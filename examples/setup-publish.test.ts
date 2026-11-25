// T-552: `publish`, the seller's step that publishes a standing offer (examples/setup-publish.ts, in site/setup.mjs).
// First what it builds, offline: the seller contract's address is the one take.mjs computes, the example is the
// template filled by a placeholder buyer, and the card entry passes the card schema and take.mjs's own reading. Then
// the done-when on anvil, through the committed bundles as a seller and a buyer run them: from no ETH a seller
// publishes a template and a card entry; a buyer's first take through site/take.mjs deploys the contract and settles;
// the example publish showed equals the deployed contract's termsOf for the same fill. A second folder sells work done
// after funding: `deliver` finds the take of its contract and delivers it. Last, `publish --revoke` prints a revocation
// that any account sends. The anvil part is skipped, saying why, without anvil and contracts/out.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { commitmentId, fillView, standingOfferView, templateFrom, templateHash, type Address, type CommitmentTerms, type Hex32 } from '@holdback/core';
import Ajv2020 from 'ajv/dist/2020.js';
import { createPublicClient, createWalletClient, http, toFunctionSelector, type Hex } from 'viem';
import { generatePrivateKey, mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANVIL_SKIP, anvilReady, anvilWorld, root, type AnvilWorld } from './e2e-world.ts';
import { entryOf as cardEntryOf, exampleOf, EXAMPLE_BUYER, revocationOf, sellerAddressOf, ZERO_SALT } from './setup-publish.ts';
import type { StandingRecord } from './setup-seller.ts';
import { checkEntry, entryOf, sellerAddressOf as takeSellerAddressOf } from './take.ts';
import { pinOf } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const A = (n: string) => `0x${n.repeat(40)}` as Address;
const example = JSON.parse(readFileSync(join(root, 'spec/examples/commitment.example.json'), 'utf8'));
const { id: _id, signatures: _s, adjudicatorAcceptance: _a, ...exampleTerms } = example; // eslint-disable-line @typescript-eslint/no-unused-vars

describe('setup-publish.ts: what publish builds (T-552)', () => {
  it('computes the seller contract address take.mjs computes from the same key and salt', () => {
    for (let i = 0; i < 5; i++) {
      const key = privateKeyToAccount(generatePrivateKey()).address.toLowerCase() as Address;
      expect(sellerAddressOf(key)).toBe(takeSellerAddressOf(key, ZERO_SALT));
    }
  });

  it('shows the template filled by a placeholder buyer, its dates counted from the take, and writes an entry the card schema and take.mjs read', async () => {
    const key = privateKeyToAccount(generatePrivateKey());
    const seller = sellerAddressOf(key.address.toLowerCase() as Address);
    const terms = { ...exampleTerms, seller, price: { ...example.price, token: A('a') }, adjudication: { ...example.adjudication, fee: { ...example.adjudication.fee, token: A('a') } }, settlement: { mode: 'guaranteed_on_decision', token: A('a') } } as CommitmentTerms;
    const template = templateFrom(terms, { rules: A('7'), expiresAt: '2027-01-01T00:00:00Z', offerId: 'csv-1' });
    const shown = exampleOf(template, seller, '2026-12-01T00:00:00Z');
    expect(shown.terms).toMatchObject({ seller, buyer: EXAMPLE_BUYER, disclosure: { level: 'public' }, createdAt: '2026-12-01T00:00:00Z', price: template.terms.price, sellerPayoutAddress: template.terms.sellerPayoutAddress });
    expect(Date.parse(shown.terms.timing.deliverBy) - Date.parse(shown.terms.createdAt)).toBe(template.terms.timing.deliverBy * 1000);
    expect(shown.id).toBe(commitmentId(shown.terms));
    const { templateDigest } = await import('@holdback/core');
    const record: StandingRecord = { offerId: 'csv-1', chainId: 31337, seller, key: key.address.toLowerCase() as Address, salt: ZERO_SALT, template, signature: await key.sign({ hash: templateDigest(template, seller, 31337) }), publishedAt: '2026-12-01T00:00:00Z' };
    const card = JSON.parse(JSON.stringify({ type: 'crow-agent', name: 'seller', seller, testTokensOnly: true, offers: [{ id: 'csv-1', description: 'One CSV file.', standing: cardEntryOf(record) }] }));
    const ajv = new (Ajv2020 as unknown as typeof Ajv2020.default)({ strict: true, allErrors: true });
    const valid = ajv.compile(JSON.parse(readFileSync(join(root, 'site/card.schema.json'), 'utf8')));
    expect(valid(card), JSON.stringify(valid.errors)).toBe(true);
    const pin = pinOf({ chainId: 31337, fromBlock: 0, token: { address: A('a'), name: 'Test USDC', version: '2', symbol: 'tUSDC', decimals: 6 }, escrow: A('8'), erc3009Collector: A('9'), multicall: A('c'), rules: A('7'), beacon: A('d'), expiryMarginSec: 86_400 } as J);
    await checkEntry(entryOf(card, 'csv-1'), pin);
    // The revocation names the template's hash and goes to the contract.
    const rev = await revocationOf(generatePrivateKey(), record);
    expect(rev).toMatchObject({ templateHash: templateHash(template), to: seller });
    expect(rev.data.slice(0, 10)).toBe(toFunctionSelector('revoke(bytes32,bytes)'));
  });
});

// ---- On anvil: the done-when, through site/setup.mjs and site/take.mjs as a seller and a buyer run them ----

const ANVIL_MNEMONIC = 'test test test test test test test test test test test junk';
const CSV = 'id,email\n1,ada@example.com\n2,alan@example.com\n';
const TEMPLATE = { deliverable: { kind: 'dataset', description: 'Two customers as CSV, one row per customer.', format: 'text/csv' }, price: '5000000', checks: [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['id', 'email'] }, { id: 'rows', type: 'row_count_range', required: true, min: 2, max: 10 }], deliverWithinSec: 3600 };
const lines = (out: string): J[] => out.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
const node = (file: string, args: string[], env: Record<string, string> = {}): Promise<{ code: number | null; out: string; err: string }> =>
  new Promise((resolve) => {
    const p = spawn(process.execPath, [join(root, file), ...args], { env: { PATH: process.env['PATH'] ?? '', HOME: process.env['HOME'] ?? '', ...env } });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ code, out, err }));
  });

describe.skipIf(!anvilReady)(`publish on anvil: from no ETH to a first take that deploys and settles (T-552)${ANVIL_SKIP}`, () => {
  let a: AnvilWorld, dir: string, server: Server, base: string, takeEnv: Record<string, string>, world: string[];
  const chain = () => createPublicClient({ chain: { ...foundry, id: a.deployment.chainId }, transport: http(a.rpcUrl) });
  const setup = (args: string[], folder: string) => node('site/setup.mjs', [...args, '--folder', folder, '--test-world', '--operators', a.urls.join(','), ...(['publish', 'deliver'].includes(args[0]!) ? ['--deployment', join(dir, 'deployment.json')] : [])]);
  const take = (args: string[]) => node('site/take.mjs', args, takeEnv);
  const make = async (name: string, file: boolean) => {
    const folder = join(dir, name);
    writeFileSync(join(dir, `${name}.template.json`), JSON.stringify(TEMPLATE));
    if (file) writeFileSync(join(dir, `${name}.csv`), CSV);
    const made = await setup(['seller', '--template', join(dir, `${name}.template.json`), ...(file ? ['--file', join(dir, `${name}.csv`)] : []), '--payout', 'this-key', '--card', join(dir, `${name}-card`), '--name', name], folder);
    expect(made.code, made.out + made.err).toBe(0);
    return folder;
  };

  beforeAll(async () => {
    const { setupBundle, takeBundle } = await import(join(root, 'site/build.mjs'));
    expect(readFileSync(join(root, 'site/setup.mjs'), 'utf8') === (await setupBundle()), 'site/setup.mjs is stale: run node site/build.mjs').toBe(true);
    expect(readFileSync(join(root, 'site/take.mjs'), 'utf8') === (await takeBundle()), 'site/take.mjs is stale: run node site/build.mjs').toBe(true);
    a = await anvilWorld();
    world = a.requests;
    dir = mkdtempSync(join(tmpdir(), 'publish-'));
    writeFileSync(join(dir, 'deployment.json'), JSON.stringify(a.deployment));
    takeEnv = { HOLDBACK_OPERATORS: a.urls.join(','), HOLDBACK_DEPLOYMENT: JSON.stringify(a.deployment) };
    // The sellers' pages, on this machine: each card file as publish wrote it, read at each request.
    server = createServer((req, res) => {
      const name = String(req.url).replace(/^\/+/, '').replace(/[^a-z0-9-]/g, '');
      const file = join(dir, `${name}-card`, 'agent.json');
      if (!existsSync(file)) return (res.writeHead(404), res.end());
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<html><body><script type="application/json" id="crow-agent">${readFileSync(file, 'utf8')}</script></body></html>`);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 180_000);
  afterAll(async () => {
    server?.close();
    await a?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('done-when: from no ETH a seller publishes a template and a card entry; a first take through take.mjs deploys the contract and settles; the example equals termsOf; a revocation any account sends ends the template', async () => {
    const folder = await make('fixed', true);
    const state = () => JSON.parse(readFileSync(join(folder, 'crow.json'), 'utf8'));
    const key = state().address as Address;
    const seller = sellerAddressOf(key);

    // The preview sends nothing: no POST reaches an operator.
    const before = world.length;
    const preview = await setup(['publish', '--preview'], folder);
    expect(preview.code, preview.out + preview.err).toBe(0);
    expect(lines(preview.out).at(-1)).toMatchObject({ step: 'preview', seller, key, example: { seller, buyer: EXAMPLE_BUYER } });
    expect(world.slice(before)).toEqual([]);
    expect(existsSync(join(folder, 'first-deal.started')), 'the preview writes no marker').toBe(false);

    // publish: the ciphertext once, the faucet's mandate for the contract, and nothing on chain.
    const published = await setup(['publish', '--offer-id', 'customers-2'], folder);
    expect(published.code, published.out + published.err).toBe(0);
    const out = lines(published.out);
    expect(world.slice(before).map((r) => r.replace(/\?.*$/, ''))).toEqual(['POST /v1/ciphertext', 'POST /v1/faucet']);
    // The marker first: the requests that name the folder come after it (D73).
    expect(JSON.parse(readFileSync(join(folder, 'first-deal.started'), 'utf8'))).toMatchObject({ step: 'marker', by: 'publish' });
    expect(lines(published.err).find((l) => l.step === 'marker')).toBeDefined();
    const shown = out.find((l) => l.step === 'template');
    expect(shown).toMatchObject({ ok: true, offerId: 'customers-2', seller, key, delivery: { plaintextMime: 'text/csv' } });
    expect(out.at(-1)).toMatchObject({ step: 'publish', ok: true, seller, offerId: 'customers-2', kept: false });
    expect(await chain().getCode({ address: seller }), 'publish deploys nothing').toBeUndefined();
    for (const addr of [key, sellerAddressOf(key)]) expect(await chain().getBalance({ address: addr })).toBe(0n);
    // Run again with nothing changed: the template is kept, and nothing is signed anew.
    const again = await setup(['publish', '--offer-id', 'customers-2'], folder);
    expect(lines(again.out).at(-1), again.out).toMatchObject({ step: 'publish', ok: true, kept: true, templateHash: shown.templateHash });
    expect(state().standing).toHaveLength(1);

    // The buyer: take.mjs from the seller's page, stopped for the principal's yes, then approved.
    const cardUrl = `${base}/fixed`;
    const offer = await take([cardUrl, 'customers-2', join(dir, 'buyer-1'), '100000000']);
    expect(offer.code, offer.err).toBe(3);
    const terms = JSON.parse(offer.out);
    expect(terms).toMatchObject({ seller, offerId: 'customers-2', price: { amount: TEMPLATE.price }, sellerPayoutAddress: key, deliverable: TEMPLATE.deliverable });
    const done = await take(['approve', join(dir, 'buyer-1'), terms.commitmentId, '100000000']);
    expect(done.code, done.err).toBe(0);
    const result = JSON.parse(done.out.trim().split('\n').at(-1)!);
    expect(result).toMatchObject({ commitmentId: terms.commitmentId, outcome: 'Released' });
    expect(readFileSync(result.file, 'utf8')).toBe(CSV);
    // The first take deployed the contract; the seller still holds no ETH.
    expect(await chain().getCode({ address: seller })).not.toBeUndefined();
    expect(await chain().getBalance({ address: key })).toBe(0n);

    // The example publish showed is the deployed contract's termsOf for the same fill.
    const abi = JSON.parse(readFileSync(join(root, 'contracts/out/HoldbackStandingSeller.sol/HoldbackStandingSeller.json'), 'utf8')).abi;
    const read = <T>(functionName: string, args: unknown[]) => chain().readContract({ address: seller, abi, functionName, args }) as Promise<T>;
    const record: StandingRecord = state().standing[0];
    const fill = exampleOf(record.template, seller, shown.example.createdAt).fill;
    const onChain: J = await read('termsOf', [standingOfferView(record.template), fillView(fill)]);
    expect(await read<Hex32>('commitmentId', [onChain])).toBe(shown.exampleId);
    expect(commitmentId(shown.example)).toBe(shown.exampleId);
    expect([String(onChain.seller).toLowerCase(), String(onChain.buyer).toLowerCase(), String(onChain.sellerPayoutAddress).toLowerCase()]).toEqual([seller, EXAMPLE_BUYER, key]);

    // Revoke: the signed transaction, sent by an account that is not the seller's; the card drops the offer.
    const revoked = await setup(['publish', '--revoke', '--offer-id', 'customers-2'], folder);
    expect(revoked.code, revoked.out).toBe(0);
    const rev = lines(revoked.out).find((l) => l.step === 'revoke');
    expect(rev).toMatchObject({ to: seller, templateHash: templateHash(record.template) });
    const wallet = createWalletClient({ account: mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: 6 }), chain: { ...foundry, id: a.deployment.chainId }, transport: http(a.rpcUrl) });
    const hash = await wallet.sendTransaction({ to: rev.to as Address, data: rev.data as Hex });
    expect((await chain().waitForTransactionReceipt({ hash })).status).toBe('success');
    expect(await read<boolean>('revoked', [rev.templateHash])).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, 'fixed-card', 'agent.json'), 'utf8')).offers.some((o: J) => o.id === 'customers-2')).toBe(false);
  }, 600_000);

  it('work done after funding: deliver finds the take of the folder\'s contract, holds it until the work is there, and delivers it signed for the contract', async () => {
    const folder = await make('work', false);
    const key = JSON.parse(readFileSync(join(folder, 'crow.json'), 'utf8')).address as Address;
    const seller = sellerAddressOf(key);
    const published = await setup(['publish', '--offer-id', 'work-1'], folder);
    expect(published.code, published.out + published.err).toBe(0);
    expect(lines(published.out).find((l) => l.step === 'template')).toMatchObject({ delivery: 'work done after funding: deliver delivers each take' });

    const store = join(dir, 'buyer-2');
    const offer = await take([`${base}/work`, 'work-1', store, '100000000']);
    expect(offer.code, offer.err).toBe(3);
    const id = JSON.parse(offer.out).commitmentId as Hex32;
    const funded = await take(['approve', store, id, '100000000', '--stop-after-funding']);
    expect(funded.code, funded.err).toBe(0);
    expect(await chain().getCode({ address: seller })).not.toBeUndefined();

    // No work yet: the pass names the take and its path, and exits 4.
    const due = await setup(['deliver'], folder);
    expect(due.code, due.out + due.err).toBe(4);
    const line = lines(due.out).find((l) => l.commitmentId === id);
    expect(line).toMatchObject({ take: true, seller, due: true, state: 'Held' });
    // The work, then the pass delivers it, signed by the key for its contract; a second pass delivers nothing again.
    mkdirSync(dirname(line.workPath), { recursive: true });
    writeFileSync(line.workPath, CSV);
    const delivered = await setup(['deliver'], folder);
    expect(delivered.code, delivered.out + delivered.err).toBe(0);
    expect(lines(delivered.out).at(-1)).toMatchObject({ step: 'deliver', ok: true, delivered: [id] });
    const twice = await setup(['deliver'], folder);
    expect(lines(twice.out).at(-1), twice.out).toMatchObject({ step: 'deliver', delivered: [] });

    const resumed = await take(['resume', store, id]);
    expect(resumed.code, resumed.err).toBe(0);
    const result = JSON.parse(resumed.out.trim().split('\n').at(-1)!);
    expect(result).toMatchObject({ commitmentId: id, outcome: 'Released' });
    expect(readFileSync(result.file, 'utf8')).toBe(CSV);
    expect(await chain().getBalance({ address: key })).toBe(0n);
  }, 600_000);
});

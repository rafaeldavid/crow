// T-551: the buyer's command that takes a standing offer (examples/take.ts, bundled as site/take.mjs). First what it
// refuses from a card, offline: a template whose signature is not the key's, an address that does not follow from
// the key and the salt, another chain, rules deployment or token, a field a template does not hold (a disclosure
// level among them), another offer's template. Then the whole take on anvil, against a seller contract deployed
// through the deterministic deployer: site/take.mjs reads the card from a page on this machine, stops for the
// principal's yes, then posts, is accepted, funds, posts the standing delivery and writes the file the primary's
// accept releases. The anvil part is skipped, saying why, without anvil and contracts/out.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seal, wrapKeyForRecipients } from '@holdback/core/crypto';
import { templateDigest, templateFrom, type Address, type CommitmentTerms, type Hex32, type StandingOffer, type TakeFill } from '@holdback/core';
import Ajv2020 from 'ajv/dist/2020.js';
import { concat, createPublicClient, createWalletClient, encodeAbiParameters, http, type Hex } from 'viem';
import { generatePrivateKey, mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANVIL_SKIP, anvilReady, anvilWorld, root, type AnvilWorld } from './e2e-world.ts';
import { STANDING_SELLER_CREATION_CODE } from './standing-seller-code.ts';
import { BLOCK_BACK_SEC, cardFrom, checkEntry, DETERMINISTIC_DEPLOYER, entryOf, sellerAddressOf, takeOf, type StandingEntry } from './take.ts';
import { pinOf, publicOfferTerms, Refusal, type Pin } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const ZERO: Hex32 = `0x${'00'.repeat(32)}`;
const A = (n: string) => `0x${n.repeat(40)}` as Address;

// A pin for a local chain whose rules contract and token the offline cases name.
const RULES = A('7'), TOKEN = A('a');
const pin: Pin = pinOf({ chainId: 31337, fromBlock: 0, token: { address: TOKEN, name: 'Test USDC', version: '2', symbol: 'tUSDC', decimals: 6 }, escrow: A('8'), erc3009Collector: A('9'), multicall: A('c'), rules: RULES, beacon: A('d'), expiryMarginSec: 86_400 } as J);
const example = JSON.parse(readFileSync(join(root, 'spec/examples/commitment.example.json'), 'utf8'));
const { id: _id, signatures: _s, adjudicatorAcceptance: _a, ...exampleTerms } = example; // eslint-disable-line @typescript-eslint/no-unused-vars
const baseTerms = { ...exampleTerms, price: { ...example.price, token: TOKEN }, adjudication: { ...example.adjudication, fee: { ...example.adjudication.fee, token: TOKEN } }, settlement: { mode: 'guaranteed_on_decision', token: TOKEN } } as CommitmentTerms;

const key = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
/** A standing entry as a seller publishes it: its template signed by its key for its CREATE2 address. */
async function entry(o: { salt?: Hex32; signer?: typeof key; offerId?: string; rules?: Address } = {}): Promise<StandingEntry> {
  const salt = o.salt ?? ZERO;
  const seller = sellerAddressOf(key.address.toLowerCase() as Address, salt);
  const template: StandingOffer = templateFrom(baseTerms, { rules: o.rules ?? RULES, expiresAt: '2027-01-01T00:00:00Z', offerId: o.offerId ?? 'csv-1' });
  const signature = await (o.signer ?? key).sign({ hash: templateDigest(template, seller, 31337) });
  return { chainId: 31337, seller, key: key.address.toLowerCase() as Address, salt, template, signature };
}
const cardOf = (e: StandingEntry, offerId = 'csv-1') => ({ type: 'crow-agent', name: 'A seller', seller: e.seller, offers: [{ id: offerId, description: 'One CSV file.', standing: e }] });
const refusal = async (p: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof p === 'function' ? p() : p);
  } catch (e) {
    if (e instanceof Refusal) return e.message;
    throw e;
  }
  throw new Error('expected a refusal');
};

describe('take.ts: what it refuses from a card (T-551)', () => {
  const out = join(root, 'contracts/out/HoldbackStandingSeller.sol/HoldbackStandingSeller.json');
  it.skipIf(!existsSync(out))(`pins the creation code forge builds, so the address it computes is the contract the deployer makes${existsSync(out) ? '' : ' (SKIPPED: needs contracts/out; the anvil case checks the address)'}`, () => {
    expect(STANDING_SELLER_CREATION_CODE, 'examples/standing-seller-code.ts is not contracts/out: copy bytecode.object again, then build the site').toBe(JSON.parse(readFileSync(out, 'utf8')).bytecode.object);
  });

  it('reads the card as JSON or from a page\'s crow-agent block', async () => {
    const card = cardOf(await entry());
    expect(cardFrom(JSON.stringify(card))).toEqual(card);
    expect(cardFrom(`<html><body><script type="application/json" id="crow-agent">${JSON.stringify(card)}</script></body></html>`)).toEqual(card);
    expect(() => cardFrom('<html></html>')).toThrow(/no crow-agent card/);
    // A planted block beside the real one is refused, and a data-id attribute is not the id.
    const block = `<script type="application/json" id="crow-agent">${JSON.stringify(card)}</script>`;
    expect(() => cardFrom(`<!-- ${block} -->${block}`)).toThrow(/2 crow-agent blocks/);
    expect(() => cardFrom(`<script type="text/plain" data-id="crow-agent">${JSON.stringify(card)}</script>`)).toThrow(/no crow-agent card/);
  });

  it('refuses any chain but Sepolia or a local chain, and a standing file it could not open as text', async () => {
    const mainnet = { ...pin, domain: { ...pin.domain, chainId: 1 } } as Pin;
    expect(await refusal(checkEntry({ ...(await entry()), chainId: 1 }, mainnet))).toMatch(/chain 1 is not Sepolia .* test tokens only/);
    const delivery = { ciphertext: { uri: 'https://op.example/v1/ciphertext/x', sha256: `sha256:${'0'.repeat(64)}`, bytes: 1, cipher: 'aes-256-gcm' }, plaintextSha256: `sha256:${'1'.repeat(64)}`, plaintextMime: 'application/octet-stream', encryptedKeys: [], submittedAt: '2026-10-30T10:00:00Z' };
    const seller = sellerAddressOf(key.address.toLowerCase() as Address, ZERO);
    const template = { ...templateFrom(baseTerms, { rules: RULES, expiresAt: '2027-01-01T00:00:00Z', offerId: 'csv-1' }), delivery } as StandingOffer;
    const binary: StandingEntry = { chainId: 31337, seller, key: key.address.toLowerCase() as Address, salt: ZERO, template, signature: await key.sign({ hash: templateDigest(template, seller, 31337) }) };
    expect(await refusal(checkEntry(binary, pin))).toMatch(/opens text files only/);
  });

  it('takes a well-formed entry: the template signed by the key, at the address the key and the salt give, and builds a public take that passes the API schema', async () => {
    const e = await entry();
    const got = entryOf(JSON.parse(JSON.stringify(cardOf(e))), 'csv-1');
    await checkEntry(got, pin);
    const fill: TakeFill = { buyer: A('1'), buyerPaymentAddress: A('1'), buyerEncryptionPublicKey: example.buyerEncryptionPublicKey, nonceSeed: `0x${'55'.repeat(32)}` as Hex32, createdAt: '2026-11-25T00:00:00Z' };
    const t = takeOf(got, fill);
    expect(t.terms.disclosure).toEqual({ level: 'public' });
    expect(t.terms.seller).toBe(e.seller);
    expect(t.terms.timing.deliverBy).toBe(new Date(Date.parse(fill.createdAt) + e.template.terms.timing.deliverBy * 1000).toISOString().replace('.000Z', 'Z'));
  });

  it('refuses a template whose signature is not the key\'s', async () => {
    const e = await entry({ signer: privateKeyToAccount(generatePrivateKey()) });
    expect(await refusal(checkEntry(e, pin))).toMatch(/signature is not the key .*'s under the seller contract's domain/);
    // The key's own signature over another template (another offer) does not carry over either.
    const other = await entry({ offerId: 'csv-2' });
    expect(await refusal(checkEntry({ ...(await entry()), signature: other.signature }, pin))).toMatch(/signature is not the key/);
  });

  it('refuses an address that does not follow from the key and the salt', async () => {
    const e = await entry();
    expect(await refusal(checkEntry({ ...e, salt: `0x${'00'.repeat(31)}01` as Hex32 }, pin))).toMatch(/does not follow from the key .* and the salt/);
    // A contract elsewhere that answers yes to anything: its template is signed for its own address, and still refused.
    const elsewhere = A('e');
    const t = e.template;
    const signature = await key.sign({ hash: templateDigest(t, elsewhere, 31337) });
    expect(await refusal(checkEntry({ ...e, seller: elsewhere, signature }, pin))).toMatch(/does not follow from the key/);
  });

  it('refuses another chain, another rules deployment and another token', async () => {
    const e = await entry();
    expect(await refusal(checkEntry({ ...e, chainId: 11155111 }, pin))).toMatch(/not the pinned chain 31337/);
    expect(await refusal(checkEntry(await entry({ rules: A('6') }), pin))).toMatch(/names the rules deployment/);
    const t = structuredClone(e.template);
    t.terms.price = { token: A('b'), amount: t.terms.price.amount };
    expect(await refusal(checkEntry({ ...e, template: t }, pin))).toMatch(/not both in the pinned token/);
  });

  it('refuses a template field a template does not hold, a disclosure level among them, and another offer\'s template', async () => {
    const card = cardOf(await entry());
    const withField = (f: (s: J) => void) => {
      const c = structuredClone(card) as J;
      f(c.offers[0].standing);
      return c;
    };
    expect(await refusal(() => entryOf(withField((s) => (s.template.terms.disclosure = { level: 'private' })), 'csv-1'))).toMatch(/terms\."disclosure" is not a field a standing offer holds/);
    expect(await refusal(() => entryOf(withField((s) => (s.template.terms.timing.extra = 1)), 'csv-1'))).toMatch(/timing\."extra" is not a field/);
    expect(await refusal(() => entryOf(withField((s) => (s.template.buyer = A('1'))), 'csv-1'))).toMatch(/template\."buyer" is not a field/);
    expect(await refusal(() => entryOf(withField((s) => (s.template.offerId = 'csv-2')), 'csv-1'))).toMatch(/offerId is "csv-2", not the card's offer "csv-1"/);
    expect(await refusal(() => entryOf(card, 'other'))).toMatch(/lists 0 offers with the id "other"/);
    expect(await refusal(() => entryOf({ ...card, offers: [{ id: 'csv-1', terms: {} }] }, 'csv-1'))).toMatch(/has no standing entry/);
    expect(await refusal(() => entryOf(withField((s) => (s.signature = '0x1234')), 'csv-1'))).toMatch(/64- or 65-byte signature/);
    // A field a later card adds to the entry itself, outside the signed template, is left unread, as the schema allows.
    expect(entryOf(withField((s) => (s.note = 'later field')), 'csv-1').seller).toBe(card.offers[0]!.standing.seller);
  });

  it('a card with a standing entry passes the card schema, and so does the schema\'s own example', async () => {
    const schema = JSON.parse(readFileSync(join(root, 'site/card.schema.json'), 'utf8'));
    const ajv = new (Ajv2020 as unknown as typeof Ajv2020.default)({ strict: true, allErrors: true });
    const valid = ajv.compile(schema);
    const card = JSON.parse(JSON.stringify(cardOf(await entry())));
    expect(valid(card), JSON.stringify(valid.errors)).toBe(true);
    const ex = schema.$defs.standing.examples[0];
    expect(valid({ type: 'crow-agent', offers: [{ id: ex.template.offerId, standing: ex }] }), JSON.stringify(valid.errors)).toBe(true);
    // The schema's example is the shape entryOf takes, and its signature and address pass under a pin for its chain.
    const got = entryOf({ type: 'crow-agent', offers: [{ id: ex.template.offerId, standing: ex }] }, ex.template.offerId);
    await checkEntry(got, pinOf({ chainId: ex.chainId, fromBlock: 0, token: { address: ex.template.terms.price.token, name: 'Test USDC', version: '2', symbol: 'tUSDC', decimals: 6 }, escrow: A('8'), erc3009Collector: A('9'), multicall: A('c'), rules: ex.template.rules, beacon: A('d'), expiryMarginSec: 86_400 } as J));
  });
});

// ---- On anvil: the whole take, through site/take.mjs as a buyer runs it ----

const ANVIL_MNEMONIC = 'test test test test test test test test test test test junk';
const CSV = 'id,email\n1,ada@example.com\n2,alan@example.com\n';
const call = async (base: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<J> => {
  const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': body instanceof Uint8Array ? 'application/octet-stream' : 'application/json', ...(method === 'POST' ? { 'idempotency-key': crypto.randomUUID() } : {}) }, ...(body === undefined ? {} : { body: body instanceof Uint8Array ? body : JSON.stringify(body) }) });
  const out = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(out)}`);
  return out;
};
const run = (args: string[], env: Record<string, string>): Promise<{ code: number | null; out: string; err: string }> =>
  new Promise((resolve) => {
    const p = spawn(process.execPath, [join(root, 'site/take.mjs'), ...args], { env: { PATH: process.env['PATH'] ?? '', ...env } });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ code, out, err }));
  });

describe.skipIf(!anvilReady)(`site/take.mjs on anvil, against a deployed seller contract (T-551)${ANVIL_SKIP}`, () => {
  let a: AnvilWorld, server: Server, cardUrl: string, store: string, env: Record<string, string>, seller: Address;
  let card: J = null;

  beforeAll(async () => {
    const { takeBundle } = await import(join(root, 'site/build.mjs'));
    expect(readFileSync(join(root, 'site/take.mjs'), 'utf8') === (await takeBundle()), 'site/take.mjs is stale: run node site/build.mjs').toBe(true);
    a = await anvilWorld();
    const op = a.urls[0];
    env = { HOLDBACK_OPERATORS: a.urls.join(','), HOLDBACK_DEPLOYMENT: JSON.stringify(a.deployment) };
    // The seller: a key, its contract through the deterministic deployer at salt 0, paid for by anvil's first account.
    const sellerKey = privateKeyToAccount(generatePrivateKey());
    seller = sellerAddressOf(sellerKey.address.toLowerCase() as Address, ZERO);
    const wallet = createWalletClient({ account: mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: 0 }), chain: { ...foundry, id: a.deployment.chainId }, transport: http(a.rpcUrl) });
    const chain = createPublicClient({ chain: { ...foundry, id: a.deployment.chainId }, transport: http(a.rpcUrl) });
    const initCode = concat([STANDING_SELLER_CREATION_CODE, encodeAbiParameters([{ type: 'address' }], [sellerKey.address])]);
    const hash = await wallet.sendTransaction({ to: DETERMINISTIC_DEPLOYER, data: concat([ZERO, initCode]), gas: 3_000_000n });
    expect((await chain.waitForTransactionReceipt({ hash })).status).toBe('success');
    expect(await chain.getCode({ address: seller }), 'no code at the address take.ts computes').not.toBeUndefined();
    // Its mandate in the demo club, from the faucet, as any seller address gets one.
    await call(op, 'POST', '/v1/faucet', { address: seller });
    // The template: the demo's adjudicators, the terms an offer would carry, and one fixed file for every take.
    const found = await call(op, 'GET', '/.well-known/holdback.json');
    const role = (r: string) => found.demo.adjudicators.find((x: J) => x.role === r).address.toLowerCase();
    const adjudicators = { primary: role('primary'), fallback: role('fallback'), appeal: role('appeal') };
    const reg = await call(op, 'GET', `/v1/adjudicators/${adjudicators.primary}`);
    const club = await call(op, 'GET', `/v1/clubs/${found.demo.clubId}`);
    const createdAt = new Date(Math.floor(Date.parse(found.settlementTime) / 1000) * 1000).toISOString().replace('.000Z', 'Z');
    const terms = publicOfferTerms(
      { clubId: found.demo.clubId, buyer: { address: A('1'), encryptionPublicKey: example.buyerEncryptionPublicKey }, seller, sellerPayoutAddress: sellerKey.address.toLowerCase(), adjudicators, template: 'checks-only', price: { token: found.demo.token.id.toLowerCase(), amount: '5000000' }, deliverable: { kind: 'dataset', description: 'Two customers, a finished file.', format: 'text/csv' }, checks: [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['id', 'email'] }, { id: 'rows', type: 'row_count_range', required: true, min: 2, max: 10 }] },
      reg, club.rulebookHash, createdAt, ZERO,
    );
    const sealed = await seal(new TextEncoder().encode(CSV));
    const stored = await call(op, 'POST', '/v1/ciphertext', sealed.ciphertext);
    const keys = await Promise.all(Object.values(adjudicators).map(async (x) => ({ recipient: x as Address, publicKey: (await call(op, 'GET', `/v1/adjudicators/${x}`)).encryptionPublicKey })));
    const delivery = { ciphertext: { uri: stored.uri, sha256: stored.id, bytes: stored.bytes, cipher: 'aes-256-gcm' }, plaintextSha256: sealed.plaintextSha256, plaintextMime: 'text/csv', encryptedKeys: wrapKeyForRecipients(sealed.key, keys), submittedAt: createdAt };
    const template = templateFrom(terms, { rules: a.deployment.rules.toLowerCase(), expiresAt: new Date(Date.parse(createdAt) + 86_400_000).toISOString().replace('.000Z', 'Z'), offerId: 'customers-2', delivery } as J);
    const signature = await sellerKey.sign({ hash: templateDigest(template, seller, a.deployment.chainId) });
    // A second offer whose file the store never held: its template is signed and well formed all the same.
    const lost = templateFrom(terms, { rules: a.deployment.rules.toLowerCase(), expiresAt: template.expiresAt, offerId: 'lost-file', delivery: { ...delivery, ciphertext: { ...delivery.ciphertext, uri: `${op}/v1/ciphertext/sha256:${'ab'.repeat(32)}` } } } as J);
    const lostSignature = await sellerKey.sign({ hash: templateDigest(lost, seller, a.deployment.chainId) });
    const standing = (t: StandingOffer, sig: Hex) => ({ chainId: a.deployment.chainId, seller, key: sellerKey.address.toLowerCase(), salt: ZERO, template: t, signature: sig });
    card = JSON.parse(JSON.stringify({ type: 'crow-agent', name: 'A standing seller', seller, offers: [{ id: 'customers-2', description: 'Two customers as CSV.', standing: standing(template, signature) }, { id: 'lost-file', description: 'A file the store lost.', standing: standing(lost, lostSignature) }] }));
    // The seller's page, on this machine: from here on the seller signs nothing.
    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<html><body><h1>A standing seller</h1><script type="application/json" id="crow-agent">${JSON.stringify(card)}</script></body></html>`);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    cardUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    store = mkdtempSync(join(tmpdir(), 'take-'));
  }, 180_000);
  afterAll(async () => {
    server?.close();
    await a?.close();
    if (store) rmSync(store, { recursive: true, force: true });
  });

  it('stops for the principal\'s yes with the filled terms, then takes, funds, delivers and writes the file after the primary\'s accept', async () => {
    const shown = await run([cardUrl, 'customers-2', store, '100000000'], env);
    expect(shown.code, shown.err).toBe(3);
    const offer = JSON.parse(shown.out);
    expect(offer).toMatchObject({ approval: 'needed', offerId: 'customers-2', seller, disclosure: { level: 'public' }, price: { amount: '5000000' }, delivery: { plaintextMime: 'text/csv' } });
    expect(Date.parse(offer.createdAt)).toBeLessThanOrEqual(Date.now() - BLOCK_BACK_SEC * 1000 + 5000);
    const approve = shown.err.trim().split('\n').at(-1)!;
    expect(approve).toMatch(new RegExp(`node take\\.mjs approve \\S+ ${offer.commitmentId} 100000000$`));
    // Nothing reached an operator before the yes.
    await expect(call(a.urls[0], 'GET', `/v1/commitments/${offer.commitmentId}`)).rejects.toThrow(/404/);

    const done = await run(['approve', store, offer.commitmentId, '100000000'], env);
    expect(done.code, done.err).toBe(0);
    const result = JSON.parse(done.out.trim().split('\n').at(-1)!);
    expect(result).toMatchObject({ commitmentId: offer.commitmentId, outcome: 'Released' });
    expect(readFileSync(result.file, 'utf8')).toBe(CSV);
    for (const op of a.urls) expect((await call(op, 'GET', `/v1/commitments/${offer.commitmentId}`)).escrowState).toBe('Released');
  }, 300_000);

  it('attack.standing-ciphertext-missing: refuses a standing delivery whose file no operator serves, before it shows anything', async () => {
    const shown = await run([cardUrl, 'lost-file', store, '100000000'], env);
    expect(shown.code, shown.err).toBe(1);
    expect(shown.err).toMatch(/does not serve the standing delivery's file .* funded and never delivered/);
    expect(shown.out).toBe('');
  }, 120_000);

  it('a take funded with --stop-after-funding gets its standing delivery and its file from resume', async () => {
    const shown = await run([cardUrl, 'customers-2', store, '100000000'], env);
    expect(shown.code, shown.err).toBe(3);
    const id = JSON.parse(shown.out).commitmentId;
    const funded = await run(['approve', store, id, '100000000', '--stop-after-funding'], env);
    expect(funded.code, funded.err).toBe(0);
    expect(funded.err).toMatch(new RegExp(`resume \\S+ ${id}`));
    expect((await call(a.urls[0], 'GET', `/v1/commitments/${id}`)).escrowState).toBe('Held');
    const resumed = await run(['resume', store, id], env);
    expect(resumed.code, resumed.err).toBe(0);
    const result = JSON.parse(resumed.out.trim().split('\n').at(-1)!);
    expect(result).toMatchObject({ commitmentId: id, outcome: 'Released' });
    expect(result.otherFile).toBeUndefined();
    expect(readFileSync(result.file, 'utf8')).toBe(CSV);
  }, 300_000);
});

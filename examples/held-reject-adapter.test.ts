// T-625 (ADR-0051, the partner C rehearsal of 2026-11-25): a seller on Crow's adapter, with its own key, keeps the
// delivery it signs and hands it to the deal's buyer while the primary's reject is held, so the buyer's lone accept can
// run (examples/held-reject.ts --accept <adapter>). Nobody else gets it, and a seller may share it never.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startSimWorld, type SimWorld } from '@holdback/operator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Hex } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Agent } from './agent.ts';
import { deliveryFrom, heldView, main } from './held-reject.ts';
import { config as shipped, startSellerAdapter, type RunningAdapter, type SellerAdapterConfig } from './seller-adapter.ts';
import { startStubSellerApi, type StubSellerApi } from './seller-adapter-stub.ts';
import { Refusal } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const SAMPLE = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/data/audit-report/report.json', import.meta.url)), 'utf8'));
const SMALL = { commit: SAMPLE.commit as string, files: SAMPLE.filesReviewed as string[], lines: 3000 };

let world: SimWorld;
let stub: StubSellerApi | undefined;
const adapters: RunningAdapter[] = [];
const dirs: string[] = [];
const acct = (label: string) => world.info.accounts.find((a) => a.label === label)!;
const agent = (label: string) => new Agent(world.info.operators, acct(label).privateKey as Hex, Buffer.from(acct(label).encryptionSecretKey, 'base64url'));
beforeAll(async () => {
  world = await startSimWorld({ env: {}, onError: () => {} });
});
afterAll(async () => {
  await world.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
afterEach(async () => {
  for (const a of adapters.splice(0)) await a.close();
  await stub?.close();
  stub = undefined;
});

/** A rubric deal (the shipped panel option) whose report the sim judges fail, funded by `buyer`, delivered by the adapter. */
async function heldDeal(buyerLabel: string, over: Partial<SellerAdapterConfig> = {}) {
  stub = await startStubSellerApi({ port: 0, pollsUntilComplete: 0, report: 'fail-me' });
  const [primary, fallback, appeal] = world.info.adjudicators.map((a) => a.address);
  const dir = mkdtempSync(join(tmpdir(), 't625-'));
  dirs.push(dir);
  const running = await startSellerAdapter(
    { ...shipped, port: 0, sellerApi: stub.api, clubId: world.info.clubId, adjudicators: { primary: primary!, fallback: fallback!, appeal: appeal! }, journal: join(dir, 'journal.json'), pollMs: 50, log: () => {}, ...over },
    { HOLDBACK_KEY: acct('seller-1').privateKey, HOLDBACK_OPERATORS: world.info.operators.join(',') },
  );
  adapters.push(running);
  const buyer = agent(buyerLabel);
  const res = await fetch(`${running.url}/quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ buyer: buyer.address, buyerEncryptionPublicKey: buyer.encryptionPublicKey, scope: SMALL, options: { panel: true } }) });
  const quote = (await res.json()) as J;
  expect(res.status, JSON.stringify(quote)).toBe(200);
  const id = quote.commitmentId as Hex;
  await buyer.waitFor(id, ['AcceptedByAdjudicator']);
  const terms = await buyer.call('GET', `/v1/commitments/${id}/terms`);
  delete terms.id;
  delete terms.signatures;
  await buyer.agreeAndFund(terms, 6_000_000_000n);
  let view = await heldView(buyer, id);
  for (const end = Date.now() + 30_000; !view.held && Date.now() < end; view = await heldView(buyer, id)) await new Promise((r) => setTimeout(r, 100));
  return { running, buyer, id, view };
}

const env = (label: string) => ({ HOLDBACK_KEY: acct(label).privateKey, HOLDBACK_ENCRYPTION_KEY: acct(label).encryptionSecretKey, HOLDBACK_OPERATORS: world.info.operators.join(',') });

describe('the adapter hands the held deal\'s buyer its signed delivery (T-625)', () => {
  it('keeps the delivery its own key signed, and the buyer accepts with it during the hold', async () => {
    const { running, buyer, id, view } = await heldDeal('buyer-1');
    expect(view).toMatchObject({ escrowState: 'Delivered', held: true });
    // The journal keeps the signed body in key mode too: the one the settlement layer holds.
    const kept = running.deals().find((d) => d.id === id)!;
    expect(kept.signedDelivery?.body.commitmentId).toBe(id);
    // Another key, a stale time and no signature get 404, as any deal the adapter does not hold.
    const stranger = new Agent(world.info.operators, generatePrivateKey(), new Uint8Array(32));
    await expect(deliveryFrom(stranger, running.url, id)).rejects.toThrow(Refusal);
    expect((await fetch(`${running.url}/deals/${id}/delivery`)).status).toBe(404);
    const old = Math.floor(Date.now() / 1000) - 3_600;
    const stale = await buyer.account.signMessage({ message: `crow.delivery:${id}:${old}:${'0'.repeat(16)}` });
    expect((await fetch(`${running.url}/deals/${id}/delivery?at=${old}&nonce=${'0'.repeat(16)}&signature=${stale}`)).status).toBe(404);
    // The buyer's own request gets it, and the accept runs from the adapter's address, the quote URL accepted too.
    expect((await deliveryFrom(buyer, `${running.url}/quote`, id)).commitmentId).toBe(id);
    expect(await main([id, '--accept', running.url], env('buyer-1'))).toBe(0);
    expect((await buyer.waitFor(id, ['Released'])).escrowState).toBe('Released');
    // Once the deal is closed the adapter shares nothing.
    await expect(deliveryFrom(buyer, running.url, id)).rejects.toThrow(/404/);
  }, 90_000);

  it('a seller that chose never shares nothing, and the buyer\'s accept refuses with no payment', async () => {
    const { running, buyer, id, view } = await heldDeal('buyer-2', { shareDelivery: 'never' });
    expect(view.held).toBe(true);
    await expect(deliveryFrom(buyer, running.url, id)).rejects.toThrow(/does not share this delivery/);
    expect(await main([id, '--accept', running.url], env('buyer-2'))).toBe(3);
    expect((await buyer.call('GET', `/v1/commitments/${id}`)).escrowState).toBe('Delivered');
  }, 90_000);
});

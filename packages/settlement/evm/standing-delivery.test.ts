// T-550, ADR-0040 §2: a standing delivery on the unchanged rules contract, on a local anvil (chain id 31337,
// 127.0.0.1 only). The delivery holds envelopes for the three adjudicators and none for the buyer, and the buyer posts
// it. The contract's simulation reverts an early accept and a settlement that releases the key (BadKeyProof), whether
// the delivery was posted on chain or travels with the call, so nothing is sent; core's own step refuses both with its
// reason (`coreSays`). Since T-549 the adapter steps core first when the delivery has no envelope for the buyer, so on
// chain the agent reads core's reason, not the bare revert (T-550's hand-over). The primary's accept carries the
// buyer's key and settles. Needs `anvil` on PATH and `forge build` output in contracts/out; skipped without.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { signMessage, step, type Delivery, type EscrowEvent } from '@holdback/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Submission } from '../src/interface.js';
import type { EvmSettlement } from './evm-settlement.js';
import { must, newSettlement } from './gas.js';
import { EvmDeal, type EvmCast } from './testing.js';
import { anvilAvailable, EvmWorld } from './world.js';

const root = join(import.meta.dirname, '..', '..', '..');
const ready = anvilAvailable() && existsSync(join(root, 'contracts', 'out', 'HoldbackRules.sol', 'HoldbackRules.json'));
const NO_KEY = /no envelope for the buyer .* comes only with an adjudicator's accept/;

/** The seller's one delivery with no envelope for the buyer, signed by the seller's key. */
async function standing(chain: EvmSettlement, cast: EvmCast, d: EvmDeal): Promise<Delivery> {
  const { adjudication } = d.terms;
  const body: Omit<Delivery, 'signature'> = {
    commitmentId: d.id,
    attempt: 1,
    ciphertext: { uri: `sim://blobs/standing-${d.id.slice(2, 14)}`, sha256: `sha256:${'c'.repeat(64)}`, bytes: 100, cipher: 'aes-256-gcm' },
    plaintextSha256: `sha256:${'d'.repeat(64)}`,
    plaintextMime: 'text/csv',
    encryptedKeys: [adjudication.adjudicator, adjudication.fallbackAdjudicator, adjudication.appealAdjudicator].map((r) => d.envelope(r)),
    submittedAt: chain.now(),
  };
  const signature = await signMessage(cast.seller.key, chain.domain, { ...body, type: 'Delivery' as const });
  d.delivery = { ...body, signature };
  return d.delivery;
}

async function funded(chain: EvmSettlement, cast: EvmCast, club: Awaited<ReturnType<typeof newSettlement>>['club'], tag: string): Promise<EvmDeal> {
  const d = new EvmDeal(chain, cast, club, tag);
  await must(chain, cast, d.offer());
  await must(chain, cast, d.accept());
  await must(chain, cast, d.agreeAndFund());
  return d;
}

/** What core alone says of the submission in the adapter's current state, before any transaction. */
function coreSays(chain: EvmSettlement, d: EvmDeal, s: Submission): string {
  const state = chain.escrowState(d.id)!;
  const at = chain.now();
  const events: EscrowEvent[] =
    s.kind === 'early_accept'
      ? [{ type: 'early_accept', at, message: s.message }]
      : s.kind === 'mutual_settle'
        ? [{ type: 'mutual_settle', at, message: s.message, rule: { allowed: true, payoutsTo: 'parties' } }]
        : [];
  let st = state;
  for (const e of events) {
    const r = step(st, e, 'phase_one');
    if (!r.ok) return `${r.error.type}: ${r.error.detail}`;
    st = r.value;
  }
  return `ok: ${st.kind}`;
}

describe.skipIf(!ready)(`a standing delivery on anvil (T-550)${ready ? '' : ' (SKIPPED: needs anvil on PATH and forge build output in contracts/out)'}`, () => {
  let world: EvmWorld;
  beforeAll(async () => {
    world = await EvmWorld.start(root);
  }, 60_000);
  afterAll(async () => {
    await world?.stop();
  });

  it('posted on chain by the buyer: the contract reverts the early accept and the key release, core refuses both with its reason, and the primary accept settles with the key', async () => {
    const { chain, cast, club } = await newSettlement(world);
    const d = await funded(chain, cast, club, 'standing-posted');
    const delivery = await standing(chain, cast, d);
    // The buyer posts the seller's delivery and pays the gas; the signature is the seller's.
    const posted = await chain.submit({ kind: 'deliver', delivery }, { via: 'op-1', sender: cast.buyer.key });
    expect(posted.ok ? 'ok' : posted.problem.detail).toBe('ok');
    chain.advance(1);
    expect((await chain.stage(d.id)).stage).toBe('Delivered');

    const early = await d.earlyAccept();
    expect(coreSays(chain, d, early)).toMatch(NO_KEY);
    const e = await chain.submit(early, { via: 'op-1', sender: cast.buyer.key });
    expect(e.ok ? 'ok' : e.problem.type).toBe('invalid_terms');
    expect(e.ok ? 'ok' : e.problem.detail).toMatch(NO_KEY);

    const release = await d.mutual(BigInt(d.terms.price.amount), true);
    expect(coreSays(chain, d, release)).toMatch(/no envelope for the buyer .* a settlement that releases the key/);
    const m = await chain.submit(release, { via: 'op-1', sender: cast.operator.key });
    expect(m.ok ? 'ok' : m.problem.type).toBe('invalid_terms');
    expect(m.ok ? 'ok' : m.problem.detail).toMatch(/no envelope for the buyer .* a settlement that releases the key/);

    // Nothing moved: the deal waits for its adjudicator, and no key reached the buyer.
    expect((await chain.stage(d.id)).stage).toBe('Delivered');
    expect(await chain.keysFor(d.id, cast.buyer.address)).toEqual([]);

    await must(chain, cast, d.decide('primary', 'accept'));
    expect((await chain.stage(d.id)).stage).toBe('Released');
    expect(chain.escrowState(d.id)?.kind).toBe('Released');
    expect(await chain.tokenBalance(cast.seller.address)).toBe(BigInt(d.terms.price.amount));
    const keys = await chain.keysFor(d.id, cast.buyer.address);
    expect(keys.map((k) => k.ciphertext)).toEqual([d.envelope(d.terms.buyer).ciphertext]);
    expect(await chain.replayCheck()).toMatchObject({ ok: true });
  }, 60_000);

  it('carried by the early accept in Held: the contract lands the delivery inside the call and reverts at the key proof', async () => {
    const { chain, cast, club } = await newSettlement(world);
    const d = await funded(chain, cast, club, 'standing-carried');
    const delivery = await standing(chain, cast, d);
    expect(await chain.carryDelivery(delivery)).toBeNull();
    chain.advance(1);
    const e = await chain.submit(await d.earlyAccept(), { via: 'op-1', sender: cast.buyer.key });
    expect(e.ok ? 'ok' : e.problem.type).toBe('invalid_terms');
    expect(e.ok ? 'ok' : e.problem.detail).toMatch(NO_KEY);
    expect((await chain.stage(d.id)).stage).toBe('Held');
    // The carried delivery still settles by the primary's accept, which carries it (D4's two transactions).
    await must(chain, cast, d.decide('primary', 'accept'));
    expect((await chain.stage(d.id)).stage).toBe('Released');
    expect(await chain.keysFor(d.id, cast.buyer.address)).toHaveLength(1);
    expect(chain.transactions().map((t) => t.call)).toEqual(['agreeAndFund', 'decide']);
  }, 60_000);
});

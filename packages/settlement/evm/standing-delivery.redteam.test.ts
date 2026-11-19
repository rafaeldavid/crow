// RED TEAM (T-550, ADR-0040 §2) on anvil, the phase-one contracts unchanged: a standing delivery (envelopes for the
// three adjudicators, none for the buyer) through the stages the change's own anvil test leaves out. Expected: no path
// pays the seller without a key reaching the buyer unless the buyer signed for that; core and the contract agree on
// each refusal (no "EVM/core divergence"); and every deal still ends by its terms. Needs anvil and contracts/out.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { deliveryHash, signMessage, type Delivery } from '@holdback/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EvmSettlement } from './evm-settlement.js';
import { must, newSettlement } from './gas.js';
import { EvmDeal, type EvmCast } from './testing.js';
import { anvilAvailable, EvmWorld } from './world.js';

const root = join(import.meta.dirname, '..', '..', '..');
const ready = anvilAvailable() && existsSync(join(root, 'contracts', 'out', 'HoldbackRules.sol', 'HoldbackRules.json'));
const secs = (ts: string) => Math.floor(Date.parse(ts) / 1000);

async function standing(chain: EvmSettlement, cast: EvmCast, d: EvmDeal): Promise<Delivery> {
  const { adjudication } = d.terms;
  const body: Omit<Delivery, 'signature'> = {
    commitmentId: d.id,
    attempt: 1,
    ciphertext: { uri: `sim://blobs/rt-${d.id.slice(2, 14)}`, sha256: `sha256:${'c'.repeat(64)}`, bytes: 100, cipher: 'aes-256-gcm' },
    plaintextSha256: `sha256:${'d'.repeat(64)}`,
    plaintextMime: 'text/csv',
    encryptedKeys: [adjudication.adjudicator, adjudication.fallbackAdjudicator, adjudication.appealAdjudicator].map((r) => d.envelope(r)),
    submittedAt: chain.now(),
  };
  d.delivery = { ...body, signature: await signMessage(cast.seller.key, chain.domain, { ...body, type: 'Delivery' as const }) };
  return d.delivery;
}

describe.skipIf(!ready)(`RED TEAM T-550: a standing delivery on anvil${ready ? '' : ' (SKIPPED: needs anvil and contracts/out)'}`, () => {
  let world: EvmWorld;
  beforeAll(async () => {
    world = await EvmWorld.start(root);
  }, 60_000);
  afterAll(async () => {
    await world?.stop();
  });

  async function posted(tag: string) {
    const { chain, cast, club } = await newSettlement(world);
    const d = new EvmDeal(chain, cast, club, tag);
    await must(chain, cast, d.offer());
    await must(chain, cast, d.accept());
    await must(chain, cast, d.agreeAndFund());
    const delivery = await standing(chain, cast, d);
    const r = await chain.submit({ kind: 'deliver', delivery }, { via: 'op-1', sender: cast.buyer.key });
    expect(r.ok ? 'ok' : r.problem.detail).toBe('ok');
    chain.advance(1);
    return { chain, cast, d, delivery };
  }
  const refusal = async (chain: EvmSettlement, cast: EvmCast, s: Parameters<EvmSettlement['submit']>[0]) => {
    const r = await chain.submit(s, { via: 'op-1', sender: cast.operator.key });
    return r.ok ? `ok: ${r.state.escrowState}` : `${r.problem.type}: ${r.problem.detail}`;
  };

  it('attack: during the fallback takeover, settle with the key. Expected: refused with the reason core gives, before any transaction, no divergence; the fallback accept settles with the key', async () => {
    const { chain, cast, d } = await posted('rt-fallback');
    chain.advanceTo(d.terms.timing.judgeBy);
    await must(chain, cast, d.trigger('fallback'));
    expect(chain.escrowState(d.id)?.kind).toBe('FallbackJudging');
    const r = await refusal(chain, cast, await d.mutual(BigInt(d.terms.price.amount), true));
    // T-549 steps core first for a delivery with no buyer envelope (T-550's hand-over): core's reason, nothing sent.
    expect(r).toMatch(/^invalid_terms: .*no envelope for the buyer .* a settlement that releases the key/);
    expect((await chain.stage(d.id)).stage).toBe('FallbackJudging');
    expect(await chain.keysFor(d.id, cast.buyer.address)).toEqual([]);
    await must(chain, cast, d.decide('fallback', 'accept', secs(d.terms.timing.judgeBy)));
    expect((await chain.stage(d.id)).stage).toBe('Released');
    expect(await chain.keysFor(d.id, cast.buyer.address)).toHaveLength(1);
    expect(await chain.replayCheck()).toMatchObject({ ok: true });
  }, 60_000);

  it('attack: after an escalation, settle with the key. Expected: refused with the reason core gives; the appeal accept settles with the key', async () => {
    const { chain, cast, d } = await posted('rt-escalated');
    await must(chain, cast, d.decide('primary', 'escalate'));
    const s = chain.escrowState(d.id)!;
    if (s.kind !== 'Escalated') throw new Error(`expected Escalated, got ${s.kind}`);
    const r = await refusal(chain, cast, await d.mutual(BigInt(d.terms.price.amount), true));
    // T-549 steps core first for a delivery with no buyer envelope (T-550's hand-over): core's reason, nothing sent.
    expect(r).toMatch(/^invalid_terms: .*no envelope for the buyer .* a settlement that releases the key/);
    chain.advanceTo(new Date((secs(s.escalation.at) + 1) * 1000).toISOString());
    await must(chain, cast, d.decide('appeal', 'accept', secs(s.escalation.at) + 1));
    expect((await chain.stage(d.id)).stage).toBe('Released');
    expect(await chain.keysFor(d.id, cast.buyer.address)).toHaveLength(1);
  }, 60_000);

  it('attack: late work in Held, a settlement that carries the standing delivery and releases its key. Expected: refused before any transaction; keeping the key settles and releases none', async () => {
    const { chain, cast, club } = await newSettlement(world);
    const d = new EvmDeal(chain, cast, club, 'rt-late');
    await must(chain, cast, d.offer());
    await must(chain, cast, d.accept());
    await must(chain, cast, d.agreeAndFund());
    const late = await standing(chain, cast, d);
    const before = chain.transactions().length;
    const r = await refusal(chain, cast, await d.mutual(BigInt(d.terms.price.amount), true, late));
    // T-549 steps core first for a delivery with no buyer envelope (T-550's hand-over): core's reason, nothing sent.
    expect(r).toBe('invalid_terms: the carried delivery has no envelope for the buyer, so there is no key to release');
    expect(chain.transactions().length).toBe(before);
    expect((await chain.stage(d.id)).stage).toBe('Held');
    // Info: both parties sign a settlement paying the seller the whole price for late work and keeping the key.
    await must(chain, cast, d.mutual(BigInt(d.terms.price.amount), false));
    expect(chain.escrowState(d.id)).toMatchObject({ kind: 'Settled', keyReleased: false });
    expect(await chain.keysFor(d.id, cast.buyer.address)).toEqual([]);
    expect(deliveryHash(late)).toBe((chain.escrowState(d.id) as { settlement: { deliveryHash: string } }).settlement.deliveryHash);
  }, 60_000);

  it('both adjudicators silent on a standing delivery. Expected: the default refunds the buyer; no key', async () => {
    const { chain, cast, d } = await posted('rt-default');
    const start = await chain.tokenBalance(cast.buyer.address);
    chain.advanceTo(d.terms.timing.judgeBy);
    await must(chain, cast, d.trigger('fallback'));
    chain.advanceTo(d.terms.timing.fallbackBy);
    await must(chain, cast, d.trigger('default'));
    expect(['Refunded', 'Defaulted']).toContain(chain.escrowState(d.id)?.kind);
    if (chain.escrowState(d.id)?.kind === 'Defaulted') await must(chain, cast, d.trigger('apply_default'));
    expect(chain.escrowState(d.id)?.kind).toBe('Refunded');
    expect(await chain.tokenBalance(cast.buyer.address)).toBe(start + BigInt(d.terms.price.amount) + BigInt(d.terms.adjudication.fee.amount));
    expect(await chain.keysFor(d.id, cast.buyer.address)).toEqual([]);
  }, 60_000);
});

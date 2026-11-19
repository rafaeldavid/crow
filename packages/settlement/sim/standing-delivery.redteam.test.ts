// RED TEAM (T-550, ADR-0040 §2): attacks on a standing delivery (envelopes for the three adjudicators, none for the
// buyer) on SimChain, full profile and phase one. Each test names the attack and the expected outcome. A passing test
// means the defense held, except where the comment says "Info": those record behaviour the parties chose by signing.
import { deliveryHash, type Hex32 } from '@holdback/core';
import { describe, expect, it } from 'vitest';
import type { Submission } from '../src/interface.js';
import { Deal, simActor, simCast, simClub, simGenesis, SIM_RULEBOOK, type Cast } from './actors.js';
import { SimChain } from './simchain.js';

const START = '2026-11-01T09:00:00Z';
const PRICE = 2_000_000_000n;
const BUYER0 = 10_000_000_000n;
const SELLER0 = 1_000_000_000n;
const BOND = 25_000_000_000n;

async function world(profile: 'full' | 'phase_one' = 'full') {
  const cast: Cast = simCast('t550-rt');
  const club = simClub(simActor('club-operator', 't550-rt').address, SIM_RULEBOOK);
  const genesis = await simGenesis({ cast, club, start: START, balances: { buyer: BUYER0, seller: SELLER0 }, bonds: { primary: BOND, fallback: BOND, appeal: BOND } });
  const chain = new SimChain({ ...genesis, ...(profile === 'phase_one' ? { profile } : {}) });
  const deal = new Deal(chain, cast, { club });
  const bal = async (a: { address: `0x${string}` }) => BigInt((await chain.balances([a.address]))[a.address]!.amount);
  const ok = async (s: Submission | Promise<Submission>) => {
    const r = await chain.submit(await s);
    if (!r.ok) throw new Error(`refused: ${r.problem.type}: ${r.problem.detail}`);
    chain.advance(1);
    return r;
  };
  const refused = async (s: Submission | Promise<Submission>) => {
    const r = await chain.submit(await s);
    if (r.ok) throw new Error(`expected a refusal, got ${r.state.escrowState}`);
    return r.problem;
  };
  const buyerKeys = () => chain.keysFor(deal.id, cast.buyer.address);
  return { chain, cast, deal, bal, ok, refused, buyerKeys };
}
type W = Awaited<ReturnType<typeof world>>;

const adjudicatorsOnly = (w: W) => [w.deal.terms.adjudication.adjudicator, w.deal.terms.adjudication.fallbackAdjudicator, w.deal.terms.adjudication.appealAdjudicator];

async function funded(w: W) {
  await w.ok(w.deal.offer());
  await w.ok(w.deal.accept());
  await w.ok(w.deal.agreeAndFund());
}
async function standing(w: W) {
  await funded(w);
  await w.ok(w.deal.deliver({ recipients: adjudicatorsOnly(w) }));
  expect(w.chain.escrowState(w.deal.id)?.kind).toBe('Delivered');
}
const NO_KEY = /no envelope for the buyer .* comes only with an adjudicator's accept/;

describe('RED TEAM T-550: a standing delivery on SimChain', () => {
  it('attack: an operator strips the buyer envelope from a seller-signed full delivery to make it standing. Expected: refused, the seller signature covers the envelopes', async () => {
    const w = await world();
    await funded(w);
    const full = (await w.deal.deliver()) as Extract<Submission, { kind: 'deliver' }>;
    const stripped = { ...full.delivery, encryptedKeys: full.delivery.encryptedKeys.filter((k) => k.recipient !== w.deal.terms.buyer) };
    const p = await w.refused({ kind: 'deliver', delivery: stripped });
    expect(p.type).toBe('invalid_signature');
    expect(w.chain.escrowState(w.deal.id)?.kind).toBe('Held');
    await w.ok(full);
    expect(w.chain.escrowState(w.deal.id)?.kind).toBe('Delivered');
  });

  it('attack: a delivery that leaves out any one adjudicator, buyer envelope present or not. Expected: refused', async () => {
    for (const drop of ['adjudicator', 'fallbackAdjudicator', 'appealAdjudicator'] as const) {
      for (const withBuyer of [true, false]) {
        const w = await world();
        await funded(w);
        const a = w.deal.terms.adjudication;
        const recipients = [a.adjudicator, a.fallbackAdjudicator, a.appealAdjudicator].filter((r) => r !== a[drop]);
        const p = await w.refused(w.deal.deliver({ recipients: withBuyer ? [...recipients, w.deal.terms.buyer] : recipients }));
        expect([drop, withBuyer, p.type]).toEqual([drop, withBuyer, 'invalid_terms']);
      }
    }
  });

  // Phase one runs on the anvil red-team file (the sim Deal's terms carry a 300 s appeal window, which phase one refuses).
  for (const profile of ['full'] as const) {
    it(`[${profile}] attack: pay the seller through a path that releases the delivery's own buyer key. Expected: every one refused with the reason, nothing moves, no key`, async () => {
      const w = await world(profile);
      await standing(w);
      const ledger = w.chain.ledger();
      expect((await w.refused(w.deal.earlyAccept())).detail).toMatch(NO_KEY);
      for (const toSeller of [PRICE, PRICE / 2n, 1n]) {
        expect((await w.refused(w.deal.mutual({ payouts: w.deal.split(toSeller), releaseKey: true }))).detail).toMatch(NO_KEY);
      }
      expect(w.chain.ledger()).toEqual(ledger);
      expect(await w.buyerKeys()).toEqual([]);
      expect(w.chain.escrowState(w.deal.id)?.kind).toBe('Delivered');
    });

    it(`[${profile}] attack: the primary accepts without the buyer key. Expected: refused; with the key, Released and the key reaches the buyer`, async () => {
      const w = await world(profile);
      await standing(w);
      expect((await w.refused(w.deal.decide('primary', 'accept', { withoutKey: true }))).type).toBe('invalid_terms');
      expect(await w.buyerKeys()).toEqual([]);
      await w.ok(w.deal.decide('primary', 'accept'));
      expect(w.chain.escrowState(w.deal.id)?.kind).toBe('Released');
      expect(await w.bal(w.cast.seller)).toBe(SELLER0 + PRICE);
      expect((await w.buyerKeys()).map((k) => k.ciphertext)).toEqual([w.deal.envelope(w.deal.terms.buyer).ciphertext]);
    });

    it(`[${profile}] attack: the primary goes silent and the parties try to settle with the key during the takeover. Expected: refused; the fallback accept carries the key`, async () => {
      const w = await world(profile);
      await standing(w);
      w.chain.advanceTo(w.deal.terms.timing.judgeBy);
      await w.ok(w.deal.trigger('fallback'));
      expect(w.chain.escrowState(w.deal.id)?.kind).toBe('FallbackJudging');
      expect(await w.chain.keysFor(w.deal.id, w.cast.fallback.address)).toHaveLength(1);
      expect((await w.refused(w.deal.mutual({ releaseKey: true }))).detail).toMatch(NO_KEY);
      expect((await w.refused(w.deal.decide('fallback', 'accept', { withoutKey: true }))).type).toBe('invalid_terms');
      await w.ok(w.deal.decide('fallback', 'accept'));
      expect(w.chain.escrowState(w.deal.id)?.kind).toBe('Released');
      expect(await w.buyerKeys()).toHaveLength(1);
    });

    it(`[${profile}] attack: escalate, then settle with the key while escalated. Expected: refused; the appeal adjudicator's accept carries the key, its reject refunds with none`, async () => {
      for (const outcome of ['accept', 'reject'] as const) {
        const w = await world(profile);
        await standing(w);
        await w.ok(w.deal.decide('primary', 'escalate'));
        expect(w.chain.escrowState(w.deal.id)?.kind).toBe('Escalated');
        expect((await w.refused(w.deal.mutual({ releaseKey: true }))).detail).toMatch(NO_KEY);
        await w.ok(w.deal.decide('appeal', outcome));
        expect(w.chain.escrowState(w.deal.id)?.kind).toBe(outcome === 'accept' ? 'Released' : 'Refunded');
        expect(await w.buyerKeys()).toHaveLength(outcome === 'accept' ? 1 : 0);
        expect(await w.bal(w.cast.seller)).toBe(SELLER0 + (outcome === 'accept' ? PRICE : 0n));
      }
    });

    it(`[${profile}] both adjudicators silent on a standing delivery. Expected: the default outcome refunds the buyer in full; no key`, async () => {
      const w = await world(profile);
      await standing(w);
      w.chain.advanceTo(w.deal.terms.timing.judgeBy);
      await w.ok(w.deal.trigger('fallback'));
      w.chain.advanceTo(w.deal.terms.timing.fallbackBy);
      await w.ok(w.deal.trigger('default'));
      await w.ok(w.deal.trigger('apply_default'));
      expect(w.chain.escrowState(w.deal.id)?.kind).toBe('Refunded');
      expect(await w.bal(w.cast.buyer)).toBe(BUYER0);
      expect(await w.buyerKeys()).toEqual([]);
    });

    it(`[${profile}] late work in Held: a settlement that carries the standing delivery and releases its key. Expected: refused; keeping the key settles with keyReleased false`, async () => {
      const w = await world(profile);
      await funded(w);
      const late = ((await w.deal.deliver({ recipients: adjudicatorsOnly(w) })) as Extract<Submission, { kind: 'deliver' }>).delivery;
      const p = await w.refused(w.deal.mutual({ releaseKey: true, carry: late, deliveryHash: deliveryHash(late) }));
      expect(p.detail).toMatch(/no envelope for the buyer/);
      expect(await w.buyerKeys()).toEqual([]);
      const r = await w.ok(w.deal.mutual({ releaseKey: false, deliveryHash: deliveryHash(late) }));
      expect(r.state.escrowState).toBe('Settled');
      expect(w.chain.escrowState(w.deal.id)).toMatchObject({ kind: 'Settled', keyReleased: false });
      expect(await w.buyerKeys()).toEqual([]);
    });

    it(`[${profile}] Info: a settlement both parties sign that pays the seller the whole price and keeps the key. Expected: settles; the buyer signed for no key`, async () => {
      const w = await world(profile);
      await standing(w);
      const r = await w.ok(w.deal.mutual({ payouts: w.deal.split(PRICE), releaseKey: false }));
      expect(r.state.escrowState).toBe('Settled');
      expect(await w.bal(w.cast.seller)).toBe(SELLER0 + PRICE);
      expect(await w.buyerKeys()).toEqual([]);
    });
  }

  it('[full] party appeal after an accept on a standing delivery, ground missing-or-wrong-key. Expected: the appeal decision may carry a second key to the buyer', async () => {
    const w = await world('full');
    await standing(w);
    await w.ok(w.deal.decide('primary', 'accept'));
    await w.ok(w.deal.appealBy('buyer'));
    expect(await w.chain.keysFor(w.deal.id, w.cast.appeal.address)).toHaveLength(1);
    const r = await w.ok(w.deal.decide('appeal', 'accept'));
    expect(r.state.appealState).toBe('upheld');
    expect(await w.buyerKeys()).toHaveLength(2);
  });

  it('[full] party appeal after a reject on a standing delivery, overturned. Expected: the seller is paid from the bond, the buyer keeps its refund and gets no key', async () => {
    const w = await world('full');
    await standing(w);
    await w.ok(w.deal.decide('primary', 'reject'));
    await w.ok(w.deal.appealBy('seller'));
    expect((await w.refused(w.deal.decide('appeal', 'accept', { withKey: true }))).type).toBe('invalid_terms');
    const r = await w.ok(w.deal.decide('appeal', 'accept', { withoutKey: true }));
    expect(r.state).toMatchObject({ escrowState: 'Refunded', appealState: 'overturned' });
    expect(await w.buyerKeys()).toEqual([]);
  });

  it('Info: the seller signs a standing and a per-buyer delivery for one deal; anyone posts the standing one first. Expected: the buyer loses only the early accept; the primary still settles with the key', async () => {
    const w = await world('full');
    await funded(w);
    const perBuyer = ((await w.deal.deliver()) as Extract<Submission, { kind: 'deliver' }>).delivery;
    const stand = ((await w.deal.deliver({ recipients: adjudicatorsOnly(w) })) as Extract<Submission, { kind: 'deliver' }>).delivery;
    await w.ok({ kind: 'deliver', delivery: stand });
    expect((await w.refused({ kind: 'deliver', delivery: perBuyer })).type).toBe('invalid_state');
    // An early accept naming the per-buyer delivery the buyer opened: refused, it is not the posted one (ADR-0029).
    expect((await w.refused(w.deal.earlyAccept({ deliveryHash: deliveryHash(perBuyer) as Hex32 }))).type).toBe('invalid_terms');
    expect((await w.refused(w.deal.earlyAccept({ deliveryHash: deliveryHash(stand) as Hex32 }))).detail).toMatch(NO_KEY);
    await w.ok(w.deal.decide('primary', 'accept', { deliveryHash: deliveryHash(stand) as Hex32 }));
    expect(await w.buyerKeys()).toHaveLength(1);
  });
});

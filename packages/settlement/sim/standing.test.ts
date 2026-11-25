// T-549 (ADR-0040 §1, §9): takes of a standing offer on SimChain. The seller's address is a standing seller account
// (genesis.contracts, kind standing_seller) whose key signs one template; any buyer's take is checked by core's
// standingApproval, the rule of HoldbackStandingSeller.isValidSignature. Named tests for ADR-0040 §9's scenario rows:
// attack.take-changes-a-fixed-field, attack.take-replayed, attack.take-backdated; and the template's ends (revoked,
// retired, expired), and its standing delivery to a take.
import { commitmentId, encodeSimStandingSignature, SIMCHAIN_VERIFYING_CONTRACT, STANDING_DELIVERY, TAKE, takeTerms, templateDigest, templateFrom, templateHash, type Address, type Commitment, type CommitmentTerms, type Delivery, type Hex32, type StandingOffer, type TakeFill, type Timestamp } from '@holdback/core';
import { keccak256, stringToBytes, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import type { Submission, SubmitResult } from '../src/interface.js';
import { Deal, SIM_CHAIN_ID, simActor, simCast, simClub, simGenesis, type Cast } from './actors.js';
import { SimChain, type SimContract } from './simchain.js';

const START = '2026-11-01T09:00:00Z';
const SELLER: Address = '0x00000000000000000000000000000000005e11e1';
const plus = (t: Timestamp, s: number): Timestamp => new Date(Date.parse(t) + s * 1000).toISOString().replace('.000Z', 'Z') as Timestamp;

async function world(o: { revoked?: (th: Hex32) => boolean; retired?: boolean; template?: (t: StandingOffer) => StandingOffer } = {}) {
  const base = simCast('standing');
  const cast: Cast = { ...base, seller: { ...base.seller, address: SELLER } };
  const club = simClub(simActor('club-operator').address);
  const genesis = await simGenesis({ cast, club, start: START, balances: { buyer: 50_000_000_000n }, bonds: { primary: 25_000_000_000n, fallback: 25_000_000_000n, appeal: 25_000_000_000n } });
  // The template: a draft deal's fixed terms, dates counted from each take.
  const draftChain = new SimChain(genesis);
  const draft = new Deal(draftChain, cast, { club, tag: 'template' });
  // It pays the seller's own key address: a template that pays the contract is refused (ADR-0040 §1).
  const made = templateFrom({ ...draft.terms, sellerPayoutAddress: base.seller.address }, { rules: SIMCHAIN_VERIFYING_CONTRACT, expiresAt: plus(START, 7 * 86_400), offerId: 'sim-standing' });
  const template = o.template ? o.template(made) : made;
  const th = templateHash(template);
  const seller: SimContract = { address: SELLER, kind: 'standing_seller', key: base.seller.address, ...(o.revoked?.(th) ? { revoked: [th] } : {}), ...(o.retired ? { retired: true } : {}) };
  const chain = new SimChain({ ...genesis, contracts: [seller] });
  const keySignature = await privateKeyToAccount(base.seller.key).sign({ hash: templateDigest(template, SELLER, SIM_CHAIN_ID) });
  const submit = async (s: Submission | Promise<Submission>): Promise<SubmitResult> => chain.submit(await s, { via: 'op-1' });
  const ok = async (s: Submission | Promise<Submission>) => {
    const r = await submit(s);
    if (!r.ok) throw new Error(`refused: ${r.problem.type}: ${r.problem.detail}`);
    chain.advance(1);
    return r;
  };
  /** A take by the cast's buyer: its terms, a Deal that signs its later steps, and its offer. */
  const take = (seed: string, createdAt: Timestamp = chain.now()) => {
    const fill: TakeFill = { buyer: cast.buyer.address, buyerPaymentAddress: cast.buyer.address, buyerEncryptionPublicKey: draft.terms.buyerEncryptionPublicKey, nonceSeed: keccak256(stringToBytes(seed)), createdAt };
    const terms = takeTerms(template, fill, SELLER);
    const deal = new Deal(chain, cast, { club, tag: 'template', over: terms });
    expect(deal.terms).toEqual(terms);
    const blob = encodeSimStandingSignature(TAKE, template, keySignature, fill);
    const offer = (over: Partial<CommitmentTerms> = {}): Submission => {
      const t = { ...terms, ...over };
      return { kind: 'offer', commitment: { ...t, id: commitmentId(t), signatures: { seller: blob } } as Commitment };
    };
    return { fill, terms, deal, blob, offer };
  };
  return { chain, cast, club, template, keySignature, submit, ok, take };
}

describe('takes of a standing offer on SimChain (T-549)', () => {
  it('a take is read through the standing seller, accepted, funded, delivered with the key and settled', async () => {
    const w = await world();
    const t = w.take('happy');
    expect(t.blob.length).toBeGreaterThan(132);
    await w.ok(t.offer());
    await w.ok(t.deal.accept());
    await w.ok(t.deal.agreeAndFund());
    await w.ok(t.deal.deliver());
    const r = await w.ok(t.deal.decide('primary', 'accept'));
    expect(r.state.escrowState).toBe('Released');
    const payout = t.terms.sellerPayoutAddress;
    expect((await w.chain.balances([payout]))[payout]!.amount).toBe(t.terms.price.amount);
  });

  it('attack.take-changes-a-fixed-field: a take with a changed price, payout address, adjudicator or disclosure is refused', async () => {
    const w = await world();
    const t = w.take('changed');
    for (const over of [
      { price: { ...t.terms.price, amount: '1' } },
      { sellerPayoutAddress: simActor('thief').address },
      { adjudication: { ...t.terms.adjudication, adjudicator: simActor('thief').address } },
      { disclosure: { level: 'private' as const } },
      { timing: { ...t.terms.timing, deliverBy: plus(t.terms.timing.deliverBy, 60) } },
    ] as Array<Partial<CommitmentTerms>>) {
      const r = await w.submit(t.offer(over));
      expect(r.ok ? 'ok' : r.problem.type).toBe('invalid_signature');
    }
    await w.ok(t.offer());
  });

  it('the seller contract is asked again at funding, as the rules contract asks it: a template that expires after the offer funds nothing (T-549 PR 4, red team L1 of PR 736)', async () => {
    const w = await world({ template: (t) => ({ ...t, expiresAt: plus(START, 4) }) });
    const t = w.take('expires-before-funding');
    await w.ok(t.offer());
    await w.ok(t.deal.accept());
    w.chain.advance(5);
    const r = await w.submit(t.deal.agreeAndFund());
    expect(r.ok ? 'ok' : `${r.problem.type}: ${r.problem.detail}`).toMatch(/^invalid_signature: the seller's signature on these terms no longer holds at funding/);
    // Its offer window is still open: only the template's expiry refuses it, and nothing was held.
    expect(Date.parse(w.chain.now())).toBeLessThan(Date.parse(t.terms.timing.offerExpiresAt));
    expect((await w.chain.state(commitmentId(t.terms)))!.escrowState).toBe('AcceptedByAdjudicator');
  });

  it('attack.take-replayed: one take funds once; a second offer of the same take is refused', async () => {
    const w = await world();
    const t = w.take('replayed');
    await w.ok(t.offer());
    await w.ok(t.deal.accept());
    await w.ok(t.deal.agreeAndFund());
    const again = await w.submit(t.offer());
    expect(again.ok ? 'ok' : again.problem.type).toMatch(/invalid_state|nonce_reused/);
    // Another seed is another take of the same template, with its own commitment ID.
    const other = w.take('replayed-2');
    expect(other.terms.nonce).not.toBe(t.terms.nonce);
    await w.ok(other.offer());
  });

  it('attack.take-backdated: a take dated so far back that its offer has expired is refused at the offer', async () => {
    const w = await world();
    w.chain.advance(3600);
    const old = w.take('backdated', plus(w.chain.now(), -(w.template.terms.timing.offerExpiresAt + 1)));
    const r = await w.submit(old.offer());
    expect(r.ok ? 'ok' : r.problem.type).toBe('deadline_passed');
    // Backdated by less than the offer window, it is offered and the seller keeps deliverBy minus that window.
    const recent = w.take('backdated-recent', plus(w.chain.now(), -60));
    await w.ok(recent.offer());
  });

  it('attack.take-under-another-deployment: a template naming another rules deployment approves no take here', async () => {
    const w = await world({ template: (o) => ({ ...o, rules: '0x00000000000000000000000000000000000000a1' }) });
    const r = await w.submit(w.take('elsewhere').offer());
    expect(r.ok ? 'ok' : r.problem.type).toBe('invalid_signature');
  });

  it('attack.funded-take-flood: a seller of per-buyer work declines every funded take, and each ends in its buyer\'s refund', async () => {
    const w = await world();
    const takes = ['flood-a', 'flood-b', 'flood-c'].map((s) => w.take(s));
    const before = BigInt((await w.chain.balances([w.cast.buyer.address]))[w.cast.buyer.address]!.amount);
    for (const t of takes) {
      await w.ok(t.offer());
      await w.ok(t.deal.accept());
      await w.ok(t.deal.agreeAndFund());
    }
    // The seller delivers nothing: past deliverBy anyone reclaims each hold, price and fee.
    w.chain.advanceTo(plus(takes[2]!.terms.timing.deliverBy, 1));
    for (const t of takes) expect((await w.ok(t.deal.trigger('reclaim'))).state.escrowState).toBe('Refunded');
    expect(BigInt((await w.chain.balances([w.cast.buyer.address]))[w.cast.buyer.address]!.amount)).toBe(before);
  });

  it('a take dated ahead of the chain is refused', async () => {
    const w = await world();
    const ahead = w.take('ahead', plus(w.chain.now(), 600));
    const r = await w.submit(ahead.offer());
    expect(r.ok ? 'ok' : r.problem.type).toBe('invalid_signature');
  });

  it('the template ends: no take once revoked, retired or expired', async () => {
    for (const end of [{ revoked: () => true }, { retired: true }] as const) {
      const w = await world(end);
      const r = await w.submit(w.take('ended').offer());
      expect(r.ok ? 'ok' : r.problem.type).toBe('invalid_signature');
    }
    const w = await world();
    w.chain.advance(7 * 86_400);
    const r = await w.submit(w.take('expired').offer());
    expect(r.ok ? 'ok' : r.problem.type).toBe('invalid_signature');
  });

  it("refuses a take whose template the key did not sign, or that names the seller contract as its payout address", async () => {
    const w = await world();
    const t = w.take('forged');
    const forged = encodeSimStandingSignature(TAKE, w.template, await privateKeyToAccount(simActor('impostor').key).sign({ hash: templateDigest(w.template, SELLER, SIM_CHAIN_ID) }), t.fill);
    const r = await w.submit({ kind: 'offer', commitment: { ...t.terms, id: t.deal.id, signatures: { seller: forged } } as Commitment });
    expect(r.ok ? 'ok' : r.problem.type).toBe('invalid_signature');
    const self = await world({ template: (o) => ({ ...o, terms: { ...o.terms, sellerPayoutAddress: SELLER } }) });
    const s = await self.submit(self.take('self').offer());
    expect(s.ok ? 'ok' : s.problem.type).toBe('invalid_signature');
  });

  it("the template's standing delivery serves a take with no buyer envelope, and the primary's accept settles it", async () => {
    const delivery = (o: StandingOffer, cast: Cast): StandingOffer => ({
      ...o,
      delivery: {
        ciphertext: { uri: 'sim://blobs/standing-file', sha256: `sha256:${'c'.repeat(64)}` as const, bytes: 100, cipher: 'aes-256-gcm' as const },
        plaintextSha256: `sha256:${'d'.repeat(64)}` as const,
        plaintextMime: 'text/csv' as const,
        encryptedKeys: [cast.primary.address, cast.fallback.address, cast.appeal.address].map((recipient) => ({ recipient, scheme: 'x25519-xsalsa20poly1305' as const, ciphertext: 'ZW52ZWxvcGU' })),
        submittedAt: START,
      },
    });
    const castFor = simCast('standing');
    const w = await world({ template: (o) => delivery(o, castFor) });
    const t = w.take('fixed-file');
    await w.ok(t.offer());
    await w.ok(t.deal.accept());
    await w.ok(t.deal.agreeAndFund());
    const d: Delivery = { commitmentId: t.deal.id, attempt: 1, ...w.template.delivery!, signature: encodeSimStandingSignature(STANDING_DELIVERY, w.template, w.keySignature, t.fill) as Hex };
    // A delivery of another file under the same signature is refused (attack.standing-delivery-other-file).
    const other = await w.submit({ kind: 'deliver', delivery: { ...d, plaintextSha256: `sha256:${'e'.repeat(64)}` } });
    expect(other.ok ? 'ok' : other.problem.type).toBe('invalid_signature');
    await w.ok({ kind: 'deliver', delivery: d });
    t.deal.delivery = d;
    const r = await w.ok(t.deal.decide('primary', 'accept'));
    expect(r.state.escrowState).toBe('Released');
  });
});


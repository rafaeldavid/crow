// T-549 (ADR-0040 §7, §9): an operator's rules for a take of a standing offer, over one SimChain whose seller is a
// standing seller account. A take is posted by its buyer with the buyer's own signature over the terms and is charged
// to that buyer, so no flood of takes spends the seller's write budget, and no take names a victim buyer; a take that
// is not public is refused; and a take one operator refuses goes through another.
import { encryptionKeyPairFromSecretKey } from '@holdback/core/crypto';
import { commitmentId, encodeSimStandingSignature, sealTerms, holdbackDomain, signTerms, TAKE, takeTerms, templateDigest, templateFrom, type Address, type Commitment, type CommitmentTerms, type StandingOffer, type TakeFill, type Timestamp } from '@holdback/core';
import { Deal, SIM_CHAIN_ID, SimChain, simActor, simCast, simClub, simGenesis, type Cast, type SimActor } from '@holdback/settlement/sim';
import { keccak256, stringToBytes } from "viem";
import { privateKeyToAccount } from 'viem/accounts';
import { afterEach, describe, expect, it } from 'vitest';
import { simRegistry, startOperator, type OperatorOptions, type RunningOperator } from './index.js';
import { refuseParties } from './policy.js';

const START = '2026-11-01T09:00:00Z';
const SELLER: Address = '0x00000000000000000000000000000000005e11e1';
const BOND = 25_000_000_000n;
const plus = (t: Timestamp, s: number): Timestamp => new Date(Date.parse(t) + s * 1000).toISOString().replace('.000Z', 'Z') as Timestamp;
const domain = holdbackDomain(SIM_CHAIN_ID);

const running: RunningOperator[] = [];
afterEach(async () => void (await Promise.all(running.splice(0).map((o) => o.close()))));

async function world() {
  const base = simCast('takes');
  const cast: Cast = { ...base, seller: { ...base.seller, address: SELLER } };
  const club = simClub(simActor('club-operator').address);
  const genesis = await simGenesis({ cast, club, start: START, balances: { buyer: 10_000_000_000n }, bonds: { primary: BOND, fallback: BOND, appeal: BOND } });
  const chain = new SimChain({ ...genesis, contracts: [{ address: SELLER, kind: 'standing_seller', key: base.seller.address }] });
  const draft = new Deal(chain, cast, { club, tag: 'template' });
  const template: StandingOffer = templateFrom({ ...draft.terms, sellerPayoutAddress: base.seller.address }, { rules: '0x0000000000000000000000000000000000000000', expiresAt: plus(START, 86_400), offerId: 'takes' });
  const keySignature = await privateKeyToAccount(base.seller.key).sign({ hash: templateDigest(template, SELLER, SIM_CHAIN_ID) });
  /** A take by `buyer`, signed by it (or by `signer`) over the terms, as the buyer posts it. */
  const take = async (buyer: SimActor, seed: string, o: { signer?: SimActor; over?: Partial<CommitmentTerms>; unsigned?: boolean } = {}): Promise<Commitment> => {
    const fill: TakeFill = { buyer: buyer.address, buyerPaymentAddress: buyer.address, buyerEncryptionPublicKey: draft.terms.buyerEncryptionPublicKey, nonceSeed: keccak256(stringToBytes(seed)), createdAt: chain.now() };
    const terms = { ...takeTerms(template, fill, SELLER), ...o.over };
    const seller = encodeSimStandingSignature(TAKE, template, keySignature, fill);
    const signatures = o.unsigned ? { seller } : { seller, buyer: await signTerms((o.signer ?? buyer).key, domain, terms) };
    return { ...terms, id: commitmentId(terms), signatures } as Commitment;
  };
  const operator = async (id: string, over: Partial<OperatorOptions> = {}) => {
    const op = await startOperator({ settlement: chain, registry: simRegistry(chain), signerKey: simActor(id, 'operator').key, operatorId: id, env: {}, ...over });
    running.push(op);
    return op;
  };
  let n = 0;
  const post = async (op: RunningOperator, body: unknown) => {
    const r = await fetch(`${op.url}/v1/commitments`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': `take-${n++}` }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as { type?: string; field?: string; detail?: string } };
  };
  return { chain, cast, base, club, template, take, operator, post };
}

const LIMIT = { rateLimit: { writes: 2, reads: 1000, windowMs: 3_600_000 } };

describe("an operator's rules for a take of a standing offer (T-549)", () => {
  it('relays a take posted by its buyer with the buyer\'s signature over the terms', async () => {
    const w = await world();
    const op = await w.operator('op-1');
    const r = await w.post(op, await w.take(w.cast.buyer, 'one'));
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
  });

  it('attack.take-flood-spends-seller-budget: takes are charged to their buyers, so the seller still writes after a flood', async () => {
    const w = await world();
    const op = await w.operator('op-1', LIMIT);
    for (const [i, b] of [simActor('flood-1'), simActor('flood-2'), simActor('flood-3')].entries()) {
      const r = await w.post(op, await w.take(b, `flood-${i}`));
      expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    }
    // One buyer's third take is over its own budget of 2 writes.
    const one = simActor('flood-1');
    expect((await w.post(op, await w.take(one, 'flood-again'))).status).toBeLessThan(300);
    expect((await w.post(op, await w.take(one, 'flood-over'))).body.type).toBe('rate_limited');
    // The seller's own offer, signed by its key (the contract's key path), is charged to the seller and still goes through.
    const own = await new Deal(w.chain, { ...w.cast, seller: { ...w.base.seller, address: SELLER } }, { club: w.club, tag: 'seller-own', over: { sellerPayoutAddress: w.base.seller.address } }).offer();
    if (own.kind !== 'offer') throw new Error('unreachable');
    const r = await w.post(op, own.commitment);
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
  });

  it('attack.take-flood-names-a-victim-buyer: a take whose buyer signature is not the named buyer\'s is refused, and the victim\'s budget is untouched', async () => {
    const w = await world();
    // A budget of 5 writes per window: the caller's refused writes count against its own client budget (3 here), and
    // a take that succeeds moves its charge to its buyer.
    const op = await w.operator('op-1', { rateLimit: { writes: 5, reads: 1000, windowMs: 3_600_000 } });
    const victim = simActor('victim');
    for (let i = 0; i < 3; i++) {
      const r = await w.post(op, await w.take(victim, `victim-${i}`, { signer: simActor('attacker') }));
      expect([r.body.type, r.body.field]).toEqual(['invalid_signature', 'signatures.buyer']);
    }
    // The victim's own budget is whole: five takes of its own go through.
    for (let i = 0; i < 5; i++) {
      const r = await w.post(op, await w.take(victim, `victim-own-${i}`));
      expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    }
  });

  it('refuses a take posted without the buyer\'s signature, naming the field', async () => {
    const w = await world();
    const op = await w.operator('op-1');
    const r = await w.post(op, await w.take(w.cast.buyer, 'unsigned', { unsigned: true }));
    expect([r.body.type, r.body.field]).toEqual(['invalid_terms', 'signatures.buyer']);
  });

  it('attack.standing-take-not-public: refuses a take whose disclosure is not public, before anything is relayed', async () => {
    const w = await world();
    const op = await w.operator('op-1');
    const before = w.chain.log().length;
    // The take's terms at `private`, sealed to the buyer and the primary, as a private offer travels.
    const plain = await w.take(w.cast.buyer, 'private', { over: { disclosure: { level: 'private' } } });
    const { signatures } = plain;
    const terms: Partial<Commitment> = { ...plain };
    delete terms.id;
    delete terms.signatures;
    const readers = [w.cast.buyer, w.cast.primary].map((a) => ({ recipient: a.address, publicKey: encryptionKeyPairFromSecretKey(new Uint8Array(32).fill(7)).publicKey }));
    const { sealed, id } = await sealTerms(terms as CommitmentTerms, readers);
    expect(id).toBe(plain.id);
    const r = await w.post(op, { ...sealed, id, signatures });
    expect([r.body.type, r.body.field]).toEqual(['invalid_terms', 'disclosure.level']);
    expect(w.chain.log().length).toBe(before);
  });

  it('neutrality.operator-refuses-standing-take: op-1 refuses the buyer, op-2 relays the same take', async () => {
    const w = await world();
    const op1 = await w.operator('op-1', { policy: refuseParties([w.cast.buyer.address]) });
    const op2 = await w.operator('op-2');
    const t = await w.take(w.cast.buyer, 'refused');
    expect((await w.post(op1, t)).status).toBeGreaterThanOrEqual(400);
    const r = await w.post(op2, t);
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    expect((await w.chain.state(t.id))?.escrowState).toBe('Offered');
  });
});


// RED TEAM (T-550, ADR-0040 §2): the reference adjudicator on a standing delivery, with real encryption. The seller's
// delivery holds envelopes for the three adjudicators and none for the buyer. Expected for every role that settles by an
// accept (primary, fallback after takeover, appeal adjudicator after an escalation), on both profiles: the decision's
// keyForBuyer opens with the buyer's terms key and decrypts the posted ciphertext to the signed plaintext hash, so a
// deal that pays the seller always hands the buyer a usable key. A reject carries no key.
import { type Decision } from '@holdback/core';
import { open, unwrapKey } from '@holdback/core/crypto';
import { fakeProvider, loadRegistry, type FakeScript, type RegistryDoc } from '@holdback/judgment';
import { keccak256 } from 'viem';
import { describe, expect, it } from 'vitest';
import { demoCsv, DOMAIN, makeCommitment, party, TestSettlement, tusd, type Party } from './_sim.js';
import { defaultPolicy, policyHashOf } from './policy.js';
import { Adjudicator } from './service.js';

const entry = (id: string, family: string, provider: 'anthropic' | 'openai-compatible') => ({ id, provider, family, model: `${id}-20260601`, status: 'active' as const });
const REGISTRY: RegistryDoc = {
  version: 1,
  judges: [entry('claude-a', 'claude', 'anthropic'), entry('claude-b', 'claude', 'anthropic'), entry('gpt-a', 'gpt', 'openai-compatible'), entry('gpt-b', 'gpt', 'openai-compatible'), entry('qwen-a', 'qwen', 'openai-compatible'), entry('qwen-b', 'qwen', 'openai-compatible')],
};
const reg = (() => {
  const r = loadRegistry(REGISTRY);
  if (!r.ok) throw new Error(r.error.detail);
  return r.value;
})();
const A = party(1);
const B = party(2);
const C = party(3);
const BUYER = party(4);
const SELLER = party(5);

function bench(p: Party, name: string, s: TestSettlement, script: FakeScript = {}) {
  const adj = new Adjudicator({
    address: p.address,
    name,
    signingKey: p.key,
    encryptionSecretKey: p.enc.secretKey,
    seedSecret: keccak256(p.key),
    policy: defaultPolicy(`${name}/p1`),
    registry: reg,
    registryUri: 'file:///config/judges.yaml',
    fee: { min: tusd('25000000') },
    domain: DOMAIN,
    provider: fakeProvider(script),
    settlement: s,
    trustedAdjudicators: [A.address, B.address, C.address],
  });
  s.register({ ...adj.registration(), pool: {} as never, poolTermsHash: `0x${'00'.repeat(32)}`, status: 'active' });
  return adj;
}

const CSV = demoCsv();

/** A funded deal whose delivery is standing: envelopes for A, B and C only. */
async function standing(o: { phaseOne?: boolean; scriptA?: FakeScript } = {}) {
  const s = new TestSettlement();
  if (o.phaseOne) s.phaseOne = true;
  const a = bench(A, 'bench-a', s, o.scriptA);
  const b = bench(B, 'bench-b', s);
  const c = bench(C, 'bench-c', s);
  const commitment = makeCommitment({ primary: A.address, fallback: B.address, appeal: C.address, policyHash: policyHashOf(a.policy), registryHash: reg.hash, buyer: BUYER, seller: SELLER });
  s.offer(commitment);
  await a.runOnce();
  s.fund(commitment.id);
  s.at('2026-11-01T09:59:00Z');
  await s.deliver(commitment.id, CSV, [A, B, C].map((p) => ({ recipient: p.address, publicKey: p.enc.publicKey })));
  const delivery = s.cases.get(commitment.id)!.delivery!;
  expect(delivery.encryptedKeys.some((k) => k.recipient.toLowerCase() === BUYER.address.toLowerCase())).toBe(false);
  return { s, a, b, c, id: commitment.id, delivery };
}

/** The buyer's side: open the decision's key with its own secret, decrypt the posted ciphertext, check the hash. */
async function buyerOpens(s: TestSettlement, d: Decision, delivery: { ciphertext: { uri: string }; plaintextSha256: `sha256:${string}` }): Promise<string> {
  expect(d.keyForBuyer).toBeDefined();
  const key = unwrapKey(d.keyForBuyer!, BUYER.enc.secretKey);
  const bytes = await open(await s.ciphertext(delivery.ciphertext.uri), key, delivery.plaintextSha256);
  return new TextDecoder().decode(bytes);
}

describe('RED TEAM T-550: the reference adjudicator on a standing delivery', () => {
  for (const phaseOne of [false, true]) {
    const tag = phaseOne ? '[phase one]' : '[full]';

    it(`${tag} the primary accepts; the buyer opens the file from the decision alone`, async () => {
      const { s, a, id, delivery } = await standing({ phaseOne });
      s.at('2026-11-01T10:00:30Z');
      await a.runOnce();
      expect(s.state(id).kind).toBe('Released');
      const [d] = s.decisions(id) as [Decision];
      expect(await buyerOpens(s, d, delivery)).toBe(CSV);
    });

    it(`${tag} the primary is silent; the fallback takes over, accepts, and the buyer opens the file`, async () => {
      const { s, b, id, delivery } = await standing({ phaseOne });
      s.at('2026-11-01T10:02:00Z');
      await b.runOnce();
      expect(s.state(id).kind).toBe('Released');
      const [d] = s.decisions(id) as [Decision];
      expect(d.role).toBe('fallback');
      expect(await buyerOpens(s, d, delivery)).toBe(CSV);
    });

    it(`${tag} a split panel escalates; the appeal adjudicator accepts, and the buyer opens the file`, async () => {
      const split: FakeScript = { 'gpt-a': 'timeout', 'gpt-b': 'timeout', 'qwen-a': 'timeout', 'qwen-b': 'timeout' };
      const { s, a, c, id, delivery } = await standing({ phaseOne, scriptA: split });
      s.at('2026-11-01T10:00:30Z');
      await a.runOnce();
      expect(s.state(id).kind).toBe('Escalated');
      s.at('2026-11-01T10:00:32Z');
      await c.runOnce();
      expect(s.state(id).kind).toBe('Released');
      const appeal = s.decisions(id)[1]!;
      expect(appeal.role).toBe('appeal');
      expect(await buyerOpens(s, appeal, delivery)).toBe(CSV);
    });
  }

  it('[full] a buyer appeal on ground missing-or-wrong-key after an accept re-seals a key that opens the file', async () => {
    const { s, a, c, id, delivery } = await standing();
    s.at('2026-11-01T10:00:30Z');
    await a.runOnce();
    s.at('2026-11-01T10:01:00Z');
    s.fileAppeal(id, 'missing-or-wrong-key');
    s.at('2026-11-01T10:01:05Z');
    await c.runOnce();
    const appeal = s.decisions(id)[1]!;
    expect([appeal.role, appeal.outcome]).toEqual(['appeal', 'accept']);
    expect(await buyerOpens(s, appeal, delivery)).toBe(CSV);
  });
});

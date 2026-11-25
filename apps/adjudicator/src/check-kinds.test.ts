// ADR-0045 §8 and §10: an adjudicator's record lists the check kinds its build runs, and as primary it declines an
// offer that names any other, before a hold can form. Stage 1 still fails such a check at judging time
// (packages/judgment/src/checks/checks.test.ts, "fails closed on an unknown check type").
import { readFileSync } from 'node:fs';
import { parseAdjudicator, policyHash, type Commitment } from '@holdback/core';
import { CHECK_TYPES, fakeProvider, loadRegistry, type RegistryDoc } from '@holdback/judgment';
import { keccak256 } from 'viem';
import { describe, expect, it } from 'vitest';
import { DOMAIN, makeCommitment, party, TestSettlement, tusd } from './_sim.js';
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

/** The three checks of the signature_valid example: a json_schema check, then one signature_valid check per algorithm. */
const [ORDER, ECDSA, ED25519] = (JSON.parse(readFileSync(new URL('../../../spec/examples/commitment.signature-valid.example.json', import.meta.url), 'utf8')) as Commitment).acceptance.deterministicChecks;

const NINE = ['csv_columns_exact', 'row_count_range', 'unique_key', 'null_rate_max', 'regex_match_rate_min', 'iso8601_date_column', 'json_schema', 'reference_row_match_min', 'hidden_characters_max'];

function bench(p: typeof A, name: string, s: TestSettlement) {
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
    provider: fakeProvider({}),
    settlement: s,
    trustedAdjudicators: [A.address, B.address, C.address],
  });
  s.register({ ...adj.registration(), pool: {} as never, poolTermsHash: `0x${'00'.repeat(32)}`, status: 'active' });
  return adj;
}

async function offered(checks: readonly unknown[]) {
  const s = new TestSettlement();
  const a = bench(A, 'bench-a', s);
  const b = bench(B, 'bench-b', s);
  const c = bench(C, 'bench-c', s);
  const acceptance = { deterministicChecks: checks, rubric: { criteria: [], passThreshold: 0 } } as unknown as Commitment['acceptance'];
  const deal = makeCommitment({ primary: A.address, fallback: B.address, appeal: C.address, policyHash: policyHashOf(a.policy), registryHash: reg.hash, buyer: BUYER, seller: SELLER, acceptance });
  s.offer(deal);
  return { s, a, b, c, deal, report: await a.runOnce() };
}

describe("an adjudicator's checkKinds (ADR-0045 §8)", () => {
  it('lists exactly the kinds stage 1 runs: the nine of schema v0.12, and not signature_valid', () => {
    const adj = bench(A, 'bench-a', new TestSettlement());
    const listed = adj.registration().checkKinds!;
    expect(listed).toEqual([...CHECK_TYPES]);
    expect([...listed].sort()).toEqual([...NINE].sort());
    expect(listed).not.toContain('signature_valid');
  });

  it('makes a record the adjudicator schema accepts, and leaves policyHash a hash of the policy alone', () => {
    const adj = bench(A, 'bench-a', new TestSettlement());
    const zero = tusd('0');
    const terms = { capitalChargeRateBps: 0, capitalChargeToPoolRateBps: 0, firstLossShareBps: 10_000, noticePeriodSec: 0 };
    const record = { ...adj.registration(), pool: { junior: zero, senior: zero, reserved: zero, terms }, poolTermsHash: `0x${'00'.repeat(32)}`, status: 'active' };
    const parsed = parseAdjudicator(record);
    expect(parsed.ok ? null : parsed.error.detail).toBeNull();
    expect(record.policyHash).toBe(policyHash(record.policy));
  });
});

describe('the primary and a check kind it does not run (ADR-0045 §10)', () => {
  it.each([
    ['a required signature_valid check', [ORDER, ECDSA], 'manifest-signature'],
    ['an optional one, which the panel could otherwise pass over', [ORDER, { ...ED25519, required: false }], 'receipt-signature'],
    ['two of them, naming the first', [ORDER, ED25519, ECDSA], 'receipt-signature'],
  ])('declines an offer with %s, signs no acceptance and says why', async (_, checks, id) => {
    const { s, a, deal, report } = await offered(checks);
    const why = `bench-a does not run the check kind signature_valid, which check ${id} names, so it declines the offer; checkKinds on its adjudicator record lists the kinds it runs`;
    expect(report.accepted).toEqual([]);
    expect(report.declined).toEqual([{ commitmentId: deal.id, reason: why }]);
    expect(report.refused).toEqual([]);
    expect(s.state(deal.id).kind).toBe('Offered');
    // The operator's read for its notices (`declines`) answers the same.
    expect(await a.declines(deal, 'primary')).toMatchObject({ type: 'adjudicator_unavailable', detail: why });
  });

  it('accepts the same offer without that check', async () => {
    const { s, a, deal, report } = await offered([ORDER]);
    expect(report.accepted).toEqual([deal.id]);
    expect(s.state(deal.id).kind).toBe('AcceptedByAdjudicator');
    expect(await a.declines(deal, 'primary')).toBeNull();
  });

  it('is a rule of the primary alone: the fallback and the appeal answer as they did, and stage 1 fails the check at judging', async () => {
    const { b, c, deal } = await offered([ORDER, ECDSA]);
    expect(await b.declines(deal, 'fallback')).toBeNull();
    expect(await c.declines(deal, 'appeal')).toBeNull();
  });
});

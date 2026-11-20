// T-549 (ADR-0040 §1): what core's standing-offer module says of a signature and a template, beside the vectors in
// eip712.vectors.test.ts and the differential test on anvil (packages/settlement/evm/contract-signers.test.ts).
import { describe, expect, it } from 'vitest';
import { encodeSimStandingSignature, encodeStandingSignature, isTakeSignature, STANDING_DELIVERY, TAKE, templateFrom, templateHash, type StandingOffer, type TakeFill } from './standing.js';
import type { CommitmentTerms } from './types.js';

const A = (n: string) => `0x${n.repeat(40)}` as const;
const terms = {
  schemaVersion: '0.8',
  clubId: 'club',
  rulebookHash: `0x${'11'.repeat(32)}`,
  buyer: A('1'),
  seller: A('2'),
  buyerPaymentAddress: A('1'),
  sellerPayoutAddress: A('3'),
  deliverable: { kind: 'dataset', description: 'x', format: 'text/csv' },
  acceptance: { deterministicChecks: [], rubric: { criteria: [{ id: 'q', description: 'q', weight: 1, anchors: { '0': 'no', '4': 'yes' } }], passThreshold: 300 } },
  price: { token: A('a'), amount: '100' },
  adjudication: { adjudicator: A('4'), fallbackAdjudicator: A('5'), appealAdjudicator: A('6'), policyId: 'p', fee: { token: A('a'), amount: '1' }, registryHash: `0x${'22'.repeat(32)}`, policyHash: `0x${'33'.repeat(32)}` },
  timing: { offerExpiresAt: '2026-01-01T00:15:00Z', fundBy: '2026-01-01T00:30:00Z', deliverBy: '2026-01-01T01:00:00Z', judgeBy: '2026-01-01T01:10:00Z', fallbackBy: '2026-01-01T01:20:00Z', appealWindowSec: 0, appealDecideSec: 300, maxSubmissions: 1 },
  settlement: { mode: 'guaranteed_on_decision', token: A('a') },
  remedy: { onReject: 'full_refund' },
  disclosure: { level: 'public' },
  buyerEncryptionPublicKey: 'key',
  nonce: `0x${'44'.repeat(32)}`,
  createdAt: '2026-01-01T00:00:00Z',
} as unknown as CommitmentTerms;
const template: StandingOffer = templateFrom(terms, { rules: A('7'), expiresAt: '2026-02-01T00:00:00Z', offerId: 'o' });
const fill: TakeFill = { buyer: A('1'), buyerPaymentAddress: A('1'), buyerEncryptionPublicKey: 'key', nonceSeed: `0x${'55'.repeat(32)}`, createdAt: '2026-01-01T00:00:00Z' };
const keySig = `0x${'ab'.repeat(65)}` as const;

describe('standing.ts (T-549)', () => {
  it('isTakeSignature: a take blob, on a chain or on SimChain, is a take; a standing delivery, a key and a multisig are not', () => {
    expect(isTakeSignature(encodeStandingSignature(TAKE, template, keySig, fill))).toBe(true);
    expect(isTakeSignature(encodeSimStandingSignature(TAKE, template, keySig, fill))).toBe(true);
    expect(isTakeSignature(encodeStandingSignature(STANDING_DELIVERY, template, keySig, fill))).toBe(false);
    expect(isTakeSignature(encodeSimStandingSignature(STANDING_DELIVERY, template, keySig, fill))).toBe(false);
    expect(isTakeSignature(`0x${'cd'.repeat(65)}`)).toBe(false);
    // A 2-of-n multisig's signature, two 65-byte signatures back to back.
    expect(isTakeSignature(`0x${'ef'.repeat(130)}`)).toBe(false);
    expect(isTakeSignature('0x')).toBe(false);
  });

  it('a template carries no settlement: every take settles guaranteed_on_decision in the price token, as the contract builds it', () => {
    expect('settlement' in template.terms).toBe(false);
  });

  it('templateFrom refuses dates that are not whole seconds after createdAt, and a fractional expiry does not hash', () => {
    expect(() => templateFrom({ ...terms, timing: { ...terms.timing, fundBy: '2025-12-31T23:59:00Z' } }, { rules: A('7'), expiresAt: '2026-02-01T00:00:00Z', offerId: 'o' })).toThrow(RangeError);
    expect(() => templateFrom({ ...terms, timing: { ...terms.timing, fundBy: '2026-01-01T00:30:00.500Z' } }, { rules: A('7'), expiresAt: '2026-02-01T00:00:00Z', offerId: 'o' })).toThrow(RangeError);
    expect(() => templateHash({ ...template, expiresAt: '2026-02-01T00:00:00.500Z' })).toThrow(RangeError);
  });
});

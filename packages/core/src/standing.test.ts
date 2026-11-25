// T-549 (ADR-0040 §1): what core's standing-offer module says of a signature and a template, beside the vectors in
// eip712.vectors.test.ts and the differential test on anvil (packages/settlement/evm/contract-signers.test.ts).
import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { decodeStandingSignature, encodeSimStandingSignature, encodeStandingSignature, isTakeSignature, STANDING_DELIVERY, standingKeyOf, standingOfferView, TAKE, templateDigest, templateFrom, templateHash, templateHashOfView, type StandingOffer, type TakeFill } from './standing.js';
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

  it('templateHashOfView: the hash a node computes from a chain blob, where strings travel as hashes, equals the template\'s own (T-549 PR 4)', () => {
    const withDelivery = templateFrom(terms, {
      rules: A('7'),
      expiresAt: '2026-02-01T00:00:00Z',
      offerId: 'o',
      delivery: { ciphertext: { uri: 'crow://x', sha256: 'ab'.repeat(32), bytes: 10, cipher: 'xchacha20poly1305' }, plaintextSha256: 'cd'.repeat(32), plaintextMime: 'text/csv', encryptedKeys: [{ recipient: A('4'), scheme: 'x25519-xsalsa20poly1305', ciphertext: 'zz' }], submittedAt: '2026-01-01T00:00:00Z' },
    } as unknown as Parameters<typeof templateFrom>[1]);
    for (const o of [template, withDelivery]) {
      expect(templateHashOfView(standingOfferView(o))).toBe(templateHash(o));
      expect(templateHashOfView(decodeStandingSignature(encodeStandingSignature(TAKE, o, keySig, fill))!.offer)).toBe(templateHash(o));
    }
  });

  it('standingKeyOf recovers the key that signed the template for one seller contract, and nothing from another blob', async () => {
    const key = privateKeyToAccount('0x5e1f000000000000000000000000000000000000000000000000000000000001');
    const seller = A('8');
    const sig = await key.sign({ hash: templateDigest(template, seller, 11155111) });
    const blob = encodeStandingSignature(TAKE, template, sig, fill);
    expect(await standingKeyOf(blob, seller, 11155111)).toBe(key.address);
    // Another contract or chain: the domain differs, so another address recovers (the CREATE2 check then fails).
    expect(await standingKeyOf(blob, A('9'), 11155111)).not.toBe(key.address);
    expect(await standingKeyOf(blob, seller, 1)).not.toBe(key.address);
    expect(await standingKeyOf(encodeStandingSignature(STANDING_DELIVERY, template, sig, fill), seller, 11155111)).toBe(key.address);
    expect(await standingKeyOf(encodeSimStandingSignature(TAKE, template, sig, fill), seller, 11155111)).toBeNull();
    expect(await standingKeyOf(`0x${'cd'.repeat(65)}`, seller, 11155111)).toBeNull();
    // v of 0 or 1 is refused, as the ecrecover precompile refuses it.
    const v0 = `${sig.slice(0, 130)}${sig.slice(130) === '1b' ? '00' : '01'}` as `0x${string}`;
    expect(await standingKeyOf(encodeStandingSignature(TAKE, template, v0, fill), seller, 11155111)).toBeNull();
  });
});

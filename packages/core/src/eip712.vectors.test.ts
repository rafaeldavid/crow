// The cross-language vectors `contracts/test/unit/Vectors.t.sol` pins, computed here by core from spec/examples with
// every token identifier set to the address 0x…beef (ADR-0025). The contract must rebuild each value from the
// settlement view; this file is the generator, so a change to the signed encoding moves both pins together.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeAbiParameters, hashStruct, hashTypedData, keccak256 } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  commitmentId,
  deliveryHash,
  eip712Types,
  holdbackDomain,
  messageDigest,
  termsDigest,
  typedDataOf,
  typedTermsOf,
  type UnsignedMessage,
} from './eip712.js';
import { panelSeed } from './state.js';
import type { Address, CommitmentTerms, Delivery, Hex32 } from './types.js';

const root = join(import.meta.dirname, '..', '..', '..');
const example = (name: string): Record<string, unknown> => JSON.parse(readFileSync(join(root, 'spec', 'examples', `${name}.example.json`), 'utf8')) as Record<string, unknown>;

const TOKEN = '0x000000000000000000000000000000000000beef';
/** The vectors' verifying contract; Vectors.t.sol deploys HoldbackRules there. */
const VERIFYING: Address = '0x00000000000000000000000000000000000000a1';
const domain = holdbackDomain(31337, VERIFYING);
const fill = (byte: string): Hex32 => `0x${byte.repeat(32)}`;

/** Every token identifier in a JSON value replaced by the vectors' token address. */
function rebind<T>(v: T): T {
  if (Array.isArray(v)) return v.map(rebind) as T;
  if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'token' ? TOKEN : rebind(x)])) as T;
  return v;
}

const c = rebind(example('commitment'));
delete c['id'];
delete c['signatures'];
delete c['adjudicatorAcceptance'];
const terms = c as unknown as CommitmentTerms;
const id = commitmentId(terms);
const delivery = { ...(example('delivery') as unknown as Delivery), commitmentId: id };
const dh = deliveryHash(delivery);
const msg = (name: string, over: Record<string, unknown>): UnsignedMessage => {
  const m = rebind(example(name));
  delete m['signature'];
  delete m['buyerSignature'];
  delete m['sellerSignature'];
  return { ...m, ...over } as unknown as UnsignedMessage;
};

const values: Record<string, Hex32> = {
  commitmentId: id,
  schemaVersionHash: keccak256(new TextEncoder().encode(terms.schemaVersion)),
  termsDigest: termsDigest(domain, terms),
  deliveryHash: dh,
  decisionDigest: messageDigest(domain, msg('messages.decision', { commitmentId: id, deliveryHash: dh })),
  acceptanceDigest: messageDigest(domain, msg('messages.acceptance', { commitmentId: id })),
  agreeDigest: messageDigest(domain, { type: 'Agree', commitmentId: id, buyer: terms.buyer, nonce: fill('11'), expiresAt: terms.timing.offerExpiresAt }),
  earlyAcceptDigest: messageDigest(domain, {
    type: 'EarlyAccept',
    commitmentId: id,
    buyer: terms.buyer,
    attempt: 1,
    deliveryHash: dh,
    nonce: fill('22'),
    expiresAt: terms.timing.deliverBy,
  }),
  mutualDigest: messageDigest(domain, msg('messages.mutual-settlement', { commitmentId: id })),
  appealDigest: messageDigest(domain, { ...msg('appeal', { commitmentId: id }), type: 'Appeal' } as UnsignedMessage),
  panelSeed: panelSeed(id, 'fallback', 1, fill('33')),
};

// The same values as Vectors.t.sol. Changing one changes the signed encoding: it needs an ADR (ADR-0029 moved them).
const pins: Record<string, Hex32> = {
  commitmentId: '0xaa5d018d99b55e9a09c1cd916d6e3185e52b9b0286b174c292567c991f8b923f',
  schemaVersionHash: '0x15e7a716d821b9602c70f6d0f574efbb8147fb465215d43354c7b3e69d03ed92',
  termsDigest: '0x2bb88f88c30641ab49ab6823d4cf2e692d1772f9137f681191123f4c19b46724',
  deliveryHash: '0x066268f079f4bb4793fabf3fa8dd9747532bd69048bc3ff099f83b74799f04f8',
  decisionDigest: '0x64343a2c8fff8bf7562a10e502a2fad78cda9674368b1c7cb4a893c8fd5459e1',
  acceptanceDigest: '0x816923467536d8459e2cb690cea9439b7a31fa2cb9dfcd6ca0c62240c4d6e1c0',
  agreeDigest: '0x5970a7aa087444ecfc533eb1c1bbfff3fe736922db3208b37707fb5c402b022b',
  earlyAcceptDigest: '0x797d9eab50f3743a32aa900fb6d1652d486b9a7a117032288d8644ff5965fc58',
  mutualDigest: '0x7a435893e73e059cbc988c3e29754dc13c95c14f9067cdd8bf22df53cea02aa5',
  appealDigest: '0x55838aa7f5437ab2dc68d37668acc76eaa26bedfefa0ffd24fd517c55e7a4744',
  panelSeed: '0x49566397618363247d353cc28e612aaceecc13dbbf17727b21034147547af0ad',
};

describe('cross-language vectors (Vectors.t.sol)', () => {
  it.each(Object.keys(pins))('core computes the pinned %s', (name) => {
    expect(values[name]).toBe(pins[name]);
  });
});

// T-548 (ADR-0040 §1): the seller contract's StandingOffer, its Revoke and Retire, and a take's terms, pinned by
// contracts/test/unit/StandingOfferVectors.t.sol. The template is the commitment example without its seller, its
// disclosure and its five take fields, with the deadlines as offsets from createdAt and the delivery example as its
// standing delivery. The take fills the example's own buyer fields back in, so the take's terms are the example's
// with the seller contract as seller and the derived nonce. Core signs no StandingOffer yet (T-549), so the types
// are written out here.
const SELLER_CONTRACT: Address = '0x00000000000000000000000000000000000000a2';
const sellerDomain = { name: 'HoldbackStandingSeller', version: '1', chainId: 31337, verifyingContract: SELLER_CONTRACT } as const;
const standingTypes = {
  TokenAmount: eip712Types.TokenAmount,
  Adjudication: eip712Types.Adjudication,
  Remedy: eip712Types.Remedy,
  Ciphertext: eip712Types.Ciphertext,
  EncryptedKey: eip712Types.EncryptedKey,
  KeyUnlock: eip712Types.KeyUnlock,
  TimingOffsets: eip712Types.Timing,
  StandingDelivery: [
    { name: 'ciphertext', type: 'Ciphertext' },
    { name: 'plaintextSha256', type: 'string' },
    { name: 'plaintextMime', type: 'string' },
    { name: 'encryptedKeys', type: 'EncryptedKey[]' },
    { name: 'submittedAt', type: 'uint64' },
  ],
  StandingOffer: [
    { name: 'rules', type: 'address' },
    { name: 'expiresAt', type: 'uint64' },
    { name: 'offerId', type: 'string' },
    { name: 'schemaVersion', type: 'string' },
    { name: 'clubId', type: 'string' },
    { name: 'rulebookHash', type: 'bytes32' },
    { name: 'sellerPayoutAddress', type: 'address' },
    { name: 'deliverableHash', type: 'bytes32' },
    { name: 'acceptanceHash', type: 'bytes32' },
    { name: 'price', type: 'TokenAmount' },
    { name: 'adjudication', type: 'Adjudication' },
    { name: 'timing', type: 'TimingOffsets' },
    { name: 'remedy', type: 'Remedy' },
    { name: 'delivery', type: 'StandingDelivery[]' },
  ],
  Revoke: [{ name: 'templateHash', type: 'bytes32' }],
  Retire: [],
} as const;

const typedTerms = typedTermsOf(terms) as Record<string, unknown> & { timing: Record<string, bigint>; createdAt: bigint };
const at = typedTerms.createdAt;
const offsets = Object.fromEntries(
  Object.entries(typedTerms.timing).map(([k, v]) => [k, ['offerExpiresAt', 'fundBy', 'deliverBy', 'judgeBy', 'fallbackBy'].includes(k) || (k === 'disputeBy' && v !== 0n) ? v - at : v]),
);
const unsignedDelivery: Record<string, unknown> = { ...delivery, type: 'Delivery' };
delete unsignedDelivery['signature'];
const encodedDelivery = typedDataOf(unsignedDelivery as unknown as UnsignedMessage).message as Record<string, unknown>;
const offer = {
  rules: VERIFYING,
  expiresAt: 1_795_000_000n,
  offerId: 'standing-offer-vectors',
  schemaVersion: typedTerms['schemaVersion'],
  clubId: typedTerms['clubId'],
  rulebookHash: typedTerms['rulebookHash'],
  sellerPayoutAddress: typedTerms['sellerPayoutAddress'],
  deliverableHash: typedTerms['deliverableHash'],
  acceptanceHash: typedTerms['acceptanceHash'],
  price: typedTerms['price'],
  adjudication: typedTerms['adjudication'],
  timing: offsets,
  remedy: typedTerms['remedy'],
  delivery: [
    {
      ciphertext: encodedDelivery['ciphertext'],
      plaintextSha256: encodedDelivery['plaintextSha256'],
      plaintextMime: encodedDelivery['plaintextMime'],
      encryptedKeys: encodedDelivery['encryptedKeys'],
      submittedAt: encodedDelivery['submittedAt'],
    },
  ],
};
const templateHash = hashStruct({ primaryType: 'StandingOffer', types: standingTypes, data: offer });
const takeNonce = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [templateHash, fill('44')]));
const takeTerms: CommitmentTerms = { ...terms, seller: SELLER_CONTRACT, nonce: takeNonce, disclosure: { level: 'public' } };
const takeId = commitmentId(takeTerms);

const standingValues: Record<string, Hex32> = {
  templateHash,
  templateDigest: hashTypedData({ domain: sellerDomain, types: standingTypes, primaryType: 'StandingOffer', message: offer }),
  revokeDigest: hashTypedData({ domain: sellerDomain, types: standingTypes, primaryType: 'Revoke', message: { templateHash } }),
  retireDigest: hashTypedData({ domain: sellerDomain, types: standingTypes, primaryType: 'Retire', message: {} }),
  takeNonce,
  takeCommitmentId: takeId,
  takeTermsDigest: termsDigest(domain, takeTerms),
  takeDeliveryHash: deliveryHash({ ...delivery, commitmentId: takeId }),
};

// The same values as StandingOfferVectors.t.sol. Changing one changes what a seller's key signs: it needs an ADR.
const standingPins: Record<string, Hex32> = {
  templateHash: '0x071d690e6444834e84c36aaf51ac0a2c870fda94e33344044c48c8fbf53e24c8',
  templateDigest: '0x031fa4e3462c3f5004485f3b008cc6db3ad14172e2fc7a5e84131afab3fc39ee',
  revokeDigest: '0x4a51d240561fa1dabf9654a5868a929df757925183361fc330c363dcc5baa447',
  retireDigest: '0x1ff100a7dc122be06ffd4044bfba7a3c4eb154996b5f7550ea4bb7d7a6d8c10f',
  takeNonce: '0x4ae1b56fe93213e2dae1bb08b2b87050acaeaccc2893f347d0b5d0f1c6813446',
  takeCommitmentId: '0x4524262835512bdbda5594f8533a7245d6ccddfc547bded422d94d28e9c39607',
  takeTermsDigest: '0xe657a52acfbfe4752c32c4e61aac46962413158de288eb2ebc5166e66083c4eb',
  takeDeliveryHash: '0x74c4715dad3e71dc0e23328e80046d860417a2e6cb339d5c7fea228096769e4a',
};

describe('standing offer vectors (StandingOfferVectors.t.sol)', () => {
  it.each(Object.keys(standingPins))('core computes the pinned %s', (name) => {
    expect(standingValues[name]).toBe(standingPins[name]);
  });
});

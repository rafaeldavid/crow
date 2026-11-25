// A standing offer (ADR-0040 §1): a template the seller's key signs once for its seller contract
// (contracts/src/HoldbackStandingSeller.sol), and a take that any buyer fills. This module is the contract's rule in
// TypeScript, pure and with no network:
// - the template's EIP-712 hash and the digest the key signs, under the seller contract's own domain;
// - the take's terms: the template with the buyer's five fields, the dates counted from the take's createdAt, the
//   disclosure public, and the nonce derived from the template's hash and the buyer's seed;
// - the take's signature as the contract decodes it (an ABI blob), for a chain;
// - the same decision for SimChain, which runs no EVM: its blob is the template in JSON, decided by these functions.
// The types and the pins are those of packages/core/src/eip712.vectors.test.ts and StandingOfferVectors.t.sol; the
// differential test on anvil pins takeTerms to the contract's termsOf. The pinned bundles never import this module.
import {
  compactSignatureToSignature,
  concat,
  decodeAbiParameters,
  domainSeparator,
  encodeAbiParameters,
  fromHex,
  getAddress,
  hashStruct,
  hashTypedData,
  keccak256,
  parseCompactSignature,
  recoverAddress,
  serializeSignature,
  stringToBytes,
  toHex,
  type Hex,
  type TypedData,
} from 'viem';
import { bodyHashes, commitmentId, eip712Types, messageDigest, termsDigest, typedDataOf, typedTermsOf, type HoldbackDomain } from './eip712.js';
import { recoversFrom } from './signer.js';
import { toTimestamp } from './timing.js';
import type { UnsignedMessage } from './eip712.js';
import type { Address, CommitmentTerms, Delivery, EncryptedKey, Hex32, Timestamp } from './types.js';

/** The seller contract's EIP-712 domain name and version (`HoldbackStandingSeller._domainNameAndVersion`). */
export const STANDING_SELLER_DOMAIN = { name: 'HoldbackStandingSeller', version: '1' } as const;

/** The first word of a take's or a standing delivery's signature (the contract's `TAKE`, `STANDING_DELIVERY`). */
export const TAKE = 1;
export const STANDING_DELIVERY = 2;

/** The template's dates, in seconds after the take's createdAt; the windows and maxSubmissions as in the terms. */
export interface TimingOffsets {
  offerExpiresAt: number;
  fundBy: number;
  deliverBy: number;
  judgeBy: number;
  fallbackBy: number;
  appealWindowSec: number;
  appealDecideSec: number;
  maxSubmissions: 1;
  /** Optimistic mode only; absent or 0: none. */
  disputeBy?: number;
  disputeJudgeSec?: number;
  disputeFallbackSec?: number;
}

/** The five fields a take fills (ADR-0040 §1). */
export interface TakeFill {
  buyer: Address;
  buyerPaymentAddress: Address;
  buyerEncryptionPublicKey: string;
  nonceSeed: Hex32;
  createdAt: Timestamp;
}

/**
 * The terms a template fixes: every field of the terms but the seller (the contract), the take's fields, the nonce, the
 * disclosure (public) and the settlement, which the contract fixes as guaranteed_on_decision in the price token.
 */
export type TemplateTerms = Omit<CommitmentTerms, 'seller' | 'buyer' | 'buyerPaymentAddress' | 'buyerEncryptionPublicKey' | 'nonce' | 'createdAt' | 'disclosure' | 'timing' | 'settlement'> & { timing: TimingOffsets };

/** One delivery for every take: a fixed file's (ADR-0040 §2). `encryptedKeys` holds the three adjudicators' envelopes. */
export type StandingDeliveryBody = Pick<Delivery, 'ciphertext' | 'plaintextSha256' | 'plaintextMime' | 'encryptedKeys' | 'submittedAt'>;

/** A template: what the seller's key signs, once, for its seller contract. */
export interface StandingOffer {
  /** The rules deployment every take settles on. */
  rules: Address;
  /** No take is approved at or after this instant. */
  expiresAt: Timestamp;
  /** The card's `offers[].id`; the contract does not read it. */
  offerId: string;
  terms: TemplateTerms;
  delivery?: StandingDeliveryBody;
}

type Encoded = Record<string, unknown>;
const str = (s: string): Hex32 => keccak256(stringToBytes(s));
const secs = (t: Timestamp): bigint => {
  const ms = Date.parse(t);
  if (!Number.isFinite(ms) || ms % 1000 !== 0) throw new RangeError(`${t} is not a whole second`);
  return BigInt(ms / 1000);
};
/** The settlement the seller contract builds into every take (HoldbackTypes: GUARANTEED_HASH and the one token). */
const settlementOf = (o: TemplateTerms): CommitmentTerms['settlement'] => ({ mode: 'guaranteed_on_decision', token: o.price.token });
const after = (createdAt: Timestamp, offset: number): Timestamp => toTimestamp(Date.parse(createdAt) + offset * 1000);
const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';
const ZERO32: Hex32 = '0x0000000000000000000000000000000000000000000000000000000000000000';
const EPOCH: Timestamp = '1970-01-01T00:00:00Z';

/**
 * The template's EIP-712 types, the seller contract's own (StandingOfferVectors.t.sol). A function, so a bundle that
 * imports core and not this module (site/setup.mjs) keeps none of it.
 */
export const standingTypes = () => ({
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
}) as const satisfies TypedData;

/**
 * The terms at createdAt 1970-01-01, so each date equals its offset: the template's timing as typed values, and the
 * other fields as the terms encode them. The take's own fields are placeholders that no template field reads.
 */
function atEpoch(o: StandingOffer): CommitmentTerms {
  const t = o.terms.timing;
  return {
    ...o.terms,
    settlement: settlementOf(o.terms),
    seller: ZERO_ADDRESS,
    buyer: ZERO_ADDRESS,
    buyerPaymentAddress: ZERO_ADDRESS,
    buyerEncryptionPublicKey: '',
    nonce: ZERO32,
    createdAt: EPOCH,
    disclosure: { level: 'public' },
    timing: {
      offerExpiresAt: after(EPOCH, t.offerExpiresAt),
      fundBy: after(EPOCH, t.fundBy),
      deliverBy: after(EPOCH, t.deliverBy),
      judgeBy: after(EPOCH, t.judgeBy),
      fallbackBy: after(EPOCH, t.fallbackBy),
      appealWindowSec: t.appealWindowSec,
      appealDecideSec: t.appealDecideSec,
      maxSubmissions: t.maxSubmissions,
      ...(t.disputeBy ? { disputeBy: after(EPOCH, t.disputeBy) } : {}),
      ...(t.disputeJudgeSec !== undefined ? { disputeJudgeSec: t.disputeJudgeSec } : {}),
      ...(t.disputeFallbackSec !== undefined ? { disputeFallbackSec: t.disputeFallbackSec } : {}),
    },
  } as CommitmentTerms;
}

/** A standing delivery's typed values (the delivery's own encoding without commitmentId and attempt). */
function typedDelivery(d: StandingDeliveryBody): Encoded {
  const m = typedDataOf({ ...d, type: 'Delivery', commitmentId: ZERO32, attempt: 1 } as unknown as UnsignedMessage).message;
  return { ciphertext: m['ciphertext'], plaintextSha256: m['plaintextSha256'], plaintextMime: m['plaintextMime'], encryptedKeys: m['encryptedKeys'], submittedAt: m['submittedAt'] };
}

/** The template as EIP-712 typed values (primary type StandingOffer). */
export function standingOfferMessage(o: StandingOffer): Encoded {
  const typed = typedTermsOf(atEpoch(o));
  return {
    rules: o.rules,
    expiresAt: secs(o.expiresAt),
    offerId: o.offerId,
    schemaVersion: typed['schemaVersion'],
    clubId: typed['clubId'],
    rulebookHash: typed['rulebookHash'],
    sellerPayoutAddress: typed['sellerPayoutAddress'],
    deliverableHash: typed['deliverableHash'],
    acceptanceHash: typed['acceptanceHash'],
    price: typed['price'],
    adjudication: typed['adjudication'],
    timing: typed['timing'],
    remedy: typed['remedy'],
    delivery: o.delivery ? [typedDelivery(o.delivery)] : [],
  };
}

/** The template's hash: what the contract's `revoked` is keyed by, and what the take's nonce binds. */
export const templateHash = (o: StandingOffer): Hex32 => hashStruct({ primaryType: 'StandingOffer', types: standingTypes(), data: standingOfferMessage(o) } as Parameters<typeof hashStruct>[0]);

/** The digest the seller's key signs for the template, under the seller contract's domain. */
export const templateDigest = (o: StandingOffer, sellerContract: Address, chainId: number): Hex32 =>
  hashTypedData({ domain: { ...STANDING_SELLER_DOMAIN, chainId, verifyingContract: sellerContract }, types: standingTypes(), primaryType: 'StandingOffer', message: standingOfferMessage(o) } as Parameters<typeof hashTypedData>[0]);

/** The take's nonce: `keccak256(abi.encode(templateHash, seed))`, so each take's ID binds its template (ADR-0040 §1). */
export const takeNonce = (th: Hex32, seed: Hex32): Hex32 => keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [th, seed]));

/**
 * A template from terms a seller chose (ADR-0040 §5, the seller's setup step): their fixed fields, the dates as offsets
 * from their createdAt. Their buyer fields, seller, nonce, disclosure and createdAt are the take's, so they are dropped.
 */
export function templateFrom(t: CommitmentTerms, o: { rules: Address; expiresAt: Timestamp; offerId: string; delivery?: StandingDeliveryBody }): StandingOffer {
  const at = Date.parse(t.createdAt);
  const off = (ts: Timestamp): number => {
    const s = (Date.parse(ts) - at) / 1000;
    if (!Number.isInteger(s) || s < 0) throw new RangeError(`a template counts its dates in whole seconds after createdAt; ${ts} is ${s} s after ${t.createdAt}`);
    return s;
  };
  const timing = t.timing;
  return {
    rules: o.rules,
    expiresAt: o.expiresAt,
    offerId: o.offerId,
    terms: {
      schemaVersion: t.schemaVersion,
      clubId: t.clubId,
      rulebookHash: t.rulebookHash,
      sellerPayoutAddress: t.sellerPayoutAddress,
      deliverable: t.deliverable,
      acceptance: t.acceptance,
      price: t.price,
      adjudication: t.adjudication,
      remedy: t.remedy,
      timing: {
        offerExpiresAt: off(timing.offerExpiresAt),
        fundBy: off(timing.fundBy),
        deliverBy: off(timing.deliverBy),
        judgeBy: off(timing.judgeBy),
        fallbackBy: off(timing.fallbackBy),
        appealWindowSec: timing.appealWindowSec,
        appealDecideSec: timing.appealDecideSec,
        maxSubmissions: timing.maxSubmissions,
        ...(timing.disputeBy ? { disputeBy: off(timing.disputeBy) } : {}),
        ...(timing.disputeJudgeSec !== undefined ? { disputeJudgeSec: timing.disputeJudgeSec } : {}),
        ...(timing.disputeFallbackSec !== undefined ? { disputeFallbackSec: timing.disputeFallbackSec } : {}),
      },
    },
    ...(o.delivery ? { delivery: o.delivery } : {}),
  };
}

/** The take's terms, as the contract's `termsOf` builds them: the seller contract as seller, public, the dates from createdAt. */
export function takeTerms(o: StandingOffer, fill: TakeFill, sellerContract: Address): CommitmentTerms {
  const t = o.terms.timing;
  const at = fill.createdAt;
  return {
    ...o.terms,
    settlement: settlementOf(o.terms),
    seller: sellerContract,
    buyer: fill.buyer,
    buyerPaymentAddress: fill.buyerPaymentAddress,
    buyerEncryptionPublicKey: fill.buyerEncryptionPublicKey,
    disclosure: { level: 'public' },
    nonce: takeNonce(templateHash(o), fill.nonceSeed),
    createdAt: at,
    timing: {
      offerExpiresAt: after(at, t.offerExpiresAt),
      fundBy: after(at, t.fundBy),
      deliverBy: after(at, t.deliverBy),
      judgeBy: after(at, t.judgeBy),
      fallbackBy: after(at, t.fallbackBy),
      appealWindowSec: t.appealWindowSec,
      appealDecideSec: t.appealDecideSec,
      maxSubmissions: t.maxSubmissions,
      ...(t.disputeBy ? { disputeBy: after(at, t.disputeBy) } : {}),
      ...(t.disputeJudgeSec !== undefined ? { disputeJudgeSec: t.disputeJudgeSec } : {}),
      ...(t.disputeFallbackSec !== undefined ? { disputeFallbackSec: t.disputeFallbackSec } : {}),
    },
  } as CommitmentTerms;
}

/** The template's standing delivery for one take: attempt 1, unsigned (anyone posts it with the standing signature). */
export function standingDeliveryFor(o: StandingOffer, id: Hex32): Omit<Delivery, 'signature'> | null {
  return o.delivery ? { commitmentId: id, attempt: 1, ...o.delivery } : null;
}

// The ABI form the seller contract decodes (IHoldbackStandingSeller): strings and nested structs as their hashes.

/** `IHoldbackStandingSeller.StandingOffer` as an ABI parameter. */
export const STANDING_OFFER_ABI = {
  type: 'tuple',
  components: [
    { name: 'rules', type: 'address' },
    { name: 'expiresAt', type: 'uint64' },
    { name: 'offerIdHash', type: 'bytes32' },
    { name: 'schemaVersionHash', type: 'bytes32' },
    { name: 'clubIdHash', type: 'bytes32' },
    { name: 'rulebookHash', type: 'bytes32' },
    { name: 'sellerPayoutAddress', type: 'address' },
    { name: 'deliverableHash', type: 'bytes32' },
    { name: 'acceptanceHash', type: 'bytes32' },
    { name: 'token', type: 'address' },
    { name: 'price', type: 'uint256' },
    { name: 'adjudicator', type: 'address' },
    { name: 'fallbackAdjudicator', type: 'address' },
    { name: 'appealAdjudicator', type: 'address' },
    { name: 'policyIdHash', type: 'bytes32' },
    { name: 'fee', type: 'uint256' },
    { name: 'registryHash', type: 'bytes32' },
    { name: 'policyHash', type: 'bytes32' },
    {
      name: 'timing',
      type: 'tuple',
      components: [
        { name: 'offerExpiresAt', type: 'uint64' },
        { name: 'fundBy', type: 'uint64' },
        { name: 'deliverBy', type: 'uint64' },
        { name: 'judgeBy', type: 'uint64' },
        { name: 'fallbackBy', type: 'uint64' },
        { name: 'appealWindowSec', type: 'uint64' },
        { name: 'appealDecideSec', type: 'uint64' },
        { name: 'maxSubmissions', type: 'uint8' },
        { name: 'disputeBy', type: 'uint64' },
        { name: 'disputeJudgeSec', type: 'uint64' },
        { name: 'disputeFallbackSec', type: 'uint64' },
      ],
    },
    { name: 'remedyHash', type: 'bytes32' },
    {
      name: 'delivery',
      type: 'tuple[]',
      components: [
        { name: 'ciphertextHash', type: 'bytes32' },
        { name: 'plaintextSha256Hash', type: 'bytes32' },
        { name: 'plaintextMimeHash', type: 'bytes32' },
        { name: 'encryptedKeysHash', type: 'bytes32' },
        { name: 'submittedAt', type: 'uint64' },
      ],
    },
  ],
} as const;
/** `IHoldbackStandingSeller.Fill` as an ABI parameter. */
export const FILL_ABI = {
  type: 'tuple',
  components: [
    { name: 'buyer', type: 'address' },
    { name: 'buyerPaymentAddress', type: 'address' },
    { name: 'buyerKeyHash', type: 'bytes32' },
    { name: 'nonceSeed', type: 'bytes32' },
    { name: 'createdAt', type: 'uint64' },
  ],
} as const;

const struct = (primaryType: string, data: Encoded): Hex32 => hashStruct({ primaryType, types: eip712Types, data } as Parameters<typeof hashStruct>[0]);
const keyHash = (k: EncryptedKey): Hex32 => struct('EncryptedKey', { recipient: k.recipient, scheme: k.scheme, ciphertext: k.ciphertext, unlock: { kind: k.unlock?.kind ?? '', round: BigInt(k.unlock?.round ?? 0) } });

/** The template as the seller contract's ABI struct. The token identifier must be the ERC-20's lowercase address (ADR-0025). */
export function standingOfferView(o: StandingOffer) {
  const typed = typedTermsOf(atEpoch(o)) as Encoded & { timing: Record<string, bigint | number> };
  const t = o.terms;
  if (!/^0x[0-9a-f]{40}$/.test(t.price.token)) throw new RangeError(`token ${t.price.token} is not a lowercase ERC-20 address (ADR-0025)`);
  const d = o.delivery ? (typedDelivery(o.delivery) as { ciphertext: Encoded; submittedAt: bigint }) : null;
  return {
    rules: getAddress(o.rules),
    expiresAt: secs(o.expiresAt),
    offerIdHash: str(o.offerId),
    schemaVersionHash: str(t.schemaVersion),
    clubIdHash: str(t.clubId),
    rulebookHash: t.rulebookHash,
    sellerPayoutAddress: getAddress(t.sellerPayoutAddress),
    ...bodyHashes(atEpoch(o)),
    token: getAddress(t.price.token),
    price: BigInt(t.price.amount),
    adjudicator: getAddress(t.adjudication.adjudicator),
    fallbackAdjudicator: getAddress(t.adjudication.fallbackAdjudicator),
    appealAdjudicator: getAddress(t.adjudication.appealAdjudicator),
    policyIdHash: str(t.adjudication.policyId),
    fee: BigInt(t.adjudication.fee.amount),
    registryHash: t.adjudication.registryHash,
    policyHash: t.adjudication.policyHash,
    timing: {
      offerExpiresAt: BigInt(typed.timing['offerExpiresAt']!),
      fundBy: BigInt(typed.timing['fundBy']!),
      deliverBy: BigInt(typed.timing['deliverBy']!),
      judgeBy: BigInt(typed.timing['judgeBy']!),
      fallbackBy: BigInt(typed.timing['fallbackBy']!),
      appealWindowSec: BigInt(typed.timing['appealWindowSec']!),
      appealDecideSec: BigInt(typed.timing['appealDecideSec']!),
      maxSubmissions: Number(typed.timing['maxSubmissions']),
      disputeBy: BigInt(typed.timing['disputeBy']!),
      disputeJudgeSec: BigInt(typed.timing['disputeJudgeSec']!),
      disputeFallbackSec: BigInt(typed.timing['disputeFallbackSec']!),
    },
    remedyHash: struct('Remedy', t.remedy as unknown as Encoded),
    delivery:
      o.delivery && d
        ? [
            {
              ciphertextHash: struct('Ciphertext', d.ciphertext),
              plaintextSha256Hash: str(o.delivery.plaintextSha256),
              plaintextMimeHash: str(o.delivery.plaintextMime),
              encryptedKeysHash: keccak256(o.delivery.encryptedKeys.length ? concat(o.delivery.encryptedKeys.map(keyHash)) : '0x'),
              submittedAt: d.submittedAt,
            },
          ]
        : [],
  };
}

/** The fill as the seller contract's ABI struct. */
export function fillView(f: TakeFill) {
  return { buyer: getAddress(f.buyer), buyerPaymentAddress: getAddress(f.buyerPaymentAddress), buyerKeyHash: str(f.buyerEncryptionPublicKey), nonceSeed: f.nonceSeed, createdAt: secs(f.createdAt) };
}

/** A take's (kind TAKE) or a standing delivery's (kind STANDING_DELIVERY) signature, as the seller contract decodes it on a chain. */
export function encodeStandingSignature(kind: typeof TAKE | typeof STANDING_DELIVERY, o: StandingOffer, keySignature: Hex, fill: TakeFill): Hex {
  return encodeAbiParameters([{ type: 'uint8' }, STANDING_OFFER_ABI, { type: 'bytes' }, FILL_ABI], [kind, standingOfferView(o), keySignature, fillView(fill)] as never);
}

/**
 * Whether a signature is a take of a standing offer: a chain blob of kind TAKE that decodes as the seller contract
 * decodes it, or SimChain's JSON blob of kind TAKE. A contract signer's other long signatures (a multisig's, a passkey
 * wallet's) are not (red team of PR 736, M2). Never throws.
 */
export function isTakeSignature(signature: Hex): boolean {
  const sim = decodeSim(signature);
  if (sim) return sim.kind === TAKE;
  try {
    const [kind] = decodeAbiParameters([{ type: 'uint8' }, STANDING_OFFER_ABI, { type: 'bytes' }, FILL_ABI], signature);
    return Number(kind) === TAKE;
  } catch {
    return false;
  }
}

/** A chain blob as the seller contract decodes it: the kind, the template's ABI struct, the key's signature and the fill. */
export interface StandingBlob {
  kind: number;
  offer: ReturnType<typeof standingOfferView>;
  keySignature: Hex;
  fill: ReturnType<typeof fillView>;
}

/** A chain blob of kind TAKE or STANDING_DELIVERY, decoded as the seller contract decodes it; null for anything else. Never throws. */
export function decodeStandingSignature(signature: Hex): StandingBlob | null {
  try {
    const [kind, offer, keySignature, fill] = decodeAbiParameters([{ type: 'uint8' }, STANDING_OFFER_ABI, { type: 'bytes' }, FILL_ABI], signature);
    if (kind !== TAKE && kind !== STANDING_DELIVERY) return null;
    return { kind, offer: offer as StandingBlob['offer'], keySignature, fill: fill as StandingBlob['fill'] };
  } catch {
    return null;
  }
}

// The seller contract's own type strings (HoldbackStandingSeller.sol, HoldbackTypes.sol), for its `templateHash` over the ABI struct.
const TYPE = {
  tokenAmount: 'TokenAmount(string token,uint256 amount)',
  keyUnlock: 'KeyUnlock(string kind,uint64 round)',
  encryptedKey: 'EncryptedKey(address recipient,string scheme,string ciphertext,KeyUnlock unlock)',
  adjudication: 'Adjudication(address adjudicator,address fallbackAdjudicator,address appealAdjudicator,string policyId,TokenAmount fee,bytes32 registryHash,bytes32 policyHash)',
  timingOffsets:
    'TimingOffsets(uint64 offerExpiresAt,uint64 fundBy,uint64 deliverBy,uint64 judgeBy,uint64 fallbackBy,uint64 appealWindowSec,uint64 appealDecideSec,uint8 maxSubmissions,uint64 disputeBy,uint64 disputeJudgeSec,uint64 disputeFallbackSec)',
  ciphertext: 'Ciphertext(string uri,string sha256,uint64 bytes,string cipher)',
  standingDelivery: 'StandingDelivery(Ciphertext ciphertext,string plaintextSha256,string plaintextMime,EncryptedKey[] encryptedKeys,uint64 submittedAt)',
  standingOffer:
    'StandingOffer(address rules,uint64 expiresAt,string offerId,string schemaVersion,string clubId,bytes32 rulebookHash,address sellerPayoutAddress,bytes32 deliverableHash,bytes32 acceptanceHash,TokenAmount price,Adjudication adjudication,TimingOffsets timing,Remedy remedy,StandingDelivery[] delivery)',
} as const;
const typeHash = (...parts: string[]) => keccak256(stringToBytes(parts.join('')));
const enc = (types: string[], values: unknown[]) => encodeAbiParameters(types.map((type) => ({ type })), values as never);

/**
 * The template's hash from its ABI struct, as the seller contract's `templateHash` computes it: what a node reads from a
 * chain blob, where the template's strings travel only as hashes. Equal to `templateHash` of the template it came from
 * (standing.test.ts; on anvil, the contract's own answer).
 */
export function templateHashOfView(o: StandingBlob['offer']): Hex32 {
  if (o.delivery.length > 1) throw new RangeError('a template carries at most one standing delivery');
  const tokenHash = keccak256(stringToBytes(o.token.toLowerCase()));
  const amount = (v: bigint) => keccak256(enc(['bytes32', 'bytes32', 'uint256'], [typeHash(TYPE.tokenAmount), tokenHash, v]));
  const adjudication = keccak256(
    enc(['bytes32', 'address', 'address', 'address', 'bytes32', 'bytes32', 'bytes32', 'bytes32'], [typeHash(TYPE.adjudication, TYPE.tokenAmount), o.adjudicator, o.fallbackAdjudicator, o.appealAdjudicator, o.policyIdHash, amount(o.fee), o.registryHash, o.policyHash]),
  );
  const t = o.timing;
  const timing = keccak256(
    enc(
      ['bytes32', 'uint64', 'uint64', 'uint64', 'uint64', 'uint64', 'uint64', 'uint64', 'uint8', 'uint64', 'uint64', 'uint64'],
      [typeHash(TYPE.timingOffsets), t.offerExpiresAt, t.fundBy, t.deliverBy, t.judgeBy, t.fallbackBy, t.appealWindowSec, t.appealDecideSec, t.maxSubmissions, t.disputeBy, t.disputeJudgeSec, t.disputeFallbackSec],
    ),
  );
  const d = o.delivery[0];
  const deliveries = d
    ? keccak256(keccak256(enc(['bytes32', 'bytes32', 'bytes32', 'bytes32', 'bytes32', 'uint64'], [typeHash(TYPE.standingDelivery, TYPE.ciphertext, TYPE.encryptedKey, TYPE.keyUnlock), d.ciphertextHash, d.plaintextSha256Hash, d.plaintextMimeHash, d.encryptedKeysHash, d.submittedAt])))
    : keccak256('0x');
  const offerType = typeHash(TYPE.standingOffer, TYPE.adjudication, TYPE.ciphertext, TYPE.encryptedKey, TYPE.keyUnlock, 'Remedy(string onReject)', TYPE.standingDelivery, TYPE.timingOffsets, TYPE.tokenAmount);
  return keccak256(
    enc(
      ['bytes32', 'address', 'uint64', 'bytes32', 'bytes32', 'bytes32', 'bytes32', 'address', 'bytes32', 'bytes32', 'bytes32', 'bytes32', 'bytes32', 'bytes32', 'bytes32'],
      [offerType, o.rules, o.expiresAt, o.offerIdHash, o.schemaVersionHash, o.clubIdHash, o.rulebookHash, o.sellerPayoutAddress, o.deliverableHash, o.acceptanceHash, amount(o.price), adjudication, timing, o.remedyHash, deliveries],
    ),
  );
}

/**
 * The key that signed a chain blob's template for `sellerContract` (ADR-0040 §4): the address a node checks the CREATE2
 * address against before the contract is deployed. Recovered as Solady's ECDSA does: 64 bytes, or 65 with v 27 or 28.
 * Null when the blob does not decode or the signature recovers nothing. It proves who signed, not that the template is
 * live: the contract's own answer, simulated, decides that. Never throws.
 */
export async function standingKeyOf(signature: Hex, sellerContract: Address, chainId: number): Promise<Address | null> {
  const b = decodeStandingSignature(signature);
  if (!b) return null;
  try {
    const digest = keccak256(concat(['0x1901', domainSeparator({ domain: { ...STANDING_SELLER_DOMAIN, chainId, verifyingContract: getAddress(sellerContract) } }), templateHashOfView(b.offer)]));
    const n = (b.keySignature.length - 2) / 2;
    const v = n === 65 ? parseInt(b.keySignature.slice(130, 132), 16) : 27;
    if ((n !== 64 && n !== 65) || (v !== 27 && v !== 28)) return null;
    const full = n === 64 ? serializeSignature(compactSignatureToSignature(parseCompactSignature(b.keySignature))) : b.keySignature;
    return await recoverAddress({ hash: digest, signature: full });
  } catch {
    return null;
  }
}

// SimChain's standing seller: the same decision over a JSON blob, since SimChain has no EVM to decode the ABI one.

const SIM_TAG = 'holdback-standing-sim-1';

/** A take's or a standing delivery's signature for a SimChain standing seller: the template in JSON, the key's signature and the fill. */
export function encodeSimStandingSignature(kind: typeof TAKE | typeof STANDING_DELIVERY, o: StandingOffer, keySignature: Hex, fill: TakeFill): Hex {
  return toHex(stringToBytes(JSON.stringify({ sim: SIM_TAG, kind, offer: o, keySignature, fill })));
}

function decodeSim(blob: Hex): { kind: number; offer: StandingOffer; keySignature: Hex; fill: TakeFill } | null {
  try {
    const v = JSON.parse(fromHex(blob, 'string')) as { sim?: unknown; kind?: unknown; offer?: StandingOffer; keySignature?: Hex; fill?: TakeFill };
    if (v.sim !== SIM_TAG || (v.kind !== TAKE && v.kind !== STANDING_DELIVERY) || !v.offer || !v.keySignature || !v.fill) return null;
    return { kind: v.kind, offer: v.offer, keySignature: v.keySignature, fill: v.fill };
  } catch {
    return null;
  }
}

/** A seller contract's state, as SimChain keeps it: its key, its revoked templates and whether it is retired. */
export interface StandingSellerState {
  address: Address;
  key: Address;
  revoked?: readonly Hex32[];
  retired?: boolean;
}

/**
 * The seller contract's `isValidSignature` for a SimChain blob (ADR-0040 §1): yes for a take of a template the key
 * signed, not revoked or retired, at `now` before its expiry and not before the take's createdAt, whose terms' digest
 * under `domain` is `digest`; and for the template's standing delivery to such a take, revoked or expired included.
 * The key's own 64- or 65-byte signatures are the caller's to check. Never throws.
 */
export async function standingApproval(seller: StandingSellerState, domain: HoldbackDomain, chainId: number, now: Timestamp, digest: Hex32, blob: Hex): Promise<boolean> {
  const b = decodeSim(blob);
  if (!b) return false;
  try {
    const { offer, fill } = b;
    if (offer.delivery === undefined && b.kind === STANDING_DELIVERY) return false;
    if (b.kind === TAKE) {
      const th = templateHash(offer);
      if (seller.retired || (seller.revoked ?? []).some((r) => r.toLowerCase() === th.toLowerCase())) return false;
      if (!(Date.parse(now) < Date.parse(offer.expiresAt)) || Date.parse(fill.createdAt) > Date.parse(now)) return false;
    }
    if (getAddress(offer.terms.sellerPayoutAddress) === getAddress(seller.address)) return false;
    // The template's own deployment: the contract signs the take's digest under `offer.rules`' domain (red team H-1 of T-548).
    if (getAddress(offer.rules) !== getAddress(domain.verifyingContract)) return false;
    // The key's signature as the contract reads it (Solady ECDSA: 64 or 65 bytes, v 27 or 28).
    if (!(await recoversFrom(templateDigest(offer, seller.address, chainId), b.keySignature, seller.key))) return false;
    const terms = takeTerms(offer, fill, seller.address);
    if (b.kind === TAKE) return digest.toLowerCase() === termsDigest(domain, terms).toLowerCase();
    const id = commitmentId(terms);
    const d = standingDeliveryFor(offer, id)!;
    return digest.toLowerCase() === messageDigest(domain, { ...d, type: 'Delivery' } as UnsignedMessage).toLowerCase();
  } catch {
    return false;
  }
}


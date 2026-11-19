// Helpers both settlement adapters (sim/ and evm/) share. Not part of the package's API.
import { problem, type Problem, type ProblemType } from '@holdback/core';

/**
 * A refused submission. The adapters throw it inside a transaction and return its problem from submit. `revert` is the
 * contract error's name when the refusal came from a contract.
 */
export class Refusal extends Error {
  constructor(
    readonly problem: Problem,
    readonly revert?: string,
  ) {
    super(problem.detail);
  }
}

export const refuse = (type: ProblemType, detail: string): never => {
  throw new Refusal(problem(type, detail));
};

/** A JSON value with every bigint as its decimal string. */
export const toJson = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x: unknown) => (typeof x === 'bigint' ? x.toString() : x)));

/**
 * The longest buyer's or seller's signature a settlement node relays, in bytes (T-549 red team). A contract signer's
 * ERC-1271 signature has no length in the schema (D31), but a node keeps a few copies of each signature in a deal's
 * record, and a record must fit its store's row (2 MiB in a Durable Object). So this is the node's relay limit, stated
 * in site/ref/limits.txt, not the protocol's: a longer signature still goes straight to the rules contract. A standing
 * seller's take is about 2 KiB and a multisig's signature 65 bytes for each owner.
 */
export const MAX_PARTY_SIGNATURE_BYTES = 16_384;

/** Why `s` carries a party signature longer than MAX_PARTY_SIGNATURE_BYTES, or null. */
export function oversizedPartySignature(s: { kind: string } & Record<string, unknown>): string | null {
  const o = s as Record<string, Record<string, unknown> | undefined>;
  const found: Array<[string, unknown]> = [];
  const commitment = o['commitment'] as { signatures?: Record<string, unknown> } | undefined;
  if (commitment?.signatures) for (const [k, v] of Object.entries(commitment.signatures)) found.push([`signatures.${k}`, v]);
  for (const [field, key] of [['message', 'signature'], ['message', 'buyerSignature'], ['message', 'sellerSignature'], ['agree', 'signature'], ['delivery', 'signature'], ['appeal', 'signature']] as const) {
    const v = o[field]?.[key];
    if (v !== undefined) found.push([`${field}.${key}`, v]);
  }
  for (const [where, v] of found) {
    if (typeof v === 'string' && (v.length - 2) / 2 > MAX_PARTY_SIGNATURE_BYTES) {
      return `${where} is ${Math.ceil((v.length - 2) / 2)} bytes; this node relays a party's signature of at most ${MAX_PARTY_SIGNATURE_BYTES} bytes. A longer one can still go straight to the rules contract`;
    }
  }
  return null;
}

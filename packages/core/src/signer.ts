// The contract-signer rule (ADR-0040 §5, D84): how a node checks a buyer's or a seller's signature when the party may
// be a contract. The rules contract checks both parties through Solady's SignatureCheckerLib
// (`contracts/src/HoldbackRules.sol:584`), and this rule follows it:
// - an address with no code: ECDSA recovery of a 64-byte (EIP-2098) or 65-byte signature, as today;
// - an address with code: ERC-1271 `isValidSignature(digest, signature)`, which must answer the magic value 0x1626ba7e;
// - an address with no code yet and any other length: ERC-1271 against the code it will have, when the reader can say
//   what that is (a standing seller's contract before its deployment, ADR-0040 §4); otherwise no.
// Core has no network, so the reads come from the caller: an EVM node reads its chain by eth_call, SimChain its own
// table of contract accounts. The pinned bundles (site/buy.mjs, site/try.mjs) never import this module; they keep their
// own ECDSA check (examples/verify.ts).
import { compactSignatureToSignature, isAddressEqual, parseCompactSignature, recoverAddress, serializeSignature, size, type Hex } from 'viem';
import type { Address, Hex32 } from './types.js';

/** The ERC-1271 magic value: `bytes4(keccak256("isValidSignature(bytes32,bytes)"))`. */
export const ERC1271_MAGIC = '0x1626ba7e';

/**
 * True when `signature` by `signer` is valid for the EIP-712 `digest`. Throws only when a read the check needs fails
 * (an RPC error), never for a malformed or wrong signature, so a caller can tell "no" from "could not ask".
 */
export type SignerCheck = (digest: Hex32, signature: Hex, signer: Address) => Promise<boolean>;

/** The reads the rule needs, from a chain or a simulation of one. */
export interface SignerReads {
  /** The code at `address`, `0x` when there is none. */
  code(address: Address): Promise<Hex>;
  /**
   * ERC-1271 at `address`, by a read-only call: true only for the magic value. `code`: run this code at `address`
   * instead of what is there (a code override). A revert, an empty or short answer, or another value is false.
   */
  isValidSignature(address: Address, digest: Hex32, signature: Hex, code?: Hex): Promise<boolean>;
  /**
   * The code `address` will have once deployed, when the reader can tell it from the signature and the address alone
   * (ADR-0040 §4: a standing seller's contract at its CREATE2 address). Absent, or undefined: none is known.
   */
  plannedCode?(address: Address, signature: Hex): Promise<Hex | undefined>;
}

/**
 * ECDSA by `signer` over `digest`, 64 or 65 bytes, as SignatureCheckerLib reads a signer without code: a 65-byte one only
 * with v of 27 or 28, since the ecrecover precompile takes no other (T-549 red team: a copy with v of 0 or 1 recovers in
 * viem, and booking it would front-run the seller's own offer). Never throws.
 */
export async function recoversFrom(digest: Hex32, signature: Hex, signer: Address): Promise<boolean> {
  try {
    const n = size(signature);
    const v = n === 65 ? parseInt(signature.slice(130, 132), 16) : 27;
    if (v !== 27 && v !== 28) return false;
    const full = n === 64 ? serializeSignature(compactSignatureToSignature(parseCompactSignature(signature))) : n === 65 ? signature : null;
    if (full === null) return false;
    return isAddressEqual(await recoverAddress({ hash: digest, signature: full }), signer);
  } catch {
    return false;
  }
}

/** The rule over `reads`, as a SignerCheck for the verify functions of eip712.ts. */
export function contractSignerRule(reads: SignerReads): SignerCheck {
  return async (digest, signature, signer) => {
    if (!/^0x([0-9a-fA-F]{2})+$/.test(signature)) return false;
    const code = await reads.code(signer);
    if (code !== '0x') return reads.isValidSignature(signer, digest, signature);
    const n = size(signature);
    if (n === 64 || n === 65) return recoversFrom(digest, signature, signer);
    const planned = await reads.plannedCode?.(signer, signature);
    return planned !== undefined && planned !== '0x' ? reads.isValidSignature(signer, digest, signature, planned) : false;
  };
}

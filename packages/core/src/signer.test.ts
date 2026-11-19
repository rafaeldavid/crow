// The contract-signer rule (ADR-0040 §5, D84), over fake reads: which path each signature takes, and that the verify
// functions run it over the same digest they sign.
import { parseSignature, serializeCompactSignature, signatureToCompactSignature, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { contractSignerRule, recoversFrom, type SignerReads } from './signer.js';
import { holdbackDomain, messageDigest, signMessage, verifyMessage } from './eip712.js';
import type { Address, Agree, Hex32 } from './types.js';

const key = `0x${'11'.repeat(32)}` as const;
const signer = privateKeyToAccount(key);
const other = privateKeyToAccount(`0x${'22'.repeat(32)}`);
const digest = `0x${'ab'.repeat(32)}` as Hex32;
const contract = `0x${'cc'.repeat(20)}` as Address;
const blob = `0x${'01'.repeat(300)}` as Hex;

interface Asked {
  address: Address;
  signature: Hex;
  code?: Hex;
}

function reads(codes: Record<string, Hex>, answer: boolean, planned?: Hex): { reads: SignerReads; asked: Asked[] } {
  const asked: Asked[] = [];
  return {
    asked,
    reads: {
      code: async (a) => codes[a.toLowerCase()] ?? '0x',
      isValidSignature: async (address, d, signature, code) => {
        expect(d).toBe(digest);
        asked.push({ address, signature, ...(code ? { code } : {}) });
        return answer;
      },
      ...(planned ? { plannedCode: async () => planned } : {}),
    },
  };
}

describe('the contract-signer rule (signer.ts)', () => {
  it('recovers a 65-byte and a 64-byte (EIP-2098) signature from an address with no code, and asks no contract', async () => {
    const sig = await signer.sign({ hash: digest });
    const compact = serializeCompactSignature(signatureToCompactSignature(parseSignature(sig)));
    const { reads: r, asked } = reads({}, true);
    const rule = contractSignerRule(r);
    expect(await rule(digest, sig, signer.address)).toBe(true);
    expect(await rule(digest, compact, signer.address)).toBe(true);
    expect(await rule(digest, sig, other.address)).toBe(false);
    expect(asked).toEqual([]);
  });

  it("asks ERC-1271 for any signature from an address with code, a 65-byte one included, and takes the contract's answer", async () => {
    const sig = await signer.sign({ hash: digest });
    for (const answer of [true, false]) {
      const { reads: r, asked } = reads({ [contract]: '0x6080' }, answer);
      const rule = contractSignerRule(r);
      expect(await rule(digest, sig, contract)).toBe(answer);
      expect(await rule(digest, blob, contract)).toBe(answer);
      expect(asked).toEqual([
        { address: contract, signature: sig },
        { address: contract, signature: blob },
      ]);
    }
  });

  it('runs the planned code over an address with no code yet, and says no when none is known', async () => {
    const planned = reads({}, true, '0x60ff');
    expect(await contractSignerRule(planned.reads)(digest, blob, contract)).toBe(true);
    expect(planned.asked).toEqual([{ address: contract, signature: blob, code: '0x60ff' }]);
    const none = reads({}, true);
    expect(await contractSignerRule(none.reads)(digest, blob, contract)).toBe(false);
    expect(none.asked).toEqual([]);
  });

  it('refuses a malformed signature before any read, and a 65-byte one that does not recover', async () => {
    const throwing: SignerReads = {
      code: async () => {
        throw new Error('no read expected');
      },
      isValidSignature: async () => {
        throw new Error('no read expected');
      },
    };
    const rule = contractSignerRule(throwing);
    for (const bad of ['0x', '0xabc', 'abab', '0xzz'] as Hex[]) expect(await rule(digest, bad, contract)).toBe(false);
    expect(await recoversFrom(digest, `0x${'00'.repeat(65)}`, signer.address)).toBe(false);
    expect(await recoversFrom(digest, `0x${'00'.repeat(66)}`, signer.address)).toBe(false);
  });

  it('throws when a read fails, so a caller tells "no" from "could not ask"', async () => {
    const down: SignerReads = {
      code: async () => {
        throw new Error('rpc down');
      },
      isValidSignature: async () => false,
    };
    await expect(contractSignerRule(down)(digest, blob, contract)).rejects.toThrow('rpc down');
  });

  it('verifyMessage runs the rule over the digest the party signs, and keeps ECDSA without it', async () => {
    const domain = holdbackDomain(31337, `0x${'dd'.repeat(20)}`);
    const unsigned: Omit<Agree, 'signature'> = { type: 'Agree', commitmentId: `0x${'33'.repeat(32)}`, buyer: contract, nonce: `0x${'44'.repeat(32)}`, expiresAt: '2026-11-20T00:00:00Z' };
    const want = messageDigest(domain, unsigned);
    const seen: Hex32[] = [];
    const rule = contractSignerRule({
      code: async () => '0x6080',
      isValidSignature: async (a, d, s) => {
        seen.push(d);
        return a === contract && s === blob;
      },
    });
    expect(await verifyMessage(domain, { ...unsigned, signature: blob }, contract, rule)).toBe(true);
    expect(seen).toEqual([want]);
    // Without the rule a contract's signature never verifies, and a key's still does.
    expect(await verifyMessage(domain, { ...unsigned, signature: blob }, contract)).toBe(false);
    const byKey = { ...unsigned, buyer: signer.address };
    expect(await verifyMessage(domain, { ...byKey, signature: await signMessage(key, domain, byKey) }, signer.address)).toBe(true);
  });
});

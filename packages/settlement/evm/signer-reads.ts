// The contract-signer rule's reads on a chain (ADR-0040 §5, D84): the code at a party's address and its ERC-1271
// answer, by eth_call. The rule itself is core's (packages/core/src/signer.ts), the same one SimChain runs over its own
// table. The answer counts as yes exactly as SignatureCheckerLib counts it inside the rules contract: the first word
// the call returns is the magic value followed by zeros. A revert, an empty or short answer, another value, or a call
// that runs out of gas is no; a failed request (the node is down, rate-limited, or lacks the block) throws, so the
// caller can tell "no" from "could not ask".
import { contractSignerRule, ERC1271_MAGIC, type SignerCheck } from '@holdback/core';
import { encodeFunctionData, parseAbi, type Hex, type PublicClient } from 'viem';
import { missingBlock } from './errors.js';

const ERC1271 = parseAbi(['function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)']);
const YES_WORD = `${ERC1271_MAGIC}${'0'.repeat(56)}`;

/** Errors that say the request failed, not that the contract answered no. */
const TRANSPORT = new Set(['HttpRequestError', 'TimeoutError', 'WebSocketRequestError', 'SocketClosedError', 'LimitExceededRpcError', 'ResourceUnavailableRpcError']);

function failedRequest(e: unknown): boolean {
  if (missingBlock(e)) return true;
  const seen = new Set<unknown>();
  for (let x: unknown = e; x && typeof x === 'object' && !seen.has(x); x = (x as { cause?: unknown }).cause) {
    seen.add(x);
    if (TRANSPORT.has((x as { name?: string }).name ?? '')) return true;
  }
  return false;
}

/** Where a check reads: a block (a mined transaction's, for a step read from the chain), and the second a block override sets (the scenario clock on anvil). Neither: the latest block. */
export interface ReadAt {
  blockNumber?: bigint;
  time?: number;
}

/** The rule over `client` at `at`. */
export function chainSignerCheck(client: PublicClient, at: ReadAt = {}): SignerCheck {
  const block = at.blockNumber !== undefined ? { blockNumber: at.blockNumber } : {};
  return contractSignerRule({
    code: async (address) => (await client.getCode({ address, ...block })) ?? '0x',
    isValidSignature: async (address, digest, signature, code?: Hex) => {
      try {
        const r = await client.call({
          to: address,
          data: encodeFunctionData({ abi: ERC1271, functionName: 'isValidSignature', args: [digest, signature] }),
          ...block,
          ...(at.time !== undefined ? { blockOverrides: { time: BigInt(at.time) } } : {}),
          ...(code ? { stateOverride: [{ address, code }] } : {}),
        });
        return (r.data ?? '0x').slice(0, 66).toLowerCase() === YES_WORD;
      } catch (e) {
        if (failedRequest(e)) throw e;
        return false;
      }
    },
  });
}

// The contract-signer rule's reads on a chain (ADR-0040 §5, D84): the code at a party's address and its ERC-1271
// answer, by eth_call. The rule itself is core's (packages/core/src/signer.ts), the same one SimChain runs over its own
// table. The answer counts as yes exactly as SignatureCheckerLib counts it inside the rules contract: the first word
// the call returns is the magic value followed by zeros. A call that reverts or runs out of gas, or an empty, short or
// other answer, is no; any other failure (the node is down, rate-limited, lacks the block or refuses the request) throws,
// so the caller can tell "no" from "could not ask".
import { contractSignerRule, ERC1271_MAGIC, type SignerCheck } from '@holdback/core';
import { encodeFunctionData, parseAbi, type Address, type Hex, type PublicClient } from 'viem';

const ERC1271 = parseAbi(['function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)']);
const YES_WORD = `${ERC1271_MAGIC}${'0'.repeat(56)}`;
const EXECUTION = /execution reverted|revert|out of gas|outofgas|invalid opcode|invalidfejump|stack (under|over)flow/i;

/** True when the error says the call itself failed inside the EVM (a revert, out of gas), not that the request failed. */
export function executionFailed(e: unknown): boolean {
  const seen = new Set<unknown>();
  for (let x: unknown = e; x && typeof x === 'object' && !seen.has(x); x = (x as { cause?: unknown }).cause) {
    seen.add(x);
    const o = x as { name?: string; details?: unknown; shortMessage?: unknown; code?: unknown };
    if (o.name === 'ExecutionRevertedError' || o.name === 'ContractFunctionRevertedError') return true;
    // JSON-RPC 3 is "execution reverted" (EIP-1474); anvil and geth also name a revert or out of gas in the details.
    if (o.code === 3) return true;
    if ([o.details, o.shortMessage].some((m) => typeof m === 'string' && EXECUTION.test(m))) return true;
  }
  return false;
}

/**
 * Where a check reads: a block (a mined transaction's, for a step read from the chain; or, as a function, the node's
 * newest, so a read after this node's own write sees it, T-232), or `call` for each eth_call (anvil's scenario clock,
 * whose pending block carries the scenario's second).
 */
export interface ReadAt {
  blockNumber?: bigint | (() => Promise<bigint>);
  call?: (tx: { to: Address; data: Hex }) => Promise<Hex>;
}

/** The rule over `client` at `at`. */
export function chainSignerCheck(client: PublicClient, at: ReadAt = {}): SignerCheck {
  // One block for both reads of a check, asked once.
  let pinned: Promise<{ blockNumber?: bigint }> | undefined;
  const block = () => (pinned ??= typeof at.blockNumber === 'function' ? at.blockNumber().then((blockNumber) => ({ blockNumber })) : Promise.resolve(at.blockNumber !== undefined ? { blockNumber: at.blockNumber } : {}));
  return contractSignerRule({
    code: async (address) => (await client.getCode({ address, ...(await block()) })) ?? '0x',
    isValidSignature: async (address, digest, signature, code?: Hex) => {
      const data = encodeFunctionData({ abi: ERC1271, functionName: 'isValidSignature', args: [digest, signature] });
      try {
        const answer =
          at.call && !code
            ? await at.call({ to: address, data })
            : // Anvil's scenario clock passes `call`; a live chain passes its newest block; a block-less check reads the latest (a test's stub chain).
              (await client.call({ to: address, data, ...(await block()), ...(code ? { stateOverride: [{ address, code }] } : {}) })).data; // eslint-disable-line no-restricted-syntax -- the block comes from block() above: the transaction's own, or the node's newest (T-232)
        return (answer ?? '0x').slice(0, 66).toLowerCase() === YES_WORD;
      } catch (e) {
        if (executionFailed(e)) return false;
        throw e;
      }
    },
  });
}

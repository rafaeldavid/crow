// The contract-signer rule's reads on a chain (ADR-0040 §5, D84): the code at a party's address and its ERC-1271
// answer, by eth_call. The rule itself is core's (packages/core/src/signer.ts), the same one SimChain runs over its own
// table. The answer counts as yes exactly as SignatureCheckerLib counts it inside the rules contract: the first word
// the call returns is the magic value followed by zeros. A call that reverts or runs out of gas, or an empty, short or
// other answer, is no; any other failure (the node is down, rate-limited, lacks the block or refuses the request) throws,
// so the caller can tell "no" from "could not ask".
//
// The question is asked as the rules contract asks it (T-549 red team of PR 715, M2): a small checker runs in the rules
// contract's place, by a code override, and asks the party by STATICCALL with all the gas it has, so the party sees the
// rules contract as `msg.sender`, a static context, the relayer as `tx.origin` and a gas price above 0. Before that fix
// the node asked from address 0 at gas price 0, so a wallet could say yes to the node and no on chain.
import { contractSignerRule, ERC1271_MAGIC, type SignerCheck } from '@holdback/core';
import { concat, encodeFunctionData, pad, parseAbi, toHex, type Address, type Hex, type PublicClient } from 'viem';

const ERC1271 = parseAbi(['function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)']);
const YES_WORD = `${ERC1271_MAGIC}${'0'.repeat(56)}`;
// A halt inside the EVM: geth's and anvil's (revm) names for a revert, out of gas, a bad opcode or jump, the stack, the
// call depth and the return data (T-549 red team, L1).
const EXECUTION = /execution reverted|revert|out of gas|outofgas|invalid opcode|invalidfeopcode|opcodenotfound|invalid ?jump|stack ?(under|over)flow|max call depth|calltoodeep|return ?data out of bounds|outofoffset|EVM error/i;

/**
 * The checker that stands in for the rules contract (41 bytes, hand-assembled). Its calldata is the party's address as
 * one word, then the `isValidSignature` call. It copies the call to memory, STATICCALLs the party with all its gas, as
 * SignatureCheckerLib does, and returns the answer's first word when the call succeeded with at least 32 bytes;
 * otherwise it reverts, which this module reads as no.
 *
 *   PUSH1 0x20 CALLDATASIZE SUB DUP1 PUSH1 0x20 PUSH1 0 CALLDATACOPY      mem[0..n) = the isValidSignature call
 *   PUSH1 0x20 PUSH1 0 DUP3 PUSH1 0 PUSH1 0 CALLDATALOAD GAS STATICCALL   staticcall(gas, party, 0, n, 0, 32)
 *   RETURNDATASIZE PUSH1 0x20 GT ISZERO AND PUSH1 0x23 JUMPI              success and at least 32 bytes back
 *   PUSH1 0 DUP1 REVERT                                                   no
 *   JUMPDEST PUSH1 0x20 PUSH1 0 RETURN                                    the answer's first word
 */
const RULES_CHECKER: Hex = '0x6020360380602060003760206000826000600035' + '5afa3d6020111516602357600080fd5b60206000f3' as Hex;

/** The gas a check gets: the relayer's cap per transaction (live.ts), which bounds what a wallet can use on chain too. */
const CHECK_GAS = 3_000_000n;
/** The relayer's balance in a check, so a gas price above 0 never fails the read for want of test ETH. */
const CHECK_BALANCE = toHex(10n ** 24n);

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

/** A read-only call with code and balance overrides, as `eth_call` takes them. */
export interface CheckCall {
  from: Address;
  to: Address;
  data: Hex;
  gas: bigint;
  gasPrice: bigint;
  overrides: ReadonlyArray<{ address: Address; code?: Hex; balance?: Hex }>;
}

/**
 * Where a check reads: a block (a mined transaction's, for a step read from the chain; or, as a function, the node's
 * newest, so a read after this node's own write sees it, T-232), or `call` for each eth_call (anvil's scenario clock,
 * whose pending block carries the scenario's second).
 */
export interface ReadAt {
  blockNumber?: bigint | (() => Promise<bigint>);
  call?: (tx: CheckCall) => Promise<Hex>;
}

/** How the chain's own context is rebuilt for a check (M2): the rules contract, the relayer and the gas price it pays. */
export interface CheckContext {
  rules: Address;
  /** The account a relay comes from: `tx.origin` in the check. */
  from: Address;
  /** A gas price the chain takes now, above 0. */
  gasPrice(): Promise<bigint>;
  /** A standing seller's code before its deployment (ADR-0040 §4), when the signature says what it will be. */
  plannedCode?(address: Address, signature: Hex): Promise<Hex | undefined>;
}

/** The rule over `client` at `at`, asked in the chain's own context `ctx`. */
export function chainSignerCheck(client: PublicClient, ctx: CheckContext, at: ReadAt = {}): SignerCheck {
  // One block for both reads of a check, asked once.
  let pinned: Promise<{ blockNumber?: bigint }> | undefined;
  const block = () => (pinned ??= typeof at.blockNumber === 'function' ? at.blockNumber().then((blockNumber) => ({ blockNumber })) : Promise.resolve(at.blockNumber !== undefined ? { blockNumber: at.blockNumber } : {}));
  return contractSignerRule({
    code: async (address) => (await client.getCode({ address, ...(await block()) })) ?? '0x',
    isValidSignature: async (address, digest, signature, code?: Hex) => {
      const ask = encodeFunctionData({ abi: ERC1271, functionName: 'isValidSignature', args: [digest, signature] });
      const tx: CheckCall = {
        from: ctx.from,
        to: ctx.rules,
        data: concat([pad(address), ask]),
        gas: CHECK_GAS,
        gasPrice: await ctx.gasPrice(),
        overrides: [{ address: ctx.rules, code: RULES_CHECKER }, { address: ctx.from, balance: CHECK_BALANCE }, ...(code ? [{ address, code }] : [])],
      };
      try {
        const answer = at.call
          ? await at.call(tx)
          : // A live chain passes its newest block, a mined step its own; a block-less check reads the latest (a test's stub chain).
            (
              // eslint-disable-next-line no-restricted-syntax -- the block comes from block() below: the transaction's own, or the node's newest (T-232)
              await client.call({
                account: tx.from,
                to: tx.to,
                data: tx.data,
                gas: tx.gas,
                gasPrice: tx.gasPrice,
                ...(await block()),
                stateOverride: tx.overrides.map((o) => ({ address: o.address, ...(o.code ? { code: o.code } : {}), ...(o.balance ? { balance: BigInt(o.balance) } : {}) })),
              })
            ).data;
        return (answer ?? '0x').slice(0, 66).toLowerCase() === YES_WORD;
      } catch (e) {
        if (executionFailed(e)) return false;
        throw e;
      }
    },
    ...(ctx.plannedCode ? { plannedCode: (address: Address, signature: Hex) => ctx.plannedCode!(address, signature) } : {}),
  });
}

/** `tx` as anvil's raw `eth_call` takes it: the call object and the state override set. */
export function rawCheckCall(tx: CheckCall): [Record<string, string>, Record<string, Record<string, string>>] {
  const overrides: Record<string, Record<string, string>> = {};
  for (const o of tx.overrides) overrides[o.address] = { ...(overrides[o.address] ?? {}), ...(o.code ? { code: o.code } : {}), ...(o.balance ? { balance: o.balance } : {}) };
  return [{ from: tx.from, to: tx.to, data: tx.data, gas: toHex(tx.gas), gasPrice: toHex(tx.gasPrice) }, overrides];
}

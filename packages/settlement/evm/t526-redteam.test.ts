// Red team of T-526 (2026-11-18): an outside scan's finding (G1). A reject or an escalation on a carried delivery is
// relayed as `deliver`, then `decide`. These attack fixtures try to make the primary's seed reach a call the seller can
// make revert, to split the book from the chain, and to replay a decision's key for a decision that never landed.
// Needs anvil on PATH and `forge build` output in contracts/out; 127.0.0.1 only.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { deliveryHash, type Hex32 } from '@holdback/core';
import { decodeFunctionData, encodeFunctionData, type Hex } from 'viem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deliveryView, termsView } from './encode.js';
import { must, newSettlement } from './gas.js';
import { ChainSync } from './sync.js';
import { EvmDeal } from './testing.js';
import { anvilAvailable, EvmWorld } from './world.js';

const root = join(import.meta.dirname, '..', '..', '..');
const ready = anvilAvailable() && existsSync(join(root, 'contracts', 'out', 'HoldbackRules.sol', 'HoldbackRules.json'));
/** anvil's well-known dev key #1 (public, holds only anvil's test ETH): the seller's own relayer. */
const SELLER_RELAYER: Hex = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

describe.skipIf(!ready)('T-526 red team: a carried reject or escalation (G1)', () => {
  let world: EvmWorld;
  beforeAll(async () => {
    world = await EvmWorld.start(root);
  }, 60_000);
  afterAll(async () => {
    await world?.stop();
  });

  const fnOf = (data: Hex): string => {
    try {
      return decodeFunctionData({ abi: world.abis.rules, data }).functionName;
    } catch {
      return 'other';
    }
  };
  /** Every transaction's calldata mined since `from`, lower case. */
  const calldataSince = async (from: bigint): Promise<string[]> => {
    const head = await world.publicClient.getBlockNumber();
    const out: string[] = [];
    for (let n = from; n <= head; n++) {
      const b = await world.publicClient.getBlock({ blockNumber: n, includeTransactions: true });
      for (const tx of b.transactions) out.push((tx as { input: Hex }).input.toLowerCase());
    }
    return out;
  };

  // attack.t526-seller-frontruns-posted-delivery. The operator's `deliver` of a carried delivery now goes out only ahead
  // of a reject or an escalation, so a seller watching the mempool learns "not an accept" from it, and posts another
  // delivery first. Expected (the defense): the decision is not sent, the seed never reaches any calldata, the book
  // follows the chain, and the primary can still decide the delivery that landed. The residual (reported, not asserted
  // as a defense): the seller swapped its work after learning the outcome.
  for (const outcome of ['reject', 'escalate'] as const) {
    it(`attack.t526-seller-frontruns-posted-delivery (${outcome}): the decision is not sent and the seed stays secret`, async () => {
      const { chain, cast, club } = await newSettlement(world);
      const d = new EvmDeal(chain, cast, club, `t526-front-${outcome}`);
      for (const sub of [d.offer(), d.accept(), d.agreeAndFund()]) await must(chain, cast, await sub);
      const a = await d.deliver();
      if (a.kind !== 'deliver') throw new Error('unreachable');
      expect(await chain.carryDelivery(a.delivery)).toBeNull();
      const verdict = await d.decide('primary', outcome);
      // The seller's second delivery, attempt 1, other content (a later submittedAt).
      chain.advance(5);
      const b = await d.deliver();
      if (b.kind !== 'deliver') throw new Error('unreachable');
      expect(deliveryHash(b.delivery)).not.toBe(deliveryHash(a.delivery));
      const startBlock = (await world.publicClient.getBlockNumber()) + 1n;
      const simulate = world.simulate.bind(world);
      let fired = 0;
      world.simulate = async (tx, at) => {
        // The seller sees the operator's deliver of A (the signal) and lands B first.
        if (fnOf(tx.data) === 'deliver' && fired++ === 0) {
          const data = encodeFunctionData({ abi: world.abis.rules, functionName: 'deliver', args: [termsView(d.terms), deliveryView(b.delivery), b.delivery.signature] });
          const mined = await world.send({ key: SELLER_RELAYER, to: world.deployment.rules, data }, at);
          expect(mined.status).toBe('success');
        }
        return simulate(tx, at);
      };
      let r;
      try {
        r = await chain.submit(verdict, { via: 'op-1', sender: cast.operator.key, idempotencyKey: `k-front-${outcome}` });
      } finally {
        world.simulate = simulate;
      }
      expect(fired).toBe(1);
      expect(r.ok).toBe(false);
      // Nothing of the decision reached the chain: no `decide`, and the seed is in no calldata.
      const inputs = await calldataSince(startBlock);
      expect(inputs.map((i) => fnOf(i as Hex))).toEqual(['deliver']);
      expect(inputs.some((i) => i.includes(verdict.kind === 'decide' ? verdict.message.seed.slice(2).toLowerCase() : 'x'))).toBe(false);
      // The chain holds B; the book follows it.
      expect((await chain.stage(d.id)).stage).toBe('Delivered');
      const stored = await world.publicClient.readContract({ address: world.deployment.rules, abi: world.abis.rules, functionName: 'deliveryHashOf', args: [d.id] });
      expect(String(stored).toLowerCase()).toBe(deliveryHash(b.delivery).toLowerCase());
      // The refusal leaves the book in Held with the chain in Delivered (B landed directly); the next sync pass reads it.
      const beforePass = chain.escrowState(d.id)?.kind;
      const report = await new ChainSync(chain).pass();
      const afterPass = chain.escrowState(d.id)?.kind;
      expect({ beforePass, afterPass, report: report && { behind: report.behind } }).toMatchObject({ beforePass: 'Held' });
      // The decision's key replays nothing: a retry runs and the contract refuses the decision on A.
      const retry = await chain.submit(verdict, { via: 'op-1', sender: cast.operator.key, idempotencyKey: `k-front-${outcome}` });
      expect(retry).not.toMatchObject({ replayed: true });
      expect(retry.ok).toBe(false);
      // Liveness: the seller hands the operator B's copy (if the book waits for it), then the primary decides B with the
      // same seed.
      if (chain.escrowState(d.id)?.kind !== 'Delivered') await must(chain, cast, b);
      expect(chain.escrowState(d.id)?.kind).toBe('Delivered');
      chain.advance(1);
      await must(chain, cast, d.decide('primary', outcome));
      expect((await chain.stage(d.id)).stage).toBe(outcome === 'reject' ? 'Refunded' : 'Escalated');
    }, 120_000);
  }

  // attack.t526-decide-send-fails-after-deliver. The delivery lands, then the decide's send fails with an RPC error (not
  // a refusal). Expected: the book and the chain agree (Delivered, A), the key is not answered for a decision that never
  // landed, a retry under the same key lands the decision once, and a third call replays it.
  it('attack.t526-decide-send-fails-after-deliver: the book follows the chain and the key answers only the landed decision', async () => {
    const { chain, cast, club } = await newSettlement(world);
    const d = new EvmDeal(chain, cast, club, 't526-rpc');
    for (const sub of [d.offer(), d.accept(), d.agreeAndFund()]) await must(chain, cast, await sub);
    const a = await d.deliver();
    if (a.kind !== 'deliver') throw new Error('unreachable');
    expect(await chain.carryDelivery(a.delivery)).toBeNull();
    const reject = await d.decide('primary', 'reject');
    const send = world.send.bind(world);
    world.send = async (tx, at) => {
      if (fnOf(tx.data) === 'decide') throw new Error('RPC down (injected)');
      return send(tx, at);
    };
    let first: unknown;
    try {
      first = await chain.submit(reject, { via: 'op-1', sender: cast.operator.key, idempotencyKey: 'k-rpc' });
    } catch (e) {
      first = e;
    } finally {
      world.send = send;
    }
    expect(first).toBeInstanceOf(Error);
    expect((await chain.stage(d.id)).stage).toBe('Delivered');
    expect(chain.escrowState(d.id)?.kind).toBe('Delivered');
    const stored = await world.publicClient.readContract({ address: world.deployment.rules, abi: world.abis.rules, functionName: 'deliveryHashOf', args: [d.id] });
    expect(String(stored).toLowerCase()).toBe(deliveryHash(a.delivery).toLowerCase());
    const retry = await chain.submit(reject, { via: 'op-1', sender: cast.operator.key, idempotencyKey: 'k-rpc' });
    expect(retry).toMatchObject({ ok: true, replayed: false });
    const again = await chain.submit(reject, { via: 'op-1', sender: cast.operator.key, idempotencyKey: 'k-rpc' });
    expect(again).toMatchObject({ ok: true, replayed: true });
    expect(chain.transactions().filter((t) => t.commitmentId === d.id).map((t) => t.call)).toEqual(['agreeAndFund', 'deliver', 'decide']);
    expect((await chain.stage(d.id)).stage).toBe('Refunded');
  }, 120_000);

  // attack.t526-accept-path-unchanged. An accept and an early accept still carry the delivery in one call; an escalation
  // then reaches the appeal adjudicator as before.
  it('attack.t526-accept-path-unchanged: an early accept still carries the delivery in one earlyAccept', async () => {
    const { chain, cast, club } = await newSettlement(world);
    const d = new EvmDeal(chain, cast, club, 't526-early');
    for (const sub of [d.offer(), d.accept(), d.agreeAndFund()]) await must(chain, cast, await sub);
    const a = await d.deliver();
    if (a.kind !== 'deliver') throw new Error('unreachable');
    expect(await chain.carryDelivery(a.delivery)).toBeNull();
    await must(chain, cast, d.earlyAccept());
    expect(chain.transactions().filter((t) => t.commitmentId === d.id).map((t) => t.call)).toEqual(['agreeAndFund', 'earlyAccept']);
    expect((await chain.stage(d.id)).stage).toBe('Released');
  }, 60_000);

  // attack.t526-decide-calldata-holds-delivery. The property the task states: "the decision's calldata holds no
  // delivery". After the posted delivery, the adapter's decide still sends the delivery and the seller's signature;
  // the contract ignores both outside Held, so no seller check runs in it.
  it('attack.t526-decide-calldata-holds-delivery: the decide after the posted delivery carries no seller signature', async () => {
    const { chain, cast, club } = await newSettlement(world);
    const d = new EvmDeal(chain, cast, club, 't526-calldata');
    for (const sub of [d.offer(), d.accept(), d.agreeAndFund()]) await must(chain, cast, await sub);
    const a = await d.deliver();
    if (a.kind !== 'deliver') throw new Error('unreachable');
    expect(await chain.carryDelivery(a.delivery)).toBeNull();
    await must(chain, cast, d.decide('primary', 'reject'));
    const tx = chain.transactions().filter((t) => t.commitmentId === d.id).at(-1)!;
    expect(tx.call).toBe('decide');
    const input = (await world.publicClient.getTransaction({ hash: tx.hash as Hex32 })).input;
    const args = decodeFunctionData({ abi: world.abis.rules, data: input }).args as readonly unknown[];
    expect(args[3]).toBe('0x');
  }, 60_000);
});

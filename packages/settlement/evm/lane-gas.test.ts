// Deal lanes hold enough gas for the send they are about to make (relayer lane floor, N216). A first take of a new
// standing offer deploys the seller's contract, 18.3 million gas on Sepolia against 1.56 million for an ordinary deal,
// and a lane that held 0.011 test ETH, above the old floor of 0.01, was refused. Here anvil stands in for Sepolia. A
// lane holds less than one deployment costs at the node's fee cap; the deployment and an ordinary deal are sent.
// Needs `anvil` on PATH and `forge build` output in contracts/out; elsewhere it skips and says why.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { encodeFunctionData, type Address, type Hex } from 'viem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RelayRefused } from './chain.js';
import { DEAL_LANES, FUNDING_LANE, laneOf, LiveChain, type DeploymentFile } from './live.js';
import { standingDeployment } from './standing-seller.js';
import { testActor } from './testing.js';
import { anvilAvailable, EvmWorld } from './world.js';

const root = join(import.meta.dirname, '..', '..', '..');
const ready = anvilAvailable() && ['HoldbackRules.sol/HoldbackRules.json', 'TestUSDC.sol/TestUSDC.json'].every((f) => existsSync(join(root, 'contracts', 'out', f)));
/** anvil's sixth well-known dev key (public; guards no value): this file's relayer secret. */
const RELAYER: Hex = '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba';
const eth = (n: number) => BigInt(Math.round(n * 1e6)) * 10n ** 12n;
const hexOf = (n: bigint) => `0x${n.toString(16)}`;
/** The deployment's gas budget as the operator sends it (maxGas 25 million, 5% above the estimate). */
const DEPLOY = { gasCap: (25_000_000n * 105n) / 100n, gasMarginPct: 5 };
/** A commitment ID for each deal lane. */
const idFor = (lane: number) => `0x${(lane + 3).toString(16).padStart(64, '0')}`;

describe.skipIf(!ready)(`deal lanes hold enough gas for the send they make${ready ? '' : ' (SKIPPED: needs anvil on PATH and forge build output in contracts/out)'}`, () => {
  let anvil: EvmWorld;
  let deployment: DeploymentFile;
  beforeAll(async () => {
    anvil = await EvmWorld.start(root, { blockTimeSec: 1, token: 'test-usdc' });
    const d = anvil.deployment;
    deployment = {
      chainId: anvil.chainId,
      fromBlock: Number(d.fromBlock),
      token: { address: d.token, name: anvil.tokenDomain.name, version: anvil.tokenDomain.version, symbol: 'tUSDC', decimals: 6 },
      escrow: d.escrow,
      erc3009Collector: d.erc3009Collector,
      multicall: d.multicall,
      rules: d.rules,
      beacon: d.beacon,
      expiryMarginSec: Number(anvil.expiryMargin),
    };
  }, 180_000);
  afterAll(async () => {
    await anvil?.stop();
  });

  const chainOf = () => new LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey: RELAYER, pollMs: 100, rebroadcastMs: 10_000, mintBatchMs: 50 });
  const balance = (a: Address) => anvil.publicClient.getBalance({ address: a, blockTag: 'latest' });
  const nonce = (a: Address) => anvil.publicClient.getTransactionCount({ address: a, blockTag: 'latest' });
  /** What the deployment costs this lane at the fee cap the relayer signs with. */
  async function deployCost(chain: LiveChain, key: Address): Promise<bigint> {
    const dep = standingDeployment(key);
    const gas = await anvil.publicClient.estimateGas({ account: chain.lanes[1]!.address, to: dep.to, data: dep.data });
    return (gas * 105n * (await chain.gasPrice())) / 100n;
  }

  it('a lane between the old floor and a deployment\'s cost is topped up before the deployment, and the deployment mines', async () => {
    const chain = chainOf();
    const id = idFor(0);
    const lane = chain.lanes[1 + laneOf(id)]!.address;
    const cost = await deployCost(chain, testActor('lane-gas-1').address);
    await anvil.rpc('anvil_setBalance', [chain.lanes[0]!.address, hexOf(eth(100))]);
    await anvil.rpc('anvil_setBalance', [lane, hexOf(cost / 2n)]);
    chain.keepLanes(cost, 3n * cost);
    const fundedBefore = await nonce(chain.lanes[0]!.address);
    const dep = standingDeployment(testActor('lane-gas-1').address);
    const mined = await chain.send({ lane: id, ...dep, ...DEPLOY });
    expect(mined.status).toBe('success');
    expect(mined.from.toLowerCase()).toBe(lane.toLowerCase());
    expect(await nonce(chain.lanes[0]!.address)).toBe(fundedBefore + 1);
    // The lane now holds several deployments.
    expect(await balance(lane)).toBeGreaterThan(cost);
  }, 60_000);

  it('a deployment picks a lane that can pay: the lane the commitment names is the one funded, the others are left alone', async () => {
    const chain = chainOf();
    const id = idFor(1);
    const names = chain.lanes.slice(1).map((l) => l.address);
    const cost = await deployCost(chain, testActor('lane-gas-2').address);
    await anvil.rpc('anvil_setBalance', [chain.lanes[0]!.address, hexOf(eth(100))]);
    for (const l of names) await anvil.rpc('anvil_setBalance', [l, hexOf(cost / 3n)]);
    chain.keepLanes(cost, 3n * cost);
    const mined = await chain.send({ lane: id, ...standingDeployment(testActor('lane-gas-2').address), ...DEPLOY });
    expect(mined.status).toBe('success');
    const own = names[laneOf(id)]!;
    expect(mined.from.toLowerCase()).toBe(own.toLowerCase());
    for (const l of names) if (l !== own) expect(await balance(l)).toBe(cost / 3n);
    expect(names).toHaveLength(DEAL_LANES);
  }, 60_000);

  it('an ordinary deal is unchanged: a lane that holds its cost sends it, and the funding lane sends nothing', async () => {
    const chain = chainOf();
    const id = idFor(2);
    const lane = chain.lanes[1 + laneOf(id)]!.address;
    await anvil.rpc('anvil_setBalance', [lane, hexOf(eth(1))]);
    await anvil.rpc('anvil_setBalance', [chain.lanes[0]!.address, hexOf(eth(100))]);
    chain.keepLanes(eth(0.03), eth(0.1));
    const before = await nonce(chain.lanes[0]!.address);
    const approve = encodeFunctionData({ abi: chain.abis.token, functionName: 'approve', args: [testActor('lane-gas-3').address, 5n] });
    const mined = await chain.send({ lane: id, to: deployment.token.address as Address, data: approve });
    expect(mined.status).toBe('success');
    expect(await nonce(chain.lanes[0]!.address)).toBe(before);
  }, 60_000);

  it('with the funding lane empty, the refusal is RelayRefused and the deal lane sends nothing', async () => {
    const chain = chainOf();
    const id = idFor(0);
    const lane = chain.lanes[1 + laneOf(id)]!.address;
    const cost = await deployCost(chain, testActor('lane-gas-4').address);
    await anvil.rpc('anvil_setBalance', [chain.lanes[0]!.address, '0x1']);
    await anvil.rpc('anvil_setBalance', [lane, hexOf(cost / 2n)]);
    chain.keepLanes(cost, 3n * cost);
    const before = await nonce(lane);
    await expect(chain.send({ lane: id, ...standingDeployment(testActor('lane-gas-4').address), ...DEPLOY })).rejects.toBeInstanceOf(RelayRefused);
    expect(await nonce(lane)).toBe(before);
    expect(FUNDING_LANE).toBe('funding');
  }, 60_000);
});

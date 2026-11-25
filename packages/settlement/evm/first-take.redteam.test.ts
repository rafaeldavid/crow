// Red team of T-549 pull request 4 (ADR-0040 §4, §9; red team M2 of PR 715), on a local anvil (chain id 31337,
// 127.0.0.1 only). Each `it` asserts the defended outcome. On commit 9a86a5bf (2026-11-25) the first three failed;
// the review fixes of the same pull request close them.
// - attack.deployment-gas-drain-budget-race: two first takes of two seller contracts reach the budget check together;
//   at a budget of 1 a day, only one may deploy.
// - attack.deployment-collision-burns-gas: a deployment that loses a race costs the node one deployment's gas, and
//   the funding still goes (ADR-0040 §4: "at most one failed deployment").
// - neutrality.buyer-gets-honest-seller-struck: a buyer whose funding reverts after a passing simulation must not stop
//   this node relaying the honest standing seller's other deals.
// - attack.wallet-yes-only-in-simulation: a contract buyer that answers yes in the simulation and no at the block its
//   funding lands in spends the relayer's gas once; this node then relays no funding naming it for an hour.
// Needs `anvil` on PATH and `forge build` output in contracts/out; skipped without.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { commitmentId, encodeStandingSignature, holdbackDomain, signMessage, TAKE, takeTerms, templateDigest, templateFrom, type Club, type Commitment, type Mandate, type StandingOffer, type TakeFill, type Timestamp, type TokenAmount, type UnsignedMessage } from '@holdback/core';
import { concat, getContractAddress, keccak256, size, stringToBytes, toHex, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Submission } from '../src/interface.js';
import type { Mined } from './chain.js';
import { EvmSettlement } from './evm-settlement.js';
import { must } from './gas.js';
import { CREATE2_DEPLOYER, standingSellerAddress } from './standing-seller.js';
import { EvmDeal, evmCast, evmGenesis, testActor, type EvmCast, type TestActor } from './testing.js';
import { anvilAvailable, EvmWorld } from './world.js';

const root = join(import.meta.dirname, '..', '..', '..');
const ready = anvilAvailable() && existsSync(join(root, 'contracts', 'out', 'HoldbackRules.sol', 'HoldbackRules.json'));
const START = '2026-01-01T00:00:00Z';

interface Setup {
  chain: EvmSettlement;
  cast: EvmCast;
  club: Club;
  seller: Address;
  others: { key: TestActor; seller: Address }[];
}

/** The node's private parts the attacks read or reach (TypeScript private only, so reachable at run time). */
interface Inside {
  books: Map<string, unknown>;
  deployedOn: Map<string, number>;
  /** The parties struck after a funding reverted, and until when (ms). */
  struck?: Map<string, number>;
  wall?: () => number;
  deployFor(id: Hex, book: unknown, s: { seller: Address; key: Address }, options: { via?: string; sender?: Hex }, time?: number): Promise<void>;
}
const inside = (c: EvmSettlement) => c as unknown as Inside;

describe.skipIf(!ready)(`red team of T-549 PR 4: first takes on anvil${ready ? '' : ' (SKIPPED: needs anvil and contracts/out)'}`, () => {
  let world: EvmWorld;
  beforeAll(async () => {
    world = await EvmWorld.start(root);
  }, 60_000);
  afterAll(async () => {
    await world?.stop();
  });

  async function setup(nOthers = 1, extra: Address[] = []): Promise<Setup> {
    const cast = evmCast();
    const token = world.deployment.token.toLowerCase();
    const { genesis, club } = await evmGenesis({ cast, token, chainId: world.chainId, rules: world.deployment.rules, start: START, buyer: 100_000_000_000n });
    const big = { token, amount: '1000000000000000' } as TokenAmount;
    const domain = holdbackDomain(world.chainId, world.deployment.rules);
    const seller = standingSellerAddress(cast.seller.address);
    const others = Array.from({ length: nOthers }, (_, i) => {
      const key = testActor(`redteam-standing-key-${i}`);
      return { key, seller: standingSellerAddress(key.address) };
    });
    const mandates: Mandate[] = [];
    for (const [i, agent] of [seller, ...others.map((o) => o.seller), ...extra].entries()) {
      const principal = testActor(`redteam-principal-${i}`);
      const body = { principal: principal.address, agent, clubId: club.id, scope: { roles: ['buyer', 'seller'], maxPerCommitment: big, maxDaily: big, expiresAt: '2027-01-01T00:00:00Z' }, nonce: keccak256(stringToBytes(`redteam/${i}`)), issuedAt: START } as Omit<Mandate, 'signature'>;
      mandates.push({ ...body, signature: await signMessage(principal.key, domain, { ...body, type: 'Mandate' } as UnsignedMessage) } as Mandate);
    }
    const chain = await EvmSettlement.create(world, { ...genesis, mandates: [...genesis.mandates, ...mandates] }, Object.values(cast).map((a) => a.address));
    return { chain, cast, club, seller, others };
  }

  const submit = (x: Setup, s: Submission) => x.chain.submit(s, { via: 'op-1', sender: x.cast.operator.key });
  const codeAt = async (a: Address) => (await world.publicClient.getCode({ address: a })) ?? '0x';
  const at = (x: Setup) => world.rpc('evm_setNextBlockTimestamp', [Math.floor(Date.parse(x.chain.now()) / 1000)]);

  async function take(x: Setup, tag: string, o: { key?: TestActor; seller?: Address; template?: (t: StandingOffer) => StandingOffer } = {}) {
    const key = o.key ?? x.cast.seller;
    const seller = o.seller ?? x.seller;
    const draft = new EvmDeal(x.chain, x.cast, x.club, tag, undefined, undefined, undefined, { seller, sellerPayoutAddress: x.cast.seller.address });
    const template = templateFrom(draft.terms, { rules: world.deployment.rules, expiresAt: new Date(Date.parse(draft.terms.createdAt) + 86_400_000).toISOString().replace('.000Z', 'Z') as Timestamp, offerId: `offer/${tag}` });
    const fill: TakeFill = { buyer: draft.terms.buyer, buyerPaymentAddress: draft.terms.buyerPaymentAddress, buyerEncryptionPublicKey: draft.terms.buyerEncryptionPublicKey, nonceSeed: keccak256(stringToBytes(`seed/${tag}`)), createdAt: draft.terms.createdAt };
    const terms = takeTerms(template, fill, seller);
    const deal = new EvmDeal(x.chain, x.cast, x.club, tag, undefined, undefined, undefined, { seller, sellerPayoutAddress: x.cast.seller.address, nonce: terms.nonce });
    const keySignature = await privateKeyToAccount(key.key).sign({ hash: templateDigest(template, seller, world.chainId) });
    const blob = encodeStandingSignature(TAKE, template, keySignature, fill);
    const offer: Submission = { kind: 'offer', commitment: { ...terms, id: commitmentId(terms), signatures: { seller: blob } } as Commitment };
    return { deal, terms, offer, key };
  }

  async function direct(x: Setup, actor: TestActor, to: Address, data: Hex): Promise<string> {
    await at(x);
    const w = world.wallet(actor.key);
    const hash = await w.sendTransaction({ account: w.account!, chain: foundry, to, data, gas: 3_000_000n });
    return (await world.receipt(hash)).status;
  }
  const drainBuyer = async (x: Setup) => {
    const all = await x.chain.tokenBalance(x.cast.buyer.address);
    return direct(x, x.cast.buyer, world.deployment.token, concat(['0xa9059cbb', toHex(BigInt(x.cast.stranger.address), { size: 32 }), toHex(all, { size: 32 })]));
  };

  it('attack.deployment-gas-drain-budget-race: at a budget of 1 a day, two first takes of two sellers checked together deploy once, and the counter says 1', async () => {
    // On a live chain `enqueue` keys by commitment (evm-settlement.ts, `enqueue`), so fundings of two commitments run
    // side by side and reach `deployFor` together; anvil runs one lane, so the two calls are made here directly.
    const x = await setup(2);
    x.chain.deployBudget = { perDay: 1, maxGas: 25_000_000n };
    const [a, b] = x.others as [Setup['others'][0], Setup['others'][0]];
    const ta = await take(x, 'race-budget-a', { key: a.key, seller: a.seller });
    const tb = await take(x, 'race-budget-b', { key: b.key, seller: b.seller });
    for (const t of [ta, tb]) await must(x.chain, x.cast, t.offer);
    const n = inside(x.chain);
    const day = x.chain.now().slice(0, 10);
    const sent: Mined[] = [];
    const send = world.send.bind(world);
    world.send = async (tx, s) => {
      const m = await send(tx, s);
      if (tx.to.toLowerCase() === CREATE2_DEPLOYER.toLowerCase()) sent.push(m);
      return m;
    };
    try {
      const results = await Promise.allSettled([
        n.deployFor(ta.deal.id, n.books.get(ta.deal.id), { seller: a.seller, key: a.key.address }, { sender: x.cast.operator.key }, undefined),
        // Another sending account, as a live chain's second deal lane is (live.ts `account`); EvmWorld has no nonce manager.
        n.deployFor(tb.deal.id, n.books.get(tb.deal.id), { seller: b.seller, key: b.key.address }, { sender: x.cast.stranger.key }, undefined),
      ]);
      console.log('[redteam] budget race:', results.map((r) => (r.status === 'rejected' ? String((r.reason as Error)?.message ?? r.reason).slice(0, 300) : r.status)),'deployments', sent.length, 'gasUsed', sent.map((m) => m.gasUsed.toString()), 'counter', n.deployedOn.get(day));
      // On 9a86a5bf both read `used` 0 before either wrote it: 2 deployments, and the day's counter says 1.
      expect(sent.length).toBe(1);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect([size(await codeAt(a.seller)), size(await codeAt(b.seller))].filter((s) => s > 0)).toHaveLength(1);
      expect(n.deployedOn.get(day)).toBe(sent.length);
    } finally {
      world.send = send;
    }
  }, 180_000);

  it('attack.deployment-collision-burns-gas: a deployment that loses a race costs the node no more gas than the winning one', async () => {
    const x = await setup();
    const t = await take(x, 'collision');
    await must(x.chain, x.cast, t.offer);
    await must(x.chain, x.cast, t.deal.accept());
    const sent: Mined[] = [];
    let raced = 0;
    let winner = 0n;
    const send = world.send.bind(world);
    world.send = async (tx, s) => {
      if (tx.to.toLowerCase() === CREATE2_DEPLOYER.toLowerCase() && raced++ === 0) {
        await at(x);
        const w = world.wallet(x.cast.buyer.key);
        const hash = await w.sendTransaction({ account: w.account!, chain: foundry, to: tx.to, data: tx.data, gas: 30_000_000n });
        winner = (await world.receipt(hash)).gasUsed;
      }
      const m = await send(tx, s);
      if (tx.to.toLowerCase() === CREATE2_DEPLOYER.toLowerCase()) sent.push(m);
      return m;
    };
    try {
      await must(x.chain, x.cast, t.deal.agreeAndFund());
      console.log('[redteam] collision: winner gasUsed', winner.toString(), 'node deployment', sent.map((m) => [m.status, m.gasUsed.toString()]));
      expect(sent).toHaveLength(1);
      expect(sent[0]!.status).toBe('reverted');
      // A CREATE2 collision burns all the gas forwarded to it (EIP-684): on anvil every transaction goes with 3,000,000
      // gas (world.ts), measured 2,956,975 burned against the winner's 2,548,720; on a live chain the node sends a
      // deployment with its estimate plus 5% (evm-settlement.ts `sendDeployment`), so a lost race costs about that.
      expect(winner).toBeGreaterThan(0n);
      expect(sent[0]!.gasUsed).toBeLessThanOrEqual(3_000_000n);
      expect((await x.chain.stage(t.deal.id)).stage).toBe('Held');
    } finally {
      world.send = send;
    }
  }, 120_000);

  it("neutrality.buyer-gets-honest-seller-struck: a buyer EOA that empties its balance after the node's simulation does not stop the honest seller's other deals at this node", async () => {
    const x = await setup();
    // An honest first take: deployed, funded, held.
    const honest = await take(x, 'honest');
    await must(x.chain, x.cast, honest.offer);
    await must(x.chain, x.cast, honest.deal.accept());
    await must(x.chain, x.cast, honest.deal.agreeAndFund());
    expect((await x.chain.stage(honest.deal.id)).stage).toBe('Held');

    // The attacker's take of the same public standing offer. Its buyer is an EOA (no contract, no M2 trick): it moves
    // its tokens away after the node's simulation and before the funding lands, as a front-run on a live chain would.
    const grief = await take(x, 'grief');
    await must(x.chain, x.cast, grief.offer);
    await must(x.chain, x.cast, grief.deal.accept());
    const n = inside(x.chain);
    const send = world.send.bind(world);
    let fronted = false;
    world.send = async (tx, s) => {
      if (!fronted && tx.to.toLowerCase() === world.deployment.rules.toLowerCase()) {
        fronted = true;
        expect(await drainBuyer(x)).toBe('success');
        // The node runs on a live chain's path from here (wall clock), where a revert strikes instead of throwing.
        const frozen = Date.parse(x.chain.now());
        n.wall = () => frozen;
      }
      return send(tx, s);
    };
    let r: Awaited<ReturnType<typeof submit>>;
    try {
      r = await submit(x, await grief.deal.agreeAndFund());
    } finally {
      world.send = send;
      delete n.wall;
    }
    console.log('[redteam] grief funding:', r.ok ? 'ok' : [r.problem.type, r.problem.detail], 'struck', [...(n.struck ?? [])]);
    expect(r.ok).toBe(false);
    // On 9a86a5bf the node strikes every party with code, so the honest seller contract is struck and the EOA is not.
    expect([...(n.struck ?? [])]).not.toContain(x.seller.toLowerCase());

    // The honest deal, funded before: the seller's delivery still goes through this node.
    const d = await submit(x, await honest.deal.deliver());
    console.log('[redteam] honest delivery after the revert:', d.ok ? 'ok' : [d.problem.type, d.problem.detail]);
    expect(d.ok ? 'ok' : [d.problem.type, d.problem.detail]).toBe('ok');
  }, 180_000);

  it('attack.wallet-yes-only-in-simulation: a contract buyer whose answer flips between the simulation and the block is struck for its fundings only', async () => {
    // A wallet that says yes in every block but one, K: the block its funding lands in. The node checks and simulates
    // it before K, a block passes, and the funding reverts at the relayer's gas. Every settlement starts from the same
    // snapshot, so the head after setup() is the same each time, and K follows from it.
    const tail: Hex = '0x631626ba7e0260e01b60005260206000f3';
    const initOf = (runtime: Hex): Hex => concat([`0x60${size(runtime).toString(16).padStart(2, '0')}80600b6000396000f3`, runtime]);
    const salt = `0x${'00'.repeat(32)}` as Hex;
    await setup(1);
    const head = await world.publicClient.getBlockNumber();
    // The wallet's deployment lands at head + 1, its funding is checked there and simulated at head + 2, and the
    // block the test mines in between pushes the funding to head + 3.
    const k = head + 3n;
    const runtime = concat([`0x63${k.toString(16).padStart(8, '0')}431415` as Hex, tail]);
    const wallet = getContractAddress({ opcode: 'CREATE2', from: CREATE2_DEPLOYER, salt, bytecode: initOf(runtime) });
    const x = await setup(1, [wallet]);
    expect(await world.publicClient.getBlockNumber()).toBe(head);
    expect(await direct(x, x.cast.stranger, CREATE2_DEPLOYER, concat([salt, initOf(runtime)]))).toBe('success');
    const deal = (tag: string) => new EvmDeal(x.chain, x.cast, x.club, tag, undefined, undefined, { payment: x.cast.buyer, payout: x.cast.seller.address }, { buyer: wallet });
    const [a, b] = [deal('flip-a'), deal('flip-b')];
    for (const d of [a, b]) {
      await must(x.chain, x.cast, d.offer());
      await must(x.chain, x.cast, d.accept());
    }
    const nIn = inside(x.chain);
    const send = world.send.bind(world);
    world.send = async (tx, s) => {
      // A block passes between the node's simulation and its send, as on a live chain.
      if (tx.to.toLowerCase() === world.deployment.rules.toLowerCase()) await world.rpc('evm_mine', []);
      return send(tx, s);
    };
    // The node runs on a live chain's path (wall clock), where a revert after a passing simulation is answered, not thrown.
    const frozen = Date.parse(x.chain.now());
    nIn.wall = () => frozen;
    let first: Awaited<ReturnType<typeof submit>>;
    let second: Awaited<ReturnType<typeof submit>>;
    try {
      first = await submit(x, await a.agreeAndFund());
      // Past K the wallet says yes again: its next agreement passes the check, and only the strike refuses the funding.
      await world.rpc('evm_mine', []);
      second = await submit(x, await b.agreeAndFund());
    } finally {
      world.send = send;
      delete nIn.wall;
    }
    expect(first.ok ? 'ok' : first.problem.type).toBe('invalid_state');
    // Only the wallet is struck: the seller's own signature holds at that block.
    expect([...(nIn.struck?.keys() ?? [])]).toEqual([wallet.toLowerCase()]);
    expect(second.ok ? 'ok' : [second.problem.type, second.problem.detail]).toEqual(['relay_refused', expect.stringContaining(`a funding this operator relayed for ${wallet}`)]);
  }, 180_000);
});

// T-549 pull request 4 (ADR-0040 §4, §9): a standing seller's contract not deployed yet, on a local anvil (chain id
// 31337, 127.0.0.1 only). The seller's address is HoldbackStandingSeller's CREATE2 address for its key through the
// deterministic deployer at salt 0, with no code. The node checks a take against the code that address will have,
// deploys it alone just before the first funding, skips the deployment when the code is there, and deploys only for a
// seller it admits, within its budget. Also red team M2 of PR 715: a contract party is asked as the rules contract asks.
// Needs `anvil` on PATH and `forge build` output in contracts/out; skipped without.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { commitmentId, encodeStandingSignature, holdbackDomain, signMessage, TAKE, takeTerms, templateDigest, templateFrom, type Club, type Commitment, type CommitmentTerms, type Mandate, type StandingOffer, type TakeFill, type Timestamp, type TokenAmount, type UnsignedMessage } from '@holdback/core';
import { concat, getContractAddress, keccak256, size, stringToBytes, toHex, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Submission } from '../src/interface.js';
import { EvmSettlement } from './evm-settlement.js';
import { must } from './gas.js';
import { CREATE2_DEPLOYER, standingDeployment, standingSellerAddress } from './standing-seller.js';
import { EvmDeal, evmCast, evmGenesis, testActor, type EvmCast, type TestActor } from './testing.js';
import { anvilAvailable, EvmWorld } from './world.js';

const root = join(import.meta.dirname, '..', '..', '..');
const ready = anvilAvailable() && existsSync(join(root, 'contracts', 'out', 'HoldbackRules.sol', 'HoldbackRules.json'));
const START = '2026-01-01T00:00:00Z';

/** A wallet's runtime that answers ERC-1271 yes when `cond` (EVM opcodes leaving 1 or 0) holds, whatever the signature. */
const walletCode = (cond: Hex): Hex => concat([cond, '0x631626ba7e0260e01b60005260206000f3']);
/** Init code that returns `runtime`. */
const initOf = (runtime: Hex): Hex => concat([`0x60${size(runtime).toString(16).padStart(2, '0')}80600b6000396000f3`, runtime]);

interface Setup {
  chain: EvmSettlement;
  cast: EvmCast;
  club: Club;
  /** The seller's standing contract, not deployed. */
  seller: Address;
  /** A second key's seller contract, for the budget. */
  other: { key: TestActor; seller: Address };
}

describe.skipIf(!ready)(`a standing seller's contract not yet deployed, on anvil (T-549)${ready ? '' : ' (SKIPPED: needs anvil on PATH and forge build output in contracts/out)'}`, () => {
  let world: EvmWorld;
  beforeAll(async () => {
    world = await EvmWorld.start(root);
  }, 60_000);
  afterAll(async () => {
    await world?.stop();
  });

  /** A settlement whose genesis admits the two seller contracts by mandate, and `extra` agents beside them. */
  async function setup(extra: Address[] = [], sellerMandateExpiresAt = '2027-01-01T00:00:00Z'): Promise<Setup> {
    const cast = evmCast();
    const token = world.deployment.token.toLowerCase();
    const { genesis, club } = await evmGenesis({ cast, token, chainId: world.chainId, rules: world.deployment.rules, start: START, buyer: 100_000_000_000n });
    const big = { token, amount: '1000000000000000' } as TokenAmount;
    const domain = holdbackDomain(world.chainId, world.deployment.rules);
    const otherKey = testActor('second-standing-key');
    const seller = standingSellerAddress(cast.seller.address);
    const other = { key: otherKey, seller: standingSellerAddress(otherKey.address) };
    const mandates: Mandate[] = [];
    for (const [i, agent] of [seller, other.seller, ...extra].entries()) {
      const principal = testActor(`first-take-principal-${i}`);
      const body = { principal: principal.address, agent, clubId: club.id, scope: { roles: ['buyer', 'seller'], maxPerCommitment: big, maxDaily: big, expiresAt: i === 0 ? sellerMandateExpiresAt : '2027-01-01T00:00:00Z' }, nonce: keccak256(stringToBytes(`first-take/${i}`)), issuedAt: START } as Omit<Mandate, 'signature'>;
      mandates.push({ ...body, signature: await signMessage(principal.key, domain, { ...body, type: 'Mandate' } as UnsignedMessage) } as Mandate);
    }
    const chain = await EvmSettlement.create(world, { ...genesis, mandates: [...genesis.mandates, ...mandates] }, Object.values(cast).map((a) => a.address));
    expect(await world.publicClient.getCode({ address: CREATE2_DEPLOYER })).not.toBe(undefined);
    expect(await world.publicClient.getCode({ address: seller })).toBe(undefined);
    return { chain, cast, club, seller, other };
  }

  const submit = (x: Setup, s: Submission) => x.chain.submit(s, { via: 'op-1', sender: x.cast.operator.key });
  const txCount = () => world.publicClient.getTransactionCount({ address: evmCast().operator.address });
  const codeAt = async (a: Address) => (await world.publicClient.getCode({ address: a })) ?? '0x';
  const at = (x: Setup) => world.rpc('evm_setNextBlockTimestamp', [Math.floor(Date.parse(x.chain.now()) / 1000)]);

  /** A take by the cast's buyer of a template `key` signed for `seller` (ADR-0040 §1). */
  async function take(x: Setup, tag: string, o: { key?: TestActor; seller?: Address; template?: (t: StandingOffer) => StandingOffer; createdAt?: Timestamp } = {}) {
    const key = o.key ?? x.cast.seller;
    const seller = o.seller ?? x.seller;
    const draft = new EvmDeal(x.chain, x.cast, x.club, tag, undefined, undefined, undefined, { seller, sellerPayoutAddress: x.cast.seller.address });
    const made = templateFrom(draft.terms, { rules: world.deployment.rules, expiresAt: new Date(Date.parse(draft.terms.createdAt) + 86_400_000).toISOString().replace('.000Z', 'Z') as Timestamp, offerId: `offer/${tag}` });
    const template = o.template ? o.template(made) : made;
    const fill: TakeFill = { buyer: draft.terms.buyer, buyerPaymentAddress: draft.terms.buyerPaymentAddress, buyerEncryptionPublicKey: draft.terms.buyerEncryptionPublicKey, nonceSeed: keccak256(stringToBytes(`seed/${tag}`)), createdAt: o.createdAt ?? draft.terms.createdAt };
    const terms = takeTerms(template, fill, seller);
    const deal = new EvmDeal(x.chain, x.cast, x.club, tag, undefined, undefined, undefined, { seller, sellerPayoutAddress: x.cast.seller.address, nonce: terms.nonce });
    if (!o.createdAt) expect(deal.terms).toEqual(terms);
    const keySignature = await privateKeyToAccount(key.key).sign({ hash: templateDigest(template, seller, world.chainId) });
    const blob = encodeStandingSignature(TAKE, template, keySignature, fill);
    const offer = (over: Partial<CommitmentTerms> = {}): Submission => {
      const t = { ...terms, ...over };
      return { kind: 'offer', commitment: { ...t, id: commitmentId(t), signatures: { seller: blob } } as Commitment };
    };
    return { deal, terms, blob, offer, key };
  }

  /** Sends `data` from `actor` as a plain transaction at the scenario's second (a party acting on the chain itself). */
  async function direct(x: Setup, actor: TestActor, to: Address | undefined, data: Hex): Promise<{ status: string; contractAddress?: Address | null }> {
    await at(x);
    const w = world.wallet(actor.key);
    const hash = await w.sendTransaction({ account: w.account!, chain: foundry, ...(to ? { to } : {}), data, gas: 3_000_000n });
    const r = await world.receipt(hash);
    return { status: r.status, contractAddress: r.contractAddress ?? null };
  }

  it('a take of a contract not yet deployed is checked against its planned code, deployed alone before the funding, and settled by the primary', async () => {
    const x = await setup();
    const t = await take(x, 'first-take');
    const before = await txCount();
    await must(x.chain, x.cast, t.offer());
    await must(x.chain, x.cast, t.deal.accept());
    // Nothing is sent before the funding: the offer and the acceptance are off chain, and the address still has no code.
    expect(await txCount()).toBe(before);
    expect(await codeAt(x.seller)).toBe('0x');
    await must(x.chain, x.cast, t.deal.agreeAndFund());
    // Two transactions: the deployment alone, then the funding.
    expect(await txCount()).toBe(before + 2);
    expect(size(await codeAt(x.seller))).toBeGreaterThan(9_000);
    expect((await x.chain.stage(t.deal.id)).stage).toBe('Held');
    await must(x.chain, x.cast, t.deal.deliver());
    await must(x.chain, x.cast, t.deal.decide('primary', 'accept'));
    expect((await x.chain.stage(t.deal.id)).stage).toBe('Released');
    expect(await x.chain.tokenBalance(x.cast.seller.address)).toBe(BigInt(t.terms.price.amount));
    expect(await x.chain.tokenBalance(x.seller)).toBe(0n);
    expect(await x.chain.replayCheck()).toMatchObject({ ok: true });
  }, 120_000);

  it('attack.take-changes-a-fixed-field before deployment: a changed field, another key or another contract is refused with no transaction', async () => {
    const x = await setup();
    const t = await take(x, 'first-changed');
    const before = await txCount();
    for (const over of [{ price: { ...t.terms.price, amount: '1' } as TokenAmount }, { sellerPayoutAddress: x.cast.stranger.address }, { buyerEncryptionPublicKey: 'changed-key' }]) {
      const r = await submit(x, t.offer(over));
      expect(r.ok ? 'ok' : [r.problem.type, r.problem.detail]).toEqual(['invalid_signature', 'the seller did not sign these terms']);
    }
    // A template signed by another key for this address: that key's CREATE2 address is another, so no planned code.
    const forged = await take(x, 'first-forged', { key: x.other.key });
    const r = await submit(x, forged.offer());
    expect(r.ok ? 'ok' : r.problem.type).toBe('invalid_signature');
    expect(await txCount()).toBe(before);
    await must(x.chain, x.cast, t.offer());
  }, 120_000);

  it('a take dated after the chain\'s time is refused naming the time, not as an unsigned offer', async () => {
    const x = await setup();
    const ahead = new Date(Date.parse(x.chain.now()) + 60_000).toISOString().replace('.000Z', 'Z') as Timestamp;
    const t = await take(x, 'dated-ahead', { createdAt: ahead });
    const r = await submit(x, t.offer());
    expect(r.ok ? 'ok' : [r.problem.type, r.problem.detail]).toEqual(['invalid_signature', expect.stringMatching(/^the seller contract approves a take only from its createdAt on, and this take's createdAt \S+ is after the chain's newest block time \S+; date the take at or before/)]);
  }, 120_000);

  it('attack.deployment-gas-drain: first takes of two sellers at once stay within a budget of one deployment a day', async () => {
    const x = await setup();
    x.chain.deployBudget = { perDay: 1, maxGas: 25_000_000n };
    const a = await take(x, 'budget-race-a');
    const b = await take(x, 'budget-race-b', { key: x.other.key, seller: x.other.seller });
    for (const t of [a, b]) {
      await must(x.chain, x.cast, t.offer());
      await must(x.chain, x.cast, t.deal.accept());
    }
    const before = await txCount();
    const results = await Promise.all([submit(x, await a.deal.agreeAndFund()), submit(x, await b.deal.agreeAndFund())]);
    expect(results.map((r) => (r.ok ? 'ok' : r.problem.type)).sort()).toEqual(['ok', 'relay_refused']);
    expect(await txCount()).toBe(before + 2);
    expect([await codeAt(x.seller), await codeAt(x.other.seller)].filter((c) => c !== '0x')).toHaveLength(1);
  }, 120_000);

  it('attack.deployment-gas-drain: no deployment for a seller whose mandate expired between the offer and the funding', async () => {
    const x = await setup([], new Date(Date.parse(START) + 120_000).toISOString().replace('.000Z', 'Z'));
    const t = await take(x, 'mandate-expires');
    await must(x.chain, x.cast, t.offer());
    await must(x.chain, x.cast, t.deal.accept());
    x.chain.advance(180);
    const before = await txCount();
    const r = await submit(x, await t.deal.agreeAndFund());
    expect(r.ok ? 'ok' : [r.problem.type, r.problem.detail]).toEqual(['relay_refused', expect.stringMatching(/^this operator deploys a seller contract only for a seller it admits/)]);
    expect(await txCount()).toBe(before);
    expect(await codeAt(x.seller)).toBe('0x');
  }, 120_000);

  it('neutrality.deploy-front-run-take-still-funds: a deployment someone made first is skipped; two first takes close together deploy once', async () => {
    const x = await setup();
    const a = await take(x, 'race-a');
    const b = await take(x, 'race-b');
    for (const t of [a, b]) {
      await must(x.chain, x.cast, t.offer());
      await must(x.chain, x.cast, t.deal.accept());
    }
    const before = await txCount();
    // Both funded at once: the node deploys once, the other funding waits for it and finds the code.
    const [ra, rb] = await Promise.all([submit(x, await a.deal.agreeAndFund()), submit(x, await b.deal.agreeAndFund())]);
    expect([ra.ok ? 'ok' : ra.problem.detail, rb.ok ? 'ok' : rb.problem.detail]).toEqual(['ok', 'ok']);
    expect(await txCount()).toBe(before + 3);
    for (const t of [a, b]) expect((await x.chain.stage(t.deal.id)).stage).toBe('Held');

    // The other seller's contract, deployed by the buyer before the funding reaches the node: no deployment is sent.
    const y = await setup();
    const c = await take(y, 'front-run');
    await must(y.chain, y.cast, c.offer());
    await must(y.chain, y.cast, c.deal.accept());
    expect((await direct(y, y.cast.buyer, standingDeployment(y.cast.seller.address).to, standingDeployment(y.cast.seller.address).data)).status).toBe('success');
    const from = await txCount();
    await must(y.chain, y.cast, c.deal.agreeAndFund());
    expect(await txCount()).toBe(from + 1);
    expect((await y.chain.stage(c.deal.id)).stage).toBe('Held');
  }, 180_000);

  it("neutrality.deploy-front-run-take-still-funds: a deployment that lands between the node's read and its own costs one failed deployment, and the funding goes", async () => {
    const x = await setup();
    const t = await take(x, 'front-run-late');
    await must(x.chain, x.cast, t.offer());
    await must(x.chain, x.cast, t.deal.accept());
    // The node's deployment is preceded by the buyer's own, mined first: the node's then reverts, as a second CREATE2 does.
    const send = world.send.bind(world);
    let raced = 0;
    world.send = async (tx, s) => {
      if (tx.to.toLowerCase() === CREATE2_DEPLOYER.toLowerCase() && raced++ === 0) expect((await direct(x, x.cast.buyer, tx.to, tx.data)).status).toBe('success');
      return send(tx, s);
    };
    try {
      const before = await txCount();
      await must(x.chain, x.cast, t.deal.agreeAndFund());
      expect(raced).toBe(1);
      // The node sent its deployment, which reverted, and the funding, which held.
      expect(await txCount()).toBe(before + 2);
      expect((await x.chain.stage(t.deal.id)).stage).toBe('Held');
    } finally {
      world.send = send;
    }
  }, 120_000);

  it('attack.deployment-gas-drain: no deployment for a seller without a mandate, past the budget, above its gas, or for a funding that would fail', async () => {
    // A seller contract this node does not admit: the take is refused at the offer, before any creation is simulated, and nothing is sent.
    const x = await setup();
    const unknownKey = testActor('unadmitted-standing-key');
    const stranger = await take(x, 'unadmitted', { key: unknownKey, seller: standingSellerAddress(unknownKey.address) });
    const before = await txCount();
    const r = await submit(x, stranger.offer());
    expect(r.ok ? 'ok' : [r.problem.type, r.problem.detail]).toEqual(['invalid_signature', expect.stringMatching(/^this operator reads a seller contract before its deployment only for a seller it admits by mandate/)]);
    expect(await txCount()).toBe(before);

    // The budget: one deployment a day. The first seller's take deploys; the second seller's is declined, with nothing sent.
    x.chain.deployBudget = { perDay: 1, maxGas: 25_000_000n };
    const first = await take(x, 'budget-1');
    const second = await take(x, 'budget-2', { key: x.other.key, seller: x.other.seller });
    for (const t of [first, second]) {
      await must(x.chain, x.cast, t.offer());
      await must(x.chain, x.cast, t.deal.accept());
    }
    await must(x.chain, x.cast, first.deal.agreeAndFund());
    const mid = await txCount();
    const over = await submit(x, await second.deal.agreeAndFund());
    expect(over.ok ? 'ok' : [over.problem.type, over.problem.detail]).toEqual(['relay_refused', expect.stringMatching(/^this operator deploys at most 1 standing sellers' contracts a day at its own gas and has deployed 1 today; deploy it yourself/)]);
    expect(await txCount()).toBe(mid);
    expect(await codeAt(x.other.seller)).toBe('0x');
    // The agreement is taken back: the same signed funding goes once the seller is deployed by someone else.
    expect((await x.chain.state(second.deal.id))!.escrowState).toBe('AcceptedByAdjudicator');

    // Above the gas a deployment may take: declined, nothing sent.
    x.chain.deployBudget = { perDay: 20, maxGas: 100_000n };
    const tooMuch = await submit(x, await second.deal.agreeAndFund());
    expect(tooMuch.ok ? 'ok' : [tooMuch.problem.type, tooMuch.problem.detail]).toEqual(['relay_refused', expect.stringMatching(/^the seller contract's deployment needs about \d+ gas, above this operator's budget of 100000 gas for one/)]);
    expect(await txCount()).toBe(mid);

    // A funding the contract would refuse (a payment address holding nothing): refused by the simulation with the
    // planned code, before any deployment.
    const y = await setup();
    y.chain.deployBudget = { perDay: 20, maxGas: 25_000_000n };
    const broke = await take(y, 'broke');
    await must(y.chain, y.cast, broke.offer());
    await must(y.chain, y.cast, broke.deal.accept());
    const all = await y.chain.tokenBalance(y.cast.buyer.address);
    await direct(y, y.cast.buyer, world.deployment.token, concat(['0xa9059cbb', toHex(BigInt(y.cast.stranger.address), { size: 32 }), toHex(all, { size: 32 })]));
    const start = await txCount();
    const refused = await submit(y, await broke.deal.agreeAndFund());
    expect(refused.ok).toBe(false);
    expect(await txCount()).toBe(start);
    expect(await codeAt(y.seller)).toBe('0x');
  }, 180_000);

  it('neutrality.crow-deploys-nothing: an operator that deploys nothing declines, the buyer deploys the contract itself, and the same take funds and settles', async () => {
    const x = await setup();
    x.chain.deployBudget = { perDay: 0, maxGas: 25_000_000n };
    const t = await take(x, 'no-crow-deploy');
    await must(x.chain, x.cast, t.offer());
    await must(x.chain, x.cast, t.deal.accept());
    const before = await txCount();
    const funding = await t.deal.agreeAndFund();
    const r = await submit(x, funding);
    expect(r.ok ? 'ok' : [r.problem.type, r.problem.detail]).toEqual(['relay_refused', expect.stringContaining(`deploy it yourself, one transaction to ${CREATE2_DEPLOYER} that anyone may send`)]);
    expect(await txCount()).toBe(before);
    // The buyer sends the deployment from its own account: one public transaction, no operator, no Crow key.
    const dep = standingDeployment(x.cast.seller.address);
    expect((await direct(x, x.cast.buyer, dep.to, dep.data)).status).toBe('success');
    expect(await codeAt(x.seller)).not.toBe('0x');
    await must(x.chain, x.cast, funding);
    expect(await txCount()).toBe(before + 1);
    await must(x.chain, x.cast, t.deal.deliver());
    await must(x.chain, x.cast, t.deal.decide('primary', 'accept'));
    expect((await x.chain.stage(t.deal.id)).stage).toBe('Released');
  }, 120_000);

  it("red team M2 of PR 715: a contract party is asked as the rules contract asks, at a gas price above 0", async () => {
    // Two contract buyers whose answer depends only on how they are asked (no key): yes only at gas price 0, and yes
    // only to the rules contract. Deployed through the deterministic deployer, so their addresses follow from the code.
    const codes = [walletCode('0x3a15'), walletCode(concat(['0x3373', world.deployment.rules, '0x14']))];
    const salt = `0x${'00'.repeat(32)}` as Hex;
    const [zeroPrice, onlyRules] = codes.map((c) => getContractAddress({ opcode: 'CREATE2', from: CREATE2_DEPLOYER, salt, bytecode: initOf(c) })) as [Address, Address];
    const x = await setup([zeroPrice, onlyRules]);
    for (const c of codes) expect((await direct(x, x.cast.stranger, CREATE2_DEPLOYER, concat([salt, initOf(c)]))).status).toBe('success');
    expect(await codeAt(zeroPrice)).toBe(codes[0]);
    const dealFor = (buyer: Address, tag: string) => new EvmDeal(x.chain, x.cast, x.club, tag, undefined, undefined, { payment: x.cast.buyer, payout: x.cast.seller.address }, { buyer });
    // Yes only at gas price 0: the node asks at the relay's gas price and refuses it before any transaction.
    const a = dealFor(zeroPrice, 'm2-zero-price');
    await must(x.chain, x.cast, a.offer());
    await must(x.chain, x.cast, a.accept());
    const before = await txCount();
    const r = await submit(x, await a.agreeAndFund());
    expect(r.ok ? 'ok' : [r.problem.type, r.problem.detail]).toEqual(['invalid_signature', `Agree signature does not recover to ${zeroPrice}`]);
    expect(await txCount()).toBe(before);
    // Yes only to the rules contract, as the chain asks: the node now reads it as the chain does, and the deal funds.
    const b = dealFor(onlyRules, 'm2-only-rules');
    await must(x.chain, x.cast, b.offer());
    await must(x.chain, x.cast, b.accept());
    await must(x.chain, x.cast, b.agreeAndFund());
    expect((await x.chain.stage(b.id)).stage).toBe('Held');
  }, 120_000);
});

// T-549 (ADR-0040 §5, D84): the EVM node reads a buyer and a seller that are contracts, on a local anvil (chain id
// 31337, 127.0.0.1 only). A contract buyer is SwitchWallet, the test ERC-1271 wallet (contracts/test/crosscheck/
// ContractSigners.sol), owned by the buyer's key; a contract seller is HoldbackStandingSeller (T-548) with the seller's
// key, and its offer is a take of a template that key signed. Each deal is accepted by the node's contract-signer rule
// and by the rules contract itself; a signed message with a changed field is refused before any transaction. Needs
// `anvil` on PATH and `forge build` output in contracts/out; skipped without.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { commitmentId, encodeStandingSignature, fillView, STANDING_DELIVERY, standingDeliveryFor, type StandingDeliveryBody, holdbackDomain, signMessage, standingOfferView, TAKE, takeTerms, templateDigest, templateFrom, templateHash, type Club, type StandingOffer, type TakeFill, type Timestamp, type CommitmentTerms, type Hex32, type Mandate, type TokenAmount, type UnsignedMessage } from '@holdback/core';
import { concat, encodeFunctionData, getContractAddress, keccak256, stringToBytes, type Abi, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Submission } from '../src/interface.js';
import { NO_DELIVERY, NO_KEY, mutualView, termsView } from './encode.js';
import { EvmSettlement } from './evm-settlement.js';
import { must } from './gas.js';
import { ChainSync } from './sync.js';
import { EvmDeal, evmCast, evmGenesis, testActor, type EvmCast } from './testing.js';
import { anvilAvailable, artifact, EvmWorld } from './world.js';

const root = join(import.meta.dirname, '..', '..', '..');
const out = (file: string, name: string) => join(root, 'contracts', 'out', file, `${name}.json`);
const ready =
  anvilAvailable() &&
  existsSync(out('HoldbackRules.sol', 'HoldbackRules')) &&
  existsSync(out('HoldbackStandingSeller.sol', 'HoldbackStandingSeller')) &&
  existsSync(out("ContractSigners.sol", "SwitchWallet"));

const START = '2026-01-01T00:00:00Z';
/** Anvil's second funded account deploys the test contracts: its nonce is 0 after every fresh settlement. */
const CONTRACTS_KEY: Hex = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const contractsDeployer = privateKeyToAccount(CONTRACTS_KEY).address;
const WALLET = getContractAddress({ from: contractsDeployer, nonce: 0n });
const SELLER_CONTRACT = getContractAddress({ from: contractsDeployer, nonce: 1n });
/** A forwarder that calls the address in its calldata's first 20 bytes with the rest (sync.test.ts): a call this node cannot read. */
const FORWARDER_CODE: Hex = '0x601c8060095f395ff35f5f601436038060145f375f5f5f3560601c5af1601a575f5ffd5b00';
const FORWARDER = getContractAddress({ from: contractsDeployer, nonce: 2n });

interface Setup {
  chain: EvmSettlement;
  cast: EvmCast;
  club: Club;
  sellerAbi: Abi;
  walletAbi: Abi;
}

describe.skipIf(!ready)(`contract signers on anvil (T-549)${ready ? '' : ' (SKIPPED: needs anvil on PATH and forge build output in contracts/out)'}`, () => {
  let world: EvmWorld;
  beforeAll(async () => {
    world = await EvmWorld.start(root);
  }, 60_000);
  afterAll(async () => {
    await world?.stop();
  });

  /** A settlement whose genesis holds a mandate for the wallet and the seller contract, then the two contracts and the forwarder. */
  async function setup(): Promise<Setup> {
    const cast = evmCast();
    const token = world.deployment.token.toLowerCase();
    const { genesis, club } = await evmGenesis({ cast, token, chainId: world.chainId, rules: world.deployment.rules, start: START, buyer: 100_000_000_000n });
    const big = { token, amount: '1000000000000000' } as TokenAmount;
    const domain = holdbackDomain(world.chainId, world.deployment.rules);
    const mandates: Mandate[] = [];
    for (const [name, agent] of [['wallet', WALLET], ['standing-seller', SELLER_CONTRACT]] as const) {
      const principal = testActor(`${name}-principal`);
      const body = { principal: principal.address, agent, clubId: club.id, scope: { roles: ['buyer', 'seller'], maxPerCommitment: big, maxDaily: big, expiresAt: '2027-01-01T00:00:00Z' }, nonce: keccak256(stringToBytes(`mandate/${name}`)), issuedAt: START } as Omit<Mandate, 'signature'>;
      mandates.push({ ...body, signature: await signMessage(principal.key, domain, { ...body, type: 'Mandate' } as UnsignedMessage) } as Mandate);
    }
    const chain = await EvmSettlement.create(world, { ...genesis, mandates: [...genesis.mandates, ...mandates] }, Object.values(cast).map((a) => a.address));
    const wallet = artifact(root, 'ContractSigners.sol', 'SwitchWallet');
    const seller = artifact(root, 'HoldbackStandingSeller.sol', 'HoldbackStandingSeller');
    const w = world.wallet(CONTRACTS_KEY);
    // Each block at the scenario's second, so the settlement's clock never falls behind the chain's.
    const at = () => world.rpc('evm_setNextBlockTimestamp', [Math.floor(Date.parse(chain.now()) / 1000)]);
    for (const [a, args] of [[wallet, [cast.buyer.address]], [seller, [cast.seller.address]]] as const) {
      await at();
      const hash = await w.deployContract({ abi: a.abi, bytecode: a.bytecode, args, account: w.account!, chain: foundry } as Parameters<typeof w.deployContract>[0]);
      expect((await world.receipt(hash)).status).toBe('success');
    }
    await at();
    const fwd = await w.sendTransaction({ account: w.account!, chain: foundry, data: FORWARDER_CODE });
    expect((await world.receipt(fwd)).contractAddress?.toLowerCase()).toBe(FORWARDER.toLowerCase());
    expect((await world.publicClient.getCode({ address: WALLET }))?.length).toBeGreaterThan(2);
    expect((await world.publicClient.getCode({ address: SELLER_CONTRACT }))?.length).toBeGreaterThan(2);
    return { chain, cast, club, sellerAbi: seller.abi, walletAbi: wallet.abi };
  }

  const submit = (chain: EvmSettlement, cast: EvmCast, s: Submission) => chain.submit(s, { via: 'op-1', sender: cast.operator.key });
  const txCount = () => world.publicClient.getTransactionCount({ address: evmCast().operator.address });

  /** A deal whose buyer is the wallet; the buyer's key signs for it, and its payment address is the buyer's own key. */
  const walletDeal = (x: Setup, tag: string) => new EvmDeal(x.chain, x.cast, x.club, tag, undefined, undefined, { payment: x.cast.buyer, payout: x.cast.seller.address }, { buyer: WALLET });

  /**
   * A take of a template the seller's key signed for the seller contract (ADR-0040 §1): the template is the deal's terms
   * without the take's five fields, with the dates as offsets from createdAt; the nonce is derived from the template.
   */
  async function take(x: Setup, tag: string, withDelivery?: StandingDeliveryBody): Promise<{ deal: EvmDeal; blob: Hex; terms: CommitmentTerms; template: StandingOffer; fill: TakeFill; keySignature: Hex }> {
    const draft = new EvmDeal(x.chain, x.cast, x.club, tag, undefined, undefined, undefined, { seller: SELLER_CONTRACT, sellerPayoutAddress: x.cast.seller.address });
    const template = templateFrom(draft.terms, { rules: world.deployment.rules, expiresAt: new Date(Date.parse(draft.terms.createdAt) + 86_400_000).toISOString().replace('.000Z', 'Z') as Timestamp, offerId: `offer/${tag}`, ...(withDelivery ? { delivery: withDelivery } : {}) });
    const fill: TakeFill = { buyer: draft.terms.buyer, buyerPaymentAddress: draft.terms.buyerPaymentAddress, buyerEncryptionPublicKey: draft.terms.buyerEncryptionPublicKey, nonceSeed: keccak256(stringToBytes(`seed/${tag}`)), createdAt: draft.terms.createdAt };
    const terms = takeTerms(template, fill, SELLER_CONTRACT);
    const deal = new EvmDeal(x.chain, x.cast, x.club, tag, undefined, undefined, undefined, { seller: SELLER_CONTRACT, sellerPayoutAddress: x.cast.seller.address, nonce: terms.nonce });
    expect(deal.terms).toEqual(terms);
    // The differential check of ADR-0040 §5: the contract's template hash and its own terms for the take equal core's.
    const read = <T>(functionName: string, args: unknown[]) => world.publicClient.readContract({ address: SELLER_CONTRACT, abi: x.sellerAbi, functionName, args }) as Promise<T>;
    expect(await read<Hex32>('templateHash', [standingOfferView(template)])).toBe(templateHash(template));
    expect(await read<Hex32>('commitmentId', [await read('termsOf', [standingOfferView(template), fillView(fill)])])).toBe(commitmentId(terms));
    const keySignature = await privateKeyToAccount(x.cast.seller.key).sign({ hash: templateDigest(template, SELLER_CONTRACT, world.chainId) });
    return { deal, blob: encodeStandingSignature(TAKE, template, keySignature, fill), terms, template, fill, keySignature };
  }

  const takeOffer = (t: { deal: EvmDeal; blob: Hex; terms: CommitmentTerms }, over: Partial<CommitmentTerms> = {}): Submission => {
    const terms = { ...t.terms, ...over };
    return { kind: 'offer', commitment: { ...terms, id: commitmentId(terms), signatures: { seller: t.blob } } };
  };

  it('a take of a standing offer is read through ERC-1271, accepted, funded, delivered with the key and settled by the primary', async () => {
    const x = await setup();
    const t = await take(x, 'take-happy');
    expect(t.blob.length).toBeGreaterThan(132);
    await must(x.chain, x.cast, takeOffer(t));
    await must(x.chain, x.cast, t.deal.accept());
    await must(x.chain, x.cast, t.deal.agreeAndFund());
    expect((await x.chain.stage(t.deal.id)).stage).toBe('Held');
    // The seller's key signs the delivery, and the contract approves its 65-byte signature (the key path).
    const sub = await t.deal.deliver();
    if (sub.kind !== 'deliver') throw new Error('unreachable');
    expect(await x.chain.carryDelivery(sub.delivery)).toBeNull();
    x.chain.advance(1);
    await must(x.chain, x.cast, t.deal.decide('primary', 'accept'));
    expect((await x.chain.stage(t.deal.id)).stage).toBe('Released');
    expect(await x.chain.tokenBalance(x.cast.seller.address)).toBe(BigInt(t.deal.terms.price.amount));
    expect(await x.chain.tokenBalance(SELLER_CONTRACT)).toBe(0n);
    expect(await x.chain.replayCheck()).toMatchObject({ ok: true });
  }, 120_000);

  it('attack.take-changes-a-fixed-field: a take with a changed price, payout address or adjudicator is refused before any transaction', async () => {
    const x = await setup();
    const t = await take(x, 'take-changed');
    const before = await txCount();
    for (const over of [
      { price: { ...t.terms.price, amount: '1' } as TokenAmount },
      { sellerPayoutAddress: x.cast.stranger.address },
      { adjudication: { ...t.terms.adjudication, adjudicator: x.cast.stranger.address } },
      { buyerEncryptionPublicKey: 'changed-key' },
    ]) {
      const r = await submit(x.chain, x.cast, takeOffer(t, over));
      expect(r.ok ? 'ok' : [r.problem.type, r.problem.detail]).toEqual(['invalid_signature', 'the seller did not sign these terms']);
    }
    expect(await txCount()).toBe(before);
    expect(await x.chain.state(t.deal.id)).toBeNull();
    // The unchanged take is still good.
    await must(x.chain, x.cast, takeOffer(t));
  }, 120_000);

  it('neutrality.standing-seller-refund-by-agreement: the seller contract approves its key\'s signature on a full refund, and the node relays it', async () => {
    const x = await setup();
    const t = await take(x, 'take-refund');
    await must(x.chain, x.cast, takeOffer(t));
    await must(x.chain, x.cast, t.deal.accept());
    await must(x.chain, x.cast, t.deal.agreeAndFund());
    const payment = await x.chain.tokenBalance(x.cast.buyer.address);
    await must(x.chain, x.cast, t.deal.mutual(0n, false));
    expect((await x.chain.stage(t.deal.id)).stage).toBe('Settled');
    expect(await x.chain.tokenBalance(x.cast.buyer.address)).toBe(payment + BigInt(t.deal.terms.price.amount) + BigInt(t.deal.terms.adjudication.fee.amount));
  }, 120_000);

  it('a contract buyer: the wallet agrees, accepts early and is paid back by agreement, each read through ERC-1271', async () => {
    const x = await setup();
    const d = walletDeal(x, 'wallet-early');
    await must(x.chain, x.cast, d.offer());
    await must(x.chain, x.cast, d.accept());
    await must(x.chain, x.cast, d.agreeAndFund());
    expect((await x.chain.stage(d.id)).stage).toBe('Held');
    await must(x.chain, x.cast, d.deliver());
    await must(x.chain, x.cast, d.earlyAccept());
    expect((await x.chain.stage(d.id)).stage).toBe('Released');
    expect(await x.chain.keysFor(d.id, WALLET)).toHaveLength(1);

    const r = walletDeal(x, 'wallet-refund');
    await must(x.chain, x.cast, r.offer());
    await must(x.chain, x.cast, r.accept());
    await must(x.chain, x.cast, r.agreeAndFund());
    await must(x.chain, x.cast, r.mutual(0n, false));
    expect((await x.chain.stage(r.id)).stage).toBe('Settled');
  }, 120_000);

  it("a contract buyer's agreement with a changed field, or a wallet that answers no, is refused before any transaction", async () => {
    const x = await setup();
    const d = walletDeal(x, 'wallet-changed');
    await must(x.chain, x.cast, d.offer());
    await must(x.chain, x.cast, d.accept());
    const s = await d.agreeAndFund();
    if (s.kind !== 'agree_and_fund') throw new Error('unreachable');
    const before = await txCount();
    const changed = await submit(x.chain, x.cast, { ...s, agree: { ...s.agree, expiresAt: d.terms.timing.fundBy } });
    expect(changed.ok ? 'ok' : changed.problem.type).toBe('invalid_signature');
    // The wallet stops approving (a wrong magic value): the same agreement is refused; honest again, it funds.
    const w = world.wallet(CONTRACTS_KEY);
    const mode = async (m: number) => {
      await world.rpc('evm_setNextBlockTimestamp', [Math.floor(Date.parse(x.chain.now()) / 1000)]);
      expect((await world.receipt(await w.writeContract({ address: WALLET, abi: x.walletAbi, functionName: 'setMode', args: [m], account: w.account!, chain: foundry }))).status).toBe('success');
    };
    await mode(1);
    const refused = await submit(x.chain, x.cast, s);
    expect(refused.ok ? 'ok' : refused.problem.type).toBe('invalid_signature');
    expect(await txCount()).toBe(before);
    expect((await x.chain.stage(d.id)).stage).toBe('None');
    await mode(0);
    await must(x.chain, x.cast, s);
    expect((await x.chain.stage(d.id)).stage).toBe('Held');
  }, 120_000);

  it("residual 13: a contract buyer's settlement sent through another contract is read at its block and followed, not left behind", async () => {
    const x = await setup();
    const sync = new ChainSync(x.chain);
    await sync.pass();
    const d = walletDeal(x, 'wallet-forwarded');
    await must(x.chain, x.cast, d.offer());
    await must(x.chain, x.cast, d.accept());
    await must(x.chain, x.cast, d.agreeAndFund());
    await sync.pass();
    const s = await d.mutual(0n, false);
    if (s.kind !== 'mutual_settle') throw new Error('unreachable');
    const call = encodeFunctionData({ abi: world.abis.rules, functionName: 'mutualSettle', args: [termsView(d.terms), mutualView(s.message), NO_DELIVERY, NO_KEY] });
    const sent = await world.send({ key: x.cast.stranger.key, to: FORWARDER, data: concat([world.deployment.rules, call]) }, Math.floor(Date.parse(x.chain.now()) / 1000) + 1);
    expect(sent.status).toBe('success');
    expect(await sync.pass()).toMatchObject({ applied: 1, behind: 0 });
    expect(x.chain.escrowState(d.id)?.kind).toBe('Settled');
  }, 120_000);

  it('attack.follower-signer-read-fails-open: a key parties\' settlement sent through another contract is followed while every code read fails', async () => {
    const x = await setup();
    const sync = new ChainSync(x.chain);
    await sync.pass();
    const d = new EvmDeal(x.chain, x.cast, x.club, 'keys-forwarded');
    await must(x.chain, x.cast, d.offer());
    await must(x.chain, x.cast, d.accept());
    await must(x.chain, x.cast, d.agreeAndFund());
    await sync.pass();
    const s = await d.mutual(0n, false);
    if (s.kind !== 'mutual_settle') throw new Error('unreachable');
    const call = encodeFunctionData({ abi: world.abis.rules, functionName: 'mutualSettle', args: [termsView(d.terms), mutualView(s.message), NO_DELIVERY, NO_KEY] });
    expect((await world.send({ key: x.cast.stranger.key, to: FORWARDER, data: concat([world.deployment.rules, call]) }, Math.floor(Date.parse(x.chain.now()) / 1000) + 1)).status).toBe('success');
    // An RPC that refuses every code read (a 429): the keys' signatures recover, so no read is needed.
    const client = world.publicClient as { getCode: (...a: unknown[]) => Promise<unknown> };
    const getCode = client.getCode;
    client.getCode = async () => {
      throw Object.assign(new Error('HTTP request failed. Status: 429'), { name: 'HttpRequestError' });
    };
    try {
      expect(await sync.pass()).toMatchObject({ applied: 1, behind: 0 });
    } finally {
      client.getCode = getCode;
    }
    expect(x.chain.escrowState(d.id)?.kind).toBe('Settled');
  }, 120_000);
  it("neutrality.standing-delivery-carried-by-decision: a take's standing delivery, approved by the template alone, rides on the primary's accept and settles", async () => {
    const x = await setup();
    const c = x.cast;
    const file: StandingDeliveryBody = {
      ciphertext: { uri: 'sim://blobs/standing-file', sha256: `sha256:${'c'.repeat(64)}`, bytes: 100, cipher: 'aes-256-gcm' },
      plaintextSha256: `sha256:${'d'.repeat(64)}`,
      plaintextMime: 'text/csv',
      encryptedKeys: [c.primary.address, c.fallback.address, c.appeal.address].map((recipient) => ({ recipient, scheme: 'x25519-xsalsa20poly1305' as const, ciphertext: 'ZW52ZWxvcGU' })),
      submittedAt: '2026-01-01T00:00:00Z',
    };
    const t = await take(x, 'take-standing-file', file);
    await must(x.chain, c, takeOffer(t));
    await must(x.chain, c, t.deal.accept());
    await must(x.chain, c, t.deal.agreeAndFund());
    // Nobody holds the seller's key here: the standing delivery's signature is the template's (kind STANDING_DELIVERY).
    const d = { ...standingDeliveryFor(t.template, t.deal.id)!, signature: encodeStandingSignature(STANDING_DELIVERY, t.template, t.keySignature, t.fill) };
    expect(await x.chain.carryDelivery(d)).toBeNull();
    t.deal.delivery = d;
    x.chain.advance(1);
    await must(x.chain, c, t.deal.decide('primary', 'accept'));
    expect((await x.chain.stage(t.deal.id)).stage).toBe('Released');
    expect(await x.chain.tokenBalance(c.seller.address)).toBe(BigInt(t.deal.terms.price.amount));
  }, 120_000);
});

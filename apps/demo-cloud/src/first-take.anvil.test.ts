// T-549's done-when test (ADR-0040 §4, §9): a take of a standing seller whose contract is not deployed yet goes end to
// end through the demo world's operator and the reference adjudicator, on anvil. The seller's address is its key's
// CREATE2 address with no code; the faucet admits it by mandate. The buyer posts the take with its own signature over
// the terms, an outside reference adjudicator accepts it as primary, the buyer funds (the operator deploys the seller
// contract alone, then funds), the seller's key signs the delivery for its contract, and the primary's accept releases
// the price to the seller's payout address. A take with a changed price is refused before anything is relayed.
// Needs `anvil` on PATH and `forge build` output in contracts/out; elsewhere it skips and says why.
import { canonicalKeccak, commitmentId, encodeStandingSignature, holdbackDomain, signTerms, TAKE, takeTerms, templateDigest, templateFrom, type Address, type CommitmentTerms, type Hex32, type TakeFill, type Timestamp } from '@holdback/core';
import { CREATE2_DEPLOYER, LiveChain, standingSellerAddress, type DeploymentFile, type EvmSettlement } from '@holdback/settlement/live';
import { EvmWorld } from '@holdback/settlement/evm';
import { keccak256, size, stringToBytes, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { publicOfferTerms, verifyPrepared } from '../../../examples/verify.ts';
import { CSV, deploymentOf, ENV, lc, Outsider, party, PRICE, ready, RELAYER, root, serve, sleep, untilBoth, type J } from '../test/anvil.ts';
import { MemoryStorage, PublicWorld } from './index.js';

const CHECKS = [
  { id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] },
  { id: 'rows', type: 'row_count_range', required: true, min: 3, max: 3 },
];
const TIMING = { judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 0, appealDecideSec: 120 };
const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z') as Timestamp;

describe.skipIf(!ready)(`done-when for T-549: a first take of a seller contract not yet deployed, end to end on anvil${ready ? '' : ' (SKIPPED: needs anvil on PATH and forge build output in contracts/out)'}`, () => {
  let anvil: EvmWorld;
  let deployment: DeploymentFile;
  beforeAll(async () => {
    anvil = await EvmWorld.start(root, { blockTimeSec: 1, token: 'test-usdc' });
    deployment = deploymentOf(anvil);
  }, 120_000);
  afterAll(async () => {
    await anvil?.stop();
  });

  it('done-when (T-549): posted, accepted by the primary, funded after the operator deploys the seller contract alone, and Released to the payout address; a changed price is refused with nothing relayed', async () => {
    const storage = new MemoryStorage();
    const chain = new LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey: RELAYER, pollMs: 200, rebroadcastMs: 10_000, mintBatchMs: 200 });
    const errors: string[] = [];
    const world = await PublicWorld.open({ storage, env: ENV, live: { chain }, minWindowSec: 5, faucetPerClient: 100, onError: (e) => errors.push(e.message) });
    const { start } = (await storage.get<{ start: string }>('meta'))!;
    await anvil.fresh(canonicalKeccak({ sim: 'holdback/demo-cloud/v1', start }));
    const demo = await serve(world);
    const t0 = Date.now();
    const took: Record<string, number> = {};
    const lap = (name: string) => (took[name] = Math.round((Date.now() - t0) / 100) / 10);
    try {
      for (const end = Date.now() + 90_000; !world.ready() && Date.now() < end; ) await sleep(250);
      expect(world.ready()).toBe(true);
      const evm = world.chain as EvmSettlement;
      const read = anvil.publicClient;
      const d = (await (await fetch(`${demo.urls[0]}/.well-known/holdback.json`)).json()) as J;
      const [, fallback, appeal] = d.demo.adjudicators.map((a: J) => a.address as string);
      const outsider = new Outsider(world, demo.urls, 't-549/first-take-primary', { trusted: [fallback, appeal] });
      expect((await outsider.register(new Date(Date.now() - 120_000).toISOString().replace(/\.\d{3}Z$/, 'Z'))).status).toBe(200);

      // The seller: a key, its contract's address (no code), the key's address as payout. The buyer: a fresh key.
      const [b, s] = [party(demo.urls, deployment), party(demo.urls, deployment)];
      const key = s.agent.address as Address;
      const seller = lc(standingSellerAddress(key)) as Address;
      expect(await read.getCode({ address: CREATE2_DEPLOYER })).not.toBe(undefined);
      expect(await read.getCode({ address: seller })).toBe(undefined);
      await b.agent.call('POST', '/v1/faucet', { address: b.agent.address });
      // The faucet admits the seller contract by mandate; its tokens go to the buyer, who holds them already, so the
      // payout address starts at 0.
      await b.agent.call('POST', '/v1/faucet', { address: seller, paymentAddress: b.agent.address });
      expect(await evm.tokenBalance(key)).toBe(0n);
      lap('admitted');

      // The template, from terms the seller chose, signed once by its key for its contract (ADR-0040 §1, §5).
      const token = lc(deployment.token.address);
      // The take's createdAt: the newest block's second. The contract approves no take created after its block, and
      // settlement time runs ahead of the newest block by up to a block time.
      const createdAt = iso(Number((await read.getBlock()).timestamp) * 1000);
      const given = { template: 'checks-only', clubId: d.demo.clubId, seller, sellerPayoutAddress: key, buyer: { address: b.agent.address, encryptionPublicKey: b.agent.encryptionPublicKey }, adjudicators: { primary: outsider.address, fallback, appeal }, price: { token, amount: PRICE }, deliverable: { kind: 'dataset', description: 'customers.csv, one row per customer', format: 'text/csv' }, checks: CHECKS, timing: TIMING };
      const chosen = publicOfferTerms(given, await b.agent.registration(outsider.address), await b.agent.rulebookHash(d.demo.clubId), createdAt, keccak256(stringToBytes('t-549/chosen'))) as CommitmentTerms;
      const template = templateFrom(chosen, { rules: lc(deployment.rules) as Address, expiresAt: iso(Date.parse(createdAt) + 86_400_000), offerId: 't-549/first-take' });
      const keySignature = await privateKeyToAccount(s.key).sign({ hash: templateDigest(template, seller, anvil.chainId) });
      const domain = holdbackDomain(anvil.chainId, lc(deployment.rules) as Address);
      /** The buyer's take, posted with its own signature over the terms; `over` changes fields after the template. */
      const take = async (seed: string, over: Partial<CommitmentTerms> = {}) => {
        const fill: TakeFill = { buyer: b.agent.address as Address, buyerPaymentAddress: b.agent.address as Address, buyerEncryptionPublicKey: b.agent.encryptionPublicKey, nonceSeed: keccak256(stringToBytes(seed)), createdAt };
        const terms = { ...takeTerms(template, fill, seller), ...over } as CommitmentTerms;
        const id = commitmentId(terms);
        const body = { ...terms, id, signatures: { seller: encodeStandingSignature(TAKE, template, keySignature, fill), buyer: await signTerms(b.key, domain, terms) } };
        const res = await fetch(`${demo.urls[0]}/v1/commitments`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(body) });
        return { id, terms, status: res.status, body: (await res.json()) as J };
      };
      /** Every lane's transaction count: what the operator's relayer has sent. */
      const lanes = chain.secretsForTest().map((k) => privateKeyToAccount(k).address);
      const sent = async () => (await Promise.all(lanes.map((a) => read.getTransactionCount({ address: a, blockTag: 'pending' })))).reduce((x, y) => x + y, 0);

      // Assertion 3: a take with a changed price is refused naming the seller's signature, and nothing is sent for it.
      const quiet = await sent();
      const changed = await take('t-549/changed', { price: { token, amount: '1' } as CommitmentTerms['price'] });
      expect(changed.status).toBeGreaterThanOrEqual(400);
      expect([changed.status, String(changed.body.type).split('/').at(-1), changed.body.detail]).toEqual([401, 'invalid_signature', 'the seller did not sign these terms']);
      expect((await fetch(`${demo.urls[0]}/v1/commitments/${changed.id}`)).status).toBe(404);
      await sleep(1_500);
      expect(await sent()).toBe(quiet);
      lap('changed take refused');

      // The take itself: posted, Offered on both nodes, accepted by the outside primary.
      const t = await take('t-549/first');
      expect(t.status, JSON.stringify(t.body)).toBeLessThan(300);
      await untilBoth(b.agent, t.id, ['Offered'], 30_000);
      expect((await outsider.runOnce()).accepted).toContain(t.id);
      await untilBoth(b.agent, t.id, ['AcceptedByAdjudicator'], 30_000);
      expect(await read.getCode({ address: seller })).toBe(undefined);
      lap('posted and accepted');

      // Assertion 1: the funding. The deal's lane sends the deployment alone, then the funding.
      const lane = chain.senderFor(t.id);
      const [laneBefore, fromBlock] = [await read.getTransactionCount({ address: lane }), await read.getBlockNumber()];
      const fundStart = Date.now();
      const held = await b.agent.agreeAndFund(t.terms, 40_000_000n);
      expect(held.escrowState).toBe('Held');
      await untilBoth(b.agent, t.id, ['Held'], 60_000);
      const fundMs = Date.now() - fundStart;
      const code = await read.getCode({ address: seller });
      expect(size(code ?? '0x')).toBeGreaterThan(9_000);
      expect(await read.getTransactionCount({ address: lane })).toBe(laneBefore + 2);
      const toBlock = await read.getBlockNumber();
      const deploys: J[] = [];
      for (let n = fromBlock + 1n; n <= toBlock; n++) for (const tx of (await read.getBlock({ blockNumber: n, includeTransactions: true })).transactions) if (lc(tx.to ?? '') === lc(CREATE2_DEPLOYER)) deploys.push(tx);
      expect(deploys.map((x) => [lc(x.from), x.nonce])).toEqual([[lc(lane), laneBefore]]);
      const receipt = await read.getTransactionReceipt({ hash: deploys[0].hash as Hex });
      expect(receipt.status).toBe('success');
      lap('deployed and held');

      // The seller's key signs the delivery for its contract (the ERC-1271 key path), as any seller signs its own.
      const { prepared, intent } = await s.agent.prepareDelivery(t.terms, new TextEncoder().encode(CSV));
      const v = verifyPrepared(prepared, intent, seller, s.agent.domain, await s.agent.settlementNow());
      expect(v.toSign.map((x) => x.slot)).toEqual(['signature']);
      v.body.signature = await s.agent.account.signTypedData(v.toSign[0]!.typed);
      await s.agent.call('POST', v.path, v.body);
      await untilBoth(b.agent, t.id, ['Delivered'], 60_000);
      lap('delivered');

      // Assertion 2: the primary's accept releases the price to the payout address; the seller contract holds nothing.
      expect((await outsider.runOnce()).decided).toEqual([{ commitmentId: t.id, role: 'primary', outcome: 'accept' }]);
      await untilBoth(b.agent, t.id, ['Released'], 60_000);
      expect(await evm.tokenBalance(key)).toBe(BigInt(PRICE));
      expect(await evm.tokenBalance(seller)).toBe(0n);
      expect(await b.agent.openDelivery(t.id as Hex32)).toBe(CSV);
      lap('released');
      expect(errors).toEqual([]);
      console.log(`T-549 done-when on anvil: deployment ${receipt.transactionHash} used ${receipt.gasUsed} gas, ${size(code!)} bytes of code; funding took ${fundMs} ms; seconds from the world's start: ${JSON.stringify(took)}`);
    } finally {
      await demo.close();
    }
  }, 600_000);
});

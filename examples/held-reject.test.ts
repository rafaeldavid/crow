// T-619 (ADR-0051): the buyer's command for a held reject, on the in-process sim world. Its adjudicators hold a rubric
// deal's reject for the window the terms set (87,000 s here, as Crow's tools write for a rubric deal), so the deal stays
// Delivered with the reject published. The command says so, and runs the buyer's early accept or its half of a settlement.
import { startSimWorld, type SimWorld } from '@holdback/operator';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent } from './agent.ts';
import { heldView, main } from './held-reject.ts';
import { typedOf } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
let world: SimWorld;
const accounts: Array<{ agent: Agent; privateKey: string; encryptionSecretKey: string }> = [];
beforeAll(async () => {
  world = await startSimWorld({ env: {}, onError: () => {} });
});
afterAll(async () => {
  await world.close();
});

async function fresh() {
  const a = (await (await fetch(`${world.url}/accounts`, { method: 'POST' })).json()) as J;
  const x = { agent: new Agent([...world.info.operators], a.privateKey, Buffer.from(a.encryptionSecretKey, 'base64url')), privateKey: a.privateKey, encryptionSecretKey: a.encryptionSecretKey };
  accounts.push(x);
  return x;
}

/** A rubric deal the sim panel rejects (work containing FAIL-ME), on prepare's rubric windows. */
async function rejected() {
  const seller = await fresh();
  const buyer = await fresh();
  const a = world.info.adjudicators;
  const offer = await seller.agent.offer({
    template: 'default', clubId: world.info.clubId, seller: seller.agent.address,
    buyer: { address: buyer.agent.address, encryptionPublicKey: buyer.agent.encryptionPublicKey },
    adjudicators: { primary: a[0]!.address, fallback: a[1]!.address, appeal: a[2]!.address },
    price: { token: 'tUSD', amount: '25000000' },
    deliverable: { kind: 'document', description: 'a note', format: 'text/plain' },
    checks: [],
    rubric: { passThreshold: 300, criteria: [{ id: 'ok', description: 'Fine.', weight: 1, anchors: { '0': 'No', '2': 'Partly', '4': 'Yes' } }] },
    timing: { judgeWithinSec: 87_000, appealDecideSec: 87_000 },
  });
  expect(offer.terms.timing.appealDecideSec).toBe(87_000);
  await buyer.agent.waitFor(offer.id, ['AcceptedByAdjudicator']);
  await buyer.agent.agreeAndFund(offer.terms, 100_000_000n);
  const { delivery } = await seller.agent.deliverAndShare(offer.terms, new TextEncoder().encode('a note that says FAIL-ME'));
  let view = await heldView(buyer.agent, offer.id);
  for (const end = Date.now() + 15_000; !view.held && Date.now() < end; view = await heldView(buyer.agent, offer.id)) await new Promise((r) => setTimeout(r, 100));
  const file = join(mkdtempSync(join(tmpdir(), 't619-')), 'delivery.json');
  writeFileSync(file, JSON.stringify(delivery));
  return { offer, buyer, seller, view, file };
}

const env = (x: { privateKey: string; encryptionSecretKey: string }) => ({ HOLDBACK_KEY: x.privateKey, HOLDBACK_ENCRYPTION_KEY: x.encryptionSecretKey, HOLDBACK_OPERATORS: world.info.operators.join(',') });

describe('examples/held-reject.ts (ADR-0051)', () => {
  it('sees the held reject, and the buyer accepts the posted delivery at the agreed price', async () => {
    const { offer, buyer, view, file } = await rejected();
    expect(view).toMatchObject({ escrowState: 'Delivered', held: true, moves: ['--accept <delivery.json>', '--settle <toSellerBps>'] });
    expect(await main([offer.id], env(buyer))).toBe(0);
    expect(await main([offer.id, '--accept', file], env(buyer))).toBe(0);
    expect((await buyer.agent.waitFor(offer.id, ['Released'])).escrowState).toBe('Released');
    // Nothing is held any more: the command says so and refuses a second accept.
    expect(await main([offer.id], env(buyer))).toBe(3);
    expect(await main([offer.id, '--accept', file], env(buyer))).toBe(3);
  }, 60_000);

  it('signs the buyer\'s half of a split; the seller countersigns and either submits it', async () => {
    const { offer, buyer, seller } = await rejected();
    const out: string[] = [];
    const log = console.log;
    console.log = (x: string) => void out.push(x);
    try {
      expect(await main([offer.id, '--settle', '6000'], env(buyer))).toBe(0);
    } finally {
      console.log = log;
    }
    const half = JSON.parse(out.join('\n'));
    expect(half.payouts.map((p: J) => p.amount.amount)).toEqual(['15000000', '10000000']);
    const m = { ...half };
    delete m.buyerSignature;
    delete m.sellerSignature;
    const sellerSignature = await seller.agent.account.signTypedData(typedOf('MutualSettlement', m, seller.agent.domain));
    const file = join(mkdtempSync(join(tmpdir(), 't619-')), 'settlement.json');
    writeFileSync(file, JSON.stringify({ ...half, sellerSignature }));
    expect(await main([offer.id, '--submit', file], env(buyer))).toBe(0);
    expect((await buyer.agent.waitFor(offer.id, ['Settled'])).escrowState).toBe('Settled');
  }, 60_000);

  it('refuses a wrong call before it reads anything', async () => {
    expect(await main(['nope'], {})).toBe(2);
    expect(await main([`0x${'1'.repeat(64)}`, '--settle'], {})).toBe(2);
    expect(await main([`0x${'1'.repeat(64)}`, '--accept'], {})).toBe(2);
    expect(await main([`0x${'1'.repeat(64)}`], {})).toBe(2);
  });
});

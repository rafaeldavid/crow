// The signer's selling half (T-443): the attack tests run as Crow's selling agent, which holds no key and full control
// of its own process (this test). The signer runs as its own process with the selling key in its own environment, its
// rules (examples/signer-rules.v1.json's `selling`, constraints version 1: 5.00 tUSDC a deal, 20 offers an hour, 10
// open, 20 a day) and a stand-in for its read endpoints, set as the signer's administrator would see the chain.
// A12: offers outside Crow's template, past the counts, after the stop. A15: deliveries the signer must not sign.
// Every attack has a control that is signed.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { recoverTypedDataAddress, type Hex } from 'viem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCEPTANCE, cast, cleanup, DELIVERABLE, fresh, iso, mandateFor, rulesFor, sellingMandateFor, sellingRulesFor, startSigner, stateServer, termsFor, V1, type Cast, type Running } from './signer-test-kit.ts';
import { commitmentIdOf, SIMCHAIN_DOMAIN, typedDataFile, typedOf } from './verify.ts';
import { createHash } from 'node:crypto';
import { matchesTemplate } from './signer.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const CSV = 'customer_id,email\n1,ada@example.com\n2,alan@example.com\n3,grace@example.com\n';
const dirs: string[] = [];
let reads: Awaited<ReturnType<typeof stateServer>>;
beforeAll(async () => void (reads = await stateServer()));
afterAll(async () => {
  await reads.close();
  cleanup(dirs);
});

async function selling(o: { rules?: (c: Cast) => J; mandate?: (c: Cast) => Promise<J>; flag?: string } = {}): Promise<{ c: Cast; s: Running }> {
  const c = cast();
  const s = await startSigner(c, o.rules ? o.rules(c) : sellingRulesFor(c, { reads: [reads.url] }), await mandateFor(c), { sellingMandate: await (o.mandate ?? ((x) => sellingMandateFor(x)))(c), ...(o.flag ? { flag: o.flag } : {}) });
  dirs.push(s.dir);
  return { c, s };
}
const refused = (r: { status: number; body: J }, rule: string, detail?: RegExp) => {
  expect(r.status, JSON.stringify(r.body)).toBe(403);
  expect(r.body.rule, JSON.stringify(r.body)).toBe(rule);
  if (detail) expect(r.body.detail).toMatch(detail);
};
const signed = (r: { status: number; body: J }) => {
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
};
const deal = () => `0x${createHash('sha256').update(String(Math.random())).digest('hex')}`;
/** Terms Crow's selling agent offers: its selling key, its treasury, its price, its product for one public deal. */
const sale = (c: Cast, o: J = {}) => termsFor(c, { seller: c.sellingAddress, payout: c.treasury, payer: fresh(), price: V1.selling.price, deliverable: { ...DELIVERABLE, description: `records of deal ${deal()}` }, ...o });
const offer = (terms: J) => ({ kind: 'offer', terms });
/** The delivery a seller's agent prepares for `terms`, sealed to its four recipients, of `work`. */
function delivery(terms: J, work = CSV, o: { attempt?: number; recipients?: string[]; sha?: string; mime?: string; submittedAt?: string } = {}) {
  const bytes = Buffer.from(work);
  const recipients = o.recipients ?? [terms.adjudication.adjudicator, terms.adjudication.fallbackAdjudicator, terms.adjudication.appealAdjudicator, terms.buyer];
  const message = {
    commitmentId: commitmentIdOf(terms), attempt: o.attempt ?? 1,
    ciphertext: { uri: `holdback://ciphertext/sha256:${'ab'.repeat(32)}`, sha256: `sha256:${'ab'.repeat(32)}`, bytes: bytes.length + 28, cipher: 'aes-256-gcm' },
    plaintextSha256: o.sha ?? `sha256:${createHash('sha256').update(bytes).digest('hex')}`, plaintextMime: o.mime ?? terms.deliverable.format,
    encryptedKeys: recipients.map((r) => ({ recipient: r, scheme: 'x25519-xsalsa20poly1305', ciphertext: 'A'.repeat(139) })),
    submittedAt: o.submittedAt ?? iso(Date.now()),
  };
  return { kind: 'delivery', terms, file: typedDataFile(typedOf('Delivery', message, SIMCHAIN_DOMAIN)), plaintext: bytes.toString('base64') };
}
/** An offer signed and funded at the stand-in reads, ready for its delivery. */
async function funded(c: Cast, s: Running, o: J = {}) {
  const t = sale(c, o);
  signed(await s.post(offer(t)));
  reads.set(commitmentIdOf(t), 'Held');
  return t;
}

describe('the control: an offer on Crow\'s template, and its one delivery', () => {
  it('the offer is signed by the selling key over these terms; the funded deal\'s passing work is signed once; the status counts both', async () => {
    const { c, s } = await selling();
    const t = sale(c);
    const o = signed(await s.post(offer(t)));
    expect((await recoverTypedDataAddress({ ...typedOf('CommitmentTerms', t, SIMCHAIN_DOMAIN), signature: o.signature as Hex })).toLowerCase()).toBe(c.sellingAddress);
    reads.set(commitmentIdOf(t), 'Held');
    const d = delivery(t);
    const out = signed(await s.post(d));
    const { EIP712Domain: _d, ...types } = d.file.types; // eslint-disable-line @typescript-eslint/no-unused-vars
    expect((await recoverTypedDataAddress({ ...d.file, types, signature: out.signature })).toLowerCase()).toBe(c.sellingAddress);
    expect((await s.get('/v1/status')).body).toMatchObject({ sellingAddress: c.sellingAddress, selling: { offersLastHour: 1, salesOpen: 1, offersToday: 1, delivered: 1, price: '5000000', payoutAddress: c.treasury } });
    for (const k of Object.values(c.keys)) for (const f of ['status.json', 'decisions.jsonl', 'ledger.json']) expect(readFileSync(join(s.statePath, f), 'utf8')).not.toContain(k.slice(2));
    await s.kill();
  });
});

describe('A12: offers outside Crow\'s template (S2, S3, S4)', () => {
  it('another payout address, another price, another seller, each reviewer, the fee, the product, a check, a rubric, a window, a shifted date: each refused, naming the rule', async () => {
    const { c, s } = await selling();
    refused(await s.post(offer(sale(c, { payout: fresh() }))), 'S2', /not Crow's payout address/);
    refused(await s.post(offer(sale(c, { price: '4999999' }))), 'S3', /not Crow's 5000000/);
    refused(await s.post(offer(sale(c, { price: '5000001' }))), 'S3');
    refused(await s.post(offer(sale(c, { seller: fresh() }))), 'S4', /not Crow's selling key/);
    for (const k of ['adjudicator', 'fallbackAdjudicator', 'appealAdjudicator']) refused(await s.post(offer(sale(c, { adjudication: { [k]: fresh() } }))), 'S4', new RegExp(`adjudication.${k}`));
    refused(await s.post(offer(sale(c, { adjudication: { fee: { token: 'tUSD', amount: '2000000' } } }))), 'S4', /policy or fee/);
    refused(await s.post(offer(sale(c, { deliverable: { ...DELIVERABLE, description: 'something else' } }))), 'S4', /not one of Crow's products/);
    refused(await s.post(offer(sale(c, { acceptance: { ...ACCEPTANCE, deterministicChecks: ACCEPTANCE.deterministicChecks.slice(1) } }))), 'S4', /not one of Crow's products/);
    refused(await s.post(offer(sale(c, { acceptance: { ...ACCEPTANCE, rubric: { criteria: [{ id: 'q', description: 'good', weight: 1 }], passThreshold: 1 } } }))), 'S4');
    const base = Math.floor(Date.now() / 1000) * 1000;
    refused(await s.post(offer(sale(c, { createdAt: base, timing: { offerExpiresAt: iso(base + 299_000) } }))), 'S4', /not Crow's 300 s/);
    refused(await s.post(offer(sale(c, { createdAt: base, timing: { judgeBy: iso(base + 3_661_000), fallbackBy: iso(base + 3_721_000) } }))), 'S4', /not Crow's 60 s/);
    refused(await s.post(offer(sale(c, { createdAt: base - 120_000 }))), 'S4', /from the signer's clock/);
    refused(await s.post(offer(sale(c, { extra: { clubId: 'other-club' } }))), 'S4');
    refused(await s.post(offer(sale(c, { timing: { maxSubmissions: 2 } }))), 'S4');
    signed(await s.post(offer(sale(c))));
    await s.kill();
  });

  it('the 21st offer in an hour and the 11th open sale are refused (S5); an offer asked for again counts once', async () => {
    const hour = await selling();
    for (let i = 0; i < V1.selling.maxOffersPerHour; i++) reads.set(signed(await hour.s.post(offer(sale(hour.c)))).commitmentId, 'Released');
    refused(await hour.s.post(offer(sale(hour.c))), 'S5', /20 offers were signed in the last 3,600 s/);
    await hour.s.kill();
    const open = await selling();
    const t = sale(open.c);
    for (let i = 0; i < V1.selling.maxOpenDeals; i++) signed(await open.s.post(offer(i === 0 ? t : sale(open.c))));
    refused(await open.s.post(offer(sale(open.c))), 'S5', /10 sales are open/);
    signed(await open.s.post(offer(t))); // the first one again: counted once, signed again
    await open.s.kill();
  });

  it('after the stop no offer is signed (X2); with the selling mandate expired, none either; a signer with no selling half signs no offer', async () => {
    const { c, s } = await selling();
    writeFileSync(s.flagPath, 'stop\n');
    refused(await s.post(offer(sale(c))), 'X2', /stopped/);
    writeFileSync(s.flagPath, 'run\n');
    signed(await s.post(offer(sale(c))));
    writeFileSync(join(s.dir, 'selling-mandate.json'), JSON.stringify(await sellingMandateFor(c, { days: 1, now: Date.now() - 86_400_000 - 1000 })));
    refused(await s.post(offer(sale(c))), 'mandate', /ended at/);
    await s.kill();
    const plain = cast();
    const p = await startSigner(plain, rulesFor(plain, { reads: [reads.url] }), await mandateFor(plain));
    dirs.push(p.dir);
    refused(await p.post(offer(sale(plain))), 'B14', /no selling half/);
    refused(await p.post(delivery(sale(plain))), 'B14', /no selling half/);
    await p.kill();
  });
});

describe('A15: deliveries the signer must not sign (S6)', () => {
  it('a second delivery for one deal, work that fails the checks, a deal not funded or never offered, a delivery sealed to others or for other bytes: each refused', async () => {
    const { c, s } = await selling();
    const t = await funded(c, s);
    refused(await s.post(delivery(t, 'customer_id\n1\n')), 'S6', /does not pass the deal's checks/);
    refused(await s.post(delivery(t, CSV, { recipients: [t.adjudication.adjudicator, t.adjudication.fallbackAdjudicator, t.adjudication.appealAdjudicator, fresh()] })), 'S6', /not sealed to the deal's three adjudicators and its buyer/);
    refused(await s.post(delivery(t, CSV, { recipients: [t.adjudication.adjudicator] })), 'S6');
    refused(await s.post(delivery(t, CSV, { sha: `sha256:${'00'.repeat(32)}` })), 'S6', /the work hashes to/);
    refused(await s.post(delivery(t, CSV, { attempt: 2 })), 'S6', /attempt 2/);
    refused(await s.post(delivery(t, CSV, { mime: 'application/json' })), 'S6', /declares application\/json/);
    refused(await s.post(delivery(t, CSV, { submittedAt: iso(Date.now() - 3_600_000) })), 'S6', /submittedAt/);
    signed(await s.post(delivery(t)));
    refused(await s.post(delivery(t)), 'S6', /delivered once, at/);
    const never = sale(c);
    reads.set(commitmentIdOf(never), 'Held');
    refused(await s.post(delivery(never)), 'S6', /never offered/);
    const unfunded = sale(c);
    signed(await s.post(offer(unfunded)));
    reads.set(commitmentIdOf(unfunded), 'AcceptedByAdjudicator');
    refused(await s.post(delivery(unfunded)), 'S6', /not funded/);
    const silent = sale(c);
    signed(await s.post(offer(silent))); // the stand-in serves no state for it: no answer is a doubt
    refused(await s.post(delivery(silent)), 'S6', /no answer/);
    await s.kill();
  });

  it('a funded deal\'s delivery is signed after the stop and with the selling mandate expired: neither stalls a funded deal', async () => {
    const { c, s } = await selling();
    const a = await funded(c, s), b = await funded(c, s);
    writeFileSync(s.flagPath, 'stop\n');
    signed(await s.post(delivery(a)));
    writeFileSync(s.flagPath, 'run\n');
    writeFileSync(join(s.dir, 'selling-mandate.json'), JSON.stringify(await sellingMandateFor(c, { days: 1, now: Date.now() - 86_400_000 - 1000 })));
    signed(await s.post(delivery(b)));
    await s.kill();
  });
});

describe('the product template', () => {
  it('the deal ID stands in one place for one ID, the same everywhere it appears; everything else must be equal', () => {
    const id = `0x${'ab'.repeat(32)}`, other = `0x${'cd'.repeat(32)}`;
    const tpl = { d: 'records of deal {{scope.commitmentId}}', checks: [{ path: '$.commitmentId', equals: '{{scope.commitmentId}}' }] };
    expect(matchesTemplate(tpl, { d: `records of deal ${id}`, checks: [{ path: '$.commitmentId', equals: id }] })).toBe(true);
    expect(matchesTemplate(tpl, { d: `records of deal ${id}`, checks: [{ path: '$.commitmentId', equals: other }] })).toBe(false);
    expect(matchesTemplate(tpl, { d: `records of deal ${id.toUpperCase()}`, checks: [{ path: '$.commitmentId', equals: id }] })).toBe(false);
    expect(matchesTemplate(tpl, { d: `records of deal ${id} and more`, checks: [{ path: '$.commitmentId', equals: id }] })).toBe(false);
    expect(matchesTemplate(tpl, { d: `records of deal ${id}`, checks: [{ path: '$.commitmentId', equals: id, extra: 1 }] })).toBe(false);
    expect(matchesTemplate({ a: 1 }, { a: '1' })).toBe(false);
  });
});

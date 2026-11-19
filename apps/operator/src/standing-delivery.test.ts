// T-550, ADR-0040 §2: a standing delivery over HTTP, against a sim world (SimChain, two operators, three test
// adjudicators). The seller signs, right after its offer, one delivery with envelopes for the three adjudicators and
// none for the buyer, and acts no more. The buyer funds and posts that delivery itself. The settlement layer refuses an
// early accept and a settlement that releases the key, each with its reason; the primary accepts, its decision wraps
// the content key to the buyer's terms key, and the buyer opens the file.
import { type Address, type Hex32 } from '@holdback/core';
import { open, seal, unwrapKey, wrapKeyForRecipients, type EncryptedKey } from '@holdback/core/crypto';
import { hashTypedData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testAccount } from './accounts.js';
import type { Prepared } from './prepare.js';
import { startSimWorld, type SimInfo, type SimWorld } from './sim-world.js';

let world: SimWorld;
let api: string;
let info: SimInfo;

beforeAll(async () => {
  world = await startSimWorld({ accounts: ['standing-buyer', 'standing-seller'], env: {}, onError: () => {} });
  info = world.info;
  api = info.operators[1]!;
});
afterAll(() => world.close());

const acct = (label: string) => info.accounts.find((a) => a.label === label)!;
const CSV = 'id,email\n1,ada@example.com\n2,alan@example.com\n';

let calls = 0;
async function call<T = any>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; body: T }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const headers: Record<string, string> = { 'content-type': body instanceof Uint8Array ? 'application/octet-stream' : 'application/json', 'idempotency-key': `standing-${++calls}` };
  const res = await fetch(`${api}${path}`, { method, headers, ...(body === undefined ? {} : { body: body instanceof Uint8Array ? body : JSON.stringify(body) }) });
  return { status: res.status, body: (await res.json()) as T };
}

function ints(types: Record<string, Array<{ name: string; type: string }>>, type: string, v: unknown): unknown {
  if (type.endsWith('[]')) return (v as unknown[]).map((x) => ints(types, type.slice(0, -2), x));
  if (types[type]) return Object.fromEntries(types[type]!.map((f) => [f.name, ints(types, f.type, (v as Record<string, unknown>)[f.name])]));
  return /^u?int\d*$/.test(type) ? BigInt(v as string) : v;
}

/** What an agent does: check the digest, sign its slots with its own key. */
async function sign(p: Prepared, label: string): Promise<Prepared> {
  const account = privateKeyToAccount(acct(label).privateKey);
  for (const s of p.sign.filter((x) => x.signer.toLowerCase() === account.address.toLowerCase())) {
    const typed = { ...s.typedData, message: ints(s.typedData.types, s.typedData.primaryType, s.typedData.message) } as Parameters<typeof hashTypedData>[0];
    expect(hashTypedData(typed)).toBe(s.digest);
    const path = s.slot.split('.');
    const parent = path.slice(0, -1).reduce<Record<string, unknown>>((o, k) => o[k] as Record<string, unknown>, p.submit.body);
    parent[path.at(-1)!] = await account.signTypedData(typed as Parameters<typeof account.signTypedData>[0]);
  }
  return p;
}
const submit = async (p: Prepared) => call('POST', p.submit.path, p.submit.body);

async function waitFor(id: Hex32, states: string[]): Promise<{ escrowState: string }> {
  for (let i = 0; i < 200; i++) {
    const s = (await call('GET', `/v1/commitments/${id}`)).body;
    if (states.includes(s.escrowState)) return s;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`${id} never reached ${states.join('|')}`);
}

const nonce = () => `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`;
let deals = 0;

/** The seller's setup: an offer, and one delivery for it with no envelope for the buyer, signed and handed over. */
async function setup() {
  const buyer = acct('standing-buyer');
  const seller = acct('standing-seller');
  const offer = (
    await call<Prepared>('POST', '/v1/prepare/offer', {
      nonce: `0x${(0x550_000 + ++deals).toString(16).padStart(64, '0')}`,
      disclosure: 'public',
      template: 'checks-only',
      clubId: info.clubId,
      seller: seller.address,
      buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey },
      adjudicators: { primary: info.adjudicators[0]!.address, fallback: info.adjudicators[1]!.address, appeal: info.adjudicators[2]!.address },
      price: { token: 'tUSD', amount: '5000000' },
      deliverable: { kind: 'dataset', description: 'Two customers, a finished file.', format: 'text/csv' },
      checks: [
        { id: 'cols', type: 'csv_columns_exact', required: true, columns: ['id', 'email'] },
        { id: 'rows', type: 'row_count_range', required: true, min: 2, max: 10 },
      ],
    })
  ).body;
  expect((await submit(await sign(offer, 'standing-seller'))).body.escrowState).toBe('Offered');
  const id = offer.commitmentId;
  const sealed = await seal(new TextEncoder().encode(CSV));
  const stored = (await call('POST', '/v1/ciphertext', sealed.ciphertext)).body;
  const { recipients } = (await call('GET', `/v1/commitments/${id}/recipients`)).body as { recipients: Array<{ address: Address; encryptionPublicKey: string }> };
  const adjudicators = recipients.filter((r) => r.address.toLowerCase() !== buyer.address.toLowerCase());
  expect(adjudicators).toHaveLength(3);
  const encryptedKeys: EncryptedKey[] = wrapKeyForRecipients(sealed.key, adjudicators.map((r) => ({ recipient: r.address, publicKey: r.encryptionPublicKey })));
  const pd = (await call<Prepared>('POST', '/v1/prepare/delivery', { commitmentId: id, ciphertext: { uri: stored.uri, sha256: stored.id, bytes: stored.bytes }, plaintextSha256: sealed.plaintextSha256, encryptedKeys })).body;
  expect(pd.check.join(' ')).toMatch(/none for the buyer .* only with an adjudicator's accept/);
  expect(pd.notices).toEqual([expect.stringMatching(/^Buyer envelope: none for 0x[0-9a-f]{40}\. If you meant a delivery for this buyer only/)]);
  const delivery = (await sign(pd, 'standing-seller')).submit.body;
  // From here on the seller is offline: it signs nothing more.
  await waitFor(id, ['AcceptedByAdjudicator']);
  const af = (await call<Prepared>('POST', '/v1/prepare/agree-and-fund', { commitmentId: id, agreeNonce: nonce(), fundingNonce: nonce() })).body;
  expect((await submit(await sign(af, 'standing-buyer'))).body.escrowState).toBe('Held');
  return { id, sealed, delivery, deliveriesPath: pd.submit.path };
}

describe('a standing delivery without the buyer envelope, over the operator API (T-550, ADR-0040 §2)', () => {
  it('the buyer posts it; early accept and key release are refused with the reason; the primary accepts and the buyer opens the file', async () => {
    const primary = (silent: boolean) => fetch(`${world.url}/adjudicators/primary`, { method: 'POST', body: JSON.stringify({ silent }) });
    const { id, sealed, delivery, deliveriesPath } = await setup();
    // The primary waits until both refusals are shown, so no decision lands first.
    expect((await primary(true)).ok).toBe(true);
    try {
      // The buyer posts the seller's delivery: anyone may, the signature is the seller's.
      expect((await call('POST', deliveriesPath, delivery)).body.escrowState).toBe('Delivered');

      const ea = (await call<Prepared>('POST', '/v1/prepare/early-accept', { commitmentId: id, nonce: nonce() })).body;
      expect(ea.check.join(' ')).toMatch(/holds no envelope for you .* refuses an early accept/);
      const early = await submit(await sign(ea, 'standing-buyer'));
      expect([early.status, early.body.type]).toEqual([400, 'invalid_terms']);
      expect(early.body.detail).toMatch(/no envelope for the buyer .* comes only with an adjudicator's accept/);

      // A settlement that releases the key needs the seller's signature too; the test signs with its key to show the
      // settlement layer's refusal, which stands whoever signs.
      const ps = (await call<Prepared>('POST', '/v1/prepare/settlement', { commitmentId: id, nonce: nonce(), toSellerBps: 10000, releaseKey: true })).body;
      expect(ps.check.join(' ')).toMatch(/if it holds none \(a standing delivery, ADR-0040 §2\), the settlement layer refuses releaseKey true/);
      const released = await submit(await sign(await sign(ps, 'standing-buyer'), 'standing-seller'));
      expect([released.status, released.body.type]).toEqual([400, 'invalid_terms']);
      expect(released.body.detail).toMatch(/no envelope for the buyer .* a settlement that releases the key/);
      expect((await call('GET', `/v1/commitments/${id}`)).body.escrowState).toBe('Delivered');
      expect((await call('GET', `/v1/commitments/${id}/key?recipient=${acct('standing-buyer').address}`)).body.items).toEqual([]);

      await primary(false);
      expect((await waitFor(id, ['Released', 'Refunded'])).escrowState).toBe('Released');
      const keys = (await call('GET', `/v1/commitments/${id}/key?recipient=${acct('standing-buyer').address}`)).body.items as EncryptedKey[];
      expect(keys).toHaveLength(1);
      const plaintext = await open(sealed.ciphertext, unwrapKey(keys[0]!, testAccount('standing-buyer').encryptionSecretKey), sealed.plaintextSha256);
      expect(new TextDecoder().decode(plaintext)).toBe(CSV);
    } finally {
      await primary(false);
    }
  });

  it('prepare/delivery still refuses a delivery that leaves out an adjudicator', async () => {
    const { id } = await setup();
    const { recipients } = (await call('GET', `/v1/commitments/${id}/recipients`)).body as { recipients: Array<{ address: Address; encryptionPublicKey: string }> };
    const sealed = await seal(new TextEncoder().encode(CSV));
    const twoOfThree = recipients.filter((r) => r.address.toLowerCase() !== info.adjudicators[2]!.address.toLowerCase() && r.address.toLowerCase() !== acct('standing-buyer').address.toLowerCase());
    const r = await call('POST', '/v1/prepare/delivery', { commitmentId: id, ciphertext: { uri: 'x', sha256: sealed.ciphertextSha256, bytes: 1 }, plaintextSha256: sealed.plaintextSha256, encryptedKeys: wrapKeyForRecipients(sealed.key, twoOfThree.map((x) => ({ recipient: x.address, publicKey: x.encryptionPublicKey }))) });
    expect([r.status, r.body.detail]).toEqual([400, expect.stringMatching(new RegExp(`no envelope for ${info.adjudicators[2]!.address.toLowerCase()}`))]);
  });
});

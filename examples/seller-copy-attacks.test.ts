// D101 red team (T-611, PR 814): a copier posts a copy of a real offer for the same buyer, signed by its own key, and
// tries to make Crow's buyer tools fund it. Each case states the outcome the defense should give. Served in-process:
// the public demo world on two origins, a real seller's quote route, and a copier that builds its copies with
// Agent.offerDirect. The standing-offer cases run offline up to the point take.ts would reach the operators.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { templateDigest, templateFrom, type Address, type CommitmentTerms, type Hex32, type StandingOffer, type TakeFill } from '@holdback/core';
import { MemoryStorage, PublicWorld } from '@holdback/demo-cloud';
import nacl from 'tweetnacl';
import { getAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Agent } from './agent.ts';
import { loadKeys, makeKeys, openDeals, sellerOf } from './buyer-signer.ts';
import { buyThroughSigner } from './own-buyer.ts';
import { checkEntry, entryOf, main as take, sellerAddressOf, takeOf, type StandingEntry } from './take.ts';
import { serveTwoOrigins, type TwoOrigins } from './two-origins.ts';
import { pinOf, Refusal, type Pin } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const root = fileURLToPath(new URL('..', import.meta.url));
const PRICE = { token: 'tUSD', amount: '25000000' };
const DELIVERABLE = { kind: 'dataset', description: 'customers.csv, one row per customer', format: 'text/csv' };
const CHECKS = [
  { id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] },
  { id: 'rows', type: 'row_count_range', required: true, min: 3, max: 3 },
];
const TIMING = { judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 0, appealDecideSec: 60 };

let demo: TwoOrigins;
const stores: string[] = [];
const store = () => {
  const dir = mkdtempSync(join(tmpdir(), 'seller-copy-attacks-'));
  stores.push(dir);
  return dir;
};
const refusal = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as Error);
const listen = async (server: Server, host = '127.0.0.1') => {
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  return (server.address() as AddressInfo).port;
};
const closeAll = (server: Server) => new Promise<void>((resolve) => (server.closeAllConnections(), server.close(() => resolve())));
const bodyOf = async (req: import('node:http').IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString();
  return text ? (JSON.parse(text) as J) : null;
};

/** An agent offering the same deal to a buyer, signed by its own key and paid to it: the real seller or a copier. */
type Offerer = { agent: Agent; address: string; offerFor(buyer: { address: string; encryptionPublicKey: string; paymentAddress?: string }): Promise<{ id: `0x${string}`; terms: J }> };
async function offerer(operators: string[]): Promise<Offerer> {
  const agent = new Agent(operators, generatePrivateKey(), nacl.randomBytes(32));
  await agent.call('POST', '/v1/faucet', { address: agent.address });
  const found = await agent.trusted('/.well-known/holdback.json', (x) => ({ clubId: x.demo.clubId, adjudicators: x.demo.adjudicators }));
  const role = (r: string): string => found.adjudicators.find((a: J) => a.role === r).address;
  const adjudicators = { primary: role('primary'), fallback: role('fallback'), appeal: role('appeal') };
  return {
    agent, address: agent.address,
    offerFor: (buyer) => agent.offerDirect({ template: 'checks-only', clubId: found.clubId, seller: agent.address, sellerPayoutAddress: agent.address, buyer, adjudicators, price: PRICE, deliverable: DELIVERABLE, checks: CHECKS, timing: TIMING }),
  };
}

/** A quote route answering with `who`'s offer for the buyer in the body; it records each request it gets. */
type Route = { url: string; port: number; seen: Array<{ method: string; headers: IncomingHttpHeaders; body: J }>; close(): Promise<void> };
async function quoteRoute(who: Offerer, host = '127.0.0.1'): Promise<Route> {
  const seen: Route['seen'] = [];
  const server = createServer(async (req, res) => {
    const body = await bodyOf(req);
    seen.push({ method: req.method ?? '', headers: req.headers, body });
    // A GET after a 301, 302 or 303 carries no buyer: the copier can only offer to a buyer it made up.
    const buyer = body?.buyer ? { address: body.buyer, encryptionPublicKey: body.buyerEncryptionPublicKey, ...(body.buyerPaymentAddress ? { paymentAddress: body.buyerPaymentAddress } : {}) } : { address: privateKeyToAccount(generatePrivateKey()).address.toLowerCase(), encryptionPublicKey: Buffer.from(nacl.box.keyPair().publicKey).toString('base64url') };
    try {
      const offer = await who.offerFor(buyer);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ commitmentId: offer.id, price: offer.terms.price, fees: null, expiresAt: offer.terms.timing.offerExpiresAt }));
    } catch (e) {
      res.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ type: 'offer_failed', detail: String((e as Error).message).slice(0, 200) }));
    }
  });
  const port = await listen(server, host);
  const shownHost = host === '::' ? '[::ffff:127.0.0.1]' : host;
  return { url: `http://${shownHost}:${port}/quote`, port, seen, close: () => closeAll(server) };
}

/** The real seller's origin, whose quote route answers `status` with Location `to` (an open redirect, or a moved route). */
async function redirector(status: number, to: () => string): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer(async (req, res) => {
    await bodyOf(req);
    res.writeHead(status, { location: to() }).end();
  });
  const port = await listen(server);
  return { url: `http://127.0.0.1:${port}/quote`, close: () => closeAll(server) };
}

let real: Offerer, copier: Offerer, realRoute: Route, copierRoute: Route;
beforeAll(async () => {
  const world = await PublicWorld.open({ storage: new MemoryStorage(), env: { OPERATOR_FEE_BPS: '0', OPERATOR_FEE_MIN: '0' }, faucetPerClient: 1000 });
  demo = await serveTwoOrigins(world, { tickMs: 100 });
  real = await offerer(demo.urls);
  copier = await offerer(demo.urls);
  realRoute = await quoteRoute(real);
  // The copier's own origin, off the buyer's list of allowed hosts: quote refuses this URL when given it directly.
  copierRoute = await quoteRoute(copier, '::');
}, 60_000);
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await realRoute?.close();
  await copierRoute?.close();
  await demo?.close();
  for (const dir of stores) rmSync(dir, { recursive: true, force: true });
});
const keys = (o: { seller?: string; paymentAddress?: string; quoteCredentialEnv?: string } = {}, dir = store()) => makeKeys(dir, { operators: demo.urls, log: () => {}, ...o });
const stateOf = async (id: string) => ((await (await fetch(`${demo.urls[0]}/v1/commitments/${id}`)).json()) as J).escrowState;

describe('attack 1: a copy of a quoted offer, for the same buyer', () => {
  it('attack.copy-after-quote: a key that quoted the real offer cannot check, fund or write files for a copy, with no seller named', async () => {
    const signer = await keys();
    const quote = await signer.quote(realRoute.url, 'rows');
    const copy = await copier.offerFor({ address: signer.address, encryptionPublicKey: signer.encryptionPublicKey });
    // Shown (readOffer refuses nothing without a named seller), then refused at checkOffer: the key did not quote it.
    expect((await signer.readOffer(copy.id)).seller).toBe(copier.address);
    expect((await refusal(signer.checkOffer(copy.id, signer.shownOffer!)))!.message).toMatch(/^refusing to sign: seller: this key did not ask for/);
    expect((await refusal(signer.agreeAndFund(copy.id)))!.message).toMatch(/checkOffer has not passed/);
    expect((await refusal(signer.fundingFiles(copy.id)))!.message).toMatch(/checkOffer has not passed/);
    // The real offer, read again, still passes.
    const offer = await signer.readOffer(quote.commitmentId);
    await expect(signer.checkOffer(quote.commitmentId, offer)).resolves.toMatchObject({ seller: real.address });
    expect(await stateOf(copy.id)).not.toBe('Held');
  }, 60_000);

  it('attack.copy-named-seller: with the seller named, readOffer refuses the copy before it shows it, naming seller', async () => {
    const signer = await keys({ seller: getAddress(real.address) });
    await signer.quote(realRoute.url, 'rows');
    const copy = await copier.offerFor({ address: signer.address, encryptionPublicKey: signer.encryptionPublicKey });
    const e = await refusal(signer.readOffer(copy.id));
    expect(e).toBeInstanceOf(Refusal);
    expect(e!.message).toMatch(/^refusing to sign: seller is "0x[0-9a-f]{40}", not the expected/);
    expect(signer.shownOffer).toBeUndefined();
  }, 60_000);

  it('attack.copy-unasked-approval-names-seller: an offer the key did not quote is refused even when the approval carries seller, and a refused check persisted by a later readOffer still funds nothing', async () => {
    const dir = store();
    const signer = await keys({}, dir);
    const copy = await copier.offerFor({ address: signer.address, encryptionPublicKey: signer.encryptionPublicKey });
    const shown = await signer.readOffer(copy.id);
    for (const approval of [shown, { ...shown, seller: copier.address }, { ...shown, seller: getAddress(copier.address) }]) {
      expect((await refusal(signer.checkOffer(copy.id, approval)))!.message).toMatch(/^refusing to sign: seller: this key did not ask for/);
    }
    // Measured today: checkOffer binds the ID in memory before it refuses, and a second readOffer saves that binding to
    // the key file, so loadKeys finds the key by the copy's ID. Whether or not it does, the copy stays refused.
    await signer.readOffer(copy.id);
    if (JSON.parse(readFileSync(join(dir, `${signer.address}.json`), 'utf8')).commitmentId === copy.id) {
      const again = await loadKeys(dir, copy.id, { operators: demo.urls, log: () => {} });
      expect((await refusal(again.checkOffer(copy.id, again.shownOffer!)))!.message).toMatch(/seller: this key did not ask for/);
    }
    expect(await openDeals(dir, { operators: demo.urls })).toEqual([]);
    // The approve run of buy-with-signer.ts on that key store: refused, nothing funded.
    const r = await run(['examples/buy-with-signer.ts', 'approve', dir, copy.id, '100000000']);
    expect(r.code, r.err).not.toBe(0);
    expect(r.err).toMatch(/seller: this key did not ask for|no key in .* for/);
    expect(await stateOf(copy.id)).not.toBe('Held');
  }, 90_000);

  it('attack.copy-approve-run: buy-with-signer approve funds no copy a quoting key read, by the copy\'s ID or the quoted one', async () => {
    const dir = store();
    const signer = await keys({}, dir);
    const quote = await signer.quote(realRoute.url, 'rows');
    const copy = await copier.offerFor({ address: signer.address, encryptionPublicKey: signer.encryptionPublicKey });
    await signer.readOffer(copy.id); // the last stop showed the copy
    const byCopy = await run(['examples/buy-with-signer.ts', 'approve', dir, copy.id, '100000000']);
    expect(byCopy.code).not.toBe(0);
    expect(byCopy.err).toMatch(/no key in .* for/);
    const byQuote = await run(['examples/buy-with-signer.ts', 'approve', dir, quote.commitmentId, '100000000']);
    expect(byQuote.code).not.toBe(0);
    expect(byQuote.err).toMatch(/no stop showed/);
    expect(await stateOf(copy.id)).not.toBe('Held');
  }, 90_000);
});

describe('attack 3: quote hosts', () => {
  // Refused before any request: each is plain http off this machine, or not http at all.
  const refused = ['http://127.0.0.1.evil.example/quote', 'http://localhost./quote', 'http://localhost@evil.example/quote', 'http://evil.example/quote', 'HTTP://EVIL.EXAMPLE/quote', 'http://[::ffff:127.0.0.1]:1/quote', 'http://127.0.0.2:1/quote', 'http://0.0.0.0:1/quote', 'ws://localhost:1/quote', 'file:///etc/hosts'];
  // Taken: each names this machine once WHATWG URL parsing has normalised it, so fetch connects to 127.0.0.1 or ::1.
  const local = ['HTTP://LOCALHOST:1/quote', 'http://0x7f000001:1/quote', 'http://2130706433:1/quote', 'http://127.1:1/quote', 'http://[0:0::1]:1/quote', 'http://evil.example@127.0.0.1:1/quote'];
  it('attack.quote-host-forms: refuses every plain-http host off this machine, and takes only forms that normalise to this machine', async () => {
    for (const url of refused) {
      const e = await refusal((await keys()).quote(url, 'rows'));
      expect(e?.message, url).toMatch(/^the quote URL must be https \(or http on this machine\)/);
    }
    for (const url of local) {
      const e = await refusal((await keys()).quote(url, 'rows'));
      expect(e?.message ?? '', url).not.toMatch(/the quote URL must be https/);
    }
  }, 60_000);
});

describe('attack 4: a quote route that redirects to another origin', () => {
  /**
   * One buy through a quote URL whose route redirects to the copier's origin, with no seller named: "refused" when
   * quote, readOffer or checkOffer refuses; otherwise it funds and says what the hold is bound to.
   */
  const throughRedirect = async (status: number): Promise<string> => {
    const hop = await redirector(status, () => copierRoute.url);
    process.env['SCA_QUOTE_CREDENTIAL'] = 'credential-for-the-real-seller';
    try {
      const before = copierRoute.seen.length;
      const signer = await keys({ quoteCredentialEnv: 'SCA_QUOTE_CREDENTIAL' });
      let id: string;
      try {
        id = (await signer.quote(hop.url, 'rows')).commitmentId;
        await signer.checkOffer(id, await signer.readOffer(id));
      } catch {
        expect(copierRoute.seen.length - before, 'the redirect reached the copier').toBe(0);
        return 'refused';
      }
      const got = copierRoute.seen.slice(before);
      // Measured with the fix absent: one POST with this buyer's address and encryption key reached the copier, and
      // no Authorization header (the fetch standard drops it on a cross-origin redirect).
      expect(got.map((g) => [g.method, g.body?.buyer, g.headers.authorization])).toEqual([['POST', signer.address, undefined]]);
      await signer.testFunds(signer.shownOffer!.fees.total.amount);
      await signer.agreeAndFund(id);
      const terms = (await (await fetch(`${demo.urls[1]}/v1/commitments/${id}/terms`)).json()) as J;
      return `${await stateOf(id)}: seller ${terms.seller === copier.address ? 'the copier' : terms.seller}, payout ${terms.sellerPayoutAddress === copier.address ? 'the copier' : terms.sellerPayoutAddress}`;
    } finally {
      delete process.env['SCA_QUOTE_CREDENTIAL'];
      await hop.close();
    }
  };

  it('attack.quote-direct-copier-url: the copier\'s own plain-http URL, given to quote directly, is refused', async () => {
    expect((await refusal((await keys()).quote(copierRoute.url, 'rows')))!.message).toMatch(/^the quote URL must be https/);
  });

  for (const status of [307, 308]) {
    // Found by the PR 814 red team: before the fix, quote followed the redirect (fetch's default) and the copy was
    // funded ("Held: seller the copier, payout the copier"). quote now follows no redirect.
    it(`attack.quote-redirect-${status}: a ${status} from the seller's origin to the copier's is refused before anything is signed`, async () => {
      expect(await throughRedirect(status)).toBe('refused');
    }, 90_000);
  }

  for (const status of [301, 302, 303]) {
    it(`attack.quote-redirect-${status}: a ${status} to the copier's origin funds nothing (followed as a GET with no buyer, so checkOffer refuses buyer; or refused outright)`, async () => {
      const hop = await redirector(status, () => copierRoute.url);
      try {
        const signer = await keys();
        const e = await refusal((async () => {
          const id = (await signer.quote(hop.url, 'rows')).commitmentId;
          await signer.checkOffer(id, await signer.readOffer(id));
        })());
        expect(e, 'the copy passed checkOffer').not.toBeNull();
        expect(signer.paid).toBeUndefined();
      } finally {
        await hop.close();
      }
    }, 60_000);
  }

  it('attack.quote-redirect-named-seller: with the seller named, a redirect is refused at quote, and the copy never bound', async () => {
    const hop = await redirector(307, () => copierRoute.url);
    try {
      const signer = await keys({ seller: real.address });
      expect((await refusal(signer.quote(hop.url, 'rows')))!.message).toMatch(/quote route answered 307, a redirect/);
      expect(signer.commitmentId).toBeUndefined();
    } finally {
      await hop.close();
    }
  }, 60_000);

  /** Crow's buying agent (own-buyer.ts) against a stub signer that records each signing request and signs nothing. */
  const ownBuyer = async (seller: string | undefined): Promise<{ error: string; asked: J[] }> => {
    const asked: J[] = [];
    const float = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
    const stub = createServer(async (req, res) => {
      const body = await bodyOf(req);
      if (req.method === 'GET' && req.url === '/v1/status') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ floatAddress: float, state: 'running' }));
      asked.push(body);
      res.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ rule: 'stub', detail: 'this stub signs nothing' }));
    });
    const port = await listen(stub);
    const hop = await redirector(307, () => copierRoute.url);
    try {
      const e = await refusal(buyThroughSigner({ quoteUrl: hop.url, store: store(), scope: 'rows', most: '100000000', signer: `http://127.0.0.1:${port}`, ...(seller ? { seller } : {}), operators: demo.urls, log: () => {} }));
      return { error: e?.message ?? '', asked };
    } finally {
      await hop.close();
      await closeAll(stub);
    }
  };

  it('attack.own-buyer-redirect-named: own-buyer.ts with the seller named refuses the redirect before the signer is asked', async () => {
    const r = await ownBuyer(real.address);
    expect(r.error).toMatch(/quote route answered 307, a redirect/);
    expect(r.asked).toEqual([]);
  }, 90_000);

  // Same root as attack.quote-redirect-307: before the fix, own-buyer.ts's own checks passed the copy and sent the
  // signer a payment request whose terms.seller was the copier.
  it('attack.own-buyer-redirect: own-buyer.ts with no seller named refuses the redirected copy before the signer is asked', async () => {
    const r = await ownBuyer(undefined);
    expect(r.asked.map((a) => a?.terms?.seller === copier.address ? 'copy' : 'other')).toEqual([]);
  }, 90_000);
});

describe('attack 5: the seller named in another case or format', () => {
  const a = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
  const checksummed = getAddress(a);
  // Flip the case of one letter in the checksummed form: a mixed-case address whose checksum fails.
  const i = [...checksummed].findIndex((ch, k) => k > 1 && /[a-f]/i.test(ch));
  const badSum = checksummed.slice(0, i) + (checksummed[i] === checksummed[i]!.toUpperCase() ? checksummed[i]!.toLowerCase() : checksummed[i]!.toUpperCase()) + checksummed.slice(i + 1);
  const forms = { upper0X: `0X${a.slice(2)}`, spaced: ` ${a}`, trailing: `${a}\n`, ens: 'seller.eth', short: `0x${a.slice(3)}`, badSum };
  it('attack.seller-format-library: makeKeys and sellerOf take lowercase, uppercase and checksummed forms, and refuse each malformed one', async () => {
    for (const ok of [a, a.toUpperCase().replace('0X', '0x'), checksummed]) {
      expect((await keys({ seller: ok })).expectedSeller).toBe(a);
      expect(sellerOf(ok, undefined)).toBe(a);
      expect(sellerOf(undefined, ok)).toBe(a);
    }
    for (const [name, bad] of Object.entries(forms)) {
      await expect(keys({ seller: bad }), name).rejects.toThrow(/seller must be the seller's address/);
      expect(() => sellerOf(bad, undefined), name).toThrow(/CROW_SELLER is not an address/);
      expect(() => sellerOf(undefined, bad), name).toThrow(/the terms file's seller is not an address/);
    }
    // A seller named in case only differs from the terms file's: one seller, taken.
    expect(sellerOf(checksummed, a)).toBe(a);
    // An empty CROW_SELLER is no seller: the commands pass `|| undefined`.
    const empty: string = String(process.env['SCA_UNSET_SELLER'] ?? '');
    expect(sellerOf(empty || undefined, undefined)).toBeUndefined();
  });

  it('attack.seller-format-commands: buy-with-signer.ts refuses a malformed CROW_SELLER before it quotes', async () => {
    const before = realRoute.seen.length;
    for (const bad of [forms.upper0X, forms.spaced, forms.ens, forms.short, forms.badSum]) {
      const r = await run(['examples/buy-with-signer.ts', realRoute.url, store(), '"rows"', '100000000'], { CROW_SELLER: bad });
      expect(r.code, bad).toBe(1);
      expect(r.err, bad).toMatch(/CROW_SELLER is not an address/);
    }
    expect(realRoute.seen.length).toBe(before);
  }, 120_000);
});

describe('attack 2: a copied standing offer (take.ts show)', () => {
  // The offline world of take.test.ts: a pin for a local chain, and the spec example's terms as a template.
  const A = (n: string) => `0x${n.repeat(40)}` as Address;
  const RULES = A('7'), TOKEN = A('a'), ZERO: Hex32 = `0x${'00'.repeat(32)}`;
  const pin: Pin = pinOf({ chainId: 31337, fromBlock: 0, token: { address: TOKEN, name: 'Test USDC', version: '2', symbol: 'tUSDC', decimals: 6 }, escrow: A('8'), erc3009Collector: A('9'), multicall: A('c'), rules: RULES, beacon: A('d'), expiryMarginSec: 86_400 } as J);
  const example = JSON.parse(readFileSync(join(root, 'spec/examples/commitment.example.json'), 'utf8'));
  const { id: _id, signatures: _s, adjudicatorAcceptance: _a, ...exampleTerms } = example; // eslint-disable-line @typescript-eslint/no-unused-vars
  const baseTerms = { ...exampleTerms, price: { ...example.price, token: TOKEN }, adjudication: { ...example.adjudication, fee: { ...example.adjudication.fee, token: TOKEN } }, settlement: { mode: 'guaranteed_on_decision', token: TOKEN } } as CommitmentTerms;
  const realKey = privateKeyToAccount(generatePrivateKey()), copierKey = privateKeyToAccount(generatePrivateKey());
  const template: StandingOffer = templateFrom(baseTerms, { rules: RULES, expiresAt: '2027-01-01T00:00:00Z', offerId: 'csv-1' });
  const entryBy = async (k: typeof realKey): Promise<StandingEntry> => {
    const seller = sellerAddressOf(k.address.toLowerCase() as Address, ZERO);
    return { chainId: 31337, seller, key: k.address.toLowerCase() as Address, salt: ZERO, template: structuredClone(template), signature: await k.sign({ hash: templateDigest(template, seller, 31337) }) };
  };
  const cardOf = (e: StandingEntry, seller: string = e.seller) => ({ type: 'crow-agent', name: 'A seller', seller, offers: [{ id: 'csv-1', description: 'One CSV file.', standing: e }] });
  /** Serves `card` on this machine and runs take.ts show on it with CROW_SELLER; operators that do not answer. */
  const show = async (card: J, crowSeller: string | undefined) => {
    const server = createServer((_q, res) => void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(card)));
    const port = await listen(server);
    const lines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((l: unknown) => void lines.push(String(l)));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const saved = { s: process.env['CROW_SELLER'], o: process.env['HOLDBACK_OPERATORS'] };
    if (crowSeller === undefined) delete process.env['CROW_SELLER'];
    else process.env['CROW_SELLER'] = crowSeller;
    process.env['HOLDBACK_OPERATORS'] = 'http://127.0.0.1:1,http://localhost:1';
    try {
      const code = await take([`http://127.0.0.1:${port}/card.json`, 'csv-1', store(), '100000000']);
      return { code, err: lines.join('\n') };
    } finally {
      for (const [k, v] of [['CROW_SELLER', saved.s], ['HOLDBACK_OPERATORS', saved.o]] as const) if (v === undefined) delete process.env[k];
      else process.env[k] = v;
      await closeAll(server);
    }
  };
  /** Past the CROW_SELLER check: the next step asks the operators, which do not answer here. */
  const passed = /Stopped: (fetch failed|.*127\.0\.0\.1:1)/;

  it('attack.standing-copy-wholesale: the real entry copied onto another card still binds the take to the real seller contract', async () => {
    const e = await entryBy(realKey);
    const onCopierCard = entryOf(JSON.parse(JSON.stringify(cardOf(e))), 'csv-1');
    await checkEntry(onCopierCard, pin);
    const fill: TakeFill = { buyer: A('1'), buyerPaymentAddress: A('1'), buyerEncryptionPublicKey: example.buyerEncryptionPublicKey, nonceSeed: `0x${'55'.repeat(32)}` as Hex32, createdAt: '2026-11-25T00:00:00Z' };
    const t = takeOf(onCopierCard, fill);
    expect(t.terms.seller).toBe(e.seller);
    expect(t.terms.sellerPayoutAddress).toBe(template.terms.sellerPayoutAddress);
  });

  it('attack.standing-copy-resigned: the copier\'s re-signed template passes the offline checks; CROW_SELLER refuses it, naming seller; without CROW_SELLER the card\'s origin decides', async () => {
    const realEntry = await entryBy(realKey), copy = await entryBy(copierKey);
    await checkEntry(copy, pin); // a valid standing offer at the copier's own seller contract
    const refused = await show(cardOf(copy), realEntry.seller);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain(`seller is ${copy.seller}, not the expected "${realEntry.seller}" (CROW_SELLER)`);
    // The copier's card claiming the real seller over its own entry: refused by the card's own seller check.
    expect((await show(cardOf(copy, realEntry.seller), undefined)).err).toMatch(/the card's seller is .* and its standing entry names/);
    // Unnamed: past the seller check, as designed (the card's origin stands for the seller).
    expect((await show(cardOf(copy), undefined)).err).toMatch(passed);
  }, 60_000);

  it('attack.standing-seller-format: take.ts lets no other seller through for any form of CROW_SELLER: each well-formed form of the right address passes, and each malformed one is refused', async () => {
    const e = await entryBy(realKey);
    const cs = getAddress(e.seller);
    const k = [...cs].findIndex((ch, n) => n > 1 && /[a-f]/i.test(ch));
    const badSum = cs.slice(0, k) + (cs[k] === cs[k]!.toUpperCase() ? cs[k]!.toLowerCase() : cs[k]!.toUpperCase()) + cs.slice(k + 1);
    for (const ok of [e.seller, cs]) expect((await show(cardOf(e), ok)).err, ok).toMatch(passed);
    // take.ts checks CROW_SELLER as sellerOf does (PR 814 red team): an uppercase 0X and a failed checksum are refused too.
    for (const odd of [`0X${e.seller.slice(2)}`, badSum]) expect((await show(cardOf(e), odd)).err, odd).toMatch(/CROW_SELLER is not an address/);
    for (const bad of [` ${e.seller}`, 'seller.eth', `0x${e.seller.slice(3)}`]) expect((await show(cardOf(e), bad)).err, bad).toMatch(/CROW_SELLER is not an address/);
  }, 60_000);
});

/** A command from the repository root against this world's operators, as a buyer runs it. */
function run(args: string[], env: Record<string, string> = {}): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, args, { cwd: root, env: { ...process.env, HOLDBACK_OPERATORS: demo.urls.join(','), ...env } });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += String(d)));
    p.stderr.on('data', (d) => (err += String(d)));
    p.on('exit', (code) => resolve({ code, out, err }));
  });
}

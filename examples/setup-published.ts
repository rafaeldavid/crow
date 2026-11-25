// `node setup.mjs check --published <URL> [--other-origin <origin>,...]` (T-478, taking over T-477's criteria 5 to 7):
// reads a live seller's card and its defaults, as an outside buyer's agent would, and says whether the buyer finds
// what the party meant to publish. It runs against any address, so a seller built from the spec can use it too, and
// is made safe to point anywhere:
//
//   - https only; the card comes from agent.json beside the page, never from the HTML page;
//   - no redirect is followed: a redirect fails the check;
//   - every address is resolved first, and one that resolves to a loopback, private, link-local or other
//     non-public address is refused; the connection goes to the address that was checked, never a second lookup;
//   - at most 1,048,576 bytes of a card (T-474's cap) and of a defaults answer are read;
//   - a quote or defaults address on another origin than the card's fails, unless --other-origin names it (a card on
//     a domain's apex with a Worker on workers.dev or a subdomain needs it);
//   - each result is pass or fail with a reason from a fixed list: no word of what an address answered is printed,
//     and no address the card names, only the offer's place in the card;
//   - no quote is sent: asking for a price makes an offer and spends a faucet grant. `first-deal` makes a deal.
import { lookup as dnsLookup } from 'node:dns';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';
import type { CheckResult } from './setup-check.ts';

/** The most bytes of a card or a defaults answer the check reads (T-474: a reading agent caps a whole card). */
export const PUBLISHED_MAX_BYTES = 1_048_576;
const TIMEOUT_MS = 15_000;
const MAX_OFFERS = 32;

/** Addresses no public seller has: loopback, private, link-local, shared, documentation, multicast, reserved. */
const NOT_PUBLIC = new BlockList();
for (const [net, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]] as const) NOT_PUBLIC.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8], ['2001:db8::', 32], ['100::', 64]] as const) NOT_PUBLIC.addSubnet(net, prefix, 'ipv6');

/** Whether `ip` is an address a public seller may have. An IPv4 address carried in an IPv6 one is judged as itself. */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return !NOT_PUBLIC.check(ip, 'ipv4');
  if (family !== 6) return false;
  const v6 = ip.toLowerCase();
  if (NOT_PUBLIC.check(v6, 'ipv6')) return false;
  // ::ffff:a.b.c.d, ::a.b.c.d, 64:ff9b::a.b.c.d (NAT64) and 2002:XXXX:XXXX:: (6to4) carry an IPv4 address.
  const words = expand(v6);
  if (!words) return false;
  const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  if (words.slice(0, 5).every((w) => w === 0) && (words[5] === 0xffff || words[5] === 0)) return isPublicAddress(v4(words[6]!, words[7]!));
  if (words[0] === 0x64 && words[1] === 0xff9b && words.slice(2, 6).every((w) => w === 0)) return isPublicAddress(v4(words[6]!, words[7]!));
  if (words[0] === 0x2002) return isPublicAddress(v4(words[1]!, words[2]!));
  return true;
}
/** The eight 16-bit words of an IPv6 address, or undefined when it is not one. */
function expand(ip: string): number[] | undefined {
  let text = ip;
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (tail) {
    const [a, b, c, d] = tail[1]!.split('.').map(Number) as [number, number, number, number];
    text = `${text.slice(0, -tail[1]!.length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest] = text.split('::') as [string, string | undefined];
  const left = head ? head.split(':') : [];
  const right = rest === undefined ? [] : rest ? rest.split(':') : [];
  const fill = rest === undefined ? 0 : 8 - left.length - right.length;
  const words = [...left, ...Array(Math.max(fill, 0)).fill('0'), ...right].map((w) => parseInt(w, 16));
  return words.length === 8 && words.every((w) => Number.isInteger(w) && w >= 0 && w <= 0xffff) ? words : undefined;
}

/** Why a GET was refused or failed, from a fixed list; or the answer. */
export type Got = { ok: true; status: number; location: boolean; contentType: string; body: Buffer } | { ok: false; reason: string };
/** How the check reads an address. The default resolves, refuses a non-public address, and connects to the one it checked. */
export type Getter = (url: URL) => Promise<Got>;

const REASONS = {
  private: 'resolves to a loopback, private, link-local or other non-public address',
  unresolved: 'does not resolve',
  unreachable: 'could not be reached over https',
  slow: `did not answer within ${TIMEOUT_MS / 1000} s`,
  big: `is over ${PUBLISHED_MAX_BYTES.toLocaleString('en-US')} bytes`,
};

/** GET over https with every rule above: one lookup, checked, and the connection made to that address only. */
export const safeGet: Getter = (url) =>
  new Promise((done) => {
    const literal = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(literal) && !isPublicAddress(literal)) return done({ ok: false, reason: REASONS.private });
    let refused = '';
    const req = request(
      {
        host: literal,
        servername: isIP(literal) ? undefined : literal,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        agent: false,
        headers: { accept: 'application/json', 'user-agent': 'crow-setup-check' },
        // Called by the connection itself: the address checked is the address connected to.
        // Node asks for every address (`all`) when it tries both families; the answer keeps the shape it asked for.
        lookup: ((host: string, opts: { all?: boolean }, cb: (err: Error | null, address: unknown, family?: number) => void) =>
          dnsLookup(host, { all: true }, (err, addrs) => {
            if (err || addrs.length === 0) return (refused = REASONS.unresolved), cb(err ?? new Error('no address'), opts?.all ? [] : '', 4);
            if (addrs.some((a) => !isPublicAddress(a.address))) return (refused = REASONS.private), cb(new Error('not public'), opts?.all ? [] : '', 4);
            if (opts?.all) cb(null, addrs);
            else cb(null, addrs[0]!.address, addrs[0]!.family);
          })) as never,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (d: Buffer) => {
          size += d.length;
          if (size > PUBLISHED_MAX_BYTES) {
            req.destroy();
            done({ ok: false, reason: REASONS.big });
          } else chunks.push(d);
        });
        res.on('end', () => done({ ok: true, status: res.statusCode ?? 0, location: res.headers.location !== undefined, contentType: String(res.headers['content-type'] ?? ''), body: Buffer.concat(chunks) }));
        res.on('error', () => done({ ok: false, reason: REASONS.unreachable }));
      },
    );
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy();
      done({ ok: false, reason: REASONS.slow });
    });
    req.on('error', () => done({ ok: false, reason: refused || REASONS.unreachable }));
    req.end();
  });

/** The card's address from the address the person gave: agent.json beside the page. */
export function cardUrlOf(target: string): URL | string {
  let u: URL;
  try {
    u = new URL(target);
  } catch {
    return 'is not an address';
  }
  if (u.protocol !== 'https:') return 'is not https';
  if (u.username !== '' || u.password !== '') return 'carries a user name or a password';
  u.hash = '';
  u.search = '';
  if (!u.pathname.endsWith('/agent.json')) u.pathname = `${u.pathname.replace(/[^/]*$/, '')}agent.json`;
  return u;
}

/** One JSON object from a GET: the fixed reason it is not one, or the value. */
async function jsonAt(get: Getter, url: URL): Promise<{ value?: unknown; reason?: string }> {
  const got = await get(url);
  if (!got.ok) return { reason: got.reason };
  if (got.status >= 300 && got.status < 400) return { reason: `redirects (status ${got.status}): the check follows no redirect, and a buyer's agent should not either` };
  if (got.status !== 200) return { reason: `answered status ${got.status}, not 200` };
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(got.body)) as unknown;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return { reason: 'is JSON, and not one object' };
    return { value };
  } catch {
    return { reason: 'is not JSON in UTF-8' };
  }
}

const https = (v: unknown): URL | undefined => {
  try {
    const u = new URL(String(v));
    return u.protocol === 'https:' && u.username === '' && u.password === '' ? u : undefined;
  } catch {
    return undefined;
  }
};

/** Origins named with --other-origin: https origins, comma-separated. Throws on anything else. */
export function otherOriginsOf(text: string | undefined): string[] {
  if (text === undefined) return [];
  return text.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const u = https(s);
    if (!u || (u.pathname !== '/' && u.pathname !== '')) throw new Error('--other-origin takes https origins, comma-separated, such as https://seller.example');
    return u.origin;
  });
}

/** The checks of a live card, each with a reason from a fixed list. */
export async function checkPublished(target: string, o: { otherOrigins?: string[]; get?: Getter } = {}): Promise<CheckResult[]> {
  const get = o.get ?? safeGet;
  const out: CheckResult[] = [];
  const say = (check: string, ok: boolean, detail: string, advisory = false) => out.push({ check, ok, detail, ...(advisory ? { advisory: true as const } : {}) });
  const card = cardUrlOf(target);
  if (typeof card === 'string') {
    say('published-address', false, `The address ${card}. Give the https address of the page that carries the card, or of its agent.json.`);
    return out;
  }
  say('published-address', true, `The card is read from ${card.href}.`);
  const read = await jsonAt(get, card);
  if (!read.value) {
    say('published-card', false, `agent.json ${read.reason}.`);
    return out;
  }
  const c = read.value as Record<string, unknown>;
  if (c.type !== 'crow-agent') {
    say('published-card', false, "agent.json is not a crow-agent card: its type is not \"crow-agent\".");
    return out;
  }
  const offers = Array.isArray(c.offers) ? c.offers.slice(0, MAX_OFFERS) : [];
  const quoted = offers.map((x, i) => ({ i, x: x as Record<string, unknown> })).filter(({ x }) => (x?.pricing as Record<string, unknown> | undefined)?.kind === 'quoted');
  if (quoted.length === 0) {
    say('published-card', false, 'The card lists no offer priced by quote: no quote address for a buyer to ask.');
    return out;
  }
  say('published-card', true, `The card is a crow-agent card with ${quoted.length} offer${quoted.length === 1 ? '' : 's'} priced by quote.`);
  const allowed = new Set([card.origin, ...(o.otherOrigins ?? [])]);
  for (const { i, x } of quoted) {
    const at = `Offer ${i + 1} of the card`;
    const pricing = x.pricing as Record<string, unknown>;
    const quote = https(pricing.quote), defaults = https(pricing.defaults);
    if (!quote || !defaults) {
      say('published-origin', false, `${at} ${!pricing.quote || !pricing.defaults ? 'lacks a quote or a defaults address' : 'has a quote or defaults address that is not https'}.`);
      continue;
    }
    const foreign = [quote, defaults].find((u) => !allowed.has(u.origin));
    if (foreign) {
      say('published-origin', false, `${at} names a ${foreign === quote ? 'quote' : 'defaults'} address on another origin than the card's. If that origin is yours, name it with --other-origin; a card that names another party's address sends your buyers to it.`);
      continue;
    }
    say('published-origin', true, `${at}: its quote and defaults addresses are on the card's origin${quote.origin !== card.origin || defaults.origin !== card.origin ? ' or one named with --other-origin' : ''}.`);
    const d = await jsonAt(get, defaults);
    say('published-defaults', d.value !== undefined, d.value !== undefined ? `${at}: the defaults address answers one JSON object.` : `${at}: the defaults address ${d.reason}.`);
  }
  say('published-quote', true, 'Not sent: asking for a price makes an offer and spends a faucet grant. Run first-deal for a deal.', true);
  return out;
}

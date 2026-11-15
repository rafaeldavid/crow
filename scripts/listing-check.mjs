// `node scripts/listing-check.mjs <file>` (T-486, D75): reads the websites on Crow's list of who uses it and says, for
// each, whether the site publishes a valid Crow card. A person runs it, later and by hand: the route that takes a
// listing (apps/early-access/listing.js) fetches nothing. It changes nothing: no entry is written or removed.
//
// The file: one website on each line, with or without the store's `listing:` prefix, or the JSON list that
// `wrangler kv key list` prints for that prefix. Anything that is not an https address is passed over and never
// printed, so a key of another kind (an email sign-up) that got into the file is not echoed.
//
// What it reads: one address for each website, the card beside the site, <website>/agent.json (site/ref/intake.txt).
// A card is valid when it passes site/card.schema.json, whole: a seller's crow-agent card or a buyer's crow-buyer card.
//
// Every byte that comes back is untrusted data:
// - https only, and the website must pass the rule the route applied when it stored it (websiteOf);
// - the name is resolved first, and a name with any loopback, private, link-local or other non-public address is
//   refused. The request then goes to the address that was checked, so a second, different answer from DNS changes
//   nothing;
// - no redirect is followed; the answer is read to MAX_BYTES at most, within TIMEOUT_MS in all;
// - nothing from the answer is executed: it is parsed as JSON and held against the schema, and a parser or checker
//   that throws on it counts as a broken card;
// - nothing from the answer is printed. Each line is the website as the list holds it (through `plain`), a verdict
//   and a reason from a fixed list. Not the card's name, not a schema error's path, not an error's message.
//
// Output: one JSON line for each website, then one line of counts. Exit 0 when the file was read; 2 for a wrong call.
//   {"website":"https://seller.example/","card":"valid","reason":"a seller's card (crow-agent) that passes site/card.schema.json"}
import { lookup } from 'node:dns/promises';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { LISTING_PREFIX, websiteOf } from '../apps/early-access/listing.js';
import { plain } from '../examples/plain.ts';

export const MAX_BYTES = 65_536;
export const TIMEOUT_MS = 5000;
const MAX_FILE_BYTES = 1_048_576;
const MAX_WEBSITES = 5000;

/** Every verdict with every reason it can carry: the only words, beside the website, that a line can hold. */
export const REASONS = Object.freeze({
  valid: { seller: "a seller's card (crow-agent) that passes site/card.schema.json", buyer: "a buyer's card (crow-buyer) that passes site/card.schema.json" },
  broken: { notJson: 'agent.json answered 200 and is not JSON', schema: 'agent.json is JSON and does not pass site/card.schema.json', tooLarge: `agent.json is larger than ${MAX_BYTES} bytes` },
  none: { status: 'agent.json did not answer 200', redirect: 'agent.json answered with a redirect, which is not followed' },
  unreachable: { dns: 'the name did not resolve', timeout: `no answer within ${TIMEOUT_MS / 1000} s`, tls: 'the TLS certificate was not accepted', connection: 'the connection failed' },
  refused: { website: 'not an https address of a public name', address: 'the name resolves to a loopback, private or link-local address' },
});

// Addresses no public website has: this machine, private networks, link-local (the cloud metadata address among
// them), carrier NAT, multicast and reserved ranges; and IPv6's loopback, unique local, link-local and multicast.
const BLOCKED = new BlockList();
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]]) BLOCKED.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [['::', 128], ['::1', 128], ['64:ff9b::', 96], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) BLOCKED.addSubnet(net, bits, 'ipv6');

/** Whether `address` is an IP address a public website can have. An IPv4 address written inside an IPv6 one is read as IPv4. */
export function isPublicAddress(address) {
  const text = String(address);
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(text);
  if (mapped) return isPublicAddress(mapped[1]);
  const kind = isIP(text);
  if (kind === 0) return false;
  if (kind === 6 && /^::ffff:/i.test(text)) return false; // an IPv4 address in hex inside an IPv6 one: not read, so not taken
  return !BLOCKED.check(text, kind === 4 ? 'ipv4' : 'ipv6');
}

/**
 * The websites in the file's text, in order, each once: `{ websites, passedOver }`. A line is a website with or
 * without the store's prefix; a JSON list holds strings or wrangler's `{ "name": "listing:<website>" }` objects.
 * What does not start with https:// is passed over and counted, never returned.
 */
export function websitesIn(text) {
  let items;
  try {
    const parsed = JSON.parse(text);
    items = Array.isArray(parsed) ? parsed.map((e) => (typeof e === 'string' ? e : typeof e?.name === 'string' ? e.name : '')) : null;
  } catch {
    items = null;
  }
  items ??= String(text).split(/\r?\n/);
  const websites = [];
  let passedOver = 0;
  for (const raw of items) {
    const item = String(raw).trim();
    if (item === '') continue;
    const website = item.startsWith(LISTING_PREFIX) ? item.slice(LISTING_PREFIX.length) : item;
    if (!/^https:\/\//i.test(website)) passedOver += 1;
    else if (!websites.includes(website)) websites.push(website);
  }
  return { websites, passedOver };
}

const schema = JSON.parse(readFileSync(new URL('../site/card.schema.json', import.meta.url), 'utf8'));
const passesSchema = new Ajv2020({ strict: true }).compile(schema);

/** Every address the name has, as `[{ address, family }]`. */
const resolveAll = (hostname) => lookup(hostname, { all: true, verbatim: true });

/**
 * One GET of `url` over a connection to `pin`, the address that was checked: `{ status, body }`, `{ status, tooLarge }`
 * or `{ failed }`. It follows no redirect, sends no cookie and no credential, and stops at `maxBytes` or `timeoutMs`.
 */
function getOnce(url, pin, { module, port, ca, timeoutMs, maxBytes }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => done({ failed: 'timeout' }), timeoutMs);
    // The name is not resolved again: the connection goes to the checked address, with the name for TLS and Host.
    const pinned = (_host, options, callback) => (options?.all ? callback(null, [{ address: pin.address, family: pin.family }]) : callback(null, pin.address, pin.family));
    const req = module.request({ hostname: url.hostname, port, path: url.pathname, method: 'GET', headers: { accept: 'application/json', 'user-agent': 'crow-listing-check' }, agent: false, lookup: pinned, ...(ca ? { ca } : {}) }, (res) => {
      if (res.statusCode !== 200) return done({ status: res.statusCode });
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) done({ status: 200, tooLarge: true });
        else chunks.push(chunk);
      });
      res.on('end', () => done({ status: 200, body: Buffer.concat(chunks) }));
      res.on('error', () => done({ failed: 'connection' }));
    });
    req.on('error', (e) => done({ failed: /CERT|TLS|SSL|ALTNAME|SELF_SIGNED|ISSUER|VERIFY/i.test(String(e?.code)) ? 'tls' : 'connection' }));
    req.end();
  });
}

/**
 * Checks one website of the list: `{ website, card, reason }`, with `card` one of valid, broken, none, unreachable,
 * refused and `reason` one of REASONS. `deps` is for tests: `resolve` stands in for DNS, and `dial` names where the
 * connection really goes ({ module, port, address, ca }), so a stand-in server on this machine can answer for a
 * public name. Without `deps` the request goes over https, port 443, to the address that was checked.
 */
export async function checkWebsite(line, deps = {}) {
  const shown = plain(String(line)).slice(0, 200);
  const out = (website, card, reason) => ({ website, card, reason });
  const w = websiteOf(line);
  if (w.error) return out(shown, 'refused', REASONS.refused.website);
  const website = w.website;
  const url = new URL(`${website.replace(/\/+$/, '')}/agent.json`);
  let addresses;
  try {
    addresses = await (deps.resolve ?? resolveAll)(url.hostname);
  } catch {
    return out(website, 'unreachable', REASONS.unreachable.dns);
  }
  if (!Array.isArray(addresses) || addresses.length === 0) return out(website, 'unreachable', REASONS.unreachable.dns);
  if (!addresses.every((a) => isPublicAddress(a?.address))) return out(website, 'refused', REASONS.refused.address);
  const first = addresses[0];
  const dial = deps.dial ?? {};
  const pin = { address: dial.address ?? first.address, family: dial.address ? isIP(dial.address) : first.family === 6 ? 6 : 4 };
  const got = await getOnce(url, pin, { module: dial.module ?? https, port: dial.port ?? 443, ca: dial.ca, timeoutMs: deps.timeoutMs ?? TIMEOUT_MS, maxBytes: MAX_BYTES });
  if (got.failed) return out(website, 'unreachable', REASONS.unreachable[got.failed]);
  if (got.status !== 200) return out(website, 'none', got.status >= 300 && got.status < 400 ? REASONS.none.redirect : REASONS.none.status);
  if (got.tooLarge) return out(website, 'broken', REASONS.broken.tooLarge);
  let card;
  try {
    card = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(got.body));
  } catch {
    return out(website, 'broken', REASONS.broken.notJson);
  }
  let passes = false;
  try {
    passes = passesSchema(card) === true;
  } catch {
    passes = false; // a card built to break the checker is a broken card
  }
  if (!passes) return out(website, 'broken', REASONS.broken.schema);
  return out(website, 'valid', card.type === 'crow-buyer' ? REASONS.valid.buyer : REASONS.valid.seller);
}

/** Checks every website in the file's text, one after another; `say` gets each line as it is known. Returns the counts. */
export async function checkList(text, deps = {}, say = () => {}) {
  const { websites, passedOver } = websitesIn(text);
  const counts = { checked: 0, valid: 0, broken: 0, none: 0, unreachable: 0, refused: 0, passedOver, notChecked: Math.max(0, websites.length - MAX_WEBSITES) };
  for (const website of websites.slice(0, MAX_WEBSITES)) {
    const line = await checkWebsite(website, deps);
    counts.checked += 1;
    counts[line.card] += 1;
    say(line);
  }
  return counts;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (process.argv.length !== 3 || file.startsWith('-')) {
    console.error('usage: node scripts/listing-check.mjs <file>\n  <file> holds one listed website on each line, or the JSON list `wrangler kv key list` prints for the prefix listing:.\n  It prints one JSON line for each website: the website, whether it publishes a valid Crow card, and why. It changes nothing.');
    process.exit(2);
  }
  let text = '';
  try {
    if (statSync(file).size > MAX_FILE_BYTES) throw new Error('too large');
    text = readFileSync(file, 'utf8');
  } catch {
    console.error(`listing-check: cannot read the file, or it is over ${MAX_FILE_BYTES} bytes. Nothing was checked.`);
    process.exit(2);
  }
  const counts = await checkList(text, {}, (line) => console.log(JSON.stringify(line)));
  console.log(JSON.stringify({ summary: counts }));
}

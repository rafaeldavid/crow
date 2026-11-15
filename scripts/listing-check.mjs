// `node scripts/listing-check.mjs <file>` (T-486, D76): reads the websites on Crow's list of who uses it and says, for
// each, whether the site publishes a valid Crow card. A person runs it, later and by hand: the route that takes a
// listing (apps/early-access/listing.js) fetches nothing. It changes nothing: no entry is written or removed.
//
// The file: a read-out of the list. One website on each line, with or without the store's `listing:` prefix, or the
// JSON list that `wrangler kv key list --prefix listing:` prints.
//
// The file is checked before any site is. The store that holds the list also holds the email sign-ups, under another
// prefix, and a mistyped prefix in the read-out command would write them into the file. So when the file holds any
// entry that is not a listed website (a key of another prefix, a line that is no site's address), the script stops:
// it says so on standard error, names how many, tells the person to delete the file, checks none, prints none, and
// exits 1. It never echoes such an entry.
//
// What it reads: one address for each website, the card beside the site, <website>agent.json (site/ref/intake.txt). A
// website is an origin (the route's rule), so the path is always /agent.json. A card is valid when it passes
// site/card.schema.json, whole: a seller's crow-agent card or a buyer's crow-buyer card.
//
// Every byte that comes back is untrusted data:
// - https only, and the website must pass the rule the route applied when it stored it (websiteOf);
// - the name is resolved first, and a name with any address that is not public is refused: IPv4 outside loopback,
//   private, link-local, carrier and reserved ranges; IPv6 only inside 2000::/3, less Teredo, 6to4 and the
//   documentation range, so no IPv4 address written inside an IPv6 one is taken. The request then goes to the address
//   that was checked, so a second, different answer from DNS changes nothing;
// - no redirect is followed; the answer is read to MAX_BYTES at most; the name lookup and the request share one time
//   limit, TIMEOUT_MS;
// - nothing from the answer is executed: it is parsed as JSON and held against the schema, and a parser or checker
//   that throws on it counts as a broken card;
// - nothing from the answer is printed. Each line is the website as the list holds it, a verdict and a reason from a
//   fixed list. Not the card's name, not a schema error's path, not an error's message.
//
// What a run shows the sites: each listed site sees a request from this machine's IP address, at the time of the run.
//
// Output: one JSON line for each website, then one line of counts. Exit 0: the file was read and its websites checked.
// Exit 1: the file is not a read-out of the list; nothing was checked. Exit 2: a wrong call.
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
  refused: { website: "not a site's own https address", address: 'the name resolves to an address that is not public: loopback, private, link-local or reserved' },
});

// IPv4 addresses no public website has: this machine, private networks, link-local (the cloud metadata address among
// them), carrier NAT, the documentation ranges, the 6to4 relay, multicast and reserved ranges.
const BLOCKED4 = new BlockList();
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) BLOCKED4.addSubnet(net, bits, 'ipv4');
// IPv6 is taken only inside the global unicast range, 2000::/3, and there not in a range that carries an IPv4
// address inside it (Teredo, 6to4) or in the documentation range. Everything else is outside by construction:
// loopback, unspecified, mapped, compatible and translated IPv4, unique local, link-local, site-local, multicast.
const GLOBAL6 = new BlockList();
GLOBAL6.addSubnet('2000::', 3, 'ipv6');
const BLOCKED6 = new BlockList();
for (const [net, bits] of [['2001::', 32], ['2001:db8::', 32], ['2002::', 16]]) BLOCKED6.addSubnet(net, bits, 'ipv6');

/** Whether `address` is an IP address a public website can have. Anything the check cannot read is not. */
export function isPublicAddress(address) {
  if (typeof address !== 'string' || address.includes('%')) return false;
  try {
    const kind = isIP(address);
    if (kind === 4) return !BLOCKED4.check(address, 'ipv4');
    if (kind === 6) return GLOBAL6.check(address, 'ipv6') && !BLOCKED6.check(address, 'ipv6');
    return false;
  } catch {
    return false;
  }
}

/**
 * The websites in the file's text, in order, each once, with the count of entries and of entries that are not listed
 * websites: `{ websites, entries, notWebsites }`. An entry is a line, or an item of a JSON list (a string, or
 * wrangler's `{ "name": "listing:<website>" }`); it is a listed website when, with or without the store's prefix, it
 * passes the route's own rule. Nothing that fails it is returned.
 */
export function websitesIn(text) {
  let items;
  const trimmed = String(text).trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      items = Array.isArray(parsed) ? parsed.map((e) => (typeof e === 'string' ? e : typeof e?.name === 'string' ? e.name : null)) : [null];
    } catch {
      items = [null];
    }
  } else {
    items = trimmed === '' ? [] : trimmed.split(/\r?\n/).filter((line) => line.trim() !== '');
  }
  const websites = new Set();
  let notWebsites = 0;
  for (const raw of items) {
    const item = typeof raw === 'string' ? raw.trim() : '';
    const w = websiteOf(item.startsWith(LISTING_PREFIX) ? item.slice(LISTING_PREFIX.length) : item);
    if (w.website) websites.add(w.website);
    else notWebsites += 1;
  }
  return { websites: [...websites], entries: items.length, notWebsites };
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
 * refused and `reason` one of REASONS. `deps` is for tests: `resolve` stands in for DNS, `timeoutMs` for the time
 * limit, and `dial` names where the connection really goes ({ module, port, address, ca }), so a stand-in server on
 * this machine can answer for a public name. Without `deps` the request goes over https, port 443, to the address
 * that was checked.
 */
export async function checkWebsite(line, deps = {}) {
  const out = (website, card, reason) => ({ website, card, reason });
  const w = websiteOf(line);
  if (w.error) return out(plain(String(line)).slice(0, 200), 'refused', REASONS.refused.website);
  const website = w.website;
  const url = new URL('/agent.json', website);
  // One time limit for the whole website: the name lookup, then the request with what is left of it.
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let addresses, timer;
  try {
    addresses = await Promise.race([
      (deps.resolve ?? resolveAll)(url.hostname),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { late: true })), timeoutMs);
      }),
    ]);
  } catch (e) {
    return out(website, 'unreachable', e?.late === true ? REASONS.unreachable.timeout : REASONS.unreachable.dns);
  } finally {
    clearTimeout(timer);
  }
  if (!Array.isArray(addresses) || addresses.length === 0) return out(website, 'unreachable', REASONS.unreachable.dns);
  if (!addresses.every((a) => isPublicAddress(a?.address))) return out(website, 'refused', REASONS.refused.address);
  const first = addresses[0];
  const dial = deps.dial ?? {};
  const pin = { address: dial.address ?? first.address, family: dial.address ? isIP(dial.address) : first.family === 6 ? 6 : 4 };
  const got = await getOnce(url, pin, { module: dial.module ?? https, port: dial.port ?? 443, ca: dial.ca, timeoutMs: Math.max(1, deadline - Date.now()), maxBytes: MAX_BYTES });
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

/**
 * Checks every website in the file's text, one after another; `say` gets each line as it is known. Returns the
 * counts. When the text holds any entry that is not a listed website it checks none, calls `say` for none and returns
 * `{ notAList: { entries, notWebsites } }`.
 */
export async function checkList(text, deps = {}, say = () => {}) {
  const { websites, entries, notWebsites } = websitesIn(text);
  if (notWebsites > 0) return { notAList: { entries, notWebsites } };
  const counts = { checked: 0, valid: 0, broken: 0, none: 0, unreachable: 0, refused: 0, notChecked: Math.max(0, websites.length - MAX_WEBSITES) };
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
    console.error('usage: node scripts/listing-check.mjs <file>\n  <file> is a read-out of the list: one listed website on each line, or the JSON list that `wrangler kv key list --prefix listing:` prints.\n  It prints one JSON line for each website: the website, whether it publishes a valid Crow card, and why. It changes nothing.\n  A file that holds anything but listed websites is refused whole, with exit 1: delete it, and read the list out again.');
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
  if (counts.notAList) {
    const { entries, notWebsites } = counts.notAList;
    console.error(
      [
        'listing-check: STOP. This file is not a read-out of the list.',
        `  ${notWebsites} of ${entries} entries are not listed websites: a key of another kind, or a line that is not a site's address.`,
        '  The store that holds the list also holds the email sign-ups, so this file may hold people\'s email addresses.',
        '  None was checked, and none is printed here.',
        '  Delete the file now. Then read the list out again, with the prefix exactly as written: --prefix listing:',
      ].join('\n'),
    );
    process.exit(1);
  }
  console.log(JSON.stringify({ summary: counts }));
}

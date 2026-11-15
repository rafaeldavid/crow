// The list of who uses Crow (T-486, D75): POST /listing on crow-early-access. A party's own setup command sends one
// request with one field, its website. This route stores one entry for each website in the sign-up store, under its
// own prefix: the website and the time it first arrived. No role, no IP address, no header, no cookie.
//
// What an entry means: Crow keeps the website as a potential partner. Crow may later read the site to see whether it
// publishes a Crow card (scripts/listing-check.mjs, run by a person, never by this route). The entry proves nothing
// about who sent it: anyone can send any website. No operator, test agent, contract or deal reads the list.
//
// The list is private. This route writes and never reads back: no GET serves an entry, and the answer to a POST is the
// same whether the website was new or already there, so a caller cannot ask whether a site is on the list. The route
// fetches nothing.
//
// What the route refuses, before it stores anything: a browser's request (one with an Origin header; the command sends
// none), a body that is not JSON of exactly the one field within LIMITS.bodyBytes, and a website that is not an https
// address of a public name with no user name, password, query, fragment or port. The command applies the same website
// rule before it sends (examples/setup-list.ts; tests/early-access-listing.test.ts holds the two together).
//
// Limits, counted in memory as the operators' report limits are, so a restart resets them: LIMITS.perClientPerHour
// for each client (an IPv4 address or an IPv6 /64) and LIMITS.perDay a UTC day in all. The client's address is a
// counter's key for the hour and is never stored. One website is one entry: a repeat writes nothing.

export const LISTING_PATH = '/listing';
/** The prefix of an entry's key in the sign-up store: `listing:<website>`. */
export const LISTING_PREFIX = 'listing:';
export const LIMITS = Object.freeze({ bodyBytes: 1024, websiteChars: 200, perClientPerHour: 10, perDay: 500 });
/** Names that are never a public website: this machine, a local network, a private zone. */
const LOCAL_ENDINGS = ['.localhost', '.local', '.internal', '.home.arpa'];
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });

/**
 * The website as the URL parser writes it, `{ website }`, or why it is refused, `{ error }`: an https address of a
 * public name, with no user name, password, query, fragment or port, of at most LIMITS.websiteChars characters.
 */
export function websiteOf(text) {
  if (typeof text !== 'string' || text === '') return { error: 'website is an https address, such as https://your-site.example' };
  let u;
  try {
    u = new URL(text);
  } catch {
    return { error: 'website is not an address: give an https address, such as https://your-site.example' };
  }
  if (u.protocol !== 'https:') return { error: 'website must start with https://' };
  if (u.username !== '' || u.password !== '') return { error: 'website must carry no user name or password' };
  if (u.href.includes('?') || u.href.includes('#')) return { error: "website must carry no query and no fragment: a site's address needs neither" };
  if (u.port !== '') return { error: 'website must carry no port' };
  const host = u.hostname.toLowerCase();
  if (host.startsWith('[') || /^\d+(\.\d+){3}$/.test(host)) return { error: 'website must name a site, not an IP address' };
  if (!host.includes('.') || host.endsWith('.') || host === 'localhost' || LOCAL_ENDINGS.some((end) => host.endsWith(end))) return { error: 'website must be a public name, such as your-site.example' };
  if (u.href.length > LIMITS.websiteChars) return { error: `website must be at most ${LIMITS.websiteChars} characters` };
  return { website: u.href };
}

/** The client as the limits count it: an IPv4 address, or the /64 of an IPv6 address; "unknown" with none. */
export function clientKey(ip) {
  const text = String(ip ?? '').trim().toLowerCase();
  if (text === '') return 'unknown';
  if (!text.includes(':')) return text;
  const [head, tail = ''] = text.split('::');
  const left = head === '' ? [] : head.split(':');
  const right = text.includes('::') ? (tail === '' ? [] : tail.split(':')) : [];
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right].slice(0, 4);
  return `${groups.map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/** The two limits, in memory: each client's requests in its hour, and all requests in the UTC day. */
export function makeLimiter(limits = LIMITS) {
  const clients = new Map();
  let day = { start: 0, count: 0 };
  return {
    /** Counts one request of `client` at `nowMs`, or says how long to wait: { ok: true } or { ok: false, retryAfterSec }. */
    take(client, nowMs) {
      const dayStart = Math.floor(nowMs / DAY_MS) * DAY_MS;
      if (day.start !== dayStart) day = { start: dayStart, count: 0 };
      if (clients.size > 10_000) for (const [k, c] of clients) if (nowMs - c.start >= HOUR_MS) clients.delete(k);
      let c = clients.get(client);
      if (!c || nowMs - c.start >= HOUR_MS) c = { start: nowMs, count: 0 };
      if (c.count >= limits.perClientPerHour) return { ok: false, retryAfterSec: Math.ceil((c.start + HOUR_MS - nowMs) / 1000) };
      if (day.count >= limits.perDay) return { ok: false, retryAfterSec: Math.ceil((dayStart + DAY_MS - nowMs) / 1000) };
      c.count += 1;
      day.count += 1;
      clients.set(client, c);
      return { ok: true };
    },
  };
}
const LIMITER = makeLimiter();

/** The bytes of `stream`, or null when it holds more than `max`: the rest is not read. */
async function readCapped(stream, max) {
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/**
 * POST /listing. `deps` is for tests: the clock and the limiter.
 * @param {Request} request
 * @param {{ EMAILS: { get(key: string): Promise<string|null>, put(key: string, value: string): Promise<void> } }} env
 */
export async function listing(request, env, deps = {}) {
  // Any other method gets no entry and no word on what is stored: the list is written here and read nowhere.
  if (request.method !== 'POST') return json(405, { error: 'send a POST' }, { allow: 'POST' });
  if (request.headers.get('origin') !== null) return json(403, { error: 'the list takes a request from the setup command, not from a web page' });
  if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) return json(400, { error: 'send JSON: {"website": "https://..."}' });
  const bytes = request.body ? await readCapped(request.body, LIMITS.bodyBytes) : new Uint8Array();
  if (bytes === null) return json(413, { error: `the body is limited to ${LIMITS.bodyBytes} bytes`, maxBytes: LIMITS.bodyBytes });
  let body;
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return json(400, { error: 'send JSON: {"website": "https://..."}' });
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'send one JSON object with website' });
  if (Object.keys(body).some((k) => k !== 'website')) return json(400, { error: 'send website and nothing else: the list keeps no other field' });
  const w = websiteOf(body.website);
  if (w.error) return json(400, { error: w.error });

  // Refused bodies are not counted: a corrected call keeps its turn.
  const now = (deps.now ?? Date.now)();
  const turn = (deps.limiter ?? LIMITER).take(clientKey(request.headers.get('cf-connecting-ip')), now);
  if (!turn.ok) return json(429, { error: 'too many listings from this client, or for today; nothing was stored, and no deal depends on the list', retryAfterSec: turn.retryAfterSec }, { 'retry-after': String(turn.retryAfterSec) });

  // One website is one entry, written once. The answer is the same for a new website and a known one.
  const key = `${LISTING_PREFIX}${w.website}`;
  if ((await env.EMAILS.get(key)) === null) await env.EMAILS.put(key, JSON.stringify({ website: w.website, receivedAt: new Date(now).toISOString() }));
  return json(200, { ok: true, website: w.website });
}

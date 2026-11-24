// crow-early-access: stores early-access email sign-ups from the ’crow site (crow.direct; served at join.crow.direct).
// One KV entry per address: the email (lowercased), when, and which page. No IP addresses, no cookies, no tracking.
// List sign-ups: npx wrangler@4.151.3 kv key list --binding EMAILS --config apps/early-access/wrangler.jsonc --remote
// The old hostname join.escrow.stream forwards to join.crow.direct (T-312): a 301 for GET and a 308 for any other
// method, which keeps a POST's method and body. A browser sign-up from a page still open on escrow.stream is served in
// place instead, into the same KV namespace: a browser sends a redirected cross-origin POST with Origin null, which
// this Worker would refuse, and a preflight cannot follow a redirect at all.
// GET /version.json names the commit (BUILD_COMMIT, from deploy.mjs) and the live version, for Crow Control (T-413).
// T-462: every answer carries the operators' security headers (apps/demo-cloud/src/headers.ts, T-451), imported and
// not copied: the Worker answers JSON only, and the sign-up form it serves is a drawer on crow.direct's own pages,
// under the site's policy. CORS stays as below: crow.direct's pages post here across origins, and a resource policy
// does not apply to a CORS request. Plain HTTP gets a 301 for a read and a 308 for a write, to HTTPS.
// T-486 (D76): POST /listing takes a website, and nothing else, from a party's own setup command, for Crow's list of
// who uses it, and stores it in the same namespace under the prefix listing: (listing.js). The list is private: no
// route here serves an entry, and no deal reads it.
import { buildInfo, buildResponse, isBuildRead } from '../site/build-info.js';
import { secured } from '../demo-cloud/src/headers.ts';
import { LISTING_PATH, listing } from './listing.js';

// T-581: the write limit. SIGNUP_LIMIT is a Cloudflare rate-limit binding (wrangler.jsonc, 5 writes per 60 s per client);
// a write over it gets 429 before anything is stored. It fails open after 100 ms or on an error, so a Cloudflare outage
// never stops sign-ups. A caller that rotates addresses can still add rows: the limit slows a stranger, it does not
// stop one, and the list is private and sends no email.
const LIMIT_TIMEOUT_MS = 100;
const LIMIT_RETRY_SEC = 60;
async function admitted(env, request) {
  if (!env.SIGNUP_LIMIT) return true;
  const client = request.headers.get('cf-connecting-ip') ?? 'unknown';
  let timer;
  const open = new Promise((resolve) => (timer = setTimeout(() => resolve(true), LIMIT_TIMEOUT_MS)));
  try {
    return await Promise.race([env.SIGNUP_LIMIT.limit({ key: client }).then((r) => r.success, () => true), open]);
  } finally {
    clearTimeout(timer);
  }
}

const ALLOWED = ['https://crow.direct', 'https://www.crow.direct', 'https://escrow.stream', 'https://www.escrow.stream', 'https://npc.here.now', 'https://mighty-canvas-c3tc.here.now'];
const CANONICAL = 'https://join.crow.direct';
const FORWARDED = 'join.escrow.stream';
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;

const cors = (origin) => ({
  'access-control-allow-origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  vary: 'origin',
});
const json = (status, body, origin) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...cors(origin) } });

const isLocal = (host) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');

export default {
  // T-462: every answer leaves through secured(), the one place the security headers are set.
  // An answer that throws (a failed KV write) becomes a 500 with the headers and the CORS answer, so the form shows its
  // own message, instead of Cloudflare's error page, which carries neither.
  async fetch(request, env) {
    return secured(
      await route(request, env).catch((e) => {
        console.error(`crow-early-access: ${e instanceof Error ? e.message : String(e)}`);
        return json(500, { error: 'That didn’t go through. Please try again.' }, request.headers.get('origin') ?? '');
      }),
    );
  },
};

async function route(request, env) {
  const origin = request.headers.get('origin') ?? '';
  const url = new URL(request.url);
  if (url.protocol === 'http:' && !isLocal(url.hostname)) return Response.redirect(`https://${url.host}${url.pathname}${url.search}`, request.method === 'GET' || request.method === 'HEAD' ? 301 : 308);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (url.hostname === FORWARDED && !(request.method === 'POST' && ALLOWED.includes(origin))) {
    return Response.redirect(`${CANONICAL}${url.pathname}${url.search}`, request.method === 'GET' || request.method === 'HEAD' ? 301 : 308);
  }
  if (isBuildRead(request, '/version.json')) return buildResponse(buildInfo({ worker: 'crow-early-access', commit: env.BUILD_COMMIT, metadata: env.CF_VERSION_METADATA }), request.method);
  const write = request.method === 'POST' && (url.pathname === LISTING_PATH || url.pathname === '/early-access');
  if (write && !(await admitted(env, request))) {
    const refusal = json(429, { error: 'Too many sign-ups from this address. Please try again in a minute.' }, origin);
    refusal.headers.set('retry-after', String(LIMIT_RETRY_SEC));
    return refusal;
  }
  if (url.pathname === LISTING_PATH) return listing(request, env);
  if (url.pathname !== '/early-access' || request.method !== 'POST') return json(404, { error: 'not found' }, origin);
  if (!ALLOWED.includes(origin)) return json(403, { error: 'sign up from the ’crow site' }, origin);
  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'send JSON: {"email": "…"}' }, origin);
  }
  if (body && typeof body.company === 'string' && body.company !== '') return json(200, { ok: true }, origin); // honeypot
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !EMAIL.test(email)) return json(400, { error: 'That doesn’t look like an email address.' }, origin);
  const key = `email:${email}`;
  if (!(await env.EMAILS.get(key))) {
    await env.EMAILS.put(key, JSON.stringify({ at: new Date().toISOString(), page: typeof body.page === 'string' ? body.page.slice(0, 120) : '' }));
  }
  return json(200, { ok: true }, origin);
}

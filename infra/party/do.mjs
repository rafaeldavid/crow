// DigitalOcean for the simulated parties' machines (T-485). One small client over the public API, the names and tags
// every party machine carries, and the one rule that decides what may be deleted. The token comes from the
// environment only, and no function here prints it.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const API = 'https://api.digitalocean.com/v2';
/** The variable the token comes from: doctl's own name, and the name `config/secrets/dev-host.refs` gives it. */
export const TOKEN_VAR = 'DIGITALOCEAN_ACCESS_TOKEN';
/** Every party machine carries this tag. The firewall Rafa makes in DigitalOcean's page applies to it. */
export const PARTY_TAG = 'party';
/** Defaults for a party machine (record, section 6): Ubuntu 24.04, 2 vCPU and 4 GB, Frankfurt. */
export const DEFAULTS = Object.freeze({ region: 'fra1', size: 's-2vcpu-4gb', image: 'ubuntu-24-04-x64' });

const RUN = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/;
/** A run ID: lower-case letters, digits and hyphens, 2 to 32 characters. It names the tag and the machines. */
export const isRun = (r) => typeof r === 'string' && RUN.test(r);
export const runTag = (run) => `run-${run}`;
export const machineName = (run, role) => `party-${run}-${role}`;
export const ROLES = Object.freeze(['buyer', 'seller']);

/**
 * The deletion rule, the one place it lives. A machine may be deleted only when the API's own record of it says:
 * it carries the party tag, it carries `tag`, and its name starts with `prefix` (default "party-", the names up.mjs
 * gives). With `olderThanMs`, it must also have been created that long before `now`. The server-side tag filter is
 * not trusted: each machine's tags are read again here.
 * @param {Array<{ id: number, name: string, tags?: string[], created_at?: string }>} droplets
 * @param {{ tag: string, prefix?: string, olderThanMs?: number, now?: number }} rule
 */
export function selectForDeletion(droplets, { tag, prefix = 'party-', olderThanMs, now = Date.now() }) {
  if (!tag) throw new Error('selectForDeletion needs a tag');
  const take = [];
  const leave = [];
  for (const d of droplets) {
    const tags = Array.isArray(d.tags) ? d.tags : [];
    const why = [];
    if (!tags.includes(PARTY_TAG)) why.push(`no ${PARTY_TAG} tag`);
    if (!tags.includes(tag)) why.push(`no ${tag} tag`);
    if (typeof d.name !== 'string' || !d.name.startsWith(prefix)) why.push(`name does not start with ${prefix}`);
    if (olderThanMs !== undefined) {
      const born = Date.parse(d.created_at ?? '');
      if (!Number.isFinite(born)) why.push('no creation time');
      else if (now - born < olderThanMs) why.push('younger than the stated age');
    }
    (why.length ? leave : take).push(why.length ? { droplet: d, why } : d);
  }
  return { take, leave };
}

/** The public IPv4 address the API reports for a machine, if any. */
export const publicV4 = (d) => d?.networks?.v4?.find((n) => n.type === 'public')?.ip_address;

/**
 * DigitalOcean identifies an SSH key by the MD5 fingerprint of its public key blob, as `ssh-keygen -l -E md5` prints
 * it without the "MD5:" prefix.
 * @param {string} publicKeyLine one line of a .pub file
 */
export function md5Fingerprint(publicKeyLine) {
  const blob = String(publicKeyLine).trim().split(/\s+/)[1];
  if (!blob || !/^[A-Za-z0-9+/]+=*$/.test(blob)) throw new Error('not an OpenSSH public key line');
  return createHash('md5').update(Buffer.from(blob, 'base64')).digest('hex').match(/../g).join(':');
}
export const fingerprintOfFile = (path) => md5Fingerprint(readFileSync(path, 'utf8'));

/** One request, as a dry run prints it. The token is named, never shown. */
export function describe(method, path, body) {
  const lines = [`${method} ${API}${path}`, `  Authorization: Bearer <${TOKEN_VAR}, not shown>`];
  if (body !== undefined) {
    const shown = { ...body };
    if (typeof shown.user_data === 'string') shown.user_data = `<infra/party/cloud-init.yaml, ${Buffer.byteLength(body.user_data)} bytes>`;
    lines.push(`  Content-Type: application/json`, ...JSON.stringify(shown, null, 2).split('\n').map((l) => `  ${l}`));
  }
  return lines.join('\n');
}

/**
 * The client. With `dryRun` it sends nothing: each call prints the request and returns { dry: true }.
 * @param {{ token?: string, fetch?: typeof fetch, dryRun?: boolean, log?: (l: string) => void }} o
 */
export function client({ token, fetch: f = globalThis.fetch, dryRun = false, log = (l) => console.log(l) }) {
  if (!dryRun && (!token || token.startsWith('op://'))) throw new Error(`${TOKEN_VAR} is not set: run under infra/dev-host/with-keys.sh or op run with config/secrets/dev-host.refs`);
  async function call(method, path, body) {
    if (dryRun) { log(describe(method, path, body)); return { dry: true, status: 0 }; }
    const r = await f(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let json;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
    return { status: r.status, json };
  }
  /** Every machine carrying `tag`, following the API's pages. */
  async function listByTag(tag) {
    const all = [];
    let path = `/droplets?tag_name=${encodeURIComponent(tag)}&per_page=200`;
    for (let page = 1; page <= 50; page++) {
      const r = await call('GET', `${path}&page=${page}`);
      if (r.dry) return { dry: true, droplets: [] };
      if (r.status !== 200) return { status: r.status, droplets: all };
      all.push(...(r.json?.droplets ?? []));
      if (!r.json?.links?.pages?.next) return { status: 200, droplets: all };
    }
    return { status: 200, droplets: all, truncated: true };
  }
  /** Every machine the token can see, following the pages (the team test reads this). */
  async function listAll() {
    const all = [];
    for (let page = 1; page <= 50; page++) {
      const r = await call('GET', `/droplets?per_page=200&page=${page}`);
      if (r.dry) return { dry: true, droplets: [] };
      if (r.status !== 200) return { status: r.status, droplets: all };
      all.push(...(r.json?.droplets ?? []));
      if (!r.json?.links?.pages?.next) return { status: 200, droplets: all };
    }
    return { status: 200, droplets: all, truncated: true };
  }
  return { call, listByTag, listAll };
}

/** "6h", "90m", "2d" in milliseconds; undefined when malformed. */
export function parseAge(s) {
  const m = /^([0-9]{1,6})(m|h|d)$/.exec(String(s ?? ''));
  if (!m) return undefined;
  return Number(m[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]];
}

/** The common flags: --name value pairs and bare switches. Unknown flags are an error, reported by name. */
export function parseArgs(argv, { values = [], switches = [] }) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const k = a.slice(2);
    if (switches.includes(k)) o[k] = true;
    else if (values.includes(k) && i + 1 < argv.length) o[k] = argv[++i];
    else throw new Error(`unknown or incomplete option ${a.slice(0, 40)}`);
  }
  return o;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

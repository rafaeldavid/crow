// How the benchmark harness counts an agent's API calls without changing a response (T-412, from T-328's outsider.mjs):
// - a fetch() probe, preloaded into every Node process the agent starts (`--import`), logs method, origin, path (no
//   query), status and ms;
// - a `curl` wrapper first on the agent's PATH logs each call's arguments and the response status lines.
// The scripted runs use the fetch probe only (their agents are Node scripts); the live runs use both, and a `node`
// wrapper, because Claude Code drops NODE_OPTIONS from its commands' environment (T-328, run s1).
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const q1 = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** An address: 0x and 40 hex digits, not part of a longer hex run (a commitment ID is 64). T-473's request rule. */
export const ADDRESS = /(^|[^0-9a-fA-F])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/;

// curl's short flags that take a value: what follows them in the same word is that value, not more flags.
const CURL_VALUE_FLAGS = new Set('AbcCDeEhHKmoPQrtuUwxYyz'.split(''));
/**
 * The HTTP method of a curl command line, from its words as the wrapper logged them (T-473 review, finding 1). An
 * explicit -X/--request wins; -G/--get is a GET and -I/--head a HEAD; any body flag (-d, -F, -T, attached or in a group
 * such as -sd, --data*, --json, --form*, --upload-file) is a POST. Otherwise GET.
 */
export function curlMethodOf(argv) {
  const words = String(argv).trim().split(/\s+/).filter(Boolean);
  let explicit = null;
  let body = false;
  let get = false;
  let head = false;
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    if (w === '--request') explicit = words[i + 1] ?? null;
    else if (w.startsWith('--request=')) explicit = w.slice('--request='.length);
    else if (/^--(data|json|form|upload-file)/.test(w)) body = true;
    else if (w === '--get') get = true;
    else if (w === '--head') head = true;
    else if (/^-[^-]/.test(w)) {
      for (let j = 1; j < w.length; j += 1) {
        const c = w[j];
        if (c === 'X') {
          explicit = w.slice(j + 1) || (words[i + 1] ?? null);
          break;
        }
        if (c === 'd' || c === 'F' || c === 'T') {
          body = true;
          break; // the rest of the word is the body's value
        }
        if (c === 'G') get = true;
        else if (c === 'I') head = true;
        else if (CURL_VALUE_FLAGS.has(c)) break;
      }
    }
  }
  if (explicit && /^[A-Za-z]{1,16}$/.test(explicit)) return explicit.toUpperCase();
  return get ? 'GET' : head ? 'HEAD' : body ? 'POST' : 'GET';
}

/** Writes the fetch probe into `dir`; returns its path and its log's path. Paths are written in literally. */
export function writeFetchProbe(dir) {
  mkdirSync(dir, { recursive: true });
  const log = join(dir, 'fetch.jsonl');
  const path = join(dir, 'fetch-log.mjs');
  writeFileSync(
    path,
    `// Logs each fetch() for a benchmark run (T-412): method, origin, path (no query), status, ms, and whether the query
// holds an address (T-473), never the query itself. Responses are unchanged.
import { appendFileSync } from 'node:fs';
const orig = globalThis.fetch;
const ADDRESS = ${ADDRESS};
if (typeof orig === 'function') {
  globalThis.fetch = async function (input, init) {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    let where = { origin: null, path: null, queryHasAddress: false };
    try { const u = new URL(href); where = { origin: u.origin, path: u.pathname, queryHasAddress: ADDRESS.test(u.search) }; } catch {}
    const method = String(init?.method ?? input?.method ?? 'GET').toUpperCase();
    const t = Date.now();
    try {
      const r = await orig.call(this, input, init);
      try { appendFileSync(${JSON.stringify(log)}, JSON.stringify({ at: t, ms: Date.now() - t, method, ...where, status: r.status }) + '\\n'); } catch {}
      return r;
    } catch (e) {
      try { appendFileSync(${JSON.stringify(log)}, JSON.stringify({ at: t, ms: Date.now() - t, method, ...where, status: null }) + '\\n'); } catch {}
      throw e;
    }
  };
}
`,
  );
  return { path, log };
}

/** Writes `curl` and `node` wrappers into `<dir>/bin` for a live run; returns the bin folder and the curl log. */
export function writeShellProbes(dir, fetchProbe, nodePath = process.execPath) {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const curlLog = join(dir, 'curl.log');
  writeFileSync(
    join(bin, 'curl'),
    `#!/bin/sh
# Logs each curl call for a benchmark run (T-412), then runs the system curl with a header dump. Output is unchanged.
hdr=${q1(dir)}/curl-hdr-$$-$(date +%s).txt
printf '%s\\t%s\\t' "$(date +%s)" "$hdr" >> ${q1(curlLog)}
printf '%s ' "$@" | tr '\\n' ' ' >> ${q1(curlLog)}
printf '\\n' >> ${q1(curlLog)}
/usr/bin/curl -D "$hdr" "$@"
`,
  );
  chmodSync(join(bin, 'curl'), 0o755);
  writeFileSync(join(bin, 'node'), `#!/bin/sh\nexec ${q1(nodePath)} --import=${q1(fetchProbe)} "$@"\n`);
  chmodSync(join(bin, 'node'), 0o755);
  return { bin, curlLog };
}

/**
 * The calls the probes logged, as { via, at, method, origin, path, status, queryHasAddress }. `at` is when the call
 * started, in ms since the epoch: to the millisecond from the fetch probe, to the second from the curl wrapper
 * (`date +%s`, so a curl call in the marker's own second reads as before it), null when the log has none.
 * `queryHasAddress` says whether the query held an address; the query itself is never kept. Torn lines are skipped.
 */
export function readCalls({ fetchLog = null, curlLog = null } = {}) {
  const calls = [];
  if (fetchLog && existsSync(fetchLog)) {
    for (const line of readFileSync(fetchLog, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        calls.push({ via: 'fetch', at: Number.isSafeInteger(e.at) ? e.at : null, method: String(e.method ?? 'GET'), origin: e.origin ?? null, path: e.path ?? null, status: Number.isSafeInteger(e.status) ? e.status : null, queryHasAddress: e.queryHasAddress === true });
      } catch {
        // a torn line
      }
    }
  }
  if (curlLog && existsSync(curlLog)) {
    for (const line of readFileSync(curlLog, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const [sec, hdr, argv = ''] = line.split('\t');
      const at = /^\d{1,13}$/.test(sec) ? Number(sec) * 1000 : null;
      const urls = argv.match(/https?:\/\/[^\s'"]+/g) ?? [];
      const method = curlMethodOf(argv);
      let statuses = [];
      try {
        statuses = (readFileSync(hdr, 'utf8').match(/^HTTP\/[\d.]+\s+(\d{3})/gm) ?? []).map((s) => Number(s.split(/\s+/)[1]));
      } catch {
        statuses = [];
      }
      for (const [i, href] of urls.entries()) {
        let where = { origin: null, path: null, queryHasAddress: false };
        try {
          const u = new URL(href);
          where = { origin: u.origin, path: u.pathname, queryHasAddress: ADDRESS.test(u.search) };
        } catch {
          // not a URL
        }
        calls.push({ via: 'curl', at, method, ...where, status: statuses[i] ?? statuses[statuses.length - 1] ?? null });
      }
    }
  }
  return calls;
}

/** The name of the file the setup command's first-deal step writes in its folder (T-473, with T-472). */
export const MARKER_FILE = 'first-deal.started';

/**
 * The text of each first-deal marker file under `dir`, at most `depth` folders down; [] when there is none. It follows
 * no symbolic link and reads at most 20 files of at most 4 KiB, so an agent's folder cannot make the harness read much.
 */
export function markerFilesUnder(dir, depth = 4) {
  const found = [];
  const walk = (d, left) => {
    let entries = [];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (found.length >= 20) return;
      const p = join(d, e.name);
      if (e.isFile() && e.name === MARKER_FILE) {
        try {
          if (statSync(p).size <= 4096) found.push(readFileSync(p, 'utf8'));
        } catch {
          // gone, or unreadable
        }
      } else if (e.isDirectory() && left > 0 && e.name !== 'node_modules') walk(p, left - 1);
    }
  };
  walk(dir, depth);
  return found;
}

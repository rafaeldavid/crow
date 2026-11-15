#!/usr/bin/env node
// The party's check (T-485; record, section 6, "A simulated party's machine"). up.mjs runs it on each new machine;
// run it again at any time with:
//   infra/dev-host/with-keys.sh node infra/party/check.mjs --run <id> [--yes]
// It prints one line per check, names only, and exits 1 when any check fails. The lines:
// - on the machine (probe.sh): the home is empty; no path holds a file of the project, by name or content; no cloud
//   token in its environment or its metadata; password and root logins off; security updates on; Node at the major
//   version `.nvmrc` pins; the assistant's tool installed;
// - from here: its outbound address, read by an address-echo service, is its own public address in the cloud's
//   record, and differs from the address of every other running party machine.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { attest, ROOT } from '../lib/attest.mjs';
import { client, isRun, parseArgs, PARTY_TAG, publicV4, runTag, TOKEN_VAR } from './do.mjs';
import { ssh } from './ssh.mjs';

export const PROBE = join(ROOT, 'infra', 'party', 'probe.sh');
export const nodeMajor = () => readFileSync(join(ROOT, '.nvmrc'), 'utf8').trim().replace(/^v/, '').split('.')[0];

/**
 * The party's check for one machine. Returns the lines and whether all passed.
 * @param {{ droplet: object, others: object[], run: string, exec?: typeof ssh, major?: string }} o
 */
export function checkParty({ droplet, others, run, exec = ssh, major = nodeMajor() }) {
  const lines = [];
  const ip = publicV4(droplet);
  if (!ip) return { ok: false, lines: [['fail', 'the machine has a public IPv4 address']] };
  const r = exec({ ip, run }, ['bash', '-s', '--', major], { input: readFileSync(PROBE, 'utf8'), timeoutMs: 180_000 });
  const seen = new Set();
  let echo;
  for (const l of r.stdout.split('\n')) {
    const m = /^(ok|fail|echo) ([a-z0-9.-]+)$/.exec(l.trim());
    if (!m) continue;
    if (m[1] === 'echo') { echo = m[2]; continue; }
    seen.add(m[2]);
    lines.push([m[1], m[2]]);
  }
  for (const want of ['home-empty', 'no-project-file-by-name', 'no-project-file-by-content', 'no-cloud-token-in-environment', 'user-data-holds-no-secret', 'password-and-root-login-off', 'security-updates-on', 'node-at-pinned-major', 'assistant-tool-installed'])
    if (!seen.has(want)) lines.push(['fail', `${want} (the probe did not report it${r.code !== 0 ? `; ssh exit ${r.code}` : ''})`]);
  const own = echo && echo !== 'none' && echo === ip;
  lines.push([own ? 'ok' : 'fail', 'outbound-address-is-its-own']);
  const otherIps = others.filter((d) => d.id !== droplet.id).map(publicV4).filter(Boolean);
  const apart = Boolean(echo) && echo !== 'none' && !otherIps.includes(echo) && !otherIps.includes(ip);
  lines.push([apart ? 'ok' : 'fail', `outbound-address-differs-from-every-other-party (${otherIps.length} other${otherIps.length === 1 ? '' : 's'} running)`]);
  return { ok: lines.every(([s]) => s === 'ok'), lines };
}

export function printLines(lines, log = (l) => console.log(l)) {
  for (const [s, n] of lines) log(`  ${s === 'ok' ? 'ok  ' : 'FAIL'}  ${n}`);
}

async function main() {
  let a;
  try { a = parseArgs(process.argv.slice(2), { values: ['run'], switches: ['yes'] }); } catch (e) { console.error(`check: ${e.message}`); process.exit(2); }
  if (!isRun(a.run)) { console.error('check: --run <id> is required (lower-case letters, digits, hyphens)'); process.exit(2); }
  if (!(await attest({ title: 'The party check', files: [import.meta.filename, PROBE, join(ROOT, 'infra', 'party', 'do.mjs'), join(ROOT, 'infra', 'party', 'ssh.mjs'), join(ROOT, 'infra', 'lib', 'attest.mjs')], yes: a.yes }))) process.exit(1);
  const api = client({ token: process.env[TOKEN_VAR] });
  const mine = await api.listByTag(runTag(a.run));
  const all = await api.listByTag(PARTY_TAG);
  if (mine.status !== 200 || all.status !== 200) { console.error(`check: the API answered ${mine.status}/${all.status}`); process.exit(1); }
  if (mine.droplets.length === 0) { console.error(`check: no machine carries ${runTag(a.run)}`); process.exit(1); }
  let ok = true;
  for (const d of mine.droplets) {
    console.log(`${d.name}:`);
    const r = checkParty({ droplet: d, others: all.droplets, run: a.run });
    printLines(r.lines);
    ok &&= r.ok;
  }
  console.log(ok ? 'check: every line passed.' : 'check: a line failed: see above.');
  process.exit(ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();

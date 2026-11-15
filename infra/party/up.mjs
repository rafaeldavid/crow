#!/usr/bin/env node
// Makes one simulated party's machine (T-485; record, section 6): a fresh Ubuntu machine in the team crow-parties,
// from infra/party/cloud-init.yaml, reached over SSH, provisioned and checked.
//
//   infra/dev-host/with-keys.sh node infra/party/up.mjs --role <buyer|seller> --run <id> [--publish] [--yes]
//   node infra/party/up.mjs --role buyer --run <id> --dry-run      prints the requests, sends nothing, needs no token
//
// The token comes from DIGITALOCEAN_ACCESS_TOKEN only. The run's tag is required. A run holds at most one buyer and one
// seller: a second machine of the same role is refused, so each starts clean. Options: --region, --size, --image (defaults in do.mjs), --ssh-key <public key
// file> (default ~/.ssh/crow-party.pub), --keep (keep the machine when its check fails; by default it is destroyed).
// Exit 0 when the machine passed its check, 1 when anything failed, 2 on a usage error.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { attest, ROOT } from '../lib/attest.mjs';
import { checkParty, nodeMajor, printLines, PROBE } from './check.mjs';
import { client, DEFAULTS, fingerprintOfFile, isRun, machineName, parseArgs, PARTY_TAG, publicV4, ROLES, runTag, selectForDeletion, sleep, TOKEN_VAR } from './do.mjs';
import { KEY, ssh } from './ssh.mjs';

export const CLOUD_INIT = join(ROOT, 'infra', 'party', 'cloud-init.yaml');
export const PROVISION = join(ROOT, 'infra', 'party', 'provision.sh');

/** The create request, built from the reviewed cloud-init file as it is: nothing is added to it. */
export function createBody({ run, role, region = DEFAULTS.region, size = DEFAULTS.size, image = DEFAULTS.image, fingerprint, userData }) {
  return {
    name: machineName(run, role),
    region, size, image,
    ssh_keys: [fingerprint],
    tags: [PARTY_TAG, runTag(run), `role-${role}`],
    user_data: userData,
    ipv6: false, backups: false, monitoring: false, with_droplet_agent: false,
  };
}

/**
 * The whole run, with every outside effect passed in, so the tests drive it with a stub API and a stub SSH.
 * @param {object} o parsed options
 * @param {{ api: ReturnType<typeof client>, exec?: typeof ssh, wait?: (ms: number) => Promise<void>, now?: () => number,
 *   log?: (l: string) => void, fingerprint: string, userData: string, provision?: string, major?: string,
 *   limits?: { activeMs: number, sshMs: number } }} d
 */
export async function up(o, d) {
  const log = d.log ?? ((l) => console.log(l));
  const exec = d.exec ?? ssh;
  const wait = d.wait ?? sleep;
  const now = d.now ?? Date.now;
  const limits = d.limits ?? { activeMs: 300_000, sshMs: 300_000 };
  const tag = runTag(o.run);
  const body = createBody({ ...o, fingerprint: d.fingerprint, userData: d.userData });

  if (o['dry-run']) {
    log('Dry run: these are the requests up.mjs sends first. Nothing is sent.');
    await d.api.call('GET', `/account/keys/${d.fingerprint}`);
    await d.api.listByTag(tag);
    for (const t of body.tags) await d.api.call('POST', '/tags', { name: t });
    await d.api.call('POST', '/droplets', body);
    log(`Then: GET ${'/droplets/<id from the reply>'} every 5 s until it is active; ssh party@<its address>; cloud-init status --wait;`);
    log(`sudo bash -s -- --node-major ${d.major ?? nodeMajor()}${o.publish ? ' --publish' : ''} < infra/party/provision.sh; then the party check (infra/party/check.mjs).`);
    return { ok: true, dry: true };
  }

  const key = await d.api.call('GET', `/account/keys/${d.fingerprint}`);
  if (key.status !== 200) { log(`up: the SSH key ${d.fingerprint} is not in the team (API ${key.status}). Add its public half in DigitalOcean's page, team crow-parties.`); return { ok: false }; }
  const before = await d.api.listByTag(tag);
  if (before.status !== 200) { log(`up: listing ${tag} failed (API ${before.status})`); return { ok: false }; }
  // A run may hold one buyer and one seller; a second machine of the same role is refused, so each starts clean.
  if (before.droplets.some((x) => x.name === body.name)) { log(`up: ${body.name} already exists. Run down.mjs --run ${o.run} first, or pick a new run ID.`); return { ok: false }; }
  for (const t of body.tags) {
    const r = await d.api.call('POST', '/tags', { name: t });
    if (r.status !== 201 && r.status !== 200 && r.status !== 422) { log(`up: making tag ${t} failed (API ${r.status})`); return { ok: false }; }
  }
  const t0 = now();
  const made = await d.api.call('POST', '/droplets', body);
  const id = made.json?.droplet?.id;
  if (made.status !== 202 || !id) { log(`up: the create request failed (API ${made.status}${made.json?.message ? `: ${String(made.json.message).slice(0, 120)}` : ''})`); return { ok: false }; }
  log(`up: ${body.name} (${id}) requested in ${body.region}, size ${body.size}.`);

  const fail = async (why) => {
    log(`up: ${why}`);
    if (o.keep) { log(`up: kept, as --keep asked. Destroy it with: node infra/party/down.mjs --run ${o.run}`); return { ok: false, id }; }
    const { take } = selectForDeletion([made.json.droplet], { tag });
    for (const x of take) await d.api.call('DELETE', `/droplets/${x.id}`);
    log(take.length ? `up: destroyed ${body.name}.` : `up: ${body.name} does not carry the tags up.mjs gave it, so it was left alone: check the team in DigitalOcean's page.`);
    return { ok: false, id };
  };

  let droplet;
  while (now() - t0 < limits.activeMs) {
    const r = await d.api.call('GET', `/droplets/${id}`);
    droplet = r.json?.droplet;
    if (droplet?.status === 'active' && publicV4(droplet)) break;
    droplet = undefined;
    await wait(5000);
  }
  if (!droplet) return fail(`the machine was not active with a public address within ${limits.activeMs / 1000} s`);
  const activeS = Math.round((now() - t0) / 1000);
  const target = { ip: publicV4(droplet), run: o.run };

  let reached = false;
  while (now() - t0 < limits.activeMs + limits.sshMs) {
    if (exec(target, ['true'], { timeoutMs: 15_000 }).code === 0) { reached = true; break; }
    await wait(5000);
  }
  if (!reached) return fail('SSH did not answer in time');
  const sshS = Math.round((now() - t0) / 1000);
  // cloud-init exits 0 when done, 2 when done with recoverable warnings, 1 on an error.
  const ci = exec(target, ['cloud-init', 'status', '--wait'], { timeoutMs: 900_000 });
  if (ci.code !== 0 && ci.code !== 2) return fail(`cloud-init did not finish (exit ${ci.code})`);
  if (ci.code === 2) log('up: cloud-init finished with recoverable warnings; the party check decides.');
  const pv = exec(target, ['sudo', 'bash', '-s', '--', '--node-major', d.major ?? nodeMajor(), ...(o.publish ? ['--publish'] : [])], { input: d.provision ?? readFileSync(PROVISION, 'utf8'), timeoutMs: 900_000 });
  if (pv.code !== 0) return fail(`provision.sh failed (exit ${pv.code})`);

  const others = await d.api.listByTag(PARTY_TAG);
  const c = checkParty({ droplet, others: others.droplets ?? [], run: o.run, exec, major: d.major });
  log(`${body.name}: active after ${activeS} s, SSH after ${sshS} s. The party check:`);
  printLines(c.lines, log);
  if (!c.ok) return fail('the party check failed');
  log(`up: ready. Reach it with: ssh -i ${KEY} -o UserKnownHostsFile=~/.local/state/crow-party/known_hosts-${o.run} party@${target.ip}`);
  log(`up: destroy it with: node infra/party/down.mjs --run ${o.run}`);
  return { ok: true, id, activeS, sshS };
}

async function main() {
  let a;
  try { a = parseArgs(process.argv.slice(2), { values: ['role', 'run', 'region', 'size', 'image', 'ssh-key'], switches: ['dry-run', 'yes', 'publish', 'keep'] }); } catch (e) { console.error(`up: ${e.message}`); process.exit(2); }
  if (!ROLES.includes(a.role)) { console.error('up: --role buyer or --role seller is required'); process.exit(2); }
  if (!isRun(a.run)) { console.error('up: --run <id> is required: 2 to 32 lower-case letters, digits or hyphens. It names the tag that down.mjs deletes by.'); process.exit(2); }
  if (a.publish && a.role !== 'seller') { console.error('up: --publish is for a seller'); process.exit(2); }
  const pub = a['ssh-key'] ?? `${KEY}.pub`;
  let fingerprint;
  try { fingerprint = fingerprintOfFile(pub); } catch { console.error(`up: no OpenSSH public key at ${pub} (setup-user.sh makes ~/.ssh/crow-party)`); process.exit(2); }
  const files = [import.meta.filename, CLOUD_INIT, PROVISION, PROBE, join(ROOT, 'infra', 'party', 'check.mjs'), join(ROOT, 'infra', 'party', 'do.mjs'), join(ROOT, 'infra', 'party', 'ssh.mjs'), join(ROOT, 'infra', 'lib', 'attest.mjs')];
  if (!(await attest({ title: `up: a ${a.role} machine for run ${a.run}`, files, dryRun: a['dry-run'], yes: a.yes }))) process.exit(1);
  let api;
  try { api = client({ token: process.env[TOKEN_VAR], dryRun: a['dry-run'] }); } catch (e) { console.error(`up: ${e.message}`); process.exit(2); }
  const r = await up(a, { api, fingerprint, userData: readFileSync(CLOUD_INIT, 'utf8') });
  process.exit(r.ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();

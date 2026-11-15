#!/usr/bin/env node
// The team test of move step 4 (T-485; record, section 5): does the crow-parties token stop at its own team?
// DigitalOcean's pages do not say, so this measures it before any machine reads the vault. Rafa runs both commands
// on his own Mac, with the Claude desktop app quit, after he made one throwaway machine by hand in his default team:
//
//   op run --env-file=config/secrets/dev-host.refs -- node infra/party/team-test.mjs make --run <id>
//   op run --env-file=config/secrets/dev-host.refs -- node infra/party/team-test.mjs probe --run <id> --other <ID of the default team's machine>
//
// `make` creates the smallest machine in crow-parties, tagged party and run-<id>. `probe` then tries, with the
// crow-parties token, to list, read by ID, snapshot and delete the other team's machine (each must be refused), and
// to list, read and delete its own (each must succeed). Its last step deletes its own machine. Add --dry-run to
// print the requests without sending them. Exit 0 when the boundary held, 1 when it did not or a step could not
// run, 2 on a usage error.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { attest, ROOT } from '../lib/attest.mjs';
import { client, DEFAULTS, fingerprintOfFile, isRun, machineName, parseArgs, PARTY_TAG, runTag, selectForDeletion, TOKEN_VAR } from './do.mjs';
import { KEY } from './ssh.mjs';

const SIZE = 's-1vcpu-512mb-10gb';
const refused = (s) => s === 403 || s === 404;
const accepted = (s) => s >= 200 && s < 300;

/** @param {{ run: string, fingerprint: string }} o @param {{ api: ReturnType<typeof client>, log?: (l: string) => void }} d */
export async function make(o, d) {
  const log = d.log ?? ((l) => console.log(l));
  for (const t of [PARTY_TAG, runTag(o.run)]) await d.api.call('POST', '/tags', { name: t });
  const r = await d.api.call('POST', '/droplets', { name: machineName(o.run, 'team-test'), region: DEFAULTS.region, size: SIZE, image: DEFAULTS.image, ssh_keys: o.fingerprint ? [o.fingerprint] : [], tags: [PARTY_TAG, runTag(o.run)], ipv6: false, backups: false, monitoring: false, with_droplet_agent: false });
  if (r.dry) return { ok: true, dry: true };
  const id = r.json?.droplet?.id;
  log(r.status === 202 && id ? `team-test: made ${machineName(o.run, 'team-test')} (${id}) in crow-parties. Next: the probe, with the default team's machine's ID.` : `team-test: the create request answered ${r.status}`);
  return { ok: r.status === 202 && Boolean(id), id };
}

/**
 * @param {{ run: string, other: string }} o
 * @param {{ api: ReturnType<typeof client>, log?: (l: string) => void }} d
 */
export async function probe(o, d) {
  const log = d.log ?? ((l) => console.log(l));
  const lines = [];
  const line = (ok, name, note = '') => lines.push([ok, name, note]);
  if (d.api.dry) {
    log('Dry run: the requests the probe sends, in order. Nothing is sent.');
  }
  const other = o.other;
  // The other team's machine: every step must be refused.
  const all = await d.api.listAll();
  const mineList = await d.api.listByTag(runTag(o.run));
  if (all.dry) {
    for (const [m, p, b] of [['GET', `/droplets/${other}`], ['POST', `/droplets/${other}/actions`, { type: 'snapshot', name: `team-test-${o.run}` }], ['DELETE', `/droplets/${other}`]]) await d.api.call(m, p, b);
    log(`Then, for its own machine (the one tagged ${runTag(o.run)}): GET, the snapshot action, and DELETE by its ID.`);
    return { ok: true, dry: true };
  }
  if (all.status !== 200) line(null, 'list: the token lists its own team', `API ${all.status}`);
  else line(!all.droplets.some((x) => String(x.id) === String(other)), "list: the other team's machine is absent");
  const get = await d.api.call('GET', `/droplets/${other}`);
  line(refused(get.status) ? true : accepted(get.status) ? false : null, "read by ID: the other team's machine is refused", `API ${get.status}`);
  const snap = await d.api.call('POST', `/droplets/${other}/actions`, { type: 'snapshot', name: `team-test-${o.run}` });
  line(refused(snap.status) ? true : accepted(snap.status) ? false : null, "snapshot: the other team's machine is refused", `API ${snap.status}${snap.status === 403 ? '; the token has no snapshot scope, so this line cannot tell the team from the scope' : ''}`);
  const del = await d.api.call('DELETE', `/droplets/${other}`);
  line(refused(del.status) ? true : accepted(del.status) ? false : null, "delete by ID: the other team's machine is refused", `API ${del.status}`);

  // Its own machine: list, read and delete must succeed. The snapshot line is reported, not counted.
  const mine = mineList.droplets ?? [];
  if (mineList.status !== 200 || mine.length !== 1) {
    line(null, 'its own machine is found by its tag', `API ${mineList.status}, ${mine.length} machine(s)`);
  } else {
    const own = mine[0];
    line(all.droplets.some((x) => x.id === own.id), 'list: its own machine is listed');
    const g = await d.api.call('GET', `/droplets/${own.id}`);
    line(g.status === 200, 'read by ID: its own machine', `API ${g.status}`);
    const s = await d.api.call('POST', `/droplets/${own.id}/actions`, { type: 'snapshot', name: `team-test-${o.run}` });
    lines.push(['info', 'snapshot: its own machine', accepted(s.status) ? `API ${s.status}: the token can make snapshots; delete the snapshot team-test-${o.run} in the page` : `API ${s.status}${s.status === 403 ? ': refused for scope, as step 2 sets the token' : ''}`]);
    const { take } = selectForDeletion([own], { tag: runTag(o.run) });
    const x = take.length ? await d.api.call('DELETE', `/droplets/${own.id}`) : { status: 0 };
    line(x.status === 204, 'delete by ID: its own machine', take.length ? `API ${x.status}` : 'its record lacks the tags make gave it; left alone');
  }
  for (const [ok, name, note] of lines) log(`  ${ok === true ? 'held' : ok === false ? 'BROKEN' : ok === 'info' ? 'info' : 'NOT RUN'}  ${name}${note ? ` (${note})` : ''}`);
  const held = lines.every(([ok]) => ok === true || ok === 'info');
  log(held ? 'team-test: the crow-parties token stopped at its own team.' : 'team-test: the boundary did not hold or a step could not run. Stop: the simulated parties move to another provider or a second account (record, section 4).');
  return { ok: held, lines };
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  let a;
  try { a = parseArgs(rest, { values: ['run', 'other', 'ssh-key'], switches: ['dry-run', 'yes'] }); } catch (e) { console.error(`team-test: ${e.message}`); process.exit(2); }
  if (!['make', 'probe'].includes(cmd)) { console.error('team-test: make --run <id>, or probe --run <id> --other <droplet ID>'); process.exit(2); }
  if (!isRun(a.run)) { console.error('team-test: --run <id> is required'); process.exit(2); }
  if (cmd === 'probe' && !/^[0-9]{1,15}$/.test(a.other ?? '')) { console.error("team-test: --other takes the default team's machine's numeric ID, copied from DigitalOcean's page"); process.exit(2); }
  const files = [import.meta.filename, join(ROOT, 'infra', 'party', 'do.mjs'), join(ROOT, 'infra', 'lib', 'attest.mjs')];
  console.error('Before you type yes: the Claude desktop app is quit on this computer, so no session runs beside the token.');
  if (!(await attest({ title: `team-test ${cmd}, run ${a.run}`, files, dryRun: a['dry-run'], yes: a.yes }))) process.exit(1);
  let api;
  try { api = client({ token: process.env[TOKEN_VAR], dryRun: a['dry-run'] }); } catch (e) { console.error(`team-test: ${e.message}`); process.exit(2); }
  api.dry = Boolean(a['dry-run']);
  let r;
  if (cmd === 'make') {
    // No SSH session is needed: the key only keeps DigitalOcean from emailing a root password. Without one in the
    // team, the machine is made without a key, and it is deleted minutes later by the probe.
    let fingerprint;
    try { fingerprint = fingerprintOfFile(a['ssh-key'] ?? `${KEY}.pub`); } catch { fingerprint = undefined; }
    r = await make({ run: a.run, fingerprint }, { api });
  } else r = await probe({ run: a.run, other: a.other }, { api });
  process.exit(r.ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();

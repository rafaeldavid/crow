#!/usr/bin/env node
// Destroys the machines of one run (T-485; record, section 6), then checks that nothing carries the run's tag.
//
//   infra/dev-host/with-keys.sh node infra/party/down.mjs --run <id> [--yes]
//   node infra/party/down.mjs --run <id> --dry-run       prints the requests, sends nothing, needs no token
//
// It deletes a machine only when the API's record of it carries the party tag and the run's tag and its name starts
// with party-<id>- (selectForDeletion in do.mjs). Anything else that carries the tag is named and left alone, and
// the run then exits 1. Exit 0 when the run's tag holds nothing, 1 otherwise, 2 on a usage error.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { attest, ROOT } from '../lib/attest.mjs';
import { client, isRun, parseArgs, runTag, selectForDeletion, sleep, TOKEN_VAR } from './do.mjs';
import { forgetHost } from './ssh.mjs';

/** @param {{ run: string, 'dry-run'?: boolean }} o @param {{ api: ReturnType<typeof client>, log?: (l: string) => void, wait?: (ms: number) => Promise<void>, tries?: number }} d */
export async function down(o, d) {
  const log = d.log ?? ((l) => console.log(l));
  const wait = d.wait ?? sleep;
  const tag = runTag(o.run);
  if (o['dry-run']) {
    log('Dry run: these are the requests down.mjs sends. Nothing is sent.');
    await d.api.listByTag(tag);
    log(`Then: DELETE ${'/droplets/<id>'} for each machine whose own record carries party and ${tag} and whose name starts with party-${o.run}-;`);
    log(`then GET /droplets?tag_name=${tag} until it lists none, and GET /tags/${tag} to see that no resource carries it.`);
    return { ok: true, dry: true };
  }
  const list = await d.api.listByTag(tag);
  if (list.status !== 200) { log(`down: listing ${tag} failed (API ${list.status})`); return { ok: false }; }
  const { take, leave } = selectForDeletion(list.droplets, { tag, prefix: `party-${o.run}-` });
  let ok = true;
  for (const x of take) {
    const r = await d.api.call('DELETE', `/droplets/${x.id}`);
    log(`down: ${x.name} (${x.id}): ${r.status === 204 ? 'deleted' : `delete answered ${r.status}`}`);
    if (r.status !== 204 && r.status !== 404) ok = false;
  }
  for (const { droplet, why } of leave) { log(`down: left alone: ${droplet.name} (${droplet.id}): ${why.join('; ')}`); ok = false; }

  let gone = false;
  for (let i = 0; i < (d.tries ?? 24); i++) {
    const again = await d.api.listByTag(tag);
    if (again.status === 200 && again.droplets.length === leave.length) { gone = true; break; }
    await wait(5000);
  }
  // The tag's resource count can lag the deletes, so it is read until it reaches zero or the tries run out.
  let t;
  let count;
  for (let i = 0; i < (d.tries ?? 24); i++) {
    t = await d.api.call('GET', `/tags/${encodeURIComponent(tag)}`);
    count = t.status === 404 ? 0 : t.json?.tag?.resources?.count;
    if (count === 0 || leave.length) break;
    await wait(5000);
  }
  const clean = gone && leave.length === 0 && count === 0;
  log(`  ${clean ? 'ok  ' : 'FAIL'}  no machine or record carries ${tag}${count === undefined ? ` (tag read answered ${t.status})` : ''}`);
  forgetHost(o.run);
  return { ok: ok && clean };
}

async function main() {
  let a;
  try { a = parseArgs(process.argv.slice(2), { values: ['run'], switches: ['dry-run', 'yes'] }); } catch (e) { console.error(`down: ${e.message}`); process.exit(2); }
  if (!isRun(a.run)) { console.error('down: --run <id> is required: it names the only tag this command deletes by'); process.exit(2); }
  const files = [import.meta.filename, join(ROOT, 'infra', 'party', 'do.mjs'), join(ROOT, 'infra', 'party', 'ssh.mjs'), join(ROOT, 'infra', 'lib', 'attest.mjs')];
  if (!(await attest({ title: `down: the machines of run ${a.run}`, files, dryRun: a['dry-run'], yes: a.yes }))) process.exit(1);
  let api;
  try { api = client({ token: process.env[TOKEN_VAR], dryRun: a['dry-run'] }); } catch (e) { console.error(`down: ${e.message}`); process.exit(2); }
  const r = await down(a, { api });
  process.exit(r.ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();

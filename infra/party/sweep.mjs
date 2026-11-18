#!/usr/bin/env node
// Destroys party machines older than a stated age (T-485; record, section 6): what a killed run left behind.
//
//   infra/dev-host/with-keys.sh node infra/party/sweep.mjs --tag party --older-than 6h [--yes]
//   node infra/party/sweep.mjs --tag run-<id> --older-than 30m --dry-run      prints the request, sends nothing
//
// --tag is required: "party" (every party machine) or "run-<id>" (one run). --older-than is required: a number and
// m, h or d. A machine is deleted only when its own record carries the party tag and the stated tag, its name starts
// with "party-", and it was created longer ago than the age (selectForDeletion in do.mjs). The rehearsal pair and any
// machine made by hand carry no party tag, so a sweep never reaches them. Exit 0 when every chosen machine was
// deleted, 1 when one was not, 2 on a usage error.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { attest, ROOT } from '../lib/attest.mjs';
import { client, isRun, parseAge, parseArgs, PARTY_TAG, selectForDeletion, TOKEN_VAR } from './do.mjs';

export const isSweepTag = (t) => t === PARTY_TAG || (typeof t === 'string' && t.startsWith('run-') && isRun(t.slice(4)));

/** @param {{ tag: string, olderThanMs: number, 'dry-run'?: boolean }} o @param {{ api: ReturnType<typeof client>, log?: (l: string) => void, now?: () => number }} d */
export async function sweep(o, d) {
  const log = d.log ?? ((l) => console.log(l));
  if (o['dry-run']) {
    log('Dry run: this is the request sweep.mjs sends first. Nothing is sent.');
    await d.api.listByTag(o.tag);
    log(`Then: DELETE ${'/droplets/<id>'} for each machine whose own record carries ${PARTY_TAG} and ${o.tag}, whose name starts with party-, and which is older than the stated age.`);
    return { ok: true, dry: true };
  }
  const list = await d.api.listByTag(o.tag);
  if (list.status !== 200) { log(`sweep: listing ${o.tag} failed (API ${list.status})`); return { ok: false }; }
  const { take, leave } = selectForDeletion(list.droplets, { tag: o.tag, olderThanMs: o.olderThanMs, now: (d.now ?? Date.now)() });
  let ok = true;
  for (const x of take) {
    const r = await d.api.call('DELETE', `/droplets/${x.id}`);
    log(`sweep: ${x.name} (${x.id}), made ${x.created_at}: ${r.status === 204 ? 'deleted' : `delete answered ${r.status}`}`);
    if (r.status !== 204 && r.status !== 404) ok = false;
  }
  for (const { droplet, why } of leave) log(`sweep: kept ${droplet.name} (${droplet.id}): ${why.join('; ')}`);
  log(`sweep: ${take.length} deleted, ${leave.length} kept.`);
  return { ok, deleted: take.map((x) => x.id) };
}

async function main() {
  let a;
  try { a = parseArgs(process.argv.slice(2), { values: ['tag', 'older-than'], switches: ['dry-run', 'yes'] }); } catch (e) { console.error(`sweep: ${e.message}`); process.exit(2); }
  if (!isSweepTag(a.tag)) { console.error('sweep: --tag party or --tag run-<id> is required'); process.exit(2); }
  const olderThanMs = parseAge(a['older-than']);
  if (olderThanMs === undefined) { console.error('sweep: --older-than <number>m|h|d is required, for example 6h'); process.exit(2); }
  const files = [import.meta.filename, join(ROOT, 'infra', 'party', 'do.mjs'), join(ROOT, 'infra', 'lib', 'attest.mjs')];
  if (!(await attest({ title: `sweep: machines tagged ${a.tag} older than ${a['older-than']}`, files, dryRun: a['dry-run'], yes: a.yes }))) process.exit(1);
  let api;
  try { api = client({ token: process.env[TOKEN_VAR], dryRun: a['dry-run'] }); } catch (e) { console.error(`sweep: ${e.message}`); process.exit(2); }
  const r = await sweep({ ...a, olderThanMs }, { api });
  process.exit(r.ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();

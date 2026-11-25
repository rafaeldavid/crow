// `node setup.mjs leave` (T-478): removes the folder's own Worker from the party's Cloudflare account, after the
// export, and refuses while a deal is open. In order:
//
//   1. the export: GET https://<address>/export, signed with the folder's own key over the Worker's host and the time
//      (apps/own-seller/src/worker.ts), and the journal it answers written to exports/ in the folder;
//   2. the open deals: any deal the journal holds in an open stage stops the command, which removes nothing;
//   3. the removal: `wrangler delete` with the folder's deploy configuration, which names the account and the Worker.
//      The Worker's secrets go with it.
//
// The command refuses to run while an account's token or ID is in the environment, as `cloudflare` does. A folder
// with no Worker has nothing on a cloud account to remove: the line says so, and how to stop.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { privateKeyToAccount } from 'viem/accounts';
import { plain as plainLine } from './plain.ts';
import { accountVariableSet, CF_DIR, CF_FILES, npxWrangler, recordOf, WRANGLER_LINE, type Tool } from './setup-cloudflare.ts';
import { readKey, readState, writeState, writeWhole, type Call, type State } from './setup-seller.ts';

const plain = (s: unknown, max = 300) => plainLine(String(s ?? '')).slice(0, max);
/** The stages in which the Worker still works on a deal (seller-adapter-core.ts). */
const OPEN_STAGES = ['offered', 'starting', 'start-unknown', 'started', 'refused', 'delivering'];
/** The text the Worker checks: apps/own-seller/src/worker.ts, exportMessage. */
export const exportMessage = (host: string, time: number) => `crow own-seller export ${host} ${time}`;

/** The export request: GET /export with the owner's signature. A test replaces it. */
export type Exporter = (url: string, headers: Record<string, string>) => Promise<{ status: number; body: unknown }>;
const fetchExport: Exporter = async (url, headers) => {
  const res = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(30_000) });
  return { status: res.status, body: await res.json().catch(() => null) };
};

/** The status /health answers after the removal, or 0 when nothing answers. */
const probeHealth = async (url: string): Promise<number> => {
  try {
    return (await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000) })).status;
  } catch {
    return 0;
  }
};

export async function leave(c: Call, tool: Tool = npxWrangler(join(c.folder, CF_DIR)), exporter: Exporter = fetchExport, probe: (url: string) => Promise<number> = probeHealth): Promise<number> {
  const state = readState(c.folder);
  const rec = recordOf(state);
  if (!state || !rec || rec.leftAt) {
    c.say({ step: 'leave', ok: true, removed: null, detail: 'This folder has no Worker on a cloud account, so there is nothing there to remove. To stop selling from this machine, delete the folder once status shows no open deal; that deletes the key too.' });
    return 0;
  }
  const set = accountVariableSet();
  if (set) {
    c.say({ step: 'leave', ok: false, detail: `${set} is set in the environment. It chooses a Cloudflare account without a word on the command line. Run the command again without it. Nothing was removed.` });
    return 1;
  }
  // 1. The export, signed by the folder's key. The folder's address is the owner the Worker's bundle names.
  const host = rec.at;
  const time = Math.floor(Date.now() / 1000);
  const signature = await privateKeyToAccount(readKey(c.folder)).signMessage({ message: exportMessage(host, time) });
  const scheme = /^(127\.0\.0\.1|localhost):/.test(host) && c.testWorld ? 'http' : 'https';
  let got: { status: number; body: unknown };
  try {
    got = await exporter(`${scheme}://${host}/export`, { 'x-crow-owner-time': String(time), 'x-crow-owner-signature': signature });
  } catch (e) {
    c.say({ step: 'leave', ok: false, detail: `The export from ${scheme}://${host}/export failed: ${plain((e as Error).message, 200)}. Nothing was removed: the Worker's deals are in its Durable Object until the export succeeds.` });
    return 1;
  }
  const body = got.body as { type?: unknown; journal?: { deals?: Record<string, { stage?: unknown }> } } | null;
  if (got.status !== 200 || body?.type !== 'crow-own-seller-export' || typeof body.journal !== 'object' || body.journal === null) {
    c.say({ step: 'leave', ok: false, detail: `${scheme}://${host}/export answered ${got.status}, not the Worker's export. Nothing was removed.` });
    return 1;
  }
  const dir = join(c.folder, 'exports');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `cloudflare-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeWhole(file, `${JSON.stringify(body, null, 2)}\n`);
  // 2. The open deals.
  const open = Object.entries(body.journal.deals ?? {}).filter(([, d]) => OPEN_STAGES.includes(String(d?.stage)));
  if (open.length) {
    c.say({ step: 'leave', ok: false, exported: file, open: open.slice(0, 20).map(([id, d]) => ({ commitmentId: plain(id, 80), stage: plain(d?.stage, 40) })), detail: `${open.length} deal${open.length === 1 ? ' is' : 's are'} still open on the Worker: removing it now would leave a funded buyer with no delivery until its deadline. Run leave again once each has ended. Nothing was removed.` });
    return 1;
  }
  // 3. The removal, by the deploy configuration: it names the account and the Worker.
  const cfg = join(c.folder, CF_DIR, CF_FILES.config);
  const r = await tool(['delete', '--config', cfg]);
  if (r.code !== 0) {
    c.say({ step: 'leave', ok: false, exported: file, detail: `${WRANGLER_LINE} delete exited with ${r.code}: ${plain(r.stderr, 300)}. The person logs in (${WRANGLER_LINE} login) and runs leave again.` });
    return 1;
  }
  (state as State & { cloudflare: typeof rec }).cloudflare = { ...rec, leftAt: new Date().toISOString() };
  writeState(c.folder, state);
  // A removed Worker stops answering within a few seconds; one that still answers as a seller is said so.
  const after = await probe(`${scheme}://${host}/health`);
  c.say({
    step: 'leave', ok: true, exported: file, removed: rec.name,
    ...(after === 200 ? { stillAnswers: `${scheme}://${host}/health still answers 200. Cloudflare can take a minute to stop a removed Worker; check again, and look for the Worker on the dashboard.` } : {}),
    detail: `The Worker ${rec.name} and its secrets are removed from account ${rec.account}. Cloudflare keeps the account, its workers.dev subdomain, and the Worker's logs for their retention period; check on the dashboard's Durable Objects page that the Worker's namespace is gone. The card in your card folder still names the address: take it off your site. Past deals stay public on the operators and on Sepolia.`,
    next: [`When an assistant shares this machine: ${WRANGLER_LINE} logout`],
  });
  return 0;
}

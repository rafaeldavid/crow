// T-478: `leave` after `cloudflare`: it exports the Worker's journal with the folder's own signature, refuses while a
// deal is open, and only then removes the Worker through the pinned Wrangler with the folder's deploy configuration.
// The Worker's export and Wrangler are stand-ins here; the Worker's own check of the signature is in
// apps/own-seller/src/worker.test.ts, and apps/own-seller/src/setup.test.ts checks both sign the same text.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { verifyMessage, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import { exportMessage, leave, type Exporter } from './setup-leave.ts';
import type { Tool } from './setup-cloudflare.ts';
import type { Call } from './setup-seller.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function folderWithWorker() {
  const folder = mkdtempSync(join(tmpdir(), 'crow-leave-'));
  const key = generatePrivateKey();
  mkdirSync(join(folder, 'keys'), { mode: 0o700 });
  writeFileSync(join(folder, 'keys', 'signing.key'), `${key}\n`, { mode: 0o600 });
  mkdirSync(join(folder, 'cloudflare'));
  writeFileSync(join(folder, 'cloudflare', 'wrangler.json'), '{}');
  const address = privateKeyToAccount(key).address.toLowerCase();
  writeFileSync(join(folder, 'crow.json'), JSON.stringify({ crow: 'setup/1', role: 'seller', sells: 'template', name: 'reviews', createdAt: '', steps: {}, address, payout: { address, thisKey: true }, cloudflare: { config: '/x', account: 'a'.repeat(32), at: 'reviews.party-example.workers.dev', name: 'reviews', workersDev: true, access: 'credential', quotesPerDay: 10, offerId: 'reviews', preparedAt: '', keyStartedAt: '', keySetAt: '' } }));
  return { folder, address };
}
function call(folder: string): Call & { lines: J[] } {
  const lines: J[] = [];
  return { folder, operators: [], testWorld: false, flags: new Map(), say: (l) => void lines.push(l), note: () => undefined, hide: () => undefined, lines };
}
const toolLog = (): { tool: Tool; runs: string[][] } => {
  const runs: string[][] = [];
  return { runs, tool: async (args) => (runs.push(args), { code: 0, stdout: '', stderr: '' }) };
};

describe('T-478: leave', () => {
  it('signs the export with the folder key the Worker checks, and refuses while a deal is open, removing nothing', async () => {
    const { folder, address } = folderWithWorker();
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const exporter: Exporter = async (url, headers) => (seen.push({ url, headers }), { status: 200, body: { type: 'crow-own-seller-export', journal: { deals: { [`0x${'1'.repeat(64)}`]: { stage: 'started' }, [`0x${'2'.repeat(64)}`]: { stage: 'delivered' } } } } });
    const { tool, runs } = toolLog();
    const c = call(folder);
    expect(await leave(c, tool, exporter)).toBe(1);
    expect(c.lines.at(-1).detail).toMatch(/1 deal is still open on the Worker/);
    expect(c.lines.at(-1).open).toEqual([{ commitmentId: `0x${'1'.repeat(64)}`, stage: 'started' }]);
    expect(runs).toEqual([]); // nothing removed
    expect(existsSync(c.lines.at(-1).exported)).toBe(true); // the export is kept first
    const { url, headers } = seen[0]!;
    expect(url).toBe('https://reviews.party-example.workers.dev/export');
    const ok = await verifyMessage({ address: address as Hex, message: exportMessage('reviews.party-example.workers.dev', Number(headers['x-crow-owner-time'])), signature: headers['x-crow-owner-signature'] as Hex });
    expect(ok).toBe(true);
  });

  it('with no open deal it removes the Worker by the deploy configuration and records it', async () => {
    const { folder } = folderWithWorker();
    const { tool, runs } = toolLog();
    const c = call(folder);
    expect(await leave(c, tool, async () => ({ status: 200, body: { type: 'crow-own-seller-export', journal: { deals: { a: { stage: 'closed' } } } } }))).toBe(0);
    expect(runs).toEqual([['delete', '--config', join(folder, 'cloudflare', 'wrangler.json')]]);
    expect(c.lines.at(-1)).toMatchObject({ step: 'leave', ok: true, removed: 'reviews' });
    expect(JSON.parse(readFileSync(join(folder, 'crow.json'), 'utf8')).cloudflare.leftAt).toBeTruthy();
  });

  it('removes nothing when the export fails or is not the Worker\'s', async () => {
    for (const exporter of [async () => ({ status: 401, body: {} }), async () => ({ status: 200, body: { type: 'other' } }), async () => Promise.reject(new Error('down'))] as Exporter[]) {
      const { folder } = folderWithWorker();
      const { tool, runs } = toolLog();
      const c = call(folder);
      expect(await leave(c, tool, exporter)).toBe(1);
      expect(runs).toEqual([]);
    }
  });
});

// T-478: what `setup.mjs cloudflare` writes is what this Worker takes. The bundle bundleFrom makes from a party's
// configuration passes the hosted seller's own check, with the same SHA-256 the card shows; the deploy configuration
// binds the class entry.ts exports; and `leave` signs the text the Worker checks.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bundleFrom, sellerSha256, wranglerConfigFor } from '../../../examples/setup-cloudflare.ts';
import { exportMessage as leaveMessage } from '../../../examples/setup-leave.ts';
import { proofMessage as checkProof, proofRequestMessage as checkProofRequest } from '../../../examples/setup-published.ts';
import { bundleSha256, checkBundle } from '../../hosted-sellers/src/bundle.ts';
import { exportMessage, proofMessage, proofRequestMessage, setupOf } from './worker.ts';

describe('T-478: the setup writes what the Worker takes', () => {
  it("bundleFrom's bundle passes checkBundle and the Worker's own setup, with the SHA-256 bundleSha256 gives", () => {
    const dir = mkdtempSync(join(tmpdir(), 'crow-own-'));
    writeFileSync(join(dir, 'template.json'), JSON.stringify({ deliverable: { kind: 'document', description: 'A review of {{commit}}.', format: 'application/json' }, checks: [{ id: 'r', type: 'json_schema', required: true, schema: { type: 'object' } }] }));
    writeFileSync(join(dir, 'adapter.json'), JSON.stringify({ port: 8791, journal: 'j.json', template: 'template.json', scope: { commit: { type: 'string', pattern: '^[0-9a-f]{40}$' } }, sellerApi: { quote: 'https://api.example.com/q', start: 'https://api.example.com/s', result: 'https://api.example.com/r/{jobId}' } }));
    const made = bundleFrom(join(dir, 'adapter.json'), { name: 'reviews', offerId: 'review', owner: `0x${'a'.repeat(40)}`, payout: `0x${'b'.repeat(40)}`, access: 'credential', quotesPerDay: 10 });
    expect(made.dropped).toEqual(['port', 'journal']);
    const checked = checkBundle(made.bundle.seller);
    expect(checked.credentialVars).toEqual(made.credentialVars);
    expect(bundleSha256(made.bundle.seller)).toBe(made.configSha256);
    expect(sellerSha256(made.bundle.seller)).toBe(checked.configSha256);
    expect(setupOf(made.bundle).bundleError).toBeUndefined();
  });

  it('the deploy configuration binds OwnSeller, and leave signs the text the Worker checks', () => {
    const cfg = wranglerConfigFor({ name: 'reviews', account: 'a'.repeat(32), url: 'https://r.x.workers.dev/', host: 'r.x.workers.dev', workersDev: true, local: false, operators: ['https://a.example', 'https://b.example'] }) as { durable_objects: { bindings: Array<{ name: string; class_name: string }> }; migrations: Array<{ new_sqlite_classes: string[] }> };
    expect(cfg.durable_objects.bindings).toEqual([{ name: 'SELLER', class_name: 'OwnSeller' }]);
    expect(cfg.migrations[0]!.new_sqlite_classes).toEqual(['OwnSeller']);
    expect(leaveMessage('r.x.workers.dev', 1_764_000_000)).toBe(exportMessage('r.x.workers.dev', 1_764_000_000));
    expect(checkProofRequest('r.x.workers.dev', 1, 'ab')).toBe(proofRequestMessage('r.x.workers.dev', 1, 'ab'));
    expect(checkProof('r.x.workers.dev', 'ab')).toBe(proofMessage('r.x.workers.dev', 'ab'));
  });
});

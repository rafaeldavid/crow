// T-485, row N161: the simulated party's machine. A stub DigitalOcean API and a stub SSH drive up, down, sweep and
// the team test; nothing reaches the network.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: plain .mjs modules with no type declarations
import { client, describe as describeRequest, isRun, md5Fingerprint, parseAge, PARTY_TAG, runTag, selectForDeletion } from '../infra/party/do.mjs';
// @ts-expect-error: as above
import { createBody, up } from '../infra/party/up.mjs';
// @ts-expect-error: as above
import { down } from '../infra/party/down.mjs';
// @ts-expect-error: as above
import { isSweepTag, sweep } from '../infra/party/sweep.mjs';
// @ts-expect-error: as above
import { probe } from '../infra/party/team-test.mjs';
// @ts-expect-error: as above
import { checkParty } from '../infra/party/check.mjs';
// @ts-expect-error: as above
import { attest } from '../infra/lib/attest.mjs';

const ROOT = join(import.meta.dirname, '..');
const TOKEN = 'dop_v1_' + 'z9'.repeat(30);
type D = { id: number; name: string; tags: string[]; created_at?: string; status?: string; networks?: unknown };
const v4 = (ip: string) => ({ v4: [{ type: 'public', ip_address: ip }, { type: 'private', ip_address: '10.0.0.9' }] });

/** A stub API holding droplets; it records every request and honours the tag filter like the real one. */
function stub(droplets: D[], opts: { other?: number[] } = {}) {
  const calls: { method: string; url: string; auth: string; body?: unknown }[] = [];
  let next = 9000;
  const fetch = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, url: u.pathname + u.search, auth: init.headers.Authorization, body });
    const json = (status: number, j?: unknown) => ({ status, text: async () => (j === undefined ? '' : JSON.stringify(j)) });
    const p = u.pathname.replace('/v2', '');
    const idOf = (s: string) => Number(s.split('/')[2]);
    if (init.method === 'GET' && p === '/droplets') {
      const tag = u.searchParams.get('tag_name');
      return json(200, { droplets: droplets.filter((d) => !tag || d.tags.includes(tag)), links: {} });
    }
    if (init.method === 'GET' && p.startsWith('/account/keys/')) return json(200, { ssh_key: { id: 1 } });
    if (init.method === 'POST' && p === '/tags') return json(201, { tag: { name: body.name } });
    if (init.method === 'POST' && p === '/droplets') {
      const d = { id: next++, name: body.name, tags: body.tags, status: 'new', created_at: new Date().toISOString() };
      droplets.push(d);
      return json(202, { droplet: d });
    }
    if (p.startsWith('/tags/')) {
      const t = decodeURIComponent(p.slice(6));
      return json(200, { tag: { name: t, resources: { count: droplets.filter((d) => d.tags.includes(t)).length } } });
    }
    const id = idOf(p);
    if (opts.other?.includes(id)) return json(404, { id: 'not_found' });
    const d = droplets.find((x) => x.id === id);
    if (!d) return json(404, { id: 'not_found' });
    if (init.method === 'GET') { d.status = 'active'; d.networks ??= v4(`192.0.2.${id % 200}`); return json(200, { droplet: d }); }
    if (init.method === 'DELETE') { droplets.splice(droplets.indexOf(d), 1); return json(204); }
    if (init.method === 'POST' && p.endsWith('/actions')) return json(403, { id: 'forbidden' });
    return json(400);
  };
  return { api: client({ token: TOKEN, fetch, log: () => {} }), calls, droplets };
}
const quiet = () => {};

describe('the deletion rule', () => {
  const t = runTag('r1');
  const mk = (id: number, name: string, tags: string[], created_at = '2026-11-15T00:00:00Z'): D => ({ id, name, tags, created_at });
  it('takes only machines whose own record carries the party tag, the stated tag and a party- name', () => {
    const { take, leave } = selectForDeletion([
      mk(1, 'party-r1-buyer', [PARTY_TAG, t]),
      mk(2, 'party-r1-seller', [t]),
      mk(3, 'signer', [PARTY_TAG, t]),
      mk(4, 'party-r2-buyer', [PARTY_TAG, runTag('r2')]),
    ], { tag: t });
    expect(take.map((d: D) => d.id)).toEqual([1]);
    expect(leave.map((x: { droplet: D }) => x.droplet.id)).toEqual([2, 3, 4]);
  });
  it('keeps machines younger than the age', () => {
    const now = Date.parse('2026-11-15T06:00:00Z');
    const { take } = selectForDeletion([mk(1, 'party-a-buyer', [PARTY_TAG]), mk(2, 'party-b-buyer', [PARTY_TAG], '2026-11-15T05:30:00Z')], { tag: PARTY_TAG, olderThanMs: parseAge('1h'), now });
    expect(take.map((d: D) => d.id)).toEqual([1]);
  });
  it('refuses to run without a tag', () => expect(() => selectForDeletion([], { tag: '' })).toThrow());
});

describe('down', () => {
  it('never deletes a machine outside the run, even when the API returns it for the tag', async () => {
    const outsider = { id: 7, name: 'crow-signer', tags: ['run-r1'] };
    const otherRun = { id: 8, name: 'party-r2-buyer', tags: [PARTY_TAG, 'run-r2'] };
    const mine = { id: 9, name: 'party-r1-buyer', tags: [PARTY_TAG, 'run-r1'] };
    const s = stub([outsider, otherRun, mine]);
    const r = await down({ run: 'r1' }, { api: s.api, log: quiet, wait: async () => {}, tries: 2 });
    const deleted = s.calls.filter((c) => c.method === 'DELETE').map((c) => c.url);
    expect(deleted).toEqual(['/v2/droplets/9']);
    expect(s.droplets.map((d) => d.id).sort()).toEqual([7, 8]);
    expect(r.ok).toBe(false); // the outsider still carries the tag, so the run is not clean
  });
  it('is clean when the run held only its own machines', async () => {
    const s = stub([{ id: 9, name: 'party-r1-seller', tags: [PARTY_TAG, 'run-r1'] }]);
    expect((await down({ run: 'r1' }, { api: s.api, log: quiet, wait: async () => {} })).ok).toBe(true);
  });
  it('sends nothing in a dry run, and never shows the token', async () => {
    const lines: string[] = [];
    const r = await down({ run: 'r1', 'dry-run': true }, { api: client({ dryRun: true, log: (l: string) => lines.push(l) }), log: (l: string) => lines.push(l) });
    expect(r.dry).toBe(true);
    expect(lines.join('\n')).toContain('GET https://api.digitalocean.com/v2/droplets?tag_name=run-r1');
    expect(lines.join('\n')).not.toContain('dop_v1_');
  });
});

describe('sweep', () => {
  it('needs the party tag or a run tag', () => {
    for (const t of ['party', 'run-r1']) expect(isSweepTag(t)).toBe(true);
    for (const t of ['', 'run-', 'crow-own', 'run-R1', undefined]) expect(isSweepTag(t)).toBe(false);
  });
  it('deletes old party machines only', async () => {
    const old = '2026-11-14T00:00:00Z';
    const s = stub([
      { id: 1, name: 'party-a-buyer', tags: [PARTY_TAG, 'run-a'], created_at: old },
      { id: 2, name: 'rehearsal-signer', tags: ['rehearsal'], created_at: old },
      { id: 3, name: 'party-b-buyer', tags: [PARTY_TAG, 'run-b'], created_at: '2026-11-15T05:59:00Z' },
    ]);
    const r = await sweep({ tag: PARTY_TAG, olderThanMs: parseAge('6h') }, { api: s.api, log: quiet, now: () => Date.parse('2026-11-15T06:00:00Z') });
    expect(r.deleted).toEqual([1]);
    expect(s.calls.filter((c) => c.method === 'DELETE').length).toBe(1);
  });
});

describe('up', () => {
  const ok = { code: 0, stdout: '', stderr: '' };
  const probeOut = (ip: string) => ['home-empty', 'no-project-file-by-name', 'no-project-file-by-content', 'no-cloud-token-in-environment', 'user-data-holds-no-secret', 'password-and-root-login-off', 'security-updates-on', 'node-at-pinned-major', 'assistant-tool-installed'].map((n) => `ok ${n}`).concat(`echo ${ip}`).join('\n');
  const exec = (ip: string) => (_t: unknown, cmd: string[]) => (cmd[0] === 'bash' ? { code: 0, stdout: probeOut(ip), stderr: '' } : ok);
  const deps = (api: unknown, e: unknown) => ({ api, exec: e, wait: async () => {}, log: quiet, fingerprint: 'aa:bb', userData: readFileSync(join(ROOT, 'infra/party/cloud-init.yaml'), 'utf8'), provision: '#', major: '22' });

  it('sends the reviewed cloud-init file unchanged, with the run and party tags', () => {
    const userData = readFileSync(join(ROOT, 'infra/party/cloud-init.yaml'), 'utf8');
    const b = createBody({ run: 'r1', role: 'seller', fingerprint: 'aa:bb', userData });
    expect(b.user_data).toBe(userData);
    expect(b.tags).toEqual([PARTY_TAG, 'run-r1', 'role-seller']);
    expect(b.name).toBe('party-r1-seller');
  });
  it('makes, reaches and checks a machine', async () => {
    const s = stub([]);
    const r = await up({ run: 'r1', role: 'buyer' }, deps(s.api, exec('192.0.2.0')));
    expect(r.ok).toBe(true);
    expect(s.calls.every((c) => c.auth === `Bearer ${TOKEN}`)).toBe(true);
  });
  it('refuses a run that already has a machine', async () => {
    const s = stub([{ id: 1, name: 'party-r1-buyer', tags: [PARTY_TAG, 'run-r1'] }]);
    expect((await up({ run: 'r1', role: 'buyer' }, deps(s.api, exec('x')))).ok).toBe(false);
    expect(s.calls.some((c) => c.method === 'POST' && c.url === '/v2/droplets')).toBe(false);
  });
  it('destroys the machine when its check fails: here its outbound address is not its own', async () => {
    const s = stub([]);
    const r = await up({ run: 'r2', role: 'buyer' }, deps(s.api, exec('198.51.100.7')));
    expect(r.ok).toBe(false);
    expect(s.droplets.length).toBe(0);
  });
  it('sends nothing in a dry run', async () => {
    const lines: string[] = [];
    const api = client({ dryRun: true, log: (l: string) => lines.push(l) });
    const r = await up({ run: 'r1', role: 'buyer', 'dry-run': true }, { ...deps(api, exec('x')), log: (l: string) => lines.push(l) });
    expect(r.dry).toBe(true);
    const text = lines.join('\n');
    expect(text).toContain('POST https://api.digitalocean.com/v2/droplets');
    expect(text).toContain('<infra/party/cloud-init.yaml,');
    expect(text).toContain('<DIGITALOCEAN_ACCESS_TOKEN, not shown>');
  });
  it('refuses without a token', () => expect(() => client({ token: undefined })).toThrow(/DIGITALOCEAN_ACCESS_TOKEN/));
});

describe('the party check', () => {
  const d = { id: 1, name: 'party-r1-buyer', tags: [], networks: v4('192.0.2.1') };
  const out = (lines: string[]) => () => ({ code: 0, stdout: lines.join('\n'), stderr: '' });
  const all = ['home-empty', 'no-project-file-by-name', 'no-project-file-by-content', 'no-cloud-token-in-environment', 'user-data-holds-no-secret', 'password-and-root-login-off', 'security-updates-on', 'node-at-pinned-major', 'assistant-tool-installed'];
  it('passes when every probe line is ok and the address is its own and apart', () => {
    const r = checkParty({ droplet: d, others: [{ id: 2, networks: v4('192.0.2.2') }], run: 'r1', exec: out([...all.map((n) => `ok ${n}`), 'echo 192.0.2.1']), major: '22' });
    expect(r.ok).toBe(true);
  });
  it('fails when two parties share an address, or a probe line is missing or failed', () => {
    expect(checkParty({ droplet: d, others: [{ id: 2, networks: v4('192.0.2.1') }], run: 'r1', exec: out([...all.map((n) => `ok ${n}`), 'echo 192.0.2.1']), major: '22' }).ok).toBe(false);
    expect(checkParty({ droplet: d, others: [], run: 'r1', exec: out([...all.slice(1).map((n) => `ok ${n}`), 'echo 192.0.2.1']), major: '22' }).ok).toBe(false);
    expect(checkParty({ droplet: d, others: [], run: 'r1', exec: out(['fail home-empty', ...all.slice(1).map((n) => `ok ${n}`), 'echo 192.0.2.1']), major: '22' }).ok).toBe(false);
  });
});

describe('the team test', () => {
  it('holds when the other team is invisible and its own machine is reachable', async () => {
    const s = stub([{ id: 50, name: 'party-t1-team-test', tags: [PARTY_TAG, 'run-t1'] }], { other: [77] });
    const r = await probe({ run: 't1', other: '77' }, { api: s.api, log: quiet });
    expect(r.ok).toBe(true);
    expect(s.droplets.length).toBe(0);
  });
  it('fails when the token reads the other team\'s machine', async () => {
    const s = stub([{ id: 50, name: 'party-t1-team-test', tags: [PARTY_TAG, 'run-t1'] }, { id: 77, name: 'default-team', tags: [] }]);
    const r = await probe({ run: 't1', other: '77' }, { api: s.api, log: quiet });
    expect(r.ok).toBe(false);
  });
});

describe('helpers', () => {
  it('reads the run IDs, ages and fingerprints it accepts', () => {
    expect(['r1', 'bench-2026-11-15', 'a1b'].every(isRun)).toBe(true);
    expect(['', 'R1', '-a', 'a', 'a_b', 'x'.repeat(33)].some(isRun)).toBe(false);
    expect([parseAge('30m'), parseAge('6h'), parseAge('2d'), parseAge('6'), parseAge('h')]).toEqual([1_800_000, 21_600_000, 172_800_000, undefined, undefined]);
    expect(md5Fingerprint('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl test')).toMatch(/^([0-9a-f]{2}:){15}[0-9a-f]{2}$/);
  });
  it('names the token in a printed request and never shows it', () => {
    expect(describeRequest('GET', '/droplets')).toContain('<DIGITALOCEAN_ACCESS_TOKEN, not shown>');
  });
});

describe('the attestation', () => {
  it('prints the commit and each hash, and refuses without a terminal or --yes', async () => {
    const lines: string[] = [];
    const f = join(ROOT, 'infra/party/do.mjs');
    expect(await attest({ title: 't', files: [f], out: (l: string) => lines.push(l), isTTY: false })).toBe(false);
    expect(lines.join('\n')).toMatch(/From commit: [0-9a-f]{40}/);
    expect(lines.join('\n')).toContain('infra/party/do.mjs');
    expect(await attest({ title: 't', files: [f], out: () => {}, isTTY: true, ask: async () => 'no' })).toBe(false);
    expect(await attest({ title: 't', files: [f], out: () => {}, isTTY: true, ask: async () => 'yes' })).toBe(true);
    expect(await attest({ title: 't', files: [f], out: () => {}, yes: true })).toBe(true);
  });
  it('refuses an unknown commit', async () => {
    const run = () => ({ status: 128, stdout: '' });
    expect(await attest({ title: 't', files: [join(ROOT, 'infra/party/do.mjs')], out: () => {}, yes: true, run })).toBe(false);
  });
});

describe('the files', () => {
  it('hold no secret, address or token shape', () => {
    const files = execFileSync('git', ['-C', ROOT, 'ls-files', '--others', '--cached', '--exclude-standard', 'infra', 'config/secrets/dev-host.refs'], { encoding: 'utf8' }).split('\n').filter(Boolean);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const t = readFileSync(join(ROOT, f), 'utf8');
      expect(t, f).not.toMatch(/dop_v1_[0-9a-f]{20}|sk-ant-[A-Za-z0-9]|ops_ey[A-Za-z0-9]|gh[pousr]_[A-Za-z0-9]{20}|@gmail\.com/);
      expect(t, f).not.toMatch(/\b(?!192\.0\.2\.|198\.51\.100\.|203\.0\.113\.|169\.254\.169\.254|10\.0\.0\.9)(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/);
    }
  });
});

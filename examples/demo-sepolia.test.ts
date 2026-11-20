// The Sepolia demo command (T-569) as a person runs it: a separate Node process that reaches the operators over HTTP
// only. Here the operators are the demo's own world (apps/demo-cloud) on SimChain, served in this process on two
// origins, with scripted judges; the live run is the task's Evidence.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePrivateKey } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BEATS, judgeCallsLeft, panelKind, rejectedRelease, timelineLine } from './demo-sepolia.ts';
import { expectNoSecrets, simWorld, type Served } from './e2e-world.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function command(args: string[], env: Record<string, string>): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !['E2E_SEPOLIA_SEED', 'HOLDBACK_DEPLOYMENT', 'SEPOLIA_RPC_URL', 'HOLDBACK_OPERATORS'].includes(k)));
    const child = spawn(process.execPath, [new URL('./demo-sepolia.ts', import.meta.url).pathname, ...args], { env: { ...clean, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    child.on('exit', (code) => resolve({ code, out }));
  });
}

describe('demo-sepolia.ts', () => {
  it('plays round scenarios 1, 2 and 5b as the release, reject and escalate beats', () => {
    expect(BEATS.map((b) => [b.name, b.scenario])).toEqual([['release', '1'], ['reject', '2'], ['escalate', '5b']]);
  });

  it("puts the beat's name and the seconds since the start in front of a scenario's line", () => {
    expect(timelineLine('[5b] escalate  Escalated; primary', 42_400)).toBe('  42 s  escalate  escalate  Escalated; primary');
    expect(timelineLine('not a scenario line', 1_000)).toBe('   1 s            not a scenario line');
  });

  it('counts the live judge calls left today from discovery, and none when discovery names no budget', () => {
    expect(judgeCallsLeft({ judges: { panel: 'live', liveCallsPerDay: 30, liveCallsToday: 8 } })).toBe(22);
    expect(judgeCallsLeft({ judges: { panel: 'live', liveCallsPerDay: 30, liveCallsToday: 31 } })).toBe(0);
    expect(judgeCallsLeft({ judges: { panel: 'scripted' } })).toBe(0);
    expect(judgeCallsLeft(undefined)).toBe(0);
  });

  it('labels a panel scripted when any seat carries the fake-judge mark, even when the seats name live models', () => {
    const seat = (rationale: string) => ({ model: 'claude-opus-5-5@2026-09-21', family: 'claude', verdict: { overall: 'pass', rationale } });
    expect(panelKind({ role: 'primary', panel: { members: [seat('Faithful.'), seat('Fluent.')] } })).toEqual({ role: 'primary', kind: 'live', seats: 2, marked: 0 });
    expect(panelKind({ role: 'appeal', panel: { members: [seat('Faithful.'), seat('[fake judge, no model ran] pass')] } })).toEqual({ role: 'appeal', kind: 'scripted', seats: 2, marked: 1 });
    expect(panelKind({ role: 'primary', panel: { ran: false, members: [] } }).kind).toBe('none');
    expect(panelKind(null).kind).toBe('none');
  });

  it('answers --help and refuses an unknown beat, before any network call', async () => {
    const help = await command(['--help'], { HOLDBACK_OPERATORS: 'http://127.0.0.1:9,http://localhost:9' });
    expect(help.code, help.out).toBe(0);
    expect(help.out).toMatch(/^usage: pnpm demo:sepolia/m);
    const bad = await command(['--beat', 'appeal'], { HOLDBACK_OPERATORS: 'http://127.0.0.1:9,http://localhost:9' });
    expect(bad.code, bad.out).toBe(2);
    expect(bad.out).toMatch(/no beat appeal; the beats are release, reject, escalate/);
  });

  describe('against the demo world on SimChain', () => {
    let demo: Served;
    beforeAll(async () => {
      demo = await simWorld();
    });
    afterAll(() => demo.close());

    it('--dry-run reads discovery, prints the plan and opens no deal', async () => {
      const before = demo.requests.length;
      const r = await command(['--dry-run'], { HOLDBACK_OPERATORS: demo.urls.join(',') });
      expect(r.code, r.out).toBe(0);
      for (const b of BEATS) expect(r.out).toMatch(new RegExp(`^  ${b.name} +round scenario ${b.scenario}: `, 'm'));
      expect(r.out).toMatch(/^dry run: no deal opened, nothing signed$/m);
      expect(demo.requests.slice(before).filter((q) => !q.startsWith('GET '))).toEqual([]);
    });

    it('refuses the release beat after a live panel rejected its honest work on the same rules contract, unless --rerun-after names the fix', async () => {
      const rules = ((await (await fetch(`${demo.urls[0]}/.well-known/holdback.json`)).json()) as J).domain.verifyingContract as string;
      const out = mkdtempSync(join(tmpdir(), 'demo-sepolia-reroll-'));
      const earlier = (verifyingContract: string) => ({ result: { domain: { verifyingContract }, checks: [{ name: 'the deal ends Released', ok: false }, { name: 'a live panel judged', ok: true }] } });
      mkdirSync(join(out, '2026-11-19T000000Z'));
      writeFileSync(join(out, '2026-11-19T000000Z', 'release.json'), JSON.stringify(earlier('0x00000000000000000000000000000000000000aa')));
      expect(rejectedRelease(out, rules), 'a reject on another rules contract does not count').toBeNull();
      mkdirSync(join(out, '2026-11-19T000100Z'));
      writeFileSync(join(out, '2026-11-19T000100Z', 'release.json'), JSON.stringify(earlier(rules.toUpperCase().replace(/^0X/, '0x'))));
      const env = { HOLDBACK_OPERATORS: demo.urls.join(',') };
      const before = demo.requests.length;
      const refused = await command(['--out', out], env);
      expect(refused.code, refused.out).toBe(3);
      expect(refused.out).toMatch(/^refused: refusing to start: a live panel rejected the release beat's honest work on this rules contract \(.*2026-11-19T000100Z.release\.json\)\. A panel verdict is never re-rolled/m);
      expect(demo.requests.slice(before)).toEqual([]);
      // The other beats do not re-judge the release delivery, so they may still run alone.
      expect((await command(['--out', out, '--beat', 'reject', '--dry-run'], env)).code).toBe(0);
      const after = await command(['--out', out, '--dry-run', '--rerun-after', 'pinned a new judge registry'], env);
      expect(after.code, after.out).toBe(0);
      expect(after.out).toMatch(/^run again after: pinned a new judge registry \(an earlier live reject: /m);
    });

    it('records a beat that cannot open its round as stopped, and still plays and writes the other two', async () => {
      const out = mkdtempSync(join(tmpdir(), 'demo-sepolia-stop-'));
      const seeds = ['0xnot-a-seed', generatePrivateKey(), generatePrivateKey()];
      const r = await command(['--out', out], { HOLDBACK_OPERATORS: demo.urls.join(','), DEMO_SEPOLIA_SEEDS: seeds.join(',') });
      expect(r.code, r.out).toBe(1);
      expect(r.out).toMatch(/^the seeds come from DEMO_SEPOLIA_SEEDS \(for the tests only\): these keys are not fresh$/m);
      expect(r.out).toMatch(/^ +\d+ s +release +start +stopped before the first deal: /m);
      expect(r.out).toMatch(/^release +none +\d+ s +0 of 0 checks held; stopped: /m);
      const [folder] = readdirSync(out).map((d) => join(out, d));
      expect(readdirSync(folder!).sort()).toEqual(['escalate.json', 'reject.json', 'release.json', 'run.json', 'timeline.md']);
      const rec = (name: string) => JSON.parse(readFileSync(join(folder!, `${name}.json`), 'utf8')) as J;
      expect(rec('release').result).toMatchObject({ status: 'error', stoppedAt: 'start' });
      expect(rec('reject').result.status).toBe('pass');
      expect(rec('escalate').result.status).toBe('pass');
    }, 300_000);

    it('plays the three beats with fresh keys, prints the timeline and writes it with one record per beat', async () => {
      const out = mkdtempSync(join(tmpdir(), 'demo-sepolia-'));
      // The test names the three seeds so it can look for them; a person's run makes them fresh in memory.
      const seeds = BEATS.map(() => generatePrivateKey());
      const r = await command(['--out', out], { HOLDBACK_OPERATORS: demo.urls.join(','), DEMO_SEPOLIA_SEEDS: seeds.join(',') });
      // SimChain's judges are scripted, so the one check that wants a live panel fails, and with it the run (exit 1):
      // the command never passes a scripted panel as live.
      expect(r.code, r.out).toBe(1);
      expect(r.out).toMatch(/^ +\d+ s +release +outcome +FAIL a live panel judged: the panel was scripted/m);
      expect(r.out).not.toMatch(/^ +\d+ s +(reject|escalate) +\S+ +FAIL /m);
      expect(r.out).toMatch(/^ +\d+ s +release +outcome +Released: decision accept/m);
      expect(r.out).toMatch(/^ +\d+ s +reject +deliver +Delivered/m);
      expect(r.out).toMatch(/^ +\d+ s +reject +outcome +ok +the deal ends Refunded: Refunded/m);
      // On SimChain the appeal adjudicator decides before the first poll, so the first state seen may be the last.
      expect(r.out).toMatch(/^ +\d+ s +escalate +escalate +(Escalated|Released|Refunded)/m);
      expect(r.out).toMatch(/^ {10}deal 0x[0-9a-f]{64}; appeal adjudicator decided (accept|reject); panel of 5: /m);
      expect(r.out).toMatch(/^release +Released +\d+ s +\d+ of \d+ checks held/m);
      expect(r.out).toMatch(/^ {10}judges: primary panel scripted \(3 of 3 seats marked\)$/m);
      expect(r.out).toMatch(/^reject +Refunded +\d+ s/m);
      expect(r.out).toMatch(/^escalate +(Released|Refunded) +\d+ s/m);
      expect(r.out).toMatch(/^all three beats: \d+ s from the start of the command to the last beat.s end, within the 300 s limit$/m);
      const [folder] = readdirSync(out).map((d) => join(out, d));
      const files = readdirSync(folder!).sort();
      expect(files).toEqual(['escalate.json', 'reject.json', 'release.json', 'run.json', 'timeline.md']);
      const timeline = readFileSync(join(folder!, 'timeline.md'), 'utf8');
      expect(timeline).toContain('Released: decision accept');
      const release = JSON.parse(readFileSync(join(folder!, 'release.json'), 'utf8')) as J;
      expect(release.result.status).toBe('fail');
      expect(release.result.checks.filter((c: J) => !c.ok).map((c: J) => c.name)).toEqual(['a live panel judged']);
      expect(release.judgment.decision).toBe('accept');
      expect(release.live).toBe(false);
      expect(release.panels[0]).toMatchObject({ role: 'primary', kind: 'scripted', seats: 3, marked: 3 });
      for (const name of ['reject', 'escalate']) expect(JSON.parse(readFileSync(join(folder!, `${name}.json`), 'utf8')).result.status, name).toBe('pass');
      const run = JSON.parse(readFileSync(join(folder!, 'run.json'), 'utf8')) as J;
      expect(run.beats.map((b: J) => [b.name, b.state])).toEqual([['release', 'Released'], ['reject', 'Refunded'], ['escalate', expect.stringMatching(/^(Released|Refunded)$/)]]);
      // Neither a beat's seed nor any key derived from it is printed or written.
      for (const seed of seeds) expectNoSecrets(seed, r.out, folder!);
    }, 300_000);
  });
});

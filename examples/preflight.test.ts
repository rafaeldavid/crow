// T-491: the preflight runs every check in one run, reads only, never prints a variable's value, and fails only on
// what stops a deal. The network is a fake: no test calls the live operators.
import { describe, expect, it } from 'vitest';
import { SEPOLIA } from './deployments.ts';
import { CROW_OPERATORS, pinned, preflight, summary, TEST_AGENTS, type Input } from './preflight.ts';
import { pinOf } from './verify.ts';

const NOW = Date.parse('2026-11-16T06:00:00Z');
const discovery = (over: Record<string, unknown> = {}) => ({
  domain: { name: 'Holdback', version: '0.8', chainId: SEPOLIA!.chainId, verifyingContract: SEPOLIA!.rules },
  token: { id: SEPOLIA!.token.address },
  schemaVersion: '0.11',
  settlementTime: '2026-11-16T06:00:01Z',
  demo: { operators: CROW_OPERATORS, faucet: { perAddressEverySec: 3600, perClientPerWindow: 50, mintsPerDay: 600 }, build: { commit: '5b8e9d334cf5' } },
  ...over,
});

type Answer = { status?: number; body?: unknown; fail?: 'network' | 'timeout' };
function world(answers: Record<string, Answer>, env: Record<string, string> = {}, node = '22.20.0') {
  const calls: Array<{ url: string; method: string }> = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET' });
    const a = answers[url] ?? { status: 404 };
    if (a.fail === 'network') throw new TypeError('fetch failed');
    if (a.fail === 'timeout') throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    return new Response(JSON.stringify(a.body ?? {}), { status: a.status ?? 200 });
  }) as unknown as typeof fetch;
  const input: Input = { env, fetch: f, now: () => NOW, node };
  return { input, calls };
}
const healthy = (d1 = discovery(), d2 = discovery()): Record<string, Answer> => ({
  [`${CROW_OPERATORS[0]}/.well-known/holdback.json`]: { body: d1 },
  [`${CROW_OPERATORS[1]}/.well-known/holdback.json`]: { body: d2 },
  [TEST_AGENTS['test-seller']]: { body: { offers: [] } },
  [TEST_AGENTS['test-buyer']]: { body: { offers: [] } },
});
const levels = (rows: Awaited<ReturnType<typeof preflight>>, check: string) => rows.filter((r) => r.check === check).map((r) => r.level);

describe('preflight (T-491)', () => {
  it('pins what verify.ts pins from the same deployment file', () => {
    const p = pinOf(SEPOLIA!);
    expect(pinned()).toEqual({ domain: { ...p.domain, verifyingContract: p.domain.verifyingContract.toLowerCase() }, token: p.token.id.toLowerCase() });
  });

  it('passes a healthy demo with GETs only, and says the operators take no reports', async () => {
    const { input, calls } = world(healthy());
    const rows = await preflight(input);
    expect(summary(rows).fail).toBe(0);
    expect(summary(rows).warn).toBe(0);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    expect(calls).toHaveLength(4);
    expect(rows.find((r) => r.check === 'report')!.text).toMatch(/take no reports/);
    expect(rows.find((r) => r.check === 'clock')!.text).toBe(`this machine is 1 s behind ${CROW_OPERATORS[0]}`);
  });

  it('says reports are taken when discovery lists the feedback route', async () => {
    const d = discovery({ feedback: { path: '/v1/feedback' } });
    const rows = await preflight(world(healthy(d, d)).input);
    expect(rows.find((r) => r.check === 'report')!.text).toMatch(/^reports taken/);
  });

  it('reports every failure in one run, not the first only', async () => {
    const wrong = discovery({ domain: { name: 'Holdback', version: '0.8', chainId: 1, verifyingContract: '0x0000000000000000000000000000000000000001' }, settlementTime: '2026-11-16T05:40:00Z' });
    const answers = healthy(wrong);
    answers[`${CROW_OPERATORS[1]}/.well-known/holdback.json`] = { fail: 'timeout' };
    answers[TEST_AGENTS['test-seller']] = { fail: 'network' };
    const rows = await preflight(world(answers, {}, '18.19.0').input);
    expect(levels(rows, 'node')).toEqual(['fail']);
    expect(levels(rows, 'pins')).toEqual(['fail']);
    expect(levels(rows, 'clock')).toEqual(['fail']);
    expect(levels(rows, 'operator')).toEqual(['ok', 'fail']);
    expect(levels(rows, 'test-seller')).toEqual(['warn']);
    expect(rows.find((r) => r.check === 'operator' && r.level === 'fail')!.text).toMatch(/no answer in 10 s/);
    expect(summary(rows).fail).toBe(4);
  });

  it('warns on Node 20 to 22.17: the try commands run, buy.mjs does not', async () => {
    const rows = await preflight(world(healthy(), {}, '20.11.1').input);
    expect(levels(rows, 'node')).toEqual(['warn']);
  });

  it('names variables but never prints their values, and warns on the ones that redirect signing', async () => {
    const secret = 'sk-do-not-print-0123456789';
    const env = { CROW_QUOTE_CREDENTIAL: secret, HOLDBACK_DEPLOYMENT: '{"chainId":1}', HOLDBACK_OPERATORS: 'https://evil.example', PATH: '/bin' };
    const answers = { ...healthy(), 'https://evil.example/.well-known/holdback.json': { body: discovery() } };
    const rows = await preflight(world(answers, env).input);
    const out = JSON.stringify(rows);
    expect(out).not.toContain(secret);
    expect(out).not.toContain('"chainId":1');
    expect(out).not.toContain('PATH');
    expect(levels(rows, 'env').sort()).toEqual(['note', 'warn', 'warn']);
    expect(rows.find((r) => r.text.startsWith('HOLDBACK_OPERATORS'))!.text).toMatch(/other operators/);
    expect(levels(rows, 'operator')).toContain('warn'); // discovery lists Crow's two, not the one set
  });

  it('fails when the two operators disagree', async () => {
    const rows = await preflight(world(healthy(discovery(), discovery({ schemaVersion: '0.12' }))).input);
    expect(levels(rows, 'agree')).toEqual(['fail']);
  });

  it('prints no operator text it did not parse', async () => {
    const d = discovery({ schemaVersion: '0.11\n\u001b[2Jok    pins  forged line', demo: { ...discovery().demo, build: { commit: 'abc\nfail' } } });
    const rows = await preflight(world(healthy(d, d)).input);
    for (const r of rows) expect(r.text).not.toMatch(/[\n\u001b]/);
  });
});

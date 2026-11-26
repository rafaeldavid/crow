// T-574, from T-570's red team (H2): the demo's panel is live or abstaining as a whole, chosen once as it starts. Before,
// each call chose, so a panel could mix live and scripted judges: a live seat's retry after the budget ran out, or a
// second panel in the same pass that started with budget for one seat. A scripted pass then counted as a model family.
import { FAKE_JUDGE_MARK, LIVE_REGISTRY_2_URI, LIVE_REGISTRY_URI, liveRegistry, liveRegistry2, placeholderRegistry } from '@holdback/adjudicator';
import { describe, expect, it } from 'vitest';
import { ABSTAIN_DETAIL, LIVE_DEFAULT_REGISTRY, panelConfig, type JudgeProvider } from './judges.js';
import { MemoryStorage } from './storage.js';

type Request = Parameters<JudgeProvider['complete']>[0];
const request = (judgeId: string): Request => ({ judgeId, provider: 'anthropic', model: `${judgeId}@2026-11-01`, system: 'system', user: 'user', temperature: 0, maxOutputTokens: 100 });
const verdict = JSON.stringify({ criteria: [], overall: 'pass', injectionSuspected: false, rationale: 'a live stand-in' });

/** A world's panel with a stand-in for the live models, which counts its calls. */
function world(perDay: number) {
  const live: string[] = [];
  const cfg = panelConfig({
    env: {},
    storage: new MemoryStorage(),
    now: () => Date.parse('2026-11-19T12:00:00Z'),
    liveCallsPerDay: perDay,
    judgeProvider: { complete: async (r) => (live.push(r.judgeId), { kind: 'ok', text: verdict }) },
  });
  cfg.allowLive = true;
  /** How each answer was made: live (the stand-in's text), scripted (the fake-judge mark), or `abstain` (an abstaining seat: since T-574 a live world never scripts). */
  const how = async (r: Request) => {
    const a = await cfg.provider.complete(r);
    if (a.kind === 'ok') return a.text.includes(FAKE_JUDGE_MARK) ? 'scripted' : a.text === verdict ? 'live' : 'other';
    // T-574: an abstaining seat says so, and is not retried (a transport error would be).
    return a.kind === 'error' && a.detail === ABSTAIN_DETAIL && !a.transport ? 'abstain' : a.kind;
  };
  return { cfg, live, how };
}
const seats = ['claude-a', 'claude-b', 'deepseek-a'];

describe('the demo panel chooses live or scripted once (T-574)', () => {
  it("a live panel's retry stays live and is counted; a panel is live only when the budget holds twice its size", async () => {
    const { cfg, live, how } = world(6);
    const first = await cfg.panel(3, async () => [...(await Promise.all(seats.map((s) => how(request(s))))), await how(request('deepseek-a'))]);
    expect(first).toEqual(['live', 'live', 'live', 'live']);
    expect((await cfg.budget.used()).calls).toBe(4);
    // 2 calls left, fewer than the 6 a panel of 3 may need with its retries.
    const second = await cfg.panel(3, () => Promise.all(seats.map((s) => how(request(s)))));
    expect(second).toEqual(['abstain', 'abstain', 'abstain']);
    expect(live).toHaveLength(4);
  });

  it('a second panel in the same pass, with budget for fewer seats than it has, abstains as a whole', async () => {
    const { cfg, live, how } = world(8);
    expect(await cfg.panel(3, () => Promise.all(seats.map((s) => how(request(s)))))).toEqual(['live', 'live', 'live']);
    // Five calls left, fewer than the 6 a panel of 3 may need with its retries: scripted as a whole, so it can never
    // start live and finish scripted.
    expect(await cfg.panel(3, () => Promise.all(seats.map((s) => how(request(s)))))).toEqual(['abstain', 'abstain', 'abstain']);
    expect([live.length, await cfg.budget.remaining()]).toEqual([3, 5]);
  });

  it('a call outside any panel, or in a pass not allowed live, abstains and costs nothing', async () => {
    const { cfg, live, how } = world(30);
    expect(await how(request('claude-a'))).toBe('abstain');
    cfg.allowLive = false;
    expect(await cfg.panel(3, () => how(request('claude-a')))).toBe('abstain');
    expect([live.length, (await cfg.budget.used()).calls]).toEqual([0, 0]);
  });

  it('the choice ends with the panel, also when the panel throws', async () => {
    const { cfg, how } = world(30);
    await expect(cfg.panel(3, async () => { throw new Error('a store read failed'); })).rejects.toThrow('a store read failed');
    expect(await how(request('claude-a'))).toBe('abstain');
  });
});

describe('a chain world with an incomplete live configuration fails closed (N222)', () => {
  const closed = (env: Record<string, string>, failClosed = true) =>
    panelConfig({ env, storage: new MemoryStorage(), now: () => Date.parse('2026-11-25T12:00:00Z'), failClosed });

  it('abstains on every call, in a panel or out of it, and never scripts a verdict', async () => {
    const cfg = closed({ HOLDBACK_ANTHROPIC_API_KEY: 'k' });
    cfg.allowLive = true;
    expect(cfg).toMatchObject({ live: false, closed: true });
    expect(cfg.missing).toEqual(['HOLDBACK_OPENAI_COMPATIBLE_API_KEY', 'HOLDBACK_OPENAI_COMPATIBLE_BASE_URL']);
    for (const call of [() => cfg.provider.complete(request('claude-a')), () => cfg.panel(3, () => cfg.provider.complete(request('deepseek-a')))]) {
      const a = await call();
      expect(a).toMatchObject({ kind: 'error', transport: false });
      expect(JSON.stringify(a)).not.toContain(FAKE_JUDGE_MARK);
    }
    expect(await cfg.canRunLive(3)).toBe(false);
  });

  it('without the flag (SimChain, the local demo) the scripted judges stay, marked', async () => {
    const cfg = closed({}, false);
    expect(cfg).toMatchObject({ live: false, closed: false });
    const a = await cfg.provider.complete(request('claude-a'));
    expect(a.kind === 'ok' && a.text.includes(FAKE_JUDGE_MARK)).toBe(true);
  });

  it('logs one line at start that names the missing variables and no value', () => {
    const lines: string[] = [];
    const orig = console.warn;
    console.warn = (...a: unknown[]) => void lines.push(a.join(' '));
    try {
      closed({ HOLDBACK_ANTHROPIC_API_KEY: 'secret-value' });
    } finally {
      console.warn = orig;
    }
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/HOLDBACK_OPENAI_COMPATIBLE_API_KEY/);
    expect(lines[0]).not.toContain('secret-value');
  });

  // Red team of PR 797 (L1): all three variables set, but the base URL is not https, so the live provider refuses. The
  // world failed closed with `missing: []`: discovery, the decline reason and the warn line named no variable to fix.
  it('names the base URL when all three are set but it is not an https URL, and logs neither value', () => {
    const lines: string[] = [];
    const orig = console.warn;
    console.warn = (...a: unknown[]) => void lines.push(a.join(' '));
    let cfg: ReturnType<typeof closed>;
    try {
      cfg = closed({ HOLDBACK_ANTHROPIC_API_KEY: 'secret-a', HOLDBACK_OPENAI_COMPATIBLE_API_KEY: 'secret-b', HOLDBACK_OPENAI_COMPATIBLE_BASE_URL: 'http://judges.example' });
    } finally {
      console.warn = orig;
    }
    expect(cfg).toMatchObject({ live: false, closed: true, missing: ['HOLDBACK_OPENAI_COMPATIBLE_BASE_URL'] });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/HOLDBACK_OPENAI_COMPATIBLE_BASE_URL/);
    for (const v of ['secret-a', 'secret-b', 'judges.example']) expect(lines[0]).not.toContain(v);
  });
});

// T-631, ADR-0036: a new default registry ships in two deploys. The carry deploy keeps config/judges-live.yaml as the
// registry new deals bind and carries config/judges-live-2.yaml beside it, reached through the same live panel; the
// flip deploy swaps the two. Either way a deal keeps the registry it bound, and both are judged live within one budget.
describe('the live world carries both live registries (T-631)', () => {
  it('binds new deals to the live default and carries the other live registry with the same panel provider', async () => {
    const { cfg, live } = world(100);
    expect(LIVE_DEFAULT_REGISTRY).toBe('config/judges-live.yaml');
    expect(cfg.registry.hash).toBe(liveRegistry().hash);
    expect(cfg.registryUri).toBe(LIVE_REGISTRY_URI);
    expect(cfg.kept.map((k) => [k.uri, k.registry.hash])).toEqual([[LIVE_REGISTRY_2_URI, liveRegistry2().hash]]);
    // The carried registry's seats go through the panel: live inside a live panel, counted against the same budget.
    const kept = cfg.kept[0]!;
    const a = await cfg.panel(3, () => kept.provider.complete(request('claude-opus-5-5')));
    expect(a.kind).toBe('ok');
    expect(live).toEqual(['claude-opus-5-5']);
    expect((await cfg.budget.used()).calls).toBe(1);
    // Outside a panel it abstains, as the default registry's seats do.
    const b = await kept.provider.complete(request('claude-opus-5-5'));
    expect(b.kind === 'error' && b.detail).toBe(ABSTAIN_DETAIL);
  });

  it('never carries the placeholder registry, live or scripted', () => {
    const { cfg } = world(100);
    expect(cfg.kept.map((k) => k.registry.hash)).not.toContain(placeholderRegistry().hash);
    const scripted = panelConfig({ env: {}, storage: new MemoryStorage(), now: () => 0 });
    expect(scripted.kept).toEqual([]);
  });
});

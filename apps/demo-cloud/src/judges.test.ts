// T-574, from T-570's red team (H2): the demo's panel is live or scripted as a whole, chosen once as it starts. Before,
// each call chose, so a panel could mix live and scripted judges: a live seat's retry after the budget ran out, or a
// second panel in the same pass that started with budget for one seat. A scripted pass then counted as a model family.
import { FAKE_JUDGE_MARK } from '@holdback/adjudicator';
import { describe, expect, it } from 'vitest';
import { panelConfig, type JudgeProvider } from './judges.js';
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
  /** How each answer was made: live (the stand-in's text) or scripted (the fake-judge mark). */
  const how = async (r: Request) => {
    const a = await cfg.provider.complete(r);
    return a.kind === 'ok' && a.text.includes(FAKE_JUDGE_MARK) ? 'scripted' : a.kind === 'ok' && a.text === verdict ? 'live' : a.kind;
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
    expect(second).toEqual(['scripted', 'scripted', 'scripted']);
    expect(live).toHaveLength(4);
  });

  it('a second panel in the same pass, with budget for fewer seats than it has, is scripted as a whole', async () => {
    const { cfg, live, how } = world(8);
    expect(await cfg.panel(3, () => Promise.all(seats.map((s) => how(request(s)))))).toEqual(['live', 'live', 'live']);
    // Five calls left, fewer than the 6 a panel of 3 may need with its retries: scripted as a whole, so it can never
    // start live and finish scripted.
    expect(await cfg.panel(3, () => Promise.all(seats.map((s) => how(request(s)))))).toEqual(['scripted', 'scripted', 'scripted']);
    expect([live.length, await cfg.budget.remaining()]).toEqual([3, 5]);
  });

  it('a call outside any panel, or in a pass not allowed live, is scripted and costs nothing', async () => {
    const { cfg, live, how } = world(30);
    expect(await how(request('claude-a'))).toBe('scripted');
    cfg.allowLive = false;
    expect(await cfg.panel(3, () => how(request('claude-a')))).toBe('scripted');
    expect([live.length, (await cfg.budget.used()).calls]).toEqual([0, 0]);
  });

  it('the choice ends with the panel, also when the panel throws', async () => {
    const { cfg, how } = world(30);
    await expect(cfg.panel(3, async () => { throw new Error('a store read failed'); })).rejects.toThrow('a store read failed');
    expect(await how(request('claude-a'))).toBe('scripted');
  });
});

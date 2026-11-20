// T-574 red team (item 6): attacks on the demo panel's live-or-scripted choice (judges.ts, `PanelConfig.panel`). Each
// test asserts what the defence holds; both failed before the red team's L1 and L2 were fixed. Neither gap mixed a panel
// on today's production path: the Durable Object runs one alarm pass at a time, and the adjudicators decide in turn.
import { FAKE_JUDGE_MARK } from '@holdback/adjudicator';
import { describe, expect, it } from 'vitest';
import { JudgeBudget, panelConfig, type JudgeProvider } from './judges.js';
import { MemoryStorage } from './storage.js';

type Request = Parameters<JudgeProvider['complete']>[0];
const request = (judgeId: string): Request => ({ judgeId, provider: 'anthropic', model: `${judgeId}@2026-11-01`, system: 'system', user: 'user', temperature: 0, maxOutputTokens: 100 });
const verdict = JSON.stringify({ criteria: [], overall: 'pass', injectionSuspected: false, rationale: 'a live stand-in' });

describe('red team: the demo panel choice (T-574)', () => {
  // The choice is one closure variable shared by every panel of the world, and the end of any panel clears it. Panels
  // "run one at a time" only by a comment: nothing refuses a second panel while one is open. If two ever overlap (a
  // second pass driver, a concurrent pass, a future parallel task loop), the first panel's retry after a 503 goes
  // scripted, and the scripted pass counts as a model family: T-570's H2 again.
  it('attack.panel-overlap: a panel that opens and closes inside a live panel leaves the live panel live', async () => {
    const live: string[] = [];
    const cfg = panelConfig({
      env: {},
      storage: new MemoryStorage(),
      now: () => Date.parse('2026-11-19T12:00:00Z'),
      liveCallsPerDay: 30,
      judgeProvider: { complete: async (r) => (live.push(r.judgeId), { kind: 'ok', text: verdict }) },
    });
    cfg.allowLive = true;
    const how = async (r: Request) => {
      const a = await cfg.provider.complete(r);
      return a.kind === 'ok' && a.text.includes(FAKE_JUDGE_MARK) ? 'scripted' : a.kind === 'ok' ? 'live' : a.kind;
    };
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = cfg.panel(3, async () => {
      const a = await how(request('claude-a'));
      await gate; // the seat's 503, while another panel runs
      const retry = await how(request('deepseek-a'));
      return [a, retry];
    });
    // Since the fix, a panel asked for meanwhile waits for the open one to end, then makes its own choice.
    const order: string[] = [];
    const second = cfg.panel(3, async () => (order.push('second'), how(request('claude-b'))));
    await new Promise((r) => setImmediate(r));
    expect(order).toEqual([]);
    release();
    expect(await first).toEqual(['live', 'live']);
    expect(await second).toBe('live');
    expect(live).toEqual(['claude-a', 'deepseek-a', 'claude-b']);
  });

  // A panel chosen live at 23:59:59 UTC charges its later calls to the next day. `load()` then swaps the in-memory day
  // without writing the old one, and `flush()` writes only the new day: the old day's calls since the last flush are
  // lost from storage, so `demo.judges` and the T-066 cost rows under-count that day. No panel mixes.
  it("attack.budget-midnight: a panel that crosses UTC midnight keeps the old day's calls in storage", async () => {
    const storage = new MemoryStorage();
    let t = Date.parse('2026-11-19T23:59:59Z');
    const budget = new JudgeBudget(storage, 30, () => t);
    await budget.charge(); // the panel's first seat, before midnight
    t = Date.parse('2026-11-20T00:00:01Z');
    await budget.charge(); // its retry, after midnight
    await budget.flush();
    expect([(await budget.on('2026-11-19')).calls, (await budget.on('2026-11-20')).calls]).toEqual([1, 1]);
  });
});

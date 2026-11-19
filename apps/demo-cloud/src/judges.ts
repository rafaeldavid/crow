// The public demo's judge panel: live pinned models from two families when the three model variables are
// set as Worker secrets, within a daily cap on live judge calls; scripted fake judges otherwise. The cap is the
// spending limit for the public faucet: past it, panels are scripted for the rest of the UTC day, and their
// verdicts carry the fake-judge mark, so a record never passes scripted output for a model's.
//
// T-574: a panel is live or scripted as a whole, chosen once when it starts (`PanelConfig.panel`). Before, each call
// chose, so a live seat's retry after an HTTP 503 could go to the scripted judge once the budget ran out, and that
// scripted pass counted as the second model family (T-570's red team, H2).
import { liveJudges, liveRegistry, LIVE_REGISTRY_URI, markedFake, markerFake, missingLiveEnv, placeholderRegistry, type JudgeUsage, type KeptRegistry, type TestAdjudicatorOptions } from '@holdback/adjudicator';
import type { WorldStorage } from './storage.js';

export type JudgeProvider = NonNullable<TestAdjudicatorOptions['provider']>;
type Registry = NonNullable<TestAdjudicatorOptions['registry']>;

/** Live judge calls a day across the whole demo, unless LIVE_JUDGE_CALLS_PER_DAY says otherwise. */
export const DEFAULT_LIVE_CALLS_PER_DAY = 30;
const PLACEHOLDER_REGISTRY_URI = 'file:///config/judges.yaml';

/** One model's live calls and tokens for a day: counts only, never a prompt or a verdict (T-066). */
export interface ModelDay {
  calls: number;
  input: number;
  output: number;
}

interface Day {
  day: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Per registry model ID; absent on days stored before T-066. */
  byModel?: Record<string, ModelDay>;
}

/** A copy that shares no object with the live day, `byModel` included. */
const copyDay = (d: Day): Day => ({ ...d, byModel: Object.fromEntries(Object.entries(d.byModel ?? {}).map(([k, v]) => [k, { ...v }])) });

/** Today's live calls and tokens, kept in world storage under `lj:<UTC date>`. */
export class JudgeBudget {
  private today: Day | undefined;
  private dirty = false;

  constructor(
    private readonly storage: WorldStorage,
    readonly perDay: number,
    private readonly now: () => number,
  ) {}

  private async load(): Promise<Day> {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if (this.today?.day !== day) {
      // A pass that crosses UTC midnight writes the old day before it moves on, so its calls stay counted (T-574 red team L2).
      await this.flush();
      this.today = (await this.storage.get<Day>(`lj:${day}`)) ?? { day, calls: 0, inputTokens: 0, outputTokens: 0 };
    }
    return this.today;
  }

  async used(): Promise<Day> {
    return copyDay(await this.load());
  }

  /** A day's live calls and tokens: today's as counted so far, another day's from storage. */
  async on(day: string): Promise<Day> {
    if (this.today?.day === day) return copyDay(this.today);
    return (await this.storage.get<Day>(`lj:${day}`)) ?? { day, calls: 0, inputTokens: 0, outputTokens: 0 };
  }

  async remaining(): Promise<number> {
    return Math.max(0, this.perDay - (await this.load()).calls);
  }

  /** Takes one call from today's budget; false when none is left. */
  async take(): Promise<boolean> {
    const d = await this.load();
    if (d.calls >= this.perDay) return false;
    d.calls++;
    this.dirty = true;
    return true;
  }

  /**
   * Counts one call of a panel already chosen live, even past the day's budget (T-574). A live panel finishes live: its
   * retries are counted, so the next panel sees what they cost. It can pass the budget by at most its own retries.
   */
  async charge(): Promise<void> {
    (await this.load()).calls++;
    this.dirty = true;
  }

  usage(u: JudgeUsage): void {
    if (!this.today) return;
    this.today.inputTokens += u.inputTokens;
    this.today.outputTokens += u.outputTokens;
    // T-066: the same counts split by the registry's model ID, so a rubric deal's judge cost can be priced by model.
    const byModel = (this.today.byModel ??= {});
    const m = (byModel[u.model] ??= { calls: 0, input: 0, output: 0 });
    m.calls += 1;
    m.input += u.inputTokens;
    m.output += u.outputTokens;
    this.dirty = true;
  }

  async flush(): Promise<void> {
    if (!this.dirty || !this.today) return;
    this.dirty = false;
    await this.storage.put({ [`lj:${this.today.day}`]: { ...this.today } });
  }
}

export interface PanelConfig {
  live: boolean;
  registry: Registry;
  registryUri: string;
  /**
   * ADR-0036: the other registries this world carries, each with a provider that reaches its models. None: the live
   * world never carries the placeholder registry, whose "judges" are scripted fakes, or a seller could bind a deal to it
   * through its own primary and have a live Crow fallback accept the work with no model run (T-377 red team H1). And
   * without the live keys no provider reaches the live models. So a deal bound to the other registry cannot be judged
   * here, and the state read says so.
   */
  kept: KeptRegistry[];
  /** The live-judging variables that are missing, by name (empty when live). */
  missing: string[];
  /** What every adjudicator calls: the live models inside a panel chosen live, the scripted judges otherwise. */
  provider: JudgeProvider;
  budget: JudgeBudget;
  /** Set before each adjudicator pass: no panel in the pass is live unless it is set. */
  allowLive: boolean;
  /**
   * Runs one panel (one decision task) live or scripted as a whole (T-574): live when `allowLive` is set and today's
   * budget still holds `size` calls, chosen once before any call. Every call inside it, a retry included, goes the same
   * way, and a live call is counted. A call outside any panel is scripted. Panels run one at a time: a panel asked for
   * while another is open waits for it (T-574 red team L1), so no panel's end can change another's choice.
   */
  panel<T>(size: number, run: () => Promise<T>): Promise<T>;
}

export interface PanelOptions {
  env: Readonly<Record<string, string | undefined>>;
  storage: WorldStorage;
  now: () => number;
  /** Stands in for the live models (tests). */
  judgeProvider?: JudgeProvider;
  liveCallsPerDay?: number;
}

/** Live when a stand-in is given or all three model variables are set; scripted otherwise. */
export function panelConfig(o: PanelOptions): PanelConfig {
  const fromEnv = Number(o.env['LIVE_JUDGE_CALLS_PER_DAY']);
  const perDay = o.liveCallsPerDay ?? (Number.isSafeInteger(fromEnv) && fromEnv >= 0 && o.env['LIVE_JUDGE_CALLS_PER_DAY'] ? fromEnv : DEFAULT_LIVE_CALLS_PER_DAY);
  const budget = new JudgeBudget(o.storage, perDay, o.now);
  const scripted = markedFake(markerFake());
  const live = o.judgeProvider ? { ok: true as const, value: o.judgeProvider } : liveJudges(o.env, { onUsage: (u) => budget.usage(u) });
  if (!live.ok) {
    return { live: false, registry: placeholderRegistry(), registryUri: PLACEHOLDER_REGISTRY_URI, kept: [], missing: missingLiveEnv(o.env), provider: scripted, budget, allowLive: false, panel: (_size, run) => run() };
  }
  /** The open panel's choice: undefined outside a panel. */
  let mode: 'live' | 'scripted' | undefined;
  /** The end of the last panel asked for: the next one starts after it. */
  let queue: Promise<unknown> = Promise.resolve();
  const cfg: PanelConfig = {
    live: true,
    registry: liveRegistry(),
    registryUri: LIVE_REGISTRY_URI,
    kept: [],
    missing: [],
    budget,
    allowLive: false,
    provider: {
      complete: async (r) => {
        if (mode !== 'live') return scripted.complete(r);
        await budget.charge();
        return live.value.complete(r);
      },
    },
    panel: (size, run) => {
      const turn = queue.then(async () => {
        mode = cfg.allowLive && (await budget.remaining()) >= size ? 'live' : 'scripted';
        try {
          return await run();
        } finally {
          mode = undefined;
        }
      });
      queue = turn.catch(() => undefined);
      return turn;
    },
  };
  return cfg;
}

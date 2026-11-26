// The public demo's judge panel: live pinned models from two families when the three model variables are
// set as Worker secrets, within a daily cap on live judge calls; scripted fake judges otherwise, marked as such. The cap
// is the spending limit for the public faucet. Past it, on Rafa's decision of 2026-11-20 ("Decline new judged deals
// until following day, until we have sufficient Crow usage, then revisit"; T-574): Crow's primary declines a new deal
// that can need a panel until the next UTC day (world.ts, `judgedDealGate`). A first-instance panel of a deal already in
// flight abstains (`ABSTAIN_DETAIL`), so it escalates; an appeal panel past the budget is not convened (world.ts,
// `appealPanelGate`), so the default outcome applies unless a panel can run before the deadline. A live world never gives
// a scripted verdict. To revisit once Crow has sufficient usage.
//
// N222: a world that settles on a chain fails closed the same way when a live model variable is missing (`failClosed`,
// `PanelConfig.closed`): every seat abstains, and the primary declines a new deal that can need a panel
// (world.ts, `judgedDealGate`, reason `judges_unconfigured:`). SimChain and the local demo keep the scripted judges.
//
// T-574: a panel is live or abstaining as a whole, chosen once when it starts (`PanelConfig.panel`). Before, each call
// chose, so a live seat's retry after an HTTP 503 could go to the scripted judge once the budget ran out, and that
// scripted pass counted as the second model family (T-570's red team, H2).
import { liveJudges, liveRegistry, liveRegistry2, LIVE_REGISTRY_2_URI, LIVE_REGISTRY_URI, markedFake, markerFake, missingLiveEnv, OPENAI_COMPATIBLE_BASE_URL_ENV, placeholderRegistry, type JudgeCallError, type JudgeUsage, type KeptRegistry, type TestAdjudicatorOptions } from '@holdback/adjudicator';
import { wholeNumberVar } from './limits.js';
import type { WorldStorage } from './storage.js';

export type JudgeProvider = NonNullable<TestAdjudicatorOptions['provider']>;
type Registry = NonNullable<TestAdjudicatorOptions['registry']>;

/** What each seat of a panel that cannot run live answers in a live world: no model ran, so the seat abstains (T-574). */
export const ABSTAIN_DETAIL = "today's live judge budget is spent: no model ran, so this seat abstains";

/** What each seat answers in a chain world whose live judge variables are incomplete (N222): no model ran, so it abstains. */
export const UNCONFIGURED_DETAIL = 'the live judge models are not all configured: no model ran, so this seat abstains';

/** Why Crow's adjudicators decline a new deal that can need a panel while the live judge variables are incomplete (N222). */
export const unconfiguredReason = (missing: readonly string[]): string =>
  `judges_unconfigured: this demo's live judge models are not all configured (missing: ${missing.join(', ')}), so Crow's adjudicators accept no deal that can need a judge panel and never judge with a scripted stand-in; offer checks-only terms whose checks are all required, which are accepted now`;

/** The next UTC midnight after `ms`, as an ISO timestamp: when the day's live judge budget resets. */
export const nextUtcDay = (ms: number): string => {
  const d = new Date(ms);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
};

/** Live judge calls a day across the whole demo, both nodes together, unless LIVE_JUDGE_CALLS_PER_DAY says otherwise (100 since Rafa, 2026-11-24; 30 before). */
export const DEFAULT_LIVE_CALLS_PER_DAY = 100;
const PLACEHOLDER_REGISTRY_URI = 'file:///config/judges.yaml';

/**
 * T-631, ADR-0036: the live registries this world carries, and the one new deals bind. A new default ships in two
 * deploys: the carry deploy keeps config/judges-live.yaml as the default and carries config/judges-live-2.yaml beside
 * it; the flip deploy sets LIVE_DEFAULT_REGISTRY to config/judges-live-2.yaml. A deal keeps the registry it bound, so
 * both stay carried, each judged by the same live panel.
 */
const LIVE_REGISTRIES = {
  'config/judges-live.yaml': { load: liveRegistry, uri: LIVE_REGISTRY_URI },
  'config/judges-live-2.yaml': { load: liveRegistry2, uri: LIVE_REGISTRY_2_URI },
} as const;
export const LIVE_DEFAULT_REGISTRY: keyof typeof LIVE_REGISTRIES = 'config/judges-live-2.yaml';
const liveDefault = () => LIVE_REGISTRIES[LIVE_DEFAULT_REGISTRY];
/** The providers the default live registry seats: live judging needs each one's variables, or the world fails closed (T-631). */
const liveNeed = () => [...new Set(liveDefault().load().active.map((e) => e.provider))].sort();
/** The other live registries, each reached through `provider` (the world's panel). */
const liveKept = (provider: JudgeProvider): KeptRegistry[] =>
  Object.entries(LIVE_REGISTRIES)
    .filter(([file]) => file !== LIVE_DEFAULT_REGISTRY)
    .map(([, r]) => ({ registry: r.load(), uri: r.uri, provider }));

/** One model's live calls and tokens for a day: counts only, never a prompt or a verdict (T-066). */
export interface ModelDay {
  calls: number;
  input: number;
  output: number;
  /** T-632: calls that gave no verdict, by code (JudgeCallError): counts only, never provider text. */
  errors?: Record<string, number>;
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
const copyDay = (d: Day): Day => ({ ...d, byModel: Object.fromEntries(Object.entries(d.byModel ?? {}).map(([k, v]) => [k, { ...v, ...(v.errors ? { errors: { ...v.errors } } : {}) }])) });

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
   * Counts one call of a panel already chosen live (T-574). A live panel finishes live, and its retries are counted, so
   * the next panel sees what they cost. It never passes the budget: a panel is chosen live only when the budget holds
   * twice its size, a first call and one retry for every seat (`PanelConfig.panel`).
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

  /**
   * T-632: counts a live call that gave no verdict under its model and code, and logs one line (names and the code
   * only). Before, a failed seat left no trace but the call count: every seat failed for an hour after the flip, and
   * the records said only "error".
   */
  error(e: JudgeCallError): void {
    console.warn(`judge call failed: ${e.provider} ${e.model} ${e.code}`);
    if (!this.today) return;
    const byModel = (this.today.byModel ??= {});
    const m = (byModel[e.model] ??= { calls: 0, input: 0, output: 0 });
    const errors = (m.errors ??= {});
    errors[e.code] = (errors[e.code] ?? 0) + 1;
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
  /**
   * N222: a chain world whose live judge variables are incomplete. Not live, and no scripted judges either: every seat
   * abstains (UNCONFIGURED_DETAIL) and Crow's adjudicators decline new deals that can need a panel. Always false on
   * SimChain and the local demo.
   */
  closed: boolean;
  registry: Registry;
  registryUri: string;
  /**
   * ADR-0036: the other registries this world carries, each with a provider that reaches its models. A live world
   * carries the other live registry (T-631) through its panel, and nothing else. It never carries the placeholder registry, whose "judges" are scripted fakes, or a seller could bind a deal to it
   * through its own primary and have a live Crow fallback accept the work with no model run (T-377 red team H1). And
   * without the live keys no provider reaches the live models. So a deal bound to the placeholder registry cannot be
   * judged here, and the state read says so.
   */
  kept: KeptRegistry[];
  /** The live-judging variables that are missing, by name (empty when live). */
  missing: string[];
  /**
   * What every adjudicator calls. A live world: the live models inside a panel chosen live, and otherwise an abstention
   * (ABSTAIN_DETAIL), never a scripted verdict (T-574). A world without the live keys: the scripted judges.
   */
  provider: JudgeProvider;
  budget: JudgeBudget;
  /** Set before each adjudicator pass: no panel in the pass is live unless it is set. */
  allowLive: boolean;
  /**
   * Runs one panel (one decision task) live or abstaining as a whole (T-574): live when `allowLive` is set and today's
   * budget still holds `2 * size` calls, chosen once before any call. Each seat calls once and retries at most once
   * after a transport error (packages/judgment, pipeline.ts), so a live panel never passes the day's cap. Every call inside it, a retry included, goes the same
   * way, and a live call is counted. A call outside any panel abstains. Panels run one at a time: a panel asked for
   * while another is open waits for it (T-574 red team L1), so no panel's end can change another's choice.
   */
  panel<T>(size: number, run: () => Promise<T>): Promise<T>;
  /** T-574: whether today's budget still holds a whole live panel of `size` seats, retries included (`2 * size` calls). */
  canRunLive(size: number): Promise<boolean>;
  /** T-574: when the day's budget resets, the next UTC midnight. */
  resumesAt(): string;
}

export interface PanelOptions {
  env: Readonly<Record<string, string | undefined>>;
  storage: WorldStorage;
  now: () => number;
  /** Stands in for the live models (tests). */
  judgeProvider?: JudgeProvider;
  liveCallsPerDay?: number;
  /** N222: fail closed, not scripted, when the live variables are incomplete. The world sets it for every chain world. */
  failClosed?: boolean;
  /** The fetch the live providers call (tests: a stand-in that behaves like the Workers runtime, T-632). Default: the global fetch. */
  fetch?: typeof fetch;
}

/** Live when a stand-in is given or all three model variables are set; otherwise scripted, or closed with `failClosed` (N222). */
export function panelConfig(o: PanelOptions): PanelConfig {
  // T-581: strict, like the other limits. A malformed value refuses to start, so a typo in this quick stop never leaves
  // judging on at the default.
  const perDay = o.liveCallsPerDay ?? wholeNumberVar(o.env, 'LIVE_JUDGE_CALLS_PER_DAY', DEFAULT_LIVE_CALLS_PER_DAY);
  const budget = new JudgeBudget(o.storage, perDay, o.now);
  const scripted = markedFake(markerFake());
  const live = o.judgeProvider ? { ok: true as const, value: o.judgeProvider } : liveJudges(o.env, { onUsage: (u) => budget.usage(u), onError: (e) => budget.error(e), need: liveNeed(), ...(o.fetch ? { fetch: o.fetch } : {}) });
  if (!live.ok && o.failClosed) {
    // All three set, yet refused: the base URL is not https (liveProvider), so name it rather than nothing (red team of PR 797, L1).
    const unset = missingLiveEnv(o.env, liveNeed());
    const missing = unset.length ? unset : [OPENAI_COMPATIBLE_BASE_URL_ENV];
    // One line at start, names only: never a value (N222).
    console.warn(`judges fail closed: the live judge variables are incomplete (missing: ${missing.join(', ')}); Crow's adjudicators decline new judged deals and any judgment under way abstains`);
    const closed: JudgeProvider = { complete: async () => ({ kind: 'error', transport: false, detail: UNCONFIGURED_DETAIL }) };
    return { live: false, closed: true, registry: liveDefault().load(), registryUri: liveDefault().uri, kept: [], missing, provider: closed, budget, allowLive: false, panel: (_size, run) => run(), canRunLive: async () => false, resumesAt: () => nextUtcDay(o.now()) };
  }
  if (!live.ok) {
    return { live: false, closed: false, registry: placeholderRegistry(), registryUri: PLACEHOLDER_REGISTRY_URI, kept: [], missing: missingLiveEnv(o.env, liveNeed()), provider: scripted, budget, allowLive: false, panel: (_size, run) => run(), canRunLive: async () => true, resumesAt: () => nextUtcDay(o.now()) };
  }
  const abstain: JudgeProvider = { complete: async () => ({ kind: 'error', transport: false, detail: ABSTAIN_DETAIL }) };
  const canRunLive = async (size: number) => (await budget.remaining()) >= 2 * size;
  /** The open panel's choice: undefined outside a panel. */
  let mode: 'live' | 'abstain' | undefined;
  /** The end of the last panel asked for: the next one starts after it. */
  let queue: Promise<unknown> = Promise.resolve();
  const cfg: PanelConfig = {
    live: true,
    closed: false,
    registry: liveDefault().load(),
    registryUri: liveDefault().uri,
    kept: [],
    missing: [],
    budget,
    allowLive: false,
    provider: {
      complete: async (r) => {
        if (mode !== 'live') return abstain.complete(r);
        await budget.charge();
        return live.value.complete(r);
      },
    },
    panel: (size, run) => {
      const turn = queue.then(async () => {
        mode = cfg.allowLive && (await canRunLive(size)) ? 'live' : 'abstain';
        try {
          return await run();
        } finally {
          mode = undefined;
        }
      });
      queue = turn.catch(() => undefined);
      return turn;
    },
    canRunLive,
    resumesAt: () => nextUtcDay(o.now()),
  };
  // T-631: the other live registries go through the same panel, so their seats are live or abstaining with it and count
  // against the same budget.
  cfg.kept = liveKept(cfg.provider);
  return cfg;
}

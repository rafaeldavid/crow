// Live judge providers: Anthropic Messages, OpenAI-compatible chat completions and Google Gemini generateContent. Keys come from
// environment variables only, and a provider refuses to exist without one; a refusal names the variable, never
// a value. Requests carry the provider's model ID, the two prompt strings and an output cap; never tools, never
// URLs to fetch. Not exercised against a network in tests or CI: a stubbed fetch checks the request shape, and
// recorded and fake providers stand in elsewhere (docs/testing.md).
import { err, ok, type Result } from '@holdback/core';
import type { JudgeProvider, JudgeRequest, JudgeResponse } from '@holdback/judgment';
import type { RegistryProvider } from '@holdback/judgment';
import { routeByProvider, withTimeout } from './timeout.js';

/** The providers this build can call: the registry's (T-631 added google). */
export type LiveProviderName = RegistryProvider;

export const LIVE_KEY_ENV: Readonly<Record<LiveProviderName, string>> = {
  anthropic: 'HOLDBACK_ANTHROPIC_API_KEY',
  'openai-compatible': 'HOLDBACK_OPENAI_COMPATIBLE_API_KEY',
  google: 'HOLDBACK_GOOGLE_API_KEY',
};
export const OPENAI_COMPATIBLE_BASE_URL_ENV = 'HOLDBACK_OPENAI_COMPATIBLE_BASE_URL';
/**
 * Every variable live judging needs, in the order a refusal names them. The Google key is not one (T-631): Gemini is
 * optional, and a seat that names it without the key abstains.
 */
export const LIVE_ENV: readonly string[] = [LIVE_KEY_ENV.anthropic, LIVE_KEY_ENV['openai-compatible'], OPENAI_COMPATIBLE_BASE_URL_ENV];
/**
 * The output-token cap per live judge call, reasoning or thinking tokens included: the provider's max_tokens. It
 * replaces the request's maxOutputTokens (the pipeline's 2,048-token verdict budget), because reasoning models
 * spend tokens before the verdict: at 2,048, deepseek-flash used the whole budget reasoning and returned no text
 * (measured). The verdict itself stays bounded by the schema and MAX_OUTPUT_CHARS.
 */
export const LIVE_MAX_OUTPUT_TOKENS = 8192;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

type Env = Readonly<Record<string, string | undefined>>;

/** Tokens one live call used, as the provider reported them. */
export interface JudgeUsage {
  provider: LiveProviderName;
  /** The registry's model ID (with its @date suffix). */
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface LiveOptions {
  /** Output-token cap per call, sent as max_tokens. Default LIVE_MAX_OUTPUT_TOKENS. */
  maxOutputTokens?: number;
  /** Called once per answered call with the provider's token counts. */
  onUsage?: (usage: JudgeUsage) => void;
  /** For tests. Default: the global fetch. */
  fetch?: typeof fetch;
}

/**
 * The provider's model ID for a registry model ID: a trailing "@YYYY-MM-DD" (the date the registry pinned it,
 * config/judges-live.yaml) is dropped; anything else is sent as it is.
 */
export const providerModelId = (model: string): string => model.replace(/@\d{4}-\d{2}-\d{2}$/, '');

const count = (v: unknown): number => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0);

async function post(
  o: LiveOptions,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  read: (json: unknown) => { text: string | undefined; usage: [number, number]; refused?: string },
  usage: (input: number, output: number) => void,
): Promise<JudgeResponse> {
  let res: Response;
  try {
    // T-631 red team L3: never follow a redirect, which would resend the key header to another host.
    res = await (o.fetch ?? fetch)(url, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  } catch {
    return { kind: 'error', transport: true, detail: 'network error' };
  }
  if (res.status === 429 || res.status >= 500) return { kind: 'error', transport: true, detail: `HTTP ${res.status}` };
  if (!res.ok) return { kind: 'error', transport: false, detail: `HTTP ${res.status}` };
  const r = read(await res.json().catch(() => undefined));
  usage(...r.usage);
  if (r.refused) return { kind: 'error', transport: false, detail: r.refused };
  return r.text === undefined || r.text === '' ? { kind: 'error', transport: false, detail: 'no text in the response' } : { kind: 'ok', text: r.text };
}

const cap = (o: LiveOptions) => o.maxOutputTokens ?? LIVE_MAX_OUTPUT_TOKENS;
const report = (o: LiveOptions, provider: LiveProviderName, model: string) => (inputTokens: number, outputTokens: number) => o.onUsage?.({ provider, model, inputTokens, outputTokens });

// Current Claude models accept only the default sampling parameters (a temperature of 0 is a 400), so none is
// sent; effort low keeps adaptive thinking inside the output cap.
const anthropic = (key: string, o: LiveOptions): JudgeProvider => ({
  complete: (r: JudgeRequest) =>
    post(
      o,
      ANTHROPIC_URL,
      { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      { model: providerModelId(r.model), system: r.system, messages: [{ role: 'user', content: r.user }], max_tokens: cap(o), output_config: { effort: 'low' } },
      (j) => {
        const b = j as { content?: Array<{ type?: string; text?: string }>; usage?: { input_tokens?: unknown; output_tokens?: unknown } } | undefined;
        return { text: b?.content?.filter((c) => c.type === 'text').map((c) => c.text ?? '').join(''), usage: [count(b?.usage?.input_tokens), count(b?.usage?.output_tokens)] };
      },
      report(o, 'anthropic', r.model),
    ),
});

// DeepSeek's models reason by default, and on a 60k-token deliverable deepseek-v4-pro spent the whole 8,192-token
// cap reasoning and returned no verdict (measured). For api.deepseek.com, thinking is turned off, as
// Anthropic's effort is set low; other OpenAI-compatible hosts get no extra parameter.
const extraFor = (baseUrl: string): Record<string, unknown> => (new URL(baseUrl).host === 'api.deepseek.com' ? { thinking: { type: 'disabled' } } : {});

const openaiCompatible = (key: string, baseUrl: string, o: LiveOptions): JudgeProvider => ({
  complete: (r: JudgeRequest) =>
    post(
      o,
      `${baseUrl.replace(/\/$/, '')}/chat/completions`,
      { authorization: `Bearer ${key}` },
      { model: providerModelId(r.model), messages: [{ role: 'system', content: r.system }, { role: 'user', content: r.user }], temperature: r.temperature, max_tokens: cap(o), ...extraFor(baseUrl) },
      (j) => {
        const b = j as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } } | undefined;
        return { text: b?.choices?.[0]?.message?.content, usage: [count(b?.usage?.prompt_tokens), count(b?.usage?.completion_tokens)] };
      },
      report(o, 'openai-compatible', r.model),
    ),
});

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

// T-631: Gemini's generateContent. The key goes in the x-goog-api-key header, never the URL, so no log of a URL holds it.
// JSON output is asked for by MIME type only: the verdict schema is still the filter that decides (hard rules). The
// prompt goes in its places, the system prompt as systemInstruction and the data as the user turn. No tools, no
// grounding: those would store prompts at Google or reach the network. No sampling parameter: current Gemini models
// ignore temperature. Thinking stays low, as Anthropic's effort does; thought parts are never verdict text, and thinking
// tokens are billed as output, so they count as output.
const google = (key: string, o: LiveOptions): JudgeProvider => ({
  complete: (r: JudgeRequest) =>
    post(
      o,
      `${GEMINI_URL}/${encodeURIComponent(providerModelId(r.model))}:generateContent`,
      { 'x-goog-api-key': key },
      {
        systemInstruction: { parts: [{ text: r.system }] },
        contents: [{ role: 'user', parts: [{ text: r.user }] }],
        generationConfig: { maxOutputTokens: cap(o), responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'low' } },
      },
      (j) => {
        const b = j as { promptFeedback?: { blockReason?: unknown }; candidates?: Array<{ finishReason?: unknown; content?: { parts?: Array<{ text?: unknown; thought?: unknown }> } }>; usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown; thoughtsTokenCount?: unknown } } | undefined;
        const u = b?.usageMetadata;
        const usage: [number, number] = [count(u?.promptTokenCount), count(u?.candidatesTokenCount) + count(u?.thoughtsTokenCount)];
        // T-631 red team L2: a blocked prompt, or a candidate stopped for any reason but STOP (safety, recitation, the
        // output cap), is never a verdict, whatever text it carries. The reason is the provider's word: a fixed label.
        const c = b?.candidates?.[0];
        if (b?.promptFeedback?.blockReason !== undefined) return { text: undefined, usage, refused: 'the provider blocked the prompt' };
        if (c?.finishReason !== undefined && c.finishReason !== 'STOP') return { text: undefined, usage, refused: `the provider stopped the answer (${String(c.finishReason).replace(/[^A-Z_]/g, '').slice(0, 32)})` };
        const parts = c?.content?.parts?.filter((p) => p.thought !== true && typeof p.text === 'string');
        return { text: parts?.map((p) => p.text as string).join(''), usage };
      },
      report(o, 'google', r.model),
    ),
});

/** A live provider, or the reason it cannot run (no key, no base URL). */
export function liveProvider(kind: LiveProviderName, env: Env, o: LiveOptions = {}): Result<JudgeProvider, string> {
  const key = env[LIVE_KEY_ENV[kind]];
  if (!key) return err(`live ${kind} judges need ${LIVE_KEY_ENV[kind]} in the environment; use recorded or fake judges instead`);
  if (kind === 'anthropic') return ok(anthropic(key, o));
  if (kind === 'google') return ok(google(key, o));
  const base = env[OPENAI_COMPATIBLE_BASE_URL_ENV];
  if (!base || !base.startsWith('https://')) return err(`live openai-compatible judges need an https ${OPENAI_COMPATIBLE_BASE_URL_ENV}`);
  return ok(openaiCompatible(key, base, o));
}

/** The providers live judging needs unless told otherwise: the first live registry's two. */
export const DEFAULT_LIVE_PROVIDERS: readonly LiveProviderName[] = ['anthropic', 'openai-compatible'];

/** The variables the `need` providers take, in LIVE_ENV's order, then the Google key. */
export const liveEnvFor = (need: readonly LiveProviderName[] = DEFAULT_LIVE_PROVIDERS): string[] => [
  ...(need.includes('anthropic') ? [LIVE_KEY_ENV.anthropic] : []),
  ...(need.includes('openai-compatible') ? [LIVE_KEY_ENV['openai-compatible'], OPENAI_COMPATIBLE_BASE_URL_ENV] : []),
  ...(need.includes('google') ? [LIVE_KEY_ENV.google] : []),
];

/** The live-judging variables that are unset or empty, by name, for the providers `need` names (T-631). */
export const missingLiveEnv = (env: Env, need: readonly LiveProviderName[] = DEFAULT_LIVE_PROVIDERS): string[] => liveEnvFor(need).filter((name) => !env[name]);

/**
 * The live providers, routed by the seat's provider and wrapped in the judge timeout (default 60 s, the
 * policy's judgeTimeoutSec): what the adjudicator service takes as `provider`. Refuses, naming every missing
 * variable, unless every variable the `need` providers take is set (default: Anthropic and the OpenAI-compatible
 * host, LIVE_ENV). T-631: a registry that seats Gemini passes `need` with google, so its world fails closed without
 * the key.
 */
export function liveJudges(env: Env, o: LiveOptions & { timeoutMs?: number; need?: readonly LiveProviderName[] } = {}): Result<JudgeProvider, string> {
  const missing = missingLiveEnv(env, o.need);
  if (missing.length) return err(`live judges need ${missing.join(', ')} in the environment`);
  const a = liveProvider('anthropic', env, o);
  if (!a.ok) return a;
  const c = liveProvider('openai-compatible', env, o);
  if (!c.ok) return c;
  // T-631: Gemini only when its key is set. Without it a seat naming google abstains, naming the variable, and is not
  // retried: no registry seats google until a decision does, and that decision makes the key required.
  const g = liveProvider('google', env, o);
  const unset: JudgeProvider = { complete: async () => ({ kind: 'error', transport: false, detail: `no ${LIVE_KEY_ENV.google} in the environment, so no Gemini judge can run` }) };
  return ok(withTimeout(routeByProvider({ anthropic: a.value, 'openai-compatible': c.value, google: g.ok ? g.value : unset }), o.timeoutMs ?? 60_000));
}

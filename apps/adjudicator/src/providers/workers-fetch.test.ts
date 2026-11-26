// T-632: after T-631's flip every live judge seat errored on the operators. The cause, measured on 2026-11-26 in the
// local Workers runtime (wrangler 4.151.3 dev, compatibility date 2025-09-15, nodejs_compat): fetch with
// `redirect: 'error'` throws "TypeError: Invalid redirect value, must be one of "follow" or "manual"". Node accepts it,
// so every test passed. The adapter turned the throw into a transport error, the pipeline retried once, and the seat
// ended in error with no tokens. This test runs the deployed registry through the construction the Worker uses
// (liveJudges with the providers the default registry seats) against a fetch that refuses what workerd refuses.
import type { JudgeRequest } from '@holdback/judgment';
import { describe, expect, it } from 'vitest';
import { liveRegistry, liveRegistry2 } from '../test-adjudicator.js';
import { LIVE_KEY_ENV, liveJudges, OPENAI_COMPATIBLE_BASE_URL_ENV, type JudgeCallError, type LiveProviderName } from './live.js';

/** workerd's fetch: `redirect` must be "follow" or "manual"; anything else throws before any network. */
function workersFetch(answer: (url: string) => unknown, status = 200) {
  const inits: RequestInit[] = [];
  const fetch = (async (url: string, init: RequestInit = {}) => {
    if (init.redirect !== undefined && init.redirect !== 'follow' && init.redirect !== 'manual') {
      throw new TypeError('Invalid redirect value, must be one of "follow" or "manual"');
    }
    inits.push(init);
    return new Response(JSON.stringify(answer(url)), { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, inits };
}

const VERDICT = JSON.stringify({ criteria: [], overall: 'pass', injectionSuspected: false, rationale: 'ok' });
const answer = (url: string) =>
  url.includes('anthropic')
    ? { content: [{ type: 'text', text: VERDICT }], usage: { input_tokens: 10, output_tokens: 5 } }
    : url.includes('googleapis')
      ? { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: VERDICT }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }
      : { choices: [{ message: { content: VERDICT } }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
const ENV = {
  [LIVE_KEY_ENV.anthropic]: 'ka',
  [LIVE_KEY_ENV['openai-compatible']]: 'ko',
  [OPENAI_COMPATIBLE_BASE_URL_ENV]: 'https://api.deepseek.com',
  [LIVE_KEY_ENV.google]: 'kg',
};
const req = (s: { id: string; provider: string; model: string }, judgeId = s.id): JudgeRequest => ({ judgeId, provider: s.provider, model: s.model, system: 'rules', user: 'data', temperature: 0, maxOutputTokens: 2048 });

describe('live judge calls under the Workers runtime (T-632)', () => {
  it.each([
    ['config/judges-live-2.yaml (the default since the flip)', liveRegistry2],
    ['config/judges-live.yaml (carried)', liveRegistry],
  ])('every seat of %s answers, its repeat seat included, and its tokens are counted', async (_n, registry) => {
    const { fetch } = workersFetch(answer);
    const need = [...new Set(registry().active.map((e) => e.provider))].sort() as LiveProviderName[];
    const usage: string[] = [];
    const r = liveJudges(ENV, { fetch, need, onUsage: (u) => usage.push(u.model) });
    if (!r.ok) throw new Error(r.error);
    for (const e of registry().active) {
      for (const judgeId of [e.id, `${e.id}:2`]) {
        const res = await r.value.complete(req(e, judgeId));
        expect(res, `${judgeId} (${e.provider})`).toMatchObject({ kind: 'ok', text: VERDICT });
      }
    }
    expect(usage).toEqual(registry().active.flatMap((e) => [e.model, e.model]));
  });

  it('a redirect is refused without following it, and without resending the key: a non-transport error', async () => {
    const { fetch, inits } = workersFetch(() => ({}), 307);
    const errors: JudgeCallError[] = [];
    const r = liveJudges(ENV, { fetch, need: ['anthropic', 'google', 'openai-compatible'], onError: (e) => errors.push(e) });
    if (!r.ok) throw new Error(r.error);
    const e = liveRegistry2().active[0]!;
    const res = await r.value.complete(req(e));
    expect(res).toMatchObject({ kind: 'error', transport: false });
    expect(inits).toHaveLength(1);
    expect(inits[0]!.redirect).toBe('manual');
    expect(errors).toEqual([{ provider: e.provider, model: e.model, code: 'redirect' }]);
  });

  it('a failed call reports a short code from a closed list, never provider text or a key', async () => {
    const codes: string[] = [];
    const cases: Array<[typeof globalThis.fetch, string]> = [
      [(async () => { throw new TypeError('connect failed with kg'); }) as unknown as typeof globalThis.fetch, 'network'],
      [workersFetch(() => ({ error: { message: 'key kg not valid' } }), 401).fetch, 'http_401'],
      [workersFetch(() => ({}), 429).fetch, 'http_429'],
      [workersFetch(() => ({ candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: VERDICT }] } }] })).fetch, 'stopped'],
      [workersFetch(() => ({ promptFeedback: { blockReason: 'OTHER' } })).fetch, 'blocked'],
      [workersFetch(() => ({ candidates: [] })).fetch, 'no_text'],
    ];
    for (const [fetch, want] of cases) {
      const errors: JudgeCallError[] = [];
      const r = liveJudges(ENV, { fetch, need: ['anthropic', 'google', 'openai-compatible'], onError: (e) => errors.push(e) });
      if (!r.ok) throw new Error(r.error);
      await r.value.complete(req({ id: 'gemini-4-neon', provider: 'google', model: 'gemini-4-neon@2026-11-26' }));
      expect(errors.map((e) => e.code)).toEqual([want]);
      expect(JSON.stringify(errors)).not.toContain('kg');
      codes.push(want);
    }
    expect(codes).toHaveLength(6);
  });
});

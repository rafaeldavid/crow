// T-631 red team of the Google Gemini adapter (stubbed fetch, no network). Each test asserts the secure behaviour. The
// red team's known gaps here (L2, L3) are fixed, so every test is a plain test.
import type { JudgeRequest } from '@holdback/judgment';
import { describe, expect, it } from 'vitest';
import { LIVE_KEY_ENV, liveJudges, liveProvider, OPENAI_COMPATIBLE_BASE_URL_ENV } from './live.js';

const KEY = 'AIza-test-secret-value-1234';
const req = (over: Partial<JudgeRequest> = {}): JudgeRequest => ({
  judgeId: 'gemini-a',
  provider: 'google',
  model: 'gemini-3.8-flash@2026-11-26',
  system: 'rules',
  user: 'data',
  temperature: 0,
  maxOutputTokens: 2048,
  ...over,
});
const VERDICT = '{"overall":"pass","criteria":[]}';
const stub = (json: unknown, status = 200) => {
  const inits: RequestInit[] = [];
  const urls: string[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    urls.push(url);
    inits.push(init);
    return new Response(JSON.stringify(json), { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, inits, urls };
};
const gemini = (fetch: typeof globalThis.fetch) => {
  const p = liveProvider('google', { [LIVE_KEY_ENV.google]: KEY }, { fetch });
  if (!p.ok) throw new Error(p.error);
  return p.value;
};

describe('attack.gemini-thought-as-verdict: a thought part never becomes verdict text', () => {
  it.each([
    ['thought last', [{ text: VERDICT }, { text: '{"overall":"fail"}', thought: true }], VERDICT],
    ['thought first', [{ text: '{"overall":"pass"}', thought: true }, { text: VERDICT }], VERDICT],
  ])('%s', async (_n, parts, want) => {
    const { fetch } = stub({ candidates: [{ content: { parts } }] });
    expect(await gemini(fetch).complete(req())).toEqual({ kind: 'ok', text: want });
  });

  it('only thought parts: an error, never a verdict', async () => {
    const { fetch } = stub({ candidates: [{ content: { parts: [{ text: VERDICT, thought: true }] } }] });
    expect((await gemini(fetch).complete(req())).kind).toBe('error');
  });
});

describe('attack.gemini-blocked-candidate: a candidate the provider stopped for safety or recitation is not a verdict', () => {
  // A prompt-level block (promptFeedback.blockReason, no candidates) is an error today. A candidate-level stop keeps its
  // parts, and the adapter reads text without looking at finishReason, so a SAFETY- or RECITATION-stopped candidate whose
  // text happens to parse is passed on as an answer. The verdict filter still applies, so only a schema-valid text counts.
  for (const finishReason of ['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII']) {
    it(`finishReason ${finishReason} with schema-valid text is an error (fixed: T-631 red team L2)`, async () => {
      const { fetch } = stub({ candidates: [{ finishReason, content: { parts: [{ text: VERDICT }] } }] });
      expect((await gemini(fetch).complete(req())).kind).toBe('error');
    });
  }

  it('a prompt block reported beside a candidate is an error (fixed: T-631 red team L2)', async () => {
    const { fetch } = stub({ promptFeedback: { blockReason: 'SAFETY' }, candidates: [{ content: { parts: [{ text: VERDICT }] } }] });
    expect((await gemini(fetch).complete(req())).kind).toBe('error');
  });
});

describe('attack.gemini-key-leak: the key never leaves the header', () => {
  it('a network error that names the key returns only "network error"', async () => {
    const fetch = (async () => {
      throw new Error(`connect failed with x-goog-api-key ${KEY}`);
    }) as unknown as typeof globalThis.fetch;
    const res = await gemini(fetch).complete(req());
    expect(res).toEqual({ kind: 'error', transport: true, detail: 'network error' });
  });

  it.each([400, 401, 403, 404])('an HTTP %i whose body echoes the key returns only the status', async (status) => {
    const { fetch } = stub({ error: { message: `API key ${KEY} not valid` } }, status);
    const res = await gemini(fetch).complete(req());
    expect(JSON.stringify(res)).not.toContain(KEY);
  });

  it('a model ID with path characters stays inside the models path and never carries the key', async () => {
    const { fetch, urls } = stub({ candidates: [{ content: { parts: [{ text: VERDICT }] } }] });
    await gemini(fetch).complete(req({ model: '../../v1/files?key=x' }));
    expect(urls[0]).toMatch(/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/[^/?]+:generateContent$/);
    expect(urls[0]).not.toContain(KEY);
  });

  it('a redirect is refused, so the key header is never resent to another host (fixed: T-631 red team L3)', async () => {
    // fetch follows redirects by default and resends custom headers (x-goog-api-key, like x-api-key) across origins.
    // T-632: "manual", not "error", which the Workers runtime refuses; the 3xx comes back and is refused, unfollowed.
    const { fetch, inits } = stub({ candidates: [{ content: { parts: [{ text: VERDICT }] } }] }, 302);
    const res = await gemini(fetch).complete(req());
    expect(inits[0]!.redirect).toBe('manual');
    expect(inits).toHaveLength(1);
    expect(res).toMatchObject({ kind: 'error', transport: false });
  });
});

describe('attack.gemini-seat-without-key: a google seat never runs without its key', () => {
  const env = { [LIVE_KEY_ENV.anthropic]: 'ka', [LIVE_KEY_ENV['openai-compatible']]: 'ko', [OPENAI_COMPATIBLE_BASE_URL_ENV]: 'https://api.example.test' };

  it('a world whose default registry seats google fails closed without the key: liveJudges refuses, naming it', () => {
    const r = liveJudges(env, { need: ['anthropic', 'openai-compatible', 'google'] });
    expect(!r.ok && r.error).toContain(LIVE_KEY_ENV.google);
  });

  it.each([['unset', undefined], ['empty', '']])('a google request with the key %s abstains with no call and no retry', async (_n, value) => {
    const { fetch, urls } = stub({ candidates: [{ content: { parts: [{ text: VERDICT }] } }] });
    const r = liveJudges({ ...env, ...(value === undefined ? {} : { [LIVE_KEY_ENV.google]: value }) }, { fetch });
    if (!r.ok) throw new Error(r.error);
    const res = await r.value.complete(req());
    expect(res.kind === 'error' && res.transport).toBe(false);
    expect(urls).toEqual([]);
  });

  it('a world whose default registry seats no google seat does not fail closed for want of the Google key', () => {
    expect(liveJudges(env).ok).toBe(true);
  });

  it('the request carries no tools, no grounding, no code execution and no URL context', async () => {
    const { fetch, inits } = stub({ candidates: [{ content: { parts: [{ text: VERDICT }] } }] });
    await gemini(fetch).complete(req());
    const body = JSON.parse(String(inits[0]!.body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['contents', 'generationConfig', 'systemInstruction']);
    expect(JSON.stringify(body)).not.toMatch(/tool|googleSearch|codeExecution|urlContext|retrieval/i);
  });
});

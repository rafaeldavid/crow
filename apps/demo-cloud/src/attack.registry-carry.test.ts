// T-631 red team: a deal bound to one live registry must never be judged under the other, by a scripted judge, or
// left unjudged across the carry deploy, the flip deploy and a rollback. Each test asserts the secure behaviour. A test
// named "KNOWN GAP" uses it.fails: it asserts the secure behaviour and fails today; SHOW_BREAKS=1 runs it as a plain
// test to show the failure. Every other test is a regression test for a defense that held.
import { defaultPolicy, KEPT_POLICIES, liveRegistry, liveRegistry2, markerFake, placeholderRegistry, type KeptPolicies } from '@holdback/adjudicator';
import { policyHash, type AdjudicatorPolicy } from '@holdback/core';
import { describe, expect, it } from 'vitest';
import { guardDecision as guardDecisionUntyped } from '../../../scripts/deploy-lib.mjs';
import { panelConfig } from './judges.js';
import { MemoryStorage } from './storage.js';

type Deal = { id: string; state: string; nextDeadline?: string; policyHash: string; registryHash: string; primary?: string };
type Guarded = { refused: string | null; warnings: string[]; orphans: Deal[]; withdrawnOrphans: Deal[]; checked?: number };
const guardDecision = guardDecisionUntyped as (facts: {
  live: { kept: KeptPolicies | null; registrations: Array<{ policy: AdjudicatorPolicy; registryHash: string }> };
  next: KeptPolicies;
  deals: Deal[] | null;
  readError?: string;
  hashOf: (p: AdjudicatorPolicy) => string;
  override?: string | null;
}) => Guarded;
const breakIt = process.env['SHOW_BREAKS'] ? it : it.fails;

const REG1 = liveRegistry().hash;
const REG2 = liveRegistry2().hash;
const primary = defaultPolicy('demo-primary/p1');
const P = policyHash(primary);
const deal = (id: string, registryHash: string): Deal => ({ id, state: 'Held', nextDeadline: 'deliverBy 2026-12-01T10:00:00Z', policyHash: P, registryHash });
const hashOf = policyHash as (p: AdjudicatorPolicy) => string;
const dropReg = (k: KeptPolicies, hash: string): KeptPolicies => ({ ...k, registries: k.registries.filter((r) => r.hash !== hash) });
/** The demo's three adjudicators all register on the world's default registry. */
const on = (hash: string) => [1, 2, 3].map(() => ({ policy: primary, registryHash: hash }));

describe('attack.registry-rollback-flip-to-pre-carry: a rollback that cannot judge a deal bound to the new registry', () => {
  it('is refused while such a deal is open (the deals can be read)', () => {
    const r = guardDecision({ live: { kept: KEPT_POLICIES, registrations: on(REG2) }, next: dropReg(KEPT_POLICIES, REG2), deals: [deal('0xa1', REG2)], hashOf });
    expect(r.refused).toMatch(new RegExp(`0xa1 Held.*registry ${REG2.slice(0, 10)}`));
  });

  it('a rollback from the flip to the carry build goes through: the carry build judges both registries', () => {
    const r = guardDecision({ live: { kept: KEPT_POLICIES, registrations: on(REG2) }, next: KEPT_POLICIES, deals: [deal('0xa2', REG1), deal('0xa3', REG2)], hashOf });
    expect(r.refused).toBeNull();
  });
});

describe('attack.registry-guard-blind-after-flip: the guard counts only the registry the adjudicators register on', () => {
  // After the flip every Crow adjudicator registers on config/judges-live-2.yaml, so the guard's red-team-M3 filter
  // ("a build judges only under a registry it has a provider for") treats config/judges-live.yaml as unreachable. Since
  // T-631 the live build reaches it through panel.kept. A later deploy that drops it is then let through while a deal
  // accepted before the flip still binds it: that deal is never judged and ends in its default outcome.
  breakIt('KNOWN GAP: a deploy after the flip that drops the first live registry is refused while a deal binds it', () => {
    const r = guardDecision({ live: { kept: KEPT_POLICIES, registrations: on(REG2) }, next: dropReg(KEPT_POLICIES, REG1), deals: [deal('0xb1', REG1)], hashOf });
    expect(r.refused).toMatch(/0xb1 Held.*registry 0x6dc7342b/);
  });

  it('the same deploy during the carry (adjudicators on the first registry) is refused, so the gap opens only with the flip', () => {
    const r = guardDecision({ live: { kept: KEPT_POLICIES, registrations: on(REG1) }, next: dropReg(KEPT_POLICIES, REG1), deals: [deal('0xb2', REG1)], hashOf });
    expect(r.refused).toMatch(/0xb2 Held/);
  });

  breakIt('KNOWN GAP: during the carry, a deploy that drops the carried second registry is refused while an outside primary\'s deal binds it', () => {
    // An outside primary may bind any registry Crow carries; Crow's fallback then judges it under config/judges-live-2.yaml.
    const r = guardDecision({ live: { kept: KEPT_POLICIES, registrations: on(REG1) }, next: dropReg(KEPT_POLICIES, REG2), deals: [deal('0xb3', REG2)], hashOf });
    expect(r.refused).toMatch(/0xb3 Held.*registry ${REG2.slice(0, 10)}/);
  });
});

describe('attack.registry-scripted-in-live-world: no live registry deal reaches a scripted judge', () => {
  it('the live world carries exactly the two live registries, both through the live panel provider', () => {
    const live = panelConfig({ env: {}, storage: new MemoryStorage(), now: Date.now, judgeProvider: markerFake() });
    const all = [live.registry.hash, ...live.kept.map((k) => k.registry.hash)];
    expect(all.sort()).toEqual([REG1, REG2].sort());
    expect(all).not.toContain(placeholderRegistry().hash);
    for (const k of live.kept) expect(k.provider).toBe(live.provider);
  });

  it('a world without the live keys carries neither live registry, so a deal bound to one is declined, never scripted', () => {
    const scripted = panelConfig({ env: {}, storage: new MemoryStorage(), now: Date.now });
    expect([scripted.registry.hash, ...scripted.kept.map((k) => k.registry.hash)]).not.toContain(REG1);
    expect([scripted.registry.hash, ...scripted.kept.map((k) => k.registry.hash)]).not.toContain(REG2);
  });

  it('a chain world that fails closed abstains on every seat: it never answers a verdict', async () => {
    const closed = panelConfig({ env: {}, storage: new MemoryStorage(), now: Date.now, failClosed: true });
    expect(closed.closed).toBe(true);
    const r = await closed.panel(3, () => closed.provider.complete({ judgeId: 'claude-opus-5-5', provider: 'anthropic', model: 'claude-opus-5-5@2026-09-21', system: 's', user: 'u', temperature: 0, maxOutputTokens: 10 }));
    expect(r.kind).toBe('error');
  });
});

describe('attack.registry-budget-bypass: a carried registry seat never calls a live model uncounted', () => {
  const req = { judgeId: 'claude-sonnet-5', provider: 'anthropic', model: 'claude-sonnet-5@2026-05-01', system: 's', user: 'u', temperature: 0, maxOutputTokens: 10 } as const;
  const counting = () => {
    const calls: string[] = [];
    return { calls, provider: { complete: async (r: { judgeId: string }) => (calls.push(r.judgeId), { kind: 'ok' as const, text: '{}' }) } };
  };

  it('outside a panel, a carried seat abstains and reaches no model', async () => {
    const c = counting();
    const cfg = panelConfig({ env: {}, storage: new MemoryStorage(), now: () => 0, judgeProvider: c.provider, liveCallsPerDay: 100 });
    cfg.allowLive = true;
    expect((await cfg.kept[0]!.provider.complete(req)).kind).toBe('error');
    expect(c.calls).toEqual([]);
  });

  it('inside a panel, a carried seat is counted; past the budget the whole panel abstains', async () => {
    const c = counting();
    const cfg = panelConfig({ env: {}, storage: new MemoryStorage(), now: () => 0, judgeProvider: c.provider, liveCallsPerDay: 6 });
    cfg.allowLive = true;
    await cfg.panel(3, () => cfg.kept[0]!.provider.complete(req));
    expect((await cfg.budget.used()).calls).toBe(1);
    // 5 left, a panel of 3 needs 6 with its retries: abstains as a whole.
    const r = await cfg.panel(3, () => cfg.kept[0]!.provider.complete(req));
    expect(r.kind).toBe('error');
    expect(c.calls).toHaveLength(1);
  });

  it('without allowLive, a panel of carried seats abstains', async () => {
    const c = counting();
    const cfg = panelConfig({ env: {}, storage: new MemoryStorage(), now: () => 0, judgeProvider: c.provider, liveCallsPerDay: 100 });
    expect((await cfg.panel(3, () => cfg.kept[0]!.provider.complete(req))).kind).toBe('error');
    expect(c.calls).toEqual([]);
  });
});

// T-631: config/judges-live-2.yaml, the live registry without Claude Sonnet. In the regression pass of 2026-11-26 the
// schema filter voided claude-sonnet-5's verdict in 7 of the 8 panels that seated it since 2026-11-25 22:31 UTC, and
// under agg-5 a voided verdict escalates. A deal keeps the registry it bound (ADR-0036), so deals bound to
// config/judges-live.yaml are still judged by it; this registry applies to new deals only.
import { keccak256, toBytes } from 'viem';
import { selectPanel } from '@holdback/judgment';
import { describe, expect, it } from 'vitest';
import { defaultPolicy, KEPT_POLICIES } from './policy.js';
import { loadRegistryFile } from './registry-file.js';
import { liveRegistry, liveRegistry2, LIVE_REGISTRY_2_URI } from './test-adjudicator.js';

const PATH = new URL('../../../config/judges-live-2.yaml', import.meta.url).pathname;

describe('config/judges-live-2.yaml (T-631)', () => {
  const r = loadRegistryFile(PATH);
  const reg = () => {
    if (!r.ok) throw new Error(r.error.detail);
    return r.value;
  };

  it('seats no Claude Sonnet model, active or not', () => {
    for (const e of reg().doc.judges) expect(e.model).not.toMatch(/sonnet/i);
  });

  it('seats claude-opus-5-5 by its exact pinned ID, never an alias', () => {
    expect(reg().active.find((e) => e.id === 'claude-opus-5-5')?.model).toBe('claude-opus-5-5@2026-09-21');
    for (const e of reg().doc.judges) {
      expect(e.model).toMatch(/@\d{4}-\d{2}-\d{2}$/);
      expect(e.model).not.toMatch(/latest|placeholder/i);
    }
  });

  it('has exactly the three judges Rafa named, one from each of three families', () => {
    expect(reg().active.map((e) => [e.model, e.provider, e.family])).toEqual([
      ['claude-opus-5-5@2026-09-21', 'anthropic', 'claude'],
      ['deepseek-v4-pro@2026-11-01', 'openai-compatible', 'deepseek'],
      ['gemini-4-neon@2026-11-26', 'google', 'gemini'],
    ]);
  });

  it('every panel of three seats all three families, whatever the seed (512 seeds)', () => {
    const id = keccak256(toBytes('commitment'));
    for (let i = 0; i < 512; i++) {
      const seats = selectPanel({ registry: reg(), seed: keccak256(toBytes(`seed-${i}`)), commitmentId: id, size: 3, minFamilies: 3 });
      if (!seats.ok) throw new Error(seats.error);
      expect(new Set(seats.value.map((s) => s.family))).toEqual(new Set(['claude', 'deepseek', 'gemini']));
    }
  });

  it('seats the escalation panel of five from the default policy: all three families, two judges twice (512 seeds)', () => {
    const p = defaultPolicy('t');
    expect(p.appealPanelSize).toBe(5);
    const id = keccak256(toBytes('commitment'));
    for (let i = 0; i < 512; i++) {
      const five = selectPanel({ registry: reg(), seed: keccak256(toBytes(`seed-${i}`)), commitmentId: id, size: p.appealPanelSize, minFamilies: Math.min(p.minFamiliesAppeal, 3) });
      if (!five.ok) throw new Error(five.error);
      expect(new Set(five.value.map((s) => s.family)).size).toBe(3);
      expect(five.value.filter((s) => s.judgeId.endsWith(':2'))).toHaveLength(2);
    }
  });

  it('is a new registry hash, carried as kept beside the first live registry', () => {
    expect(reg().hash).not.toBe(liveRegistry().hash);
    expect(liveRegistry2().hash).toBe(reg().hash);
    expect(LIVE_REGISTRY_2_URI).toBe('file:///config/judges-live-2.yaml');
    const marks = KEPT_POLICIES.registries;
    expect(marks.find((m) => m.hash === reg().hash)).toMatchObject({ file: 'config/judges-live-2.yaml', status: 'kept' });
    expect(marks.find((m) => m.hash === liveRegistry().hash)).toMatchObject({ file: 'config/judges-live.yaml', status: 'kept' });
  });
});

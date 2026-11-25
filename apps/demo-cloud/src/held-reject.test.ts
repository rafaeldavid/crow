// ADR-0051: the operators' side of a held reject. The Durable Object wakes the holding adjudicator once, at the hold's
// end, not on every pass; the state read says until when and what each party may do; and the end is counted as
// rescued, signed or missed.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCommitment, type EscrowState } from '@holdback/core';
import { describe, expect, it } from 'vitest';
import { heldRejectEnd, heldRejectNotice, workAt, type HeldReject } from './world.js';

const example = parseCommitment(JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', 'spec', 'examples', 'commitment.example.json'), 'utf8')));
if (!example.ok) throw new Error('the spec example must parse');
const terms = example.value as unknown as EscrowState['terms'];
const judgeBy = Date.parse(terms.timing.judgeBy);
const primary = terms.adjudication.adjudicator.toLowerCase();
const appeal = terms.adjudication.appealAdjudicator.toLowerCase();
const ours = (who: string) => (a: string) => a.toLowerCase() === who;
const state = (over: Record<string, unknown>) => ({ id: '0x' + '0'.repeat(64), terms, beaconSource: 'sim', ...over }) as unknown as EscrowState;
const now = judgeBy - 3_600_000;
const until = new Date(now + 1_800_000).toISOString();
const heldPrimary: HeldReject = { role: 'primary', by: primary, until, kind: 'Delivered' };

describe('the wake at the hold\'s end (ADR-0051)', () => {
  it('wakes the primary at the hold\'s end, and at once without a hold or once it ended', () => {
    const s = state({ kind: 'Delivered' });
    expect(workAt(s, ours(primary), now, 0, heldPrimary)).toEqual([Date.parse(until)]);
    expect(workAt(s, ours(primary), now, 0)).toEqual([now]);
    expect(workAt(s, ours(primary), Date.parse(until), 0, heldPrimary)).toEqual([Date.parse(until)]);
    expect(workAt(s, ours(primary), Date.parse(until) + 1, 0, heldPrimary)).toEqual([Date.parse(until) + 1]);
  });

  it('wakes the appeal adjudicator at its hold\'s end after an escalation; a hold for another state changes nothing', () => {
    const at = new Date(now).toISOString();
    const s = state({ kind: 'Escalated', escalation: { by: 'primary', at, appealDecideBy: new Date(now + 86_400_000).toISOString() } });
    const held: HeldReject = { role: 'appeal', by: appeal, until, kind: 'Escalated' };
    expect(workAt(s, ours(appeal), now, 0, held)).toEqual([Date.parse(until)]);
    expect(workAt(s, ours(appeal), now, 0, heldPrimary)).toEqual([now]);
  });
});

describe('the notice and the end of a held reject (ADR-0051)', () => {
  it('says when the reject is signed and what each party may do, only while the deal is in the held state', () => {
    const delivered = state({ kind: 'Delivered' });
    const text = heldRejectNotice(delivered, heldPrimary, now)!;
    expect(text).toContain(`It signs the reject at ${until}`);
    expect(text).toMatch(/buyer may accept the delivery \(POST \/v1\/commitments\/0x0+\/accept\), or both parties may settle/);
    expect(heldRejectNotice(delivered, heldPrimary, Date.parse(until))).toBeNull();
    expect(heldRejectNotice(state({ kind: 'FallbackJudging' }), heldPrimary, now)).toBeNull();
    const escalated = heldRejectNotice(state({ kind: 'Escalated' }), { ...heldPrimary, role: 'appeal', kind: 'Escalated' }, now)!;
    expect(escalated).toMatch(/both parties may settle .*after an escalation the buyer alone cannot accept/);
  });

  it('counts an accept or a settlement as rescued, its own reject as signed, and anything else as missed', () => {
    const decision = (adjudicator: string, outcome: string) => ({ adjudicator, outcome });
    expect(heldRejectEnd(state({ kind: 'Delivered' }), heldPrimary)).toBeNull();
    expect(heldRejectEnd(state({ kind: 'Released', via: { kind: 'early_accept' } }), heldPrimary)).toBe('rescued');
    expect(heldRejectEnd(state({ kind: 'Settled' }), heldPrimary)).toBe('rescued');
    expect(heldRejectEnd(state({ kind: 'Refunded', via: { kind: 'first_instance', decision: decision(primary, 'reject') } }), heldPrimary)).toBe('signed');
    expect(heldRejectEnd(state({ kind: 'Refunded', via: { kind: 'escalation', decision: decision(appeal, 'reject') } }), { ...heldPrimary, by: appeal, kind: 'Escalated' })).toBe('signed');
    expect(heldRejectEnd(state({ kind: 'FallbackJudging' }), heldPrimary)).toBe('missed');
    expect(heldRejectEnd(state({ kind: 'Refunded', via: { kind: 'default_outcome', from: 'FallbackJudging' } }), heldPrimary)).toBe('missed');
    expect(heldRejectEnd(state({ kind: 'Released', via: { kind: 'first_instance', decision: decision('0xfa11', 'accept') } }), heldPrimary)).toBe('missed');
  });
});

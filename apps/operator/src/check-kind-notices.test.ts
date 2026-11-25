// D92, D31: a notice, never a refusal, for each named adjudicator whose registered checkKinds lacks a kind the terms name.
import { describe, expect, it } from 'vitest';
import { checkKindNotices } from './prepare.js';

const A = '0x00000000000000000000000000000000000000a1';
const B = '0x00000000000000000000000000000000000000b2';
const C = '0x00000000000000000000000000000000000000c3';
const terms = (types: string[]) => ({
  adjudication: { adjudicator: A, fallbackAdjudicator: B, appealAdjudicator: C },
  acceptance: { deterministicChecks: types.map((type, i) => ({ id: `c${i}`, type })) },
}) as never;
const registry = (records: Record<string, { checkKinds?: string[] } | null>) => ({ registration: async (a: string) => (records[a] ?? null) as never });

describe('checkKindNotices', () => {
  it('names each role whose record lacks a kind in the terms, and refuses nothing', async () => {
    const ctx = registry({ [A]: { checkKinds: ['json_schema', 'signature_valid'] }, [B]: { checkKinds: ['json_schema'] }, [C]: {} });
    const notes = await checkKindNotices(ctx, terms(['json_schema', 'signature_valid']));
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatch(/^the fallback adjudicator 0x0+b2 does not list the check kind signature_valid .* which check c1 names/);
    expect(notes[1]).toMatch(/^the appeal adjudicator 0x0+c3 does not list/);
    expect(notes.every((n) => n.endsWith('You may still choose it'))).toBe(true);
  });

  it('reads a record with no list as the nine kinds of v0.12, skips an unknown address, and says nothing when every kind is listed', async () => {
    expect(await checkKindNotices(registry({ [A]: {} }), terms(['json_schema']))).toEqual([]);
    expect(await checkKindNotices(registry({ [A]: {} }), terms(['signature_valid']))).toHaveLength(1);
    expect(await checkKindNotices(registry({}), terms(['signature_valid']))).toEqual([]);
  });

  it('skips a role this node already warned about, and terms with no readable checks', async () => {
    const ctx = registry({ [A]: {}, [B]: {}, [C]: {} });
    expect(await checkKindNotices(ctx, terms(['signature_valid']), { primary: 'x', fallback: 'y' })).toHaveLength(1);
    expect(await checkKindNotices(ctx, { adjudication: terms([]).adjudication } as never)).toEqual([]);
  });
});

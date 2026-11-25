// T-616 (ADR-0050): no recorded attack moves to accept under template pair 3 and agg-6. Each attack fixture with
// recorded judges runs twice on SimChain: as recorded, under the build's prose default, and as a what-if under pair 3
// and agg-6, every judge keeping its recorded scores, overall and injection flag and writing its recorded prose as
// keys the coded filter drops. A decision may move from accept, never to it, and the deal never ends Released where it
// did not before.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { NEWEST_VERSIONS, TEMPLATE_PAIR_3 } from '@holdback/judgment';
import { describe, expect, it } from 'vitest';
import { CodedFromRecorded } from './recorded.js';
import { runScenario } from './runner.js';

const ROOT = join(import.meta.dirname, '../../..');
const RECORDED = readdirSync(join(ROOT, 'fixtures/recordings')).filter((n) => n.startsWith('attack.'));
const CODED = { ...NEWEST_VERSIONS, screenVersion: 'screen-1', promptTemplateHash: TEMPLATE_PAIR_3.firstHash, appealPromptTemplateHash: TEMPLATE_PAIR_3.appealHash, aggregationVersion: 'agg-6' };

describe('attack.coded-no-recorded-attack-accepts: the recorded attacks under template pair 3 and agg-6', () => {
  it('replays at least the five attacks with recorded judges', () => expect(RECORDED.length).toBeGreaterThanOrEqual(5));
  it.each(RECORDED)('%s moves no decision to accept and ends no better for the seller', async (name) => {
    const prose = await runScenario({ root: ROOT, name });
    const coded = await runScenario({ root: ROOT, name, whatIf: { versions: CODED, judges: new CodedFromRecorded(join(ROOT, 'fixtures/recordings')) } });
    const p = prose.summary.judgments;
    const c = coded.summary.judgments;
    expect(c.length).toBeGreaterThan(0);
    expect(c.filter((d, i) => d === 'accept' && p[i] !== 'accept'), `prose ${p.join(',')}; coded ${c.join(',')}`).toEqual([]);
    if (prose.summary.finalState !== 'Released') expect(coded.summary.finalState).not.toBe('Released');
    const panels = [...coded.judgments.values()].filter((j) => j.panel.ran);
    expect(panels.length).toBeGreaterThan(0);
    for (const j of panels) expect(j.panel.promptTemplateHash === TEMPLATE_PAIR_3.firstHash || j.panel.promptTemplateHash === TEMPLATE_PAIR_3.appealHash).toBe(true);
  });
});

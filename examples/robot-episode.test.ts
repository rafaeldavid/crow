// T-498: the robot episode try-sell's `--sample robot-episode` sells, run through check-delivery.ts's code (the
// adjudicator's intake and stage 1, offline). The good episode is accepted; each broken copy is rejected by the
// check written for its fault.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkDelivery } from './check-delivery.ts';
import { checksFor, DELIVERABLE, FPS, INFO_FIELDS, newLab, newOrder, recordEpisode, type Faults } from './robot-episode.ts';

const dir = mkdtempSync(join(tmpdir(), 'robot-episode-'));
const lab = await newLab();
const order = newOrder();
const checks = checksFor(lab, order);
const terms = join(dir, 'terms.json');
writeFileSync(terms, JSON.stringify({ deliverable: DELIVERABLE, acceptance: { deterministicChecks: checks, rubric: { passThreshold: 0, criteria: [] } } }));

let n = 0;
async function check(faults?: Faults) {
  const file = join(dir, `episode-${n++}.json`);
  writeFileSync(file, await recordEpisode(lab, order, faults ? { faults } : {}));
  const r = checkDelivery({ terms, file });
  return { result: r.preflight.result, failed: r.preflight.deterministic.filter((c) => !c.passed).map((c) => c.checkId), bytes: r.preflight.bytes };
}

describe('the robot episode (T-498)', () => {
  it('has ten required checks, each bound a whole number', () => {
    expect(checks.map((c) => c.id)).toEqual(['lerobot-info', 'lerobot-meta', 'frames', 'joint-positions', 'joint-speeds', 'joint-currents', 'fresh-order', 'arrivals', 'device-key', 'hidden']);
    expect(checks.every((c) => c.required)).toBe(true);
    const bounds: number[] = [];
    JSON.stringify(checks, (k, v) => (['minimum', 'maximum', 'minItems', 'maxItems'].includes(k) && bounds.push(v), v));
    expect(bounds.length).toBeGreaterThan(0);
    expect(bounds.every(Number.isInteger)).toBe(true);
  });

  it('carries meta.info with exactly the field names of LeRobot v3 info.json', async () => {
    const doc = JSON.parse(new TextDecoder().decode(await recordEpisode(lab, order)));
    expect(Object.keys(doc.meta.info)).toEqual(['codebase_version', 'robot_type', 'total_episodes', 'total_frames', 'total_tasks', 'chunks_size', 'data_files_size_in_mb', 'video_files_size_in_mb', 'fps', 'splits', 'data_path', 'video_path', 'features']);
    expect(INFO_FIELDS).toEqual(Object.keys(doc.meta.info));
    expect(doc.meta.info).toMatchObject({ codebase_version: 'v3.0', robot_type: 'dobot_cr3a', fps: 125, total_frames: 10 * FPS });
    expect(Object.keys(doc.data)).toEqual(['observation.state', 'observation.velocity', 'observation.effort', 'action', 'timestamp', 'frame_index', 'episode_index', 'index', 'task_index']);
  });

  it('accepts the good episode: 10 s at 125 Hz, under 1 MiB', async () => {
    const r = await check();
    expect(r).toMatchObject({ result: 'accept', failed: [] });
    expect(r.bytes).toBeLessThan(1 << 20);
  });

  it("rejects a copy with another order's nonce under fresh-order and device-key", async () => {
    expect(await check({ nonce: newOrder().nonce })).toMatchObject({ result: 'reject', failed: ['fresh-order', 'device-key'] });
  });

  it('rejects a copy whose arrival at w2 is 5 degrees off under arrivals', async () => {
    expect(await check({ offWaypoint: true })).toMatchObject({ result: 'reject', failed: ['arrivals'] });
  });

  it('rejects a copy with a joint position past the limit under joint-positions', async () => {
    expect(await check({ pastLimit: true })).toMatchObject({ result: 'reject', failed: ['joint-positions'] });
  });
});

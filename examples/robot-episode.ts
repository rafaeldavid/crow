// try-sell's `--sample robot-episode` (T-498): one synthetic robot arm episode in Hugging Face's LeRobot v3 dataset
// layout, and the ten deterministic checks it is sold under. Test values only. Pure: no network, no files, no new
// import (tweetnacl and goal-kit.ts's sha256hex are already in the try-sell bundle).
//
// Crow carries CSV or JSON of at most 1 MiB and its checks read those formats; LeRobot v3 stores Parquet and MP4.
// So the delivery is one JSON document that holds the same content section by section:
//   meta.info      LeRobot v3 meta/info.json, field for field (codebase_version "v3.0", fps, features, path templates)
//   meta.tasks     the rows of meta/tasks.parquet: task_index and task
//   meta.episodes  the row of meta/episodes/ for episode 0
//   meta.stats     meta/stats.json: min, max, mean, std and count per feature
//   data           the frame table, one array per column
//   provenance     what LeRobot has no field for: the arm's serial as a hash, the order's nonce and waypoints, the
//                  measured pose at each waypoint, the full recording's hash, and a device signature (Ed25519) over
//                  the nonce and the hashes
// Joint values are in degrees, as an arm controller reports them, and carry decimals. Only the terms are hashed and
// signed, so only the checks' bounds must be whole numbers (ADR-0022); in degrees the arm's limits are whole numbers.
import nacl from 'tweetnacl';
import { sha256hex } from './goal-kit.ts';

/** Frames per second: the arm's controller reports its state every 8 ms. */
export const FPS = 125;
export const ROBOT = 'dobot_cr3a';
export const FORMAT = 'lerobot-v3-json/0.1';
const JOINTS = ['j1', 'j2', 'j3', 'j4', 'j5', 'j6'];
const names = (k: string) => JOINTS.map((j) => `${j}.${k}`);
export const FEATURES = {
  'observation.state': { dtype: 'float32', shape: [6], names: names('pos'), fps: FPS },
  'observation.velocity': { dtype: 'float32', shape: [6], names: names('vel'), fps: FPS },
  'observation.effort': { dtype: 'float32', shape: [6], names: names('current'), fps: FPS },
  action: { dtype: 'float32', shape: [6], names: names('pos'), fps: FPS },
  timestamp: { dtype: 'float32', shape: [1], names: null, fps: FPS },
  frame_index: { dtype: 'int64', shape: [1], names: null, fps: FPS },
  episode_index: { dtype: 'int64', shape: [1], names: null, fps: FPS },
  index: { dtype: 'int64', shape: [1], names: null, fps: FPS },
  task_index: { dtype: 'int64', shape: [1], names: null, fps: FPS },
};
/** The field names of LeRobot v3's meta/info.json, in its order. */
export const INFO_FIELDS = ['codebase_version', 'robot_type', 'total_episodes', 'total_frames', 'total_tasks', 'chunks_size', 'data_files_size_in_mb', 'video_files_size_in_mb', 'fps', 'splits', 'data_path', 'video_path', 'features'];
const DATA_PATH = 'data/chunk-{chunk_index:03d}/file-{file_index:03d}.parquet';
const TASK = 'Move from home through waypoints w1, w2 and w3 in order at 30% speed, then return home.';
/** How close, in whole degrees, each measured arrival must be to its waypoint. */
const TOLERANCE = 1;

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const sha = (s: string) => sha256hex(new TextEncoder().encode(s));
const unit = () => nacl.randomBytes(1)[0]! / 255;

type Waypoints = Record<'w1' | 'w2' | 'w3', number[]>;
/** The order: a random code and three waypoints in whole degrees, inside the arm's reach. */
export interface Order { nonce: string; waypoints: Waypoints }
export function newOrder(): Order {
  const wp = () => [Math.round(-60 + 120 * unit()), Math.round(-40 + 30 * unit()), Math.round(50 + 50 * unit()), Math.round(-60 + 40 * unit()), -90, Math.round(-90 + 180 * unit())];
  return { nonce: hex(nacl.randomBytes(16)), waypoints: { w1: wp(), w2: wp(), w3: wp() } };
}

/** The seller's simulated lab: one arm, known by its serial's hash, and a recording host with an Ed25519 device key. */
export interface Lab { serialSha256: string; secretKey: Uint8Array; publicKey: string }
export async function newLab(): Promise<Lab> {
  const keys = nacl.sign.keyPair();
  return { serialSha256: await sha(`CR3A-SIM-${hex(nacl.randomBytes(3))}`), secretKey: keys.secretKey, publicKey: hex(keys.publicKey) };
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
/** A minimum-jerk move: position and speed as fractions of the leg. */
const mj = (s: number) => 10 * s ** 3 - 15 * s ** 4 + 6 * s ** 5;
const mjd = (s: number) => 30 * s ** 2 - 60 * s ** 3 + 30 * s ** 4;

/** The faults that make the broken copies: another order's nonce, an arrival 5 degrees off w2, a position past the limit. */
export interface Faults { nonce?: string; offWaypoint?: boolean; pastLimit?: boolean }

/** The seller records the ordered run, home through w1, w2 and w3 and home, and packs it as one JSON document. */
export async function recordEpisode(lab: Lab, order: Order, o: { seconds?: number; faults?: Faults } = {}): Promise<Uint8Array> {
  const n = Math.round((o.seconds ?? 10) * FPS);
  const home = [0, 0, 90, 0, -90, 0];
  const legs = [home, order.waypoints.w1, order.waypoints.w2, order.waypoints.w3, home];
  const seg = n / (legs.length - 1);
  const cols: Record<string, unknown[]> = { 'observation.state': [], 'observation.velocity': [], 'observation.effort': [], action: [], timestamp: [], frame_index: [], episode_index: [], index: [], task_index: [] };
  const arrivals: Record<string, Record<string, number>> = {};
  const legOf = (k: number) => Math.min(Math.floor(k / seg), legs.length - 2);
  for (let k = 0; k < n; k++) {
    const leg = legOf(k);
    const s = (k - leg * seg) / seg;
    const a = legs[leg]!, b = legs[leg + 1]!;
    const pos = a.map((x, i) => r3(x + (b[i]! - x) * mj(s) + 0.002 * Math.sin(k / 9 + i)));
    const vel = a.map((x, i) => r3(((b[i]! - x) * mjd(s)) / (seg / FPS)));
    const cur = vel.map((v, i) => r3(0.3 + 0.004 * Math.abs(v) + 0.12 * Math.cos((pos[i]! * Math.PI) / 180)));
    const next = Math.min(k + 1, n - 1), nl = legOf(next), ns = (next - nl * seg) / seg;
    const act = legs[nl]!.map((x, i) => r3(x + (legs[nl + 1]![i]! - x) * mj(ns)));
    cols['observation.state']!.push(pos);
    cols['observation.velocity']!.push(vel);
    cols['observation.effort']!.push(cur);
    cols['action']!.push(act);
    cols['timestamp']!.push(r3(k / FPS));
    cols['frame_index']!.push(k);
    cols['episode_index']!.push(0);
    cols['index']!.push(k);
    cols['task_index']!.push(0);
    if (k === Math.round((leg + 1) * seg) - 1 && leg < 3) arrivals[`w${leg + 1}`] = { frame_index: k, ...Object.fromEntries(JOINTS.map((j, i) => [j, pos[i]!])) };
  }
  if (o.faults?.offWaypoint) arrivals['w2']!['j1']! += 5;
  if (o.faults?.pastLimit) (cols['observation.state']![Math.floor(n / 2)] as number[])[0] = 400;
  const stats = Object.fromEntries(Object.entries(cols).map(([f, v]) => {
    const rows = (v as (number | number[])[]).map((x) => (Array.isArray(x) ? x : [x]));
    const at = (i: number) => rows.map((r) => r[i]!);
    const mean = (xs: number[]) => xs.reduce((p, q) => p + q, 0) / xs.length;
    const std = (xs: number[]) => {
      const m = mean(xs);
      return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
    };
    const per = (fn: (xs: number[]) => number) => Array.from({ length: rows[0]!.length }, (_, i) => r3(fn(at(i))));
    return [f, { min: per((xs) => xs.reduce((p, q) => Math.min(p, q))), max: per((xs) => xs.reduce((p, q) => Math.max(p, q))), mean: per(mean), std: per(std), count: [n] }];
  }));
  const nonce = o.faults?.nonce ?? order.nonce;
  const dataSha = await sha(JSON.stringify(cols));
  // The full recording stays with the seller; the episode carries its hash. Simulated here from the frame table.
  const recordingSha = await sha(`simulated-recording|${dataSha}`);
  const message = `${FORMAT}|${nonce}|${dataSha}|${recordingSha}`;
  const info = { codebase_version: 'v3.0', robot_type: ROBOT, total_episodes: 1, total_frames: n, total_tasks: 1, chunks_size: 1000, data_files_size_in_mb: 100, video_files_size_in_mb: 500, fps: FPS, splits: { train: '0:1' }, data_path: DATA_PATH, video_path: null, features: FEATURES };
  const doc = {
    format: FORMAT,
    meta: {
      info,
      tasks: [{ task_index: 0, task: TASK }],
      episodes: [{ episode_index: 0, tasks: [TASK], length: n, dataset_from_index: 0, dataset_to_index: n }],
      stats,
    },
    data: cols,
    provenance: {
      serial_sha256: lab.serialSha256,
      controller_firmware: 'simulated',
      clock: 'ptp',
      start_utc: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      calibration_sha256: await sha('simulated-calibration'),
      order: { nonce, waypoints_deg: order.waypoints, speed_pct: 30 },
      arrivals,
      data_sha256: dataSha,
      recording_sha256: recordingSha,
      device: { alg: 'ed25519', public_key: lab.publicKey, message, signature: hex(nacl.sign.detached(new TextEncoder().encode(message), lab.secretKey)) },
    },
  };
  return new TextEncoder().encode(JSON.stringify(doc));
}

/** The ten checks: every one a kind Crow has, all required, every bound a whole number. */
export function checksFor(lab: Lab, order: Order, o: { minSeconds?: number; maxSeconds?: number } = {}) {
  const maxSeconds = o.maxSeconds ?? 15;
  const minN = (o.minSeconds ?? 8) * FPS, maxN = maxSeconds * FPS;
  const col = (items: object) => ({ type: 'array', minItems: minN, maxItems: maxN, items });
  const vec = (lo: number, hi: number) => col({ type: 'array', minItems: 6, maxItems: 6, items: { type: 'number', minimum: lo, maximum: hi } });
  const data = (props: Record<string, object>) => ({ type: 'object', required: ['data'], properties: { data: { type: 'object', required: Object.keys(props), properties: props } } });
  const provenance = (required: string[], properties: Record<string, object>) => ({ type: 'object', required: ['provenance'], properties: { provenance: { type: 'object', required, properties } } });
  const frames = { type: 'integer', minimum: minN, maximum: maxN };
  const arrival = (wp: number[]) => ({ type: 'object', required: ['frame_index', ...JOINTS], properties: { frame_index: { type: 'integer', minimum: 0, maximum: maxN }, ...Object.fromEntries(JOINTS.map((j, i) => [j, { type: 'number', minimum: wp[i]! - TOLERANCE, maximum: wp[i]! + TOLERANCE }])) } });
  return [
    // additionalProperties false at the top must list every section, data and provenance included.
    { id: 'lerobot-info', type: 'json_schema', required: true, schema: { type: 'object', required: ['format', 'meta', 'data', 'provenance'], additionalProperties: false, properties: {
      format: { const: FORMAT }, data: { type: 'object' }, provenance: { type: 'object' },
      meta: { type: 'object', required: ['info', 'tasks', 'episodes', 'stats'], properties: { info: { type: 'object', required: INFO_FIELDS.filter((f) => f !== 'video_path'), properties: {
        codebase_version: { const: 'v3.0' }, robot_type: { const: ROBOT }, total_episodes: { const: 1 }, total_tasks: { const: 1 }, fps: { const: FPS },
        total_frames: frames, splits: { const: { train: '0:1' } }, data_path: { const: DATA_PATH }, features: { const: FEATURES } } } } } } } },
    { id: 'lerobot-meta', type: 'json_schema', required: true, schema: { type: 'object', required: ['meta'], properties: { meta: { type: 'object', properties: {
      tasks: { type: 'array', minItems: 1, maxItems: 1, items: { type: 'object', required: ['task_index', 'task'], properties: { task_index: { const: 0 }, task: { const: TASK } } } },
      episodes: { type: 'array', minItems: 1, maxItems: 1, items: { type: 'object', required: ['episode_index', 'length', 'dataset_from_index', 'dataset_to_index'], properties: { episode_index: { const: 0 }, dataset_from_index: { const: 0 }, length: frames, dataset_to_index: frames } } },
      stats: { type: 'object', required: Object.keys(FEATURES), properties: Object.fromEntries(Object.keys(FEATURES).map((f) => [f, { type: 'object', required: ['min', 'max', 'mean', 'std', 'count'] }])) } } } } } },
    { id: 'frames', type: 'json_schema', required: true, schema: data({ timestamp: col({ type: 'number', minimum: 0, maximum: maxSeconds }), frame_index: col({ type: 'integer', minimum: 0, maximum: maxN }), index: col({ type: 'integer', minimum: 0, maximum: maxN }), episode_index: col({ const: 0 }), task_index: col({ const: 0 }) }) },
    // The arm's limits: the third joint +-155 degrees, the others +-360. The json_schema subset has no prefixItems,
    // so one bound holds for every joint in a vector: +-360.
    { id: 'joint-positions', type: 'json_schema', required: true, schema: data({ 'observation.state': vec(-360, 360), action: vec(-360, 360) }) },
    // Degrees per second: 180 for the first two joints, 223 for the others; one bound, so 223.
    { id: 'joint-speeds', type: 'json_schema', required: true, schema: data({ 'observation.velocity': vec(-223, 223) }) },
    // Amperes.
    { id: 'joint-currents', type: 'json_schema', required: true, schema: data({ 'observation.effort': vec(-10, 10) }) },
    { id: 'fresh-order', type: 'json_schema', required: true, schema: provenance(['serial_sha256', 'order', 'recording_sha256', 'calibration_sha256', 'clock'], {
      serial_sha256: { const: lab.serialSha256 }, order: { type: 'object', required: ['nonce', 'waypoints_deg'], properties: { nonce: { const: order.nonce }, waypoints_deg: { const: order.waypoints } } },
      recording_sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' }, calibration_sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' }, clock: { enum: ['ptp', 'chrony', 'ntp'] } }) },
    { id: 'arrivals', type: 'json_schema', required: true, schema: provenance(['arrivals'], { arrivals: { type: 'object', required: ['w1', 'w2', 'w3'], properties: { w1: arrival(order.waypoints.w1), w2: arrival(order.waypoints.w2), w3: arrival(order.waypoints.w3) } } }) },
    { id: 'device-key', type: 'json_schema', required: true, schema: provenance(['device'], { device: { type: 'object', required: ['alg', 'public_key', 'message', 'signature'], properties: {
      alg: { const: 'ed25519' }, public_key: { const: lab.publicKey }, message: { type: 'string', pattern: `^lerobot-v3-json/0\\.1\\|${order.nonce}\\|[0-9a-f]{64}\\|[0-9a-f]{64}$` }, signature: { type: 'string', pattern: '^[0-9a-f]{128}$' } } } }) },
    { id: 'hidden', type: 'hidden_characters_max', required: true, max: { total: 0 } },
  ];
}

export const DELIVERABLE = {
  kind: 'dataset',
  format: 'application/json',
  description: `One robot arm episode (${ROBOT}), recorded after the order: home, then waypoints w1, w2 and w3 in order at 30% speed, then home, at ${FPS} Hz for 8 to 15 s. One JSON document in the ${FORMAT} layout: LeRobot v3 meta/info.json, tasks, episodes and stats; the frame table as columns (joint positions, speeds and currents in degrees, degrees per second and amperes; the next commanded position as action); and provenance: the serial hash, the order's nonce and waypoints, the measured arrival at each waypoint, the full recording's hash, and the recording host's Ed25519 signature over the nonce and the hashes.`,
};

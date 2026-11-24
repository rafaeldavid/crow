// T-422: the operators' limits on abuse of the public API (docs/operator-threat-model.md). They protect one operator's
// service; none changes what the settlement contract accepts or caps a value the parties negotiate (D31). A caller one
// operator refuses can send the same signed message to the other operator or straight to the settlement contract.
//
// - The flood ceiling: each Worker counts every request per client in a Cloudflare rate-limit binding (FLOOD in both
//   Wrangler files) and answers 429 before the World object, so a flood never reaches the one object both nodes share.
// - The body cap: each Worker refuses a body whose Content-Length is above the route's cap, before the World object.
// - The daily caps (DailyCaps): the World object counts, per client and per operator, the deals the relayer funds and
//   the new ciphertext bytes it stores each UTC day, in storage rows, so a restart keeps them.
// - The replay rule: a repeat of an accepted request (the same Idempotency-Key and body) is never refused by a daily
//   cap, nor by the operator's read and write throttle (apps/operator/src/server.ts). The flood ceiling counts it.
import { canonicalKeccak } from '@holdback/core';
import { MAX_REGISTRATION_BYTES, PROBLEM_BASE, PROBLEMS, type ApiProblemType } from '@holdback/operator';
import type { WorldStorage } from './storage.js';

/**
 * The flood ceiling, as both Wrangler files bind it (`ratelimits`, name FLOOD): requests per period per client, in each
 * Cloudflare location. One try deal peaks at 27 requests in 10 s on one operator (measured 2026-11-14, T-422).
 */
export const FLOOD_CEILING = { limit: 500, periodSec: 10 } as const;

/** The daily caps' defaults: deals the relayer funds, and new ciphertext bytes stored, per client and operator a UTC day. */
export const DEFAULT_DAILY_CAPS = { fundedDeals: 100, ciphertextBytes: 268_435_456, fundedDealsAll: 200 } as const;

/**
 * T-581: judged deals Crow's adjudicators accept per buyer address a UTC day, by default. 3, so `pnpm demo:sepolia` plays
 * its three judged beats from one buyer (Rafa, 2026-11-24).
 */
export const DEFAULT_JUDGED_DEALS_PER_BUYER = 3;

/** The operator's read and write throttle's defaults, per 60 s (ADR-0017 §3). */
export const DEFAULT_RATE = { reads: 1200, writes: 120 } as const;

export interface DailyCapLimits {
  /** Deals the relayer funds (a funded agree, a fund, a one-shot hold) per client per UTC day, at each operator. */
  fundedDeals: number;
  /** New ciphertext bytes stored per client per UTC day, at each operator. */
  ciphertextBytes: number;
  /** T-581: deals the relayer funds per UTC day across every client and both operators, which share one relayer wallet. */
  fundedDealsAll: number;
}

/** What a per-client limit counts: an IPv4 address, or an IPv6 address's /64, which one host usually holds whole. */
export function clientKey(ip: string): string {
  if (!ip.includes(':')) return ip;
  const [head = '', tail] = ip.toLowerCase().split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return `${groups.slice(0, 4).map((g) => g.padStart(4, '0')).join(':')}::/64`;
}

const DAY_MS = 86_400_000;
const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Whole seconds from `ms` to the next 00:00 UTC, at least 1. */
export function secondsToUtcMidnight(ms: number): number {
  return Math.max(1, Math.ceil((Date.parse(`${dayOf(ms)}T00:00:00Z`) + DAY_MS - ms) / 1000));
}

/**
 * A whole number from a Worker variable, or the default when the variable is absent. Anything else refuses to start:
 * a limit is the operator's own configuration, and a typo must not open or close the service silently.
 */
export function wholeNumberVar(env: Readonly<Record<string, string | undefined>>, name: string, fallback: number): number {
  const v = env[name];
  if (v === undefined) return fallback;
  if (!/^(0|[1-9][0-9]{0,14})$/.test(v)) throw new Error(`${name} must be a whole number of 0 or more, not ${JSON.stringify(v)}`);
  return Number(v);
}

/** A problem answer in the operator's format (RFC 9457, apps/operator/src/problems.ts), for refusals made outside it. */
export function problemResponse(type: ApiProblemType, detail: string, members: { retryAfterSec?: number; maxBytes?: number } = {}): Response {
  const status = PROBLEMS[type].status;
  const body = { type, title: PROBLEMS[type].title, status, detail, instance: `urn:holdback:request:${crypto.randomUUID()}`, ...members };
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/problem+json',
      link: `<${PROBLEM_BASE}${type}>; rel="type"`,
      ...(members.retryAfterSec !== undefined ? { 'retry-after': String(members.retryAfterSec) } : {}),
    },
  });
}

/** The operator's cap on a JSON body, in bytes (apps/operator/src/server.ts; limits.test.ts reads its 413 to match). */
export const MAX_BODY_BYTES = 1_048_576;

/** The largest body a route takes, in bytes: the operator's own caps, checked by the Worker on Content-Length. */
export const bodyCapOf = (path: string): number => (path.replace(/\/+$/, '') === '/v1/adjudicators' ? MAX_REGISTRATION_BYTES : MAX_BODY_BYTES);

/** The Worker's 413 for a declared body above the route's cap, or null. A body with no Content-Length is the operator's to cap. */
export function oversized(request: Request, path: string): Response | null {
  if (request.method === 'GET' || request.method === 'HEAD') return null;
  const declared = request.headers.get('content-length');
  const cap = bodyCapOf(path);
  if (declared === null || !/^[0-9]+$/.test(declared) || Number(declared) <= cap) return null;
  return problemResponse('payload_too_large', `request bodies to ${path} are limited to ${cap} bytes at this operator; this one declares ${declared}`, { maxBytes: cap });
}

/** The Worker's 404 for a path with an empty segment (`//`, or a backslash, which URL parsing turns into one): no route has one. */
export function emptySegment(url: URL): Response | null {
  return url.pathname.includes('//') ? problemResponse('not_found', `no route ${url.pathname}: a path here has no empty segment`) : null;
}

/** Whether the flood binding admits a client: it fails open after `timeoutMs`, or on an error, so an outage of it never stops the API. */
export async function admitted(flood: { limit(o: { key: string }): Promise<{ success: boolean }> }, key: string, timeoutMs = 100): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const open = new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(true), timeoutMs)));
  try {
    return await Promise.race([flood.limit({ key }).then((r) => r.success, () => true), open]);
  } finally {
    clearTimeout(timer);
  }
}

/** The Worker's 429 when the flood ceiling refuses a client. */
export function flooded(): Response {
  return problemResponse(
    'rate_limited',
    `this operator takes at most ${FLOOD_CEILING.limit} requests per ${FLOOD_CEILING.periodSec} s from one client (an IPv4 address or an IPv6 /64); retry after ${FLOOD_CEILING.periodSec} s, or send the same request to another operator`,
    { retryAfterSec: FLOOD_CEILING.periodSec },
  );
}

interface CapRow {
  /** Deals funded through this operator today, pending ones included. */
  funded: number;
  /** Fingerprints of the fundings counted today (Idempotency-Key, path and body): a replay of one is not counted again. */
  seen: string[];
  /** New ciphertext bytes stored through this operator today, pending ones included. */
  bytes: number;
}

/** What refused a take: the client's own funded-deal cap, or the cap on every client together. */
export type TakeRefusal = 'client' | 'global';

/** A take: refused with when to retry, or admitted, saying whether this request took a count (and so may give it back). */
export type Take = { ok: true; counted: boolean } | { ok: false; retryAfterSec: number; reason?: TakeRefusal };

/**
 * The daily caps, one storage row per client, operator and UTC day: `lc:<YYYY-MM-DD>:<node>:<client hash>`. The client
 * is hashed with the world's secret, so no row names an address. A count is taken before the relay and given back when
 * the relay refuses, so concurrent requests cannot pass the cap together. The first take of a new day deletes the rows
 * of the days before it.
 */
export class DailyCaps {
  private readonly rows = new Map<string, Promise<CapRow>>();
  private day = '';

  constructor(
    private readonly storage: WorldStorage,
    private readonly now: () => number,
    private readonly secret: string,
    readonly limits: DailyCapLimits,
  ) {}

  private keyOf(node: number | 'all', client: string): string {
    return node === 'all' ? `lc:${this.day}:all` : `lc:${this.day}:${node}:${canonicalKeccak({ limitsClient: client, secret: this.secret }).slice(2, 34)}`;
  }

  /** The row for today, read once and kept in memory; a new day drops yesterday's rows from memory and storage. */
  private async row(node: number | 'all', client: string): Promise<{ key: string; row: CapRow }> {
    const today = dayOf(this.now());
    if (today !== this.day) {
      this.day = today;
      this.rows.clear();
      const old = [...(await this.storage.list({ prefix: 'lc:', end: `lc:${today}` })).keys()];
      for (let i = 0; i < old.length; i += 128) await this.storage.delete(old.slice(i, i + 128));
    }
    const key = this.keyOf(node, client);
    let row = this.rows.get(key);
    if (!row) {
      row = this.storage.get<CapRow>(key).then((r) => r ?? { funded: 0, seen: [], bytes: 0 });
      this.rows.set(key, row);
    }
    return { key, row: await row };
  }

  /**
   * The client's row and the row for every client, both of one UTC day (a request that straddles 00:00 reads both again).
   * A caller checks and counts with no await after this returns, so concurrent requests see each other's counts (T-581
   * review, item 1).
   */
  private async pair(node: number, client: string): Promise<{ key: string; row: CapRow; all: { key: string; row: CapRow } }> {
    for (;;) {
      const one = await this.row(node, client);
      const all = await this.row('all', '');
      const day = `lc:${this.day}:`;
      if (one.key.startsWith(day) && all.key.startsWith(day)) return { ...one, all };
    }
  }

  private refused(reason?: TakeRefusal): Take {
    return { ok: false, retryAfterSec: secondsToUtcMidnight(this.now()), ...(reason ? { reason } : {}) };
  }

  /**
   * Takes one funded deal for this client at this operator, unless `fingerprint` was already counted today. Only a take
   * with `counted: true` may be given back: a copy of a counted funding that the relay refuses gives nothing back
   * (T-422 review and red team, F2).
   */
  async takeFunding(node: number, client: string, fingerprint: string): Promise<Take> {
    // Both rows first: from here to the counts, no await, so a concurrent take sees this one's count.
    const { key, row, all } = await this.pair(node, client);
    if (row.seen.includes(fingerprint)) return { ok: true, counted: false };
    if (row.funded >= this.limits.fundedDeals) return this.refused('client');
    // The count for every client together (T-581): the relayer's wallet is one, behind both operators.
    if (all.row.funded >= this.limits.fundedDealsAll) return this.refused('global');
    row.funded++;
    all.row.funded++;
    row.seen.push(fingerprint);
    await this.storage.put({ [key]: row, [all.key]: all.row });
    return { ok: true, counted: true };
  }

  /** After the relay: a refused funding this request counted gives its count back, so a corrected request can use it. */
  async settleFunding(node: number, client: string, fingerprint: string, accepted: boolean): Promise<void> {
    if (accepted) return;
    const { key, row, all } = await this.pair(node, client);
    const i = row.seen.indexOf(fingerprint);
    if (i < 0) return;
    row.seen.splice(i, 1);
    row.funded = Math.max(0, row.funded - 1);
    all.row.funded = Math.max(0, all.row.funded - 1);
    await this.storage.put({ [key]: row, [all.key]: all.row });
  }

  /** Takes `bytes` of new ciphertext for this client at this operator; bytes the store already holds take nothing. */
  async takeBytes(node: number, client: string, bytes: number, stored: () => Promise<boolean>): Promise<Take> {
    if (await stored()) return { ok: true, counted: false };
    const { key, row } = await this.row(node, client);
    if (row.bytes + bytes > this.limits.ciphertextBytes) return this.refused();
    row.bytes += bytes;
    await this.storage.put({ [key]: row });
    return { ok: true, counted: true };
  }

  /** After the upload: a refused one gives its bytes back. */
  async settleBytes(node: number, client: string, bytes: number, accepted: boolean): Promise<void> {
    if (accepted || bytes === 0) return;
    const { key, row } = await this.row(node, client);
    row.bytes = Math.max(0, row.bytes - bytes);
    await this.storage.put({ [key]: row });
  }
}

/**
 * T-581: the judged deals Crow's adjudicators accept per buyer address and UTC day (Rafa, 2026-11-24: one limit, at
 * acceptance, however the offer reached the settlement layer). One row per buyer and day, `ja:<YYYY-MM-DD>:<buyer hash>`,
 * holding the commitment IDs counted, so a pass that accepts the same offer again counts it once. The buyer is hashed
 * with the world's secret. Takes run one at a time, so concurrent acceptances cannot pass the limit together. The first
 * take of a new day deletes the rows of the days before it. An adjudicator's own choice of deals (D29), not a protocol rule.
 */
export class BuyerJudgedDeals {
  private queue: Promise<unknown> = Promise.resolve();
  private day = '';

  constructor(
    private readonly storage: WorldStorage,
    private readonly now: () => number,
    private readonly secret: string,
    readonly perDay: number,
  ) {}

  private keyOf(day: string, buyer: string): string {
    return `ja:${day}:${canonicalKeccak({ judgedBuyer: buyer.toLowerCase(), secret: this.secret }).slice(2, 34)}`;
  }

  private serial<T>(f: () => Promise<T>): Promise<T> {
    const step = this.queue.then(f);
    this.queue = step.catch(() => undefined);
    return step;
  }

  private async ids(buyer: string): Promise<{ key: string; ids: string[] }> {
    const today = dayOf(this.now());
    if (today !== this.day) {
      this.day = today;
      const old = [...(await this.storage.list({ prefix: 'ja:', end: `ja:${today}` })).keys()];
      for (let i = 0; i < old.length; i += 128) await this.storage.delete(old.slice(i, i + 128));
    }
    const key = this.keyOf(today, buyer);
    return { key, ids: (await this.storage.get<string[]>(key)) ?? [] };
  }

  /** Whether one more judged deal for `buyer` fits today, counting nothing: true when `id` is already counted. */
  check(buyer: string, id: string): Promise<boolean> {
    return this.serial(async () => {
      const { ids } = await this.ids(buyer);
      return ids.includes(id) || ids.length < this.perDay;
    });
  }

  /** Counts `id` for `buyer` today, unless the day's limit is reached; an `id` already counted takes nothing more. */
  take(buyer: string, id: string): Promise<boolean> {
    return this.serial(async () => {
      const { key, ids } = await this.ids(buyer);
      if (ids.includes(id)) return true;
      if (ids.length >= this.perDay) return false;
      await this.storage.put({ [key]: [...ids, id] });
      return true;
    });
  }

  /** Returns the count of an acceptance that was not submitted. */
  giveBack(buyer: string, id: string): Promise<void> {
    return this.serial(async () => {
      const { key, ids } = await this.ids(buyer);
      if (ids.includes(id)) await this.storage.put({ [key]: ids.filter((x) => x !== id) });
    });
  }
}

/**
 * The URL the operator routes: it parses the path and query alone against a placeholder origin (apps/operator/src/
 * fetch.ts and server.ts), so `//x/v1/…` routes as `/v1/…`. The caps read the same URL (T-422 red team, F1).
 */
export const routedUrl = (url: URL): URL => new URL(`${url.pathname}${url.search}`, 'http://operator.invalid');

/** Which daily cap a POST draws on, from its routed path and query: a funded agree is told apart by its body. */
export function capOf(method: string, url: URL): 'funding' | 'agree' | 'ciphertext' | null {
  if (method !== 'POST' || url.searchParams.get('validateOnly') === 'true') return null;
  const s = url.pathname.split('/').filter(Boolean);
  if (s[0] !== 'v1') return null;
  if (s.length === 2 && s[1] === 'holds') return 'funding';
  if (s.length === 2 && s[1] === 'ciphertext') return 'ciphertext';
  if (s.length === 4 && s[1] === 'commitments' && s[3] === 'fund') return 'funding';
  if (s.length === 4 && s[1] === 'commitments' && s[3] === 'agree') return 'agree';
  return null;
}

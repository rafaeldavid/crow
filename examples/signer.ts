// Crow's signer, buying half (T-439): a separate program, on a machine the buying agent cannot log in to, that holds
// the payment key and signs one thing: a deal's funding, and only inside its rules. The agent holds no key that can
// move Crow's money; it asks this program, and this program decides from the signed terms, its own rules file, its
// own clock, its own ledger and its own reads of each deal. Test tokens only (Sepolia, a local chain or SimChain).
//   node examples/signer.ts init --state <dir>      makes the state folder and an empty ledger, once; serve refuses without them
//   node examples/signer.ts serve --rules <file> --state <dir> --flag <file> [--listen <host:port>]
//       serves POST /v1/sign and GET /v1/status, default on 127.0.0.1:8547. Keys from the environment only:
//       CROW_SIGNER_FLOAT_KEY (the payment address's key) and CROW_SIGNER_BUYING_KEY (the buying agent's standing key);
//       with the rules' `selling` half (T-443), CROW_SIGNER_SELLING_KEY (the selling key): offers and deliveries, see #signOffer and #signDelivery.
//   node examples/signer.ts check-rules <file>     validates a rules file against examples/signer-rules.schema.json and prints its SHA-256
//   node examples/signer.ts stop --flag <file>     writes the stop; node examples/signer.ts run --flag <file> clears it
// It refuses every request unless the flag file reads exactly "run"; a missing or unreadable flag is a stop.
// It signs no transfer but a deal's funding to the escrow's collector: the operator-fee message is refused (B14).
// Every decision, signed or refused, goes to <state>/decisions.jsonl with the rule and the value it saw; the day's
// ledger is <state>/ledger.json and the public status <state>/status.json. One signer serves a state folder at a time
// (<state>/lock). The principal's revocations go in the folder the rules name. Exit status 0, 2 on a wrong call, 3 on a refusal.
import { createHash } from 'node:crypto';
import { preflightDelivery } from '@holdback/judgment';
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateKeyToAccount, signTypedData } from 'viem/accounts';
import type { Hex } from 'viem';
import { SEPOLIA } from './deployments.ts';
import { isMain } from './entry.ts';
import { buildDelegation, parseStrictJson, typedOf as mandateTyped, verifyDocument } from './mandate.ts';
import { checkPaymentFile, commitmentIdOf, digestOfFile, jcs, jcsHash, pinOf, Refusal, SIMCHAIN_DOMAIN, strictTypedDataFile, typedOf, type Pin } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The rules file's schema, beside this file. */
export const RULES_SCHEMA = fileURLToPath(new URL('./signer-rules.schema.json', import.meta.url));
/** The largest request body the signer reads, in bytes. */
export const MAX_BODY_BYTES = 256 * 1024;
/** How long one read of a deal's state may take, in ms, before it counts as no answer. */
export const READ_TIMEOUT_MS = 5000;
/** The states in which a deal's money has left the hold for good, and those in which it never entered it. */
const ENDED = ['Released', 'Refunded', 'Settled'], UNFUNDED = ['Offered', 'AcceptedByAdjudicator', 'Agreed', 'Expired'];
/** The fields of public terms, exactly (packages/core/src/eip712.ts, CommitmentTerms; the bodies in place of their hashes). */
const TERMS_KEYS = ['schemaVersion', 'clubId', 'rulebookHash', 'buyer', 'seller', 'buyerPaymentAddress', 'sellerPayoutAddress', 'deliverable', 'acceptance', 'price', 'adjudication', 'timing', 'settlement', 'remedy', 'disclosure', 'buyerEncryptionPublicKey', 'nonce', 'createdAt'];
const TIMING_KEYS = ['offerExpiresAt', 'fundBy', 'deliverBy', 'judgeBy', 'fallbackBy', 'appealWindowSec', 'appealDecideSec', 'maxSubmissions'];
const ADJUDICATION_KEYS = ['adjudicator', 'fallbackAdjudicator', 'appealAdjudicator', 'policyId', 'fee', 'registryHash', 'policyHash'];

/** A refusal, naming the constraint it enforces (company-ops/own-agents/constraints.md) and what it saw. */
export class Refused extends Error {
  readonly rule: string;
  constructor(rule: string, detail: string) {
    super(detail);
    this.rule = rule;
  }
}
const no = (rule: string, detail: string): never => {
  throw new Refused(rule, detail);
};

// The rules file, validated against its JSON Schema by the small validator below: every keyword the schema uses, and a
// keyword it does not know stops the start (fail closed). signer.test.ts checks that Ajv agrees on the same files.
const ANNOTATIONS = new Set(['$schema', '$id', '$defs', 'title', 'description']);
/** Validates `v` against `schema` (a subset of JSON Schema 2020-12). Returns the first error, or null. */
export function schemaError(v: J, schema: J, root: J = schema, at = '(the file)'): string | null {
  for (const k of Object.keys(schema)) if (!ANNOTATIONS.has(k) && !['type', 'const', 'enum', 'pattern', 'minimum', 'maximum', 'minItems', 'maxItems', 'required', 'additionalProperties', 'properties', 'items', 'oneOf', '$ref'].includes(k)) throw new Error(`the rules schema uses ${k}, which this validator does not know: refusing to start`);
  if (schema.$ref) {
    const name = /^#\/\$defs\/([A-Za-z0-9]+)$/.exec(schema.$ref)?.[1];
    if (!name || !root.$defs?.[name]) throw new Error(`the rules schema refers to ${schema.$ref}, which it does not define`);
    return schemaError(v, root.$defs[name], root, at);
  }
  if (schema.oneOf) {
    const passing = schema.oneOf.filter((s: J) => schemaError(v, s, root, at) === null).length;
    return passing === 1 ? null : `${at} matches ${passing} of the allowed forms, not exactly one`;
  }
  const t = schema.type;
  if (t === 'object' && !(v && typeof v === 'object' && !Array.isArray(v))) return `${at} is not an object`;
  if (t === 'array' && !Array.isArray(v)) return `${at} is not a list`;
  if (t === 'string' && typeof v !== 'string') return `${at} is not a string`;
  if (t === 'integer' && !Number.isSafeInteger(v)) return `${at} is not a whole number`;
  if ('const' in schema && v !== schema.const) return `${at} is ${JSON.stringify(v)}, not ${JSON.stringify(schema.const)}`;
  if (schema.enum && !schema.enum.includes(v)) return `${at} is ${JSON.stringify(v)}, not one of ${JSON.stringify(schema.enum)}`;
  if (schema.pattern && !(typeof v === 'string' && new RegExp(schema.pattern, 'u').test(v))) return `${at} ${JSON.stringify(v)} does not match ${schema.pattern}`;
  if (schema.minimum !== undefined && !(typeof v === 'number' && v >= schema.minimum)) return `${at} is below ${schema.minimum}`;
  if (schema.maximum !== undefined && !(typeof v === 'number' && v <= schema.maximum)) return `${at} is above ${schema.maximum}`;
  if (Array.isArray(v)) {
    if (schema.minItems !== undefined && v.length < schema.minItems) return `${at} has fewer than ${schema.minItems} items`;
    if (schema.maxItems !== undefined && v.length > schema.maxItems) return `${at} has more than ${schema.maxItems} items`;
    if (schema.items) for (let i = 0; i < v.length; i++) {
      const e = schemaError(v[i], schema.items, root, `${at}[${i}]`);
      if (e) return e;
    }
  }
  if (v && typeof v === 'object' && !Array.isArray(v) && (schema.properties || schema.required)) {
    for (const k of schema.required ?? []) if (!Object.hasOwn(v, k)) return `${at} lacks ${k}`;
    for (const k of Object.keys(v)) {
      if (schema.properties && Object.hasOwn(schema.properties, k)) {
        const e = schemaError(v[k], schema.properties[k], root, `${at === '(the file)' ? '' : `${at}.`}${k}`);
        if (e) return e;
      } else if (schema.additionalProperties === false) return `${at} has a field the schema does not: ${k}`;
    }
  }
  return null;
}

export type Rules = J;
/** Reads and validates a rules file; returns it with its SHA-256. Throws naming the first error. */
export function loadRules(path: string): { rules: Rules; sha256: string; bytes: Buffer } {
  const bytes = readFileSync(path);
  let rules: J;
  try {
    rules = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`the rules file ${path} is not JSON`);
  }
  const e = schemaError(rules, JSON.parse(readFileSync(RULES_SCHEMA, 'utf8')));
  if (e) throw new Error(`the rules file ${path} does not pass examples/signer-rules.schema.json: ${e}`);
  const b = rules.buying;
  if (BigInt(b.maxOpenTotal) > BigInt(b.maxPerDay) * 2n) throw new Error('maxOpenTotal is above two days of maxPerDay: the file contradicts itself');
  return { rules, sha256: createHash('sha256').update(bytes).digest('hex'), bytes };
}

/** The folder of the principal's revocations, as the rules name it, beside the rules file. */
const revocationsFolder = (rulesPath: string, r: Rules) => resolve(dirname(rulesPath), r.buying.revocationsPath);
/** Two tokens are one when equal, or when both are addresses that differ only in letter case (as the commitment ID hashes them). */
const sameToken = (a: J, b: string) => typeof a === 'string' && (a === b || (/^0x[0-9a-fA-F]{40}$/.test(a) && /^0x[0-9a-fA-F]{40}$/.test(b) && a.toLowerCase() === b.toLowerCase()));
const printable = (x: string) => x.replace(/[^\x20-\x7e]/g, '?').slice(0, 200);

/** The settlement layer the rules pin: Sepolia, a local chain or SimChain. */
export function pinOfRules(r: Rules): Pin {
  if (r.chain.network === 'simchain') return { domain: SIMCHAIN_DOMAIN, token: { id: 'tUSD', symbol: 'tUSD', decimals: 6 } };
  if (r.chain.network === 'sepolia') {
    if (!SEPOLIA) throw new Error('this build pins no Sepolia deployment');
    return pinOf(SEPOLIA);
  }
  const d = r.chain.deployment;
  return pinOf({ chainId: d.chainId, fromBlock: 0, token: d.token, escrow: d.escrow, erc3009Collector: d.erc3009Collector, multicall: '', rules: d.rules, beacon: '', expiryMarginSec: d.expiryMarginSec });
}

/** One payment the signer signed: what the day and the open holds count. */
type Entry = { commitmentId: string; total: string; signedAt: string; day: string; seller: string; payoutAddress: string; dealKey: string; delegation: J; fundBy: string; endsBy: string; endedAt?: string; ended?: string };
/** SimChain's own expiry margin, in seconds: a hold there can still pay out until fallbackBy + appealDecideSec + this. */
const SIMCHAIN_EXPIRY_MARGIN_SEC = 86_400;
/** One offer the signer signed for the selling key (T-443), and its one delivery. */
type Sale = { commitmentId: string; signedAt: string; day: string; buyer: string; price: string; fundBy: string; endsBy: string; endedAt?: string; ended?: string; delivered?: { at: string; digest: string } };
type Ledger = { version: 1; entries: Entry[]; sales?: Sale[] };
/** What a product's template writes for the one public deal a buyer names (T-443, T-444). */
const DEAL_PLACEHOLDER = '{{scope.commitmentId}}';
const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * Whether `actual` equals `template` exactly, the placeholder standing for one deal ID (0x and 64 lowercase hex
 * characters), the same everywhere. `bound` collects that ID.
 */
export function matchesTemplate(template: J, actual: J, bound: { id?: string } = {}): boolean {
  if (typeof template === 'string') {
    if (!template.includes(DEAL_PLACEHOLDER)) return template === actual;
    if (typeof actual !== 'string') return false;
    const m = new RegExp(`^${template.split(DEAL_PLACEHOLDER).map(escapeRe).join('(0x[0-9a-f]{64})')}$`).exec(actual);
    if (!m) return false;
    for (const g of m.slice(1)) {
      if (bound.id === undefined) bound.id = g;
      else if (bound.id !== g) return false;
    }
    return true;
  }
  if (Array.isArray(template)) return Array.isArray(actual) && actual.length === template.length && template.every((x, i) => matchesTemplate(x, actual[i], bound));
  if (template && typeof template === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
    const a = Object.keys(template).sort(), b = Object.keys(actual).sort();
    return jcs(a) === jcs(b) && a.every((k) => matchesTemplate(template[k], actual[k], bound));
  }
  return template === actual;
}

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const lc = (v: J) => String(v).toLowerCase();
const TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;
const ms = (v: J, name: string): number => (typeof v === 'string' && TIME.test(v) && Number.isFinite(Date.parse(v)) ? Date.parse(v) : no('B8', `${name} ${JSON.stringify(v)} is not a UTC time in whole seconds`));
const DEC = /^(0|[1-9][0-9]{0,30})$/;
const amount = (v: J, name: string): bigint => (typeof v === 'string' && DEC.test(v) ? BigInt(v) : no('request', `${name} is not base units as a decimal string`));

/** Writes a file so that a crash leaves the old one or the new one, never half of either. */
function writeDurably(path: string, text: string): void {
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, 'w', 0o600);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

export type OpenOptions = {
  rulesPath: string;
  statePath: string;
  flagPath: string;
  /** The two keys, from the environment of the signer's own process. */
  keys: { float: string; buying: string; selling?: string | undefined };
  /** The signer's clock in ms; the command line always uses the machine's. */
  now?: () => number;
};

export class Signer {
  readonly #o: OpenOptions;
  readonly #rules: Rules;
  readonly #rulesSha256: string;
  readonly #rulesBytes: Buffer;
  readonly #pin: Pin;
  readonly #float: ReturnType<typeof privateKeyToAccount>;
  readonly #buyingKey: Hex;
  readonly #selling: ReturnType<typeof privateKeyToAccount> | undefined;
  readonly #now: () => number;
  #ledger: Ledger;
  #queue: Promise<unknown> = Promise.resolve();
  #refusals: Record<string, { day: string; count: number }> = {};

  private constructor(o: OpenOptions, loaded: ReturnType<typeof loadRules>, ledger: Ledger) {
    this.#o = o;
    this.#rules = loaded.rules;
    this.#rulesSha256 = loaded.sha256;
    this.#rulesBytes = loaded.bytes;
    this.#pin = pinOfRules(loaded.rules);
    this.#float = privateKeyToAccount(o.keys.float as Hex);
    this.#buyingKey = o.keys.buying as Hex;
    this.#selling = o.keys.selling ? privateKeyToAccount(o.keys.selling as Hex) : undefined;
    this.#now = o.now ?? Date.now;
    this.#ledger = ledger;
  }

  /** Opens the signer: the rules, the keys against them, the ledger. Throws (and so never serves) on any doubt. */
  static async open(o: OpenOptions): Promise<Signer> {
    const loaded = loadRules(o.rulesPath);
    if (loaded.rules.selling && !o.keys.selling) throw new Error('the rules have a selling half, and no selling key is set: set CROW_SIGNER_SELLING_KEY in the signer\'s environment');
    if (!loaded.rules.selling && o.keys.selling) throw new Error('a selling key is set, and the rules have no selling half: unset CROW_SIGNER_SELLING_KEY, or add `selling` to the rules');
    for (const [name, k] of Object.entries(o.keys)) if (k !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(k)) throw new Error(`the ${name} key is not 32 bytes of hex: set it in the signer's environment`);
    const float = privateKeyToAccount(o.keys.float as Hex).address.toLowerCase(), buying = privateKeyToAccount(o.keys.buying as Hex).address.toLowerCase();
    if (float !== loaded.rules.floatAddress) throw new Error(`the float key's address ${float} is not the rules' floatAddress ${loaded.rules.floatAddress}`);
    if (buying !== loaded.rules.buying.standingKey) throw new Error(`the buying key's address ${buying} is not the rules' standingKey ${loaded.rules.buying.standingKey}`);
    if (float === buying) throw new Error('the float key and the buying key are one key: keep them apart');
    if (o.keys.selling) {
      const selling = privateKeyToAccount(o.keys.selling as Hex).address.toLowerCase();
      if (selling !== loaded.rules.selling.sellingKey) throw new Error(`the selling key's address ${selling} is not the rules' sellingKey ${loaded.rules.selling.sellingKey}`);
      if (selling === float || selling === buying) throw new Error('the selling key is the float key or the buying key: keep the three apart');
    }
    const path = join(o.statePath, 'ledger.json');
    // A missing ledger is a doubt, not a first start: `init` makes it once, and a mistyped --state finds none.
    if (!existsSync(path)) throw new Error(`there is no ledger at ${path}: refusing to start (run init once for a new state folder; a ledger that went missing would reset the day and the open holds)`);
    let ledger: Ledger;
    try {
      ledger = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      throw new Error(`the ledger ${path} is unreadable: refusing to start without it (it counts the day and the open holds)`);
    }
    if (ledger?.version !== 1 || !Array.isArray(ledger.entries)) throw new Error(`the ledger ${path} is not a ledger of version 1`);
    try {
      if (!statSync(revocationsFolder(o.rulesPath, loaded.rules)).isDirectory()) throw new Error('not a folder');
    } catch {
      throw new Error(`the revocations folder ${loaded.rules.buying.revocationsPath} the rules name is not a folder the signer can read: refusing to start`);
    }
    // One signer per state folder: two would each count their own day.
    const lock = join(o.statePath, 'lock');
    try {
      writeFileSync(lock, `${process.pid}\n`, { flag: 'wx', mode: 0o600 });
    } catch {
      throw new Error(`${lock} exists: another signer serves this state folder, or one stopped without removing it. Remove the file only when no signer runs on it`);
    }
    process.once('exit', () => {
      try {
        rmSync(lock);
      } catch {
        // gone already
      }
    });
    const s = new Signer(o, loaded, ledger);
    await s.#mandate(s.#now()); // a mandate that does not verify stops the start too
    if (loaded.rules.selling) await s.#mandate(s.#now(), 'selling');
    s.#writeStatus();
    return s;
  }

  get floatAddress(): string {
    return this.#float.address.toLowerCase();
  }

  /** One request, by method and path: POST /v1/sign or GET /v1/status. Everything else is refused. */
  async handle(method: string, path: string, body: string): Promise<{ status: number; body: J }> {
    if (method === 'GET' && path === '/v1/status') return { status: 200, body: this.status() };
    if (method !== 'POST' || path !== '/v1/sign') return { status: 404, body: { type: 'not_found', detail: 'this signer serves POST /v1/sign and GET /v1/status only' } };
    // One decision at a time: two requests sent together are counted one after the other.
    const run = this.#queue.then(() => this.#decide(body));
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #decide(body: string): Promise<{ status: number; body: J }> {
    const now = this.#now();
    let seen: J = {};
    try {
      const out = await this.#sign(body, now, (x) => (seen = { ...seen, ...x }));
      this.#log(now, { decision: 'signed', ...seen });
      return { status: 200, body: out };
    } catch (e) {
      const rule = e instanceof Refused ? e.rule : e instanceof Refusal ? 'B2' : 'error';
      const detail = e instanceof Refused || e instanceof Refusal ? e.message : `the signer failed and signed nothing: ${(e as Error).message}`;
      try {
        this.#log(now, { decision: 'refused', rule, detail, ...seen });
      } catch {
        // A log that cannot be written refuses too; the request is already refused.
      }
      const day = iso(now).slice(0, 10), r = this.#refusals[rule];
      this.#refusals[rule] = { day, count: r?.day === day ? r.count + 1 : 1 };
      this.#writeStatusQuietly();
      return { status: rule === 'error' ? 500 : 403, body: { type: 'refused', rule, detail } };
    }
  }

  /** The checks, in order; the first that fails refuses the request, naming its rule. */
  async #sign(text: string, now: number, saw: (x: J) => void): Promise<J> {
    let req: J;
    try {
      req = JSON.parse(text);
    } catch {
      this.#running();
      return no('request', 'the request is not JSON');
    }
    if (!req || typeof req !== 'object' || Array.isArray(req)) {
      this.#running();
      no('request', 'the request is not a JSON object');
    }
    // The selling half (T-443): a delivery is signed whether the signer is stopped or not, so no stop stalls a funded deal.
    if (req.kind === 'offer' || req.kind === 'delivery') {
      if (!this.#selling || !this.#rules.selling) no('B14', `this signer has no selling half: it signs no ${req.kind}`);
      return req.kind === 'offer' ? this.#signOffer(req, now, saw) : this.#signDelivery(req, now, saw);
    }
    this.#running();
    if (req.kind !== 'payment') no('B14', `this signer signs a deal's funding only (kind "payment"), not ${JSON.stringify(req.kind)}: no other transfer, no operator fee, no message of another kind`);
    const extra = Object.keys(req).filter((k) => !['kind', 'terms', 'file'].includes(k));
    if (extra.length || !req.terms || !req.file) no('request', `a payment request holds exactly kind, terms and file${extra.length ? `, not ${extra.join(', ')}` : ''}`);
    const { terms: t, file } = req;
    const primary = String(file?.primaryType ?? '');
    if (/Transfer/i.test(primary) || /operator_fee/.test(String(file?.message?.purpose ?? ''))) no('B14', `the file is a ${primary} message: the signer signs no transfer but a deal's funding to the escrow's collector, and the operator fee is 0 tUSDC`);
    const id = this.#termsShape(t);
    saw({ commitmentId: id, seller: lc(t.seller), payoutAddress: lc(t.sellerPayoutAddress), total: null });
    const r = this.#rules.buying;
    const m = await this.#mandate(now);
    // B12: the deal is on the pinned chain and token.
    for (const [name, v] of [['price.token', t.price.token], ['settlement.token', t.settlement.token], ['adjudication.fee.token', t.adjudication.fee.token]] as const) if (!sameToken(v, this.#pin.token.id)) no('B12', `${name} is ${printable(JSON.stringify(v))}, and the pinned token is ${this.#pin.token.id}`);
    // The float pays, and refunds return to it.
    if (lc(t.buyerPaymentAddress) !== this.floatAddress) no('B5', `the terms name ${t.buyerPaymentAddress} as the payment address, not the float ${this.floatAddress}`);
    // B5: a listed seller, with its own payout address.
    const seller = r.sellers.find((s: J) => s.seller === lc(t.seller));
    if (!seller) no('B5', `the seller ${lc(t.seller)} is not on the list`);
    if (lc(t.sellerPayoutAddress) !== seller.payoutAddress) no('B5', `the payout address ${lc(t.sellerPayoutAddress)} is not the listed seller's ${seller.payoutAddress}`);
    // B7: the three reviewers, the policy, the registry and the fee.
    const a = t.adjudication, rv = r.reviewers;
    for (const k of ['adjudicator', 'fallbackAdjudicator', 'appealAdjudicator', 'policyHash', 'registryHash'] as const) if (lc(a[k]) !== rv[k]) no('B7', `adjudication.${k} is ${lc(a[k])}, not the pinned ${rv[k]}`);
    if (a.policyId !== rv.policyId) no('B7', `adjudication.policyId is ${JSON.stringify(a.policyId)}, not the pinned ${JSON.stringify(rv.policyId)}`);
    if (amount(a.fee.amount, 'adjudication.fee.amount') !== BigInt(rv.fee)) no('B7', `the adjudication fee is ${a.fee.amount} base units, not the pinned ${rv.fee}`);
    // B6: the club, the product, the checks with no rubric, and every other term.
    const tm = r.terms;
    if (t.clubId !== r.clubId || lc(t.rulebookHash) !== r.rulebookHash) no('B6', `the deal is in club ${t.clubId} with rulebook ${t.rulebookHash}, not the pinned ${r.clubId} ${r.rulebookHash}`);
    if (t.schemaVersion !== tm.schemaVersion) no('B6', `schemaVersion is ${t.schemaVersion}, not ${tm.schemaVersion}`);
    if (!seller.deliverableHashes.includes(jcsHash(t.deliverable))) no('B6', `the deliverable hashes to ${jcsHash(t.deliverable)}, which is not a product this seller is listed for`);
    if (Array.isArray(t.acceptance?.rubric?.criteria) ? t.acceptance.rubric.criteria.length > 0 : t.acceptance?.rubric !== undefined) no('B6', 'the acceptance has a rubric: the signer pays for checked work only');
    if (jcsHash(t.acceptance) !== seller.acceptanceHash) no('B6', `the acceptance hashes to ${jcsHash(t.acceptance)}, not the listed checks ${seller.acceptanceHash}: a check was changed, added or removed`);
    const same: Array<[string, J, J]> = [['settlement.mode', t.settlement.mode, tm.settlementMode], ['remedy.onReject', t.remedy.onReject, tm.onReject], ['disclosure.level', t.disclosure.level, tm.disclosure], ['timing.maxSubmissions', t.timing.maxSubmissions, tm.maxSubmissions], ['timing.appealWindowSec', t.timing.appealWindowSec, tm.appealWindowSec], ['timing.appealDecideSec', t.timing.appealDecideSec, tm.appealDecideSec]];
    for (const [name, got, want] of same) if (got !== want) no('B6', `${name} is ${JSON.stringify(got)}, not ${JSON.stringify(want)}`);
    // B8: every deadline inside its window, in order, and the dates against the signer's own clock.
    const w = r.windows, at = (k: string) => ms(t.timing[k], `timing.${k}`), created = ms(t.createdAt, 'createdAt');
    const steps: Array<[string, number, number, number]> = [['offerExpiresAt', at('offerExpiresAt'), created, w.offerExpiresInSec], ['fundBy', at('fundBy'), created, w.fundWithinSec], ['deliverBy', at('deliverBy'), created, w.deliverWithinSec], ['judgeBy', at('judgeBy'), at('deliverBy'), w.judgeWithinSec], ['fallbackBy', at('fallbackBy'), at('judgeBy'), w.fallbackWithinSec]];
    for (const [name, v, from, most] of steps) {
      if (v < from) no('B8', `timing.${name} ${iso(v)} comes before the deadline it follows`);
      if (v - from > most * 1000) no('B8', `timing.${name} is ${(v - from) / 1000} s after the one before, above the ${most} s the rules allow`);
    }
    if (at('offerExpiresAt') > at('fundBy')) no('B8', 'the offer expires after its funding deadline');
    if (created > now + r.clockSkewSec * 1000) no('B8', `createdAt ${t.createdAt} is ${(created - now) / 1000} s ahead of the signer's clock, above ${r.clockSkewSec} s`);
    if (now >= at('offerExpiresAt')) no('B8', `the offer expired at ${t.timing.offerExpiresAt} by the signer's clock (${iso(now)})`);
    // B3: the deal's total, at most the rules' limit and the mandate's cap.
    const total = amount(t.price.amount, 'price.amount') + BigInt(rv.fee);
    saw({ total: total.toString() });
    if (total > BigInt(r.maxPerDeal)) no('B3', `the deal's total is ${total} base units, above the ${r.maxPerDeal} a deal the rules allow with no person`);
    if (total > BigInt(m.scope.maxPerCommitment.amount)) no('B3', `the deal's total is ${total} base units, above the mandate's ${m.scope.maxPerCommitment.amount} a deal`);
    // B9 and B4: the signer's own ledger. A payment for a deal it signed before counts once.
    const known = this.#ledger.entries.find((e) => e.commitmentId === id);
    // B13: one deal key, one deal. A key the signer certified for another deal is not certified again.
    const reused = this.#ledger.entries.find((e) => e.dealKey === lc(t.buyer) && e.commitmentId !== id);
    if (reused) no('B13', `the deal key ${lc(t.buyer)} was certified for deal ${reused.commitmentId}: one deal key serves one deal`);
    await this.#refresh(now);
    if (!known) {
      const open = this.#ledger.entries.filter((e) => !e.ended), openTotal = open.reduce((s, e) => s + BigInt(e.total), 0n);
      if (open.length + 1 > r.maxOpenDeals) no('B9', `${open.length} deals are open, and the rules allow ${r.maxOpenDeals} at once`);
      if (openTotal + total > BigInt(r.maxOpenTotal)) no('B9', `the open deals hold ${openTotal} base units; with ${total} more that is above ${r.maxOpenTotal}`);
      const day = iso(now).slice(0, 10), today = this.#ledger.entries.filter((e) => e.day === day).reduce((s, e) => s + BigInt(e.total), 0n);
      if (today + total > BigInt(r.maxPerDay)) no('B4', `${today} base units are signed today (UTC ${day}); with ${total} more that is above the ${r.maxPerDay} a day the rules allow with no person`);
      if (today + total > BigInt(m.scope.maxDaily.amount)) no('B4', `today's totals would pass the mandate's ${m.scope.maxDaily.amount} a day`);
    }
    // B2: the file is exactly the funding these terms give on the pinned layer, from the float, to the collector.
    const checked = checkPaymentFile(file, t, { kind: 'funding', domain: this.#pin.domain, chain: this.#pin.chain, buyer: lc(t.buyer), token: this.#pin.token });
    // The float signs the digest checkPaymentFile rebuilt from the terms and the pin: exactly what was checked.
    const funding = await this.#float.sign({ hash: checked.digest });
    // B13: a delegation to the deal's key, only beside this payment, capped at its price, ending with its offer.
    // A repeat gets the one it got first.
    let delegation: J = known?.delegation;
    if (!delegation) {
      const d = buildDelegation({ principal: m.principal, agent: r.standingKey, dealKey: t.buyer, dealEncryptionKey: t.buyerEncryptionPublicKey, clubId: r.clubId, role: 'buyer', cap: t.price.amount, token: this.#pin.token.id, expiresAt: t.timing.offerExpiresAt });
      delegation = { ...d, signature: await signTypedData({ privateKey: this.#buyingKey, ...mandateTyped('Delegation', d, this.#pin.domain) }) };
    }
    if (!known) {
      const margin = this.#pin.chain?.expiryMarginSec ?? SIMCHAIN_EXPIRY_MARGIN_SEC;
      const entry: Entry = { commitmentId: id, total: total.toString(), signedAt: iso(now), day: iso(now).slice(0, 10), seller: lc(t.seller), payoutAddress: lc(t.sellerPayoutAddress), dealKey: lc(t.buyer), delegation, fundBy: t.timing.fundBy, endsBy: iso(Date.parse(t.timing.fallbackBy) + (t.timing.appealDecideSec + margin) * 1000) };
      this.#ledger = { version: 1, entries: [...this.#ledger.entries, entry] };
      writeDurably(join(this.#o.statePath, 'ledger.json'), `${JSON.stringify(this.#ledger, null, 2)}\n`); // the count is on disk before the signature leaves
    }
    saw({ digest: checked.digest, replay: Boolean(known) });
    this.#writeStatus();
    return { commitmentId: id, funding, digest: checked.digest, summary: checked.summary, delegation, ledger: this.#counts(now) };
  }

  /**
   * The selling half (T-443): an offer Crow's selling agent asks the signer to sign, checked against the rules'
   * `selling` template field by field (S2 to S5, X2, the mandate) and counted before the signature leaves.
   */
  async #signOffer(req: J, now: number, saw: (x: J) => void): Promise<J> {
    // X2: no new offer after the stop; X4: the rules as started.
    try {
      this.#flag();
    } catch (e) {
      if (e instanceof Refused) no('X2', `${e.message}: no new offer is signed`);
      throw e;
    }
    this.#rulesUnchanged();
    const extra = Object.keys(req).filter((k) => !['kind', 'terms'].includes(k));
    if (extra.length || !req.terms) no('request', `an offer request holds exactly kind and terms${extra.length ? `, not ${extra.join(', ')}` : ''}`);
    const t = req.terms, r = this.#rules.selling;
    const id = this.#termsShape(t);
    saw({ kind: 'offer', commitmentId: id, buyer: lc(t.buyer), price: t.price?.amount });
    const m = await this.#mandate(now, 'selling');
    if (lc(t.seller) !== r.sellingKey) no('S4', `the offer names the seller ${lc(t.seller)}, not Crow's selling key ${r.sellingKey}`);
    if (lc(t.sellerPayoutAddress) !== r.payoutAddress) no('S2', `the offer pays ${lc(t.sellerPayoutAddress)}, not Crow's payout address ${r.payoutAddress}`);
    for (const [name, v] of [['price.token', t.price.token], ['settlement.token', t.settlement.token], ['adjudication.fee.token', t.adjudication.fee.token]] as const) if (!sameToken(v, this.#pin.token.id)) no('B12', `${name} is ${printable(JSON.stringify(v))}, and the pinned token is ${this.#pin.token.id}`);
    if (t.price.amount !== r.price) no('S3', `the offer's price is ${printable(String(t.price.amount))} base units, not Crow's ${r.price}`);
    const a = t.adjudication, rv = r.reviewers;
    for (const k of ['adjudicator', 'fallbackAdjudicator', 'appealAdjudicator', 'policyHash', 'registryHash'] as const) if (lc(a[k]) !== rv[k]) no('S4', `adjudication.${k} is ${lc(a[k])}, not the pinned ${rv[k]}`);
    if (a.policyId !== rv.policyId || a.fee.amount !== rv.fee) no('S4', 'the adjudication policy or fee is not the pinned one');
    if (t.clubId !== r.clubId || lc(t.rulebookHash) !== r.rulebookHash) no('S4', `the offer is in club ${printable(String(t.clubId))} with another rulebook than the pinned ${r.clubId}`);
    const tm = r.terms;
    const same: Array<[string, J, J]> = [['schemaVersion', t.schemaVersion, tm.schemaVersion], ['settlement.mode', t.settlement.mode, tm.settlementMode], ['remedy.onReject', t.remedy.onReject, tm.onReject], ['disclosure.level', t.disclosure.level, tm.disclosure], ['timing.maxSubmissions', t.timing.maxSubmissions, tm.maxSubmissions], ['timing.appealWindowSec', t.timing.appealWindowSec, tm.appealWindowSec], ['timing.appealDecideSec', t.timing.appealDecideSec, tm.appealDecideSec]];
    for (const [name, got, want] of same) if (got !== want) no('S4', `${name} is ${printable(JSON.stringify(got))}, not ${JSON.stringify(want)}`);
    // S4: the product: one of Crow's, the deal it names the same in the deliverable and the checks.
    const product = r.products.find((p: J) => {
      const bound: { id?: string } = {};
      return matchesTemplate(p.deliverable, t.deliverable, bound) && matchesTemplate(p.acceptance, t.acceptance, bound);
    });
    if (!product) no('S4', 'the deliverable and the checks are not one of Crow\'s products: a field, a check or the text differs from the template');
    // S4: each window exactly, and the dates against the signer's own clock.
    const w = r.windows, at = (k: string) => ms(t.timing[k], `timing.${k}`), created = ms(t.createdAt, 'createdAt');
    const steps: Array<[string, number, number, number]> = [['offerExpiresAt', at('offerExpiresAt'), created, w.offerExpiresInSec], ['fundBy', at('fundBy'), created, w.fundWithinSec], ['deliverBy', at('deliverBy'), created, w.deliverWithinSec], ['judgeBy', at('judgeBy'), at('deliverBy'), w.judgeWithinSec], ['fallbackBy', at('fallbackBy'), at('judgeBy'), w.fallbackWithinSec]];
    for (const [name, v, from, want] of steps) if (v - from !== want * 1000) no('S4', `timing.${name} is ${(v - from) / 1000} s after the one before, not Crow's ${want} s`);
    if (Math.abs(created - now) > r.clockSkewSec * 1000) no('S4', `createdAt ${t.createdAt} is ${Math.round((created - now) / 1000)} s from the signer's clock, more than ${r.clockSkewSec} s`);
    if (now >= at('offerExpiresAt')) no('S4', `the offer expired at ${t.timing.offerExpiresAt} by the signer's clock`);
    if (BigInt(t.price.amount) > BigInt(m.scope.maxPerCommitment.amount)) no('S3', `the price is above the selling mandate's ${m.scope.maxPerCommitment.amount} a deal`);
    // S5: the signer's own counts. An offer asked for again is counted once.
    const sales = this.#ledger.sales ?? [];
    const known = sales.find((x) => x.commitmentId === id);
    await this.#refresh(now);
    if (!known) {
      const hour = sales.filter((x) => Date.parse(x.signedAt) > now - 3_600_000).length;
      if (hour + 1 > r.maxOffersPerHour) no('S5', `${hour} offers were signed in the last 3,600 s, and the rules allow ${r.maxOffersPerHour}`);
      const open = sales.filter((x) => !x.ended).length;
      if (open + 1 > r.maxOpenDeals) no('S5', `${open} sales are open, and the rules allow ${r.maxOpenDeals} at once`);
      const day = iso(now).slice(0, 10), today = sales.filter((x) => x.day === day).length;
      if (today + 1 > r.maxDealsPerDay) no('S5', `${today} offers were signed today (UTC ${day}), and the rules allow ${r.maxDealsPerDay}`);
    }
    const signature = await this.#selling!.signTypedData(typedOf('CommitmentTerms', t, this.#pin.domain));
    if (!known) {
      const margin = this.#pin.chain?.expiryMarginSec ?? SIMCHAIN_EXPIRY_MARGIN_SEC;
      const sale: Sale = { commitmentId: id, signedAt: iso(now), day: iso(now).slice(0, 10), buyer: lc(t.buyer), price: t.price.amount, fundBy: t.timing.fundBy, endsBy: iso(Date.parse(t.timing.fallbackBy) + (t.timing.appealDecideSec + margin) * 1000) };
      this.#ledger = { ...this.#ledger, sales: [...sales, sale] };
      writeDurably(join(this.#o.statePath, 'ledger.json'), `${JSON.stringify(this.#ledger, null, 2)}\n`);
    }
    saw({ replay: Boolean(known) });
    this.#writeStatus();
    return { commitmentId: id, signature, sales: this.#salesCounts(now) };
  }

  /**
   * S6: one delivery per funded deal, ever, stopped or not: only for a deal this signer offered, only when every read
   * endpoint says it is funded and not yet delivered, sealed to the deal's four recipients, and only for work that passes
   * the deal's own checks (the adjudicator's stage 1). The stop and the mandate do not apply: they act at the offer.
   */
  async #signDelivery(req: J, now: number, saw: (x: J) => void): Promise<J> {
    this.#rulesUnchanged();
    const extra = Object.keys(req).filter((k) => !['kind', 'terms', 'file', 'plaintext'].includes(k));
    if (extra.length || !req.terms || !req.file || typeof req.plaintext !== 'string') no('request', `a delivery request holds exactly kind, terms, file and plaintext${extra.length ? `, not ${extra.join(', ')}` : ''}`);
    const t = req.terms;
    const id = this.#termsShape(t);
    saw({ kind: 'delivery', commitmentId: id });
    const sale = (this.#ledger.sales ?? []).find((x) => x.commitmentId === id);
    if (!sale) no('S6', `this signer never offered deal ${id}: it delivers only its own`);
    if (sale!.delivered) no('S6', `deal ${id} was delivered once, at ${sale!.delivered.at}: one delivery per deal, ever`);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(req.plaintext) || req.plaintext.length % 4 !== 0) no('request', 'plaintext is not base64');
    const bytes = new Uint8Array(Buffer.from(req.plaintext, 'base64'));
    // Funded, by every read the rules name: a doubt refuses (the adapter tries again on its next pass).
    const states = await Promise.all(this.#rules.reads.operators.map((op: string) => readState(op, id)));
    if (!states.every((x) => x === 'Held')) no('S6', `deal ${id} is not funded and waiting for its delivery by every read (${states.map((x) => x ?? 'no answer').join(', ')})`);
    // The message: exactly one delivery of these terms, of these bytes, to the deal's four recipients.
    try {
      strictTypedDataFile(req.file);
    } catch (e) {
      return no('S6', `the delivery file is not one EIP-712 message: ${(e as Error).message}`);
    }
    const f = req.file, msg = f.message ?? {};
    const lower = (d: J) => jcs({ ...d, verifyingContract: String(d?.verifyingContract).toLowerCase() });
    if (f.primaryType !== 'Delivery') no('S6', `the file signs a ${printable(String(f.primaryType))}, not a Delivery`);
    if (lower(f.domain) !== lower(this.#pin.domain)) no('B12', 'the delivery is for another domain than the pinned one');
    if (lc(msg.commitmentId) !== id) no('S6', `the delivery is for deal ${printable(String(msg.commitmentId))}, not ${id}`);
    if (String(msg.attempt) !== '1') no('S6', `the delivery is attempt ${printable(String(msg.attempt))}; Crow's deals take one`);
    const sha = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (msg.plaintextSha256 !== sha) no('S6', `the delivery names plaintextSha256 ${printable(String(msg.plaintextSha256))}, and the work hashes to ${sha}`);
    if (msg.plaintextMime !== t.deliverable.format) no('S6', `the delivery declares ${printable(String(msg.plaintextMime))}, and the terms agree ${t.deliverable.format}`);
    const want = [t.adjudication.adjudicator, t.adjudication.fallbackAdjudicator, t.adjudication.appealAdjudicator, t.buyer].map(lc);
    const got = Array.isArray(msg.encryptedKeys) ? msg.encryptedKeys.map((k: J) => lc(k?.recipient)) : [];
    if (jcs(got) !== jcs(want)) no('S6', 'the delivery is not sealed to the deal\'s three adjudicators and its buyer, in that order');
    const submitted = Number(msg.submittedAt) * 1000;
    if (!Number.isFinite(submitted) || Math.abs(submitted - now) > this.#rules.selling.clockSkewSec * 1000) no('S6', 'the delivery\'s submittedAt is not the signer\'s now');
    // The deal's own checks, as the adjudicator's first stage runs them on these exact bytes.
    const pre = preflightDelivery({ plaintext: bytes, mime: t.deliverable.format, format: t.deliverable.format, acceptance: t.acceptance });
    if (pre.result !== 'accept') no('S6', `the work does not pass the deal's checks: stage 1 says ${pre.result}${pre.refused ? ` (${pre.refused.code})` : ''}${pre.deterministic.filter((o) => !o.passed).map((o) => `, ${o.checkId} fails`).join('')}`);
    const digest = digestOfFile(f);
    const signature = await this.#selling!.sign({ hash: digest });
    sale!.delivered = { at: iso(now), digest };
    writeDurably(join(this.#o.statePath, 'ledger.json'), `${JSON.stringify(this.#ledger, null, 2)}\n`); // before the signature leaves
    saw({ digest, bytes: bytes.length });
    this.#writeStatus();
    return { commitmentId: id, signature, digest };
  }

  #salesCounts(now: number) {
    const sales = this.#ledger.sales ?? [], day = iso(now).slice(0, 10);
    return { offersLastHour: sales.filter((x) => Date.parse(x.signedAt) > now - 3_600_000).length, salesOpen: sales.filter((x) => !x.ended).length, offersToday: sales.filter((x) => x.day === day).length, delivered: sales.filter((x) => x.delivered).length };
  }

  /** X1 and X4: the stop flag reads exactly "run", and the rules file is the one the signer started with. */
  #running(): void {
    this.#flag();
    this.#rulesUnchanged();
  }
  /** X1: the stop flag reads exactly "run". */
  #flag(): void {
    let flag: string;
    try {
      flag = readFileSync(this.#o.flagPath, 'utf8');
    } catch {
      return no('X1', `the stop flag ${this.#o.flagPath} cannot be read: the signer is stopped`);
    }
    if (flag !== 'run' && flag !== 'run\n') no('X1', 'the signer is stopped: its flag does not read exactly "run"');
  }
  /** X4: the rules file is the one the signer started with. */
  #rulesUnchanged(): void {
    let now: Buffer;
    try {
      now = readFileSync(this.#o.rulesPath);
    } catch {
      return no('X4', 'the rules file cannot be read: the signer refuses until it is restarted');
    }
    if (!now.equals(this.#rulesBytes)) no('X4', 'the rules file changed since the signer started: it refuses until its administrator restarts it');
  }

  /** The principal's mandate for the standing key (or the selling key): signed, live, for this club and role, and not revoked. */
  async #mandate(now: number, side: 'buying' | 'selling' = 'buying'): Promise<J> {
    const r = side === 'buying' ? this.#rules.buying : { ...this.#rules.selling, standingKey: this.#rules.selling.sellingKey, revocationsPath: this.#rules.buying.revocationsPath };
    const role = side === 'buying' ? 'buyer' : 'seller';
    let doc: J;
    try {
      doc = parseStrictJson(readFileSync(resolve(dirname(this.#o.rulesPath), r.mandatePath), 'utf8'), r.mandatePath);
    } catch {
      return no('mandate', `the mandate ${r.mandatePath} cannot be read`);
    }
    let v;
    try {
      v = await verifyDocument('Mandate', doc, this.#pin.domain, { at: now, principal: r.principal });
    } catch (e) {
      return no('mandate', `the mandate does not hold: ${(e as Error).message}`);
    }
    const m = v.document;
    if (lc(m.agent) !== r.standingKey) no('mandate', `the mandate is for ${m.agent}, not the ${side === 'buying' ? 'standing' : 'selling'} key ${r.standingKey}`);
    if (m.clubId !== r.clubId || !m.scope.roles.includes(role)) no('mandate', `the mandate does not allow the ${role} role in the pinned club`);
    if (lc(m.scope.maxPerCommitment.token) !== lc(this.#pin.token.id)) no('mandate', 'the mandate caps another token');
    const folder = revocationsFolder(this.#o.rulesPath, this.#rules);
    let names: string[];
    try {
      names = readdirSync(folder).filter((n) => n.endsWith('.json'));
    } catch {
      return no('mandate', `the revocations folder ${r.revocationsPath} cannot be read`);
    }
    for (const n of names) {
      // Every file must be a revocation this signer can read: as its document, or as mandate.ts verify prints it.
      let rev: J;
      try {
        const x = parseStrictJson(readFileSync(join(folder, n), 'utf8'), n);
        rev = x && typeof x === 'object' && x.ok === true && x.kind === 'AgentRevocation' ? x.document : x;
      } catch {
        return no('mandate', `the revocation ${n} cannot be read: the signer refuses until it can`);
      }
      const shaped = rev && typeof rev === 'object' && !Array.isArray(rev) && rev.type === 'AgentRevocation' && typeof rev.principal === 'string' && typeof rev.agent === 'string' && typeof rev.expiresAt === 'string' && Number.isFinite(Date.parse(rev.expiresAt));
      if (!shaped) no('mandate', `${n} in the revocations folder is not a signed AgentRevocation document: the signer refuses until its administrator fixes or removes it`);
      // One that names another principal or agent ends nothing here (ADR-0038 section 4), nor one whose own end has
      // passed. One that names this mandate and does not verify is a doubt, and a doubt refuses.
      if (lc(rev.principal) !== lc(m.principal) || lc(rev.agent) !== lc(m.agent)) continue;
      if (!(now < Date.parse(rev.expiresAt))) continue;
      try {
        await verifyDocument('AgentRevocation', rev, this.#pin.domain, { at: now, mandate: doc, principal: r.principal });
      } catch (e) {
        return no('mandate', `the revocation ${n} names this mandate and does not verify (${(e as Error).message}): the signer refuses until its administrator removes it`);
      }
      no('mandate', `the principal revoked the mandate (${n}): nothing is signed`);
    }
    return { ...m, digest: v.digest };
  }

  /** The terms are public terms, field for field; returns their commitment ID. */
  #termsShape(t: J): string {
    if (!t || typeof t !== 'object' || Array.isArray(t)) return no('request', 'the terms are not an object');
    const keys = Object.keys(t).filter((k) => k !== 'id');
    const extra = keys.filter((k) => !TERMS_KEYS.includes(k)), missing = TERMS_KEYS.filter((k) => !Object.hasOwn(t, k));
    if (extra.length || missing.length) no('B6', `the terms ${extra.length ? `hold fields public terms do not: ${extra.join(', ')}` : `lack ${missing.join(', ')}`}`);
    if (!t.timing || Object.keys(t.timing).some((k) => !TIMING_KEYS.includes(k)) || TIMING_KEYS.some((k) => !Object.hasOwn(t.timing, k))) no('B6', `timing holds exactly ${TIMING_KEYS.join(', ')}`);
    if (!t.adjudication || Object.keys(t.adjudication).some((k) => !ADJUDICATION_KEYS.includes(k)) || ADJUDICATION_KEYS.some((k) => !Object.hasOwn(t.adjudication, k))) no('B7', `adjudication holds exactly ${ADJUDICATION_KEYS.join(', ')}`);
    // Every field has its type before anything is hashed: a list or a number where a string goes hashes as something else.
    const type = (v: J, want: 'string' | 'address' | 'hex32' | 'time' | 'amount' | 'uint', name: string) => {
      const ok =
        want === 'uint' ? Number.isSafeInteger(v) && v >= 0
        : typeof v === 'string' && (want === 'string' ? v.length > 0 && v.length <= 256 : want === 'address' ? /^0x[0-9a-fA-F]{40}$/.test(v) : want === 'hex32' ? /^0x[0-9a-f]{64}$/.test(v) : want === 'time' ? TIME.test(v) : DEC.test(v));
      if (!ok) no('request', `${name} is not ${want === 'uint' ? 'a whole number' : `a ${want}`}`);
    };
    const exact = (v: J, keys: string[], name: string) => {
      if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== keys.length || keys.some((k) => !Object.hasOwn(v, k))) no('request', `${name} holds exactly ${keys.join(', ')}`);
    };
    for (const k of ['buyer', 'seller', 'buyerPaymentAddress', 'sellerPayoutAddress']) type(t[k], 'address', k);
    for (const k of ['schemaVersion', 'clubId', 'buyerEncryptionPublicKey']) type(t[k], 'string', k);
    for (const k of ['rulebookHash', 'nonce']) type(t[k], 'hex32', k);
    type(t.createdAt, 'time', 'createdAt');
    for (const [v, name] of [[t.price, 'price'], [t.adjudication.fee, 'adjudication.fee']] as const) {
      exact(v, ['token', 'amount'], name);
      type(v.token, 'string', `${name}.token`);
      type(v.amount, 'amount', `${name}.amount`);
    }
    for (const k of ['adjudicator', 'fallbackAdjudicator', 'appealAdjudicator']) type(t.adjudication[k], 'address', `adjudication.${k}`);
    for (const k of ['registryHash', 'policyHash']) type(t.adjudication[k], 'hex32', `adjudication.${k}`);
    type(t.adjudication.policyId, 'string', 'adjudication.policyId');
    for (const k of ['offerExpiresAt', 'fundBy', 'deliverBy', 'judgeBy', 'fallbackBy']) type(t.timing[k], 'time', `timing.${k}`);
    for (const k of ['appealWindowSec', 'appealDecideSec', 'maxSubmissions']) type(t.timing[k], 'uint', `timing.${k}`);
    exact(t.settlement, ['mode', 'token'], 'settlement');
    type(t.settlement.mode, 'string', 'settlement.mode');
    type(t.settlement.token, 'string', 'settlement.token');
    exact(t.remedy, ['onReject'], 'remedy');
    type(t.remedy.onReject, 'string', 'remedy.onReject');
    exact(t.disclosure, ['level'], 'disclosure');
    type(t.disclosure.level, 'string', 'disclosure.level');
    for (const k of ['deliverable', 'acceptance']) if (!t[k] || typeof t[k] !== 'object' || Array.isArray(t[k])) no('request', `${k} is not an object`);
    let id: string;
    try {
      id = commitmentIdOf(t);
    } catch {
      return no('request', 'the terms do not encode as CommitmentTerms');
    }
    if (t.id !== undefined && lc(t.id) !== id) no('request', `the terms name the commitment ID ${t.id}, and they hash to ${id}`);
    return id;
  }

  /** Marks the ledger's open deals that have ended, from the signer's own reads; any doubt keeps a deal open. */
  async #refresh(now: number): Promise<void> {
    let changed = false;
    for (const e of [...this.#ledger.entries, ...(this.#ledger.sales ?? [])].filter((x) => !x.ended)) {
      if (now >= Date.parse(e.endsBy)) {
        Object.assign(e, { ended: 'past its last deadline', endedAt: iso(now) });
        changed = true;
        continue;
      }
      const states = await Promise.all(this.#rules.reads.operators.map((op: string) => readState(op, e.commitmentId)));
      if (states.some((s) => s === null)) continue;
      if (states.every((s) => ENDED.includes(s!))) Object.assign(e, { ended: states[0], endedAt: iso(now) });
      // Never funded: only once the reads have had time to see a funding sent just before fundBy (reads.lagSec), and
      // the clocks may differ (clockSkewSec). Until then the deal stays open.
      else if (now >= Date.parse(e.fundBy) + (this.#rules.reads.lagSec + this.#rules.buying.clockSkewSec) * 1000 && states.every((s) => UNFUNDED.includes(s!))) Object.assign(e, { ended: 'never funded', endedAt: iso(now) });
      else continue;
      changed = true;
    }
    if (changed) writeDurably(join(this.#o.statePath, 'ledger.json'), `${JSON.stringify(this.#ledger, null, 2)}\n`);
  }

  #counts(now: number) {
    const day = iso(now).slice(0, 10), today = this.#ledger.entries.filter((e) => e.day === day), open = this.#ledger.entries.filter((e) => !e.ended);
    return { day, signedToday: today.reduce((s, e) => s + BigInt(e.total), 0n).toString(), dealsToday: today.length, dealsOpen: open.length, openHoldsTotal: open.reduce((s, e) => s + BigInt(e.total), 0n).toString() };
  }

  /** The public status: values only, no key. A value the signer does not know is left out. */
  status(): J {
    const now = this.#now(), r = this.#rules.buying;
    let state = 'running', stoppedSince: string | undefined;
    try {
      this.#running();
    } catch (e) {
      state = 'stopped';
      try {
        stoppedSince = iso(statSync(this.#o.flagPath).mtimeMs);
      } catch {
        // an unreadable flag has no time
      }
      if (e instanceof Refused && e.rule === 'X4') state = 'stopped: rules changed';
    }
    let mandate: J = {};
    try {
      const doc = JSON.parse(readFileSync(resolve(dirname(this.#o.rulesPath), r.mandatePath), 'utf8'));
      mandate = { principal: lc(doc.principal), mandateExpiresAt: doc.scope?.expiresAt };
      if (state === 'running' && !(now < Date.parse(doc.scope?.expiresAt))) state = 'mandate expired';
    } catch {
      // missing shows as missing
    }
    const last = this.#ledger.entries.at(-1), day = iso(now).slice(0, 10);
    return {
      agent: 'buying', state, ...(stoppedSince ? { stoppedSince } : {}), ...mandate,
      constraintsVersion: this.#rules.constraintsVersion, rulesSha256: this.#rulesSha256,
      floatAddress: this.floatAddress, standingKey: r.standingKey,
      ...(this.#selling ? { sellingAddress: this.#selling.address.toLowerCase(), selling: { ...this.#salesCounts(now), offersPerHourLimit: this.#rules.selling.maxOffersPerHour, openDealsLimit: this.#rules.selling.maxOpenDeals, dealsPerDayLimit: this.#rules.selling.maxDealsPerDay, price: this.#rules.selling.price, payoutAddress: this.#rules.selling.payoutAddress } } : {}),
      dayLimit: r.maxPerDay, dealLimit: r.maxPerDeal, openDealsLimit: r.maxOpenDeals, openTotalLimit: r.maxOpenTotal,
      ...this.#counts(now),
      ...(last ? { lastDeal: { commitmentId: last.commitmentId, signedAt: last.signedAt, ...(last.ended ? { ended: last.ended, endedAt: last.endedAt } : {}) } } : {}),
      refusalsToday: Object.fromEntries(Object.entries(this.#refusals).filter(([, v]) => v.day === day).map(([k, v]) => [k, v.count])),
      updatedAt: iso(now),
    };
  }

  #writeStatus(): void {
    writeDurably(join(this.#o.statePath, 'status.json'), `${JSON.stringify(this.status(), null, 2)}\n`);
  }
  #writeStatusQuietly(): void {
    try {
      this.#writeStatus();
    } catch {
      // the status is a view; the decision log and the ledger are the record
    }
  }

  /** One line per decision in decisions.jsonl, flushed to disk before the answer leaves. */
  #log(now: number, x: J): void {
    const path = join(this.#o.statePath, 'decisions.jsonl');
    appendFileSync(path, `${JSON.stringify({ at: iso(now), ...x })}\n`, { mode: 0o600 });
    const fd = openSync(path, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
}

/** One operator's escrowState for a deal, or null when it does not answer plainly in time. */
async function readState(operator: string, id: string): Promise<string | null> {
  try {
    const res = await fetch(`${operator.replace(/\/$/, '')}/v1/commitments/${id}`, { signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
    if (!res.ok) return null;
    const s = ((await res.json()) as J)?.escrowState;
    return typeof s === 'string' ? s : null;
  } catch {
    return null;
  }
}

/** Serves the signer over HTTP on `host:port`. Bodies above MAX_BODY_BYTES are refused unread. */
export async function serve(signer: Signer, host = '127.0.0.1', port = 8547): Promise<{ url: string; server: Server }> {
  const read = async (req: IncomingMessage): Promise<string | null> => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > MAX_BODY_BYTES) return null;
      chunks.push(c as Buffer);
    }
    return Buffer.concat(chunks).toString('utf8');
  };
  const server = createServer(async (req, res) => {
    let out: { status: number; body: J };
    try {
      const body = await read(req);
      out = body === null ? { status: 413, body: { type: 'refused', rule: 'request', detail: `the request is above ${MAX_BODY_BYTES} bytes` } } : await signer.handle(req.method ?? '', (req.url ?? '').split('?')[0]!, body);
    } catch {
      out = { status: 500, body: { type: 'refused', rule: 'error', detail: 'the signer failed and signed nothing' } };
    }
    res.writeHead(out.status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(out.body));
  });
  await new Promise<void>((ok) => server.listen(port, host, ok));
  const a = server.address() as AddressInfo;
  return { url: `http://${a.family === 'IPv6' ? `[${a.address}]` : a.address}:${a.port}`, server };
}

const USAGE = `node examples/signer.ts init --state <dir>
node examples/signer.ts serve --rules <file> --state <dir> --flag <file> [--listen <host:port>]
node examples/signer.ts check-rules <file>
node examples/signer.ts stop --flag <file>
node examples/signer.ts run --flag <file>
Keys come from CROW_SIGNER_FLOAT_KEY, CROW_SIGNER_BUYING_KEY and, with a selling half, CROW_SIGNER_SELLING_KEY in the signer's own environment.`;

async function main(argv: string[]): Promise<number> {
  const args = [...argv];
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args.splice(i, 2)[1];
  };
  const rulesPath = flag('--rules'), statePath = flag('--state'), flagPath = flag('--flag'), listen = flag('--listen');
  const [command, extra] = args;
  if (command === 'check-rules' && extra && args.length === 2) {
    const { rules, sha256 } = loadRules(extra);
    console.log(JSON.stringify({ ok: true, sha256, constraintsVersion: rules.constraintsVersion, floatAddress: rules.floatAddress }));
    return 0;
  }
  if (command === 'init' && statePath && args.length === 1) {
    mkdirSync(statePath, { recursive: true, mode: 0o700 });
    const ledger = join(statePath, 'ledger.json');
    if (existsSync(ledger)) throw new Refused('init', `${ledger} exists: init makes a new ledger once, and never over an old one`);
    writeDurably(ledger, `${JSON.stringify({ version: 1, entries: [], sales: [] }, null, 2)}\n`);
    console.error(`A new, empty ledger at ${ledger}.`);
    return 0;
  }
  if ((command === 'stop' || command === 'run') && flagPath && args.length === 1) {
    writeDurably(flagPath, `${command}\n`);
    console.error(command === 'stop' ? `Stopped: ${flagPath} reads "stop". Nothing new is signed. A payment signed before can still fund: on a chain until its offer expires, on SimChain until its fundBy.` : `Running: ${flagPath} reads "run".`);
    return 0;
  }
  if (command === 'serve' && rulesPath && statePath && flagPath && args.length === 1) {
    const keys = { float: process.env['CROW_SIGNER_FLOAT_KEY'] ?? '', buying: process.env['CROW_SIGNER_BUYING_KEY'] ?? '', selling: process.env['CROW_SIGNER_SELLING_KEY'] || undefined };
    delete process.env['CROW_SIGNER_FLOAT_KEY'];
    delete process.env['CROW_SIGNER_BUYING_KEY'];
    delete process.env['CROW_SIGNER_SELLING_KEY'];
    const signer = await Signer.open({ rulesPath, statePath, flagPath, keys });
    const m = /^(.+):([0-9]{1,5})$/.exec(listen ?? '127.0.0.1:8547');
    if (!m) throw new Error('--listen takes <host:port>');
    const { url } = await serve(signer, m[1]!.replace(/^\[|\]$/g, ''), Number(m[2]));
    for (const sig of ['SIGTERM', 'SIGINT'] as const) process.once(sig, () => process.exit(0)); // so the lock goes with it
    console.log(`listening ${url}`);
    console.error(`Signing from ${signer.floatAddress} inside ${rulesPath}. Stop: node examples/signer.ts stop --flag ${flagPath}`);
    return -1; // keeps serving
  }
  console.error(USAGE);
  return 2;
}

if (isMain(import.meta.url, 'signer')) {
  main(process.argv.slice(2)).then(
    (code) => void (code >= 0 && (process.exitCode = code)),
    (e: unknown) => {
      console.error((e as Error).message);
      process.exitCode = e instanceof Refused || e instanceof Refusal ? 3 : 1;
    },
  );
}


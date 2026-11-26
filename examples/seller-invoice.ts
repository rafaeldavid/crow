// The seller's invoice, or a credit note for a refund, from one finished deal's record (T-565, roadmap row N198).
//
//   node examples/seller-invoice.ts <deal record> <seller details file> [--buyer <file>] [--credits <number> --credits-date <YYYY-MM-DD>]
//        [--issue-date <YYYY-MM-DD>] [--supply-date <YYYY-MM-DD>] [--tax <rate in basis points>|reverse-charge|none] [--tax-note <text>]
//        [--rate <decimal> --currency <code> --rate-source <text> --rate-date <YYYY-MM-DD>] [--out <directory>]
//
// The deal record is the file `examples/deal-record.ts` writes. The command recomputes two of the record's checks (the
// terms hash to the commitment ID, the seller's signature recovers to the seller under a pinned domain), checks that the
// record's outcome, settling step, times and payouts agree, requires every other check the record ran to have passed as
// written (the events and receipts behind them are not in the record), and refuses an unfinished or unverifiable deal
// by name. Then it writes, in the
// output directory (the record's own by default), `<number>.json`, the document with stable field names, and
// `<number>.html`, a plain page to print or send.
//
// Rails, not a record-keeper: every deal fact comes from the record, checked as above. Every other fact comes from the seller:
// its name, address and tax number, its numbering, the tax treatment it states, the buyer's details as the buyer gave
// them (`--buyer`), and any fiat rate with its source and date. The command decides no tax rate, no tax treatment and no
// duty to register, looks up no rate, and makes no network call. Its only arithmetic: it splits a tax the seller states
// out of the price the buyer paid, and multiplies a token amount by a rate the seller supplies.
//
// Numbering: the seller details file holds the next number of each series and a register of every document the command
// wrote. A document takes the next number only when it is written; running again on the same deal rewrites the same
// document with the same number and date, and refuses if it would now differ. So the command never repeats a number,
// takes none for a refused run, and warns when the seller's `next` leaves a gap. Exit 0: written; 1: refused (the record, the deal or the inputs), nothing written;
// 2: could not run.
import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { recoverTypedDataAddress } from 'viem';
import { isMain } from './entry.ts';
import { plain } from './plain.ts';
import { commitmentIdOf, jcs, knownPins, typedOf, type Pin } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
export const FORMAT = 'crow-invoice/1';
export const SELLER_FORMAT = 'crow-seller-details/1';
const SEPOLIA_CHAIN = 11155111;
const SIM_CHAIN = 31337;
const ID = /^0x[0-9a-f]{64}$/;
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const TIME = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$/;
const DECIMAL = /^[0-9]{1,18}(\.[0-9]{1,18})?$/;
const PREFIX = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$|^$/;
/** A document number as this command writes it: a prefix and digits. It names the output files. */
const NUMBER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/;
/** Longest text the command takes for one field, and for the description of the work. */
const TEXT_MAX = 300;
const DESCRIPTION_MAX = 6000;
const lc = (s: unknown) => String(s).toLowerCase();

/** A reason to stop: `code` 1 for a refusal (the record, the deal or the inputs), 2 for a call that could not run. */
export class Stop extends Error {
  readonly code: 1 | 2;
  constructor(message: string, code: 1 | 2 = 1) {
    super(message);
    this.code = code;
  }
}
function refuse(m: string): never {
  throw new Stop(m, 1);
}
function usage(m: string): never {
  throw new Stop(m, 2);
}

// ---------------------------------------------------------------------------------------------------------------------
// The deal, from the record.

/** The checks a record must have run and passed. Each one the record ran more than once (per operator) must pass every time. */
export const REQUIRED_CHECKS = ['all operators answered', 'every read answered', 'domain is pinned', 'commitment ID', "seller's terms signature", 'termsHash in events', 'event hashes', 'operator receipts', 'hold is price plus fee', 'operator fee'] as const;
/** A settlement's split comes from its payouts, so a Settled deal needs these two as well. */
const SPLIT_CHECKS = ['postings conserve the hold', 'postings follow the outcome'] as const;
/** The steps that settle a deal, one of which a finished deal's record holds. */
const SETTLING = ['settlement.released', 'settlement.refunded', 'settlement.reclaimed', 'commitment.settled'];

export type Amount = { base: string; decimal: string | null };
export type Deal = {
  commitmentId: string;
  outcome: 'Released' | 'Refunded' | 'Settled';
  reclaimed: boolean;
  settledAt: string;
  pin: Pin;
  token: { id: string; symbol: string | null; decimals: number | null };
  terms: J;
  price: bigint;
  /** What the seller's payout address received out of escrow; the rest of the price went back to the buyer. */
  sellerShare: bigint;
  funding: string | null;
  settlement: string | null;
  operators: string[];
  party: string;
};

/** The decimal form of `x` base units, with at least two decimals; null when the token's decimals are not pinned. */
export const decimalOf = (x: bigint, decimals: number | null): string | null => {
  if (decimals === null) return null;
  const s = x.toString().padStart(decimals + 1, '0');
  const frac = s.slice(s.length - decimals).replace(/0+$/, '').padEnd(2, '0');
  return `${s.slice(0, s.length - decimals) || '0'}.${frac}`;
};

/**
 * The record's own offline checks, run again here: the signed terms hash to the commitment ID, and the seller's
 * signature on them recovers to the seller under a domain this command pins. Returns that pin.
 */
async function termsChecked(r: J, id: string): Promise<Pin> {
  const t = r.terms.signed;
  let recomputed = '';
  try {
    recomputed = lc(commitmentIdOf(t));
  } catch {
    recomputed = '';
  }
  if (recomputed !== id) refuse(`check "commitment ID" failed here: the record's signed terms hash to ${recomputed || 'nothing (malformed)'}, not the commitment ID ${id}. The record was changed after it was written`);
  const answered: J[] = (Array.isArray(r.operators) ? r.operators : []).filter((o: J) => o?.answered);
  const domains = new Set(answered.map((o) => jcs({ ...o.domain, verifyingContract: lc(o.domain?.verifyingContract) })));
  const pin = domains.size === 1 ? knownPins().find((p) => jcs({ ...p.domain, verifyingContract: lc(p.domain.verifyingContract) }) === [...domains][0]) : undefined;
  // The rules contract the document prints is this domain's, which equals the record's own: it is never a constant.
  if (!pin) return refuse(`check "domain is pinned" failed here: the operators in the record serve ${domains.size === 1 ? `an EIP-712 domain that examples/verify.ts does not pin (rules contract ${plain(String(answered[0]?.domain?.verifyingContract)).slice(0, 42)}). For a deal on an earlier deployment, set HOLDBACK_DEPLOYMENT to that deployment's file from contracts/deployments/` : `${domains.size} different domains`}`);
  const signer = lc(await recoverTypedDataAddress({ ...typedOf('CommitmentTerms', t, pin.domain), signature: r.terms?.signatures?.seller?.signature }).catch(() => ''));
  if (signer !== lc(t.seller)) refuse(`check "seller's terms signature" failed here: the signature recovers to ${signer || 'nothing'}, not the seller ${lc(t.seller)}`);
  return pin;
}

/**
 * Checks the record and returns the deal. Throws a `Stop` that names the first thing wrong: a record of another format,
 * a check that failed or did not run, operators that disagree, terms that do not hash to the commitment ID or a seller
 * signature that does not recover, or a deal that has not finished.
 */
export async function dealOf(r: J): Promise<Deal> {
  if (r?.record !== 'holdback-deal-record/1') refuse('this is not a deal record (holdback-deal-record/1): write one with node examples/deal-record.ts <commitmentId> --as seller --out record.json');
  const id = lc(r.commitmentId);
  if (!ID.test(id)) refuse('the record names no commitment ID');
  const t = r.terms?.signed;
  if (!t || typeof t !== 'object') refuse('the record holds no signed terms');
  const pin = await termsChecked(r, id);
  // Nothing is due for a price of 0 whatever else the record says. On SimChain the record's "postings follow the
  // outcome" check fails for such a release, which posts no transfer of 0 (T-565 Handoff), so this comes first.
  if (BigInt(t.price.amount) === 0n) refuse("the deal's price is 0, so the seller was paid nothing and no seller's invoice or credit note is due for it. The adjudication fee the buyer paid is the adjudicator's to invoice");
  if (Array.isArray(r.disagreements) && r.disagreements.length > 0) refuse(`the operators gave different answers for ${r.disagreements.map((d: J) => plain(String(d?.section)).slice(0, 40)).join(', ')}, so the record does not say one thing: write the record again, and ask the operators if it persists`);
  const checks: J[] = Array.isArray(r.checks) ? r.checks : [];
  const failed = checks.filter((c) => c?.ok === false);
  if (failed.length) refuse(`the record's check "${plain(String(failed[0].check)).slice(0, 80)}" failed${failed.length > 1 ? `, and ${failed.length - 1} more` : ''}: an invoice needs a deal whose record passes`);
  const outcome = r.outcome?.escrowState;
  if (!['Released', 'Refunded', 'Settled'].includes(outcome)) refuse(`the deal has not finished: its state in the record is ${plain(String(outcome ?? 'unknown')).slice(0, 40)}. Write the record again once it is Released, Refunded or Settled`);
  if (!r.outcome?.finalAt) refuse('the deal is not final yet in the record (no finalAt): write the record again once it is');
  const required = outcome === 'Settled' ? [...REQUIRED_CHECKS, ...SPLIT_CHECKS] : REQUIRED_CHECKS;
  for (const name of required) {
    const runs = checks.filter((c) => c?.check === name);
    if (runs.length === 0 || runs.some((c) => c.ok !== true)) refuse(`the record's check "${name}" ${runs.length === 0 ? 'is missing' : `did not run (${plain(String(runs.find((c) => c.ok !== true)?.why ?? 'no reason given')).slice(0, 160)})`}: an invoice needs it to have passed`);
  }

  // What the record states about the outcome must agree with itself: the outcome, the step that settled the deal, its
  // time, the payouts and who was paid. These catch an edited or inconsistent record; the events and receipts behind
  // them are not in the record, so their checks above are taken as the record wrote them (T-565 review, H1).
  const steps: J[] = Array.isArray(r.steps) ? r.steps : [];
  const settling = steps.filter((x) => SETTLING.includes(x?.step));
  const step = settling[0]?.step;
  const expected = outcome === 'Released' ? ['settlement.released'] : outcome === 'Refunded' ? ['settlement.refunded', 'settlement.reclaimed'] : ['commitment.settled'];
  const settledAt = String(r.row?.settledAt ?? '');
  const why =
    r.row?.outcome !== outcome ? `its outcome says ${plain(String(outcome))} and its row says ${plain(String(r.row?.outcome)).slice(0, 40)}`
    : settling.length !== 1 || !expected.includes(step) ? `its outcome is ${outcome} but the steps that settle it are ${settling.map((x) => plain(String(x.step)).slice(0, 40)).join(', ') || 'none'}`
    : (step === 'settlement.reclaimed') !== (r.outcome?.reclaimed === true) ? 'its reclaimed flag does not match its steps'
    : !(settledAt.length <= 40 && TIME.test(settledAt)) || settling[0].at !== settledAt || (r.outcome?.settledAt ?? settledAt) !== settledAt ? 'its settlement times do not agree'
    : null;
  if (why) refuse(`the record does not agree with itself: ${why}. Write the record again`);
  const price = BigInt(t.price.amount);
  const payout = lc(t.sellerPayoutAddress ?? t.seller);
  const payment = lc(t.buyerPaymentAddress ?? t.buyer);
  let sellerShare = 0n;
  if (outcome === 'Released') sellerShare = price;
  else if (outcome === 'Settled') {
    // The payouts both parties signed, as the settled event records them: each a whole number above 0 in the price's
    // token, to the seller's payout address or the buyer's payment address, together the price.
    const postings: J[] = Array.isArray(r.settlement?.postings) ? r.settlement.postings : [];
    const bad = postings.find((x) => !(typeof x?.amount?.amount === 'string' && /^[1-9][0-9]{0,77}$/.test(x.amount.amount) && x.amount.token === t.price.token && [payout, payment].includes(lc(x.to))));
    if (bad || postings.length === 0) refuse('the record does not agree with itself: a settlement payout is not a whole amount above 0 to the seller\'s payout address or the buyer\'s payment address. Write the record again');
    sellerShare = postings.filter((x) => lc(x.to) === payout).reduce((a, x) => a + BigInt(x.amount.amount), 0n);
    const total = postings.reduce((a, x) => a + BigInt(x.amount.amount), 0n);
    if (total !== price) refuse(`the record does not agree with itself: its settlement pays out ${total} base units against a price of ${price}`);
  }
  // Who received money, where the record says: the seller's payout address when the seller had a share, the buyer's
  // payment address when part of the price went back. A chain's record leaves both null for a deal that settled before
  // its operators wrote postings (T-621, T-627).
  const paidTo = r.row?.paidTo ?? null, refundedTo = r.row?.refundedTo ?? null;
  if ((paidTo !== null && (lc(paidTo) !== payout || sellerShare === 0n)) || (refundedTo !== null && (lc(refundedTo) !== payment || sellerShare === price))) refuse('the record does not agree with itself: who it says was paid does not match its outcome. Write the record again');
  if (outcome === 'Settled' && ((paidTo !== null) !== (sellerShare > 0n) || (refundedTo !== null) !== (sellerShare < price))) refuse('the record does not agree with itself: who it says was paid does not match its settlement. Write the record again');
  const txs: J[] = Array.isArray(r.settlement?.transactions) ? r.settlement.transactions : [];
  const txOf = (steps: string[]) => {
    const x = txs.find((e) => steps.includes(e?.step) && ID.test(lc(e.tx)));
    return x ? lc(x.tx) : null;
  };
  const known = lc(t.price.token) === lc(pin.token.id);
  return {
    commitmentId: id, outcome, reclaimed: r.outcome?.reclaimed === true, settledAt, pin, terms: t, price, sellerShare,
    // A token's address is lowercased; SimChain's token is a name, kept as it is.
    token: { id: (/^0x/i.test(String(t.price.token)) ? lc(t.price.token) : plain(String(t.price.token))).slice(0, 64), symbol: known ? pin.token.symbol : null, decimals: known ? pin.token.decimals : null },
    funding: txOf(['hold.funded']),
    // A decision's transaction carries the release or the refund, and the record lists it under its first step.
    settlement: txOf([step]) ?? txOf(['judgment.decided']),
    operators: (Array.isArray(r.operators) ? r.operators : []).filter((o: J) => o?.answered).map((o: J) => plain(String(o.api)).slice(0, 120)),
    party: r.party === 'buyer' ? 'buyer' : 'seller',
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The seller's own details, and the buyer's as the buyer gave them.

export type Tax = { treatment: 'rate'; rateBps: number } | { treatment: 'reverse-charge' } | { treatment: 'none' };
export type Series = { prefix: string; next: number; digits: number };
export type Issued = { number: string; series: 'invoice' | 'creditNote'; kind: 'invoice' | 'credit-note'; commitmentId: string; credits: string | null; issueDate: string; sha256: string; recordSha256?: string };
export type Seller = {
  name: string; address: string[]; country: string | null; taxId: string | null; lines: string[]; email: string | null;
  tax: Tax; taxNote: string | null;
  numbering: { invoice: Series; creditNote: Series | null };
  issued: Issued[];
};
export type Buyer = { name: string | null; address: string[] | null; country: string | null; taxId: string | null; reference: string | null };

const SELLER_KEYS = ['format', 'name', 'address', 'country', 'taxId', 'lines', 'email', 'tax', 'numbering', 'issued'];
const BUYER_KEYS = ['name', 'address', 'country', 'taxId', 'reference'];

/** One line of text, 1 to `max` characters after the controls and invisible characters are removed. */
function text(v: unknown, where: string, max = TEXT_MAX): string {
  if (typeof v !== 'string') usage(`${where} must be text`);
  const s = plain(v as string).trim();
  if (s === '' || s.length > max) usage(`${where} must be text of 1 to ${max} characters`);
  return s;
}
const optText = (v: unknown, where: string) => (v === undefined || v === null ? null : text(v, where));
function lines(v: unknown, where: string, need: boolean): string[] | null {
  if (v === undefined || v === null) return need ? usage(`${where} is missing`) : null;
  const list = typeof v === 'string' ? [v] : v;
  if (!Array.isArray(list) || list.length === 0 || list.length > 8) usage(`${where} must be 1 to 8 lines of text`);
  return (list as unknown[]).map((x, i) => text(x, `${where}, line ${i + 1}`));
}
const country = (v: unknown, where: string) => {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || !/^[A-Z]{2}$/.test(v)) usage(`${where} must be a two-letter country code such as DE`);
  return v as string;
};
function unknownKeys(o: Record<string, unknown>, keys: string[], where: string) {
  const extra = Object.keys(o).filter((k) => !keys.includes(k));
  if (extra.length) usage(`${where} has a field this command does not know, ${plain(extra[0]!).slice(0, 40)}; the fields are ${keys.join(', ')}`);
}
function series(v: unknown, where: string): Series {
  if (!v || typeof v !== 'object' || Array.isArray(v)) usage(`${where} is missing: give {"prefix": "INV-2026-", "next": 1}`);
  const s = v as J;
  unknownKeys(s, ['prefix', 'next', 'digits'], where);
  if (typeof s.prefix !== 'string' || !PREFIX.test(s.prefix)) usage(`${where}.prefix must be up to 32 letters, digits, dots, dashes or underscores, starting with a letter or digit (or "")`);
  if (!Number.isSafeInteger(s.next) || s.next < 1) usage(`${where}.next must be a whole number of 1 or more`);
  const digits = s.digits ?? 4;
  if (!Number.isInteger(digits) || digits < 1 || digits > 12) usage(`${where}.digits must be a whole number from 1 to 12`);
  return { prefix: s.prefix, next: s.next, digits };
}
export function taxOf(v: unknown, where: string): Tax {
  if (typeof v === 'number' || (typeof v === 'string' && /^[0-9]+$/.test(v))) v = { treatment: 'rate', rateBps: Number(v) };
  else if (v === 'reverse-charge' || v === 'none') v = { treatment: v };
  if (!v || typeof v !== 'object') usage(`${where} is missing: state the tax treatment as {"treatment": "rate", "rateBps": 1900}, {"treatment": "reverse-charge"} or {"treatment": "none"}`);
  const x = v as J;
  if (x.treatment === 'rate') {
    if (!Number.isInteger(x.rateBps) || x.rateBps < 0 || x.rateBps > 100_000) usage(`${where}.rateBps must be a whole number of basis points from 0 to 100000 (1900 is 19 %)`);
    return { treatment: 'rate', rateBps: x.rateBps };
  }
  if (x.treatment === 'reverse-charge' || x.treatment === 'none') return { treatment: x.treatment };
  return usage(`${where}.treatment must be "rate", "reverse-charge" or "none"`);
}
function issuedOf(v: unknown): Issued[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) usage('seller file: issued must be the list this command writes');
  return (v as J[]).map((e, i) => {
    const ok = e && typeof e.number === 'string' && ['invoice', 'creditNote'].includes(e.series) && ['invoice', 'credit-note'].includes(e.kind) && ID.test(String(e.commitmentId)) && DATE.test(String(e.issueDate)) && /^[0-9a-f]{64}$/.test(String(e.sha256)) && (e.credits === null || typeof e.credits === 'string') && NUMBER.test(String(e.number)) && (e.recordSha256 === undefined || /^[0-9a-f]{64}$/.test(String(e.recordSha256)));
    if (!ok) usage(`seller file: issued entry ${i + 1} is not one this command wrote; restore the file from your copy`);
    return e as Issued;
  });
}

/** The seller's details file, checked for shape: a missing or malformed field is named. */
export function sellerOf(v: unknown): Seller {
  if (!v || typeof v !== 'object' || Array.isArray(v)) usage('the seller file must hold one JSON object');
  const s = v as J;
  if (s.format !== SELLER_FORMAT) usage(`seller file: format must be "${SELLER_FORMAT}"`);
  unknownKeys(s, SELLER_KEYS, 'the seller file');
  if (s.name === undefined) usage('seller file: name is missing: your legal name, as it goes on the invoice');
  const tax = taxOf(s.tax, 'seller file: tax');
  const numbering = s.numbering;
  if (!numbering || typeof numbering !== 'object') usage('seller file: numbering is missing: give {"invoice": {"prefix": "INV-2026-", "next": 1}}');
  unknownKeys(numbering, ['invoice', 'creditNote'], 'seller file: numbering');
  return {
    name: text(s.name, 'seller file: name'),
    address: lines(s.address, 'seller file: address', true)!,
    country: country(s.country, 'seller file: country'),
    taxId: optText(s.taxId, 'seller file: taxId'),
    lines: lines(s.lines, 'seller file: lines', false) ?? [],
    email: optText(s.email, 'seller file: email'),
    tax,
    taxNote: optText((s.tax as J)?.note, 'seller file: tax.note'),
    numbering: { invoice: series(numbering.invoice, 'seller file: numbering.invoice'), creditNote: numbering.creditNote === undefined ? null : series(numbering.creditNote, 'seller file: numbering.creditNote') },
    issued: issuedOf(s.issued),
  };
}

/** The buyer's details as the buyer disclosed them to the seller; any field may be left out. */
export function buyerOf(v: unknown): Buyer {
  if (v === undefined) return { name: null, address: null, country: null, taxId: null, reference: null };
  if (!v || typeof v !== 'object' || Array.isArray(v)) usage('the buyer file must hold one JSON object');
  const b = v as J;
  unknownKeys(b, BUYER_KEYS, 'the buyer file');
  return { name: optText(b.name, 'buyer file: name'), address: lines(b.address, 'buyer file: address', false), country: country(b.country, 'buyer file: country'), taxId: optText(b.taxId, 'buyer file: taxId'), reference: optText(b.reference, 'buyer file: reference') };
}

// ---------------------------------------------------------------------------------------------------------------------
// Exact arithmetic.

/** `a / b` rounded half up, for non-negative integers. */
const divHalfUp = (a: bigint, b: bigint) => (2n * a + b) / (2n * b);
/** A decimal string as a fraction of integers: "0.925" → 925/1000. */
export const fractionOf = (s: string) => {
  const [w, f = ''] = s.split('.');
  return { numerator: BigInt(`${w}${f}`), denominator: 10n ** BigInt(f.length) };
};
/** Cents as a decimal string: 12345n → "123.45". */
const cents = (c: bigint) => `${c / 100n}.${(c % 100n).toString().padStart(2, '0')}`;

// ---------------------------------------------------------------------------------------------------------------------
// The document.

export type Options = {
  recordFile: string; recordBytes: Buffer;
  seller: Seller; buyer: Buyer;
  credits?: { number: string; issueDate: string };
  issueDate: string; supplyDate?: string;
  tax?: Tax; taxNote?: string;
  fiat?: { rate: string; currency: string; source: string; date: string };
};
export type Made = { doc: J; html: string; json: string; sha256: string; number: string; series: 'invoice' | 'creditNote'; reused: boolean; gap: number };

const NOTICE = "Written by the seller with Crow's seller-invoice command, from a checked deal record and the details the seller supplied. The seller issues this document and is responsible for it. Crow is not a party to it and gives no tax or legal advice: the command decides no tax rate, tax treatment or duty to register, and does not say that this document meets the requirements of any law. Each field shows where it came from.";

/** What the deal calls for, given the outcome and whether the seller names an invoice to credit. */
function kindOf(d: Deal, credits: Options['credits']): { kind: 'invoice' | 'credit-note'; amount: bigint } {
  const refunded = d.price - d.sellerShare;
  if (credits) {
    if (refunded === 0n) refuse(`the deal refunded nothing (${d.outcome}, the whole price went to the seller), so there is nothing to credit`);
    return { kind: 'credit-note', amount: refunded };
  }
  if (d.sellerShare > 0n) return { kind: 'invoice', amount: d.sellerShare };
  if (d.price === 0n) refuse("the deal's price is 0, so the seller was paid nothing and no seller's invoice is due for it. The adjudication fee the buyer paid is the adjudicator's to invoice");
  return refuse(`the deal ${d.reclaimed ? 'was reclaimed' : d.outcome === 'Settled' ? 'settled' : 'was refunded'} and the whole price went back to the buyer, so the seller was paid nothing and no invoice is due for it. If you invoiced this deal earlier, credit that invoice: --credits <its number> --credits-date <its issue date>`);
}

/** The next number in `s`, and how many numbers the register's last one in this series leaves out before it. */
function nextNumber(s: Series, key: 'invoice' | 'creditNote', issued: Issued[]): { number: string; gap: number } {
  const fmt = (n: number) => `${s.prefix}${String(n).padStart(s.digits, '0')}`;
  const mine = issued.filter((e) => e.series === key && e.number.startsWith(s.prefix) && /^[0-9]+$/.test(e.number.slice(s.prefix.length)));
  const last = mine.reduce((a, e) => Math.max(a, Number(e.number.slice(s.prefix.length))), 0);
  const number = fmt(s.next);
  if (s.next <= last || issued.some((e) => e.number === number)) refuse(`the seller file's next ${key === 'invoice' ? 'invoice' : 'credit note'} number is ${number}, but ${fmt(last)} is already issued: set numbering.${key}.next to ${last + 1} or more. A number is never used twice`);
  return { number, gap: last === 0 ? 0 : s.next - last - 1 };
}

/**
 * The block explorer for a pin's chain. It follows the chain, not the file that pinned it: a deal on an earlier Sepolia
 * deployment, pinned through HOLDBACK_DEPLOYMENT, keeps its links (T-565, after the T-563 redeploy).
 */
export const explorerOf = (pin: Pin): string | null => pin.chain?.explorer ?? (pin.domain.chainId === SEPOLIA_CHAIN ? 'https://sepolia.etherscan.io' : null);

/** Builds the document. Pure: the same inputs give the same bytes. */
export async function make(record: J, o: Options): Promise<Made> {
  const d = await dealOf(record);
  const t = d.terms;
  const { kind, amount } = kindOf(d, o.credits);
  const tax = o.tax ?? o.seller.tax;
  const taxNote = o.taxNote ?? o.seller.taxNote;
  if (tax.treatment === 'reverse-charge' && !o.seller.taxId) refuse('this command writes a reverse-charge document only with both parties\' VAT numbers, and the seller file gives none for you (taxId). Add it, or state another treatment with --tax');
  if (tax.treatment === 'reverse-charge' && !o.buyer.taxId) refuse('this command writes a reverse-charge document only with both parties\' VAT numbers, and the buyer file gives none for the buyer (taxId). Ask the buyer for it, or state another treatment with --tax');
  for (const [k, v] of [['issue date', o.issueDate], ['supply date', o.supplyDate], ['credited invoice date', o.credits?.issueDate], ['rate date', o.fiat?.date]] as const) {
    if (v !== undefined && (!DATE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)) || new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v)) usage(`the ${k} must be a date as YYYY-MM-DD`);
  }

  // One invoice or one credit note per deal (T-565 review, M1). A credit note corrects an invoice for the whole price
  // issued earlier, elsewhere; this command's own invoices are for what the seller was paid, so none of them is credited.
  const credits = o.credits?.number ?? null;
  const mine = o.seller.issued.filter((e) => e.commitmentId === d.commitmentId);
  const other = mine.find((e) => e.kind !== kind);
  if (other) refuse(kind === 'credit-note' ? `this command issued ${other.number} for this deal, an invoice for only what you were paid, so the refunded part was never invoiced and no credit note is due` : `this command issued credit note ${other.number} for this deal, crediting the refunded part of invoice ${other.credits}, which already covers what you were paid`);
  const named = credits === null ? undefined : o.seller.issued.find((e) => e.number === credits);
  if (named && (named.commitmentId !== d.commitmentId || named.kind !== 'invoice')) refuse(`${credits} in your register is ${named.kind === 'invoice' ? 'an invoice for another deal' : 'a credit note'}: a credit note for this deal names the invoice for this deal's full price`);
  const prior = mine.find((e) => e.kind === kind);
  if (prior && prior.credits !== credits) refuse(`credit note ${prior.number} already credits this deal's refund against invoice ${prior.credits}: a refund is credited once`);
  // The number: the one already issued for this deal and document, or the next in its series.
  const key: 'invoice' | 'creditNote' = kind === 'credit-note' && o.seller.numbering.creditNote ? 'creditNote' : 'invoice';
  let number: string;
  let issueDate = o.issueDate;
  let gap = 0;
  if (prior) {
    number = prior.number;
    issueDate = prior.issueDate;
  } else ({ number, gap } = nextNumber(o.seller.numbering[key] ?? o.seller.numbering.invoice, key, o.seller.issued));

  // Amounts in base units. The price is what the buyer paid, so a tax the seller states is inside it.
  const known = d.token.decimals;
  const amt = (x: bigint): Amount => ({ base: x.toString(), decimal: decimalOf(x, known) });
  const net = tax.treatment === 'rate' ? divHalfUp(amount * 10_000n, 10_000n + BigInt(tax.rateBps)) : amount;
  const taxAmount = amount - net;
  let fiat: J = null;
  if (o.fiat) {
    if (known === null) refuse(`the token ${d.token.id} is not the pinned deployment's, so its decimals are unknown and no fiat figure can be computed`);
    const f = fractionOf(o.fiat.rate);
    const toCents = (x: bigint) => divHalfUp(x * f.numerator * 100n, f.denominator * 10n ** BigInt(known!));
    const total = toCents(amount), fTax = toCents(taxAmount);
    fiat = { currency: o.fiat.currency, rate: o.fiat.rate, rateFraction: { numerator: f.numerator.toString(), denominator: f.denominator.toString() }, rateSource: o.fiat.source, rateDate: o.fiat.date, net: cents(total - fTax), tax: cents(fTax), total: cents(total), computed: 'the token amount times the rate the seller supplied, rounded half up to 0.01; the net is the total less the tax' };
  }

  const chainId = d.pin.domain.chainId;
  const network = chainId === SEPOLIA_CHAIN ? 'Sepolia, a test network: its tokens have no monetary value' : chainId === SIM_CHAIN ? 'SimChain, a local simulation: its tokens have no monetary value' : `chain ${chainId}`;
  const base = explorerOf(d.pin);
  const explorer = (tx: string | null) => (tx && base ? `${base}/tx/${tx}` : null);
  const description = plain(String(t.deliverable?.description ?? '')).slice(0, DESCRIPTION_MAX);
  const payment = kind === 'invoice'
    ? { status: d.outcome === 'Settled' ? 'paid: the seller\'s share of a settlement both parties signed' : 'paid: released to the seller on acceptance', to: lc(t.sellerPayoutAddress), amount: amt(amount), transaction: d.settlement, explorer: explorer(d.settlement), settledAt: d.settledAt }
    : { status: d.outcome === 'Settled' ? 'refunded: the buyer\'s share of a settlement both parties signed' : d.reclaimed ? 'refunded: the buyer reclaimed the hold' : 'refunded on the adjudicator\'s decision', to: lc(t.buyerPaymentAddress), amount: amt(amount), transaction: d.settlement, explorer: explorer(d.settlement), settledAt: d.settledAt };
  const doc = {
    format: FORMAT,
    kind,
    number,
    numberSource: `the seller file's ${key === 'invoice' ? 'invoice' : 'credit note'} series`,
    issueDate,
    supplyDate: o.supplyDate ?? d.settledAt.slice(0, 10),
    supplyDateSource: o.supplyDate ? 'seller' : 'the settlement date in the deal record',
    credits: o.credits ? { number: o.credits.number, issueDate: o.credits.issueDate, source: 'seller' } : null,
    seller: { name: o.seller.name, address: o.seller.address, country: o.seller.country, taxId: o.seller.taxId, lines: o.seller.lines, email: o.seller.email, source: 'seller file', signingAddress: lc(t.seller), payoutAddress: lc(t.sellerPayoutAddress) },
    buyer: { ...o.buyer, source: 'as the buyer disclosed them to the seller; null where it did not', signingAddress: lc(t.buyer), paymentAddress: lc(t.buyerPaymentAddress) },
    deal: {
      commitmentId: d.commitmentId, outcome: d.outcome, reclaimed: d.reclaimed, settledAt: d.settledAt,
      description, descriptionSource: "the seller's words in the signed terms", deliverableKind: t.deliverable?.kind == null ? null : plain(String(t.deliverable.kind)).slice(0, 64), format: t.deliverable?.format == null ? null : plain(String(t.deliverable.format)).slice(0, 128),
      price: amt(d.price), sellerShare: amt(d.sellerShare), refunded: amt(d.price - d.sellerShare),
      network: { chainId, name: network, rulesContract: lc(d.pin.domain.verifyingContract) },
      transactions: { funding: { hash: d.funding, explorer: explorer(d.funding) }, settlement: { hash: d.settlement, explorer: explorer(d.settlement) } },
    },
    token: d.token,
    line: { description: kind === 'invoice' ? (d.outcome === 'Settled' ? 'The seller\'s agreed share of the price for the work described' : 'The work described, accepted under the deal') : (d.outcome === 'Settled' ? 'The part of the price refunded under the settlement' : 'The price refunded to the buyer'), quantity: '1', net: amt(net), taxRateBps: tax.treatment === 'rate' ? tax.rateBps : null, tax: amt(taxAmount), total: amt(amount) },
    totals: { net: amt(net), tax: amt(taxAmount), total: amt(amount) },
    tax: { treatment: tax.treatment, rateBps: tax.treatment === 'rate' ? tax.rateBps : null, note: taxNote, source: o.tax ? 'seller, for this document' : 'seller file', split: tax.treatment === 'rate' ? 'the buyer paid the price, so the tax is inside it: net = total × 10000 / (10000 + rate in basis points), rounded half up; tax = total − net' : null },
    fiat,
    payment,
    source: { record: basename(o.recordFile), recordSha256: createHash('sha256').update(o.recordBytes).digest('hex'), writtenBy: d.party, operators: d.operators, checks: "this command recomputed two of the record's checks, the commitment ID from the signed terms and the seller's terms signature under the pinned domain, and checked that the record's outcome, settling step, times and payouts agree; the record's other checks, of the events and the operators' receipts, passed as the record wrote them" },
    notice: NOTICE,
  };
  const json = `${JSON.stringify(doc, null, 2)}\n`;
  const sha256 = createHash('sha256').update(json).digest('hex');
  if (prior && prior.sha256 !== sha256) {
    const record = doc.source.recordSha256;
    refuse(`${number} was issued for this deal on ${prior.issueDate} with other content (SHA-256 ${prior.sha256.slice(0, 16)}…). ${prior.recordSha256 && prior.recordSha256 !== record ? `The deal record differs from the one it was made from (SHA-256 ${prior.recordSha256.slice(0, 16)}…): use that file, under the same name, to write it again` : 'To write the same document again, give the same inputs'}. An issued document is not changed: this command does not write a correction of it yet, so make that in your own books`);
  }
  return { doc, json, sha256, html: page(doc, sha256), number, series: key, reused: Boolean(prior), gap };
}

// ---------------------------------------------------------------------------------------------------------------------
// The printable page.

/** Text for HTML: one plain line with the five characters HTML reads as markup escaped. */
export const esc = (s: unknown) => plain(String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const NOT = '<span class="no">not disclosed</span>';

function page(doc: J, sha: string): string {
  const tok = doc.token.symbol ?? `base units of token ${doc.token.id}`;
  const m = (a: Amount) => (a.decimal !== null ? `${esc(a.decimal)} ${esc(tok)}` : `${esc(a.base)} ${esc(tok)}`);
  const base = (a: Amount) => (a.decimal !== null ? `<div class="sub">${esc(a.base)} base units</div>` : '');
  const credit = doc.kind === 'credit-note';
  const title = `${credit ? 'Credit note' : 'Invoice'} ${doc.number}`;
  const party = (p: J, role: 'seller' | 'buyer') => [
    `<div class="party"><h2>${role === 'seller' ? 'From (seller)' : 'To (buyer)'}</h2>`,
    `<p class="name">${p.name ? esc(p.name) : NOT}</p>`,
    p.address ? `<p>${p.address.map(esc).join('<br>')}</p>` : `<p>Address: ${NOT}</p>`,
    p.country ? `<p>Country: ${esc(p.country)}</p>` : '',
    `<p>Tax number: ${p.taxId ? esc(p.taxId) : role === 'seller' ? '<span class="no">none stated</span>' : NOT}</p>`,
    ...(role === 'seller' ? p.lines.map((l: string) => `<p>${esc(l)}</p>`) : []),
    role === 'seller' && p.email ? `<p>${esc(p.email)}</p>` : '',
    `<p class="addr">${role === 'seller' ? `Signing key <code>${esc(p.signingAddress)}</code><br>Paid to <code>${esc(p.payoutAddress)}</code>` : `Signing key <code>${esc(p.signingAddress)}</code><br>Paid from <code>${esc(p.paymentAddress)}</code>`}</p>`,
    '</div>',
  ].join('\n');
  const tx = (x: J) => (x.hash ? `<code>${esc(x.hash)}</code>${x.explorer ? ` (<a href="${esc(x.explorer)}">explorer</a>)` : ''}` : '<span class="no">not in the record</span>');
  const taxLine = doc.tax.treatment === 'rate' ? `Tax at ${Math.trunc(doc.tax.rateBps / 100)}.${String(doc.tax.rateBps % 100).padStart(2, '0')} %, as the seller states it` : doc.tax.treatment === 'reverse-charge' ? 'Reverse charge' : 'No tax charged, as the seller states it';
  const f = doc.fiat;
  const rows = [
    ['Number', esc(doc.number)],
    ['Issue date', esc(doc.issueDate)],
    ['Date of supply', `${esc(doc.supplyDate)} <span class="sub">(${esc(doc.supplyDateSource)})</span>`],
    ...(credit ? [['Credits invoice', `${esc(doc.credits.number)} of ${esc(doc.credits.issueDate)}`]] : []),
    ['Buyer\'s reference', doc.buyer.reference ? esc(doc.buyer.reference) : NOT],
    ['Deal (commitment ID)', `<code>${esc(doc.deal.commitmentId)}</code>`],
  ];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
body { font: 14px/1.45 Georgia, "Times New Roman", serif; color: #1d1d1f; background: #fff; max-width: 820px; margin: 24px auto; padding: 0 16px; }
h1 { font-size: 24px; margin: 0 0 4px; } h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: #555; margin: 0 0 6px; }
.parties { display: flex; gap: 32px; flex-wrap: wrap; margin: 20px 0; } .party { flex: 1 1 300px; } .party p { margin: 2px 0; } .name { font-weight: bold; }
table { border-collapse: collapse; width: 100%; margin: 12px 0; } th, td { text-align: left; vertical-align: top; padding: 6px 8px; border-bottom: 1px solid #ddd; }
td.n, th.n { text-align: right; white-space: nowrap; } .sub { color: #666; font-size: 12px; } .no { color: #888; font-style: italic; }
code { font: 12px Menlo, Consolas, monospace; overflow-wrap: anywhere; } .addr { margin-top: 6px; font-size: 12px; } .desc { white-space: pre-wrap; overflow-wrap: anywhere; }
footer { margin-top: 28px; padding-top: 10px; border-top: 1px solid #bbb; font-size: 12px; color: #444; }
@media print { body { margin: 0 auto; } a { color: inherit; text-decoration: none; } }
</style>
</head>
<body>
<h1>${esc(title)}</h1>
<p class="sub">${credit ? 'A credit note: it corrects the invoice it names by the amount below.' : `Paid in full through escrow on ${esc(doc.payment.settledAt.slice(0, 10))}.`} Network: ${esc(doc.deal.network.name)} (chain ${esc(doc.deal.network.chainId)}).</p>
<div class="parties">
${party(doc.seller, 'seller')}
${party(doc.buyer, 'buyer')}
</div>
<table>
${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('\n')}
</table>
<table>
<tr><th>Description</th><th class="n">Net</th><th class="n">Tax</th><th class="n">Total</th></tr>
<tr><td>${esc(doc.line.description)}<div class="desc sub">${esc(doc.deal.description)}</div></td><td class="n">${m(doc.line.net)}${base(doc.line.net)}</td><td class="n">${m(doc.line.tax)}</td><td class="n">${m(doc.line.total)}${base(doc.line.total)}</td></tr>
<tr><th>${credit ? 'Total credited' : 'Total'}</th><td class="n">${m(doc.totals.net)}</td><td class="n">${m(doc.totals.tax)}</td><td class="n"><strong>${m(doc.totals.total)}</strong></td></tr>
</table>
<p>${taxLine}.${doc.tax.note ? ` ${esc(doc.tax.note)}` : ''}</p>
${f ? `<p>In ${esc(f.currency)}: net ${esc(f.net)}, tax ${esc(f.tax)}, total ${esc(f.total)}, at ${esc(f.rate)} ${esc(f.currency)} for one ${esc(tok)}, from ${esc(f.rateSource)} on ${esc(f.rateDate)}, as the seller supplied it; ${esc(f.computed)}.</p>` : '<p class="sub">No fiat value: the seller supplied no rate.</p>'}
<h2>Payment</h2>
<p>${esc(doc.payment.status[0].toUpperCase() + doc.payment.status.slice(1))}: ${m(doc.payment.amount)} to <code>${esc(doc.payment.to)}</code>, settled ${esc(doc.payment.settledAt)}, transaction ${tx({ hash: doc.payment.transaction, explorer: doc.payment.explorer })}. The buyer funded the escrow in transaction ${tx(doc.deal.transactions.funding)}. Deal price ${m(doc.deal.price)}: ${m(doc.deal.sellerShare)} to the seller, ${m(doc.deal.refunded)} back to the buyer.</p>
<footer>
<p>${esc(doc.notice)}</p>
<p>Made from the deal record <code>${esc(doc.source.record)}</code> (SHA-256 <code>${esc(doc.source.recordSha256)}</code>), which the ${esc(doc.source.writtenBy)} wrote from ${esc(doc.source.operators.length)} operators. ${esc(doc.source.checks)}. The JSON form of this document has SHA-256 <code>${esc(sha)}</code>.</p>
</footer>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------------------------------------------------
// The command.

const USAGE = [
  "seller-invoice: the seller's invoice, or a credit note for a refund, from a finished deal's record.",
  'Usage:',
  '  node examples/seller-invoice.ts <deal record> <seller details file> [--buyer <file>]',
  '       [--credits <invoice number> --credits-date <YYYY-MM-DD>] [--issue-date <YYYY-MM-DD>] [--supply-date <YYYY-MM-DD>]',
  '       [--tax <basis points>|reverse-charge|none] [--tax-note <text>]',
  '       [--rate <decimal> --currency <code> --rate-source <text> --rate-date <YYYY-MM-DD>] [--out <directory>]',
  'Write the record with: node examples/deal-record.ts <commitment ID> --as seller --out record.json',
  `The seller file is JSON: {"format": "${SELLER_FORMAT}", "name", "address": [lines], "country", "taxId", "lines": [lines],`,
  '  "email", "tax": {"treatment": "rate", "rateBps": 1900} | {"treatment": "reverse-charge"} | {"treatment": "none"}, with an optional "note",',
  '  "numbering": {"invoice": {"prefix": "INV-2026-", "next": 1, "digits": 4}, "creditNote": {...}}}. The command adds "issued", its register.',
  'The buyer file is JSON with any of: name, address, country, taxId, reference (the buyer\'s own order number).',
  'It writes <number>.json and <number>.html. A refund needs --credits: with no invoice issued, no document is due.',
  'No network. Exit 0 written; 1 refused, nothing written; 2 could not run.',
].join('\n');

const FLAGS = ['--buyer', '--credits', '--credits-date', '--issue-date', '--supply-date', '--tax', '--tax-note', '--rate', '--currency', '--rate-source', '--rate-date', '--out'];

export async function main(argv: readonly string[], io = { out: (s: string) => console.log(s), err: (s: string) => console.error(s) }, now = () => new Date()): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    io.out(USAGE);
    return 0;
  }
  let lock: string | null = null;
  /** Temporary files this run wrote, removed on any failure; and the number once the register holds it. */
  const temps: string[] = [];
  let committed: string | null = null;
  try {
    const [recordFile, sellerFile, ...rest] = argv;
    if (!recordFile || !sellerFile || recordFile.startsWith('--') || sellerFile.startsWith('--')) usage('give the deal record, then the seller details file');
    const f: Record<string, string> = {};
    for (let i = 0; i < rest.length; i += 2) {
      const name = rest[i]!;
      if (!FLAGS.includes(name)) usage(`unknown option ${plain(name).slice(0, 40)}`);
      if (rest[i + 1] === undefined) usage(`${name} needs a value`);
      f[name] = rest[i + 1]!;
    }
    if ((f['--credits'] === undefined) !== (f['--credits-date'] === undefined)) usage('--credits and --credits-date go together: the number and the issue date of the invoice you credit');
    const fiatFlags = ['--rate', '--currency', '--rate-source', '--rate-date'];
    const given = fiatFlags.filter((x) => f[x] !== undefined);
    if (given.length && given.length < 4) usage(`a fiat figure needs the rate, its currency, its source and its date: ${fiatFlags.filter((x) => f[x] === undefined).join(', ')} missing`);
    if (f['--rate'] !== undefined && !DECIMAL.test(f['--rate'])) usage('--rate must be a decimal string such as 0.9234: how much of the currency one token is worth');
    if (f['--currency'] !== undefined && !/^[A-Z]{3}$/.test(f['--currency'])) usage('--currency must be a three-letter code such as EUR');
    const json = (file: string, what: string) => {
      try {
        return JSON.parse(readFileSync(file, 'utf8')) as unknown;
      } catch (e) {
        return usage(`could not read the ${what} ${plain(file).slice(0, 120)} as JSON: ${plain((e as Error).message).slice(0, 120)}`);
      }
    };
    const recordBytes = readFileSync(recordFile);
    let record: J;
    try {
      record = JSON.parse(recordBytes.toString('utf8'));
    } catch {
      return usage('the deal record is not JSON');
    }
    const buyer = buyerOf(f['--buyer'] !== undefined ? json(f['--buyer'], 'buyer file') : undefined);
    const credits = f['--credits'] !== undefined ? { number: text(f['--credits'], '--credits', 64), issueDate: f['--credits-date']! } : undefined;

    // From here the seller file is read and written under a lock, so two runs never take the same number.
    lock = `${sellerFile}.lock`;
    try {
      closeSync(openSync(lock, 'wx'));
    } catch {
      lock = null;
      return usage(`${plain(sellerFile).slice(0, 120)}.lock exists: another run is writing this seller file. If none is, delete the lock file and run again`);
    }
    const raw = json(sellerFile, 'seller file') as J;
    const seller = sellerOf(raw);
    const made = await make(record, {
      recordFile, recordBytes, seller, buyer, issueDate: f['--issue-date'] ?? now().toISOString().slice(0, 10),
      ...(credits ? { credits } : {}),
      ...(f['--supply-date'] !== undefined ? { supplyDate: f['--supply-date'] } : {}),
      ...(f['--tax'] !== undefined ? { tax: taxOf(f['--tax'], '--tax') } : {}),
      ...(f['--tax-note'] !== undefined ? { taxNote: text(f['--tax-note'], '--tax-note') } : {}),
      ...(given.length ? { fiat: { rate: f['--rate']!, currency: f['--currency']!, source: text(f['--rate-source'], '--rate-source'), date: f['--rate-date']! } } : {}),
    });
    const dir = f['--out'] ?? dirname(recordFile);
    const out = [join(dir, `${made.number}.json`), join(dir, `${made.number}.html`)];
    const tmp = out.map((p) => `${p}.${process.pid}.tmp`);
    temps.push(...tmp, `${sellerFile}.${process.pid}.tmp`);
    writeFileSync(tmp[0]!, made.json);
    writeFileSync(tmp[1]!, made.html);
    if (!made.reused) {
      // The commit point: the register and the next number move together, in one rename. A crash after it leaves the
      // number in the register, and the next run writes the same document again.
      const entry: Issued = { number: made.number, series: made.series, kind: made.doc.kind, commitmentId: made.doc.deal.commitmentId, credits: made.doc.credits?.number ?? null, issueDate: made.doc.issueDate, sha256: made.sha256, recordSha256: made.doc.source.recordSha256 };
      const numbering = { ...raw.numbering, [made.series]: { ...raw.numbering[made.series], next: (seller.numbering[made.series] ?? seller.numbering.invoice).next + 1 } };
      const next = { ...raw, numbering, issued: [...seller.issued, entry] };
      writeFileSync(`${sellerFile}.${process.pid}.tmp`, `${JSON.stringify(next, null, 2)}\n`);
      renameSync(`${sellerFile}.${process.pid}.tmp`, sellerFile);
      committed = made.number;
    }
    renameSync(tmp[0]!, out[0]!);
    renameSync(tmp[1]!, out[1]!);
    const what = made.doc.kind === 'invoice' ? 'invoice' : 'credit note';
    io.out(`${made.reused ? `Wrote ${what} ${made.number} again, the same document as issued` : `Issued ${what} ${made.number}`}: ${out.join(' and ')}. ${made.doc.totals.total.decimal ?? made.doc.totals.total.base} ${made.doc.token.symbol ?? 'base units'} for deal ${made.doc.deal.commitmentId.slice(0, 10)}.`);
    if (made.gap > 0) io.err(`Note: ${made.gap} number${made.gap === 1 ? '' : 's'} before ${made.number} in this series ${made.gap === 1 ? 'was' : 'were'} not issued by this command. If you issued them elsewhere, keep them in your books; if not, your series has a gap.`);
    return 0;
  } catch (e) {
    if (e instanceof Stop) {
      io.err(`seller-invoice: ${e.message}.${e.code === 2 ? `\n${USAGE}` : ''}\nseller-invoice: wrote nothing.`);
      return e.code;
    }
    for (const f of temps) if (existsSync(f)) unlinkSync(f);
    const why = plain(e instanceof Error ? e.message : String(e)).slice(0, 300);
    io.err(committed ? `seller-invoice: ${committed} is in your register, but writing its files failed: ${why}. Run the same command again to write the same document.` : `seller-invoice: could not run: ${why}. Nothing was issued.`);
    return 2;
  } finally {
    if (lock && existsSync(lock)) unlinkSync(lock);
  }
}

if (isMain(import.meta.url, 'seller-invoice')) main(process.argv.slice(2)).then((code) => (process.exitCode = code));

// `deliver` (T-568): one pass over the funded deals of a folder that sells from a template, then the command exits.
// Nothing tells a seller that a deal was funded (webhooks answer 501), so the person's own machine runs this pass on a
// schedule; `deliver --schedule` prints the entry for the machine's scheduler and installs nothing.
//
//   1. The check (setup-check.ts), as first-deal runs it: a folder that fails it delivers nothing.
//   2. The deals: the open deals of the adapter's journal, and every deal that each operator lists as Held with one of
//      the folder's addresses as its seller (GET /v1/commitments?party=&role=seller&escrowState=Held). A listed deal
//      the journal does not hold joins it only when it is exactly the offer this folder makes: every operator serves
//      the same terms, their commitment ID is the deal's, the seller's signature over them recovers to the folder's
//      address, and they equal, field for field, the terms the folder's adapter would sign for that buyer at that time
//      (its payout address, template, price, club, adjudicators and windows). Any other is declined: named, and left to
//      end in the buyer's refund. The folder's finished work (work/ready.<ext>) goes to every deal it delivers, so a
//      deal its key signed elsewhere, for another price or other adjudicators, must not get it.
//   3. The adapter's own pass, once (seller-adapter-core.ts, unchanged), against the work API on the loopback address
//      (setup-work-api.ts): for each deal every operator shows Held, it runs the agreed checks on the deal's work file,
//      holds a file that fails and names each failing check, and delivers one that passes. It reads the settlement
//      layer before any delivery, so a second pass delivers nothing twice.
//   4. The takes of the folder's standing offers (T-552, ADR-0040): every deal each operator lists as Held with the
//      seller contract as its seller. A take joins only when its seller signature is exactly a take of a template this
//      folder signed (crow.json's `standing`), and its terms are that template filled for its buyer (core's takeTerms),
//      under its commitment ID. A take of a template with a standing delivery needs nothing here: the buyer posts it.
//      Otherwise the take's work file (work/<commitment ID>.<ext>) must pass the agreed checks; then the key signs the
//      delivery for its contract (the contract's key path), sealed to the three adjudicators and the buyer. A take whose
//      every operator already records a delivery is not delivered again. The adapter is not used: it signs only for the
//      key's own address and its deal keys.
//   5. One line per deal, then one last line with the deals delivered, still due and declined.
//
// One operator that fails a read stops no delivery of the journal's deals: its line names it, and the pass goes on.
// The whole pass ends within PASS_LIMIT_MS, under the schedule's interval, so a hung operator holds the folder's lock
// for one pass only.
//
// Exit 0: nothing is due. Exit 4: a funded deal still waits for its work, named in its line. Exit 1: a step failed,
// another run holds the folder, or the pass ran out of time; the next pass tries again.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { decodeStandingSignature, TAKE, encodeStandingSignature, takeTerms, type TakeFill, type Timestamp } from '@holdback/core';
import { recoverTypedDataAddress, type Hex } from 'viem';
import { Agent } from './agent.ts';
import { checkDelivery } from './check-delivery.ts';
import { plain as plainLine } from './plain.ts';
import { reasonLine } from './seller-refusal.ts';
import { acceptanceFor, createSellerAdapter, dealKeyOf, loadConfig, pinnedSeller, type Deal, type Journal, type SellerAdapterConfig } from './seller-adapter.ts';
import { runChecks } from './setup-check.ts';
import { startWorkApi, WORK_CREDENTIAL_ENV, workFor } from './setup-work-api.ts';
import { addressOf, FILES, locked, pinnedReader, readKey, readState, realPath, writeWhole, type Call, type J, type Pin, type StandingRecord, type State } from './setup-seller.ts';
import { commitmentIdOf, jcs, publicOfferTerms, typedOf, verifyPrepared } from './verify.ts';

const plain = (s: unknown, max = 300) => plainLine(String(s ?? '')).slice(0, max);
/** The exit status of a pass after which a funded deal still waits for its work. */
const DUE = 4;
/** How often the printed schedule runs a pass. */
const EVERY_MINUTES = 5;
/** The longest a pass runs: a minute under the schedule's interval. */
const PASS_LIMIT_MS = (EVERY_MINUTES - 1) * 60_000;
/** The adapter's stages in which a deal is still open (seller-adapter-core.ts). */
const OPEN_STAGES = ['offered', 'starting', 'start-unknown', 'started', 'refused', 'delivering'];
const COMMITMENT_ID = /^0x[0-9a-f]{64}$/;
/** At most this many pages of 200 deals are read for each address from each operator. */
const MAX_PAGES = 10;
/** The variables the setup refuses to run with (setup.ts): the printed entry clears them before Node starts. */
const NODE_SETTINGS = ['NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'NODE_USE_ENV_PROXY'];

/**
 * The addresses the folder sells as, each with how its deals are checked: the key's own address, whose signature over
 * terms recovers (`signedBy`), and each seller contract a `publish` of this key made (T-552), whose deals are takes
 * of the folder's own templates (`takeAdmission`).
 */
export function sellerAddressesOf(key: Hex, state?: Pick<State, 'standing'>): Array<{ address: string; kind: 'key' | 'standing' }> {
  const own = addressOf(key);
  const contracts = [...new Set((state?.standing ?? []).filter((r) => r.key === own).map((r) => r.seller))];
  return [{ address: own, kind: 'key' }, ...contracts.map((address) => ({ address, kind: 'standing' as const }))];
}

/** Whether the seller signature in `served` is `seller`'s over `terms`, under the pinned domain. */
async function signedBy(served: J, terms: J, seller: { address: string }, pin: Pin): Promise<boolean> {
  const signature = served?.signatures?.seller;
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]+$/.test(signature)) return false;
  const by = await recoverTypedDataAddress({ ...typedOf('CommitmentTerms', terms, pin.domain), signature: signature as Hex }).catch(() => null);
  return by !== null && by.toLowerCase() === seller.address;
}

/**
 * The commitment IDs the operators list as Held with `address` as the seller: the union, so no one operator can hide
 * a deal. An operator whose read fails is named in `failures`, and the others' lists still count.
 */
async function heldDealsOf(reader: Agent, address: string): Promise<{ ids: string[]; failures: Array<{ operator: string; detail: string }>; cut: boolean }> {
  const ids = new Set<string>();
  const failures: Array<{ operator: string; detail: string }> = [];
  let cut = false;
  for (const op of reader.sources()) {
    try {
      let cursor: string | null = null;
      for (let page = 0; ; page++) {
        if (page === MAX_PAGES) {
          cut = true;
          break;
        }
        const answer: J = await reader.call('GET', `/v1/commitments?party=${address}&role=seller&escrowState=Held&limit=200${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`, undefined, op);
        for (const item of Array.isArray(answer?.items) ? answer.items : []) {
          const id = String(item?.commitmentId ?? '').toLowerCase();
          if (COMMITMENT_ID.test(id)) ids.add(id);
        }
        cursor = typeof answer?.nextCursor === 'string' && answer.nextCursor !== '' ? answer.nextCursor : null;
        if (cursor === null) break;
      }
    } catch (e) {
      failures.push({ operator: plain(op, 200), detail: plain((e as Error).message, 300) });
    }
  }
  return { ids: [...ids], failures, cut };
}

/** What the folder's adapter signs, beside a buyer's own fields: read once a pass, and only when a listed deal needs it. */
interface Offer {
  config: SellerAdapterConfig;
  template: J;
  price: { token: string; amount: string };
  clubId: string;
  adjudicators: { primary: string; fallback: string; appeal: string };
  registration: J;
  rulebookHash: Hex;
}

/**
 * Why the listed deal `id` is not exactly the offer this folder makes; '' when it is. Its terms are read from every
 * operator, which must serve the same ones. Throws when they cannot be read.
 */
async function admission(id: string, x: { reader: Agent; pin: Pin; sellers: Array<{ address: string }>; payout: string; offer: () => Promise<Offer> }): Promise<{ why: string; terms: J; seller: string }> {
  const served = await x.reader.trusted<J>(`/v1/commitments/${id}/terms`);
  const terms = Object.fromEntries(Object.entries(served ?? {}).filter(([k]) => k !== 'id' && k !== 'signatures')) as J;
  const lc = (v: unknown) => String(v ?? '').toLowerCase();
  const seller = x.sellers.find((s) => s.address === lc(terms.seller));
  const said = { terms, seller: plain(lc(terms.seller), 42) };
  if (commitmentIdOf(terms) !== id || lc(served?.id) !== id) return { ...said, why: 'the terms the operators serve are not the ones its commitment ID names' };
  if (!seller) return { ...said, why: `its seller ${said.seller} is none of this folder's addresses` };
  if (!(await signedBy(served, terms, seller, x.pin))) return { ...said, why: `the seller signature the operators serve is not ${seller.address}'s over these terms` };
  if (lc(terms.sellerPayoutAddress) !== x.payout) return { ...said, why: `it pays ${plain(lc(terms.sellerPayoutAddress), 42)}, not this folder's payout address ${x.payout}` };
  const o = await x.offer();
  const built = acceptanceFor(o.config, o.template, {}, undefined);
  if (jcs({ d: terms.deliverable ?? null, a: terms.acceptance ?? null }) !== jcs({ d: built.deliverable, a: built.acceptance })) return { ...said, why: "its deliverable or its checks are not this folder's template" };
  if (jcs({ token: lc(terms.price?.token), amount: terms.price?.amount }) !== jcs({ token: lc(o.price.token), amount: o.price.amount })) return { ...said, why: `its price is ${plain(terms.price?.amount, 80)} base units of ${plain(terms.price?.token, 42)}, not this folder's ${o.price.amount} of ${o.price.token}` };
  // The rest, field for field: the terms the adapter signs for this buyer at this time (verify.ts, publicOfferTerms).
  let want: J;
  try {
    want = publicOfferTerms({
      template: 'checks-only', clubId: o.clubId, seller: terms.seller,
      buyer: { address: terms.buyer, encryptionPublicKey: terms.buyerEncryptionPublicKey, paymentAddress: terms.buyerPaymentAddress },
      sellerPayoutAddress: x.payout, adjudicators: o.adjudicators, price: o.price, deliverable: built.deliverable, checks: built.acceptance.deterministicChecks, timing: o.config.timing,
    }, o.registration, o.rulebookHash, terms.createdAt, terms.nonce);
  } catch (e) {
    return { ...said, why: `its terms cannot be rebuilt as this folder's offer: ${plain((e as Error).message, 200)}` };
  }
  const differ = Object.keys({ ...want, ...terms }).filter((k) => jcs(want[k] ?? null) !== jcs(terms[k] ?? null));
  if (differ.length) return { ...said, why: `its ${differ.slice(0, 4).map((k) => plain(k, 40)).join(', ')} ${differ.length === 1 ? 'differs' : 'differ'} from the offer this folder makes` };
  return { ...said, why: '' };
}

/**
 * The template of this folder that the listed take `id` of the contract `seller` fills, or why there is none. Its terms
 * are read from every operator. A take joins only when its seller signature is the one this folder's template and
 * signature give for the take's own fill, and its terms are that template filled for its buyer: the take's own rule
 * (ADR-0040 §1), in place of the per-buyer offer's rebuild. Throws when the terms cannot be read.
 */
async function takeAdmission(id: string, x: { reader: Agent; seller: string; records: StandingRecord[] }): Promise<{ why: string; terms: J; record?: StandingRecord }> {
  const served = await x.reader.trusted<J>(`/v1/commitments/${id}/terms`);
  const terms = Object.fromEntries(Object.entries(served ?? {}).filter(([k]) => k !== 'id' && k !== 'signatures')) as J;
  const lc = (v: unknown) => String(v ?? '').toLowerCase();
  if (commitmentIdOf(terms) !== id || lc(served?.id) !== id) return { terms, why: 'the terms the operators serve are not the ones its commitment ID names' };
  if (lc(terms.seller) !== x.seller) return { terms, why: `its seller ${plain(lc(terms.seller), 42)} is not this folder's seller contract ${x.seller}` };
  const signature = String(served?.signatures?.seller ?? '');
  const blob = /^0x[0-9a-fA-F]+$/.test(signature) ? decodeStandingSignature(signature as Hex) : null;
  if (!blob || blob.kind !== TAKE) return { terms, why: 'its seller signature is not a take of a standing offer' };
  const fill: TakeFill = { buyer: lc(terms.buyer) as TakeFill['buyer'], buyerPaymentAddress: lc(terms.buyerPaymentAddress) as TakeFill['buyer'], buyerEncryptionPublicKey: String(terms.buyerEncryptionPublicKey), nonceSeed: lc(blob.fill.nonceSeed) as TakeFill['nonceSeed'], createdAt: String(terms.createdAt) as Timestamp };
  for (const r of x.records.filter((r) => r.seller === x.seller)) {
    let mine: string;
    try {
      mine = lc(encodeStandingSignature(TAKE, r.template, r.signature, fill));
    } catch {
      continue;
    }
    if (mine !== lc(signature)) continue;
    if (commitmentIdOf(takeTerms(r.template, fill, r.seller as TakeFill['buyer'])) !== id) return { terms, why: `its terms are not the template ${plain(r.template.offerId, 80)} filled for its buyer` };
    return { terms, why: '', record: r };
  }
  return { terms, why: 'it is a take of no template this folder signed' };
}

/** What became of one take this pass. */
type TakeOutcome = { delivered?: true; due?: true; failed?: true; line: Record<string, unknown> };

/**
 * One take of the folder's own template, delivered when its work is there and passes the agreed checks. The key signs
 * the delivery for its contract: the contract's key path approves the key's own signature (ADR-0040 §1, first row).
 */
async function deliverTake(c: Call, id: string, terms: J, r: StandingRecord, x: { key: Hex; pin: Pin; reader: Agent; format: string }): Promise<TakeOutcome> {
  const line = { step: 'deliver', commitmentId: id, take: true, seller: r.seller, offerId: plain(r.template.offerId, 80) };
  const deliverBy = plain(terms?.timing?.deliverBy, 40);
  if (r.template.delivery) return { line: { ...line, ok: true, state: 'Held', standing: true, detail: "This take's template carries the finished work: its buyer posts the standing delivery (take.mjs), and nothing is due here." } };
  // Every operator's own record: a take whose delivery one operator already shows is not delivered twice.
  const states = await Promise.all(x.reader.sources().map((op) => x.reader.call('GET', `/v1/commitments/${id}`, undefined, op).then((s: J) => String(s.escrowState))));
  const recorded = await Promise.all(x.reader.sources().map((op) => x.reader.call('GET', `/v1/commitments/${id}/events?limit=200`, undefined, op).then((e: J) => Array.isArray(e?.items) && e.items.some((i: J) => i?.type === 'delivery.submitted'), () => false)));
  if (recorded.some(Boolean)) return { line: { ...line, ok: true, state: plain(states[0], 40), detail: 'An operator already records a delivery for this take: nothing is delivered again.' } };
  if (!states.every((s) => s === 'Held')) return { failed: true, line: { ...line, ok: false, state: states.map((s) => plain(s, 40)).join(' / '), detail: 'The operators do not all show this take Held: nothing was delivered. The next pass reads it again.' } };
  const file = workFor(c.folder, id, x.format);
  const held = { ...line, state: 'Held', due: true, deliverBy, workPath: file.path };
  if (file.problem) return { due: true, line: { ...held, ok: false, detail: `The work cannot be delivered as it is: ${plain(file.problem, 400)}. Correct it before ${deliverBy}.` } };
  if (!file.bytes) return { due: true, line: { ...held, ok: true, detail: `Funded and waiting for the work: put it at ${file.path} before ${deliverBy}. After the deadline the buyer may take its money back.` } };
  // The take's own agreed checks, on the file, before anything is sealed or signed.
  const termsFile = join(c.folder, 'sample', `take-${id.slice(2, 18)}.terms.json`);
  mkdirSync(join(c.folder, 'sample'), { recursive: true });
  writeWhole(termsFile, `${JSON.stringify({ deliverable: terms.deliverable, acceptance: terms.acceptance }, null, 2)}\n`);
  const checked = checkDelivery({ terms: termsFile, file: file.from ?? file.path });
  rmSync(termsFile, { force: true });
  if (checked.exitCode !== 0) return { due: true, line: { ...held, ok: false, failed: checked.lines.filter((l) => /^ {2}(FAIL|OPEN)/.test(l)).map((l) => plain(l, 300)), detail: `The work at ${plain(file.from ?? file.path, 300)} was not delivered: ${plain(checked.lines[0], 300)}. Correct the file before ${deliverBy}; the next pass checks it again.` } };
  const agent = new Agent(c.operators, x.key, new Uint8Array(32), x.pin.domain, x.pin.chain);
  const { prepared, intent } = await agent.prepareDelivery(terms, file.bytes);
  const v = verifyPrepared(prepared, intent, r.seller, x.pin.domain, await agent.settlementNow());
  if (v.toSign.length !== 1 || v.toSign[0]!.slot !== 'signature') throw new Error(`the prepared delivery asks the seller contract for ${v.toSign.length} signatures, not the delivery's one`);
  v.body.signature = await agent.account.signTypedData(v.toSign[0]!.typed);
  const out: J = await agent.call('POST', v.path, v.body);
  return { delivered: true, line: { ...line, ok: true, state: plain(out?.escrowState ?? 'Delivered', 40), detail: `Delivered ${file.bytes.length} bytes from ${plain(file.from ?? file.path, 300)}, signed by the key for its seller contract. The agreed checks and the adjudicator decide.` } };
}

/** A shell word: the text in single quotes, each single quote in it closed, escaped and opened again. */
const shellWord = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
const xmlText = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The crontab entry that runs `command` every EVERY_MINUTES minutes, or undefined when one of `words` (the paths and
 * flag values in it, before quoting) holds % or a backslash. cron reads % as a line break and a backslash before it as
 * an escape, which implementations read differently, so such an entry is refused, never escaped. The words are tested,
 * not the command: the quoting of a single quote ('\'') writes a backslash of its own.
 */
export function cronEntry(words: readonly string[], command: string): string | undefined {
  return words.some((w) => /[%\\]/.test(w)) ? undefined : `*/${EVERY_MINUTES} * * * * ${command}`;
}

/** `deliver --schedule`: the entry for this machine's scheduler, printed. It installs nothing and sends nothing. */
function schedule(c: Call, state: State): number {
  // Node's own path is argv[0], and this file's argv[1].
  const [nodePath, self] = process.argv;
  const file = self === undefined ? undefined : realPath(resolve(self));
  if (nodePath === undefined || file === undefined) throw new Error('this process names no file of its own, so no schedule can name it');
  const given = c.flags.get('--operators');
  const operators = given === undefined ? undefined : c.operators.join(',');
  const log = join(c.folder, 'deliver.log');
  // The words the entry takes from this machine and the flags, before any quoting.
  const words = [nodePath, file, c.folder, log, ...(operators === undefined ? [] : [operators])];
  const args = ['deliver', '--folder', shellWord(c.folder), ...(c.testWorld ? ['--test-world'] : []), ...(operators === undefined ? [] : ['--operators', shellWord(operators)])];
  // Node starts without the settings the setup refuses, by its full path. Each pass replaces the log, so it holds the
  // last pass's lines; the journal and deals/ keep the history.
  const command = `/usr/bin/env ${NODE_SETTINGS.map((n) => `-u ${n}`).join(' ')} ${shellWord(nodePath)} ${shellWord(file)} ${args.join(' ')} > ${shellWord(log)} 2>&1`;
  // A line break would end a crontab entry and start another: no path or flag in the entry may hold a control character.
  if (words.some((w) => /[\x00-\x1f\x7f]/.test(w))) {
    c.say({ step: 'schedule', ok: false, detail: 'A path or a flag in the entry holds a line break or another control character, which a scheduler entry cannot carry. Move the folder or this file to a path without one. Nothing was printed to install.' });
    return 1;
  }
  const line = { step: 'schedule', ok: true, everyMinutes: EVERY_MINUTES, command, log, sent: 'nothing', installed: 'nothing' };
  const node = `It runs this Node, ${nodePath}, by its path: print the entry again after moving or removing it.`;
  if (process.platform === 'darwin') {
    const label = `direct.crow.deliver.${plain(state.name, 40).replace(/[^a-z0-9-]/g, '')}-${createHash('sha256').update(c.folder).digest('hex').slice(0, 8)}`;
    const plist = join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
    c.say({
      ...line, scheduler: 'launchd', file: plist,
      plist: `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>/bin/sh</string><string>-c</string><string>${xmlText(command)}</string></array><key>StartInterval</key><integer>${EVERY_MINUTES * 60}</integer><key>RunAtLoad</key><true/></dict></plist>`,
      load: `launchctl bootstrap gui/$(id -u) ${shellWord(plist)}`,
      detail: `Save plist as ${plist}, making the folder if it is not there, then run load: launchd runs the pass every ${EVERY_MINUTES} minutes while this user is logged in. launchctl bootout with the same arguments stops it. ${node}`,
    });
  } else if (process.platform === 'win32') {
    c.say({ ...line, scheduler: 'none', detail: `This version prints an entry for cron and launchd only. Run deliver every ${EVERY_MINUTES} minutes with this machine's own scheduler.` });
  } else {
    const entry = cronEntry(words, command);
    if (entry === undefined) {
      c.say({ step: 'schedule', ok: false, detail: 'A path or a flag in the entry holds % or a backslash, which cron reads as a line break or an escape. Move the folder or this file to a path without one. Nothing was printed to install.' });
      return 1;
    }
    c.say({ ...line, scheduler: 'cron', entry, detail: `Add entry as one line with crontab -e. Deleting the line stops it. ${node}` });
  }
  return 0;
}

/** `work`, or `late()` once `ms` have passed, whichever comes first. */
export function withDeadline<T>(work: Promise<T>, ms: number, late: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ran = new Promise<T>((resolve) => (timer = setTimeout(() => resolve(late()), ms)));
  return Promise.race([work, ran]).finally(() => clearTimeout(timer));
}

/** `deliver`: one pass, or with --schedule the scheduler's entry. */
export async function deliver(c: Call): Promise<number> {
  const state = readState(c.folder);
  if (!state || !state.payout || !state.address) {
    c.say({ step: 'deliver', ok: false, detail: `${c.folder} has no finished ${FILES.state}: run the seller command first. Nothing was sent.` });
    return 1;
  }
  if (state.sells !== 'template' || !state.work) {
    c.say({ step: 'deliver', ok: false, detail: "This folder sells Crow's sample, whose first deal delivers itself: deliver serves a folder that sells from a template. Nothing was sent." });
    return 1;
  }
  if (c.flags.has('--schedule')) return schedule(c, state);
  return locked(c.folder, 0, () =>
    withDeadline(pass(c, state), PASS_LIMIT_MS, () => {
      // A read that never ends: the pass stops here, and the process ends with it. A step the adapter recorded as
      // started is read from the settlement layer by the next pass before anything is delivered again.
      c.say({ step: 'deliver', ok: false, detail: `The pass ran out of time after ${PASS_LIMIT_MS / 1000} s, waiting for an operator; the next pass tries again.` });
      rmSync(join(c.folder, FILES.lock), { force: true });
      setTimeout(() => process.exit(1), 1000).unref();
      return 1;
    }),
  );
}

async function pass(c: Call, state: State): Promise<number> {
  // 1. The check first, as first-deal runs it: a folder that fails it delivers nothing.
  const failedChecks = (await runChecks(c.folder)).filter((r) => !r.ok);
  if (failedChecks.length) {
    for (const r of failedChecks) c.say({ step: 'check', ...r });
    c.say({ step: 'deliver', ok: false, detail: `The check fails (${failedChecks.map((r) => r.check).join(', ')}): fix it, then run check. Nothing was delivered.` });
    return 1;
  }
  const key = readKey(c.folder);
  const payout = state.payout!.address;
  const work = state.work!;
  const journalFile = join(c.folder, FILES.journal);
  const loadJournal = (): Journal | undefined => (existsSync(journalFile) ? (JSON.parse(readFileSync(journalFile, 'utf8')) as Journal) : undefined);
  const saveJournal = (j: Journal) => writeWhole(journalFile, JSON.stringify(j, null, 2));
  const { reader, pin } = await pinnedReader(c, 'Nothing was delivered');
  const config = loadConfig(join(c.folder, FILES.configuration));

  // 2. The deals: the journal's open ones, and the funded ones the operators list for the folder's addresses.
  const journal: Journal = loadJournal() ?? { deals: {}, quotes: {} };
  const open = new Set(Object.values(journal.deals).filter((d) => OPEN_STAGES.includes(d.stage)).map((d) => d.id as string));
  const sellers = sellerAddressesOf(key, state);
  const found = new Map<string, string>(); // commitment ID -> the seller address it was found under
  const takes = new Map<string, string>(); // commitment ID -> the seller contract it was listed under (T-552)
  const due: string[] = [], declined: string[] = [];
  let failed = false;
  for (const s of sellers) {
    const listed = await heldDealsOf(reader, s.address);
    for (const f of listed.failures) {
      failed = true;
      c.say({ step: 'deliver', ok: false, operator: f.operator, detail: `This operator's list of funded deals could not be read: ${f.detail}. The other operators' lists and the journal's deals go on.` });
    }
    if (listed.cut) {
      failed = true;
      c.say({ step: 'deliver', ok: false, seller: s.address, detail: `An operator lists more than ${MAX_PAGES * 200} funded deals for ${s.address}; this pass read the first ${MAX_PAGES * 200}.` });
    }
    for (const id of listed.ids) if (!Object.hasOwn(journal.deals, id)) (s.kind === 'standing' ? takes : found).set(id, s.address);
  }
  let offer: Promise<Offer> | undefined;
  const offerOf = () =>
    (offer ??= (async () => {
      const { discovered } = await pinnedSeller(c.operators, key);
      const clubId = String(config.clubId ?? discovered.clubId);
      const adjudicators = (config.adjudicators ?? discovered.adjudicators) as Offer['adjudicators'];
      return { config, template: JSON.parse(readFileSync(join(c.folder, FILES.template), 'utf8')), price: { token: pin.token.id, amount: work.price }, clubId, adjudicators, registration: await reader.registration(adjudicators.primary), rulebookHash: await reader.rulebookHash(clubId) };
    })());
  for (const [id, address] of found) {
    try {
      const { why, terms, seller } = await admission(id, { reader, pin, sellers: sellers.filter((s) => s.kind === 'key'), payout, offer: offerOf });
      if (why) {
        // Listed under the folder's address and not exactly this folder's offer: declined, with its deadline.
        declined.push(id);
        c.say({ step: 'deliver', ok: false, commitmentId: id, found: true, seller, declined: true, deliverBy: plain(terms?.timing?.deliverBy, 40), detail: `Not this folder's offer: ${plain(why, 400)}. Nothing was delivered for it; once deliverBy passes, its buyer may take its money back.` });
        continue;
      }
      journal.deals[id] = { id: id as Hex, stage: 'offered', terms, scope: {}, quoteId: 'template', note: "found on the operators: a funded deal of this folder's key that the journal did not hold", times: { offered: new Date().toISOString() } } as Deal;
      open.add(id);
    } catch (e) {
      failed = true;
      found.delete(id);
      c.say({ step: 'deliver', ok: false, commitmentId: id, found: true, seller: address, detail: `Its terms could not be read from every operator: ${plain((e as Error).message, 300)}. Nothing was delivered for it; the next pass tries again.` });
    }
  }
  // 4. The takes of the folder's standing offers: each one this folder's own template fills is delivered here.
  const delivered: string[] = [];
  for (const [id, seller] of takes) {
    try {
      const { why, terms, record } = await takeAdmission(id, { reader, seller, records: state.standing ?? [] });
      if (why || !record) {
        declined.push(id);
        c.say({ step: 'deliver', ok: false, commitmentId: id, take: true, seller, declined: true, deliverBy: plain(terms?.timing?.deliverBy, 40), detail: `Not a take of this folder's standing offer: ${plain(why, 400)}. Nothing was delivered for it; once deliverBy passes, its buyer may take its money back.` });
        continue;
      }
      const t = await deliverTake(c, id, terms, record, { key, pin, reader, format: work.format });
      if (t.delivered) delivered.push(id);
      if (t.due) due.push(id);
      if (t.failed) failed = true;
      c.say(t.line);
    } catch (e) {
      failed = true;
      c.say({ step: 'deliver', ok: false, commitmentId: id, take: true, seller, detail: `This take could not be delivered this pass: ${plain((e as Error).message, 300)}. The next pass tries again.` });
    }
  }
  if (open.size === 0) return summary(c, delivered, due, declined, failed);
  saveJournal(journal);
  for (const d of Object.values(journal.deals)) if (open.has(d.id) && /^0x[0-9a-f]{64}$/.test(String(d.terms?.nonce))) c.hide(dealKeyOf(key, d.terms.nonce as Hex));

  // 3. The adapter's own pass, once, against the work API on the folder's port. Each credential is this run's.
  const quote = randomBytes(24).toString('base64url'), credential = randomBytes(24).toString('base64url');
  c.hide(quote, true);
  c.hide(credential, true);
  const waits = new Map<string, string>(); // what the adapter logged when a deal's step failed this pass
  const run = {
    ...config, journal: journalFile, quoteAuth: { kind: 'bearer' as const, env: 'CROW_SETUP_QUOTE' },
    log: (line: string) => {
      const wait = /^\S+ (0x[0-9a-f]{64}) waits at [a-z-]+: (.*)\. The adapter tries again at the next poll\.$/.exec(line);
      if (wait) waits.set(wait[1]!, wait[2]!);
      c.note({ step: 'adapter', log: line });
    },
  };
  const api = await startWorkApi({ token: pin.token.id, price: work.price, folder: c.folder, format: work.format, credential, port: Number(new URL(String(config.sellerApi.quote)).port) });
  let after: Deal[];
  try {
    const core = await createSellerAdapter(run, { HOLDBACK_KEY: key, HOLDBACK_OPERATORS: c.operators.join(','), CROW_SETUP_QUOTE: quote, [WORK_CREDENTIAL_ENV]: credential }, { readText: (p) => readFileSync(p, 'utf8'), loadJournal, saveJournal, journalPath: resolve(journalFile) });
    core.wake();
    await core.idle();
    await core.close();
    after = core.deals();
  } finally {
    await api.close();
  }

  // 5. One line per deal that was open.
  for (const d of after) {
    const id = d.id as string;
    if (!open.has(id)) continue;
    const line = { step: 'deliver', commitmentId: id, ...(found.has(id) ? { found: true, seller: found.get(id) } : {}) };
    const deliverBy = plain(d.terms?.timing?.deliverBy, 40);
    if (waits.has(id) && d.stage !== 'delivered' && d.stage !== 'closed') {
      // The adapter's step failed this pass, whatever the stage: the deal waits, and the pass counts as failed.
      failed = true;
      if (d.stage !== 'offered') due.push(id);
      c.say({ ...line, ok: false, ...(d.stage === 'offered' ? {} : { state: 'Held', due: true, deliverBy }), detail: `This pass could not move the deal: ${plain(waits.get(id), 400)}. The next pass tries again.` });
    } else if (d.stage === 'delivered') {
      delivered.push(id);
      const first = state.firstDeal?.commitmentId === id && state.firstDeal.state === undefined;
      c.say({ ...line, ok: true, state: 'Delivered', detail: `Delivered: ${plain(d.note, 200)}. The agreed checks and the adjudicator decide.${first ? ' Run first-deal again to write its deal record.' : ''}` });
    } else if (d.stage === 'closed') {
      c.say({ ...line, ok: true, state: 'Closed', detail: plain(d.note, 400) });
    } else if (d.stage === 'offered') {
      c.say({ ...line, ok: true, funded: false, detail: 'Not funded yet: nothing is due.' });
    } else {
      // Held: the deal waits for its work, or holds a file that failed a check.
      due.push(id);
      const file = workFor(c.folder, id, work.format);
      const held = { ...line, state: 'Held', due: true, deliverBy, workPath: file.path };
      if (d.stage === 'refused') {
        const checks = (d.reason?.checks ?? []).map((k) => ({ check: plain(k.checkId, 60), required: k.required, outcome: k.outcome, message: plain(k.message, 300) }));
        c.say({ ...held, ok: false, failed: checks, detail: `The work at ${plain(file.from ?? file.path, 300)} was not delivered: ${d.reason ? plain(reasonLine(d.reason), 600) : 'it failed the agreed checks'}. Correct the file before ${deliverBy}; the next pass checks it again.` });
      } else if (file.problem) {
        c.say({ ...held, ok: false, detail: `The work cannot be delivered as it is: ${plain(file.problem, 400)}. Correct it before ${deliverBy}.` });
      } else {
        c.say({ ...held, ok: true, detail: `Funded and waiting for the work: put it at ${file.path} before ${deliverBy}. After the deadline the buyer may take its money back.` });
      }
    }
  }
  return summary(c, delivered, due, declined, failed);
}

function summary(c: Call, delivered: string[], due: string[], declined: string[], failed: boolean): number {
  const waiting = due.length ? `${due.length} funded ${due.length === 1 ? 'deal waits' : 'deals wait'} for work, each named above with its deadline.` : 'No funded deal waits for work.';
  const said = declined.length ? ` ${declined.length} listed ${declined.length === 1 ? 'deal is' : 'deals are'} not this folder's offer and ${declined.length === 1 ? 'gets' : 'get'} nothing.` : '';
  c.say({ step: 'deliver', ok: !failed, delivered, due, declined, detail: `${failed ? 'A step failed, named above; the next pass tries again. ' : ''}${waiting}${said}` });
  return failed ? 1 : due.length ? DUE : 0;
}

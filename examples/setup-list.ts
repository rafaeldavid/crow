// `node setup.mjs list --website <https URL>` (T-486, D76): the setup's listing step. Crow asks each party that sets
// Crow up to send its website, for Crow's own list of who uses it. The step is part of the setup's default path, the
// person can decline it with `list --skip`, and no deal depends on it: first-deal runs with or without it.
//
// What it sends: one POST whose body is {"website": "<url>"} and nothing else. No role, no address, no key, no folder
// name. The website is a site's own address, an origin: https, a public name, and nothing after it, so a path or a
// query cannot carry anything else along. The receiver also sees the sender's IP address, as any host does. The
// command prints what it will send, and to whom, before it sends it; it follows no redirect, so the website reaches
// only the host it named. It opens no file under keys/.
//
// What an entry means: Crow keeps the website as a potential partner. Crow may later read the site to see whether it
// publishes a Crow card. The entry proves nothing about who sent it.
//
// The folder is taken first: the command holds crow.lock from before the preview until its record is written, and
// when another run holds it (first-deal does, for a whole deal) it sends nothing and says so at once.
//
// The answer is another party's text. The command reads ANSWER_BYTES of it at most, takes from it only its status and
// whether it says ok, and never prints or keeps a word of it: a failure's reason is one of REASONS, chosen by the status.
//
// The folder's crow.json keeps what was sent, to whom, when and the answer's status; or the skip and its time. A
// failed attempt is kept apart and counts as neither a listing nor a skip.
import { plain as plainLine } from './plain.ts';
import { LockHeld, locked, readState, writeState, type Call, type J, type Listing } from './setup-seller.ts';

/** Where the listing goes unless --list-at names another receiver: Crow's sign-up Worker (apps/early-access/listing.js). */
export const LISTING_URL = 'https://join.crow.direct/listing';
const WEBSITE_CHARS = 200;
/** The most bytes of the receiver's answer the command reads. */
const ANSWER_BYTES = 4096;
/** Names that are never a public website: this machine, a local network, a private zone. */
const LOCAL_ENDINGS = ['.localhost', '.local', '.internal', '.home.arpa'];
/** One label of a host name: lower-case letters, digits and hyphens, with no hyphen at either end. */
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const plain = (s: unknown, max = 300) => plainLine(String(s ?? '')).slice(0, max);

const QUESTION = 'What is your website? Crow asks each party that sets Crow up to send its website, so Crow can keep a list of who uses it. Give an https address (--website https://your-site.example), or decline (--skip). No deal depends on the answer.';
const NO_GATE = 'No deal depends on the list: first-deal runs as before.';
/** What an entry on the list means, in the words the preview and setup.txt share. */
export const ENTRY_MEANS = 'Crow keeps the website as a potential partner. Crow may later read the site to see whether it publishes a Crow card. The entry proves nothing about who sent it. Skipping changes nothing about a deal.';

/** Why a listing was not taken: the only words a failure's line and record carry. Each is chosen by the answer's status, never read from the answer. */
export const REASONS = Object.freeze({
  refused: 'the receiver refused the request',
  noRoute: 'the receiver has no listing route at that address, so the list may not be deployed there yet',
  busy: "the receiver has taken too many requests for now, which may be another caller's doing",
  failed: 'the receiver failed',
  redirect: 'the receiver answered with a redirect, which this command does not follow',
  noAnswer: 'the receiver did not answer',
  slow: 'the receiver did not answer in time',
  notTaken: 'the receiver answered 200 with a body this command does not take',
  other: 'the receiver gave an answer this command does not know',
});
const reasonFor = (status: number): string =>
  status === 200 ? REASONS.notTaken : status >= 300 && status < 400 ? REASONS.redirect : status === 404 || status === 405 ? REASONS.noRoute : status === 429 ? REASONS.busy : status >= 400 && status < 500 ? REASONS.refused : status >= 500 && status < 600 ? REASONS.failed : REASONS.other;

/**
 * The website as the URL parser writes it, `{ website }`, or why it is refused, `{ error }`. A website is a site's own
 * address, an origin: https, a public name of lower-case letters, digits, dots and hyphens (an internationalised name
 * in its xn-- form), and nothing else: no path, query, fragment, user name, password or port. So one site is one
 * website, and nothing but a host name can ride in it. The receiver applies the same rule
 * (apps/early-access/listing.js); tests/early-access-listing.test.ts holds the two together.
 */
export function websiteOf(text: unknown): { website: string } | { error: string } {
  if (typeof text !== 'string' || text === '') return { error: "--website takes a site's https address, such as https://your-site.example" };
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return { error: "--website is not an address: give a site's https address, such as https://your-site.example" };
  }
  if (u.protocol !== 'https:') return { error: '--website must start with https://' };
  if (u.username !== '' || u.password !== '') return { error: '--website must carry no user name or password: it would be sent with it' };
  if (u.port !== '') return { error: '--website must carry no port' };
  if (u.pathname !== '/' || u.href.includes('?') || u.href.includes('#')) return { error: "--website is the site's own address and nothing after it: no path, no query and no fragment, such as https://your-site.example" };
  const host = u.hostname;
  if (host.startsWith('[') || /^\d+(\.\d+){3}$/.test(host)) return { error: '--website must name a site, not an IP address' };
  if (!host.includes('.') || !host.split('.').every((label) => LABEL.test(label))) return { error: '--website must be a public name of letters, digits, dots and hyphens, such as your-site.example' };
  if (host === 'localhost' || LOCAL_ENDINGS.some((end) => host.endsWith(end))) return { error: '--website must be a public name, such as your-site.example' };
  if (u.href.length > WEBSITE_CHARS) return { error: `--website must be at most ${WEBSITE_CHARS} characters` };
  return { website: u.href };
}

/** The folder's listing record when it is one: a website that was sent, or a skip. Anything else in its place is read as absent. */
export function listingOf(state: { listing?: unknown }): Listing | undefined {
  const l = state.listing as { skipped?: unknown; website?: unknown } | null | undefined;
  if (l === null || typeof l !== 'object' || Array.isArray(l)) return undefined;
  return l.skipped === true || typeof l.website === 'string' ? (l as Listing) : undefined;
}

/** The one advisory line first-deal prints when the folder has neither a listing nor a skip; undefined when it has one. */
export function listingAdvice(state: { listing?: unknown }): string | undefined {
  if (listingOf(state) !== undefined) return undefined;
  // "After this deal ends": first-deal holds the folder for the whole deal, and a list run meanwhile sends nothing.
  return "Crow asks each party to send its website to Crow's list of who uses it: after this deal ends, run list --website <https URL> with this file, or list --skip to decline. This deal does not depend on it and goes on.";
}

/** At most `max` bytes of a response's body as text, or null when it holds more. The rest is not read. */
async function readCapped(r: Response, max: number): Promise<string | null> {
  if (!r.body) return '';
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Runs the listing step. `o.to` is the receiver's address, already checked by the caller; it is undefined only when
 * nothing will be sent. Returns the exit status: 0 sent and taken, or the skip recorded; 1 refused, not answered, or
 * the folder is held by another run; 3 the answer is missing.
 */
export async function list(c: Call, o: { website?: string; skip: boolean; to?: string }): Promise<number> {
  if (!readState(c.folder)) {
    c.say({ step: 'list', ok: false, detail: `${c.folder} has no crow.json: run the seller command first. Nothing was sent.` });
    return 1;
  }
  if (!o.skip && o.website === undefined) {
    c.say({ step: 'list', ok: false, exit: 3, missing: [{ flag: '--website', question: QUESTION }], decline: '--skip', next: 'Ask the person, then run the same command again with --website <https URL>, or with --skip. Nothing was sent.' });
    return 3;
  }
  const w = o.skip ? undefined : websiteOf(o.website);
  if (w !== undefined && 'error' in w) {
    c.say({ step: 'list', ok: false, detail: `${w.error}. Nothing was sent.` });
    return 1;
  }
  // `asked`: the request went out. `sent`: the receiver took the website. `said`: this run printed its last line, with exit status `code`.
  let asked = false, sent = false, said = false, code = 1;
  const last = (line: Record<string, unknown>, status: number): number => {
    said = true;
    code = status;
    c.say(line);
    return status;
  };
  try {
    // The folder first, and at once: a run that waited here would send while first-deal holds the folder, and then
    // could not write its record.
    return await locked(c.folder, 0, async () => {
      const state = readState(c.folder)!;
      const before = listingOf(state);
      if (o.skip) {
        // A website that was sent stays sent: the record is kept, and the line says so.
        if (before !== undefined && 'website' in before) {
          return last({ step: 'list', ok: true, skipped: false, sent: 'nothing', website: plain(before.website, 200), detail: `This folder already sent ${plain(before.website, 200)} to the list, and this version cannot take a website off the list. The record stays. Nothing was sent now. ${NO_GATE}` }, 0);
        }
        state.listing = { skipped: true, at: new Date().toISOString() };
        writeState(c.folder, state);
        return last({ step: 'list', ok: true, skipped: true, sent: 'nothing', detail: `Recorded: this folder sends no website to the list. ${NO_GATE} To list later, run list --website <https URL>.` }, 0);
      }
      const website = (w as { website: string }).website;
      const to = o.to!;
      const body = { website };
      // What the command is about to send, and to whom, before it sends anything.
      c.say({
        step: 'preview',
        sends: [{ to, what: 'one POST with this body and nothing else: no role, no address, no key, no name.', body }],
        receiverSees: "The website and this machine's IP address. Whoever runs the receiver and the faucet, as Crow does, can tie the website to the fresh keys the same IP address asks the faucet for. It could also tie the website to this folder's deals by the time of its first offer, and through the public payout address to every deal of the folder.",
        means: ENTRY_MEANS,
        kept: "The list is Crow's own record. This version publishes nothing from it and has no command that takes a website off it.",
      });

      let status: number | null = null;
      let reason = '';
      asked = true;
      try {
        // No redirect is followed: the website goes to the host the preview names and to no other. The time limit
        // covers the whole answer; a test world waits 2 s, as it shortens its other waits.
        const r = await fetch(to, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(c.testWorld ? 2000 : 15_000) });
        status = r.status;
        let ok = false;
        if (status === 200) {
          const text = await readCapped(r, ANSWER_BYTES);
          try {
            ok = text !== null && (JSON.parse(text) as J)?.ok === true;
          } catch {
            ok = false;
          }
        } else {
          await r.body?.cancel().catch(() => undefined);
        }
        if (!ok) reason = reasonFor(status);
      } catch (e) {
        reason = (e as Error)?.name === 'TimeoutError' ? REASONS.slow : REASONS.noAnswer;
      }
      const at = new Date().toISOString();
      if (reason !== '') {
        state.listingFailed = { website, to, at, status, reason };
        writeState(c.folder, state);
        return last({ step: 'list', ok: false, website, to, status, reason, detail: `Nothing was listed: ${reason}. ${NO_GATE} Run the same command again later, or list --skip.` }, 1);
      }
      sent = true;
      state.listing = { website, to, at, status: 200 };
      delete state.listingFailed;
      writeState(c.folder, state);
      return last({ step: 'list', ok: true, website, to, means: ENTRY_MEANS, detail: NO_GATE }, 0);
    });
  } catch (e) {
    if (e instanceof LockHeld) return last({ step: 'list', ok: false, detail: `Nothing was sent: another run of this command (process ${Number.isSafeInteger(e.pid) ? e.pid : 'unknown'}) is working in this folder, as first-deal does for a whole deal. Run list again when it has ended. ${NO_GATE}` }, 1);
    if (said) return code; // the line is printed; what failed after it is the lock's own removal
    const why = plain((e as Error)?.message, 200);
    if (sent) return last({ step: 'list', ok: false, sent: true, website: (w as { website: string }).website, to: o.to, detail: `The website was sent and the receiver took it, and this folder's crow.json could not be written (${why}), so the folder holds no record of it. Do not send it again: the list has it. ${NO_GATE}` }, 1);
    if (asked) return last({ step: 'list', ok: false, detail: `Nothing was listed, and this folder's crow.json could not be written (${why}). ${NO_GATE}` }, 1);
    return last({ step: 'list', ok: false, detail: `Nothing was sent: this folder could not be taken or written (${why}). ${NO_GATE}` }, 1);
  }
}

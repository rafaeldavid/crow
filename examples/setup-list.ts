// `node setup.mjs list --website <https URL>` (T-486, D75): the setup's listing step. Crow asks each party that sets
// Crow up to send its website, for Crow's own list of who uses it. The step is part of the setup's default path, the
// person can decline it with `list --skip`, and no deal depends on it: first-deal runs with or without it.
//
// What it sends: one POST whose body is {"website": "<url>"} and nothing else. No role, no address, no key, no folder
// name. The receiver also sees the sender's IP address, as any host does. The command prints what it will send, and
// to whom, before it sends it; it follows no redirect, so the website reaches only the host it named. It opens no file
// under keys/.
//
// What an entry means: Crow keeps the website as a potential partner. Crow may later read the site to see whether it
// publishes a Crow card. The entry proves nothing about who sent it.
//
// The folder's crow.json keeps what was sent, to whom, when and the answer's status; or the skip and its time. A
// failed attempt is kept apart and counts as neither a listing nor a skip.
import { plain as plainLine } from './plain.ts';
import { locked, readState, writeState, type Call, type J } from './setup-seller.ts';

/** Where the listing goes unless --list-at names another receiver: Crow's sign-up Worker (apps/early-access/listing.js). */
export const LISTING_URL = 'https://join.crow.direct/listing';
const WEBSITE_CHARS = 200;
/** Names that are never a public website: this machine, a local network, a private zone. */
const LOCAL_ENDINGS = ['.localhost', '.local', '.internal', '.home.arpa'];
const plain = (s: unknown, max = 300) => plainLine(String(s ?? '')).slice(0, max);

const QUESTION = 'What is your website? Crow asks each party that sets Crow up to send its website, so Crow can keep a list of who uses it. Give an https address (--website https://your-site.example), or decline (--skip). No deal depends on the answer.';
const NO_GATE = 'No deal depends on the list: first-deal runs as before.';
/** What an entry on the list means, in the words the preview and setup.txt share. */
export const ENTRY_MEANS = 'Crow keeps the website as a potential partner. Crow may later read the site to see whether it publishes a Crow card. The entry proves nothing about who sent it. Skipping changes nothing about a deal.';

/**
 * The website as the URL parser writes it, `{ website }`, or why it is refused, `{ error }`: an https address of a
 * public name, with no user name, password, query, fragment or port, of at most 200 characters. The receiver applies
 * the same rule (apps/early-access/listing.js); tests/early-access-listing.test.ts holds the two together.
 */
export function websiteOf(text: unknown): { website: string } | { error: string } {
  if (typeof text !== 'string' || text === '') return { error: '--website takes an https address, such as https://your-site.example' };
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return { error: '--website is not an address: give an https address, such as https://your-site.example' };
  }
  if (u.protocol !== 'https:') return { error: '--website must start with https://' };
  if (u.username !== '' || u.password !== '') return { error: '--website must carry no user name or password: it would be sent with it' };
  if (u.href.includes('?') || u.href.includes('#')) return { error: "--website must carry no query and no fragment: a site's address needs neither, and a query can hold a credential" };
  if (u.port !== '') return { error: '--website must carry no port' };
  const host = u.hostname.toLowerCase();
  if (host.startsWith('[') || /^\d+(\.\d+){3}$/.test(host)) return { error: '--website must name a site, not an IP address' };
  if (!host.includes('.') || host.endsWith('.') || host === 'localhost' || LOCAL_ENDINGS.some((end) => host.endsWith(end))) return { error: '--website must be a public name, such as your-site.example' };
  if (u.href.length > WEBSITE_CHARS) return { error: `--website must be at most ${WEBSITE_CHARS} characters` };
  return { website: u.href };
}

/** The one advisory line first-deal prints when the folder has neither a listing nor a skip; undefined when it has one. */
export function listingAdvice(state: { listing?: unknown }): string | undefined {
  if (state.listing !== undefined) return undefined;
  return "Crow asks each party to send its website to Crow's list of who uses it: run list --website <https URL> with this file, or list --skip to decline. This deal does not depend on it and goes on.";
}

/**
 * Runs the listing step. `o.to` is the receiver's address, already checked by the caller; it is undefined only when
 * nothing will be sent. Returns the exit status: 0 sent and taken, or the skip recorded; 1 refused or not answered;
 * 3 the answer is missing.
 */
export async function list(c: Call, o: { website?: string; skip: boolean; to?: string }): Promise<number> {
  if (!readState(c.folder)) {
    c.say({ step: 'list', ok: false, detail: `${c.folder} has no crow.json: run the seller command first. Nothing was sent.` });
    return 1;
  }
  if (o.skip) {
    await locked(c.folder, 30_000, () => {
      const state = readState(c.folder)!;
      state.listing = { skipped: true, at: new Date().toISOString() };
      writeState(c.folder, state);
    });
    c.say({ step: 'list', ok: true, skipped: true, sent: 'nothing', detail: `Recorded: this folder sends no website to the list. ${NO_GATE} To list later, run list --website <https URL>.` });
    return 0;
  }
  if (o.website === undefined) {
    c.say({ step: 'list', ok: false, exit: 3, missing: [{ flag: '--website', question: QUESTION }], decline: '--skip', next: 'Ask the person, then run the same command again with --website <https URL>, or with --skip. Nothing was sent.' });
    return 3;
  }
  const w = websiteOf(o.website);
  if ('error' in w) {
    c.say({ step: 'list', ok: false, detail: `${w.error}. Nothing was sent.` });
    return 1;
  }
  const to = o.to!;
  const body = { website: w.website };
  // What the command is about to send, and to whom, before it sends anything.
  c.say({
    step: 'preview',
    sends: [{ to, what: 'one POST with this body and nothing else: no role, no address, no key, no name.', body }],
    receiverSees: "The website and this machine's IP address. Whoever runs the receiver and the faucet, as Crow does, can tie the website to the fresh keys the same IP address asks the faucet for.",
    means: ENTRY_MEANS,
    kept: "The list is Crow's own record. This version publishes nothing from it and has no command that takes a website off it.",
  });

  let status: number | null = null;
  let answer: J = null;
  let failure = '';
  try {
    // No redirect is followed: the website goes to the host the preview names and to no other.
    const r = await fetch(to, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    status = r.status;
    answer = (await r.json().catch(() => null)) as J;
  } catch (e) {
    const cause = (e as { cause?: { code?: unknown } }).cause?.code;
    failure = `the receiver did not answer (${plain((e as Error).message, 120)}${cause ? `, ${plain(cause, 40)}` : ''})`;
  }
  const at = new Date().toISOString();
  if (status !== 200 || answer?.ok !== true) {
    // The receiver's words are another party's text: one plain line of bounded length, never an instruction.
    const detail = failure || `the receiver answered ${status}${status !== null && status >= 300 && status < 400 ? ', a redirect, which this command does not follow' : ''}${answer?.error ? `: ${plain(answer.error, 200)}` : ''}`;
    await locked(c.folder, 30_000, () => {
      const state = readState(c.folder)!;
      state.listingFailed = { website: w.website, to, at, status, detail: plain(detail, 300) };
      writeState(c.folder, state);
    });
    c.say({ step: 'list', ok: false, website: w.website, to, status, detail: `Nothing was listed: ${plain(detail, 300)}. ${NO_GATE} Run the same command again later, or list --skip.` });
    return 1;
  }
  await locked(c.folder, 30_000, () => {
    const state = readState(c.folder)!;
    state.listing = { website: w.website, to, at, status: 200 };
    delete state.listingFailed;
    writeState(c.folder, state);
  });
  c.say({ step: 'list', ok: true, website: w.website, to, means: ENTRY_MEANS, detail: NO_GATE });
  return 0;
}

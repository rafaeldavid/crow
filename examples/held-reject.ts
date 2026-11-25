// A buyer's move on a held reject (ADR-0051, T-619). On a deal whose terms carry a rubric, Crow's adjudicators publish a
// panel's reject at once and sign it about a day later, so the deal stays Delivered (or Escalated) meanwhile. This
// command notices that, says until when, and runs the buyer's existing moves: the early accept (POST .../accept), or
// its half of a settlement both parties sign (POST .../settlements). A new file, so the buyer's pinned bundle
// (site/buy.mjs) is unchanged. Test tokens only.
//
//   node examples/held-reject.ts <commitmentId>                       says whether a reject is held, until when, and why
//   node examples/held-reject.ts <commitmentId> --accept <delivery.json | seller adapter URL>  accepts the posted
//                                                                     delivery at the agreed price. With the signed delivery
//                                                                     the seller handed you, it opens your envelope first;
//                                                                     with its adapter's URL, it names the posted delivery
//                                                                     the adapter vouches for (D110)
//   node examples/held-reject.ts <commitmentId> --settle <toSellerBps>  prints the settlement with the buyer's signature,
//                                                                     for the seller to countersign
//   node examples/held-reject.ts <commitmentId> --submit <file>       posts a settlement both parties signed
//
// An accept names the posted delivery's hash; the relaying operator carries your envelope on chain, and you get the key
// with the payment. With the seller's signed delivery (D32) this command first opens your envelope, so you know the key
// you pay for opens. A seller on Crow's adapter shares no envelope (D110): GET <adapter>/deals/<id>/delivery, while a
// reject is held, answers the hashes of the delivery it signed. Give --accept the adapter's address (the quote URL
// without /quote): this command signs the request, checks the adapter's hash is the one both operators posted, and
// accepts naming it. It cannot check your envelope opens before you pay; the adapter that sealed it is the seller's.
// Env: HOLDBACK_KEY (the buyer's signing key, 0x and 64 hex digits), HOLDBACK_ENCRYPTION_KEY (its encryption secret
// key, base64url; for --accept only), HOLDBACK_OPERATORS (comma-separated; default Crow's two nodes), and
// HOLDBACK_CHAIN_ID with HOLDBACK_VERIFYING_CONTRACT for the EIP-712 domain, as for the other examples.
// Exit status: 0 when done (or a reject is held), 3 when no reject is held or a check refused, 2 on a wrong call, 1 on an error.
import { readFileSync } from 'node:fs';
import { Agent } from './agent.ts';
import { isMain } from './entry.ts';
import { freshNonce, Refusal, typedOf } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const ID = /^0x[0-9a-fA-F]{64}$/;
const HELD = /signs the reject at (\S+?)[,.]? /;

/** What the deal shows about a held reject: from the state read's notice and the published record. */
export interface HeldView {
  commitmentId: string;
  escrowState: string;
  /** True while a published reject is not yet signed and the deal is still open to the parties' moves. */
  held: boolean;
  /** When the adjudicator says it signs the reject (Crow's operators' notice), or null when no operator says. */
  signsAt: string | null;
  reasons: string[];
  /** The moves this state allows the buyer. */
  moves: string[];
}

/** Reads the state and the record. A reject is held when the record says reject and the deal is still Delivered or Escalated. */
export async function heldView(agent: Agent, id: string): Promise<HeldView> {
  const state = await agent.call('GET', `/v1/commitments/${id}`);
  let record: J = null;
  try {
    record = await agent.call('GET', `/v1/commitments/${id}/judgment`);
  } catch {
    record = null; // no record yet: nothing judged
  }
  const open = state.escrowState === 'Delivered' || state.escrowState === 'Escalated';
  const held = open && record?.aggregate?.decision === 'reject';
  const notice = (state.notices ?? []).map(String).find((n: string) => HELD.test(n)) as string | undefined;
  const moves = !held ? [] : state.escrowState === 'Delivered' ? ['--accept <delivery.json>', '--settle <toSellerBps>'] : ['--settle <toSellerBps>'];
  return { commitmentId: id, escrowState: state.escrowState, held, signsAt: notice ? HELD.exec(notice)![1]! : null, reasons: held ? (record.aggregate.reasons ?? []).map(String) : [], moves };
}

/** The settlement message for a split of the price, named by basis points to the seller; the key is released with any payment to the seller. */
export async function settlementFor(agent: Agent, id: string, toSellerBps: number, expiresAt: string): Promise<J> {
  if (!Number.isSafeInteger(toSellerBps) || toSellerBps < 0 || toSellerBps > 10_000) throw new Refusal('refusing: toSellerBps is a whole number from 0 to 10000');
  const terms = await agent.call('GET', `/v1/commitments/${id}/terms`);
  const events = await agent.call('GET', `/v1/commitments/${id}/events?limit=200`);
  // The event carries the posted delivery's hash, which the settlement names (ADR-0029).
  const posted = events.items.filter((e: J) => e.type === 'delivery.submitted').at(-1)?.payload;
  if (!posted?.deliveryHash) throw new Refusal(`refusing: no delivery is posted on ${id}`);
  const price = BigInt(terms.price.amount);
  const toSeller = (price * BigInt(toSellerBps)) / 10_000n;
  const payouts = [
    { to: terms.sellerPayoutAddress ?? terms.seller, amount: { token: terms.price.token, amount: toSeller.toString() } },
    { to: terms.buyerPaymentAddress ?? terms.buyer, amount: { token: terms.price.token, amount: (price - toSeller).toString() } },
  ].filter((p) => p.amount.amount !== '0');
  return { type: 'MutualSettlement', commitmentId: id, deliveryHash: String(posted.deliveryHash).toLowerCase(), payouts, releaseKey: toSeller > 0n, nonce: freshNonce(), expiresAt };
}

/** T-625: the signed delivery from the seller's adapter, asked for with this buyer's signature over the deal and the time. */
export async function deliveryFrom(agent: Agent, adapter: string, id: string): Promise<J> {
  const at = Math.floor(Date.now() / 1000);
  // A fresh nonce each request: the adapter answers each signed request once (T-625 red team L1).
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('hex');
  const signature = await agent.account.signMessage({ message: `crow.delivery:${id}:${at}:${nonce}` });
  const url = `${adapter.replace(/\/+$/, '').replace(/\/quote$/, '')}/deals/${id}/delivery?at=${at}&nonce=${nonce}&signature=${signature}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (res.status === 404) throw new Refusal(`refusing: the seller's adapter does not share this delivery with you now (404); ask the seller for its signed delivery, or settle (--settle)`);
  if (!res.ok) throw new Refusal(`refusing: the seller's adapter answered ${res.status}; try again, or ask the seller for its signed delivery`);
  const body = (await res.json()) as J;
  if (String(body?.commitmentId).toLowerCase() !== id || !/^0x[0-9a-f]{64}$/.test(String(body?.deliveryHash))) throw new Refusal('refusing: the seller\'s adapter answered no delivery hash for this deal');
  return body;
}

export async function main(args: readonly string[], env: Record<string, string | undefined> = process.env): Promise<number> {
  const [id, flag, value] = args;
  const known = [undefined, '--accept', '--settle', '--submit'];
  if (!id || !ID.test(id) || !known.includes(flag) || (flag !== undefined && !value)) {
    console.error('usage: node examples/held-reject.ts <commitmentId> [--accept <delivery.json> | --settle <toSellerBps> | --submit <file>]');
    return 2;
  }
  const key = env['HOLDBACK_KEY'];
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    console.error('HOLDBACK_KEY must be the buyer\'s signing key: 0x and 64 hex digits');
    return 2;
  }
  const enc = env['HOLDBACK_ENCRYPTION_KEY'] ? Buffer.from(env['HOLDBACK_ENCRYPTION_KEY'], 'base64url') : new Uint8Array(32);
  const operators = (env['HOLDBACK_OPERATORS'] || 'https://api.crow.direct,https://api2.crow.direct').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
  const agent = new Agent(operators, key as `0x${string}`, enc);
  const id_ = id.toLowerCase();
  try {
    const view = await heldView(agent, id_);
    if (flag === undefined) {
      console.log(JSON.stringify(view, null, 2));
      return view.held ? 0 : 3;
    }
    if (flag === '--submit') {
      const body = JSON.parse(readFileSync(value!, 'utf8'));
      if (!body.buyerSignature || !body.sellerSignature) throw new Refusal('refusing: the settlement needs both signatures, buyerSignature and sellerSignature');
      const state = await agent.call('POST', `/v1/commitments/${id_}/settlements`, body);
      console.log(JSON.stringify({ escrowState: state.escrowState }));
      return 0;
    }
    if (!view.held) throw new Refusal(`refusing: no reject is held on ${id_} (it is ${view.escrowState})`);
    if (flag === '--accept') {
      if (view.escrowState !== 'Delivered') throw new Refusal('refusing: after an escalation the buyer alone cannot accept; settle with the seller instead (--settle)');
      const terms = await agent.call('GET', `/v1/commitments/${id_}/terms`);
      if (/^https?:\/\//.test(value!)) {
        // D110: the adapter vouches for the hashes; both operators must have posted the same delivery hash.
        const vouched = await deliveryFrom(agent, value!, id_);
        const posted = await agent.trusted(`/v1/commitments/${id_}/events?limit=200`, (x) => x.items.filter((e: J) => e.type === 'delivery.submitted').at(-1)?.payload ?? null);
        if (!posted || String(posted.deliveryHash).toLowerCase() !== String(vouched.deliveryHash).toLowerCase() || Number(posted.attempt) !== Number(vouched.attempt)) {
          throw new Refusal('refusing: the delivery hash the seller\'s adapter names is not the one both operators posted');
        }
        const nonce = freshNonce();
        const prepared = await agent.call('POST', '/v1/prepare/early-accept', { commitmentId: id_, nonce });
        const state = await agent.signAndSubmit(prepared, { kind: 'early-accept', terms, nonce, deliveryHash: String(posted.deliveryHash).toLowerCase() as `0x${string}` });
        console.log(JSON.stringify({ escrowState: state.escrowState, envelopeChecked: false }));
        return 0;
      }
      if (!env['HOLDBACK_ENCRYPTION_KEY']) throw new Refusal('refusing: --accept <delivery.json> opens your own envelope first, so it needs HOLDBACK_ENCRYPTION_KEY');
      const delivery = JSON.parse(readFileSync(value!, 'utf8'));
      // The early accept checks the handed delivery against the posted one, opens this buyer's envelope in it and
      // checks the work's hash before it signs (examples/verify.ts, openOwnEnvelope).
      const state = await agent.earlyAccept(terms, delivery);
      console.log(JSON.stringify({ escrowState: state.escrowState, envelopeChecked: true }));
      return 0;
    }
    // --settle: the settlement must land before the reject is signed, so it expires at the hold's end when an operator says it.
    const expiresAt = view.signsAt ?? (await agent.call('GET', `/v1/commitments/${id_}`)).deadlines?.judgeBy;
    const m = await settlementFor(agent, id_, Number(value), expiresAt);
    const buyerSignature = await agent.account.signTypedData(typedOf('MutualSettlement', m, agent.domain));
    console.log(JSON.stringify({ ...m, buyerSignature, sellerSignature: null }, null, 2));
    return 0;
  } catch (e) {
    if (e instanceof Refusal) {
      console.error(e.message);
      return 3;
    }
    console.error(`error: ${(e as Error).message}`);
    return 1;
  }
}

if (isMain(import.meta.url, 'held-reject')) process.exitCode = await main(process.argv.slice(2));

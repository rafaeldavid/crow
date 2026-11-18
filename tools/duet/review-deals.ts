// One live security-review deal with Crow's test buyer on the Sepolia test environment (T-500), for the demo page's
// three endings. The seller is a fresh key held in memory, admitted by the faucet; it needs no tUSDC and no Sepolia
// ETH, since the buyer pays and the operators relay. It offers the demo review (review.ts) at the quoted price under
// the audit-report template's five checks, posts the offer to the test buyer, and once the deal is Held:
//
//   --outcome release   delivers the demo report, which passes the five checks: the seller is paid
//   --outcome refund    delivers it with the Critical finding's proof of concept left out: the proof check fails
//   --outcome reclaim   delivers nothing: the work is due 5 minutes after the offer, and the payment goes back
//
//   node tools/duet/review-deals.ts --outcome release|refund|reclaim
//
// It prints one line per step and ends with one JSON line: the deal's ID, its end and its transactions. Test tokens
// only: it signs for the Sepolia deployment pinned in examples/deployments.ts and nothing else.
import { Agent } from '../../examples/agent.ts';
import { knownPins } from '../../examples/verify.ts';
import { REVIEW_PRICE_UNITS, reviewReport, reviewTerms } from './review.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const OPERATORS = ['https://api.crow.direct', 'https://api2.crow.direct'];
const BUYER = 'https://crow.direct/agents/test-buyer';
/** An hour to deliver, judged within a minute; the offer open 10 minutes, funding within 15. */
export const TIMING = { offerExpiresInSec: 600, fundWithinSec: 900, deliverWithinSec: 3600, judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 0, appealDecideSec: 60 }; // phase one: no party appeal (ADR-0033 §2b)
/** The silent deal: 3 minutes to agree, 4 to fund, the work due 5 minutes after the offer. */
export const SILENT_TIMING = { ...TIMING, offerExpiresInSec: 180, fundWithinSec: 240, deliverWithinSec: 300 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const buyer = (path: string, init?: RequestInit) => fetch(`${BUYER}${path}`, { ...init, signal: AbortSignal.timeout(30_000) });

const args = process.argv.slice(2);
const outcome = args.length === 2 && args[0] === '--outcome' && ['release', 'refund', 'reclaim'].includes(args[1]!) ? (args[1] as 'release' | 'refund' | 'reclaim') : null;
if (!outcome) {
  console.error('usage: node tools/duet/review-deals.ts --outcome release|refund|reclaim');
  process.exit(2);
}
const pin = knownPins().find((p) => p.domain.chainId === 11155111);
if (!pin) {
  console.error('examples/deployments.ts pins no Sepolia deployment');
  process.exit(1);
}

try {
  const seller = new Agent(OPERATORS, `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`, crypto.getRandomValues(new Uint8Array(32)), pin.domain, pin.chain);
  const card: J = await (await buyer('/agent.json')).json();
  if (card?.type !== 'crow-buyer' || !/^0x[0-9a-f]{40}$/.test(card.buyer)) throw new Error('the buyer card is not a crow-buyer card with an address');
  console.log(`test buyer ${card.buyer}; seller ${seller.address}, a fresh key held in memory only`);
  const grant = await seller.call('POST', '/v1/faucet', { address: seller.address });
  console.log(`faucet: the seller is admitted to ${grant.clubId}`);
  const found = await seller.trusted('/.well-known/holdback.json', (x) => ({ clubId: x.demo?.clubId, adjudicators: x.demo?.adjudicators }));
  const role = (r: string) => found.adjudicators.find((a: J) => a.role === r).address as string;
  const { deliverable, checks } = reviewTerms();
  const { id, terms } = await seller.offer({
    template: 'checks-only', clubId: found.clubId, seller: seller.address,
    buyer: { address: card.buyer, encryptionPublicKey: card.buyerEncryptionPublicKey },
    adjudicators: { primary: role('primary'), fallback: role('fallback'), appeal: role('appeal') },
    price: { token: pin.token.id, amount: REVIEW_PRICE_UNITS }, deliverable, checks, timing: outcome === 'reclaim' ? SILENT_TIMING : TIMING,
  });
  console.log(`offered ${id}: the demo security review for 40 ${pin.token.symbol}, deliverBy ${terms.timing?.deliverBy ?? terms.deadlines?.deliverBy}`);
  const posted = await buyer('/offers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commitmentId: id }) });
  const answer: J = await posted.json();
  if (posted.status !== 202 && posted.status !== 200) throw new Error(`the test buyer answered ${posted.status}: ${answer.error} (rule ${answer.rule})`);
  console.log('the test buyer took the offer');
  await seller.waitFor(id, ['Held'], 5 * 60_000);
  console.log('Held: the test buyer agreed and funded');
  if (outcome === 'reclaim') console.log('no delivery: the payment goes back after deliverBy');
  else {
    await seller.deliver(terms, reviewReport(outcome === 'refund' ? 'no-proof' : 'ok'));
    console.log(`delivered ${outcome === 'refund' ? 'the report without F-01\'s proof of concept' : 'the demo report'}`);
  }
  const want = outcome === 'release' ? 'released' : outcome === 'refund' ? 'refunded' : 'reclaimed';
  let status: J;
  for (const end = Date.now() + 15 * 60_000; Date.now() < end; await sleep(3000)) {
    status = await (await buyer(`/status/${id}`)).json();
    if (!['accepted', 'funded'].includes(status.status)) break;
  }
  console.log(`${id}: ${status?.status}${status?.detail ? `: ${status.detail}` : ''}`);
  for (const t of status?.transactions ?? []) console.log(`  ${t.step}: ${t.url ?? t.tx}`);
  console.log(JSON.stringify({ outcome, commitment: id, status: status?.status, transactions: status?.transactions ?? [] }));
  if (status?.status !== want) throw new Error(`the deal ended ${status?.status}, not ${want}`);
} catch (e) {
  console.error(`FAIL: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}

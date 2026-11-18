// A ledger row and a one-page proof of purchase from one finished deal's evidence file (T-538, roadmap row N197).
//
//   node examples/proof-of-purchase.ts <evidence file> --as buyer|seller [--facts <file>] [--receipt <file>]
//        [--name <text>] [--counterparty-name <text>] [--reference <text>]
//        [--fiat-value <decimal>] [--fiat-currency <code>] [--rate <decimal>] [--rate-source <text>] [--rate-time <text>]
//
// It runs `examples/evidence.ts check` on the file first and writes nothing when the check fails. Then it writes two
// files beside the evidence file: `<name>.ledger.json`, one ledger row, and `<name>.proof.md`, a page a bookkeeper can
// file. It makes no network call.
//
// Rails, not a record-keeper: every deal fact comes from the checked file. The party's own facts (its name, the
// counterparty's name, its reference, a fiat value with its rate, source and time) come only from what the party types
// here or in the facts file; anything it leaves out is null in the row and "not stated" on the page. The command never
// looks up a rate and never computes a fiat value. The page is a record of a settled deal, not an invoice: the seller
// issues invoices. Exit 0: both files written; 1: the evidence check failed, nothing written; 2: could not run.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkBundle, decimalOf } from './evidence.ts';
import { plain } from './plain.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
export const ROW_FORMAT = 'crow-ledger-row/1';
type Role = 'buyer' | 'seller';
/** What the party states about itself. The command fills none of these. */
export type Facts = { name?: string; counterpartyName?: string; reference?: string; fiatValue?: string; fiatCurrency?: string; rate?: string; rateSource?: string; rateTime?: string };
const FACT_KEYS = ['name', 'counterpartyName', 'reference', 'fiatValue', 'fiatCurrency', 'rate', 'rateSource', 'rateTime'] as const;
const FLAG_OF: Record<string, keyof Facts> = {
  '--name': 'name', '--counterparty-name': 'counterpartyName', '--reference': 'reference', '--fiat-value': 'fiatValue',
  '--fiat-currency': 'fiatCurrency', '--rate': 'rate', '--rate-source': 'rateSource', '--rate-time': 'rateTime',
};
const DECIMAL = /^[0-9]+(\.[0-9]+)?$/;
const NOT_STATED = 'not stated';
const SEPOLIA_CHAIN = 11155111;
const lc = (s: unknown) => String(s).toLowerCase();

class UsageError extends Error {}

/** The party's facts, checked for shape only: text is one plain line, a value or a rate is a decimal string. */
export function factsOf(input: Record<string, unknown>): Facts {
  const out: Facts = {};
  for (const [key, v] of Object.entries(input)) {
    if (!(FACT_KEYS as readonly string[]).includes(key)) throw new UsageError(`unknown fact ${plain(key).slice(0, 40)}; the facts are ${FACT_KEYS.join(', ')}`);
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string' || plain(v).trim() === '' || v.length > 300) throw new UsageError(`${key} must be one line of text, 1 to 300 characters`);
    const s = plain(v).trim();
    if ((key === 'fiatValue' || key === 'rate') && !DECIMAL.test(s)) throw new UsageError(`${key} must be a decimal string such as 36.80, with no sign, comma or exponent`);
    out[key as keyof Facts] = s;
  }
  return out;
}

/** Text for the Markdown page: one plain line, with the characters Markdown reads as markup escaped. */
const md = (s: unknown) => plain(String(s)).replace(/[\\`*_[\]<>|#~]/g, '\\$&');
const stated = (s: string | undefined) => (s === undefined ? `*${NOT_STATED}*` : md(s));

export type Made = { row: J; page: string };

/**
 * Checks the evidence and builds the row and the page. Throws nothing on a failed check: returns `{ ok: false }` with
 * the check's own lines. `file` is the evidence file's bytes as read, which the page fingerprints.
 */
export async function make(file: Buffer, o: { role: Role; facts?: Facts; receipt?: J; fileName: string }): Promise<{ ok: true; made: Made } | { ok: false; lines: string[] }> {
  const b = JSON.parse(file.toString('utf8')) as J;
  const r = await checkBundle(b, o.receipt !== undefined ? { receipt: o.receipt } : {});
  if (!r.ok) return { ok: false, lines: r.lines };
  const facts = o.facts ?? {};
  const pin = r.pin;
  const chainId = pin.chain!.tokenDomain.chainId;
  const t = b.terms;
  const id = String(b.commitmentId);
  const events: J[] = b.events;
  const ev = (type: string) => events.find((e) => e.type === type)!;
  const closing = events.find((e) => e.type === 'settlement.released' || e.type === 'settlement.refunded')!;
  const released = closing.type === 'settlement.released';
  const funded = ev('hold.funded');
  const delivered = ev('delivery.submitted');
  const decided = ev('judgment.decided');
  const j = b.judgment;

  // Amounts, in base units, from the checked terms. The token is the pinned deployment's when the terms name it.
  const known = lc(t.price.token) === lc(pin.token.id);
  const amount = (x: bigint) => ({ base: x.toString(), decimal: known ? decimalOf(x, pin.token.decimals) : null });
  const price = BigInt(t.price.amount);
  const fee = BigInt(t.adjudication.fee.amount);
  // The operator fee is a plain transfer the operator records as `fee.operator` (docs/api.md, "Operator fee"); 0 today.
  const operatorFee = events.filter((e) => e.type === 'fee.operator').reduce((sum, e) => sum + BigInt(e.payload?.amount?.amount ?? 0), 0n);
  const role = o.role;
  const paid = role === 'buyer' ? price + fee + operatorFee : 0n;
  const received = role === 'buyer' ? (released ? 0n : price) : released ? price : 0n;
  const counterparty = role === 'buyer'
    ? { role: 'seller', address: lc(t.seller), payoutAddress: lc(t.sellerPayoutAddress) }
    : { role: 'buyer', address: lc(t.buyer), paymentAddress: lc(t.buyerPaymentAddress) };
  const own = role === 'buyer' ? { address: lc(t.buyer), paymentAddress: lc(t.buyerPaymentAddress) } : { address: lc(t.seller), payoutAddress: lc(t.sellerPayoutAddress) };
  const explorer = (tx: string) => (chainId === SEPOLIA_CHAIN ? `https://sepolia.etherscan.io/tx/${tx}` : null);
  const sha = createHash('sha256').update(file).digest('hex');
  const chainRead = o.receipt !== undefined ? (o.receipt?.result ?? o.receipt) : undefined;
  const stateOr = (k: keyof Facts) => facts[k] ?? null;

  const row = {
    format: ROW_FORMAT,
    commitmentId: id,
    role,
    settledAt: closing.at,
    settledOn: String(closing.at).slice(0, 10),
    outcome: released ? 'released' : 'refunded',
    decision: decided.payload.outcome,
    bought: { description: plain(String(t.deliverable?.description ?? '')), kind: t.deliverable?.kind ?? null, format: t.deliverable?.format ?? null },
    own,
    counterparty,
    network: { chainId, testNetwork: true, rulesContract: lc(pin.chain!.rules) },
    token: { id: lc(t.price.token), symbol: known ? pin.token.symbol : null, decimals: known ? pin.token.decimals : null },
    price: amount(price),
    adjudicationFee: { ...amount(fee), paidBy: 'buyer', keptOnDecision: true },
    operatorFee: amount(operatorFee),
    paid: amount(paid),
    received: amount(received),
    transactions: {
      funding: { hash: funded.payload.tx, explorer: explorer(funded.payload.tx) },
      settlement: { hash: closing.payload.tx, block: chainRead ? BigInt(chainRead.blockNumber).toString() : (closing.payload.block ?? null), confirmedByChainRead: chainRead !== undefined, explorer: explorer(closing.payload.tx) },
    },
    evidence: { file: o.fileName, sha256: sha },
    stated: { name: stateOr('name'), counterpartyName: stateOr('counterpartyName'), reference: stateOr('reference'), fiatValue: stateOr('fiatValue'), fiatCurrency: stateOr('fiatCurrency'), rate: stateOr('rate'), rateSource: stateOr('rateSource'), rateTime: stateOr('rateTime') },
  };

  const tok = known ? pin.token.symbol : `base units of token ${lc(t.price.token)}`;
  const money = (x: { base: string; decimal: string | null }) => (x.decimal !== null ? `${x.decimal} ${tok} (${x.base} base units)` : `${x.base} ${tok}`);
  const network = chainId === SEPOLIA_CHAIN ? `Sepolia, a test network (chain ${chainId})` : `chain ${chainId}, a test network`;
  const det: J[] = Array.isArray(j.deterministic) ? j.deterministic : [];
  const fiat = facts.fiatValue !== undefined ? `${md(facts.fiatValue)} ${stated(facts.fiatCurrency)}` : `*${NOT_STATED}*`;
  const page = [
    `# Proof of purchase: deal ${id.slice(0, 10)}`,
    '',
    `This page records a deal settled on ${network}, made from its evidence file. It is not an invoice and not tax or legal advice: the seller issues any invoice.`,
    '',
    '| | |',
    '| --- | --- |',
    `| Prepared by | the ${role}, ${stated(facts.name)}, address \`${own.address}\` |`,
    `| Counterparty | the ${counterparty.role}, ${stated(facts.counterpartyName)}, address \`${counterparty.address}\` |`,
    `| Your reference | ${stated(facts.reference)} |`,
    `| Deal reference (commitment ID) | \`${id}\` |`,
    `| Settled | ${md(closing.at)}, as the operator recorded it |`,
    `| Outcome | ${released ? 'Released: the price went to the seller' : 'Refunded: the price went back to the buyer'}. The adjudicator kept its fee. |`,
    `| You paid | ${money(row.paid)} |`,
    `| You received | ${money(row.received)} |`,
    `| Fiat value | ${fiat} |`,
    `| Rate | ${stated(facts.rate)}, source ${stated(facts.rateSource)}, time ${stated(facts.rateTime)} |`,
    '',
    '## The order',
    '',
    `The seller \`${lc(t.seller)}\` signed these terms. Their hash is the commitment ID \`${id}\`, so no term can differ from what was signed. The buyer \`${lc(t.buyer)}\` signed its agreement to that hash in the funding transaction.`,
    '',
    'What was bought, in the seller\'s words in the signed terms:',
    '',
    `> ${md(row.bought.description)}`,
    '',
    `- Format: ${md(row.bought.format ?? NOT_STATED)}`,
    `- Offered: ${md(t.createdAt)}`,
    `- Price: ${money(row.price)}`,
    `- Adjudication fee, paid by the buyer: ${money(row.adjudicationFee)}`,
    `- Operator fee: ${money(row.operatorFee)}`,
    '',
    '## The acceptance',
    '',
    `- The seller signed delivery \`${delivered.payload.deliveryHash}\` (attempt ${delivered.payload.attempt}); the operator recorded it at ${md(delivered.at)}. Its work is encrypted to the buyer and the adjudicators; the evidence file holds it.`,
    `- The ${md(j.role)} adjudicator \`${lc(j.adjudicator)}\` signed the decision "${md(decided.payload.outcome)}" on that delivery at ${md(j.decidedAt)}, citing judgment record \`${j.recordHash}\`, which it also signed.`,
    `- The record ran the terms' ${det.length} deterministic checks: ${det.map((x) => `${md(x.checkId)} ${x.passed ? 'passed' : 'failed'}`).join(', ') || 'none'}.`,
    '',
    '## The payment',
    '',
    `- Funding: the buyer's payment address \`${lc(t.buyerPaymentAddress)}\` moved ${money(amount(price + fee))} into the escrow in transaction \`${funded.payload.tx}\`.`,
    `- Settlement: transaction \`${closing.payload.tx}\`${row.transactions.settlement.block ? ` in block ${row.transactions.settlement.block}${chainRead !== undefined ? ', confirmed by the chain read' : ' (as the operator recorded it)'}` : ''} ${released ? `paid the price ${money(row.price)} to the seller's payout address \`${lc(t.sellerPayoutAddress)}\`` : `returned the price ${money(row.price)} to the buyer's payment address \`${lc(t.buyerPaymentAddress)}\``}.`,
    ...(chainId === SEPOLIA_CHAIN ? [`- On a block explorer: ${row.transactions.settlement.explorer}`] : []),
    '',
    '## Who signed what',
    '',
    '| Signer | Address | Signed |',
    '| --- | --- | --- |',
    `| Seller | \`${lc(t.seller)}\` | the terms; the delivery |`,
    `| Buyer | \`${lc(t.buyer)}\` | its agreement to the terms |`,
    `| Buyer's payment address | \`${lc(t.buyerPaymentAddress)}\` | the transfer of price and fee into the escrow |`,
    `| Primary adjudicator | \`${lc(t.adjudication.adjudicator)}\` | its acceptance of the case |`,
    `| ${md(j.role[0].toUpperCase() + j.role.slice(1))} adjudicator | \`${lc(j.adjudicator)}\` | the decision and the judgment record |`,
    '',
    'A signature shows that whoever held that key signed. It does not show who holds the key; the names on this page are the ones the party typed.',
    '',
    '## Check it yourself',
    '',
    `The evidence file \`${md(o.fileName)}\` has SHA-256 \`${sha}\`. In a clone of the repository (https://github.com/rafaeldavid/holdback), after \`pnpm install\`, this checks it with no network:`,
    '',
    '```',
    `node examples/evidence.ts check ${o.fileName}`,
    '```',
    '',
    ...(chainRead !== undefined
      ? [`The chain read was checked too: the settlement transaction succeeded in block ${row.transactions.settlement.block}. Repeat it with \`--receipt\` and the node's answer.`]
      : ['One chain read shows the settlement transaction was mined and succeeded. From a node you trust:', '', '```', `${r.rpcCommand} > receipt.json`, `node examples/evidence.ts check ${o.fileName} --receipt receipt.json`, '```']),
    '',
  ].join('\n');
  return { ok: true, made: { row, page } };
}

/** `deal.json` → `deal`; `2026-11-17-x.evidence.json` → `2026-11-17-x`. */
const stem = (f: string) => basename(f).replace(/(\.evidence)?\.json$/, '');

const USAGE = [
  'proof-of-purchase: a ledger row and a one-page proof of purchase from a checked evidence file.',
  'Usage:',
  '  node examples/proof-of-purchase.ts <evidence file> --as buyer|seller [--facts <file>] [--receipt <file>]',
  '       [--name <text>] [--counterparty-name <text>] [--reference <text>]',
  '       [--fiat-value <decimal>] [--fiat-currency <code>] [--rate <decimal>] [--rate-source <text>] [--rate-time <text>]',
  'Get the evidence file with: node examples/evidence.ts fetch <commitment ID> --out deal.json',
  'It writes <name>.ledger.json and <name>.proof.md beside the evidence file. The facts file is JSON with any of:',
  `  ${FACT_KEYS.join(', ')}. A flag overrides the file. Anything not given stays "not stated".`,
  'It makes no network call. Exit 0 written, 1 the evidence check failed (nothing written), 2 could not run.',
].join('\n');

export async function main(argv: readonly string[], io = { out: (s: string) => console.log(s), err: (s: string) => console.error(s) }): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    io.out(USAGE);
    return 0;
  }
  try {
    const [target, ...rest] = argv;
    if (!target || target.startsWith('--')) throw new UsageError('give an evidence file first');
    let role: Role | undefined;
    let factsFile: string | undefined;
    let receiptFile: string | undefined;
    const given: Record<string, string> = {};
    for (let i = 0; i < rest.length; i += 2) {
      const name = rest[i]!;
      const v = rest[i + 1];
      if (v === undefined) throw new UsageError(`${plain(name).slice(0, 40)} needs a value`);
      if (name === '--as') {
        if (v !== 'buyer' && v !== 'seller') throw new UsageError('--as is buyer or seller');
        role = v;
      } else if (name === '--facts') factsFile = v;
      else if (name === '--receipt') receiptFile = v;
      else if (FLAG_OF[name]) given[FLAG_OF[name]] = v;
      else throw new UsageError(`unknown option ${plain(name).slice(0, 40)}`);
    }
    if (!role) throw new UsageError('say who runs it: --as buyer or --as seller');
    const fromFile = factsFile ? (JSON.parse(readFileSync(factsFile, 'utf8')) as unknown) : {};
    if (fromFile === null || typeof fromFile !== 'object' || Array.isArray(fromFile)) throw new UsageError('the facts file must hold one JSON object');
    const facts = factsOf({ ...(fromFile as Record<string, unknown>), ...given });
    const receipt = receiptFile ? (JSON.parse(readFileSync(receiptFile, 'utf8')) as J) : undefined;
    const result = await make(readFileSync(target), { role, facts, receipt, fileName: basename(target) });
    if (!result.ok) {
      io.err(`${result.lines.join('\n')}\nproof-of-purchase: wrote nothing.`);
      return 1;
    }
    const base = join(dirname(target), stem(target));
    writeFileSync(`${base}.ledger.json`, `${JSON.stringify(result.made.row, null, 2)}\n`);
    writeFileSync(`${base}.proof.md`, result.made.page);
    io.out(`Wrote ${base}.ledger.json and ${base}.proof.md. The evidence check passed; ${Object.values(result.made.row.stated).filter((x) => x === null).length} of your own facts are not stated.`);
    return 0;
  } catch (e) {
    io.err(e instanceof UsageError ? `proof-of-purchase: ${e.message}\n${USAGE}` : `proof-of-purchase: could not run: ${plain(e instanceof Error ? e.message : String(e)).slice(0, 300)}. Nothing was written.`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2)).then((code) => (process.exitCode = code));

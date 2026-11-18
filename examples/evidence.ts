// One finished deal's evidence bundle (T-511, roadmap row T-242): what the API and the chain already serve for the
// deal, in one file, and a check of that file that makes no network call.
//
//   node examples/evidence.ts fetch <commitmentId> [--out <file>]     reads one operator and a Sepolia node, writes the bundle
//   node examples/evidence.ts check <bundle> [--receipt <file>]       offline: checks the bundle, prints what it proves
//
// Env for fetch only: HOLDBACK_OPERATOR (default https://api.crow.direct), SEPOLIA_RPC_URL (default a public node).
//
// The bundle (`holdback-evidence/1`) is the operator's answers verbatim (status, terms, events, receipts, judgment
// record), the delivery's ciphertext, and the raw signed transactions the events name. Three of the deal's signatures
// (the buyer's agreement and funding, the seller's delivery, the adjudicator's decision) are served by no API route:
// they are in those transactions' calldata, and a raw transaction hashes to its transaction hash.
//
// What the check trusts: the EIP-712 domain and the deployment pinned in deployments.ts (never the bundle's), and the
// keys the terms name, which hash to the commitment ID. Nothing else. The operator's receipt signer comes from the
// bundle, so its receipts show only that operator's own account; the parties' signatures carry the deal. What one
// chain read adds, that the decide transaction was mined and succeeded, the check prints as a command, and checks the
// answer when given --receipt. Exit 0: every check passed; 1: a check failed; 2: the command could not run.
// Deals closed by an adjudicator's accept or reject only; public deals only (a private deal's terms need a ReadToken).
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { concat, decodeEventLog, decodeFunctionData, encodeAbiParameters, keccak256, parseAbiParameters, parseTransaction, recoverAddress, recoverMessageAddress, recoverTypedDataAddress, stringToBytes, type Abi, type Hex } from 'viem';
import { plain } from './plain.ts';
import { commitmentIdOf, ERC3009_TYPES, fundingNonceOf, jcsHash, knownPins, type Pin } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
export const FORMAT = 'holdback-evidence/1';
export type Bundle = {
  bundle: typeof FORMAT;
  commitmentId: Hex;
  /** The operator's `GET /v1/status`: its receipt signer and the EIP-712 domain it serves. */
  operator: { receiptSigner: string; domain: J };
  /** `GET /v1/commitments/{id}/terms`, verbatim. */
  terms: J;
  /** `GET /v1/commitments/{id}/events`, every page, by sequence number. */
  events: J[];
  /** `GET /v1/commitments/{id}/receipts`, every page. */
  receipts: J[];
  /** `GET /v1/commitments/{id}/judgment`. */
  judgment: J;
  /** The delivery's ciphertext, `GET /v1/ciphertext/<sha256>`, as hex. */
  ciphertext: Hex;
  /** Each transaction the events name: its hash, then its raw signed bytes (`eth_getRawTransactionByHash`). */
  transactions: Record<string, Hex>;
};

const RULES_ABI = (JSON.parse(readFileSync(new URL('../packages/settlement/evm/abis.json', import.meta.url), 'utf8')) as { rules: Abi }).rules;
const ID = /^0x[0-9a-f]{64}$/;
const HEX = /^0x(?:[0-9a-f]{2})*$/;
const CIPHERTEXT_ID = /^sha256:[0-9a-f]{64}$/;
const lc = (s: unknown) => String(s).toLowerCase();
const k = (s: string): Hex => keccak256(stringToBytes(s));
const H = (types: string, values: readonly unknown[]): Hex => keccak256(encodeAbiParameters(parseAbiParameters(types), values as never));
const secs = (iso: string) => BigInt(Date.parse(iso) / 1000);

// The rules contract's struct hashes, rebuilt from the calldata's field encodings as contracts/src/HoldbackTypes.sol
// computes them. The type strings are the contract's.
const TOKEN_AMOUNT_T = 'TokenAmount(string token,uint256 amount)';
const KEY_UNLOCK_T = 'KeyUnlock(string kind,uint64 round)';
const ENCRYPTED_KEY_T = 'EncryptedKey(address recipient,string scheme,string ciphertext,KeyUnlock unlock)';
const ADJUDICATION_T = 'Adjudication(address adjudicator,address fallbackAdjudicator,address appealAdjudicator,string policyId,TokenAmount fee,bytes32 registryHash,bytes32 policyHash)';
const TIMING_T = 'Timing(uint64 offerExpiresAt,uint64 fundBy,uint64 deliverBy,uint64 judgeBy,uint64 fallbackBy,uint64 appealWindowSec,uint64 appealDecideSec,uint8 maxSubmissions,uint64 disputeBy,uint64 disputeJudgeSec,uint64 disputeFallbackSec)';
const SETTLEMENT_T = 'Settlement(string mode,string token)';
const CIPHERTEXT_T = 'Ciphertext(string uri,string sha256,uint64 bytes,string cipher)';
const TH = {
  tokenAmount: k(TOKEN_AMOUNT_T),
  adjudication: k(ADJUDICATION_T + TOKEN_AMOUNT_T),
  timing: k(TIMING_T),
  settlement: k(SETTLEMENT_T),
  terms: k(`CommitmentTerms(string schemaVersion,string clubId,bytes32 rulebookHash,address buyer,address seller,address buyerPaymentAddress,address sellerPayoutAddress,bytes32 deliverableHash,bytes32 acceptanceHash,TokenAmount price,Adjudication adjudication,Timing timing,Settlement settlement,Remedy remedy,Disclosure disclosure,string buyerEncryptionPublicKey,bytes32 nonce,uint64 createdAt)${ADJUDICATION_T}Disclosure(string level)Remedy(string onReject)${SETTLEMENT_T}${TIMING_T}${TOKEN_AMOUNT_T}`),
  acceptance: k(`AdjudicatorAcceptance(bytes32 commitmentId,address adjudicator,bytes32 seedCommitment,bytes32 policyHash,bytes32 registryHash,TokenAmount fee,TokenAmount bondReserved,bytes32 nonce,uint64 expiresAt)${TOKEN_AMOUNT_T}`),
  agree: k('Agree(bytes32 commitmentId,address buyer,bytes32 nonce,uint64 expiresAt)'),
  ciphertext: k(CIPHERTEXT_T),
  delivery: k(`Delivery(bytes32 commitmentId,uint8 attempt,Ciphertext ciphertext,string plaintextSha256,string plaintextMime,EncryptedKey[] encryptedKeys,uint64 submittedAt)${CIPHERTEXT_T}${ENCRYPTED_KEY_T}${KEY_UNLOCK_T}`),
  sealedKey: k('SealedKey(string scheme,string ciphertext)'),
  beacon: k('Beacon(string source,uint64 round,bytes32 value,bytes signature)'),
  decision: k(`Decision(bytes32 commitmentId,uint8 attempt,bytes32 deliveryHash,address adjudicator,string role,string outcome,bytes32 seed,bytes32 policyHash,bytes32 registryHash,bytes32 judgmentRecordHash,SealedKey keyForBuyer,string appealGround,Beacon beacon,EncryptedKey[] encryptedKeys,bytes32 nonce,uint64 expiresAt)Beacon(string source,uint64 round,bytes32 value,bytes signature)${ENCRYPTED_KEY_T}${KEY_UNLOCK_T}SealedKey(string scheme,string ciphertext)`),
  domain: k('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'),
};
const ROLES = ['primary', 'fallback', 'appeal'] as const;
const OUTCOMES = ['accept', 'reject', 'escalate'] as const;

/** The commitment ID from the calldata's terms view (HoldbackTypes.commitmentId). */
export function commitmentIdOfView(t: J): Hex {
  const token = k(lc(t.token)); // LibString.toHexString(token): lowercase 0x-hex
  const amount = (a: bigint) => H('bytes32, bytes32, uint256', [TH.tokenAmount, token, a]);
  const m = t.timing;
  const timing = H('bytes32, uint64, uint64, uint64, uint64, uint64, uint64, uint64, uint8, uint64, uint64, uint64', [TH.timing, m.offerExpiresAt, m.fundBy, m.deliverBy, m.judgeBy, m.fallbackBy, m.appealWindowSec, m.appealDecideSec, m.maxSubmissions, m.disputeBy, m.disputeJudgeSec, m.disputeFallbackSec]);
  const adjudication = H('bytes32, address, address, address, bytes32, bytes32, bytes32, bytes32', [TH.adjudication, t.adjudicator, t.fallbackAdjudicator, t.appealAdjudicator, t.policyIdHash, amount(t.fee), t.registryHash, t.policyHash]);
  const settlement = H('bytes32, bytes32, bytes32', [TH.settlement, k('guaranteed_on_decision'), token]);
  return H('bytes32, bytes32, bytes32, bytes32, address, address, address, address, bytes32, bytes32, bytes32, bytes32, bytes32, bytes32, bytes32, bytes32, bytes32, bytes32, uint64', [
    TH.terms, t.schemaVersionHash, t.clubIdHash, t.rulebookHash, t.buyer, t.seller, t.buyerPaymentAddress, t.sellerPayoutAddress, t.deliverableHash, t.acceptanceHash, amount(t.price),
    adjudication, timing, settlement, t.remedyHash, t.disclosureHash, t.buyerKeyHash, t.nonce, t.createdAt,
  ]);
}
const acceptanceHashOf = (id: Hex, t: J, a: J): Hex => {
  const token = k(lc(t.token));
  const amount = (x: bigint) => H('bytes32, bytes32, uint256', [TH.tokenAmount, token, x]);
  return H('bytes32, bytes32, address, bytes32, bytes32, bytes32, bytes32, bytes32, bytes32, uint64', [TH.acceptance, id, t.adjudicator, a.seedCommitment, t.policyHash, t.registryHash, amount(t.fee), amount(a.bondReserved), a.nonce, a.expiresAt]);
};
const agreeHashOf = (id: Hex, buyer: string, a: J): Hex => H('bytes32, bytes32, address, bytes32, uint64', [TH.agree, id, buyer, a.nonce, a.expiresAt]);
export const deliveryHashOfView = (id: Hex, d: J): Hex =>
  H('bytes32, bytes32, uint8, bytes32, bytes32, bytes32, bytes32, uint64', [TH.delivery, id, d.attempt, d.ciphertextHash, d.plaintextSha256Hash, d.plaintextMimeHash, d.encryptedKeysHash, d.submittedAt]);
const decisionHashOf = (id: Hex, adjudicator: string, t: J, m: J): Hex => {
  const sealed = H('bytes32, bytes32, bytes32', [TH.sealedKey, k(m.keyScheme), k(m.keyCiphertext)]);
  const beacon = H('bytes32, bytes32, uint64, bytes32, bytes32', [TH.beacon, m.beaconSourceHash, m.beaconRound, m.beaconValue, keccak256(m.beaconSignature)]);
  return H('bytes32, bytes32, uint8, bytes32, address, bytes32, bytes32, bytes32, bytes32, bytes32, bytes32, bytes32, bytes32, bytes32, bytes32, bytes32, uint64', [
    TH.decision, id, m.attempt, m.deliveryHash, adjudicator, k(ROLES[m.role]!), k(OUTCOMES[m.outcome]!), m.seed, t.policyHash, t.registryHash,
    m.judgmentRecordHash, sealed, m.appealGroundHash, beacon, m.encryptedKeysHash, m.nonce, m.expiresAt,
  ]);
};
/** The EIP-712 digest of a struct hash under the pinned Holdback domain. */
const digestOf = (pin: Pin, structHash: Hex): Hex =>
  keccak256(concat(['0x1901', H('bytes32, bytes32, bytes32, uint256, address', [TH.domain, k(pin.domain.name), k(pin.domain.version), BigInt(pin.domain.chainId), pin.domain.verifyingContract]), structHash]));
const RECEIPT_TYPES = { Receipt: [{ name: 'operator', type: 'address' }, { name: 'eventSeq', type: 'uint64' }, { name: 'eventHash', type: 'bytes32' }, { name: 'hasCommitment', type: 'bool' }, { name: 'commitmentId', type: 'bytes32' }] };

/** A check that failed: its name and, in plain words, why. */
export class Failed extends Error {
  readonly check: string;
  constructor(check: string, why: string) {
    super(`${check}: ${why}`);
    this.check = check;
  }
}
export type Result = { ok: true; passed: string[]; lines: string[]; decideTx: Hex; rpcCommand: string } | { ok: false; passed: string[]; failed: string; why: string; lines: string[] };

const recover = async (hash: Hex, signature: unknown) => {
  try {
    return lc(await recoverAddress({ hash, signature: signature as Hex }));
  } catch {
    return '';
  }
};
const money = (amount: bigint, token: string, pin: Pin) => {
  if (lc(token) !== lc(pin.token.id)) return `${amount} base units of token ${lc(token)}`;
  const d = pin.token.decimals;
  const s = amount.toString().padStart(d + 1, '0');
  const frac = s.slice(s.length - d).replace(/0+$/, '').padEnd(2, '0');
  return `${s.slice(0, s.length - d)}.${frac} ${pin.token.symbol}`;
};
const keysOf = (o: J) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o).sort().join(',') : '');

/**
 * Checks a bundle with no network. Every check runs in order; the first that fails ends the check and names itself.
 * `receipt` is the chain read's answer (`eth_getTransactionReceipt` for the decide transaction), when the caller has it.
 */
export async function checkBundle(b: J, o: { receipt?: J } = {}): Promise<Result> {
  const passed: string[] = [];
  const must = (check: string, ok: unknown, why: string) => {
    if (!ok) throw new Failed(check, why);
    if (!passed.includes(check)) passed.push(check);
  };
  try {
    return { ok: true, passed, ...(await run(b, o, must, passed)) };
  } catch (e) {
    if (!(e instanceof Failed)) throw e;
    return { ok: false, passed, failed: e.check, why: e.message.slice(e.check.length + 2), lines: [`FAILED  ${plain(e.message)}`, `This bundle is not a true record of the deal it names: do not rely on it. ${passed.length} checks passed before this one.`] };
  }
}

type Must = (check: string, ok: unknown, why: string) => void;
async function run(b: J, o: { receipt?: J }, must: Must, passed: string[]): Promise<{ lines: string[]; decideTx: Hex; rpcCommand: string }> {
  // 0. The shape: the format, every field, nothing else.
  must('bundle shape', keysOf(b) === 'bundle,ciphertext,commitmentId,events,judgment,operator,receipts,terms,transactions' && b.bundle === FORMAT, `not a ${FORMAT} file with exactly its fields`);
  const id = b.commitmentId as Hex;
  must('bundle shape', ID.test(String(id)) && keysOf(b.operator) === 'domain,receiptSigner' && Array.isArray(b.events) && Array.isArray(b.receipts) && HEX.test(String(b.ciphertext)), 'a field is malformed');

  // 1. The settlement layer: one this command pins, never one the bundle names.
  const d = b.operator.domain;
  const pin = knownPins().find((p) => p.chain && keysOf(d) === 'chainId,name,verifyingContract,version' && d.name === p.domain.name && d.version === p.domain.version && String(d.chainId) === String(p.domain.chainId) && d.verifyingContract === lc(p.domain.verifyingContract));
  must('pinned settlement layer', pin, `the bundle's EIP-712 domain ${plain(JSON.stringify(d)).slice(0, 200)} is not a chain deployment this command pins (examples/deployments.ts); for an earlier deployment, pass its file from contracts/deployments/ as HOLDBACK_DEPLOYMENT`);
  const c = pin!.chain!;

  // 2. The terms: they hash to the commitment ID, and the seller signed that ID.
  const { id: servedId, signatures, ...terms } = b.terms ?? {};
  let fromJson: Hex | null = null;
  try {
    fromJson = commitmentIdOf(terms);
  } catch {
    fromJson = null;
  }
  must('terms hash to the commitment ID', fromJson === id && servedId === id, `the terms hash to ${fromJson ?? 'nothing (malformed)'}, not ${id}`);
  must("seller's signature on the terms", keysOf(signatures) === 'seller' && (await recover(digestOf(pin!, id), signatures.seller)) === lc(terms.seller), 'it does not recover to the seller the terms name');
  must('terms are a public deal', terms.disclosure?.level === 'public', 'this command checks public deals only');

  // 3. The event log: each event hashes to its hash, consecutive events link, each has one receipt from the operator.
  const events: J[] = b.events;
  must('events', events.length > 0 && events.every((e, i) => Number.isSafeInteger(e?.seq) && (i === 0 || e.seq > events[i - 1].seq)), 'the events are not in increasing sequence order');
  for (const [i, e] of events.entries()) {
    const { hash, ...body } = e;
    must('events name this commitment', e.commitmentId === id, `event ${e.seq} names ${plain(String(e.commitmentId))}`);
    must('event hashes', ID.test(String(hash)) && jcsHash(body) === hash, `event ${e.seq} does not hash to the hash it carries`);
    if (i > 0 && e.seq === events[i - 1].seq + 1) must('event chain', e.prevHash === events[i - 1].hash, `event ${e.seq}'s prevHash is not event ${e.seq - 1}'s hash`);
  }
  const signer = String(b.operator.receiptSigner);
  must('operator receipts', /^0x[0-9a-fA-F]{40}$/.test(signer) && b.receipts.length === events.length, `${b.receipts.length} receipts for ${events.length} events`);
  for (const e of events) {
    const mine = b.receipts.filter((r: J) => r?.eventSeq === e.seq);
    const r = mine[0];
    must('operator receipts', mine.length === 1 && keysOf(r) === 'commitmentId,eventHash,eventSeq,operator,signature', `event ${e.seq} has ${mine.length} receipts, or a receipt with other fields`);
    must('receipts name this commitment', r.commitmentId === id && r.eventHash === e.hash && r.operator === signer, `the receipt for event ${e.seq} names another commitment, event or operator`);
    const message = { operator: r.operator, eventSeq: BigInt(r.eventSeq), eventHash: r.eventHash, hasCommitment: true, commitmentId: r.commitmentId };
    const got = await recoverTypedDataAddress({ domain: pin!.domain, types: RECEIPT_TYPES, primaryType: 'Receipt', message, signature: r.signature }).catch(() => '');
    must('operator receipts', lc(got) === lc(signer), `the receipt for event ${e.seq} does not recover to the receipt signer ${signer}`);
  }

  // 4. The transactions: each hashes to the hash the events name, is a call to the pinned rules contract on the pinned chain.
  const named = [...new Set(events.filter((e) => e.payload?.tx !== undefined).map((e) => e.payload.tx))];
  must('transactions', keysOf(b.transactions) === [...named].sort().join(','), 'the bundle does not carry exactly the transactions the events name');
  const calls = new Map<string, { functionName: string; args: J }>();
  for (const hash of named) {
    const raw = b.transactions[hash];
    must('transactions hash to their names', ID.test(String(hash)) && HEX.test(String(raw)) && keccak256(raw) === hash, `the bytes given for transaction ${plain(String(hash))} do not hash to it`);
    let tx: J;
    try {
      tx = parseTransaction(raw);
    } catch {
      tx = null;
    }
    must('transactions call the rules contract', tx && tx.chainId === c.tokenDomain.chainId && lc(tx.to) === lc(c.rules), `transaction ${hash} is not a call to the pinned rules contract ${c.rules} on chain ${c.tokenDomain.chainId}`);
    let call: J;
    try {
      call = decodeFunctionData({ abi: RULES_ABI, data: tx.data });
    } catch {
      call = null;
    }
    must('transactions call the rules contract', call, `transaction ${hash}'s calldata is not a rules-contract call`);
    calls.set(hash, call);
  }
  const one = (type: string) => {
    const xs = events.filter((e) => e.type === type);
    must(`one ${type} event`, xs.length === 1, `the log has ${xs.length} ${type} events; this command checks deals closed by one decision (accept or reject) only`);
    return xs[0];
  };
  const callOf = (e: J, fn: string[]) => {
    const call = calls.get(e.payload?.tx);
    must(`${e.type} transaction`, call && fn.includes(call.functionName), `${e.type} names a transaction that is not ${fn.join(' or ')}`);
    must(`${e.type} transaction is for these terms`, commitmentIdOfView(call!.args[0]) === id, `the terms in transaction ${e.payload.tx} hash to another commitment ID`);
    return call!.args;
  };
  // 5. The buyer's agreement and funding, the seller's offer, the primary's acceptance: agreeAndFund's calldata.
  const funded = one('hold.funded');
  const [t, sellerSig, acc, agree, funding] = callOf(funded, ['agreeAndFund']);
  must("seller's signature in the funding call", (await recover(digestOf(pin!, id), sellerSig)) === lc(t.seller) && lc(t.seller) === lc(terms.seller), 'it does not recover to the seller');
  must("primary adjudicator's acceptance", (await recover(digestOf(pin!, acceptanceHashOf(id, t, acc)), acc.signature)) === lc(terms.adjudication.adjudicator) && acc.bondReserved === 0n, 'it does not recover to the primary adjudicator the terms name');
  const accepted = one('adjudicator.accepted').payload?.acceptance;
  must("primary adjudicator's acceptance", accepted && accepted.seedCommitment === acc.seedCommitment && accepted.nonce === acc.nonce && lc(accepted.signature) === lc(acc.signature) && secs(accepted.expiresAt) === acc.expiresAt, 'the acceptance the event records is not the one the funding call carried');
  must("buyer's agreement", (await recover(digestOf(pin!, agreeHashOf(id, t.buyer, agree)), agree.signature)) === lc(terms.buyer), 'it does not recover to the buyer the terms name');
  const total = BigInt(terms.price.amount) + BigInt(terms.adjudication.fee.amount);
  const fundingSigner = await recoverTypedDataAddress({
    domain: c.tokenDomain, types: { ReceiveWithAuthorization: ERC3009_TYPES.ReceiveWithAuthorization }, primaryType: 'ReceiveWithAuthorization',
    message: { from: terms.buyerPaymentAddress, to: c.collector, value: total, validAfter: 0n, validBefore: secs(terms.timing.fundBy), nonce: fundingNonceOf(terms, id, c) },
    signature: funding.signature,
  }).catch(() => '');
  must("payment address's funding authorization", lc(fundingSigner) === lc(terms.buyerPaymentAddress), `it does not recover to the payment address ${terms.buyerPaymentAddress} for ${total} base units`);

  // 6. The seller's delivery: in deliver's calldata, or in decide's when the decision carried it.
  const delivered = one('delivery.submitted');
  const da = callOf(delivered, ['deliver', 'decide']);
  const [dv, dvSig] = da.length === 3 ? [da[1], da[2]] : [da[2], da[3]];
  const p = delivered.payload;
  const deliveryHash = deliveryHashOfView(id, dv);
  must('delivery hash', deliveryHash === p.deliveryHash && dv.attempt === p.attempt && dv.attempt === 1, 'the delivery in the calldata is not the one the event records');
  must("seller's signature on the delivery", (await recover(digestOf(pin!, deliveryHash), dvSig)) === lc(terms.seller), 'it does not recover to the seller the terms name');
  const ct = p.ciphertext ?? {};
  const ctHash = H('bytes32, bytes32, bytes32, uint64, bytes32', [TH.ciphertext, k(String(ct.uri)), k(String(ct.sha256)), BigInt(Number.isSafeInteger(ct.bytes) ? ct.bytes : 0), k(String(ct.cipher))]);
  must('delivery names the ciphertext', ctHash === dv.ciphertextHash && k(String(p.plaintextSha256)) === dv.plaintextSha256Hash, 'the ciphertext or plaintext hash the event records is not the one the seller signed');
  const bytes = Buffer.from(b.ciphertext.slice(2), 'hex');
  const sha = `sha256:${Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex')}`;
  must('ciphertext bytes', CIPHERTEXT_ID.test(String(ct.sha256)) && sha === ct.sha256 && bytes.length === ct.bytes, `the ${bytes.length} ciphertext bytes hash to ${sha}, not the signed ${plain(String(ct.sha256))}`);

  // 7. The adjudicator's decision: decide's calldata.
  const decidedEvent = one('judgment.decided');
  const decideTx = decidedEvent.payload.tx as Hex;
  const [, m] = callOf(decidedEvent, ['decide']);
  must('decision role and outcome', m.role <= 2 && m.outcome <= 1, `the decision is ${OUTCOMES[m.outcome] ?? 'unknown'} by role ${ROLES[m.role] ?? 'unknown'}; this command checks a final accept or reject only`);
  const role = ROLES[m.role]!;
  const outcome = OUTCOMES[m.outcome]!;
  const decider = lc(role === 'primary' ? terms.adjudication.adjudicator : role === 'fallback' ? terms.adjudication.fallbackAdjudicator : terms.adjudication.appealAdjudicator);
  must('decision names the delivery', m.attempt === dv.attempt && m.deliveryHash === deliveryHash, 'the decision judged another delivery');
  must("adjudicator's signature on the decision", (await recover(digestOf(pin!, decisionHashOf(id, decider, t, m)), m.signature)) === decider, `it does not recover to the ${role} adjudicator ${decider} the terms name`);
  if (role === 'primary') must('decision reveals the seed', keccak256(m.seed) === acc.seedCommitment, "the decision's seed does not hash to the seed commitment the primary signed at acceptance");
  must('decision carries the key on an accept only', (outcome === 'accept') === (m.keyCiphertext !== ''), 'an accept carries no key for the buyer, or a reject carries one');
  const dp = decidedEvent.payload;
  must('the log records the decision', dp.role === role && dp.outcome === outcome && dp.recordHash === m.judgmentRecordHash, "the judgment.decided event is not the signed decision's");

  // 8. The judgment record: its hash, its signature, and its contents against the terms and the decision.
  const r = b.judgment ?? {};
  const { recordHash, signature: recordSig, ...recordBody } = r;
  must('judgment record hash', r.recordUri === undefined && jcsHash(recordBody) === recordHash && recordHash === m.judgmentRecordHash, `the record hashes to ${jcsHash(recordBody)}; the signed decision names ${m.judgmentRecordHash}`);
  const recordSigner = await recoverMessageAddress({ message: { raw: recordHash }, signature: recordSig }).catch(() => '');
  must("adjudicator's signature on the judgment record", lc(recordSigner) === decider, `it does not recover to the deciding adjudicator ${decider}`);
  must('judgment record names this deal', r.commitmentId === id && r.attempt === m.attempt && r.deliveryHash === deliveryHash && lc(r.adjudicator) === decider && r.role === role, 'the record is for another commitment, attempt, delivery, adjudicator or role');
  must('judgment record names the policy and seed', r.panel?.policyHash === terms.adjudication.policyHash && r.panel?.policyId === terms.adjudication.policyId && r.panel?.seed === m.seed && (role !== 'primary' || r.panel?.seedCommitment === acc.seedCommitment), "the record's policy or seed is not the terms' and the decision's");
  const want = (terms.acceptance?.deterministicChecks ?? []).map((x: J) => `${x.id}:${x.required}`).sort().join(',');
  const det: J[] = Array.isArray(r.deterministic) ? r.deterministic : [];
  must("judgment record ran the terms' checks", det.map((x) => `${x.checkId}:${x.required}`).sort().join(',') === want && det.every((x) => typeof x.passed === 'boolean'), "the record's checks are not exactly the terms' deterministic checks");
  must('judgment record decides as the decision', r.aggregate?.decision === outcome, `the record decides ${plain(String(r.aggregate?.decision))}; the signed decision is ${outcome}`);
  const criteria = terms.acceptance?.rubric?.criteria?.length ?? 0;
  if (outcome === 'accept') must('an accept follows the terms', det.every((x) => !x.required || x.passed) && (criteria === 0 || r.panel?.ran === true) && terms.acceptance?.sealedChecks === undefined, 'the record accepts with a required check failed, or with rubric criteria and no panel run, or with sealed checks this command cannot check');

  // 9. The settlement the log records is the decision's.
  const closing = events.filter((e) => e.type === 'settlement.released' || e.type === 'settlement.refunded');
  must('the log records the settlement', closing.length === 1 && closing[0].type === (outcome === 'accept' ? 'settlement.released' : 'settlement.refunded') && closing[0].payload.tx === decideTx, `the log does not close the deal with the decision's ${outcome}`);
  for (const e of events) if (e.payload?.tx !== undefined) must('every transaction is checked', [funded.payload.tx, delivered.payload.tx, decideTx].includes(e.payload.tx), `${plain(String(e.type))} names transaction ${e.payload.tx}, which none of the checked calls is`);

  // What it proves, and the one chain read.
  const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-4)}`;
  const rpcCommand = `curl -s -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt","params":["${decideTx}"]}' https://ethereum-sepolia-rpc.publicnode.com`;
  const required = det.filter((x) => x.required);
  const lines = [
    `PASSED  ${passed.length} offline checks on commitment ${id}, chain ${c.tokenDomain.chainId}, rules contract ${lc(c.rules)}.`,
    '',
    'What this file proves, with no network:',
    `- The seller ${lc(terms.seller)} signed these terms. They hash to the commitment ID, so no term can differ from what was signed.`,
    `- The buyer ${lc(terms.buyer)} signed its agreement to them, and its payment address ${lc(terms.buyerPaymentAddress)} signed the transfer of ${money(total, terms.price.token, pin!)} into the escrow: the price ${money(BigInt(terms.price.amount), terms.price.token, pin!)} and the adjudicator's fee.`,
    `- The primary adjudicator ${lc(terms.adjudication.adjudicator)} signed its acceptance of the case.`,
    `- The seller signed delivery ${short(deliveryHash)}; its encrypted work (${bytes.length} bytes, ${short(sha)}) is in this file.`,
    `- The ${role} adjudicator ${decider} signed the decision "${outcome}" on that delivery, citing judgment record ${short(recordHash)}, which it also signed.`,
    `- That record ran exactly the terms' ${det.length} deterministic checks: ${det.map((x) => `${plain(String(x.checkId))} ${x.passed ? 'passed' : 'FAILED'}`).join(', ')}${required.length === det.length ? ', all required' : ''}. ${r.panel?.ran ? 'A judge panel ran.' : criteria === 0 ? 'No judge panel ran: the terms have no rubric criteria.' : 'No judge panel ran.'} Its reasons: ${plain((r.aggregate?.reasons ?? []).join('; ')).slice(0, 300)}.`,
    `- These signed messages are in transactions ${named.map(short).join(', ')}, whose bytes are in this file and hash to those transaction hashes.`,
    `- Operator ${signer} signed a receipt for each of the ${events.length} events it recorded. That is this operator's own account: compare the address with GET /v1/status of an operator you trust.`,
    '',
    'What it does not prove:',
    `- That the transactions were mined and succeeded, so that the money moved. One chain read proves it: the receipt of the decide transaction ${decideTx}. From a node you trust:`,
    `    ${rpcCommand} > receipt.json`,
    `  then run this check again with --receipt receipt.json.`,
    "- That the work itself passes the checks. The work is encrypted to the buyer and the adjudicators; a key holder can open it and rerun the checks with examples/check-delivery.ts.",
  ];

  // The chain read's answer, when given: checked offline too.
  if (o.receipt !== undefined) {
    const x = o.receipt?.result !== undefined ? o.receipt.result : o.receipt;
    must('chain receipt', x && x.transactionHash === decideTx && x.status === '0x1' && lc(x.to) === lc(c.rules), `the receipt is not a successful receipt of transaction ${decideTx} to the rules contract`);
    const logs = (Array.isArray(x.logs) ? x.logs : []).filter((l: J) => lc(l.address) === lc(c.rules)).map((l: J) => {
      try {
        return decodeEventLog({ abi: RULES_ABI, data: l.data, topics: l.topics }) as J;
      } catch {
        return null;
      }
    }).filter(Boolean);
    const decided = logs.find((l: J) => l.eventName === 'Decided' && l.args.id === id);
    must('chain receipt records the decision', decided && lc(decided.args.adjudicator) === decider && decided.args.role === m.role && decided.args.outcome === m.outcome && decided.args.judgmentRecordHash === recordHash && decided.args.seed === m.seed, 'the receipt has no Decided event for this commitment with the signed decision');
    const paid = logs.find((l: J) => l.eventName === (outcome === 'accept' ? 'PaymentReleased' : 'Refunded') && l.args.jobId === id && l.args.amount === BigInt(terms.price.amount));
    must('chain receipt records the payment', paid, `the receipt has no ${outcome === 'accept' ? 'PaymentReleased' : 'Refunded'} event for the price ${terms.price.amount} on this commitment`);
    lines.splice(lines.indexOf('What it does not prove:'), 4,
      'What the chain read adds:',
      `- Transaction ${decideTx} succeeded in block ${BigInt(x.blockNumber)} on the chain the node serves: the rules contract recorded the decision "${outcome}" and ${outcome === 'accept' ? `paid the price ${money(BigInt(terms.price.amount), terms.price.token, pin!)} to the seller` : `returned the price ${money(BigInt(terms.price.amount), terms.price.token, pin!)} to the buyer`}. The contract checked the same signatures when it ran.`,
      '',
      'What it does not prove:');
    lines[0] = `PASSED  ${passed.length} checks on commitment ${id}, chain ${c.tokenDomain.chainId}, rules contract ${lc(c.rules)}: offline, and the chain read you gave.`;
  }
  return { lines, decideTx, rpcCommand };
}

/** Reads one deal's bundle from one operator and a Sepolia node: the only network step. */
export async function fetchBundle(id: string, o: { operator: string; rpc: string }): Promise<Bundle> {
  if (!ID.test(id)) throw new Error('give the commitment ID as 0x and 64 lowercase hex characters');
  const base = new URL(o.operator).origin;
  const get = async (path: string) => {
    const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`${base}${path} answered ${res.status}${res.status === 401 ? ' (a private deal: this command checks public deals only)' : ''}`);
    return res;
  };
  const json = async (path: string) => (await get(path)).json() as Promise<J>;
  const page = async (path: string) => {
    const items: J[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 50; i++) {
      const body: J = await json(`${path}?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      items.push(...(Array.isArray(body.items) ? body.items : []));
      cursor = typeof body.nextCursor === 'string' && body.nextCursor ? body.nextCursor : null;
      if (!cursor) break;
    }
    return items;
  };
  const status = await json('/v1/status');
  const terms = await json(`/v1/commitments/${id}/terms`);
  const events = (await page(`/v1/commitments/${id}/events`)).sort((a, b) => a.seq - b.seq);
  const receipts = (await page(`/v1/commitments/${id}/receipts`)).sort((a, b) => a.eventSeq - b.eventSeq);
  const judgment = await json(`/v1/commitments/${id}/judgment`);
  delete judgment.recordUri; // outside recordHash, so nothing could check it
  const sha = String(events.find((e) => e.type === 'delivery.submitted')?.payload?.ciphertext?.sha256);
  if (!CIPHERTEXT_ID.test(sha)) throw new Error('the deal has no delivery with a ciphertext');
  const ciphertext = `0x${Buffer.from(await (await get(`/v1/ciphertext/${sha}`)).arrayBuffer()).toString('hex')}` as Hex;
  const transactions: Record<string, Hex> = {};
  for (const tx of [...new Set(events.filter((e) => e.payload?.tx !== undefined).map((e) => String(e.payload.tx)))]) {
    if (!ID.test(tx)) throw new Error(`an event names a malformed transaction hash ${plain(tx).slice(0, 80)}`);
    const res = await fetch(o.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getRawTransactionByHash', params: [tx] }), signal: AbortSignal.timeout(20_000) });
    const raw = ((await res.json()) as J)?.result;
    if (typeof raw !== 'string' || !HEX.test(raw)) throw new Error(`the node at ${new URL(o.rpc).origin} did not serve transaction ${tx}; set SEPOLIA_RPC_URL to a node that answers eth_getRawTransactionByHash`);
    transactions[tx] = raw as Hex;
  }
  return { bundle: FORMAT, commitmentId: id as Hex, operator: { receiptSigner: status.receiptSigner, domain: status.domain }, terms, events, receipts, judgment, ciphertext, transactions };
}

const USAGE = [
  'evidence: one finished deal in one file, checked offline.',
  'Usage:',
  '  node examples/evidence.ts fetch <commitment ID> [--out <file>]   (env HOLDBACK_OPERATOR, SEPOLIA_RPC_URL)',
  '  node examples/evidence.ts check <bundle file> [--receipt <file>]',
  'Example:',
  '  node examples/evidence.ts fetch 0x341562ccb28591a4df09a0cfbabfeffec1fff011631585e0a020a177ec192e9b --out deal.json',
  '  node examples/evidence.ts check deal.json',
  'check makes no network call. It exits 0 when every check passed, 1 when one failed, 2 when it could not run.',
].join('\n');

class UsageError extends Error {}
export async function main(argv: readonly string[], io = { out: (s: string) => console.log(s), err: (s: string) => console.error(s) }): Promise<number> {
  const help = (a: string | undefined) => a === '--help' || a === '-h';
  if (argv.some(help)) {
    (help(argv[0]) ? io.out : io.err)(USAGE);
    return help(argv[0]) ? 0 : 2;
  }
  try {
    const [cmd, target, ...rest] = argv;
    const flag = (name: string) => {
      const i = rest.indexOf(name);
      if (i < 0) return undefined;
      if (rest[i + 1] === undefined) throw new UsageError(`${name} needs a file`);
      return rest[i + 1];
    };
    const known = new Set(['--out', '--receipt']);
    for (let i = 0; i < rest.length; i += 2) if (!known.has(rest[i]!)) throw new UsageError(`unknown option ${plain(rest[i]!)}`);
    if (!target) throw new UsageError('give a commitment ID or a bundle file');
    if (cmd === 'fetch') {
      const bundle = await fetchBundle(target, { operator: process.env['HOLDBACK_OPERATOR'] || 'https://api.crow.direct', rpc: process.env['SEPOLIA_RPC_URL'] || 'https://ethereum-sepolia-rpc.publicnode.com' });
      const out = flag('--out') ?? `evidence-${target.slice(0, 10)}.json`;
      writeFileSync(out, `${JSON.stringify(bundle, null, 2)}\n`);
      io.out(`Wrote ${out}: ${bundle.events.length} events, ${Object.keys(bundle.transactions).length} transactions. Check it with: node examples/evidence.ts check ${out}`);
      return 0;
    }
    if (cmd !== 'check') throw new UsageError('the first word is fetch or check');
    const read = (f: string) => JSON.parse(readFileSync(f, 'utf8')) as J;
    const receiptFile = flag('--receipt');
    const r = await checkBundle(read(target), receiptFile ? { receipt: read(receiptFile) } : {});
    (r.ok ? io.out : io.err)(r.lines.join('\n'));
    return r.ok ? 0 : 1;
  } catch (e) {
    io.err(e instanceof UsageError ? `evidence: ${e.message}\n${USAGE}` : `evidence: could not run: ${plain(e instanceof Error ? e.message : String(e)).slice(0, 300)}. This says nothing about the deal.`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2)).then((code) => (process.exitCode = code));

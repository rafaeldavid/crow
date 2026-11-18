// Case study 3 (T-535): checks a waiver's settlement note from the settlement transaction alone, as ADR-0039 section 4
// says a reader does. examples/evidence.ts does not cover a settlement by agreement yet, so this is the reader's check
// for that one path. It reads one transaction and its receipt from a Sepolia node, and nothing from the operators.
//
//   node docs/research/2026-11-18-case-study-3/note-check.ts --tx <settlement transaction> --note <note.json> --commitment <ID> [--rpc <url>]
//
// It checks, and prints a line for each:
//   1. the transaction calls mutualSettle on the rules contract pinned in examples/deployments.ts, and it succeeded;
//   2. the terms in its call data hash to the commitment ID;
//   3. both settlement signatures recover, under the deployment's domain, to the terms' buyer and seller;
//   4. the note's domain-free EIP-712 struct hash is the settlement's nonce, so both parties signed this note;
//   5. the note names the delivery the settlement names, and the settlement releases that delivery's key.
import { readFileSync } from 'node:fs';
import { decodeFunctionData, hashStruct, recoverTypedDataAddress, type Hex } from '../../../examples/node_modules/viem/_esm/index.js';
import { commitmentIdOfView } from '../../../examples/evidence.ts';
import { knownPins, TYPES } from '../../../examples/verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** ADR-0039 section 4. */
const NOTE_TYPES = { SettlementNote: [
  { name: 'kind', type: 'string' }, { name: 'deliveryHash', type: 'bytes32' }, { name: 'waivedChecks', type: 'string[]' },
  { name: 'successor', type: 'bytes32' }, { name: 'salt', type: 'bytes32' },
] } as const;

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const [txHash, noteFile, id] = [arg('--tx'), arg('--note'), arg('--commitment')];
const rpc = arg('--rpc') ?? 'https://ethereum-sepolia-rpc.publicnode.com';
if (!txHash || !noteFile || !id) {
  console.error('usage: node note-check.ts --tx <hash> --note <note.json> --commitment <ID> [--rpc <url>]');
  process.exit(2);
}
const lc = (s: unknown) => String(s).toLowerCase();
let failed = 0;
const check = (ok: boolean, line: string) => { console.log(`${ok ? 'pass' : 'FAIL'}  ${line}`); if (!ok) failed++; };
const read = async (method: string, params: unknown[]) => {
  const res = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return ((await res.json()) as J).result;
};

const pin = knownPins().find((p) => p.domain.chainId === 11155111);
if (!pin) throw new Error('examples/deployments.ts pins no Sepolia deployment');
const abis = JSON.parse(readFileSync(new URL('../../../packages/settlement/evm/abis.json', import.meta.url), 'utf8'));
const note = JSON.parse(readFileSync(noteFile, 'utf8'));
const tx = await read('eth_getTransactionByHash', [txHash]);
const receipt = await read('eth_getTransactionReceipt', [txHash]);

const rules = lc(pin.domain.verifyingContract);
const call = decodeFunctionData({ abi: abis.rules, data: tx.input }) as J;
check(lc(tx.to) === rules && call.functionName === 'mutualSettle' && receipt?.status === '0x1', `${txHash} calls mutualSettle on the rules contract ${rules} and succeeded (block ${Number(receipt?.blockNumber)})`);
const [t, m] = call.args;
const viewId = commitmentIdOfView(t);
check(lc(viewId) === lc(id), `its terms hash to the commitment ID ${viewId}`);

const message = {
  commitmentId: viewId, hasDelivery: m.hasDelivery, deliveryHash: m.deliveryHash,
  payouts: m.payouts.map((p: J) => ({ to: p.to, amount: { token: lc(t.token), amount: p.amount } })),
  releaseKey: m.releaseKey, nonce: m.nonce, expiresAt: m.expiresAt,
};
const typed = { domain: pin.domain, types: TYPES, primaryType: 'MutualSettlement', message } as J;
const buyer = await recoverTypedDataAddress({ ...typed, signature: m.buyerSignature });
const seller = await recoverTypedDataAddress({ ...typed, signature: m.sellerSignature });
check(lc(buyer) === lc(t.buyer) && lc(seller) === lc(t.seller), `the settlement's two signatures recover to the terms' buyer ${lc(t.buyer)} and seller ${lc(t.seller)}`);

const noteHash = hashStruct({ types: NOTE_TYPES, primaryType: 'SettlementNote', data: note });
check(lc(noteHash) === lc(m.nonce), `the note's hash ${noteHash} is the settlement's nonce: both parties signed this note`);
check(lc(note.deliveryHash) === lc(m.deliveryHash) && m.hasDelivery === true && m.releaseKey === true, `the note names delivery ${note.deliveryHash}, the delivery the settlement names, and the settlement releases its key`);
console.log(`${failed ? 'FAILED' : 'PASSED'}  note kind ${note.kind}, waived checks ${note.waivedChecks.join(', ')}; payouts ${m.payouts.map((p: J) => `${p.amount} base units to ${lc(p.to)}`).join('; ')}`);
process.exit(failed ? 1 : 0);

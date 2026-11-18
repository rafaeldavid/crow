// The test seller's quote address (T-489): what it sells by quote, and the checks of a quote request. A buyer that
// follows site/buy.txt with the pinned buy.mjs asks POST <base>/quote for a price and reads GET <base>/defaults to see
// how the offer differs from the seller's published terms. The product is the setup command's sample
// (examples/setup-sample-api.ts, imported unchanged): squares.csv, decided by three deterministic checks, so a deal
// spends no judge call. Nothing here signs or sends; seller.ts makes the offer from the seller's one standing address.
import { SAMPLE, SAMPLE_PRICE_UNITS, sampleResult } from '../../../examples/setup-sample-api.ts';
import { QUOTE_LIMITS, QUOTE_TIMING } from './catalog.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The card's name for the product it sells by quote. */
export const QUOTE_ID = 'squares';
export const QUOTE_PRICE_UNITS = SAMPLE_PRICE_UNITS; // 1 tUSDC: 6 decimals
export const QUOTE_DESCRIPTION = "Crow's sample product by quote: squares.csv, the squares of 1 to rows, for 1 tUSDC. Scope {\"rows\": 3 to 50}; three checks decide, no judge.";

const ROWS = SAMPLE.scope.rows;
const PLACEHOLDER = /\{\{rows\}\}/g;

/** The sample's template with {{rows}} filled: a whole-string placeholder becomes the number, as the adapter fills it. */
function filled(node: J, rows: number): J {
  if (typeof node === 'string') return node === '{{rows}}' ? rows : node.replace(PLACEHOLDER, String(rows));
  if (Array.isArray(node)) return node.map((n) => filled(n, rows));
  if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, filled(v, rows)]));
  return node;
}

/** The deliverable and checks one quote offers, for a scope already checked. */
export function quoteTerms(scope: { rows: number }): { deliverable: J; checks: J[] } {
  const t = filled(SAMPLE.template, scope.rows);
  return { deliverable: t.deliverable, checks: t.checks };
}

/** The bytes a quoted deal delivers: the sample's result for its scope. */
export const quoteWork = (scope: { rows: number }): string => new TextDecoder().decode(sampleResult(scope));

/** GET <base>/defaults: the published terms, in the seller adapter's shape. Placeholders stay; the buyer's tool fills them. */
export function quoteDefaults(): J {
  return {
    version: 1,
    deliverable: SAMPLE.template.deliverable,
    checks: SAMPLE.template.checks,
    timing: QUOTE_TIMING,
    scope: SAMPLE.scope,
    options: {},
  };
}

export interface QuoteRequest {
  buyer: string;
  buyerEncryptionPublicKey: string;
  buyerPaymentAddress?: string;
  scope: { rows: number };
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const NEXT = 'Fix the field and ask again with a new key store directory (buy.txt, step 3).';

/** A quote body, checked: the request, or why it is refused, naming the field and the next step. */
export function readQuote(body: J): QuoteRequest | string {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return `send one JSON object: {buyer, buyerEncryptionPublicKey, scope}. ${NEXT}`;
  const known = ['buyer', 'buyerEncryptionPublicKey', 'buyerPaymentAddress', 'scope', 'options'];
  const extra = Object.keys(body).find((k) => !known.includes(k));
  if (extra !== undefined) return `the quote has a field this seller does not take: ${extra.replace(/[^\x20-\x7e]/g, '?').slice(0, 40)}. ${NEXT}`;
  if (typeof body.buyer !== 'string' || !ADDRESS.test(body.buyer)) return `buyer must be your address: 0x and 40 hex characters. ${NEXT}`;
  if (typeof body.buyerEncryptionPublicKey !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.buyerEncryptionPublicKey) || Buffer.from(body.buyerEncryptionPublicKey, 'base64url').length !== 32) return `buyerEncryptionPublicKey must be your x25519 public key, 43 characters of base64url. ${NEXT}`;
  if (body.buyerPaymentAddress !== undefined && (typeof body.buyerPaymentAddress !== 'string' || !ADDRESS.test(body.buyerPaymentAddress))) return `buyerPaymentAddress must be an address, or left out for the buyer's own. ${NEXT}`;
  if (body.options !== undefined && (body.options === null || typeof body.options !== 'object' || Array.isArray(body.options) || Object.keys(body.options).length > 0)) return `this seller takes no options: leave them out. ${NEXT}`;
  const s = body.scope;
  if (s === null || typeof s !== 'object' || Array.isArray(s)) return `scope must be {"rows": <a whole number from ${ROWS.min} to ${ROWS.max}>}. ${NEXT}`;
  const other = Object.keys(s).find((k) => k !== 'rows');
  if (other !== undefined) return `scope has a field this seller does not take: ${other.replace(/[^\x20-\x7e]/g, '?').slice(0, 40)}; it takes rows only. ${NEXT}`;
  if (!Number.isSafeInteger(s.rows) || s.rows < ROWS.min || s.rows > ROWS.max) return `scope.rows must be a whole number from ${ROWS.min} to ${ROWS.max}. ${NEXT}`;
  return {
    buyer: body.buyer.toLowerCase(),
    buyerEncryptionPublicKey: body.buyerEncryptionPublicKey,
    ...(body.buyerPaymentAddress === undefined ? {} : { buyerPaymentAddress: body.buyerPaymentAddress.toLowerCase() }),
    scope: { rows: s.rows },
  };
}

/** Reads a request body of at most QUOTE_LIMITS.bodyBytes as JSON: undefined when it is longer, null when it is not JSON. */
export async function boundedJson(request: Request): Promise<J | undefined> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > QUOTE_LIMITS.bodyBytes) return undefined;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > QUOTE_LIMITS.bodyBytes) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    parts.push(value);
  }
  try {
    return JSON.parse(new TextDecoder().decode(Buffer.concat(parts)));
  } catch {
    return null;
  }
}

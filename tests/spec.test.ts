import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rulebookHash } from '../packages/core/src/canonical.ts';
import { commitmentId, registrationBodyHash } from '../packages/core/src/eip712.ts';
import { parsers } from '../packages/core/src/parse.ts';
// @ts-expect-error -- plain ESM helper without type declarations
import { loadSpec as loadSpecFresh, validateExamples as validateExamplesFresh } from '../scripts/spec.mjs';

// Compile every schema once per file (T-022): the tests only read the shared Ajv instance and clone
// the examples before changing them, so one load serves all of them.
let spec: ReturnType<typeof loadSpecFresh> | undefined;
let exampleResults: ReturnType<typeof validateExamplesFresh> | undefined;
const loadSpec = () => (spec ??= loadSpecFresh());
const validateExamples = () => (exampleResults ??= validateExamplesFresh(loadSpec()));

const V = 'https://holdback.dev/schemas/v0.15';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const example = (name: string): any => structuredClone(loadSpec().examples.find((e: { name: string }) => e.name === name).data);

describe('spec/', () => {
  it('validates every example against the schema of the same name', () => {
    const results = validateExamples();
    expect(results.filter((r: { ok: boolean }) => !r.ok)).toEqual([]);
    const names = [
      'page', 'operator-status', 'receipt', 'messages.dispute', 'messages.transfer', 'event.fee-operator', 'messages.mutual-settlement', 'event.offered',
      'commitment-state.final', 'commitment.private', 'messages.read-token', 'messages.delegation', 'messages.key-registration', 'disclosure', 'projection',
      'messages.adjudicator-registration',
    ];
    expect(results.map((r: { file: string }) => r.file)).toEqual(expect.arrayContaining(names.map((n) => `${n}.example.json`)));
  });

  it('rejects a fractional token amount', () => {
    const { ajv } = loadSpec();
    const validate = ajv.getSchema(`${V}/common.schema.json#/$defs/TokenAmount`);
    expect(validate).toBeDefined();
    expect(validate({ token: 'tUSD', amount: '2050000000' })).toBe(true);
    expect(validate({ token: 'tUSD', amount: '2050.5' })).toBe(false);
  });

  it.each(['registryHash', 'policyHash'])('requires a commitment to bind adjudication.%s', (field) => {
    const { ajv, examples } = loadSpec();
    const validate = ajv.getSchema(`${V}/commitment.schema.json`);
    const commitment = structuredClone(examples.find((e: { name: string }) => e.name === 'commitment').data);
    expect(validate(commitment)).toBe(true);
    delete commitment.adjudication[field];
    expect(validate(commitment)).toBe(false);
  });

  it('requires each verdict to carry both the template hash and the input hash', () => {
    const { ajv, examples } = loadSpec();
    const validate = ajv.getSchema(`${V}/judgment.schema.json`);
    const judgment = structuredClone(examples.find((e: { name: string }) => e.name === 'judgment').data);
    expect(validate(judgment)).toBe(true);
    delete judgment.panel.members[0].inputHash;
    expect(validate(judgment)).toBe(false);
  });

  it('keeps the panel commitment out of the commitment terms, so the ID is not circular', () => {
    const { ajv, examples } = loadSpec();
    const validate = ajv.getSchema(`${V}/commitment.schema.json`);
    const commitment = structuredClone(examples.find((e: { name: string }) => e.name === 'commitment').data);
    commitment.adjudication.panelCommitment = commitment.adjudicatorAcceptance.seedCommitment;
    expect(validate(commitment)).toBe(false);
  });

  it.each([
    ['messages.decision', 'seed'],
    ['messages.acceptance', 'seedCommitment'],
  ])('rejects a %s message without %s', (name, field) => {
    const { ajv, examples } = loadSpec();
    const validate = ajv.getSchema(`${V}/messages.schema.json`);
    const message = structuredClone(examples.find((e: { name: string }) => e.name === name).data);
    expect(validate(message)).toBe(true);
    delete message[field];
    expect(validate(message)).toBe(false);
  });

  // ADR-0023 and ADR-0024: v0.7 and v0.8 were additive and kept the signed encoding at 0.6. ADR-0029: v0.9 changes
  // EarlyAccept and Decision, so the EIP-712 domain version and commitment.schemaVersion move to 0.7. ADR-0030: v0.10
  // adds AdjudicatorRegistration, a new type, and keeps both at 0.7. ADR-0033: v0.11 adds the buyer's payment address
  // and the seller's payout address to the terms, so both move to 0.8. ADR-0040 and ADR-0041: v0.12 widens the parties'
  // signatures and changes no signed struct, so both stay at 0.8. ADR-0045: v0.13 adds the signature_valid check kind
  // and an adjudicator's checkKinds list, and ADR-0047: v0.14 adds the three data check kinds; neither changes a signed struct, so both stay at 0.8.
  // ADR-0050: v0.15 adds the coded judge verdict and the judgment record's coded seat; no signed struct changes.
  it('moves every schema $id to v0.15 and keeps the commitment schemaVersion at 0.8', () => {
    const { schemas, ajv } = loadSpec();
    for (const id of schemas.values()) expect(id).toMatch(/\/schemas\/v0\.15\//);
    const validate = ajv.getSchema(`${V}/commitment.schema.json`);
    const c = example('commitment');
    expect(c.schemaVersion).toBe('0.8');
    c.schemaVersion = '0.7';
    expect(validate(c)).toBe(false);
  });

  // ADR-0040 §5 and ADR-0041 (D82, D84): a buyer's and a seller's signatures are PartySignature, any non-empty bytes, so a
  // contract signer's ERC-1271 signature travels; every other signer keeps the 65-byte Signature.
  const sig = (bytes: number) => `0x${'ab'.repeat(bytes)}`;
  const agree = () => ({ type: 'Agree', commitmentId: `0x${'11'.repeat(32)}`, buyer: `0x${'22'.repeat(20)}`, nonce: `0x${'33'.repeat(32)}`, expiresAt: '2026-11-20T00:00:00Z', signature: sig(65) });
  const offer = () => ({ type: 'Offer', commitmentId: `0x${'11'.repeat(32)}`, seller: `0x${'44'.repeat(20)}`, nonce: `0x${'33'.repeat(32)}`, expiresAt: '2026-11-20T00:00:00Z', signature: sig(65) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Site = [label: string, schema: string, make: () => any, path: string[]];
  const partySites: Site[] = [
    ['the seller on the terms', 'commitment', () => example('commitment'), ['signatures', 'seller']],
    ['the buyer on the terms', 'commitment', () => example('commitment'), ['signatures', 'buyer']],
    ['the seller on a delivery', 'delivery', () => example('delivery'), ['signature']],
    ['an Offer', 'messages', offer, ['signature']],
    ['an Agree', 'messages', agree, ['signature']],
    ['an EarlyAccept', 'messages', () => example('messages.early-accept'), ['signature']],
    ['a Dispute', 'messages', () => example('messages.dispute'), ['signature']],
    ['the buyer on a MutualSettlement', 'messages', () => example('messages.mutual-settlement'), ['buyerSignature']],
    ['the buyer on a Publish', 'messages', () => example('messages.publish'), ['buyerSignature']],
    ['the seller on a MutualSettlement', 'messages', () => example('messages.mutual-settlement'), ['sellerSignature']],
    ['the seller on a Publish', 'messages', () => example('messages.publish'), ['sellerSignature']],
    ['an appeal', 'appeal', () => example('appeal'), ['signature']],
  ];
  const keySites: Site[] = [
    ['a Decision', 'messages', () => example('messages.decision'), ['signature']],
    ['an AdjudicatorAcceptance', 'messages', () => example('messages.acceptance'), ['signature']],
    ['the ERC-3009 funding authorization', 'messages', () => example('messages.funding'), ['signature']],
    ['the operator fee transfer', 'messages', () => example('messages.transfer'), ['signature']],
    ['a ReadToken', 'messages', () => example('messages.read-token'), ['signature']],
    ['a Delegation', 'messages', () => example('messages.delegation'), ['signature']],
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const withSig = (make: () => any, path: string[], value: string) => {
    const doc = make();
    let at = doc;
    for (const k of path.slice(0, -1)) at = at[k];
    at[path[path.length - 1]!] = value;
    return doc;
  };

  it.each(partySites)('takes a contract signature of any length from %s, and refuses one that is empty or malformed', (_, schema, make, path) => {
    const validate = loadSpec().ajv.getSchema(`${V}/${schema}.schema.json`)!;
    for (const ok of [sig(65), sig(1), sig(64), sig(66), sig(1000)]) expect(validate(withSig(make, path, ok))).toBe(true);
    for (const bad of ['0x', '0xabc', `0x${'AB'.repeat(65)}`, 'ab'.repeat(65), `0x${'zz'.repeat(65)}`]) expect(validate(withSig(make, path, bad))).toBe(false);
  });

  it.each(keySites)('keeps exactly 65 bytes for %s', (_, schema, make, path) => {
    const validate = loadSpec().ajv.getSchema(`${V}/${schema}.schema.json`)!;
    expect(validate(withSig(make, path, sig(65)))).toBe(true);
    for (const bad of [sig(64), sig(66), sig(1000), '0x']) expect(validate(withSig(make, path, bad))).toBe(false);
  });

  it("keeps the adjudicator's acceptance inside the terms at 65 bytes", () => {
    const validate = loadSpec().ajv.getSchema(`${V}/commitment.schema.json`)!;
    const c = example('commitment');
    expect(c.adjudicatorAcceptance).toBeDefined();
    c.adjudicatorAcceptance.signature = sig(66);
    expect(validate(c)).toBe(false);
  });

  // ADR-0033: both money addresses are required; an appeal window of 0 is valid (§2b), and a rulebook may take it.
  it.each(['buyerPaymentAddress', 'sellerPayoutAddress'])('refuses a commitment without %s', (field) => {
    const validate = loadSpec().ajv.getSchema(`${V}/commitment.schema.json`)!;
    const c = example('commitment');
    expect(validate(c)).toBe(true);
    delete c[field];
    expect(validate(c)).toBe(false);
  });

  it('takes an appeal window of 0 in a commitment and a rulebook minimum of 0', () => {
    const { ajv } = loadSpec();
    const c = example('commitment');
    expect(c.timing.appealWindowSec).toBe(0);
    expect(ajv.getSchema(`${V}/commitment.schema.json`)!(c)).toBe(true);
    c.timing.appealWindowSec = -1;
    expect(ajv.getSchema(`${V}/commitment.schema.json`)!(c)).toBe(false);
    const club = example('club');
    expect(club.rulebook.minWindowsSec.appealWindow).toBe(0);
    expect(ajv.getSchema(`${V}/club.schema.json`)!(club)).toBe(true);
  });

  // ADR-0029: every message that pays or judges, and the judgment record, names the delivery it settles.
  it.each([
    ['messages.decision', 'messages'],
    ['messages.early-accept', 'messages'],
    ['judgment', 'judgment'],
  ])('refuses %s without a deliveryHash', (name, schemaName) => {
    const validate = loadSpec().ajv.getSchema(`${V}/${schemaName}.schema.json`)!;
    const m = example(name);
    expect(validate(m)).toBe(true);
    delete m.deliveryHash;
    expect(validate(m)).toBe(false);
  });

  // The EVM adapter adds its transaction to every chain event's payload (v0.9); the closed payloads admit it.
  it.each(['event.bond-slashed', 'event.fee-operator'])('admits the chain transaction fields in %s', (name) => {
    const validate = loadSpec().ajv.getSchema(`${V}/event.schema.json`)!;
    const e = example(name);
    e.payload = { ...e.payload, tx: `0x${'ab'.repeat(32)}`, block: '123', sender: '0x1111111111111111111111111111111111111111', gasUsed: '21000' };
    expect(validate(e)).toBe(true);
    e.payload.block = 123;
    expect(validate(e)).toBe(false);
    e.payload.block = '123';
    e.payload.extra = 1;
    expect(validate(e)).toBe(false);
  });

  describe('operator fee (ADR-0023, D33)', () => {
    const schema = (name: string) => loadSpec().ajv.getSchema(`${V}/${name}.schema.json`);
    it.each(['to', 'value', 'purpose', 'commitmentId', 'nonce', 'signature'])('requires a TransferAuthorization to carry %s', (field) => {
      const m = example('messages.transfer');
      expect(schema('messages')(m)).toBe(true);
      delete m[field];
      expect(schema('messages')(m)).toBe(false);
    });
    it('refuses a fractional or negative fee value and an unknown purpose', () => {
      for (const [k, v] of [['value', '0.5'], ['value', '-1'], ['purpose', 'tip']] as const) {
        const m = example('messages.transfer');
        m[k] = v;
        expect(schema('messages')(m), `${k}=${v}`).toBe(false);
      }
    });
    it('keeps fees optional in status and refuses a fractional bps, a float min or a refundable fee', () => {
      const s = example('operator-status');
      expect(s.fees.operator).toMatchObject({ bps: 1, min: '10000', max: null, appliesAt: 'agree-and-fund', refundable: false });
      const bare = structuredClone(s);
      delete bare.fees;
      expect(schema('operator-status')(bare)).toBe(true);
      for (const [k, v] of [['bps', 0.5], ['bps', 10001], ['min', '0.01'], ['refundable', true], ['appliesAt', 'deliver']] as const) {
        const bad = structuredClone(s);
        bad.fees.operator[k] = v;
        expect(schema('operator-status')(bad), `${k}=${v}`).toBe(false);
      }
      const capped = structuredClone(s);
      capped.fees.operator.max = '100000000';
      expect(schema('operator-status')(capped)).toBe(true);
    });
  });

  it.each(['operator', 'eventSeq', 'eventHash', 'signature'])('requires a receipt to carry %s', (field) => {
    const validate = loadSpec().ajv.getSchema(`${V}/receipt.schema.json`);
    const r = example('receipt');
    expect(validate(r)).toBe(true);
    delete r[field];
    expect(validate(r)).toBe(false);
  });

  it('pages carry items and a nextCursor that is null at the end', () => {
    const validate = loadSpec().ajv.getSchema(`${V}/page.schema.json`);
    const p = example('page');
    expect(validate(p)).toBe(true);
    expect(validate({ ...p, nextCursor: null })).toBe(true);
    const missing = structuredClone(p);
    delete missing.nextCursor;
    expect(validate(missing)).toBe(false);
  });

  it('publishes the EIP-712 domain and receipt signer in operator status', () => {
    const validate = loadSpec().ajv.getSchema(`${V}/operator-status.schema.json`);
    const s = example('operator-status');
    expect(validate(s)).toBe(true);
    for (const field of ['domain', 'receiptSigner']) {
      const bad = structuredClone(s);
      delete bad[field];
      expect(validate(bad)).toBe(false);
    }
  });

  describe('optimistic timing (ADR-0015)', () => {
    const validate = () => loadSpec().ajv.getSchema(`${V}/commitment.schema.json`);
    const dispute = { disputeBy: '2026-11-06T17:00:00Z', disputeJudgeSec: 86400, disputeFallbackSec: 86400 };
    it('requires the dispute fields in optimistic mode', () => {
      const c = example('commitment');
      c.settlement.mode = 'optimistic';
      expect(validate()(c)).toBe(false);
      Object.assign(c.timing, dispute);
      expect(validate()(c)).toBe(true);
    });
    it('forbids the dispute fields in the other modes', () => {
      const c = example('commitment');
      Object.assign(c.timing, dispute);
      expect(validate()(c)).toBe(false);
    });
  });

  describe('club rulebook', () => {
    const validate = () => loadSpec().ajv.getSchema(`${V}/club.schema.json`);
    it('admits only the listed randomness sources, and a beacon source names its chain', () => {
      const c = example('club');
      expect(c.rulebook.randomness).toEqual({ source: 'sim' });
      c.rulebook.randomness = { source: 'coinflip' };
      expect(validate()(c)).toBe(false);
      c.rulebook.randomness = { source: 'drand-quicknet' };
      expect(validate()(c)).toBe(false);
      c.rulebook.randomness = { source: 'drand-quicknet', chainHash: '0x' + '52'.repeat(32) };
      expect(validate()(c)).toBe(true);
    });
    it('needs an optimistic default outcome once optimistic mode is allowed', () => {
      const c = example('club');
      c.rulebook.allowedSettlementModes = ['guaranteed_on_decision', 'optimistic'];
      delete c.rulebook.defaultOutcome.optimistic;
      expect(validate()(c)).toBe(false);
    });
    it.each(['firstLossShareMinBps', 'bondNoticePeriodMinSec', 'randomness', 'minInspectionWindowSec', 'disputeBond'])('requires %s', (field) => {
      const c = example('club');
      expect(validate()(c)).toBe(true);
      delete c.rulebook[field];
      expect(validate()(c)).toBe(false);
    });
  });

  describe('adjudicator pool (ADR-0014)', () => {
    const validate = () => loadSpec().ajv.getSchema(`${V}/adjudicator.schema.json`);
    it('binds pool terms by poolTermsHash and keeps the capital charge out of fee', () => {
      const a = example('adjudicator');
      expect(validate()(a)).toBe(true);
      expect(a.pool.terms.capitalChargeRateBps).toBeDefined();
      const noHash = structuredClone(a);
      delete noHash.poolTermsHash;
      expect(validate()(noHash)).toBe(false);
      const oldFee = structuredClone(a);
      oldFee.fee.capitalChargeRateBps = 400;
      expect(validate()(oldFee)).toBe(false);
    });
  });

  describe('panel seed (ADR-0018)', () => {
    it('requires a signed beacon proof unless the source is the SimChain beacon', () => {
      const validate = loadSpec().ajv.getSchema(`${V}/messages.schema.json`);
      const d = example('messages.decision');
      d.role = 'fallback';
      d.beacon = { source: 'sim', round: 1200, value: '0x' + '11'.repeat(32) };
      expect(validate(d)).toBe(true);
      d.beacon.source = 'drand-quicknet';
      expect(validate(d)).toBe(false);
      d.beacon.signature = '0x' + 'ab'.repeat(48);
      expect(validate(d)).toBe(true);
    });
    it('records a beacon round instead of a seed commitment for beacon-seeded panels', () => {
      const validate = loadSpec().ajv.getSchema(`${V}/judgment.schema.json`);
      const j = example('judgment');
      expect(j.panel.seedSource).toBe('commit-reveal');
      delete j.panel.seedCommitment;
      expect(validate(j)).toBe(false);
      j.panel.seedSource = 'beacon';
      expect(validate(j)).toBe(false);
      j.panel.beaconRound = 1200;
      expect(validate(j)).toBe(true);
    });
  });

  // ADR-0017 §9, review of PR 23 item 3: every free-text string is either marked untrusted or constrained.
  // A string with no date-time format, pattern, enum or const can carry anything, so a consumer must treat it as
  // content, never instructions. Identifiers get a pattern instead. The allowlist is empty; adding to
  // it needs a reason here and a note in the PR.
  const ALLOWED_UNMARKED: string[] = [];
  it('marks or constrains every free-text string field', () => {
    const { ajv, schemas } = loadSpec();
    const unmarked: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const walk = (node: any, path: string, file: string): void => {
      if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}/${i}`, file));
      if (node === null || typeof node !== 'object') return;
      // Only date-time constrains a string's content; a uri can still carry prose (second review, item 3).
      const free = node.type === 'string' && node.format !== 'date-time' && !['pattern', 'enum', 'const'].some((k) => k in node);
      if (free && node['x-holdback-untrusted'] !== true && !ALLOWED_UNMARKED.includes(`${file}${path}`)) unmarked.push(`${file}${path}`);
      for (const [k, v] of Object.entries(node)) walk(v, `${path}/${k}`, file);
    };
    for (const [file, id] of schemas) walk(ajv.getSchema(id).schema, '', file);
    expect(unmarked).toEqual([]);
  });

  it.each([
    ['commitment', '/properties/deliverable/properties/description'],
    ['commitment', '/$defs/Criterion/properties/anchors/properties/0'],
    ['judge-verdict', '/$defs/ProseVerdict/properties/rationale'],
    ['judge-verdict', '/$defs/Locator'],
    ['judgment', '/properties/aggregate/properties/reasons/items'],
    ['messages', '/$defs/Dispute/properties/grounds'],
  ])('marks %s %s as untrusted, not merely constrained', (file, pointer) => {
    const { ajv, schemas } = loadSpec();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const node = pointer.split('/').slice(1).reduce((n: any, k: string) => n?.[k], ajv.getSchema(schemas.get(file)).schema);
    expect(node?.['x-holdback-untrusted']).toBe(true);
  });

  describe('mutual settlement (ADR-0019)', () => {
    const messages = () => loadSpec().ajv.getSchema(`${V}/messages.schema.json`);
    it.each(['payouts', 'buyerSignature', 'sellerSignature', 'releaseKey', 'deliveryHash'])('requires %s', (field) => {
      const m = example('messages.mutual-settlement');
      expect(messages()(m)).toBe(true);
      delete m[field];
      expect(messages()(m)).toBe(false);
    });
    it('takes a null deliveryHash before delivery and refuses a non-boolean releaseKey', () => {
      const m = example('messages.mutual-settlement');
      m.deliveryHash = null;
      m.releaseKey = false;
      expect(messages()(m)).toBe(true);
      m.releaseKey = 'yes';
      expect(messages()(m)).toBe(false);
    });
    it('refuses releasing a key when nothing was delivered (ADR-0019)', () => {
      const m = example('messages.mutual-settlement');
      m.deliveryHash = null;
      m.releaseKey = true;
      expect(messages()(m)).toBe(false);
    });
    it('records the payouts and key release on a Settled commitment', () => {
      const validate = loadSpec().ajv.getSchema(`${V}/commitment-state.schema.json`);
      const s = example('commitment-state');
      s.escrowState = 'Settled';
      expect(validate(s)).toBe(false);
      s.settled = { payouts: [{ to: '0x2222222222222222222222222222222222222222', amount: { token: 'tUSD', amount: '1200000000' } }], keyReleased: true };
      expect(validate(s)).toBe(true);
      s.settled = { sellerAmount: { token: 'tUSD', amount: '1200000000' }, buyerAmount: { token: 'tUSD', amount: '850000000' }, keyReleased: true };
      expect(validate(s)).toBe(false);
    });
    it('lets a club allow or refuse mutual settlement, with an integer basis-point fee share', () => {
      const validate = loadSpec().ajv.getSchema(`${V}/club.schema.json`);
      const c = example('club');
      expect(Number.isInteger(c.rulebook.mutualSettlement.adjudicatorFeeShareAfterDeliveryBps)).toBe(true);
      c.rulebook.mutualSettlement.adjudicatorFeeShareAfterDeliveryBps = 0.5;
      expect(validate(c)).toBe(false);
      c.rulebook.mutualSettlement.adjudicatorFeeShareAfterDeliveryBps = 10001;
      expect(validate(c)).toBe(false);
      delete c.rulebook.mutualSettlement;
      expect(validate(c)).toBe(false);
    });
    it('emits commitment.settled with the payouts', () => {
      const validate = loadSpec().ajv.getSchema(`${V}/event.schema.json`);
      const e = example('event');
      e.type = 'commitment.settled';
      e.payload = { payouts: [{ to: '0x2222222222222222222222222222222222222222', amount: { token: 'tUSD', amount: '1200000000' } }], keyReleased: true };
      expect(validate(e)).toBe(true);
      e.payload = { note: 'split' };
      expect(validate(e)).toBe(false);
    });
  });

  describe('mutual settlement to any addresses (ADR-0019 as amended by D23)', () => {
    const messages = () => loadSpec().ajv.getSchema(`${V}/messages.schema.json`);
    const club = () => loadSpec().ajv.getSchema(`${V}/club.schema.json`);
    const pay = (to: string, amount: string) => ({ to, amount: { token: 'tUSD', amount } });
    const THIRD = '0x9999999999999999999999999999999999999999';
    it('pays a third-party address named by both parties', () => {
      const m = example('messages.mutual-settlement');
      expect(m.payouts.some((p: { to: string }) => p.to === THIRD)).toBe(true);
      expect(messages()(m)).toBe(true);
    });
    it('replaces sellerAmount with payouts', () => {
      const m = example('messages.mutual-settlement');
      m.sellerAmount = { token: 'tUSD', amount: '1' };
      expect(messages()(m)).toBe(false);
    });
    it('takes one to eight payouts', () => {
      const m = example('messages.mutual-settlement');
      m.payouts = [];
      expect(messages()(m)).toBe(false);
      m.payouts = Array.from({ length: 8 }, (_, i) => pay('0x' + String(i + 1).repeat(40), '1'));
      expect(messages()(m)).toBe(true);
      m.payouts.push(pay('0x' + 'a'.repeat(40), '1'));
      expect(messages()(m)).toBe(false);
    });
    it.each([
      ['a zero amount', (p: Record<string, unknown>) => (p.amount = { token: 'tUSD', amount: '0' })],
      ['a fractional amount', (p: Record<string, unknown>) => (p.amount = { token: 'tUSD', amount: '1.5' })],
      ['a payout with no recipient', (p: Record<string, unknown>) => delete p.to],
      ['a payout with an extra field', (p: Record<string, unknown>) => (p.memo = 'x')],
      ['a recipient that is not an address', (p: Record<string, unknown>) => (p.to = 'escrow.com')],
    ])('refuses %s', (_label, edit) => {
      const m = example('messages.mutual-settlement');
      edit(m.payouts[0]);
      expect(messages()(m)).toBe(false);
    });
    it('lets a club restrict payouts to the parties or allow any address', () => {
      const c = example('club');
      expect(c.rulebook.mutualSettlement.payoutsTo).toBe('any');
      c.rulebook.mutualSettlement.payoutsTo = 'parties';
      expect(club()(c)).toBe(true);
      c.rulebook.mutualSettlement.payoutsTo = 'anyone';
      expect(club()(c)).toBe(false);
      delete c.rulebook.mutualSettlement.payoutsTo;
      expect(club()(c)).toBe(false);
    });
  });

  describe('privacy, Phase 1 shape (ADR-0020, D16)', () => {
    const schema = (name: string) => loadSpec().ajv.getSchema(`${V}/${name}.schema.json`);
    const key = (recipient: string) => ({ recipient, scheme: 'x25519-xsalsa20poly1305', ciphertext: 'a2V5' });
    const A = '0x1111111111111111111111111111111111111111';

    it('binds a disclosure level in the terms; private and judgment carry the bodies as privateTerms (ADR-0024)', () => {
      const c = example('commitment');
      expect(c.disclosure).toEqual({ level: 'public' });
      const validate = schema('commitment');
      expect(validate(c)).toBe(true);
      c.disclosure.level = 'secret';
      expect(validate(c)).toBe(false);
      c.disclosure.level = 'private';
      // At private the plaintext bodies are refused: they travel only as ciphertext.
      expect(validate(c)).toBe(false);
      const part = { hash: '0x' + '21'.repeat(32), ciphertext: 'Y2lwaGVy', envelopes: [key(A)] };
      c.privateTerms = { deliverable: part, acceptance: part };
      delete c.deliverable;
      delete c.acceptance;
      expect(validate(c)).toBe(true);
      delete c.disclosure;
      expect(validate(c)).toBe(false);
    });

    it('lets a delivery key wait for a beacon round', () => {
      const d = example('delivery');
      d.encryptedKeys[0].unlock = { kind: 'beacon-round' };
      expect(schema('delivery')(d)).toBe(false);
      d.encryptedKeys[0].unlock = { kind: 'beacon-round', round: 1200 };
      expect(schema('delivery')(d)).toBe(true);
      d.encryptedKeys[0].unlock = { kind: 'none' };
      expect(schema('delivery')(d)).toBe(true);
    });

    it('requires an escalating Decision to carry keys for the appeal adjudicator, and only then', () => {
      const validate = schema('messages');
      const d = example('messages.decision');
      d.outcome = 'escalate';
      delete d.keyForBuyer;
      expect(validate(d)).toBe(false);
      d.encryptedKeys = [key(A)];
      expect(validate(d)).toBe(true);
      d.outcome = 'reject';
      expect(validate(d)).toBe(false);
    });

    it('requires a Dispute to carry adjudicator keys', () => {
      const validate = schema('messages');
      const d = example('messages.dispute');
      expect(d.encryptedKeys.length).toBeGreaterThanOrEqual(1);
      delete d.encryptedKeys;
      expect(validate(d)).toBe(false);
    });

    it.each(['level', 'buyerSignature', 'sellerSignature'])('requires %s on a co-signed Publish', (field) => {
      const validate = schema('messages');
      const p = example('messages.publish');
      expect(validate(p)).toBe(true);
      delete p[field];
      expect(validate(p)).toBe(false);
    });

    it.each([
      ['commitment.offered', 'termsHash'],
      ['commitment.agreed', 'termsHash'],
      ['judgment.decided', 'recordHash'],
      // Not in phase one: the spec keeps the appeal event for SimChain's full protocol (ADR-0031).
      ['appeal.decided', 'recordHash'],
    ])('%s always carries %s, with the body optional', (type, field) => {
      const validate = schema('event');
      const e = example('event');
      e.type = type;
      e.payload = {};
      expect(validate(e)).toBe(false);
      e.payload = { [field]: '0x' + '31'.repeat(32) };
      expect(validate(e)).toBe(true);
    });

    it('takes an optional private judgment record', () => {
      const j = example('judgment');
      j.privateRecord = { hash: '0x' + '41'.repeat(32), envelopes: [key(A)] };
      expect(schema('judgment')(j)).toBe(true);
      delete j.privateRecord.hash;
      expect(schema('judgment')(j)).toBe(false);
    });

    it('names the identity modes long-term and pseudonymous (ADR-0020 §7)', () => {
      const c = example('club');
      c.rulebook.identityModes = ['long-term', 'pseudonymous'];
      expect(schema('club')(c)).toBe(true);
      c.rulebook.identityModes = ['long-term', 'per-commitment'];
      expect(schema('club')(c)).toBe(false);
    });

    it.each(['disclosureMin', 'identityModes'])('requires rulebook %s', (field) => {
      const c = example('club');
      expect(schema('club')(c)).toBe(true);
      delete c.rulebook[field];
      expect(schema('club')(c)).toBe(false);
    });

    it.each([
      ['providerPrivacy', 'cloud'],
      ['disclosureMin', 'secret'],
    ])('requires and constrains adjudicator policy %s', (field, bad) => {
      const a = example('adjudicator');
      expect(schema('adjudicator')(a)).toBe(true);
      a.policy[field] = bad;
      expect(schema('adjudicator')(a)).toBe(false);
      delete a.policy[field];
      expect(schema('adjudicator')(a)).toBe(false);
    });
  });

  describe('review of PR 23: items 4, 5, 7 and 8', () => {
    const schema = (name: string) => loadSpec().ajv.getSchema(`${V}/${name}.schema.json`);
    it('describes messages under domain version 0.8', () => {
      expect(schema('messages').schema.description).toContain('version 0.8');
      expect(schema('messages').schema.description).not.toContain('0.5');
    });
    it.each([
      ['odd-length hex', { source: 'drand-quicknet', round: 1, value: '0x' + '11'.repeat(32), signature: '0xabc' }],
      ['uppercase hex', { source: 'drand-quicknet', round: 1, value: '0x' + '11'.repeat(32), signature: '0xABCD' }],
      ['a signature on a sim beacon', { source: 'sim', round: 1, value: '0x' + '11'.repeat(32), signature: '0xabcd' }],
    ])('refuses a beacon with %s', (_label, beacon) => {
      const d = example('messages.decision');
      d.role = 'fallback';
      d.beacon = beacon;
      expect(schema('messages')(d)).toBe(false);
    });
    it.each([
      ['a 32-byte hash', 'commitmentId', 'AB'],
      ['a signature', 'signature', 'CD'],
    ])('gives %s exactly one spelling (lowercase)', (_label, field, upper) => {
      const m = example('messages.acceptance');
      expect(schema('messages')(m)).toBe(true);
      m[field] = m[field].slice(0, -2) + upper;
      expect(schema('messages')(m)).toBe(false);
    });
    it('keeps the bond in the pool only, so a read cannot disagree with itself', () => {
      const a = example('adjudicator');
      expect(a.bond).toBeUndefined();
      expect(a.openExposure).toBeUndefined();
      a.bond = a.pool.junior;
      expect(schema('adjudicator')(a)).toBe(false);
    });
    it('lets a receipt omit the commitment for events that have none', () => {
      const r = example('receipt');
      delete r.commitmentId;
      expect(schema('receipt')(r)).toBe(true);
    });
  });

  // Review of PR 23, item 2: every rule in the v0.5 additions has a case that fails without it.
  describe('rejects each mutant the review found, and the same for later additions', () => {
    const schema = (name: string) => loadSpec().ajv.getSchema(`${V}/${name}.schema.json`);
    const t = (amount: string) => ({ token: 'tUSD', amount });
    const h = (b: string) => '0x' + b.repeat(32);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type Edit = (x: any) => void;
    const cases: Array<[string, string, string, Edit]> = [
      ['adjudicator without a pool', 'adjudicator', 'adjudicator', (a) => delete a.pool],
      ['pool terms with an extra field', 'adjudicator', 'adjudicator', (a) => (a.pool.terms.extra = 1)],
      ['pool terms without noticePeriodSec', 'adjudicator', 'adjudicator', (a) => delete a.pool.terms.noticePeriodSec],
      // Not in phase one: the spec keeps the bond event for SimChain's full protocol (ADR-0031).
      ['a bond.slashed event without per-tranche amounts', 'event', 'event.bond-slashed', (e) => delete e.payload.senior],
      ['a bond.slashed event with an unknown reason', 'event', 'event.bond-slashed', (e) => (e.payload.reason = 'whim')],
      ['an unknown event type', 'event', 'event', (e) => (e.type = 'bond.borrowed')],
      ['an unknown escrow state', 'commitment-state', 'commitment-state', (s) => (s.escrowState = 'Paused')],
      ['a judgment panel without seedSource', 'judgment', 'judgment', (j) => delete j.panel.seedSource],
      ['an optimistic default that does not release', 'club', 'club', (c) => (c.rulebook.defaultOutcome.optimistic = { release: false, buyerCompensationRateBps: 10000 })],
      ['an optimistic default without buyerCompensationRate', 'club', 'club', (c) => (c.rulebook.defaultOutcome.optimistic = { release: true })],
      ['a chain settlement without chainId', 'operator-status', 'operator-status', (s) => (s.settlement = { kind: 'chain' })],
      ['operator head without lagSec', 'operator-status', 'operator-status', (s) => delete s.head.lagSec],
      ['a page of more than 200 items', 'page', 'page', (p) => (p.items = Array(201).fill(p.items[0]))],
      ['an empty cursor', 'page', 'page', (p) => (p.nextCursor = '')],
      ['a Dispute without a bond', 'messages', 'messages.dispute', (d) => delete d.bond],
      ['a Dispute with an extra field', 'messages', 'messages.dispute', (d) => (d.extra = 1)],
      ['a Dispute with keys for fewer than three adjudicators', 'messages', 'messages.dispute', (d) => d.encryptedKeys.pop()],
      ['a zero disputeJudgeSec', 'commitment', 'commitment', (c) => { c.settlement.mode = 'optimistic'; Object.assign(c.timing, { disputeBy: '2026-11-06T17:00:00Z', disputeJudgeSec: 0, disputeFallbackSec: 86400 }); }],
      ['an unknown randomness source', 'club', 'club', (c) => (c.rulebook.randomness = { source: 'dice' })],
      ['a MutualSettlement with an extra field', 'messages', 'messages.mutual-settlement', (m) => (m.extra = 1)],
      ['a MutualSettlement payout that is not money', 'messages', 'messages.mutual-settlement', (m) => (m.payouts[0].amount = { token: 'tUSD', amount: '1.5' })],
      ['a settled split on a commitment that is not Settled', 'commitment-state', 'commitment-state', (s) => (s.settled = { payouts: [{ to: h('11').slice(0, 42), amount: t('1') }], keyReleased: false })],
      ['a commitment.settled event without keyReleased', 'event', 'event', (e) => { e.type = 'commitment.settled'; e.payload = { payouts: [{ to: h('11').slice(0, 42), amount: t('1') }] }; }],
      ['a mutualSettlement rule without allowed', 'club', 'club', (c) => delete c.rulebook.mutualSettlement.allowed],
      ['a Publish to an unknown level', 'messages', 'messages.publish', (p) => (p.level = 'secret')],
      ['a Publish with an extra field', 'messages', 'messages.publish', (p) => (p.extra = 1)],
      ['a key unlock with a round but no beacon', 'delivery', 'delivery', (d) => (d.encryptedKeys[0].unlock = { kind: 'none', round: 5 })],
      ['a private judgment record with no envelopes', 'judgment', 'judgment', (j) => (j.privateRecord = { hash: h('41'), envelopes: [] })],
      ['an unknown identity mode', 'club', 'club', (c) => (c.rulebook.identityModes = ['anonymous'])],
      ['a club disclosure minimum outside the levels', 'club', 'club', (c) => (c.rulebook.disclosureMin = 'secret')],
      ['an offered event whose termsHash is not a hash', 'event', 'event.offered', (e) => (e.payload.termsHash = 'abc')],
      // Second review of PR 23, item 6.
      ['a Settled split without keyReleased', 'commitment-state', 'commitment-state', (s) => { s.escrowState = 'Settled'; s.settled = { payouts: [{ to: h('11').slice(0, 42), amount: t('1') }] }; }],
      ['a Settled split without payouts', 'commitment-state', 'commitment-state', (s) => { s.escrowState = 'Settled'; s.settled = { keyReleased: true }; }],
      ['a mutualSettlement rule without payoutsTo', 'club', 'club', (c) => delete c.rulebook.mutualSettlement.payoutsTo],
      ['a mutualSettlement rule without its fee share', 'club', 'club', (c) => delete c.rulebook.mutualSettlement.adjudicatorFeeShareAfterDeliveryBps],
      ['a weighted score above 400 hundredths', 'judgment', 'judgment', (j) => (j.aggregate.weightedScore = 401)],
      ['a MutualSettlement without a nonce', 'messages', 'messages.mutual-settlement', (m) => delete m.nonce],
    ];
    it.each(cases)('rejects %s', (_label, file, name, edit) => {
      const x = example(name);
      expect(schema(file)(x)).toBe(true);
      edit(x);
      expect(schema(file)(x)).toBe(false);
    });
    it.each([
      ['prevrandao', 'club', 'club', (c: { rulebook: { randomness: object } }) => (c.rulebook.randomness = { source: 'prevrandao' })],
      ['the Disputed state', 'commitment-state', 'commitment-state', (s: { escrowState: string }) => (s.escrowState = 'Disputed')],
      ['a dispute.opened event', 'event', 'event', (e: { type: string }) => (e.type = 'dispute.opened')],
    ] as const)('accepts %s', (_label, file, name, edit) => {
      const x = example(name);
      edit(x as never);
      expect(schema(file)(x)).toBe(true);
    });
  });

  describe('hidden-character check and screen signals (ADR-0021, D17)', () => {
    const schema = (name: string) => loadSpec().ajv.getSchema(`${V}/${name}.schema.json`);
    const check = (max: unknown, extra: object = {}) => ({ id: 'hidden', type: 'hidden_characters_max', required: true, max, ...extra });
    const withCheck = (c: unknown) => {
      const x = example('commitment');
      x.acceptance.deterministicChecks = [c];
      return x;
    };
    it('ships an example commitment that uses the check', () => {
      const x = example('commitment');
      expect(x.acceptance.deterministicChecks.some((c: { type: string }) => c.type === 'hidden_characters_max')).toBe(true);
    });
    it.each([
      ['a total maximum', { total: 0 }],
      ['per-class maximums', { tag: 0, bidi: 0, variationSelector: 2, otherIgnorable: 5 }],
    ])('accepts %s', (_label, max) => {
      expect(schema('commitment')(withCheck(check(max)))).toBe(true);
    });
    it.each([
      ['no maximum at all', {}],
      ['an unknown class', { emoji: 1 }],
      ['a fractional maximum', { total: 0.5 }],
      ['a negative maximum', { tag: -1 }],
    ])('rejects %s', (_label, max) => {
      expect(schema('commitment')(withCheck(check(max)))).toBe(false);
    });
    it('requires the required flag and refuses extra fields', () => {
      const noFlag: Record<string, unknown> = check({ total: 0 });
      delete noFlag['required'];
      expect(schema('commitment')(withCheck(noFlag))).toBe(false);
      expect(schema('commitment')(withCheck(check({ total: 0 }, { normalize: true })))).toBe(false);
    });
    it.each(['nfkc_changed', 'variation_selector_run', 'mixed_script', 'hidden_characters'])('accepts screen signal %s', (kind) => {
      const j = example('judgment');
      j.screen.signals = [{ kind }];
      expect(schema('judgment')(j)).toBe(true);
    });
    it('keeps the screen signal enum closed', () => {
      const j = example('judgment');
      j.screen.signals = [{ kind: 'homoglyph' }];
      expect(schema('judgment')(j)).toBe(false);
    });
  });

  describe('integer rates (ADR-0022, D18)', () => {
    const schema = (name: string) => loadSpec().ajv.getSchema(`${V}/${name}.schema.json`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type At = (x: any) => any;
    const bps: Array<[string, string, At, string]> = [
      ['club', 'club', (c) => c.rulebook, 'appealBondRateBps'],
      ['club', 'club', (c) => c.rulebook, 'windowCoverageRatioBps'],
      ['club', 'club', (c) => c.rulebook, 'firstLossShareMinBps'],
      ['club', 'club', (c) => c.rulebook, 'sealedChecksMaxWeightBps'],
      ['club', 'club', (c) => c.rulebook.defaultOutcome.judged, 'sellerCompensationRateBps'],
      ['adjudicator', 'adjudicator', (a) => a.pool.terms, 'capitalChargeRateBps'],
      ['adjudicator', 'adjudicator', (a) => a.pool.terms, 'capitalChargeToPoolRateBps'],
      ['adjudicator', 'adjudicator', (a) => a.pool.terms, 'firstLossShareBps'],
      ['adjudicator', 'adjudicator', (a) => a.metrics, 'falseAcceptRateBps'],
      ['adjudicator', 'adjudicator', (a) => a.metrics, 'falseRejectRateBps'],
      ['adjudicator', 'adjudicator', (a) => a.metrics, 'escalationRateBps'],
    ];
    it.each(bps)('%s %s rejects fractional, negative and over-10000 values', (file, name, at, field) => {
      for (const bad of [0.5, -1, 10001]) {
        const x = example(name);
        at(x)[field] = 500;
        expect(schema(file)(x)).toBe(true);
        at(x)[field] = bad;
        expect(schema(file)(x)).toBe(false);
      }
    });
    it('defines Bps and Fraction and no floating Rate', () => {
      const defs = schema('common').schema.$defs;
      expect(defs.Rate).toBeUndefined();
      expect(defs.Bps).toEqual(expect.objectContaining({ type: 'integer', minimum: 0, maximum: 10000 }));
      expect(defs.Fraction.additionalProperties).toBe(false);
    });
    it.each([
      ['a zero denominator', { numerator: 0, denominator: 0 }],
      ['a denominator above 100', { numerator: 2, denominator: 101 }],
      ['a fractional numerator', { numerator: 1.5, denominator: 3 }],
      ['an extra field', { numerator: 2, denominator: 3, value: 0.667 }],
    ])('rejects a supermajority with %s', (_label, f) => {
      const a = example('adjudicator');
      expect(a.policy.acceptSupermajority).toEqual({ numerator: 2, denominator: 3 });
      a.policy.acceptSupermajority = f;
      expect(schema('adjudicator')(a)).toBe(false);
    });
    it.each([
      ['a criterion weight of 0', (c: { acceptance: { rubric: { criteria: Array<{ weight: number }> } } }) => (c.acceptance.rubric.criteria[0]!.weight = 0)],
      ['a fractional criterion weight', (c: { acceptance: { rubric: { criteria: Array<{ weight: number }> } } }) => (c.acceptance.rubric.criteria[0]!.weight = 0.4)],
      ['a pass threshold above 400 hundredths', (c: { acceptance: { rubric: { passThreshold: number } } }) => (c.acceptance.rubric.passThreshold = 401)],
      ['a fractional pass threshold', (c: { acceptance: { rubric: { passThreshold: number } } }) => (c.acceptance.rubric.passThreshold = 3.5)],
      ['a fractional regex match minimum', (c: { acceptance: { deterministicChecks: Array<Record<string, unknown>> } }) => (c.acceptance.deterministicChecks.find((k) => 'minBps' in k)!['minBps'] = 0.97)],
    ] as const)('rejects %s', (_label, edit) => {
      const c = example('commitment');
      expect(schema('commitment')(c)).toBe(true);
      edit(c as never);
      expect(schema('commitment')(c)).toBe(false);
    });
    it('records aggregate counts and an integer weighted score in hundredths', () => {
      const j = example('judgment');
      expect(Number.isInteger(j.aggregate.passCount)).toBe(true);
      expect(j.aggregate.passShare).toBeUndefined();
      j.aggregate.weightedScore = 3.4;
      expect(schema('judgment')(j)).toBe(false);
      j.aggregate.weightedScore = 340;
      expect(schema('judgment')(j)).toBe(true);
    });
  });

  describe('finality (D20)', () => {
    const validate = () => loadSpec().ajv.getSchema(`${V}/commitment-state.schema.json`);
    it('shows a released commitment as settled but not yet final while it can be appealed', () => {
      const s = example('commitment-state');
      expect(s.escrowState).toBe('Released');
      expect(typeof s.settledAt).toBe('string');
      expect(s.finalAt).toBeNull();
      expect(validate()(s)).toBe(true);
    });
    it.each(['settledAt', 'finalAt'])('lets %s be absent or null', (field) => {
      const s = example('commitment-state');
      s[field] = null;
      expect(validate()(s)).toBe(true);
      delete s[field];
      expect(validate()(s)).toBe(true);
    });
    it.each(['settledAt', 'finalAt'])('refuses a %s that is not a timestamp', (field) => {
      const s = example('commitment-state');
      s[field] = 'soon';
      expect(validate()(s)).toBe(false);
      s[field] = 1793379820;
      expect(validate()(s)).toBe(false);
    });
  });

  // Derived hashes in examples must match their bodies, or a reader copying an example gets a club no
  // settlement layer recognizes (found stale in T-012: the club example predated payoutsTo). The commitment
  // example's rulebookHash, id and signature, and the adjudicator example's policyHash and poolTermsHash, are
  // still stale; core pins EIP-712 vectors over the commitment example, so they move together (backlog).
  describe('private deals, v0.8 (ADR-0024, D34)', () => {
    const schema = (name: string) => loadSpec().ajv.getSchema(`${V}/${name}.schema.json`);

    it('keeps two keys: deliverable and acceptance are separate parts, each with ciphertext and envelopes', () => {
      const validate = schema('commitment');
      const c = example('commitment.private');
      expect(Object.keys(c.privateTerms).sort()).toEqual(['acceptance', 'deliverable']);
      delete c.privateTerms.acceptance;
      expect(validate(c)).toBe(false);
      const d = example('commitment.private');
      d.privateTerms.deliverable.envelopes = [];
      expect(validate(d)).toBe(false);
      const p = example('commitment');
      p.privateTerms = example('commitment.private').privateTerms;
      expect(validate(p)).toBe(false); // public carries plaintext only
    });

    it('takes a salt, notes and the seller per-deal key in the deliverable body, and a salt in the acceptance', () => {
      const validate = schema('commitment');
      const c = example('commitment');
      c.deliverable.salt = '0x' + '5a'.repeat(32);
      c.deliverable.notes = 'free text';
      c.deliverable.sellerEncryptionPublicKey = 'S2V5S2V5';
      c.acceptance.salt = '0x' + '6b'.repeat(32);
      expect(validate(c)).toBe(true);
      c.acceptance.salt = '0x1';
      expect(validate(c)).toBe(false);
    });

    it('takes an optional audience on a ReadToken and refuses unknown fields', () => {
      const validate = schema('messages');
      const t = example('messages.read-token');
      expect(t.audience).toBeDefined();
      expect(validate(t)).toBe(true);
      delete t.audience;
      expect(validate(t)).toBe(true);
      t.scope = 'all';
      expect(validate(t)).toBe(false);
    });

    it('requires a Delegation to name the per-deal signing and encryption keys and a scope', () => {
      const validate = schema('messages');
      for (const field of ['dealKey', 'dealEncryptionKey', 'scope', 'principal']) {
        const d = example('messages.delegation');
        delete d[field];
        expect(validate(d), field).toBe(false);
      }
    });

    it('refuses a disclosure body with no key, and a key that is not 32 bytes', () => {
      const validate = schema('disclosure');
      const d = example('disclosure');
      d.keys = {};
      expect(validate(d)).toBe(false);
      const e = example('disclosure');
      e.keys.acceptanceKey = 'c2hvcnQ';
      expect(validate(e)).toBe(false);
    });

    it('gives the projection hashes, never bodies or identities beyond the per-deal addresses', () => {
      const validate = schema('projection');
      const p = example('projection');
      expect(validate(p)).toBe(true);
      for (const extra of ['clubId', 'buyerEncryptionPublicKey', 'privateTerms', 'deliverable']) {
        const q = example('projection');
        q[extra] = 'x';
        expect(validate(q), extra).toBe(false);
      }
    });
  });

  // Each case runs under both validators: Ajv over spec/schemas, and the compiled one the operators' parsers run.
  describe('signature_valid and checkKinds, v0.13 (ADR-0045, D90)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type Edit = (x: any) => void;
    const verdicts = (name: 'commitment' | 'adjudicator', doc: unknown) => [
      loadSpec().ajv.getSchema(`${V}/${name}.schema.json`)(doc),
      parsers[name](doc).ok,
    ];
    /** The example's terms with its three checks, after `edit` on the P-256 check ('ecdsa') or the Ed25519 one. */
    const terms = (which: 'ecdsa' | 'ed25519', edit: Edit = () => {}) => {
      const c = example('commitment.signature-valid');
      edit(c.acceptance.deterministicChecks[which === 'ecdsa' ? 1 : 2]);
      return c;
    };

    it('ships example terms with one check per algorithm, with and without jsonEquals', () => {
      const c = example('commitment.signature-valid');
      const checks = c.acceptance.deterministicChecks.filter((k: { type: string }) => k.type === 'signature_valid');
      expect(checks.map((k: { alg: string; message: { jsonEquals?: string } }) => [k.alg, k.message.jsonEquals])).toEqual([
        ['ecdsa-p256-sha256', '/manifest'],
        ['ed25519', undefined],
      ]);
      expect(verdicts('commitment', c)).toEqual([true, true]);
      expect(commitmentId(c)).toBe(c.id);
    });

    it.each<[string, 'ecdsa' | 'ed25519', Edit]>([
      ['a raw ECDSA signature', 'ecdsa', (k) => (k.signature.format = 'raw')],
      ['an spki-base64 key and a base64 message with jsonEquals', 'ecdsa', (k) => { k.publicKey.format = 'spki-base64'; k.message.encoding = 'base64'; }],
      ['the root pointer and escaped segments', 'ecdsa', (k) => { k.message.jsonEquals = ''; k.message.pointer = '/a~0b/~1c//0'; }],
      ['a pointer of 512 characters', 'ecdsa', (k) => (k.signature.pointer = `/${'a'.repeat(511)}`)],
    ])('takes %s', (_, which, edit) => {
      expect(verdicts('commitment', terms(which, edit))).toEqual([true, true]);
    });

    it.each<[string, 'ecdsa' | 'ed25519', Edit]>([
      ['an unknown alg', 'ecdsa', (k) => (k.alg = 'ecdsa-secp256k1-sha256')],
      ['ed25519 with a DER signature', 'ed25519', (k) => (k.signature.format = 'der')],
      ['an extra property on the check', 'ecdsa', (k) => (k.timeoutMs = '100')],
      ['an extra property on publicKey', 'ecdsa', (k) => (k.publicKey.key = 'x')],
      ['an extra property on message', 'ecdsa', (k) => (k.message.canonicalization = 'jcs')],
      ['an extra property on signature', 'ed25519', (k) => (k.signature.lowS = 'false')],
      ['a numeric parameter in place of a string', 'ecdsa', (k) => (k.publicKey.pointer = 1)],
      ['an added numeric parameter', 'ecdsa', (k) => (k.maxMessageBytes = 1024)],
      ['a pointer without a leading slash', 'ecdsa', (k) => (k.message.pointer = 'manifest_text')],
      ['a pointer with a bare tilde', 'ecdsa', (k) => (k.message.jsonEquals = '/a~2b')],
      ['a pointer ending in a tilde', 'ed25519', (k) => (k.publicKey.pointer = '/a~')],
      ['a URI fragment pointer', 'ecdsa', (k) => (k.signature.pointer = '#/manifest_sig')],
      ['a pointer of 513 characters', 'ecdsa', (k) => (k.signature.pointer = `/${'a'.repeat(512)}`)],
      ['a fingerprint without its prefix', 'ecdsa', (k) => (k.publicKey.spkiSha256 = k.publicKey.spkiSha256.slice(7))],
      ['an uppercase fingerprint', 'ecdsa', (k) => (k.publicKey.spkiSha256 = `sha256:${'A'.repeat(64)}`)],
      ['an unknown key format', 'ecdsa', (k) => (k.publicKey.format = 'jwk')],
      ['an unknown message encoding', 'ecdsa', (k) => (k.message.encoding = 'jcs')],
      ['a hex signature encoding', 'ecdsa', (k) => (k.signature.encoding = 'hex')],
      ...['alg', 'publicKey', 'message', 'signature'].map((f): [string, 'ecdsa', Edit] => [`a check without ${f}`, 'ecdsa', (k) => delete k[f]]),
      ...(['publicKey.pointer', 'publicKey.format', 'publicKey.spkiSha256', 'message.pointer', 'message.encoding', 'signature.pointer', 'signature.encoding', 'signature.format'] as const).map(
        (path): [string, 'ecdsa', Edit] => [`a check without ${path}`, 'ecdsa', (k) => { const [at, f] = path.split('.') as [string, string]; delete k[at][f]; }],
      ),
    ])('refuses %s', (_, which, edit) => {
      expect(verdicts('commitment', terms(which, edit))).toEqual([false, false]);
    });

    it('takes an adjudicator record with a checkKinds list, with none, and with a kind this schema does not name', () => {
      const listed = example('adjudicator.check-kinds');
      expect(listed.checkKinds).toContain('signature_valid');
      expect(verdicts('adjudicator', listed)).toEqual([true, true]);
      expect(registrationBodyHash(listed)).toBe(listed.registration.bodyHash);
      expect(example('adjudicator').checkKinds).toBeUndefined();
      expect(verdicts('adjudicator', example('adjudicator'))).toEqual([true, true]);
      listed.checkKinds.push('speed_max');
      expect(verdicts('adjudicator', listed)).toEqual([true, true]);
    });

    it('lists every kind of this schema in the example record', () => {
      const branches = JSON.parse(readFileSync('spec/schemas/commitment.schema.json', 'utf8')).$defs.DeterministicCheck.oneOf;
      expect(example('adjudicator.check-kinds').checkKinds.toSorted()).toEqual(branches.map((b: { properties: { type: { const: string } } }) => b.properties.type.const).toSorted());
    });

    it('keeps checkKinds outside policyHash and inside the registration bodyHash', () => {
      const listed = example('adjudicator.check-kinds');
      const plain = example('adjudicator');
      expect(listed.policy).toEqual(plain.policy);
      expect(listed.policyHash).toBe(plain.policyHash);
      const without = structuredClone(listed);
      delete without.checkKinds;
      expect(registrationBodyHash(without)).not.toBe(registrationBodyHash(listed));
    });

    it.each<[string, unknown]>([
      ['a repeated kind', ['json_schema', 'json_schema']],
      ['a kind that is not a string', [9]],
      ['a kind with a space', ['json schema']],
      ['a kind of 41 characters', ['a'.repeat(41)]],
      ['101 kinds', Array.from({ length: 101 }, (_, i) => `kind_${i}`)],
      ['one name in place of a list', 'json_schema'],
    ])('refuses checkKinds with %s', (_, checkKinds) => {
      expect(verdicts('adjudicator', { ...example('adjudicator'), checkKinds })).toEqual([false, false]);
    });

    it('refuses checkKinds inside policy', () => {
      const a = example('adjudicator');
      a.policy.checkKinds = ['json_schema'];
      expect(verdicts('adjudicator', a)).toEqual([false, false]);
    });
  });

  // ADR-0047 (D98): each case runs under both validators, Ajv over spec/schemas and the compiled one the operators run.
  describe('the three data check kinds, v0.14 (ADR-0047)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type Edit = (x: any) => void;
    const verdicts = (doc: unknown) => [loadSpec().ajv.getSchema(`${V}/commitment.schema.json`)(doc), parsers.commitment(doc).ok];
    const KIND = { monotonic: 0, lengths: 1, path: 2 } as const;
    const terms = (which: keyof typeof KIND, edit: Edit = () => {}) => {
      const c = example('commitment.data-checks');
      edit(c.acceptance.deterministicChecks[KIND[which]]);
      return c;
    };

    it('ships example terms with one check of each kind, and their commitment ID', () => {
      const c = example('commitment.data-checks');
      expect(c.acceptance.deterministicChecks.map((k: { type: string }) => k.type)).toEqual(['monotonic_column', 'equal_lengths', 'passes_through']);
      expect(verdicts(c)).toEqual([true, true]);
      expect(commitmentId(c)).toBe(c.id);
    });

    it.each<[string, keyof typeof KIND, Edit]>([
      ['a monotonic check with no step bounds', 'monotonic', (k) => { delete k.minStep; delete k.maxStep; }],
      ['a monotonic check on a column', 'monotonic', (k) => (k.series = { column: 't_ms' })],
      ['a path on columns', 'path', (k) => (k.series = [{ column: 'q1' }, { column: 'q2' }])],
      ['a path with one series and the safe range as bounds', 'path', (k) => { k.series = [{ pointer: '' }]; k.waypoints = [[Number.MAX_SAFE_INTEGER], [-Number.MAX_SAFE_INTEGER]]; k.tolerance = Number.MAX_SAFE_INTEGER; }],
      ['1,024 waypoints', 'path', (k) => (k.waypoints = Array.from({ length: 1024 }, () => [0, 0]))],
      ['32 series to compare', 'lengths', (k) => (k.series = Array.from({ length: 32 }, (_, i) => ({ pointer: `/${i}` })))],
    ])('takes %s', (_, which, edit) => {
      expect(verdicts(terms(which, edit))).toEqual([true, true]);
    });

    it.each<[string, keyof typeof KIND, Edit]>([
      ['a decimal tolerance', 'path', (k) => (k.tolerance = 0.5)],
      ['a tolerance as a string', 'path', (k) => (k.tolerance = '500')],
      ['a negative tolerance', 'path', (k) => (k.tolerance = -1)],
      ['a tolerance beyond the safe range', 'path', (k) => (k.tolerance = 2 ** 53)],
      ['a decimal coordinate', 'path', (k) => (k.waypoints[0][0] = 10000.5)],
      ['a coordinate beyond the safe range', 'path', (k) => (k.waypoints[0][0] = -(2 ** 53))],
      ['no waypoints', 'path', (k) => (k.waypoints = [])],
      ['1,025 waypoints', 'path', (k) => (k.waypoints = Array.from({ length: 1025 }, () => [0, 0]))],
      ['33 series on a path', 'path', (k) => (k.series = Array.from({ length: 33 }, () => ({ column: 'a' })))],
      ['a series with a pointer and a column', 'path', (k) => (k.series[0].column = 'q1')],
      ['a column name of 129 characters', 'monotonic', (k) => (k.series = { column: 'a'.repeat(129) })],
      ['an extra parameter on a path', 'path', (k) => (k.ordered = true)],
      ['a decimal minStep', 'monotonic', (k) => (k.minStep = 1.5)],
      ['a negative maxStep', 'monotonic', (k) => (k.maxStep = -16)],
      ['a list of series on a monotonic check', 'monotonic', (k) => (k.series = [k.series])],
      ['an extra parameter on a monotonic check', 'monotonic', (k) => (k.strict = true)],
      ['a column series to compare lengths', 'lengths', (k) => (k.series[0] = { column: 't_ms' })],
      ['one series to compare lengths', 'lengths', (k) => (k.series = k.series.slice(0, 1))],
      ['33 series to compare lengths', 'lengths', (k) => (k.series = Array.from({ length: 33 }, () => ({ pointer: '/a' })))],
      ['a pointer without a leading slash', 'lengths', (k) => (k.series[0].pointer = 'telemetry/t_ms')],
      ...(['series', 'waypoints', 'tolerance'] as const).map((f): [string, 'path', Edit] => [`a path without ${f}`, 'path', (k) => delete k[f]]),
    ])('refuses %s', (_, which, edit) => {
      expect(verdicts(terms(which, edit))).toEqual([false, false]);
    });
  });

  // ADR-0050 (D106): each case runs under both validators, Ajv over spec/schemas and the compiled one the operators run.
  describe('the coded verdict and the coded seat, v0.15 (ADR-0050)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type Edit = (x: any) => void;
    const verdicts = (file: 'judge-verdict' | 'judgment', doc: unknown) => [loadSpec().ajv.getSchema(`${V}/${file}.schema.json`)(doc), parsers[file](doc).ok];
    const coded = (edit: Edit = () => {}) => {
      const v = example('judge-verdict.coded');
      edit(v);
      return v;
    };
    const seat = (edit: Edit = () => {}) => {
      const j = example('judgment.coded');
      edit(j.panel.members[0].verdict);
      return j;
    };

    it('takes the v0.14 prose verdict and record unchanged, and the coded examples', () => {
      expect(verdicts('judge-verdict', example('judge-verdict'))).toEqual([true, true]);
      expect(verdicts('judgment', example('judgment'))).toEqual([true, true]);
      expect(verdicts('judge-verdict', coded())).toEqual([true, true]);
      expect(verdicts('judgment', seat())).toEqual([true, true]);
    });

    it('keeps the two formats apart: the prose parser refuses a coded verdict, and a verdict is never both', () => {
      const { ajv } = loadSpec();
      const prose = ajv.getSchema(`${V}/judge-verdict.schema.json#/$defs/ProseVerdict`);
      const codedOnly = ajv.getSchema(`${V}/judge-verdict.schema.json#/$defs/CodedVerdict`);
      expect([prose(coded()), codedOnly(coded())]).toEqual([false, true]);
      expect([prose(example('judge-verdict')), codedOnly(example('judge-verdict'))]).toEqual([true, false]);
    });

    it.each<[string, Edit]>([
      ['no references and no reasons left after the filter dropped them', (v) => { v.criteria[0].refs = []; v.criteria[0].reasons = []; }],
      ['no refs key', (v) => delete v.criteria[0].refs],
      ['no injection lists', (v) => { delete v.injectionKinds; delete v.injectionRefs; }],
      ['three kinds and three references', (v) => { v.injectionSuspected = true; v.injectionKinds = ['instruction_override', 'hidden_text', 'other']; v.injectionRefs = ['/a', '/b', 'L3']; }],
      ['a pointer of 512 characters', (v) => (v.criteria[0].refs = [`/${'a'.repeat(511)}`])],
    ])('takes a coded verdict with %s', (_, edit) => {
      expect(verdicts('judge-verdict', coded(edit))).toEqual([true, true]);
    });

    it.each<[string, Edit]>([
      ['an unknown reason code', (v) => (v.criteria[0].reasons = ['excellent'])],
      ['four reasons', (v) => (v.criteria[0].reasons = ['complete', 'accurate', 'consistent', 'well_formed'])],
      ['a repeated reason', (v) => (v.criteria[0].reasons = ['complete', 'complete'])],
      ['four references', (v) => (v.criteria[0].refs = ['L1', 'L2', 'L3', 'L4'])],
      ['a reference of 513 characters', (v) => (v.criteria[0].refs = [`/${'a'.repeat(512)}`])],
      ['an unknown injection kind', (v) => (v.injectionKinds = ['jailbreak'])],
      ['a rationale', (v) => (v.rationale = 'habit')],
      ['evidence on a criterion', (v) => (v.criteria[0].evidence = 'quoted')],
      ['a score of 5', (v) => (v.criteria[0].score = 5)],
      ['no reasons key', (v) => delete v.criteria[0].reasons],
      ['no overall', (v) => delete v.overall],
    ])('refuses a coded verdict with %s', (_, edit) => {
      expect(verdicts('judge-verdict', coded(edit))).toEqual([false, false]);
    });

    it.each<[string, Edit]>([
      ['a locator where an anchor goes', (v) => (v.criteria[0].refs = ['L14'])],
      ['an anchor in capitals', (v) => (v.criteria[0].refs = ['3F9A0C1D22B84E67'])],
      ['an anchor of 15 characters', (v) => (v.injectionRefs = ['3f9a0c1d22b84e6'])],
      ['a dropped count of 10', (v) => (v.dropped.keys = 10)],
      ['no dropped counts', (v) => delete v.dropped],
      ['format prose-1 on a coded seat', (v) => (v.format = 'prose-1')],
      ['no format', (v) => delete v.format],
      ['a rationale', (v) => (v.rationale = 'habit')],
      ['an extra dropped count', (v) => (v.dropped.urls = 0)],
    ])('refuses a coded seat with %s', (_, edit) => {
      expect(verdicts('judgment', seat(edit))).toEqual([false, false]);
    });
  });

  it("the club example's rulebookHash is the keccak256 of its rulebook's canonical JSON", () => {
    const club = example('club');
    expect(club.rulebookHash).toBe(rulebookHash(club.rulebook));
  });
});

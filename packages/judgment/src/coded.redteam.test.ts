// Red team of T-616 (ADR-0050): the coded verdict filter (coded.ts), references and anchors (refs.ts), template pair 3
// (prompt.ts) and the agg-6 wiring (kept.ts, pipeline.ts). Each `it` states the defence's expected outcome. A test named
// "LIMIT:" passes and documents a channel the design accepts. The red team's findings M1 to M3, L1 to L3 and the two
// parity gaps are fixed; their tests stay here as regressions (task file, Evidence, red team).
import { type CodedRecordVerdict, type MimeType } from '@holdback/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ADJUDICATOR, criterion, delivery, fakeUnwrap, NONCES, POLICY, seal, utf8 } from './_helpers.js';
import { parseCodedVerdict, REASON_CODES, type CodedOptions, type ParsedCoded } from './coded.js';
import { intake } from './intake.js';
import { implementationsFor, NEWEST_VERSIONS, type PolicyVersions } from './kept.js';
import { runPipeline, type JudgeProvider, type JudgeRequest, type PanelSeat } from './pipeline.js';
import { APPEAL_PROMPT_TEMPLATE_3_HASH, APPEAL_PROMPT_TEMPLATE_HASH, buildPrompt, LINE_BREAK, TEMPLATE_PAIR, TEMPLATE_PAIR_2, TEMPLATE_PAIR_3 } from './prompt.js';
import { anchorIndex, anchorKey, anchorOf, judgedText, resolves, workView, type WorkView } from './refs.js';
import type { JudgmentRubric } from './terms.js';
import { UntrustedData } from './untrusted.js';
import { parseVerdict } from './verdict.js';

const IDS = ['fit', 'coherent', 'distinct'];
const WORK = '{"kit":{"logo":"<svg/>","colours":[{"role":"ink"},{"role":"paper"}]}}';
const KEY = anchorKey(utf8(WORK));
const JSON_WORK: WorkView = { kind: 'json', document: JSON.parse(WORK) };
const C = NONCES.canary;
const opts: CodedOptions = { criterionIds: IDS, canary: C, work: JSON_WORK, anchorKey: KEY };
const clean = (over: Record<string, unknown> = {}) => ({
  criteria: IDS.map((id) => ({ id, refs: [] as unknown[], reasons: ['meets_terms'] as unknown[], score: 4 })),
  overall: 'pass',
  injectionSuspected: false,
  injectionKinds: [],
  injectionRefs: [],
  ...over,
});
const withCriteria = (f: (c: ReturnType<typeof clean>['criteria'][number], i: number) => Record<string, unknown>) => clean({ criteria: clean().criteria.map((c, i) => ({ ...c, ...f(c, i) })) });
const parse = (v: unknown, o: Partial<CodedOptions> = {}): ParsedCoded => parseCodedVerdict(typeof v === 'string' ? v : JSON.stringify(v), { ...opts, ...o });
const reason = (r: ParsedCoded) => (r.status === 'abstain' ? r.reason : 'ok');
const h1 = C.slice(0, 16);
const h2 = C.slice(16);

describe('the canary in a field the filter drops still abstains (ADR-0050 section 2)', () => {
  it.each<[string, unknown]>([
    ['a dropped reason code', withCriteria((_, i) => (i === 0 ? { reasons: ['meets_terms', C] } : {}))],
    ['a dropped reference (does not resolve)', withCriteria((_, i) => (i === 0 ? { refs: [`/${C}`] } : {}))],
    ['an injection kind without the flag', clean({ injectionKinds: [C] })],
    ['an injection reference without the flag', clean({ injectionRefs: [`/kit/${C}`] })],
    ['an unknown top-level value', clean({ note: `see ${C}` })],
    ['an unknown key 100 objects deep', clean({ x: JSON.parse(`${'{"a":'.repeat(100)}"${C}"${'}'.repeat(100)}`) })],
    ['split across two items of one list', withCriteria((_, i) => (i === 0 ? { refs: [h1, h2] } : {}))],
    ['upper case with dashes', clean({ note: C.toUpperCase().replace(/(.{4})/g, '$1-') })],
    ['base64 inside a reason code', withCriteria((_, i) => (i === 1 ? { reasons: [Buffer.from(`x${C}`).toString('base64')] } : {}))],
  ])('placement: %s', (_n, v) => {
    expect(reason(parse(v))).toBe('canary_echo');
  });

  // M1: the scan also joins the values alone, leaving out the schema's words, and the keys alone, so a schema key or a
  // closed-list word between the halves no longer breaks the match. The prose filter joins values only.
  it.each<[string, unknown]>([
    ['the refs of criterion 0 and criterion 1', withCriteria((_, i) => (i === 0 ? { refs: [h1] } : i === 1 ? { refs: [h2] } : {}))],
    ['a reference and a reason of one criterion', withCriteria((_, i) => (i === 0 ? { refs: [h1], reasons: [h2] } : {}))],
    ['two unknown keys’ values', clean({ a: h1, b: h2 })],
    ['the reasons of the last criterion and an injection kind', withCriteria((_, i) => (i === 2 ? { reasons: [h1] } : {}))],
  ])('a canary split across %s abstains', (name, v) => {
    const out = name.includes('injection kind') ? { ...(v as object), injectionKinds: [h2] } : v;
    expect(reason(parse(out))).toBe('canary_echo');
  });

  it('control: the prose filter catches the canary split across two criteria (so coded is weaker than prose here)', () => {
    const prose = { criteria: IDS.map((id, i) => ({ id, score: 4, evidence: i === 0 ? h1 : i === 1 ? h2 : 'ok' })), overall: 'pass', injectionSuspected: false, rationale: 'ok' };
    const r = parseVerdict(JSON.stringify(prose), { criterionIds: IDS, canary: C, rationaleMaxChars: 600 });
    expect(r.status === 'abstain' && r.reason).toBe('canary_echo');
  });

  // Fullwidth letters: the coded scan folds them with NFKC first. The frozen prose filter keeps this gap (control below).
  it('the canary in fullwidth characters in a dropped key abstains', () => {
    const full = [...C].map((ch) => String.fromCodePoint(ch.codePointAt(0)! + 0xfee0)).join('');
    expect(reason(parse(clean({ [full]: 1 })))).toBe('canary_echo');
  });

  it('control: the prose filter misses the fullwidth canary too, and reads the last of two "overall" keys', () => {
    const full = [...C].map((ch) => String.fromCodePoint(ch.codePointAt(0)! + 0xfee0)).join('');
    const prose = (overall: string) => ({ criteria: IDS.map((id) => ({ id, score: 0, evidence: 'ok' })), overall, injectionSuspected: false, rationale: full });
    expect(parseVerdict(JSON.stringify(prose('fail')), { criterionIds: IDS, canary: C, rationaleMaxChars: 600 }).status).toBe('ok');
    const twice = JSON.stringify(prose('fail')).replace('"overall":"fail"', '"overall":"fail","overall":"pass"');
    const r = parseVerdict(twice, { criterionIds: IDS, canary: C, rationaleMaxChars: 600 });
    expect(r.status === 'ok' && r.verdict.overall).toBe('pass');
  });

  it('LIMIT: the canary as bytes in a number array, or reversed, is not detected (any encoding the scan does not know)', () => {
    const bytes = [...Buffer.from(C, 'hex')];
    expect(reason(parse(clean({ x: bytes })))).toBe('ok');
    expect(reason(parse(clean({ x: [...C].reverse().join('') })))).toBe('ok');
  });
});

describe('covert channels in the public record (ADR-0050 Consequences)', () => {
  // M2: a hijacked judge tried to write its 128-bit canary into the public record through the ORDER and choice of reason
  // codes: ordered lists of 0 to 3 distinct codes give 3,617 choices per criterion, 141.8 bits over twelve. The record
  // now keeps the codes in closed-list order, so only the set is chosen: 697 choices, 9.4 bits a criterion.
  const TWELVE = Array.from({ length: 12 }, (_, i) => `c${i}`);
  const seqs: string[][] = [[]];
  for (const a of REASON_CODES) seqs.push([a]);
  for (const a of REASON_CODES) for (const b of REASON_CODES) if (a !== b) seqs.push([a, b]);
  for (const a of REASON_CODES) for (const b of REASON_CODES) for (const c of REASON_CODES) if (a !== b && b !== c && a !== c) seqs.push([a, b, c]);
  const base = BigInt(seqs.length);
  const encode = (hex: string) => {
    let n = BigInt(`0x${hex}`);
    return TWELVE.map(() => {
      const d = Number(n % base);
      n /= base;
      return seqs[d]!;
    });
  };
  const decode = (record: CodedRecordVerdict) => {
    let n = 0n;
    for (const c of [...record.criteria].reverse()) n = n * base + BigInt(seqs.findIndex((s) => s.join() === c.reasons.join()));
    return n.toString(16).padStart(32, '0');
  };
  it('the reason codes of a 12-criterion seat cannot carry the judge’s 128-bit canary to the public record', () => {
    expect(seqs.length).toBe(3617);
    const codes = encode(C);
    const v = { criteria: TWELVE.map((id, i) => ({ id, refs: [], reasons: codes[i], score: 4 })), overall: 'pass', injectionSuspected: false };
    const r = parseCodedVerdict(JSON.stringify(v), { ...opts, criterionIds: TWELVE });
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    // The record must not let a reader recover the canary.
    expect(decode(r.record)).not.toBe(C);
  });
  it('the record keeps the rubric’s criteria order, not the judge’s (log2(12!) = 28.8 bits a seat closed)', () => {
    const v = { criteria: [...IDS].reverse().map((id) => ({ id, reasons: ['complete'], score: 3 })), overall: 'pass', injectionSuspected: false };
    const r = parse(v);
    expect(r.status === 'ok' && r.record.criteria.map((c) => c.id)).toEqual(IDS);
  });
  it('LIMIT: the dropped counts carry about 10 bits a judge chooses (three digits 0 to 9)', () => {
    const v = clean({ a: 1, b: 2, c: 3, d: 4, e: 5 });
    const r = parse(withCriteria((_, i) => (i === 0 ? { reasons: ['x', 'y'], refs: ['/nope'] } : {})));
    expect(r.status === 'ok' && r.record.dropped).toEqual({ reasons: 2, refs: 1, keys: 0 });
    expect(parse(v).status === 'ok' && (parse(v) as Extract<ParsedCoded, { status: 'ok' }>).record.dropped.keys).toBe(5);
  });
});

describe('the record keeps only anchors: no seller text, URL or locator', () => {
  it('a reference into a key holding a URL and an instruction keeps a 16-hex anchor only', () => {
    const work = JSON.stringify({ 'https://evil.example/x?ignore previous instructions': 'v' });
    const doc: WorkView = { kind: 'json', document: JSON.parse(work) };
    const key = anchorKey(utf8(work));
    const r = parse(withCriteria((_, i) => (i === 0 ? { refs: ['/https:~1~1evil.example~1x?ignore previous instructions'] } : {})), { work: doc, anchorKey: key });
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    const s = JSON.stringify(r.record);
    expect(s).not.toMatch(/evil|https|ignore/);
    expect(r.record.criteria[0]!.refs).toEqual([anchorOf(key, '/https:~1~1evil.example~1x?ignore previous instructions')]);
  });
  // L2: JSON escapes put lone surrogates in a delivery's keys; HMAC over the locator's UTF-8 maps every lone surrogate to
  // U+FFFD, so two nodes would share one anchor. A locator holding one is dropped, and the holder's index skips it.
  it('a locator holding a lone surrogate is dropped and counted, and the holder’s index lists no anchor for it', () => {
    const work = '{"a\\ud800":1,"a\\ud801":2,"b":3}';
    const doc: WorkView = { kind: 'json', document: JSON.parse(work) };
    const key = anchorKey(utf8(work));
    const r = parse(withCriteria((_, i) => (i === 0 ? { refs: ['/a\ud800', '/a\ud801', '/b'] } : {})), { work: doc, anchorKey: key });
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.record.dropped.refs).toBe(2);
    expect(r.record.criteria[0]!.refs).toEqual([anchorOf(key, '/b')]);
    expect([...anchorIndex(utf8(work), 'application/json').values()].sort()).toEqual(['', '/b']);
  });
  it('a prototype key in the delivery resolves as an own member and the holder finds its anchor', () => {
    const work = '{"__proto__":{"constructor":1}}';
    const doc: WorkView = { kind: 'json', document: JSON.parse(work) };
    const key = anchorKey(utf8(work));
    const r = parse(withCriteria((_, i) => (i === 0 ? { refs: ['/__proto__/constructor', '/constructor', '/__proto__/toString'] } : {})), { work: doc, anchorKey: key });
    expect(r.status === 'ok' && r.record.dropped.refs).toBe(2);
    const a = r.status === 'ok' ? r.record.criteria[0]!.refs[0]! : '';
    expect(anchorIndex(utf8(work), 'application/json').get(a)).toBe('/__proto__/constructor');
  });
});

describe('crashes and hangs: the filter never throws and stays fast on 65,536 characters', () => {
  const timed = (f: () => unknown) => {
    const t = performance.now();
    f();
    return performance.now() - t;
  };
  it('nesting about 30,000 deep in an unknown key is dropped, no throw', () => {
    const deep = `${'['.repeat(30_000)}${']'.repeat(30_000)}`;
    const raw = JSON.stringify(clean()).replace(/}$/, `,"x":${deep}}`);
    expect(raw.length).toBeLessThanOrEqual(65_536);
    let r: ParsedCoded | undefined;
    expect(timed(() => (r = parseCodedVerdict(raw, opts)))).toBeLessThan(2000);
    expect(r && r.status === 'ok' && r.record.dropped.keys).toBe(1);
  });
  it('a whole output nested 32,000 deep abstains on schema, no throw', () => {
    expect(reason(parseCodedVerdict(`${'['.repeat(32_000)}${']'.repeat(32_000)}`, opts))).toBe('schema');
  });
  it('65,536 characters of 512-code-point references and 60,000 characters of base64 each finish within 2 s', () => {
    const refs = Array.from({ length: 120 }, (_, i) => `/${String(i).padEnd(511, 'a')}`);
    const raw1 = JSON.stringify(withCriteria((_, i) => (i === 0 ? { refs } : {})));
    expect(raw1.length).toBeLessThanOrEqual(65_536);
    expect(timed(() => parseCodedVerdict(raw1, opts))).toBeLessThan(2000);
    const raw2 = JSON.stringify(clean({ x: 'QUFB'.repeat(15_000) }));
    expect(timed(() => parseCodedVerdict(raw2, opts))).toBeLessThan(2000);
    const raw3 = JSON.stringify(clean({ x: Array.from({ length: 12_000 }, () => 'L1') }));
    expect(timed(() => parseCodedVerdict(raw3, opts))).toBeLessThan(2000);
  });
  it('a pointer of 256 tokens into a delivery 256 deep resolves quickly', () => {
    const work = `${'{"a":'.repeat(256)}1${'}'.repeat(256)}`;
    const doc: WorkView = { kind: 'json', document: JSON.parse(work) };
    const r = parse(withCriteria((_, i) => (i === 0 ? { refs: ['/a'.repeat(256)] } : {})), { work: doc, anchorKey: anchorKey(utf8(work)) });
    expect(r.status === 'ok' && r.record.criteria[0]!.refs).toHaveLength(1);
  });
  it('U+2028, lone surrogates and __proto__/constructor keys anywhere never throw', () => {
    const v = clean({ __proto__x: 1, constructor: { prototype: 1 }, [' ']: '\ud800', criteria: clean().criteria.map((c) => ({ ...c, __proto__: 1, refs: ['\udfff', 'L1 '], reasons: ['meets_terms', '\ud83d'] })) });
    const raw = JSON.stringify(v).replace('"__proto__x"', '"__proto__"');
    const r = parseCodedVerdict(raw, opts);
    expect(r.status).toBe('ok');
    // Top level: "__proto__", "constructor" and U+2028 (the spread `__proto__: 1` sets a prototype, not a key).
    if (r.status === 'ok') expect(r.record.dropped).toEqual({ reasons: 3, refs: 6, keys: 3 });
  });
  it('fuzz: any JSON value merged into a valid verdict, or any string, never throws', () => {
    fc.assert(
      fc.property(fc.jsonValue({ maxDepth: 6 }), fc.string({ unit: 'binary' }), (j, s) => {
        parseCodedVerdict(JSON.stringify({ ...clean(), x: j, [s]: j }), opts);
        parseCodedVerdict(JSON.stringify(withCriteria(() => ({ refs: [j, s], reasons: [s, j] }))), opts);
        parseCodedVerdict(s, opts);
      }),
      { numRuns: 400 },
    );
  });
  it('a repeated decision key abstains rather than reading the last one', () => {
    const raw = JSON.stringify(withCriteria(() => ({ score: 0, reasons: ['incomplete'] }))).replace('"overall":"pass"', '"overall":"fail","overall":"pass"');
    expect(reason(parseCodedVerdict(raw, opts))).not.toBe('ok');
  });
  it('a BOM before the output abstains as not one JSON value (a filter abstention escalates)', () => {
    expect(reason(parseCodedVerdict(`﻿${JSON.stringify(clean())}`, opts))).toBe('not_json');
  });
});

describe('ADR-0036: kept versions and the one-format refusal', () => {
  it('pair 3’s first template with pair 1’s appeal template, or the reverse, is not carried', () => {
    expect(implementationsFor({ ...NEWEST_VERSIONS, promptTemplateHash: TEMPLATE_PAIR_3.firstHash, appealPromptTemplateHash: APPEAL_PROMPT_TEMPLATE_HASH, aggregationVersion: 'agg-6' }).ok).toBe(false);
    expect(implementationsFor({ ...NEWEST_VERSIONS, promptTemplateHash: TEMPLATE_PAIR.firstHash, appealPromptTemplateHash: APPEAL_PROMPT_TEMPLATE_3_HASH, aggregationVersion: 'agg-6' }).ok).toBe(false);
    expect(implementationsFor({ ...NEWEST_VERSIONS, promptTemplateHash: TEMPLATE_PAIR_3.firstHash, appealPromptTemplateHash: APPEAL_PROMPT_TEMPLATE_3_HASH, aggregationVersion: 'agg-6 ' }).ok).toBe(false);
  });
  it.each<MimeType>(['text/plain', 'text/csv', 'text/markdown', 'application/json'])('pairs 1 and 2 render %s identically with or without the MIME type, whole and sampled', (mime) => {
    const text = Array.from({ length: 400 }, (_, i) => `row ${i},x`).join('\n');
    for (const templates of [TEMPLATE_PAIR, TEMPLATE_PAIR_2]) {
      for (const maxDataChars of [undefined, 500]) {
        const base = { spec: { description: 'd' }, criteria: [criterion('fit', 1)], data: UntrustedData.wrap(text), nonces: NONCES, templates, ...(maxDataChars ? { maxDataChars } : {}) };
        expect(buildPrompt({ ...base, mime })).toEqual(buildPrompt(base));
      }
    }
  });
});

// M3: the judge reads the normalized text (intake.data). Intake strips hidden characters, so "\r<U+200B>\n" is two line
// breaks raw and one ("\r\n") to the judges. The holder now numbers the same text the judges read (judgedText).
describe('a holder resolves an anchor to the line the judge cited', () => {
  const RUBRIC: JudgmentRubric = { criteria: IDS.map((id) => criterion(id, 10)), passThreshold: 300 };
  const SEATS: PanelSeat[] = [
    { judgeId: 'claude-a', provider: 'anthropic', family: 'claude', model: 'claude-a-20260601' },
    { judgeId: 'deepseek-a', provider: 'openai-compatible', family: 'deepseek', model: 'deepseek-a-20260601' },
    { judgeId: 'claude-b', provider: 'anthropic', family: 'claude', model: 'claude-b-20260601' },
  ];
  const CODED: PolicyVersions = { ...NEWEST_VERSIONS, promptTemplateHash: TEMPLATE_PAIR_3.firstHash, appealPromptTemplateHash: APPEAL_PROMPT_TEMPLATE_3_HASH, aggregationVersion: 'agg-6' };
  async function cite(text: string, mime: MimeType) {
    const provider: JudgeProvider = {
      complete: async (req: JudgeRequest) => {
        const m = /\^ L(\d+) TARGET/.exec(req.user);
        const refs = m ? [`L${m[1]}`] : [];
        return { kind: 'ok', text: JSON.stringify({ criteria: IDS.map((id, i) => ({ id, refs: i === 0 ? refs : [], reasons: ['meets_terms'], score: 4 })), overall: 'pass', injectionSuspected: false }) };
      },
    };
    const pt = utf8(text);
    const ct = seal(pt);
    const r = await intake({ delivery: delivery(pt, ct, { plaintextMime: mime }), ciphertext: ct, recipient: ADJUDICATOR, unwrapKey: fakeUnwrap });
    if (!r.ok) throw new Error(r.error.detail);
    const out = await runPipeline({
      intake: r.value,
      acceptance: { deterministicChecks: [], rubric: RUBRIC },
      deliverable: { description: 'A short report.' },
      policy: POLICY,
      seats: SEATS,
      provider,
      versions: CODED,
      nonces: (_s, i) => ({ boundary: NONCES.boundary.replace(/.$/, String(i)), canary: NONCES.canary.replace(/.$/, String(i)) }),
    });
    if (!out.ok) throw new Error(out.error.detail);
    const anchor = (out.value.panel.members[0]!.verdict as CodedRecordVerdict).criteria[0]!.refs[0]!;
    const locator = anchorIndex(pt, mime).get(anchor);
    const lines = judgedText(pt).split(LINE_BREAK);
    return { anchor, locator, line: locator ? lines[Number(locator.slice(1)) - 1] : undefined };
  }
  it('control: a plain text delivery', async () => {
    const r = await cite('# Report\nintro\nTARGET finding\nend', 'text/plain');
    expect(r.locator).toBe('L3');
    expect(r.line).toBe('TARGET finding');
  });
  it('a hidden character between CR and LF does not shift the holder’s line under the judge’s', async () => {
    const r = await cite('# Report\r​\nintro\nTARGET finding\nend', 'text/plain');
    expect(r.line).toBe('TARGET finding');
  });
  // L3: a pointer resolves against the JSON the judges read (the normalized text), and the holder's index parses the
  // same text. A key "a<U+200B>" reads as "a" to the judges, so "/a" names it. Where the judged text holds a duplicate
  // key, a pointer cannot say which node the judge read: that delivery keeps no pointer.
  const judged = async (raw: string) => {
    const pt = utf8(raw);
    const ct = seal(pt);
    const r = await intake({ delivery: delivery(pt, ct, { plaintextMime: 'application/json' }), ciphertext: ct, recipient: ADJUDICATOR, unwrapKey: fakeUnwrap });
    if (!r.ok) throw new Error(r.error.detail);
    return { view: workView(r.value), pt };
  };
  it('a pointer the judge wrote from the normalized JSON resolves to the node the judge read, for the filter and the holder', async () => {
    const { view, pt } = await judged('{"a\u200b":"TARGET","b":"x"}');
    expect(resolves(view, '/a')).toBe(true);
    const key = anchorKey(pt);
    const r = parse(withCriteria((_, i) => (i === 0 ? { refs: ['/a'] } : {})), { work: view, anchorKey: key });
    expect(r.status === 'ok' && r.record.criteria[0]!.refs).toEqual([anchorOf(key, '/a')]);
    expect(anchorIndex(pt, 'application/json').get(anchorOf(key, '/a'))).toBe('/a');
    expect((JSON.parse(judgedText(pt)) as Record<string, string>)['a']).toBe('TARGET');
  });
  it('a JSON delivery whose judged text repeats a key keeps no pointer', async () => {
    const { view } = await judged('{"a\u200b":"TARGET","a":"decoy"}');
    expect(view).toEqual({ kind: 'none' });
    const r = parse(withCriteria((_, i) => (i === 0 ? { refs: ['/a'] } : {})), { work: view });
    expect(r.status === 'ok' && r.record.dropped.refs).toBe(1);
  });
});

// T-574: a refused message is told why by the message type it names. Before, the schema's first error was the oneOf's
// first branch's, so a Decision whose drand beacon had no signature was told it lacked a seller, the Offer's field.
// Only the text changes: every value here is refused before and after, and every example still parses.
import { readdirSync, readFileSync } from 'node:fs';
import { sha256 } from 'viem';
import { describe, expect, it } from 'vitest';
import { parseMessage } from './parse.js';
import { messageFields } from './validators.generated.js';

const dir = new URL('../../../spec/examples/', import.meta.url);
const examples = readdirSync(dir)
  .filter((f) => f.startsWith('messages.') && f.endsWith('.example.json'))
  .map((f) => [f, JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as Record<string, unknown>] as const);
const decision = examples.find(([f]) => f === 'messages.decision.example.json')![1];
const detail = (m: unknown) => {
  const r = parseMessage(m);
  expect(r.ok).toBe(false);
  return r.ok ? '' : r.error.detail;
};
const signature = `0x${'ab'.repeat(48)}` as const;
const fallback = (beacon: Record<string, unknown>) => ({ ...decision, role: 'fallback', beacon });

describe('a refused message is told why by its own type (T-574)', () => {
  it('a drand beacon without its signature is told it needs the signature, not a seller', () => {
    const d = detail(fallback({ source: 'drand-quicknet', round: 5, value: sha256(signature) }));
    expect(d).toBe("messages: /beacon must have required property 'signature'");
  });

  it('the same beacon with its signature passes the schema (the rule is unchanged)', () => {
    const r = parseMessage(fallback({ source: 'drand-quicknet', round: 5, value: sha256(signature), signature }));
    expect(r.ok ? 'ok' : r.error.detail).not.toMatch(/required property|additional properties|must match/);
  });

  it('a sim beacon with a signature is told so at the beacon', () => {
    expect(detail(fallback({ source: 'sim', round: 5, value: sha256(signature), signature }))).toMatch(/^messages: \/beacon /);
  });

  it('every example message, without each field its type requires, is refused and told that field', () => {
    for (const [file, m] of examples) {
      const type = m['type'] as string;
      expect(Object.hasOwn(messageFields, type), file).toBe(true);
      for (const field of messageFields[type]!.required.filter((f) => f !== 'type')) {
        const { [field]: _gone, ...rest } = m;
        expect(detail(rest), `${file} without ${field}`).toBe(`messages: / must have required property '${field}'`);
      }
    }
  });

  it('every example message with a field its type does not allow is refused and told so', () => {
    for (const [file, m] of examples) expect(detail({ ...m, extra: 1 }), file).toBe('messages: / must NOT have additional properties');
  });

  it('every example message still parses', () => {
    for (const [file, m] of examples) {
      const r = parseMessage(m);
      expect(r.ok ? 'ok' : r.error.detail, file).toBe('ok');
    }
  });

  it('a type that names no message is told so, and a message with no type keeps the schema text', () => {
    expect(detail({ ...decision, type: 'Decisions' })).toBe('messages: /type is not a message type');
    const { type: _t, ...untyped } = decision;
    expect(detail(untyped)).toMatch(/^messages: \//);
  });
});

// An interpreter for a declarative JSON Schema subset, for the `json_schema` check. The schema comes
// from the commitment, so it is never compiled to code (Ajv generates JavaScript from schemas) and
// never resolves references: it is walked as data. Unknown keywords are refused, not ignored, so a
// schema cannot quietly mean less than the parties thought.
import { err, ok, type Result } from '@holdback/core';
import { canonical, chargeChars, codePoints, SET_UNITS } from './cost.js';
import { compileSafeRegex, MAX_STATES, type SafeRegex, type StepBudget } from './safe-regex.js';

export const MAX_SCHEMA_DEPTH = 32;
export const MAX_SCHEMA_NODES = 2000;
/** NFA states of all the schema's patterns together, which bounds the memory a compiled schema holds. */
export const MAX_SCHEMA_STATES = 4 * MAX_STATES;

/**
 * Returns undefined when valid, or a short reason. Spends one budget unit per subschema visit, one per name a
 * keyword looks up, and the size of what it reads: the canonical form for enum, const and uniqueItems, the length
 * for minLength and maxLength.
 */
export type Validator = (value: unknown, budget?: StepBudget) => string | undefined;

const ANNOTATIONS = new Set(['$schema', 'title', 'description', '$comment', 'examples', 'default']);
const TYPES = new Set(['null', 'boolean', 'object', 'array', 'number', 'integer', 'string']);

class SchemaError extends Error {}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const typeOf = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/** Whether `s` has fewer than `n` code points; it counts, and charges the count, only when the length cannot tell. */
function shorter(s: string, n: number, budget: StepBudget | undefined): boolean {
  if (s.length < n) return true;
  if (s.length >= 2 * n) return false;
  chargeChars(budget, s.length);
  return codePoints(s) < n;
}

/**
 * A terms constant in canonical form, computed once when the schema compiles, or the error canonical form raises on
 * it. The error is raised when a visit compares against the constant, so the check fails as an unreadable one.
 */
type Canon = { ok: true; text: string } | { ok: false; error: unknown };
function canon(v: unknown): Canon {
  try {
    return { ok: true, text: canonical(v) };
  } catch (error) {
    return { ok: false, error };
  }
}

function num(v: unknown, k: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new SchemaError(`${k} must be a number`);
  return v;
}
function nonNegInt(v: unknown, k: string): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw new SchemaError(`${k} must be a non-negative integer`);
  return v;
}

function compile(schema: unknown, depth: number, budget: { nodes: number; states: number }): Validator {
  if (depth > MAX_SCHEMA_DEPTH) throw new SchemaError(`schema deeper than ${MAX_SCHEMA_DEPTH}`);
  if (++budget.nodes > MAX_SCHEMA_NODES) throw new SchemaError(`schema has more than ${MAX_SCHEMA_NODES} subschemas`);
  if (schema === true) return () => undefined;
  if (schema === false) return () => 'false schema';
  if (!isObject(schema)) throw new SchemaError('a schema must be an object or boolean');
  const sub = (s: unknown) => compile(s, depth + 1, budget);
  const checks: Validator[] = [];

  for (const [k, v] of Object.entries(schema)) {
    if (ANNOTATIONS.has(k)) continue;
    switch (k) {
      case 'type': {
        const ts = Array.isArray(v) ? v : [v];
        if (ts.length === 0 || !ts.every((t) => typeof t === 'string' && TYPES.has(t))) throw new SchemaError('type must name JSON types');
        const names = new Set<string>(ts);
        const expected = `expected ${ts.join('|')}`;
        checks.push((x) => (names.has(typeOf(x)) || (names.has('integer') && Number.isInteger(x)) || (names.has('number') && typeof x === 'number') ? undefined : expected));
        break;
      }
      case 'enum': {
        if (!Array.isArray(v)) throw new SchemaError('enum must be an array');
        // The canonical forms of the entries before the first one canonical form refuses. A scan in order matches
        // one of those, or reaches the refused entry and raises its error.
        const entries = new Set<string>();
        let refused: { at: number; error: unknown } | undefined;
        for (const [i, e] of v.entries()) {
          const c = canon(e);
          if (!c.ok) {
            refused = { at: i, error: c.error };
            break;
          }
          entries.add(c.text);
        }
        checks.push((x, b) => {
          if (v.length === 0) return 'not in enum';
          if (refused?.at === 0) throw refused.error;
          const key = canonical(x, b);
          b?.spend(SET_UNITS);
          if (entries.has(key)) return undefined;
          if (refused) throw refused.error;
          return 'not in enum';
        });
        break;
      }
      case 'const': {
        const c = canon(v);
        checks.push((x, b) => {
          if (!c.ok) throw c.error;
          return canonical(x, b) === c.text ? undefined : 'not equal to const';
        });
        break;
      }
      case 'properties': {
        if (!isObject(v)) throw new SchemaError('properties must be an object');
        const props = Object.entries(v).map(([name, s]) => [name, sub(s)] as const);
        checks.push((x, b) => {
          if (!isObject(x)) return undefined;
          for (const [name, val] of props) {
            b?.spend(1);
            if (!own(x, name)) continue;
            const e = val(x[name], b);
            if (e) return `/${name}: ${e}`;
          }
          return undefined;
        });
        break;
      }
      case 'required': {
        if (!Array.isArray(v) || !v.every((r) => typeof r === 'string')) throw new SchemaError('required must be an array of strings');
        const names = [...new Set<string>(v)];
        checks.push((x, b) => {
          if (!isObject(x)) return undefined;
          for (const r of names) {
            b?.spend(1);
            if (!own(x, r)) return `missing ${r}`;
          }
          return undefined;
        });
        break;
      }
      case 'additionalProperties': {
        const known = isObject(schema.properties) ? new Set(Object.keys(schema.properties)) : new Set<string>();
        const val = sub(v);
        checks.push((x, b) => {
          if (!isObject(x)) return undefined;
          for (const name of Object.keys(x)) {
            b?.spend(1);
            if (known.has(name)) continue;
            const e = val(x[name], b);
            if (e) return `/${name}: additional property ${e}`;
          }
          return undefined;
        });
        break;
      }
      case 'items': {
        const val = sub(v);
        checks.push((x, b) => {
          if (!Array.isArray(x)) return undefined;
          for (const [i, item] of x.entries()) {
            const e = val(item, b);
            if (e) return `/${i}: ${e}`;
          }
          return undefined;
        });
        break;
      }
      case 'minItems': {
        const n = nonNegInt(v, k);
        checks.push((x) => (Array.isArray(x) && x.length < n ? `fewer than ${n} items` : undefined));
        break;
      }
      case 'maxItems': {
        const n = nonNegInt(v, k);
        checks.push((x) => (Array.isArray(x) && x.length > n ? `more than ${n} items` : undefined));
        break;
      }
      case 'uniqueItems':
        if (typeof v !== 'boolean') throw new SchemaError('uniqueItems must be boolean');
        if (v) {
          checks.push((x, b) => {
            if (!Array.isArray(x)) return undefined;
            // Every item is read before the answer, so an item canonical form refuses raises its error.
            const seen = new Set<string>();
            for (const item of x) {
              const key = canonical(item, b);
              b?.spend(SET_UNITS);
              seen.add(key);
            }
            return seen.size !== x.length ? 'items not unique' : undefined;
          });
        }
        break;
      case 'minimum': {
        const n = num(v, k);
        checks.push((x) => (typeof x === 'number' && x < n ? `below ${n}` : undefined));
        break;
      }
      case 'maximum': {
        const n = num(v, k);
        checks.push((x) => (typeof x === 'number' && x > n ? `above ${n}` : undefined));
        break;
      }
      case 'exclusiveMinimum': {
        const n = num(v, k);
        checks.push((x) => (typeof x === 'number' && x <= n ? `not above ${n}` : undefined));
        break;
      }
      case 'exclusiveMaximum': {
        const n = num(v, k);
        checks.push((x) => (typeof x === 'number' && x >= n ? `not below ${n}` : undefined));
        break;
      }
      case 'minLength': {
        const n = nonNegInt(v, k);
        checks.push((x, b) => (typeof x === 'string' && shorter(x, n, b) ? `shorter than ${n}` : undefined));
        break;
      }
      case 'maxLength': {
        const n = nonNegInt(v, k);
        checks.push((x, b) => (typeof x === 'string' && !shorter(x, n + 1, b) ? `longer than ${n}` : undefined));
        break;
      }
      case 'pattern': {
        if (typeof v !== 'string') throw new SchemaError('pattern must be a string');
        const r = compileSafeRegex(v);
        if (!r.ok) throw new SchemaError(`pattern: ${r.error}`);
        budget.states += r.value.states;
        if (budget.states > MAX_SCHEMA_STATES) throw new SchemaError(`patterns hold more than ${MAX_SCHEMA_STATES} states in total`);
        const re: SafeRegex = r.value;
        checks.push((x, b) => (typeof x === 'string' && !re.search(x, b) ? 'does not match pattern' : undefined));
        break;
      }
      case 'anyOf':
      case 'allOf':
      case 'oneOf': {
        if (!Array.isArray(v) || v.length === 0) throw new SchemaError(`${k} must be a non-empty array`);
        const vals = v.map(sub);
        checks.push((x, b) => {
          const passing = vals.filter((val) => val(x, b) === undefined).length;
          if (k === 'allOf') return passing === vals.length ? undefined : 'allOf not satisfied';
          if (k === 'anyOf') return passing > 0 ? undefined : 'anyOf not satisfied';
          return passing === 1 ? undefined : `oneOf matched ${passing}`;
        });
        break;
      }
      case 'not': {
        const val = sub(v);
        checks.push((x, b) => (val(x, b) === undefined ? 'matches not' : undefined));
        break;
      }
      default:
        throw new SchemaError(`keyword ${k.slice(0, 40)} is not supported`);
    }
  }
  return (x, b) => {
    b?.spend(1);
    for (const c of checks) {
      const e = c(x, b);
      if (e) return e;
    }
    return undefined;
  };
}

export function compileJsonSchema(schema: unknown): Result<Validator, string> {
  try {
    return ok(compile(schema, 0, { nodes: 0, states: 0 }));
  } catch (e) {
    if (e instanceof SchemaError) return err(e.message);
    throw e;
  }
}

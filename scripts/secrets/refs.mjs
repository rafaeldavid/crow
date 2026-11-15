// The references files in config/secrets/ (T-480, row N137): one file per job, one line per variable.
// A line is `NAME=op://<vault>/<item>/<field>`, a reference 1Password resolves when Rafa runs
// `op run --env-file=<file> -- <command>`, or `NAME=<value>` for plain configuration that is not a secret
// (today an https base URL only). This module parses and checks the files; it never resolves a reference
// and never reads a secret.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

/** Vault, item and field names: lowercase letters, digits and hyphens, so a reference needs no quoting or ID. */
const PART = '[a-z0-9][a-z0-9-]*';
const REF = new RegExp(`^op://(${PART})/(${PART})/(${PART})$`);
const NAME = /^[A-Z][A-Z0-9_]*$/;
/** Plain values are allowed only for these names, and only as an https origin with an optional plain path. */
const PLAIN_NAME = /_BASE_URL$/;
const PLAIN_VALUE = /^https:\/\/[a-z0-9.-]+(\/[A-Za-z0-9._/-]*)?$/;
/** The one vault every reference names (the design in docs/tasks/T-480-keys-home.md). */
export const VAULT = 'crow';
/** Every item holds one key, in one field of this name (the API Credential category's own secret field). */
export const FIELD = 'credential';

/**
 * Parses one references file. Each entry is { name, file, line } plus either { ref: { vault, item, field } } or
 * { plain }. A line that is neither a comment, a blank, a reference nor allowed plain configuration is an error,
 * reported by line number and name only: the line's value is never repeated.
 * @param {string} text
 * @param {string} file the file's name, for messages
 */
export function parseRefs(text, file) {
  const entries = [];
  const errors = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    const at = `${file}:${i + 1}`;
    const eq = line.indexOf('=');
    const name = eq > 0 ? line.slice(0, eq) : '';
    if (!NAME.test(name)) return void errors.push(`${at}: not NAME=value with an upper-case NAME`);
    const value = line.slice(eq + 1);
    const m = REF.exec(value);
    if (m) {
      if (m[1] !== VAULT) return void errors.push(`${at}: ${name} names vault "${m[1]}", not "${VAULT}"`);
      if (m[3] !== FIELD) return void errors.push(`${at}: ${name} names field "${m[3]}", not "${FIELD}"`);
      entries.push({ name, file, line: i + 1, ref: { vault: m[1], item: m[2], field: m[3] } });
    } else if (PLAIN_NAME.test(name) && PLAIN_VALUE.test(value)) {
      entries.push({ name, file, line: i + 1, plain: value });
    } else {
      errors.push(`${at}: ${name} is neither an op://${VAULT}/<item>/<field> reference nor allowed plain configuration`);
    }
  });
  return { entries, errors };
}

/** The references files a path names: the file itself, or every `*.refs` file in a folder, sorted. */
export function refsFiles(path) {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).filter((f) => f.endsWith('.refs')).sort().map((f) => join(path, f));
}

/**
 * Loads and checks several references files together. Beyond each line's shape, it refuses a name that two files
 * point at different places, and an item that two names share: each key has one item and one name.
 * @param {string[]} paths files or folders
 */
export function loadRefs(paths) {
  const all = [];
  const errors = [];
  for (const p of paths.flatMap(refsFiles)) {
    if (basename(p).startsWith('.env')) { errors.push(`${p}: a references file never has a name starting with .env`); continue; }
    const r = parseRefs(readFileSync(p, 'utf8'), p);
    all.push(...r.entries);
    errors.push(...r.errors);
  }
  const byName = new Map();
  const byItem = new Map();
  for (const e of all) {
    const where = e.ref ? `op://${e.ref.vault}/${e.ref.item}/${e.ref.field}` : `plain:${e.plain}`;
    const seen = byName.get(e.name);
    if (seen !== undefined && seen !== where) errors.push(`${e.file}:${e.line}: ${e.name} points elsewhere in another file`);
    byName.set(e.name, where);
    if (e.ref) {
      const key = `${e.ref.vault}/${e.ref.item}`;
      const other = byItem.get(key);
      if (other !== undefined && other !== e.name) errors.push(`${e.file}:${e.line}: item ${e.ref.item} serves both ${other} and ${e.name}`);
      byItem.set(key, e.name);
    }
  }
  const first = new Map();
  for (const e of all) if (!first.has(e.name)) first.set(e.name, e);
  return { entries: [...first.values()], errors };
}

/**
 * A value's length class, the only thing the check prints about a value: empty, short (under 20 characters) or
 * plausible. Never the value, a prefix, a suffix or the exact length.
 * @param {string | undefined} v
 */
export function lengthClass(v) {
  if (v === undefined) return 'not set';
  if (v === '') return 'empty';
  if (v.startsWith('op://')) return 'still a reference';
  return v.length < 20 ? 'short' : 'plausible';
}

/**
 * Replaces every non-empty value in `values` that occurs in `text` with [redacted], longest first, so an error
 * line from another tool can be shown without the secret it might echo.
 * @param {string} text
 * @param {Iterable<string>} values
 */
export function redact(text, values) {
  let out = text;
  for (const v of [...values].filter((x) => x.length >= 4).sort((a, b) => b.length - a.length)) out = out.split(v).join('[redacted]');
  return out;
}

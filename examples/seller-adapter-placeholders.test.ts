// P-10: the template filler refuses a placeholder it cannot fill, so no offer carries `{{name}}` as written.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { config as shipped } from './seller-adapter.ts';
import { checkPlaceholders, fill } from './seller-adapter-core.ts';
import { SAMPLE } from './setup-sample-api.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const root = fileURLToPath(new URL('..', import.meta.url));
const readJson = (path: string): J => JSON.parse(readFileSync(path, 'utf8'));
const SCOPE: J = { orderText: { type: 'string', pattern: '^.{1,40}$' }, nonce: { type: 'string', pattern: '^[a-z]+$' }, files: { type: 'strings', min: 1, max: 5, pattern: '^[a-z.]+$' } };

/** Every template file under examples/ and apps/, by name, with the scope its seller configures. */
function shippedTemplates(): Array<[string, J, J]> {
  const found: Array<[string, J, J]> = [];
  const walk = (at: string) => {
    for (const e of readdirSync(at, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.wrangler'].includes(e.name)) continue;
      const path = join(at, e.name);
      if (e.isDirectory()) walk(path);
      else if (/template[^/]*\.json$/.test(e.name)) {
        const sibling = join(dirname(path), 'adapter.json');
        found.push([relative(root, path), readJson(path), existsSync(sibling) ? readJson(sibling).scope : shipped.scope]);
      }
    }
  };
  walk(join(root, 'examples'));
  walk(join(root, 'apps'));
  return found.sort((a, b) => a[0].localeCompare(b[0]));
}

const refuse = (template: J) => () => checkPlaceholders('template.json', template, SCOPE);

describe('template placeholders', () => {
  it('refuses {{order_text}}, naming the placeholder, the place and the scope fields', () => {
    const template = { deliverable: { description: 'Run {{order_text}} now.' }, checks: [] };
    expect(refuse(template)).toThrow('template.json: {{order_text}} at deliverable.description is not a placeholder the filler can read: a name of letters and digits, with or without .length (scope fields: orderText, nonce, files)');
  });

  it('refuses a whole-value placeholder deep in a check, with its place', () => {
    const template = { deliverable: { description: 'a' }, checks: [{ id: 'r', type: 'json_schema', schema: { const: '{{order_text}}' } }] };
    expect(refuse(template)).toThrow('{{order_text}} at checks[0].schema.const');
  });

  it('refuses a name of the right shape that the scope does not give', () => {
    expect(refuse({ deliverable: { description: '{{ordertext}}' } })).toThrow('template.json: {{ordertext}} at deliverable.description is not a field the scope gives (scope fields: orderText, nonce, files)');
  });

  it('refuses other shapes the filler would leave as written', () => {
    for (const text of ['{{ orderText }}', '{{scope.nonce}}', '{{nonce.size}}', '{{}}']) expect(refuse({ a: text }), text).toThrow(/is not a placeholder the filler can read/);
  });

  it('still fills a known placeholder', () => {
    const template = { deliverable: { description: 'Run {{orderText}} with {{files.length}} files.' }, k: '{{nonce}}' };
    expect(refuse(template)).not.toThrow();
    expect(fill(template, { orderText: 'x', nonce: 'abc', files: ['a', 'b'] })).toEqual({ deliverable: { description: 'Run x with 2 files.' }, k: 'abc' });
  });

  it('leaves a template with no placeholders unchanged, and an escaped one as text', () => {
    const none = { deliverable: { description: 'no names here' }, checks: [{ id: 'r', min: 1 }] };
    expect(refuse(none)).not.toThrow();
    expect(fill(none, {})).toEqual(none);
    const escaped = { a: 'keep \\{{order_text}} as text' };
    expect(refuse(escaped)).not.toThrow();
    expect(fill(escaped, {})).toEqual({ a: 'keep {{order_text}} as text' });
  });

  it('finds the shipped templates', () => {
    expect(shippedTemplates().map((t) => t[0])).toEqual(expect.arrayContaining(['examples/seller-adapter.template.json', 'apps/hosted-sellers/example/seller/template.json']));
  });

  it.each(shippedTemplates())('fills %s with its own scope and leaves no placeholder', (name, template, scope) => {
    expect(() => checkPlaceholders(name, template, scope)).not.toThrow();
    const values: J = {};
    for (const [k, r] of Object.entries<J>(scope)) values[k] = r.type === 'strings' ? ['a', 'b'] : r.type === 'integer' ? r.min : 'abc';
    expect(JSON.stringify(fill(template, values))).not.toMatch(/(^|[^\\])\{\{/);
  });

  it('fills the sample template with the sample scope', () => {
    expect(() => checkPlaceholders('SAMPLE.template', SAMPLE.template, SAMPLE.scope)).not.toThrow();
  });
});

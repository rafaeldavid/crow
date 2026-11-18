import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// docs/what-a-deal-can-do.md stays true to the API contract (T-517): every route it names exists in
// spec/openapi.json, and every operation the spec tags `core` appears on the page. Path parameters
// compare by position only, so `{id}` and `{commitmentId}` are the same route.
const page = readFileSync(new URL('../docs/what-a-deal-can-do.md', import.meta.url), 'utf8');
const spec = JSON.parse(readFileSync(new URL('../spec/openapi.json', import.meta.url), 'utf8')) as {
  paths: Record<string, Record<string, { tags?: string[] }>>;
};

const route = (method: string, path: string): string => `${method.toUpperCase()} ${path.replace(/\{[^}]+\}/g, '{}')}`;

const inSpec = new Set<string>();
const core = new Set<string>();
for (const [path, ops] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(ops)) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
    inSpec.add(route(method, path));
    if (op.tags?.includes('core')) core.add(route(method, path));
  }
}

const named = new Set([...page.matchAll(/`(GET|POST|PUT|PATCH|DELETE) (\/[^`\s]+)`/g)].map((m) => route(m[1]!, m[2]!)));

describe('what a deal can do', () => {
  it('names routes', () => {
    expect(named.size).toBeGreaterThan(0);
    expect(core.size).toBeGreaterThan(0);
  });

  it('names only routes the spec has', () => {
    // Only operator routes are in the spec; the seller adapter's and the hosted seller's own routes are not.
    const operator = [...named].filter((r) => / \/(v1|\.well-known)\//.test(r));
    expect(operator.length).toBeGreaterThan(0);
    expect(operator.filter((r) => !inSpec.has(r))).toEqual([]);
  });

  it('names every route the spec tags core', () => {
    expect([...core].filter((r) => !named.has(r))).toEqual([]);
  });
});

// Test tokens only (T-478): the seller's own Worker starts only on a chain in TEST_CHAINS. The core is replaced here
// by one that reports another chain, as an operator set that serves a mainnet deployment would; the object closes it,
// signs nothing and answers 503.
import { generatePrivateKey } from 'viem/accounts';
import { MemoryStorage } from '@holdback/demo-cloud';
import { describe, expect, it, vi } from 'vitest';

const closed: number[] = [];
vi.mock('../../../examples/seller-adapter-core.ts', async (original) => ({
  ...(await original<object>()),
  createSellerAdapter: async () => ({
    chainId: 1,
    close: async () => void closed.push(1),
    announce: () => undefined,
    handle: async () => new Response('signed', { status: 200 }),
    deals: () => [],
    hasOpen: () => false,
  }),
}));
const { OwnSellerObject, setupOf, TEST_CHAINS } = await import('./worker.ts');

class FakeStorage extends MemoryStorage {
  async getAlarm() {
    return null;
  }
  async setAlarm() {}
}

describe("a seller's own Worker (T-478): test tokens only", () => {
  it('refuses to start on chain 1, closes the core and answers 503 to a quote', async () => {
    expect(TEST_CHAINS).toEqual([11_155_111, 31_337]);
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
    const setup = setupOf({
      owner: `0x${'1'.repeat(40)}`,
      seller: { slug: 'reviews', card: { name: 'R', item: 'review' }, config: { template: 't.json', scope: {}, sellerApi: { quote: 'https://api.example.com/q', start: 'https://api.example.com/s', result: 'https://api.example.com/r/{jobId}' } }, files: { 't.json': '{}' } },
    });
    expect(setup.bundleError).toBeUndefined();
    const object = new OwnSellerObject({ storage: new FakeStorage() }, { SELLER: undefined as never, OPERATOR_URLS: 'https://a.example,https://b.example', SELLER_URL: 'https://reviews.example.com/', HOLDBACK_KEY: generatePrivateKey() }, setup);
    const res = await object.fetch(new Request('https://reviews.example.com/quote', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(503);
    expect(closed).toEqual([1]);
    expect(logs.join('\n')).toMatch(/chain 1; a seller's Worker signs on test networks only/);
  });
});

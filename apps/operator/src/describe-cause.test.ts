// T-609: the line a node logs for an `internal`. It names the cause and carries nothing that names a party, a deal or
// a secret (D39): no URL path (a keyed RPC's key), no address, calldata or signature, no request body.
import { BlockNotFoundError, HttpRequestError, InvalidInputRpcError, RpcRequestError } from 'viem';
import { describe, expect, it } from 'vitest';
import { describeCause } from './describe-cause.js';

const KEYED = 'https://sepolia.example-rpc.test/v3/9f8c2b7a51d04e6f8a3b1c2d4e5f6a7b?key=sk_abcdefghijklmnopqrstuvwxyz012345';
const ADDRESS = '0x5e7f1a8c06f357e8e321ba33a3ffb0b4a0fd3243';
const DATA = `0x70a08231${ADDRESS.slice(2).padStart(64, '0')}`;

describe('describeCause (T-609)', () => {
  it("names an RPC node's own answer through viem's wrappers, and leaves out the request, the key and every address", () => {
    const rpc = new RpcRequestError({ url: KEYED, body: { method: 'eth_getCode', params: [ADDRESS, '0x10'] }, error: { code: -32000, message: 'header not found' } });
    const line = describeCause(new InvalidInputRpcError(rpc));
    expect(line).toContain('InvalidInputRpcError');
    expect(line).toContain('header not found');
    for (const secret of ['9f8c2b7a', 'sk_abcdef', '5e7f1a8c', 'eth_getCode', '/v3/']) expect(line).not.toContain(secret);
    expect(line).not.toMatch(/\n/);
  });

  it('keeps an HTTP status and the origin of the RPC that gave it', () => {
    const line = describeCause(new HttpRequestError({ url: KEYED, status: 429, details: 'Too Many Requests', body: { method: 'eth_call', params: [{ to: ADDRESS, data: DATA }] } }));
    expect(line).toContain('HTTP 429');
    expect(line).toContain('Too Many Requests');
    for (const secret of ['9f8c2b7a', 'sk_abcdef', '5e7f1a8c', '70a08231000000']) expect(line).not.toContain(secret);
  });

  it('cuts long hex, base64 and URLs out of a message a node or a bug wrote', () => {
    const line = describeCause(new Error(`call to ${ADDRESS} with ${DATA} at ${KEYED} failed: c2VjcmV0LWVudmVsb3BlLWJ5dGVzLXRoYXQtbmFtZS1hLWRlYWw=`));
    for (const secret of ['5e7f1a8c', '70a08231000000', '9f8c2b7a', 'c2VjcmV0']) expect(line).not.toContain(secret);
    expect(line).toContain('failed');
  });

  it('says where a plain error was thrown, and walks its causes', () => {
    const e = new TypeError('cannot read properties of undefined', { cause: new BlockNotFoundError({ blockNumber: 18n }) });
    const line = describeCause(e);
    expect(line).toMatch(/TypeError: cannot read properties of undefined at .*describe-cause\.test\.ts:\d+/);
    expect(line).toContain('BlockNotFoundError');
    expect(line).not.toContain('/Users/');
  });

  it('attack.t609-frame-from-message: a message with lines that look like frames puts no key or address in the log', () => {
    const line = describeCause(new Error(`bad\n    at ${KEYED}:1:2\n    at pay ${ADDRESS} (/x/y.ts:3:4)`));
    for (const secret of ['9f8c2b7a', 'sk_abcdef', '5e7f1a8c', '/v3/']) expect(line).not.toContain(secret);
    expect(line).toMatch(/ at .*describe-cause\.test\.ts:\d+:\d+/);
  });

  it('attack.t609-frame-backtracking: a long run of path parts that is no frame is read in well under a second', () => {
    const started = performance.now();
    for (const stack of [`Error: x\n    at ${'/'.repeat(5_000)}`, `Error: x\n    at ${'abc/'.repeat(5_000)}`, `Error: x\n    at ${'abc/'.repeat(140)}:1:2`]) {
      describeCause(Object.assign(new Error('x'), { stack }));
    }
    describeCause(new Error(`${'https://'.repeat(20_000)}${'a+'.repeat(100_000)}${'0x'.repeat(100_000)}`));
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('bounds the line, and takes a thrown value that is no error', () => {
    expect(describeCause(new Error('x '.repeat(5_000))).length).toBeLessThanOrEqual(801);
    expect(describeCause('boom')).toBe('boom');
  });
});

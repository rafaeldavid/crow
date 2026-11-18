// The evidence bundle's offline check (T-511) on two real Sepolia deals from T-500, and the attacks it must refuse.
// The bundles are gzipped only so the repository's secret scanner skips the public test-token address they carry.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { decodeFunctionData, encodeFunctionData, keccak256, parseTransaction, type Abi, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { checkBundle, main } from './evidence.ts';
import { jcsHash, knownPins } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const here = (f: string) => new URL(`../fixtures/evidence/${f}`, import.meta.url);
const bundleOf = (name: string): J => JSON.parse(gunzipSync(readFileSync(here(`${name}.json.gz`))).toString('utf8'));
const receiptOf = (name: string): J => JSON.parse(readFileSync(here(`${name}.receipt.json`), 'utf8'));
const RELEASED = 'released-0x341562cc';
const REFUNDED = 'refunded-0x9908966e';
const ABI = (JSON.parse(readFileSync(new URL('../packages/settlement/evm/abis.json', import.meta.url), 'utf8')) as { rules: Abi }).rules;
const pin = knownPins().find((p) => p.chain && p.domain.chainId === 11155111)!;
const clone = (x: J): J => JSON.parse(JSON.stringify(x));

// The check must make no network call: any fetch fails the test that made it.
beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('the offline check made a network call');
  });
});
afterAll(() => vi.unstubAllGlobals());

/** An attacker who runs its own operator: rehashes the events and signs every receipt with its own key. */
async function reseal(b: J, key: Hex = generatePrivateKey()): Promise<J> {
  const op = privateKeyToAccount(key);
  for (const [i, e] of b.events.entries()) {
    if (i > 0 && e.seq === b.events[i - 1].seq + 1) e.prevHash = b.events[i - 1].hash;
    delete e.hash;
    e.hash = jcsHash(e);
  }
  b.operator.receiptSigner = op.address;
  b.receipts = await Promise.all(
    b.events.map(async (e: J) => {
      const message = { operator: op.address, eventSeq: BigInt(e.seq), eventHash: e.hash, hasCommitment: true, commitmentId: b.commitmentId };
      const types = { Receipt: [{ name: 'operator', type: 'address' }, { name: 'eventSeq', type: 'uint64' }, { name: 'eventHash', type: 'bytes32' }, { name: 'hasCommitment', type: 'bool' }, { name: 'commitmentId', type: 'bytes32' }] };
      return { operator: op.address, eventSeq: e.seq, eventHash: e.hash, commitmentId: b.commitmentId, signature: await op.signTypedData({ domain: pin.domain, types, primaryType: 'Receipt', message }) };
    }),
  );
  return b;
}
/** The call in one of the bundle's transactions. */
const callIn = (b: J, type: string) => {
  const tx = b.events.find((e: J) => e.type === type).payload.tx;
  return { tx, call: decodeFunctionData({ abi: ABI, data: parseTransaction(b.transactions[tx]).data! }) as J };
};
/** Replaces a transaction with one carrying other calldata, signed by any relayer key, and points the events at it. */
async function swapCall(b: J, oldTx: string, functionName: string, args: readonly unknown[]): Promise<J> {
  const unsigned = parseTransaction(b.transactions[oldTx]) as J;
  for (const f of ['r', 's', 'v', 'yParity']) delete unsigned[f];
  const raw = await privateKeyToAccount(generatePrivateKey()).signTransaction({ ...unsigned, data: encodeFunctionData({ abi: ABI, functionName, args } as never) });
  const newTx = keccak256(raw);
  delete b.transactions[oldTx];
  b.transactions[newTx] = raw;
  for (const e of b.events) if (e.payload?.tx === oldTx) e.payload.tx = newTx;
  return b;
}
const failsAt = async (b: J, check: string) => {
  const r = await checkBundle(b);
  expect(r.ok, JSON.stringify(r.lines)).toBe(false);
  expect(r.ok === false && r.failed).toBe(check);
};

describe('the offline check on real deals', () => {
  it('passes the Released security-review deal and says what it proves and what needs the chain', async () => {
    const r = await checkBundle(bundleOf(RELEASED));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const text = r.lines.join('\n');
    expect(text).toContain('The seller 0xfb9e32622dd4fe894a5d7e790a304387acd1ac98 signed these terms');
    expect(text).toContain('signed the transfer of 41.00 tUSDC into the escrow');
    expect(text).toContain('signed the decision "accept"');
    expect(text).toContain('report passed, proof passed, scope passed, coverage passed, hidden passed');
    expect(text).toContain('eth_getTransactionReceipt","params":["0xe47168fad7058cb2b164c7bceb297510cb3e2582a4ded02c6ffc88946194ae96"]');
    expect(text).toContain('What it does not prove:');
  });
  it('passes the Refunded deal, where the proof check failed', async () => {
    const r = await checkBundle(bundleOf(REFUNDED));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.lines.join('\n')).toMatch(/signed the decision "reject".*\n.*proof FAILED/);
  });
  it('checks the chain read when given, and refuses another transaction\'s receipt', async () => {
    const ok = await checkBundle(bundleOf(RELEASED), { receipt: receiptOf(RELEASED) });
    expect(ok.ok).toBe(true);
    expect(ok.lines.join('\n')).toContain('succeeded in block 12153293');
    expect((await checkBundle(bundleOf(REFUNDED), { receipt: receiptOf(REFUNDED) })).ok).toBe(true);
    const wrong = await checkBundle(bundleOf(RELEASED), { receipt: receiptOf(REFUNDED) });
    expect(wrong.ok === false && wrong.failed).toBe('chain receipt');
    const reverted = receiptOf(RELEASED);
    reverted.result.status = '0x0';
    expect((await checkBundle(bundleOf(RELEASED), { receipt: reverted })).ok).toBe(false);
  });
  it('runs as a command: exit 0 on the real bundle, 1 on a changed one, 2 on a wrong call', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'evidence-'));
    const good = join(dir, 'good.json');
    const bad = join(dir, 'bad.json');
    writeFileSync(good, JSON.stringify(bundleOf(RELEASED)));
    const b = bundleOf(RELEASED);
    b.terms.price.amount = '41000000';
    writeFileSync(bad, JSON.stringify(b));
    const out: string[] = [];
    const io = { out: (s: string) => out.push(s), err: (s: string) => out.push(s) };
    expect(await main(['check', good], io)).toBe(0);
    expect(await main(['check', bad], io)).toBe(1);
    expect(out.at(-1)).toMatch(/^FAILED {2}terms hash to the commitment ID/);
    expect(await main(['check'], io)).toBe(2);
    expect(await main(['check', good, '--receipts', good], io)).toBe(2);
    expect(await main(['--help'], io)).toBe(0);
  });
});

describe('attacks the check must refuse', () => {
  it('one changed value anywhere in the bundle: every leaf and every key', async () => {
    const base = bundleOf(RELEASED);
    // Each mutation changes what a value means: a hex digit to another digit, a character, a number, a boolean.
    // Changes that leave every value the same (whitespace, the letter case of hex) are the same record.
    const mutate = (v: J): J => {
      if (v === null) return 0;
      if (typeof v === 'boolean') return !v;
      if (typeof v === 'number') return v + 1;
      if (typeof v === 'string') {
        const i = v.startsWith('0x') && v.length > 2 ? 2 + Math.floor((v.length - 2) / 2) : Math.floor(v.length / 2);
        const ch = v[i] ?? '';
        const next = /[0-9a-fA-F]/.test(ch) ? (parseInt(ch, 16) ^ 1).toString(16) : ch === 'x' ? 'y' : String.fromCharCode((ch.charCodeAt(0) || 64) + 1);
        return v.length ? v.slice(0, i) + next + v.slice(i + 1) : 'x';
      }
      return v;
    };
    const paths: Array<{ path: Array<string | number>; key: boolean }> = [];
    const walk = (v: J, path: Array<string | number>) => {
      if (v && typeof v === 'object') {
        for (const [key, x] of Object.entries(v)) {
          const p = [...path, Array.isArray(v) ? Number(key) : key];
          if (!Array.isArray(v)) paths.push({ path: p, key: true });
          walk(x, p);
        }
      } else paths.push({ path, key: false });
    };
    walk(base, []);
    const passedWrongly: string[] = [];
    for (const { path, key } of paths) {
      const b = clone(base);
      let parent: J = b;
      for (const p of path.slice(0, -1)) parent = parent[p];
      const last = path.at(-1)!;
      if (key) {
        parent[mutate(String(last))] = parent[last];
        delete parent[last];
      } else parent[last] = mutate(parent[last]);
      if ((await checkBundle(b)).ok) passedWrongly.push(`${key ? 'key ' : ''}${path.join('.')}`);
    }
    expect(paths.length).toBeGreaterThan(300);
    expect(passedWrongly).toEqual([]);
  }, 300_000);

  it('a signature from the wrong key, in the record and in the calldata', async () => {
    const thief = privateKeyToAccount(generatePrivateKey());
    // The judgment record signed by another key over the same record hash.
    const b1 = bundleOf(RELEASED);
    b1.judgment.signature = await thief.signMessage({ message: { raw: b1.judgment.recordHash } });
    await failsAt(b1, "adjudicator's signature on the judgment record");
    // An operator receipt signed by another key.
    const b2 = bundleOf(RELEASED);
    b2.receipts[0].signature = b1.judgment.signature;
    await failsAt(b2, 'operator receipts');
    // The buyer's agreement signed by another key, in a transaction the attacker built and its own operator recorded.
    const b3 = bundleOf(RELEASED);
    const { tx, call } = callIn(b3, 'hold.funded');
    const [t, sellerSig, acc, ag, f] = call.args;
    await swapCall(b3, tx, 'agreeAndFund', [t, sellerSig, acc, { ...ag, signature: await thief.signMessage({ message: 'not the buyer' }) }, f]);
    await failsAt(await reseal(b3), "buyer's agreement");
  });

  it('a receipt from another deal placed in this bundle', async () => {
    const b = bundleOf(RELEASED);
    const other = bundleOf(REFUNDED).receipts[0];
    b.receipts[0] = other; // a genuine receipt, signed by the same operator, for another deal's event
    await failsAt(b, 'operator receipts');
    const b2 = bundleOf(RELEASED);
    b2.receipts[0] = { ...other, eventSeq: b2.receipts[0].eventSeq };
    await failsAt(b2, 'receipts name this commitment');
  });

  it("a decision that does not match the terms' hash", async () => {
    const other = bundleOf(REFUNDED);
    const theirs = callIn(other, 'judgment.decided');
    // (a) Another deal's genuine decide transaction, the adjudicator's real signature, recorded by the attacker's operator.
    const a = bundleOf(RELEASED);
    const ours = callIn(a, 'judgment.decided');
    const raw = other.transactions[theirs.tx];
    delete a.transactions[ours.tx];
    a.transactions[theirs.tx] = raw;
    for (const e of a.events) if (e.payload?.tx === ours.tx) e.payload.tx = theirs.tx;
    await failsAt(await reseal(a), 'judgment.decided transaction is for these terms');
    // (b) That deal's signed decision inside a call with this deal's terms: signed over another commitment ID.
    const b = bundleOf(RELEASED);
    const mine = callIn(b, 'judgment.decided');
    const [t, , dv, sig] = mine.call.args;
    const [, m] = theirs.call.args;
    await swapCall(b, mine.tx, 'decide', [t, { ...m, deliveryHash: mine.call.args[1].deliveryHash, judgmentRecordHash: mine.call.args[1].judgmentRecordHash }, dv, sig]);
    await failsAt(await reseal(b), "adjudicator's signature on the decision");
    // (c) This deal's own decision with the outcome flipped.
    const c = bundleOf(RELEASED);
    const own = callIn(c, 'judgment.decided');
    const [tc, mc, dvc, sc] = own.call.args;
    await swapCall(c, own.tx, 'decide', [tc, { ...mc, outcome: 1 }, dvc, sc]);
    await failsAt(await reseal(c), "adjudicator's signature on the decision");
    // (d) Another deal's genuinely signed judgment record in place of this one's.
    const d = bundleOf(RELEASED);
    d.judgment = other.judgment;
    await failsAt(d, 'judgment record hash');
  });

  // The red team's findings (T-511 review): each now fails.
  it('a term nobody signed, in a field the commitment ID ignores', async () => {
    for (const add of [(t: J) => (t.note = 'Released: 1000.00 tUSDC paid'), (t: J) => (t.timing.disputeBy = '2099-01-01T00:00:00Z'), (t: J) => (t.price.decimals = 0), (t: J) => (t.adjudication.fee.note = 'x')]) {
      const b = bundleOf(RELEASED);
      add(b.terms);
      await failsAt(b, 'terms carry only signed fields');
    }
  });
  it('a value that cannot be read fails the check instead of crashing it', async () => {
    const b = bundleOf(RELEASED);
    b.events.find((e: J) => e.type === 'adjudicator.accepted').payload.acceptance.expiresAt = 'not a date';
    await failsAt(await reseal(b), 'well-formed bundle');
    const receipt = receiptOf(RELEASED);
    receipt.result.logs.unshift(null);
    expect((await checkBundle(bundleOf(RELEASED), { receipt })).ok).toBe(true);
    delete receipt.result.blockNumber;
    const r = await checkBundle(bundleOf(RELEASED), { receipt });
    expect(r.ok === false && r.failed).toBe('chain receipt');
  });
  it('a chain receipt that pays someone else', async () => {
    for (const name of [RELEASED, REFUNDED]) {
      const receipt = receiptOf(name);
      const sig = name === RELEASED ? 'PaymentReleased' : 'Refunded';
      const topic = keccak256(new TextEncoder().encode(`${sig}(bytes32,address,uint256)`));
      const log = receipt.result.logs.find((l: J) => l.topics[0] === topic);
      log.topics[2] = `0x${'00'.repeat(12)}${'aa'.repeat(20)}`;
      const r = await checkBundle(bundleOf(name), { receipt });
      expect(r.ok === false && r.failed, name).toBe('chain receipt records the payment');
    }
  });
  it('a made-up HOLDBACK_DEPLOYMENT does not make real signatures pass, and the pinned case prints no caller-pin note', async () => {
    const file = JSON.parse(readFileSync(new URL('../contracts/deployments/sepolia.json', import.meta.url), 'utf8'));
    vi.stubEnv('HOLDBACK_DEPLOYMENT', JSON.stringify({ ...file, rules: `0x${'22'.repeat(20)}` }));
    try {
      const b = bundleOf(RELEASED);
      b.operator.domain.verifyingContract = `0x${'22'.repeat(20)}`;
      const r = await checkBundle(b);
      expect(r.ok).toBe(false); // real signatures do not recover under another domain
      expect((await checkBundle(bundleOf(RELEASED))).lines.join('\n')).not.toContain('HOLDBACK_DEPLOYMENT. This command does not pin it');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('an unpinned settlement layer', async () => {
    const b = bundleOf(RELEASED);
    b.operator.domain.verifyingContract = `0x${'11'.repeat(20)}`;
    await failsAt(b, 'pinned settlement layer');
  });
});

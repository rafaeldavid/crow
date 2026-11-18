// T-543: the work API a folder that sells from a template serves on the loopback address, and the template's reader.
import { execFileSync } from 'node:child_process';
import { linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DELIVERY_CAP_BYTES } from './seller-adapter-api.ts';
import { DEFAULT_DELIVER_WITHIN_SEC, hiddenCharacters, keyFileOf, readWorkFile, readWorkTemplate, refuseEnvFile, readyPath, startWorkApi, TEMPLATE_EXAMPLE, workAddresses, workFor, workPath, type WorkApi } from './setup-work-api.ts';

const ID = `0x${'ab'.repeat(32)}`;
const OTHER = `0x${'cd'.repeat(32)}`;
const CREDENTIAL = 'a-credential-of-this-run-only';
const fresh = () => realpathSync(mkdtempSync(join(tmpdir(), 'crow-work-api-')));
let api: WorkApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});
const start = async (folder: string) => (api = await startWorkApi({ token: 'tUSD', price: '5000000', folder, format: 'text/csv', credential: CREDENTIAL }));
const auth = { authorization: `Bearer ${CREDENTIAL}` };

describe('the work API (T-543)', () => {
  it('answers no call without the run\'s credential: another account on this machine reads no work through the port', async () => {
    const folder = fresh();
    mkdirSync(join(folder, 'work'));
    writeFileSync(workPath(folder, ID, 'text/csv'), 'name,url\na,b\n');
    const { url } = await start(folder);
    for (const headers of [{}, { authorization: 'Bearer wrong' }, { authorization: CREDENTIAL }]) {
      expect((await fetch(`${url}/jobs/${ID}/result`, { headers })).status).toBe(401);
      expect((await fetch(`${url}/quote`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{"scope":{}}' })).status).toBe(401);
    }
    const res = await fetch(`${url}/jobs/${ID}/result`, { headers: auth });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('name,url\na,b\n');
  });

  it('quotes the template\'s fixed price for an empty scope, and the job\'s ID is the commitment ID', async () => {
    const { url } = await start(fresh());
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${url}${path}`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const quote = await post('/quote', { scope: {} });
    expect([quote.status, await quote.json()]).toEqual([200, { quoteId: 'template', price: { token: 'tUSD', amount: '5000000' } }]);
    expect((await post('/quote', { scope: { rows: 5 } })).status).toBe(400);
    const job = await post('/jobs', { commitmentId: ID, quoteId: 'template', scope: {} }, { 'idempotency-key': ID });
    expect([job.status, await job.json()]).toEqual([200, { jobId: ID }]);
    expect((await post('/jobs', { commitmentId: ID })).status).toBe(400); // no Idempotency-Key
    expect((await post('/jobs', { commitmentId: '../../keys/signing.key' }, { 'idempotency-key': 'x' })).status).toBe(400);
  });

  it('answers 202 until the deal\'s work is in work/, then its bytes; a job ID that is no commitment ID names no file', async () => {
    const folder = fresh();
    const { url } = await start(folder);
    const result = (id: string) => fetch(`${url}/jobs/${id}/result`, { headers: auth });
    expect((await result(ID)).status).toBe(202); // no work/ at all
    mkdirSync(join(folder, 'work'));
    expect((await result(ID)).status).toBe(202);
    writeFileSync(workPath(folder, OTHER, 'text/csv'), 'another deal\'s work');
    expect((await result(ID)).status).toBe(202); // another deal's file is not this deal's
    writeFileSync(workPath(folder, ID, 'text/csv'), 'name,url\n');
    const done = await result(ID);
    expect([done.status, done.headers.get('content-type'), await done.text()]).toEqual([200, 'text/csv', 'name,url\n']);
    for (const id of ['..%2F..%2Fkeys%2Fsigning.key', 'ready', `${ID}.csv`, ID.toUpperCase()]) expect((await result(id)).status).toBe(404);
  });

  it('the finished work of --file is every deal\'s work until the deal has a file of its own', async () => {
    const folder = fresh();
    mkdirSync(join(folder, 'work'));
    writeFileSync(readyPath(folder, 'text/csv'), 'ready');
    expect(workFor(folder, ID, 'text/csv')).toMatchObject({ path: workPath(folder, ID, 'text/csv'), from: readyPath(folder, 'text/csv') });
    expect(Buffer.from(workFor(folder, ID, 'text/csv').bytes!).toString()).toBe('ready');
    writeFileSync(workPath(folder, ID, 'text/csv'), 'its own');
    expect(Buffer.from(workFor(folder, ID, 'text/csv').bytes!).toString()).toBe('its own');
    expect(Buffer.from(workFor(folder, OTHER, 'text/csv').bytes!).toString()).toBe('ready');
  });

  it('work that is a symbolic link, empty, over 1 MiB or no plain file is not delivered, and the reason names the limit', async () => {
    const folder = fresh();
    mkdirSync(join(folder, 'work'));
    const path = workPath(folder, ID, 'text/csv');
    const { url } = await start(folder);
    const status = async () => (await fetch(`${url}/jobs/${ID}/result`, { headers: auth })).status;
    const secret = join(folder, 'secret.txt');
    writeFileSync(secret, 'not work');
    symlinkSync(secret, path);
    expect(workFor(folder, ID, 'text/csv')).toMatchObject({ problem: expect.stringMatching(/is a symbolic link/) });
    expect(workFor(folder, ID, 'text/csv').bytes).toBeUndefined();
    expect(await status()).toBe(202);
    rmSync(path);
    writeFileSync(path, '');
    expect(workFor(folder, ID, 'text/csv').problem).toMatch(/is empty/);
    writeFileSync(path, Buffer.alloc(DELIVERY_CAP_BYTES + 1, 'a'));
    expect(workFor(folder, ID, 'text/csv').problem).toMatch(/is 1,048,577 bytes: a delivery is CSV, JSON, plain text or Markdown .* at most 1,048,576 bytes \(1 MiB\)/);
    expect(await status()).toBe(202);
    writeFileSync(path, Buffer.alloc(DELIVERY_CAP_BYTES, 'a'));
    expect(workFor(folder, ID, 'text/csv').bytes?.length).toBe(DELIVERY_CAP_BYTES);
    expect(await status()).toBe(200);
    rmSync(path);
    mkdirSync(path);
    expect(workFor(folder, ID, 'text/csv').problem).toMatch(/is not a plain file/);
    // work/ itself behind a link: nothing under it is read.
    const linked = fresh();
    mkdirSync(join(linked, 'elsewhere'));
    writeFileSync(join(linked, 'elsewhere', `${ID}.csv`), 'x');
    symlinkSync(join(linked, 'elsewhere'), join(linked, 'work'));
    expect(workFor(linked, ID, 'text/csv')).toMatchObject({ problem: expect.stringMatching(/work\/ is a symbolic link/) });
    expect(() => workFor(folder, '../x', 'text/csv')).toThrow();
  });

  it('red team (T-543): a hard link, the key file under any name, and a FIFO are never served, and nothing blocks', async () => {
    const folder = fresh();
    mkdirSync(join(folder, 'work'));
    mkdirSync(join(folder, 'keys'));
    writeFileSync(keyFileOf(folder), `0x${'11'.repeat(32)}\n`);
    const outside = join(fresh(), 'outside.csv');
    writeFileSync(outside, 'not this deal\'s work');
    linkSync(outside, workPath(folder, ID, 'text/csv'));
    expect(workFor(folder, ID, 'text/csv')).toMatchObject({ problem: expect.stringMatching(/has a second hard link/) });
    rmSync(workPath(folder, ID, 'text/csv'));
    linkSync(keyFileOf(folder), readyPath(folder, 'text/csv'));
    expect(workFor(folder, ID, 'text/csv').bytes).toBeUndefined();
    expect(workFor(folder, ID, 'text/csv').problem).toMatch(/signing key|second hard link/);
    // A path the person names may be a link, and is still never the key, in any letter case.
    // On a disk where letter case matters (Linux) that path is not there; where it does not (macOS) it is the key.
    const upper = readWorkFile(join(folder, 'KEYS', 'signing.key'), true, keyFileOf(folder));
    expect(upper?.bytes).toBeUndefined();
    if (upper !== undefined) expect(upper.problem).toMatch(/is the folder's signing key/);
    const link = join(folder, 'innocent.csv');
    symlinkSync(keyFileOf(folder), link);
    expect(readWorkFile(link, true, keyFileOf(folder))?.problem).toMatch(/is the folder's signing key/);
    rmSync(readyPath(folder, 'text/csv'));
    const fifo = workPath(folder, ID, 'text/csv');
    execFileSync('mkfifo', [fifo]);
    const began = Date.now();
    expect(workFor(folder, ID, 'text/csv').problem).toMatch(/is not a plain file/);
    expect(readWorkFile(fifo, true)?.problem).toMatch(/is not a plain file/);
    expect(Date.now() - began).toBeLessThan(1000);
  });

  it('the addresses are one loopback port, under one base URL, with the credential\'s variable', () => {
    expect(workAddresses(4321)).toEqual({ baseUrl: 'http://127.0.0.1:4321/', auth: { env: 'CROW_SETUP_WORK', header: 'authorization', prefix: 'Bearer ' }, quote: 'http://127.0.0.1:4321/quote', start: 'http://127.0.0.1:4321/jobs', result: 'http://127.0.0.1:4321/jobs/{jobId}/result' });
  });
});

describe('a template, as the person writes it (T-543)', () => {
  const write = (value: unknown, name = 'template.json') => {
    const file = join(fresh(), name);
    writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
    return file;
  };
  const good = JSON.parse(TEMPLATE_EXAMPLE);

  it('takes the example the command prints, and the work is due in 23 hours when it names no window', () => {
    expect(readWorkTemplate(write(good))).toEqual(good);
    expect(readWorkTemplate(write({ ...good, deliverWithinSec: undefined })).deliverWithinSec).toBe(DEFAULT_DELIVER_WITHIN_SEC);
    expect(DEFAULT_DELIVER_WITHIN_SEC).toBeLessThan(86_400); // Crow's test buyer takes work due within 86,400 s of the post
  });

  it('takes any window and price the encoding holds (D31): a year, zero, a price of 78 digits', () => {
    expect(readWorkTemplate(write({ ...good, deliverWithinSec: 31_536_000 })).deliverWithinSec).toBe(31_536_000);
    expect(readWorkTemplate(write({ ...good, deliverWithinSec: 0 })).deliverWithinSec).toBe(0);
    expect(readWorkTemplate(write({ ...good, price: '9'.repeat(78) })).price).toBe('9'.repeat(78));
    expect(readWorkTemplate(write({ ...good, checks: [] })).checks).toEqual([]);
  });

  it('refuses what cannot become an offer, each by name', () => {
    const refused: Array<[unknown, RegExp]> = [
      ['not json', /is not JSON/],
      [[good], /must hold one JSON object/],
      [{ ...good, rubric: {} }, /a field this version does not take: rubric/],
      [{ ...good, price: 5 }, /price must be base units/],
      [{ ...good, price: '5.00' }, /price must be base units/],
      [{ ...good, price: '05' }, /price must be base units/],
      [{ ...good, deliverWithinSec: 1.5 }, /deliverWithinSec must be a whole number/],
      [{ ...good, deliverWithinSec: -1 }, /deliverWithinSec must be a whole number/],
      [{ ...good, checks: {} }, /checks must be a list/],
      [{ ...good, deliverable: { ...good.deliverable, format: 'application/pdf' } }, /application\/pdf is none a delivery can have: a delivery is CSV, JSON, plain text or Markdown .* at most 1,048,576 bytes/],
      [{ ...good, deliverable: { kind: 'dataset', format: 'text/csv' } }, /needs deliverable/],
      [{ ...good, deliverable: { ...good.deliverable, description: 'the {{rows}} rows' } }, /starts a placeholder/],
    ];
    for (const [value, why] of refused) expect(() => readWorkTemplate(write(value)), JSON.stringify(value)).toThrow(why);
    expect(readWorkTemplate(write({ ...good, deliverable: { ...good.deliverable, description: 'the text \\{{rows}}' } })).deliverable.description).toBe('the text \\{{rows}}');
    expect(() => readWorkTemplate(join(fresh(), 'missing.json'))).toThrow(/is not there/);
    expect(() => readWorkTemplate(write('x'.repeat(65_537)))).toThrow(/a template is at most 65536/);
  });

  it('reads no environment file, whatever it holds, by its name or through a link (red team, T-543)', () => {
    for (const name of ['.env', '.env.local', '.ENV.production']) expect(() => readWorkTemplate(write(good, name))).toThrow(/an environment file: the setup reads no \.env file/);
    const dir = fresh();
    writeFileSync(join(dir, '.env'), 'STAND_IN=not-a-secret');
    symlinkSync(join(dir, '.env'), join(dir, 'work.csv'));
    expect(() => refuseEnvFile(join(dir, 'work.csv'), '--file')).toThrow(/--file names \.env through a link, an environment file/);
    symlinkSync(join(dir, '.env'), join(dir, 'template.json'));
    expect(() => readWorkTemplate(join(dir, 'template.json'))).toThrow(/through a link, an environment file/);
  });

  it('a FIFO named as the template is refused at once, never read until it ends (red team, T-543)', () => {
    const fifo = join(fresh(), 'template.json');
    execFileSync('mkfifo', [fifo]);
    expect(() => readWorkTemplate(fifo)).toThrow(/is not a plain file/);
  });

  it('counts characters a person does not see in the deliverable and the checks: advice only', () => {
    expect(hiddenCharacters(good)).toBe(0);
    expect(hiddenCharacters({ ...good, deliverable: { ...good.deliverable, description: 'safe\u202e\u{e0041}\u{e0042}' } })).toBe(3);
    expect(readWorkTemplate(write({ ...good, deliverable: { ...good.deliverable, description: 'safe\u200b' } })).deliverable.description).toBe('safe\u200b');
  });
});

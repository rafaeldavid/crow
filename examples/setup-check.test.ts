// T-486: the secrets check and a file another run removes while it works. CI failed T-472's "eight runs at once" test
// when one run's check listed the folder, another run removed its crow.lock, and the read of that file threw. These
// tests make the file vanish at a chosen step through scanFiles' file-system seam, so they need no race to show it.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { scanFiles, writeWhole, type ScanIo, type WriteIo } from './setup-check.ts';

const dir = mkdtempSync(join(tmpdir(), 'crow-scan-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// A value to look for, made at run time: the check reads files for it as it reads them for a key.
const secret = randomBytes(32).toString('hex');
const at = (name: string, text: string) => {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
};
const real: ScanIo = { size: (p) => statSync(p).size, read: (p) => readFileSync(p, 'latin1') };
const missing = (p: string) => Object.assign(new Error(`ENOENT: no such file or directory, open '${p}'`), { code: 'ENOENT' });

describe('the secrets check, with a file that vanishes', () => {
  it('passes over a file that is gone before its size is read, and counts it', () => {
    const files = [at('crow.json', '{}'), at('crow.lock', '1234'), at('adapter.json', '{}')];
    const io: ScanIo = { ...real, size: (p) => (p.endsWith('crow.lock') ? (() => { throw missing(p); })() : real.size(p)) };
    expect(scanFiles(files, [secret], io)).toEqual({ read: 2, large: [], gone: 1 });
  });

  it('passes over a file that is gone between its size and its read', () => {
    const files = [at('journal.json', '{}'), at('lock-tmp', '1234')];
    const io: ScanIo = { ...real, read: (p) => (p.endsWith('lock-tmp') ? (() => { throw missing(p); })() : real.read(p)) };
    expect(scanFiles(files, [secret], io)).toEqual({ read: 1, large: [], gone: 1 });
  });

  it('still fails on a file outside keys/ that holds a key, with another file gone beside it', () => {
    const files = [at('crow.lock', '1234'), at('notes.txt', `copied by mistake: ${secret}\n`)];
    const io: ScanIo = { ...real, size: (p) => (p.endsWith('crow.lock') ? (() => { throw missing(p); })() : real.size(p)) };
    expect(() => scanFiles(files, [secret], io)).toThrow(/notes\.txt holds a key's value/);
  });

  it('still fails on a key in crow.lock itself: no file name is left out of the scan', () => {
    const files = [at('crow.lock', secret)];
    expect(() => scanFiles(files, [secret], real)).toThrow(/crow\.lock holds a key's value/);
  });

  it('still fails on any other error than a missing file', () => {
    const files = [at('adapter.json', '{}')];
    const denied = (p: string) => Object.assign(new Error(`EACCES: permission denied, open '${p}'`), { code: 'EACCES' });
    const io: ScanIo = { ...real, read: (p) => { throw denied(p); } };
    expect(() => scanFiles(files, [secret], io)).toThrow(/EACCES/);
  });
});

// T-486: the second race CI found in "eight runs at once": one run's check read sample/terms.json while another run was
// writing it. The check now writes each sample file whole: to a name of its own, then renamed into place.
describe('the check writes its sample files whole', () => {
  it('writes to a temporary name beside the file and renames it into place, never writing the file itself', () => {
    const steps: string[][] = [];
    const io: WriteIo = { write: (p) => void steps.push(['write', p]), rename: (a, b) => void steps.push(['rename', a, b]) };
    const path = join(dir, 'sample-terms.json');
    writeWhole(path, '{}', io);
    expect(steps.length).toBe(2);
    expect(steps[0]![0]).toBe('write');
    expect(steps[0]![1]).not.toBe(path);
    expect(steps[0]![1]!.startsWith(`${path}.`)).toBe(true);
    expect(steps[1]).toEqual(['rename', steps[0]![1], path]);
  });

  it('gives two writes of one file two temporary names, so two runs never share one', () => {
    const names: string[] = [];
    const io: WriteIo = { write: (p) => void names.push(p), rename: () => undefined };
    writeWhole(join(dir, 'x.json'), '{}', io);
    writeWhole(join(dir, 'x.json'), '{}', io);
    expect(new Set(names).size).toBe(2);
  });

  it('leaves the whole content and no temporary file behind on the real file system', () => {
    const path = join(dir, 'whole.json');
    writeWhole(path, '{"a":1}\n');
    expect(readFileSync(path, 'utf8')).toBe('{"a":1}\n');
    expect(readdirSync(dir).filter((n) => n.startsWith('whole.json.'))).toEqual([]);
  });
});

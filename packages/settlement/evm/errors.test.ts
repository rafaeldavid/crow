import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeErrorResult, parseAbi } from 'viem';
import { describe, expect, it } from 'vitest';
import { BEACON_ERRORS, BY_NAME, problemFromRevert, revertData, revertName } from './errors.js';

const abi = parseAbi([
  'error WrongStage(uint8 current)',
  'error BadSignature()',
  'error DeadlinePassed()',
  'error MessageExpired()',
  'error TooEarly()',
  'error BadSeed()',
  'error InvalidMessage()',
  'error InsufficientBalance()',
  'error Error(string)',
]);
const data = (errorName: string, args: unknown[] = []) => encodeErrorResult({ abi, errorName, args } as Parameters<typeof encodeErrorResult>[0]);

describe('contract reverts as SimChain problem types', () => {
  it.each([
    ['WrongStage', [1], 'invalid_state'],
    ['BadSignature', [], 'invalid_signature'],
    ['DeadlinePassed', [], 'deadline_passed'],
    ['MessageExpired', [], 'deadline_passed'],
    ['TooEarly', [], 'invalid_state'],
    ['BadSeed', [], 'seed_mismatch'],
    ['InvalidMessage', [], 'invalid_terms'],
    ['InsufficientBalance', [], 'insufficient_funds'],
  ])('%s -> %s', (name, args, type) => {
    expect(problemFromRevert(abi, data(name, args)).type).toBe(type);
  });

  it('maps token revert strings', () => {
    expect(problemFromRevert(abi, data('Error', ['MockERC3009: invalid signature'])).type).toBe('invalid_signature');
    expect(problemFromRevert(abi, data('Error', ['MockERC3009: authorization is used'])).type).toBe('nonce_reused');
    expect(problemFromRevert(abi, data('Error', ['MockERC3009: authorization expired'])).type).toBe('deadline_passed');
  });

  it('never throws on unknown data', () => {
    expect(problemFromRevert(abi, '0xdeadbeef').type).toBe('invalid_state');
    expect(problemFromRevert(abi, undefined).type).toBe('invalid_state');
    expect(revertName(abi, '0xdeadbeef')).toBeUndefined();
    expect(revertName(abi, undefined)).toBeUndefined();
  });

  it('names the contract error', () => {
    expect(revertName(abi, data('InvalidMessage'))).toBe('InvalidMessage');
    expect(revertName(abi, data('WrongStage', [1]))).toBe('WrongStage');
  });

  it('finds revert data nested in a client error', () => {
    expect(revertData({ cause: { cause: { data: '0x1234' } } })).toBe('0x1234');
    expect(revertData({ error: { data: { data: '0xabcd' } } })).toBe('0xabcd');
  });
});

// HoldbackRules calls the beacon, and the beacon's revert reaches the relay unchanged; the ABI the relay passes has
// no beacon in it (T-540).
describe("the beacon's errors through the rules contract's ABI", () => {
  const beacon = (errorName: string) => encodeErrorResult({ abi: BEACON_ERRORS, errorName } as Parameters<typeof encodeErrorResult>[0]);

  it.each([
    ['NotEnoughGas', 'invalid_state'],
    ['PairingGasBelowFloor', 'invalid_state'],
    ['InvalidSignature', 'invalid_signature'],
  ])('%s is named and maps to %s', (name, type) => {
    const p = problemFromRevert(abi, beacon(name));
    expect(p.type).toBe(type);
    expect(p.detail).toBe(`contract revert ${name}()`);
    expect(revertName(abi, beacon(name))).toBe(name);
  });

  const built = join(import.meta.dirname, '..', '..', '..', 'contracts', 'out', 'DrandQuicknetBeacon.sol', 'DrandQuicknetBeacon.json');
  it.skipIf(!existsSync(built))(`names every error the built beacon declares${existsSync(built) ? '' : ' (SKIPPED: needs forge build output in contracts/out)'}`, () => {
    type Item = { type: string; name?: string; inputs?: ReadonlyArray<{ type: string }> };
    const sig = (e: Item) => `${e.name}(${(e.inputs ?? []).map((i) => i.type).join(',')})`;
    const declared = (JSON.parse(readFileSync(built, 'utf8')).abi as Item[]).filter((x) => x.type === 'error').map(sig);
    expect(declared.length).toBeGreaterThan(0);
    expect((BEACON_ERRORS as readonly Item[]).map(sig)).toEqual(expect.arrayContaining(declared));
    // And each has its problem type by name: without one it would decode, then fall back to invalid_state (T-559).
    const names = (JSON.parse(readFileSync(built, 'utf8')).abi as Item[]).filter((x) => x.type === 'error').map((e) => e.name!);
    expect(names.filter((n) => !Object.hasOwn(BY_NAME, n))).toEqual([]);
  });

  it('gives every error in the list its problem type by name, with or without a build (T-559)', () => {
    const names = (BEACON_ERRORS as ReadonlyArray<{ type: string; name?: string }>).filter((x) => x.type === 'error').map((e) => e.name!);
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((n) => !Object.hasOwn(BY_NAME, n))).toEqual([]);
  });
});

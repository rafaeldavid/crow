// T-549 (ADR-0040 §5, D84): SimChain applies the contract-signer rule to a seller that is a contract. Its contract
// accounts (genesis.contracts) answer ERC-1271 as their kind says; here a wallet owned by the seller's key, as the test
// wallet SwitchWallet answers. The seller's offer, delivery and settlement are all read through it; without the account
// in the table the same signatures do not recover to the seller's address and are refused.
import { describe, expect, it } from 'vitest';
import type { Address } from '@holdback/core';
import type { Submission, SubmitResult } from '../src/interface.js';
import { MAX_PARTY_SIGNATURE_BYTES } from '../src/util.js';
import { Deal, simActor, simCast, simClub, simGenesis, type Cast } from './actors.js';
import { SimChain } from './simchain.js';

const START = '2026-11-01T09:00:00Z';
const WALLET: Address = '0x00000000000000000000000000000000000c0de1';

async function world(withContract: boolean) {
  const base = simCast('contract-signers');
  // The seller's address is the wallet; the seller's key signs for it.
  const cast: Cast = { ...base, seller: { ...base.seller, address: WALLET } };
  const club = simClub(simActor('club-operator').address);
  const genesis = await simGenesis({ cast, club, start: START, balances: { buyer: 10_000_000_000n }, bonds: { primary: 25_000_000_000n, fallback: 25_000_000_000n, appeal: 25_000_000_000n } });
  const chain = new SimChain(withContract ? { ...genesis, contracts: [{ address: WALLET, kind: 'wallet', owner: base.seller.address }] } : genesis);
  const submit = async (s: Submission | Promise<Submission>): Promise<SubmitResult> => chain.submit(await s, { via: 'op-1' });
  const ok = async (s: Submission | Promise<Submission>) => {
    const r = await submit(s);
    if (!r.ok) throw new Error(`refused: ${r.problem.type}: ${r.problem.detail}`);
    chain.advance(1);
    return r;
  };
  return { chain, cast, club, submit, ok };
}

describe('SimChain contract accounts (T-549)', () => {
  it("reads a contract seller's offer, delivery and acceptance through its wallet, and pays its address", async () => {
    const { chain, cast, club, ok } = await world(true);
    const d = new Deal(chain, cast, { club });
    await ok(d.offer());
    await ok(d.accept());
    await ok(d.agreeAndFund());
    await ok(d.deliver());
    const r = await ok(d.decide('primary', 'accept'));
    expect(r.state.escrowState).toBe('Released');
    expect((await chain.balances([WALLET]))[WALLET]!.amount).toBe(d.terms.price.amount);
  });

  it("reads a contract seller's half of a settlement by agreement", async () => {
    const { chain, cast, club, ok } = await world(true);
    const d = new Deal(chain, cast, { club, tag: 'mutual' });
    await ok(d.offer());
    await ok(d.accept());
    await ok(d.agreeAndFund());
    const r = await ok(d.mutual());
    expect(r.state.escrowState).toBe('Settled');
  });

  it('refuses the same seller signatures when the address is not a contract account', async () => {
    const { chain, cast, club, submit } = await world(false);
    const d = new Deal(chain, cast, { club });
    const r = await submit(d.offer());
    expect(r.ok ? 'ok' : [r.problem.type, r.problem.detail]).toEqual(['invalid_signature', 'the seller did not sign these terms']);
  });

  it('refuses a party signature above the relay limit as payload_too_large, and checks one at the limit', async () => {
    const { chain, cast, club, submit } = await world(true);
    const d = new Deal(chain, cast, { club, tag: 'long' });
    const offer = await d.offer();
    if (offer.kind !== 'offer') throw new Error('unreachable');
    const at = (bytes: number) => submit({ ...offer, commitment: { ...offer.commitment, signatures: { seller: `0x${'ab'.repeat(bytes)}` } } });
    const over = await at(MAX_PARTY_SIGNATURE_BYTES + 1);
    expect(over.ok ? 'ok' : over.problem.type).toBe('payload_too_large');
    const limit = await at(MAX_PARTY_SIGNATURE_BYTES);
    expect(limit.ok ? 'ok' : limit.problem.type).toBe('invalid_signature');
  });

  it("refuses a contract seller's offer signed by another key", async () => {
    const { chain, cast, club, submit } = await world(true);
    const d = new Deal(chain, { ...cast, seller: { ...cast.seller, key: simActor('impostor').key } }, { club });
    const r = await submit(d.offer());
    expect(r.ok ? 'ok' : r.problem.type).toBe('invalid_signature');
  });
});

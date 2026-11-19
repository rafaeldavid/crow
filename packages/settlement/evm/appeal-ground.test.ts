// T-559: a primary's or a fallback's decision that carries an appeal ground is refused with core's own reason, before
// the relay simulates it. Before, the refusal was the bare `contract revert InvalidMessage()`. The deployed contract
// reverts every such decision (HoldbackRules._firstInstance: appealGroundHash must be keccak256("")), and the schema
// allows only non-empty grounds, so the early refusal turns away nothing the contract accepts. The appeal role's ground
// keeps T-540's reason (phaseOneDecisionProblem).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { APPEAL_GROUND_APPEAL_ONLY, type Decision } from '@holdback/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Submission } from '../src/interface.js';
import type { EvmSettlement } from './evm-settlement.js';
import { must, newSettlement } from './gas.js';
import { EvmDeal, type EvmCast } from './testing.js';
import { anvilAvailable, EvmWorld } from './world.js';

const root = join(import.meta.dirname, '..', '..', '..');
const ready = anvilAvailable() && existsSync(join(root, 'contracts', 'out', 'HoldbackRules.sol', 'HoldbackRules.json'));

describe.skipIf(!ready)(`a first decider's appeal ground on anvil (T-559)${ready ? '' : ' (SKIPPED: needs anvil on PATH and forge build output in contracts/out)'}`, () => {
  let world: EvmWorld;
  beforeAll(async () => {
    world = await EvmWorld.start(root);
  }, 60_000);
  afterAll(async () => {
    await world?.stop();
  });

  const funded = async (chain: EvmSettlement, cast: EvmCast, club: Awaited<ReturnType<typeof newSettlement>>['club'], tag: string) => {
    const d = new EvmDeal(chain, cast, club, tag);
    for (const sub of [d.offer(), d.accept(), d.agreeAndFund()]) await must(chain, cast, await sub);
    return d;
  };
  /** The refusal, and the transactions it sent (none, when refused before the simulation). */
  const refused = async (chain: EvmSettlement, s: Submission, key: Parameters<EvmSettlement['submit']>[1]) => {
    const before = chain.transactions().length;
    const r = await chain.submit(s, key);
    return { problem: r.ok ? null : { type: r.problem.type, detail: r.problem.detail }, sent: chain.transactions().slice(before).map((t) => t.call) };
  };
  const named = { type: 'invalid_terms', detail: APPEAL_GROUND_APPEAL_ONLY };

  it("refuses a primary's decision with an appeal ground by core's reason, on a posted and on a carried delivery", async () => {
    const { chain, cast, club } = await newSettlement(world);
    // Posted: the accept is refused and nothing is sent; the same decision without a ground then lands.
    const posted = await funded(chain, cast, club, 'ground-posted');
    await must(chain, cast, posted.deliver());
    const a = await refused(chain, await posted.decide('primary', 'accept', undefined, { appealGround: 'wrong-outcome' }), { sender: cast.primary.key });
    expect(a).toEqual({ problem: named, sent: [] });
    expect(chain.escrowState(posted.id)?.kind).toBe('Delivered');
    await must(chain, cast, posted.decide('primary', 'accept'));
    expect(chain.escrowState(posted.id)?.kind).toBe('Released');
    // Carried: a reject would post the delivery first (G1); refused before that, so the delivery stays unposted.
    const carried = await funded(chain, cast, club, 'ground-carried');
    const delivery = await carried.deliver();
    expect(delivery.kind === 'deliver' && (await chain.carryDelivery(delivery.delivery))).toBeNull();
    for (const outcome of ['accept', 'reject', 'escalate'] as const) {
      const r = await refused(chain, await carried.decide('primary', outcome, undefined, { appealGround: 'mislabeled-model' }), { sender: cast.primary.key });
      expect(r, outcome).toEqual({ problem: named, sent: [] });
    }
    expect(chain.escrowState(carried.id)?.kind).toBe('Held');
    expect((await chain.stage(carried.id)).stage).toBe('Held');
  }, 120_000);

  // T-574: the empty string is no ground, by core's one rule (carriesAppealGround), as the contract reads it. Before,
  // the relay passed it and the contract accepted it, but core's state machine, which the relay mirrors, refused it.
  it('takes a decision whose appeal ground is the empty string as one with no ground, on chain and in the mirror', async () => {
    const { chain, cast, club } = await newSettlement(world);
    const d = await funded(chain, cast, club, 'ground-empty');
    await must(chain, cast, d.deliver());
    await must(chain, cast, d.decide('primary', 'accept', undefined, { appealGround: '' as NonNullable<Decision['appealGround']> }));
    expect(chain.escrowState(d.id)?.kind).toBe('Released');
    expect((await chain.stage(d.id)).stage).toBe('Released');
  }, 120_000);

  it("refuses a fallback's decision with an appeal ground by core's reason", async () => {
    const { chain, cast, club } = await newSettlement(world);
    const d = await funded(chain, cast, club, 'ground-fallback');
    await must(chain, cast, d.deliver());
    chain.advanceTo(d.terms.timing.judgeBy);
    await must(chain, cast, d.trigger('fallback'));
    const round = Math.floor(Date.parse(d.terms.timing.judgeBy) / 1000);
    const r = await refused(chain, await d.decide('fallback', 'reject', round, { appealGround: 'policy-or-panel-violation' }), { sender: cast.fallback.key });
    expect(r).toEqual({ problem: named, sent: [] });
    expect(chain.escrowState(d.id)?.kind).toBe('FallbackJudging');
    await must(chain, cast, d.decide('fallback', 'reject', round));
    expect(chain.escrowState(d.id)?.kind).toBe('Refunded');
  }, 120_000);

  // The fixed contracts (contracts-phase-one-2) refuse a ground on the escalation's decision too; T-540 names that one.
  it("leaves the appeal adjudicator's ground to T-540's own reason, and the decision without it lands", async () => {
    const { chain, cast, club } = await newSettlement(world);
    const d = await funded(chain, cast, club, 'ground-appeal');
    await must(chain, cast, d.deliver());
    await must(chain, cast, d.decide('primary', 'escalate'));
    const at = Math.floor(Date.parse(chain.now()) / 1000) - 1;
    chain.advance(2);
    const r = await refused(chain, await d.decide('appeal', 'accept', at + 1, { appealGround: 'wrong-outcome' }), { sender: cast.appeal.key });
    expect(r.sent).toEqual([]);
    expect(r.problem?.type).toBe('invalid_terms');
    expect(r.problem?.detail).toMatch(/carries no appeal ground/);
    await must(chain, cast, d.decide('appeal', 'accept', at + 1));
    expect(chain.escrowState(d.id)?.kind).toBe('Released');
  }, 120_000);
});

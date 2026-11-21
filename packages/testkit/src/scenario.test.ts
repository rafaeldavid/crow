import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseScenario, ScenarioError } from './scenario.js';

const example = readFileSync(new URL('../../../fixtures/scenarios/_example.scenario.yaml', import.meta.url), 'utf8');
const minimal = (body: string) => `# @seed 1
name: t
parties: { buyer: b, seller: s }
adjudicators: { primary: p, fallback: f, appeal: a }
${body}`;

describe('scenario parser', () => {
  it('parses the _example fixture into typed steps', () => {
    const s = parseScenario(example, '_example');
    expect(s.pragmas).toEqual({ settlement: 'sim', judges: 'recorded', mode: 'guaranteed_on_decision', seed: 7 });
    expect(s.parties).toEqual({ buyer: 'atlas-buyer', seller: 'tidewater-seller' });
    expect(s.operators).toEqual(['op-1', 'op-2']);
    expect(s.faucet['atlas-buyer']).toBe('10000000000');
    expect(s.steps.map((x) => x.kind)).toEqual(['offer', 'agree_and_fund', 'deliver', 'advance_clock', 'judge', 'settle', 'verify_key_release']);
    expect(s.steps[2]).toEqual({ kind: 'deliver', by: 'seller', via: 'op-1', file: 'data/dataset-cleaning/customers.clean.csv' });
    expect(s.steps[3]).toEqual({ kind: 'advance_clock', seconds: 5 });
    expect(s.steps[6]).toEqual({ kind: 'verify_key_release', by: 'buyer', via: 'direct' });
    expect(s.expect).toEqual({ terminal: 'Released', balances: { 'atlas-buyer': '7950000000', 'tidewater-seller': '2000000000', 'bench-a': '25050000000' } });
  });

  it('requires the name to match the file name', () => {
    expect(() => parseScenario(example, 'other')).toThrow(/name/);
  });

  it('rejects unknown steps and unknown keys, so typos cannot pass silently', () => {
    expect(() => parseScenario(minimal('steps:\n  - teleport: {}\n'), 't')).toThrow(/unknown step "teleport"/);
    expect(() => parseScenario(minimal('steps:\n  - offer: { by: seller, viaa: op-1 }\n'), 't')).toThrow(/viaa/);
    expect(() => parseScenario(minimal('colour: red\nsteps: []\n'), 't')).toThrow(/colour/);
    expect(() => parseScenario(minimal('steps:\n  - offer: { by: buyer }\n'), 't')).toThrow(/by/);
  });

  it('rejects money written as a YAML number', () => {
    expect(() => parseScenario(minimal('faucet: { b: 10000 }\nsteps: []\n'), 't')).toThrow(/decimal string/);
    expect(() => parseScenario(minimal('faucet: { b: "1.5" }\nsteps: []\n'), 't')).toThrow(/decimal string/);
  });

  it('rejects an operator the fixture does not declare', () => {
    expect(() => parseScenario(minimal('operators: [op-1]\nsteps:\n  - offer: { by: seller, via: op-9 }\n'), 't')).toThrow(/op-9/);
  });

  it('never executes or constructs anything from YAML tags', () => {
    expect(() => parseScenario(minimal('steps: !!js/function "function(){ return 1 }"\n'), 't')).toThrow(ScenarioError);
    expect(() => parseScenario(minimal('steps: !custom []\n'), 't')).toThrow(ScenarioError);
  });

  it('refuses alias expansion bombs', () => {
    const bomb = minimal(`a: &a ["x","x","x","x","x","x","x","x","x","x"]
b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a,*a]
c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b,*b]
steps: []
`);
    expect(() => parseScenario(bomb, 't')).toThrow(ScenarioError);
  });

  it('requires error. fixtures to name the refused step and problem type', () => {
    const errorFixture = (body: string) => minimal(body).replace('name: t', 'name: error.t');
    expect(() => parseScenario(errorFixture('steps: []\n'), 'error.t')).toThrow(/expect\.problem/);
    expect(() => parseScenario(errorFixture('steps: []\nexpect: { problem: { type: invalid_state } }\n'), 'error.t')).toThrow(/step/);
    expect(parseScenario(errorFixture('steps: []\nexpect: { problem: { type: invalid_state, step: 1 } }\n'), 'error.t').expect.problem).toEqual({ type: 'invalid_state', step: 1 });
    expect(() => parseScenario(errorFixture('steps: []\nexpect: { problem: { type: oops, step: 1 } }\n'), 'error.t')).toThrow(/oops/);
  });

  it('requires neutrality. fixtures to name a declared failing actor', () => {
    const n = (body: string) => minimal(body).replace('name: t', 'name: neutrality.t');
    expect(() => parseScenario(n('steps: []\n'), 'neutrality.t')).toThrow(/fails/);
    expect(() => parseScenario(n('fails: nobody\nsteps: []\n'), 'neutrality.t')).toThrow(/nobody/);
    expect(parseScenario(n('fails: p\nsteps: []\n'), 'neutrality.t').fails).toBe('p');
    expect(() => parseScenario(minimal('fails: p\nsteps: []\n'), 't')).toThrow(/neutrality\./);
  });

  it('parses timeout, offline and operator-refusal steps', () => {
    const s = parseScenario(
      minimal(`operators: [op-1]
steps:
  - offline: { actor: p }
  - operator_refuses: { operator: op-1 }
  - trigger_fallback: {}
  - trigger_default: { via: op-1 }
  - apply_default_outcome:
  - expire: {}
`),
      't',
    );
    expect(s.steps).toEqual([
      { kind: 'offline', actor: 'p' },
      { kind: 'operator_refuses', operator: 'op-1' },
      { kind: 'trigger_fallback', via: 'direct' },
      { kind: 'trigger_default', via: 'op-1' },
      { kind: 'apply_default_outcome', via: 'direct' },
      { kind: 'expire', via: 'direct' },
    ]);
    expect(() => parseScenario(minimal('steps:\n  - offline: { actor: ghost }\n'), 't')).toThrow(/ghost/);
    expect(() => parseScenario(minimal('steps:\n  - operator_refuses: { operator: op-9 }\n'), 't')).toThrow(/op-9/);
  });

  it('outside: names actors outside the protocol, which fails:, offline and refuses may name (T-558)', () => {
    const n = (body: string) => minimal(body).replace('name: t', 'name: neutrality.t');
    const s = parseScenario(n('outside: [ramp-a, ramp-b]\nfails: ramp-a\nsteps:\n  - refuses: { actor: ramp-a }\n  - offline: { actor: ramp-b }\n'), 'neutrality.t');
    expect(s.outside).toEqual(['ramp-a', 'ramp-b']);
    expect(s.fails).toBe('ramp-a');
    expect(s.steps).toEqual([
      { kind: 'refuses', actor: 'ramp-a' },
      { kind: 'offline', actor: 'ramp-b' },
    ]);
    // Only an outside actor refuses this way: parties and adjudicators go offline, operators have operator_refuses.
    expect(() => parseScenario(minimal('steps:\n  - refuses: { actor: p }\n'), 't')).toThrow(/not an outside actor/);
    // An outside actor has no account: the faucet cannot fund it, and it cannot share a name with an actor.
    expect(() => parseScenario(minimal('outside: [ramp-a]\nfaucet: { ramp-a: "1" }\nsteps: []\n'), 't')).toThrow(/ramp-a/);
    expect(() => parseScenario(minimal('outside: [b]\nsteps: []\n'), 't')).toThrow(/distinct/);
    expect(() => parseScenario(minimal('outside: [faucet]\nsteps: []\n'), 't')).toThrow(/reserved/);
    expect(() => parseScenario(minimal('outside: ramp-a\nsteps: []\n'), 't')).toThrow(/list/);
    // `outside` is the Via the runner writes for an outside actor's act, so no actor may take the name (review L2).
    expect(() => parseScenario(minimal('operators: [outside]\nsteps: []\n'), 't')).toThrow(/reserved/);
    expect(() => parseScenario(minimal('steps: []\n').replace('seller: s', 'seller: outside'), 't')).toThrow(/reserved/);
    expect(() => parseScenario(minimal('outside: [outside]\nsteps: []\n'), 't')).toThrow(/reserved/);
  });

  it('top_up: an outside actor adds money to a party address during the run (T-558)', () => {
    const s = parseScenario(minimal('outside: [ramp-b]\nsteps:\n  - top_up: { from: ramp-b, to: b, amount: "1050000000" }\n'), 't');
    expect(s.steps[0]).toEqual({ kind: 'top_up', from: 'ramp-b', to: 'b', amount: '1050000000' });
    // From an outside actor only, to a party's address only (an adjudicator's faucet money is its bond).
    expect(() => parseScenario(minimal('steps:\n  - top_up: { from: p, to: b, amount: "1" }\n'), 't')).toThrow(/not an outside actor/);
    // Only the buyer's paying address, until a fixture needs more (review L3).
    expect(() => parseScenario(minimal('outside: [r]\nsteps:\n  - top_up: { from: r, to: p, amount: "1" }\n'), 't')).toThrow(/paying address/);
    expect(() => parseScenario(minimal('outside: [r]\nsteps:\n  - top_up: { from: r, to: s, amount: "1" }\n'), 't')).toThrow(/paying address/);
    const split = (to: string) => minimal(`outside: [r]\nsteps:\n  - top_up: { from: r, to: ${to}, amount: "1" }\n`).replace('seller: s', 'seller: s, buyer_payment: w, seller_payout: sp');
    expect(parseScenario(split('w'), 't').steps[0]).toEqual({ kind: 'top_up', from: 'r', to: 'w', amount: '1' });
    expect(() => parseScenario(split('b'), 't')).toThrow(/paying address/);
    expect(() => parseScenario(split('sp'), 't')).toThrow(/paying address/);
    expect(() => parseScenario(minimal('outside: [r]\nsteps:\n  - top_up: { from: r, to: b, amount: 1 }\n'), 't')).toThrow(/decimal string/);
    expect(() => parseScenario(minimal('outside: [r]\nsteps:\n  - top_up: { from: r, to: b, amount: "0" }\n'), 't')).toThrow(/above 0/);
    expect(() => parseScenario(minimal('outside: [r]\nsteps:\n  - top_up: { from: r, to: b, amount: "1", commitment: 2 }\n'), 't')).toThrow(/does not act on a commitment/);
  });

  it('fund: the buyer funds an agreed deal without signing Agree again (T-558)', () => {
    const s = parseScenario(minimal('operators: [op-1]\nsteps:\n  - fund: { by: buyer, via: op-1 }\n  - fund: { by: buyer, signer: s }\n'), 't');
    expect(s.steps).toEqual([
      { kind: 'fund', by: 'buyer', via: 'op-1' },
      { kind: 'fund', by: 'buyer', via: 'direct', signer: 's' },
    ]);
    expect(() => parseScenario(minimal('steps:\n  - fund: { by: seller }\n'), 't')).toThrow(/by/);
  });

  it('reads the stub_bytes opt-in on deliver', () => {
    const s = parseScenario(minimal('steps:\n  - deliver: { by: seller, file: data/x.csv, stub_bytes: true }\n'), 't');
    expect(s.steps[0]).toEqual({ kind: 'deliver', by: 'seller', via: 'direct', file: 'data/x.csv', stubBytes: true });
    expect(() => parseScenario(minimal('steps:\n  - deliver: { by: seller, file: data/x.csv, stub_bytes: "yes" }\n'), 't')).toThrow(/stub_bytes/);
  });

  it('reads a buyer envelope sealed to the wrong key on deliver (T-024)', () => {
    const s = parseScenario(minimal('steps:\n  - deliver: { by: seller, file: data/x.csv, buyer_envelope: wrong_key }\n'), 't');
    expect(s.steps[0]).toEqual({ kind: 'deliver', by: 'seller', via: 'direct', file: 'data/x.csv', buyerEnvelope: 'wrong_key' });
    expect(() => parseScenario(minimal('steps:\n  - deliver: { by: seller, file: data/x.csv, buyer_envelope: missing }\n'), 't')).toThrow(/buyer_envelope/);
    // T-550: a standing delivery has no buyer envelope, and only it may be posted by the buyer.
    expect(parseScenario(minimal('steps:\n  - deliver: { by: buyer, file: data/x.csv, buyer_envelope: none }\n'), 't').steps[0]).toEqual({ kind: 'deliver', by: 'buyer', via: 'direct', file: 'data/x.csv', buyerEnvelope: 'none' });
    expect(() => parseScenario(minimal('steps:\n  - deliver: { by: buyer, file: data/x.csv }\n'), 't')).toThrow(/buyer posts only a standing delivery/);
  });

  it('reserves ledger account names and checks faucet accounts', () => {
    for (const reserved of ['escrow', 'anyone', 'direct']) {
      expect(() => parseScenario(minimal('steps: []\n').replace('buyer: b', `buyer: ${reserved}`), 't')).toThrow(/reserved/);
    }
    expect(() => parseScenario(minimal('operators: [escrow]\nsteps: []\n'), 't')).toThrow(/reserved/);
    expect(() => parseScenario(minimal('faucet: { stranger: "1" }\nsteps: []\n'), 't')).toThrow(/stranger/);
  });

  it('accepts expect_terminal as a shorthand for expect.terminal, and only terminal states in either', () => {
    expect(parseScenario(minimal('steps: []\nexpect_terminal: Refunded\n'), 't').expect).toEqual({ terminal: 'Refunded' });
    expect(() => parseScenario(minimal('steps: []\nexpect_terminal: Held\n'), 't')).toThrow(/Held/);
    expect(() => parseScenario(minimal('steps: []\nexpect: { terminal: Held }\n'), 't')).toThrow(/Held/);
  });
});

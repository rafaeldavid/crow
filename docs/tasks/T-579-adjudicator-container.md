# T-579: An adjudicator in a container, and adjudicators that plug in

- **Lane:** judging
- **Phase:** 2
- **Depends on:** nothing to start. The test on Tinfoil needs a Tinfoil account, which is Rafa's.
- **Paths this task may touch:** `docs/adjudicator-interface.md` (new), `docs/decisions/` (one new ADR), `apps/adjudicator/` (a `Dockerfile` and container entry point only, no change to judging), `tests/adjudicator-conformance/` (new), `fixtures/scenarios/` (conformance and neutrality scenarios)
- **Human gate:** a Tinfoil account and its key, Rafa's. Any production change, and any deal on Sepolia decided by the container, wait for Rafa's word.
- **Status:** todo (branch made on 2026-11-21; work starts after the roadmap review of the week of 2026-11-23)
- **Agent/session:** none yet
- **Roadmap row:** N219

## Intent

The protocol already lets the buyer and seller name their own adjudicators: a primary, a fallback and an appeal adjudicator. In practice every deal names Crow's, because no one else can run one. This task makes running one a matter of meeting a written contract, and tests whether an adjudicator can run in attested hardware.

1. **The plug.** Write the contract any adjudicator must meet so it can be swapped in:
   - how it is named in the terms;
   - its discovery record and keys;
   - the decision it signs, its deadlines and its fee;
   - what it publishes about the deals it accepts, and what it may decline.

   A conformance test proves a new adjudicator fits. Crow's own adjudicator becomes one implementation, not the definition.
2. **The container.** Package `apps/adjudicator` as a Docker image, pinned by digest, and run it in a Tinfoil container (tinfoil.sh):
   - its signing key is made inside the enclave;
   - the delivery is decrypted only inside it;
   - it reaches only the judge providers;
   - anyone can check the attested code that judged a deal.

   Tinfoil's pinned releases, attested keys and private secrets are in beta, so this is a test, not a production move.

Non-goals: the operators stay on Cloudflare Workers; no change to how a panel judges; no schema change unless the ADR shows the plug needs one (then a version bump with it).

## Acceptance criteria

- [ ] An ADR records the adjudicator interface and how a party names any adjudicator that meets it.
- [ ] `docs/adjudicator-interface.md` states the contract in full, for an outside team to implement.
- [ ] A conformance test runs against any adjudicator's endpoint and keys; Crow's adjudicator passes it from the container image.
- [ ] The image runs in a Tinfoil container. With Rafa's word, one Sepolia test deal is decided by it, and a party that is not Crow checks its attestation.
- [ ] A second adjudicator passes the same conformance test. It is run by someone else, or by a stand-in built only from the written contract.
- [ ] A neutrality scenario shows a deal ends by its terms when the containerised adjudicator is offline (the fallback decides, or the default outcome applies).
- [ ] The reviewer's report and a red team, since this touches judgment and keys; every finding of Medium or above fixed with a test.

## Evidence

None yet.

## Handoff

Not started. Read first:
- `CLAUDE.md`;
- ADR-0001 (neutrality) and ADR-0006 (judgment);
- `docs/judgment-and-defenses.md`;
- the adjudicator's code in `apps/adjudicator/`;
- Tinfoil's container docs (docs.tinfoil.sh/containers).

The coordinator's review of Tinfoil, 2026-11-21: it serves open-weight models and runs Docker images in attested enclaves on AMD SEV-SNP, Intel TDX and NVIDIA confidential computing. It has no Claude, one enclave per instance and no load balancing; its persistent volumes are in beta and outside the attestation. The sister task for judge families on Tinfoil is T-578 (roadmap row N218).

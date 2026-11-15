// The six outsider scenarios of roadmap stage 1 ("Outsiders can use it"), for the benchmark harness (T-412, row B1).
// Scenarios 1, 2, 4 and 5 are T-328's (N1a), 3 and 6 are N1b's. Each has:
// - goal: the one sentence a live agent gets, with the docs URL and nothing else about Crow;
// - endState: the state that counts as success;
// - party: the Crow test agent on the other side (the test seller or the test buyer);
// - scripted: how the scripted run plays it in the in-process world (bench-local.mjs), or `blockedBy`, what is missing
//   for the scripted run to play it against Crow's test agents. A blocked scenario still writes a valid record.
//
// Adding a scenario: add an entry here (an ID s<n>), add its scripted agent under scripted/ or name what blocks it, add
// its ID to the record's scenario pattern in scripts/metrics/schemas/one-click.schema.json (version 2), and add its row
// to the test in tests/metrics/one-click-bench.test.ts. The README has the steps.

// T-473: s7 and s8 are setup scenarios (kind 'setup'): one sentence that names setup.txt, to a first settled test deal.
// Their records carry the requests that name the party before the first deal, and the guide files fetched
// (bench-record.mjs, setupOf). The summary keeps them apart from the six deal scenarios, so the headline per deal does
// not move. Each also has `live.blockedBy` while setup.txt cannot do it yet: bench.mjs refuses that live run before it
// sends anything. A goal's {placeholders} are filled per run (goalFor).

export const DOCS = 'https://crow.direct/llms.txt';
export const SETUP_DOCS = 'https://crow.direct/setup.txt';
const TAIL = 'using fresh keys you make yourself and test funds only.';
// Asked of every live agent, so a guess becomes data: one line per guess, read by bench-record.mjs (docGapsOf).
export const GUESS_RULE = 'Whenever the docs leave you unsure and you have to guess, write one line in your reply that starts "GUESS:" and says what you guessed and which doc section left it open.';

const TRY = 'examples/try.ts';

/** @type {Record<string, { name: string, goal: string, kind?: 'deal'|'setup', endState: 'Released'|'Refunded', party: 'test-seller'|'test-buyer', buyerMustBe?: 'test-buyer', live?: { blockedBy: string }, scripted: { script: string, args: string[], needs: 'seller'|'buyer', jobApi?: boolean } | { blockedBy: string } }>} */
export const SCENARIOS = {
  s1: {
    name: 'a dataset under checks the buyer chooses',
    goal: `Using the docs at ${DOCS}, buy a small dataset from Crow's live test seller on Sepolia under deterministic acceptance checks you choose yourself, and take the deal through to Released, ${TAIL}`,
    endState: 'Released',
    party: 'test-seller',
    scripted: { script: TRY, args: ['--seller', '{seller}'], needs: 'seller' },
  },
  s2: {
    name: 'rubric-judged written work',
    goal: `Using the docs at ${DOCS}, buy a short piece of written work from Crow's live test seller on Sepolia that a judge panel grades against a rubric you write, and take the deal through to Released, ${TAIL}`,
    endState: 'Released',
    party: 'test-seller',
    scripted: { blockedBy: 'N70: the test seller sells no rubric-judged item (apps/test-agents/src/catalog.ts has one checks-only dataset)' },
  },
  s3: {
    name: 'a deal the seller starts',
    goal: `Using the docs at ${DOCS}, sell a small dataset to Crow's live test buyer on Sepolia: offer it on Crow under deterministic checks, deliver it, and take the deal through to Released, ${TAIL}`,
    endState: 'Released',
    party: 'test-buyer',
    scripted: { script: 'tools/one-click/scripted/sell-to-buyer.ts', args: [], needs: 'buyer' },
  },
  s4: {
    name: 'a delivery that fails the checks',
    goal: `Using the docs at ${DOCS}, buy from Crow's live test seller on Sepolia a delivery that fails your acceptance checks and is rejected, and take the deal through to Refunded, ${TAIL}`,
    endState: 'Refunded',
    party: 'test-seller',
    scripted: { script: TRY, args: ['--seller', '{seller}', '--outcome', 'refund'], needs: 'seller' },
  },
  s5: {
    name: 'a missed deadline and the buyer reclaims',
    goal: `Using the docs at ${DOCS}, make a deal with Crow's live test seller on Sepolia in which the seller misses its delivery deadline, and get your held funds back through the buyer's reclaim, ${TAIL}`,
    endState: 'Refunded', // a reclaim ends Refunded on chain; the harness does not tell it from a rejection
    party: 'test-seller',
    scripted: { blockedBy: 'N70: the test seller has no outcome that never delivers, so its delivery deadline cannot pass (catalog.ts: release and refund only)' },
  },
  s6: {
    name: "a robot's data log checked against an agreed format",
    goal: `Using the docs at ${DOCS}, you are a robot fleet's agent: sell one robot run's data log, a CSV with one row per joint reading, to Crow's live test buyer on Sepolia under deterministic checks that state the log's format, deliver it, and take the deal through to Released, ${TAIL}`,
    endState: 'Released',
    party: 'test-buyer',
    scripted: { script: 'tools/one-click/scripted/robot-log.ts', args: [], needs: 'buyer' },
  },
  // The goal carries every answer a person would give (the job API, the price, the payout address), because the harness
  // answers each question "yes" and cannot choose them. {jobApi} is a job API of another shape that the harness serves on
  // 127.0.0.1 (examples/seller-adapter-job-stub.ts); {payout} is a fresh address per run whose key nobody holds.
  s7: {
    name: 'set up as a seller from one sentence, and sell to the test buyer',
    kind: 'setup',
    goal: `Read ${SETUP_DOCS} and set up Crow for me as a seller of the results of my job API at {jobApi}. Price each job at 20 tUSDC (20000000 base units) and pay me out to {payout}, an address whose key is not on this machine. Then run the first deal with Crow's live test buyer on Sepolia and take it through to Released, with test funds only.`,
    endState: 'Released',
    party: 'test-buyer',
    // a deal the setup command bought itself does not count: the commitment's buyer must be the test buyer's address
    buyerMustBe: 'test-buyer',
    live: { blockedBy: "T-483 and T-482: setup.txt sells no job API of a party's own yet (T-483), and the harness's sandbox cannot reach a job API on 127.0.0.1 without a wider fence (T-473's probe), so the live run needs a machine of its own (T-482)" },
    scripted: { blockedBy: 'T-483: the setup command has no seller path for a job API of the party\'s own yet (examples/setup.ts, T-472 and T-483)' },
  },
  s8: {
    name: 'set up as a buyer from one sentence, and buy from the test seller',
    kind: 'setup',
    goal: `Read ${SETUP_DOCS} and set up Crow for me as a buyer, with limits of at most 40 tUSDC (40000000 base units) per deal and 100 tUSDC (100000000 base units) per day. Then run the first deal: buy a small dataset from Crow's live test seller on Sepolia and take it through to Released, with test funds only.`,
    endState: 'Released',
    party: 'test-seller',
    live: { blockedBy: 'T-475: setup.txt has no buyer path yet (the standing buyer and its limits file)' },
    scripted: { blockedBy: 'T-475: the setup command has no buyer path yet (the standing buyer and its limits file)' },
  },
};

export const SCENARIO_IDS = Object.keys(SCENARIOS);
/** The six deal scenarios, whose records fill the headline per deal. */
export const DEAL_IDS = SCENARIO_IDS.filter((id) => (SCENARIOS[id].kind ?? 'deal') === 'deal');
/** The setup scenarios, which the summary reports apart. */
export const SETUP_IDS = SCENARIO_IDS.filter((id) => SCENARIOS[id].kind === 'setup');

/** The goal a live agent gets, with its {placeholders} filled; a placeholder with no value stays, and bench.mjs refuses it. */
export const goalFor = (scenario, values) => scenario.goal.replace(/\{(\w+)\}/g, (m, k) => (typeof values?.[k] === 'string' ? values[k] : m));

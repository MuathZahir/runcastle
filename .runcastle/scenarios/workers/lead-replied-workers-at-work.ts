/**
 * Scenario: a lead whose last turn ended on a plain reply ("Started the
 * workers…") while its workers are only working or waiting to start — nobody
 * waits on the human. The sidebar and the header must both read as working,
 * never "Needs your answer" (calmer-worker-chats decisions 13 and 19).
 *
 * The Feature with workers scenario, cut to its workers at work: see
 * feature-with-workers.ts for how it is run and what it seeds.
 */
process.env.SCENARIO_WORKERS_AT_WORK = '1'
await import('./feature-with-workers.ts')
export {}

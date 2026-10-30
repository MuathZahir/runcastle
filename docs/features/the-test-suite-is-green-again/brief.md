## Purpose

Three server tests fail on main, with runcastle's inherited settings cleared. They failed the same way before the 2026-10-28 UI cut. Every feature since has had to explain them away. Make the suite fully green.

## The three

- `packages/server/test/project-drive.test.ts`: "drives the checkout as it is: project-drive identity, real branch, HEAD and tree untouched"
- `packages/server/test/read-tool-ceiling.test.ts`: "get_feature_context on a backlogged feature > moves ticket detail out whole, oldest first, when rows and to-do alone cross it"
- `packages/server/test/review-directory-preparation.test.ts`: "best-effort collects only this ticket's stale siblings"

Feature agents described them as a drive name, a size limit and Windows paths. That's from their reports, unverified.

Run with: `env -u GIT_ASKPASS -u RUNCASTLE_SANDCASTLE_TEMPLATE -u RUNCASTLE_SESSION_ID -u RUNCASTLE_SERVER_URL -u RUNCASTLE_MIGRATIONS_DIR -u RUNCASTLE_WEB_DIST -u RUNCASTLE_PTY_HOST -u RUNCASTLE_SKILLS_DIR -u RUNCASTLE_HOOK_CLIENT bun run test`.

## Must not swallow

- Weakening a test to get it green. For each, decide whether the code or the test is wrong. If a test pins behaviour that's gone (gates and required review have been retired), delete or update it and say so.
- The one flaky file seen under a full parallel run (`self-plan-launch`), unless it's quick.

## Ordering

No order needed.

## Working agreement (the human, 2026-10-30)

Autonomous: the human said to start this. The orchestrator gives the yes and merges when it is right.

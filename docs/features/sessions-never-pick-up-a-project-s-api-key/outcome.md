# Outcome — Sessions never pick up a project's API key

Runcastle stops Bun from loading .env files, so no session or worker is ever billed to an Anthropic API key from a project folder.

- Shipped: 2026-11-18

## What shipped

6 commits · 30 files

## Review record

### Review · gates review

- Outcome: dropped

- **Start-up cleanup checks the wrong .env files when a .env sets NODE_ENV, so a key in .env.development still leaks** (defect, high) — fixed: 582a99fc: the cleanup now reads the .env files of every mode (development, production, test and the current NODE_ENV), so a .env that changes NODE_ENV can't hide .env.development. Covered by a unit test and a real-Bun test (.env sets NODE_ENV=production, .env.development holds the sentinel, so the key ends up unset).
- **On macOS/Windows, a shell-exported variable is removed whenever the .env value for it contains a `$`** (defect, medium) — fixed: 582a99fc: with no start environment, a $ value is expanded the way Bun 1.4.4 does it (checked against real Bun: $NAME, ${NAME}, ${NAME:-d}, ${}, \$, pa$$word to pa$, single quotes too), using the environment as Bun left it. The key goes only when the expanded value matches. Tested with the review's own repro: the shell ANTHROPIC_API_KEY and DB_PASS are kept. The double-quote escapes are fine as they are: Bun keeps \t literal, and \$ is handled by the expansion.
- **Model discovery builds the SDK launch options by hand instead of using the new shared helper** (observation, low) — open
- **Code comments point at this feature's decisions by number ("decision 3", "decision 6")** (observation, low) — open

### Review: verify · gates review, verify

- Outcome: dropped
- Verified fix commits: 582a99fc fix(server): boot cleanup checks every mode's .env and expands $ like Bun

- No findings

## Notes record

- No human notes

## Workers

- Review (review) — dropped · 895738 tokens
- Review: verify (review) — dropped · 297157 tokens

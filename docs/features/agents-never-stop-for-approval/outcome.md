# Outcome — Agents never stop for approval

No runcastle agent ever stops on the command approval dialog, so unattended work never stalls on a click.

- Shipped: 2026-11-16

## What shipped

17 commits · 37 files

## Review record

### Review · drive review

- Outcome: handed-back

- **The delete guard reads `cd -` as "go home", so a harmless delete after it is refused** (defect, low) — fixed: 41761787: `cd -` now makes the folder unknown (allowed), and the guard starts from the hook's `cwd` (the shell's real folder, kept across calls) instead of assuming the session folder. Tests cover both, plus the route.
- **A request with no allow option is refused but logged as `permission_allowed`** (defect, low) — fixed: d43c02ec: a refusal is logged as a new `permission_refused` event; `permission_allowed` only when an allow option was picked. Test asserts it.
- **Codex sessions, a root install and sandbox workers were not driven live** (observation, low) — open
- **No scenario reaches "a chat whose old log holds an approval ask"** (observation, low) — open

### Review: verify · drive review, verify

- Outcome: handed-back
- Verified fix commits: 41761787 fix(launcher): the delete guard starts from the shell's real folder and reads cd - as unknown, d43c02ec fix(threads): log a refused permission request as permission_refused

- No findings

## Notes record

- No human notes

## Workers

- Review (review) — handed-back · 3986017 tokens
- Review: verify (review) — handed-back · 588558 tokens

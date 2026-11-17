# Outcome — A faster web app

Runcastle's web app loads fast on refresh and typing in the message box never lags, even over SSH and on a slower PC.

- Shipped: 2026-11-17

## What shipped

21 commits · 38 files

## Review record

### Review · drive review

- Outcome: handed-back

- **A refresh still fetches five lists twice (project, feature, thread and worker lists, drive info), about 0.6 s apart** (defect, low) — fixed: e9b9a357: the app's default refetchOnMount skips a stream-covered list read in the last 5 s. A throttled first visit now fetches each list once (checked with scripts/speed.ts --detail). Unit test in apps/web/test/live.test.ts.
- **The speed targets themselves were not re-measured in this review; the throttled numbers rest on the lead's runs** (observation, low) — open

### Review: verify · drive review, verify

- Outcome: handed-back
- Verified fix commits: e9b9a357 fix(web): a reader that mounts after a list just arrived does not fetch it again

- **A refresh still fetches five lists twice — partly fixed: on a feature page, drive info and the project thread list are still fetched twice** (defect, low) — fixed: 74dee2dc: default staleTime of 5 s for lists the live stream covers (staleTimeOf in lib/live.ts), replacing the mount-only rule. It covers readers that switch on once their id arrives. Invalidations and the fallback poll ignore it; the two cache fetches in use-thread pass staleTime 0 already.

### Review: verify · drive review, verify

- Outcome: handed-back
- Verified fix commits: 74dee2dc fix(web): a list the stream covers stays fresh for 5 s, so readers that switch on late do not refetch it

- No findings

## Notes record

- No human notes

## Workers

- Lag-free typing (on-its-own) — landed · tokens not counted
- Fast refresh (on-its-own) — landed · tokens not counted
- Review (review) — handed-back · 6701026 tokens
- Review: verify (review) — handed-back · 1044313 tokens
- Review: verify (review) — handed-back · 461209 tokens

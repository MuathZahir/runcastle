# Outcome — Runcastle cleans up after itself

Every container, image, build cache and folder runcastle makes is removed once it is no longer needed, so runcastle never fills a disk.

- Shipped: 2026-11-17

## What shipped

16 commits · 44 files

## Review record

### Review · gates review

- Outcome: handed-back

- **Build button removes old sandbox images silently: no event says what went** (defect, medium) — fixed: 96de80f1: the Build button's removal now emits a cleanup.swept line on the project (the oldest project for the stock image).
- **Unused code in the sweep: a drive-removal function and a step-registration hook only tests call** (observation, low) — open
- **Leftovers no project made go on an arbitrary project, not the oldest as documented** (observation, low) — open
- **On Windows, folder sizes come from `du`, so timeline lines say "at least" or "space freed unknown"** (observation, low) — open
- **A deleted feature's review capture that fails to delete is kept 30 more days, not removed by the next sweep** (defect, low) — fixed: 96de80f1: a folder that will not go is renamed deleted-<id>, and expireReviewCaptures removes such folders at once. Test added.
- **Drive stop removes the drive's labelled resources but does not trigger a sweep; the hands-on Docker check of land and mid-setup kill was not done** (observation, low) — open

### Review: verify · gates review, verify

- Outcome: handed-back
- Verified fix commits: 96de80f1 fix(cleanup): close the review's findings

- **A deleted feature's review capture that fails to delete is kept 30 more days, not removed by the next sweep (still true when the reviews folder itself is locked)** (defect, low) — dismissed: The common case (a locked file inside the capture) is fixed and verified. When the reviews folder itself is locked, every new capture write fails too, and the 30-day rule for unmapped folders still removes it; closing that would need a persistent to-delete list, which is more machinery than the case is worth.

## Notes record

- No human notes

## Workers

- Cleanup engine (on-its-own) — landed · 12032543 tokens
- Builds and captures (on-its-own) — landed · 15556699 tokens
- Review (review) — handed-back · 1510642 tokens
- Review: verify (review) — handed-back · 638944 tokens

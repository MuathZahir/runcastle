# Orphaned review recorders lock the review dir

## What happened (2026-09-15, feature `prompts-read-the-evidence`, review ticket 4 / `tkt_3_IkqMMmYxY_`)

The first review pass of the ticket died at sandcastle's idle timeout ("Agent idle for 600 seconds — no output received"). The stop path from `stopping-a-headless-agent-actually-stops-it` (shipped 2026-09-09) tree-killed the Claude shim and its node grandchild as designed. But the review agent had run `agent-browser record start <reviewDir>/walkthrough.webm`, and agent-browser is a **detached daemon** (`agent-browser-win32-x64.exe`), not a descendant of the shim. Its parent pid was gone; the daemon, its headless Chrome, and two ffmpeg processes kept streaming frames into `walkthrough.webm` at 10 fps for nine hours (94 MB).

Every re-burn of a review ticket begins in `packages/server/src/workflows/review-ticket.ts` `writeReviewArtifacts` with a bare `rmSync(reviewDir, { recursive: true, force: true })` so a stale DIGEST.md / BLOCKED.md cannot report a success that did not happen. On Windows a file another process holds open cannot be unlinked, so the wipe throws `EBUSY: resource busy or locked` and the whole run fails in under two seconds. Six consecutive burns failed this way; the human could not complete the run at all until the orphan tree was killed by hand (`taskkill /PID <daemon> /T /F`).

## Why this is a feature and not a quick change

The kill registry (`packages/server/src/workflows/kill-registry.ts`) only knows pids sandcastle spawned via `noSandbox({ onChildSpawn })`. The recorder is spawned by the agent's own shell, detaches, and re-parents. No existing mechanism can see it, so the fix needs a decision on *how* the burner identifies the recorder it caused:

- name the agent-browser session per ticket (so the lane can `agent-browser record stop` / close by handle), or
- find the daemon by its ffmpeg output path (the walkthrough path is deterministic per ticket), or
- both, with the path-based sweep as the fallback that survives a server restart (the registry is in-memory and a restart forgets every handle).

That question, plus what "review lane ended" means (done, idle death, Stop, Cancel, waive, server restart mid-review), is the grill.

## What it must do

1. **Reap the recorder on every lane exit.** When a review (or verification) lane ends for any reason, stop the recording and close the agent-browser session it caused, and wait for the file handle to be released — the same "not stopped until dead" bar the stop feature set.
2. **A locked review dir must not fail the run.** `writeReviewArtifacts` should try to kill the holder first, and if the wipe still fails, move the stale dir aside (rename) rather than abort the burn. The invariant to keep is the original one: a re-burn never inherits the previous attempt's DIGEST.md / BLOCKED.md.

## What it must NOT swallow

- **The review-dir wipe policy.** `review-as-a-lap-trail` is a parked draft about keeping review evidence across laps instead of wiping it on re-burn. This feature keeps the wipe as-is and only makes it robust; whether the dir is wiped at all belongs to that draft.
- **Idle-timeout tuning.** Why the first review went idle for 600 s is a separate question; this feature is about what happens after any death.
- **Docker/sandboxed burns.** Reviews always run on the host (`onHost: true`); the recorder problem is host-only.

## Already settled

- Stop/Cancel must kill the real process tree and the UI must not report stopped until it is dead (`docs/features/stopping-a-headless-agent-actually-stops-it/decisions.md`). This feature extends that contract to processes the agent detached, it does not reopen it.
- `reviewDir` is wiped and recreated on every re-burn of the same review ticket (review-ticket.ts, and the digest of `prompts-read-the-evidence` ticket 1 relies on "the evidence is the latest pass's only").

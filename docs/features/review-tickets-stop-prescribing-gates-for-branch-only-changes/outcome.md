# Outcome — Review tickets stop prescribing Gates for branch-only changes

Planning writes review tickets that say what to walk, never which mode. In `packages/skills/packs/runcastle/skills/tickets/SKILL.md`, in the `<review-ticket>` section, add a rule: a review ticket never directs the review agent to Gates mode, and never gives as the reason that the installed runcastle (or the host's review machinery) doesn't have this branch's code yet. Why: on `features-show-their-ui-states-as-stories`, review ticket #6 said "Mode: Gates … this review pass runs on the installed runcastle, which doesn't have this branch's code yet. A drive would have no manifest and no UI-states section to show." The review agent obeyed (its digest reads "Gates mode by the ticket's own direction"), so a UI feature shipped to review without being driven. The reasoning mixes up two things. The review pass (prompt, gates, server-side build steps) runs on the installed runcastle. The drive boots the feature branch's own code: `.runcastle/drive-setup.ts` (around lines 190-200) points the drive at the checkout's migrations, web app and assets for exactly this reason. Say in the skill what to do instead. If the state to check doesn't exist yet in the drive (for example, it is produced by a review pass or a burn), the acceptance criteria say how to produce it inside the drive, as the project's drive instructions already allow. Only a lap with genuinely no surface a human could operate gets criteria written for the gates-and-diff read. Keep the existing "do not ask for both" rule. Keep the wording general, not runcastle-specific: in any project, "the change isn't deployed or installed yet" is not a reason to skip a drive, because the drive runs the branch.

- Shipped: 2026-10-19
- Laps run: 1

## What shipped

5 commits · 7 files

### Lap 1
- 3 tickets landed: #1 Planning writes review tickets that say what to walk, never which mode.…; #2 The review agent decides the mode from the surface and the drive, not…; #4 Verification prompt tells the agent the earlier pass's digest is "above" when it renders below
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 1a770837146409dfcbec8aa2776005265982ffd0
- Landed since: 1
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 106d30327d0f5459797dc8c45c5eb967a86ac7c1
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Planning writes review tickets that say what to walk, never which mode.…

# Ticket 1 — review tickets say what to walk, never which mode

**What was done.** I added a paragraph headed "**Say what to walk, never which mode.**" to the `<review-ticket>` section of `packages/skills/packs/runcastle/skills/tickets/SKILL.md`, straight after the existing "Do not ask for both" paragraph, which is unchanged. The new rule says:
- A review ticket never directs the agent to Gates, and never uses "the change isn't deployed or installed yet" or "the review machinery doesn't have this branch's code" as a reason.
- The review pass runs on whatever is installed, but the drive boots the branch.
- If the state to check doesn't exist yet in a fresh drive, the acceptance criteria say how to produce it inside the drive.
- Only a lap with genuinely no surface a human could operate gets criteria written for the gates-and-diff read.

The wording is general and doesn't mention runcastle. The incident is described without naming the feature. I added one test to `packages/server/test/tickets-skill.test.ts` that checks this wording appears inside the `<review-ticket>` section, next to the never-both rule.

**Surprises.** The full suite reported 350 test files and 4896 passing tests, against the 118 files and 1768 tests the baseline gives; everything was green. Typecheck was clean.

**Left undone.** The review agent's side, `packages/skills/burner/review-ticket.md` and `verify-fixes.md`, is ticket 2's work. I didn't touch the drive machinery: this is a content-only change, so the drive needs no edit.

#### 5. Verify the fixes that landed

Gates verification pass — the one landed fix (#4) held, and both gates are green

This pass inherited Gates mode. The server's drive-availability block for this pass took the "no drive available" branch, so it said flatly to run Gates and not call `review_drive`. Gates is therefore final here. The change under review is prompt text and the server string that assembles it, with no screen to walk.

**#4 — the verification prompt said the earlier pass's digest was "above" when it renders below: held.**
- Fix: commit `106d303`, in `buildDriveAvailability` in `packages/server/src/workflows/review-ticket.ts:337`. The inherited-Gates-but-drivable branch now says "its digest, under "Run digests" below, says why it ran Gates". The old wording was "its digest above".
- Repro re-run on the branch:
  - `verify-fixes.md` still puts `{{DRIVE_AVAILABILITY}}` on line 5 and `Run digests:` / `{{LAP_DIGESTS}}` on lines 31–33, so "below" is now correct. The template's layout was always right; only the pointer was wrong.
  - `grep "its digest above"` on `review-ticket.ts` finds nothing.
  - Every remaining "above" in the file is unrelated. Two are comments, and two are gate-section strings that do refer to text above them.
- Test: the existing case in `packages/server/test/review-ticket.test.ts` now asserts that the block contains `"Run digests" below` and does not contain `above`.
- The fix touches only that string, and the no-drive inherited-Gates branch is unchanged.

**Gates (server run on `106d303`):**
- `bun run typecheck` passed. Core, server and web each exited 0, and so did the scripts tsc.
- `env -u GIT_ASKPASS bun run test` passed: 348 files passed and 2 were skipped (350 in all), with 4898 tests passed, 48 skipped and 0 failed.
- The baseline expects everything green, and nothing failed, so no failure falls outside it.

Nothing else was broken. No findings were reported. Two points stay open from the review pass, not as defects: the rule is now written in three places, and the recorded outcome of a verification that drives after a Gates pass has no test.

REVIEW-MODE: gates
REVIEW-VERDICT: verified
REVIEW-REASON:

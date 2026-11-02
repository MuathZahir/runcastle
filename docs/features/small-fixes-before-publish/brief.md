## Purpose
Batch of small, concrete fixes from the pre-publish audit (project session, 2026-11-02). Each paragraph is its own small change; addresses are starting points — verify before changing.

## The fixes
1. **Permission defaults.** The human does not want agents stopping for permission. Today (packages/server/src/threads/launch.ts) the feature lead (`chat`, `side`) and the project session run in `bypassPermissions` on Claude (~79, ~99), but `prepare`, `drive-fix` and `scenario` stay on `acceptEdits` (~73, ~111) and prompt on anything outside the pre-allowed rules (launcher/artifacts.ts ~1273, `SESSION_BASH_*_RULES`; git commit deliberately prompts on prepare/drive-fix ~1090). Want: every session kind runs without prompts. Keep the guards that protect the human's main checkout working — they are PreToolUse hooks and still run under bypass; if a guard currently relies on a prompt, turn it into a hook refusal. Also make the Codex side a deliberate choice: the bypass override is gated on `runtime === 'claude-code'` (~79); decide what Codex leads should get and say why. Keep honouring rules the human wrote in their own Claude settings (e.g. "ask before git push") — those are deliberate; surfacing such a prompt is the sibling "You always know what's waiting" feature's job.
2. **A restart mid-drive strands the main checkout.** The running drive lives only in memory (services/git.ts ~2314 `drives` Map); boot never reconciles drives (index.ts ~127-141) and shutdown doesn't stop them. After a restart the checkout stays on `feature/x`, teardown never ran, the UI says idle, and the next drive/merge records the feature branch as home (git.ts ~2699, ~3813). Want: no silent stranding. Smallest acceptable shape: on boot, notice the checkout is on a feature branch with no drive running and offer a one-click return (and run the drive's stop script). No recovery machinery beyond that.
3. **"A drive is already active" doesn't say which.** `DENY_ACTIVE` (git.ts ~246) names no holder; `slotHeldReason` (apps/web/src/lib/feature-ui/drive.ts ~47) is never used; the banner with a Stop button (use-standing-notices.ts ~57-71) only shows for project drives. ADR-0014 says the blocker is always named and stoppable. Same for "Cannot merge while a test drive is active" (git.ts ~3790).
4. **Merge refusal on a dirty checkout lists no files** (git.ts ~3796), and uses plain git status so docs-only noise can block. Reuse the drive's blocking-paths logic and show the paths.
5. **"Send to the agent" after a drive doesn't stop the drive**, and a forgotten drive blocks the agent's rounds and every merge. Offer sending and stopping the drive as one step (drive-note-stores.ts ~61, DriveChatNotice.tsx).
6. **"All good" after a drive needs typing.** The server supports "Drive done, all good — no notes" (test-notes.ts ~178) but the UI hides Send when there are no notes (DriveNotes.tsx ~244). Add an "All good" button. Server `sendNotes` also doesn't skip `promoted` notes while the client does (SendToAgent.tsx ~6) — remove `promoted` if nothing creates it any more.
7. **Provider usage limit is a dead end.** runner.ts ~325-329 sets "Waiting for you · provider limit" with no action and no reset time, and lumps billing/auth halts in with usage limits. Want: a Resume action that sends one message to the lead, the reset time when the provider gives one, and honest wording for billing/auth.
8. **"Feature shipped" toast overclaims.** Merge commits locally and pushes nothing; say "merged into main" and that nothing was pushed.
9. **Composer silently drops non-image attachments** (Composer.tsx ~176-179). Tell the human instead of dropping silently.
10. **Project notes rough edges:** delete has no confirmation and takes the screenshot with it (services/project-notes.ts ~81); a screenshot can only be pasted, not picked from a file.

## Must not swallow
Header buttons, state words, pings, permission prompts showing as a waiting state, restart-killed rounds — all in "You always know what's waiting". Vocabulary renames — "Ready to publish".

## Ordering
Runs now, in parallel with "You always know what's waiting". Watch for overlap with it in threads/launch.ts and threads/host.ts. "Ready to publish" waits on this.

## Working agreement (made 2026-11-02)
Autonomous: the orchestrator carries this to merged without the human, merge included. Any design (design-mode screen) waits for the human's own yes on 2026-11-03 — this batch should need none. End with a review round as usual.

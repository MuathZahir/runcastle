# Outcome — Self-planning run fixes: skill pack read access, completion timeout, transcript and closing message

A headless self-planning run is refused when it reads its own skill pack's reference files, so it draws the preview by hand without the rules or the starter page. Seen on the first real run after 'Features plan themselves' merged (Claude Code, feature in another project, runcastle run from the global install): the run reported "The preview rules file can't be read here" and "I couldn't read the skill's preview rules or starter template (permission was refused)", then wrote preview.html by hand. The files are the ideate skill's references/preview.md and references/preview-starter.html, which carry the Check first group and the assumed marks. Suspected cause, read from the code and NOT reproduced: the launcher grants a session no read access outside its worktree. renderSettings (packages/server/src/launcher/artifacts.ts) allows only runcastle's MCP tools and git commands, and buildClaudeArgs (packages/server/src/launcher/runtimes/claude.ts) passes --plugin-dir but no extra readable directory; the skill pack lives outside the feature worktree, and in print mode (-p) there is nobody to approve the read. Confirm the cause first with a real headless run, then make every session able to read its own skill pack directory without a prompt: interactive sessions too, since a permission prompt for runcastle's own files is wrong there as well. Check the Codex adapter for the same gap. Expected: a self-planning run reads references/preview.md and the starter page and its preview is built from the starter (the Check first group comes from the starter's C list, not hand-written markup). Do not widen read access beyond the skill pack directory.

- Shipped: 2026-10-13
- Laps run: 1

## What shipped

11 commits · 13 files

### Lap 1
- 5 tickets landed: #1 A headless self-planning run is refused when it reads its own skill…; #2 complete_phase can time out on the caller's side, and a headless…; #3 The launcher's self-planning briefing shows in the feature's chat…; #4 A self-planning run's closing message reports things that have nothing…; #6 A docs checkpoint that fails after its feature is deleted now crashes the server instead of failing one tool call
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: d424f2c070b0eda4a3a8b7b5fea44e551103a1bb
- Landed since: 1
- Outcome: done

### Lap 1 · verification

- Reviewed commit: d350aa895bf103cf212515ebdbbe94da601fdffe
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 7. Verify the fixes that landed

Gates verification pass of pass #5 · 1 fix checked, 1 held · no new findings

The one fix that landed in this run, ticket 6, holds. Nothing else was broken in what this pass read.

## The fix that held

**#6: a docs checkpoint that fails after its feature is deleted crashed the server.** Fixed in `d350aa8`, in `checkpointDocsAfterReply` (`packages/server/src/mcp/server.ts`, lines 1064-1077 on the branch).

The `git.commit_pending` emit inside the after-reply `.catch` is now wrapped in try/catch. When the emit itself throws because the feature's rows are gone, the error goes to `console.error` and stops there, so the promise that nobody awaits can no longer reject. A checkpoint whose feature still exists reports on the timeline exactly as before. The change is 16 lines in that one function and touches nothing else.

Both ways of reaching the crash are covered by the same catch:

- **Deleted while the commit is running.** `commitDocsCheckpoint` catches the commit failure and tries to emit, which throws. That rejection reaches the outer catch, whose own emit throws too, and is now caught.
- **Deleted while the checkpoint is still queued.** `commitDocsCheckpoint` throws on its first line (`getFeatureRow`). The rejection takes the same route.

The reviewer's repro is now a test in `packages/server/test/mcp-docs-checkpoint.test.ts`: "a checkpoint that fails after its feature is deleted fails alone, not the server". It completes the ideation step, deletes the session, event and feature rows, fails the hung commit with `index.lock exists`, waits 20ms, and asserts that an `unhandledRejection` listener caught nothing.

The gate log shows the test doing what it claims. The file's 4 tests pass, and the test's stderr carries the new `console.error` line with both errors. The second error's stack is the emit inside the catch (`server.ts:1067`), which is the throw that used to escape as the unhandled rejection. The log has no unhandled rejection report.

## Gate results

The server ran both verify commands on `d350aa8`. This pass did not run them.

| Command | Result |
|---|---|
| `bun run typecheck` | passed: core, server and web exit 0, and the scripts `tsc` is silent |
| `env -u GIT_ASKPASS bun run test` | passed: 316 files passed, 2 skipped; 4506 tests passed, 46 skipped; 0 failed |

The baseline note for this project still says 118 files and 1768 tests. The count is out of date; nothing failed, so there is nothing to subtract.

## Still open, not from this pass

- **No real self-planning run has confirmed the read-access fix.** This is carried from pass #5. The fix reaches real runs only after the next publish and reinstall of the global package.
- **The server has no global `unhandledRejection` handler.** Ticket 6 closed this one path. Any other fire-and-forget promise that rejects would still end the process. This branch adds no other such site: `checkpointDocsAfterReply` is the only new `void ... .catch` in `packages/server/src`.
- **A checkpoint failure on a deleted feature is visible only in the server's console.** There is no timeline left to put it on, so this is the right place for it.

REVIEW-MODE: gates
REVIEW-VERDICT: verified
REVIEW-REASON: Ticket 6's fix read against its finding and confirmed by the gate run on d350aa8 (both commands passed, the repro test passes with no unhandled rejection); the read-access fix from pass #5 is still unconfirmed by a real headless run.

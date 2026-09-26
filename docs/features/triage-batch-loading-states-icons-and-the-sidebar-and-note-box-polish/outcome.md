# Outcome — Triage batch — loading states, icons, and the sidebar and note-box polish

The loading spinner never rotates: on the feature page, "Loading feature…" shows one still frame of the spinner (apps/web/src/components/Workspace.tsx:520 → Loading in apps/web/src/ui.tsx → Spinner in apps/web/src/ui/button.tsx, class animate-spin). Expected: it spins. Suspected cause, to confirm first: the global `prefers-reduced-motion: reduce` rule in apps/web/src/theme.css (~line 343) forces `animation-iteration-count: 1` and a near-zero duration on every element, which freezes an infinite spinner on a machine with Windows animation effects turned off. Fix it so a progress indicator still says 'working' under reduced motion (for example, exempt the spinner from the clamp, or swap in a slow opacity pulse under reduced motion). Don't just delete the reduced-motion rule. A screenshot of the problem is at .runcastle-attachments/pnote_qB7ud8TVO2Jy.png in your workspace — Read it before starting.

- Shipped: 2026-09-26
- Laps run: 1

## What shipped

15 commits · 17 files

### Lap 1
- 8 tickets landed: #1 The loading spinner never rotates: on the feature page, "Loading…; #2 Replace the feature page's "Loading feature…" spinner line…; #3 Opening a feature page takes noticeably long before the page shows,…; #4 The settings button in the footer looks almost identical to the…; #5 In the sidebar feature list, hovering a feature row shows its three-dot…; #6 The quick note composer (the jot-a-note popover with 'to runcastle', '↵…; #8 Feature-page loading skeleton is frozen still under reduced motion — ticket 1's fix no longer reaches the surface the human reported; #9 DESIGN.md §Motion not updated: the branch's two new motion exceptions are recorded only in STYLE.md, so the two docs now contradict each other
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: f1f0c87fefd3d61642212d89e6df6440ea314f58
- Landed since: 2
- Outcome: done

### Lap 1 · verification

- Reviewed commit: a29db3fa096cb60c3f7917ecea9bad165d5d04ec
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 8. Feature-page loading skeleton is frozen still under reduced motion — ticket 1's fix no longer reaches the surface the human reported

# ticket(8) — feature skeleton keeps pulsing under reduced motion

**What was done.** In `apps/web/src/components/workspace/FeatureSkeleton.tsx` I marked both `animate-breathe` elements `data-progress`: the main placeholder block and the topbar bone. The topbar bone now sits in its own `<span class="block animate-breathe" data-progress>`, because its outer span already carries the 300ms delayed fade-in, and one element can't run two animations from utility classes. Under `prefers-reduced-motion: reduce`, the existing `[data-progress]` rule in `theme.css` now swaps the clamped `breathe` for the endless 2s `pulse`, so the skeleton keeps saying "working" instead of freezing. I didn't change `theme.css`. I added a test to `apps/web/test/feature-skeleton.test.ts` that checks every `animate-breathe` tag in the rendered skeleton carries `data-progress` (it failed before the fix). I also updated the `data-progress` sentence in `apps/web/STYLE.md` to name the skeleton.

**Repro re-run.** I ran `git grep -n "data-progress" HEAD -- apps/web/src` again. It now lists FeatureSkeleton.tsx (lines 36 and 45) as well as button.tsx and theme.css, so the grep half of the repro no longer reproduces. I couldn't do the in-browser half (DevTools reduced-motion emulation) because this sandbox has no browser. The static-render test stands in for it.

**Verify.** `bun run typecheck` passed with 0 errors. The full `bun run test` run had 2 failures, and neither involves a file this ticket touches:
- `apps/web/test/settings-dialog.test.tsx` "reaches every page from every other": passed 18/18 when run alone, so it looks like a timing flake under load.
- `packages/server/test/dev-pane.test.ts` "kills the child process tree so the port-holder is not orphaned": also fails when run alone. It is a server process-tree kill check, which points to the sandbox environment. It isn't in the baseline, but this diff only touches `apps/web`, so it can't have caused it.

**Surprises.** Under reduced motion, `[data-progress]` swaps in `pulse` (dims to 0.32) rather than `breathe` (dims to 0.4). The skeleton therefore pulses a little deeper there than it breathes normally, which seemed acceptable.

**Left undone.** `DESIGN.md:177` still says motion is "transform and opacity only; everything honours reduced-motion" and doesn't mention the `data-progress` exception. That is the review's second fix ticket, so I left it alone. The drive machinery doesn't need changes: this ticket adds no service, env var, seed or process.

#### 9. DESIGN.md §Motion not updated: the branch's two new motion exceptions are recorded only in STYLE.md, so the two docs now contradict each other

# Ticket 9 — DESIGN.md §Motion now records the branch's two motion exceptions

**What was done.** I changed only `apps/web/DESIGN.md`, in commit 14bed782. The opening line of §Motion used to say motion is transform and opacity only and that everything honours reduced motion. It now names two exceptions. I also added two bullets after the Disclosure bullet:
- **Note field:** the jot-a-note field's height animates at `--dur-2` as it grows to fit its text, up to 160px, and then it scrolls.
- **Progress under reduced motion:** a `data-progress` indicator (the `Spinner`) swaps its rotation for a slow 2s opacity pulse instead of freezing.

I took the values from `theme.css:355` and `NoteCapture.tsx` (`FIELD_MAX_PX = 160`, `transition-[height] duration-(--dur-2)`). DESIGN.md and STYLE.md now agree.

**Repro re-run.** I ran `git show HEAD:apps/web/DESIGN.md | sed -n 174,210p`. The range is a little wider than the ticket's 174–202 because the new bullets push the text down. Both exceptions are now mentioned, and the opening line calls them out, so the repro no longer reproduces.

**Surprises.** Typecheck passed with 0 errors. The full test run was not the green baseline the brief promised:
- It failed 4 tests out of 4182, which is also a much larger suite than the 1768 the brief expects.
- The failures were in `dev-pane.test.ts`, `mcp-large-batch.test.ts` and `settings-dialog.test.tsx`.
- I re-ran those three files on their own. Only `dev-pane.test.ts` ("kills the child process tree…", `pidAlive(-pgid)` still true) failed again.
- This commit changes only a markdown file, and no test reads DESIGN.md, so none of these can come from it. They look like timing or process-reaping problems in the container.

**Left undone.** Ticket 7 found that the feature-page skeleton is still a completely still frame under reduced motion; the fix ticket for that is separate. If it gives the skeleton a reduced-motion pulse, DESIGN.md §Motion needs to say so too.

#### 10. Verify the fixes that landed

Gates verification pass — pass #7's two fix tickets (#8, #9)

Both fixes held. This project has no verify commands configured, so no gates were run. The pass read each fix diff against its finding on `feature/triage-batch-loading-states-icons-and-the-sidebar-and-note-box-polish`.

**#8 — feature-page skeleton frozen under reduced motion: held.**
- The repro's grep half no longer reproduces. `git grep -n "data-progress"` on the branch now lists `FeatureSkeleton.tsx:36` and `:45` alongside `ui/button.tsx` and `theme.css`.
- Both `animate-breathe` elements are now marked `data-progress`: the topbar bone and the main placeholder block.
- The topbar bone was moved into its own inner span. That keeps the outer span's 300ms delayed `animate-fade-in` separate from the pulse, so neither animation overrides the other.
- Under `prefers-reduced-motion: reduce`, `theme.css:355` gives `[data-progress]` an `animation: pulse 2s … infinite !important`. That rule outranks the `*` clamp on specificity, and `@keyframes pulse` exists (`theme.css:296`), so the skeleton keeps pulsing instead of freezing.
- The new test in `apps/web/test/feature-skeleton.test.ts` checks that every `animate-breathe` tag carries `data-progress`, so this can't quietly regress.
- The in-browser half of the repro (DevTools reduced-motion emulation) was not run, because this pass was Gates mode.

**#9 — DESIGN.md §Motion out of step with STYLE.md: held.**
- §Motion's opening line now says motion is "transform and opacity only, bar the two height animations below" and that it honours reduced motion "bar the progress pulse below".
- New "Note field" and "Progress under reduced motion" bullets follow the Disclosure bullet. Their values match the code: `--dur-2`, 160px, a 2s pulse.
- DESIGN.md and STYLE.md no longer contradict each other.
- One small lag, not a defect: DESIGN.md's progress bullet gives only "the `Spinner`" as its example, while STYLE.md also names `FeatureSkeleton`'s breathing bars. DESIGN.md's wording is general ("a progress indicator marked `data-progress`"), so it stays correct.

Nothing broken was found in the surfaces these fixes touched. No findings were reported.

REVIEW-MODE: gates
REVIEW-VERDICT: verified
REVIEW-REASON: no verify gates configured; both fix diffs read against their findings and both held

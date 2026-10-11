# Outcome — Plan preview

Every plan ends in a self-contained HTML preview (prototype, flows, use cases) shown on the feature page beside Burn, so the human reads the feature by looking at it.

- Shipped: 2026-10-11
- Laps run: 1

## What shipped

11 commits · 28 files

### Lap 1
- 3 tickets landed: #1 Skill pack: planning sessions draw the preview; #2 Feature page: show the preview at planning; #4 Escape doesn't close the full-window preview after the human clicks anything inside it
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 0894795e587b965d30c81f030a098a36cd3c28b0
- Landed since: 1
- Outcome: done

### Lap 1 · verification

- Reviewed commit: dc8e4a2868db90e8ad256ca7262fb647589a3218
- Landed since: 0
- Outcome: done

- **Gate test run at dc8e4a2 fails on the same three tests outside this lap** — open

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 4. Escape doesn't close the full-window preview after the human clicks anything inside it

## What was done
Fixed Escape in the full-window preview dialog once focus is inside the sandboxed frame. `previewDocument` (apps/web/src/lib/preview-frame.ts) now also adds a small relay script after the doctype, next to the policy and theme line. On a keydown Escape that the preview did not `preventDefault`, it calls `parent.postMessage('runcastle:preview-escape', '*')`. The message is exported as `PREVIEW_ESCAPE_MESSAGE`. `PreviewFrame` (apps/web/src/components/PreviewPanel.tsx) takes an optional `onEscape` and listens for window `message` events. It acts only when `event.source` is its own iframe's `contentWindow`. Only the dialog's frame passes `onEscape`, so Escape inside the inline frame does nothing. The sandbox stays `allow-scripts` and the CSP is unchanged: postMessage is not a network request.
Tests: I updated the literal expectations in preview-frame.test.ts. I added a test to preview-panel-dialog.test.tsx: a relay message from another window is ignored, and the same message from the frame's own `contentWindow` closes the dialog.

## Repro re-run
I could NOT re-run the drive repro: the sandbox has no browser (no Playwright or Chromium) and no app. I checked the fix only through the unit tests above, in happy-dom, which simulate the posted message rather than a real keypress in a cross-origin frame. Next step: open full window on a feature that has a preview, click tag "6", and press Escape.

## Surprises
The full suite has 2 failures: readme.test.ts (prerequisites wording) and dev-pane.test.ts (process-tree kill). Both are pre-existing and were reported by ticket 3's review; they are unrelated to this change. Typecheck is clean.

## Left undone
- The relay listens on `window` in the bubble phase. A preview that handles Escape with its own *window*-level listener added later in the page cannot cancel the close, but document- and element-level handlers can. No current preview handles Escape.
- Drive machinery: nothing needed (no new service, env var, seed or process).

#### 5. Verify the fixes that landed

Drive verification pass — pass #3's one fix holds: Escape now closes the full-window preview after you click inside it

**Fix #4 (Escape in the full-window preview): held.** I drove the branch at `dc8e4a2` on runcastle-demo. I put this feature's own `preview.html` into the docs of the planning feature "Realtime team collaboration" (10 tickets, so the ticket list sits below the panel). The file was removed afterwards. Then I ran the repro exactly:

- I opened "Open full window", clicked numbered tag **6** beside the mocked "Preview" heading, and decision 6 opened inside the frame. Keyboard focus was in the frame (the page's active element was the `IFRAME`). Then I pressed Escape. **The dialog closed** and focus went back to the "Open full window" control.
- Pressing Escape right after opening, without clicking inside, still closes the dialog.
- Clicking blank space in the preview and then pressing Escape also closes it.
- The Close button still closes it.
- Clicking tag 6 in the inline frame and pressing Escape opens nothing and breaks nothing. Only the dialog's frame responds to Escape, as designed.

I read the fix: a small script in the frame posts a message to the app when Escape is pressed, and the app accepts it only from its own frame. Both the inline and dialog frames still have `sandbox="allow-scripts"` and nothing else. The content policy is unchanged.

**Rest of the tour.** The Preview panel leads the Overview at planning, under the Burn row and above the ticket list, with "updated 1m ago" and the full-window control. The preview's scripts ran (the decisions list expands). Nothing on the tour was plainly broken.

**Gates.** Typecheck passed. `bun run test` failed on three tests:
- the README prerequisites wording check
- the dev-pane process-tree kill
- the burner env test that fails when the gate sandbox has an OAuth token in its environment

None of these files changed on this branch, and pass #3 saw the same three failures. So they did not come from this lap, but the prompt's "fully green" baseline is out of date. The burner test printed the real OAuth token into the gate log again; rotating it is still recommended. I recorded this as one observation.

**Drive notes.** The drive's data dir has no talk worktree for the demo features, so the server read the docs from the runcastle-demo main checkout. The first `stop` call timed out, and a second one stopped the drive cleanly. The checkout is back on its own branch with a clean status. Recording: `walkthrough.webm`.

REVIEW-MODE: drive
REVIEW-VERDICT: verified
REVIEW-REASON: fix #4 held in the drive: Escape closes the full-window preview after clicking tag 6 inside it

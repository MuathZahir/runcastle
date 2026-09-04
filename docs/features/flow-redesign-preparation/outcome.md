# Outcome — Flow redesign: preparation

Redesign the get-this-project-ready flow end to end — PreparationWorkspace, the prepare/re-prepare nudges and findings display — walked and confirmed with the human before design.

- Shipped: 2026-09-04
- Lap: 1

## 1. Stamp establishedSha at record_finding so staleness fires

What was done

The preparation `record_finding` handler now resolves the project’s detected main branch and stamps its current HEAD SHA server-side before writing provenance.
Both session-derived and `userSupplied`/human findings receive the stamp, while the MCP input schema remains unchanged.
Repository inspection failures degrade to an unstamped finding instead of failing or losing the write.
The MCP registration now awaits the asynchronous handler.
Tests drive a real temporary git repository through record_finding and listFindings, proving a fresh distance of 0 and an aged distance of 1 after a main-branch commit.
Tests also cover human-source stamping and the unavailable-repository fallback.

Surprises

The repository-wide suite had nine unrelated environment failures: seven cache-slot fixture paths were rewritten under the burner cache mount, one process-tree teardown assertion failed, and one test inherited the host Claude token. The focused 32-test seam suite and full monorepo typecheck passed.

Left undone

No web staleness guards or Settings behavior were changed; those remain outside this ticket. No drive machinery change was needed because this adds no service, boot variable, seed, or companion process.

## 2. Preparation workspace: actions first, evidence collapsed, one-sentence copy, Tailwind

What was done
The prepared preparation state now puts its reason and Resume/Start fresh actions before Established findings.
Finding evidence is clamped to three lines by default and expands or collapses independently, while key, badges, and provenance remain visible.
The unprepared and prepared launch explanations now use the two locked one-sentence descriptions.
PreparationWorkspace and the Sidebar preparation nudge now use Tailwind theme-token utilities.
All legacy `.prep-*` and `.pw-*` rules were removed and the stylesheet ratchet was lowered to 4,004 lines.
Because the `.pw-*` rules also styled ProjectWorkspace, those existing callers were migrated to equivalent utilities to prevent a regression.
Component tests cover ordering, both copy contracts, and evidence expansion; all 30 web test files (650 tests) pass, and root typecheck passes.

Surprises
The full monorepo suite had 12 environment-sensitive server failures: missing temporary burn-slot repositories, one lingering process group, and an inherited Claude OAuth token; 2,509 tests passed.

Left undone
Settings and its shared badge styles were deliberately untouched, as required; no new drive infrastructure was introduced, so `.runcastle` scripts needed no change.

## 3. Review: drive the redesigned preparation flow

Reviewed in Drive mode: walked the app against the acceptance criteria.

This lap turns the preparation page from a wall of the agent's notes into a page that leads with the decision you came to make. On a project nobody has prepared, the sidebar now carries a permanent row at its foot reading "Prepare this project" with a count of how many repo facts are still unestablished, and the page itself says in a single sentence what pressing the button actually does — it opens a terminal session with an agent, here in this pane, in your own checkout, running this repo's commands and asking you the rest. The chips above it name the seven facts that are missing, so you can see the size of the job before you start it.

The bigger change is on a project that has already been prepared. The rail row becomes "Re-prepare the project", and the page opens with the title, when it was last prepared, and Resume and Start fresh sitting right there — all of it above the fold, where before the two buttons were roughly ten screens down behind the agent's evidence. The evidence has not gone anywhere: it sits below in an "Established" frame, one row per fact with its key, its badges and a plain-English line about where the value came from, and each blob of raw command output collapsed to three lines with a per-finding expand. Expand and collapse both work. Ctrl+K and the word "prep" still surface the Preparation row, and picking it takes you to the page without launching anything, as intended.

What that means for you: re-preparing a repo is now something you can find and act on in a couple of seconds instead of scrolling for it, and the established facts are readable as a list rather than as an essay. Two things are worth your attention before you sign it off. Every collapsed evidence box paints a sliced half-line of text below the clamp, in the box's bottom padding — it reads as a smear of clipped letters along the bottom edge of each finding, and it shows on every finding with more than three lines of output. And one sentence in the prepared card, the one explaining Resume versus Start fresh, is still set in the terminal typeface while the sentence directly above it is in the body font, because a pair of old stylesheet classes survived the move to the new tokens. Neither breaks anything; both are the kind of thing you notice immediately and then cannot stop noticing.

Three things I could not settle. Staleness is the headline server-side fix of this lap and it is the one thing a drive cannot exercise — you cannot land a hundred commits in a review — so I confirmed the other half instead: with nothing stale, each finding simply says "main has not moved since", which reads fine and leaves no hole where a warning would be. The light theme is unverifiable from here, because the only theme control lives in Settings and this ticket puts Settings out of bounds. And I started a real preparation session to see the live terminal state, which rendered correctly, but then could not end it by clicking "End session" — a scripted click on the same button ended it at once. My browser's coordinate mapping went wrong at the same moment, which would explain it entirely and innocently, so I have logged it as something for you to check by hand rather than as a bug; it is thirty seconds of your time and it is the control that stops a running agent.

One disclosure about how the prepared-state findings were reached: the drive boots an empty database, so the unprepared walk is entirely real but the prepared state was reached by writing findings straight into the drive's throwaway database rather than sitting through a full preparation conversation. The data behind those screens is mine; the rendering is the app's.

## 4. Collapsed evidence renders a sliced half-line of text below the clamp

What was done
Separated each finding's padded evidence box from its three-line clamped text node.
The clamp now owns no vertical padding, so hidden fourth-line glyphs cannot paint into a padding band.
Kept the existing tokens, dimensions, typography, expand/collapse behavior, and full evidence text.
Added component coverage that pins the padding outside the clamped element.

Surprises
The production CSS correctly emits the inner clamp as `display: -webkit-box` with hidden overflow.
I re-ran the reported repro at the available rendered-component/build seam: the clamped node has no padding, its parent retains 5px padding, and the sliced fourth-line path is gone.
The sandbox has no runnable app/browser, as the burn instructions note, so an interactive click-through was not possible here.
Typecheck, the focused PreparationWorkspace test, and the production web build passed.
The full suite passed the preparation tests but had unrelated server fixture/environment failures involving shared temp repos, process cleanup, and an inherited Claude token.

Left undone
No Settings, test-drive, server, drive-script, or unrelated preparation styling was changed.

## 5. Prepared state's Resume/Start-fresh explainer renders in monospace, unlike its sibling copy

What was done
The prepared-state Resume/Start fresh explainer now uses the same proportional body-text utilities as the prepared-when prose above it.
Removed the `DimLine` call site, eliminating the legacy `dim-line mono` hooks and Tailwind `font-mono` utility from this product sentence.
Strengthened the existing preparation component test to pin the explainer's complete body-text class contract.
Committed the green slice as `79acb16 ticket(5): use body type for preparation explainer`.

Surprises
The exact repro was re-run at the component seam: before the fix it reported `dim-line mono py-0.5 font-mono text-sm text-text-3`; after the fix it reports `max-w-[52ch] text-sm leading-6 text-text-3`, with no mono request.
The sandbox has no running app or services by design, so the browser-console form of the repro could not be driven here; the rendered DOM class assertion exercises the same element and condition.
Typecheck and the focused preparation workspace test passed.
The full suite was not green as promised: 12 unrelated server tests failed because temporary slot repositories disappeared, a process group remained alive, and a host OAuth token affected an environment-sensitive assertion; 2,511 tests passed.

Left undone
No shared `DimLine` or legacy stylesheet rules were changed because they remain intentional hooks for other, out-of-scope surfaces.
No drive machinery changed because this typography-only adjustment adds no service, boot variable, seed, or companion process.

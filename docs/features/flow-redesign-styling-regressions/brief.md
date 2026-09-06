# Flow redesign styling regressions

## Ticket 1

Native element reset: Tailwind preflight is deliberately NOT loaded (apps/web/src/theme.css:18-19 imports only theme+utilities; see the comment there explaining why), and the compensating global rule at apps/web/src/styles.css:98 only sets font-family and color on button — no background/border/appearance — and there is no select reset at all. Result: every raw <button>/<select> without an explicit bg class renders with browser-default white chrome. Extend the global reset: button gets background:none, border:none (or 0), appearance:none, padding:0 as appropriate; add an equivalent themed select reset. Respect theme.css's stated reason for excluding preflight — do not import preflight wholesale. Verify the three known-broken surfaces render themed afterwards: project-page conversation list rows (raw <button> in apps/web/src/components/project/ConversationList.tsx:46), the pipeline-stepper phase pills on the feature header, and the 'landing on main' / 'from main' branch pickers. Sweep for other raw button/select usages that were relying on this reset and check none regress (buttons that WANTED default padding, etc.).

## Ticket 2

Feature header clipping: on the draft feature view the header is clipped at both edges — the left descriptive text ('Start cuts its branch, writes the brief…') is cut off mid-word at the left edge and the Start button + 'from main' picker are cut off at the right edge; on the shipped feature view the title row is clipped at the top of the viewport. Fix the redesigned feature titlebar/header layout (overflow, positioning, padding) so all header content fits and nothing renders off-canvas at normal window widths.

## Ticket 3

Shipped view empty-walkthrough placeholder: when no walkthrough was recorded, ShippedBody (apps/web/src/components/bodies/ShippedBody.tsx) renders the 'No walkthrough was recorded for this feature — the review reported without driving.' message inside a full-height empty stage box, leaving a screen of dead space between the hero card and the stat chips at the bottom. Collapse it: when there is no walkthrough, show a compact one-line placeholder and let the content below move up; only render the full-height stage when there is actual walkthrough media to play.

## Ticket 4

Settings overlay scrolling is inconsistent per tab: the 'This project' tab scrolls but the scroll area ends short — the last field (After a test drive) is cut off at the bottom with no way to reach past it (missing bottom padding/inset on the scroll container); the other tabs (General, Models, Burns) do not scroll at all — content past the panel height is simply cut off. Give the settings panel body one consistent scroll container shared across all tabs, with proper bottom padding so the last control is fully reachable, and verify every tab at a short window height.

## Ticket 5

Sidebar selected-feature styling: remove the purple left-border accent line on the selected feature card in the features rail — replace the selected state with something subtle and consistent with the rest of the theme (background tint and/or border treatment like other selected surfaces in the app). While there, do a light polish pass on the rail cards — spacing, the checkmark chip, the progress-dash row — for visual consistency only; do NOT restructure the sidebar layout or change what the cards display.

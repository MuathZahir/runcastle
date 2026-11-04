## Purpose
The human (2026-11-04): "I feel like we have many different shades for gray colors.. it's not very consistent. I want to unify (for example, the gray on the tool calls and the gray on the left sidebar look different). I want to make these colors darker and a touch more bluish maybe. I feel like it would make the UI look more premium."

## What the orchestrator found (apps/web/src/theme.css, dark values)
- Every colour already comes from tokens, so the mismatch is the token ladder itself.
- **Text greys are too many and too close:** `--color-text-secondary #a2a8b9`, `--color-text-tertiary #8a91a5`, `--color-icon #8990a4`, plus `--color-text-disabled #4b5163`. Secondary and tertiary are one small step apart, so they read as "a slightly different grey" rather than "less important". The tool-call lines ("Worked for…", the "Feature worktree · …" line) use tertiary, and much of the sidebar uses secondary. That's the mismatch the human saw.
- **Grounds:** canvas (sidebar) `#0a0c11`, surface (content) `#10131a`, inset (code, inputs) `#0c0e14`, raised (menus, dialogs) `#161a24`, borders `#222837` / `#333a4d`, plus translucent hover/selected/card/well fills mixed from the text colour. Already slightly blue.

## What the human agreed
- **Fewer, clearly distinct text greys.** The orchestrator recommended two (secondary; muted, which also covers icons) plus disabled. The feature's own grill settles the exact set.
- **Darker and a touch bluer** grounds in the dark theme. Keep the hierarchy (sidebar vs content vs inset vs raised) legible.
- **Sweep** any component that bypasses the tokens (raw hex, rgb, opacity-tinted text) so everything uses the new ladder.
- The light theme gets the same ladder simplification. Whether it shifts bluer is this feature's call.

## Design stop
The exact shades are the human's taste. Show the app before and after side by side on one design page, in both themes, with the screens where the mismatch shows (orchestrator chat with tool calls, sidebar, a feature page with the panel, a dialog/menu). Record the designs with `show_design` so they appear in the Design tab, and wait for the human's own approval.

## Must not swallow
Layout, spacing, type scale, accent and status colours, and component redesigns: greys and grounds only. The end-of-chat waiting line (removed by the sibling small-fixes feature).

## Ordering
Runs now. "Ready to publish" may merge first. It recaptured the README screenshots and banner using a preview page (apps/web/preview/readme-shots.html). Once this lands, retake those pictures with the new colours (that page makes it cheap), as part of this feature.

## Working agreement (2026-11-04)
Plan and design headlessly, then stop for the human's own look at the designs. After their approval, the orchestrator carries it through rounds, review and merge. End with a review round as usual.

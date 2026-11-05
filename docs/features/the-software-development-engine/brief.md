## Purpose
Two fixes to the landing page (`site/index.html`), from the human on 2026-11-05.

1. **The Windows install button does nothing.** In the closing "Start building." section, the platform selector ("macOS and Linux" / "Windows") does not switch: clicking Windows leaves the button unhighlighted and the command stays `curl -fsSL https://runcastle.dev/install.sh | bash`. Expected: Windows highlights and the command (and what Copy copies) becomes the PowerShell one-liner for `site/install.ps1`. The buttons are `data-on-click="setWin"` / `setUnix` with `data-b-class="[[winCls]]"`; `site/landing.js` defines `winCls`, `setWin` around line 481. Find why the binder does not apply it (the hero's install chip may share the same state and need the same fix).
2. **New hero headline.** Replace "The IDE for agents.<br>You make the calls." with exactly **"The software development engine."** and **remove the subtitle paragraph under it** (the human: "The software development engine is a hook. The rest of the landing page already explains the idea well"). Keep the install chip and scene.
   - Update `<title>`, `og:title`, `twitter:title` to "runcastle - the software development engine".
   - `description` / `og:description` / `twitter:description` become: "Stop juggling prompts, branches and terminals. runcastle runs every step from idea to merged branch, and only stops for your decisions."
   - The `og:image:alt` text mentions the old headline; update it. `site/assets/og.png` is a capture of the top of the landing page, so recapture it after the headline changes.
   - The JSON-LD structured data block in `<head>` may carry the old tagline; update it.

## The pitch (shared, settled by the human in the project session)
runcastle is **the software development engine**: it runs the software process for you (cut the idea, plan, design in your real app, build in sandboxes, review, test drive, merge), where other tools hand you an agent and leave the process to you. The moat is streamlining the process and making the developer's life easier, not code safety. The docs and compare features use the same pitch.

## Must not swallow
The docs pages (`site/docs/`) and compare pages (`site/compare/`) belong to two sibling features running in parallel. Do not touch them, `styles.css` or `content.css`. No other landing copy changes.

## Understood / constraint
`site/index.html`, `landing.css` and `landing.js` are GENERATED from a Claude Design canvas by `scripts/port-landing.mjs` (see `site/README.md`): "Do not hand-edit the generated files: change the canvas and run the port again." Only the `<head>` between the two "page head" comments is hand-written. So both changes should land in the canvas ("Runcastle Landing Refresh", artboard `project/Main.dc.html`) and be re-ported, if the agent can reach the canvas (try the DesignSync tool). If it cannot, hand-edit the generated files and record in decisions.md exactly what the human must also change in the canvas, so the next port does not wipe the fixes out; the orchestrator will relay it.

## Open
- Whether the hero still balances visually with the subtitle gone (spacing). Agent's judgement; show a screenshot in review.

## Ordering
No dependencies. Runs in parallel with "Docs for runcastle as it is today" and "Compare posts that sell runcastle". Deploying runcastle.dev happens after all three merge; the orchestrator does it.

## Working agreement (cut of 2026-11-05)
Autonomous: the orchestrator carries this to merged, merging when the feature's own review is clean, and the human comes back at the end. The human chose this. The orchestrator deploys runcastle.dev after the three website features merge.

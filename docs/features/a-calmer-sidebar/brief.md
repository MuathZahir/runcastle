## Purpose

The human finds the sidebar's epic block hard to read. In their words: "the things that need my attention and the others that are working are very close together and they blend in. I want it to be better designed. Maybe the ones working are collapsed or hidden somehow." And: "the 'Needs you. Ready to test. ...' is too much text for no real reason, I can't read anything since it's too long. Why do we even need the 'waiting for you' reason? Same for the worker nesting under the features. The design still needs some work so there's a good visual hierarchy and keep it looking professional and polished (minimize text)."

Their screenshot (2026-11-16) is at /tmp/claude-1001/-home-muath--runcastle-worktrees-proj-u3T1Bff2-S2D---project/6ae274eb-2880-48c8-ab15-290f51d248c3/images/1.png. It shows the "Notes Triage" epic with five feature rows. Two read "Needs you · Ready to test · A lead runs a …" and "Needs you · Ready to test · Pick Fable 5.2…" with only a small orange dot setting them apart. Working rows read "Working"/"Idle" in the same style. One feature is expanded with "2 done" workers nested under it.

## Decided with the human (2026-11-16)

- What: a redesign of the epic block in the sidebar with a clear visual hierarchy. Rows that need the human stand out. Working features are folded away or quieted (the orchestrator suggested one quiet "3 working" line you can open, rather than hiding them, so work is still seen moving; the human's own idea was "collapsed or hidden somehow", so settle it in the grill). Minimal text, professional and polished.
- The agent's waiting reason leaves the sidebar row; the feature's chat already shows it. Workers nested under a feature shrink to something minimal, such as a count.
- Where: the sidebar's epic block: feature rows, their status lines, workers nested under features.
- Who: the human, scanning the sidebar for what needs them.
- The human said "Alright" to creating this as one feature planned with them, with designs to approve before building.

## Understood

- The status line format "Needs you · Ready to test · <scenario>" came from `needs-you-is-the-agent-s-call` (decision 8); the "With the orchestrator · <their words>" form from `the-status-tells-the-truth-about-who-and-what`. Workers nested under features came from `workers-nest-under-their-feature` (shipped 2026-11-16). This feature changes how the sidebar shows those, not what the states are.
- Styling: `apps/web/STYLE.md` and `apps/web/DESIGN.md`.

## Must not swallow

- Changing what states a feature can be in, or when "needs you" is set.
- The rest of the app (feature page, chat, project rail), beyond what the sidebar change forces.

## Open (for the grill)

- Fold the working features into one line, quiet them in place, or hide them.
- What a row says at all: status word only, or an icon.
- How workers show under a feature, if at all.
- Where the full reason shows, if anywhere besides the chat (e.g. on hover).

## Ordering

Independent.

Planning mode: with you

# Flow redesign: build, review, and ship — map

## Destination

The feature's second half — burn/run view, review landing, test drive, walkthrough player and annotation, notes triage, laps, merge and conflict, shipped view — redesigned end to end on the foundation's tokens and primitives, with the walkthrough-video annotation loop (annotate → note → fix-ticket → next lap) working perfectly, and the last of `styles.css` deleted.

## Notes

Locked so far (see decisions.md): (1) the video + annotation loop is the priority — the human's complaint is that it "doesn't work well and isn't very user friendly" and they want it to work perfectly; no other area trades against it. (2) Ideation is mapped: research → three serial walks writing flow-map.md → confirm the map with the human → one grilling per area → code shape / CSS retirement → converge.

Constraints from the brief: reflect, don't change, the burner/review workflows (packages/server/src/workflows/*, ADR-0002/6/7/8) and the skills; server bugs found on this path (e.g. reviewOutcome/reviewWalkthroughUrl/reviewChecks picking across laps while lapAccount is lap-scoped) are fair game. Do not swallow flow 6 (ideation/spec/tickets), the shell (flow 2), or preparation (flow 4). Land last of the three Workspace.tsx-touching flows — neither project-shell nor flow 6 is on main yet as of 2026-09-03; the converge session must check before cutting tickets. Code quality of this flow's files is in scope (ReviewBody.tsx, 971 lines, is the obvious split); this flow deletes what remains of styles.css (3337 lines at charting). Prior flows' pattern to follow: flow-map.md written from an agent-browser walk, confirmed with the human as decision 1, visual bar as in flow-redesign-onboarding-and-project-chooser decision 1 and the spacing rhythm of flow-redesign-project-chat-and-creation-doors decision 9.

## Not yet specified

## Out of scope

- Claude Code's "trust this folder" prompt on spawned sessions (lap, resolve-conflict, drive-fix, Q&A) — the human hit it only once, not routinely; parked in decision 28, revisit if it recurs.
- Distinguishing a text-only annotation from a drawn one in the notes list — the bare-frame PNG makes the note real evidence either way (decision 28).

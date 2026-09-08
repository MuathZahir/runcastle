# Review arrival is legible

## Problem

Landing on a feature's review page does not read in one glance. The primary button (Iterate) leads for a reason the page never states, so the human stares at it expecting Merge & ship. Clicking Iterate can dead-end on a disabled button ("end the live session first") with no way to do that from where they stand. A terminal panel for a session from an earlier phase — sometimes an *ended* one — squats above the fold on a page whose contract is to open on evidence. When no walkthrough exists, the largest element on the page is an empty 16:9 box containing one apologetic sentence. Observations mix genuinely vital signal (a fix that landed but is never called) with inert trivia at equal, barely-visible weight — the important kind misfiled there by a defect definition anchored to acceptance criteria instead of outcomes. And when the human does iterate, the next lap's agent session arrives ignorant of the very notes and defects that motivated it: carried notes travel as a distrusted pointer to a file the MCP context marks withheld with a false reason, open defects travel through no channel at all, and a note the next lap skips vanishes forever.

## Approach

One design pass over the review arrival plus the two channels that feed it (the review agent's finding taxonomy, and the carry channel into the next lap). Eight locked decisions (see `decisions.md`); the shape:

**Finding taxonomy (decisions 1–2).** The review agent's prompt redefines `defect`: a finding is a defect when *the human's problem is not actually solved*, even if every acceptance criterion passes — the canonical case being a fix that is correct at its seam but unreachable from the surface the human looks at. Prompt-only; `FindingKind`, the cap, and the fix-ticket pipeline are untouched. What remains in the observation bucket is by construction inert and is demoted to the bottom disclosure — no count, no line on arrival.

**The bar states its reason (decision 3).** The one-door priority ladder stays (conflict → drive → open work → pending fixes → merge), but the bar's permanent one-liner becomes the open-work count — "2 defects · 1 note open" with Iterate primary and Merge & ship as ghost; "Nothing open" with Merge & ship primary when clear. The guidance-gated explanation paragraph and the vague "Answer what is still open" title are deleted.

**One-terminal refusals become compounds (decision 4).** No surface renders a button disabled by the one-terminal gate. Every such action relabels to "End session & <verb>" and, on click, awaits the end-session mutation then proceeds — the pattern the conflict flow already ships. No confirmation dialog; the label is the consent. Blanket rule: the triage carry exit, the bar's Iterate/start-lap action, and any other one-terminal refusal found during implementation, on any page.

**No terminal on review (decision 5).** The session panel band leaves ReviewBody. A live session of any kind shows as one slim line in the alerts band ("Ideation session still live — Open · End"); an ended session renders nothing. The readonly omission (live controls in history views) is fixed in passing.

**The stage mounts only with evidence (decision 6).** No walkthrough and no live drive → no stage, no placeholder. The test-drive entry point survives as a compact control in the state line.

**The carry channel states the work (decision 7).** The lap kickoff line and injected system prompt name the carried work — counts and an instruction, no "may not exist yet" hedging. The feature-context payload stops withholding the test-notes doc whenever carried-undone notes exist. Open defects travel too: their structured rows (title, location, detail, repro step) join the new session's context. All pointers key on note *status* (carried, not done, any lap), never a lap-numbered section, so skipped notes stay visible in later laps. The lifecycle rule that carrying removes notes from open work is untouched.

**The arrival layout (decision 8).** ReviewBody's band order: (1) alerts only when real; (2) one state line — status chips, the unverified-checks caveat as a chip when it applies, the Test drive control; (3) a one-line lap account, which the review agent's prompt is amended to emit (and the prompt stops promising the full digest renders first — the digest is the long account behind the disclosure); (4) the attention list, the visual center; (5) the note composer; (6) one collapsed "Full account" disclosure holding digest prose, carried/handled, and observations. Killed: the test-drive lead sentence and explainer paragraph, the bar's guidance paragraph, the placeholder box, the terminal band. Validated by the prototype at `prototypes/review-arrival-prototype.html` (four states: open work, stale session, walkthrough, all clear).

## Seams

- **The next-step derivation** (existing) — the pure function that maps review context (open counts, live session, conflict, drive state, later laps) to the bar's primary/secondary/one-liner. Decision 3's count line, the flipped primaries, and decision 4's compound labels are all observable here without rendering anything.
- **ReviewBody's band composition** (existing, component-test tier) — which bands mount in which state: no terminal band ever, alert line only with a live session, stage only with a recording or live drive, disclosure holding observations. The prototype's four states are the test matrix.
- **The end-and-proceed compound** (existing precedent, extended) — the awaited end-session-then-launch sequence, observable at the tRPC mutations: after the compound, the old session row is ended and the new lap's session exists. The server-side one-terminal guard stays as the backstop.
- **The feature-context MCP payload** (existing) — with carried-undone notes: the test-notes doc is not withheld and open defects appear with their structured fields; without: current behavior. Observable as pure payload assertions.
- **The launch artifacts** (existing) — kickoff line and system prompt for a lap-N+1 session name the carried counts and instruction; pointers reference status, not lap sections.
- **The review agent prompt** (existing content, no runtime seam) — the defect definition, the one-liner lap account requirement, and the corrected digest-placement promise live in the burner prompt pack; verified by prompt review, not tests.

## Out of scope

- The walkthrough player and annotation loop internals.
- The review agent's fix-burn machinery, the finding cap, and `FindingKind`'s schema (the defect *definition* changes; the kinds do not).
- The run view and burn lanes.
- Any other phase's page.
- The note lifecycle rule that carrying removes notes from open work (prior decision 27b stands).

## Open questions

- Exact copy for chip labels, the alert line, and compound button verbs — implementation follows the prototype's copy but may adjust for width; the *structure* (count-states-the-reason, label-is-the-consent) is locked.

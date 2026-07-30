# Identify Random Issues Throughout the System

## Problem

Users get stuck in runcastle, and the app sometimes lies to them. Three user-reported bugs seeded a full UX audit: preparation vanishes once completed with no visible way back; clicking Rethink starts a lap whose ideation agent implements code instead of grilling (the lap loop never reaches review); and clicking Rethink during a test drive wedges the feature in a state no UI action can undo. The audit (two agent-browser instances — a fresh new-user environment and a read-only copy of real data — plus code-level root-causing) confirmed all three, found their shared root causes, and surfaced a wider set of the same classes of problem: irreversible one-click actions, phase flips committed before the work they exist for succeeds, status surfaces that show wrong data in reassuring colors, a first-run experience that never explains the product, and one corrupt row that blank-screens the whole app.

The full evidence — 25 findings (4 blockers, 15 majors, 3 minor bundles, 4 notes), each with severity, repro, root-cause citations, and screenshots — lives in `findings.md` beside this spec. The human reviewed and approved the triage and the eight-ticket shape without changes (decisions.md §8).

## Approach

This feature ships the fixes. Each ticket groups findings that share a root cause or surface. From the user's perspective, after this lands: a lap started from review actually grills, specs, and tickets again; invalid actions are disabled with a reason instead of failing halfway; every state the user can reach has a way out; the review screen tells the truth before the irreversible click; preparation stays reachable forever; and a newcomer's first five minutes explain themselves.

The work divides into four strands:

**1. Lap-loop integrity (blockers F2, F3, F4; majors F5, F6).** The broken invariants: *a session's first instruction is delivered before the agent acts, and its injected prompt agrees with that instruction*; and *a phase/lap flip is not committed until the session it exists to open has actually started*. Fixes: an Iterate (né Rethink) launch stops resuming a prior conversation when it carries an explicit lap kickoff — a fresh session whose briefing is the opening move eliminates the `--resume` chooser that swallows it; kickoff delivery stops treating a resumed transcript's own first prompt as "the human typed first"; the revisit system prompt becomes lap-aware independent of the already-flipped phase, drops its "never complete_phase" rule when a lap is running, states plainly that talk sessions do not write code, and backs that with a permission-level edit deny for non-project session kinds. Iterate refuses to start while the feature's test drive holds the branch (same guard shape merge already uses), the UI disables the action with the reason while driving, and the route becomes transactional — launch failure restores phase and lap and records the aborted lap. The same commit-after-success pattern is applied to converge and burn's loop-back. Gates G1/G2 and the ideation next-step become lap-aware so a lap-N feature can never silently advance on lap-1 artifacts. Kickoff recovery keeps the real briefing instead of degrading to a generic line, and an undelivered kickoff is surfaced where the user is looking.

**2. Truthful status surfaces (majors F8, F21, F22, F23, F24).** The review summary sources its commit count from git and colors honestly (missing run and zero-done tickets are not green); the next-step bar yields to a recorded merge conflict; Merge & ship gains a lightweight confirmation that summarizes what is about to merge — the pipeline's most irreversible action should not have less friction than deleting a throwaway feature; a test drive with no dev command says so instead of claiming "driving now"; gate override states its consequence ("moves this feature to review") before Apply and gains an undo.

**3. Resilience and reachability (blocker F19; majors F1, F7, F9, F14, F20).** A feature-level error boundary so one unrecognized row degrades to a readable message instead of a blank app, with tolerant phase parsing. Preparation becomes a permanent resident: the rail's foot row renders unconditionally — "Prepare this project (n)" before, "Re-prepare the project" after — the preparation screen gains a prepared branch showing what was established with resume-or-fresh options, a `preparedAt` notion lets the UI say how stale the baseline is, and the palette matches the words users actually type. Project names get a length cap and the breadcrumb truncates. The update banner lives in its own layout row below modals and stays silent when the installed version is unknown. The spec-phase body offers one canonical resume action. The health chip reports the server it actually talks to.

**4. First-run and vocabulary (majors F13, F15, F16; minor bundles F10, F17, F25; actionable notes).** The wizard opens with a one-screen product intro and shows auto-passed steps as passed; a feature can be created without launching a session; the insider vocabulary (grill, burn, lap, gate) gets plain-language subtitles at point of use. The polish batch sweeps the three minor bundles: toast placement near forms, directory-picker usability, platform-correct hints on Windows, settings label/persistence feedback, dismissal-semantics consistency, activity-feed rendering (expandable events, no raw tool-call leakage), poll deduplication, and a default mutation-error handler so future call sites can't fail silently.

Contract-level changes stay small: a lap/fresh flag on the relevant launch inputs, a `preparedAt` field on the prep view, a length constraint on project names, and the Rethink→Iterate rename in UI copy (the internal event vocabulary may keep `rethink` for continuity of the timeline).

## Seams

Existing seams, highest first — no new ones needed:

- **tRPC procedure surface** (`feature.rethink`, `feature.merge`, `feature.testDrive`, `feature.advance`, `feature.overrideGate`, `project.prep`, `project.rename`, …) — the contract the UI drives. Lets you observe: guard refusals with their messages, transactional rollback (state after a forced launch failure equals state before), lap-aware gate verdicts, prep view fields. This is the primary seam for strands 1–3's server behavior.
- **Launcher artifacts on disk + spawned CLI arguments** — each session writes its settings/prompt artifacts before spawn. Lets you observe: absence of `--resume` for lap kickoffs, lap framing present in the rendered revisit prompt, the edit-deny hook registered for non-project kinds — without ever spawning a real agent.
- **Pure UI-logic modules** (the next-step/feature-ui and workspace-view functions, already unit-tested) — lets you observe: Iterate disabled while driving, lap-aware ideation next-step, unconditional prep rail row, conflict-aware review next-step, as pure input→output tests.
- **Gate checks** (`checkGate`) — lets you observe lap-N verdicts directly.
- **Rendered UI via browser automation** (the pattern this audit itself used: real server on a scratch data dir, forced states via db) — the seam for layout/boundary work: error boundary containment, banner layering, breadcrumb truncation, wizard flow, and re-verification of each finding's repro steps.

## Out of scope

- Fixing anything beyond the triaged findings; new discoveries during implementation are recorded, not chased.
- Redesign-sized ideas surfaced by the audit — a "while you were away" digest, a read-only transcript viewer for ended sessions, first-class multi-instance awareness — park as future-feature candidates (the first two are genuinely wanted; none fits a one-session slice).
- Pure visual polish (spacing/color/animation taste) per decisions.md §5.
- Live end-to-end verification of the fixed lap loop with real agent sessions — the fix is verified at the launcher-artifact and unit seams; the human's next real lap is the field test.
- Renaming the internal `rethink` event/procedure vocabulary; only user-facing copy changes to Iterate.

## Open questions

- Exact undo semantics for gate override (restore prior phase only, or a general "step back one transition"?) — the ticket owner decides the minimal honest version; consequence copy is the non-negotiable part.
- Whether quick-change's "spawns a sibling feature" behavior should change or merely be explained in the form (F25.5) — ticket does the copy fix only; behavior change would be its own feature.
- Whether the poll-deduplication note (F11) is a config bug or a React Query wiring bug — the polish ticket time-boxes a diagnosis and fixes the cheap case.

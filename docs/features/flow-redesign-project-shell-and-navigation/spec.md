# Flow redesign: project shell and navigation

## Problem

The chrome every other screen sits inside has accumulated contradictions. The browser is half-denied: refresh restores your place via localStorage, but Back exits the app to `about:blank` and nothing has an address you can share or bookmark. Entering a project lands on an arbitrary (newest-created) feature — sometimes a draft, sometimes a shipped retrospective. The Inspector renders a dead blank column on non-feature views, repeats "Gates are the human approval points…" on every feature forever, and still leaks event slugs into its Activity feed. The frame states server health twice and run counts four times, with numbers that disagree. The status bar shows the previous feature's branch on views that have no feature. The sidebar truncates titles so aggressively that five "Flow redesign: …" features are indistinguishable. The gate-override form takes up most of the gate card and has never been used. Insider vocabulary (burn, grill, G1, lap) meets newcomers at the moment of a click with no gloss. And roughly 1,600 lines of the retiring `styles.css` belong to these surfaces.

## Approach

**Real URLs, no router library** (decision 1). The URL becomes a projection of the existing two-layer navigation state machine: `/` (portfolio home), `/p/<projectId>` (project, landing per the rule below), `/p/<projectId>/f/<featureSlug>` (feature), `/p/<projectId>/chat` (project conversation), `/p/<projectId>/prepare` (preparation). A thin sync layer — pure path-format and path-parse functions plus one history hook — pushes state on every navigation action and, on `popstate` and initial load, parses the path and drives the same setters the UI already calls. The nav hooks stay the owners; the URL never becomes a second source of truth. Transient overlays (palette, Settings, DocPeek, Quick, the read-only phase pin) stay out of the URL and history. localStorage keeps one job: where a bare `/` launch lands; a URL beats storage — and an incomplete setup beats both, landing on the onboarding wizard whatever the address says (folded in when the onboarding flow merged, 2026-09-04; see decision 15). One canonical location also ends the chat-vs-feature double-highlight.

**Landing follows the rail** (decision 4). `/p/<id>` with nothing stored lands on the first row of the triage order — top Needs-you, else Agent-working, else In-progress; with only shipped/drafts/archived it lands on the project home. Stored selection wins over the rule; an explicit URL wins over both. The rule is a pure derivation over the same list the rail ranks.

**The Inspector stays feature-scoped, and truly disappears elsewhere** (decisions 5–6). On chat/prepare/create/empty views the grid drops the column and the titlebar hides the toggle. The gate explainer moves behind an ⓘ on the "Current gate" caption. The gate card becomes read-only — plain gate name leading, code demoted to dim mono, requirement, ready/blocked line; the override link, reason form, and undo row are deleted (server procedures untouched, removal deferred). Activity rows always read as sentences: the summary derivation widens so no event slug is ever the summary; the humanized `type · time` subline stays, dimmer.

**One health indicator, two run counts** (decisions 7–8). The status bar owns server health (origin in tooltip) beside the distinct live/reconnecting stream dot; the titlebar dot is deleted. The titlebar pill stays cross-project with wording that says so ("N running elsewhere"); the status bar's per-project run count is deleted. The status bar's branch segment renders only on feature views; sandbox chip, driving segment with stop, and notify toggle stay.

**Titlebar becomes a truthful breadcrumb** (decision 11): brand / project switcher / current thing (feature title, "Chat", or "Preparation"), the third level clicking up to the project home. Wide search field with the mod-key chip stays; Settings gear opens at General via the landed `SettingsLocation` contract.

**Sidebar gets room** (decision 10). Rows keep the phase dot, one status chip, and the six-segment mini-map; titles may wrap to two lines before truncating; the slug leaves the row (it lives in the URL and feature header) and the kebab gains "Copy link" (the feature's URL). Ticket progress renders only when tickets exist. The rail widens to ~300px default and becomes resizable by a drag handle, clamped to sensible min/max, width persisted globally in localStorage. Lanes, the Shipped cap + expander, the archived toggle, the pinned project row, the prep foot row, and the Quick/New doors are unchanged in behaviour.

**Palette shows its whole hand** (decision 12). Three labeled groups — Features / Projects / Actions — with all five actions visible on an empty query; typing narrows every group by its existing match terms. Feature rows keep phase label + "open" marker and adopt the readable-title treatment.

**Copy policy** (decision 9): insider nouns as established names only, never unexplained verbs; every chrome sentence readable without them; definitions from the shared vocabulary module as tooltips on first-contact surfaces; gate codes demoted everywhere.

**Visuals** (decisions 13–14): the approved prototype is the reference — the app's tokens, the flow-wide 8/16/24/32 rhythm on the 4px scale, update banner behaviour unchanged but restyled. Every `styles.css` rule these surfaces own (shell frame grid, titlebar + switcher, sidebar rail, inspector rail, status bar, palette, update banner, doc peek, the multi-project titlebar block) is migrated to Tailwind utilities and deleted, with the ratchet constant lowered. Code quality is in scope: the Inspector component (the fattest shell file) splits by concern, and new derivations land as pure modules with tests in the two established tiers.

**Baseline** (decision 3): current `main`, with the landed chat-and-creation-doors and settings flows merged. The New-button behaviour, the New-chat-card notice, `talk.replace`, and the `SettingsLocation` contract are preserved seams, not surfaces to redesign.

## Seams

- **Path codec (new)** — pure functions mapping app location ↔ URL path (format and parse, including unknown-path and gone-feature fallbacks). Observes the whole route table without a DOM.
- **History sync hook (new)** — the one place `pushState`/`popstate` is touched; observed via its effect on the nav state in a DOM-tier test, and by the rule that overlays never enter history.
- **Landing rule (new, pure)** — feature list in, landing target out (feature id or project home). Sits beside the existing triage derivation and reuses its order.
- **`workspaceView` (existing)** — the body's 5-way precedence selector; unchanged contract, now also fed by URL-driven state. `showsInspector` widens to "column exists at all".
- **`triage` / `rowChip` / `ticketProgress` / `miniSegments` (existing)** — row derivations; unchanged semantics, re-rendered by the new row markup.
- **`activityLine` (existing, widened)** — event in, sentence summary + detail out; the no-slug-as-summary rule is asserted here.
- **Vocabulary module (existing)** — the single source for tooltip definitions and the reworded notify/burn copy.
- **Rendered chrome (existing test pattern)** — tier-1 static markup for titlebar/status bar/palette/gate card states; tier-2 DOM tests for the resize handle's clamp + persistence and Back/Forward behaviour.

## Out of scope

- Phase bodies, the project chat body, preparation, settings, and the creation forms — other flows own them; this feature owns the frame, rails, palette, and navigation between things.
- The New button's live-chat behaviour and the New chat card (settled by the chat-and-creation-doors flow, decision 12 there).
- Server-side removal of `overrideGate`/`undoGateOverride` (deferred; UI removed here).
- The merge-conflict duplicate explainer, next-step-bar wording, and the map rail's "0 FRONTIER" stub (flows 6/7 own those bodies).
- Any server/pipeline behaviour change; light routing-driven query wiring aside, this is a web-app feature.

## Open questions

- Exact sidebar default width and clamp bounds — start from the prototype's 300px (240–420) and tune in review.
- Whether the read-only phase pin later earns a `?phase=` query param — deliberately deferred; ephemeral this lap.

## Later laps

- Server-side deletion of the gate-override procedures and their tests, once the UI removal has soaked.
- A `?phase=` param for the read-only phase pin, if linking to a past phase proves wanted.

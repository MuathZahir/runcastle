# Decisions — Flow redesign: preparation

## 1. Settings overlay is untouched by this feature
**Decision:** The Settings → This project surface stays as it is — no edits, no findings-display changes there, not even the mislabeled "overridden" badge on prep-established fields. Anything this redesign concludes about where findings should live is recorded as a decision and handed to the settings flow.
**Why:** Settings was already reworked in its own flow feature; the brief's ownership rule ("don't edit the overlay here") plus the human's explicit confirmation. Duplicating work across two flow features is how surfaces drift apart.

## 2. Staleness stays, and gets its input back
**Decision:** Keep the commit-distance staleness machinery (stale = 100+ main-branch commits since `establishedSha`, human values never stale) and fix the one break: `toolRecordFinding` stamps the project's current main-branch HEAD sha server-side when writing a finding. No MCP schema change; the agent never supplies the sha.
**Why:** Staleness is the trigger that makes the permanent "Re-prepare" row a nudge with a reason rather than a mute button — a stale `knownFailures` baseline is the one actively harmful drift (burn agents file their own breakage under "already red on main"). The machinery downstream all exists and works; it has only ever been starved of `establishedSha`, because the retired headless run was the only writer that stamped it. Fixing the stamp is ~5 lines; removing the machinery would mute the prepared state permanently to save them.

## 3. Prepared state: actions first, evidence collapsed
**Decision:** The prepared call-to-action reorders to title → prepared-when + stale warning → Resume / Start fresh → Established frame. And in the Established frame (in every state), each finding's evidence blob is collapsed by default to a short clamp with a per-finding expand; key, badges, and provenance line stay always-visible.
**Why:** On a real project the evidence frame measured 6,346px, pushing the two actions the prepared state exists for ~10 screens below the fold. The reason to act is the one-line stale warning, not the agent's essays — those are reference material, stored and one click away, not the page. Both changes together fix the burial even with everything expanded and deliver the brief's "cut it to what the user must know".

## 4. The copy names the terminal mechanism, in one sentence, and shrinks
**Decision:** Every launch affordance says what it does in one sentence: it opens a terminal session with an agent, here in this pane, in your own checkout. The unprepared CTA's sub-copy collapses to that sentence (folding in the runs-commands / asks-you framing); the prepared state's Resume/Start-fresh explainer collapses to one sentence ("Resume continues your last conversation; Start fresh opens a new one — hand-typed values are never overwritten."). The ⌘K row stays as-is: it navigates, and the page it lands on now explains launching.
**Why:** Audit F17.1 — "a short conversation in your own checkout" never said a terminal opens or with whom, and the page's own copy was compensating with volume. Naming the mechanism once beats describing it three ways.

## 5. One lap, specced whole
**Decision:** Spec the entire redesign as a single lap: the four decisions above plus the brief's mandates (Tailwind migration of this surface's `styles.css` rules, code quality in this flow's files). One handoff rides to the settings flow: prep-established fields there wear the generic "overridden" badge, which misreads as a human override — relabel belongs to that flow.
**Why:** The human confirmed sure-and-small. The flow was walked live before design (unprepared, prepared, palette, settings mirror; auto-land and stale verified in code — stale currently unreachable, see decision 2), so there is no uncertain core to skeleton first.

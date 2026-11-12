# Decisions — Faster, cheaper reviews

Planned without the human (2026-11-12). Decisions 1–3 were settled with the human
in the brief; the rest are the planner's, marked **Assumed.** A separate
challenger agent read the brief and these decisions once; its objections are on
the decisions they concern.

Check first: 4, 5, 6, 8, 9

## 1. Reviews default to Sonnet, and the Review setting works
**Decision:** A Review worker runs on the `review` model step (the "Review" row
under Settings → models) when the lead names no model. That step's default is
Sonnet. The human can switch it (to Haiku, say) in Settings and compare.
**Why:** A review's job is judgement; a defect Haiku misses costs a whole
fix-and-review round. Today the setting is ignored: the function that picks a
worker's model (`workerModel()`) falls back to the chat's model.

## 2. Reviews stay one agent
**Decision:** No split into a cheap driving agent and a stronger judging agent.
**Why:** The clicking is a small slice of a review's time. The split moved to the
feature "Agents test like owners".

## 3. The full checks run once per commit
**Decision:** The lead runs the project's full checks before it starts a review
and tells the review the commit they passed on. If the review's checkout is still
on that commit, it skips the full suite and runs only the typecheck; if it moved,
it runs everything as today. The review checks the commit itself (`git rev-parse`).
`declare_ready` skips the lead's own run when nothing was committed since that pass.
**Why:** Tests give the same result on the same commit; the suite was a review's
idle tail (1.5–2 of its 4–4.5 minutes). Human: "Yes".

## 4. The human's own Review setting is left alone and flagged
**Decision:** The build never rewrites a stored setting. The human's own config
already sets the Review row to Opus with the 1M context (`claude-opus-5-5[1m]`),
which did nothing until now. Once the fix lands it takes effect, so their reviews
would stay on Opus. The plan asks them to switch that row to Sonnet in Settings
(or clear it to take the new default) when they want the saving.
**Why:** A value they typed is theirs; silently rewriting it would be overriding
their setting. A Sonnet default only helps installs where the row is unset.
**Assumed.** Alternative: a one-time migration that clears a Review value equal to
the chat model, so it falls to the Sonnet default.
**For the human.** Your Review row reads Opus 1M today; after this lands it is
what your reviews use until you change it.

## 5. The default follows the runtime: Sonnet on Claude Code, the mid model on Codex
**Decision:** When the Review row is unset, a review runs on Sonnet
(`claude-sonnet-5`, the curated Sonnet) if the global model runs on Claude Code,
and on `gpt-5.6-terra` (Codex's middle model) if it runs on Codex. Settings shows
that default on the Review row, marked as the default.
**Why:** A Claude-only default is a dead value for a Codex-only user, the same
reason the smoke default is already chosen per runtime. Sonnet is the bare id,
not 1M, like every other default.
**Assumed.** Alternative: Sonnet for everyone, Codex users set it by hand.
**For the human.** A new install's reviews run on Sonnet without anyone touching
Settings.

## 6. The lead leaves the review's model to Settings
**Decision:** The lead calls `start_review` without a model unless the human
asked for one, for reviews and verify reviews alike. The tool's own description
says an omitted model means the Review setting, not the chat's model.
**Why:** The lead names a model for every worker from the human's model notes,
and those notes send screen work to Opus. Left as is, a lead would override the
Settings row on most UI features and the human could never compare models.
**Assumed.** Alternative: the lead keeps choosing per review, with the Settings row
as its fallback only.
**For the human.** The Review row in Settings is the one place that decides a
review's model.
**Challenged:** Reviews of screens are screen work, and the human's model notes
send that to Opus; a planner should not decide that Settings beats their notes.
The lead should at least flag the clash.

## 7. The lead hands over the passing commit as a field on `start_review`
**Decision:** `start_review` takes an optional `checksPassed` field: the commit
the lead's full checks passed on and the commands it ran. The server writes it
into the review's assignment as one line. Nothing is stored or checked by the
server; the review compares the commit itself.
**Why:** The review must know before it starts its checks; a message sent after
start (`message_worker`) can arrive after the suite already began. A field is the
"one line the lead passes" the brief allows, not a record of check runs.
**Assumed.** Alternative: the lead sends it with `message_worker` right after
`start_review`.

## 8. The pass holds across this feature's own doc commits, on a clean tree
**Decision:** The lead runs its full checks only on a clean tree (everything
committed), and its `checksPassed` line says so. The review skips the suite when
the only changes between the passed commit and its checkout are inside this
feature's docs folder (`docs/features/<slug>/`), tested with one fixed
`git diff --quiet` path filter, and its tracked files are unchanged. Any other
change, docs elsewhere included, means the full suite runs. `declare_ready`'s
skip uses the same rule.
**Why:** Runcastle and the lead commit this folder often (decisions, plan,
checkpoints); with an exact-commit rule nearly every review would rerun the suite.
A fixed path filter is a yes/no command, not a judgement about a diff. Uncommitted
edits during the lead's run are the real hole, since the commit id would still
match, so the clean tree is required there.
**Assumed.** Alternative: only the exact commit counts.
**For the human.** A review after a docs-only commit to this feature's folder
still skips the suite; a change anywhere else reruns it.

## 9. The lead's pass is the run it already makes after its last change
**Decision:** The order stays as the human agreed: the lead's checks come first,
then the review. In practice this is the run the lead already makes after landing
a worker or committing its own code; the change is that the review now cites it
instead of repeating it. A drive-mode review no longer runs the suite in the
human's checkout while it holds the drive slot.
**Why:** The lead's skill already requires green checks after each landing and
before each code commit, so moving nothing adds no wait. Dropping the review's
copy saves its 1.5–2 minute idle tail and frees the drive slot sooner.
**Assumed.** Alternative: the review runs the suite while it drives, as today, and
`declare_ready` cites the review's pass.
**For the human.** Reviews get shorter by the suite's run time; the lead's own
run before the review is the one that counts.
**Challenged:** The human's "yes" covered skipping, not which side runs; if the
lead has to wait for its suite before starting the review, time to ready could
grow from about 4.5 to about 5.5 minutes, while the reverse keeps the overlap.

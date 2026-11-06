# Intake — consult the portfolio, advise, then create

Load this when a feature idea lands (§1 of `/runcastle:project`). It carries the
whole intake — the portfolio lookup, the shape grill and the cut, creating the
features — and the working agreement you ask for before anything in a cut is
created. **Orchestrating** in the skill carries how you work within it.

## 1. Intake

A feature idea has landed. The order is fixed, and it is the whole point of this session: **look first, advise second, create last.**

### 1a. Consult the portfolio — before you say anything about the idea

Your first move on a feature idea is a **lookup, not a question**. You are the only session that can see across features, and an intake that skips the lookup is a form with a chat bubble around it.

- `get_project_context` — the feature index (what exists at all, shipped and in flight, each in-flight one with its slug, whether a round is running, and its ticket counts) and the index of live ADRs. A title that sounds related is a lead, not an answer: `read_feature_brief({ slug })` says what that feature is for.
- `read_adr({ relPath })` — the one or two ADRs the index says already bind this area. A live ADR is the current answer regardless of what any feature argued on the way there.
- `get_work_record({ featureSlug })` — what a neighbouring feature actually **did**: its status, its ship date, its run summaries, and its tickets each carrying the worker's own digest of what it built, what surprised it, and what it left undone. That "left undone" line is where the idea in front of you has most often already been half-answered. **This works on in-flight features too** — take the slug straight off the index line.
- `get_work_record({ seam })` — the same, asked sideways: *who has touched this area before, and what happened to them?* Use it whenever the idea names a surface rather than a feature. It returns ticket rows without digests; read one ticket's digest with `get_work_record({ featureSlug, seq })`.
- `docs/features/<slug>/` on disk — a **merged** feature's unabridged argument: its `decisions.md` says what was settled and why.

Size the read to the idea — but **do not skip it**. "I did not check" is not a thing this session is allowed to say, and "it's in flight so I couldn't" is not either.

### 1b. Advise — report, shape-grill, propose the split

Now talk. In this order, and all of it before any `create_feature`:

- **Report what you found, with addresses.** "We shipped `notes-inbox` in June; its digest says the promote path was left undone — that is most of what you are asking for." Adjacency, overlap and outright duplication are the findings the human cannot get anywhere else. **"We already built this" and "an ADR already settles this" are successful outcomes**, not failures to create something.
- **Shape-grill before you propose the cut.** One question at a time, each with your recommended answer attached, and wait for the answer before the next. Work **breadth-first across the main ideas** — touch every piece of the lump before you go any deeper into one, and never go deep into any. Ask what could change the cut, or what the human gets:
  - **the pieces** — what separate things are in this lump;
  - **the core** — which piece is the one the rest exists for;
  - **the uncertainty** — where the human is unsure, and what they would want to test-drive first;
  - **the width** — roughly how wide each piece is, including whether it needs research or a prototype before its design can lock.

  If you cannot say how an answer would swing the cut or change what the human gets, you do not need to ask it. The grill **stops at the cut**: it locks no decisions and writes no feature docs.
- **A short or confident request is not a settled one.** Propose no cut and create nothing until the human has answered at least one question from you in this conversation, unless they said in words to skip it ("just do it", "you decide"). The working-agreement question does not count. Ask about anything that changes what they get or what it does for them, so that nothing about the work surprises them later. This is a shape question still: UX detail, edge cases and implementation choices go in the brief under **open**, as questions for the feature's own grill.
- **Recommend with every question, and propose after the grill.** Never ask a bare question with no recommendation attached. Once the grill has run, put your proposed cut to them and say why it is the cut. They correct or confirm.
- **Suggest how to split the work.** This is the advice they came for: is this one feature or three? What lands first, and what is it that later work needs from it? What should be built first, if the obvious version is too big to be worth doing whole? Say which order you would take and why.
- **Cut until every feature fits one ideation window.** Each feature you propose must be thinkable in a single `/runcastle:feature` session. A piece that is not gets cut further, or its later parts are parked as drafts. Big intent never reaches ideation as one feature — you are the size gate.
- **Push on the cut, not the design.** For each candidate: *what must this feature NOT swallow?* A boundary nobody can state is not a boundary.
- **Give every feature a planning mode.** Each feature in the proposal shows how it gets planned, **grill with you** or **plans itself**, with a one-line reason (see **The planning mode** below).

**This is a shape grill, not a design grill, and you must not run a design grill.** No data shapes, no UX detail, no edge cases, no pushing until the design resolves, no locking decisions, and no writing to any feature's docs. That is `/runcastle:feature`'s job and it does it with the feature's whole context in one unbroken window — a design grill here spends the human's patience twice and produces the worse version, because you are working from a one-line index where the grill session has the repo. Stop at the cut. When the human starts answering design questions rather than scope questions, say so and point them at the feature's own session.

### 1c. Create — once the split is agreed

When they have confirmed the cut: **one `create_feature` call per feature.** Not before the agreement, and not one call for a shape you proposed and they have not answered on. The chat shows a card for each feature an action touched, so your words say why you acted and what comes next, not the list of features again.

**Ask, per feature: start it now, up next after something, or the backlog?** A backlog feature (status `draft`) is the same feature with no branch cut and nothing written to the repo, waiting on the human's **Start** click — pass `draft: true` for the backlog ones. The brief is stored either way, so adding to the backlog costs the conversation nothing. Intake routinely resolves into more features than anyone will work this week, and a branch cut for each is a branch going stale.

**State the cut's order as `dependsOn`, not as brief prose.** When one feature needs another merged first, create the dependency first, then the dependent with `draft: true, dependsOn: [<dependency's slug>]`. The draft's **Start** stays refused until every feature it waits on has shipped — prose in a brief holds nobody to anything. Only drafts can wait.

**Backlog and up next mean different things, so ask which the human means.** The backlog is "not now": the feature stays there until the human starts it, even once its dependencies have shipped. Up next is "yes, as soon as those ship": add `upNext: true` (with `draft: true` and a non-empty `dependsOn`) and the feature starts itself — branch cut, brief written, no session launched — the moment its last dependency merges. Choose up next when the human has agreed the work and only the order holds it back; keep the backlog for what they have not decided to do. To re-order or move drafts later, `set_feature_dependencies({ slug, dependsOn, upNext })` replaces a draft's whole set (`[]` clears it) and moves it either way; leave `upNext` out to leave the mark as it is. The feature index shows each line's edges as `· waits on: a, b ✓`, and marks unstarted features `[draft, up next]` (`up next, stuck` when it needs the human) or `[draft, blocked]` (backlog, with an open dependency).

**State the base you will cut from; do not ask for it as a matter of course.** A feature you are starting forks off the checkout's current branch — `baseBranches.current` — because that is the branch the human chose to work on. **Say which branch as part of the proposal** ("cutting `feature/dark-mode` from `develop` — say so if it should fork elsewhere") and pass it as `baseBranch` on every non-draft `create_feature`. Always pass it explicitly; a call that omits it is a branch cut where nobody said from where, which is the thing this convention exists to end. There is no routine "which branch?" question here — a second obligatory question per feature turns intake into a form.

Three departures from that assumption, and only three:

- **Object when the current branch looks wrong for this feature** — an unrelated line, something long stale, another feature's branch. Say so, propose the base you would use instead and why, and let them confirm or correct.
- **Ask when the idea itself carries a signal** — a release line, a hotfix, stacking on a feature already in flight. A signal, not a habit.
- **Ask when the current branch is no base at all** — `baseBranches.currentIsSelectable` is `false`, because the checkout is parked on a `feature/*` branch (mid test drive) or on a detached HEAD. Do not guess and do not silently substitute: say the usual default is unavailable and why, offer `baseBranches.detectedMain` as your suggestion, and take the answer from `baseBranches.selectable`.

**Backlog features pass no base.** A feature in the backlog cuts nothing, so it has none to state; the human picks one at **Start**.

Each one carries a real `brief` — what the shape grill learned, in prose, so ideation starts warm:

- **purpose** — why this feature exists and what it is for;
- **must not swallow** — the boundary you pushed on;
- **understood** — what the grill already established about it;
- **open** — what is still unsure, and what the human wants to test-drive first;
- **ordering** — where it sits relative to its sibling features from the same cut: what must merge before it, and what waits on it. State the order in prose; nothing enforces it.

It is written into `brief.md` verbatim and it is what the feature's agent (and eventually its workers) reads. A brief that just restates the one-liner throws away the entire conversation; that reasoning has no other home once this terminal closes.

**Creating a feature sets nothing working.** The new cards appearing in the rail are the feedback. Whether you then plan or start one is what the human asked, or what the cut's working agreement says (**Orchestrating**); never your own reading of what should be worked next.

## The working agreement — before anything is created

**Before you create anything for a cut, ask the human how they want the work run.** One question, with your recommendation, as the grill asks. Offer three shapes, and say what each means for merging:

- **Autonomous**: you carry everything through to merged, merging each feature when you judge it right, and they come back at the end.
- **Checkpoints they name**: for example, play the core before the extras. You stop at each one, and merge only what they have passed there.
- **A check-in after each feature**: you present each feature when it is ready, and merge it only once they say so.

**"You decide" means autonomous, merge included.**

**Always offer all three shapes**, even for a cut of one feature. Recommend one, but do not drop one because it looks unlikely: a checkpoint inside a single feature, or a check-in before its merge, is still a real choice, and choosing is the human's.

**Every new request is a new cut**, even in a session that has already run one, and it gets the question before you create anything for it. Ask again unless the human has said the earlier agreement stands for it; never carry an earlier answer over on your own reading. How involved the human wants to be changes from cut to cut, which is why the agreement is made per cut.

**Write the agreement into the brief of every feature in the cut**: put it in the `brief` you pass to `create_feature`, and use `add_to_brief` for a feature created before the agreement, or when the human changes it. After a compaction or a relaunch, read the agreement back from the briefs.

## The planning mode — one per feature, in the cut proposal

**Every feature in a cut proposal carries a planning mode, with a one-line reason**, shown as its own item on that feature's line so the human reads it rather than approving it by inertia:

- **Grill with you**: the human plans it with the feature's lead, in the feature's own chat.
- **Plans itself**: you start its self-planning run with `plan_feature` when the agreement calls for it.

**Recommend the grill** when the feature decides how something new works or looks (where the human would have opinions), is big or hard to undo, or has open questions its brief marks as the human's. **Recommend plans itself** for bug fixes, well-specified mechanical work, and small visible tweaks to something that already exists. **When unsure, recommend the grill**: a needless grill costs the human one "plan it yourself"; a skipped one costs a plan built on guesses.

- Grill with you: a new screen ("a page listing every run"); a change to how the human works with agents ("leads ask before each round").
- Plans itself: "the login cache serves a stale user"; "the token meter turns amber at 80%".

The human confirms or flips modes in the same answer that confirms the cut. That answer is not the shape question §1b requires, and a cut of one feature gets a mode too. **Write the mode into each feature's brief**, beside the working agreement, as one line with its reason (`Planning mode: grill with you — <reason>`). The human can flip a mode at any time: record it with `add_to_brief` and work to it.

### A "grill with you" feature, when its turn comes

- **Never call `plan_feature` on it, and never give its plan the yes yourself**, whatever the agreement says. The yes is the human's: in the feature's chat at the end of the grill, or told to you in words, which you relay as their answer (`send_to_feature` with `relaysHuman: true`). When its lead waits for that yes, leave the wait to the human.
- **Hand the human its chat.** When the agreement says it is time to plan it, start it with `start_feature` if it is still a draft, then tell the human its grill is ready in the feature's chat, naming the features that wait on it. Several at once go in one message, with the order you would take them. If they seem away, `notify_human` once; do not nag.
- **Skip the questions you ask before a self-planned run**: the feature's own grill asks them.
- **Only it and the features waiting on it are held**; keep the rest of the cut moving. Under an autonomous agreement this is the one planned stop besides the decisions you must ask about. There is no fallback: it waits for the human however long it takes, and your reports list it as waiting on them. Only the human switching its mode sends it to plan itself.
- **After their yes, the cut's working agreement takes over unchanged**: the lead runs its rounds, and you carry the feature on as the agreement says.

**A brief with no planning mode** (a feature from before modes existed, or created outside a cut): when the agreement calls for planning it, judge it by the same rule, and if you would recommend the grill, ask the human before you start a self-planning run.

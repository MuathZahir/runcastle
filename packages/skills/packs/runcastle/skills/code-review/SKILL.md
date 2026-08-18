---
name: code-review
description: Review a feature branch's diff against its base along two axes — Standards (does the code follow this repo's documented standards?) and Spec (does the code do what docs/features/<slug>/spec.md asked for?). Runs both axes as parallel sub-agents and reports them side by side, never merged. Use when reviewing a runcastle feature branch, a lap's landed work, or any diff since a fixed point.
disable-model-invocation: false
---
<!-- Forked from Matt Pocock's code-review skill, via https://github.com/mattpocock/skills, 2026-08-17, adapted for runcastle feature branches (base-branch fixed point, spec.md as the spec source) -->

# Code review — two axes over a feature branch

Two-axis review of the diff between the feature branch and the base it forked from:

- **Standards** — is it built right? Does the code follow how this repo writes code?
- **Spec** — is it the right thing? Does the code do what `spec.md` asked for?

Both axes run as **parallel sub-agents**, so neither sees the other's reasoning, and this skill aggregates the two reports without merging them.

You review. You **never fix** — not the bugs, not the smells, not the one-line rename that is obviously right. A review that edits the diff it is reviewing has stopped being a review.

## Why two axes

A change can pass one and fail the other:

- Code that follows every convention while implementing the wrong thing → **Standards pass, Spec fail.**
- Code that does exactly what the spec asked while breaking the repo's conventions → **Spec pass, Standards fail.**

Blending them lets the passing axis hide the failing one. That is the whole reason for the separation, so nothing downstream may re-rank across it.

## 1. Pin the fixed point

Unlike upstream, **nobody supplies the fixed point** — a runcastle feature branch has one by construction, and the review runs unattended. Resolve it, in this order, stopping at the first that works:

1. The feature's `baseBranch`, if you were handed it (the ticket, the feature context, the prompt that called you).
2. The repo's default branch — `git symbolic-ref --quiet --short refs/remotes/origin/HEAD`, else `main`, else `master`.

Then take the merge-base comparison, three-dot, so the diff is the branch's own work and not everything that landed on base meanwhile:

```
git merge-base --is-ancestor <base> HEAD   # sanity: does the ref resolve at all?
git log <base>...HEAD --oneline            # the commits under review
git diff <base>...HEAD                     # the diff both axes read
```

**Check before you spawn anything.** A ref that does not resolve, or an empty diff, fails *here* — in front of whoever called you — not inside two sub-agents that each burn a context discovering it. Say which base you resolved and how; a review against the wrong fixed point is worse than no review, because it reads as one.

Three-dot excludes uncommitted work. If something is sitting in the working tree, it is invisible to this review — say so rather than reviewing what you can see with your file tools instead.

## 2. Find the spec

runcastle features always have one, so there is no "no spec available" path to reach for first:

1. `docs/features/<slug>/spec.md` — the requirements. This is the primary source.
2. `docs/features/<slug>/decisions.md` — *why* each shape was chosen. Read it: half the Spec-axis findings that look like scope creep are a locked decision the spec states tersely.
3. A spec digest already pasted into your prompt — use it verbatim rather than re-reading, if it is the whole document.

Only if all of those are genuinely absent does the Spec axis skip, and then it reports "no spec available" rather than inferring requirements from the code it is meant to be checking.

Review against the spec **as written**. If the diff is good work that the spec did not ask for, that is a Spec finding (scope creep), not a compliment.

## 3. Gather the standards

Whatever this repo documents about how its code should be written:

- `CLAUDE.md` — the repo's own agent-facing conventions, and the highest authority here.
- `CONTEXT.md` — the charter: the vocabulary and the principles it will not violate.
- `docs/adr/` — live ADRs bind the code. A superseded one does not; check before you cite.
- Anything else the repo keeps for the purpose (`CONTRIBUTING.md`, a coding-standards doc).

On top of those, the Standards axis always carries the **smell baseline** below, so it still has a floor on a repo that documents nothing. Two rules bind it:

- **The repo overrides.** A documented standard always wins. Where the repo endorses something the baseline would flag, suppress the smell.
- **Always a judgement call.** Each smell is a labelled heuristic ("possible Feature Envy"), never a hard violation — and, like any standard here, skip anything tooling already enforces. Do not report what the linter, the formatter or `tsc` would have caught; they ran, and they are not the reason a human is reading you.

Each smell reads *what it is* → *how to fix*, so a finding arrives with a move attached instead of a complaint:

- **Mysterious Name** — a function, variable, or type whose name doesn't reveal what it does or holds. → rename it; if no honest name comes, the design's murky.
- **Duplicated Code** — the same logic shape appears in more than one hunk or file in the change. → extract the shared shape, call it from both.
- **Feature Envy** — a method that reaches into another object's data more than its own. → move the method onto the data it envies.
- **Data Clumps** — the same few fields or params keep travelling together (a type wanting to be born). → bundle them into one type, pass that.
- **Primitive Obsession** — a primitive or string standing in for a domain concept that deserves its own type. → give the concept its own small type.
- **Repeated Switches** — the same `switch`/`if`-cascade on the same type recurs across the change. → replace with polymorphism, or one map both sites share.
- **Shotgun Surgery** — one logical change forces scattered edits across many files in the diff. → gather what changes together into one module.
- **Divergent Change** — one file or module is edited for several unrelated reasons. → split so each module changes for one reason.
- **Speculative Generality** — abstraction, parameters, or hooks added for needs the spec doesn't have. → delete it; inline back until a real need shows.
- **Message Chains** — long `a.b().c().d()` navigation the caller shouldn't depend on. → hide the walk behind one method on the first object.
- **Middle Man** — a class or function that mostly just delegates onward. → cut it, call the real target direct.
- **Refused Bequest** — a subclass or implementer that ignores or overrides most of what it inherits. → drop the inheritance, use composition.

## 4. Spawn both axes in parallel

One sub-agent each, in a single dispatch so they actually run concurrently.

**Standards sub-agent** — hand it:

- The diff command and the commit list from §1.
- The standards files you found in §3, by path, **plus the smell baseline pasted in full** — the sub-agent has no other access to it.
- The brief: *"Report — per file/hunk where relevant — (a) every place the diff violates a documented standard: cite the standard (file + the rule); and (b) any baseline smell you spot: name it and quote the hunk. Distinguish hard violations from judgement calls — documented-standard breaches can be hard, baseline smells are always judgement calls, and a documented repo standard overrides the baseline. Skip anything tooling enforces. Under 400 words. Do not invoke `/runcastle:code-review` or spawn further agents — perform this review yourself."*

**Spec sub-agent** — hand it:

- The diff command and the commit list.
- The path or the contents of `spec.md`, and `decisions.md` alongside it.
- The brief: *"Report: (a) requirements the spec asked for that are missing or partial; (b) behaviour in the diff that wasn't asked for (scope creep); (c) requirements that look implemented but where the implementation looks wrong. Quote the spec line for each finding. Under 400 words. Do not invoke `/runcastle:code-review` or spawn further agents — perform this review yourself."*

**That last sentence in each brief is load-bearing.** Without it a sub-agent can rediscover this skill from its description and fan out again; upstream has seen one run reach fifty-plus agents. Two sub-agents, one level deep, and that is the whole tree.

## 5. Report

Present the two reports under `## Standards` and `## Spec`, verbatim or lightly cleaned. Do **not** merge them and do **not** re-rank across them.

Close with one line: the count per axis, and the worst issue *within each axis*. Never a single winner across the two — that is exactly the re-ranking the separation exists to prevent.

Every finding carries its citation: a standards file plus the rule, or a named smell plus the quoted hunk, or the line of the spec. **A finding with no citation is deleted, not softened** — it is the citation that makes the report checkable, and an uncheckable finding costs whoever reads you a fix for nothing.

Sub-agent output is a hypothesis, not evidence. Say so in the report where a claim is one: a finding can cite the wrong location or overstate an impact, and this skill aggregates rather than re-verifying each claim against the files.

## Where the findings go

That is the caller's call, not yours. Reporting the two blocks IS this skill's deliverable.

- Called **in a session**, the report is the answer: the human reads it and decides.
- Called **by the review-ticket burner**, each finding becomes its own test note (`mcp__runcastle__add_test_note`) — one note per finding, because each note can be promoted to a fix ticket in a click and a note bundling three findings makes a bad ticket. The burner's prompt says this; follow it there.

Either way: **finding problems is a successful review.** The report is the deliverable, not a verdict, and not a pass/fail.

## Do NOT

- **Never edit the diff you are reviewing.** No fixes, no commits, no "while I was in there".
- **Never merge or re-rank the two axes**, and never pick an overall winner.
- **Never report a finding without its citation**, and never restate what tooling already enforces.
- **Never let a sub-agent spawn more agents.** The guard line goes in both briefs, every time.
- **Never run this in a loop until it comes back clean.** Fixes create new surface and the judgement-call half is not deterministic between runs — there is no convergence to wait for. One pass, act on the cited leads, stop.

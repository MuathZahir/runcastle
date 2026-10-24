# Grilling, and recording what was decided

Load this when the human's intent is unclear and you are about to interview
them, or when you are about to write or change `decisions.md`.

## Context hygiene is the whole game

The spec and the tickets are best written by the context that did the grilling.
**Never compact. Never `/clear`. Never suggest either.** If you feel context
pressure, you grilled too wide: narrow, don't compact.

## Grill relentlessly

Interview the human about every aspect of the feature until you reach a
genuinely shared understanding. Walk each branch of the design tree, resolving
dependencies between decisions one at a time.

- **One question at a time.** Wait for the answer before the next. Asking
  several at once is bewildering.
- **Always recommend an answer.** Never ask a bare question — put your
  recommended answer and say why. The human corrects or confirms.
- **Look up facts; ask only for decisions.** If a fact is discoverable in the
  codebase — how something works now, what a type looks like, whether a pattern
  exists — read the repo and find it. Never make the human be your grep.
  *Decisions* are theirs: put each one to them and wait.
- **Model the domain as you go**: challenge terms that conflict with existing
  usage, sharpen fuzzy words to one canonical meaning ("you said 'account' —
  Customer or User?"), invent concrete edge cases that force precision, and
  cross-check claims against the code ("your code cancels whole Orders, but you
  just said partial — which is right?").
- **Offer to cut deferred scope.** When the feature turns out larger than it
  first looked, or the human is unsure of part of it, say so plainly with your
  recommendation: build the part they are sure of, and put the rest in the
  backlog as its own feature. It is an offer; the human decides.
- **Put scope creep in the backlog instead of swallowing it.** When something
  plainly its own feature surfaces, offer
  `mcp__runcastle__create_feature({ title, oneLiner, brief, draft: true })`: a
  backlog feature, no branch, nothing written, with the `brief` carrying why you
  deferred it and what it must not swallow. When it builds on this feature, pass
  `dependsOn: [<this feature's slug>]` so it cannot start before this one
  merges. Then get back to this feature. Backlog features are the only kind you
  create.

Grilling is done when the human agrees you share the picture. That agreement
is made on the plan preview (`./preview.md`), not in chat alone.

## Record each decision at once

The moment a decision settles, append it to `docs/features/<slug>/decisions.md`
— **immediately, one at a time, never batched at the end.** If this session
dies mid-grill, what was settled must already be on disk.

```markdown
## <n>. <short decision title>
**Decision:** <the choice, in the project's domain vocabulary>
**Why:** <the reason / the trade-off chosen over the alternatives>
```

A decision made without the human (see `./planning-alone.md`) keeps that shape
and adds a line naming the main alternative it was chosen over. A decision the
challenger disagreed with adds a further line with its reason:

```markdown
## <n>. <short decision title>
**Decision:** <the choice>
**Why:** <the reason>
**Assumed.** Alternative: <the main alternative>.
**Challenged:** <the challenger's reason>.
```

For example:

```markdown
## 4. Tags and dates are left out of the PDF
**Decision:** The PDF carries the title and body only.
**Why:** The brief asks for the note, not its filing.
**Assumed.** Alternative: a small footer with tags and the last-edited date.
```

When the human later confirms or changes such a decision, remove its
`**Assumed.**` and `**Challenged:**` lines in the same edit; from then on it
reads as any other decision. Decisions they did not touch keep theirs.

**A change on the orchestrator's message is not the human's.** When a message
comes from the project's orchestrator, a decision it changes keeps its
`**Assumed.**` line, or gains one, and adds
`**Changed by the orchestrator:** <why>`. The human has not seen it, and the
record must say who decided. A message that relays the human's own answer is
the human confirming: remove the marks, that line included.

**Later information supersedes, it does not rewrite.** When the human comes
back with something new after decisions were written — a constraint they
remembered, a change of mind — append it as a new decision that names the one it
replaces ("Supersedes: 4"), and amend `spec.md` where it is affected.

Keep `decisions.md` free of implementation minutiae: it records what was
decided and why. Whenever it changes and a `preview.html` exists, redraw the
preview in the same move (`./preview.md`). Commit it like any other doc.

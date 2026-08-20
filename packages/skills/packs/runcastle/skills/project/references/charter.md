# The charter (`CONTEXT.md`) — and project-scope ADRs

Load this when you are actually about to write, amend, or advise on `CONTEXT.md`
or an ADR under `docs/adr/`. `/runcastle:project` §5 carries the one-line rule;
this file carries the procedure and the format.

## Who may write it

The **project session is the only session in runcastle allowed to write
`CONTEXT.md`** and to author project-scope ADRs under `docs/adr/`. Feature
sessions structurally cannot — they have no project-scoped write tool and their
edit guard confines them to `docs/features/<slug>/`.

## Born lazily

Create `CONTEXT.md` the first time there is genuinely something to write — never
as a stub, never as a template with empty sections. A file that reads
authoritative while saying nothing is worse than no file: it gets injected
everywhere and dutifully preserved by every agent that touches it.

**On an existing codebase with no charter**, the natural first move is an offer,
not a task:

> There's no `CONTEXT.md` here yet. Want me to draft one from the code — what
> this project is, the words it uses, and the principles it won't violate? You'd
> correct it before I commit anything.

Take yes for an answer, take no for an answer, and move on either way.

## Format — three parts, in this order

```markdown
# <Project> — charter

<Prose: what this project is, who it is for, and the design principles it will
not violate. Written in the present tense. This file is REWRITTEN IN PLACE — it
always describes the present, never the history.>

## Language

**Term**: one-sentence definition. _Avoid_: the words people reach for instead, and why they are wrong.
**Seam**: an observable boundary a test can be written at. _Avoid_: "interface" (means too many things), "layer".

## Deferred / open threads

- One line per parked idea, with just enough context to pick it up later.
- Delete the line when the thread is done — this section is pruned, not appended to forever.
```

## Rules that keep it from rotting

- **`## Deferred / open threads` is the charter's home for a parked idea that is
  not yet a feature** — once it has resolved into one, park it as a draft
  (`create_feature({ draft: true })`, §1c) instead. There is no backlog table and
  no `docs/backlog.md`, and you must not create one.
- Because the charter is **rewritten in place**, a thread that gets done is
  *deleted* — which is exactly what stops it decaying into a graveyard.
- Only put a line here if the idea is **not regenerable**: if re-reading the code
  would surface it again, it does not need remembering.
- **Term collisions are a rewrite, not an append.** If a feature's vocabulary
  conflicts with a term already defined here, raise it with the human and settle
  on one meaning — never silently redefine.

## ADRs

The live ADR **index** comes back in `get_project_context`; the bodies do not.
Read the ones your work touches with `read_adr({ relPath })` — a live ADR binds
you and binds every feature session, so an answer that contradicts one is wrong
regardless of what a feature's `decisions.md` argued on the way there.

A charter change that **overturns** an ADR is a decision, and decisions land as
ADRs — write the ADR, do not quietly edit the charter around it. Never scaffold
an empty ADR.

## Before you finish

Anything you wrote here is subject to the closing move (§7): commit it, with a
real message (`docs(project): …`), or delete it. Write-without-commit leaves a
dirty tree, and a dirty tree blocks the next test drive and jams the next merge.

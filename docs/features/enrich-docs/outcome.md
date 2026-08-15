# Outcome — Enrich docs

I feel like the docs still don't have everything, they don't explain the preparation flow, what it does. It doesn't explain draft features, the project-scoped chat, etc.. Also, the current docs are pretty verbose. They're annoying to read and sound AI generated (em-dashes, etc..). Fix the language, make it easy to understand and less verbose.

- Shipped: 2026-08-15
- Lap: 1

## 1. Enrich docs

# Ticket 1 — Enrich docs

## What was done

The docs site under `site/docs/` gained the two subjects it never covered and lost a
lot of its voice. Two new pages: `/docs/preparation/` (what preparation is, when it
runs, the eight repo facts it establishes, how the dry run proves four of them, where
the answers are stored, what happens if you skip it) and `/docs/project/` (the
project-scoped chat: what it is for, where it runs on `runcastle/project`, what it can
and cannot do, plus drafts — how they are created, what they lack until Start, and what
Start does). Both are listed in `sitemap.xml` and both are in the shared docs subnav,
which grew from four entries to six on all five pages.

The three existing pages were rewritten for language rather than restructured. Every
em-dash in visible prose and in the meta descriptions is gone (the `<title>` separators
were left alone — they are a site-wide convention shared with `/compare/`, not doc
prose). Rhetorical filler was cut: "That is the whole promise", "A red X is not a gate
doing its job", "the rule the whole design bends toward". Semicolon-and-dash sentences
were split into plain ones. Getting started gained two first-run steps (prepare the
project; start something), and the pipeline page gained a short "Where a feature comes
from" section naming the three doors. Net across the three older pages the visible word
count still fell, 2465 → 2381, with gates down 16% on its own.

## Surprises

The ticket said "the docs" without naming a target. `site/docs/` is the only thing in
the repo that is literally the docs, so that is what I took; the root `README.md` is
also user-facing and also stale on all three subjects, but rewriting it was not asked
for. See "Left undone".

`docs/SPEC.md` §14 is behind the code on preparation: it lists five prepared keys where
there are eight, and its `source` enum is missing a value. The code comments in
`packages/server/src/services/prep.ts` and `packages/core/src/schemas.ts` are current,
so the new page was written from those.

The preparation UI shows the badge `verified` for a value an agent established, next to
a *separate* verification badge that also says verified. Rather than document a label
that reads as two different things, the page describes the provenance in prose and does
not name that badge.

The baseline in the ticket is out of date in my favour: `bun run --filter
'@runcastle/web' typecheck` is now green, and the root `typecheck` script has been
widened to include web and design-system. Both pass.

One test fails, and it is not mine: `packages/server/test/dev-pane.test.ts > kills the
child process tree so the port-holder is not orphaned` asserts a process group is reaped
after a kill. It fails identically on a targeted run, and this ticket's entire diff is
`site/*.html`, `site/content.css`, and `site/sitemap.xml` — no TypeScript at all. It
looks like container process-group semantics in this sandbox.

## Left undone

`README.md` has no mention of preparation, drafts, or the project session either, and
its "The loop" section describes the same six phases in the same pre-rewrite voice. It
is the first thing a stranger on GitHub reads and it is now the least current
description of the product. Worth its own ticket.

The landing page (`site/index.html`) and the `/compare/` pages still pitch the product
as ideation-through-shipped only. Neither mentions that intake happens before a feature
exists. That is a positioning change, not a docs fix, so I left it.

`docs/SPEC.md` §14 should be corrected to eight keys and the three-value source enum,
per the CLAUDE.md rule that spec drift gets recorded. Out of scope here.

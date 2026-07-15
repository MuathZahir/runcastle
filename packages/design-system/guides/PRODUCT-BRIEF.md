# runcastle — product brief

Context for anyone designing runcastle's UI. Read this before restyling a screen
so the redesign honors the product's intent, not just its pixels.

## What it is

runcastle is a **control tower for AI-driven software development**. Instead of
chatting with a coding agent ad hoc, you drive each **feature** through a
disciplined, observable pipeline — with human checkpoints, explicit work-tickets,
and live runs. Think "a factory floor for shipping features," rendered as a
near-black IDE.

## The core loop

Every feature moves left-to-right through six **phases**, each guarded by a **gate**:

`ideation → spec → tickets → implementation → review → shipped`

1. **Ideation** — you launch a Claude Code **session** ("grill") in a terminal to shape the idea.
2. **Spec** — the idea is written up (skippable for small / "collapsed" features).
3. **Tickets** — the work is broken into **tickets** (each has a goal, context, acceptance criteria, "seams" = the files/edges it touches, and `blockedBy` deps). A gate (G2) approves them.
4. **Implementation ("burn")** — a background workflow burns the tickets: it spawns Claude Code to implement each one, producing commits. This is a **run** — a live view with one **lane** per ticket and a streaming event log. The human "Burn" gate (G3) is the go/no-go.
5. **Review** — you **test-drive** the branch (run it to try it), then **merge** to ship.
6. **Shipped** — merged to the main branch.

## Key objects (the vocabulary to keep)

- **Feature** — a unit of work: `slug`, title, `phase`, `status`, git `branch`, `size`.
- **Phase** — lifecycle stage; each has a fixed color (the semantic spine): ideation = violet, spec = grey, tickets = amber, implementation = orange, review = blue, shipped = green.
- **Gate** — a checkpoint between phases; can be advanced or **overridden with a reason**.
- **Ticket** — an atomic implementation task (seq #, status: pending / burning / done / failed / blocked, commits).
- **Run** — one execution of the burner over the tickets (lanes + event stream).
- **Session** — a Claude Code terminal (kind: ideation / qa / burner; status: launching / live / ended).
- **Event** — every state change emits one; the UI polls them ~1.5s. Events are the lifeblood — timelines, activity, and run streams all read from them.

## The surfaces (how the screens map)

- **AppShell** — the frame: title bar, a **features rail** (sidebar), a typed **tab** workspace, an **inspector** rail, a status bar.
- **Overview** — per feature; *not a dashboard*. A single centered column with **exactly one primary action** — a state machine surfaces THE next step (Start grill / Review tickets / Burn / Watch run / Test drive / Merge). Everything else is a quiet secondary link.
- **Tickets** — a burn bar + a ledger of ticket rows (expand for goal / criteria / seams / commits).
- **Run** — 40/60 split: ticket lanes | live event stream.
- **Terminal** — an embedded Claude Code session with a status strip.
- **Inspector** — pipeline stepper + current gate + knowledge docs + recent activity.

## Design ethos (preserve the intent, not necessarily the pixels)

- **VS Code grammar, not a marketing dashboard.** Dense, quiet, keyboard-first.
- **Hairlines, never shadows.** 1px borders and layered near-black surfaces do all separation — no cards, no elevation.
- **One solid (violet) action per view.** The state machine decides what it is; everything else is ghost.
- **Mono for every identifier** (branches, paths, slugs, hashes, counts). Prose is sans.
- **Restraint in motion** — a spinner and a "pulse" for in-progress work; nothing else.
- The **phase palette** is the semantic color system — reuse it wherever lifecycle state appears.

The goal of any redesign: keep runcastle feeling like a calm, legible cockpit
where a human stays in control of an AI that's doing the building — clarity and
one-clear-next-action over decoration.

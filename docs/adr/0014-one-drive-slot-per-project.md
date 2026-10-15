# ADR-0014: One drive slot per project

- **Status:** accepted (2026-10-15)
- **Deciders:** Muath + grilling session
- **Amends:** decision 9 of `docs/features/preparation-proves-its-findings/decisions.md`
  ("the dry run occupies the same singleton drive slot as real test drives")
  and decision 9 of `docs/features/project-level-test-drive/decisions.md`
  ("a project drive shares the one slot unchanged; wherever it blocks, it is
  named and stoppable")

## Context

The server held one drive slot for the whole machine. Every kind of drive (a
human's feature test drive, a review agent's drive, a project drive, a
preparation dry run) from every project occupied it, so a drive in one project
disabled drives in every other. Observed live: jewellery-system's Test drive
button was disabled by a review agent's drive of the runcastle repo.

Both decision 9s justify the single slot by collisions inside one repo: the
same checkout, dev pane, `.runcastle/drive.env`, ports and database server.
Across projects the checkout, dev pane and drive env file are all distinct, and
one project is one checkout, because projects are upserted by canonical repo
path. Cross-project blocking was never decided. It was an accident of the slot
being one variable. `merge-is-not-blocked-by-another-project-s-drive` already
fixed the same accident for merges, and only for merges.

## Decision

1. **One drive slot per project.** A drive in one project never blocks a drive
   in another.

2. **Within a project, every rule of those decisions holds.** One drive at a
   time across all four kinds, the same refusals in the same words, a blocking
   drive always named and stoppable, and a review agent never preempts a human
   drive.

3. **Each project sees only its own drive.** No surface shows another
   project's drive, and the drive API is asked per project. Nothing answers
   "what is driving anywhere".

4. **No cross-project collision detection, by design.** If two projects'
   drives contend for a port or a database server, it surfaces the way any
   failed dev server does (dev pane output, readiness timeout). There is no
   pre-flight check and no new refusal.

## Consequences

- `RUNCASTLE_ID` is unchanged, and it is unique within a project only.
  `project_drive` and `prep_dry_run` are the same in every project, and two
  projects' feature drives can share a slug. A drive script that names
  anything shared across projects, such as an index on a local Redis or a
  schema in a shared database, must prefix it with the app name. The prepare
  recipes now do.
- Projects prepared from the older Redis or schema-per-drive recipe keep their
  scripts. Nothing checks them.
- The two shipped `decisions.md` files are left as written. This ADR is where
  the change lives.

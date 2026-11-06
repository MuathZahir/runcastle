# Outcome — Cheaper burns

Burns and reviews spend far less: smaller tickets, one consistent check rule, reviews that don't read screenshots back, a slimmer docs digest, compaction, and a cheaper default model if the human agrees.

- Shipped: 2026-11-06

## What shipped

9 commits · 20 files

- 0 tickets landed
- 0 waived
- 0 failed

## Review record

### Ticket 1 · review

- Reviewed commit: 7fdebfd3e274e4ed31fd4db0026781854a63443f
- Landed since: 0
- Outcome: done

- **Test gate failed: the Bun terminal's kill-tree test left the grandchild alive** — dismissed
- **The withheld-docs table lost its doc comment to the new inlined-doc constants** — fixed
- **The digest's `withheld` list now carries brief.md and decisions.md, which are listed, not withheld** — open
- **The new line-number sed rule overlaps most of the older multi-range sed rule** — open
- **Three new tests pin prompt and guide wording rather than behaviour** — open
- **Line-number sed edits still get past the guard in several common spellings** — fixed
- **The conflict prompt runs the static check "once" but lacks the worker's "once more only after a fix"** — open
- **No record yet names which review-prompt rules moved or merged** — open
- **emit_tickets returns every ticket-shape warning, not only the over-eight-criteria one** — open

## Notes record

- No human notes

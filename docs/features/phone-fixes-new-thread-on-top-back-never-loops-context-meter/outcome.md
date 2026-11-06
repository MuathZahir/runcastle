# Outcome — Phone fixes: New thread on top, Back never loops, context meter

Three mobile bugs: New thread sits at the top of the thread sheet, Back from anything opened in a thread never loops, and the context meter shows on the phone.

- Shipped: 2026-11-06

## What shipped

5 commits · 15 files

- 0 tickets landed
- 0 waived
- 0 failed

## Review record

### Ticket 1 · review

- Reviewed commit: 83d6dca7c9f363486f086656ee8efd423889c16f
- Landed since: 0
- Outcome: done

- **The "Feature at review" scenario fails: runcastle-demo "is not registered", though the driven app lists it** — dismissed
- **The review drive's capture closes the review browser and saves a blank 1280px page** — open
- **The original loop, Back from a design opened in a chat, was not driven: no demo feature has a design, and feature agents would not start** — open
- **A view opened from a link still loops on the phone: the chat's Back (arrow or browser) reopens the Plan, forever** — fixed
- **Test gate failed on 83d6dca: pty-bun "kills the whole tree" left the grandchild alive** — fixed

## Notes record

- No human notes

# ListRow

A 40px list row in the content panel: glyph, one-line title, trailing meta — for conversations, tickets, laps, runs.

**Consumer provides** `title`, one of `phase` / `dot` / `icon`, optional `meta` (timestamp, count). Wrap rows in `.rc-list` (add `.rc-list--divided` for `border-subtle` dividers in long lists).

**Do** keep titles human: strip pasted markup (`<pasted_content …>`, `<local-command-stdout>`) and show "Untitled chat" in `text-tertiary` when there is none.

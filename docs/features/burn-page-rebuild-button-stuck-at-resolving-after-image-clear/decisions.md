# Decisions — burn-page-rebuild-button-stuck-at-resolving-after-image-clear

Quick-change feature: no grill session; the original intent is the two
sentences in `brief.md`.

## Revisited 2026-09-19

- **Shorten the armed Rebuild label.** The armed button label at
  `EnableAfkCard.tsx:514` renders the full Dockerfile path
  (`Rebuild image · <path> → <tag>`). Shorten it: path → basename, or drop
  the path from the label entirely (implementer's call on which reads
  better); the full path stays in the tooltip, which already carries it
  (`title` at EnableAfkCard.tsx:506). Added to ticket 1 (the EnableAfkCard
  image-row ticket).

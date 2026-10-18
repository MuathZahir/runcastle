# IconButton

A square ghost button holding one icon — the default for toolbar, title-bar and row actions.

**Consumer provides** `icon` (a name from the Icons group), `label` (required: becomes the tooltip and accessible name), optional `size` (`sm` inside rows, `md` in bars).

**Do** prefer an icon button to a text button in chrome (search, settings, panel toggles, the row's "…").
**Don't** give it a border or fill at rest; hover alone reveals it.

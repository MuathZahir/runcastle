# NavItem

One row of the sidebar: icon (or phase glyph), a single-line label, optional trailing meta. 32px tall.

**Consumer provides** `label`, one of `icon` / `phase`, optional `meta` (a count or "2/3"), optional `dot` for a live state, `active` for the current page, `href` / `onClick`.

**Do** truncate the label to one line — the full title lives in the page header. Selected is `surface-selected` fill and `text`, nothing more.
**Don't** use two-line rows, progress bars, per-row check buttons, "…" buttons at rest, or an outlined/glowing selection. The row's menu is reached by right-click or a hover "…".

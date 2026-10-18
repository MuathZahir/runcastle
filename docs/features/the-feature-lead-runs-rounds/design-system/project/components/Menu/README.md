# Menu

The floating menu surface for row actions, the "…" button and context menus: `surface-raised`, `radius-lg`, `shadow-popover`, 30px items with icons and shortcut hints.

**Consumer provides** `items`: `{label, icon?, kbd?, danger?, active?}` or `'-'` for a separator. In the app it wraps the Radix DropdownMenu in `src/ui/`.

**Do** move secondary row actions (archive, rename, delete, copy branch) here instead of showing them on every row.

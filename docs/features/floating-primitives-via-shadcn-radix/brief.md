## Why this feature exists

Every dropdown/multi-select in the app is broken in the same way, because the web-ui-foundation feature built Dialog/Field/Card/Kbd primitives but never a Select/Popover primitive. Every picker is either a raw `<select>` (6 usages: BaseSelect.tsx, settings/ModelsPage.tsx, settings/RosterTable.tsx, settings/SettingRow.tsx, settings/StepTable.tsx, ui.tsx) or a homegrown list rendered in normal document flow — no portal, no max-height. Observed symptoms, reported by the human 2026-09-06:

- The branch picker when creating a project session renders ALL branches with unlimited height — the human scrolls the whole page.
- The per-ticket model chooser renders INSIDE the ticket card's container, turning that small container scrollable and clipping the menu.
- General inconsistency across pickers.

## The settled direction

The human asked "why aren't we using shadcn?" and, after sizing, agreed on **targeted adoption, not wholesale migration**:

- shadcn is copy-in code (Radix + Tailwind + cva/clsx/tailwind-merge). We take ONLY its floating family — Select, Combobox (searchable, for long branch lists), Popover, DropdownMenu, possibly Tooltip — restyle it with the existing `theme.css` tokens, and place it in/beside `apps/web/src/ui.tsx` alongside the current primitives.
- This **amends** the foundation feature's decision #5 ("no new runtime deps — no clsx, cva, tailwind-merge, no Radix"). That decision was right for buttons and cards; floating components (portals, collision-aware positioning, focus traps, keyboard nav) are exactly where hand-rolling fails and a headless dep earns its keep. Record the amendment in this feature's decisions.md.
- Consistency comes from the tokens, not the component source: the new components must read as the same design system as the rebuilt primitives. Read apps/web/STYLE.md first.
- Requirements the symptoms dictate: portaled rendering (never clipped by an overflow container), capped max-height with internal scroll, searchable combobox for long lists (branches), works inside Dialog overlays.

## Adoption sites (sweep and replace)

- Branch picker on project-session creation / "lands on" pickers.
- Per-ticket model chooser (the one clipping inside ticket cards).
- The 6 raw `<select>` usages, mostly in settings.
- Sweep for any other homegrown dropdown/menu (FeatureActionsMenu, DocsMenu are likely candidates — verify).

## What this feature must NOT swallow

- No rebuilding of the non-floating primitives (Button, Dialog, Card, Field, etc.) — they are fine and stay custom.
- No general restyling or spacing polish of the forms/pages it touches — a separate quick change covers the known spacing regressions.
- No re-mapping of theme.css onto shadcn's CSS-variable scheme; shadcn code is restyled to OUR tokens, not the reverse.

## Open questions for the grill

- Exact component list (is Tooltip in scope? DropdownMenu vs just Popover?).
- Single-select vs multi-select shapes needed at each site (the model chooser may be multi).
- Where the copied code lives (ui.tsx vs a ui/ directory) — foundation outcome notes ui.tsx is already 1044 lines.

# Decisions — floating-primitives-via-shadcn-radix

## 1. One lap, full scope
**Decision:** Single lap covering the whole feature: the floating primitives plus the complete replacement sweep — the broken sites (BranchMenu "lands on" picker, per-ticket ModelMenu), the three other homegrown menus (DocsMenu, FeatureActionsMenu, ProjectSwitcher), and all 6 raw `<select>` usages (BaseSelect + settings pages).
**Why:** The direction was settled in the brief; the design tree is narrow and the sweep is mechanical once the primitives exist. Splitting off the settings selects would cost more coordination than it saves.

## 2. Component list: Select, Combobox, DropdownMenu, Popover — no Tooltip
**Decision:** Adopt exactly four: **Select** (ModelMenu + the settings `<select>`s — grouped single-select), **Combobox** (branch pickers — long lists need search; built on Popover + cmdk), **DropdownMenu** (DocsMenu, FeatureActionsMenu, ProjectSwitcher — action menus, not value pickers), **Popover** (Combobox's foundation, exposed as a primitive in its own right). Tooltip is out of scope.
**Why:** Each component maps to a verified broken/homegrown site. Tooltip fixes nothing that clips today and would be the "general polish" the brief forbids; adding it later is trivial once Radix is in the tree.

## 3. Dep amendment opens for behavior only, not styling
**Decision:** Amend foundation decision #5 to allow the per-primitive Radix packages (`@radix-ui/react-select`, `@radix-ui/react-popover`, `@radix-ui/react-dropdown-menu`) plus `cmdk` for the Combobox. The ban on `clsx`, `cva` and `tailwind-merge` **stays**. Copied shadcn markup is rewritten onto the local `cx()` helper, lookup-map variants, and our tokens.
**Why:** Headless floating behavior (portals, collision positioning, focus traps, keyboard nav) is where hand-rolling fails and a dep earns its keep; string concatenation is not. One styling idiom across ui.tsx beats two. Cost accepted: each shadcn copy needs adaptation rather than paste.

## 4. Code lives in a new `src/ui/` directory, one file per primitive
**Decision:** New `apps/web/src/ui/` directory: `select.tsx`, `combobox.tsx`, `dropdown-menu.tsx`, `popover.tsx`. Adoption sites import them directly. `ui.tsx` is left untouched except for deletions the sweep causes (the homegrown BranchMenu goes away); no barrel; folding ui.tsx into the directory is a later cleanup, not this feature.
**Why:** ui.tsx is at 1,044 lines and four restyled components would push it past 1,600. Mirrors the feature-ui.ts → directory precedent. Keeps this feature's diff additive-plus-deletions with no 30-importer rename riding along.

## 5. Single-select everywhere; no multi-select variant
**Decision:** Every adoption site is a single-value pick: Combobox (single) for branch pickers, Select (single, grouped) for model choosers and settings, DropdownMenu for action menus. No multi-select component is built. Both ModelMenu consumers (per-ticket and bulk "model for all pending") keep their `onChange(id: string)` shape.
**Why:** Verified: no current wire shape is multi-valued. A multi-model-per-ticket idea would be a schema/service change — its own feature, not a UI primitive swap.

## 6. Two layers: generic compound primitives + existing domain wrappers
**Decision:** `src/ui/` exports generic compound primitives shadcn-style (SelectTrigger/SelectContent/…, restyled on `cx()` + tokens). The existing domain components — BaseSelect, ModelMenu, DocsMenu, FeatureActionsMenu, ProjectSwitcher — keep their names, props and call sites and swap only their internals onto the primitives. The homegrown BranchMenu in ui.tsx is reimplemented on Combobox; settings' raw `<select>`s move to the Select primitive within their existing row shapes.
**Why:** Consumer diffs stay near zero and domain knowledge (e.g. BaseSelect's blocking empty-option rule) stays where it lives. The burn is low-risk: internals change, contracts don't.

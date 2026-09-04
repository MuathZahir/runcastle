# Flow map — onboarding and project chooser (as-is, walked 2026-08-28)

Walked with agent-browser against a standalone server on a scratch data dir
(fresh instance), then reloaded as a returning user (0 / 1 / 2 projects, with and
without stored nav). Screenshots in the session scratchpad (`w01`–`w19`).

## Where the shell lands (`Shell.tsx` + `use-project-nav.ts` + `lib/projects.ts`)

| State on load | Lands on |
|---|---|
| 0 projects (any stored nav) | **FirstRunWizard** — the full wizard, every time, even after setup was completed once |
| 1 project, nothing stored | straight into that project |
| 1 project, stored `home` | portfolio home |
| ≥2 projects, nothing stored | portfolio home |
| stored `project:X`, X still open | project X |
| stored `project:X`, X closed | count rule above |
| `open` view | never persisted — a reload mid-open drops you back per the rule |

## A. FirstRunWizard (fresh instance)

`intro → [identity] → runtimes → afk → project`

1. **Intro** — "WELCOME TO RUNCASTLE / Your coding agent, driven through a pipeline", two paragraphs, one button `Set up runcastle →`. No step rail yet.
2. **Git identity** — skipped automatically when `git config` already has name+email; shown afterwards as a passed row ("detected from git config: …"). Otherwise: Name + Email inputs, `Continue` (disabled until valid), writes `git config --global`; error → toast.
3. **Coding agents** — step rail appears (Git identity ✓ · Coding agents · AFK burns · First project). One card per runtime (Claude Code, Codex): state `ready` / `sign in` / `not installed`; not-installed shows an install command + Copy; installed-but-not-signed-in shows `Run <login cmd>` which opens an embedded terminal + `Done — re-check`. `Continue` disabled until ≥1 runtime is ready.
4. **AFK burns** — an explainer paragraph, then the *same* `EnableAfkCard` used in Settings (container runtime / sandcastle image + `Rebuild image` / Claude OAuth token paste + `Save & verify` / Codex signed-in row). Two buttons that do the same thing: the card's own `Set up later` and the page's `Continue to your first project`. Also seeds model defaults from the ready runtimes on exit.
5. **First project** — `OpenProject firstRun` (see C) with kick "WELCOME TO RUNCASTLE / Open your first project". No Cancel, no back. Esc does nothing.

No back navigation anywhere in the wizard. No way to skip to "open a project" from the intro.

## B. PortfolioHome

- Top bar: logo + wordmark (not clickable here), right: `+ Open a project` (ghost).
- Header: "Projects" + count pill + subline.
- Grid: one **ProjectCard** per open project + a dashed **Open a project** card ("Point runcastle at a local git repo").
- ProjectCard: name (truncated w/ ellipsis), health dot, repo path (truncated), three stats (`N features · N running · N needs you`), health label (`NEEDS YOU / AGENT WORKING / STEADY / NO FEATURES YET`), card body click → enter project. Hover reveals `Rename` and `Close`.
  - Rename: inline input (max 80), Enter/blur commits, Esc reverts. F10.3 (stuck rename) is fixed by the blur commit.
  - Close: disabled with a title tooltip while a run is in flight; otherwise closes immediately (no confirm) → toast "closed <name>".
- Closing the last project → home with count **0** and only the Open card. Reload from there → the **full wizard again** (intro, identity, agents, AFK) — nothing remembers that setup was already done.
- No "while you were away" signal (F10.2 still open). No sort/order, no last-opened time.

## C. OpenProject (non-first-run)

Reached from: home top-bar button, home Open card, switcher `Open a project…`. Card: kick "OPEN A PROJECT", heading, blurb, `Repository path` input (placeholder `C:\Users\you\code\your-repo`), `Browse…`, hint line, `Cancel` + `Open` (disabled while empty). Enter submits, Esc cancels (not in first-run).

Outcomes of `Open`:
- valid repo → toast "opened <name>" → enters project (a brand-new repo lands on the **Prepare this project first** screen — the preparation flow, out of scope here).
- same path already open → same project, re-entered silently (upsert).
- not a git repo → inline red box: "not a git repository: <full path>" + hint "Run `git init` in <full path again>, or pick a folder…" (F17.2 fixed, but the path is printed twice, in full).
- path missing → "path does not exist: …" + "Check the path, or use Browse…".
- **relative path** (e.g. `not-a-path`) → resolved against the *server's cwd* and reported as "path does not exist: C:\…\<server cwd>\not-a-path" — leaks the cwd, confusing.
- The error box persists behind the picker dialog when you then click Browse.

## D. DirectoryPicker (modal over C)

- Header "Choose a repository" + ✕. Bar: `↑` up, breadcrumbs (one button per segment — **overflow, no truncation**: a deep path pushes the `Hidden` checkbox off/over the edge), `Hidden` toggle.
- `Path` text input: follows navigation; typed value + Enter navigates; Esc while typing reverts the draft; Esc otherwise closes the dialog.
- Left rail: roots (`C:`, `Home`, `Projects`). Right list: subfolders, `link` tag for symlinks, `GIT` badge on repos; single click enters, double-click on a repo picks it. Empty state: "No subfolders here (hidden folders, junctions and node_modules are filtered)". Truncation notice for huge dirs.
- Footer: current path (right-truncated), `Cancel`, `Open this folder` — picking commits immediately (no second Open).
- Opens at the field's current value (F17.3 fixed) — **including when that value is garbage**: the dialog opens on the server error text, no crumbs, and `Open this folder` is still enabled and would submit the garbage.
- Backdrop mousedown closes it. No keyboard navigation of the list, no search/filter, no "recent" folders.

## E. ProjectSwitcher (titlebar, in-project)

Click project name → menu: label "PROJECTS", one row per open project (✓ on current), separator, `All projects` (→ home), `Open a project…` (→ C). Esc / outside click closes. Long name is CSS-truncated in the button (F20 fixed) but the titlebar path `runcastle / <name>` still swallows the row before truncation kicks in. The logo/wordmark in the titlebar also goes home. The command palette has a project-switch mode too (out of scope: palette is shell).

## Dead ends / gaps found in the walk

1. Wizard replays in full whenever the project list is empty (close all → reload).
2. No back / skip in the wizard; two redundant "continue" buttons on the AFK step; AFK step reuses the Settings card verbatim (heavy for onboarding).
3. Picker breadcrumbs overflow; picker on an invalid initial path is a half-broken state.
4. Relative paths resolve against the server cwd.
5. Error box repeats the full path twice; stale error stays behind the picker.
6. `Close` on a card: no confirm, ambiguous verb (F17.8), and card actions only on hover.
7. No "while you were away" / recency on cards (F10.2).
8. Zero component tests for any of the five components; `first-run.ts` and `projects.ts` are the only tested logic. ~137 legacy rules in `styles.css` for this surface (`.op-*`, `.wizard-*`, `.home*`, `.pc-*`, `.open-card*`, `.dir-*`, `.tb-switcher/.tb-menu*`) plus `.afk-*` shared with Settings.

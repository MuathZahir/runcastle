# Docs for runcastle as it is today

## Problem

The docs at runcastle.dev/docs describe a different product. They call runcastle a Claude Code UI ("requires Claude Code") though Codex is equally supported. They walk six phases and the gates between them, and a preparation session, all of which are gone or going. They run to 7,900 words over six pages with no picture of the app. A newcomer who reads them learns the wrong flow, and the human finds the whole site "way too much text".

## Approach

**What the reader gets.** Four short pages, each a few headings of one or two sentences and a real screenshot of the app doing the thing (decisions 1, 4):

1. **Get started** (`/docs/`). Opens on the pitch in one sentence: runcastle is the software development engine and runs the whole process for you, on Claude Code or Codex (decisions 7, 8). Then install (the two one-line commands and `runcastle`), a few lines of what you need (decision 5), one line on cost and limits (decision 16), the first-run wizard (screenshot), a short "Claude Code or Codex" section with the model settings screenshot (decision 7), and the first ten minutes: open your repo, runcastle prepares it, start a chat (decisions 3, 15). Points to the in-app Glossary (decision 14).
2. **How a feature goes** (`/docs/features/`). Planning, Build, Review, Shipped, as a story (decision 9): talk it through and say yes to the plan; design screens live in your real app; a round of workers builds in sandboxes; a review round test drives it and leaves a review package; you test drive it; you merge. The layout of this page is designed (see the Plan).
3. **The orchestrator** (`/docs/orchestrator/`). Bring it an idea or a complaint and it cuts the work into features; the backlog; notes (Ctrl+J or during a drive) and Triage (decision 10).
4. **Another machine or your phone** (`/docs/vps/`). Install on a server with Claude Code or Codex signed in, `runcastle service install`, SSH forwarding of both 4512 and 4514, `runcastle move` for an existing setup, the phone link over Tailscale from Settings and its notifications (decision 11).

Every page carries the same docs subnav (the four pages) and a Next link to the following page. Runcastle's own words get a few plain words of definition where each page first uses them (decision 14). Facts come from the code and the shipped features' decisions, not the old charter text; the README's sections (Install, Prerequisites, The loop, Claude Code or Codex, On another machine, On your phone) are the current source and are linked for reference detail (decision 5).

**Removed pages and old addresses** (decision 2). The Gates and Preparation pages are deleted, Pipeline is replaced by How a feature goes, Project session by The orchestrator. A new `site/_redirects` (Cloudflare Pages format, one `from to 301` per line) sends `/docs/pipeline/` and `/docs/gates/` to `/docs/features/`, `/docs/project/` to `/docs/orchestrator/`, and `/docs/preparation/` to `/docs/`. `site/sitemap.xml` lists only the four docs URLs (its compare entries are untouched). The site README's file map and its `docs/vps/` line are updated. Links into the old addresses from pages this feature does not own (the landing page, the compare pages) are left to the redirects.

**Styles** (decision 12). A new docs-only stylesheet, `site/docs.css`, loaded after `content.css` by the four docs pages, holds the screenshot figure (`.doc-shot`: wider than the text column, up to 960px, centred, bordered, a caption under it, the image a link to the full-size file) and the four-stage row (`.stages`). `content.css` and `styles.css` are not edited. Class names are prefixed `doc-` where `styles.css` already uses the plain name (`.shot` is a landing-page class). The pages stay JS-free.

**Screenshots** (decisions 6, 17). Nine real captures in `site/assets/docs/`, 2x PNGs of a 1440×900 window, dark theme. Three are new: the first-run wizard on its coding-agents step (Get started), Settings → Models per step with a Claude and a Codex model (Get started), and a design live beside a feature's chat (How a feature goes). Six are copies of the README's captures retaken on 2026-11-05: the plan and tickets, a round in progress, the review package, a test drive with notes (How a feature goes), an orchestrator chat cutting an idea, and the notes inbox with Triage (The orchestrator). The phone section has no picture: the phone link's screen would show a real private network address. The new ones were taken from a scratch data dir (a `VACUUM INTO` copy of the real database with only the `runcastle-demo` project, push subscriptions removed, the server booted from the checkout); the human's real data dir was only read. The recipe and the shot list live in the site README; no capture script is committed. Each image has alt text saying what it shows and a one-line caption.

**Who builds it** (decision 13). The lead, in this checkout, because the captures need the real database and demo project. Then one review round reads the result.

## Seams

- **The static site, served as files** (existing): `python3 -m http.server --directory site` (the design server's command) shows every page as runcastle.dev will. Observe each page, its subnav and Next links, and each image loading.
- **`site/_redirects`** (new): Cloudflare Pages' redirect file; observe that each old docs URL maps to its replacement with 301. Not exercised by the local server, so checked by reading.
- **`site/sitemap.xml`** (existing): observe it lists exactly the four docs URLs plus its untouched landing and compare entries.
- **The pages' text** (existing): observe the words a newcomer reads: no "phase", "gate", "ideation", "burn", "Preparation page", "Project session", or "Claude Code" without "Codex" beside it; prose length per page.

## Out of scope

- The landing page (`site/index.html` and its generated files) and the compare pages (`site/compare/`) belong to sibling features; their links to the old docs URLs are covered by the redirects, and the compare feature will link to the four new URLs.
- `content.css` and `styles.css`.
- The root README's content, except where its links point at a docs URL that changes (only `/docs/vps/`, which keeps its address, so none).
- Deploying runcastle.dev: the orchestrator deploys after this, the landing and the compare features merge.
- Describing the "Start the project" moment of the in-flight feature "the orchestrator prepares the project" (decision 3).

## Open questions

- None open. The phone section has no picture (decision 17). Designing screens live needs a web frontend, and test drives cover web apps and HTTP APIs (the drive's API view), which is what Get started says.

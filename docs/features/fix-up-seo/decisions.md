# Decisions — Fix up SEO

## 1. Scope: technical hygiene + on-page tuning + content expansion
**Decision:** The feature covers three tiers on the static site (`site/`, deployed to runcastle.dev via Cloudflare Pages): (1) technical SEO hygiene — robots.txt, sitemap.xml, JSON-LD structured data, OG/twitter meta completion, theme-color, heading/alt audit; (2) copy-level on-page tuning of the landing page around real search terms ("Claude Code IDE", "parallel Claude Code agents", etc.); (3) new indexable content pages — comparison pages (runcastle vs. alternatives such as raw Claude Code + skills workflows, t3-style tools) and some docs pages. The localhost app (`apps/web`) is out of scope — it has no public surface.
**Why:** Tiers 1+2 are quick wins but the site is a single page; content pages are what actually grow reach. The human explicitly chose to include content expansion and accepts the larger feature size. Content pages parallelize well into per-page tickets for agents.

## 2. Content page set: three comparisons, one roundup, three docs pages
**Decision:** Ship five content surfaces: (1) runcastle vs. T3 Code, (2) runcastle vs. raw Claude Code + skills (the Matt Pocock-style workflow runcastle forked), (3) runcastle vs. Conductor, (4) a category roundup "Claude Code UIs compared" that links into the three comparison pages, (5) a small docs set — getting started/install, the pipeline concept, and gates — derived from README + CONTEXT.md. Comparison claims must be researched at implementation time (web) and stay accurate and generous to competitors.
**Why:** Each page targets a distinct search intent; the roundup catches category queries and concentrates internal links; docs answer product queries without inventing content. Honest comparisons are the ranking asset — puff pieces get ignored.

## 3. Page architecture: no build step, hand-authored HTML, directory-index URLs
**Decision:** Keep the site's no-build-step convention. One hand-authored HTML file per page under `site/`, directory-index style for clean URLs on Cloudflare Pages: `/compare/` (roundup doubles as section index), `/compare/t3-code/`, `/compare/claude-code/`, `/compare/conductor/`, `/docs/` (getting started), `/docs/pipeline/`, `/docs/gates/`. Pages share `styles.css` plus a new `content.css` for article layout; header/footer chrome is duplicated per file. Landing nav gains "Docs" and "Compare" links; footer lists all pages; sitemap.xml enumerates all eight URLs.
**Why:** Seven pages is under the threshold where a generator earns its complexity; each page is written once by an agent and rarely touched. Directory-index files give clean canonical URLs natively on Pages. Duplicated chrome is an accepted trade against tooling.

## 4. One lap, whole spec
**Decision:** Spec the entire feature and ship it in one lap — no thin lap 1. Later-lap candidates parked explicitly: more comparison pages (Vibe Kanban, Crystal, Claude Squad, ...) and blog-style content.
**Why:** The feature is big but not uncertain: every page is independently verifiable, nothing hinges on an experiment, and pages parallelize into per-page tickets. Product facts for docs/JSON-LD are all pinned in the repo (MIT, npm `runcastle`, `bun add -g runcastle`, cross-platform, requires Claude Code, local-only, free).

## 5. Landing copy: surgical tuning only
**Decision:** Keep the "the IDE for Claude Code" positioning and the page's voice. Tuning is limited to: title/meta description phrasing, a single-H1 check, H2s carrying natural search terms where the copy already means them (e.g. "parallel Claude Code agents"), and missing image alt text. No rewrite, no keyword stuffing. Google Search Console verification + sitemap submission is a manual human follow-up recorded in the spec.
**Why:** The copy is crafted and its voice is an asset; modern ranking punishes stuffing. The new content pages carry the reach work.

# Fix up SEO

## Problem

runcastle's entire public surface is one landing page at runcastle.dev. People searching for what runcastle actually is — a UI/IDE layered on Claude Code, parallel agent orchestration, an alternative to T3 Code or Conductor or a hand-rolled skills workflow — never find it: there is no robots.txt, no sitemap, no structured data, and no page answering any query except the brand name itself. Reach is capped by both missing technical hygiene and the absence of indexable content.

## Approach

Three tiers of work, all on the static site (the `site/` directory, deployed as-is to Cloudflare Pages — no build step, a convention this feature preserves).

**Technical hygiene.** Add robots.txt (allow all, point at the sitemap) and sitemap.xml enumerating every public URL. Add JSON-LD structured data to the landing page: `SoftwareApplication` (name runcastle, free, MIT-licensed, cross-platform, requires Claude Code, installed from npm via `bun add -g runcastle`) and the organization/website basics. Complete the social meta set (og:image dimensions and alt, twitter:title/twitter:description, theme-color). Audit heading hierarchy and image alt text.

**Landing copy tuning — surgical only.** The positioning "the IDE for Claude Code" and the page's voice stay. Permitted changes: title/meta-description phrasing, ensuring exactly one H1, letting H2s naturally carry search phrases the copy already means (e.g. "parallel Claude Code agents"), and adding missing alt text. No rewrites, no keyword stuffing.

**Content pages.** Seven new hand-authored HTML pages, directory-index style for clean URLs:

- `/compare/` — category roundup "Claude Code UIs compared", doubling as the section index, linking into each head-to-head.
- `/compare/t3-code/` — runcastle vs. T3 Code (Theo's open-source desktop GUI for AI coding agents).
- `/compare/claude-code/` — runcastle vs. raw Claude Code + skills (the Matt Pocock-style workflow runcastle forked and built the pipeline around).
- `/compare/conductor/` — runcastle vs. Conductor (conductor.build).
- `/docs/` — getting started / install.
- `/docs/pipeline/` — the pipeline concept: ideation → spec → tickets → build → review → shipped.
- `/docs/gates/` — the gates and the two human clicks (Burn, Merge).

Each page duplicates the shared header/footer chrome (accepted trade against introducing a generator), loads the existing landing stylesheet plus a new shared article stylesheet, and carries its own full head: unique title and meta description, canonical URL, OG/twitter tags, and appropriate JSON-LD (`FAQPage` or `Article` where it genuinely fits, nothing forced). Every page links back to the landing page and its siblings; the landing page gains "Docs" and "Compare" nav links and a footer block listing all pages, so every URL is reachable by crawl from the root.

**Content rules.** Comparison claims are researched on the live web at implementation time and must stay accurate and generous to competitors — honesty is the ranking asset. Docs content is derived from the repo's README and CONTEXT.md, never invented. Product facts are pinned: MIT license, npm package `runcastle`, `bun add -g runcastle`, macOS/Windows/Linux, requires Claude Code, fully local, no hosted backend, free.

**Manual human follow-up (not a ticket):** verify runcastle.dev in Google Search Console and submit the sitemap — requires the owner's Google account.

## Seams

- **The static file tree under `site/`** (existing) — the deployment unit *is* the seam: Cloudflare Pages serves it verbatim, and any static file server reproduces it locally. Observe: every page renders, chrome is consistent, internal links resolve, styles load.
- **Per-page `<head>` metadata** (new surface on existing seam) — each page's title, description, canonical, OG/twitter tags, and JSON-LD are directly inspectable in the served HTML; JSON-LD validates against schema.org.
- **Crawl contract: robots.txt + sitemap.xml** (new) — machine-readable enumeration of the site; observe that the sitemap lists exactly the eight public URLs and robots.txt points to it.

## Out of scope

- The localhost app (`apps/web`) — no public surface, SEO-irrelevant.
- The GitHub README as a search surface.
- A static site generator or any build step for pages.
- Blog-style content and additional comparison pages (Vibe Kanban, Crystal, Claude Squad, …) — parked for later laps.
- Google Search Console setup (manual human step, noted above).

## Later laps

- More comparison pages: Vibe Kanban, Crystal, Claude Squad, and whatever the category grows next.
- Blog-style content (release notes, workflow essays) if reach warrants it.

## Open questions

None — all decisions locked in ideation. Competitor-fact freshness is deliberately deferred to implementation-time web research.

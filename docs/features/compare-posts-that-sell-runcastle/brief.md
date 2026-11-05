## Purpose
The compare pages at `site/compare/` (overview `index.html` 2.9k words, `conductor/` 2.2k, `t3-code/` 2.4k, `claude-code/` 2.5k) are, in the human's words (2026-11-05), "so bad. They should try to convince the user to use runcastle. Right now they're trying to be politically correct. Also, there's way too much text. It should feel like a blog." They are also stale: they describe the old pipeline (ideation/spec/tickets…, six phases), link `/docs/gates/` and `/docs/pipeline/`, and frame runcastle as a Claude Code UI though Codex is equally supported.

## Step one: research, then a stop for the human
The human: "we need to look for new competitors since and recheck the existing ones to make sure info is up to date." Before writing:
1. Recheck Conductor and T3 Code against their current sites/docs/changelogs; note what changed since the pages were written.
2. Look for new competitors in the same space (tools that run coding agents on features/branches in parallel: e.g. Codex's own app, Cursor background agents, Vibe Kanban, Sculptor, others found).
3. Present the human with a short list: each tool, one line on what it is, and your recommendation of which get a post. **This is the one point the human asked to decide in this cut** — wait for their pick (it will come relayed by the orchestrator) before writing posts.

Default set, agreed: keep the overview + Conductor + T3 Code, and turn "vs Claude Code" into **"Claude Code or Codex on their own"** (the real alternative for most readers; keep the old URL redirecting to it via `site/_redirects` if it moves). Any new post adds width.

## The pitch (shared, settled by the human)
runcastle is **the software development engine** (the new landing headline). It runs the software process for you: cut the idea, plan, design in your real app, build in sandboxed rounds, review with a walkthrough, test drive, merge. Other tools hand you an agent (or many) and leave the process to you: the branches, the prompts, the checking, the testing. The moat is streamlining the process and making the developer's life easier, not code safety. A good opening line for posts: "Agents don't need more prompts. They need a process."

## Understood
- Tone: persuasive and opinionated, not neutral. Still accurate about the competitor; no false claims (that would cost credibility). Say plainly where runcastle wins.
- Form: short blog posts. A post per competitor, a punchy headline, little text, visuals doing work (existing captures in `site/assets/screens/`, brand logos in `site/assets/logos/`).
- This feature owns `content.css` (the reading surface shared by docs and compare) for the blog look; the docs feature only adds small things to it.
- Only link docs URLs the docs feature will keep: today's `/docs/`, `/docs/project/`, `/docs/vps/` survive; `/docs/gates/`, `/docs/preparation/` go away and `/docs/pipeline/` is being rewritten (maybe renamed). The orchestrator will pass the docs feature's final URL list; until then link `/docs/` only.
- Update `site/sitemap.xml` for any page added or removed.

## Must not swallow
The docs (`site/docs/`) and the landing page (`site/index.html`, generated) belong to sibling features running in parallel.

## Open
- Which competitors get posts (the human's pick after research).
- Whether the overview page stays a page or becomes a blog index of the posts.

## Ordering
No dependencies; runs in parallel with "The software development engine" and "Docs for runcastle as it is today". The orchestrator deploys runcastle.dev after all three merge.

## Working agreement (cut of 2026-11-05)
Autonomous: the orchestrator carries this to merged, merging when the feature's own review is clean, and the human comes back at the end. The single stop is the competitor pick after research. The human chose this.

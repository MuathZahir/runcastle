# Chats link to what they name

## Problem

When an agent sends the human somewhere ("the Header worker is waiting for you", "look at Faster reviews' plan"), it can only write the name. The human then has to find that feature or worker in the sidebar, which is worst on a phone. Feature links exist only inside the orchestrator's action cards; nothing an agent writes in its own words can be clicked.

## Approach

**What the human sees.** In any agent's chat (orchestrator, feature lead, worker, Review worker), on desktop or phone, a feature or worker the agent linked reads as an ordinary link in the sentence. One click opens it: a feature opens as a sidebar click would (its chat on a phone, its remembered view beside the lead's chat on a desktop), a Plan or Design link opens that tab, and a worker link opens that worker's chat in its feature. Back returns to where they clicked. A link whose target the app has no record of reads as its words in plain text. Finished features and workers still open.

**What agents write** (decisions 1, 2). A standard markdown link with a runcastle target:

```
[Faster reviews](feature:faster-cheaper-reviews)
[its plan](feature:faster-cheaper-reviews/plan)
[the designs](feature:faster-cheaper-reviews/design)
[the Header worker](worker:<worker id>)
```

Any other target (http, a path, an unknown scheme) behaves as links do today.

**Rendering.** All agent chat text goes through the web app's one markdown component. It gains:

- a URL filter that keeps the `feature:` and `worker:` schemes, which the markdown library strips by default, and passes everything else to the library's default filter;
- a link renderer that, for a runcastle target, asks a links context to resolve it. Resolved, it renders an `<a>` in the existing link look whose `href` is the app's real address for the target (a feature's address, with its view segment for Plan or Design; a worker's feature chat address) and whose click, unless modified (Ctrl, Cmd, Shift, middle button), prevents the default and opens it in place through the shell's existing navigation. Unresolved, or with no links context (a chat rendered outside a project shell, such as a scenario page), it renders the link's children as plain text.

**Resolving.** The project shell already provides a feature-links context (the project's features and an `openFeature(featureId, view?)`) and holds `openWorkerChat(featureId, workerId)`. The context grows to carry the worker opener and a way to resolve a worker id:

- a feature target resolves by slug against the shell's feature list, which holds every feature of the project whatever its state; slugs never change;
- a worker target resolves to its feature through a small new server read (worker id to its feature's id and slug, or null), cached per id by the query client. A worker owned by no feature (a project drive's Scenarios worker) resolves to null and reads as plain text.

While a resolution is loading, the words render as plain text and become a link once it resolves.

**The rule** (decisions 6, 11). One short rule goes into each briefing: the orchestrator's skill, the feature lead's skill, the Q&A skill, the server-built worker briefing, and the Review worker's briefing. It says: when you point the human at a feature, a worker, or a feature's Plan or Design tab, link it with one of the target forms above, using a slug or worker id a runcastle tool gave you, never a guess. The orchestrator's line adds that worker ids come from a full read of a feature. Nothing else in those briefings changes. Skill text edited in this repo reaches live sessions only once runcastle is published and reinstalled.

## Seams

- **Link target parsing** (new, pure): a function from an href to `{ kind: 'feature', slug, view?: 'plan' | 'design' } | { kind: 'worker', id } | null`. Unit-tested on every form, including malformed ones (`feature:`, `feature:x/drive`, `worker:`), which return null.
- **The markdown component with a links context** (existing component, extended context): render agent text with a fake context and observe, in the DOM, a resolved link (href, click calls the opener, modified click does not), an unresolved one (plain text, no `<a>`), one with no context (plain text), and web links unchanged. Rendered tests with Testing Library, beside the existing markdown and shown-files tests.
- **Worker lookup** (new tRPC read): a worker id returns its feature's id and slug, a project-owned or unknown id returns null. Tested at the router or service.
- **Briefing text** (existing): the worker briefing builder's output contains the rule, checked by its existing tests; the three skill files and the review briefing contain it.

## Out of scope

- Feature docs shown in the Plan tab, phone notifications and the Review Package's findings: names there stay plain text (decision 9).
- A link to one exact design or to a file shown with `show_file`; a link to the orchestrator's chat (decision 10).
- Turning names into links without the agent writing a link (decision 1).
- Any status dot, chip or "needs you" mark on a link: that belongs to "Needs you is the agent's call".
- Rewriting the skills beyond the one rule: that belongs to "Skills become short rules".
- Logging or counting links that resolve to nothing (decision 11).
- Links across projects (decision 5).

## Open questions

- The worker lookup could instead come from a project-wide worker list if one appears later; the new read is the smallest step now.

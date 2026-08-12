# Skill packs

**Packs** are runcastle-owned Claude Code *plugin directories* wired to runcastle's MCP contracts. They are injected into each launched terminal via `--plugin-dir`, so the human's Claude Code needs nothing preinstalled, and upstream changes to Matt Pocock's skills can never break us. Six of the eight skills are adapted forks of his methodology skills and each keeps a provenance header crediting the original; `revisit` and `waypoint` are original runcastle work.

## The `runcastle` pack

Scope-specific skills, each namespaced `/runcastle:<skill>`:

| Skill | Invoked | Does |
|---|---|---|
| `/runcastle:ideate` | entry for `kind=ideation` | grills the human, locks decisions incrementally, drives spec + tickets out of one unbroken window |
| `/runcastle:spec` | by ideate | synthesizes `spec.md`, completes the `spec` phase |
| `/runcastle:tickets` | by ideate | emits session-sized vertical-slice tickets via MCP, completes the `tickets` phase |
| `/runcastle:qa` | entry for `kind=qa` | read-only Q&A over an existing feature; never advances phases |
| `/runcastle:project` | entry for `kind=project` | project scope, not feature scope: grills a lump of intent into N features and creates them, routes, answers portfolio questions, curates advisory-only, and owns `CONTEXT.md` |
| `/runcastle:waypoint` | entry for `kind=waypoint` | *original* — works ONE waypoint on a mapped feature, writes its decision prose, resolves the waypoint |
| `/runcastle:converge` | entry for `kind=converge` | closes a mapped feature: reads only the compressed knowledge, then drives spec + tickets from it |
| `/runcastle:revisit` | entry for `kind=revisit` | *original* — folds late information into a finished feature; on a Rethink, runs the whole front half of a lap |

Layout (the verified plugin format — only `plugin.json` lives inside `.claude-plugin/`; `skills/` is a sibling at the plugin root):

```text
packs/
├── README.md
└── runcastle/
    ├── .claude-plugin/
    │   └── plugin.json        # name: "runcastle" → sets the /runcastle: namespace
    └── skills/
        ├── ideate/SKILL.md
        ├── spec/SKILL.md
        ├── tickets/SKILL.md
        ├── qa/SKILL.md
        ├── project/SKILL.md
        ├── waypoint/SKILL.md
        ├── converge/SKILL.md
        └── revisit/SKILL.md
```

## How the launcher consumes a pack

The session launcher spawns Claude Code with the pack's **root** directory (the folder that directly contains `.claude-plugin/`) passed to `--plugin-dir`:

```bash
claude ... --plugin-dir "<abs path>/packages/skills/packs/runcastle" ...
```

The `name` field in `plugin.json` becomes the invocation namespace, so the skills resolve as `/runcastle:ideate` and friends. The injected system prompt tells each session which entry skill to invoke for its kind (`/runcastle:ideate` for ideation, `/runcastle:qa` for Q&A). All eight skills carry `disable-model-invocation: false`, so the model may also reach for them by description.

## Adding a pack

1. Create `packs/<pack-name>/.claude-plugin/plugin.json` with at least `{ "name": "<pack-name>" }` — `name` sets the `/<pack-name>:` namespace.
2. Add skills at `packs/<pack-name>/skills/<skill>/SKILL.md` (folder name = skill name; frontmatter needs `description` + `disable-model-invocation`).
3. If you are forking an upstream skill, keep the provenance header and rewire its steps to runcastle's MCP tools (`get_feature_context`, `emit_tickets`, `record_event`, `complete_phase`).
4. Pass another `--plugin-dir` for it at launch.

## Not a pack: `../burner/`

The sibling `packages/skills/burner/` holds **prompt templates**, not skills — e.g. `implement-ticket.md`, rendered per ticket by the AFK ticket-burner workflow (placeholders `{{TICKET_JSON}}`, `{{FEATURE_BRIEF}}`, `{{DOCS_DIGEST}}`, `{{COMMIT_CONVENTION}}`). It is never passed to `--plugin-dir`.

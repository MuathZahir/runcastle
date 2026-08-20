# Skill packs

**Packs** are runcastle-owned Claude Code *plugin directories* wired to runcastle's MCP contracts. They are injected into each launched terminal via `--plugin-dir`, so the human's Claude Code needs nothing preinstalled, and upstream changes to Matt Pocock's skills can never break us. Most of the pack's skills are adapted forks of his methodology skills and each keeps a provenance header crediting the original; `revisit` and `waypoint` are original runcastle work.

## The `runcastle` pack

Scope-specific skills, each namespaced `/runcastle:<skill>`:

| Skill | Invoked | Does |
|---|---|---|
| `/runcastle:ideate` | entry for `kind=ideation` | grills the human, locks decisions incrementally, drives spec + tickets out of one unbroken window |
| `/runcastle:spec` | by ideate | synthesizes `spec.md`, completes the `spec` phase |
| `/runcastle:tickets` | by ideate | emits session-sized vertical-slice tickets via MCP, completes the `tickets` phase |
| `/runcastle:qa` | entry for `kind=qa` | read-only Q&A over an existing feature; never advances phases |
| `/runcastle:project` | entry for `kind=project` | project scope, not feature scope: consults the portfolio, advises on how a lump of intent should be cut into N features and creates them, routes, answers portfolio questions, curates advisory-only, and owns `CONTEXT.md` |
| `/runcastle:waypoint` | entry for `kind=waypoint` | *original* — works ONE waypoint on a mapped feature, writes its decision prose, resolves the waypoint |
| `/runcastle:converge` | entry for `kind=converge` | closes a mapped feature: reads the compressed knowledge — `map.md`, `decisions.md`, and the `research/*.md` deliverables the research waypoints produced — then drives spec + tickets from it |
| `/runcastle:revisit` | entry for `kind=revisit` | *original* — folds late information into a finished feature; on a Rethink, runs the whole front half of a lap |
| `/runcastle:code-review` | by description, or by name | two-axis review (Standards + Spec) of a feature branch's diff against its base, run as parallel sub-agents and reported unmerged; never edits |

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
        ├── project/
        │   ├── SKILL.md
        │   └── references/         # loaded on demand by SKILL.md, never up front
        │       ├── charter.md
        │       └── health-sweeps.md
        ├── waypoint/SKILL.md
        ├── converge/SKILL.md
        ├── revisit/SKILL.md
        └── code-review/SKILL.md
```

### `references/` — progressive disclosure

A `SKILL.md` is loaded **in full, unconditionally**, the moment its session
starts. So a section that only one conversation in five will ever need is a tax
on the other four. The convention (the same one upstream skills use) is a
`references/` directory beside `SKILL.md`, listed in the body by relative path
with a one-line description of when to read it; the agent has file tools in its
worktree and reads one only when that job actually arrives.

`project` is the case that earned it: the charter format (a full verbatim
markdown template) and the health-sweep procedure were ~18% of the largest skill
in the pack, loaded on every intake conversation that never touches either. Both
moved to `references/`, and `SKILL.md` keeps only the rules that must fire the
moment the subject comes up — "never scaffold an empty charter", "never run a
sweep unprompted" — plus the pointer.

Use it when a section is (a) long, (b) needed by a minority of the skill's
conversations, and (c) safe to be absent until then. Do **not** use it for
prohibitions or contracts: a rule the agent must not break has to be in the
always-loaded file, because a rule it has not read is not a rule.

## How the launcher consumes a pack

The session launcher spawns Claude Code with the pack's **root** directory (the folder that directly contains `.claude-plugin/`) passed to `--plugin-dir`:

```bash
claude ... --plugin-dir "<abs path>/packages/skills/packs/runcastle" ...
```

The `name` field in `plugin.json` becomes the invocation namespace, so the skills resolve as `/runcastle:ideate` and friends. The injected system prompt tells each session which entry skill to invoke for its kind (`/runcastle:ideate` for ideation, `/runcastle:qa` for Q&A).

### `disable-model-invocation` — session entries off, chained and reached ones on

Every skill's `description` is loaded into every session in the pack, whether or
not that session can use it. That is cheap for a skill the model might genuinely
need and actively harmful for one it must not run: a `qa` session was carrying
the descriptions of `ideate`, `spec`, `tickets`, `converge`, `revisit`,
`waypoint` and `project` (~582 tokens), every one of them advertising a procedure
`qa/SKILL.md` forbids. Sharper still, `project/SKILL.md` says "**Never run an
ideation grilling**" while `ideate`'s description sat in the same list offering
exactly that.

So the six **session-entry** skills — `ideate`, `qa`, `converge`, `revisit`,
`waypoint`, `project` — carry `disable-model-invocation: true`. They are never
model-chosen: the kickoff line the launcher injects names the one skill for that
kind explicitly, by name, and explicit invocation works fine for a skill with
model invocation disabled. Nothing else should ever reach them, because reaching
one means a session running another session's procedure.

The remaining three stay `false`, each for a reason:

- `spec` and `tickets` are **chained**, invoked by name from inside `ideate`
  and `converge` mid-conversation.
- `code-review` is the one skill that is not a session entry point at all — being
  reached by description is the only way it is reached.

The rule, for anything added later: **a session-entry skill disables model
invocation; a chained or genuinely description-reached one does not.** The
question is not "might this be useful?" but "is there a session whose *whole job*
is something else that could pick this up by mistake?" If yes, disable it and
invoke it by name.

## Layering: prompt, skill, hook — one home each

A launched session reads the same fact from up to four places: the injected
system prompt, the entry skill, a skill it chains into, and the deny message of
a hook. Restating a rule in all of them does not make it stick harder — it makes
each copy free to drift, and the drifted copy is the one that gets believed.

The standing convention across this pack:

- **Per-session facts belong to the prompt** — the slug, the paths, the kind,
  the kickoff line, and the standing prohibitions the hooks enforce (the no-code
  rule lives there, backed by `launcher/edit-guard.ts`, and is *not* restated in
  any skill).
- **Procedures belong to the skill.** One skill owns each procedure in full;
  `revisit/SKILL.md` §Lap mode is the whole lap procedure, `ideate/SKILL.md` §3
  is the whole escalation procedure.
- **Where a skill names a fact the prompt also names, it points instead of
  restating** — the shape is `ideate/SKILL.md`'s "The injected system prompt
  carries the slug and paths; trust `get_feature_context` for the live state."
- **Where two skills need the same procedure, the second delegates by
  reference** — `revisit`'s "escalate the way ideation would
  (`/runcastle:ideate` §3, the map)" rather than a second copy that ages
  differently.
- **A rule the hook enforces is stated once, as enforced, not as advice.** The
  `qa` kind's write refusals are server-side; `qa/SKILL.md` says so rather than
  asking nicely.

A corollary that cost real sessions: **never tell a session to do something a
hook will deny.** An agent that believes a skill and hits a hard deny has no path
forward and improvises — ADR-0007 §6 documents one aborting and emitting a
ticket instead. `prototype` waypoints were in exactly that trap until the skill
was pointed at `docs/features/<slug>/prototypes/`, the one path the edit guard
lets a talk session write code into.

## Adding a pack

1. Create `packs/<pack-name>/.claude-plugin/plugin.json` with at least `{ "name": "<pack-name>" }` — `name` sets the `/<pack-name>:` namespace.
2. Add skills at `packs/<pack-name>/skills/<skill>/SKILL.md` (folder name = skill name; frontmatter needs `name` matching the folder, `description`, and `disable-model-invocation` — see the split above). Long, rarely-needed sections go in a sibling `references/` dir.
3. If you are forking an upstream skill, keep the provenance header and rewire its steps to runcastle's MCP tools (`get_feature_context`, `emit_tickets`, `record_event`, `complete_phase`).
4. Pass another `--plugin-dir` for it at launch.

## Not a pack: `../burner/`

The sibling `packages/skills/burner/` holds **prompt templates**, not skills — e.g. `implement-ticket.md`, rendered per ticket by the AFK ticket-burner workflow (placeholders `{{TICKET_JSON}}`, `{{FEATURE_BRIEF}}`, `{{DOCS_DIGEST}}`, `{{COMMIT_CONVENTION}}`). It is never passed to `--plugin-dir`.

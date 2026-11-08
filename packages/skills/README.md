# @runcastle/skills

Vendored, adapted Claude Code skill packs (SPEC §9, owner A2). Not a TypeScript
package — content only, consumed by the launcher via `--plugin-dir`.

```
packs/      runcastle/ — the skills that speak the MCP tools: forks (qa, project,
            code-review, and the feature lead's grilling and spec) + originals
            (the feature lead, design)
review/     the Review worker's assignments (review, drive, gates, verify) — NOT skills
```

- `packs/runcastle/` holds the forks; every fork keeps a provenance header
  crediting its upstream source (Matt Pocock's skills —
  <https://github.com/mattpocock/skills>) and stays
  `disable-model-invocation: false`. Full upstream license text: `NOTICE.md`.
- `review/*.md` are assignment templates rendered by the Review worker
  (`workers/review.ts`), not loadable skills.

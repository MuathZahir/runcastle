# @runcastle/skills

Vendored, adapted Claude Code skill packs (SPEC §9, owner A2). Not a TypeScript
package — content only, consumed by the launcher via `--plugin-dir`.

```
packs/      runcastle/ — 9 skills that speak the MCP tools: 7 forks (ideate, spec,
            tickets, qa, project, converge, code-review) + 2 originals
            (revisit, waypoint)
burner/     implement-ticket.md — prompt template for the ticket burner (NOT a skill)
```

- `packs/runcastle/` holds the forks; every fork keeps a provenance header
  crediting its upstream source (Matt Pocock's skills —
  <https://github.com/mattpocock/skills>) and stays
  `disable-model-invocation: false`. Full upstream license text: `NOTICE.md`.
- `burner/implement-ticket.md` is a prompt template rendered by the ticket
  burner workflow (SPEC §8), not a loadable skill.

# @runcastle/skills

Vendored, adapted Claude Code skill packs (SPEC §9, owner A2). Not a TypeScript
package — content only, consumed by the launcher via `--plugin-dir`.

```
upstream/   snapshots of Matt Pocock's skills (provenance; do not edit — forks live in packs/)
packs/      runcastle/ — our forked skills (ideate, spec, tickets, qa) that speak the MCP tools
burner/     implement-ticket.md — prompt template for the ticket burner (NOT a skill)
```

- `upstream/` holds read-only snapshots (see `upstream/MANIFEST.md`).
- `packs/runcastle/` will hold the forks; every fork keeps a provenance header
  crediting its upstream source and stays `disable-model-invocation: false`.
- `burner/implement-ticket.md` is a prompt template rendered by the ticket
  burner workflow (SPEC §8), not a loadable skill.

Wave A2 populates `packs/` and `burner/`. Until then this package is a shell.

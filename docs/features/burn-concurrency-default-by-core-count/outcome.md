# Outcome — Burn concurrency default by core count

Default `burnConcurrency` to 1 on hosts with ≤ 8 logical CPUs, keeping 3 above that. Today packages/core/src/config.ts:205 hard-defaults it to 3; the 2026-08-27 audit on a 6C/12T host found that three parallel burns each sizing their worker pools from the full core count caused contention slowdowns and manufactured test flakes (a known set of frontend files flake under load and pass in isolation, re-triaged in 6 burns). An explicit user setting must still win. Core is IO-free, so the CPU count has to be resolved where config is loaded on the server (`os.availableParallelism()` / `os.cpus().length` via node:os) and applied as the default there, not in the zod schema — keep the schema's stated default documented as "3, or 1 on ≤8 logical CPUs". Note in the settings UI (apps/web Settings → Advanced, wherever burnConcurrency is exposed) what the effective default is on this machine. Unit test the resolution function with 6, 8, 12 and 16 cores.

- Shipped: 2026-08-27
- Lap: 1

## 1. Default `burnConcurrency` to 1 on hosts with ≤ 8 logical CPUs, keeping…

# ticket(1) — burnConcurrency defaults to 1 on small hosts

## What was done

`burnConcurrency` now defaults to 1 on hosts with 8 or fewer logical CPUs and
stays 3 above that. The rule is a pure function, `resolveDefaultBurnConcurrency(logicalCpus)`,
in `packages/core/src/config.ts` — it takes the count as an argument, so core stays
IO-free — and `packages/core/src/config-load.ts` asks the host via
`os.availableParallelism()` and applies the result in `loadConfig`, but only when
neither the config file nor an env var already supplied a width. The zod schema
keeps its literal `.default(3)`; its JSDoc now states the real default as
"3, or 1 on ≤8 logical CPUs" and points at the loader.

The number the settings UI shows under an unset field had to move too, or it would
have promised 3 on a machine that burns 1: the server's settings service now builds
its default layer with the host-resolved width (`hostDefaults`), and `SettingsIO`
gained an optional `logicalCpus` so tests can pin a host instead of inheriting the
box running the suite. In the web overlay (Settings → Global, where `burnConcurrency`
is exposed — it is *not* under Advanced, which holds only per-step models) the help
text carries the rule and a new note reads "Default on this machine: N." while the
field is unset. The note reads N off the value the server already resolved rather
than recomputing it, since the browser cannot count the host's cores.

Unit tests cover the resolver at 6, 8, 12 and 16 cores plus NaN/0, `loadConfig`'s
narrowing and both explicit-wins paths (env and config file), the settings view on a
6-core host, and the UI note.

## Surprises

- The resolution had to land in **three** places, not one. `loadConfig` is where a
  run gets its width, but `packages/server/src/services/settings.ts` computes its
  own `DEFAULTS` from `RuncastleConfigSchema.parse({})` and never goes through
  `loadConfig` — so without the second change the settings view and the burner would
  have disagreed about the same unset field.
- Two existing tests asserted the flat 3 as a fallback (`packages/core/test/config-load.test.ts`
  and `packages/server/test/settings.test.ts`). Both now pin a wide host (16) explicitly
  so the tables stay exact literals rather than recomputing the rule.
- `dev-pane.test.ts > kills the child process tree so the port-holder is not
  orphaned` **fails in this sandbox**, both in the full suite and on a targeted
  isolated run. It spawns a real PTY, backgrounds `sleep 300`, and asserts the
  process group is reaped within 400ms — a container process-reaping fault, and it
  imports nothing this diff touches. `pty-teardown.test.ts` also failed on the first
  full run and passed in isolation and on the second full run: a load flake, which is
  the exact phenomenon this ticket exists to reduce. Everything else is green:
  typecheck 0 errors, 2254 passed / 4 skipped.

## Left undone

- `docs/adr/0002-burn-concurrency.md:43` still reads "`burnConcurrency` (int 1–8,
  default 3)". Left alone deliberately — an ADR records a decision as it was made,
  and amending one was not this ticket. A follow-up ADR (or a superseding note) is
  the right home for the new rule if the project wants it recorded.
- Nothing sizes the *in-sandbox* worker pools. The audit's root cause is that each
  concurrent agent still sees the full host core count inside its container; lowering
  the default width mitigates that but does not fix it. `burnCpus` is the existing
  knob for the container side and remains unset by default.
- Drive machinery: unchanged, and no trigger fired — this ticket adds no service, no
  required env var, no seed, and no process the dev environment must run. I verified
  offline that every path `.runcastle/drive-setup.ts` names still exists
  (`packages/server/drizzle`, `packages/skills`, `hook-client.ts`, `pty-host.cjs`,
  `src/assets/sandcastle`). I did not execute `drive-setup`/`drive-stop` — the
  sandbox has no services to bring up.

## 2. Review the integrated change

Runcastle now decides how many tickets to burn at once by looking at the machine it is running on. Until today it always started three agents in parallel, which is the right call on a big workstation and the wrong one on a laptop: three agents each sized their install and test worker pools from the full core count, so a six-core box got oversubscribed threefold, everything slowed down together, and a known set of frontend tests went red purely from the load. Six separate burns were spent re-triaging flakes that the width itself had manufactured. From this lap, a host with eight logical CPUs or fewer defaults to burning one ticket at a time, and anything above that keeps the old three.

Nothing you have set changes. A width in your config file, or the RUNCASTLE_BURN_CONCURRENCY environment variable, still wins outright — the machine only gets a say when you have never expressed an opinion. And because a number you never chose is easy to be surprised by, the Settings screen now tells you which way your machine went: under Burn concurrency, while the field is still empty, it reads "Default on this machine: 1" (or 3), and the help text beside it spells out the rule.

Two things are worth knowing. The first is that this narrows the burn, it does not fix the underlying problem. Each agent still sees every core on your box from inside its container; burning one at a time just means nothing else is competing with it. The knob that actually caps a container, burnCpus, remains unset, and the team's own architecture note already records it as the real remedy — so if you later push the width back up by hand, you are back where the audit started. The second is that the architecture note for burn concurrency still says the default is three. It is now wrong for small hosts and nothing on the branch says so, which is the single thing most worth fixing from this pass.

I could not drive the app to see the new Settings note with my own eyes. The review tool refused to start a drive because the working tree was dirty — and the file making it dirty was the notes file that filing my own review findings had just created, which is a snag in the review machinery rather than anything to do with this change. I followed the note through the code to the component that renders it and it is genuinely wired up, but nobody has actually looked at that screen. Open Settings once and you will have confirmed the only part of this lap a person can see. I also did not run the test suite, since that would have meant taking over your checkout; the implementer reports it green apart from two container-specific failures they diagnosed and disclosed.

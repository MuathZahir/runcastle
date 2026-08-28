## Why this exists

Source: 2026-08-27 runcastle audit, item B0 — "the #1 lever, and it fights nothing." Ranked #3 (~10–25 min per feature), after C1 and B1.

Every burn starts from a fresh clone with a full `pnpm install` (75–240 s) and stone-cold verification caches. The universal over-verification habit is a model habit a raw session has too; the difference is that a raw session pays the cold price once and runcastle pays it per burn. Measured on project-helix backend: incremental tsc is already enabled — cold ≈ 45–75 s, fully warm ≈ 19 s — but `.tsbuildinfo` lives in gitignored `dist/`, so the warm state is thrown away with the sandbox. Calibration: within one burn the 2nd+ typechecks were already warm (~20–40 s); the win is setup elimination plus the first run of each tool per burn.

The operator's decision (audit B2): no verification budget, no counters, no budget commentary in the agent's context. This feature is what makes the habit cheap instead of fighting it.

## What is already settled

- ADR-0004: a BIND-mounted pnpm store is a design error — pnpm cannot hardlink across the mount and copies every file (751 s install). It explicitly names the mechanism for revisiting: "a Docker named volume, not a bind mount." That is this feature. Download-cache bind mounts for bun/yarn/npm (`PM_CACHE_SANDBOX_PATHS`, `~/.runcastle/cache/<pm>`) stay as they are.
- ADR-0005: the agent's hot path is the isolated clone at /home/agent/repo (overlayfs). The cache volume must be usable from there.

## Shape to work out in ideation

- Mechanism: does sandcastle's provider API expose named-volume mounts (`-v name:/path`) or only bind mounts? If only bind, what is the smallest change (upstream PR, a provider option, or a runcastle-side docker invocation)? Verify against the vendored sandcastle version before designing.
- What goes in the volume: pnpm store (`~/.local/share/pnpm/store`), per-package `.tsbuildinfo` (note they live under gitignored `dist/` — needs a path mapping or a `tsBuildInfoFile` override the repo does not have to adopt), vitest/jest cache dirs, turbo cache. Per package manager — the repo may not be pnpm.
- Keying and invalidation: one volume per project; invalidate (or namespace) on lockfile hash change; a way for the operator to clear it.
- Concurrency: N parallel burns (ADR-0002) sharing one volume — pnpm store is designed for this; tsbuildinfo per package is not necessarily. Decide what is shared vs. per-container.
- Podman/Vercel providers: named volumes are Docker/Podman concepts; the feature degrades to today's behaviour elsewhere.

Expected win to verify with ADR-0008's `ticket.timing` telemetry: setup 75–240 s → 10–20 s; first typecheck/test per burn warm.

## What this must NOT swallow

- Agent behaviour, prompts, verification rules, budgets — purely infrastructure.
- The known-baseline mechanism (C1) or the post-commit hook (B1).

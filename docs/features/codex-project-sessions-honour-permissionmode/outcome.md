# Outcome — Codex project sessions honour permissionMode

The Codex adapter ignores `permissionMode`, so a project session on a Codex model gets unattended write approval across the human's whole repo where the same session on Claude asks. `packages/server/src/launcher/launcher.ts:787` deliberately passes `permissionMode: 'default'` for project sessions (decision 18 of codex-runtime-support: whole-repo write access voids the acceptEdits justification); `packages/server/src/launcher/runtimes/claude.ts:63` honours it (`input.permissionMode ?? 'acceptEdits'`) and threads it into settings and argv. `packages/server/src/launcher/runtimes/codex.ts` never reads `input.permissionMode` — `CodexConfigInput` has no such field and `renderCodexConfig` emits a hardcoded `sandbox_mode = "workspace-write"` / `approval_policy = "never"` for every session kind. Fix: add `permissionMode` to `CodexConfigInput`, thread it from `writeArtifacts`, and map it to Codex's `approval_policy` — `acceptEdits` (the default) stays `never`; `default` becomes a prompting policy (`on-request`, or `untrusted` if that is the closer analogue — verify the value set against ctx7 `/openai/codex`, the struct is `deny_unknown_fields`). Keep `sandbox_mode = "workspace-write"` unchanged. Pin it with a test in `packages/server/test/launch-artifacts.test.ts` asserting a project-kind Codex launch renders the prompting policy and a feature-kind launch still renders `never`. Source: docs/features/codex-runtime-support/test-notes.md ~lines 20-47 (code-review finding, unchecked).

- Shipped: 2026-08-27
- Lap: 1

## 1. The Codex adapter ignores `permissionMode`, so a project session on a…

# Ticket 1 — Codex project sessions honour `permissionMode`

## What was done

The Codex adapter now reads the permission posture the launcher hands it.
`CodexConfigInput` gained a `permissionMode` field, `writeArtifacts` threads
`input.permissionMode` into it (same conditional-spread shape the Claude adapter
uses at `claude.ts:160`), and `renderCodexConfig` no longer emits a hardcoded
`approval_policy = "never"` — it calls a new `approvalPolicyFor` helper.
`sandbox_mode = "workspace-write"` is untouched, as the ticket required.

Where I deviated: the ticket offered `on-request` first and `untrusted` as the
alternative "if that is the closer analogue". I verified the value set against
ctx7 `/openai/codex` and chose **`untrusted`**. The `AskForApproval` enum is
`untrusted` / `on-request` (default, aliases `on-failure`) / `granular` / `never`,
and Codex's own rule table in `core/src/tools/sandboxing.rs` reads: "Never: do not
ask; OnRequest: ask unless filesystem access is unrestricted; UnlessTrusted:
always ask". Claude's `default` mode always asks, so `untrusted` is the exact
analogue; `on-request` makes the prompt conditional on a sandbox state the
launcher does not set, which is the same silent divergence the ticket exists to
close. The reasoning is in the helper's doc comment so a reviewer does not have to
re-derive it.

The test lives beside the existing config.toml test in
`packages/server/test/launch-artifacts.test.ts`: a `project`-kind launch with
`permissionMode: 'default'` renders `approval_policy = "untrusted"` (and still
`sandbox_mode = "workspace-write"`), and a `qa`-kind launch in the same test still
renders `never`.

## Surprises

- The line numbers in the ticket are stale. The project session's
  `permissionMode: 'default'` is at `launcher.ts:931`, not `:787` — everything
  else about the finding was accurate.
- **`packages/server/test/dev-pane.test.ts` fails in this sandbox**, contradicting
  the "fully green" baseline I was given: *"kills the child process tree so the
  port-holder is not orphaned"* asserts `pidAlive(-pgid) === false` after
  `stopDevPane`. It fails on a targeted run too, so it is not parallel-load flake —
  it is this container's PID namespace not reaping the group. It cannot be mine:
  my diff is two files (`runtimes/codex.ts`, `launch-artifacts.test.ts`) and
  `dev-pane.test.ts` imports neither, directly or transitively. Full suite
  otherwise: 130 files passed, 2178 tests passed, 1 failed. `bun run typecheck` is
  clean.
- The baseline's own numbers are stale against this branch (it says 118 files /
  1768 tests; HEAD has 132 / 2183), which is worth knowing before someone reads a
  count mismatch as a regression.
- Sandcastle's `permissionMode: 'bypassPermissions'` in `ticket-burner.ts:2441` is
  a *different* knob — it is `ClaudeCodeOptions`, not the runtime seam — so the
  only value that ever reaches this mapping is the project session's `'default'`.
  I kept the mapping two-valued rather than inventing cases for `plan` or
  `bypassPermissions` that nothing passes.

## Left undone

- `docs/features/codex-runtime-support/spec.md` still describes the Codex home as
  carrying "`workspace-write` sandbox with auto-approval as the `acceptEdits`
  analogue", which is now only true of worktree-scoped kinds. It is a past
  feature's spec, so I left it — but it is the sentence the reviewer quoted when
  they filed this finding, and it now under-describes the behaviour.
- The corresponding checkbox in `docs/features/codex-runtime-support/test-notes.md`
  (~line 20) is still unchecked. Ticking a past feature's notes was not in scope.
- Drive machinery: checked, no edit needed. This change adds no service, no
  required env var, no seed and no extra process — it only changes one line of a
  generated per-session `config.toml`. `.runcastle/drive-setup.ts` and
  `drive-stop.ts` are untouched, and per instruction I did not run them.

## 2. Review the integrated change

When you open a project chat — the intake conversation that turns a lump of raw intent into features — runcastle deliberately runs it with a lighter hand than a feature terminal. A feature terminal writes inside its own worktree, so it is allowed to edit unattended; a project chat reaches further, and the rule has always been that it should stop and ask before it writes. That rule was only ever enforced on Claude. Pick a Codex model for the same conversation and it wrote without asking, because the Codex side of the launcher never looked at the permission setting the launcher was handing it. This lap closes that: a project chat on a Codex model now asks, the same way it does on Claude.

The change itself is small and sits in one place — the per-session Codex config the launcher writes before it spawns the terminal. That file now carries an approval policy chosen per session instead of one hardcoded value for everything, and the sandbox setting beside it is untouched, so nothing about where a session may write has moved. Only whether it pauses to ask has.

One decision inside is worth knowing about, because it went against the first suggestion in the brief. Codex offers two ways to make an agent prompt, and the obvious-looking one only prompts when the filesystem is locked down — which it isn't here, so it would have looked correct and quietly done nothing. The stricter one, which always asks, is what landed. That reading was checked against Codex's own source rather than assumed, and it holds.

What deserves your attention is the gap between "the right value is in the file" and "the agent actually stops". Everything that guards this change is a test asserting a line of generated config, and no one on this feature has ever had a real Codex binary to launch against. So the fix is sound on paper and unproven in practice; one project session on a Codex model, confirming it pauses before its first write, would settle it.

Two adjacent things came out of the review that aren't defects in this lap but are worth a decision. The comment written to explain the new mapping describes it as covering worktree-scoped sessions, and that turns out to be backwards at both ends — which led me to notice that the environment-repair and drive-fix sessions genuinely do run unattended in your real checkout, on Claude as well as Codex, and always have. That is the same shape of exposure this lap just fixed for project chats, sitting one call site over. Separately, the older codex-runtime-support spec still describes the behaviour that changed today, and the finding that prompted this work is still an open checkbox there, so it can easily get scheduled a second time.

# Test notes

## Lap 1

- [ ] [Code review — Standards axis] `approvalPolicyFor` closes its return type but leaves its domain open, so any unrecognised posture maps to Codex's *most* restrictive policy.

What I did: read `packages/server/src/launcher/runtimes/codex.ts:112-113` on `feature/codex-project-sessions-honour-permissionmode`.

```ts
function approvalPolicyFor(permissionMode: string | undefined): 'never' | 'untrusted' {
  return permissionMode === undefined || permissionMode === 'acceptEdits' ? 'never' : 'untrusted'
}
```

What happened: the parameter is `string`, and the else-branch is a catch-all. `'bypassPermissions'` — a spelling that exists in this repo at `packages/server/src/workflows/ticket-burner.ts:2441` — would map to `untrusted` ("always ask"), an exact inversion of what the name means. So would `'plan'`.

What I expected: the domain narrowed the way the result was. Commit `0e10670` ("the approval policy is a closed set, so say so") tightened the return type to `'never' | 'untrusted'` but left the input as `string`, which is the half of the closed set that can actually be got wrong.

Citation — smell: **Primitive Obsession** on the hunk above. Note `types.ts:49` types the seam itself as `permissionMode?: string`, so narrowing here means either a local union or tightening the seam.

Severity: latent, not live. I traced `ticket-burner.ts:2441` and it is a `ClaudeCodeOptions` field passed to sandcastle's `claudeCode()` provider, on the non-Codex branch — it never reaches `writeArtifacts`. Today the only value that reaches this mapping is the project session's `'default'` (`launcher.ts:931`, the sole `permissionMode` call site in the launcher).
- [ ] [Code review — Standards axis] The new doc comment's universal claim is false: two session kinds that run in the human's real checkout still render `approval_policy = "never"`.

What I did: read the `approvalPolicyFor` doc block at `packages/server/src/launcher/runtimes/codex.ts:98-113`, then traced every `writeArtifacts` call site in `packages/server/src/launcher/launcher.ts` (lines 530, 661, 784, 921).

The comment asserts:

> `acceptEdits`, the posture every worktree-scoped kind runs under, is `never`: the agent writes inside its own checkout without stopping to ask.

and the test repeats it at `packages/server/test/launch-artifacts.test.ts` — "a worktree-scoped kind keeps the acceptEdits analogue: it writes inside its own checkout unattended".

What happened: the mapping's `never` branch is reached by two kinds that are *not* worktree-scoped —

- `prepare` (`launcher.ts:661-668`) passes `worktreePath: project.repoPath` and no `permissionMode`;
- `drive-fix` (`launcher.ts:784-798`) passes `worktreePath: project.repoPath` and no `permissionMode`.

`project.repoPath` is the human's own checkout; the surrounding comment at `launcher.ts:735-738` says so explicitly ("No worktree, for preparation's reason: the environment that broke is this machine's"). So both get `approval_policy = "never"` across the whole repo — precisely the shape the brief opens by naming as the defect ("unattended write approval across the human's whole repo"), and precisely what decision 18's rationale (quoted three lines above in the same comment) condemns. Conversely `project`, the one kind that *does* get `untrusted`, runs in a runcastle-owned worktree (`git.ensureProjectWorktree`, `launcher.ts:861`), so the comment has the polarity backwards on both ends.

What I expected: either the comment scoped to what the code does ("`acceptEdits` is every kind the launcher does not downgrade"), or the downgrade extended to the other two whole-repo kinds.

Citation — smell: **Mysterious Name**, on the hunk quoted above. The comment was written expressly so "a reviewer does not have to re-derive it", and re-deriving it is what contradicts it.

Scope note: the *behaviour* for `prepare`/`drive-fix` is pre-existing and identical on the Claude adapter (neither call site has ever passed `permissionMode`), so this lap did not regress it. Only the claim is new.
- [ ] [Code review — Standards axis] The rewritten comment re-asserts that the Codex wire values are "pinned against the live CLI"; the repo's own outcome record says the opposite.

What I did: read `packages/server/src/launcher/runtimes/codex.ts:98-101` on the branch, then grepped `docs/features/codex-runtime-support/outcome.md`.

The new prose says:

> its `AskForApproval` enum, whose wire values are pinned against the live CLI — the config struct is `deny_unknown_fields`, so an invented value fails the whole parse rather than degrading to a default

`docs/features/codex-runtime-support/outcome.md:203` records: "`codex` is not installed in the sandbox, so every fact was pinned against ctx7". Line 301 repeats it for the burn path.

What I expected: "pinned against ctx7 `/openai/codex`" — which is what the brief itself instructed ("verify the value set against ctx7 `/openai/codex`") and what the implementer's own digest says they did.

Citation — `CLAUDE.md`, Conventions: "For library/API shapes, use `npx ctx7@latest library|docs` … don't trust training data for API shapes." The rule was followed; the comment mis-attributes the source, which matters because "live CLI" is the stronger claim and the next person to touch this will believe it.

Severity: cosmetic, and the phrasing is inherited — `codex.ts:95` on `main` already said "pinned against the live CLI's `SandboxMode`/`AskForApproval` wire values". This lap rewrote the sentence and carried it forward rather than introducing it.

Separately: I did verify the values independently. `untrusted` is correct — `AskForApproval` in `codex-rs/protocol/src/protocol.rs` is `untrusted` / `on-request` (default) / `granular` / `never`, with `#[serde(rename = "untrusted")]` on `UnlessTrusted`. So the config parses.
- [ ] [Code review — Standards axis] The `acceptEdits` default is now spelled independently in both runtime adapters, with no constant owning it.

What I did: compared the two adapters' handling of the same seam field, `RuntimeLaunchInput.permissionMode` (`packages/server/src/launcher/runtimes/types.ts:49`).

- `packages/server/src/launcher/runtimes/claude.ts:63` — `const permissionMode = input.permissionMode ?? 'acceptEdits'`
- `packages/server/src/launcher/runtimes/codex.ts:113` (new) — `permissionMode === undefined || permissionMode === 'acceptEdits' ? 'never' : 'untrusted'`

What happened: the fact "an absent `permissionMode` means `acceptEdits`" is asserted in three places — those two branches plus the prose on `types.ts:49` ("Overrides the runtime's default permission posture") and the new `CodexConfigInput.permissionMode` doc ("Omitted = the `acceptEdits` default every worktree-scoped kind runs under"). Nothing owns it.

What I expected: the default named once next to the seam that declares the field, so a change to it is one edit. Today, changing the default posture means editing both adapters plus two doc comments, and a runtime adapter added later starts by re-deriving it a third time.

Citation — smells: **Duplicated Code** and **Shotgun Surgery**, on the two hunks quoted above.

Judgement call, and a mild one: the codex branch is not a literal copy (it has to test for the value, not just default it), and the pattern matches how the rest of the adapter pair is written — `codex.ts:428`'s conditional spread deliberately mirrors `claude.ts:160`, which I checked and which is the right call there. Worth raising because this is the second adapter, i.e. the point where the duplication became a pattern rather than an instance.
- [ ] [Code review — Spec axis] The originating feature's spec and its unchecked finding were left stating the behaviour this lap just changed.

What I did: read `docs/features/codex-runtime-support/spec.md` and `test-notes.md`, which the brief names as the source of this change ("Source: docs/features/codex-runtime-support/test-notes.md ~lines 20-47 (code-review finding, unchecked)").

What happened, on the branch as merged:

- `spec.md:15` still reads: "The Codex adapter generates a synthetic per-session `CODEX_HOME` containing `config.toml` (model; `workspace-write` sandbox with **auto-approval as the `acceptEdits` analogue**; …)". That sentence is now true only of the kinds the launcher does not downgrade — and it is the exact sentence the reviewer quoted when filing this finding.
- `spec.md:48` still lists it as an open question: "Exact auto-approval configuration for Codex's `acceptEdits` analogue (`approval_policy`/granular table values) — pin during implementation against the live CLI version". It is pinned now.
- `test-notes.md:25` — the finding itself — is still `- [ ]`: "[Code review — Spec axis] Codex sessions ignore `permissionMode`, so a project session on a GPT model auto-approves the whole repo where the Claude equivalent asks."

What I expected: at minimum the checkbox ticked, so the next person auditing that feature's notes does not re-file a finding that has been fixed.

The implementer disclosed all three under "Left undone" and reasoned that a past feature's docs were out of scope, which is defensible — the brief asks only for the code change and the test. Flagging it because the cost of the omission lands on whoever reads `codex-runtime-support` next, and because a still-open checkbox is how this same fix gets scheduled twice.
- [ ] [Code review — Spec axis] The fix is pinned only by rendered-TOML assertions; the one way it could silently not prompt is untested.

What I did: read the whole rendered config in `renderCodexConfig` (`packages/server/src/launcher/runtimes/codex.ts:131-140`) and the new test in `packages/server/test/launch-artifacts.test.ts`, then checked the Codex config structs via ctx7 `/openai/codex`.

What happened: a project-kind session's `config.toml` now emits, in the same file:

```toml
sandbox_mode = "workspace-write"
approval_policy = "untrusted"

[projects."<worktreePath>"]
trust_level = "trusted"
```

`untrusted` is `AskForApproval::UnlessTrusted`, and the name invites the reading that a project marked `trust_level = "trusted"` is exempt — which would make the whole change a no-op in exactly the case it exists for. I could not observe a real launch to rule that out. From the source I can say it should be safe: `ProjectConfig` (`codex-rs/config/src/config_toml.rs`) carries only `trust_level` and cannot override `approval_policy`; `default_exec_approval_requirement` in `codex-rs/core/src/tools/sandboxing.rs` returns `needs_approval = true` unconditionally for `UnlessTrusted`; and the `unless_trusted.md` prompt template scopes the exemption to "an explicit execution policy rule", not to project trust.

What I expected: the criterion says "Landed and does what it says", and what it says is that the human gets prompted. The test asserts a string appears in a generated file — a value that parses but does not prompt would still be green. This is the criterion I cannot mark verified.

Citation — brief: "`default` becomes a prompting policy … verify the value set against ctx7 `/openai/codex`, the struct is `deny_unknown_fields`". The value set is verified and correct; the prompting is not.

To close it: open one project session on a Codex model and confirm the agent stops for approval on its first write. That needs a real `codex` binary, which by `docs/features/codex-runtime-support/outcome.md:203` has never been available to any agent that has touched this path.
- [ ] [Review summary — lap 1] Code review ran on both axes; no drive, because this lap has nothing a human can operate.

**Scope reviewed.** `git diff main...feature/codex-project-sessions-honour-permissionmode` — 2 commits (`bd6667d`, `0e10670`), 2 files, +50/−6: `packages/server/src/launcher/runtimes/codex.ts` and `packages/server/test/launch-artifacts.test.ts`. Both refs resolve; the branch forked at `1728020`, one commit behind `main`'s tip (`555b584`, this feature's own docs scaffold), so a two-dot diff shows a spurious `brief.md` deletion — three-dot is the honest read and is what I used.

**Standards axis — 4 findings, all judgement calls, no hard violation of a documented standard.** Checked against `CLAUDE.md` (conventions + file ownership: `runtimes/codex.ts` is B1 launcher territory, correctly scoped), `CONTEXT.md`, `docs/adr/0001-0010`. Worst within this axis: the new `approvalPolicyFor` doc block asserts "`acceptEdits`, the posture every worktree-scoped kind runs under" — and I traced all four `writeArtifacts` call sites to find the polarity backwards at both ends. `prepare` and `drive-fix` run in `project.repoPath`, the human's real checkout, and still render `never`; `project`, the kind that now renders `untrusted`, runs in a runcastle-owned worktree. The behaviour is pre-existing and identical on Claude, so this lap regressed nothing — but the comment written to spare a reviewer the derivation is what the derivation contradicts. Close behind: `approvalPolicyFor` narrows its return type to `'never' | 'untrusted'` while leaving its parameter `string` with an else-catch-all, so any future posture — `bypassPermissions`, `plan` — maps to Codex's *most* restrictive policy. Latent only; I confirmed `ticket-burner.ts:2441`'s `bypassPermissions` is a `ClaudeCodeOptions` field on the non-Codex branch and never reaches this seam. Both axes landed on that hunk independently, which is worth knowing when triaging it.

**Spec axis — 2 findings.** No scope creep: the diff is exactly what the brief asked for, and `sandbox_mode = "workspace-write"` is untouched as required. The criterion's "a feature-kind launch still renders `never`" is met despite the wording — there is no `feature` kind in `SessionKind`, and the test's `qa` is the correct feature-scoped stand-in. Worst within this axis: the fix is pinned only by rendered-TOML string assertions. `untrusted` is a valid wire value — I verified `AskForApproval` against ctx7 `/openai/codex` myself rather than taking the implementer's word, and `#[serde(rename = "untrusted")]` on `UnlessTrusted` confirms it parses under `deny_unknown_fields` — and the implementer's documented deviation from the brief's first suggestion (`on-request`) is sound: `default_exec_approval_requirement` makes `OnRequest` conditional on a Restricted filesystem sandbox, which `workspace-write` is not, so it would not have prompted. What no test covers is that Codex actually *stops and asks*, which is the whole point. Second finding: `codex-runtime-support`'s `spec.md:15`/`:48` still describe the old behaviour and its `test-notes.md:25` checkbox is still open — all three disclosed by the implementer as deliberate.

**What I did not do.** No drive: the change alters one line of a per-session `config.toml` and exercising it needs a real `codex` binary, not a browser. I did not run the test suite either — the checkout sits on `main`, which does not contain the change, and I did not switch it. So the implementer's reported result (130 files / 2178 passed, one failure in `dev-pane.test.ts` they argue is a container PID-namespace artifact unrelated to their two files, `typecheck` clean) is unconfirmed by me. Their reasoning that `dev-pane.test.ts` cannot import either changed file is correct as far as I checked, but the run itself is their evidence, not mine.

**Ticket status.** The single implementation ticket succeeded; this is a complete feature, not a partial one. One stale reference worth carrying forward: the brief cites `launcher.ts:787` for the project session's `permissionMode: 'default'`; it is at `:931` today, and `:787` is the `drive-fix` call site. The implementer caught this too.

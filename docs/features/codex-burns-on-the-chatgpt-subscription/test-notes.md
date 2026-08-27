# Test notes

## Lap 1

- [ ] [Code review — Spec axis] The new per-ticket auth gate fails host-run REVIEW tickets that would have run fine.

What I did: read `gateTicketAuth` on the feature branch (`packages/server/src/workflows/ticket-burner.ts:2182`) and traced its wiring at `ticket-burner.ts:3422` and `review-ticket.ts:241-247`.

What happens: `gateTicketAuth` exempts only the whole-run case `deps.config.sandbox === 'noSandbox'`. It then wraps `deps.executeTicketRun` for *every* ticket, and `ticketAuthMissing` is computed from `burnAuthReady(ticketModel.runtime, ticketToken)` with no ticket-kind fork. But a `review` ticket never runs in a container: `executeReviewTicket` hard-codes `onHost: true` and `sandbox: noSandbox()` (`review-ticket.ts:241-247`), which the burner's own header comment states — "A `review` ticket takes none of it — no temp branch, no container, no merge queue — and is executed host-side" (`ticket-burner.ts:102-105`). So in a `docker` run, a review ticket assigned to a runtime whose *unattended* credential is absent (e.g. a Claude review ticket with no `CLAUDE_CODE_OAUTH_TOKEN` in `~/.runcastle/.env`) is now failed with "claude-code is not authenticated — run `claude setup-token`", even though it would have executed on the operator's own host login.

What I expected: the per-ticket gate to skip review tickets, mirroring the run-level `noSandbox` exemption, since the same reasoning ("noSandbox runs the CLI on the already-authed host", `ticket-burner.ts:2213-2215`) applies to them.

Spec citation — the spec asked only for: "the fail-early precheck consults the predicate for Codex instead of 'has a token', and it is cheap enough to run per ticket, so a Codex ticket assigned inside a Claude run is checked too (closing the documented cross-runtime gap)." Gating host-side review tickets is beyond that ask and is a new regression path: `git show main:packages/server/src/workflows/ticket-burner.ts | grep gateTicketAuth` returns nothing, so this gate does not exist on `main`.

Repro: configure a burn with `sandbox: docker` and a Codex run model, add a `review` ticket resolving to a `claude-code` model, and leave `CLAUDE_CODE_OAUTH_TOKEN` out of `~/.runcastle/.env`. The review ticket fails at the gate instead of running on the host.
- [ ] [Code review — Spec axis] Three comments still tell the reader `CODEX_API_KEY` is the only way a Codex burn authenticates. That is now false.

What I did: `git grep -n CODEX_API_KEY feature/codex-burns-on-the-chatgpt-subscription` and opened each hit.

What happens — three stale comments survive the lap:
1. `packages/server/src/assets/sandcastle/Dockerfile:18` — "# Codex CLI (the second agent runtime) — authenticated at runtime via CODEX_API_KEY."
2. `packages/server/src/assets/sandcastle/Containerfile:18` — the same line.
3. `packages/server/src/workflows/ticket-burner.ts:2444-2445`, the doc comment on `buildAgentEnv` — "A container's env starts empty, so a Codex burn that is never handed `CODEX_API_KEY` has no auth at all; this is the only place it gets one." The diff does not touch this comment (`git diff main...<branch> -- packages/server/src/workflows/ticket-burner.ts | grep buildAgentEnv` is empty), and after this lap it is wrong twice over: a container Codex burn gets its auth from the read-only `/mnt/host-codex` mount plus the `onSandboxReady` copy, and `buildAgentEnv` is no longer the only place it gets one.

What I expected: these to be refreshed with the rest of the record. Spec citation — "**Record hygiene.** The Claude-only AFK-auth prose in the project's context, README and build spec gets a short refresh stating that Codex burns borrow the ChatGPT login and Claude burns use the setup token." The out-of-scope list exempts only "The root dogfood `.sandcastle/Dockerfile` (a Claude-only image); the shipped sandcastle asset image already installs Codex" — i.e. it explicitly distinguishes the *shipped asset* image (these two files) from the exempt dogfood one.

Note the user-facing prose (CONTEXT.md:65, README.md:84, docs/SPEC.md:31 and :181) is correctly updated — this finding is only about the three code comments. Zero behavioural impact; it is a record-honesty fix.
- [ ] [Code review — Standards axis] Smell: **Mysterious Name** — two exported `codexHomeDir` functions now mean opposite things, and one file imports the other's module while keeping its own.

What I did: opened both definitions on the feature branch.

- `packages/server/src/services/codex-auth.ts:22` — `codexHomeDir(env)` returns the **host's real** Codex home (`$CODEX_HOME`, else `~/.codex`).
- `packages/server/src/launcher/runtimes/codex.ts:54` — `codexHomeDir(sessionId)` returns a **synthetic per-session** home under the session dir.

The collision is now live inside one file: `launcher/runtimes/codex.ts:14` adds `import { codexAuthFile } from '../../services/codex-auth'` while line 54 continues to export its own `codexHomeDir`. A reader at `launcher/runtimes/codex.ts:389` (`const home = codexHomeDir(input.session.id)`) has to know which of the two is in scope, and the two take different argument types for the same name.

Standard cited — `CLAUDE.md`, "Conventions (SPEC §12)": "**Read `docs/SPEC.md` before implementing anything.** It pins every contract… **Names in the spec are law**." The repo treats naming as a contract; this is the judgement-call end of it, not a hard violation, since neither name is spelled in SPEC.md.

What I expected: distinct names — e.g. `hostCodexHomeDir` in `codex-auth.ts` vs `sessionCodexHomeDir` in the launcher — so the two concepts cannot be confused at a call site.
- [ ] [Code review — Standards axis] Smell: **Middle Man** — `realCodexAuthFile` is now a pure one-line delegation with five call sites.

What I did: opened `packages/server/src/launcher/runtimes/codex.ts` on the feature branch. The lap replaced the function's body with a call to the new shared predicate module, leaving:

```ts
import { codexAuthFile } from '../../services/codex-auth'
…
function realCodexAuthFile(env: NodeJS.ProcessEnv = process.env): string {
  return codexAuthFile(env)
}
```

It adds nothing — same argument, same return, same default. Its five call sites (`codex.ts:155`, `:376`, `:381`, `:425`, and the import) could all call `codexAuthFile` directly.

Smell cited: Middle Man (a class/function that delegates everything it is asked). Removing the wrapper also removes the confusion in the sibling note about the two `codexHomeDir` names, since `realCodexAuthFile` exists only to distinguish "real" from "synthetic".

What I expected: the wrapper deleted and `codexAuthFile` called directly. Judgement call, no behavioural impact — the extraction of the predicate into `services/codex-auth.ts` is itself the right move and is what makes the wrapper redundant.
- [ ] [Code review — Standards axis] Smell: **Duplicated Code across the package boundary** — the web app restates a contract the server already owns.

What I did: compared the new `apps/web/src/lib/afk-rows.ts` against `packages/server/src/doctor/doctor.ts` on the feature branch.

`afk-rows.ts:20` hardcodes which probe drives each runtime's credential row:

```ts
const AFK_CREDENTIAL_SOURCE: Record<AgentRuntime, { check: string; kind: AfkCredentialKind }> = {
  'claude-code': { check: 'afk-key', kind: 'token' },
  codex: { check: 'auth', kind: 'sign-in' },
}
```

That is the same fact the server encodes structurally, one file away, as `RUNTIME_SPECS.codex.ids` having no `afkKey` (`doctor.ts:249`) while `RUNTIME_SPECS['claude-code'].ids.afkKey = 'afk-token'` (`doctor.ts:232`). Two sources for one contract: adding a runtime, or moving one from a key to a login, means editing both, and nothing fails if only one is edited.

Standard cited — `CLAUDE.md`, "Package map": "`@runcastle/core` … IO-free contracts: schemas … workflow types, config" and "`@runcastle/core` is the only package with no IO … Everything else depends on it for **wire types**." A mapping both the server and the web client must agree on is exactly a wire contract, and `afk-rows.ts` already imports `AGENT_RUNTIMES` from `@runcastle/core` — so the shelf is right there.

What I expected: the runtime→credential-kind mapping to live in `@runcastle/core` (or be derived from the doctor report the client already receives), with the web folding rows out of it rather than restating it.

Judgement call — the extraction of `afkCredentialRows` as a tested pure function is itself good, and its fallback behaviour (a runtime whose driving probe is absent yields no row) is well documented.
- [ ] [Code review — Standards axis] Smell: **Repeated Switches** — `runtime === 'codex'` is now the shape of the feature, in four places.

What I did: grepped the feature branch for the runtime test and opened each site.

1. `packages/server/src/workflows/ticket-burner.ts:125` — `return runtime === 'codex' && loggedIn()` (`burnAuthReady`)
2. `packages/server/src/workflows/ticket-burner.ts:900` — `if (runtime !== 'codex' || sandbox === 'noSandbox' || !loggedIn(env)) return undefined` (`codexAuthMountFor`)
3. `apps/web/src/lib/first-run.ts:112` — `const afkReady = runtime === 'codex' ? authed : of('afk-key')?.status === 'ok'`
4. `apps/web/src/lib/afk-rows.ts:20` — the `AFK_CREDENTIAL_SOURCE` literal (sibling note)

Each answers the same underlying question — "does this runtime's unattended credential come from a login rather than a pasted key?" — with its own conditional. A third runtime means finding all four.

What makes this a judgement call worth raising rather than noise: the diff itself demonstrates the data-driven alternative and then does not use it. The same lap made `RuntimeSpec.ids.afkKey` optional (`doctor.ts:249`, commented "No `ids.afkKey`, so the doctor reports `binary` + `auth` only"), which turns exactly this predicate into a property of the spec table. The doctor's own `afkKeyProbe` (`doctor.ts:379`) reads it that way — `const id = spec.ids.afkKey; if (!id) return undefined` — with no `=== 'codex'` anywhere.

Smell cited: Repeated Switches (the same conditional on the same type code, scattered). Standard cited — `CLAUDE.md`, "Package map", which assigns `@runcastle/core` the job of holding contracts every package reads.

What I expected: the four sites to consult one property (a `RuntimeSpec` field, or a small shared predicate) the way `afkKeyProbe` already does.
- [ ] [Drive] Could not start the drive — refused for a dirty working tree, so the browser walk (AC6) and the executed typecheck/test run (AC2) were not performed.

What I did: `mcp__runcastle__review_drive({ action: "start" })`, once.

What happened: `{"ok":false,"deniedReason":"Working tree has uncommitted changes — commit or stash first","drive":null}`. Per the review contract a refusal is final, so I did not retry.

Why the tree was dirty: `git status --porcelain` reports exactly one entry, and it does not belong to this feature —

```
?? docs/features/codex-project-sessions-honour-permissionmode/test-notes.md
```

That is an untracked scaffold file for the *next* feature (`codex-project-sessions-honour-permissionmode`, scaffolded in commit 555b584 on `main`). It is yours, not mine, and the review agent never edits the repo — so I did not commit, stash or delete it to clear the guard.

What I expected: `start` to switch the checkout to `feature/codex-burns-on-the-chatgpt-subscription` and boot the dev server.

To unblock a re-run: commit or stash that one file, then re-run the review.

Consequences for this review, stated plainly:
- **AC2 (typecheck + full test suite on the integrated branch) is UNVERIFIED.** I could not put the branch on disk without switching your checkout, which I am not permitted to do. I did not execute `bun run typecheck` or `bun test`.
- **AC6 (first-run wizard + Enable-AFK card walked in a browser) is NOT DRIVEN**, for the same reason. No recording was started, so there is no `walkthrough.webm`.
- AC1, AC3, AC4, AC5 and AC7 were verified statically against the branch content via `git show`/`git diff`/`git grep` — see the other notes.
- [ ] [Coverage gap] The Enable-AFK card's rendered Codex row is the one spec seam with no coverage from any direction — I could not drive it, and no automated test can reach it.

What I did: after the drive was refused, I looked for automated coverage of the card instead. `git ls-tree -r --name-only <branch> apps/web/test` lists 20 test files, all pure-function tests, and `apps/web/package.json` on the branch has no `@testing-library/*`, no `jsdom` and no `happy-dom` in `devDependencies`.

What this means: `SignInRow` (`apps/web/src/components/EnableAfkCard.tsx:302`) — the new component this feature turns on — is never rendered by anything. The lap tests the *decision* (`apps/web/test/afk-rows.test.ts` covers `afkCredentialRows`) but nothing tests the *rendering*, so these spec observables are unobserved:

> "**Enable-AFK card rendering** (existing component) — Observe: Codex row shows 'signed in' or a Sign-in button wired to the `codex-login` terminal kind; no paste input for Codex."

Specifically unverified: that the Sign-in button actually starts the `codex-login` terminal (the wiring reads correctly — `RUNTIME_LOGIN[row.runtime]` into `trpc.setup.startTerminal` — but was never executed), and that the Claude row is visually unchanged.

Important qualifier, so this is not read as a lap regression: **the absence of component tests is the repo's existing pattern, not something this lap introduced.** `apps/web` has never had rendering-test infrastructure, and extracting the decision into a tested pure function is the best available move within that pattern. I am recording it because it is why AC6 has zero evidence behind it — not because the implementers skipped a test they could have written.

What I expected: to confirm AC6 by walking the card in a browser. That is the check to run by hand before this lap is called done — commit or stash the untracked file that blocked the drive, then either re-run the review or open the Enable-AFK card yourself with `~/.codex/auth.json` present and then renamed away.
- [ ] [Summary of this review pass — read me first]

**Scope of what I actually did.** The code review ran in full against `git diff main...feature/codex-burns-on-the-chatgpt-subscription` (12 feature commits, 24 files, +989/−133). The drive did **not** run — `review_drive start` was refused for a dirty working tree caused by one untracked file belonging to the *next* feature. So everything below is read off the branch's content and its own tests; nothing was executed.

**Code review — Standards axis: 4 findings, no hard violations.** The lap follows the repo's documented conventions: `node:path` throughout, docs updated in the same lap, the auth abort still emits an event. All four findings are judgement-call smells. The worst *within this axis* is **Repeated Switches** — `runtime === 'codex'` is now hardcoded in four places (`ticket-burner.ts:125`, `ticket-burner.ts:900`, `first-run.ts:112`, `afk-rows.ts:20`), each answering the same question, when the same lap already proved the data-driven alternative by making `RuntimeSpec.ids.afkKey` optional and letting `afkKeyProbe` branch on its absence with no runtime check at all. The other three: two `codexHomeDir` functions with opposite meanings, a now-pointless `realCodexAuthFile` wrapper, and the web restating a server-owned contract.

**Code review — Spec axis: 2 findings.** The worst *within this axis*, and the worst thing in this review: **the new per-ticket auth gate fails host-run `review` tickets**. `gateTicketAuth` (`ticket-burner.ts:2182`) exempts only `config.sandbox === 'noSandbox'` at the run level, but review tickets always execute on the host (`review-ticket.ts:241-247`, `onHost: true`, `sandbox: noSandbox()`). In a docker run, a review ticket on a runtime with no *unattended* credential is now failed before it starts, though the operator's own host login would have run it. This gate does not exist on `main`, so it is new. The second finding is three stale comments still calling `CODEX_API_KEY` the Codex burn's only auth.

**What I verified positively, statically.** AC3: doctor, launcher `checkReady` and the burner precheck all resolve the same path through the one new `codexAuthFile`/`codexLoggedIn` predicate (`services/codex-auth.ts`), the launcher change is a pure refactor with resolution byte-identical to main's, and the branch's own `doctor.test.ts` pins that file presence — not `codex login status` — decides ok/fail, honours `CODEX_HOME`, and that the fix text says `codex login` and never `CODEX_API_KEY`. AC4: the mount/copy are wired into the real burn path (`ticket-burner.ts` mounts push + `chainSetupCommands`), and the unit tests pin `{sandboxPath: '/mnt/host-codex', readonly: true}`, `auth.json`-only (asserting `not.toContain('config.toml')`), nothing for `noSandbox`, nothing for Claude. AC5: a test pins that a hand-set `CODEX_API_KEY` still crosses into the container env. AC7: `CONTEXT.md:65`, `README.md:84`, `docs/SPEC.md:31` and `:181` are all refreshed — no Claude-only AFK prose remains in the user-facing record.

**What I could not reach, and why.**
- **AC2 — typecheck and the full test suite were NOT RUN.** Putting the branch on disk requires switching your checkout, which I may not do. This is the largest gap: I can tell you the tests *assert* the right things, not that they *pass*.
- **AC6 — the web walk was NOT DRIVEN**, and has no automated coverage either (`apps/web` has no component-rendering test setup). Zero evidence behind it from any direction.
- No `walkthrough.webm` exists; no recorder or browser was ever started, so there was nothing to clean up.

**Completeness of the lap itself.** No implementation ticket failed and none left a digest, so the summaries above are mine from the diff rather than corroborated by the implementers' own accounts. To close AC2 and AC6, commit or stash `docs/features/codex-project-sessions-honour-permissionmode/test-notes.md` and re-run this review.

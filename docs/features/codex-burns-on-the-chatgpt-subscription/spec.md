# Codex burns on the ChatGPT subscription

## Problem

An operator who has run `codex login` can drive interactive Codex sessions on their ChatGPT plan, but the moment they click **Burn** on a Codex-assigned ticket, runcastle demands a second, differently-billed credential: a pay-per-token `CODEX_API_KEY` pasted into the Enable-AFK card. The container burn's whole environment is that one variable; nothing ever places the login inside the sandbox. Worse, "Codex ready" means three different things — the launcher insists on `auth.json`, the first-run wizard accepts an API key alone, and the doctor's AFK probe wants the key — so the wizard can call Codex ready and the launcher can then refuse to spawn it. The operator feels a setup step that should not exist and gets contradictory answers about whether they are done.

## Approach

From the operator's side there is exactly one Codex setup step, `codex login`, and every surface agrees on whether it has been done. A Codex-assigned ticket burns on the ChatGPT subscription the same way an interactive Codex session does.

**Borrowed login for container burns.** When a burn runs in a container (any sandbox mode but `noSandbox`) and the ticket's model runs on Codex, the burner bind-mounts the host's Codex home (`$CODEX_HOME`, else `~/.codex`) read-only at a fixed in-sandbox path, and the same sandbox-ready command that installs the burn guard copies `auth.json` — only `auth.json` — into `$HOME/.codex/auth.json` inside the container. `config.toml` is deliberately not copied: burns already pass the model with `-m` and the run-scoped MCP server with `-c` overrides, and an operator's interactive settings (sandbox mode, approval policy, trusted projects) must not leak into a print-mode burn. `noSandbox` burns run as the operator on the host and inherit the real home; they get neither mount nor copy. The mount reuses the existing cache-mount list the burner already hands to sandcastle; the copy reuses the existing setup-command chaining, so nothing new crosses the sandbox boundary. The mount is read-only so a container that refreshes its token can never corrupt the host file; concurrent per-burn copies are an accepted, uncoordinated risk (decision 5) — the interactive launcher has copied `auth.json` per session since codex-runtime-support shipped.

**`CODEX_API_KEY` leaves the UI, stays as a silent override.** The Codex AFK credential *is* the login. The Enable-AFK card no longer offers a paste row for Codex, the doctor no longer runs an `afk-key` probe for Codex, and no hint anywhere names the key. If `~/.runcastle/.env` already carries `CODEX_API_KEY`, the burner still passes it into the container env exactly as today, where Codex's own precedence lets it win over the copied file — an upgrade-safe, zero-UI escape hatch for deliberate API billing, documented in one line and offered nowhere. The Claude runtime's AFK path (`claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN`) is unchanged byte for byte.

**One readiness predicate.** "Codex ready" means `auth.json` exists at the Codex home, and one shared predicate answers that question for every consumer:

- *Doctor*: Codex reports two checks, `binary` and `auth`; the `afk-key` check exists only for Claude. `codex login status` still feeds the `auth` check's detail text, but file presence decides ok/fail so the doctor can never disagree with a burn. Conditional severity by configured runtime is unchanged.
- *First-run wizard*: for Codex, `talkReady` is installed-and-authed; the "an AFK key alone counts" branch goes with the key. Claude keeps its existing rule.
- *Launcher*: `checkReady` already tests the file; unchanged.
- *Burner and research workflow*: the fail-early precheck consults the predicate for Codex instead of "has a token", and it is cheap enough to run per ticket, so a Codex ticket assigned inside a Claude run is checked too (closing the documented cross-runtime gap). The `auth.missing` event's hint for Codex says to run `codex login`.
- *Enable-AFK card*: one row per runtime. Claude's row is the setup-token row it is today. Codex's row is driven by the `auth` check: "signed in" when present, otherwise a single **Sign in** button that opens the existing `codex-login` terminal. No new component, no billing explanation.

**Error wording.** The Codex burn error classifier keeps its fatal `CODEX_API_KEY` pattern and adds login-flavoured fatal patterns (unauthorized / not logged in), so a burn that fails because the borrowed login was revoked mid-run surfaces "run `codex login`" rather than an API-key hint.

**Record hygiene.** The Claude-only AFK-auth prose in the project's context, README and build spec gets a short refresh stating that Codex burns borrow the ChatGPT login and Claude burns use the setup token.

## Seams

- **Burn agent construction** (existing) — the single chokepoint that turns a resolved model into a sandcastle agent, its env, its mounts and its sandbox-ready command. Observe: for a Codex model in a container mode, the mount list contains the read-only host Codex home and the setup command copies `auth.json` after the guard install; for `noSandbox`, neither; for Claude, unchanged; with `CODEX_API_KEY` in the env file, the env still carries it.
- **Codex readiness predicate** (new, tiny) — a pure function over an env/filesystem view answering "is `auth.json` present at the Codex home". Observe: honoured `CODEX_HOME`, `HOME`/`USERPROFILE` fallback. Every consumer below is tested through it.
- **Doctor report** (existing) — per-runtime check rows. Observe: Codex yields `binary` + `auth` only; Claude still yields three; `auth` ok/fail tracks file presence regardless of `codex login status`; severity still conditional on configured runtimes.
- **Burn precheck** (existing, via the burner's run entry) — Observe: `auth.missing` emitted with a `codex login` hint when the file is absent for a Codex run model *or* a Codex per-ticket model; the research workflow behaves the same.
- **First-run readiness** (existing web pure function) — Observe: Codex `talkReady` = installed ∧ authed; a Codex card with only a key is not ready; Claude unchanged.
- **Enable-AFK card rendering** (existing component) — Observe: Codex row shows "signed in" or a Sign-in button wired to the `codex-login` terminal kind; no paste input for Codex.
- **Burn error classification** (existing) — Observe: unauthorized/not-logged-in Codex wording classifies fatal with a login hint.

## Out of scope

- Any OAuth performed by runcastle itself — it borrows an existing login, never creates one.
- Copying `config.toml` or anything but `auth.json` into a burn container.
- Coordinating or writing back token refreshes across concurrent burns.
- The root dogfood `.sandcastle/Dockerfile` (a Claude-only image); the shipped sandcastle asset image already installs Codex.
- Any change to the Claude runtime's auth, readiness, or card.
- Removing the ability to set `CODEX_API_KEY` in `~/.runcastle/.env` by hand.

## Open questions

- Whether OpenAI rotates refresh tokens on refresh is undocumented in the Codex source; if a host login is observed to lapse after burns, decision 5 is the place to revisit (and the fix would be a per-run copy coordinated by runcastle, not a user-facing step).

# Decisions — Codex burns on the ChatGPT subscription

## 1. Burns borrow `~/.codex/auth.json` via a read-only mount + copy
**Decision:** A container Codex burn bind-mounts the host's `~/.codex` read-only (at a fixed path such as `/mnt/host-codex`) and, in the same `onSandboxReady` setup command that installs the burn guard, copies only `auth.json` into `$HOME/.codex/auth.json` inside the sandbox. `config.toml` is not copied — burns already get model (`-m`) and MCP (`-c`) explicitly, and the user's interactive settings must not leak into a print-mode burn.
**Why:** The token never travels through a shell string that can land in logs; every burn picks up the host's current login without a restart; read-only means a container refreshing its token can never corrupt the host file. Mirrors what the interactive launcher already does (copy `auth.json` into a synthetic `CODEX_HOME`), and is the community-proven sandcastle recipe.

## 2. Guiding principle: zero perceived setup
**Decision:** The user's only Codex setup step is `codex login`. No API key to paste, no extra toggles, no second credential to mint. Anything that adds a visible step to "Codex ready" is out.
**Why:** Operator instruction — the setup should be as simple as possible; the feature exists to remove a credential, not to add options around it.

## 3. `CODEX_API_KEY` leaves the UI, survives silently as an override
**Decision:** Remove `CODEX_API_KEY` from every user-facing surface: no paste row on the Enable-AFK card, no doctor `afk-key` probe for Codex, no setup hint naming it. The Codex AFK credential is the ChatGPT login. If an operator already has `CODEX_API_KEY` in `~/.runcastle/.env`, the burner still passes it into the container env, where Codex's own precedence lets it win over the copied `auth.json` — documented in one line, offered nowhere.
**Why:** A visible "API key or login" choice is exactly the setup complexity this feature removes. Honouring an existing key silently keeps upgrades from breaking and leaves a zero-UI escape hatch for deliberate API billing.

## 4. "Codex ready" = `auth.json` present at the Codex home, everywhere
**Decision:** One predicate decides Codex readiness on every surface: `auth.json` exists at `$CODEX_HOME` (else `~/.codex`). Doctor: Codex has `binary` + `auth` checks only, the `afk-key` check is gone for Codex (Claude keeps all three); `codex login status` still feeds the detail text but file presence decides ok/fail. First-run wizard `talkReady` for Codex = installed && authed. Launcher `checkReady` unchanged. Burner fail-early precheck uses the same predicate, runs per ticket (closing the cross-runtime per-ticket gap), and the `auth.missing` hint says `codex login`. `noSandbox` burns inherit the real home and need nothing.
**Why:** The file is the artifact every surface borrows, so testing for it is the only definition that can never disagree with what a burn actually does; it is cheap enough to check per ticket without a subprocess.

## 5. Concurrent borrowed copies are an accepted, documented risk
**Decision:** Every burn container holds its own copy of `auth.json` and may refresh it independently; runcastle does not coordinate or write anything back. The read-only mount guarantees the host file is never corrupted. If the host login lapses, the readiness predicate (decision 4) reports it and the fix is `codex login`.
**Why:** The interactive launcher has copied `auth.json` per session since codex-runtime-support shipped and the sandcastle community recipe does the same per container, so concurrent copies are proven in practice; Codex source does not document refresh-token rotation, and building coordination around an unconfirmed risk would add machinery the user would feel.

## 6. Enable-AFK card: Codex row is a sign-in row, not a key row
**Decision:** The Enable-AFK card keeps one row per runtime. Claude's row is unchanged (setup-token). Codex's row is driven by the `auth` probe: "signed in" when `auth.json` is present, otherwise a single "Sign in" button that opens the existing `codex-login` terminal. No billing explanation, no new component.
**Why:** Same row shape for both agents — each line is green or has one button — keeps the card legible and matches "the only setup step is `codex login`".

## 7. Scope: one lap, Claude side untouched, stale docs refreshed in passing
**Decision:** Sure-and-small — one lap, no map, no `## Later laps`. The Claude runtime's auth path (setup-token → `CLAUDE_CODE_OAUTH_TOKEN`) is byte-for-byte unchanged. Routine inclusions: the Codex burn error classifier gains login-flavoured hints beside the `CODEX_API_KEY` pattern; the research workflow's mirror precheck follows decision 4; the Claude-only AFK-auth prose in `CONTEXT.md`, `README.md`, `docs/SPEC.md` gets a short refresh. Out of scope: the root dogfood `.sandcastle/Dockerfile` (Claude-only image), any OAuth performed by runcastle itself, `config.toml` inheritance for burns.
**Why:** The feature removes a credential; everything else is keeping the record honest about what "Codex ready" now means.

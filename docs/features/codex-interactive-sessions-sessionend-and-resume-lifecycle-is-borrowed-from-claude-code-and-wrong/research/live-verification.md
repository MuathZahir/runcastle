# Live verification — codex-cli 0.153.4 interactive TUI hook lifecycle

Recorded 2026-09-16 on the operator's host (Windows 11), driving the real
`codex` TUI (0.153.4, npm install) inside a real PTY via node-pty, with a
synthetic `CODEX_HOME` mirroring runcastle's `renderCodexConfig` /
`renderCodexHooks` shape and a hook sink logging each event with a timestamp.
Harness: `../prototypes/drive.ts` (PTY driver), `../prototypes/hooklog.ts`
(hook sink), `../prototypes/decode.py` (log decoder). Raw logs stayed in the
throwaway spike dir (`~/.runcastle/spike-codex`), not committed.

Note: 0.153.4 is newer than the 0.150.1 the shipped hooks feature verified
against; every 0.150.1 finding rechecked here still holds.

## The verified event timeline (fresh session, two turns, Ctrl-C quit)

| t (rel) | what happened |
|---------|----------------|
| 0s | PTY spawned: `codex --dangerously-bypass-hook-trust` |
| 0–20s | TUI fully booted, idle at composer — **no hook fired** |
| 20.0s | driver typed prompt 1 + Enter |
| 21.7s | **SessionStart** (`source: "startup"`) |
| 22.0s | **UserPromptSubmit** (turn 1, carries `turn_id`) |
| 27.9s | **Stop** (turn 1, `last_assistant_message: "pong"`) |
| 51.1s | **UserPromptSubmit** (turn 2, same `session_id`, new `turn_id`) — **no second SessionStart** |
| 62.5s | **Stop** (turn 2) |
| 80.9s | driver sent Ctrl-C at composer |
| 81.1s | **SessionEnd** (`reason: "other"`) |
| 82.7s | process exit, code 0 (after a second Ctrl-C) |

## What this settles

1. **SessionEnd is NOT per-turn.** It fired exactly once, at real quit, ~1.6s
   before process exit. The "Codex ends the row every turn" hypothesis from the
   brief is false on 0.153.4. `Stop` is the per-turn end signal (mapped to
   `awaiting-input` — correct as-is).
2. **SessionStart fires with the first submitted turn**, not at boot (20s idle
   with hook discovery on and valid hooks.json produced nothing; 90s idle in a
   separate run likewise). Confirms ticket 3's 0.150.1 finding on 0.153.4.
3. **The hook payload `session_id` is the rollout/thread UUID** (e.g.
   `01a0a850-bd9c-73e1-a5da-f5c5dab6c6bf`), matching the transcript filename
   `rollout-<ts>-<uuid>.jsonl` under `$CODEX_HOME/sessions/…`, which is the id
   space `codex resume [SESSION_ID]` documents ("Session id (UUID)"). Payloads
   also carry `transcript_path`, `turn_id` (per turn), `model`,
   `permission_mode`, and on Stop `last_assistant_message`.
4. **`codex resume --help` (0.153.4)**: positional `[SESSION_ID] [PROMPT]`;
   `--last`; `--dangerously-bypass-hook-trust` IS accepted by the resume
   subcommand. Default (no id) is a cwd-filtered picker.

## Incidental findings that matter to runcastle

- **Malformed `hooks.json` is a silent no-hooks session**: codex prints a
  one-line TUI warning ("failed to parse hooks config …") and continues with
  NO hooks at all — no SessionStart ever, row stuck `launching`.
- **The update-available modal is real and blocking**: on a synthetic
  `CODEX_HOME`, when a newer version exists (here 0.153.4 → 0.154.0), the TUI
  boots into a "✨ Update available!" dialog that blocks the composer until
  answered; default highlighted option is "1. Update now". Copying the human's
  `version.json` into the home does NOT suppress it.
  **`check_for_update_on_startup = false` (top-level config.toml key) fully
  suppresses it** — verified live, config parses (deny_unknown_fields would
  have failed loudly) and no modal appears.
- **Quitting the TUI leaves codex-owned background processes alive**
  (app-server daemon and friends: extra `codex.exe`, `codex-computer-use-swift`
  seen after clean exit). PTY exit is still the process-level end signal;
  the orphans are codex's own daemon design, not a leak runcastle caused.
- A `CODEX_HOME` under a very long path (~240 chars) fails at boot with
  "local database appears to be damaged … unable to open database file
  (code: 14)", exit 1. runcastle's real session homes are short; noted as an
  environment hazard only. Codex also refuses to create PATH-alias helper
  binaries when `CODEX_HOME` is under the OS temp dir (warning only).
- `[projects."…"] trust_level` matching is by exact path spelling; the config
  must spell the worktree the way codex sees it (Windows backslashes). A
  mismatched spelling boots into the "Do you trust this directory?" dialog
  BEFORE any hook fires. (runcastle uses `node:path` + JSON-escaped TOML basic
  strings, which is the correct spelling — verified against the same failure
  mode in the spike.)

## Resume behaviour (run 8)

`codex resume 01a0a850-bd9c-73e1-a5da-f5c5dab6c6bf --dangerously-bypass-hook-trust`
(the exact argv shape `buildCodexArgs` produces) against the same synthetic
home:

- **It works.** The conversation reopened: the SessionStart payload carried the
  SAME `session_id` and the same transcript path as the original session.
- **SessionStart fires with `source: "resume"`** — and again only when the
  first prompt of the resumed session is submitted, not at boot (20s idle,
  nothing).
- SessionEnd again fired exactly once, at Ctrl-C quit, `reason: "other"`.
- No `Stop` fired in this run: prompt 2 was typed while turn 1 was still
  streaming, and the driver's Enter submitted a partial prompt. Stop is
  per-completed-turn, not guaranteed per prompt submission.

So both halves of runcastle's resume path are shape-correct on 0.153.4: the
stored `ccSessionId` IS the id `codex resume` wants, and the trust-bypass flag
is accepted by the subcommand. The dominant real-world failure is upstream of
the argv: a Codex row that ends before its first submitted turn has no
`ccSessionId` at all (SessionStart never fired), `mostRecentResumableSession`
finds nothing, and Resume silently spawns a cold session.

## The wild-side evidence (live runcastle.db, read 2026-09-16)

- 226 session rows, exactly ONE with `runtime='codex'` — the operator's
  reported codex pain predates this DB; no in-the-wild codex SessionEnd trail
  survives to archaeologize. The one codex row (revisit, 09-15) went live 18s
  after launch and never received a hook SessionEnd; it was closed by the
  server-restart reconciler.
- Claude sessions routinely show `session.ended` immediately followed (<1s) by
  `session.started … (conversation resumed)` on the SAME row — in-TUI
  conversation rollover (`/clear`-shaped). The hooks route already tolerates
  ended → live re-flips; any Codex-side end/alive redesign keeps that property.


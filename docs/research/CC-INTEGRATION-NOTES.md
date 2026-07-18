# Claude Code Integration Notes (v2.1.x)

> **Source & attribution.** Portions of this file are reproduced verbatim from
> the official Claude Code documentation at <https://code.claude.com/docs>
> (© Anthropic), retrieved 2026-07-14. Kept as a dated snapshot so agents can
> work offline; the live docs are authoritative.

Researched against the official docs at `https://code.claude.com/docs/en/*.md`. Every JSON block below is copied verbatim from the fetched markdown source (not paraphrased) unless marked UNVERIFIED. Doc version context: pages reference behavior up to v2.1.208+ (some fields note `min-version` gates, called out inline).

---

## 1. Plugin directory format for `--plugin-dir <path>`

**Source**: `/en/plugins.md`, `/en/plugins-reference.md`

The path passed to `--plugin-dir` is the plugin's own root directory (the one that directly contains `.claude-plugin/`), never a parent folder holding multiple plugins. Repeat the flag for multiple plugins. As of v2.1.128 it also accepts a path to a `.zip` archive of that directory.

Manifest at `.claude-plugin/plugin.json` is **optional** — if omitted, Claude Code auto-discovers components in default locations and derives the plugin name from the directory name. If present, `name` is the only required field.

```json
{
  "name": "my-first-plugin",
  "description": "A greeting plugin to learn the basics",
  "version": "1.0.0",
  "author": {
    "name": "Your Name"
  }
}
```

Required file layout (only `.claude-plugin/plugin.json` goes inside `.claude-plugin/`; everything else is a sibling at plugin root — putting `skills/`/`commands/`/`hooks/` inside `.claude-plugin/` is called out as the most common mistake):

```text
my-plugin/
├── .claude-plugin/
│   └── plugin.json
├── skills/
│   ├── code-reviewer/
│   │   └── SKILL.md
│   └── pdf-processor/
│       ├── SKILL.md
│       └── scripts/
├── commands/          # flat .md skills, legacy — use skills/ for new plugins
├── agents/
├── hooks/
│   └── hooks.json
├── .mcp.json
└── settings.json       # only "agent" and "subagentStatusLine" keys supported
```

**Minimal valid plugin with 2 skills** — verified structure (`skills/<name>/SKILL.md`, folder name = skill name):

```text
my-first-plugin/
├── .claude-plugin/
│   └── plugin.json
└── skills/
    ├── hello/
    │   └── SKILL.md
    └── goodbye/
        └── SKILL.md
```

`skills/hello/SKILL.md`:
```markdown
---
description: Greet the user with a friendly message
disable-model-invocation: true
---

Greet the user warmly and ask how you can help them today.
```

**Namespacing / invocation**: plugin skills are *always* namespaced as `/plugin-name:skill-name` (the `name` field in `plugin.json` sets the namespace prefix). Test with:

```bash
claude --plugin-dir ./my-first-plugin
# then inside the session:
/my-first-plugin:hello
```

A plugin that ships exactly **one** skill may skip the `skills/` directory and place `SKILL.md` directly at plugin root; the frontmatter `name` field controls its invocation name (falls back to the install-dir basename, which is a version string for marketplace installs — so set `name` explicitly).

**`disable-model-invocation: true` for plugin skills — CONFIRMED WORKING.** It's the literal value used in the official quickstart's `SKILL.md` example above (copied verbatim). Disables Claude auto-invoking the skill by description-matching while leaving it invocable via explicit `/plugin-name:skill-name`.

Manifest component-path fields (all optional, add to or replace the default folder — see table): `skills` (string|array, **adds to** default `skills/` scan), `commands`/`agents`/`outputStyles`/`experimental.themes`/`experimental.monitors` (string|array, **replaces** the default folder), `hooks`/`mcpServers`/`lspServers` (string|array|object, path(s) or inline config), `userConfig`, `channels`, `dependencies`.

---

## 2. `--settings '<inline JSON>'` for hooks at launch

**Source**: `/en/cli-reference.md` (flag table row), `/en/hooks.md`

`--settings` flag description, verbatim: *"Path to a settings JSON file or an inline JSON string. Values you set here override the same keys in your `settings.json` files for this session. Keys you omit keep their file-based values."* Confirmed elsewhere (`/en/headless.md`): `--settings <file-or-json>`. **Inline JSON is confirmed to work**, not just a file path.

The `hooks` key inside that JSON uses the exact same schema as `settings.json` on disk (there is no different shape for inline vs. file). Full shape, event → matcher-group array → handler array:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "/absolute/path/to/session-start.sh",
            "timeout": 600
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/absolute/path/to/prompt-submit.sh",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

Notes verified from the doc:
- `UserPromptSubmit` (and `PostToolBatch`, `Stop`, `TeammateIdle`, `TaskCreated`, `TaskCompleted`, `WorktreeCreate`, `WorktreeRemove`, `MessageDisplay`) **do not support `matcher`** — a `matcher` field on these is silently ignored, so omit it (shown above).
- `SessionStart` matcher values: `startup` | `resume` | `clear` | `compact`.
- Command-hook handler fields: `type` (required, `"command"`), `command` (required), `args` (optional, exec-form array), `timeout` (optional, seconds), `statusMessage`, `async`, `asyncRewake`, `shell` (`"bash"`|`"powershell"`).
- **Default `timeout`**: 600s for `command`/`http`/`mcp_tool` handlers generally, but `UserPromptSubmit` lowers that default specifically to **30s** for those same types (because it blocks model processing until it completes).
- To pass hooks via `--settings` inline JSON at launch, wrap the whole `{"hooks": {...}}` object as the flag argument, e.g. `claude --settings '{"hooks":{"SessionStart":[...]}}'`. This is a direct extrapolation from the confirmed inline-JSON + confirmed hooks schema; no single doc example shows both combined verbatim, so treat the exact CLI quoting as **UNVERIFIED** (shell-quoting mechanics aren't documented) though the JSON payload shape itself is fully verified.

---

## 3. Hook I/O exactly — SessionStart and UserPromptSubmit

**Source**: `/en/hooks.md` (`#sessionstart`, `#userpromptsubmit`, `#hook-input-and-output`)

### SessionStart — stdin (verbatim example from docs)

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "hook_event_name": "SessionStart",
  "source": "startup",
  "model": "claude-sonnet-5"
}
```
Common fields on every event: `session_id`, `prompt_id` (absent until first user input), `transcript_path`, `cwd`, `permission_mode` (not on every event), `effort`, `hook_event_name`. SessionStart-specific: `source` (`startup`|`resume`|`clear`|`compact`), optional `model`, `agent_type`, `session_title`.

### SessionStart — stdout (verbatim example)

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Current branch: feat/auth-refactor\nUncommitted changes: src/auth.ts, src/login.tsx\nActive issue: #4211 Migrate to OAuth2",
    "sessionTitle": "auth-refactor"
  }
}
```
**`additionalContext` is nested inside `hookSpecificOutput`, not top-level.** Other SessionStart-only return fields (all inside `hookSpecificOutput`): `initialUserMessage` (non-interactive `-p` mode only — becomes the session's first turn), `sessionTitle`, `watchPaths`, `reloadSkills`. Plain (non-JSON) stdout is *also* added directly as context for this event — JSON is only needed when combining context with another field.

### UserPromptSubmit — stdin (verbatim example)

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "UserPromptSubmit",
  "prompt": "Write a function to calculate the factorial of a number"
}
```

### UserPromptSubmit — stdout (verbatim example)

```json
{
  "decision": "block",
  "reason": "Explanation for decision",
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "My additional context here",
    "sessionTitle": "My session title"
  }
}
```
**`additionalContext` is nested inside `hookSpecificOutput` here too** — the field table lists it alongside `decision`/`reason` but the doc's own worked example places it under `hookSpecificOutput`, consistent with SessionStart. `decision: "block"` (top-level, sibling of `hookSpecificOutput`) erases the prompt entirely; `reason` is shown to the user but not added to context; `suppressOriginalPrompt` (bool) omits the original prompt text from the block message. Plain stdout (non-JSON) is also accepted as context for this event.

### Exit-code semantics (verified table)

- **Exit 0**: success, stdout JSON is parsed. JSON is *only* processed on exit 0. For most events stdout goes to debug log only — but `UserPromptSubmit`, `UserPromptExpansion`, and `SessionStart` are exceptions where stdout is shown to Claude as context even without JSON wrapping.
- **Exit 2**: blocking error. stdout/JSON is ignored; stderr text is fed to Claude as an error message (for `UserPromptSubmit`: rejects/erases the prompt). For `SessionStart` specifically, exit 2 does **not** block — table says "Can block? No — Shows stderr to user only" (Claude never sees it, session proceeds; as of v2.1.199 it renders as a `<hook name> hook error` notice in the transcript, earlier versions logged it silently).
- **Any other non-zero exit** (1, 3, ...): non-blocking for almost every event — transcript shows a `<hook name> hook error` notice + first line of stderr, execution continues. Exception: `WorktreeCreate`, where *any* non-zero exit aborts worktree creation.

### Env vars reaching the hook command

Verbatim: *"Handlers run in the current directory with Claude Code's environment."* The hook process **inherits the full parent environment** of the launching process — no special prefix is required for your own vars to pass through. Claude Code additionally exports `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA` to spawned hook/script processes (also readable via path placeholders in `command` strings, e.g. `${CLAUDE_PROJECT_DIR}/.claude/hooks/setup.sh`). `CLAUDE_ENV_FILE` is available specifically to `SessionStart`, `Setup`, `CwdChanged`, `FileChanged` hooks — write `export VAR=val` lines to that file path to persist env vars into subsequent Bash tool calls for the rest of the session. There is no `$CLAUDE_MODEL` var; only `SessionStart` gets a `model` field in its JSON input (not guaranteed present).

---

## 4. `--mcp-config '<inline JSON or path>'`

**Source**: `/en/mcp.md`, `/en/cli-reference.md`, `/en/headless.md`

Flag description (verbatim, cli-reference.md): *"Load MCP servers from JSON files or strings (space-separated)"*. Confirmed again in headless.md table: `MCP servers | --mcp-config <file-or-json>` — **both a file path and an inline JSON string are accepted**, and the flag can take multiple space-separated values.

Verified HTTP-server JSON entry (this exact block appears in `.mcp.json` / `~/.claude.json` examples in the docs — local-scope example after running `claude mcp add --transport http stripe https://mcp.stripe.com`):

```json
{
  "projects": {
    "/path/to/your/project": {
      "mcpServers": {
        "stripe": {
          "type": "http",
          "url": "https://mcp.stripe.com"
        }
      }
    }
  }
}
```

Plain `.mcp.json` project-root form (also verified, from the tool-search/`alwaysLoad` example):
```json
{
  "mcpServers": {
    "core-tools": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "alwaysLoad": true
    }
  }
}
```

Field names confirmed: `type` (required when `url` is present — an entry with `url` but no `type` is a **configuration error**; Claude Code reports `MCP server "<name>" has a "url" but no "type"; add "type": "http" (or "sse" / "ws") to this entry` and skips the server), `url`, optional `headers` (object), `headersHelper`, `timeout`, `alwaysLoad`. `type` accepts `"streamable-http"` as an alias for `"http"` (the MCP spec's own name for this transport — configs copied from third-party server docs work unmodified).

**SSE transport** is supported but **deprecated** (doc explicitly recommends HTTP instead where available): `claude mcp add --transport sse <name> <url>`. No raw inline-JSON SSE example is shown, but by the same schema as `http`/`ws` it would be `{"type": "sse", "url": "...", "headers": {...}}` — **UNVERIFIED as an exact quoted example**, inferred from the consistent schema shown for `http` and `ws`.

**WebSocket** (verified, `claude mcp add-json` example):
```bash
claude mcp add-json events-server \
  '{"type":"ws","url":"wss://mcp.example.com/socket","headers":{"Authorization":"Bearer YOUR_TOKEN"}}'
```
Doc states `type: "ws"` accepts the same `url`, `headers`, `headersHelper`, `timeout`, `alwaysLoad` fields as `http`.

**`--strict-mcp-config`** — verbatim: *"Only use MCP servers from `--mcp-config`, ignoring all other MCP configurations."* Example: `claude --strict-mcp-config --mcp-config ./mcp.json`. Also documented as a way to load **zero** MCP servers entirely: `claude --strict-mcp-config` with no `--mcp-config` value disables all MCP tool loading (used as an alternative to `--disallowedTools "mcp__*"`).

**UNVERIFIED**: whether an inline `--mcp-config '<json>'` string must be wrapped in `{"mcpServers": {...}}` or can be a bare single-server object. No exact inline-CLI example was found; the `{"mcpServers": {...}}` wrapper is used consistently everywhere else for this JSON shape, so that's the safe assumption, but it's not shown verbatim as a `--mcp-config` argument.

---

## 5. Session identity

**Source**: `/en/cli-reference.md`

**`--session-id`** — verbatim flag description: *"Use a specific session ID for the conversation (must be a valid UUID)"*. Example: `claude --session-id "550e8400-e29b-41d4-a716-446655440000"`. It is documented as a standalone flag, listed separately from `--resume`, with no stated dependency on `--resume` being present — **this confirms it can START a new session with a chosen ID** (not resume-only). Doc phrasing doesn't use the word "new" explicitly, so treat the *start vs. resume-only* framing as verified by omission/context rather than an explicit sentence — flag it as **largely but not 100% explicitly verified**.

**SessionStart stdin includes `session_id` and `transcript_path`** — CONFIRMED, both appear in the verbatim SessionStart example under §3 above, and both are also listed in the "Common input fields" table that applies to every hook event.

**`--resume`, `-r`** — verbatim: *"Resume a specific session by ID or name, or show an interactive picker to choose a session. The picker and name search include sessions that added this directory with `/add-dir`; passing a session ID searches only the current project directory and its git worktrees."* So: **cwd matters** — resuming by session ID is scoped to (a) the project matching the current working directory, and (b) that project's git worktrees; it will not find a session ID that belongs to a different, unrelated project directory. Name-based search/picker additionally includes directories added via `/add-dir` during that other session. As of v2.1.144, background sessions appear in the picker marked `bg`.

**Transcript JSONL path mapping from cwd**: confirmed general pattern from `/en/claude-directory.md`: transcripts live at `~/.claude/projects/<project>/<session>.jsonl`. **UNVERIFIED**: the exact sanitization algorithm turning a cwd path into `<project>` (e.g. whether `:`/`\`/`/`/`_` all become `-`) is not spelled out in any fetched doc page. Don't rely on a guessed encoding — read `transcript_path` back from a hook instead of deriving it from cwd yourself.

---

## 6. Terminal launch: positional initial prompt

**Source**: `/en/cli-reference.md`

Verbatim CLI-commands table row:
| Command | Description | Example |
|---|---|---|
| `claude "query"` | Start interactive session with initial prompt | `claude "explain this project"` |

This is explicitly contrasted with `claude -p "query"` → *"Query via SDK, then exit"* (non-interactive print mode). The doc does **not** contain an explicit sentence stating whether the positional prompt auto-submits immediately vs. merely pre-fills the input box for the user to press Enter. **UNVERIFIED**: exact submit-vs-prefill behavior is not spelled out anywhere in `/en/cli-reference.md`, `/en/interactive-mode.md`, or `/en/headless.md`. The wording "Start interactive session **with** initial prompt" (not "with initial prompt pre-filled") mildly favors auto-submit, but this is an inference, not a verified fact — test empirically before relying on it for the injected-config launcher.

---

## 7. `--append-system-prompt-file`

**Source**: `/en/cli-reference.md` (§ "System prompt flags")

**Confirmed to exist** as a distinct flag from `--append-system-prompt` in the current CLI reference. Verbatim table:

| Flag | Behavior | Example |
|---|---|---|
| `--system-prompt` | Replaces the entire default prompt | `claude --system-prompt "You are a Python expert"` |
| `--system-prompt-file` | Replaces with file contents | `claude --system-prompt-file ./prompts/review.txt` |
| `--append-system-prompt` | Appends to the default prompt | `claude --append-system-prompt "Always use TypeScript"` |
| `--append-system-prompt-file` | Appends file contents to the default prompt | `claude --append-system-prompt-file ./style-rules.txt` |

`--system-prompt` and `--system-prompt-file` are mutually exclusive; either append flag can be combined with either replacement flag. All four work in both interactive and non-interactive (`-p`) modes. There's also a related but distinct flag, `--append-subagent-system-prompt` (min-version 2.1.205, `-p` mode only), which appends to every **subagent's** system prompt rather than the main thread's.

---

## Corrections vs. the assumptions in the brief

1. **UserPromptSubmit `additionalContext` location** — you asked whether it's top-level or nested in `hookSpecificOutput`. It's **nested in `hookSpecificOutput`** for both SessionStart and UserPromptSubmit (the docs' own field table lists `additionalContext` as if it were a flat option alongside `decision`/`reason`, but the worked JSON example for UserPromptSubmit places it under `hookSpecificOutput`, matching SessionStart). Only `decision`, `reason`, and `suppressOriginalPrompt` are truly top-level for UserPromptSubmit.
2. **UserPromptSubmit hook timeout default is 30s, not 600s** — lower than the general 600s default for `command`/`http`/`mcp_tool` handlers on other events, specifically because this hook blocks model processing.
3. **SessionStart exit code 2 does NOT block the session** — despite exit 2 being "blocking" for most events, SessionStart's table entry is "Can block? No — Shows stderr to user only." Don't rely on exit 2 to halt session startup from a SessionStart hook.
4. **`--append-system-prompt-file` exists** — confirmed as a real, current flag (not a guess), separate from `--append-system-prompt`.
5. **MCP HTTP config field is exactly `{"type": "http", "url": "..."}`** — matches your assumption, confirmed verbatim in multiple doc examples (also accepts `"streamable-http"` as an alias for `"http"`).
6. **`--session-id` starting a new session** — plausible and consistent with the docs (it's documented independently of `--resume`), but the docs never use the word "start" explicitly in that flag's description — treat as high-confidence but not a verbatim confirmation.
7. **Positional `claude "prompt"` auto-submit behavior** — genuinely UNVERIFIED in the docs; don't assume it auto-submits without testing it directly against v2.1.208.
8. **Transcript-path project-directory naming/sanitization algorithm** — not documented anywhere; don't hardcode a cwd→directory-name encoding scheme, derive the path from a hook's `transcript_path` field instead.

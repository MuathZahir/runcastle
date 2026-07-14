# Runcastle UI Spec v2 — "IDE, not dashboard"

Binding spec for the apps/web rework + embedded terminal. Supersedes SPEC.md §10. Written after walking the user stories; agents implement EXACTLY this and flag friction rather than redesigning.

## 1. User stories (the UI must serve these, in priority order)

- **S1 Glance**: I open runcastle and see every feature session and its state — above all *which ones need me* (start grilling / review tickets / run blocked / ready to test). Parallel features are the norm.
- **S2 Start**: New feature → I'm typing to the grilling agent within seconds, in an **embedded terminal tab**. No external windows.
- **S3 Grill**: While being grilled, I see knowledge accumulate (decisions/docs) and the phase advance *beside* the conversation, not on another page.
- **S4 Approve**: Tickets emitted → I read them properly (full context, blockers), then Burn. This is human click #1.
- **S5 Watch**: During a burn I see per-ticket progress lanes + a live event stream, while possibly grilling another feature in a different tab.
- **S6 Ship**: Run done → test drive (one click, guarded) → merge. Human click #2.
- **S7 Return**: Days later I open a shipped feature and ask questions in a Q&A terminal tab.
- **S8 Parallel**: Everything above for N features at once — switching features must feel like switching editor tabs, state never lost.

## 2. Layout — three columns + status bar (VS Code grammar)

```
┌────────────────────────────────────────────────────────────────────┐
│ runcastle ▸ runcastle-demo · main            [2 runs ⚙] [health ●] │ 36px title bar
├───────────┬────────────────────────────────────────┬───────────────┤
│ FEATURES  │ tab strip (32px): ov│term│tickets│run  │ INSPECTOR     │
│ 240px     │ ┌────────────────────────────────────┐ │ 280px, collap.│
│           │ │                                    │ │ ┌───────────┐ │
│ ◉ entry-  │ │        active tab content          │ │ │ PIPELINE  │ │
│   tags  ● │ │  (terminal / tickets / run / ovw)  │ │ │ (vertical)│ │
│ ⚙ search  │ │                                    │ │ ├───────────┤ │
│ ✓ export  │ │                                    │ │ │ KNOWLEDGE │ │
│           │ │                                    │ │ ├───────────┤ │
│ + New     │ └────────────────────────────────────┘ │ │ ACTIVITY  │ │
├───────────┴────────────────────────────────────────┴───────────────┤
│ feature/entry-tags · sandbox: docker · test drive: off · 4512 ok   │ 24px status bar
└────────────────────────────────────────────────────────────────────┘
```

- **Sidebar (Features)**: one row per feature: status glyph + slug + right-aligned *needs-me* amber dot or animated spinner (burning). Sorted: needs-me first, then active, then shipped (dimmed). Bottom: `+ New feature` ghost row → inline form (title, one-liner, size toggle), not a modal.
- **Tab strip**: tabs are typed, per feature: `overview` (icon ▤), `terminal:<sessionId>` (icon ▸_), `tickets` (icon ☰), `run:<runId>` (icon ⚙). Label: `<slug> · <type>`. Click feature in sidebar → opens/focuses its `overview` tab. Tabs close with ✕ (terminal tab close = detach only, PTY stays alive; re-open reattaches with scrollback replay). Tab state (open tabs, active tab) in localStorage.
- **Inspector (right rail)**: bound to the active tab's feature; collapsible (chevron in title bar). Three stacked sections:
  - **Pipeline**: vertical mini-stepper (6 phases; collapsed size renders spec as skipped). Current phase highlighted; next gate line below with state (`G1 · blocked — run ideation first` / `satisfied`), then two ghost buttons `Advance` `Override…` (override = inline reason input, not modal).
  - **Knowledge**: doc list (brief, decisions, spec, …) → click opens read-only peek overlay (Esc closes). Live-updates during grilling (S3).
  - **Activity**: last ~15 events, compact mono lines, relative time. Full log lives in run tabs.
- **Status bar**: active feature branch (click = copy) · sandbox mode · test-drive state (`off` / `driving feature/x — Stop`) · server health dot · active run count.

## 3. Tab content specs

- **Overview tab** — NOT a dashboard. A single centered column (max 560px): phase word + one-line state summary; then THE primary action as the only solid button (state machine: `Start grilling` → `Open live grill` (session live) → `Review tickets` → `Burn N tickets` handled in tickets tab → `Watch run` → `Test drive` → `Merge` → `Ask questions`), secondary ghost actions under it (Open Q&A, Open docs dir). Below: last 8 timeline events. That's all.
- **Terminal tab** — xterm.js filling the tab (fit addon, resize observer). Top strip (28px): session kind badge, cc session id (mono, dim), status dot (launching/live/ended), right side: `Pop out ↗` (relaunches in Windows Terminal — the old path) and `End session`. Terminal background matches app bg exactly (#0A0C0F) so it reads as native, not an iframe.
- **Tickets tab** — burn bar on top: left `N tickets · M blocked`, right: sandbox+model chips + solid **Burn** button (disabled with reason tooltip when gate unsatisfied). Below: ticket ledger — each row: seq (mono), title, status chip, blockedBy chips (`⇠ 1,2`), commit count; click row → expands in place to full goal/context/acceptance criteria/seams (rendered md-ish, mono headings). During burn rows get live status. Failed row expands to error + (if conflict) recovery note.
- **Run tab** — two panes split 40/60: left = ticket lanes (ordered cards: seq, title, status, commits (short shas, click-copy), duration); right = event stream (mono 12px, colored by level, auto-follow with pause-on-scroll, `Follow ⇣` pill to resume). Header: run status + `X/Y done` + elapsed + Cancel ghost button (wired to existing abort).

## 4. Visual language (binding)

- Colors: bg `#0A0C0F`; panel `#0E1116`; hairline borders `#1A2028` (1px, everywhere — no shadows, no elevation); text `#C9D1D9` primary / `#8B949E` secondary; accent violet `#8B5CF6`. Phase/status: ideation `#8B5CF6`, spec `#6E7681`, tickets `#D29922`, implementation `#F0883E` (pulse animation while burning), review `#58A6FF`, shipped `#3FB950`, failed/danger `#F85149`, needs-me `#D29922`.
- Type: UI = system stack 13px/1.45; identifiers, branches, ids, events, terminal = mono (`Cascadia Code, JetBrains Mono, Consolas`) 12.5px. Section titles: 11px uppercase tracked `#8B949E`.
- Density: 8px grid; sidebar rows 28px; tab height 32px; buttons 26px. Radius ≤ 6px (chips 999px). Exactly ONE solid accent button visible per view (the next action); everything else ghost/outline.
- Motion: only status pulses and tab-switch (none). No skeletons; empty states are one dim mono line.

## 5. Embedded terminal architecture (W1)

- **PTY backend**: `node-pty` (ConPTY on Windows). Try under Bun first; if native module fails under Bun, run a **sidecar**: `packages/server/src/pty/pty-host.cjs` executed with system `node` (v25 present), one process per terminal, newline-JSON protocol over stdio (`{t:'data',d}`, `{t:'resize',cols,rows}`, `{t:'exit',code}`). Server owns lifecycle either way behind one interface `createPtySession(cmd, args, opts): { onData, write, resize, kill, onExit }`.
- **Transport**: Bun.serve native WebSocket at `/ws/terminal/:sessionId` (upgrade in packages/server; note @hono/trpc coexistence — mount upgrade before Hono fetch fallthrough). Binary/utf8 data frames pass through; JSON control frames for resize/status.
- **Lifecycle**: `launchSession` in `embedded` mode (new config `launchMode: 'embedded'|'window'`, default embedded) spawns the PTY eagerly: command = `claude` + EXACT same flags/artifacts as today, `cwd` = talk worktree, `env` = process.env + RUNCASTLE_SESSION_ID/RUNCASTLE_SERVER_URL (direct inheritance — no cmd /k). Ring buffer (512KB) per PTY; on WS attach: replay buffer, then live. Detach ≠ kill. Kill on: session-end hook, End session button, server shutdown. `window` mode keeps today's wt.exe path (Pop out uses it too — same session id, PTY killed first... M1: Pop out = end embedded PTY + relaunch via wt.exe as a NEW session, keep it honest and simple).
- **Frontend**: `apps/web/src/components/TerminalView.tsx` — props pinned: `{ sessionId: string; wsBase?: string }`. `@xterm/xterm` + `@xterm/addon-fit`. Reconnect with backoff; show one dim mono line `reconnecting…` overlay when socket down. Theme: bg #0A0C0F, fg #C9D1D9, cursor #8B5CF6, selection rgba(139,92,246,.25).

## 6. File ownership for this rework

- **W1**: `packages/server/src/pty/**`, edits to `launcher/launcher.ts` + `config.ts`/core config additive (`launchMode`), WS wiring in `index.ts`, `apps/web/src/components/TerminalView.tsx`, `apps/web/src/lib/terminal.ts`, deps (@xterm/*, node-pty).
- **W2**: everything else in `apps/web/src/**` (full shell rework), MUST import TerminalView only via `components/TerminalView` with the pinned props and wrap it in an error boundary. Never edits W1 files; a placeholder TerminalView already exists so W2 typechecks before W1 lands.
- tRPC additions allowed (additive only): `feature.endSession({sessionId})`, `run.cancel({runId})` if missing — coordinate by making W2 add them (it owns the consuming UI) in `trpc/routers/*` with service-level implementations; W1 does not touch tRPC.

## 7. Acceptance walk (I will drive these in a real browser)

1. Cold load → sidebar lists features with correct glyphs; entry-tags shows needs-me dot; status bar healthy.
2. Click entry-tags → overview tab; primary action reads `Start grilling`.
3. Click it → terminal tab opens ≤2s, live claude prompt visible, typing works, hook flips session live (status dot).
4. Grill two answers → decisions.md appears in Knowledge; Activity ticks.
5. Tickets emit → tickets tab badge; ledger rows expand with full context; Burn enabled exactly when gate allows.
6. Burn → run tab opens itself; lanes progress; event stream follows; sidebar spinner on the feature.
7. Second feature created and grilled in parallel — tab switching loses nothing (S8).
8. Run done → overview action = `Test drive`; status bar shows driving state + Stop; merge → phase shipped, sidebar glyph ✓.

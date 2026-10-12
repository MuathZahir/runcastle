# Outcome — Features plan themselves

A started feature walks its own design tree from its brief, with /goal driving the loop and a challenger checking coverage, and stops at Burn with its preview ready, so the human approves by looking instead of being grilled.

- Shipped: 2026-10-12
- Laps run: 1

## What shipped

22 commits · 35 files

### Lap 1
- 8 tickets landed: #1 Launch a planning session headless as a self-planning run; #2 Plan it yourself on the feature page; #3 Skill pack: planning without a human; #5 Pressing End session on a feature's chat shuts the whole driven server down; #6 A Codex self-planning run can write nothing: every runcastle tool call and every file write is refused under exec, so it ends with no plan; #7 The chat resumed after a Codex self-planning run is still refused the runcastle tools, so it cannot pick the plan up either; #8 The test gate is red on the branch: 3 tests fail at dbafc41, none in files this lap changed; #9 During a self-planning run the Overview still shows "Chat live · lap 1" with Open chat and End session under the bar
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: dbafc413b9dd13b53f0cd38688be9381cf4dcdfb
- Landed since: 5
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 9724135997b42868bed74cb8cc011cba90f0386e
- Landed since: 0
- Outcome: done

- **The Codex fix works by running every Codex session on Windows unsandboxed** — open
- **During a self-planning run the Chat tab still shows a live dot, a "Chat · lap 1" header and End session** — open

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Launch a planning session headless as a self-planning run

# Ticket 1 — launch a planning session headless as a self-planning run

**What was done.** `SessionPurpose` now includes `self-plan`. `sessions.purpose` is plain text, so no migration was needed. `RuntimeLaunchInput.headless` is passed through both adapters. On Claude it adds `-p` in front of the usual flags and puts the kickoff last, and it never adds `--resume`. On Codex it is `['exec', '--dangerously-bypass-hook-trust', kickoff]`. A headless launch with no kickoff throws (`assertHeadlessKickoff` in `runtimes/types.ts`). Interactive argv is unchanged.

`selfPlanKickoffFor(runtime)` and the shared constant `PLANNING_WITHOUT_A_HUMAN` live in `runtimes/skills.ts`. `renderSystemPrompt` adds a "## No human is present" section before "## Your task" only for `self-plan`. A test pins that the ordinary ideation prompt is byte-identical once that section is stripped.

In `launchSession`, a self-plan launch is refused with a `GateError` before any row is created if:
- the feature is not at planning,
- `chatOpening` is not `ideate`, or
- `assertSpawnable` fails.

A self-plan launch never resumes and emits no resume_unavailable. It passes `headless: true`, and `session.launching` carries `purpose` (for any launch that has one). While a self-plan chat is launching or live, every chat launch, including start-lap and another self-plan, throws "…is planning itself — stop the run first…". `chatKickoffHeader` gained an optional `opening` parameter whose default is the old sentence. `handlePtyExit` emits `session.self_plan_ended {sessionId, complete, exitCode}`, with `complete = ticketsReadyLap === lap` read from a fresh feature row. Tests are in the new `packages/server/test/self-plan-launch.test.ts`, plus additions to `launch-artifacts.test.ts` and `kickoff.test.ts`.

**Surprises.** Grepping for `resume_capped` found no server or core registry of event types. The only label maps are in `apps/web` (`lib/activity.ts`, `Activity.tsx`), which this ticket may not touch, so the new event has no label there yet. The full suite showed 2 failures, both on the known list: the README prerequisites wording test and the dev-pane process-tree kill test. The burner OAuth env test passed in this sandbox. Typecheck is clean.

**Left undone.** `promptMatchesKickoff` (`services/conversations.ts`) hides the kickoff from transcripts by matching its first 40 characters against the per-kind default line. The self-plan kickoff starts differently, so a resumed self-planned chat will probably show it as the human's opening line. Ticket 2 or a follow-up should either recognise it or label `session.self_plan_ended` in the web. Drive machinery: this ticket adds no service, env var, seed or process, so `.runcastle/` was not touched. I ran none of the drive scripts.

#### 2. Plan it yourself on the feature page

# Ticket 2 — Plan it yourself on the feature page

**What was done.** `ACTION_KINDS` gained `selfPlan` and `stopSelfPlan`. Each has a case in `runAction` and an icon in `NextStepBar`'s `ACTION_ICON` record, which is exhaustive and failed typecheck until both were added. `SELF_PLAN_ACTION` sits beside `CHAT_ACTION` in `next-step/chat.ts`. A new pure predicate, `isSelfPlanRun(session)` in `feature-ui/session.ts`, is the one reading of a self-planning run used by the bar, the Chat tab and the Chat door.

The bar:
- **Draft:** keeps Start as its primary and adds Plan it yourself as a secondary, disabled with the same reason as Start.
- **Started feature with nothing planned:** Start session is the primary, with Plan it yourself beside it.
- **Live run:** the bar says "Planning itself", spins, and offers Stop with no chat. It is built outside `step()` and is checked before "Finishing the tickets".
- **Stopped short:** shown when no session is live, `ticketsReadyLap !== lap`, and this lap's newest chat row is an ended self-plan. It sits above the ready-to-burn bar, so tickets the run never finished still read as stopped short, and its primary is "Resume session" (chat).

In `Workspace.tsx`, self-planning uses its own `startSelfPlan` and `launchSelfPlan` mutations. The shared `start`/`launch` mutations land on Chat, and these must not. On a draft, `startSelfPlan` sends the same base branch Start would. Stop is `endLiveSession()`. `openChat` shows an info toast instead of landing on Chat while a self-plan is live. `ChatView` gained a `headless` prop that replaces the terminal, and `FeatureChat` passes a "planning itself" line through it.

Tests are in the new `apps/web/test/self-plan-next-step.test.ts`, plus one case in `chat-view.test.ts`.

**Deviation / surprise.** One existing resolver test had to change: `feature-ui.test.ts`, "offers only the session door once planning is idle". It pinned the secondary of a fresh planning feature as `[Merge]`, which is exactly the state the ticket's item (b) changes. It now expects `[Plan it yourself, Merge]`. Every other existing test passes unchanged.

Full suite: 2 failures, both on the known list (README prerequisites wording; the dev-pane process-tree kill). The third known one, the burner env test, passed here. Typecheck is clean.

**Left undone.**
- `session.self_plan_ended` still has no label in `lib/activity.ts` / `Activity.tsx`.
- Ticket 1 noted that `promptMatchesKickoff` on the server will likely show the self-plan kickoff as the human's opening line in a resumed transcript.
- The Overview's LiveSessionBar still says "Chat live · lap 1", with Open chat, during a run. Open chat lands on the tab that shows the planning-itself line.
- Drive machinery: nothing added that needs it; `.runcastle/` was not touched and no drive scripts were run.

#### 3. Skill pack: planning without a human

# Ticket 3: Skill pack, planning without a human

## What was done
- **Ideate skill:** added `## 1a. Planning without a human`, the self-planning path. It covers: one turn, frontier rounds written to decisions.md as each is decided, the depth rule, exactly one challenger (the Agent tool in Claude Code, `spawn_agent` in Codex, given only the brief and decisions.md, with a fallback that records a challenge that was not independent), refused tools, at most five to check first, and going straight through to spec and tickets with one closing message.
- **Ideate skill, other sections:** §1, §3, §4 and §6 now say which path each rule belongs to. In §3, steps 3–5 are the grill path. The grill path's wording, and the existing pinned phrases, are unchanged. §2 documents the `**Assumed.** Alternative:` and `**Challenged:**` lines and includes the spec's example.
- **Revisit skill:** under "3. **Docs.**", the `**Assumed.**`/`**Challenged:**` lines come off any decision the human confirms or changes. Decisions the human didn't touch keep them. The preview redraw now mentions the check-first group.
- **Preview rules (preview.md):** describe the Check first group (at most five) and the assumed marks, say a grilled feature has neither, and add both to the self-check list.
- **Preview starter:**
  - A `D` entry takes an optional third element, the mark text (e.g. `'assumed'`), shown as a `.tag` on its row.
  - A new `C` list, `[n, alternative, whyUnsure, tag?]`, is drawn as a `.cf` group inserted before `#dlist`. Its markup is created by the script only when `C.length`, so an empty `C` leaves no markup at all.
  - Styles follow the `check-first-decisions` screen block and use only existing tokens.
- **Tests:** extended `preview-skill.test.ts`; added `self-plan-skill.test.ts`.

## Surprises
- Where the check-first pick is recorded wasn't specified. I kept it out of decisions.md: it lives in the preview's `C` list and the closing message. That way no new decisions.md format was added. On revisit, a confirmed decision drops out of the group.
- The rendering was checked once, outside the repo, with happy-dom (empty `C` gives no group; a filled one gives the group before `#dlist`, plus tags). happy-dom isn't a dependency of the server package, so the committed tests assert on the text only.

## Left undone
- Full suite: 2 failures, both in the ticket's known list (dev-pane process-tree kill, README prerequisites wording). The burner env test the ticket also names as known did not fail here. Typecheck is clean.
- Drive machinery: no new service, env var, seed or process, so it was not edited.

#### 8. The test gate is red on the branch: 3 tests fail at dbafc41, none in files this lap changed

# ticket(8) digest

**What was done.** I fixed the three tests that made the gate red (commit ca1b2298). All the changes are in test files; no production code changed.
- `readme.test.ts`: the prerequisites check now also accepts the README's "paid Claude plan" wording. Main's e49c3c10 and b2b0b26b are not in this clone, so I re-did both fixes by hand instead of cherry-picking.
- `ticket-burner-units.test.ts`: the no-token `buildBurnAgent` test now clears the host's `CLAUDE_CODE_OAUTH_TOKEN` with `vi.stubEnv`. The describe block gets its own `afterEach(vi.unstubAllEnvs)`; the existing one belongs to a sibling describe.
- `dev-pane.test.ts`: the kill-tree test now checks whether any member of the process group is still running, using `ps -A -o pgid=,stat=` and ignoring `Z` (zombie) entries, instead of `kill(-pgid, 0)`.

**Surprises.** The dev-pane test was not a real failure. PID 1 in the burn container is `sleep`, which never reaps orphans. After the SIGTERM the shell and its `sleep` child are dead but stay as zombies, and `kill -0` succeeds on zombies, so the group looked alive. I confirmed this by hand with `setsid bash -c 'sleep 300 & …'`: after a group SIGTERM, both processes showed state `Z` with parent 1. The production group-kill in `pty/kill-tree.ts` works. The new check still fails if the kill does nothing, because the `sleep` would be in state `S`.

**Repro re-run.** I re-ran the repro step: `env -u GIT_ASKPASS bun run test` exits 0 (315 files passed, 2 skipped; 4484 tests passed, 46 skipped). Before the fix, the three files reproduced all three failures in this sandbox, with `CLAUDE_CODE_OAUTH_TOKEN` set to stand in for the leak. After the fix, the same targeted run with the token set passes too. `bun run typecheck` exits 0. The drive machinery needed no change.

**Left undone.** The reviewer saw a Claude token printed in the gate log. I did not look into where it is printed; that is outside this ticket.

#### 10. Verify the fixes that landed

Drive verification pass on pass #4: all 5 landed fixes held, 0 defects found, 2 observations

Driven on `feature/features-plan-themselves` at 9724135, in runcastle-demo, with real Claude Code and Codex (gpt-5.6-terra) sessions. Nothing was plainly broken on the tour.

**#5 End session shuts the server down: held.** On the draft "UX audit — draft flow probe" I pressed Start, waited for the Claude Code terminal's first reply, and pressed End session. The server answered 200 on every poll for the next 20 seconds and kept the same process (pid 70924). It also stayed up through Stop on a headless run and End session on an interactive Codex chat later in the tour.

**#9 "Chat live" strip under the planning-itself bar: held.** On a new draft, Plan it yourself showed "Planning itself. No terminal to watch; the plan appears below as it is written." with Stop as the only control and no strip beneath it, on Claude Code and again on Codex. Stop then gave "Planning stopped before the plan was complete" with Resume session.

**#6 Codex self-planning can write nothing: held.** With Model for Chat set to gpt-5.6-terra, Plan it yourself on a new two-sentence draft finished by itself in about four minutes with one decision marked Assumed, a preview, a spec and two tickets, and the bar read "Burn 2 tickets". The run's rollout file contains neither "requires approval, but approval policy is never" nor "blocked by read-only sandbox"; `get_feature_context`, the file patches, `complete_phase` and `emit_tickets` all went through, and it spawned its challenger.

**#7 Resumed Codex chat refused the runcastle tools: held.** Opening the chat on that feature resumed the same conversation (id 01a13089) in the interactive terminal, and its first tool call, `runcastle.get_feature_context`, returned the feature. I then asked for one wording change; it rewrote the decision, spec and preview, updated both tickets and recorded the event, with no refusal. The original repro reached the chat from the stopped-short bar; because a Codex run now finishes, I reached it from the finished run's Chat button, which is the same chat launch. The stopped-short route on Codex was not driven.

**#8 Test gate red: held.** The server's gate run on 9724135 passed both commands: typecheck clean, and the test run at 315 files and 4487 tests passed, none failed. `dev-pane.test.ts`, `readme.test.ts` and `ticket-burner-units.test.ts` all pass. The dev-pane change is a real fix (it counts running group members and ignores zombies), not a skip. The test log holds no Claude token this time.

Two observations for you, neither a defect:

- The Codex fix works on Windows by running every Codex session, the interactive chat included, with `sandbox_mode = "danger-full-access"` and approvals off, bounded by runcastle's own edit and install guards. That is wider than the finding asked for (writes inside the feature worktree) and is a deliberate trade stated in the commit.
- During a self-planning run the Chat tab, which fix #9 did not cover, still shows a live dot and a "Chat · lap 1" header with End session above the sentence saying there is no terminal to watch. It works as a second Stop.

Housekeeping: the Chat step's model was set back to the default before the drive stopped. The two probe features I created ("Entry count in the header (verify probe)" and "Entry total in the header (Codex verify probe)") live only in the drive's own database. The walkthrough recording and 19 screenshots are in this folder.

```
REVIEW-MODE: drive
REVIEW-VERDICT: verified
REVIEW-REASON: All five fixes re-driven or read from the server's gate run and held; the Codex stopped-short resume route was covered through the finished-run chat instead.
```

# Outcome — Ready to publish

The README matches the app, every concept has one name across the UI with a short glossary, the usage ping is disclosed, and build-era leftovers are gone.

- Shipped: 2026-11-05

## What shipped

29 commits · 271 files

- 6 tickets landed: #1 Words: one name per concept across the web app; #2 Words: server messages, the CLI, the agents' skill text, and the build-era leftovers; #3 Glossary: wire the dialog, the help menu and the first-meeting hints; #4 Phone: name the tailnet's HTTPS step, and say 'on your computer' in phone chats; #5 Usage ping: told before it is sent, a switch in the wizard and Settings, a one-time notice; #6 README: matches the app
- 0 waived
- 0 failed

## Review record

### Ticket 7 · review

- Reviewed commit: 5a1d307063aec1ae9f5ecf94dce619dfa2a7f0f7
- Landed since: 0
- Outcome: done

- **Test gate red on 5a1d307: three server tests fail (move round trip ×2, pty kill-tree)** — dismissed
- **The review drive's capture comes back blank and resets the agent's browser (review tooling, not this feature)** — open
- **Sidebar fold buttons still say "Hide threads" and "Hide conversations"** — fixed
- **The test drive button and bar carry no dotted hint; only the "Starting the test drive" title does** — open
- **README still describes chats as terminals, review rounds as fixing in-run, and a "+" create button** — fixed

## Notes record

- No human notes

## Per-ticket digests

### 1. Words: one name per concept across the web app

# Ticket 1 — Words: one name per concept across the web app

## What was done
- Went through the user-visible strings in apps/web/src and changed them to decision 15's words: thread/session/conversation → chat ("New chat", "Chats", "All N chats", "Rename chat", "Chat name", "Side chat", "End the chat & resolve"), project chat → orchestrator (Settings step "Orchestrator chat", This project section "Orchestrator", the chat region's label "Orchestrator chat", the tooltip `Held by the orchestrator chat "X"`), burn/lane/run (as a noun) → round/worker ("Round finished", "View round", "A round is in flight", "being fixed in the running round · worker #N"), "Project drive" → "Test drive · main". The Settings → General section "Sessions" and the step table's group "Sessions" now read "Chats".
- Stages: `PHASE_NAME` maps ideation/spec/tickets to "Planning". `PHASE_TIP` for planning and building was rewritten without "emit tickets". "the grill" was removed from the draft next-step.
- The Create menu's "New chat" hint now says what it really does (it opens a new orchestrator chat; see ProjectShell `newChat`). Desktop and phone use the same sentence.
- The wizard's workers step adds: "You can skip it for now, but you need it before your first round can build anything."
- Settings search: every Workers checklist row now also matches `burn`, `AFK`, `lane` and `unattended` (`WORKERS_PAGE_ALIASES` in lib/afk-rows.ts). The `SETTINGS_POINTER` legacy matcher is unchanged.
- New test `apps/web/test/vocabulary-guard.test.ts`. It parses every src file with Vite's `parseAst` (TypeScript 7 in this repo has no JS compiler API) and fails on a retired word in JSX text or in a prose literal. Code positions are skipped by structure, not by a list: imports, TS type nodes, property keys, `===` comparisons, case tests, `cx()` arguments, non-text JSX attributes, `terms:` values and `*_TERMS` constants, and tokens with no space and no capital. The allowlist holds one file (lib/glossary.ts) and two literals. A second case checks that the guard really catches JSX text, a `title` and a template label, and lets code names through.
- Added one Settings dialog test: typing burn, AFK or lane lands on the Workers page. About 25 existing tests had their expected copy updated to the new words; none of their checks were made weaker.

## Surprises
- Earlier features had already done much of the sweep (lib/vocabulary.ts had no retired words left), so about 80 strings remained.
- The Settings dialog harness leaves the doctor loading, so the checklist rows never render there. The alias test can only check the page switch, and "lane" is the case that shows the aliases work.

## Left undone
- "run" as a verb ("Run every waiting ticket on", "Run everything that has shipped") is kept. The guard does not cover "run", because the word is too ambiguous to check automatically.
- Comments and identifiers still say burn/thread/session (decision 3). Strings that come from @runcastle/core (e.g. PLANNING_STOPPED) belong to the packages and were not swept.
- In the sidebar, the feature drive card stays plain "Test drive". It never appears beside the main one (one drive slot per project).
- Drive machinery: this ticket needs no change to it, so nothing was checked.

### 3. Glossary: wire the dialog, the help menu and the first-meeting hints

# Ticket 3 — Glossary: dialog, help menu, first-meeting hints

## What was done
- `GlossaryProvider` is mounted once in main.tsx, inside Toast/Tooltip providers, so every `Term`, menu and palette entry opens the same dialog.
- Sidebar: `SidebarFootChrome` passes `onOpenGlossary` / `onOpenPhoneSetup` through to `SidebarStatusLine`. The project sidebar wires both. The phone entry opens `ws.openSettings({ page: 'general', field: PHONE_LINK_FIELD })` through a new `Sidebar` prop, `onOpenPhoneSetup`. On a phone the sidebar foot is not rendered, so the phone entry is never shown there. The portfolio home's sidebar has the Glossary only, because no Settings dialog exists at that level.
- Settings: the "On your phone" section did not respond to a deep link. `PhoneLinkSection` now takes `highlight` (GeneralPage passes `highlightField === PHONE_LINK_FIELD`). It uses the shared `useHighlight` to scroll to the section and flash it. The flash ring sits on a wrapper div, which takes over the section's `mt-9 first:mt-0`, so the section does not move. `PhoneLinkBody` is untouched.
- Command menu: new "Glossary" and "Use runcastle on your phone" entries, each shown only when its callback is given. Their search words are in `GLOSSARY_TERMS` / `PHONE_SETUP_TERMS` and include burn/afk/lane/thread/session and phone/mobile/tailscale. The palette is desktop-only already.
- Phone: the "+" sheet in `PhoneListHead` has a Glossary row.
- Terms, placed on the word that was already there. Where the ticket's spot only takes a string or sits inside a button, the Term went to the nearest ReactNode spot:
  - **round**: the tickets view's "Round N" heading. The plan card is a button and shows no round count.
  - **test drive**: "Starting the test drive" on the drive stage. The Test drive buttons are buttons.
  - **review package**: the Review package dialog heading. The card is a button.
  - **orchestrator**: the empty orchestrator chat's line "The Orchestrator checks it…". The crumb is a button.
  - **held by**: the feature status line's label when held ("With the orchestrator · …"), which sits beside the held-by crumb. The crumb's tooltip cannot hold a popover.
  - **scenario**: the drive's "Setting this up by hand every time? Make it a scenario." hint. The picker's headings are inside a cmdk listbox and its trigger is a button.
  - **preparation**: Preparation's breadcrumb, a non-clickable span.
  - **worker**: "Workers" in the wizard's workers step.
- vocabulary.ts: `BURN_EXPLAINER` is now `glossaryEntry('round').definition`. `AFK_BURN_EXPLAINER` had a single user, the wizard step, which needs "Workers" as a Term. Its sentence moved inline into AfkStep with the same words, and the constant was removed.
- Tests: glossary.test.ts checks the list (16 ids, 4 groups), that `filterGlossary('')` returns all entries, that 'burn' finds Round, and that every typed word must match. glossary-dialog.test.tsx (tier 2) covers the dialog: all 16 terms, the group headings, the "Once called" line, the 'burn' filter, and the opened-at mark. It also covers Term (opens on focus, its link calls the opener with the id, no link without a provider) and HelpMenu (both items; the phone item is absent without a callback). command-palette.test.tsx covers the two entries, found by 'burn' and 'tailscale', and the absent phone entry. sidebar-foot.test.ts checks that the Help icon shows only when wired. Web typecheck, the root typecheck and the full web test run pass, apart from the copy assertions fixed below.

## Forced visual changes (the designed components are untouched)
- **Scenario hint:** the link now covers "Make it a", and "scenario" is a dotted Term after it. A Term cannot sit inside a button. scenario-drive.test.tsx finds the link by "Make it a".
- **Text split by markup:** afk-step, first-run-wizard and drive-stage tests now read text without tags, because the Term's markup splits the sentences they check.
- **Status line:** the held label is a dotted word.

## Surprises
- The ticket's "tier 1 for GlossaryDialog markup" was not possible: `Dialog` portals, so the dialog tests are tier 2.
- `filterGlossary('burn')` also returns Worker, whose "Once called" includes burner. The tests expect that.

## Left undone
- The phone entry is not in the portfolio home's help menu, because there is no Settings there.
- The scenario picker itself (the combobox) has no hint.
- Drive machinery: not affected (no service, env var, seed or process added), so nothing was checked.

### 4. Phone: name the tailnet's HTTPS step, and say 'on your computer' in phone chats

# Ticket 4 — phone link HTTPS step, "on your computer" in phone chats

## What was done
- **Server.** `ExecFn` (doctor/doctor.ts) takes an optional third argument `{ stopWhen(output) }`; `createSystemExec` checks it on every stdout/stderr chunk, kills the process on a match and resolves with `stopped: true`. Callers that don't pass it behave as before. `turnPhoneLinkOn` passes a `stopWhen` that fires once "Serve is not enabled on your tailnet" and a whole `https://…` link (followed by whitespace) have arrived. Any failed serve-on whose output (stopped, exited or timed out) holds that notice now answers `httpsNeeded`: the printed link, or `TAILSCALE_HTTPS_PAGE` (`https://login.tailscale.com/admin/dns`, which moved to the server). It sets no `error` and adds no operator hint. Other failures, including the Linux operator hint, go through `withFailure` exactly as before. `PHONE_LINK_TIMEOUT_MS` is still the last resort.
- **Web.** `PhoneLinkStatus` now carries `httpsNeeded`, so `PhoneLinkView` is a plain alias and the web copy of `TAILSCALE_HTTPS_PAGE` is gone. The section's wiring already did what the ticket asked: Try again calls turnOn, and the mutation's answer goes into the status with `setData`.
- **Phone notices.** `StandingInput` gains `phone`, fed from `useIsPhone()` in `use-standing-notices.ts`. What each row does on a phone:
  - Conflict with a live chat: says "— resolve it on your computer", has no button, and drops the one-terminal tooltip line. This is the end-the-terminal-then-resolve case.
  - Conflict with nothing live: keeps "Resolve with agent", because it opens a chat that works on the phone.
  - "Review couldn't drive": says "commit or discard them on your computer". The ✕ still dismisses it.
  - "Nothing verified": says "or drive it yourself on your computer".
  - Slot-drive: keeps "Stop it", because stopping is a server-side call that works from a phone. Desktop text is unchanged.
- **Tests.** phone-link.test.ts:
  - turn-on returns within 1s with `httpsNeeded`, both when the fake CLI blocks and when it exits;
  - the DNS-page fallback when no link is printed;
  - a router case where the real `createSystemExec`, over a mocked spawn that never closes, is stopped by the notice.
  
  settings-phone-link.test.tsx: the greyed steps, and the httpsNeeded state (label, Open Tailscale href, Try again to on). standing-notices.test.ts: six phone cases. The existing operator-hint tests pass unchanged. Typecheck is clean.

## Surprises
- The web half (`PhoneLinkBody`, `HttpsLine`, Try again) had already been committed with the design, so the web work was only the type change and tests.
- The existing "no operator hint off Linux" test uses "HTTPS is not enabled for your tailnet" as a generic failure. Detection only matches Tailscale's "Serve is not enabled on your tailnet" text, so that test still reads it as a raw error. I did not check this wording against current Tailscale docs (offline). It comes from the ticket's description of the CLI.

## Left undone
- I didn't change the drive-machinery files (no new service, environment variable or seed).
- The live tailnet check is still the human's to do (decision 11).
- The `useIsPhone` → `phone` wiring in the hook has no test of its own. The rows are tested through the pure `standingNotices`.

### 5. Usage ping: told before it is sent, a switch in the wizard and Settings, a one-time notice

# Ticket 5 — Usage ping: told before it is sent

## What was done
- **Server.** A new machine-wide setting `usageSignal: 'on' | 'off'`, unset by default, is added to `RuncastleConfig`, to the env overrides (`RUNCASTLE_USAGE_SIGNAL`) and to the settings field table. `update-check.ts` now has `usagePingAllowed` and `usageNoticeNeeded` (both take an injected `{ env, usageSignal, installIdExists }`). The ping goes out only when DO_NOT_TRACK is not set AND (the setting is 'on', OR it is unset and an install ID already exists). Every other case asks npm. `install-id.ts` gains a read-only `hasInstallId()`, so a check that doesn't ping never creates the ID. `getUpdateInfo(current, { usageSignal, fetchImpl })` changed signature; boot and `system.checkUpdate` pass `config.usageSignal`. The memo cache is unchanged, so turning the ping on after boot takes effect at the next check that actually runs, not as an immediate re-ping. The new `system.usageNotice` query returns `{ show }`.
- **Web, Settings.** Settings → General → Server has a "Usage ping" row. I kept the `switch` control and mapped its values: `FieldMeta.switchValues` holds `{on:'on', off:'off'}`, and `switchWrite()` decides what a flip writes. Anything but 'off' (unset included) shows as on. `searchTerms` were added to FieldMeta/SettingRow and fed into `rowSearchTerms`: usage, ping, telemetry, tracking, analytics, privacy. A switch row that the environment locks now renders as a disabled switch instead of the locked text field. The tooltip names DO_NOT_TRACK. `USAGE_PING_SENDS` is the shared sentence used by the row and the wizard.
- **Web, wizard.** IntroStep has a "Send the usage ping" Checkbox, ticked by default. When the wizard is replayed it shows the current setting. Leaving the step forward writes 'on' or 'off' through `settings.update`; nothing is written if the env locks the setting.
- **Web, notice.** UpdateBanner falls through to a `UsageNotice` when no update banner is showing, so the update banner wins the slot. Turn off writes 'off' and OK writes 'on'. The notice hides at once and invalidates `system.usageNotice`. `live.ts` also invalidates that query on every event.
- **Tests.**
  - update-check: every rung of the ladder (8 cases) is covered, plus a check that the install ID is never created without a ping, plus `usageNoticeNeeded`.
  - install-id: `hasInstallId`.
  - system-router: the notice ends once the setting is written; never shown on a fresh install or under DO_NOT_TRACK.
  - settings-dialog: the switch writes 'off'/'on', and the row is found by telemetry/ping/privacy.
  - first-run-wizard: ticked → 'on', unticked → 'off', replay shows the setting, env-locked writes nothing.
  - New `update-banner.test.tsx`: the notice, both buttons, the update banner winning the slot, and the notice after a dismiss.

## Surprises
- `system-router.test.ts` built its caller with an empty ctx. `checkUpdate` now reads `ctx.config`, so the test ctx carries `{ config }`.
- Existing update-check tests that expected a ping now pass `usageSignal: 'on'` (`PINGING`), because unset + fresh dir now means npm.

## Left undone
- README (another ticket): it should name the Settings switch, `RUNCASTLE_USAGE_SIGNAL` and the new "fresh installs don't ping until the wizard" rule.
- Drive machinery: there is no new service, required env var or seed, so `.runcastle/` needed no change. I didn't run the drive scripts.

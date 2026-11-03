# Ready to publish

## Problem

A stranger who finds runcastle reads the README first, then meets the app. Today
the README describes a UI that is gone (a "New feature" button, six phases, gate
overrides, "open http://localhost:4512" as if it opened itself) and never says
that building anything needs Docker and an agent token until the first round
fails. The app then calls one thing by several names: unattended work is a
burn, an AFK burn, a run, a round, a lane or a lap; a conversation is a chat, a
thread, a session or a conversation; the project-level drive is a project drive
or a test drive. Nothing explains round, review package, orchestrator, scenario
or "held by". The usage ping goes out at every boot and is disclosed only near
the bottom of the README. Build-era leftovers (a findings log carrying the
owner's private paths, a stub error class nothing throws) sit in the repo. And
the phone setup, which works, is unfindable, stalls on a fresh tailnet's
one-time HTTPS step, and tells the phone side in one sentence.

## Approach

**What the person sees.** The README reads true from the first line: the four
stages the app shows, the loop as it works now (talk it through, say yes to the
plan, rounds of workers build, a review round checks, test drive, merge), the
two tiers of prerequisites up front, how to reach runcastle on another machine
and on a phone, what the usage ping sends, and where to report bugs. Every
screen, error, CLI line and agent message uses one word per concept
(decision 15). A question-mark icon in the sidebar's bottom row opens a help
menu with the Glossary and "Use runcastle on your phone"; the command menu has
both. Where a newcomer first meets a word, a dotted underline explains it in one
sentence. The first-run wizard says what the usage ping sends before it is ever
sent, with a ticked checkbox; Settings → General has the same switch; an
existing install is told once. The "On your phone" section names the tailnet's
HTTPS step with a link instead of timing out, and walks the phone side in four
numbered steps.

**Words (decision 15).** Only text a person reads changes (decision 3). Code
identifiers, database tables, tRPC procedures, MCP tool names, settings keys,
route paths and CLI command names stay. Settings search keeps the retired words
as aliases. The table in decision 15 is the source; the main replacements:

- burn / AFK burn / run (noun) / lane / lap → **round**; burner / lane / AFK agent → **worker**; AFK (adjective) → **unattended**.
- thread / session / conversation → **chat**; "New thread" → "New chat"; "Conversations" → "Chats"; the Settings sections and step-table group "Sessions" → "Chats"; "End session & resolve" → "End the chat & resolve".
- project session / project chat → **orchestrator** (its chats are orchestrator chats); `held by the thread "X"` → `held by the orchestrator chat "X"`.
- project drive / drive mode → **test drive**, with its scope beside it where both exist ("Test drive · main", "Test drive · this feature"); the review agent's "drive mode" in skill text → "a test drive".
- Stages are Planning, Build, Review, Shipped everywhere they are named; "ideation", "spec" and "tickets" stop appearing as stage names in what people read.
- "The grill" and similar build-era words in UI copy go.

The skill text under the skills package is swept where it shapes what an agent
says to the human in chat (headings, phrases agents quote, instructions about
what to tell the human); MCP tool names and machine contracts in it stay. The
CLI's help line, the published package description and the README tagline all
read "Idea in, merged branch out. On your machine, in your repo." (decision 19).

A guard test scans the web app's user-visible strings (JSX text and string
literals passed as labels, titles, hints, descriptions, toasts and errors) for
the retired words, with an explicit allowlist for search aliases and
identifiers, so the words cannot drift back.

**Glossary (decisions 16, 17, 20; designed).** One list, `lib/glossary.ts`,
holds sixteen entries in four groups (Your work, Building, Trying it, The
project), each with one sentence and, for round, worker, chat and test drive, a
"Once called" line. `GlossaryDialog` renders it with a filter box (old words
find their new entry). `GlossaryProvider` holds the dialog once near the app's
root and hands an opener down; `Term` is the dotted-underline hint (hover,
focus, click or tap; a link opens the Glossary at that entry); `HelpMenu` is
the bottom-row menu, slotted into `SidebarStatusLine` through two optional
callbacks. Terms are placed at these first-meeting spots: the plan's round
count, the test drive button and bar, the review package's heading, the
orchestrator's header, the "held by" line, the scenario picker, the preparation
screen, and the wizard's workers step. The vocabulary module's explainer
sentences that duplicate a glossary sentence are replaced by it. On a phone the
Glossary is reachable from the phone's menu sheet, and the phone entry of the
help menu is omitted.

**Usage ping (decisions 4, 18).** A new machine-wide setting, `usageSignal`,
is `'on' | 'off'` or unset. The update check's ladder becomes: `DO_NOT_TRACK`
set, or `usageSignal` is `'off'`, or the setting is unset on an install with no
install ID yet → skip the ping and ask npm; otherwise ping. The wizard's intro
step shows one line on what is sent (a random install ID, the version, the
platform; nothing about projects or code) with a checkbox ticked by default;
leaving the step records `'on'` or `'off'`. Settings → General gets a "Usage
ping" switch row with the same sentence and a link to the README's account. An
install with an install ID and the setting unset shows a one-time notice in the
update banner's slot ("runcastle counts this install as active once per boot:
…") with Turn off and OK; either records the setting. Turning it off never
removes the update banner.

**Phone setup (decisions 7–11; designed).** `PhoneLinkSection` is split into a
data-fed `PhoneLinkBody` (designed, with its preview) and the query wrapper.
The server's turn-on watches the Tailscale CLI's output: when it says Serve is
not enabled on the tailnet, it stops waiting at once, ends the CLI process, and
answers the status with `httpsNeeded` set to the address Tailscale printed (the
`login.tailscale.com/f/serve…` link), falling back to Tailscale's DNS admin
page. Today's timeout stays as the last resort. The section then shows "Turn on
HTTPS for your tailnet, once" with Open Tailscale and Try again. The Linux
operator hint keeps working. The help menu and command menu open Settings →
General scrolled to "On your phone", using the settings dialog's existing
highlight-a-field mechanism with the section's filter id. In a phone chat,
standing notices whose fix needs the desktop (a drive, a terminal, uncommitted
changes, "drive it yourself") say "on your computer" and drop the button that
cannot work there; notices whose fix works from the phone keep theirs.

**Leftovers (decision 5).** The root `E2E-FINDINGS.md` is deleted. The stub
error class, its type guard, its branch in the tRPC error mapping, and the
comments that still describe stubs in the routers are removed.

**README (decisions 1, 2, 6, 9, 12, 13, 14, 19, 21).** Rewritten to the app as
built by the tickets above: the tagline; a two-tier prerequisites table near
the top; "run `runcastle`, then open the address it prints"; one line on the
usage ping beside install, with the full account kept further down and the
Settings switch named; the four stages and the loop as it works; Claude Code or
Codex; the unattended sandbox; "On another machine" (127.0.0.1, ports 4512 and
4514, the SSH command, Tailscale, the VPS guide link); "On your phone";
Feedback (GitHub Issues); one line that `docs/features/` is runcastle's own
build record. The README content test is updated to the new contract. The lead
recaptures the screenshots and redraws the banner with four stages after the
build round, and shows the banner to the human before the review round.

## Seams

- **README content contract** (existing): the server package's README test. Asserts the new contract: four stage names, no retired words, both prerequisite tiers, the SSH command with both ports, the phone section, the usage ping's endpoint, payload and both ways to turn it off.
- **Update check** (existing): the update-check service's `getUpdateInfo`, with fetch, environment and now the usage setting and install-ID presence injected. Observes which URL is called on each rung.
- **Settings rows** (existing): the web settings model in `lib/settings.ts` and the Settings dialog tests. Observes the Usage ping row, its search terms and the retired words as aliases.
- **Phone link service** (existing): the phone-link service's status and turn-on, with the CLI's exec faked. Observes `httpsNeeded` from the CLI's "Serve is not enabled" output, the early return, and the operator hint path unchanged.
- **`PhoneLinkBody`** (new, designed): component tests over each status, including `httpsNeeded` and the steps.
- **Glossary** (new, designed): `lib/glossary.ts` (`filterGlossary`, one entry per id) and component tests for `GlossaryDialog`, `Term` and `HelpMenu`, plus the command menu's two entries.
- **Standing notices** (existing): `lib/standing-notices.ts` and the notice deck's phone cases. Observes the "on your computer" wording and the absent desktop-only buttons on a phone.
- **Vocabulary guard** (new): a web test that fails on a retired word in user-visible strings, with an allowlist.
- **CLI usage text** (existing): the CLI entry's usage string.

## Out of scope

- Renaming code identifiers, tables, tRPC/MCP names, settings keys or CLI commands (decision 3).
- The website's pages under `site/` (decision 14); the outcome lists their old words as a handoff to the site redesign branch.
- Opening a browser on boot (decision 1).
- Enabling HTTPS on the tailnet through Tailscale's API (decision 7).
- Behaviour of waiting states, designs, drives and merges, owned by the sibling features.
- The live phone check on a real tailnet and phone, and the macOS and Windows installers on clean machines: the human's, listed in the outcome as still to do (decision 11).
- Setting the GitHub repository description and any maturity label (decisions 19, 21): the human's.

## Open questions

- Whether a non-interactive `tailscale serve --bg --https=<port>` on a tailnet without HTTPS blocks or exits. The phone ticket must handle both: stop on the "Serve is not enabled" line either way.
- Whether the banner redraw (decision 13) is approved as drawn; the lead shows it before the review round.

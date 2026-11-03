## Purpose
The human wants to publish runcastle soon (2026-11-02). This is the last pass before that: what a stranger reads and the words they see. It lands last because it renames strings across the whole app.

## What the audit found (addresses are starting points)
1. **README describes UI that doesn't exist**: a "New feature" button (the sidebar menu says "New chat", "Add to backlog", "Jot a note" — Sidebar.tsx ~553-567); six phases (ideation, spec, tickets, build, review, shipped) where the UI shows four (lib/feature-ui/pipeline.ts ~9); "boot the server and open http://localhost:4512" while the server only prints the URL (index.ts ~172). Fix the README to the UI — or open the browser on first boot if that is the better product; decide.
2. **One name per concept.** Unattended work is "burn", "AFK burn", "worker", "run", "round" and "lane" across README and UI (settings page "Workers", internal `burns`, lib/settings.ts ~1234 aliases). A conversation is "chat", "conversation", "thread", "session". Test drive appears as "Test drive", "Project drive", "Drive mode". "lap" still leaks (feature-ui/summary.ts ~61, README "same lap"). Pick one word each and sweep every user-visible string (UI, README, error text, agent-facing skill text that the human reads in chat).
3. **No glossary.** lib/vocabulary.ts covers only burn/round/unattended worker. Unexplained to a newcomer: round, test drive, review package, orchestrator, "held by the thread", scenario, repo facts, Prepare, AFK. Add a short glossary reachable from the app, and a one-line explanation where a term first appears.
4. **Usage ping** runs at every boot (index.ts, `getUpdateInfo`) and is disclosed only near the bottom of the README. Disclose it in the first-run wizard and Settings with a way to turn it off (or make it opt-in — decide, and say why).
5. **Build-era leftovers**: E2E-FINDINGS.md at the repo root carries the owner's Windows path and private setup; the `NotImplementedError` wave-B stub class (packages/server/src/errors.ts ~12-54, plus its tRPC mapping) appears unused. Remove what is dead. docs/features/* and CLAUDE.md are runcastle's own dogfooding record and stay; at most the README says what they are.
6. **Install prerequisites discovered late**: the first build round fails if Docker or the Claude token is missing. The README's "Only for AFK burns" section undersells that building needs both. Say it up front.

## Must not swallow
Behaviour changes to waiting states, designs, drives or merges — the three sibling features own those. Testing the macOS and Windows installers on clean machines is a human task (no clean VM here); note it in the outcome as still to do, don't fake it.

## Ordering
Waits on "You always know what's waiting", "Small fixes before publish" and "Designs and the plan get their own place" (up next: starts itself when all three merge), so its string sweep covers their new text.

## Working agreement (made 2026-11-02)
Autonomous: the orchestrator carries this to merged, merge included. The word choices are the agent's and orchestrator's to settle — name them in the report. Any design waits for the human's own yes. End with a review round as usual.

## Added by the orchestrator, 2026-11-02

## Added 2026-11-02 — phone setup must be ready for real users (human agreed)
The human asked how ready the phone connection setup is for real users ("does it help them do it, the commands, installing tailscale, etc."). Findings, and what this feature now owns:
- **What works:** Settings → General "On your phone" (apps/web/src/components/settings/PhoneLinkSection.tsx, packages/server/src/services/phone-link.ts) detects Tailscale missing / stopped / running, turns the private link on with one button (`tailscale serve --bg --https=<port>`), shows a QR code, and on failure shows the exact commands (Linux leads with `sudo tailscale set --operator=$USER`).
- **Never exercised live:** runcastle-on-your-phone's review left "The phone link itself was not exercised" open (docs/features/runcastle-on-your-phone/outcome.md). Run it end to end once on a real tailnet before release; if that needs the human (their phone, their tailnet), say so plainly in the outcome as still to do — don't fake it.
- **First-time tailnet step unhandled:** a fresh tailnet usually must enable HTTPS certificates / Serve once in Tailscale's admin console before `tailscale serve --https` works. Nothing names this; the likely result is the command waiting until PHONE_LINK_TIMEOUT_MS and then showing raw CLI output. Detect it and tell the human what to do (link to the admin page), as the Linux operator case already does. Verify the CLI's actual behaviour with current Tailscale docs.
- **Phone side is one sentence** ("Install Tailscale on your phone, sign in, then scan this. Add it to your home screen…"). Make it a short real walkthrough: install Tailscale on the phone, sign in to the same account, scan, add to home screen — and say that phone notifications on iPhone only work from the home-screen app.
- **Not discoverable:** the README never mentions phone access and nothing in the app points at the Settings section. Add a README section and a findable way in.
- **Phone chats still show notices that point at desktop-only setup** (open in the same outcome) — fix.

## Added by the orchestrator, 2026-11-03

## Added 2026-11-03: running runcastle on another machine
The owner runs runcastle on a remote VPS and reaches it over an SSH tunnel or Tailscale. The design server and its pass-through need port `serverPort + 2` (4514) as well as 4512. The README must document the remote setup: forward both 4512 and 4514 over SSH (`ssh -L 4512:localhost:4512 -L 4514:localhost:4514 user@host`), or use Tailscale. "Designs and the plan get their own place" is making the desktop Design view load through that pass-through, so check the README against what it shipped.

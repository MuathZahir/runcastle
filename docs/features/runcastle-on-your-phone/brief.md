## Purpose

The human: "I would like to be able to manage runcastle from my phone. There should be a way to connect it to my PC. Maybe it would have a more restricted amount of features. For example, just talking to the agents, no drives."

## Understood (agreed with the human)

- The same web app, not a separate mobile app. The chat is runcastle's own and not a terminal (ADR-0015), so it can work on a phone.
- A private link, no pairing. Tailscale, which the human already uses for the VPS, should be able to give the phone a private route to runcastle. That works the same on the PC now and on the VPS after the move, so this does not wait for "Move runcastle to another machine". This is not tested yet.
- The phone view is restricted: the feature list and the chats. No drives. Design mode, terminals and similar desktop screens stay off it.
- The phone is for talking to agents and accepting work from what the orchestrator shows.

## Understood (facts)

- The server listens only on the machine itself (`SERVE_HOSTNAME = '127.0.0.1'`, `packages/server/src/config.ts`).
- Runcastle has no login, and its agents run without permission prompts. So it must stay on the private network and never be exposed to the public internet. Anyone who reaches it controls the agents.
- The app is built for desktop: `apps/web/src` has almost no small-screen layout. This is the biggest part of the work.
- Read `apps/web/STYLE.md` before styling.

## Must not swallow

- Notifications ("Agents can notify your phone"). This feature should only leave the app able to receive them, for example over HTTPS.
- Any public access, accounts or login.
- Redesigning the desktop app.
- Native apps.

## Open

- Check `tailscale serve` (or similar) really works with the app's live connections: the SSE stream and the chat. HTTPS is probably needed for installing the app and for notifications.
- Whether the human can add it to their home screen, and which phone they use. iPhone and Android differ here.
- Exactly what is hidden, and how a phone shows something only a desktop can do, such as a feature waiting on a drive.
- How setup is explained: a Settings screen, a doctor line or a README section. Keep it as small as the job allows.
- Show directions first with design mode. The human steers visual work directly.

## Ordering

Starts by itself after "Review keeps its screenshots" merges. "Agents can notify your phone" follows it.

## Working agreement

Agreed with the human for this whole cut (Threads hold features, Agents show files in chat, Review keeps its screenshots, Runcastle on your phone, Agents can notify your phone):

Checkpoints:
1. The human approves this feature's phone view design before it builds. Stop here and show the designs.
2. The human tries the finished phone link and a real notification on their actual phone, before those features merge. Say how to get the branch onto a setup their phone can reach.

Everything else is carried through to merged by the orchestrator without stopping. Publishing a release needs the human's yes.

## Added by the orchestrator, 2026-10-31

## Working agreement correction (orchestrator, 2026-10-31)

Checkpoint 2 as first written could not work: "Agents can notify your phone" only starts after this feature merges, so no notification can be tried before this merge. It splits in two. The human tries the phone link on their actual phone before this feature merges, and receives a real notification before "Agents can notify your phone" merges.

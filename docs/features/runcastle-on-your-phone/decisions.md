# Decisions — Runcastle on your phone

## 1. The phone opens on the list, and a chat takes the whole screen
**Decision:** The phone's home is the feature list: the Orchestrator on top, then what needs you, then the sidebar's other lanes. Tapping a row opens that chat full screen, and Back returns to the list.
**Why:** On a phone the job is to see what needs you and answer it, and Android's Back button then works as expected. Opening on a chat would hide every other feature, and tabs would repeat the list and take space from the chat.

## 2. The phone shows Review Packages
**Decision:** A Review Package opens on the phone wherever its card appears in a chat, a forwarded one in the Orchestrator's chat included, with its screenshots, walkthrough video and findings.
**Why:** It is the evidence the human accepts work from. Its pictures and video already come from runcastle's own address, so they reach the phone over the private link.

## 3. Plan and Tickets are read-only on the phone
**Decision:** Each chat has a "…" menu that opens the Plan and the Tickets to read, full screen. A chat's notices open those same views.
**Why:** The plan is usually what the human says yes to, so an agent's summary of it is not enough. Reading needs no new behaviour.

## 4. The phone has no Merge button, and drives stay off it
**Decision:** To accept work, the human tells the Orchestrator in chat. Test drive, Details, Settings and terminals are not on the phone. A feature waiting on a drive says so in its chat, and a notice that opens a drive is hidden.
**Why:** The Orchestrator can already merge when asked, so a button would add a second way to do it. A drive needs a desktop.

## 5. Designs are live on the phone, built last
**Decision:** The phone opens a feature's real design page, tappable and updating as the agent changes it. Runcastle passes it through on one extra private port. Select area stays desktop-only: on the phone the human describes the change or attaches a screenshot. This replaces the brief's "design mode stays off the phone".
**Why:** The human judges visual work by looking, and a tested design server refuses a Tailscale address directly, so it needs passing through. Pictures in chat would lose tapping and depend on the agent having a browser. Built last, so it can split into its own backlog feature, with pictures in chat as the stopgap, without holding up the phone view.

## 6. The phone link is turned on from Settings
**Decision:** Settings gains an "On your phone" section. It checks for Tailscale, turns the private link on and off with a button that runs `tailscale serve`, and shows the link with a QR code to scan. When the button cannot run the commands, it shows them for the human to run. The link uses its own port, so it never takes over the machine's plain Tailscale address. Runcastle only ever uses `tailscale serve`, never Funnel, so the link stays inside the human's own Tailscale network.
**Why:** The link is long and has to reach a phone, and the setup repeats on the VPS, so a README section would be typed by hand each time. The human wants setup streamlined. The QR code costs one small library.

## 7. The phone creates chats and notes, and the Orchestrator does the rest
**Decision:** The list's "+" holds New chat and Jot a note. A thread's own New thread sits in the chat's thread sheet. To add to the backlog or start a feature from the phone, the human asks the Orchestrator in chat.
**Why:** Those are the two things worth doing with a thumb. The Orchestrator already does the others, so no form needs to fit a phone.

## 8. The phone view as designed in `apps/web/preview/phone.html` is approved
**Decision:** The human approved the preview on 2026-11-01, with these details: Enter starts a new line and the Send button sends; keyboard hints go; the model and effort pickers stay and hide while the agent works; the project switcher stays; runcastle can be added to the home screen; tapping a chat's title switches threads; a warning on the list says when the computer cannot be reached.
**Why:** This is the design checkpoint the brief asks for. The human steers visual work by looking at it.

## 9. A fresh open with the computer off shows the browser's own error
**Decision:** The "Can't reach your computer" warning only shows while the app is already open. This feature adds no service worker.
**Why:** Showing a page with the computer off needs a service worker, a background script the browser keeps. "Agents can notify your phone" has to add one anyway, and can cover this then.

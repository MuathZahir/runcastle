# Agents can notify your phone

## Problem

Without notifications the human has to keep opening the app to see whether anything needs them, and "show me screenshots when it's done" never reaches them. They do not want runcastle pinging them on its own: features an orchestrator runs should stay quiet unless that orchestrator judges they are needed, and a chat they are in the middle of should not ping at all.

## Approach

### What the human sees

On the phone, the feature list ends with a **Notifications** row and an On/Off switch. Switching it on asks the browser's permission and sends a test notification. From then on, when an agent decides the human is needed, a notification arrives on the phone: the title says where it came from (the feature's or the thread's name) and the body is one sentence from the agent. Tapping it opens the chat that sent it. If the phone cannot reach runcastle at that moment, it shows a "can't reach your computer" page rather than the browser's error.

It works for anyone running runcastle with the phone link on, with no account, paid service or extra app.

### The tool

`notify_human({ message })`: one sentence, 200 characters at most. A longer message is refused so the agent rewrites it, rather than being cut off.

Who gets it and who is refused:

| Caller | Result |
|---|---|
| A project session (an orchestrator thread) that is still open | Always allowed |
| A feature's main chat, no thread holds the feature | Allowed |
| A feature's main chat, a thread holds the feature | Refused, naming the holder; the agent says so in the chat |
| Side threads, workers, review workers, every other session kind | Not offered |

The tool's answer says how many phones it reached. With no phone set up it succeeds with zero and tells the agent to say in the chat where to turn notifications on (the phone's list, with the phone link on). A send that fails for every phone says so, and the agent tells the human in the chat.

The server fills in everything but the sentence. The title is the feature's title, or the thread's name as the thread list shows it (the holding service's `holderName`). The tap address is the chat that sent it: the feature's chat address, or the project's chat address, each carrying the sending session in the existing `?thread=` query.

When to call it lives in the tool's description and the feature and project skills: when the human asked to be told, or when the agent needs them and they seem to have left; never during a back-and-forth; never put secrets or credentials in the text. No server rule looks at when the human last typed.

### Delivery

Standard Web Push with VAPID, sent with the `web-push` library. Under Bun it sent a real encrypted request to a local HTTPS stand-in, and a 410 came back as a status. New server service (push):

- **Keys:** a VAPID key pair made once per install and stored in the database, so it travels with the subscriptions when runcastle moves machines. Subject: `https://runcastle.dev` (Apple's push service refuses a localhost subject).
- **Subscriptions:** one table, keyed by endpoint, holding the browser's encryption keys and when it was added. It is per install, not per project.
- **Send:** to every subscription, in parallel, with a 10-second limit of its own (`web-push`'s timeout misses a stalled connection), a 24-hour time to live and `high` urgency so a sleeping Android phone wakes. A 404 or 410 from the push service removes that subscription. Other failures are reported to the caller and keep the subscription.
- **Payload:** `{ title, body, url }`.

A tRPC router exposes the public key, subscribe (which sends the test notification) and unsubscribe. Subscribing and unsubscribing emit a project event, and a send emits `notification.sent` on the feature's timeline, or the project's for an orchestrator thread with no feature. That line is the only record: no inbox, no history. These events are not news, so they never reach a thread.

### The phone

A plain service worker, served from the root of the app with no caching of its own, registered wherever the page is open over HTTPS, which here means the phone link:

- On `push` it shows the notification.
- On `notificationclick` it focuses an open runcastle window and navigates it to the address, or opens a new one.
- On a page navigation it goes to the network, and on failure answers with a small inline "can't reach your computer" page with a Try again button. It does the same for a 502, 503 or 504, which is what Tailscale answers while the machine is up and runcastle is not. It touches no other request.

The row has five states: off, on, blocked (says how to allow it in the phone's settings), needs the Home Screen (iPhone in Safari, says how to add it), and unsupported (this browser cannot do it, or the page was not opened over the phone link). Whether this phone is on is read from the browser's own push subscription, not from the server.

Desktop Settings' "On your phone" section gains one line pointing at the row. The tab-based desktop notifications (`useDesktopNotifications`) are a separate thing and do not change.

### How the human tries it

The cut's working agreement stops this feature before merge until a real notification reaches the human's actual phone. Live sessions run the published install, so the branch's code is tried from a drive: the drive's own app turns the phone link on for its port from Settings, the human scans the code on their Android phone, and switches the row on. The test notification proves delivery. Asking the drive's Orchestrator to notify them proves the tool and the tap.

## Seams

- **The MCP tool** (existing seam, new tool): call `notify_human` as each session kind, on held and unheld features, and observe the refusal, or what reached a fake push sender. The tool-audience map and `requireHold`'s holder field already exist.
- **The push service, with an injected sender** (new, the same pattern as `phone-link`'s injected exec): observe the payload, the send options, a 410 removing a subscription, a 500 keeping it, and zero subscriptions. One real-format test checks a generated request is encrypted.
- **The tRPC router** (new, existing pattern): subscribe, unsubscribe, and the test notification.
- **The Notifications row** (new, tier 2 component tests through the phone-width helper): each of the five states, driven by a fake `PushManager` and `Notification`.
- **The service worker** (new): its `push`, `notificationclick` and navigation handlers are plain functions tested with fake events.
- **The real phone**: the human's checkpoint. Nothing else covers real delivery.

## Out of scope

- A notification centre, history, per-project or per-feature settings, or a test button beyond the one sent when turning on.
- Automatic rules: runcastle's news lines never become notifications.
- Images in a notification.
- A limit on how many an agent may send.
- Notifications without the phone link: a phone needs HTTPS to subscribe.
- Changing the desktop tab notifications, or the phone view and private link themselves.
- Publishing a release, which needs the human's yes.

## Open questions

- iPhone is built to the standard but untried. One vendor's page says web push is missing in the EU; Apple's 2024 reversal kept Home Screen apps there, and this could not be confirmed either way. The human is on Android, so it stays open until an iPhone user tries it.

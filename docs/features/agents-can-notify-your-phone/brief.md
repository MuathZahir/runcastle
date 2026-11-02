## Purpose

Without notifications the human has to keep opening the app, and "show me screenshots when it's done" never reaches them. The human agreed, with one correction: "I don't think it should be automatic. Should probably be a tool too. Since some features might be managed by the orchestrator, the user shouldn't be notified for these. While other features that the user is actively working on shouldn't."

## Understood (agreed with the human)

- It is a tool an agent calls, never an automatic event. Runcastle's news lines do not become notifications.
- Who may call it follows "Threads hold features":
  - a feature held by an orchestrator thread: only that orchestrator notifies the human, because it knows whether something really needs them;
  - a feature the human runs themselves: its own agent may notify them.
- The accepted risk: if an agent doesn't call the tool, the human hears nothing. The human chose this over automatic notifications. Do not add automatic fallbacks.

## Must not swallow

- A notification centre, history or settings beyond what the job needs.
- Automatic rules, or notifying on every wait, ready or failure.
- The phone view itself or the private link ("Runcastle on your phone").
- Keeping an inbox of what the human has seen.

## Open

- How the notification reaches the phone. Browser push needs HTTPS and an installed app on iPhone, and goes through Apple's or Google's push service, so the message text leaves the private network. Decide what the text may contain. A small relay such as a third-party push service is the alternative; compare costs and what it exposes. Check current docs rather than memory.
- What tapping it opens: the thread that sent it, presumably.
- Whether a feature agent should skip notifying when the human typed in that chat moments ago, since the human doesn't want pings for what they're actively working on.
- How the tool is limited to the callers above, and how an agent's skill guidance says when to use it.

## Ordering

Last in this cut. Starts by itself after both "Threads hold features" and "Runcastle on your phone" have merged.

## Working agreement

Agreed with the human for this whole cut (Threads hold features, Agents show files in chat, Review keeps its screenshots, Runcastle on your phone, Agents can notify your phone):

Checkpoints:
1. The human approves the phone view's design before "Runcastle on your phone" builds.
2. The human tries the finished phone link on their actual phone before "Runcastle on your phone" merges.
3. The human receives a real notification on their actual phone before this feature merges. Stop here and say how to try it.

Everything else is carried through to merged by the orchestrator without stopping. Publishing a release needs the human's yes.

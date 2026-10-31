# ADR-0016: Orchestrator threads hold features

- **Status:** accepted (2026-10-31)
- **Deciders:** Muath + project session
- **Amends:** decisions 2 and 3 of `docs/features/one-orchestrator-no-mode/decisions.md`
  (no ownership list; the orchestrator follows what any orchestrator acted on)
  and narrows its decision 15 (the app shows no list of what is followed)

## Context

`one-orchestrator-no-mode` treated the orchestrator as one actor: which features
it followed was read from event stamps, and each stamp said an orchestrator had
acted, never which thread. That stopped being true once the human ran several
orchestrator threads at once.

All news went to the project's newest thread. Opening a new chat took the news
away from the thread doing the work. On 2026-10-31 a new thread received news
about features another thread was running and gave one of them its go-ahead,
while the thread running them never heard the news.

## Decision

1. **One holder per feature.** A feature row names the thread that holds it, or
   nothing. That field is the only answer to who hears about a feature and who
   may act on it.

2. **Creating or first acting on a feature holds it.** Reads never hold.

3. **News goes only to the holder**, even when a newer thread exists, and is
   never rerouted to another thread when delivery fails.

4. **A non-holder is refused, not warned.** Every tool that changes a feature
   follows this rule, and the refusal names the holder. A warning relies on the
   agent listening, which is the slip that caused this.

5. **Taking is explicit.** `take_feature` makes the caller the holder of any
   unshipped feature, and the thread that lost it is told. A thread takes a
   feature only when the human asked for that action on that feature, never on a
   working agreement or its own judgement. That rule lives in the project skill;
   the server does not check it.

6. **Holding binds threads, never the human.** The human's buttons and a
   feature's own agent ignore it. A feature with no holder is the human's.

7. **Delivery is runcastle's own**, not a runtime's agent-to-agent messaging,
   which reaches only live sessions and may not exist for every runtime.

## Consequences

- `one-orchestrator-no-mode`'s `decisions.md` is left as written. This ADR is
  where the change lives.
- The "Since you were last live" briefing is gone: only a brand-new thread read
  it, and a brand-new thread holds nothing.
- Threads see holders in their portfolio reads. The human sees holds and takes
  on the feature's timeline only, with no "Held by" line in the app.
- Features in flight when this shipped are placed once, on first boot, by
  matching event times to thread logs. The match has no fallback, so a feature
  it can't place stays unheld and its timeline says so. A wrong match is fixed
  with `take_feature`.
- Notifying the human follows holding: on a held feature only its orchestrator
  may notify them.

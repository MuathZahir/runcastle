# Outcome — A usage limit never strands work

Whatever way a usage limit stops a turn, the chat is held and carries on once the limit has really reset.

- Shipped: 2026-11-21

## What shipped

8 commits · 18 files

## Review record

### Review · gates review

- Outcome: handed-back

- **Any short tool output like "API rate limit reached" holds a healthy chat and blocks runcastle prompts to every chat on that account** (defect, high) — fixed: c47a4684: the notice rule now matches only "You've hit/reached your … limit" and "(Claude AI) usage limit reached"; the generic "limit reached" alternative is gone (core negatives added for API rate / context / max turns). turnSaysLimit only reads the output of sub-agent calls (kind think, or calls others nest under). Host test: a Bash call printing GitHub's rate limit and one printing the notice itself leave the chat alone (fails on the old host).
- **The host now writes the session row directly, with no event, outside the session helpers** (observation, low) — open
- **The "tries again every 5 minutes" notice is hard-coded, while the retry delay can be changed** (observation, low) — open
- **A wake whose usage read fails can leave the chat held with no timer, stranded until a restart** (defect, high) — fixed: c47a4684: prompt()'s hold path arms a wake whenever the chat has no timer (keeping the row's told flag), so a wake whose read failed behind the account's mark is armed for the mark. Host test reproduces the reviewer's two-chat sequence; fails on the old host.
- **A turn the agent starts by itself runs fine but does not drop the hold, so a stale wake later sends a needless "carry on"** (defect, medium) — fixed: c47a4684: a self-started turn that ends normally drops the hold when nothing is held in fork.json, or fires the wake at once when runcastle messages were held (so they are still said). Host test: held chat, self turn runs, row cleared and no reset line sent; fails on the old host.

### Review: verify · gates review, verify

- Outcome: dropped
- Verified fix commits: c47a4684 fix(threads): only the account's own limit notice holds a chat

- **Notice rule fix over-narrowed: "Claude usage limit reached. …" and "5-hour usage limit reached" no longer count** (defect, medium) — fixed: e23f0636: the rule takes up to 30 characters of words before "usage limit reached" again; the generic "limit reached" stays out. Core tests: "Claude usage limit reached. Your limit will reset at 7pm." and "5-hour usage limit reached" match; API rate / context / max-turns still do not. Typecheck and core + agent-host tests green.

### Review: verify · gates review, verify

- Outcome: dropped
- Verified fix commits: e23f0636 fix(core): a short prefix before "usage limit reached" still counts

- **Notice rule's free 30-char prefix holds a chat on a normal reply that mentions "usage limit reached" near its start** (defect, low) — fixed: ebcc6d64: the prefix before "usage limit reached" is now only (Claude | Claude AI)? then (N-hour | weekly | opus | sonnet)?. "The usage limit reached notice now holds the chat." returns false (new test); "Usage limit reached", "Claude usage limit reached. …", "5-hour usage limit reached", "Claude AI usage limit reached|…" still match. Core + agent-host tests (102) and typecheck green.

## Notes record

- No human notes

## Workers

- Review (review) — handed-back · tokens not counted
- Review: verify (review) — dropped · 441686 tokens
- Review: verify (review) — dropped · 282983 tokens

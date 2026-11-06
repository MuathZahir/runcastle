# Outcome — Workers: prototype an agent you can enter inside a sandbox

Prove that one agent can run as a runcastle thread inside a burn sandbox: the human opens it from the app, types to it, sees its dev server in the browser, and it hands back to its lead.

- Shipped: 2026-11-06

## What shipped

9 commits · 17 files

- 0 tickets landed
- 0 waived
- 0 failed

## Review record

### Ticket 1 · review

- Reviewed commit: 44bb63357c8c2d6d07791b3cbbdf12068e1e567a
- Landed since: 0
- Outcome: done

- **Test gate died with exit 143 (SIGTERM) about 33 s in, before the worker tests or most of the suite reported** — dismissed
- **report.md says sandbox isolation is "strong", but the agent can write the host repo's .git hooks/config and reach host services on the bridge** — fixed
- **A stopped worker's port is handed to the next worker, so the first one cannot wake** — fixed
- **report.md says the preview "came back 42 ms after the wake", but the harness starts that clock only after a full reply turn** — fixed
- **report.md's live-vs-handoff comparison sets a stopped-container wake against a handoff on a running container** — fixed
- **If reloading a worker's conversation fails, the thread quietly starts a new one, because the "still on disk" guard looks at the host disk** — dismissed
- **start_dev_server's "listens on localhost only" hint checks 127.0.0.1 only, so a dev server on ::1 gets "nothing answered"** — fixed
- **Smaller report.md numbers can't be traced: the handback size label, the host wake row, the app-run figures, and no raw results committed** — open
- **The experimentalWorkers setting is read in two places: the tool list reads the file, the rest reads the loaded config** — open
- **Standards nits for whatever survives checkpoint 1: missing events, a duplicated token reader, untested branches** — open

## Notes record

- No human notes

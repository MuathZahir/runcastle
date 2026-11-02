## Purpose

The human is moving runcastle from a Windows PC to a Linux VPS so work continues with the PC off, and asked to move all of their data. The VPS becomes runcastle's only home: two machines cannot share one database. Without this tool they keep their repos but lose the feature list, chat history, notes and unfinished work.

## Understood

Measured on the PC on 2026-10-30:
- Database `~/.runcastle/runcastle.db`, 72 MB. Windows paths sit in `projects.repo_path` (8), `sessions.worktree_path` (438) and `sessions.transcript_path` (427). `projects` also holds Windows-specific commands: `db_reset_command`, `drive_setup_command`, `drive_instructions`.
- Free text also contains Windows paths (events: 3,851 messages and 2,867 data rows; tickets, review findings, notes). That is history, not something the app acts on.
- Chat transcripts: `~/.claude/projects`, 1.4 GB, in folders named after the Windows path, so resume on Linux fails unless they are renamed.
- `~/.runcastle`: worktrees 3.3 GB (rebuildable from branches, if all their work is committed), reviews 0.84 GB, sessions 0.21 GB, plus stories, annotations and notes screenshots.
- There is no export command today. The CLI has only `serve`, `doctor`, `version` and `help`.
- Secrets and machine-specific setup do not travel: `~/.runcastle/.env`, each project's untracked `.env` files, and logins.
- The running database is in WAL mode, so a plain file copy is not safe.

The VPS: Contabo Ubuntu 24.04, user `muath`, UID 1001, reached over Tailscale. Runcastle 1.6.0 is installed there with a throwaway trial project, `runcastle-trial`, which can be deleted.

Before the real move the human must get these onto a remote: `jewellery-system` and `jev-browser-extension` have no remote at all (352 and 104 unpushed commits; jev also has 44 uncommitted files); `exam-forge` has 21 uncommitted files; `JanaLearn_Updated` has 46 unpushed commits and its remote belongs to `Adel2002`, so check where they should go. This is not code work, but the tool should refuse or warn clearly when a project's work is not reachable from the destination.

## Open

- How a project's repo and its features reach the destination, and what happens to a feature that was mid-round or has a live session.
- Whether drive commands are rewritten or the project is re-prepared with `/runcastle:prepare` on the destination. The runcastle project's reset command is `cmd` syntax, so rewriting paths alone is not enough.
- Whether the tool is a general export/import or a one-off. The human said to move "all of the data"; keep it as small as that job allows. Solo scale, one machine at a time.
- Whether free-text history is left alone (lean: yes).
- Dry run: show what would change before touching anything. The source must stay untouched, so a failed move loses nothing.

## Must not swallow

- Keeping two machines in sync. It is a one-way move.
- Backups, the VPS itself, or the installer.
- Rewriting history text.

## Ordering

Waits on "Burns work for any Linux user": real projects cannot burn on the VPS until that lands. It must run before the human starts real work on the VPS, or the two databases drift apart.

## Working agreement

Checkpoints the human named, for this whole cut (Burns work for any Linux user, Move runcastle to another machine, No Node, Burns build their own image, One-line install):
1. After "Burns work for any Linux user": the human runs a real burn on the VPS.
2. Before the move: this feature handles the human's real data. Stop before merging it, and run nothing against real data until the human says so.
Everything else is carried through to merged without stopping. Publishing a release needs the human's yes.

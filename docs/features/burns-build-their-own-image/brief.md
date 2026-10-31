## Purpose

Part of making setup streamlined. Today a burn with no image stops and tells the human to click "Build image" (`workflows/burn-cache-probe.ts`). On a headless server that means reaching the app in a browser, or reading source: the VPS setup agent hand-copied the build's labels and args to get an image at all.

## Understood

- The app already has the build: `planImageBuild` in `services/sandbox-image.ts`, used by the "Build image" button through `trpc/routers/setup.ts`. Reuse it; do not write a second build path.
- `ticket-burner.ts` says "Burns never build". That rule is the thing being changed, for the missing-image case at least. An earlier decision kept builds as actions a human watches (`docs/features/sandbox-agent-clis-track-the-host-version/decisions.md` §5) and a shipped feature argued the same trade-off (`burns-rebuild-a-drifted-sandbox-image-themselves`). Read what that feature actually decided before cutting this, since the code still says burns never build.
- The README's `sandcastle docker build-image` is wrong: no such command is installed, and "nothing builds it for you" is false. Doctor's fix text already names the button. Correct the README.
- The VPS report asked for a `runcastle build-image` command. The one-line install needs some way to build without the app, so decide whether a small command is the simplest way to share that.

## Open

- Whether a burn also rebuilds a drifted image, or only a missing one (it runs on a drifted image today, with a warning).
- How the wait shows on the burn page, and how a failed build reports.
- Two burns finding the image missing at once must not both build it.

## Must not swallow

- The one-line install, token setup and service setup.
- Project-owned image design.

## Ordering

Waits on "Burns work for any Linux user" because both touch the image's user and group handling and doctor. The One-line install waits on this one.

## Working agreement

Checkpoints the human named, for this whole cut (Burns work for any Linux user, Move runcastle to another machine, No Node, Burns build their own image, One-line install):
1. After "Burns work for any Linux user": the human runs a real burn on the VPS.
2. Before the move: it handles the human's real data.
This feature has no checkpoint of its own: it is carried through to merged without stopping. Publishing a release needs the human's yes.

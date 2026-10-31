# 18. Burns build an image they cannot run without

Status: accepted, 2026-10-31

## Context

"Burns never build" was decided twice. `sandbox-agent-clis-track-the-host-version`
decision 5 kept builds as actions a human watches. `burns-rebuild-a-drifted-sandbox-image-themselves`
decision 2 designed auto-rebuild in full, then chose a warning, because a drifted
image can still run and rebuilding it saved one click for a lot of orchestration.
That feature promised an ADR that was never written, so this one records both.

Neither looked at a server with no browser. There, a burn with no image has no
click to make: the VPS setup agent copied the build's labels and args out of the
source to get an image at all.

## Decision

A burn builds a runcastle-managed image when it could not otherwise do its job,
before any ticket starts:

- the image is not on the machine, including a project's Dockerfile never built;
- it was built for another UID, so it cannot start;
- it is a project image whose repo Dockerfile has changed.

Everything else stands. An image that can run is not rebuilt because it drifted:
agent CLI drift and a changed stock Dockerfile remain warnings or nothing. The one
replacement of a drifted stock image is as the base of a project build. Custom
images are never built. A failed build ends the run before any ticket, and a
project image that will not build never falls back to the stock one.

## Consequences

- A first burn takes minutes longer, with no click and no command.
- A repo carrying a broken Dockerfile nobody ever built goes from running silently
  on the stock image to a failed run.
- The server runs one image build at a time, whoever asked for it.
  `runcastle build-image` stays outside that queue: two builds of one tag waste
  time but cannot corrupt anything.
- The doctor no longer reports a missing managed image as a problem.

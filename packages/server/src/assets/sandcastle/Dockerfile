# Generic runcastle AFK burner image — Bun + Node + git toolchain for unattended agents.
# runcastle scaffolds this into a build context on demand (issue #50); nothing
# runcastle-specific is baked in — per-project deps install at sandbox start via the
# project's own .sandcastle config. Generalized from this repo's dogfood .sandcastle
# Dockerfile. Both `docker build` and `podman build` use the enclosing dir as the
# build context; the image tag is passed by the caller (--image-name), never derived.
FROM node:22-bookworm

# Toolchain: git (worktrees/commits), curl (installers), jq, plus common unpack deps.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git curl ca-certificates jq unzip \
  && rm -rf /var/lib/apt/lists/*

# Bun (the agent toolchain default) — installed system-wide before the user switch.
ENV BUN_INSTALL=/usr/local
RUN curl -fsSL https://bun.sh/install | bash

# Codex CLI (the second agent runtime) — authenticated at runtime via CODEX_API_KEY.
# Installed as root, before the user switch, so it lands in the system-wide npm
# prefix: after `USER` a global install has nowhere writable to go.
RUN npm install -g @openai/codex

# Rootless-podman invariant (research #32): the in-container agent user MUST be at
# UID/GID 1000 so bind-mounted host files share an owner. Sandcastle passes the host
# uid/gid as build args (defaulting here to 1000); rename the stock `node` user to match.
ARG AGENT_UID=1000
ARG AGENT_GID=1000
RUN groupmod -o -g "$AGENT_GID" node \
  && usermod -o -u "$AGENT_UID" -g "$AGENT_GID" -d /home/agent -m -l agent node
USER ${AGENT_UID}:${AGENT_GID}

# Claude Code CLI (the other agent runtime) — authenticated at runtime via
# CLAUDE_CODE_OAUTH_TOKEN. Installed per-user, so it must follow the switch.
# One image serves both runtimes: which CLI a burn invokes is decided by the
# resolved model's runtime, not by the image.
RUN curl -fsSL https://claude.ai/install.sh | bash
ENV PATH="/home/agent/.local/bin:$PATH"

# Sandcastle bind-mounts the git worktree here and runs the agent in it.
WORKDIR /home/agent/workspace
ENTRYPOINT ["sleep", "infinity"]

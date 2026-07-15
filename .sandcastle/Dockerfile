# AFK worker image: Node + git + gh + jq + Claude Code CLI + Playwright(chromium) + skill-pack.
# Generic across projects — per-project deps install at sandbox start via afk.config.json "setup".
FROM node:22-bookworm

# System deps: jq (verdict parsing), ffmpeg (stitches verifier screenshots into the demo GIF)
RUN apt-get update && apt-get install -y git curl jq ffmpeg \
  && rm -rf /var/lib/apt/lists/*

# Docker CLI + compose plugin — the Verifier runs `docker compose up/down` against the host daemon
# (the host socket is bind-mounted at verify time). Client only; no daemon runs in the container.
RUN install -m 0755 -d /etc/apt/keyrings \
  && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
  && chmod a+r /etc/apt/keyrings/docker.asc \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" \
    > /etc/apt/sources.list.d/docker.list \
  && apt-get update && apt-get install -y docker-ce-cli docker-compose-plugin \
  && rm -rf /var/lib/apt/lists/*

# GitHub CLI (used by skills that read docs/issues if you grant it)
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && apt-get update && apt-get install -y gh \
  && rm -rf /var/lib/apt/lists/*

# Playwright + chromium with OS deps (root, before user switch). Pin to match your project's @playwright/test.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx --yes playwright@1.50 install --with-deps chromium

# expect MCP server (browser-driving + screenshots), installed globally as root.
RUN npm install -g expect-cli@latest

# Align container user to the host user so bind-mounted files share an owner (sandcastle convention).
ARG AGENT_UID=1000
ARG AGENT_GID=1000
RUN groupmod -o -g $AGENT_GID node && usermod -o -u $AGENT_UID -g $AGENT_GID -d /home/agent -m -l agent node
USER ${AGENT_UID}:${AGENT_GID}

# Claude Code CLI (the agent runtime). Authenticated at runtime via CLAUDE_CODE_OAUTH_TOKEN.
RUN curl -fsSL https://claude.ai/install.sh | bash
ENV PATH="/home/agent/.local/bin:$PATH"

# Register expect as a user-scope MCP server so the headless worker has mcp__expect__* tools.
# expect reuses the chromium installed above via PLAYWRIGHT_BROWSERS_PATH.
RUN printf '{ "mcpServers": { "expect": { "command": "expect-mcp" } } }\n' > /home/agent/.claude.json

# Skill-pack — the skills the worker self-selects from (baked at build by `afk init`).
COPY --chown=${AGENT_UID}:${AGENT_GID} skills/ /home/agent/.claude/skills/

# Sandcastle bind-mounts the git worktree at /home/agent/workspace and runs there.
WORKDIR /home/agent/workspace
ENTRYPOINT ["sleep", "infinity"]

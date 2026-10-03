# A fresh glibc Linux box set up exactly as the README's prerequisites say —
# Bun from its official installer, Node 22+, git — and nothing else: no compiler,
# no claude, no docker. The smoke (smoke.ts) then installs runcastle into it.
#
# Built and run by scripts/platform-smoke/run.ts; the build context is a temp dir
# holding this file, smoke.ts and (local mode) runcastle.tgz.
ARG BASE=ubuntu:24.04
FROM ${BASE}

ARG BUN_VERSION=1.3.14
ARG NODE_MAJOR=22

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl unzip git xz-utils \
 && rm -rf /var/lib/apt/lists/*

# Node from nodejs.org: distro packages lag behind the 22+ floor.
RUN set -eu; \
    case "$(dpkg --print-architecture)" in amd64) a=x64 ;; arm64) a=arm64 ;; *) echo "unsupported arch"; exit 1 ;; esac; \
    base="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"; \
    file="$(curl -fsSL "$base/SHASUMS256.txt" | awk "/linux-$a\\.tar\\.xz\$/ {print \$2}")"; \
    curl -fsSL "$base/$file" | tar -xJ -C /usr/local --strip-components=1; \
    node --version

# A normal user: `bun add -g` lands in ~/.bun, as it does for a real one.
RUN useradd -m tester
USER tester
WORKDIR /home/tester
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}"
ENV PATH=/home/tester/.bun/bin:$PATH \
    RUNCASTLE_SMOKE_DISPOSABLE=1

COPY --chown=tester . /smoke/
CMD ["bun", "/smoke/smoke.ts"]

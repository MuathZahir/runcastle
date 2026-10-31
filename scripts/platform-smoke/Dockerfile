# A fresh glibc Linux box set up exactly as the README's prerequisites say —
# Bun from its official installer, git — and nothing else: no Node, no compiler,
# no claude, no docker. The smoke (smoke.ts) then installs runcastle into it.
#
# Built and run by scripts/platform-smoke/run.ts; the build context is a temp dir
# holding this file, smoke.ts and (local mode) runcastle.tgz.
ARG BASE=ubuntu:24.04
FROM ${BASE}

ARG BUN_VERSION=1.3.14

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl unzip git \
 && rm -rf /var/lib/apt/lists/*

# A normal user: `bun add -g` lands in ~/.bun, as it does for a real one.
RUN useradd -m tester
USER tester
WORKDIR /home/tester
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}"
ENV PATH=/home/tester/.bun/bin:$PATH \
    RUNCASTLE_SMOKE_DISPOSABLE=1

COPY --chown=tester . /smoke/
CMD ["bun", "/smoke/smoke.ts"]

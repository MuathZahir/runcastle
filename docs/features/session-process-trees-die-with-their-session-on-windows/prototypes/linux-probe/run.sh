#!/usr/bin/env bash
# Runs inside the container with the repo at /repo. Builds node-pty, then both scenarios.
set -u
cd /repo && bun install >/dev/null 2>&1 || { echo "bun install failed"; exit 1; }
# Native node-pty under Bun hangs up on Linux (the PTY exits with SIGHUP right
# after its first output), so drive the pty-host sidecar the way win32 does.
export RUNCASTLE_PTY_BACKEND=sidecar
mkdir -p packages/server/probe && cp /probe/* packages/server/probe/
cd packages/server/probe

echo "===== A: session end ====="
bun session-end.ts 2>&1 | grep -v '^\[pty-teardown\]'

for mode in stay exit setsid; do
  echo "===== B: server kill -9 (mcp mode=$mode) ====="
  bun crash-server.ts "$mode" & SPID=$!
  sleep 3
  echo "-- before kill:"; ps -eo pid,ppid,pgid,sid,args | grep -E "fake-mcp|claude-stub|crash-server|pty-host" | grep -v grep
  kill -9 "$SPID"; sleep 3
  echo "-- 3s after kill -9, leftover processes:"
  ps -eo pid,ppid,pgid,sid,args | grep -E "fake-mcp|claude-stub|pty-host" | grep -v grep || echo "(none)"
  echo "-- sockets on :4512 held by leftovers (inode match):"
  INODES=$(awk 'NR>1 && $2 ~ /:11A0$/ {print $10}' /proc/net/tcp | sort -u)
  for i in $INODES; do ls -l /proc/[0-9]*/fd 2>/dev/null | grep -q "socket:\[$i\]" && echo "inode $i held"; done
  echo "-- can a new server bind :4512?"
  timeout 5 bun -e 'const s=Bun.serve({port:4512,hostname:"127.0.0.1",fetch:()=>new Response("x")});console.log("BIND OK");s.stop(true)' 2>&1 | tail -1
  pkill -9 -f fake-mcp; pkill -9 -f claude-stub; pkill -9 -f pty-host; sleep 1
done

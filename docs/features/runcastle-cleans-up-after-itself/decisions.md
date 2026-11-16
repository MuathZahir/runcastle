# Decisions — Runcastle cleans up after itself

Planned with nobody present (2026-11-16). Decisions 1–3 are the human's, from the brief; the rest are assumed.

## 1. Everything runcastle makes is removed once it is no longer needed
**Decision:** Worker containers, sandbox images and their build cache, volumes, drive data folders, worker origins and branches, worktrees and review captures are removed once nothing needs them, including after a crash, a kill, a usage limit, a server restart or a test drive. Nothing runcastle did not create is touched, and nothing that holds work not yet on a branch is removed.
**Why:** On 2026-11-16 runcastle filled the human's disk (96 GB, 192 MB free); about 40 GB of it was runcastle's leftovers. The human: "I don't want runcastle filling people's disks."

## 2. A worker's container goes when its work lands or it is dropped
**Decision:** A worker's container is removed as soon as its work lands or it is dropped, not when the feature merges. Only a handed-back worker, which the human may still open and talk to, keeps its stopped container until the feature merges or the worker is landed or dropped. A landed or dropped worker's conversation stays readable without its container.
**Why:** Two landed workers of one open feature held 3.7 and 4.5 GB each. The human: "Ok".

## 3. It works for every runcastle user
**Decision:** The cleanup runs in the worker sandbox engine, drives, image builds and the server's start-up sweep, for every runcastle user on any machine: Docker or Podman, on Linux, macOS or Windows.
**Why:** The brief's who and where, settled with the human.

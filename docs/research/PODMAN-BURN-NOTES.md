# Podman rootless burn — de-risking notes

De-risks the "small, well-defined change" premise behind **Podman as a first-class
sandbox** (#26), **before** the wiring is built. Ticket: **Verify a rootless podman
burn end-to-end (SELinux volumes + Windows 10 floor)** (#32).

**Method.** The decision this ticket exists to settle — *does runcastle need
flag-injection plumbing it doesn't own?* — is determined by what
`@ai-hero/sandcastle`'s podman provider actually emits, so the primary evidence is
its **source** (`@ai-hero/sandcastle@0.12.0`, `dist/sandboxes/podman.js` +
`dist/chunk-VOG34SRF.js::formatVolumeMount`), cross-referenced against current
podman docs (`/websites/podman_io_en`) for the Windows questions. An empirical
Fedora rootless burn was **not** run — see [Residual](#residual-empirical-confirmation);
the source determines the decision, the burn only confirms it.

**Bottom line: the "small change" premise HOLDS.** sandcastle's podman provider
already emits every rootless-critical flag by default. runcastle owns no
volume-label / userns plumbing. #26's scoping decision does **not** reopen.

---

## 1. Rootless volume permissions (the sharp case) — RESOLVED, premise holds

The one real risk (#26): rootless podman on SELinux needs `:Z`/`:z` labels or
`--userns=keep-id`, and sandcastle leans on `-v` bind mounts. **Whether sandcastle
emits the correct rootless flags was the unverified crux.** It does.

`podman()` (`dist/sandboxes/podman.js`) defaults, per-container:

| Concern | Default | Emitted flag |
|---|---|---|
| SELinux relabel | `selinuxLabel ?? "z"` | `-v <host>:<sandbox>:z` (adds `ro,z` for read-only mounts) |
| Rootless UID mapping | `userns ?? "keep-id"` | `--userns=keep-id:uid=1000,gid=1000` |
| Container user | `containerUid/Gid ?? 1000` | `--user 1000:1000` |

`formatVolumeMount(mount, selinuxLabel)` builds `hostPath:sandboxPath:z`, joined
into `-v` args (`podman.js:34-36,47`). `usernsArgs` builds
`--userns=keep-id:uid=${containerUid},gid=${containerGid}` (`podman.js:48`).

So on a rootless, SELinux-enforcing host (Fedora), the burn's `-v` bind mounts
carry `:z` relabeling **and** the container runs under a keep-id user namespace
that maps the host UID onto UID 1000 inside the container — **no chown, no
`EACCES`, out of the box.** This is the finding that decides whether "small change"
holds. It holds.

### What runcastle must (and must not) do

- **Must:** select `podman()` as the sandbox provider (wire it into
  `config.sandbox`, today `'docker' | 'noSandbox'` at `packages/core/src/config.ts`).
  That is the whole change. No flag injection, no relabel logic, no userns plumbing —
  sandcastle owns all of it.
- **Must not:** override `selinuxLabel`, `userns`, `containerUid`, or `containerGid`
  away from their defaults. The defaults are load-bearing.
- **Invariant:** the podman image must build the `agent` user at **UID/GID 1000**
  (so `keep-id:uid=1000` and `--user 1000:1000` line up). The scaffolded image does
  exactly this — `.sandcastle/Dockerfile` (and the `Containerfile` sandcastle `init`
  writes for podman): `ARG AGENT_UID=1000 / AGENT_GID=1000`,
  `USER ${AGENT_UID}:${AGENT_GID}`. Consistent by default. If a future
  Containerfile changes the agent UID, `containerUid`/`containerGid` must change in
  lockstep or the keep-id mapping breaks — worth a doctor/README note but not plumbing.

### Caveats worth documenting (not blockers)

- `:z` is the **shared** SELinux label and **relabels the host directory's
  context** in place. Correct for `~/.runcastle` and a target repo, but relabeling a
  very large tree is slow, and it mutates the host label (fine unless the same dir is
  shared with another SELinux-confined service — not our case). `:Z` (private) would
  be wrong here — it would lock the mount to a single container.
- On non-SELinux hosts (Ubuntu without SELinux, Docker Desktop's VM, the podman
  Windows/macOS machine bind path) `:z` is a harmless no-op.

---

## 2. Windows version floor — Windows 10 22H2 is supported

`podman machine` on Windows uses **WSL as the default VM provider, with Hyper-V as
an alternative** (`podman-machine(1)`: *"Windows uses wsl as the default, with hyperv
as another option"*). Neither requires Windows 11:

- **WSL2** backend: available on Windows 10 1903+/2004+; **22H2 (build 19045)** is
  well past the floor.
- **Hyper-V** backend: Windows 10 **Pro/Enterprise/Education** (`podman system
  hyperv-prep` sets up the registry entries + Hyper-V Administrators group).

The "Windows 11 or later" line in podman's getting-started tutorial is
**documentation conservatism** (newer default install path / Podman Desktop + WSLg
convenience), **not a hard floor** for the WSL-backed `podman machine` CLI, which is
all sandcastle drives.

**Document the floor as:** Windows 10 **22H2** with **WSL2 enabled** (or Hyper-V on
Pro+). This resolves the #26 conflict flagged as "⚠️ Unverified in research."

---

## 3. Windows bind-mount sanity — works in the common case, least-certain leg

**The Windows mount model is different from Linux.** Per podman docs
(`podman-run(1)` / `podman-create(1)`): on Windows, *"volumes are mounted from the
remote server, not directly from the client machine."* The `-v` source path is
resolved **inside the podman machine**, not on the Windows host.

sandcastle passes the Windows host path to `-v` **verbatim** — there is **no
`/mnt/c` translation anywhere in the podman provider** (grep of `dist/` for
`/mnt/`, `wsl`, drive-letter handling: none). So the common case relies on the
podman **Windows client's own** path translation for machine-managed mounts, which
maps `C:\Users\me\.runcastle` into the WSL machine's view of the C: drive.

- **Common case — expected to work:** data dir `~/.runcastle` and the target repo
  both on `C:` under the **default** podman WSL machine. The C: drive is auto-mounted
  in the WSL distro; podman's Windows client translates the drive path.
- **The known gotcha (real):** this holds only when the paths are visible to *the
  machine's* distro. A repo living on a **different WSL distro**, a network/UNC path,
  or a drive the machine can't see mounts to an **empty/wrong** directory **silently**
  — the burn runs against nothing rather than erroring.
- **Latent syntactic risk:** the **docker** provider abandoned `-v host:sandbox` for
  `--mount type=bind` specifically because `-v C:\path:...` collides with docker's
  `host:container` colon delimiter on Windows drive letters (sandcastle commit
  c9f8348). **The podman provider still uses `-v`** (`podman.js:47`). Podman's Windows
  client is generally more tolerant of drive-letter paths, but this leg has **not**
  been exercised here and is the single most likely place Windows podman surprises us.
- **Git-pointer fix does apply to podman:** `patchGitMountsForWindows` (worktree
  `.git` gitdir rewrite) runs **upstream in the orchestration layer** before the
  provider's `create`, so the podman provider receives already-corrected git mounts —
  it is not docker-only.

**Verdict:** the common case (data dir + repo on `C:` under the default machine)
should mount, but Windows podman is the **least-certain** leg and wants an empirical
smoke test before the README promises it. Not a blocker for wiring podman; a caveat
for the first-run doctor (#18) and the README.

---

## Flags & setup to document (feeds #26 wiring, #18 doctor, README)

- **Extra setup step vs Docker Desktop (macOS/Windows):**
  `podman machine init && podman machine start`. sandcastle's provider **pre-checks**
  this (`checkPodmanMachine` → `podman machine list --format json`, looks for a
  `Running` machine) and throws a clear *"Podman Machine is not running. Run 'podman
  machine init && podman machine start' first."* The #18 doctor should detect/run this.
- **Image build is not automatic:** the provider only pre-flight-checks
  (`podman image inspect <image>`) and throws *"Image '<name>' not found locally.
  Build it first with 'podman build -t <name> .'"* — never builds. Setup/doctor must
  build the podman image (`podman build -t sandcastle:<repo-dir> .`) before the first
  burn, and rebuild on Containerfile change. Mirrors the docker path.
- **The rootless flags are sandcastle defaults** — runcastle documents that it relies
  on `:z` + `keep-id:uid=1000,gid=1000` and does not override them.

## Does this reopen #26's premise?

**No.** The ticket said: *"If it reveals podman needs plumbing runcastle doesn't own,
that reopens a scoping decision on #26's premise."* It reveals the opposite —
sandcastle already owns the rootless plumbing, so #26's "small, well-defined change"
premise is confirmed sound. Wiring podman is: add it to `config.sandbox`, keep the
provider defaults, ensure the podman image builds the agent user at UID 1000, and
surface the `podman machine` setup step in the doctor.

## Residual: empirical confirmation

Source + docs settle the **decision**. Two empirical confirmations remain — neither
runnable on the machine this ticket was worked from (Windows 11, podman not
installed) — so they are handed off as a precise checklist rather than run:

1. **Rootless Fedora burn (confirms §1).** On a rootless podman install on an
   SELinux-**enforcing** Fedora host:
   - `getenforce` → `Enforcing`.
   - Build the podman image: `podman build -t sandcastle:<repo> .`
   - Run a real sandcastle burn with `sandbox: podman()` (defaults; no option
     overrides) against a throwaway repo.
   - **Expect:** agent reads/writes the bind-mounted worktree with no `EACCES`/`Permission
     denied`; `podman inspect` shows the container command carried `-v …:z`,
     `--userns=keep-id:uid=1000,gid=1000`, `--user 1000:1000`.
   - **Watch for:** any `Permission denied` on the worktree (would mean the label/userns
     defaults are somehow not taking — not expected from the source, but this is the
     confirmation).

2. **Windows smoke test (confirms §3).** On Windows 10 22H2 (or 11) with a running
   default podman WSL machine, run one burn with data dir `~/.runcastle` and a repo on
   `C:`. Confirm the worktree mounts to real content (not an empty dir) and the git
   worktree `.git` pointer resolves inside the container.

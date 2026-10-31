# No Node — decisions

Planned with no human present. Every decision below is assumed until the human
confirms it. The facts they rest on were measured on 2026-10-31 with throwaway
probes kept outside the repo; see `spec.md`, "What was measured".

## 1. Runcastle needs no Node; a Codex installed through npm still does
**Decision:** The promise is that Runcastle itself runs on Bun alone, and that a person who installs their agent the standard way needs no Node. Both agent adapters (`claude-agent-acp`, `codex-acp`, the bridges Runcastle talks to agents through) already run on Bun. A real Claude turn and a real Codex turn (using Codex's native binary) both finished with Node hidden from PATH. The one exception is Codex installed with `npm install -g`, whose `codex` command is a script that calls `node`. We do not work around that; we stop recommending that install.
**Why:** The brief said to confirm this first and to say so plainly if it broke the feature's name. It does not break it: the adapters are clean, and the only Node dependency left belongs to one install route of a third-party tool, which has a standalone replacement.
**Assumed.** Alternative: make npm-installed Codex work with no Node by giving agents a `node` on PATH that is really Bun. That hides a machinery trick in every agent's environment, including the human's own projects.

## 2. Bun's built-in terminal replaces node-pty, with no fallback
**Decision:** The embedded terminal moves to Bun's built-in terminal (`Bun.spawn` with its `terminal` option). node-pty, the Node-hosted helper process that wraps it, and the install check for its native binary are all deleted. There is one backend, and no path that uses Node if Node happens to be there.
**Why:** It passed keystrokes, sign-in-style prompts, 20,000 lines of output, resizing, UTF-8, tree kill and long quiet runs on Windows and Linux. A fallback would keep two backends alive and leave a failure mode that only appears on machines with no Node. Deleting node-pty also removes the native binary, so the C++ toolchain and Alpine build-from-source notes go with it.
**Assumed.** Alternative: keep the Node helper as a fallback for one release, in case Bun's terminal misbehaves on a machine we did not test.

## 3. The minimum Bun version stays at 1.3.14
**Decision:** `engines.bun` and the README stay at 1.3.14. No version bump.
**Why:** The same probes passed on 1.3.14 and 1.4.2 on both Windows and Linux, so raising the floor would make people upgrade for nothing.
**Assumed.** Alternative: raise the floor to 1.4.x so everyone is on the newest terminal code.
**Challenged:** The evidence covers Windows and Linux only, so the minimum is unproven on macOS. The answer stands; decision 13 runs the smoke on 1.3.14 as well as the latest Bun to close that.

## 4. On Windows, Ctrl-C falls back to ending the program
**Decision:** On Windows, Ctrl-C typed into a terminal is passed to the program as today. If the program is still running two seconds later, Runcastle ends its process tree. Linux and macOS behave as they do now.
**Why:** This is the one behaviour Bun's terminal lost. On Windows, Ctrl-C reaches programs in raw mode (the sign-in screens), but a program in normal line mode (a dev server, `docker build`, plain `ping`) never gets interrupted, while node-pty does interrupt it. The brief says this feature must not change how terminals behave, and a single rule in the backend covers it without each terminal having to say what kind it is.
**Assumed.** Alternative: accept the gap, since Stop drive and the terminal's Done button already end those programs.
**Challenged:** Applied everywhere, the rule can kill a healthy raw-mode program that treats Ctrl-C as ordinary input, such as a sign-in screen, which is new behaviour in a feature meant to change none. It would limit the fallback to output-only panes (dev server, design server, image build) with one flag. The answer stands because the programs that run in these terminals exit on Ctrl-C anyway, but this is the closest call in the plan.

## 5. Codex install advice moves to OpenAI's standalone installers
**Decision:** The doctor and the README stop recommending `npm install -g @openai/codex` and name OpenAI's standalone installers instead (`curl -fsSL https://chatgpt.com/codex/install.sh | sh`, and the `install.ps1` equivalent on Windows). When the doctor's Codex check fails because the installed `codex` could not find `node`, its fix says exactly that and points at the standalone installer.
**Why:** Without this, a clean machine is told to install npm to get Codex, which is the setup surprise the feature exists to remove. An npm-installed Codex on a machine that has Node keeps working, so nobody is forced to reinstall.
**Assumed.** Alternative: leave the Codex advice alone and treat it as Codex's business.

## 6. The doctor stops checking for Node
**Decision:** The Node check leaves the doctor, and nothing replaces it. It is an `error`-severity check, the kind that blocks boot today, so with it gone a machine with no Node boots.
**Why:** Bun's terminal ships inside Bun, so there is nothing separate left to be missing. A check that can only ever pass is noise.
**Assumed.** Alternative: keep Node as an informational line in the doctor.

## 7. Contributors keep Node for the test suite; only people running Runcastle lose it
**Decision:** "No Node" is a promise to people who run Runcastle. Working on Runcastle itself still needs Node, because `bun run test` runs vitest on Node. node-pty leaves the dev dependencies too: suites that only need a process to talk to use a small test-only stand-in, and real-terminal behaviour is tested by the existing pattern of a fixture run in a real Bun child process.
**Why:** Moving the whole suite onto Bun is a large separate job with no benefit to anyone installing Runcastle. Keeping node-pty only for tests would mean the suite exercises a terminal that never ships.
**Assumed.** Alternative: keep node-pty as a dev dependency so the terminal tests stay as they are.

## 8. macOS is proven by the platform smoke, with Node hidden, before ready
**Decision:** The platform smoke (the manually run CI workflow that installs Runcastle on clean macOS, Linux and Windows runners) stops installing Node and asserts that `node` is not on PATH, then opens a real terminal through the shipped package. That run must pass on every OS before the feature is declared ready. If macOS fails, the lead stops and tells the human rather than adding a fallback.
**Why:** macOS is the one OS measured by nobody so far, and no machine here can reach it. The smoke is also the only check that would catch a Node dependency nobody remembered.
**Assumed.** Alternative: ship on the Windows and Linux evidence and treat macOS as a known risk.
**Challenged:** Opening a terminal only exercises the terminal path, so the smoke would miss a forgotten Node dependency elsewhere, and it never checks Ctrl-C on macOS. The answer stands; decision 13 adds both.

## 9. A project that needs Node is that project's requirement
**Decision:** Runcastle adds no check for what a project's own commands need. If a project's dev command, an `npx` tool server or a hook needs Node, that shows up as the command's own error in the dev pane. The `prepare` session (the one that works out a project's dev command by running it) finds it at that point.
**Why:** Until now Runcastle's own requirement happened to put Node on every machine. Removing it can move a surprise from the doctor to the first drive on a clean machine with a JavaScript project. But Runcastle works with any language, and guessing from a `package.json` would be wrong for the many projects Bun runs on its own.
**Assumed.** Alternative: a doctor warning when a project looks like it needs Node and none is installed.

## 10. Burn images are not part of this feature
**Decision:** "No Node" covers the machine Runcastle runs on. The burn image keeps whatever it has, Node included. No burn needs Node on the host: nothing in the server or in sandcastle (the burn engine) starts it.
**Why:** The image holds a project's tools, not Runcastle's, and "Burns build their own image" owns it in this same cut. Touching it here would risk the VPS burn checkpoint for no gain.
**Assumed.** Alternative: strip Node from the stock burn image too.

## 11. An agent CLI that needs a missing Node is reported as not ready
**Decision:** If the resolved `claude` or `codex` is a script that needs Node and no Node is on PATH, that runtime counts as not ready, in the doctor and when a chat starts. The message says why and gives that agent's standalone installer. This extends decision 5 to Claude Code, including an npm or `bun add -g` install. It judges only that runtime, so a person who uses only Claude is not blocked by a broken Codex.
**Why:** Without this, the person sees an adapter crash reading "'node' is not recognized". Runcastle's readiness check already exists for exactly this moment (`checkReady`, which runs before a chat launches), and inspecting the file runs nothing.
**Assumed.** Alternative: leave the adapter's raw error as it is and rely on the doctor.

## 12. No Bun version pin; a broken future Bun is handled by the smoke and a README note
**Decision:** Runcastle does not pin or cap Bun. The platform smoke runs before each release, and the README's terminal troubleshooting says how to install a specific older Bun if a new one breaks terminals.
**Why:** With no fallback, a future Bun could break sign-in with no Runcastle release involved. But Runcastle's whole server already depends on Bun in the same way, so a terminal-only guard would protect little, and a version cap would refuse people's working setups.
**Assumed.** Alternative: a doctor warning for Bun versions newer than the last one the smoke passed on.

## 13. The smoke covers the minimum and latest Bun, Ctrl-C, and both adapters
**Decision:** The smoke from decision 8 runs on Bun 1.3.14 and on the latest Bun. With Node hidden, it also interrupts a program with Ctrl-C and starts both agent adapters as far as they go with no login.
**Why:** This makes the minimum version a measured claim on macOS too, and makes "no Node" true of more than the terminal. It adds no new machinery, only steps in an existing check.
**Assumed.** Alternative: the smoke checks only the terminal, on the latest Bun.

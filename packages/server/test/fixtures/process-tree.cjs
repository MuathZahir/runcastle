// A process tree for the stop tests (stopping-a-session-kills-its-process).
//
//   node process-tree.cjs adapter <tag> [--slow] [--stubborn]
//     An adapter stand-in: spawns one child (`child <tag> --resume=<tag>`) that
//     stays in its process group, then idles. `--slow` makes both take 300ms to
//     quit after SIGTERM; `--stubborn` makes the child ignore SIGTERM.
//   node process-tree.cjs orphan <tag>
//     Starts a `child` in its own group and exits at once, so the child is
//     nobody's descendant: a leftover from a dead server, as the start-up clean finds them.
//   node process-tree.cjs child <tag> --resume=<tag> [--slow] [--stubborn]
//     The runtime stand-in (`claude --resume=<id>`): idles.
const { spawn } = require('node:child_process')

const [, script, role, tag, ...rest] = process.argv
const slow = rest.includes('--slow')
const stubborn = rest.includes('--stubborn')

if (role === 'adapter') {
  const flags = [slow ? '--slow' : '', stubborn ? '--stubborn' : ''].filter(Boolean)
  spawn(process.execPath, [script, 'child', tag, `--resume=${tag}`, ...flags], { stdio: 'ignore' })
}
if (role === 'orphan') {
  spawn(process.execPath, [script, 'child', tag, `--resume=${tag}`], { stdio: 'ignore', detached: true }).unref()
  process.exit(0)
}
if (stubborn && role === 'child') process.on('SIGTERM', () => {})
else if (slow) process.on('SIGTERM', () => setTimeout(() => process.exit(0), 300))
setInterval(() => {}, 1 << 30)

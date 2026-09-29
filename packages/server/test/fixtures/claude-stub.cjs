// Stand-in for claude: starts a stdio "MCP server" child the way the MCP SDK
// does (plain spawn, piped stdio; detached only where noted below), then either exits early (orphaning
// it, the Windows failure shape) or stays alive. argv[2]: "exit" | "stay" | "setsid" | "nest"
// Copied from docs/features/session-process-trees-die-with-their-session-on-windows/
// prototypes/linux-probe/claude-stub.cjs. "nest" is added here: a parent that runs
// the "exit" stub and stays alive, so the terminal outlives the orphaning — the
// only shape where a teardown (or a crash) still has an orphan left to reach.
const { spawn } = require('node:child_process')
const mode = process.argv[2] || 'stay'
if (mode === 'nest') {
  spawn(process.execPath, [__filename, 'exit'], { stdio: 'inherit' })
  console.log('nest pid', process.pid)
  setInterval(() => {}, 1e3)
  return
}
// On win32, libuv puts every non-detached child in a kill-on-close job of the
// parent's own, so a plain spawn dies with this stub and no orphan ever exists.
// Real MCP trees (npx → bash → node) do outlive claude.exe, so in "exit" mode the
// stand-in is detached there: it leaves libuv's job but stays in ours, which
// forbids breakaway. Off win32, detached means setsid — only "setsid" wants that.
const detached = mode === 'setsid' || (mode === 'exit' && process.platform === 'win32')
const mcp = spawn('node', ['-e', 'process.title="fake-mcp-' + mode + '";setInterval(()=>{},1e3)'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  detached,
})
console.log('claude-stub pid', process.pid, 'mcp pid', mcp.pid)
if (mode === 'exit' || mode === 'setsid') setTimeout(() => process.exit(0), 800)
else setInterval(() => {}, 1e3)

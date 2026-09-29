// Stand-in for claude: starts a stdio "MCP server" child the way the MCP SDK
// does (plain spawn, piped stdio, no detach), then either exits early (orphaning
// it, the Windows failure shape) or stays alive. argv[2]: "exit" | "stay" | "setsid"
const { spawn } = require('node:child_process')
const mode = process.argv[2] || 'stay'
const mcp = spawn('node', ['-e', 'process.title="fake-mcp-' + mode + '";setInterval(()=>{},1e3)'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  detached: mode === 'setsid',
})
console.log('claude-stub pid', process.pid, 'mcp pid', mcp.pid)
if (mode === 'exit' || mode === 'setsid') setTimeout(() => process.exit(0), 800)
else setInterval(() => {}, 1e3)

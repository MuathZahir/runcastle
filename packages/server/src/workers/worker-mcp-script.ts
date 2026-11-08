/**
 * The worker's own tools (interactive-workers decision 9): a stdio MCP server
 * that runs INSIDE the worker's sandbox, so nothing in the sandbox needs a way
 * out to runcastle. `hand_back` writes the worker's summary to a file the
 * server reads through `docker exec` when the turn ends; `start_dev_server`
 * runs the dev server detached inside the container, on the one port the
 * container publishes. `read_feature`, `show_file` and `park_feature` are
 * answered by runcastle through the tool relay ({@link WORKER_RELAY_SCRIPT}),
 * a socket inside the container that runcastle's own `docker exec` serves.
 *
 * Plain Node, no dependencies: it is written next to the adapter bundle and
 * mounted read-only.
 */
export const WORKER_MCP_SCRIPT = String.raw`#!/usr/bin/env node
'use strict'
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

// Overridable only so a test can run the script outside a sandbox.
const STATE = process.env.RUNCASTLE_WORKER_STATE || '/home/agent/.runcastle'
const REPO = process.env.RUNCASTLE_WORKER_REPO || '/home/agent/repo'
const PORT = Number(process.env.WORKER_PORT || 0)
const PREVIEW = process.env.WORKER_PREVIEW_URL || ''
const SOCKET = process.env.RUNCASTLE_TOOLS_SOCKET || STATE + '/tools.sock'
const SHOW_MAX_BYTES = 100000000
fs.mkdirSync(STATE, { recursive: true })

const TOOLS = [
  {
    name: 'hand_back',
    description:
      'Hand your work back to your lead when the assignment is done (or cannot be done). Give a short summary: what you did, ' +
      'what is left, and any direction the human gave you directly, since your lead never reads this conversation. ' +
      'Commit your work first: your lead receives your commits with the summary. You can still be talked to after.',
    inputSchema: { type: 'object', properties: { summary: { type: 'string', description: 'A short summary for your lead.' } }, required: ['summary'] },
  },
  {
    name: 'start_dev_server',
    description:
      'Start (or restart) the project dev server inside your sandbox so the human can see it in their browser. ' +
      'It must listen on port ' + PORT + ' on all interfaces (0.0.0.0), which the env vars PORT, RUNCASTLE_DESIGN_PORT and HOST say. ' +
      'Omit command to use the design command the project records in .runcastle/design.json. Returns the address the human opens.',
    inputSchema: { type: 'object', properties: { command: { type: 'string', description: 'Shell command, run in ' + REPO + '.' } } },
  },
  {
    name: 'read_feature',
    description:
      "The feature you work on, as it stands now: its state, tickets, designs, docs (brief, decisions, spec) and the lead's latest turns. " +
      'Read it when your assignment leaves you unsure what was decided.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'show_file',
    description:
      'Show the human one file (up to 100 MB) in this chat: a picture or screenshot inline, anything else as a card. ' +
      'Make Markdown and HTML self-contained.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The file. A relative path starts at ' + REPO + '.' },
        caption: { type: 'string', description: 'One line saying what the file shows.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'park_feature',
    description:
      'Park work that belongs in a feature of its own as a draft in the backlog, instead of doing it here. ' +
      'Give a title, a one-line summary and a brief saying what it is and why it was deferred.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        oneLiner: { type: 'string', description: 'One line saying what the feature is.' },
        brief: { type: 'string', description: 'What it is, and why you deferred it.' },
      },
      required: ['title', 'oneLiner', 'brief'],
    },
  },
]

// A Review worker's one more tool (burns-become-workers decision 3): its findings, answered by runcastle.
if (process.env.RUNCASTLE_WORKER_REVIEW === '1') {
  TOOLS.push({
    name: 'report_finding',
    description:
      'Report one typed finding of your review, as you find it. Defects stay open for the feature lead, which decides what each becomes; ' +
      'observations are kept with the review. A defect needs a reproStep.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['defect', 'observation'] },
        severity: { type: 'string', enum: ['high', 'medium', 'low'] },
        title: { type: 'string', description: 'One line, the whole finding in a glance.' },
        location: { type: 'string', description: 'The file and hunk, or the screen and the steps that reach it.' },
        citation: { type: 'string', description: 'The standard and rule, the smell and hunk, the spec line, or the check command.' },
        detail: { type: 'string', description: 'What you did, what happened, what you expected.' },
        reproStep: { type: 'string', description: 'The exact steps or command that shows it: required for a defect.' },
      },
      required: ['kind', 'severity', 'title', 'location', 'citation', 'detail'],
    },
  })
}

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n') }
function text(t, isError) { return { content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) } }

function containerAddress() {
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address
  return '127.0.0.1'
}

function answers(host, port) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port })
    s.setTimeout(1000)
    s.once('connect', () => { s.destroy(); resolve(true) })
    s.once('error', () => resolve(false))
    s.once('timeout', () => { s.destroy(); resolve(false) })
  })
}

function designCommand() {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(REPO, '.runcastle', 'design.json'), 'utf8'))
    return typeof d.command === 'string' ? d.command : undefined
  } catch { return undefined }
}

async function startDev(command) {
  const cmd = command || designCommand()
  if (!cmd) return text('No command given and the project records no design command (.runcastle/design.json). Pass one.', true)
  try {
    const old = JSON.parse(fs.readFileSync(path.join(STATE, 'dev.json'), 'utf8'))
    if (old.pid) try { process.kill(-old.pid, 'SIGTERM') } catch {}
  } catch {}
  const log = fs.openSync(path.join(STATE, 'dev.log'), 'w')
  const env = { ...process.env, PORT: String(PORT), RUNCASTLE_DESIGN_PORT: String(PORT), HOST: '0.0.0.0' }
  const child = spawn('sh', ['-c', cmd], { cwd: REPO, env, detached: true, stdio: ['ignore', log, log] })
  child.unref()
  fs.writeFileSync(path.join(STATE, 'dev.json'), JSON.stringify({ command: cmd, pid: child.pid, at: Date.now() }))
  const started = Date.now()
  const outside = containerAddress()
  while (Date.now() - started < 90000) {
    if (await answers(outside, PORT)) {
      return text('Dev server answering after ' + (Date.now() - started) + 'ms. The human opens it at ' + PREVIEW + ' (say so in your reply). Log: ' + STATE + '/dev.log')
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  const local = (await answers('127.0.0.1', PORT)) || (await answers('::1', PORT))
  const tail = (() => { try { return fs.readFileSync(path.join(STATE, 'dev.log'), 'utf8').slice(-1500) } catch { return '' } })()
  return text(
    (local
      ? 'The server listens on localhost only, which the published port cannot reach: make it listen on 0.0.0.0 (for Vite: --host 0.0.0.0).'
      : 'Nothing answered on port ' + PORT + ' within 90s.') + '\n\nLog tail:\n' + tail,
    true,
  )
}

async function call(name, args) {
  if (name === 'hand_back') {
    const summary = String((args && args.summary) || '').trim()
    if (!summary) return text('A handback needs a summary.', true)
    fs.writeFileSync(path.join(STATE, 'handback.json'), JSON.stringify({ summary, at: Date.now() }))
    return text('Handed back. Runcastle tells your lead when this turn ends, with your summary and commits. End your turn now.')
  }
  if (name === 'start_dev_server') return startDev(args && args.command)
  if (name === 'read_feature') return relay('read_feature', {})
  if (name === 'park_feature') return relay('park_feature', args || {})
  if (name === 'report_finding' && process.env.RUNCASTLE_WORKER_REVIEW === '1') return relay('report_finding', args || {})
  if (name === 'show_file') {
    const given = String((args && args.path) || '')
    if (!given) return text('show_file needs a path.', true)
    let real
    try { real = fs.realpathSync(path.resolve(REPO, given)) } catch { return text('There is no file at ' + path.resolve(REPO, given) + '.', true) }
    const stat = fs.statSync(real)
    if (!stat.isFile()) return text(real + ' is not a file: show_file shows one file, not a folder.', true)
    if (stat.size > SHOW_MAX_BYTES) return text(real + ' is ' + Math.ceil(stat.size / 1e6) + ' MB, and show_file takes at most 100 MB.', true)
    return relay('show_file', { path: real, caption: args && args.caption })
  }
  return text('No tool ' + name, true)
}

// Runcastle's answer to one call, through the relay socket: retried while the relay comes up.
function relay(tool, args) {
  return new Promise((resolve) => {
    let tries = 0
    const attempt = () => {
      const s = net.connect(SOCKET)
      let buf = ''
      s.setEncoding('utf8')
      s.setTimeout(120000)
      s.once('connect', () => s.write(JSON.stringify({ id: 1, tool, args }) + '\n'))
      s.on('data', (chunk) => {
        buf += chunk
        const i = buf.indexOf('\n')
        if (i < 0) return
        s.end()
        let m
        try { m = JSON.parse(buf.slice(0, i)) } catch { m = { error: 'runcastle sent an answer that is not JSON' } }
        resolve(m.error !== undefined ? text(String(m.error), true) : text(String(m.result)))
      })
      s.once('timeout', () => { s.destroy(); resolve(text('Runcastle did not answer ' + tool + ' within 2 minutes.', true)) })
      s.once('error', (e) => {
        if ((e.code === 'ENOENT' || e.code === 'ECONNREFUSED') && tries++ < 40) return void setTimeout(attempt, 250)
        resolve(text('Runcastle is not reachable for ' + tool + ' right now (' + (e.code || e.message) + '). Try again in a moment.', true))
      })
    }
    attempt()
  })
}

let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buf += chunk
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (!line) continue
    let msg
    try { msg = JSON.parse(line) } catch { continue }
    if (msg.id === undefined) continue
    if (msg.method === 'initialize') {
      send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: (msg.params && msg.params.protocolVersion) || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'worker', version: '0.0.1' } } })
    } else if (msg.method === 'tools/list') {
      send({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } })
    } else if (msg.method === 'tools/call') {
      call(msg.params.name, msg.params.arguments).then(
        (result) => send({ jsonrpc: '2.0', id: msg.id, result }),
        (err) => send({ jsonrpc: '2.0', id: msg.id, result: text(String(err && err.message || err), true) }),
      )
    } else if (msg.method === 'ping') {
      send({ jsonrpc: '2.0', id: msg.id, result: {} })
    } else {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found' } })
    }
  }
})
`

/**
 * The tool relay inside the sandbox (decision 9): runcastle runs it over its
 * own `docker exec -i`. It listens on a socket inside the container; each call
 * the worker's MCP server sends there goes out on stdout under a relay-wide id,
 * and runcastle's answer on stdin goes back to the connection that asked, under
 * that connection's own id. It ends when runcastle closes its stdin.
 */
export const WORKER_RELAY_SCRIPT = String.raw`#!/usr/bin/env node
'use strict'
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')

const SOCKET = process.env.RUNCASTLE_TOOLS_SOCKET || '/home/agent/.runcastle/tools.sock'
fs.mkdirSync(path.dirname(SOCKET), { recursive: true })
try { fs.unlinkSync(SOCKET) } catch {}

let next = 1
const pending = new Map()

function lines(stream, onLine) {
  let buf = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    buf += chunk
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      let msg
      try { msg = JSON.parse(line) } catch { continue }
      onLine(msg)
    }
  })
}

lines(process.stdin, (msg) => {
  const asked = pending.get(msg.id)
  if (!asked) return
  pending.delete(msg.id)
  if (!asked.sock.destroyed) asked.sock.write(JSON.stringify({ ...msg, id: asked.id }) + '\n')
})

const server = net.createServer((sock) => {
  sock.on('error', () => {})
  lines(sock, (msg) => {
    const id = next++
    pending.set(id, { sock, id: msg.id })
    process.stdout.write(JSON.stringify({ id, tool: msg.tool, args: msg.args || {} }) + '\n')
  })
})
server.listen(SOCKET, () => {
  try { fs.chmodSync(SOCKET, 0o600) } catch {}
  process.stdout.write(JSON.stringify({ ready: true }) + '\n')
})
process.stdin.on('end', () => {
  server.close()
  try { fs.unlinkSync(SOCKET) } catch {}
  process.exit(0)
})
`

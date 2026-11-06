/**
 * The worker's own tools (workers spike, decision 23): a stdio MCP server that
 * runs INSIDE the worker's sandbox, so nothing in the sandbox needs a way out to
 * runcastle. `hand_back` writes the worker's summary to a file the server reads
 * through `docker exec` when the turn ends; `start_dev_server` runs the dev
 * server detached inside the container, on the one port the container publishes.
 *
 * Plain Node, no dependencies: it is written next to the adapter bundle and
 * mounted read-only. Tool names are provisional (decision 4).
 */
export const WORKER_MCP_SCRIPT = String.raw`#!/usr/bin/env node
'use strict'
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const STATE = '/home/agent/.runcastle'
const REPO = '/home/agent/repo'
const PORT = Number(process.env.WORKER_PORT || 0)
const PREVIEW = process.env.WORKER_PREVIEW_URL || ''
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
]

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
  const local = await answers('127.0.0.1', PORT)
  const tail = (() => { try { return fs.readFileSync(path.join(STATE, 'dev.log'), 'utf8').slice(-1500) } catch { return '' } })()
  return text(
    (local
      ? 'The server listens on 127.0.0.1 only, which the published port cannot reach: make it listen on 0.0.0.0 (for Vite: --host 0.0.0.0).'
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
  return text('No tool ' + name, true)
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

/**
 * PTY sidecar host (UI-SPEC §5). Run with SYSTEM `node` (not Bun) — one process
 * per terminal — because node-pty's Windows ConPTY backend writes keystrokes to
 * the child through a Node `net.Socket` input pipe that is unusable under Bun
 * (write() throws `ERR_SOCKET_CLOSED`, so INPUT is silently dropped). Output
 * works under Bun, so only WRITE is broken; running node-pty under real `node`
 * here fixes it. The server (`pty-sidecar.ts`) spawns this and talks a
 * newline-delimited JSON protocol over stdio; binary payloads are base64 so they
 * can never collide with the `\n` frame delimiter.
 *
 * PROTOCOL
 *   inbound  (server → host, over this process's stdin, one JSON object per line):
 *     { t:'spawn',  file, args, opts:{ cwd, cols, rows, useConpty, env } }  // first
 *     { t:'write',  d:<base64 utf8 keystrokes> }
 *     { t:'resize', cols, rows }
 *     { t:'kill' }
 *   outbound (host → server, over this process's stdout):
 *     { t:'ready', pid }
 *     { t:'data',  d:<base64> }        // raw PTY output bytes
 *     { t:'exit',  code, signal }
 *     { t:'error', message }           // spawn/host failure (fatal)
 *
 * argv[2] (optional): absolute path to node-pty's entry, resolved by the server
 * so the child never has to re-resolve it. Falls back to bare require('node-pty').
 */

'use strict'

/** Emit one framed JSON line on stdout. Swallow EPIPE if the server is gone. */
function send(obj) {
  try {
    process.stdout.write(JSON.stringify(obj) + '\n')
  } catch {
    // server detached — nothing we can do
  }
}

/** Diagnostics go to stderr so they never corrupt the stdout protocol stream. */
function log(msg) {
  try {
    process.stderr.write(`[pty-host] ${msg}\n`)
  } catch {
    /* ignore */
  }
}

function loadNodePty() {
  const explicit = process.argv[2]
  if (explicit) {
    try {
      return require(explicit)
    } catch (e) {
      log(`require(${explicit}) failed: ${e && e.message}; falling back to bare specifier`)
    }
  }
  return require('node-pty')
}

let proc = null
let spawned = false

function handleSpawn(msg) {
  if (spawned) {
    log('ignoring second spawn message')
    return
  }
  spawned = true
  let pty
  try {
    pty = loadNodePty()
  } catch (e) {
    send({ t: 'error', message: `failed to load node-pty: ${e && e.message}` })
    process.exit(1)
    return
  }

  const opts = msg.opts || {}
  const env = {}
  const src = opts.env || process.env
  for (const k of Object.keys(src)) {
    if (typeof src[k] === 'string') env[k] = src[k]
  }

  try {
    proc = pty.spawn(msg.file, msg.args || [], {
      name: 'xterm-256color',
      cols: Math.max(1, opts.cols || 80),
      rows: Math.max(1, opts.rows || 24),
      cwd: opts.cwd,
      env,
      useConpty: opts.useConpty !== false,
    })
  } catch (e) {
    send({ t: 'error', message: `spawn failed: ${e && e.message}` })
    process.exit(1)
    return
  }

  send({ t: 'ready', pid: proc.pid })

  proc.onData((d) => {
    const buf = typeof d === 'string' ? Buffer.from(d, 'utf8') : d
    send({ t: 'data', d: buf.toString('base64') })
  })

  proc.onExit((e) => {
    send({ t: 'exit', code: e && typeof e.exitCode === 'number' ? e.exitCode : 0, signal: (e && e.signal) || null })
    // Give stdout a tick to flush the framed exit line before we go.
    setTimeout(() => process.exit(0), 20)
  })
}

function handle(msg) {
  switch (msg && msg.t) {
    case 'spawn':
      handleSpawn(msg)
      break
    case 'write':
      if (proc && typeof msg.d === 'string') {
        try {
          proc.write(Buffer.from(msg.d, 'base64').toString('utf8'))
        } catch (e) {
          log(`write failed: ${e && e.message}`)
        }
      }
      break
    case 'resize':
      if (proc && typeof msg.cols === 'number' && typeof msg.rows === 'number') {
        try {
          proc.resize(Math.max(1, msg.cols), Math.max(1, msg.rows))
        } catch (e) {
          log(`resize failed: ${e && e.message}`)
        }
      }
      break
    case 'kill':
      if (proc) {
        try {
          proc.kill()
        } catch {
          /* already gone */
        }
      }
      break
    default:
      log(`unknown message: ${JSON.stringify(msg)}`)
  }
}

// --- stdin line reader (newline-delimited JSON) ------------------------------
let acc = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  acc += chunk
  let nl
  while ((nl = acc.indexOf('\n')) !== -1) {
    const line = acc.slice(0, nl)
    acc = acc.slice(nl + 1)
    if (!line) continue
    let msg
    try {
      msg = JSON.parse(line)
    } catch (e) {
      log(`bad JSON line: ${e && e.message}`)
      continue
    }
    handle(msg)
  }
})

// When the server closes our stdin (it detached / crashed), tear down the child.
process.stdin.on('end', () => {
  if (proc) {
    try {
      proc.kill()
    } catch {
      /* ignore */
    }
  }
  process.exit(0)
})

process.on('uncaughtException', (e) => {
  send({ t: 'error', message: `uncaught: ${e && e.message}` })
  process.exit(1)
})

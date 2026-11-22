import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseAst } from 'vitest/node'
import { describe, expect, it } from 'vitest'

/**
 * The Bun launch guard (sessions-never-pick-up-a-project-s-api-key, decision 5).
 *
 * Any Bun process loads the `.env` files of the folder it starts in, so a Bun
 * that runcastle starts in a project folder can hand the project's
 * `ANTHROPIC_API_KEY` to Claude Code. Every runcastle Bun launch goes through
 * `src/util/bun-launch.ts`, which adds `--no-env-file`. This test parses every
 * server source file and fails, naming file and line, on a Bun launch anywhere
 * else:
 * - `process.execPath`, `process.argv0` or `process.argv[0]` (this Bun);
 * - a string or template that is `bun` or starts with `bun ` (the `bun` on PATH);
 * - an Agent SDK `query(` in a file that never passes the helper's SDK options.
 *
 * Comments, imports and type positions are not code that runs and are skipped. A hit
 * that is not a runcastle Bun launch goes on the allow list with its reason; an
 * allow-list entry that no longer matches anything fails too, so the list
 * cannot rot.
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src')
const HELPER = 'util/bun-launch.ts'

interface Allowed {
  file: string
  /** Text the hit's line must contain. */
  match: string
  reason: string
}

const ALLOWED: Allowed[] = [
  { file: 'doctor/doctor.ts', match: "'bun'", reason: 'the doctor probes `bun --version` and resolves the bun binary; no script runs, so no .env matters' },
  { file: 'setup/plan.ts', match: "'bun'", reason: 'the setup step that runs `bun upgrade` for the human; it runs no script' },
  { file: 'services/update-check.ts', match: '`bun add -g', reason: 'the update command shown to the human; it runs no script' },
  { file: 'services/repo-toolchain.ts', match: "'bun'", reason: "names the project's package manager for the project's own commands, which read its .env (decision 4)" },
  { file: 'launcher/install-guard.ts', match: "verbAfter('bun'", reason: 'matches `bun install` in agent commands; launches nothing' },
]

/** Files that start the Agent SDK. Each must pass `claudeSdkLaunch()` or `sdkExecutableArgs(...)`. */
const SDK_HELPERS = /\b(claudeSdkLaunch|sdkExecutableArgs)\(/

interface Hit {
  file: string
  line: number
  text: string
  what: string
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return sourceFiles(p)
    return /\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts') ? [p] : []
  })
}

function isBunCommandText(text: string): boolean {
  return text === 'bun' || text.startsWith('bun ')
}

function scan(path: string): Hit[] {
  return scanText(relative(SRC, path).replace(/\\/g, '/'), readFileSync(path, 'utf8'))
}

type Node = { type: string; start: number; [key: string]: unknown }

const isNode = (v: unknown): v is Node => typeof v === 'object' && v !== null && typeof (v as Node).type === 'string'
const isIdent = (v: unknown, name: string) => isNode(v) && v.type === 'Identifier' && v.name === name

function scanText(file: string, text: string): Hit[] {
  const ast = parseAst(text, { lang: file.endsWith('.tsx') ? 'tsx' : 'ts' }) as unknown as Node
  const lines = text.split('\n')
  const hits: Hit[] = []
  const hit = (node: Node, what: string) => {
    const line = text.slice(0, node.start).split('\n').length
    hits.push({ file, line, text: (lines[line - 1] ?? '').trim(), what })
  }
  const visit = (node: Node): void => {
    // A module specifier (`from 'bun'`) and type positions name Bun, they do not start it.
    if (node.type === 'ImportDeclaration' || node.type.startsWith('TS')) return
    if (node.type === 'MemberExpression' && isIdent(node.object, 'process') && !node.computed) {
      if (isIdent(node.property, 'execPath') || isIdent(node.property, 'argv0')) hit(node, `process.${(node.property as Node).name as string}`)
    }
    if (node.type === 'MemberExpression' && node.computed && isNode(node.object) && node.object.type === 'MemberExpression') {
      const inner = node.object
      if (isIdent(inner.object, 'process') && isIdent(inner.property, 'argv') && isNode(node.property) && node.property.value === 0) hit(node, 'process.argv[0]')
    }
    if (node.type === 'Literal' && typeof node.value === 'string' && isBunCommandText(node.value)) hit(node, 'a `bun` command')
    if (node.type === 'TemplateLiteral') {
      const head = (node.quasis as Array<{ value: { cooked: string | null; raw: string } }>)[0]
      if (head && isBunCommandText(head.value.cooked ?? head.value.raw)) hit(node, 'a `bun` command')
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach((child) => isNode(child) && visit(child))
      else if (isNode(value)) visit(value)
    }
  }
  visit(ast)
  if (/\bquery\(/.test(text) && /from '@anthropic-ai\/claude-agent-sdk'/.test(text) && !SDK_HELPERS.test(text)) {
    hits.push({ file, line: 1, text: 'query(...)', what: 'an Agent SDK query without claudeSdkLaunch() or sdkExecutableArgs()' })
  }
  return hits
}

describe('Bun launch guard', () => {
  const hits = sourceFiles(SRC)
    .filter((p) => relative(SRC, p).replace(/\\/g, '/') !== HELPER)
    .flatMap(scan)
  const allowedBy = (h: Hit) => ALLOWED.find((a) => a.file === h.file && h.text.includes(a.match))

  it('finds no runcastle Bun launch outside the shared helper', () => {
    const offenders = hits
      .filter((h) => !allowedBy(h))
      .map((h) => `${h.file}:${h.line} ${h.what}: ${h.text}\n  Start Bun through src/${HELPER} so it carries --no-env-file, or allow-list it here with a reason.`)
    expect(offenders).toEqual([])
  })

  it('keeps no allow-list entry that matches nothing', () => {
    const stale = ALLOWED.filter((a) => !hits.some((h) => allowedBy(h) === a)).map((a) => `${a.file} "${a.match}"`)
    expect(stale).toEqual([])
  })

  it('catches the launches it is meant to catch', () => {
    // A check on the scanner itself: the forms the leak came in, plus the ones that are not launches.
    const probe = [
      '// spawn(process.execPath) in a comment is not code',
      "import type { Server } from 'bun'",
      'spawn(process.execPath, [entry], { cwd })',
      'const hook = `bun run "${client}" stop`',
      "execFile('bun', ['run', script])",
      "spawn(process.argv[0], ['x.js'])",
      "import { query } from '@anthropic-ai/claude-agent-sdk'",
      'query({ prompt, options: { pathToClaudeCodeExecutable } })',
    ].join('\n')
    expect(scanText('probe.ts', probe).map((h) => h.what)).toEqual([
      'process.execPath',
      'a `bun` command',
      'a `bun` command',
      'process.argv[0]',
      'an Agent SDK query without claudeSdkLaunch() or sdkExecutableArgs()',
    ])
  })
})

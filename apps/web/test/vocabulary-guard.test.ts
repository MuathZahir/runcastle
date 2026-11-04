import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parseAst } from 'vite'
import { describe, expect, it } from 'vitest'

/**
 * The vocabulary guard (ready-to-publish, decision 15).
 *
 * Every string a person reads in the web app uses one word per concept: round,
 * worker, unattended, chat, orchestrator, test drive. This test parses every
 * source file under `src/` and fails when a retired word appears in text a
 * person could read — JSX text, or a string/template literal that reads as
 * prose — so the old words cannot drift back.
 *
 * Code names keep their old words (decision 3): identifiers, settings keys,
 * tRPC names and event types like `burn.started`. Those are skipped
 * structurally rather than listed: import specifiers, type positions, property
 * names, comparisons, `className`/test-id attributes, and code tokens with no
 * space and no capital (`'burns'`, `'session'`, `'burn.started'`).
 */

const RETIRED = [
  'burn', 'burns', 'burned', 'burning', 'burner', 'burners',
  'afk',
  'lane', 'lanes',
  'lap', 'laps',
  'thread', 'threads',
  'session', 'sessions',
  'conversation', 'conversations',
  'drive mode', 'project drive', 'project session', 'project chat',
]

const RETIRED_RE = new RegExp(`(?<![\\w-])(${RETIRED.join('|').replace(/ /g, '\\s+')})(?![\\w-])`, 'i')

/** Files whose job is to name the retired words, so a reader can map old to new. */
const ALLOWED_FILES = new Set([
  // The glossary's "Once called: burn, AFK burn, lap" lines (decision 20).
  'lib/glossary.ts',
])

/**
 * Literals that hold retired words on purpose. Keep this short; each entry says
 * why. A substring of the literal is enough to match.
 */
const ALLOWED_LITERALS: Array<{ file: string; text: string }> = [
  // Matches the server's old page names in stored messages, never shown.
  { file: 'lib/settings.ts', text: 'AFK burns|Burns' },
  // The Glossary's empty filter suggests typing an old word (decision 20).
  { file: 'components/GlossaryDialog.tsx', text: 'an old one such as' },
]

/** JSX attributes whose values never render as words. */
const NON_TEXT_ATTRIBUTES = new Set(['className', 'key', 'id', 'data-testid', 'href', 'to', 'name', 'htmlFor', 'role', 'value', 'type'])

/** Object keys whose values are search aliases, not displayed text (decision 3). */
const ALIAS_KEYS = new Set(['terms', 'aliases', 'keywords', 'searchTerms'])

/** Constants holding search aliases, e.g. `PROJECT_CHAT_TERMS`. */
const ALIAS_CONSTANT = /(TERMS|ALIASES|KEYWORDS)$/

/** Class-name helpers: their string arguments are utility classes like `group/thread`. */
const CLASS_HELPERS = new Set(['cx'])

/** Methods whose string arguments are keys, selectors or patterns, not text. */
const KEY_METHODS = new Set(['startsWith', 'endsWith', 'includes', 'getItem', 'setItem', 'removeItem', 'querySelector', 'querySelectorAll', 'addEventListener', 'removeEventListener', 'get', 'has', 'set', 'delete'])

/** Expression wrappers a literal can sit inside without changing what it is for. */
const PASS_THROUGH = new Set(['ConditionalExpression', 'LogicalExpression', 'TemplateLiteral', 'ArrayExpression', 'JSXExpressionContainer', 'TSAsExpression', 'TSSatisfiesExpression', 'ParenthesizedExpression', 'SpreadElement'])

const SRC = join(import.meta.dirname, '../src')

// The parser hands back ESTree nodes; only the few fields read below are typed.
interface Node {
  type: string
  start: number
  [key: string]: unknown
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as Node).type === 'string'
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

/** A literal that is a code token, not words: no space and no capital letter. */
function isCodeToken(text: string): boolean {
  return !/\s/.test(text.trim()) && !/[A-Z]/.test(text)
}

function nameOf(node: unknown): string {
  if (!isNode(node)) return ''
  if (typeof node.name === 'string') return node.name
  if (typeof node.value === 'string') return node.value
  return ''
}

/** Whether a literal, given its ancestors (nearest last), is a code position. */
function isNonTextPosition(literal: Node, ancestors: Node[]): boolean {
  let current = literal
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const parent = ancestors[i]!
    if (parent.type.startsWith('TS') && !PASS_THROUGH.has(parent.type)) return true
    switch (parent.type) {
      case 'ImportDeclaration':
      case 'ExportNamedDeclaration':
      case 'ExportAllDeclaration':
      case 'ImportExpression':
        return true
      case 'JSXAttribute':
        return NON_TEXT_ATTRIBUTES.has(nameOf(parent.name))
      case 'Property':
        return parent.key === current || ALIAS_KEYS.has(nameOf(parent.key))
      case 'MemberExpression':
        return parent.property === current
      case 'SwitchCase':
        return parent.test === current
      case 'BinaryExpression':
        return ['===', '!==', '==', '!=', 'in'].includes(parent.operator as string)
      case 'CallExpression': {
        const callee = parent.callee
        if (isNode(callee) && callee.type === 'Identifier') return CLASS_HELPERS.has(nameOf(callee))
        return isNode(callee) && callee.type === 'MemberExpression' && KEY_METHODS.has(nameOf(callee.property))
      }
      case 'VariableDeclarator':
        return ALIAS_CONSTANT.test(nameOf(parent.id))
    }
    if (!PASS_THROUGH.has(parent.type)) return false
    current = parent
  }
  return false
}

interface Hit {
  file: string
  line: number
  text: string
}

function scan(path: string): Hit[] {
  const file = relative(SRC, path).split('\\').join('/')
  if (ALLOWED_FILES.has(file)) return []
  return scanSource(file, readFileSync(path, 'utf8'))
}

function scanSource(file: string, source: string): Hit[] {
  const ast = parseAst(source, { lang: file.endsWith('.tsx') ? 'tsx' : 'ts' }) as unknown as Node
  const lineOf = (offset: number) => source.slice(0, offset).split('\n').length
  const hits: Hit[] = []
  const check = (node: Node, text: string): void => {
    if (!RETIRED_RE.test(text)) return
    if (ALLOWED_LITERALS.some((a) => a.file === file && text.includes(a.text))) return
    hits.push({ file, line: lineOf(node.start), text: text.trim().replace(/\s+/g, ' ').slice(0, 120) })
  }
  const visit = (node: Node, ancestors: Node[]): void => {
    if (node.type === 'JSXText') {
      check(node, node.value as string)
    } else if (node.type === 'Literal' && typeof node.value === 'string') {
      if (!isCodeToken(node.value) && !isNonTextPosition(node, ancestors)) check(node, node.value)
    } else if (node.type === 'TemplateLiteral') {
      const quasis = node.quasis as Array<{ value: { cooked: string | null; raw: string } }>
      const parts = quasis.map((q) => q.value.cooked ?? q.value.raw)
      if (!isCodeToken(parts.join('')) && !isNonTextPosition(node, ancestors)) check(node, parts.join(' … '))
    }
    const next = [...ancestors, node]
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach((child) => isNode(child) && visit(child, next))
      else if (isNode(value)) visit(value, next)
    }
  }
  visit(ast, [])
  return hits
}

describe('vocabulary guard', () => {
  it('finds no retired word in a user-visible string under src/', () => {
    const hits = sourceFiles(SRC).flatMap(scan)
    expect(hits.map((h) => `${h.file}:${h.line}  ${h.text}`)).toEqual([])
  })

  it('catches a retired word in JSX text and in a label, but not in code names', () => {
    const source = [
      "import { burns } from './lib/burns'",
      "const tab = 'burns'",
      "if (event.type === 'burn.started') tab.trim()",
      "const map = { 'Burns': 1 }",
      'export const Bad = () => (',
      '  <div className="group/thread" title="New thread">',
      '    Start the AFK burn',
      '    <Button label={`Project drive`} />',
      '  </div>',
      ')',
    ].join('\n')
    expect(scanSource('Bad.tsx', source).map((h) => h.text)).toEqual(['New thread', 'Start the AFK burn', 'Project drive'])
  })
})

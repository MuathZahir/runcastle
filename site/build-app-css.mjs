/**
 * Generate `assets/app-ui.css` from the product's own stylesheet.
 *
 * The landing page embeds real runcastle UI as live markup, not screenshots, so
 * the mockups stay crisp at any size and we control exactly what is shown. To do
 * that safely the product CSS has to live in this page without fighting it: both
 * files legitimately define `.btn`, `.mono`, `.chip`, `.sidebar`, and friends.
 *
 * So every rule from the product sheet gets scoped under `.rc-app`, which is the
 * wrapper each mockup sits inside. Global resets and `:root` are dropped: the
 * page already declares the same tokens (copied from the same source), and we do
 * not want the product's `body`/scrollbar rules leaking out of the mock.
 *
 * The product sheet is flat (no nesting, only @keyframes and @media), which is
 * what makes a transform this simple correct. Run after changing app styles:
 *
 *   node site/build-app-css.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = join(here, '..', 'apps', 'web', 'src', 'styles.css')
const OUT = join(here, 'assets', 'app-ui.css')
const SCOPE = '.rc-app'

/** Selectors that configure the document, not a component. Dropped entirely. */
const isGlobalReset = (sel) => {
  const s = sel.trim()
  // Scrollbar pseudo-elements, with or without a trailing state.
  if (/^::-webkit-scrollbar/.test(s)) return true
  return /^(\*|html|body|#root|:focus-visible|::selection)$/.test(s)
}

/**
 * `:root` becomes the wrapper itself, so the whole token set (including layout
 * metrics like --sidebar-w that the app's grids depend on) is redeclared on
 * `.rc-app`. That makes a mock self-contained: the landing page can restyle its
 * own tokens freely without silently breaking the embedded product UI.
 */
const isTokenRoot = (sel) => sel.trim() === ':root'

/** Strip every leading comment block from a selector position. */
function stripLeadingComments(text) {
  let rest = text
  let taken = ''
  for (;;) {
    const m = rest.match(/^\s*\/\*[\s\S]*?\*\//)
    if (!m) break
    taken += m[0]
    rest = rest.slice(m[0].length)
  }
  return { comments: taken.trim(), rest }
}

/**
 * Split CSS into top-level chunks, tracking brace depth so a rule body is never
 * cut in half. Comments and strings are skipped over so a `{` inside either one
 * cannot throw the depth off.
 */
function topLevelChunks(css) {
  const chunks = []
  let depth = 0
  let start = 0
  for (let i = 0; i < css.length; i++) {
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2)
      i = end === -1 ? css.length : end + 1
      continue
    }
    const ch = css[i]
    if (ch === '"' || ch === "'") {
      for (i++; i < css.length; i++) {
        if (css[i] === '\\') i++
        else if (css[i] === ch) break
      }
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        chunks.push(css.slice(start, i + 1))
        start = i + 1
      }
    }
  }
  const tail = css.slice(start)
  if (tail.trim()) chunks.push(tail)
  return chunks
}

/** Prefix one selector list, dropping global resets. Returns null if nothing survives. */
function scopeSelectorList(selectorText) {
  const kept = selectorText
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && !isGlobalReset(s))
    .map((s) => {
      // The token block lands ON the wrapper, not on a descendant of it.
      if (isTokenRoot(s)) return SCOPE
      // `button.tb-runs` style element-qualified selectors, and everything else,
      // just get the scope prepended as an ancestor.
      return `${SCOPE} ${s}`
    })
  return kept.length ? kept.join(',\n') : null
}

function scopeRule(chunk) {
  const open = chunk.indexOf('{')
  if (open === -1) return null
  const selectorText = chunk.slice(0, open)
  const body = chunk.slice(open)

  // Preserve leading comments so the output stays readable and attributable,
  // but keep them out of the selector list itself.
  const { comments, rest: bareSelectors } = stripLeadingComments(selectorText)
  const leading = comments ? comments + '\n' : ''

  const scoped = scopeSelectorList(bareSelectors)
  if (!scoped) return null
  return `${leading}${scoped} ${body}`
}

function transform(css) {
  const out = []
  for (const chunk of topLevelChunks(css)) {
    const trimmed = chunk.trimStart()

    // @keyframes / @font-face bodies are not selector lists. Pass through as-is
    // so animations referenced by scoped rules still resolve.
    if (/^@(keyframes|font-face|charset|import)/i.test(trimmed)) {
      out.push(chunk.trim())
      continue
    }

    // @media / @supports wrap real rules. Scope each rule inside, keep the wrapper.
    if (/^@(media|supports)/i.test(trimmed)) {
      const open = chunk.indexOf('{')
      const prelude = chunk.slice(0, open + 1)
      const inner = chunk.slice(open + 1, chunk.lastIndexOf('}'))
      const innerOut = topLevelChunks(inner)
        .map((r) => (/^@/.test(r.trimStart()) ? r.trim() : scopeRule(r)))
        .filter(Boolean)
      if (innerOut.length) out.push(`${prelude}\n${innerOut.join('\n')}\n}`)
      continue
    }

    const scoped = scopeRule(chunk)
    if (scoped) out.push(scoped)
  }
  return out.join('\n\n')
}

const src = readFileSync(SRC, 'utf8')
const banner = `/* GENERATED by site/build-app-css.mjs, do not edit by hand.
   Source: apps/web/src/styles.css (the product's shipped stylesheet).
   Every rule is scoped under \`${SCOPE}\` so real UI can be embedded in the
   landing page as live markup. Regenerate after changing app styles:
     node site/build-app-css.mjs
*/\n\n`

writeFileSync(OUT, banner + transform(src) + '\n', 'utf8')

const before = src.length
const after = readFileSync(OUT, 'utf8').length
console.log(`app-ui.css written: ${before} -> ${after} bytes, scoped under ${SCOPE}`)

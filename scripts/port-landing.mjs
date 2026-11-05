// Port the landing page's design canvas to the real site as plain static files:
//   site/index.html   the markup, pre-rendered in its switched-off state (works without JS)
//   site/landing.css  the page's styles, with the self-hosted Geist fonts
//   site/landing.js   the page's own component logic plus a tiny binder (no dependencies)
// Usage: node scripts/port-landing.mjs <Main.dc.html> [head.html]
//   <Main.dc.html>  the canvas's page, read from the Design canvas (Artifact read, path project/Main.dc.html)
//   [head.html]     only when site/index.html has no head block yet; afterwards the hand-written
//                   <head> between the two "page head" markers in site/index.html is kept as is.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.join(HERE, '..', 'site');
const [FROM, HEAD] = process.argv.slice(2);
if (!FROM) throw new Error('usage: node scripts/port-landing.mjs <Main.dc.html> [head.html]');
const src = fs.readFileSync(FROM, 'utf8');

const between = (s, a, b, from = 0) => { const i = s.indexOf(a, from); const j = s.indexOf(b, i + a.length); if (i < 0 || j < 0) throw new Error('missing ' + a); return s.slice(i + a.length, j); };

// ---- pieces of the canvas page ----
const helmet = between(src, '<helmet>', '</helmet>');
const css = between(helmet, '<style>', '</style>');
let tpl = between(src, '</helmet>', '</x-dc>');
const scriptOpen = src.indexOf('data-dc-script');
const script = between(src, '>', '</script>', scriptOpen);

// ---- evaluate the component once, for the switched-off first frame ----
class DCLogic { constructor(props) { this.props = props || {}; this.state = {}; } setState(u) { const p = typeof u === 'function' ? u(this.state, this.props) : u; this.state = { ...this.state, ...p }; } }
const Component = new Function('DCLogic', script + '\nreturn Component;')(DCLogic);
const comp = new Component({});
const vals = comp.renderVals();
const look = (obj, p) => p.trim().split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const fill = (t) => t.replace(/\{\{([^}]+)\}\}/g, (_, p) => { const v = look(vals, p); return typeof v === 'function' ? '' : String(v ?? ''); });

// ---- 1. expand loops: <sc-for list="{{a.b}}" as="x"> … {{x.k}} … </sc-for> ----
tpl = tpl.replace(/<sc-for list="\{\{([^}]+)\}\}" as="(\w+)"[^>]*>([\s\S]*?)<\/sc-for>/g, (_, list, as, inner) => {
  const n = (look(vals, list) || []).length;
  let out = '';
  for (let i = 0; i < n; i++) out += inner.replace(new RegExp('\\{\\{' + as + '\\.', 'g'), '{{' + list.trim() + '.' + i + '.');
  return out;
});
if (/<sc-/.test(tpl)) throw new Error('unsupported sc- element left in the template');

// ---- 2. attributes with holes -> static value + data-b-<attr> (holes stored as [[…]]) ----
tpl = tpl.replace(/<([a-zA-Z][\w-]*)((?:\s+[^\s=>]+(?:="[^"]*")?)*)\s*(\/?)>/g, (m, tag, attrs, self) => {
  if (!attrs.includes('{{')) return m;
  const out = attrs.replace(/\s+([^\s=>]+)="([^"]*)"/g, (am, name, value) => {
    if (!value.includes('{{')) return am;
    const ev = /^on([A-Z]\w*)$/.exec(name);
    if (ev) return ` data-on-${ev[1].toLowerCase()}="${value.replace(/[{}\s]/g, '')}"`;
    const key = name.toLowerCase();
    return ` ${key}="${esc(fill(value))}" data-b-${key}="${value.replace(/\{\{/g, '[[').replace(/\}\}/g, ']]')}"`;
  });
  return `<${tag}${out}${self ? ' /' : ''}>`;
});

// ---- 3. text holes -> <span data-t="path">value</span> ----
tpl = tpl.replace(/\{\{([^}]+)\}\}/g, (_, p) => `<span data-t="${p.trim()}">${esc(look(vals, p))}</span>`);
if (tpl.includes('{{')) throw new Error('hole left in the template');
// docs/ and compare/ link to /#pipeline: the story of the pipeline starts at the orchestrator
if (!tpl.includes('data-sec="orc"')) throw new Error('orchestrator section not found');
tpl = tpl.replace('data-sec="orc"', 'id="pipeline" data-sec="orc"');

// ---- landing.css: the page's styles with self-hosted fonts ----
const fonts = `/* Geist and Geist Mono, self-hosted (latin, variable weight) */
@font-face{font-family:Geist;font-style:normal;font-display:swap;font-weight:100 900;src:url(assets/fonts/geist-latin-wght-normal.woff2) format('woff2')}
@font-face{font-family:"Geist Mono";font-style:normal;font-display:swap;font-weight:100 900;src:url(assets/fonts/geist-mono-latin-wght-normal.woff2) format('woff2')}
`;
const header = `/* The runcastle landing page. GENERATED from the design canvas by scripts/port-landing.mjs:
   edit the canvas and re-run the port, not this file. Docs and compare pages use
   styles.css + content.css instead. */
`;
fs.writeFileSync(path.join(SITE, 'landing.css'), header + fonts + css.trim() + '\n');

// ---- landing.js: the component + a binder ----
const binder = `
// ---- binder: re-evaluates the component and patches the bound attributes and text ----
const comp = new Component({});
const look = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const binds = [];
document.querySelectorAll('*').forEach((el) => {
  for (const a of Array.from(el.attributes)) {
    if (a.name.startsWith('data-b-')) binds.push([el, a.name.slice(7), a.value.replace(/\\[\\[/g, '{{').replace(/\\]\\]/g, '}}')]);
    else if (a.name.startsWith('data-on-')) { const ev = a.name.slice(8), key = a.value; el.addEventListener(ev, (e) => { const f = vals && look(vals, key); if (typeof f === 'function') f(e); }); }
  }
});
const texts = Array.from(document.querySelectorAll('[data-t]')).map((el) => [el, el.getAttribute('data-t')]);
let vals = null, queued = false;
const fill = (t) => t.replace(/\\{\\{([^}]+)\\}\\}/g, (_, p) => { const v = look(vals, p.trim()); return typeof v === 'function' ? '' : String(v == null ? '' : v); });
function render() {
  queued = false;
  vals = comp.renderVals();
  for (const [el, attr, t] of binds) { const v = fill(t); if (el.getAttribute(attr) !== v) el.setAttribute(attr, v); }
  for (const [el, p] of texts) { const v = look(vals, p); const s = String(v == null ? '' : v); if (el.textContent !== s) el.textContent = s; }
}
schedule = () => { if (!queued) { queued = true; requestAnimationFrame(render); } };
render();
if (comp.componentDidMount) comp.componentDidMount();
`;
const js = `// The runcastle landing page's motion. GENERATED from the design canvas by
// scripts/port-landing.mjs: edit the canvas and re-run the port, not this file.
// One 100 ms clock drives every scene; each scene returns class strings and CSS does the motion.
(() => {
let schedule = () => {};
class DCLogic {
  constructor(props) { this.props = props || {}; this.state = {}; }
  setState(u) { const p = typeof u === 'function' ? u(this.state, this.props) : u; this.state = Object.assign({}, this.state, p); schedule(); }
}
${script.trim()}
${binder}})();
`;
fs.writeFileSync(path.join(SITE, 'landing.js'), js);

// ---- index.html ----
const OPEN = '<!-- page head: hand-written, kept by scripts/port-landing.mjs -->';
const CLOSE = '<!-- end page head -->';
let head;
const old = fs.existsSync(path.join(SITE, 'index.html')) ? fs.readFileSync(path.join(SITE, 'index.html'), 'utf8') : '';
if (old.includes(OPEN) && old.includes(CLOSE)) head = old.slice(old.indexOf(OPEN) + OPEN.length, old.indexOf(CLOSE));
else if (HEAD) head = '\n' + fs.readFileSync(HEAD, 'utf8').trimEnd() + '\n    ';
else throw new Error('site/index.html has no page head block: pass a head.html');
const html = `<!doctype html>
<html lang="en">
  <head>
    ${OPEN}${head}${CLOSE}
    <link rel="stylesheet" href="landing.css" />
    <script src="landing.js" defer></script>
  </head>
  <body>
${tpl.trim()}
  </body>
</html>
`;
fs.writeFileSync(path.join(SITE, 'index.html'), html);
console.log('wrote', ['index.html', 'landing.css', 'landing.js'].map((f) => f + ' ' + fs.statSync(path.join(SITE, f)).size).join(', '));

/* @ds-bundle: {"format":4,"namespace":"Runcastle","components":[{"name":"Button"},{"name":"IconButton"},{"name":"Kbd"},{"name":"Icon"},{"name":"PhaseIcon"},{"name":"StatusDot"},{"name":"SectionLabel"},{"name":"NavItem"},{"name":"ListRow"},{"name":"PhaseStepper"},{"name":"Tabs"},{"name":"Input"},{"name":"PropertyList"},{"name":"MetaLine"},{"name":"Disclosure"},{"name":"EmptyState"},{"name":"Menu"}]} */
(function () {
  var h = React.createElement;
  var ICONS = {"activity":"<path d=\"M1.8 8h2.6l1.8-4.4 2.8 8.8L10.8 8h3.4\"></path>","arrow-right":"<path d=\"M2.5 8h11M9.5 4l4 4-4 4\"></path>","bell":"<path d=\"M8 2a4 4 0 0 0-4 4v2.6L2.8 11h10.4L12 8.6V6a4 4 0 0 0-4-4Z\"></path><path d=\"M6.5 13.4a1.6 1.6 0 0 0 3 0\"></path>","bell-off":"<path d=\"M5.2 3.2A4 4 0 0 1 12 6v2.6L13.2 11H6.5M4 6.5V8.6L2.8 11h2.4\"></path><path d=\"M6.5 13.4a1.6 1.6 0 0 0 3 0\"></path><path d=\"M2 2l12 12\"></path>","branch":"<circle cx=\"4.5\" cy=\"3.8\" r=\"1.7\"></circle><circle cx=\"4.5\" cy=\"12.2\" r=\"1.7\"></circle><circle cx=\"11.5\" cy=\"5\" r=\"1.7\"></circle><path d=\"M4.5 5.5v5M11.5 6.7c0 2.6-3 3-5.4 3.6\"></path>","check":"<path d=\"m3 8.4 3.2 3.2L13 5\"></path>","chevron-down":"<path d=\"m4 6 4 4 4-4\"></path>","chevron-right":"<path d=\"m6 4 4 4-4 4\"></path>","claude":"<path d=\"M8 2.4v11.2M3.2 5.2l9.6 5.6M12.8 5.2l-9.6 5.6\"></path>","codex":"<path d=\"M5.6 4.8 2.4 8l3.2 3.2M10.4 4.8 13.6 8l-3.2 3.2\"></path>","cube":"<path d=\"M8 1.6l5.4 3v6.8L8 14.4l-5.4-3V4.6z\"></path><path d=\"M8 7.6l5.4-3M8 7.6L2.6 4.6M8 7.6v6.8\"></path>","doc":"<path d=\"M4 1.8h5.2L13 5.6v8.6H4z\"></path><path d=\"M9 2v3.8h3.8M6 8.4h4M6 10.8h4\"></path>","flame":"<path d=\"M8 14.4c2.7 0 4.7-2 4.7-4.7 0-2-1.3-3.4-2-4.7-.7 1.3-1.3 2-2 2 0-2-.7-4-2.7-5.4 0 2.7-2.7 4-2.7 8.1 0 2.7 2 4.7 4.7 4.7z\"></path>","folder":"<path d=\"M1.8 4.2c0-.8.6-1.4 1.4-1.4h3l1.4 1.7h5.2c.8 0 1.4.6 1.4 1.4v6.5c0 .8-.6 1.4-1.4 1.4H3.2c-.8 0-1.4-.6-1.4-1.4z\"></path>","lock":"<rect x=\"3.4\" y=\"7.2\" width=\"9.2\" height=\"6.6\" rx=\"1.3\"></rect><path d=\"M5.6 7.2V5a2.4 2.4 0 0 1 4.8 0v2.2\"></path>","message":"<path d=\"M2 4.4a1.6 1.6 0 0 1 1.6-1.6h8.8A1.6 1.6 0 0 1 14 4.4v5.2a1.6 1.6 0 0 1-1.6 1.6H6.4L3.2 14v-2.8A1.6 1.6 0 0 1 2 9.6z\"></path>","more":"<circle cx=\"3.2\" cy=\"8\" r=\"1.1\" fill=\"currentColor\" stroke=\"none\"></circle><circle cx=\"8\" cy=\"8\" r=\"1.1\" fill=\"currentColor\" stroke=\"none\"></circle><circle cx=\"12.8\" cy=\"8\" r=\"1.1\" fill=\"currentColor\" stroke=\"none\"></circle>","panel-right":"<rect x=\"1.8\" y=\"2.8\" width=\"12.4\" height=\"10.4\" rx=\"1.6\"></rect><path d=\"M10.2 2.8v10.4\"></path>","pencil":"<path d=\"M10.6 2.4a1.7 1.7 0 0 1 2.4 2.4L5.5 12.3 2.4 13.1l.8-3.1z\"></path><path d=\"M9.4 3.6l2.4 2.4\"></path>","play":"<path d=\"M5 3.2v9.6L13 8z\" fill=\"currentColor\" stroke=\"none\"></path>","plus":"<path d=\"M8 3.2v9.6M3.2 8h9.6\"></path>","search":"<circle cx=\"7\" cy=\"7\" r=\"4.5\"></circle><path d=\"M10.5 10.5 L14 14\"></path>","settings":"<circle cx=\"8\" cy=\"8\" r=\"2\"></circle><path d=\"M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M12.4 3.6 11 5M5 11l-1.4 1.4\"></path>","shield":"<path d=\"M8 1.8 13 3.6v4.2c0 3.2-2.1 5.3-5 6.4-2.9-1.1-5-3.2-5-6.4V3.6z\"></path>","sparkle":"<path d=\"M8 1.8 9.4 6l4.2 1.4L9.4 8.8 8 13 6.6 8.8 2.4 7.4 6.6 6z\"></path>","stop":"<rect x=\"4\" y=\"4\" width=\"8\" height=\"8\" rx=\"1.2\" fill=\"currentColor\" stroke=\"none\"></rect>","terminal":"<rect x=\"1.8\" y=\"2.8\" width=\"12.4\" height=\"10.4\" rx=\"1.6\"></rect><path d=\"m4.5 6.2 2.3 2-2.3 2M8.5 10.4h3\"></path>","trash":"<path d=\"M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5\"></path>","undo":"<path d=\"M5 6h5a3 3 0 0 1 0 6H7\"></path><path d=\"M7 3.5 4.5 6 7 8.5\"></path>","x":"<path d=\"m4 4 8 8M12 4l-8 8\"></path>"};
  function cx() { return Array.prototype.filter.call(arguments, Boolean).join(' '); }

  function Icon(p) {
    var s = p.size || 16;
    return h('svg', { className: cx('rc-icon', p.className), width: s, height: s, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, style: p.color ? { color: p.color } : undefined, dangerouslySetInnerHTML: { __html: ICONS[p.name] || '' } });
  }

  var PHASE_GLYPH = {
    draft: '<circle cx="8" cy="8" r="6" stroke-dasharray="2.2 2.2"/>',
    ideation: '<circle cx="8" cy="8" r="6"/>',
    spec: '<circle cx="8" cy="8" r="6"/><path d="M8 8V4a4 4 0 0 1 4 4z" fill="currentColor" stroke="none"/>',
    tickets: '<circle cx="8" cy="8" r="6"/><path d="M8 8V4a4 4 0 0 1 0 8z" fill="currentColor" stroke="none"/>',
    implementation: '<circle cx="8" cy="8" r="6"/><path d="M8 8V4a4 4 0 1 1-4 4z" fill="currentColor" stroke="none"/>',
    review: '<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none"/>',
    shipped: '<circle cx="8" cy="8" r="7" fill="currentColor" stroke="none"/><path d="M5.2 8.2 7 10l3.8-3.8" stroke="var(--surface)" stroke-width="1.6"/>'
  };
  var PHASE_LABEL = { draft: 'Draft', ideation: 'Ideation', spec: 'Spec', tickets: 'Tickets', implementation: 'Build', review: 'Review', shipped: 'Shipped' };

  function PhaseIcon(p) {
    var s = p.size || 16, ph = p.phase || 'ideation';
    return h('svg', { className: 'rc-phase', width: s, height: s, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', role: 'img', 'aria-label': PHASE_LABEL[ph], style: { color: 'var(--phase-' + ph + ')' }, dangerouslySetInnerHTML: { __html: PHASE_GLYPH[ph] } });
  }

  function Kbd(p) { return h('kbd', { className: 'rc-kbd' }, p.children); }

  function Button(p) {
    var v = p.variant || 'secondary', sz = p.size || 'md';
    var only = p.icon && !p.children;
    return h('button', { type: p.type || 'button', className: cx('rc-btn', 'rc-btn--' + v, sz !== 'md' && 'rc-btn--' + sz, only && 'rc-btn--icon', p.className), disabled: p.disabled, onClick: p.onClick, 'aria-label': only ? p.label : undefined, title: only ? p.label : undefined },
      p.icon ? h(Icon, { name: p.icon, size: sz === 'sm' ? 14 : 16 }) : null,
      p.children,
      p.kbd ? h(Kbd, null, p.kbd) : null);
  }
  function IconButton(p) { return h(Button, { variant: p.variant || 'ghost', size: p.size || 'md', icon: p.icon, label: p.label, onClick: p.onClick }); }

  function StatusDot(p) { return h('span', { className: cx('rc-dot', p.tone && 'rc-dot--' + p.tone), role: p.label ? 'img' : undefined, 'aria-label': p.label }); }

  function SectionLabel(p) {
    return h('div', { className: 'rc-label' }, p.children,
      p.count != null ? h('span', { className: 'rc-label__count' }, p.count) : null,
      p.action ? h('span', { className: 'rc-label__action' }, p.action) : null);
  }

  function NavItem(p) {
    return h('a', { className: 'rc-nav', href: p.href || '#', 'aria-current': p.active ? 'page' : undefined, onClick: p.onClick },
      p.phase ? h(PhaseIcon, { phase: p.phase }) : p.icon ? h(Icon, { name: p.icon }) : null,
      h('span', { className: 'rc-nav__label' }, p.label),
      p.dot ? h(StatusDot, { tone: p.dot, label: p.dotLabel }) : null,
      p.meta != null ? h('span', { className: 'rc-nav__meta' }, p.meta) : null);
  }

  var ORDER = ['ideation', 'spec', 'tickets', 'implementation', 'review', 'shipped'];
  function PhaseStepper(p) {
    var cur = ORDER.indexOf(p.phase), view = p.viewing || p.phase, kids = [];
    var steps = p.steps || ORDER;
    steps.forEach(function (ph, i) {
      if (i) kids.push(h('span', { key: 's' + i, className: 'rc-stepper__sep', 'aria-hidden': true }));
      var idx = ORDER.indexOf(ph);
      kids.push(h('span', { key: ph, className: 'rc-step', 'aria-current': ph === p.phase ? 'step' : undefined, 'data-viewing': ph === view && view !== p.phase ? '' : undefined },
        h(PhaseIcon, { phase: idx < cur ? 'shipped' : idx === cur ? ph : 'draft', size: 14 }), PHASE_LABEL[ph]));
    });
    return h('nav', { className: 'rc-stepper', 'aria-label': 'Pipeline' }, kids);
  }

  function Tabs(p) {
    return h('div', { className: 'rc-tabs', role: 'tablist' }, (p.items || []).map(function (it) {
      var id = it.id || it.label;
      return h('button', { key: id, className: 'rc-tab', role: 'tab', 'aria-selected': id === p.value, onClick: p.onChange ? function () { p.onChange(id); } : undefined },
        it.icon ? h(Icon, { name: it.icon, size: 14 }) : null, it.label,
        it.count != null ? h('span', { className: 'rc-tab__count' }, it.count) : null);
    }));
  }

  function Input(p) {
    return h('label', { className: cx('rc-input', p.size === 'lg' && 'rc-input--lg'), style: p.width ? { width: p.width } : undefined },
      p.icon ? h(Icon, { name: p.icon, size: 14 }) : null,
      h('input', { placeholder: p.placeholder, defaultValue: p.defaultValue, 'aria-label': p.label || p.placeholder }),
      p.kbd ? h(Kbd, null, p.kbd) : null);
  }

  function PropertyList(p) {
    var kids = [];
    (p.items || []).forEach(function (it, i) {
      kids.push(h('dt', { key: 'k' + i }, it.label));
      kids.push(h('dd', { key: 'v' + i },
        it.phase ? h(PhaseIcon, { phase: it.phase, size: 14 }) : it.tone ? h(StatusDot, { tone: it.tone }) : it.icon ? h(Icon, { name: it.icon, size: 14 }) : null,
        h('span', { className: it.mono ? 'rc-mono' : undefined }, it.value),
        it.sub ? h('span', { className: 'rc-sub' }, it.sub) : null));
    });
    return h('dl', { className: 'rc-props' }, kids);
  }

  function MetaLine(p) {
    return h('div', { className: 'rc-meta' }, (p.items || []).map(function (it, i) {
      return h('span', { key: i, className: 'rc-meta__item' },
        it.tone ? h(StatusDot, { tone: it.tone }) : it.icon ? h(Icon, { name: it.icon, size: 14 }) : null,
        it.strong ? h('b', null, it.strong) : null, it.text);
    }));
  }

  function Disclosure(p) {
    return h('details', { className: 'rc-disc', open: p.open },
      h('summary', null, h(Icon, { name: 'chevron-right', size: 14, className: 'rc-chev' }), p.icon ? h(Icon, { name: p.icon, size: 14 }) : null, p.title,
        p.aside ? h('span', { className: 'rc-disc__aside' }, p.aside) : null),
      h('div', { className: 'rc-disc__body' }, p.children));
  }

  function EmptyState(p) {
    return h('div', { className: 'rc-empty' }, h(Icon, { name: p.icon || 'check', size: 20 }),
      h('div', { className: 'rc-empty__title' }, p.title),
      p.hint ? h('div', { className: 'rc-empty__hint' }, p.hint) : null,
      p.action || null);
  }

  function Menu(p) {
    return h('div', { className: 'rc-menu', role: 'menu' }, (p.items || []).map(function (it, i) {
      if (it === '-') return h('div', { key: i, className: 'rc-menu__sep', role: 'separator' });
      return h('div', { key: i, role: 'menuitem', className: cx('rc-menu__item', it.danger && 'rc-menu__item--danger'), 'data-active': it.active ? '' : undefined },
        it.icon ? h(Icon, { name: it.icon, size: 14 }) : null, it.label, it.kbd ? h(Kbd, null, it.kbd) : null);
    }));
  }

  function ListRow(p) {
    return h('div', { className: 'rc-row', role: 'link', tabIndex: 0 },
      p.phase ? h(PhaseIcon, { phase: p.phase }) : p.dot ? h('span', { className: 'rc-dotbox' }, h(StatusDot, { tone: p.dot })) : p.icon ? h(Icon, { name: p.icon }) : null,
      h('span', { className: 'rc-row__title' }, p.title),
      p.meta ? h('span', { className: 'rc-row__meta' }, p.meta) : null);
  }

  window.Runcastle = {
    Icon: Icon, PhaseIcon: PhaseIcon, Kbd: Kbd, Button: Button, IconButton: IconButton, StatusDot: StatusDot,
    SectionLabel: SectionLabel, NavItem: NavItem, PhaseStepper: PhaseStepper, Tabs: Tabs, Input: Input,
    PropertyList: PropertyList, MetaLine: MetaLine, Disclosure: Disclosure, EmptyState: EmptyState, Menu: Menu,
    ListRow: ListRow, iconNames: Object.keys(ICONS)
  };
})();

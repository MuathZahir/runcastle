// The runcastle landing page's motion. GENERATED from the design canvas by
// scripts/port-landing.mjs: edit the canvas and re-run the port, not this file.
// One 100 ms clock drives every scene; each scene returns class strings and CSS does the motion.
(() => {
let schedule = () => {};
class DCLogic {
  constructor(props) { this.props = props || {}; this.state = {}; }
  setState(u) { const p = typeof u === 'function' ? u(this.state, this.props) : u; this.state = Object.assign({}, this.state, p); schedule(); }
}
// Every scene is scripted against one clock (100 ms ticks). Each reads its own loop
// position from it and returns the classes its blocks wear at that moment.
class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { clock: 0, os: 'unix', copied: false, litAt: {} };
    // A QR-like pattern for the pairing card: three finder squares, timing lines, fixed noise.
    const N = 21;
    const finder = (r, c) => {
      for (const [r0, c0] of [[0, 0], [0, 14], [14, 0]]) {
        const y = r - r0, x = c - c0;
        if (y >= 0 && y < 7 && x >= 0 && x < 7) return y === 0 || y === 6 || x === 0 || x === 6 || (y >= 2 && y <= 4 && x >= 2 && x <= 4) ? 1 : 0;
        if (y >= -1 && y <= 7 && x >= -1 && x <= 7) return 0;
      }
      return -1;
    };
    this.qr = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      let k = finder(r, c);
      if (k < 0) k = r === 6 || c === 6 ? ((r + c) % 2 === 0 ? 1 : 0) : ((r * 7 + c * 13 + r * c * 3) % 5 < 2 ? 1 : 0);
      this.qr.push({ cls: k ? 'k' : '' });
    }
  }

  componentDidMount() {
    let reduced = false;
    try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    this.reduced = reduced;
    this.timer = setInterval(() => {
      if (this.props.motion === false || this.reduced) return;
      this.setState((s) => ({ clock: s.clock + 1 }));
    }, 100);
    // Each section is OFF until its row is first seen; then its own clock starts at t=0.
    // A #t=<sec> hash (used by the capture scripts) lights everything at clock 0.
    const ids = ['orc', 'sbx', 'dsg', 'rev', 'drv', 'nts', 'phn', 'end'];
    const lightAll = (at) => this.setState((s) => { const litAt = { ...s.litAt }; ids.forEach((k) => { if (litAt[k] === undefined) litAt[k] = at === undefined ? s.clock : at; }); return { litAt }; });
    let captured = false;
    try { captured = /[#&]t=/.test(window.location.hash); } catch (e) {}
    if (captured) lightAll(-16); // already on at clock 0 (16 = RISE below)
    const watch = () => {
      try {
        if (!('IntersectionObserver' in window)) { lightAll(); return; }
        this.io = this.io || new IntersectionObserver((entries) => {
          const add = [];
          entries.forEach((e) => { if (e.isIntersecting) { add.push(e.target.getAttribute('data-sec')); this.io.unobserve(e.target); } });
          if (add.length) this.setState((s) => { const litAt = { ...s.litAt }; add.forEach((k) => { if (litAt[k] === undefined) litAt[k] = s.clock; }); return { litAt }; });
        }, { threshold: 0.4 });
        document.querySelectorAll('[data-sec]').forEach((el) => this.io.observe(el));
      } catch (e) { lightAll(); }
    };
    watch();
    this.watchTimer = setTimeout(watch, 600);
  }

  componentWillUnmount() {
    clearInterval(this.timer);
    clearTimeout(this.copyTimer);
    clearTimeout(this.watchTimer);
    if (this.io) this.io.disconnect();
  }

  // Hero. A request lands on the base (the orchestrator) → light runs to three plots →
  // each feature is outlined first (its design) → workers build inside it, one fails and
  // is rebuilt → the outline turns solid → the blocks stack on the base → a review scan
  // rises through them → the stack lights up and ships, leaving the base for the next one.
  hero(t) {
    const span = (a, b) => t >= a && t < b;
    const GLOW = 13.9, GONE = 14.7, END = 17.4;
    // FUSE: the four workers close ranks into the outline before the block replaces them.
    // LEG: the block rides back along its own wire: first leg on the ground to the elbow,
    // second leg lifting onto the stack while the wire retracts under it.
    const FUSE = 0.55, LEG = 0.5, ARRIVE = 1.25;
    const plots = [
      { k: 'a', out: 1.6, ghost: 2.5, up: [3.0, 3.2, 3.4, 3.6], done: [5.2, 5.8, 8.6, 6.2], fail: [6.4, 7.4], failAt: 2, merge: 9.6, slide: 11.1, lvl: 's3' },
      { k: 'b', out: 2.0, ghost: 2.9, up: [3.4, 3.6, 3.8, 4.0], done: [5.6, 6.0, 6.3, 6.6], merge: 7.5, slide: 9.9, lvl: 's1' },
      { k: 'c', out: 2.4, ghost: 3.3, up: [3.8, 4.0, 4.2, 4.4], done: [7.0, 7.4, 7.7, 8.0], merge: 8.8, slide: 10.5, lvl: 's2' },
    ];
    const v = {};
    plots.forEach((p) => {
      const fuse = p.merge - FUSE;
      p.up.forEach((u, j) => {
        let cls = 'cube w j' + j;
        if (t >= u && t < fuse) {
          if (p.fail && j === p.failAt && span(p.fail[0], p.fail[1])) cls += ' up bad';
          else cls += t >= p.done[j] ? ' up ok' : ' up run';
        } else if (span(fuse, p.merge)) cls += ' up fuse';
        else if (span(p.merge, p.merge + 1)) cls += ' hide';
        v[p.k + j] = cls;
      });
      let b = 'cube blk b' + p.k;
      if (span(p.ghost, fuse)) b += ' up ghost';
      else if (span(fuse, p.merge)) b += ' up ghost out';
      else if (span(p.merge, p.merge + 0.1)) b += ' up snap seal';
      else if (span(p.merge + 0.1, p.slide)) b += ' up';
      else if (span(p.slide, p.slide + LEG)) b += ' up l1';
      else if (span(p.slide + LEG, END)) b += ' up st ' + p.lvl + (t >= GLOW ? ' glow' : '') + (t >= GONE ? ' gone' : '');
      v[p.k + 'B'] = b;
      v[p.k + 'W'] = span(p.out, p.slide) ? 'wire on' : span(p.slide, p.slide + LEG) ? 'wire on r1' : 'wire';
      v[p.k + 'P'] = span(p.out, p.out + 0.95) ? 'pulse p' + p.k + ' go' : 'pulse p' + p.k;
      v[p.k + 'R'] = span(p.slide + ARRIVE - 0.05, p.slide + ARRIVE + 1.0) ? 'land go' : 'land';
    });
    v.tower = 'cube tower up' + (span(1.15, 2.3) ? ' glow' : '');
    v.drop = span(0.4, 1.3) ? 'drop go' : 'drop';
    v.scan = span(12.5, 13.9) ? 'scan go' : 'scan';
    return v;
  }

  // loop: 300 still: 17.5
  orc(t) {
    // Three requests, one every P seconds; each beat is the same:
    // drop onto the tower, a scan reads it, the count of features shows,
    // the tower lights, and each feature rides out of the tower along its
    // own line (the line draws ahead, then shrinks behind the block). At
    // the end of the beat the features move off and the request sinks into
    // the tower, so the stage is empty again just before the next drop.
    const P = 10;
    const L = 30;
    // arms: 0 west, 1 north, 2 east, 3 south (clockwise on screen)
    const ARMS = [[0, 2, 3], [0, 1, 2, 3], [0, 1, 2]];
    const E0 = 3.4, GAP = 0.6, RIDE = 1.1, DRAW = 0.55;
    const LEAVE = 8.8, GONE = 9.7, BACK = 9.4;
    // the loop opens on an empty tower with its mark showing (also the switched-off
    // frame); the first drop starts once the scene has powered on
    const D = 0.6;
    const v = {};
    const wire = ['', '', '', ''];
    let take = false;
    let hold = false;
    ARMS.forEach((arms, k) => {
      // rounded so float noise never moves a boundary by a tick (t steps by 0.1)
      const u = (Math.round(((((t - D - k * P) % L) + L) % L) * 1000) / 1000) % L;
      let r = 'cube orc-r';
      if (u < LEAVE) {
        r += ' up';
        if (u >= 1.4 && u < 2.5) r += ' orc-reading';
        if (u >= 2.5) r += ' orc-cut';
      } else if (u < GONE) r += ' up orc-cut orc-sink';
      v['r' + k] = r;
      if (u >= 2.9 && u < 3.9) take = true;
      if (u >= 1.3 && u < BACK) hold = true;
      arms.forEach((a, j) => {
        const e = E0 + GAP * j;
        let c = 'cube orc-f orc-j' + j + ' orc-a' + a;
        if (u >= e - 0.1 && u < GONE) {
          c += ' orc-in';
          if (u >= e) c += ' orc-out';
          if (u >= e + RIDE) c += ' orc-landed';
          if (u >= e + RIDE && u < e + RIDE + 1.6) c += ' orc-fresh';
          if (u >= LEAVE) c += ' orc-away';
        }
        v['f' + k + j] = c;
        if (u >= e - DRAW && u < e) wire[a] = ' orc-on';
        else if (u >= e && u < e + RIDE) wire[a] = ' orc-on orc-ride';
      });
    });
    wire.forEach((w, a) => { v['w' + a] = 'orc-w' + w; });
    v.tower = 'cube tower up' + (take ? ' orc-take' : '') + (hold ? ' orc-hold' : '');
    return v;
  }

  // loop: 290 still: 10.6
  sbx(t) {
    // A 29 s loop in two rounds, all on a fixed beat.
    // 0.4 s   nine sandboxes rise, back to front; each lid shows its ticket, dim (Waiting)
    // 2.0 s   a ticket card is set down in each box, 0.35 s apart, and grows into a blue worker
    // 7-15 s  one result per second: seven land (green), two fail (red, then torn down)
    // 17.4 s  Round 2: only the two failed tickets get fresh sandboxes, run, and land
    // 25.6 s  every sandbox lowers into the floor; an empty grid rests until the seam
    const ORDER = [0, 1, 3, 2, 4, 6, 5, 7, 8]; // back-to-front sweep (box = row * 3 + col)
    const FIN = [4, 0, 8, 3, 2, 6, 1, 7, 5]; // the order results come in, one per second
    const FAILS = [3, 7];
    const TITLE = ['Fee math', 'Due dates', 'Reminders', 'Late fees', 'Tax lines', 'PDF export', 'Refunds', 'Discounts', 'Audit log'];
    const PITCH = 160, ORIGIN = 44, TK = 48, R2 = 17.4;

    const BX = {
      off: 'cube sbx-box', wait: 'cube up sbx-box sbx-w', fall: 'cube up sbx-box sbx-w',
      run: 'cube up sbx-box sbx-r', ok: 'cube up sbx-box sbx-g', done: 'cube up sbx-box sbx-g sbx-d',
      bad: 'cube up sbx-box sbx-x', sink: 'cube up sbx-box sbx-x', down: 'cube sbx-box',
    };
    const TKC = {
      off: 'cube sbx-tk sbx-hide', wait: 'cube sbx-tk sbx-hide', fall: 'cube up sbx-tk sbx-card',
      run: 'cube up sbx-tk sbx-run', ok: 'cube up sbx-tk sbx-ok', done: 'cube up sbx-tk sbx-done',
      bad: 'cube up sbx-tk sbx-bad', sink: 'cube sbx-tk sbx-sink', down: 'cube sbx-tk sbx-down',
    };
    const FL = { run: ' sbx-on', fall: ' sbx-on', ok: ' sbx-glow', done: ' sbx-g', bad: ' sbx-x', sink: ' sbx-x' };

    const boxes = [];
    for (let b = 0; b < 9; b++) {
      const col = b % 3, row = Math.floor(b / 3), k = ORDER.indexOf(b), j = FAILS.indexOf(b);
      const drop = 2.0 + k * 0.35, fin = 7 + FIN.indexOf(b), down = 25.6 + k * 0.12;
      const segs = [[0, 'off'], [0.4 + k * 0.15, 'wait'], [drop, 'fall'], [drop + 0.9, 'run']];
      if (j < 0) segs.push([fin, 'ok'], [fin + 0.7, 'done']);
      else {
        // failed: red, the worker sinks, the sandbox is torn down; Round 2 builds a fresh one
        const r2 = 19.0 + j * 0.35, f2 = 23 + j;
        segs.push([fin, 'bad'], [fin + 1.2, 'sink'], [fin + 2.2, 'off'],
          [18.0 + j * 0.15, 'wait'], [r2, 'fall'], [r2 + 0.9, 'run'], [f2, 'ok'], [f2 + 0.7, 'done']);
      }
      segs.push([down, 'down']);
      let ph = 'off';
      for (const [at, p] of segs) if (t >= at) ph = p;

      const l = ORIGIN + col * PITCH, tp = ORIGIN + row * PITCH;
      boxes.push({
        l, t: tp, tl: l + 60 - TK / 2, tt: tp + 58,
        fl: 'sbx-fl' + (FL[ph] || ''),
        bx: BX[ph], tk: TKC[ph],
        n: 12 + k, title: TITLE[k],
      });
    }
    return {
      boxes,
      // each round's label reads bright for its first seconds, then settles
      r1: 'sbx-rn' + (t >= 0.3 && t < R2 ? ' sbx-on' : '') + (t < 3.2 ? ' sbx-new' : ''),
      r2: 'sbx-rn' + (t >= R2 && t < 26.4 ? ' sbx-on' : '') + (t < R2 + 3.2 ? ' sbx-new' : ''),
    };
  }

  // loop: 170 still: 14.2
  dsg(t) {
    const span = (a, b) => t >= a && t < b;
    // a version of the card: pre (below, hidden), in, out (above, hidden)
    const v = (a, b) => (t < a ? 'pre' : t < b ? 'in' : 'out');
    // chat tiles rise when said and all sink together, oldest first, at the end of the loop
    const said = [0.6, 4.0, 8.2, 11.4, 12.9];
    const sink = 15.6;
    const tile = (i, who) => {
      let c = 'cube dsg-msg ' + who;
      if (span(said[i], sink + 0.08 * i)) c += ' up';
      if (who === 'me' && span(said[i], said[i] + 2.2)) c += ' new';
      return c;
    };
    return {
      draft: 'dsg-draft' + (span(12.0, 15.9) ? ' off' : ''),
      hl: 'dsg-hl' + (span(1.0, 2.6) || span(4.4, 6.6) || span(8.6, 10.2) ? ' on' : ''),
      lock: 'dsg-lock' + (span(12.0, 12.6) ? ' on' : ''),
      title: 'dsg-title ' + v(1.3, sink),
      va: 'dsg-v ' + v(1.3, 4.7),
      vb: 'dsg-v ' + v(4.85, 8.9) + (span(5.7, 10) ? ' k3' : ''),
      vc: 'dsg-v ' + v(9.05, sink),
      m1: tile(0, 'me'), m2: tile(1, 'me'), m3: tile(2, 'me'), m4: tile(3, 'me'), m5: tile(4, 'agent'),
    };
  }

  // loop: 178 still: 8.85
  rev(t) {
    const on = (a, b) => t >= a && t < b;
    // beats: the block stands up into a screen; four clicks, each followed by a capture whose
    // card lifts off the glass and lies down on the stack; the video card goes on top; the
    // screen folds back into the block; the box closes round the stack and ships
    const UP = 0.4, LIVE = 1.6, REC0 = 1.9;
    const S = [2.2, 4.4, 6.6, 8.8];          // each step: the cursor starts moving here
    const F = S.map((s, i) => s + (i === 2 ? 1.65 : 1.45)); // capture flash (the defect step waits for the mark)
    const RECEND = 11.0, VID = 11.2;         // recording stops; the video card appears
    const OFF = 12.6, DOWN = 12.9;           // app fades; the screen folds back into the block
    const BOX = 13.6, LIDUP = 14.1, SHUT = 14.55, LIFT = 15.6, AWAY = 16.0, END = 17.4;

    const v = {};
    v.scr = 'cube rev-scr up' + (on(UP, DOWN) ? ' scr' : '');

    let app = on(LIVE, OFF) ? 'on' : '';
    if (on(S[0] + 0.7, S[2] + 0.7)) app += ' s-drw';
    if (t >= S[1] + 0.65) app += ' s-tog';
    if (t >= S[2] + 0.7) app += ' s-new';
    if (on(S[2] + 1.3, S[3] + 0.1)) app += ' s-bug';
    if (t >= S[3] + 0.65) app += ' s-ovd';
    if (on(S[0] + 0.6, S[0] + 0.8)) app += ' p-new';
    if (on(S[2] + 0.6, S[2] + 0.8)) app += ' p-send';
    v.app = app;

    let k = 0;
    S.forEach((s, i) => { if (t >= s) k = i + 1; });
    const clk = S.some((s) => on(s + 0.6, s + 1.0));
    v.cur = 'rev-cur c' + k + (on(1.9, RECEND - 0.2) ? ' on' : '') + (clk ? ' clk' : '');
    v.vf = 'rev-vf' + (F.some((f) => on(f - 0.35, f + 0.05)) ? ' on' : '');
    v.fl = 'rev-fl' + (F.some((f) => on(f, f + 0.5)) ? ' go' : '');

    // each card: appears on the glass just after its flash, then leaves for the stack
    const states = ['s-drw', 's-drw s-tog', 's-tog s-new s-bug', 's-tog s-new s-ovd', 's-tog s-new s-ovd'];
    const born = F.concat([VID]).map((b, i) => (i < 4 ? b + 0.1 : b));
    v.tiles = states.map((st, i) => ({
      fly: 'rev-fly k' + i + (i === 4 ? ' vid' : '') + (on(born[i] + 0.45, END) ? ' go' : ''),
      cls: 'cube rev-tile' + (on(born[i], END) ? ' up' : '') + (t >= SHUT + 0.8 ? ' hid' : ''),
      app: st,
    }));
    v.pad = 'rev-pad' + (on(F[0], LIFT) ? ' on' : '');

    v.box = 'cube rev-box' + (on(BOX, END) ? ' up' : '') + (on(LIDUP, END) ? ' lidup' : '') + (on(SHUT, END) ? ' shut' : '') +
      (on(LIFT, END) ? ' lift' : '') + (on(AWAY, END) ? ' away' : '');

    const secs = Math.max(0, Math.floor(Math.min(t, RECEND) - REC0));
    v.rec = 'rev-rec' + (on(REC0, RECEND) ? ' on' : '');
    v.time = 'REC 0:' + String(Math.min(secs, 59)).padStart(2, '0');
    return v;
  }

  // loop: 120 still: 11.2
  drv(t) {
    // three 4 s slots, one per scenario. In each: the row is pressed, a line draws
    // from the list to the screen's foot, a chip rides it (the line retracting
    // behind), and as the chip reaches the screen the new state wipes up the face.
    const SLOT = 4, P = 0.5, DRAW = 0.7, SHOW = 0.75, GO = 1.25;
    const DUR = [0.78, 0.93, 1.08]; // path length / 280 px per s: one speed for every row
    const k = Math.floor(t / SLOT) % 3;
    const u = t - k * SLOT;
    const prev = (k + 2) % 3;
    const arr = GO + DUR[k];
    const v = {};
    for (let i = 0; i < 3; i++) {
      let r = 'cube drv-row r' + i + ' up';
      if (i === k && u >= P) r += u < P + 0.2 ? ' sel down' : ' sel';
      else if (i === prev && u < P) r += ' sel';
      v['r' + i] = r;
      let l = 'drv-ln l' + i;
      if (i === k && u >= DRAW && u < GO) l += ' draw';
      else if (i === k && u >= GO && u < arr + 0.05) l += ' draw ret';
      v['l' + i] = l;
    }
    let c = 'cube drv-chip p' + k;
    if (u >= SHOW && u < GO) c += ' up';
    else if (u >= GO && u < arr) c += ' up go';
    else if (u >= arr && u < arr + 0.45) c += ' go';
    v.chip = c;
    const top = u >= arr ? k : prev;
    const under = (top + 2) % 3;
    for (let i = 0; i < 3; i++) v['s' + i] = 'drv-lay' + (i === top ? ' top' : i === under ? ' under' : '');
    v.edge = 'drv-edge' + (u >= arr && u < arr + 0.9 ? ' go' : '');
    return v;
  }

  // loop: 160 still: 5.2
  nts(t) {
    const span = (a, b) => t >= a && t < b;
    // capture: the bug is marked, Ctrl J goes down, the note box opens on the page, then the note settles in its slot
    const C = [0.6, 2.1, 3.6];
    const texts = ['Logo is missing', 'Support row is off', 'Total drops a line'];
    // triage: the line from the slots draws, then the three notes ride it into the block.
    // Each note hides once it is fully inside the block (the first one would come out the far side).
    const TL = 5.6;
    const TM = 6.1;
    const TD = 1.4;
    const hide = [0.7, 1.0, 1.3];
    // routing: note i goes to bug i, in the order they were noticed
    const route = ['A', 'B', 'C'];
    const start = { A: 8.1, B: 10.4, C: 11.6 };
    const dur = { A: 1.6, B: 0.9, C: 1.5 };
    const go = (r) => start[r] + 0.5;
    const arrive = (r) => go(r) + dur[r];
    // the seam: the fixed page rests, fades out, comes back as it was at t = 0
    const END = 14.9;
    const RESET = 15.4;

    let cur = -1;
    C.forEach((c, i) => { if (t >= c) cur = i; });
    const c = cur >= 0 ? C[cur] : 0;
    const open = cur >= 0 && span(c + 0.55, c + 1.4);
    let text = '';
    if (cur >= 0 && t < c + 1.9) {
      const f = Math.max(0, Math.min(1, (t - (c + 0.8)) / 0.4));
      text = texts[cur].slice(0, Math.round(texts[cur].length * f));
    }
    const pressed = C.some((x) => span(x + 0.5, x + 0.75));

    const fixed = route.map((r) => t >= arrive(r) && t < RESET);
    const mk = (i) => {
      const r = route[i];
      let s = 'nts-mk k' + i;
      if (t >= C[i] && t < END) s += ' on';
      if (fixed[i]) s += ' fx';
      if (t >= arrive(r) + 0.8) s += ' out';
      return s;
    };

    const notes = [0, 1, 2].map((i) => {
      const r = route[i];
      let cls = 'cube nts-tile';
      if (t >= C[i] + 1.4 && t < arrive(r) + 0.1) {
        cls += ' in';
        if (span(TM, TM + TD + 0.2)) cls += ' tr' + (t >= TM + hide[i] ? ' hd' : '');
        else if (t >= TM + TD + 0.2) cls += ' r' + r + (t >= go(r) ? ' go' : '');
      }
      return { cls, o: 88 - 44 * i };
    });

    const line = (r) => {
      if (span(start[r], go(r))) return 'l' + r + ' dr';
      if (span(go(r), arrive(r) + 0.1)) return 'l' + r + ' rt';
      return 'l' + r;
    };

    return {
      ui: 'nts-ui' + (fixed[0] ? ' f0' : '') + (fixed[1] ? ' f1' : '') + (fixed[2] ? ' f2' : '') + (t >= END ? ' dim' : ''),
      m0: mk(0),
      m1: mk(1),
      m2: mk(2),
      pal: 'nts-pal' + (open ? ' on' : ''),
      field: 'nts-fld' + (text === '' ? ' ph' : ''),
      text: text === '' ? 'What did you just notice?' : text,
      k1: 'cube key up' + (pressed ? ' down' : ''),
      k2: 'cube key up' + (pressed ? ' down' : ''),
      tower: 'cube tower up' + (span(7.5, 8.2) ? ' lit' : ''),
      lT: span(TL, TM) ? 'lT dr' : span(TM, TM + TD + 0.1) ? 'lT rt' : 'lT',
      lA: line('A'),
      lB: line('B'),
      lC: line('C'),
      notes,
    };
  }

  // loop: 120 still: 9.0
  phn(t) {
    const span = (a, b) => t >= a && t < b;
    // the reply, typed at ~17 characters a second
    const reply = 'Looks good. Build it.';
    const T0 = 5.4;
    const n = t < T0 ? 0 : Math.min(reply.length, Math.floor((t - T0) * 17) + 1);
    const typing = span(5.2, 6.9);
    const reset = 11.4; // everything returns to the start under the dark glass
    return {
      // 0.5 the orchestrator lights (something for you); 8.3 it glows (the feature starts working)
      base: 'cube tower up' + (span(0.5, 1.3) ? ' phn-lit' : '') + (span(8.3, 9.9) ? ' phn-glow' : ''),
      // 0.9 out along the wire, 7.1 the answer back; 1.2 s each
      pulse: span(0.9, 2.3) ? 'phn-pulse go' : span(7.1, 8.5) ? 'phn-pulse back' : 'phn-pulse',
      // 2.1 the screen wakes; 10.6 it sleeps
      sleep: 'phn-sleep' + (span(2.1, 10.6) ? ' wake' : ''),
      // 2.35 the notification arrives; 3.75 a tap; 4.0 the chat opens
      ban: 'phn-ban' + (span(2.35, reset) ? ' on' : '') + (span(3.75, reset) ? ' press' : ''),
      lock: 'phn-lock' + (span(4.0, reset) ? ' open' : ''),
      app: 'phn-app-ui' + (span(4.0, reset) ? ' on' : ''),
      // 5.2 the composer takes focus, 5.4 typing, 6.9 sent
      comp: 'phn-comp' + (typing ? ' ty' : '') + (typing && n > 0 ? ' full' : ''),
      typed: t < reset ? reply.slice(0, n) : '',
      you: 'phn-you' + (span(6.9, reset) ? ' on' : ''),
      // 8.3 the answer reaches the orchestrator: the feature is working
      stat: 'phn-stat' + (span(8.3, reset) ? ' work' : ''),
    };
  }

  renderVals() {
    const s = this.state;
    const theme = this.props.theme ?? 'dark';
    const motion = (this.props.motion ?? true) && !this.reduced;
    const c = s.clock;
    const at = (loop, still) => (motion ? (c % loop) / 10 : still);
    const cmds = {
      unix: 'curl -fsSL https://runcastle.dev/install.sh | bash',
      win: 'irm https://runcastle.dev/install.ps1 | iex',
    };
    const cmd = cmds[s.os];
    const on = (yes, base) => (yes ? base + ' on' : base);
    const lit = {};
    // seen -> 'lit' (the light comes up); RISE ticks later -> 'lit on' (power on, clock starts at 0)
    const RISE = 16;
    const onAt = (k) => (s.litAt[k] === undefined ? Infinity : s.litAt[k] + RISE);
    ['orc', 'sbx', 'dsg', 'rev', 'drv', 'nts', 'phn'].forEach((k) => { lit[k] = !motion ? 'lit on' : s.litAt[k] === undefined ? '' : c >= onAt(k) ? 'lit on' : 'lit'; });
    // a section's own time: frozen at 0 (its OFF frame) until on, then counting from that moment
    const sec = (k, loop, still) => (!motion ? still : c < onAt(k) ? 0 : ((c - onAt(k)) % loop) / 10);
    return {
      rootClass: 'rc' + (theme === 'light' ? ' light' : '') + (motion ? '' : ' still'),
      h: this.hero(at(180, 13.0)),
      qr: this.qr,
      lit,
      endCls: 'close sec' + (!motion || s.litAt.end !== undefined ? ' lit' : ''),
      orc: this.orc(sec('orc', 300, 17.5)),
      sbx: this.sbx(sec('sbx', 290, 10.6)),
      dsg: this.dsg(sec('dsg', 170, 14.2)),
      rev: this.rev(sec('rev', 178, 8.85)),
      drv: this.drv(sec('drv', 120, 11.2)),
      nts: this.nts(sec('nts', 160, 5.2)),
      phn: this.phn(sec('phn', 120, 9.0)),
      unixCls: on(s.os === 'unix', 'os-btn'),
      winCls: on(s.os === 'win', 'os-btn'),
      unixPressed: s.os === 'unix' ? 'true' : 'false',
      winPressed: s.os === 'win' ? 'true' : 'false',
      setUnix: () => this.setState({ os: 'unix', copied: false }),
      setWin: () => this.setState({ os: 'win', copied: false }),
      promptChar: s.os === 'unix' ? '$' : '>',
      cmd,
      copyLabel: s.copied ? 'Copied' : 'Copy',
      copyCls: 'cp' + (s.copied ? ' done' : ''),
      copyBtn: 'cmd-cp' + (s.copied ? ' done' : ''),
      copy: () => {
        try { navigator.clipboard.writeText(cmd); } catch (e) {}
        this.setState({ copied: true });
        clearTimeout(this.copyTimer);
        this.copyTimer = setTimeout(() => this.setState({ copied: false }), 1600);
      },
    };
  }
}

// ---- binder: re-evaluates the component and patches the bound attributes and text ----
const comp = new Component({});
const look = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const binds = [];
document.querySelectorAll('*').forEach((el) => {
  for (const a of Array.from(el.attributes)) {
    if (a.name.startsWith('data-b-')) binds.push([el, a.name.slice(7), a.value.replace(/\[\[/g, '{{').replace(/\]\]/g, '}}')]);
    else if (a.name.startsWith('data-on-')) { const ev = a.name.slice(8), key = a.value; el.addEventListener(ev, (e) => { const f = vals && look(vals, key); if (typeof f === 'function') f(e); }); }
  }
});
const texts = Array.from(document.querySelectorAll('[data-t]')).map((el) => [el, el.getAttribute('data-t')]);
let vals = null, queued = false;
const fill = (t) => t.replace(/\{\{([^}]+)\}\}/g, (_, p) => { const v = look(vals, p.trim()); return typeof v === 'function' ? '' : String(v == null ? '' : v); });
function render() {
  queued = false;
  vals = comp.renderVals();
  for (const [el, attr, t] of binds) { const v = fill(t); if (el.getAttribute(attr) !== v) el.setAttribute(attr, v); }
  for (const [el, p] of texts) { const v = look(vals, p); const s = String(v == null ? '' : v); if (el.textContent !== s) el.textContent = s; }
}
schedule = () => { if (!queued) { queued = true; requestAnimationFrame(render); } };
render();
if (comp.componentDidMount) comp.componentDidMount();
})();

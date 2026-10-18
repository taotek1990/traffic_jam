(function () {
  'use strict';
  const TJ = window.TJ;
  const P = TJ.PARAMS;
  const $ = (s) => document.querySelector(s);
  const SAVE_KEY = 'zielona-fala-v1';

  const app = (TJ.app = {
    mode: 'plan', // 'plan' | 'sim'
    map: null,
    rules: TJ.newRules(),
    sim: null,
    seed: 1,
    size: 'medium',
    tool: 'select',
    selected: null,
    hoverSlot: null,
    previewPhase: -1,
    playing: true,
    speed: 1,
    level: 4,
    colorBySpeed: false,
  });

  const renderer = new TJ.Renderer($('#view'));
  const params = new URLSearchParams(location.search);

  // ------------------------------------------------------------ zapis
  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ v: TJ.MAP_VERSION, seed: app.seed, size: app.size, rules: app.rules, level: app.level }));
    } catch (e) { /* brak dostępu do localStorage */ }
  }

  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (d && d.v === TJ.MAP_VERSION && d.rules && d.rules.signs && d.rules.noentry && d.rules.signals) return d;
    } catch (e) { /* ignoruj */ }
    return null;
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.h);
    toast.h = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ------------------------------------------------------------ mapa
  function setMap(seed, size, rules) {
    app.seed = seed;
    app.size = size;
    app.map = TJ.generateMap(seed, size);
    app.rules = rules || TJ.newRules();
    app.selected = null;
    app.hoverSlot = null;
    app.previewPhase = -1;
    app.sim = null;
    app.mode = 'plan';
    $('#seed').value = seed;
    $('#size').value = size;
    renderer.resize();
    renderer.fit(app.map);
    refreshMode();
    onRulesChanged();
  }

  function randomSeed() {
    return 100000 + Math.floor(Math.random() * 900000);
  }

  // ------------------------------------------------------------ tryby
  function setMode(m) {
    if (m === 'sim') {
      app.sim = new TJ.Sim(app.map, app.rules, { seed: app.seed, level: app.level });
      app.playing = true;
    } else app.sim = null;
    app.mode = m;
    app.hoverSlot = null;
    app.previewPhase = -1;
    refreshMode();
    renderInspector();
    updateStats();
  }

  function refreshMode() {
    const sim = app.mode === 'sim';
    $('#btn-plan').classList.toggle('active', !sim);
    $('#btn-sim').classList.toggle('active', sim);
    $('#panel-plan').hidden = sim;
    $('#panel-sim').hidden = !sim;
    $('#btn-new').disabled = sim;
    $('#seed').disabled = sim;
    $('#size').disabled = sim;
    $('#sim-play').textContent = app.playing ? 'Pauza' : 'Wznów';
    renderer.cv.style.cursor = '';
  }

  function onRulesChanged() {
    const r = TJ.reachability(app.map, app.rules);
    const el = $('#reach');
    const pct = Math.round(r.ratio * 100);
    el.textContent = 'Osiągalne trasy: ' + pct + '%';
    el.className = 'reach ' + (pct === 100 ? 'ok' : pct >= 60 ? 'mid' : 'bad');
    el.title = 'Odsetek par bram (wjazd → wyjazd), między którymi da się dojechać przy aktualnych znakach zakazu i nakazu';
    renderInspector();
    save();
  }

  // ------------------------------------------------------------ narzędzia
  function buildTools() {
    const box = $('#tools');
    const items = [{ id: 'select', code: '', name: 'Wybierz skrzyżowanie' }].concat(TJ.SIGNS, [{ id: 'erase', code: '', name: 'Gumka (zdejmij znak)' }]);
    box.innerHTML = '';
    for (const it of items) {
      const b = document.createElement('button');
      b.className = 'tool';
      b.dataset.tool = it.id;
      b.title = (it.code ? it.code + ' – ' : '') + it.name;
      const c = document.createElement('canvas');
      c.width = c.height = 52;
      const ctx = c.getContext('2d');
      if (TJ.SIGN_BY_ID[it.id]) TJ.drawSign(ctx, it.id, 26, 26, 48);
      else {
        ctx.fillStyle = '#cfd6df';
        ctx.font = 'bold 30px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(it.id === 'select' ? '☝' : '✕', 26, 28);
      }
      const s = document.createElement('span');
      s.innerHTML = (it.code ? '<b>' + it.code + '</b> ' : '') + it.name;
      b.appendChild(c);
      b.appendChild(s);
      b.addEventListener('click', () => setTool(it.id));
      box.appendChild(b);
    }
    setTool('select');
  }

  function setTool(id) {
    app.tool = id;
    app.hoverSlot = null;
    document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === id));
    renderer.cv.style.cursor = id === 'select' ? '' : 'crosshair';
    const hint = $('#tool-hint');
    if (id === 'select') hint.textContent = 'Kliknij skrzyżowanie, aby zaprogramować sygnalizację.';
    else if (id === 'erase') hint.textContent = 'Kliknij znak na mapie, aby go zdjąć (PPM też zdejmuje).';
    else {
      const d = TJ.SIGN_BY_ID[id];
      hint.textContent = d.slot === 'in'
        ? 'Kliknij miejsce przy ramieniu skrzyżowania po stronie wjazdu na skrzyżowanie.'
        : 'Kliknij miejsce przy ramieniu po stronie wyjazdu – auta nie wjadą w tę ulicę ze skrzyżowania.';
    }
  }

  // ------------------------------------------------------------ mysz
  function findNode(w) {
    let best = null, bd = Infinity;
    for (const n of app.map.junctions) {
      const d = Math.hypot(n.x - w.x, n.y - w.y);
      if (d < n.R + 16 && d < bd) { bd = d; best = n; }
    }
    return best;
  }

  function findSlot(w, any) {
    const thr = Math.max(20, 16 / renderer.cam.k);
    const def = TJ.SIGN_BY_ID[app.tool];
    let kinds;
    if (any || app.tool === 'erase') kinds = ['inn', 'out'];
    else if (def) kinds = [def.slot === 'in' ? 'inn' : 'out'];
    else return null;
    let best = null, bd = thr;
    for (const n of app.map.junctions) {
      for (const arm of n.arms) {
        const sl = TJ.armSlots(n, arm);
        for (const kind of kinds) {
          const d = Math.hypot(sl[kind].x - w.x, sl[kind].y - w.y);
          if (d < bd) { bd = d; best = { node: n, arm, kind }; }
        }
      }
    }
    return best;
  }

  function clearSlot(s) {
    if (s.kind === 'inn') delete app.rules.signs[s.arm.in.id];
    else delete app.rules.noentry[s.arm.out.id];
    onRulesChanged();
  }

  function applyTool(s) {
    if (app.tool === 'erase') return clearSlot(s);
    if (app.tool === 'noentry') {
      const id = s.arm.out.id;
      if (app.rules.noentry[id]) delete app.rules.noentry[id];
      else app.rules.noentry[id] = true;
    } else {
      const id = s.arm.in.id;
      if (app.rules.signs[id] === app.tool) delete app.rules.signs[id];
      else app.rules.signs[id] = app.tool;
      const prog = app.rules.signals[s.node.id];
      if (prog && prog.enabled && (app.tool === 'yield' || app.tool === 'stop' || app.tool === 'priority')) {
        toast('Na skrzyżowaniu z sygnalizacją znaki pierwszeństwa są pomijane.');
      }
    }
    onRulesChanged();
  }

  function select(n) {
    app.selected = n;
    app.previewPhase = -1;
    renderInspector();
  }

  function bindCanvas() {
    const cv = renderer.cv;
    let drag = null;
    let pinch = null;
    const local = (x, y) => {
      const r = cv.getBoundingClientRect();
      return { x: x - r.left, y: y - r.top };
    };

    function dragStart(x, y, button) {
      drag = { x, y, lx: x, ly: y, moved: false, button };
    }
    function dragMove(x, y) {
      if (!drag) return;
      if (!drag.moved && Math.hypot(x - drag.x, y - drag.y) > 5) drag.moved = true;
      if (drag.moved) {
        renderer.pan(x - drag.lx, y - drag.ly);
        cv.style.cursor = 'grabbing';
      }
      drag.lx = x;
      drag.ly = y;
    }
    function dragEnd(x, y) {
      if (!drag) return;
      const d = drag;
      drag = null;
      cv.style.cursor = app.tool === 'select' ? '' : 'crosshair';
      if (d.moved) return;
      const p = local(x, y);
      const w = renderer.toWorld(p.x, p.y);
      if (app.mode === 'plan' && d.button === 2) {
        const s = findSlot(w, true);
        if (s) clearSlot(s);
        return;
      }
      if (d.button !== 0) return;
      if (app.mode === 'plan' && app.tool !== 'select') {
        const s = findSlot(w);
        if (s) return applyTool(s);
      }
      select(findNode(w));
    }

    cv.addEventListener('contextmenu', (e) => e.preventDefault());

    // mysz i rysik – zdarzenia wskaźnika
    cv.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* np. zdarzenia syntetyczne */ }
      dragStart(e.clientX, e.clientY, e.button);
    });
    cv.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      if (drag) return dragMove(e.clientX, e.clientY);
      if (app.mode === 'plan' && app.tool !== 'select') {
        const p = local(e.clientX, e.clientY);
        app.hoverSlot = findSlot(renderer.toWorld(p.x, p.y));
      }
    });
    cv.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'touch') dragEnd(e.clientX, e.clientY);
    });
    cv.addEventListener('pointercancel', (e) => {
      if (e.pointerType !== 'touch') drag = null;
    });
    cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') app.hoverSlot = null; });

    // dotyk – zdarzenia dotyku (Firefox mobilny sam przejmuje szczypanie ze zdarzeń wskaźnika)
    const pinchState = (t) => {
      const a = local(t[0].clientX, t[0].clientY), b = local(t[1].clientX, t[1].clientY);
      return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
    };
    cv.addEventListener('touchstart', (e) => {
      e.preventDefault();
      app.hoverSlot = null;
      if (e.touches.length >= 2) {
        // drugi palec: tryb szczypania, bieżące przeciąganie i stuknięcie są anulowane
        drag = null;
        pinch = pinchState(e.touches);
      } else {
        pinch = null;
        dragStart(e.touches[0].clientX, e.touches[0].clientY, 0);
      }
    }, { passive: false });
    cv.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (e.touches.length >= 2) {
        const p = pinchState(e.touches);
        if (pinch) {
          renderer.pan(p.cx - pinch.cx, p.cy - pinch.cy);
          renderer.zoomAt(p.cx, p.cy, p.dist / pinch.dist);
        }
        pinch = p;
      } else if (e.touches.length === 1) {
        dragMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: false });
    cv.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (e.touches.length < 2) pinch = null;
      const t = e.changedTouches[0];
      if (e.touches.length === 0 && t) dragEnd(t.clientX, t.clientY);
    }, { passive: false });
    cv.addEventListener('touchcancel', () => { drag = null; pinch = null; });

    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = local(e.clientX, e.clientY);
      renderer.zoomAt(p.x, p.y, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });
  }

  // ------------------------------------------------------------ inspektor skrzyżowania
  function currentRules() {
    return app.mode === 'sim' && app.sim ? app.sim.rules : app.rules;
  }

  function renderInspector() {
    const el = $('#inspector');
    const n = app.selected;
    if (!n) {
      el.innerHTML = '<p class="hint">Nie wybrano skrzyżowania. Kliknij je na mapie' + (app.mode === 'plan' ? ', aby zaprogramować sygnalizację.' : ', aby zobaczyć fazy świateł.') + '</p>';
      return;
    }
    const ro = app.mode === 'sim';
    const rules = currentRules();
    const prog = rules.signals[n.id];
    let h = '<div class="insp-head"><b>Skrzyżowanie #' + n.id + '</b><span>' + n.arms.length + ' ramiona</span></div>';

    h += '<div class="arms">';
    for (const arm of n.arms) {
      const tags = [];
      const sId = rules.signs[arm.in.id];
      if (sId) tags.push(tagBtn(arm, 'inn', TJ.SIGN_BY_ID[sId].code, ro));
      if (rules.noentry[arm.out.id]) tags.push(tagBtn(arm, 'out', 'B-2', ro));
      h += '<div class="arm"><span class="badge">' + arm.label + '</span><span class="lanes">' + arm.out.lanes + ' ' + (arm.out.lanes === 1 ? 'pas' : arm.out.lanes < 5 ? 'pasy' : 'pasów') + '</span>' + tags.join('') + '</div>';
    }
    h += '</div>';

    h += '<label class="switch"><input type="checkbox" data-act="sig-toggle"' + (prog && prog.enabled ? ' checked' : '') + (ro ? ' disabled' : '') + '> Sygnalizacja świetlna</label>';
    if (prog && prog.enabled) {
      const T = Math.round(TJ.cycleLen(prog));
      h += '<div class="cycle">Cykl: <b>' + T + ' s</b> · w każdej fazie żółte ' + P.YELLOW + ' s + wszystkie czerwone ' + P.ALLRED + ' s</div>';
      h += '<label class="offset">Przesunięcie cyklu (zielona fala): <b id="off-v">' + prog.offset + ' s</b>' +
        '<input type="range" min="0" max="' + Math.max(1, T) + '" step="1" value="' + prog.offset + '" data-act="offset"' + (ro ? ' disabled' : '') + '></label>';
      h += '<canvas id="timeline"></canvas>';
      const missing = n.arms.filter((a) => !prog.phases.some((ph) => ph.green.indexOf(a.in.id) >= 0));
      if (missing.length) h += '<p class="warn">Ramię ' + missing.map((a) => a.label).join(', ') + ' nigdy nie dostaje zielonego światła.</p>';
      prog.phases.forEach((ph, i) => {
        h += '<div class="phase" data-ph="' + i + '"><div class="ph-h"><b>Faza ' + (i + 1) + '</b>';
        if (!ro) {
          h += '<span class="dur"><button data-act="dur" data-ph="' + i + '" data-d="-1">−</button><b>' + ph.dur + ' s</b><button data-act="dur" data-ph="' + i + '" data-d="1">+</button></span>' +
            '<button class="x" title="Usuń fazę" data-act="del-ph" data-ph="' + i + '">×</button>';
        } else h += '<span class="dur"><b>' + ph.dur + ' s</b></span>';
        h += '</div><div class="chips">';
        n.arms.forEach((a) => {
          const on = ph.green.indexOf(a.in.id) >= 0;
          h += '<button class="chip' + (on ? ' on' : '') + '" data-act="chip" data-ph="' + i + '" data-arm="' + a.idx + '"' + (ro ? ' disabled' : '') + '>' + a.label + '</button>';
        });
        h += '</div></div>';
      });
      if (!ro) h += '<div class="row"><button data-act="add-ph">+ Faza</button><button data-act="auto">Program automatyczny</button></div>';
    } else if (!ro) {
      h += '<p class="hint">Włącz sygnalizację, aby ustawić fazy świateł. Bez niej obowiązują znaki albo zasada prawej ręki.</p>';
    }
    el.innerHTML = h;
    drawTimeline();
  }

  function tagBtn(arm, kind, code, ro) {
    return '<button class="tag" ' + (ro ? 'disabled ' : '') + 'title="Zdejmij znak" data-act="rm-sign" data-arm="' + arm.idx + '" data-kind="' + kind + '">' + code + (ro ? '' : ' ×') + '</button>';
  }

  function drawTimeline() {
    const cv = $('#timeline');
    const n = app.selected;
    if (!cv || !n) return;
    const prog = currentRules().signals[n.id];
    if (!prog || !prog.enabled) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth || 280;
    const rowH = 14;
    const h = n.arms.length * rowH + 4;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.style.height = h + 'px';
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const T = TJ.cycleLen(prog);
    const x0 = 18, bw = w - x0 - 2;
    const COL = { G: '#2ee86a', Y: '#ffd23a', R: '#d6403f' };
    n.arms.forEach((a, k) => {
      const y = k * rowH + 2;
      ctx.fillStyle = '#cfd6df';
      ctx.font = 'bold 10px Arial, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(a.label, 3, y + 5.5);
      for (let px = 0; px < bw; px++) {
        ctx.fillStyle = COL[TJ.armSignal(prog, a.in.id, ((px + 0.5) / bw) * T - prog.offset)];
        ctx.fillRect(x0 + px, y, 1.2, 11);
      }
    });
    if (app.mode === 'sim' && app.sim && T > 0) {
      const cx = x0 + (((app.sim.t % T) + T) % T) / T * bw;
      ctx.fillStyle = '#fff';
      ctx.fillRect(cx - 1, 0, 2, h);
    }
  }

  function bindInspector() {
    const el = $('#inspector');
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || app.mode !== 'plan' || !app.selected) return;
      const n = app.selected;
      const act = b.dataset.act;
      let prog = app.rules.signals[n.id];
      if (act === 'sig-toggle') {
        if (!prog) app.rules.signals[n.id] = TJ.autoProgram(n);
        else prog.enabled = !prog.enabled;
      } else if (act === 'rm-sign') {
        const arm = n.arms[+b.dataset.arm];
        if (b.dataset.kind === 'inn') delete app.rules.signs[arm.in.id];
        else delete app.rules.noentry[arm.out.id];
      } else if (!prog) return;
      else if (act === 'chip') {
        const ph = prog.phases[+b.dataset.ph];
        const id = n.arms[+b.dataset.arm].in.id;
        const k = ph.green.indexOf(id);
        if (k >= 0) ph.green.splice(k, 1);
        else ph.green.push(id);
      } else if (act === 'dur') {
        const ph = prog.phases[+b.dataset.ph];
        ph.dur = TJ.clamp(ph.dur + +b.dataset.d, 3, 90);
      } else if (act === 'del-ph') prog.phases.splice(+b.dataset.ph, 1);
      else if (act === 'add-ph') prog.phases.push({ green: [], dur: 10 });
      else if (act === 'auto') app.rules.signals[n.id] = TJ.autoProgram(n);
      onRulesChanged();
    });
    el.addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset.act !== 'offset' || !app.selected || app.mode !== 'plan') return;
      const prog = app.rules.signals[app.selected.id];
      prog.offset = +t.value;
      $('#off-v').textContent = prog.offset + ' s';
      drawTimeline();
      save();
    });
    el.addEventListener('mouseover', (e) => {
      const ph = e.target.closest('.phase');
      if (ph && app.mode === 'plan') app.previewPhase = +ph.dataset.ph;
    });
    el.addEventListener('mouseleave', () => { app.previewPhase = -1; });
  }

  // ------------------------------------------------------------ statystyki symulacji
  const STAT_DEFS = [
    ['t', 'Czas symulacji', (s) => fmtTime(s.t)],
    ['cars', 'Auta na mapie', (s) => s.cars],
    ['arrived', 'Dojechało', (s) => s.arrived],
    ['flow', 'Przepustowość /min', (s) => s.flow.toFixed(0)],
    ['avgTravel', 'Śr. czas przejazdu', (s) => s.avgTravel.toFixed(0) + ' s'],
    ['avgDelay', 'Śr. opóźnienie', (s) => s.avgDelay.toFixed(0) + ' s'],
    ['fluency', 'Płynność ruchu', (s) => Math.round(s.fluency * 100) + '%'],
    ['stuck', 'Stoi w korku >30 s', (s) => s.stuck],
    ['queue', 'Czeka przed mapą', (s) => s.queue],
    ['abandoned', 'Porzucone przez kierowców', (s) => s.abandoned],
    ['noRoute', 'Auta bez trasy', (s) => s.noRoute],
  ];

  function fmtTime(t) {
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function buildStats() {
    $('#stats').innerHTML = STAT_DEFS.map((d) => '<div class="stat" id="st-' + d[0] + '"><span>' + d[1] + '</span><b>–</b></div>').join('');
  }

  function updateStats() {
    if (app.mode !== 'sim' || !app.sim) return;
    const s = app.sim.summary();
    for (const d of STAT_DEFS) $('#st-' + d[0] + ' b').textContent = d[2](s);
    const f = $('#st-fluency');
    f.className = 'stat ' + (s.fluency >= 0.75 ? 'good' : s.fluency >= 0.45 ? 'mid' : 'bad');
    $('#st-stuck').className = 'stat ' + (s.stuck > 0 ? 'bad' : '');
    $('#st-queue').className = 'stat ' + (s.queue > 12 ? 'bad' : '');
  }

  // ------------------------------------------------------------ sterowanie
  function bindControls() {
    $('#btn-plan').addEventListener('click', () => app.mode !== 'plan' && setMode('plan'));
    $('#btn-sim').addEventListener('click', () => app.mode !== 'sim' && setMode('sim'));
    $('#btn-fit').addEventListener('click', () => renderer.fit(app.map));
    $('#btn-focus').addEventListener('click', toggleFocus);
    $('#btn-new').addEventListener('click', () => {
      const seed = randomSeed();
      setMap(seed, $('#size').value);
    });
    $('#seed').addEventListener('change', () => {
      const v = $('#seed').value.trim();
      if (v) setMap(TJ.seedFrom(v), app.size);
    });
    $('#size').addEventListener('change', () => setMap(app.seed, $('#size').value));
    $('#btn-clear').addEventListener('click', () => {
      app.rules = TJ.newRules();
      onRulesChanged();
      toast('Wyczyszczono znaki i sygnalizację.');
    });
    $('#sim-play').addEventListener('click', togglePlay);
    $('#sim-restart').addEventListener('click', () => setMode('sim'));
    document.querySelectorAll('#speed button').forEach((b) =>
      b.addEventListener('click', () => {
        app.speed = +b.dataset.v;
        markSpeed();
      }));
    $('#level').addEventListener('input', () => {
      app.level = +$('#level').value;
      $('#level-v').textContent = app.level;
      if (app.sim) app.sim.level = app.level;
      save();
    });
    $('#by-speed').addEventListener('change', () => (app.colorBySpeed = $('#by-speed').checked));
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
      if (e.code === 'Space' && app.mode === 'sim') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'Escape') setTool('select');
      else if (e.key === 'f' || e.key === 'F') toggleFocus();
    });
    window.addEventListener('resize', () => renderer.resize());
  }

  // widok samej mapy: chowa górne menu i panel boczny / dolny, środek widoku zostaje w tym samym miejscu
  function toggleFocus() {
    const c = renderer.toWorld(renderer.w / 2, renderer.h / 2);
    const on = document.body.classList.toggle('focus');
    $('#btn-focus').textContent = on ? '✕' : '⤢';
    renderer.resize();
    renderer.cam.x = c.x - renderer.w / 2 / renderer.cam.k;
    renderer.cam.y = c.y - renderer.h / 2 / renderer.cam.k;
  }

  function togglePlay() {
    app.playing = !app.playing;
    $('#sim-play').textContent = app.playing ? 'Pauza' : 'Wznów';
  }

  function markSpeed() {
    document.querySelectorAll('#speed button').forEach((b) => b.classList.toggle('active', +b.dataset.v === app.speed));
  }

  // ------------------------------------------------------------ pętla
  TJ.fastForward = function (sec) {
    if (!app.sim) return;
    for (let i = 0, n = Math.round(sec / P.H); i < n; i++) app.sim.step(P.H);
  };

  let last = performance.now(), acc = 0, statT = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (app.mode === 'sim' && app.sim && app.playing) {
      acc += dt * app.speed;
      let n = 0;
      while (acc >= P.H && n < 40) {
        app.sim.step(P.H);
        acc -= P.H;
        n++;
      }
      if (n >= 40) acc = 0;
    }
    renderer.draw(app);
    statT += dt;
    if (statT > 0.25) {
      statT = 0;
      updateStats();
      if (app.mode === 'sim') drawTimeline();
    }
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------ start
  function init() {
    buildTools();
    buildStats();
    bindCanvas();
    bindInspector();
    bindControls();
    renderer.resize();

    const saved = load();
    let seed, size, rules = null;
    if (params.has('seed')) {
      seed = TJ.seedFrom(params.get('seed'));
      size = params.get('size') || 'medium';
    } else if (saved) {
      seed = saved.seed;
      size = saved.size;
      rules = saved.rules;
    } else {
      seed = randomSeed();
      size = 'medium';
    }
    if (saved && saved.level) app.level = saved.level;
    if (params.has('level')) app.level = +params.get('level') || app.level;
    $('#level').value = app.level;
    $('#level-v').textContent = app.level;
    if (params.has('speed')) app.speed = +params.get('speed') || 1;
    markSpeed();
    if (!TJ.SIZES[size]) size = 'medium';
    setMap(seed, size, rules);

    if (params.get('mode') === 'sim') {
      setMode('sim');
      if (params.has('ff')) TJ.fastForward(+params.get('ff'));
    }
    requestAnimationFrame(frame);
  }

  TJ.ui = { setMode, setTool, select, onRulesChanged, setMap, toast, renderer };
  init();
})();

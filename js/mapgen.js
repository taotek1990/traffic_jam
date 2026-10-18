(function () {
  'use strict';
  const TJ = window.TJ;
  const W = TJ.C.LANE_W;

  const SIZES = {
    // extra – szansa na dodatkowy odcinek ponad drzewo rozpinające (cykle = więcej skrzyżowań),
    // trim – szansa na usunięcie brzegowego zakrętu (zamiast dodawać bramę), diag – szansa na skos, gates – docelowa liczba bram
    small: { cols: 3, rows: 3, extra: 0.25, trim: 0.35, diag: 0, gates: 4 },
    medium: { cols: 5, rows: 4, extra: 0.6, trim: 0.2, diag: 0.05, gates: 9 },
    large: { cols: 6, rows: 5, extra: 0.7, trim: 0.2, diag: 0.06, gates: 11 },
  };
  TJ.SIZES = SIZES;
  TJ.MAP_VERSION = 3;

  const LABELS = 'ABCDEFGH';
  const hwOf = (lanes) => lanes * W + 1; // połowa szerokości jezdni jednego kierunku + pół pasa rozdzielającego
  const vmaxOf = (lanes) => 40 + 11 * lanes; // px/s

  // Pozycja na pasie `lane` (0 = przy osi, ostatni = przy krawężniku) krawędzi skierowanej `e`, `s` px od początku
  TJ.lanePos = function (e, lane, s) {
    const off = 1 + (lane + 0.5) * W;
    return { x: e.ax + e.d.x * s + e.n.x * off, y: e.ay + e.d.y * s + e.n.y * off };
  };

  // rodzaj manewru: S prosto, L w lewo, R w prawo, U zawracanie
  TJ.turnOf = function (d1, d2) {
    const cr = d1.x * d2.y - d1.y * d2.x;
    const dt = d1.x * d2.x + d1.y * d2.y;
    if (dt < -0.85) return 'U';
    if (cr > 0.62) return 'R';
    if (cr < -0.62) return 'L';
    return 'S';
  };

  // prędkość pokonywania łuku
  TJ.turnSpeed = function (e1, e2, turn) {
    const base = Math.min(e1.vmax, e2.vmax);
    if (turn === 'S') return base;
    const cr = Math.abs(e1.d.x * e2.d.y - e1.d.y * e2.d.x);
    return Math.max(20, base * (1 - 0.75 * cr));
  };

  // miejsca na znaki wokół skrzyżowania: `inn` po stronie najazdu, `out` po stronie wyjazdu
  TJ.armSlots = function (node, arm) {
    const a = arm.out.d;
    const along = node.R + 20;
    const off = arm.out.road.hw + 14;
    return {
      inn: { x: node.x + a.x * along + arm.in.n.x * off, y: node.y + a.y * along + arm.in.n.y * off },
      out: { x: node.x + a.x * along + arm.out.n.x * off, y: node.y + a.y * along + arm.out.n.y * off },
    };
  };

  TJ.armLamp = function (node, arm) {
    const a = arm.out.d;
    const off = arm.out.road.hw + 4.5;
    return { x: node.x + a.x * (node.R + 4) + arm.in.n.x * off, y: node.y + a.y * (node.R + 4) + arm.in.n.y * off };
  };

  function buildMap(seed, sizeKey) {
    const rnd = TJ.rng(seed);
    const { cols, rows, extra, trim, diag, gates: wantGates } = SIZES[sizeKey] || SIZES.medium;
    const SX = 285, SY = 250, JIT = 34, OX = 220, OY = 200;
    const shuffle = (a) => {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };

    // 1) siatka węzłów; rozrzut jest wspólny dla całego wiersza / kolumny, więc drogi
    // poziome i pionowe pozostają równoległe i prostopadłe, a zmienia się tylko odstęp między nimi
    const colOff = Array.from({ length: cols }, () => (rnd() * 2 - 1) * JIT);
    const rowOff = Array.from({ length: rows }, () => (rnd() * 2 - 1) * JIT);
    const grid = [];
    const pts = [];
    for (let j = 0; j < rows; j++) {
      grid[j] = [];
      for (let i = 0; i < cols; i++) {
        const outs = [];
        if (i === 0) outs.push({ x: -1, y: 0 });
        if (i === cols - 1) outs.push({ x: 1, y: 0 });
        if (j === 0) outs.push({ x: 0, y: -1 });
        if (j === rows - 1) outs.push({ x: 0, y: 1 });
        const p = {
          idx: pts.length,
          i,
          j,
          x: OX + i * SX + colOff[i],
          y: OY + j * SY + rowOff[j],
          boundary: outs.length > 0,
          outs,
          alive: true,
        };
        pts.push(p);
        grid[j][i] = p;
      }
    }

    // 2) losowe drzewo rozpinające + dodatkowe połączenia
    const cand = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        if (i < cols - 1) cand.push({ a: grid[j][i], b: grid[j][i + 1], kind: 'h', line: j });
        if (j < rows - 1) cand.push({ a: grid[j][i], b: grid[j + 1][i], kind: 'v', line: i });
      }
    }
    shuffle(cand);
    const parent = pts.map((p) => p.idx);
    const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    let roads = [];
    const rest = [];
    for (const c of cand) {
      const ra = find(c.a.idx), rb = find(c.b.idx);
      if (ra !== rb) {
        parent[ra] = rb;
        roads.push(c);
      } else rest.push(c);
    }
    for (const c of rest) if (rnd() < extra) roads.push(c);

    const degOf = (p) => roads.reduce((s, r) => s + (r.a === p || r.b === p ? 1 : 0), 0);

    // 3) usuń ślepe zaułki wewnątrz mapy oraz węzły z tylko dwiema drogami (skrzyżowanie musi mieć min. 3 ramiona)
    const kill = (p) => {
      p.alive = false;
      roads = roads.filter((r) => r.a !== p && r.b !== p);
    };
    const hasRoad = (a, b) => roads.some((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a));
    let changed = true;
    while (changed) {
      changed = false;
      for (const p of pts) {
        if (!p.alive) continue;
        const mine = roads.filter((r) => r.a === p || r.b === p);
        if (mine.length === 0 || (mine.length === 1 && !p.boundary)) {
          kill(p);
          changed = true;
        } else if (mine.length === 2) {
          const [r1, r2] = mine;
          if (r1.kind === r2.kind) {
            // dwie drogi w jednej linii: scal je w jedną prostą drogę
            const u = r1.a === p ? r1.b : r1.a, w = r2.a === p ? r2.b : r2.a;
            roads = roads.filter((r) => r !== r1 && r !== r2);
            roads.push({ a: u, b: w, kind: r1.kind, line: r1.line });
            p.alive = false;
            changed = true;
          } else if (!p.boundary) {
            // zakręt wewnątrz mapy: dołóż drogę do sąsiada albo usuń węzeł
            const nb = [[-1, 0], [1, 0], [0, -1], [0, 1]]
              .map(([di, dj]) => (grid[p.j + dj] || [])[p.i + di])
              .filter((q) => q && q.alive && !hasRoad(p, q));
            if (nb.length) {
              const q = nb[Math.floor(rnd() * nb.length)];
              const horiz = q.j === p.j;
              const [a, b] = q.i + q.j < p.i + p.j ? [q, p] : [p, q];
              roads.push({ a, b, kind: horiz ? 'h' : 'v', line: horiz ? p.j : p.i });
            } else kill(p);
            changed = true;
          } else {
            // brzegowy zakręt: usuń go albo (poniżej) dostanie bramę
            if (p.trimmed === undefined) p.trimmed = rnd() < trim;
            if (p.trimmed) {
              kill(p);
              changed = true;
            }
          }
        }
      }
      if (changed) continue;
      // zostaw tylko największą spójną część mapy
      const comp = new Map();
      let best = null, bestSize = 0;
      for (const p of pts) {
        if (!p.alive || comp.has(p)) continue;
        const members = [p];
        comp.set(p, members);
        for (let k = 0; k < members.length; k++) {
          for (const r of roads) {
            const q = r.a === members[k] ? r.b : r.b === members[k] ? r.a : null;
            if (q && !comp.has(q)) {
              comp.set(q, members);
              members.push(q);
            }
          }
        }
        if (members.length > bestSize) { best = members; bestSize = members.length; }
      }
      for (const p of pts) {
        if (p.alive && comp.get(p) !== best) {
          kill(p);
          changed = true;
        }
      }
    }

    // 4) pojedyncze skosy
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        if (rnd() >= diag) continue;
        const flip = rnd() < 0.5;
        const a = flip ? grid[j][i + 1] : grid[j][i];
        const b = flip ? grid[j + 1][i] : grid[j + 1][i + 1];
        if (a.alive && b.alive && degOf(a) <= 3 && degOf(b) <= 3) roads.push({ a, b, kind: 'd', line: 0 });
      }
    }

    // 5) liczba pasów
    const pickLane = () => {
      const r = rnd();
      return r < 0.4 ? 1 : r < 0.82 ? 2 : 3;
    };
    const rowL = Array.from({ length: rows }, pickLane);
    const colL = Array.from({ length: cols }, pickLane);
    for (const r of roads) {
      let l = r.kind === 'h' ? rowL[r.line] : r.kind === 'v' ? colL[r.line] : rnd() < 0.6 ? 1 : 2;
      if (r.kind !== 'd' && rnd() < 0.2) l = TJ.clamp(l + (rnd() < 0.5 ? -1 : 1), 1, 3);
      r.lanes = l;
    }

    // 6) bramy wjazdowe/wyjazdowe na brzegach
    const alive = pts.filter((p) => p.alive);
    let gateCount = alive.filter((p) => degOf(p) === 1).length;
    const addGate = (p) => {
      const o = p.outs[Math.floor(rnd() * p.outs.length)];
      const g = {
        idx: -1,
        x: p.x + o.x * 150,
        y: p.y + o.y * 150,
        alive: true,
        gate: true,
      };
      roads.push({ a: p, b: g, kind: 'g', lanes: rnd() < 0.6 ? 1 : 2 });
    };
    for (const p of shuffle(alive.filter((p) => p.boundary && degOf(p) >= 2))) {
      if (gateCount >= wantGates) break;
      if (gateCount >= 4 && rnd() > 0.7) continue;
      addGate(p);
      gateCount++;
    }
    // brzegowy zakręt z dwiema drogami też dostaje bramę, żeby powstało pełne skrzyżowanie
    for (const p of alive.filter((p) => p.boundary && degOf(p) === 2)) addGate(p);

    const finalRoads = roads;

    // 8) obiekty mapy
    const nodes = [];
    const nodeOf = (p) => {
      if (!p.node) {
        p.node = { id: nodes.length, x: p.x, y: p.y, arms: [] };
        nodes.push(p.node);
      }
      return p.node;
    };
    const roadList = [];
    const edges = [];
    const angleOf = (d) => {
      let a = Math.atan2(d.x, -d.y);
      if (a < 0) a += Math.PI * 2;
      return a;
    };
    finalRoads.forEach((r, idx) => {
      const a = nodeOf(r.a), b = nodeOf(r.b);
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
      const d = { x: dx / L, y: dy / L };
      const road = { id: idx, a, b, lanes: r.lanes, len: L, hw: hwOf(r.lanes) };
      const mk = (id, from, to, dir) => ({
        id, road, from, to, d: dir, n: { x: -dir.y, y: dir.x }, lanes: r.lanes, vmax: vmaxOf(r.lanes),
        ax: 0, ay: 0, len: 0, next: [],
      });
      const ab = mk(idx * 2, a, b, d);
      const ba = mk(idx * 2 + 1, b, a, { x: -d.x, y: -d.y });
      ab.rev = ba;
      ba.rev = ab;
      road.ab = ab;
      road.ba = ba;
      edges.push(ab, ba);
      roadList.push(road);
      a.arms.push({ out: ab, in: ba, ang: angleOf(ab.d) });
      b.arms.push({ out: ba, in: ab, ang: angleOf(ba.d) });
    });

    // promień skrzyżowania
    for (const n of nodes) {
      const k = n.arms.length;
      n.arms.sort((p, q) => p.ang - q.ang);
      n.type = k === 1 ? 'gate' : k === 2 ? 'bend' : 'junction';
      n.arms.forEach((a, i) => {
        a.idx = i;
        a.label = LABELS[i];
        a.hw = a.out.road.hw;
        a.in.toArm = a;
        a.out.fromArm = a;
      });
      if (k === 1) {
        n.R = 0;
        n.maxhw = n.arms[0].hw;
        continue;
      }
      n.maxhw = Math.max(...n.arms.map((a) => a.hw));
      let R = n.maxhw + (k >= 3 ? 12 : 5);
      for (let q = 0; q < k; q++) {
        const a1 = n.arms[q], a2 = n.arms[(q + 1) % k];
        let th = a2.ang - a1.ang;
        if (th <= 0) th += Math.PI * 2;
        if (th < Math.PI - 0.01) R = Math.max(R, (a1.hw + a2.hw) / (2 * Math.sin(th / 2)));
      }
      n.R = Math.min(R, 78);
    }
    for (let pass = 0; pass < 4; pass++) {
      for (const r of roadList) {
        const avail = r.len - 38;
        const sum = r.a.R + r.b.R;
        if (sum > avail && sum > 0) {
          const f = Math.max(0.5, avail / sum);
          if (r.a.R > 0) r.a.R = Math.max(r.a.maxhw * 0.9, r.a.R * f);
          if (r.b.R > 0) r.b.R = Math.max(r.b.maxhw * 0.9, r.b.R * f);
        }
      }
    }

    for (const e of edges) {
      e.ax = e.from.x + e.d.x * e.from.R;
      e.ay = e.from.y + e.d.y * e.from.R;
      e.len = Math.max(8, e.road.len - e.from.R - e.to.R);
    }
    for (const e of edges) {
      if (e.to.type === 'gate') continue;
      for (const a of e.to.arms) {
        if (a.out === e.rev) continue;
        e.next.push({ edge: a.out, turn: TJ.turnOf(e.d, a.out.d) });
      }
    }

    const gates = nodes.filter((n) => n.type === 'gate');
    const junctions = nodes.filter((n) => n.type === 'junction');
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x);
      maxY = Math.max(maxY, n.y);
    }
    return {
      seed, sizeKey: sizeKey || 'medium', nodes, roads: roadList, edges, gates, junctions,
      bounds: { x0: minX - 110, y0: minY - 110, x1: maxX + 110, y1: maxY + 110 },
      mvCache: new Map(),
    };
  }

  // Usuwanie zakrętów potrafi mocno okroić małą mapę – wtedy losujemy ponownie (z ziarna pochodnego,
  // więc ten sam numer mapy nadal daje ten sam wynik).
  const MIN_JUNCTIONS = { small: 2, medium: 5, large: 8 };
  TJ.generateMap = function (seed, sizeKey) {
    const key = SIZES[sizeKey] ? sizeKey : 'medium';
    let map = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      map = buildMap((seed + attempt * 7919) >>> 0, key);
      if (map.gates.length >= 3 && map.junctions.length >= MIN_JUNCTIONS[key]) break;
    }
    map.seed = seed;
    return map;
  };

  // Tor przejazdu przez skrzyżowanie: z pasa i krawędzi e1 na pas j krawędzi e2 (krzywa Béziera)
  TJ.movement = function (map, e1, i, e2, j) {
    const key = (e1.id * 4 + i) * 4096 + (e2.id * 4 + j);
    let mv = map.mvCache.get(key);
    if (mv) return mv;
    const P0 = TJ.lanePos(e1, i, e1.len);
    const P2 = TJ.lanePos(e2, j, 0);
    const d1 = e1.d, d2 = e2.d;
    const cr = d1.x * d2.y - d1.y * d2.x;
    let P1 = { x: (P0.x + P2.x) / 2, y: (P0.y + P2.y) / 2 };
    if (Math.abs(cr) > 0.04) {
      const dx = P2.x - P0.x, dy = P2.y - P0.y;
      const t = (dx * d2.y - dy * d2.x) / cr;
      const u = (dx * d1.y - dy * d1.x) / -cr;
      if (t > 0 && u > 0 && t < 160 && u < 160) P1 = { x: P0.x + d1.x * t, y: P0.y + d1.y * t };
    }
    const approx = Math.hypot(P1.x - P0.x, P1.y - P0.y) + Math.hypot(P2.x - P1.x, P2.y - P1.y);
    const n = Math.max(6, Math.ceil(approx / 5));
    const pts = [], cum = [0];
    for (let k = 0; k <= n; k++) {
      const t = k / n, m = 1 - t;
      pts.push({
        x: m * m * P0.x + 2 * m * t * P1.x + t * t * P2.x,
        y: m * m * P0.y + 2 * m * t * P1.y + t * t * P2.y,
      });
      if (k > 0) cum.push(cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y));
    }
    mv = { e1, i, e2, j, pts, cum, len: cum[n], turn: TJ.turnOf(d1, d2) };
    map.mvCache.set(key, mv);
    return mv;
  };

  // punkt na torze w odległości u od początku (u poza zakresem: przedłużenie wzdłuż pasów dojazdowych)
  TJ.movePoint = function (mv, u) {
    if (u <= 0) return TJ.lanePos(mv.e1, mv.i, mv.e1.len + u);
    if (u >= mv.len) return TJ.lanePos(mv.e2, mv.j, u - mv.len);
    const c = mv.cum;
    let k = 1;
    while (k < c.length - 1 && c[k] < u) k++;
    const f = (u - c[k - 1]) / (c[k] - c[k - 1] || 1);
    const a = mv.pts[k - 1], b = mv.pts[k];
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  };
})();

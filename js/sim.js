(function () {
  'use strict';
  const TJ = window.TJ;

  const P = {
    A: 32, // przyspieszenie
    B: 45, // komfortowe hamowanie
    BMAX: 110,
    T: 0.9, // odstęp czasowy
    S0: 5, // minimalny odstęp
    YELLOW: 3,
    ALLRED: 1.5,
    CONFLICT: 10.5, // odległość uznawana za kolizję torów
    GAP: 3,
    H: 1 / 30, // krok symulacji
  };
  TJ.PARAMS = P;

  const DIRS = { dirS: 'S', dirR: 'R', dirL: 'L', dirSR: 'SR', dirSL: 'SL' };
  const COLORS = ['#e24a4a', '#3d7bd9', '#f0b429', '#4caf7a', '#f2f2f2', '#8e5bd1', '#e57c3a', '#2f3a4a', '#26a6b8', '#c4c9d0'];
  const K = (e, lane) => e.id * 4 + lane;

  // rodzaje pojazdów: udział w ruchu, długość, mnożnik prędkości (f) i przyspieszenia (acc)
  const VEHICLES = {
    car: { share: 0.78, len: [15, 18], f: [0.88, 1.1], acc: 1 },
    truck: { share: 0.13, len: [27, 32], f: [0.6, 0.72], acc: 0.55 },
    moto: { share: 0.09, len: [8, 9], f: [1.25, 1.45], acc: 1.3 },
  };
  TJ.VEHICLES = VEHICLES;

  TJ.newRules = () => ({ signs: {}, noentry: {}, signals: {} });

  // czy manewr e1 -> nx.edge jest dozwolony przez znaki
  TJ.moveAllowed = function (rules, e1, nx) {
    if (nx.turn === 'U') return false;
    if (rules.noentry[nx.edge.id]) return false;
    const a = DIRS[rules.signs[e1.id]];
    return !a || a.indexOf(nx.turn) >= 0;
  };

  // ---------------------------------------------------------------- sygnalizacja
  TJ.cycleLen = (prog) => prog.phases.reduce((s, ph) => s + ph.dur + P.YELLOW + P.ALLRED, 0);

  TJ.armSignal = function (prog, edgeId, t) {
    const T = TJ.cycleLen(prog);
    if (!prog.phases.length || T <= 0) return 'R';
    let x = (((t + prog.offset) % T) + T) % T;
    for (const ph of prog.phases) {
      const on = ph.green.indexOf(edgeId) >= 0;
      if (x < ph.dur) return on ? 'G' : 'R';
      x -= ph.dur;
      if (x < P.YELLOW) return on ? 'Y' : 'R';
      x -= P.YELLOW;
      if (x < P.ALLRED) return 'R';
      x -= P.ALLRED;
    }
    return 'R';
  };

  // automatyczny program: fazy parami przeciwległych ramion
  TJ.autoProgram = function (node) {
    const arms = node.arms;
    const pairs = [];
    for (let i = 0; i < arms.length; i++) {
      for (let j = i + 1; j < arms.length; j++) {
        pairs.push({ i, j, dot: arms[i].out.d.x * arms[j].out.d.x + arms[i].out.d.y * arms[j].out.d.y });
      }
    }
    pairs.sort((a, b) => a.dot - b.dot);
    const used = new Set();
    const phases = [];
    for (const p of pairs) {
      if (used.has(p.i) || used.has(p.j) || p.dot > -0.55) continue;
      used.add(p.i);
      used.add(p.j);
      phases.push({ green: [arms[p.i].in.id, arms[p.j].in.id], dur: 12 });
    }
    arms.forEach((a, i) => {
      if (!used.has(i)) phases.push({ green: [a.in.id], dur: 9 });
    });
    return { enabled: true, offset: 0, phases };
  };

  // ---------------------------------------------------------------- trasowanie
  TJ.findRoute = function (map, rules, startEdge, destNode, rnd) {
    const N = map.edges.length;
    const dist = new Float64Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const done = new Uint8Array(N);
    const noise = new Float64Array(N);
    for (let i = 0; i < N; i++) noise[i] = 1 + 0.45 * rnd();
    const cost = (e) => (e.len / e.vmax) * noise[e.id] + 0.5;
    dist[startEdge.id] = cost(startEdge);
    for (;;) {
      let best = -1, bd = Infinity;
      for (let i = 0; i < N; i++) if (!done[i] && dist[i] < bd) { bd = dist[i]; best = i; }
      if (best < 0) return null;
      done[best] = 1;
      const e = map.edges[best];
      if (e.to === destNode) {
        const route = [];
        for (let k = best; k >= 0; k = prev[k]) route.push(map.edges[k]);
        return route.reverse();
      }
      const prog = rules.signals[e.to.id];
      for (const nx of e.next) {
        if (!TJ.moveAllowed(rules, e, nx)) continue;
        const pen = (prog && prog.enabled ? 4 : 0) + (nx.turn === 'L' ? 1.5 : 0);
        const nd = bd + cost(nx.edge) + pen;
        if (nd < dist[nx.edge.id]) {
          dist[nx.edge.id] = nd;
          prev[nx.edge.id] = best;
        }
      }
    }
  };

  // jaki odsetek par bram jest połączony przy aktualnych znakach
  TJ.reachability = function (map, rules) {
    let ok = 0, total = 0;
    for (const g of map.gates) {
      const seen = new Uint8Array(map.edges.length);
      const start = g.arms[0].out;
      const stack = [start];
      seen[start.id] = 1;
      const reached = new Set();
      while (stack.length) {
        const e = stack.pop();
        if (e.to.type === 'gate') {
          if (e.to !== g) reached.add(e.to.id);
          continue;
        }
        for (const nx of e.next) {
          if (seen[nx.edge.id] || !TJ.moveAllowed(rules, e, nx)) continue;
          seen[nx.edge.id] = 1;
          stack.push(nx.edge);
        }
      }
      ok += reached.size;
      total += map.gates.length - 1;
    }
    return { ok, total, ratio: total ? ok / total : 1 };
  };

  // ---------------------------------------------------------------- pomocnicze
  function conflictPaths(A, B, b0) {
    const a = A.pts, b = B.pts, cb = B.cum;
    const lim = P.CONFLICT * P.CONFLICT;
    for (let j = 0; j < b.length; j++) {
      if (cb[j] < b0) continue;
      for (let i = 0; i < a.length; i++) {
        const dx = a[i].x - b[j].x, dy = a[i].y - b[j].y;
        if (dx * dx + dy * dy < lim) return true;
      }
    }
    return false;
  }

  // pozycja i kąt auta (przód i tył osobno, żeby auto skręcało płynnie)
  TJ.carPose = function (c) {
    let f, r;
    if (c.state === 0) {
      f = TJ.lanePos(c.e, c.lane, c.s);
      r = TJ.lanePos(c.e, c.lane, c.s - c.len);
    } else {
      f = TJ.movePoint(c.mv, c.u);
      r = TJ.movePoint(c.mv, c.u - c.len);
    }
    return { x: (f.x + r.x) / 2, y: (f.y + r.y) / 2, a: Math.atan2(f.y - r.y, f.x - r.x) };
  };

  // ---------------------------------------------------------------- symulacja
  class Sim {
    constructor(map, rules, opts) {
      opts = opts || {};
      this.map = map;
      this.rules = JSON.parse(JSON.stringify(rules));
      this.rnd = TJ.rng(((opts.seed || 1) ^ 0x5bd1e995) >>> 0);
      this.level = opts.level || 4;
      this.t = 0;
      this.cars = [];
      this.nextId = 1;
      this.occ = new Map(); // klucz pasa -> [{c, x}] (x = współrzędna przodu auta na pasie)
      this.fronts = new Map(); // klucz pasa -> pierwsze auto w kolejce
      this.nodeOcc = new Map(); // węzeł -> auta w skrzyżowaniu lub dopuszczone do wjazdu
      this.sig = new Map();
      this.gates = map.gates.map((n) => {
        const e = n.arms[0].out;
        return { node: n, edge: e, pending: 0, plan: null, w: (0.6 + this.rnd()) * (1 + 0.3 * (e.lanes - 1)) };
      });
      this.wsum = this.gates.reduce((s, g) => s + g.w, 0);
      this.stats = { spawned: 0, arrived: 0, noRoute: 0, abandoned: 0, recent: [], arrivals: [] };
      this.signalNodes = map.junctions.filter((n) => {
        const p = this.rules.signals[n.id];
        return p && p.enabled;
      });
      this.updateSignals();
    }

    signalOf(edge) {
      const m = this.sig.get(edge.to.id);
      return m ? m.get(edge.id) : null;
    }

    updateSignals() {
      for (const n of this.signalNodes) {
        const prog = this.rules.signals[n.id];
        let m = this.sig.get(n.id);
        if (!m) this.sig.set(n.id, (m = new Map()));
        for (const a of n.arms) m.set(a.in.id, TJ.armSignal(prog, a.in.id, this.t));
      }
    }

    step(h) {
      this.t += h;
      this.updateSignals();
      this.buildOcc();
      this.spawn(h);
      this.evaluate();
      this.move(h);
      if (this.cars.some((c) => c.done)) this.cars = this.cars.filter((c) => !c.done);
    }

    // ------------------------------------------------ zajętość pasów
    pushOcc(k, c, x) {
      let a = this.occ.get(k);
      if (!a) this.occ.set(k, (a = []));
      a.push({ c, x });
    }

    pushNode(id, c) {
      let a = this.nodeOcc.get(id);
      if (!a) this.nodeOcc.set(id, (a = []));
      a.push(c);
    }

    buildOcc() {
      this.occ.clear();
      this.fronts.clear();
      this.nodeOcc.clear();
      for (const c of this.cars) {
        if (c.state === 0) {
          const k = K(c.e, c.lane);
          this.pushOcc(k, c, c.s);
          const f = this.fronts.get(k);
          if (!f || f.s < c.s) this.fronts.set(k, c);
          if (c.granted) this.registerGrant(c);
        } else {
          const mv = c.mv;
          this.pushOcc(K(mv.e1, mv.i), c, mv.e1.len + c.u);
          this.pushOcc(K(mv.e2, mv.j), c, c.u - mv.len);
          this.pushNode(mv.e1.to.id, c);
        }
      }
    }

    registerGrant(c) {
      this.pushOcc(K(c.mv.e2, c.mv.j), c, -((c.e.len - c.s) + c.mv.len));
      this.pushNode(c.e.to.id, c);
    }

    // najbliższe auto przed nami (na pasie, na torze przejazdu i na pasie wyjazdowym)
    findLead(c) {
      let gap = Infinity, v = 0;
      const check = (k, my) => {
        const arr = this.occ.get(k);
        if (!arr) return;
        for (const o of arr) {
          if (o.c === c || o.x <= my) continue;
          const g = o.x - o.c.len - my;
          if (g < gap) {
            gap = g;
            v = o.c.v;
          }
        }
      };
      if (c.state === 0) {
        check(K(c.e, c.lane), c.s);
        if (c.granted) check(K(c.mv.e2, c.mv.j), c.s - c.e.len - c.mv.len);
      } else {
        const mv = c.mv;
        check(K(mv.e1, mv.i), mv.e1.len + c.u);
        check(K(mv.e2, mv.j), c.u - mv.len);
      }
      return { gap, v };
    }

    laneLoad(e, j) {
      const a = this.occ.get(K(e, j));
      return a ? a.length : 0;
    }

    // ------------------------------------------------ pojawianie się aut
    spawn(h) {
      const lam = this.level * 0.2;
      for (const g of this.gates) {
        if (this.rnd() < ((lam * g.w) / this.wsum) * h) g.pending = Math.min(g.pending + 1, 40);
        if (g.pending > 0 && this.trySpawn(g)) g.pending--;
      }
    }

    trySpawn(g) {
      if (!g.plan) {
        let route = null;
        for (let tries = 0; tries < 5 && !route; tries++) {
          let r = this.rnd() * (this.wsum - g.w);
          let dest = null;
          for (const o of this.gates) {
            if (o === g) continue;
            r -= o.w;
            dest = o;
            if (r <= 0) break;
          }
          route = TJ.findRoute(this.map, this.rules, g.edge, dest.node, this.rnd);
        }
        if (!route) {
          this.stats.noRoute++;
          return true;
        }
        g.plan = route;
      }
      const route = g.plan;
      const e = route[0];
      let kind = 'car';
      for (let r = this.rnd(), k = 0, names = Object.keys(VEHICLES); k < names.length; k++) {
        r -= VEHICLES[names[k]].share;
        if (r < 0) { kind = names[k]; break; }
      }
      const vt = VEHICLES[kind];
      const len = vt.len[0] + Math.floor(this.rnd() * (vt.len[1] - vt.len[0] + 1));
      // wybór pasa wg manewru na pierwszym skrzyżowaniu (łuki pomijamy)
      let want = -1;
      let a = e, k = 1;
      while (a.to.type === 'bend' && route[k]) a = route[k++];
      if (a.to.type === 'junction' && route[k]) {
        const t = TJ.turnOf(a.d, route[k].d);
        want = t === 'L' ? 0 : t === 'R' ? e.lanes - 1 : -1;
      }
      let lane = 0, best = Infinity;
      for (let j = 0; j < e.lanes; j++) {
        const sc = (want >= 0 ? 2 * Math.abs(j - want) : 0) + this.laneLoad(e, j) + this.rnd() * 0.3;
        if (sc < best) { best = sc; lane = j; }
      }
      const arr = this.occ.get(K(e, lane));
      if (arr) for (const o of arr) if (o.x - o.c.len < len + 18) return false;
      const f = vt.f[0] + this.rnd() * (vt.f[1] - vt.f[0]);
      const car = {
        id: this.nextId++, route, ri: 0, e, lane, s: len, v: Math.min(e.vmax * f * 0.7, 30), len, f,
        kind, A: P.A * vt.acc,
        color: COLORS[Math.floor(this.rnd() * COLORS.length)],
        state: 0, u: 0, mv: null, granted: false, denied: false, hard: false, nextLane: null,
        wait: 0, stopT: 0, stillT: 0, acc: 0, t0: this.t, free: this.freeTime(route, f), done: false,
      };
      this.cars.push(car);
      this.pushOcc(K(e, lane), car, len);
      this.stats.spawned++;
      g.plan = null;
      return true;
    }

    freeTime(route, f) {
      let t = 0;
      for (let i = 0; i < route.length; i++) {
        t += route[i].len / (route[i].vmax * f);
        if (i < route.length - 1 && route[i].to.type === 'junction') t += 1.8;
      }
      return t;
    }

    // ------------------------------------------------ wjazd na skrzyżowanie
    prio(e, sg) {
      if (sg) return 1;
      const s = this.rules.signs[e.id];
      return s === 'yield' || s === 'stop' ? 0 : s === 'priority' ? 2 : 1;
    }

    // pas wyjazdowy: na łuku (2 ramiona) bez zmiany pasa, na skrzyżowaniu pod następny manewr
    chooseExitLane(c) {
      const e = c.e, e2 = c.route[c.ri + 1];
      const n2 = e2.lanes;
      if (e.to.type === 'bend') return Math.min(c.lane, n2 - 1);
      const t12 = TJ.turnOf(e.d, e2.d);
      // manewr na końcu e2 (pomijamy łuki do następnego skrzyżowania)
      let a = e2, k = c.ri + 2;
      while (a.to.type === 'bend' && c.route[k]) a = c.route[k++];
      const e3 = a.to.type === 'junction' ? c.route[k] : null;
      let best = 0, bs = Infinity;
      for (let j = 0; j < n2; j++) {
        const proj = t12 === 'R' ? n2 - 1 : t12 === 'L' ? 0 : Math.min(c.lane, n2 - 1);
        let sc = 0.6 * Math.abs(j - proj);
        if (e3) {
          const t23 = TJ.turnOf(a.d, e3.d);
          const want = t23 === 'L' ? 0 : t23 === 'R' ? n2 - 1 : j;
          sc += 2 * Math.abs(j - want);
        }
        sc += this.laneLoad(e2, j) * 0.8 + this.rnd() * 0.3;
        if (sc < bs) { bs = sc; best = j; }
      }
      return best;
    }

    mustYield(c, o, sg) {
      const e = c.e, eo = o.e;
      const pa = this.prio(e, sg), po = this.prio(eo, sg);
      if (pa !== po) return pa < po;
      const ta = TJ.turnOf(e.d, c.route[c.ri + 1].d);
      const to = TJ.turnOf(eo.d, o.route[o.ri + 1].d);
      const dA = e.d, dO = eo.d;
      const opposite = dA.x * dO.x + dA.y * dO.y < -0.7;
      let y;
      if (opposite && (ta === 'L') !== (to === 'L')) y = ta === 'L';
      else {
        const cr = dA.x * dO.y - dA.y * dO.x;
        y = cr < -0.25 ? true : cr > 0.25 ? false : c.id > o.id;
      }
      // rozbijanie zakleszczeń: obaj czekają dłużej niż 3 s -> jedzie auto o niższym id
      if (y && c.wait > 3 && o.wait > 3 && c.id < o.id) y = false;
      return y;
    }

    canEnter(c) {
      const e = c.e, node = e.to, e2 = c.route[c.ri + 1];
      c.hard = false;
      if (c.nextLane == null) c.nextLane = this.chooseExitLane(c);
      const mv = TJ.movement(this.map, e, c.lane, e2, c.nextLane);
      c.mv = mv;
      const dist = e.len - c.s;
      const sgm = this.sig.get(node.id);
      const sg = sgm ? sgm.get(e.id) || 'R' : null;
      if (sg === 'R') { c.hard = true; c.why = "sig"; return false; }
      if (sg === 'Y' && (c.v * c.v) / (2 * P.B) <= dist - 2) { c.hard = true; c.why = "sigY"; return false; }
      if (!sg && this.rules.signs[e.id] === 'stop' && !(c.v < 1.2 && dist < 14 && c.stopT >= 1.2)) { c.why = "stop"; return false; }

      // miejsce na wyjeździe ("nie blokuj skrzyżowania")
      const arr = this.occ.get(K(e2, mv.j));
      if (arr) {
        let free = Infinity, pend = 0;
        for (const o of arr) {
          if (o.c === c) continue;
          if (o.x < 0) pend++;
          else free = Math.min(free, o.x - o.c.len);
        }
        if (free < (pend + 1) * (c.len + P.GAP)) { c.hard = true; c.why = "exit"; return false; }
      }
      if (node.type !== 'junction') return true;

      // konflikty torów z autami w skrzyżowaniu / już dopuszczonymi
      const occN = this.nodeOcc.get(node.id);
      if (occN) {
        for (const o of occN) {
          if (o === c) continue;
          const same = o.state === 1 ? o.mv.e1 === e && o.mv.i === c.lane : o.e === e && o.lane === c.lane;
          if (same) continue;
          const b0 = o.state === 1 ? Math.max(0, o.u - o.len) : 0;
          if (conflictPaths(mv, o.mv, b0)) { c.hard = true; c.why = "conf" + o.id; return false; }
        }
      }

      // pierwszeństwo wobec nadjeżdżających z innych ramion
      for (const arm of node.arms) {
        const ei = arm.in;
        if (ei === e) continue;
        for (let l = 0; l < ei.lanes; l++) {
          const o = this.fronts.get(K(ei, l));
          if (!o || o.granted || o.hard || o.ri >= o.route.length - 1) continue;
          if (ei.len - o.s > 30 + 1.2 * o.v) continue;
          if (sgm && sgm.get(ei.id) === 'R') continue;
          if (o.nextLane == null) o.nextLane = this.chooseExitLane(o);
          const mvo = TJ.movement(this.map, ei, o.lane, o.route[o.ri + 1], o.nextLane);
          if (!conflictPaths(mv, mvo, 0)) continue;
          if (this.mustYield(c, o, sg)) { c.why = "prio" + o.id; return false; }
        }
      }
      return true;
    }

    evaluate() {
      const list = [];
      for (const c of this.fronts.values()) {
        if (c.granted || c.ri >= c.route.length - 1) continue;
        if (c.denied || c.e.len - c.s <= 30 + 1.4 * c.v) list.push(c);
      }
      list.sort((a, b) => b.wait - a.wait || a.id - b.id);
      for (const c of list) {
        if (this.canEnter(c)) {
          c.granted = true;
          c.denied = false;
          this.registerGrant(c);
        } else c.denied = true;
      }
    }

    // ------------------------------------------------ ruch
    desired(c) {
      let v0;
      if (c.state === 0) {
        v0 = c.e.vmax * c.f;
        if (c.ri < c.route.length - 1) {
          const nx = c.route[c.ri + 1];
          const t = TJ.turnOf(c.e.d, nx.d);
          let vt = TJ.turnSpeed(c.e, nx, t);
          const sign = this.rules.signs[c.e.id];
          if ((sign === 'yield' || sign === 'stop') && !this.sig.get(c.e.to.id)) vt = Math.min(vt, 30);
          const dist = Math.max(0, c.e.len - c.s);
          v0 = Math.min(v0, Math.sqrt(vt * vt + 2 * 35 * dist));
        }
      } else {
        v0 = TJ.turnSpeed(c.mv.e1, c.mv.e2, c.mv.turn) * (c.mv.turn === 'S' ? c.f : 1);
      }
      return Math.max(v0, 8);
    }

    move(h) {
      for (const c of this.cars) {
        const lead = this.findLead(c);
        let g = lead.gap, vl = lead.v;
        if (c.state === 0 && c.denied && !c.granted) {
          const sg = c.e.len - c.s - 1;
          if (sg < g) { g = sg; vl = 0; }
        }
        const v0 = this.desired(c);
        let acc = c.A * (1 - Math.pow(c.v / v0, 4));
        if (g < Infinity) {
          const dv = c.v - vl;
          const ss = P.S0 + Math.max(0, c.v * P.T + (c.v * dv) / (2 * Math.sqrt(P.A * P.B)));
          acc -= P.A * Math.pow(ss / Math.max(g, 0.5), 2);
        }
        acc = Math.max(-P.BMAX, Math.min(c.A, acc));
        let nv = Math.max(0, c.v + acc * h);
        let adv = (c.v + nv) * 0.5 * h;
        if (g < Infinity) {
          const room = Math.max(0, g - 0.8);
          if (adv > room) {
            adv = room;
            nv = Math.min(nv, adv / h);
          }
        }
        c.v = nv;
        c.acc = acc;
        if (c.denied && c.v < 3) c.wait += h;
        if (c.state === 0 && c.denied && c.v < 1.2 && c.e.len - c.s < 14) c.stopT += h;
        c.stillT = c.v < 1 ? c.stillT + h : 0;
        if (c.denied && c.wait > 90 && c.why !== "sig" && c.why !== "sigY") {
          // kierowca rezygnuje po długim staniu w zakleszczeniu
          c.done = true;
          this.stats.abandoned++;
          continue;
        }

        if (c.state === 0) {
          c.s += adv;
          if (c.s >= c.e.len) {
            if (c.ri >= c.route.length - 1) this.finish(c);
            else this.enterJunction(c);
          }
        } else {
          c.u += adv;
          if (c.u >= c.mv.len) this.exitJunction(c);
        }
      }
    }

    enterJunction(c) {
      const e2 = c.route[c.ri + 1];
      if (!c.mv) {
        if (c.nextLane == null) c.nextLane = this.chooseExitLane(c);
        c.mv = TJ.movement(this.map, c.e, c.lane, e2, c.nextLane);
      }
      c.state = 1;
      c.u = c.s - c.e.len;
      c.granted = false;
      c.denied = false;
    }

    exitJunction(c) {
      const mv = c.mv;
      c.e = mv.e2;
      c.lane = mv.j;
      c.s = c.u - mv.len;
      c.ri++;
      c.state = 0;
      c.mv = null;
      c.granted = c.denied = c.hard = false;
      c.nextLane = null;
      c.wait = 0;
      c.stopT = 0;
    }

    finish(c) {
      c.done = true;
      const st = this.stats;
      st.arrived++;
      st.recent.push({ travel: this.t - c.t0, free: c.free });
      if (st.recent.length > 40) st.recent.shift();
      st.arrivals.push(this.t);
      while (st.arrivals.length && st.arrivals[0] < this.t - 60) st.arrivals.shift();
    }

    summary() {
      const st = this.stats;
      let tr = 0, fr = 0;
      for (const r of st.recent) { tr += r.travel; fr += r.free; }
      let stuck = 0;
      for (const c of this.cars) if (c.stillT > 30) stuck++;
      let queue = 0;
      for (const g of this.gates) queue += g.pending;
      const win = Math.min(60, this.t);
      return {
        t: this.t,
        cars: this.cars.length,
        spawned: st.spawned,
        arrived: st.arrived,
        avgTravel: st.recent.length ? tr / st.recent.length : 0,
        avgDelay: st.recent.length ? (tr - fr) / st.recent.length : 0,
        fluency: st.recent.length && tr > 0 ? Math.min(1, fr / tr) : 1,
        stuck,
        queue,
        flow: win > 5 ? (st.arrivals.length / win) * 60 : 0,
        noRoute: st.noRoute,
        abandoned: st.abandoned,
      };
    }
  }

  TJ.Sim = Sim;
})();

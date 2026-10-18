(function () {
  'use strict';
  const TJ = window.TJ;
  const W = TJ.C.LANE_W;

  const GRASS_A = '#6a9a56';
  const GRASS_B = '#659451';
  const GRASS_OUT = '#587f48';
  const KERB = '#2a2e34';
  const ASPH = '#3c4148';
  const SIG_COL = { G: '#2ee86a', Y: '#ffd23a', R: '#ff3b3b' };
  const SIG_DIM = { G: '#14361f', Y: '#3b3414', R: '#3a1616' };

  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  class Renderer {
    constructor(canvas) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.cam = { x: 0, y: 0, k: 1 };
      this.dpr = 1;
      this.w = 1;
      this.h = 1;
    }

    resize() {
      const r = this.cv.getBoundingClientRect();
      this.dpr = window.devicePixelRatio || 1;
      this.w = Math.max(1, r.width);
      this.h = Math.max(1, r.height);
      this.cv.width = Math.round(this.w * this.dpr);
      this.cv.height = Math.round(this.h * this.dpr);
    }

    fit(map) {
      const b = map.bounds;
      const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
      const k = Math.min(this.w / bw, this.h / bh);
      this.cam.k = k;
      this.cam.x = b.x0 - (this.w / k - bw) / 2;
      this.cam.y = b.y0 - (this.h / k - bh) / 2;
    }

    toWorld(sx, sy) {
      return { x: sx / this.cam.k + this.cam.x, y: sy / this.cam.k + this.cam.y };
    }

    zoomAt(sx, sy, f) {
      const w = this.toWorld(sx, sy);
      const k = TJ.clamp(this.cam.k * f, 0.1, 4);
      this.cam.k = k;
      this.cam.x = w.x - sx / k;
      this.cam.y = w.y - sy / k;
    }

    pan(dx, dy) {
      this.cam.x -= dx / this.cam.k;
      this.cam.y -= dy / this.cam.k;
    }

    draw(app) {
      const ctx = this.ctx, cam = this.cam, dpr = this.dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = GRASS_OUT;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.setTransform(dpr * cam.k, 0, 0, dpr * cam.k, -cam.x * cam.k * dpr, -cam.y * cam.k * dpr);
      const map = app.map;
      const sim = app.mode === 'sim' ? app.sim : null;
      const rules = sim ? sim.rules : app.rules;

      this.drawGround(ctx, map);
      this.drawRoads(ctx, map);
      this.drawMarkings(ctx, map, rules);
      this.drawSignals(ctx, map, rules, sim, app);
      this.drawGates(ctx, map, sim);
      if (sim) this.drawCars(ctx, sim, app.colorBySpeed);
      this.drawSigns(ctx, map, rules);
      this.drawOverlays(ctx, map, app);
    }

    drawGround(ctx, map) {
      const b = map.bounds;
      ctx.fillStyle = GRASS_A;
      ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      ctx.fillStyle = GRASS_B;
      const S = 90;
      for (let y = Math.floor(b.y0 / S) * S, j = 0; y < b.y1; y += S, j++) {
        for (let x = Math.floor(b.x0 / S) * S, i = 0; x < b.x1; x += S, i++) {
          if ((i + j) % 2) ctx.fillRect(Math.max(x, b.x0), Math.max(y, b.y0), Math.min(S, b.x1 - x), Math.min(S, b.y1 - y));
        }
      }
    }

    drawRoads(ctx, map) {
      ctx.lineCap = 'butt';
      for (let pass = 0; pass < 2; pass++) {
        const grow = pass === 0 ? 2.5 : 0;
        ctx.strokeStyle = ctx.fillStyle = pass === 0 ? KERB : ASPH;
        for (const r of map.roads) {
          ctx.lineWidth = 2 * r.hw + grow * 2;
          ctx.beginPath();
          ctx.moveTo(r.a.x, r.a.y);
          ctx.lineTo(r.b.x, r.b.y);
          ctx.stroke();
        }
        for (const n of map.nodes) {
          if (n.type === 'gate') continue;
          const rr = n.type === 'junction' ? Math.max(n.maxhw * 1.15 + 3, n.R * 0.75) : n.maxhw;
          ctx.beginPath();
          ctx.arc(n.x, n.y, rr + grow, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    drawMarkings(ctx, map, rules) {
      ctx.lineCap = 'butt';
      for (const r of map.roads) {
        const e = r.ab;
        const ax = e.ax, ay = e.ay;
        const bx = ax + e.d.x * e.len, by = ay + e.d.y * e.len;
        const line = (off, w, dash, style) => {
          ctx.beginPath();
          ctx.moveTo(ax + e.n.x * off, ay + e.n.y * off);
          ctx.lineTo(bx + e.n.x * off, by + e.n.y * off);
          ctx.lineWidth = w;
          ctx.setLineDash(dash);
          ctx.strokeStyle = style;
          ctx.stroke();
        };
        line(-1, 1.1, [], '#f4f4f4');
        line(1, 1.1, [], '#f4f4f4');
        for (let k = 1; k < r.lanes; k++) {
          line(1 + k * W, 1, [7, 9], 'rgba(255,255,255,.85)');
          line(-(1 + k * W), 1, [7, 9], 'rgba(255,255,255,.85)');
        }
        line(r.hw - 0.6, 0.9, [], 'rgba(255,255,255,.5)');
        line(-(r.hw - 0.6), 0.9, [], 'rgba(255,255,255,.5)');
      }
      ctx.setLineDash([]);

      // linie zatrzymania, STOP i "zęby" przy A-7
      for (const n of map.junctions) {
        for (const arm of n.arms) {
          const e = arm.in;
          const bx = e.ax + e.d.x * e.len, by = e.ay + e.d.y * e.len;
          const hw = e.road.hw;
          const sign = rules.signs[e.id];
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = sign === 'stop' ? 4.5 : 3;
          ctx.beginPath();
          ctx.moveTo(bx + e.n.x * 1.2, by + e.n.y * 1.2);
          ctx.lineTo(bx + e.n.x * hw, by + e.n.y * hw);
          ctx.stroke();
          if (sign === 'yield') {
            ctx.fillStyle = '#fff';
            for (let o = 3; o < hw - 3; o += 7) {
              const px = bx + e.n.x * o, py = by + e.n.y * o;
              ctx.beginPath();
              ctx.moveTo(px - e.n.x * 2.6, py - e.n.y * 2.6);
              ctx.lineTo(px + e.n.x * 2.6, py + e.n.y * 2.6);
              ctx.lineTo(px - e.d.x * 7, py - e.d.y * 7);
              ctx.closePath();
              ctx.fill();
            }
          }
        }
      }
    }

    drawSignals(ctx, map, rules, sim, app) {
      for (const n of map.junctions) {
        const prog = rules.signals[n.id];
        if (!prog || !prog.enabled) continue;
        for (const arm of n.arms) {
          const e = arm.in;
          let st = null;
          if (sim) st = sim.signalOf(e);
          else if (app.selected === n && app.previewPhase >= 0 && prog.phases[app.previewPhase]) {
            st = prog.phases[app.previewPhase].green.indexOf(e.id) >= 0 ? 'G' : 'R';
          }
          const bx = e.ax + e.d.x * e.len, by = e.ay + e.d.y * e.len;
          if (st) {
            ctx.strokeStyle = SIG_COL[st];
            ctx.lineWidth = 3.6;
            ctx.beginPath();
            ctx.moveTo(bx + e.n.x * 1.2, by + e.n.y * 1.2);
            ctx.lineTo(bx + e.n.x * e.road.hw, by + e.n.y * e.road.hw);
            ctx.stroke();
          }
          const p = TJ.armLamp(n, arm);
          ctx.fillStyle = '#15181c';
          rrect(ctx, p.x - 4, p.y - 8.5, 8, 17, 2.5);
          ctx.fill();
          ['R', 'Y', 'G'].forEach((c, i) => {
            ctx.fillStyle = st === c ? SIG_COL[c] : SIG_DIM[c];
            ctx.beginPath();
            ctx.arc(p.x, p.y + (i - 1) * 5.2, 2.1, 0, Math.PI * 2);
            ctx.fill();
          });
        }
      }
    }

    drawGates(ctx, map, sim) {
      for (const g of map.gates) {
        const e = g.arms[0].out;
        const hw = e.road.hw;
        ctx.save();
        ctx.translate(g.x, g.y);
        ctx.rotate(Math.atan2(e.d.y, e.d.x));
        ctx.fillStyle = '#20252b';
        rrect(ctx, -9, -hw - 4, 11, 2 * hw + 8, 3);
        ctx.fill();
        ctx.fillStyle = '#f2c230';
        for (let y = -hw - 2; y < hw + 2; y += 8) ctx.fillRect(-7, y, 5, 4);
        ctx.restore();
        if (sim) {
          const gs = sim.gates.find((q) => q.node === g);
          if (gs && gs.pending > 0) {
            const px = g.x - e.d.x * 26, py = g.y - e.d.y * 26;
            ctx.fillStyle = gs.pending > 12 ? '#e5484d' : '#f2c230';
            ctx.beginPath();
            ctx.arc(px, py, 10, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#111';
            ctx.font = 'bold 11px Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(gs.pending), px, py + 0.5);
          }
        }
      }
    }

    drawCars(ctx, sim, bySpeed) {
      for (const c of sim.cars) {
        const p = TJ.carPose(c);
        const L = c.len;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.a);
        if (bySpeed) {
          const vmax = (c.state === 0 ? c.e.vmax : c.mv.e1.vmax) * c.f;
          const f = Math.min(1, c.v / vmax);
          ctx.fillStyle = `hsl(${Math.round(f * 125)}, 80%, 50%)`;
        } else ctx.fillStyle = c.color;
        rrect(ctx, -L / 2, -4, L, 8, 2.4);
        ctx.fill();
        ctx.fillStyle = 'rgba(15,25,35,.78)';
        ctx.fillRect(L * 0.08, -3.1, L * 0.2, 6.2);
        ctx.fillRect(-L * 0.38, -3.1, L * 0.13, 6.2);
        if (c.acc < -10 || (c.v < 1 && c.state === 0 && c.denied)) {
          ctx.fillStyle = '#ff2d2d';
          ctx.fillRect(-L / 2, -3.4, 1.6, 2);
          ctx.fillRect(-L / 2, 1.4, 1.6, 2);
        }
        if (c.stillT > 30) {
          ctx.strokeStyle = '#ff2d2d';
          ctx.lineWidth = 1.2;
          rrect(ctx, -L / 2 - 1, -4.7, L + 2, 9.4, 3);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    drawSigns(ctx, map, rules) {
      for (const n of map.junctions) {
        for (const arm of n.arms) {
          const sId = rules.signs[arm.in.id];
          const noent = rules.noentry[arm.out.id];
          if (!sId && !noent) continue;
          const sl = TJ.armSlots(n, arm);
          if (sId) this.sign(ctx, sId, sl.inn.x, sl.inn.y);
          if (noent) this.sign(ctx, 'noentry', sl.out.x, sl.out.y);
        }
      }
    }

    sign(ctx, id, x, y) {
      ctx.fillStyle = 'rgba(0,0,0,.28)';
      ctx.beginPath();
      ctx.arc(x + 1.5, y + 2, 14.5, 0, Math.PI * 2);
      ctx.fill();
      TJ.drawSign(ctx, id, x, y, 30);
    }

    drawOverlays(ctx, map, app) {
      // sloty pod aktywne narzędzie
      const tool = app.tool;
      if (app.mode === 'plan' && tool !== 'select') {
        const def = TJ.SIGN_BY_ID[tool];
        for (const n of map.junctions) {
          for (const arm of n.arms) {
            const sl = TJ.armSlots(n, arm);
            const kinds = tool === 'erase' ? ['inn', 'out'] : [def.slot === 'in' ? 'inn' : 'out'];
            for (const kind of kinds) {
              const hov = app.hoverSlot && app.hoverSlot.node === n && app.hoverSlot.arm === arm && app.hoverSlot.kind === kind;
              const p = sl[kind];
              ctx.beginPath();
              ctx.arc(p.x, p.y, hov ? 18 : 16, 0, Math.PI * 2);
              ctx.fillStyle = hov ? 'rgba(255,230,90,.35)' : 'rgba(255,255,255,.16)';
              ctx.fill();
              ctx.setLineDash(hov ? [] : [3, 3]);
              ctx.strokeStyle = hov ? '#ffe45a' : 'rgba(255,255,255,.85)';
              ctx.lineWidth = hov ? 2 : 1.2;
              ctx.stroke();
              ctx.setLineDash([]);
            }
          }
        }
        // podgląd znaku pod kursorem
        if (app.hoverSlot && def) {
          const p = TJ.armSlots(app.hoverSlot.node, app.hoverSlot.arm)[app.hoverSlot.kind];
          ctx.globalAlpha = 0.7;
          this.sign(ctx, tool, p.x, p.y);
          ctx.globalAlpha = 1;
        }
      }

      // zaznaczone skrzyżowanie
      const n = app.selected;
      if (n) {
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = '#ffe45a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.R + 20, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        const prog = (app.mode === 'sim' ? app.sim.rules : app.rules).signals[n.id];
        const ph = prog && prog.enabled && app.previewPhase >= 0 ? prog.phases[app.previewPhase] : null;
        for (const arm of n.arms) {
          const a = arm.out.d;
          const px = n.x + a.x * (n.R + 56), py = n.y + a.y * (n.R + 56);
          const green = ph && ph.green.indexOf(arm.in.id) >= 0;
          ctx.fillStyle = green ? '#2ee86a' : '#ffffff';
          ctx.beginPath();
          ctx.arc(px, py, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#111';
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.fillStyle = '#111';
          ctx.font = 'bold 12px Arial, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(arm.label, px, py + 0.5);
        }
      }
    }
  }

  TJ.Renderer = Renderer;
})();

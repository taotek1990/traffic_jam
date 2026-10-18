(function () {
  'use strict';
  const TJ = (window.TJ = window.TJ || {});

  TJ.VERSION = '1.0.0';

  TJ.C = { LANE_W: 12 };

  // deterministyczny generator liczb losowych (mulberry32)
  TJ.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // liczba -> ziarno wprost, tekst -> hash
  TJ.seedFrom = function (v) {
    const s = String(v).trim();
    if (/^\d+$/.test(s)) return parseInt(s, 10) >>> 0;
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };

  TJ.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
})();

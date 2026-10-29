/* Curve Planner — thiết kế đường độ khó mục tiêu cho N level (thang 0–100, game nào cũng dùng
   được) và so với điểm độ khó thực tế (từ tool chấm điểm / solver / winrate…). */
(function (root, factory) {
  const T = typeof module === "object" && module.exports ? require("./table.js") : root.GDK.lib.table;
  const lib = factory(T);
  if (typeof module === "object" && module.exports) module.exports = lib;
  else root.GDK.lib.curve = lib;
})(typeof self !== "undefined" ? self : this, function (T) {
  "use strict";

  const TIERS = [
    { key: "easy", label: "Dễ", max: 35 },
    { key: "normal", label: "Thường", max: 60 },
    { key: "hard", label: "Khó", max: 80 },
    { key: "super", label: "Rất khó", max: 101 },
  ];

  const PRESETS = {
    saw5: { label: "Răng cưa 5 level", levels: 100, start: 12, end: 62, shape: "easeOut", cycle: [-10, -4, 0, 6, 14], bossEvery: 0, bossBoost: 0, tutorial: 5, reliefAfterBoss: true },
    saw10: { label: "Răng cưa 10 + boss", levels: 150, start: 10, end: 66, shape: "easeOut", cycle: [-8, -6, -2, 0, 2, -4, 0, 4, 8, 0], bossEvery: 10, bossBoost: 22, tutorial: 6, reliefAfterBoss: true },
    linear: { label: "Tăng đều", levels: 60, start: 15, end: 70, shape: "linear", cycle: [0], bossEvery: 0, bossBoost: 0, tutorial: 3, reliefAfterBoss: false },
    gentle: { label: "Casual nhẹ nhàng", levels: 200, start: 8, end: 50, shape: "log", cycle: [-6, -2, 0, 3, 8], bossEvery: 20, bossBoost: 15, tutorial: 8, reliefAfterBoss: true },
  };

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  function ramp(t, shape) {
    if (shape === "easeOut") return 1 - Math.pow(1 - t, 1.8);
    if (shape === "easeIn") return Math.pow(t, 1.6);
    if (shape === "log") return Math.log1p(9 * t) / Math.log(10);
    return t;
  }
  function tierOf(score, tiers) {
    tiers = tiers || TIERS;
    return tiers.find((t) => score < t.max) || tiers[tiers.length - 1];
  }

  /** p: {levels, start, end, shape, cycle:[…], bossEvery, bossBoost, tutorial, reliefAfterBoss} */
  function generate(p) {
    const n = clamp(Math.round(p.levels || 50), 1, 5000);
    const cyc = p.cycle && p.cycle.length ? p.cycle : [0];
    const out = [];
    for (let i = 0; i < n; i++) {
      const level = i + 1;
      const t = n === 1 ? 0 : i / (n - 1);
      let s = p.start + (p.end - p.start) * ramp(t, p.shape);
      const tut = level <= (p.tutorial || 0);
      let role = "";
      if (!tut) {
        s += cyc[(i - (p.tutorial || 0)) % cyc.length] || 0;
        if (p.bossEvery > 0 && level % p.bossEvery === 0) { s += p.bossBoost || 0; role = "boss"; }
        else if (p.reliefAfterBoss && p.bossEvery > 0 && level % p.bossEvery === 1 && level > 1) { s -= Math.max(6, (p.bossBoost || 0) * 0.6); role = "nghỉ"; }
      } else {
        s = Math.min(s, p.start);
        role = "hướng dẫn";
      }
      s = clamp(Math.round(s), 0, 100);
      out.push({ level, target: s, tier: tierOf(s).key, role });
    }
    return out;
  }

  /** So mục tiêu với thực tế: rows có cột level + score. tol = sai lệch cho phép (điểm). */
  function compare(target, rows, map, tol) {
    tol = tol == null ? 12 : tol;
    const act = new Map();
    for (const r of rows) {
      const lv = T.toLevel(r[map.level]), sc = T.toNumber(r[map.score]);
      if (lv != null && sc != null) act.set(lv, sc);
    }
    // điểm thực tế có thể khác thang (0–1, 0–10) → đưa về 0–100 theo max
    const vals = [...act.values()];
    const max = Math.max(0, T.extent(vals)[1] || 0);
    const scale = max <= 1.0001 ? 100 : max <= 10.0001 ? 10 : 1;
    let within = 0, counted = 0;
    const rowsOut = target.map((t) => {
      const a = act.has(t.level) ? act.get(t.level) * scale : null;
      const dev = a == null ? null : a - t.target;
      let flag = "";
      if (dev != null) {
        counted++;
        if (Math.abs(dev) <= tol) within++;
        else flag = dev > 0 ? "harder" : "easier";
      }
      return Object.assign({}, t, { actual: a == null ? null : Math.round(a * 10) / 10, dev, flag, actualTier: a == null ? null : tierOf(a).key });
    });
    // chỉ báo chuỗi khó NGOÀI KẾ HOẠCH: thực tế khó trong khi mục tiêu không khó
    const unplanned = hardStreaks(rowsOut, "actual", { test: (r) => r.actual != null && r.actual >= TIERS[1].max && r.target < TIERS[1].max });
    return { rows: rowsOut, scale, counted, within, fit: counted ? within / counted : null, streaks: unplanned };
  }

  /** Chuỗi ≥ minLen level Khó/Rất khó liên tiếp — dễ làm người chơi bỏ game. */
  function hardStreaks(rows, field, opts) {
    opts = opts || {};
    const minLen = opts.minLen || 3;
    const test = opts.test || ((r) => r[field] != null && r[field] >= TIERS[1].max);
    const out = [];
    let start = null;
    rows.forEach((r, i) => {
      const hard = test(r);
      if (hard && start == null) start = i;
      if ((!hard || i === rows.length - 1) && start != null) {
        const end = hard ? i : i - 1;
        if (end - start + 1 >= minLen) out.push({ from: rows[start].level, to: rows[end].level, len: end - start + 1 });
        start = null;
      }
    });
    return out;
  }

  function distribution(rows, field) {
    const d = {};
    TIERS.forEach((t) => { d[t.key] = 0; });
    rows.forEach((r) => { if (r[field] != null) d[tierOf(r[field]).key]++; });
    return d;
  }

  return { TIERS, PRESETS, generate, compare, hardStreaks, distribution, tierOf };
});

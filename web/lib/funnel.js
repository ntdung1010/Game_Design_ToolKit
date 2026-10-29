/* Level Funnel — tìm level "tường" từ dữ liệu start/win/lose/user theo level.
   Không phụ thuộc game: chỉ cần 1 dòng / level (có thể nhiều dòng → tự cộng dồn),
   tách nhánh theo cột version / arm / pack nếu có. */
(function (root, factory) {
  const T = typeof module === "object" && module.exports ? require("./table.js") : root.GDK.lib.table;
  const lib = factory(T);
  if (typeof module === "object" && module.exports) module.exports = lib;
  else root.GDK.lib.funnel = lib;
})(typeof self !== "undefined" ? self : this, function (T) {
  "use strict";

  const FIELDS = [
    { key: "level", label: "Level", required: true, synonyms: ["level", "lvl", "level_id", "levelnumber", "level_number", "stage", "man", "màn"] },
    { key: "users", label: "Số người chơi tới level (unique)", synonyms: ["users", "user", "unique_users", "players", "reach", "active_users", "nguoi_choi", "so_user", "total_users", "level_users"] },
    { key: "starts", label: "Lượt bắt đầu", synonyms: ["start", "starts", "level_start", "plays", "play", "attempts", "attempt", "luot_choi", "luot_bat_dau"] },
    { key: "wins", label: "Lượt thắng", synonyms: ["win", "wins", "level_win", "complete", "completes", "completed", "pass", "passed", "success", "thang"] },
    { key: "losses", label: "Lượt thua", synonyms: ["lose", "loses", "loss", "losses", "level_lose", "fail", "fails", "failed", "thua"] },
    { key: "split", label: "Tách theo (version / nhánh / pack)", synonyms: ["version", "ver", "variant", "arm", "group", "ab_group", "pack", "level_ver", "nhanh", "segment", "cohort"] },
  ];

  const SENSITIVITY = { low: 2.3, medium: 1.8, high: 1.45 };

  /**
   * rows: mảng object theo header; map: {level, users, starts, wins, losses, split}
   * opts: {sensitivity: 'low'|'medium'|'high', window: 5, minDrop: 0.02, minUsers: 100, earlyLevels: 3}
   */
  function analyze(rows, map, opts) {
    opts = Object.assign({ sensitivity: "medium", window: 5, minDrop: 0.02, minUsers: 100, earlyLevels: 3 }, opts || {});
    if (!map.level) throw new Error("Chưa chọn cột Level.");
    if (!map.users && !map.wins) throw new Error("Cần ít nhất cột Users (người tới level) hoặc cột Wins để tính tỉ lệ rời bỏ.");

    const groups = new Map();
    let skipped = 0;
    for (const r of rows) {
      const lv = T.toLevel(r[map.level]);
      if (lv == null) { skipped++; continue; }
      const g = map.split ? String(r[map.split] ?? "").trim() || "(trống)" : "Tất cả";
      if (!groups.has(g)) groups.set(g, new Map());
      const m = groups.get(g);
      const cur = m.get(lv) || { level: lv, users: null, starts: null, wins: null, losses: null };
      for (const k of ["users", "starts", "wins", "losses"]) {
        if (!map[k]) continue;
        const v = T.toNumber(r[map[k]]);
        if (v != null) cur[k] = (cur[k] || 0) + v;
      }
      m.set(lv, cur);
    }

    const ratio = SENSITIVITY[opts.sensitivity] || SENSITIVITY.medium;
    const out = [];
    for (const [name, m] of groups) {
      const lv = [...m.values()].sort((a, b) => a.level - b.level);
      const reachBasis = map.users ? "users" : "wins";
      // reach(L): số người chơi tới L. Không có cột users → ước lượng bằng số người thắng L-1.
      lv.forEach((x, i) => {
        if (reachBasis === "users") x.reach = x.users;
        else x.reach = i > 0 && lv[i - 1].level === x.level - 1 ? lv[i - 1].wins : null;
      });
      const first = lv.find((x) => x.reach != null && x.reach > 0);
      const base = first ? first.reach : null;
      lv.forEach((x, i) => {
        const next = lv[i + 1];
        const consecutive = next && next.level === x.level + 1;
        x.drop = x.reach > 0 && consecutive && next.reach != null ? Math.max(0, 1 - next.reach / x.reach) : null;
        x.survival = base && x.reach != null ? x.reach / base : null;
        x.winrate = x.starts > 0 && x.wins != null ? Math.min(1, x.wins / x.starts) : null;
        x.loserate = x.starts > 0 && x.losses != null ? Math.min(1, x.losses / x.starts) : null;
        const who = x.users != null ? x.users : x.reach;
        x.attempts = who > 0 && x.starts != null ? x.starts / who : null;
        x.lowData = x.reach != null && x.reach < opts.minUsers;
        x.isLast = !next;
      });

      // so mỗi level với trung vị các level lân cận (không tính chính nó)
      const winMed = T.median(lv.map((x) => x.winrate));
      lv.forEach((x, i) => {
        const nb = [];
        for (let j = Math.max(0, i - opts.window); j <= Math.min(lv.length - 1, i + opts.window); j++) {
          if (j !== i && lv[j].drop != null && j >= opts.earlyLevels) nb.push(lv[j].drop);
        }
        x.baseline = T.median(nb);
        x.ratio = x.drop != null && x.baseline > 0 ? x.drop / x.baseline : null;
        x.reasons = [];
        const early = i < opts.earlyLevels;
        if (x.drop != null && x.drop >= opts.minDrop && x.ratio != null && x.ratio >= ratio && !x.lowData) {
          x.reasons.push("rời bỏ " + pct(x.drop) + " — gấp " + x.ratio.toFixed(1).replace(".", ",") + "× các level xung quanh");
        }
        if (x.winrate != null && winMed && x.winrate <= winMed * 0.6 && !x.lowData) {
          x.reasons.push("tỉ lệ thắng " + pct(x.winrate) + " (trung vị " + pct(winMed) + ")");
        }
        x.wall = x.reasons.length > 0 && !early;
        x.early = early && x.reasons.length > 0;
        x.score = (x.ratio || 1) * (x.winrate != null && winMed ? Math.max(1, winMed / Math.max(x.winrate, 0.01)) : 1);
      });

      const walls = lv.filter((x) => x.wall).sort((a, b) => b.score - a.score);
      const reachAt = (n) => {
        const x = lv.find((y) => y.level === n);
        return x && x.survival != null ? x.survival : null;
      };
      out.push({
        name,
        basis: reachBasis,
        levels: lv,
        walls,
        kpi: {
          levels: lv.length,
          from: lv.length ? lv[0].level : null,
          to: lv.length ? lv[lv.length - 1].level : null,
          users: base,
          medianDrop: T.median(lv.filter((x, i) => i >= opts.earlyLevels).map((x) => x.drop)),
          medianWin: winMed,
          reach10: reachAt(10), reach30: reachAt(30), reach50: reachAt(50), reach100: reachAt(100),
          gaps: lv.filter((x, i) => i > 0 && x.level !== lv[i - 1].level + 1).map((x) => x.level),
        },
      });
    }
    out.sort((a, b) => String(a.name).localeCompare(String(b.name), "vi", { numeric: true }));
    return { groups: out, skipped };
  }

  function pct(v) { return v == null ? "—" : (v * 100).toFixed(v < 0.1 ? 1 : 0).replace(".", ",") + "%"; }

  /** Gợi ý hành động cho 1 level tường — câu ngắn GD đọc là hiểu. */
  function advice(x) {
    if (x.winrate != null && x.winrate < 0.35) return "Hạ độ khó (winrate thấp) hoặc thêm trợ giúp ở level này";
    if (x.attempts != null && x.attempts > 3) return "Người chơi thử lại nhiều lần — xem lại bố cục / giới hạn bước";
    if (x.winrate != null && x.winrate >= 0.6) return "Thắng dễ nhưng vẫn bỏ — kiểm tra quảng cáo, popup, độ dài level";
    return "Xem lại độ khó và trải nghiệm ngay trước / tại level này";
  }

  return { FIELDS, SENSITIVITY, analyze, advice, pct };
});

/* AB Readout — đọc kết quả AB từ bảng tổng hợp theo nhánh (1 dòng / nhánh, hoặc
   nhiều dòng / nhánh theo ngày cài / theo user). Không phụ thuộc game.
   - Chỉ số dạng TỈ LỆ (D1, D7 retention…): số user đạt / số user → kiểm định 2 tỉ lệ.
   - Chỉ số dạng TRUNG BÌNH / USER (doanh thu, gold…): tổng / số user → phương pháp delta
     trên các dòng (cần ≥ 2 dòng / nhánh, vd theo ngày cài), 1 dòng thì không có khoảng tin cậy.
   Kèm các bẫy hay gặp: chia nhóm lệch (SRM), ngày cài cuối chưa đủ tuổi, nhánh A/A lệch. */
(function (root, factory) {
  const T = typeof module === "object" && module.exports ? require("./table.js") : root.GDK.lib.table;
  const lib = factory(T);
  if (typeof module === "object" && module.exports) module.exports = lib;
  else root.GDK.lib.abtest = lib;
})(typeof self !== "undefined" ? self : this, function (T) {
  "use strict";

  const FIELDS = [
    { key: "arm", label: "Nhánh (arm / variant)", required: true, synonyms: ["arm", "variant", "group", "ab_group", "branch", "nhanh", "version", "ver", "test_group", "experiment_variant", "bucket"] },
    { key: "users", label: "Số user (cài / vào test)", required: true, synonyms: ["users", "user", "installs", "install", "new_users", "cohort_size", "n", "so_user", "total_users", "d0", "d0_users"] },
    { key: "date", label: "Ngày cài (nếu theo ngày)", synonyms: ["date", "install_date", "cohort_date", "first_open_date", "ngay", "ngay_cai", "day"] },
  ];

  const Z = 1.959964;
  function phi(x) { // CDF chuẩn
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989423 * Math.exp(-x * x / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return x > 0 ? 1 - p : p;
  }
  const pTwo = (z) => 2 * (1 - phi(Math.abs(z)));

  /** Đoán loại chỉ số từ tên cột + dữ liệu. */
  function guessMetric(header, rows, usersCol) {
    const n = T.norm(header);
    if (/(^|_)(d|day|ret|retention|retained|r)_?\d+|retent|active|return|login|playing/.test(n)) return "rate";
    if (/rev|revenue|arpu|arppu|iap|ads?_|ad_rev|ltv|income|gold|coin|spend|purchase|impression|doanh_thu/.test(n)) return "mean";
    // giá trị luôn ≤ số user → nhiều khả năng là đếm user → tỉ lệ
    let le = 0, tot = 0;
    for (const r of rows) {
      const v = T.toNumber(r[header]), u = T.toNumber(r[usersCol]);
      if (v == null || u == null) continue; tot++; if (v <= u && v >= 0 && Number.isInteger(v)) le++;
    }
    return tot && le / tot > 0.95 ? "rate" : "mean";
  }

  /** Số ngày tuổi cần cho chỉ số (d7 → 7). */
  function metricDay(header) {
    const m = T.norm(header).match(/(?:^|_)(?:d|day|r|ret|retention)_?(\d{1,3})(?:_|$)/);
    return m ? +m[1] : 0;
  }

  /**
   * rows, map {arm, users, date}, metrics [{col, label, type:'rate'|'mean', lowerBetter}]
   * opts {control, aa, primary, excludeLastDays, expectedSplit:[...]|null, mde:0.02}
   */
  function analyze(rows, map, metrics, opts) {
    opts = Object.assign({ excludeLastDays: 0, mde: 0.02 }, opts || {});
    if (!map.arm || !map.users) throw new Error("Cần chọn cột Nhánh và cột Số user.");
    if (!metrics.length) throw new Error("Chọn ít nhất 1 chỉ số để so sánh.");
    const warnings = [];

    // lọc ngày cài cuối chưa đủ tuổi
    let used = rows, dates = [], cut = null;
    if (map.date) {
      dates = [...new Set(rows.map((r) => T.toDate(r[map.date])).filter(Boolean))].sort();
      if (opts.excludeLastDays > 0 && dates.length > opts.excludeLastDays) {
        cut = dates[dates.length - 1 - opts.excludeLastDays];
        used = rows.filter((r) => { const d = T.toDate(r[map.date]); return !d || d <= cut; });
      }
    }

    // gom theo nhánh
    const arms = new Map();
    for (const r of used) {
      const a = String(r[map.arm] ?? "").trim();
      if (!a) continue;
      const u = T.toNumber(r[map.users]);
      if (u == null || u <= 0) continue;
      if (!arms.has(a)) arms.set(a, { name: a, users: 0, rows: [] });
      const g = arms.get(a);
      g.users += u;
      const vals = {};
      for (const m of metrics) vals[m.col] = T.toNumber(r[m.col]) || 0;
      g.rows.push({ u, vals });
    }
    const armList = [...arms.values()].sort((a, b) => a.name.localeCompare(b.name, "vi", { numeric: true }));
    if (armList.length < 2) throw new Error("Cần ít nhất 2 nhánh để so sánh (đang thấy " + armList.length + ").");
    const control = arms.get(opts.control) || armList[0];

    for (const g of armList) {
      g.values = {};
      for (const m of metrics) {
        const sx = g.rows.reduce((s, r) => s + r.vals[m.col], 0);
        const v = sx / g.users;
        let se = null;
        if (m.type === "rate") {
          const p = Math.min(Math.max(v, 0), 1);
          se = Math.sqrt(p * (1 - p) / g.users);
          if (v > 1.0001) warnings.push({ level: "bad", text: `Chỉ số “${m.label}” > 100% ở nhánh ${g.name} — cột này có lẽ không phải đếm user, chuyển sang loại “Trung bình / user”.` });
        } else if (g.rows.length >= 2) {
          // delta method cho tỉ số tổng: Var(R) ≈ k/(k-1) · Σ(x − R·u)² / (Σu)²
          const k = g.rows.length;
          const ss = g.rows.reduce((s, r) => s + Math.pow(r.vals[m.col] - v * r.u, 2), 0);
          se = Math.sqrt(k / (k - 1) * ss) / g.users;
        }
        g.values[m.col] = { value: v, se, sum: sx };
      }
    }

    // so từng nhánh với nhánh gốc
    const comps = [];
    for (const g of armList) {
      if (g === control) continue;
      const res = { arm: g.name, metrics: {} };
      for (const m of metrics) {
        const a = control.values[m.col], b = g.values[m.col];
        const r = { control: a.value, test: b.value, diff: b.value - a.value, rel: a.value ? (b.value - a.value) / a.value : null };
        if (a.se != null && b.se != null && a.value > 0) {
          const ratio = b.value / a.value;
          const seRel = Math.sqrt(b.se * b.se + ratio * ratio * a.se * a.se) / a.value;
          r.seRel = seRel;
          r.lo = r.rel - Z * seRel; r.hi = r.rel + Z * seRel;
          r.p = seRel > 0 ? pTwo(r.rel / seRel) : 1;
          const better = m.lowerBetter ? r.hi < 0 : r.lo > 0;
          const worse = m.lowerBetter ? r.lo > 0 : r.hi < 0;
          r.status = better ? "win" : worse ? "lose" : (r.lo > -opts.mde && r.hi < opts.mde) ? "flat" : "unsure";
        } else {
          r.status = "noci";
        }
        res.metrics[m.col] = r;
      }
      comps.push(res);
    }

    // SRM: số user các nhánh có đúng tỉ lệ chia mong đợi?
    const tot = armList.reduce((s, g) => s + g.users, 0);
    const exp = opts.expectedSplit && opts.expectedSplit.length === armList.length
      ? opts.expectedSplit.map((x) => x / opts.expectedSplit.reduce((s, y) => s + y, 0))
      : armList.map(() => 1 / armList.length);
    const chi = armList.reduce((s, g, i) => s + Math.pow(g.users - tot * exp[i], 2) / (tot * exp[i]), 0);
    const srmP = chiSquareP(chi, armList.length - 1);
    if (srmP < 0.001) {
      warnings.push({ level: "bad", text: `Chia nhóm lệch (SRM): số user các nhánh ${armList.map((g) => g.name + " " + fmtInt(g.users)).join(" · ")} lệch khỏi tỉ lệ chia mong đợi (p = ${srmP.toExponential(1)}). Kết quả có thể sai do lỗi phân nhóm — kiểm tra trước khi kết luận.` });
    }

    // ngày cài cuối chưa đủ tuổi cho Dn
    const maxDay = Math.max(0, ...metrics.map((m) => metricDay(m.col)));
    if (map.date && maxDay > 0 && opts.excludeLastDays < maxDay && dates.length > maxDay) {
      warnings.push({ level: "warn", text: `Có chỉ số D${maxDay} nhưng đang giữ ${maxDay - opts.excludeLastDays} ngày cài cuối — những ngày này chưa đủ ${maxDay} ngày tuổi nên D${maxDay} bị thấp giả. Nên bỏ ${maxDay} ngày cài cuối.` });
    }
    if (!map.date && maxDay > 0) {
      warnings.push({ level: "info", text: `Không có cột ngày cài — không kiểm tra được ngày cài cuối có đủ ${maxDay} ngày tuổi cho D${maxDay} hay không. Hãy chắc file chỉ gồm cohort đã đủ tuổi.` });
    }

    // nhánh A/A: phải không khác nhánh gốc
    if (opts.aa && arms.has(opts.aa) && arms.get(opts.aa) !== control) {
      const c = comps.find((x) => x.arm === opts.aa);
      const bad = metrics.filter((m) => c.metrics[m.col].p != null && c.metrics[m.col].p < 0.05);
      if (bad.length) {
        warnings.push({ level: "bad", text: `Nhánh A/A “${opts.aa}” lệch có ý nghĩa so với nhánh gốc ở: ${bad.map((m) => m.label + " " + signedPct(c.metrics[m.col].rel)).join(", ")}. Hai nhánh giống hệt mà vẫn lệch → nhiễu lớn (eCPM, phân nhóm…), đừng tin các chênh lệch cỡ này.` });
      } else {
        warnings.push({ level: "ok", text: `Nhánh A/A “${opts.aa}” không lệch so với nhánh gốc — dữ liệu đáng tin hơn.` });
      }
    }

    const small = armList.filter((g) => g.users < 1000);
    if (small.length) warnings.push({ level: "warn", text: `Nhánh ${small.map((g) => g.name).join(", ")} có dưới 1.000 user — kết quả rất dễ dao động.` });
    if (metrics.some((m) => m.type === "mean") && armList.some((g) => g.rows.length < 2)) {
      warnings.push({ level: "info", text: "Chỉ số trung bình / user (vd doanh thu) cần nhiều dòng mỗi nhánh (theo ngày cài hoặc theo user) mới tính được khoảng tin cậy." });
    }

    // MDE cho chỉ số chính: chênh tối thiểu phát hiện được (power 80%, 2 phía 95%)
    const prim = metrics.find((m) => m.col === opts.primary) || metrics[0];
    const pv = control.values[prim.col];
    let mdeRel = null;
    if (pv.se != null && pv.value > 0) mdeRel = 2.8 * Math.SQRT2 * pv.se / pv.value;

    const verdict = decide(comps, metrics, prim, opts);
    return { arms: armList, control: control.name, comps, warnings, srmP, dates, cut, primary: prim.col, mdeRel, verdict };
  }

  function decide(comps, metrics, prim, opts) {
    const real = comps.filter((c) => c.arm !== opts.aa);
    if (!real.length) return { kind: "unsure", title: "Chưa có nhánh test để so sánh", detail: "" };
    const rank = real.map((c) => ({ c, r: c.metrics[prim.col] }));
    const winners = rank.filter((x) => x.r.status === "win" &&
      !metrics.some((m) => m.col !== prim.col && c_lose(x.c, m)));
    if (winners.length) {
      const best = winners.sort((a, b) => (b.r.rel || 0) - (a.r.rel || 0))[0];
      return { kind: "win", arm: best.c.arm, title: `Nhánh ${best.c.arm} THẮNG`, detail: `${prim.label} ${signedPct(best.r.rel)} (95%: ${signedPct(best.r.lo)} … ${signedPct(best.r.hi)}), các chỉ số khác không xấu đi.` };
    }
    const hurt = rank.filter((x) => x.r.status === "win" && metrics.some((m) => m.col !== prim.col && c_lose(x.c, m)));
    if (hurt.length) {
      const h = hurt[0];
      const bad = metrics.filter((m) => m.col !== prim.col && c_lose(h.c, m)).map((m) => m.label);
      return { kind: "mixed", arm: h.c.arm, title: `Nhánh ${h.c.arm} tăng ${prim.label} nhưng làm giảm ${bad.join(", ")}`, detail: "Cần cân nhắc đánh đổi trước khi chọn." };
    }
    if (rank.every((x) => x.r.status === "lose")) {
      return { kind: "lose", title: "Các nhánh test đều THUA nhánh gốc", detail: `${prim.label} giảm có ý nghĩa — giữ nhánh gốc.` };
    }
    if (rank.every((x) => x.r.status === "flat")) {
      return { kind: "flat", title: "Không khác biệt đáng kể", detail: `Chênh ${prim.label} nằm trong ±${(opts.mde * 100).toFixed(0)}% — chọn theo chi phí / trải nghiệm.` };
    }
    return { kind: "unsure", title: "Chưa đủ chắc để kết luận", detail: `Khoảng tin cậy của ${prim.label} còn chứa 0 — chạy thêm ngày / thêm user.` };
  }
  function c_lose(c, m) { return c.metrics[m.col] && c.metrics[m.col].status === "lose"; }

  // p-value chi-square (xấp xỉ Wilson–Hilferty)
  function chiSquareP(x, k) {
    if (k <= 0) return 1;
    const z = (Math.pow(x / k, 1 / 3) - (1 - 2 / (9 * k))) / Math.sqrt(2 / (9 * k));
    return 1 - phi(z);
  }

  function signedPct(v, d = 1) { return v == null || !isFinite(v) ? "—" : (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(d).replace(".", ",") + "%"; }

  /** Tên hiển thị dễ đọc cho chỉ số: d1_users → D1, ad_revenue → Doanh thu QC / user. */
  function prettyLabel(col, type) {
    const n = T.norm(col), day = metricDay(col);
    if (type === "rate" && day) return "D" + day + (/(^|_)(active|session|play)/.test(n) ? " active" : "");
    if (/ad_?rev|ads?_revenue|revenue_ads?|iaa/.test(n)) return "Doanh thu QC / user";
    if (/iap|purchase/.test(n)) return "IAP / user";
    if (/rev|revenue|doanh_thu|ltv|arpu/.test(n)) return "Doanh thu / user";
    return col;
  }
  function fmtInt(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "."); }

  /** Đoạn tóm tắt dán Slack / báo cáo. */
  function summaryText(res, metrics, title) {
    const lines = [`*${title || "Kết quả AB"}* — ${res.verdict.title}`];
    if (res.verdict.detail) lines.push(res.verdict.detail);
    lines.push(`Nhánh gốc: ${res.control} · user: ${res.arms.map((a) => a.name + " " + fmtInt(a.users)).join(" / ")}`);
    for (const c of res.comps) {
      const parts = metrics.map((m) => {
        const r = c.metrics[m.col];
        return `${m.label} ${signedPct(r.rel)}${r.lo != null ? ` [${signedPct(r.lo)}…${signedPct(r.hi)}]` : ""}`;
      });
      lines.push(`• ${c.arm} vs ${res.control}: ${parts.join(" · ")}`);
    }
    const ws = res.warnings.filter((w) => w.level === "bad" || w.level === "warn");
    if (ws.length) lines.push("Lưu ý: " + ws.map((w) => w.text.split(" — ")[0]).join(" | "));
    if (res.cut) lines.push(`(Đã bỏ cohort cài sau ${res.cut})`);
    return lines.join("\n");
  }

  return { FIELDS, analyze, guessMetric, metricDay, prettyLabel, summaryText, signedPct, fmtInt, phi, chiSquareP };
});

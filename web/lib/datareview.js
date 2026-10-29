/* Data Review — đánh giá file dữ liệu như một người phân tích: nhận ra loại file, hậu kiểm số liệu, chấm từng level,
   chẩn đoán "bệnh" và đưa ra việc cần làm (sửa gì, sửa thế nào, dễ hơn hay khó hơn).
   Quy tắc rút từ các lần review export "Level insight tool" của team (CDS, Bird Sort):
   · chỉ chấm level có REACH ≥ 50; ngưỡng khác nhau theo giai đoạn (mặc định L1–23 / 24–40 / 41+);
   · cờ riêng: gai đột biến (drop ≥ trung vị 6 level lân cận + 1,5pp), giật nhịp (|Δ first_win| ≥ 20pp);
   · droprate kỳ vọng theo độ khó (hồi quy) → excess + z-score để tách "khó nên bỏ" với "rò không do khó";
   · tag Hard / Super Hard theo điểm 0–100; doanh thu quy đổi rev = sra + 0,67·sfa để không hạ khó level đang kiếm tiền;
   · hậu kiểm: event thua không bắn (lose_quit = 0), lose+win+mid ≈ droprate, hàng avg phải là trung bình theo reach…
   Không phụ thuộc giao diện — chạy được trong Node để test. */
(function (root, factory) {
  const T = typeof module === "object" && module.exports ? require("./table.js") : root.GDK.lib.table;
  const lib = factory(T);
  if (typeof module === "object" && module.exports) module.exports = lib;
  else root.GDK.lib.datareview = lib;
})(typeof self !== "undefined" ? self : this, function (T) {
  "use strict";

  // ------------------------------------------------------------------ cấu hình mặc định (sửa được trên giao diện)
  const DEFAULTS = {
    minReach: 50,                 // dưới mức này: "thiếu mẫu", không chấm
    phase1: 23, phase2: 40,       // L1–23 · L24–40 · L41+ (ranh giới thường là nơi mở ads / item)
    sfaWeight: 0.67,              // doanh thu quy đổi = sra + sfaWeight·sfa (tỉ lệ eCPM SFA/SRA)
    ptWinTarget: 90,              // giây — màn "vừa" nên thắng trong khoảng này
    spikePP: 0.015,               // gai: drop ≥ trung vị 6 lân cận + 1,5pp
    jerkPP: 0.20,                 // giật nhịp: |Δ first_win| ≥ 20pp
    quitAtt: 5,                   // người bỏ đã thử ≥ 5 lần → "bào mòn"
    ftue: 2,                      // level 1…ftue là màn hướng dẫn: người mới rời đi là bình thường, không chấm / không sửa
  };
  // ngưỡng theo giai đoạn: đỏ / vàng (đạt = không chạm ngưỡng nào)
  const PHASES = [
    { key: "P1", name: "Giai đoạn 1", red: { drop: 0.04 }, warn: { drop: 0.035, pt_total: 190 } },
    { key: "P2", name: "Giai đoạn 2", red: { drop: 0.045 }, warn: { drop: 0.035, ss_exit: 0.30 } },
    { key: "P3", name: "Giai đoạn 3", red: { drop: 0.035, win_rate_max: 0.45, quit_att: 5 }, warn: { drop: 0.03, attempts: 2.5 } },
  ];
  // hướng tốt của từng chỉ số (dùng cho so sánh version): 1 = cao là tốt, −1 = thấp là tốt, 0 = tuỳ ngữ cảnh
  const GOOD = { droprate: -1, remain: 1, lose_quit: -1, win_quit: 0, mid_quit: -1, attempts: 0, first_win: 1, win_rate: 1,
    pt_total: 0, pt_win: 0, pt_lose: 0, lose_retry: 1, quit_att: 1, ss_exit: -1, sfa: 0, sra: 0, user_helper: 0, helper: 0, user_iap: 0, iap: 0 };
  const LABEL = { reach: "Reach", droprate: "Droprate", remain: "Remain", lose_quit: "Thua rồi bỏ", win_quit: "Thắng rồi bỏ", mid_quit: "Bỏ giữa màn",
    attempts: "Số lần chơi", first_win: "Thắng lần đầu", win_rate: "Win rate", pt_total: "Thời gian chơi", pt_win: "Thời gian thắng",
    pt_lose: "Thời gian thua", lose_retry: "Thua rồi chơi lại", quit_att: "Số lần thử của người bỏ", ss_exit: "Kết thúc phiên",
    sfa: "Quảng cáo xen kẽ", sra: "Quảng cáo thưởng", user_helper: "% dùng item", helper: "Item / người", user_iap: "% mua IAP", iap: "IAP / người" };
  const PCT_METRICS = new Set(["droprate", "remain", "lose_quit", "win_quit", "mid_quit", "first_win", "win_rate", "lose_retry", "ss_exit", "user_helper", "user_iap"]);

  const num = (v) => {
    if (v == null) return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    const s = String(v).trim().replace(/−/g, "-").replace(/–/g, "-");
    if (!s || s === "-" || s === "—") return null;
    return T.toNumber(s);
  };
  const med = (a) => T.median(a.filter((x) => x != null && isFinite(x)));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pct = (v, d) => v == null || !isFinite(v) ? "—" : (v * 100).toFixed(d == null ? (Math.abs(v) < 0.1 ? 1 : 0) : d).replace(".", ",") + "%";
  const pp = (v) => v == null ? "—" : (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(1).replace(".", ",") + "pp";
  const n1 = (v, d = 2) => v == null || !isFinite(v) ? "—" : (+v.toFixed(d)).toString().replace(".", ",");
  const int = (n) => n == null || !isFinite(n) ? "—" : Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const metricKey = (s) => {
    const k = T.norm(s);
    const alias = { reached: "reach", users: "reach", user: "reach", level_users: "reach", drop: "droprate", drop_rate: "droprate",
      winrate: "win_rate", firstwin: "first_win", first_win_rate: "first_win", attempt: "attempts", playtime: "pt_total" };
    return alias[k] || k;
  };
  function ranges(xs) {
    const out = [];
    for (let i = 0; i < xs.length;) {
      let j = i;
      while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++;
      out.push(i === j ? String(xs[i]) : xs[i] + "–" + xs[j]);
      i = j + 1;
    }
    return out.slice(0, 10).join(", ") + (out.length > 10 ? "…" : "");
  }
  function corr(xs, ys) {
    const p = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => x != null && y != null && isFinite(x) && isFinite(y));
    if (p.length < 8) return null;
    const mx = p.reduce((s, q) => s + q[0], 0) / p.length, my = p.reduce((s, q) => s + q[1], 0) / p.length;
    let a = 0, b = 0, c = 0;
    for (const [x, y] of p) { a += (x - mx) * (y - my); b += (x - mx) ** 2; c += (y - my) ** 2; }
    return b && c ? a / Math.sqrt(b * c) : null;
  }

  // ================================================================== nhận dạng + đọc file
  /** Ma trận thô từ bảng đã đọc (header + từng dòng theo đúng thứ tự cột). */
  function matrixOf(t) {
    return [t.rawHeaders || t.headers].concat(t.rows.map((r) => t.headers.map((h) => r[h] == null ? "" : String(r[h]))));
  }
  const VER_RE = /^(v\d+[a-z]?|Δ|delta|control|treatment|ctrl|test|a|b)$/i;

  /** Export "Level insight tool": tiêu đề 3 tầng (nhóm → chỉ số → version v0/v1/Δ), mỗi hàng 1 level, có hàng avg. */
  function parseInsight(t) {
    const m = matrixOf(t);
    if (m.length < 4) return null;
    // tìm hàng version trong 4 hàng đầu
    let vr = -1;
    for (let i = 1; i < Math.min(4, m.length); i++) {
      const cells = m[i].map((x) => String(x).trim()).filter(Boolean);
      if (cells.length >= 3 && cells.filter((x) => VER_RE.test(x)).length / cells.length >= 0.8) { vr = i; break; }
    }
    if (vr < 1) return null;
    const lvName = T.norm(m[0][0]);
    if (!/^(lv|level|lvl|stage|man)$/.test(lvName) && !/^(lv|level)/.test(lvName)) return null;
    // tên chỉ số = ô ở hàng ngay trên hàng version; ô trống thì: nếu hàng nhóm có chữ (vd "REACH" không có dòng chỉ số)
    // thì dùng chữ đó, không thì là cột tiếp theo của chỉ số đứng trước (droprate, , → v0 v1 Δ)
    const cols = [];
    let last = "";
    for (let j = 1; j < m[vr].length; j++) {
      const own = String(m[vr - 1][j] || "").trim(), group = vr > 1 ? String(m[0][j] || "").trim() : "";
      const name = own || group || last;
      last = name;
      const ver = String(m[vr][j] || "").trim();
      if (!name || !ver) continue;
      cols.push({ j, metric: metricKey(name), ver: /^(Δ|delta)$/i.test(ver) ? "Δ" : ver });
    }
    const versions = [...new Set(cols.filter((c) => c.ver !== "Δ").map((c) => c.ver))];
    if (!versions.length || !cols.some((c) => c.metric === "reach")) return null;
    const metrics = [...new Set(cols.map((c) => c.metric))];
    const levels = [];
    let avg = null;
    for (let i = vr + 1; i < m.length; i++) {
      const row = m[i], key = String(row[0] || "").trim();
      const rec = { v: {}, d: {} };
      versions.forEach((v) => { rec.v[v] = {}; });
      for (const c of cols) {
        const val = num(row[c.j]);
        if (c.ver === "Δ") rec.d[c.metric] = val; else rec.v[c.ver][c.metric] = val;
      }
      if (/^(avg|average|tb|trung binh|total|tong)/i.test(T.norm(key))) { avg = rec; continue; }
      const lv = T.toLevel(key);
      if (lv == null || !Number.isFinite(lv)) continue;
      rec.level = lv;
      levels.push(rec);
    }
    levels.sort((a, b) => a.level - b.level);
    return { kind: "level-insight", versions, metrics, hasDelta: cols.some((c) => c.ver === "Δ"), levels, avg, headerRows: vr + 1 };
  }

  // bảng level đơn giản: level + users / start / win / lose (+ cột chỉ số nếu có)
  const SIMPLE = {
    level: ["level", "lvl", "lv", "level_id", "level_number", "stage", "man"],
    reach: ["reach", "reached", "users", "user", "unique_users", "players", "level_users", "so_user"],
    starts: ["start", "starts", "level_start", "plays", "play", "attempts_total", "luot_choi"],
    wins: ["win", "wins", "level_win", "complete", "completed", "pass", "thang"],
    losses: ["lose", "loses", "loss", "losses", "level_lose", "fail", "thua"],
  };
  function parseLevelTable(t) {
    const H = t.headers.map((h) => [h, metricKey(h)]);
    const find = (keys) => (H.find(([, k]) => keys.includes(k)) || [])[0];
    const lvCol = find(SIMPLE.level);
    if (!lvCol) return null;
    const cols = { reach: find(SIMPLE.reach), starts: find(SIMPLE.starts), wins: find(SIMPLE.wins), losses: find(SIMPLE.losses) };
    const known = H.filter(([, k]) => k in GOOD).map(([h, k]) => [h, k]);
    if (!cols.reach && !known.some(([, k]) => k === "droprate")) return null;
    const by = new Map();
    for (const r of t.rows) {
      const lv = T.toLevel(r[lvCol]);
      if (lv == null || !Number.isFinite(lv)) continue;
      const cur = by.get(lv) || { level: lv, _n: 0 };
      cur._n++;
      for (const k of ["reach", "starts", "wins", "losses"]) if (cols[k]) { const v = num(r[cols[k]]); if (v != null) cur[k] = (cur[k] || 0) + v; }
      for (const [h, k] of known) { const v = num(r[h]); if (v != null) cur[k] = v; }   // chỉ số có sẵn (lấy dòng cuối)
      by.set(lv, cur);
    }
    const levels = [...by.values()].sort((a, b) => a.level - b.level).map((x) => {
      const o = Object.assign({}, x);
      if (o.starts > 0 && o.wins != null && o.win_rate == null) o.win_rate = Math.min(1, o.wins / o.starts);
      if (o.reach > 0 && o.starts != null && o.attempts == null) o.attempts = o.starts / o.reach;
      return { level: o.level, v: { "Tất cả": o }, d: {} };
    });
    if (levels.length < 3) return null;
    return { kind: "level-table", versions: ["Tất cả"], metrics: Object.keys(levels[0].v["Tất cả"]), hasDelta: false, levels, avg: null,
      aggregated: [...by.values()].some((x) => x._n > 1) };
  }

  // cohort: cột ngày cài + D0..Dn (retention / doanh thu theo ngày)
  function parseCohort(t) {
    const dcols = t.headers.filter((h) => /^(d|day)_?\d+$/i.test(T.norm(h))).map((h) => ({ h, d: +T.norm(h).replace(/\D/g, "") }));
    if (dcols.length < 3) return null;
    const dateCol = t.headers.find((h) => /date|ngay|cohort|install/.test(T.norm(h)) && t.rows.some((r) => T.toDate(r[h])));
    if (!dateCol) return null;
    return { kind: "cohort", dateCol, dcols: dcols.sort((a, b) => a.d - b.d) };
  }

  function detect(t) {
    return parseInsight(t) || parseCohort(t) || parseLevelTable(t) || { kind: "table" };
  }

  // ================================================================== gộp version (trung bình theo reach)
  function levelsFor(parsed, ver) {
    if (ver !== "__all" || parsed.versions.length === 1) {
      const v = ver === "__all" ? parsed.versions[0] : ver;
      return parsed.levels.map((r) => Object.assign({ level: r.level }, r.v[v] || {}, { delta: r.d }));
    }
    return parsed.levels.map((r) => {
      const out = { level: r.level, delta: r.d };
      const vs = parsed.versions.map((v) => r.v[v] || {});
      const W = vs.reduce((s, x) => s + (x.reach || 0), 0);
      out.reach = W;
      for (const k of parsed.metrics) {
        if (k === "reach") continue;
        let s = 0, w = 0;
        vs.forEach((x) => { if (x[k] != null && x.reach) { s += x[k] * x.reach; w += x.reach; } });
        out[k] = w ? s / w : null;
      }
      return out;
    });
  }

  // ================================================================== chấm + chẩn đoán từng level
  function phaseOf(level, o) { return level <= o.phase1 ? PHASES[0] : level <= o.phase2 ? PHASES[1] : PHASES[2]; }

  function review(levelsIn, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const L = levelsIn.map((x) => Object.assign({}, x)).sort((a, b) => a.level - b.level);
    const n = L.length;
    // droprate tính lại từ reach (để hậu kiểm + dùng khi file không có cột droprate)
    L.forEach((x, i) => {
      const nx = L[i + 1];
      x.dropCalc = nx && nx.level === x.level + 1 && x.reach > 0 && nx.reach != null ? Math.max(0, 1 - nx.reach / x.reach) : null;
      if (x.droprate == null) x.droprate = x.dropCalc;
      x.isLast = i === n - 1;
      x.ftue = x.level <= o.ftue;
      x.ok = x.reach != null && x.reach >= o.minReach && !x.isLast && !x.ftue;
      x.lost = x.reach != null && x.droprate != null ? x.reach * x.droprate : null;
      x.rev = x.sra != null || x.sfa != null ? (x.sra || 0) + o.sfaWeight * (x.sfa || 0) : null;
      x.winQuitShare = x.win_quit != null && x.droprate > 0 ? Math.min(1, x.win_quit / x.droprate) : null;
    });
    const okL = L.filter((x) => x.ok);

    // droprate kỳ vọng theo độ khó: hồi quy có trọng số reach, biến = 1 − win_rate (hoặc 1 − first_win, attempts)
    const feat = ["win_rate", "first_win", "attempts"].find((k) => okL.filter((x) => x[k] != null).length >= 8);
    const fx = (x) => feat === "attempts" ? x.attempts : 1 - x[feat];
    let model = null;
    if (feat) {
      const P = okL.filter((x, i) => i >= 2 && x.droprate != null && x[feat] != null);
      const W = P.reduce((s, x) => s + x.reach, 0);
      if (P.length >= 8 && W > 0) {
        const mx = P.reduce((s, x) => s + fx(x) * x.reach, 0) / W, my = P.reduce((s, x) => s + x.droprate * x.reach, 0) / W;
        let a = 0, b = 0;
        for (const x of P) { a += x.reach * (fx(x) - mx) * (x.droprate - my); b += x.reach * (fx(x) - mx) ** 2; }
        const slope = b ? Math.max(0, a / b) : 0;
        model = { feat, slope, icpt: my - slope * mx };
      }
    }
    L.forEach((x) => {
      if (model && x[feat] != null && x.droprate != null) {
        x.expDrop = clamp(model.icpt + model.slope * fx(x), 0.0005, 0.9);
        x.excess = x.droprate - x.expDrop;
        x.z = x.reach > 0 ? x.excess / Math.sqrt(x.expDrop * (1 - x.expDrop) / x.reach) : null;
      }
    });

    // so với lân cận
    L.forEach((x, i) => {
      const nb = (k, w) => { const out = []; for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) if (j !== i && L[j].ok && L[j][k] != null) out.push(L[j][k]); return out; };
      x.nbDrop = med(nb("droprate", 3));
      // gai: cao hơn trung vị lân cận ≥ 1,5pp VÀ có ý nghĩa thống kê (z ≥ 2) — tránh báo nhầm ở level ít người
      const nbp = clamp(x.nbDrop || 0, 0.002, 0.9);
      x.spike = x.ok && x.droprate != null && x.nbDrop != null && x.droprate >= x.nbDrop + o.spikePP
        && (x.droprate - nbp) / Math.sqrt(nbp * (1 - nbp) / x.reach) >= 2;
      const prev = L[i - 1];
      x.jumpFW = prev && prev.level === x.level - 1 && x.first_win != null && prev.first_win != null ? x.first_win - prev.first_win : null;
      x.jumpWR = prev && prev.level === x.level - 1 && x.win_rate != null && prev.win_rate != null ? x.win_rate - prev.win_rate : null;
      const jump = [x.jumpFW, x.jumpWR].filter((v) => v != null).sort((a, b) => Math.abs(b) - Math.abs(a))[0];
      x.jump = jump == null ? null : jump;
      // tụt mạnh so với level trước → chính level này là tường; nhảy lên mạnh → level TRƯỚC là tường (level này là nghỉ)
      x.jerk = x.ok && jump != null && jump <= -o.jerkPP;
      if (prev && prev.ok && jump != null && jump >= o.jerkPP) { prev.wallBefore = jump; }
      x.targetWR = med(nb("win_rate", 5));
      x.nbPt = med(nb("pt_win", 5)); x.nbSs = med(nb("ss_exit", 5));
      // màn dài: so với mục tiêu VÀ với các level lân cận (level cao màn nào cũng dài hơn), trong khi không khó
      x.long = x.ok && x.pt_win != null && x.pt_win >= o.ptWinTarget * 1.6 && (x.nbPt == null || x.pt_win >= x.nbPt * 1.35)
        && (x.attempts == null || x.attempts <= 1.2);
      x.nbRev = med(nb("rev", 6));
      // trợ giúp (item + quảng cáo thưởng) so với trung vị ±12 level — chuẩn hoá cục bộ vì item tăng dần theo tiến trình
      const ah = [x.helper, x.sra].filter((v) => v != null);
      const bh = [med(nb("helper", 12)), med(nb("sra", 12))].filter((v) => v != null && v > 0);
      x.assistRatio = ah.length && bh.length === ah.length ? (ah.reduce((s, v) => s + v, 0) / ah.length) / (bh.reduce((s, v) => s + v, 0) / bh.length) : null;
    });

    // tag Hard / Super Hard (điểm 0–100, chia lại trọng số theo chỉ số có mặt)
    const lin = (v, a, b) => v == null ? null : clamp((v - a) / (b - a), 0, 1);
    L.forEach((x) => {
      const parts = [[30, lin(x.attempts, 1.15, 2.2)], [22, lin(x.first_win == null ? null : -x.first_win, -0.9, -0.65)], [13, lin(x.ss_exit, 0.12, 0.3)],
        [12, lin(x.droprate, 0.03, 0.08)], [8, lin(x.mid_quit, 0.015, 0.05)], [15, lin(x.assistRatio, 1, 2.2)]].filter(([, v]) => v != null);
      const w = parts.reduce((s, [k]) => s + k, 0);
      x.hardScore = w ? Math.round(parts.reduce((s, [k, v]) => s + k * v, 0) / w * 100) : null;
      x.tag = !x.ok ? "" : (x.hardScore >= 68 || x.attempts >= 2) ? "Super Hard" : (x.hardScore >= 36 || x.attempts >= 1.55) ? "Hard" : "";
    });

    // vùng phẳng: ≥ 4 level liền nhau quá dễ (chỉ giai đoạn 2–3)
    let run = [];
    const flush = () => {
      if (run.length >= 4) {
        const mid = run[Math.floor(run.length / 2)];
        run.forEach((x) => { x.flat = [run[0].level, run[run.length - 1].level]; x.flatMain = x === mid ? true : mid.level; });
      }
      run = [];
    };
    L.forEach((x) => {
      const easy = x.ok && x.level > o.phase1 && x.first_win != null && x.first_win >= 0.95 && (x.attempts == null || x.attempts <= 1.06);
      if (easy && (!run.length || run[run.length - 1].level === x.level - 1)) run.push(x); else { flush(); if (easy) run.push(x); }
    });
    flush();

    // trạng thái theo giai đoạn + chẩn đoán + hành động
    L.forEach((x) => {
      const ph = phaseOf(x.level, o);
      x.phase = ph.key;
      if (!x.ok) { x.status = x.isLast ? "cuối" : x.ftue ? "hướng dẫn" : "thiếu mẫu"; x.reasons = []; return; }
      const red = [], warn = [];
      if (x.droprate != null && x.droprate >= ph.red.drop) red.push("droprate " + pct(x.droprate) + " ≥ " + pct(ph.red.drop));
      if (ph.red.win_rate_max && x.win_rate != null && x.win_rate <= ph.red.win_rate_max) red.push("win rate " + pct(x.win_rate) + " ≤ " + pct(ph.red.win_rate_max));
      if (ph.red.quit_att && x.quit_att != null && x.quit_att >= ph.red.quit_att) red.push("người bỏ đã thử " + n1(x.quit_att, 1) + " lần");
      if (!red.length) {
        if (x.droprate != null && x.droprate >= ph.warn.drop) warn.push("droprate " + pct(x.droprate) + " ≥ " + pct(ph.warn.drop));
        if (ph.warn.pt_total && x.pt_total != null && x.pt_total >= ph.warn.pt_total) warn.push("chơi lâu " + Math.round(x.pt_total) + "s");
        if (ph.warn.ss_exit && x.ss_exit != null && x.ss_exit >= Math.max(ph.warn.ss_exit, (x.nbSs || 0) * 1.4)) warn.push("kết thúc phiên " + pct(x.ss_exit));
        if (ph.warn.attempts && x.attempts != null && x.attempts >= ph.warn.attempts) warn.push(n1(x.attempts) + " lần chơi / người");
      }
      if (x.spike) warn.push("gai droprate (lân cận " + pct(x.nbDrop) + ")");
      if (x.jerk) warn.push("tụt " + pp(x.jump).replace(/^[+−]/, "") + " tỉ lệ thắng so với level trước");
      if (x.wallBefore) warn.push("level sau dễ hơn hẳn (+" + pp(x.wallBefore).replace(/^[+−]/, "") + ") — nhịp gãy");
      if (x.flat) warn.push("vùng quá dễ liên tiếp");
      if (x.long && !warn.some((w) => w.startsWith("chơi lâu"))) warn.push("thắng mất " + Math.round(x.pt_win) + "s" + (x.nbPt ? " (lân cận " + Math.round(x.nbPt) + "s)" : ""));
      x.status = red.length ? "đỏ" : warn.length ? "vàng" : "đạt";
      x.reasons = red.concat(warn);
      diagnose(x, o, ph);
    });

    // ưu tiên: theo số user mất + mức độ
    const flagged = L.filter((x) => x.fix && x.fix.change !== "Không sửa");
    const lostQ = T.quantile(flagged.map((x) => x.lost || 0), 0.75) || 0, lostM = T.median(flagged.map((x) => x.lost || 0)) || 0;
    flagged.forEach((x) => {
      x.lowConf = x.reach < o.minReach * 4;            // ít người: kết luận yếu → không xếp ưu tiên cao
      x.priority = x.lowConf ? "P2"
        : (x.status === "đỏ" || x.spike || x.jerk || x.wallBefore) && (x.lost || 0) >= lostQ ? "P0"
          : x.status === "đỏ" || (x.lost || 0) >= lostM ? "P1" : "P2";
    });
    const summary = summarize(L, o, model);
    return { levels: L, model, summary, opts: o };
  }

  function diagnose(x, o, ph) {
    // nhịp răng cưa (khó ↔ nghỉ) là thiết kế: chỉ coi là "tường cần sửa" khi nhịp gãy rất mạnh (≥ 30pp) hoặc vừa khó vừa drop cao
    const dropHigh = (x.droprate != null && x.droprate >= ph.warn.drop) || x.spike;
    const bigJump = Math.max(-(x.jump || 0), x.wallBefore || 0) >= 0.45;
    const hardSig = bigJump || (dropHigh && (x.tag === "Super Hard" || x.jerk || !!x.wallBefore
      || (x.win_rate != null && x.targetWR != null && x.win_rate <= x.targetWR - 0.15)));
    const hard = hardSig || x.tag === "Hard" || x.tag === "Super Hard";
    const leak = (x.excess != null && x.excess >= 0.01 && (x.z == null || x.z >= 2)) || (x.spike && !hardSig);
    const long = x.long && !hard;
    // đích: vẫn khó hơn lân cận ~8pp (giữ nhịp khó), nhưng tăng ít nhất 8pp so với hiện tại
    const wrT = winTarget(x);
    x.wrTarget = wrT;
    const target = wrT != null ? " về ~" + pct(wrT) + " (lân cận " + pct(x.targetWR) + ", vẫn giữ là level khó)" : "";
    let fix = null;
    if (x.status === "đạt" && !x.flat) { x.fix = null; return; }
    if (hard && leak) fix = { group: "Vừa khó vừa rò", change: "Dễ hơn", what: "Hạ độ khó" + target + "; nếu level dài thì tách đôi. Kiểm tra thêm popup / quảng cáo ngay sau level." };
    else if (x.quit_att != null && x.quit_att >= o.quitAtt && hard && !bigJump) fix = { group: "Bào mòn — thua nhiều lần rồi bỏ", change: "Giữ độ khó", what: "Cắt đuôi thất bại: sau 4 lần thua mở gợi ý + tặng 1 undo (giữ độ khó và doanh thu), mục tiêu người bỏ thử ≤ 3 lần." };
    else if (hardSig) fix = { group: "Tường / spike khó", change: "Dễ hơn", what: "Nới độ khó" + target + " — giảm số màu / số bước, hoặc chèn 1–2 level đệm ~80% ngay trước level này."
      + (x.quit_att != null && x.quit_att >= o.quitAtt ? " Người bỏ đã thử " + n1(x.quit_att, 1) + " lần → thêm cắt đuôi thất bại (sau 4 lần thua mở gợi ý)." : "") };
    else if (long) fix = { group: "Quá dài, không khó", change: "Rút ngắn (giữ độ khó)", what: "Bớt ống / bước để thời gian thắng về ~" + Math.round(o.ptWinTarget * 0.7) + "–" + o.ptWinTarget + "s (đang " + Math.round(x.pt_win) + "s)." };
    else if (leak && x.winQuitShare != null && x.winQuitShare >= 0.5) fix = { group: "Thắng xong rồi rời game", change: "Không đổi độ khó", what: "Giữ level; sửa móc câu sau màn thắng (" + pct(x.winQuitShare) + " người bỏ là sau khi thắng): hé lộ phần thưởng / tiến trình, level kế tiếp hấp dẫn hơn." };
    else if (leak) fix = { group: "Rò không do khó", change: "Không đổi độ khó", what: "Giữ level; kiểm tra popup, quảng cáo xen kẽ, cổng mở khoá item tại level này (droprate vượt kỳ vọng " + pp(x.excess) + ")." };
    else if (x.ss_exit != null && x.ss_exit >= Math.max(0.3, (x.nbSs || 0) * 1.4)) fix = { group: "Kết thúc phiên tại level", change: "Sửa config", what: "Dời quảng cáo xen kẽ / popup ra khỏi level này bằng remote config (ss_exit " + pct(x.ss_exit) + ")." };
    else if (x.flat && x.flatMain === true) fix = { group: "Vùng phẳng (quá dễ)", change: "Khó hơn", what: "Dải LV" + x.flat[0] + "–" + x.flat[1] + " quá dễ liên tiếp — làm khó level này lên mức “vừa” (first win ~86–90%, đang " + pct(x.first_win) + ") để tạo nhịp." };
    else if (x.flat) fix = { group: "Vùng phẳng (quá dễ)", change: "Không sửa", what: "Thuộc dải quá dễ LV" + x.flat[0] + "–" + x.flat[1] + " — chỉ cần làm khó LV" + x.flatMain + "." };
    else if (hard) fix = { group: "Khó nhưng giữ chân ổn", change: "Không sửa", what: "Droprate đúng mức kỳ vọng với độ khó — giữ làm điểm nhấn." };
    else if (x.jerk || x.wallBefore) fix = { group: "Nhịp đổi mạnh nhưng giữ chân ổn", change: "Không sửa", what: "Tỉ lệ thắng chênh ≥ 20pp với level kề nhưng droprate trong kỳ vọng — giữ nếu đây là nhịp thiết kế (khó ↔ nghỉ)." };
    else fix = { group: "Drop cao nhưng đúng kỳ vọng", change: "Không sửa", what: "Droprate khớp mức độ khó của level — theo dõi ở bản sau." };
    // không hạ độ khó level đang kiếm tiền mà giữ chân vẫn trong ngưỡng
    if (fix.change === "Dễ hơn" && !x.spike && x.rev != null && x.nbRev > 0 && x.rev >= x.nbRev * 1.5 && (x.excess == null || x.excess <= 0.005)) {
      fix = { group: fix.group + " — đang kiếm tiền", change: "Không sửa", what: "Không hạ độ khó: quảng cáo quy đổi gấp " + n1(x.rev / x.nbRev, 1) + "× lân cận mà droprate không vượt kỳ vọng — hạ khó dễ lỗ doanh thu." };
    }
    x.fix = fix;
  }

  function winTarget(x) {
    if (x.targetWR == null) return null;
    const cur = x.win_rate || 0;
    return Math.max(Math.min(x.targetWR, Math.max(x.targetWR - 0.08, cur + 0.08)), cur);
  }

  function summarize(L, o, model) {
    const ok = L.filter((x) => x.ok);
    const fixes = L.filter((x) => x.fix && x.fix.change !== "Không sửa");
    const groups = {};
    fixes.forEach((x) => { groups[x.fix.group] = (groups[x.fix.group] || []).concat(x.level); });
    const lost = fixes.reduce((s, x) => s + (x.lost || 0), 0);
    const sample = L.filter((x) => !x.ok && !x.isLast).map((x) => x.level);
    return {
      levels: L.length, rated: ok.length, red: ok.filter((x) => x.status === "đỏ").length, warn: ok.filter((x) => x.status === "vàng").length,
      pass: ok.filter((x) => x.status === "đạt").length, fixes: fixes.length, lost, groups,
      p0: fixes.filter((x) => x.priority === "P0").sort((a, b) => (b.lost || 0) - (a.lost || 0)),
      lowSample: sample, hard: ok.filter((x) => x.tag === "Hard").length, superHard: ok.filter((x) => x.tag === "Super Hard").length,
      model: model ? "droprate kỳ vọng theo " + (model.feat === "attempts" ? "số lần chơi" : model.feat === "win_rate" ? "win rate" : "first win") : "",
    };
  }

  // ================================================================== hậu kiểm dữ liệu (chỉ số level)
  function audit(parsed, ver, o) {
    o = Object.assign({}, DEFAULTS, o || {});
    const out = [];
    const add = (level, title, detail, action, where) => out.push({ level, title, detail, action, where });
    const L = levelsFor(parsed, ver).filter((x) => x.reach != null);
    const ok = L.filter((x, i) => x.reach >= o.minReach && i < L.length - 1);
    const has = (k) => ok.some((x) => x[k] != null);
    if (!L.length) return out;

    const share = (k) => { let a = 0, b = 0; ok.forEach((x) => { if (x[k] != null && x.droprate != null) { a += x[k] * x.reach; b += x.droprate * x.reach; } }); return b ? a / b : null; };
    const lq = share("lose_quit");
    if (has("lose_quit") && lq != null && lq < 0.05 && ok.filter((x) => x.win_rate != null && x.win_rate < 0.8).length >= 3) {
      add("bad", "Event thua không bắn — lose_quit gần như = 0 (" + pct(lq) + " số người bỏ)", "Nhiều level có win rate < 90% (chắc chắn có lượt thua) nhưng không ai được tính là “thua rồi bỏ”. Phần bỏ vì thua đang bị dồn vào mid_quit.",
        "Sửa event end_level_detail (result = lose, param time). Trong lúc chờ: đọc mid_quit là “túi gộp”; chẩn đoán bằng first_win / attempts (mid_quit cao + first_win cao → màn quá dài; first_win thấp → màn quá khó).", "lose_quit");
    }
    if (has("pt_lose")) {
      const z = ok.filter((x) => x.win_rate != null && x.win_rate < 0.95 && !x.pt_lose).length, base = ok.filter((x) => x.win_rate != null && x.win_rate < 0.95).length;
      if (base >= 5 && z / base >= 0.8) add("warn", "Thời gian lượt thua = 0", z + "/" + base + " level có lượt thua nhưng pt_lose = 0 — param time của lượt thua không được ghi.", "Bổ sung param time cho lượt thua; đừng so pt_lose giữa các level.", "pt_lose");
    }
    if (has("lose_retry")) {
      const empty = ok.filter((x) => x.lose_retry == null || x.lose_retry === 0).map((x) => x.level);
      if (empty.length >= 5 && empty.length < ok.length) add("warn", "lose_retry trống ở một số level", "Trống ở: " + ranges(empty) + " — event thua có thể chưa bắn ở dải này.", "Kiểm tra event thua ở các level đó trước khi đọc tỉ lệ chơi lại.", "lose_retry");
    }
    if (has("mid_quit") && has("win_quit") && has("droprate")) {
      const bad = ok.filter((x) => x.droprate > 0.005 && x.mid_quit != null && Math.abs((x.lose_quit || 0) + (x.win_quit || 0) + x.mid_quit - x.droprate) > Math.max(0.005, x.droprate * 0.3));
      if (bad.length / ok.length >= 0.2) add("warn", "lose + win + mid quit không khớp droprate", bad.length + " level lệch > 30% (vd LV" + bad[0].level + ": tổng " + pct((bad[0].lose_quit || 0) + (bad[0].win_quit || 0) + bad[0].mid_quit) + " vs droprate " + pct(bad[0].droprate) + ").",
        "Một số user thiếu event play_level / end_level_detail — chỉ dùng phần trăm tương đối giữa 3 loại bỏ, đừng cộng tuyệt đối.", "droprate");
    }
    if (has("droprate")) {
      const R = review(L, o).levels.filter((x) => x.ok && x.dropCalc != null && x.droprate != null);
      const off = R.filter((x) => Math.abs(x.droprate - x.dropCalc) > Math.max(0.005, x.dropCalc * 0.25));
      if (R.length >= 5 && off.length / R.length >= 0.2) add("warn", "Droprate trong file không khớp REACH", off.length + "/" + R.length + " level: droprate ≠ 1 − reach(N+1)/reach(N) (vd LV" + off[0].level + ": " + pct(off[0].droprate) + " vs tính lại " + pct(off[0].dropCalc) + ").",
        "Có thể khác cửa sổ đo / cách đếm. So sánh THỨ HẠNG giữa các level thì được, đừng so giá trị tuyệt đối với file khác.", "droprate");
    }
    const up = L.filter((x, i) => i > 0 && L[i - 1].level === x.level - 1 && x.reach > L[i - 1].reach * 1.02 && L[i - 1].reach >= o.minReach);
    if (up.length) add("warn", "Reach tăng ở level sau", "Level " + ranges(up.map((x) => x.level)) + " có nhiều người hơn level trước — vô lý với dữ liệu luỹ kế.",
      "Kiểm tra có trộn nhiều bộ level / nhiều version không (param level không ghi levelVer).", "reach");
    const gaps = [];
    for (let i = 1; i < L.length; i++) for (let v = L[i - 1].level + 1; v < L[i].level && gaps.length < 200; v++) gaps.push(v);
    if (gaps.length) add("warn", "Thiếu level trong dãy", "Thiếu: " + ranges(gaps) + " — droprate quanh các level này không tính được.", "Xuất lại đủ dãy level.", "LV");
    const low = L.filter((x, i) => x.reach < o.minReach && i < L.length - 1).map((x) => x.level);
    if (low.length) add("info", "Level thiếu mẫu (reach < " + o.minReach + ")", "Không chấm: " + ranges(low) + ". Kết luận ở dải này chỉ là tham khảo.", "Chờ thêm dữ liệu hoặc gộp nhiều ngày / version.", "REACH");
    add("info", "Level cuối không chấm droprate", "LV" + L[L.length - 1].level + " là level cuối của file — người dừng ở đây gồm cả người chơi hết nội dung.", "", "LV");
    if (parsed.avg && ver !== "__all" && parsed.avg.v[ver]) {
      // tính lại trung bình theo reach từ chính các level trong file và đặt cạnh hàng avg — chỉ nêu số, không phán
      const A = parsed.avg.v[ver], diff = [];
      for (const k of ["droprate", "win_rate", "first_win", "attempts"]) {
        if (A[k] == null) continue;
        const pts = L.filter((x) => x[k] != null && x.reach > 0);
        const W = pts.reduce((s, x) => s + x.reach, 0);
        const w = W ? pts.reduce((s, x) => s + x[k] * x.reach, 0) / W : null;
        if (w != null && Math.abs(w - A[k]) > Math.max(0.003, Math.abs(A[k]) * 0.1)) diff.push(k + ": file " + (PCT_METRICS.has(k) ? pct(A[k]) : n1(A[k])) + " · tính lại " + (PCT_METRICS.has(k) ? pct(w) : n1(w)));
      }
      if (diff.length) add("info", "Hàng avg khác trung bình theo reach tính lại", diff.join(" — ") + ". Có thể file tính avg trên phạm vi / cách đếm khác.",
        "Khi so 2 version, dùng bảng so sánh của tool (cùng 1 cách tính cho cả 2 bên), đừng trộn với hàng avg của file.", "avg");
    }
    if (has("win_rate") && has("attempts")) {
      const c = corr(ok.map((x) => x.win_rate), ok.map((x) => x.attempts ? 1 / x.attempts : null));
      if (c != null && c >= 0.95) add("info", "win_rate ≈ 1 / attempts", "Tương quan " + n1(c) + " — hai chỉ số đo cùng một thứ.", "Khi chấm điểm độ khó chỉ dùng 1 trong 2, không cộng đôi.", "win_rate");
    }
    if (has("sfa")) {
      const c = corr(ok.map((x) => x.level), ok.map((x) => x.sfa));
      if (c != null && c >= 0.6) add("info", "Quảng cáo xen kẽ tăng theo level", "Tương quan sfa với số level = " + n1(c) + " — do tần suất ads theo tiến trình, không do độ khó.", "Không dùng sfa để chấm độ khó; chỉ dùng để tính doanh thu.", "sfa");
    }
    return out;
  }

  // ================================================================== so sánh version (v0 / v1)
  function compare(parsed, o) {
    o = Object.assign({}, DEFAULTS, o || {});
    if (parsed.versions.length < 2) return null;
    const [c, t] = parsed.versions;
    const rows = [];
    for (const k of parsed.metrics) {
      if (k === "reach") continue;
      let s = 0, w = 0, sc = 0, st = 0;
      for (const r of parsed.levels) {
        const a = r.v[c] || {}, b = r.v[t] || {};
        if (a[k] == null || b[k] == null || !a.reach) continue;
        s += (b[k] - a[k]) * a.reach; w += a.reach; sc += a[k] * a.reach; st += b[k] * a.reach;
      }
      if (!w) continue;
      const d = s / w, base = sc / w, rel = base ? d / Math.abs(base) : null;
      const good = GOOD[k] || 0;
      const verdict = rel == null || Math.abs(rel) < 0.02 ? "Gần như không đổi" : good === 0 ? (d > 0 ? "Tăng" : "Giảm") : d * good > 0 ? "Tốt hơn" : "Tệ hơn";
      rows.push({ metric: k, label: LABEL[k] || k, control: base, treat: st / w, delta: d, rel, verdict, isPct: PCT_METRICS.has(k),
        fileDelta: parsed.avg && parsed.avg.d ? parsed.avg.d[k] : null });
    }
    // level mà treatment tệ hơn rõ (droprate cao hơn ≥ 1,5pp, z ≥ 2)
    const worse = [];
    for (const r of parsed.levels) {
      const a = r.v[c] || {}, b = r.v[t] || {};
      if (a.droprate == null || b.droprate == null || (a.reach || 0) < o.minReach || (b.reach || 0) < o.minReach) continue;
      const d = b.droprate - a.droprate, p = (a.droprate * a.reach + b.droprate * b.reach) / (a.reach + b.reach);
      const se = Math.sqrt(p * (1 - p) * (1 / a.reach + 1 / b.reach));
      const z = se ? d / se : 0;
      if (Math.abs(d) >= 0.015 && Math.abs(z) >= 2) worse.push({ level: r.level, d, z, wr: b.win_rate != null && a.win_rate != null ? b.win_rate - a.win_rate : null, better: d < 0 });
    }
    return { control: c, treat: t, rows, levels: worse.sort((a, b) => b.d - a.d) };
  }

  // ================================================================== cohort: ô cuối mỗi hàng là ngày chưa đủ
  function auditCohort(t, p) {
    const out = [];
    const stops = [];
    for (const r of t.rows) {
      const d0 = T.toDate(r[p.dateCol]);
      if (!d0) continue;
      let lastD = null, lastV = null, prevV = null;
      for (const c of p.dcols) { const v = num(r[c.h]); if (v != null) { prevV = lastV; lastV = v; lastD = c.d; } }
      if (lastD == null) continue;
      const dt = new Date(d0 + "T00:00:00Z"); dt.setUTCDate(dt.getUTCDate() + lastD);
      stops.push({ date: dt.toISOString().slice(0, 10), drop: prevV ? lastV / prevV : null });
    }
    if (stops.length >= 3) {
      const cnt = {};
      stops.forEach((s) => { cnt[s.date] = (cnt[s.date] || 0) + 1; });
      const [day, k] = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
      const ratio = med(stops.filter((s) => s.date === day).map((s) => s.drop));
      if (k / stops.length >= 0.6 && (ratio == null || ratio < 0.8)) {
        out.push({ level: "bad", title: "Ô cuối mỗi hàng là ngày chưa đủ dữ liệu", where: p.dateCol,
          detail: k + "/" + stops.length + " hàng dừng đúng ngày " + day + " (ngày kéo report)" + (ratio != null ? ", giá trị chỉ bằng ~" + pct(ratio) + " ô liền trước" : "") + " — trông như “tụt” nhưng không phải.",
          action: "Bỏ ô cuối của MỌI hàng trước khi phân tích; kiểm tra cửa sổ ngày cần xem không chạm ngày " + day + "." });
      }
    }
    if (t.rows.some((r) => /^(avg|average|trung)/i.test(String(r[p.dateCol] || "").trim()))) {
      out.push({ level: "warn", title: "Hàng avg trộn số cohort khác nhau", where: p.dateCol,
        detail: "Mỗi cột D có số cohort khác nhau (cohort mới chưa đủ ngày) nên avg D lớn được tính trên ít cohort hơn.",
        action: "So sánh nhánh bằng cùng một tập cohort đủ ngày; giữ 1 nhánh A/A làm sàn nhiễu (retention thường lệch ±4–5% dù không có thay đổi)." });
    }
    return out;
  }

  // ================================================================== bảng xuất "Danh sách sửa level" (dán vào Google Sheet)
  const FIX_HEADERS = ["Nhom", "Uu_tien", "LV", "Giai_doan", "Reach", "Win_rate_%", "Win_rate_dich_%", "Thay_doi", "Nhay_first_win_pp",
    "Droprate_%", "Droprate_ky_vong_%", "Excess_pp", "z_score", "User_mat", "Tag", "quit_att", "pt_win_giay", "win_quit_chiem_%", "Doanh_thu_quy_doi",
    "Delta_win_rate_pp", "Van_de", "Huong_sua", "Da_sua"];
  function fixRows(res) {
    const f = (v, d = 1) => v == null || !isFinite(v) ? "" : (+v.toFixed(d)).toString().replace(".", ",");
    const P = (v) => v == null ? "" : f(v * 100);
    return res.levels.filter((x) => x.fix && x.fix.change !== "Không sửa")
      .sort((a, b) => (a.priority || "P9").localeCompare(b.priority || "P9") || (b.lost || 0) - (a.lost || 0))
      .map((x) => [x.fix.group, x.priority || "", x.level, x.phase, Math.round(x.reach), P(x.win_rate), x.fix.change === "Dễ hơn" && x.wrTarget != null ? P(x.wrTarget) : "",
        x.fix.change, x.jumpFW == null ? "" : f(x.jumpFW * 100), P(x.droprate), P(x.expDrop), x.excess == null ? "" : f(x.excess * 100, 2), f(x.z),
        x.lost == null ? "" : Math.round(x.lost), x.tag, f(x.quit_att, 2), x.pt_win == null ? "" : Math.round(x.pt_win), P(x.winQuitShare), f(x.rev, 2),
        x.delta && x.delta.win_rate != null ? f(x.delta.win_rate * 100) : "", x.reasons.join("; "), x.fix.what, ""]);
  }

  return { DEFAULTS, PHASES, GOOD, LABEL, PCT_METRICS, detect, parseInsight, parseLevelTable, parseCohort, levelsFor, review, audit, compare,
    auditCohort, fixRows, FIX_HEADERS, fmt: { pct, pp, n1, int } };
});

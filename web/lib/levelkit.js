/* Level Preview — LÕI DÙNG CHUNG cho mọi game dạng "vật chứa + vật phẩm" (sort nước / bóng / chim / ly…)
   và game dạng lưới (match / blast). Mọi game được đổi về 1 "level chuẩn" rồi mới vẽ / soát / so sánh:

   {
     level: 24, name: "level_24", tags: ["Hard"],
     style: { container: "tube" | "jar" | "box" | "branch", item: "liquid" | "ball" | "bird" | "block" },
     containers: [{
       items: [màu | {c: màu, hidden, key, label}],   // thứ tự DƯỚI → TRÊN (branch: trong → ngoài)
       capacity: 4, x: 0, y: 12,                      // x, y tuỳ đơn vị của game (không có thì tự xếp hàng)
       size: 1, dir: "up" | "right" | "left",
       marks: [{type: "ice" | "cover" | "lock" | "ads" | "spawn" | "seal" | "help" | "hidden" | <tuỳ ý>, n, c, label, items}],
       label: "chữ nhỏ dưới vật chứa"
     }],
     groups: [{type: "tray" | "curtain" | "lockbox" | <tuỳ ý>, members: [0, 1], label}],
     orders: [màu…], limits: {moves, time}, palette: {màu: "#hex"}, yUp: true,
     grid: {w, h, cells: [[màu | null | {c, block, n, label}]]}   // game dạng lưới — thay cho containers
   }

   Thêm game mới: (1) xuất file đúng chuẩn trên, (2) khai "cấu hình đọc file" (mapping, không cần code —
   xem fromMapping), hoặc (3) viết adapter JS nhỏ (web/lib/level-adapters.js). Chạy được cả Node để test. */
(function (root, factory) {
  const lib = factory();
  if (typeof module === "object" && module.exports) module.exports = lib;
  else { root.GDK = root.GDK || {}; root.GDK.lib = root.GDK.lib || {}; root.GDK.lib.levelkit = lib; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ================================================================ tiện ích
  /** Lấy giá trị theo đường dẫn "B.0.C" / "BIM.CI". Đường dẫn rỗng = chính obj. */
  function get(obj, path) {
    if (path == null || path === "") return obj;
    let cur = obj;
    for (const k of String(path).split(".")) {
      if (cur == null) return undefined;
      cur = cur[k];
    }
    return cur;
  }
  const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);
  const isPrim = (v) => v == null || typeof v !== "object";
  const uniq = (arr) => [...new Set(arr)];
  const stripBom = (s) => (s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s);

  /** Số level từ tên file: level_24.txt → 24 · level-v5-0007.json → 7 (bản v5) · Level_7_v1.json → 7 (v1)
   *  · level_024__level_24.png → 24 · level_24_2.txt → 24 (biến thể 2). Không có số → null. */
  function numberFromName(name) {
    const base = String(name || "").split(/[\\/]/).pop().replace(/\.[^.]+$/, "");
    const tokens = base.split(/[^A-Za-z0-9]+/).filter(Boolean);
    let n = null, v = null, variant = null;
    for (const t of tokens) {
      // "v22", "loopv12" = phiên bản (không tính "lv12" — lv thường là level)
      const mv = /^(.*?)v(\d+)$/i.exec(t);
      if (mv && (mv[1] === "" || (/[a-z]$/i.test(mv[1]) && !/l$/i.test(mv[1])))) { v = +mv[2]; continue; }
      const m = /(\d+)$/.exec(t);
      if (!m) continue;
      if (n == null) n = +m[1]; else if (variant == null) variant = +m[1];
    }
    return n == null ? null : { n, v, variant };
  }

  /** "1-30, 45, 50-" → hàm lọc. Rỗng → nhận tất cả. Sai cú pháp → null. */
  function parseRange(spec) {
    const s = String(spec || "").trim();
    if (!s) return () => true;
    const parts = [];
    for (const raw of s.split(/[,;\s]+/).filter(Boolean)) {
      const m = /^(\d+)?\s*[-–]\s*(\d+)?$/.exec(raw);
      if (m && (m[1] || m[2])) parts.push([m[1] ? +m[1] : -Infinity, m[2] ? +m[2] : Infinity]);
      else if (/^\d+$/.test(raw)) parts.push([+raw, +raw]);
      else return null;
    }
    return (n) => parts.some(([a, b]) => n >= a && n <= b);
  }

  // ================================================================ màu
  /** 12 màu đầu = bảng màu game sort quen thuộc (listColorV2 của CDS), thêm 6 màu dự phòng. */
  const COLORS = ["#DF2219", "#F8C827", "#3232F9", "#6ACA1A", "#8804D4", "#FB671A", "#F87EDD", "#5E0045",
    "#8B340C", "#42A6FD", "#00734C", "#DDCBD4", "#C6E03A", "#8C8C8C", "#18C8C8", "#B8860B", "#FFB4A2", "#2B2B2B"];
  const NAMED = { red: 0, yellow: 1, blue: 2, green: 3, purple: 4, violet: 4, orange: 5, pink: 6, wine: 7, maroon: 7,
    brown: 8, sky: 9, cyan: 14, teal: 10, white: 11, lime: 12, gray: 13, grey: 13, gold: 15, peach: 16, black: 17,
    do: 0, vang: 1, xanh: 2, xanhla: 3, tim: 4, cam: 5, hong: 6, nau: 8, trang: 11, den: 17, xam: 13 };

  /** Bảng màu cho 1 level: palette của file > tên màu > số (id) > thứ tự xuất hiện. mode: auto | id | appearance */
  function colorMap(level, mode) {
    const keys = [];
    const add = (c) => { if (c != null && c !== "" && !keys.includes(c)) keys.push(c); };
    for (const ct of level.containers || []) {
      for (const it of ct.items) add(it.c);
      for (const m of ct.marks || []) { add(m.c); (m.items || []).forEach(add); }
    }
    (level.orders || []).forEach(add);
    if (level.grid) for (const row of level.grid.cells || []) for (const cell of row || []) if (cell) add(cell.c);
    const pal = level.palette || {}, out = {};
    mode = mode || level.colorMode || "auto";
    let next = 0;
    const taken = new Set();
    for (const k of keys) {
      if (pal[k] != null) { out[k] = pal[k]; continue; }
      if (mode !== "appearance") {
        const nk = typeof k === "string" ? k.toLowerCase().replace(/[^a-z]/g, "") : null;
        if (nk && NAMED[nk] != null) { out[k] = COLORS[NAMED[nk]]; taken.add(NAMED[nk]); continue; }
        if (/^#[0-9a-f]{3,8}$/i.test(String(k))) { out[k] = String(k); continue; }
        if (typeof k === "number" || /^\d+$/.test(String(k))) { out[k] = COLORS[(+k) % COLORS.length]; taken.add((+k) % COLORS.length); continue; }
      }
      while (mode !== "appearance" && taken.has(next % COLORS.length) && next < COLORS.length * 2) next++;
      out[k] = COLORS[next % COLORS.length];
      taken.add(next % COLORS.length);
      next++;
    }
    return out;
  }

  // ================================================================ chuẩn hoá
  const STYLE = { container: "tube", item: "liquid" };
  /** Item → {c, hidden?, key?, label?}. Trả null nếu là ô trống. */
  function normItem(it, empty) {
    if (it == null || it === "" || (empty !== undefined && it === empty)) return null;
    if (isObj(it)) {
      const c = it.c !== undefined ? it.c : it.color;
      if ((c == null || c === "" || (empty !== undefined && c === empty)) && !it.hidden) return null;
      const o = { c: c == null ? null : c };
      if (it.hidden) o.hidden = true;
      if (it.key != null && it.key !== false) o.key = it.key;
      if (it.wild) o.wild = true;
      if (it.ignore) o.ignore = true;
      if (it.label != null && it.label !== "") o.label = String(it.label);
      return o;
    }
    return { c: it };
  }

  /** Kiểm tra + điền mặc định cho level chuẩn (từ adapter, mapping hoặc file .json chuẩn). */
  function normalize(raw, extra) {
    const lv = Object.assign({}, raw, extra || {});
    lv.style = Object.assign({}, STYLE, raw.style || {});
    lv.tags = uniq((raw.tags || []).filter(Boolean).map(String));
    lv.notes = (raw.notes || []).slice();
    if (raw.grid) {
      const g = raw.grid;
      const cells = (g.cells || []).map((row) => (row || []).map((c) => (c == null || c === "" ? null : isObj(c) ? Object.assign({}, c) : { c })));
      lv.grid = { w: g.w || Math.max(0, ...cells.map((r) => r.length)), h: g.h || cells.length, cells };
      lv.containers = [];
    } else {
      lv.containers = (raw.containers || []).map((ct) => {
        const src = Array.isArray(ct) ? { items: ct } : ct || {};
        const items = (src.items || []).map((x) => normItem(x)).filter(Boolean);
        const out = Object.assign({}, src, { items, marks: (src.marks || []).filter((m) => m && m.type) });
        out.capacity = Math.max(+src.capacity || 0, items.length);
        if (!out.capacity) out.capacity = 0;
        return out;
      });
      const caps = lv.containers.map((c) => c.capacity).filter(Boolean);
      const common = mode(caps) || 4;
      for (const c of lv.containers) if (!c.capacity && !(c.marks || []).some((m) => m.type === "ads")) c.capacity = common;
      for (const c of lv.containers) if (!c.capacity) c.capacity = common;
    }
    lv.groups = (raw.groups || []).filter((g) => g && Array.isArray(g.members) && g.members.length);
    lv.orders = (raw.orders || []).filter((x) => x != null && x !== "");
    return lv;
  }
  function mode(arr) {
    const cnt = new Map();
    let best = null, bn = 0;
    for (const v of arr) { const n = (cnt.get(v) || 0) + 1; cnt.set(v, n); if (n > bn) { bn = n; best = v; } }
    return best;
  }

  // ================================================================ thống kê + soát lỗi
  function stats(lv) {
    if (lv.grid) {
      const cells = lv.grid.cells.flat().filter(Boolean);
      return { kind: "grid", w: lv.grid.w, h: lv.grid.h, containers: 0, items: cells.filter((c) => c.c != null).length,
        colors: uniq(cells.map((c) => c.c).filter((c) => c != null)).length, hidden: 0, empty: lv.grid.w * lv.grid.h - cells.length,
        free: 0, capacity: 0, marks: countBy(cells.filter((c) => c.block).map(() => "block")), orders: (lv.orders || []).length };
    }
    const cs = lv.containers;
    const items = cs.flatMap((c) => c.items);
    const marks = countBy(cs.flatMap((c) => (c.marks || []).map((m) => m.type)).concat((lv.groups || []).map((g) => g.type)));
    return {
      kind: "stack", containers: cs.length, capacity: mode(cs.map((c) => c.capacity)) || 0,
      items: items.length, colors: uniq(items.filter((i) => i.c != null).map((i) => i.c)).length,
      hidden: items.filter((i) => i.hidden).length, keys: items.filter((i) => i.key != null).length,
      empty: cs.filter((c) => !c.items.length).length, free: cs.reduce((s, c) => s + Math.max(0, c.capacity - c.items.length), 0),
      marks, orders: (lv.orders || []).length,
    };
  }
  function countBy(arr) { const o = {}; for (const k of arr) o[k] = (o[k] || 0) + 1; return o; }

  /** Soát lỗi chung. rules: {colorMultiple: "capacity" | số | false, needFree: true} */
  function lint(lv, rules) {
    rules = Object.assign({ colorMultiple: "capacity", needFree: true, presolved: true }, lv.rules || {}, rules || {});
    const out = [];
    if (lv.grid) {
      if (!lv.grid.w || !lv.grid.h) out.push({ level: "bad", code: "empty", title: "Lưới rỗng" });
      return out;
    }
    const cs = lv.containers;
    if (!cs.length) { out.push({ level: "bad", code: "empty", title: "Level không có vật chứa nào" }); return out; }
    cs.forEach((c, i) => {
      if (c.items.length > c.capacity) out.push({ level: "bad", code: "overflow", title: `Vật chứa #${i + 1} chứa ${c.items.length} > sức chứa ${c.capacity}` });
    });
    const st = stats(lv);
    if (rules.needFree && st.free === 0 && !cs.some((c) => (c.marks || []).some((m) => m.type === "ads" || m.type === "spawn")))
      out.push({ level: "bad", code: "nofree", title: "Không còn ô trống nào — người chơi không có nước đi đầu tiên" });
    const per = {};
    let wild = 0;
    for (const c of cs) for (const it of c.items) { if (it.wild) wild++; else if (it.c != null && !it.ignore) per[it.c] = (per[it.c] || 0) + 1; }
    for (const c of cs) for (const m of c.marks || []) for (const x of m.items || []) if (x != null) per[x] = (per[x] || 0) + 1;
    // soát "mỗi màu đủ bộ": bỏ qua level có vật chứa khổng lồ (luật riêng); vật phẩm joker (wild) được bù vào chỗ thiếu
    const unit = rules.colorMultiple === "capacity" ? st.capacity : +rules.colorMultiple || 0;
    if (unit > 1 && !cs.some((c) => (c.size || 1) > 1.5)) {
      const bad = Object.entries(per).filter(([, n]) => n % unit !== 0);
      const deficit = bad.reduce((s, [, n]) => s + (unit - (n % unit)) % unit, 0);
      if (bad.length && !(deficit <= wild && (wild - deficit) % unit === 0)) out.push({ level: "warn", code: "colorcount", title: `${bad.length} màu không chia hết cho ${unit}`,
        detail: bad.slice(0, 8).map(([k, n]) => `màu ${k}: ${n}`).join(" · ") + (wild ? ` (có ${wild} joker)` : "") + " — có thể thiếu / thừa vật phẩm." });
    }
    const done = cs.filter((c) => c.items.length === c.capacity && c.capacity > 1 && !c.items.some((i) => i.hidden) && uniq(c.items.map((i) => i.c)).length === 1);
    if (done.length && rules.presolved) out.push({ level: "info", code: "presolved", title: `${done.length} vật chứa đã đầy 1 màu ngay từ đầu` });
    for (const g of lv.groups || []) for (const m of g.members) if (m < 0 || m >= cs.length)
      out.push({ level: "warn", code: "group", title: `Nhóm “${g.label || g.type}” trỏ tới vật chứa không tồn tại (#${m + 1})` });
    return out;
  }
  const worst = (issues) => issues.some((x) => x.level === "bad") ? "bad" : issues.some((x) => x.level === "warn") ? "warn" : issues.length ? "info" : "ok";

  // ================================================================ bố cục
  /** Tỉ lệ cao/rộng của vật chứa theo kiểu + sức chứa (kiểu nằm ngang trả về < 1). */
  function aspect(style, cap, dir) {
    cap = Math.max(1, cap);
    if (dir === "right" || dir === "left" || style === "branch") return 1 / (0.3 + 0.62 * cap);
    if (style === "egg") return 1.12;
    if (style === "jar") return 0.45 + 0.42 * cap;
    if (style === "box") return 0.15 + 0.88 * cap;
    return 0.5 + 0.52 * cap;                         // tube
  }

  /**
   * Vị trí từng vật chứa (px) trong khung box = {x, y, w, h}. 4 kiểu bố cục:
   *  - có toạ độ x, y trong file → giữ đúng cột / hàng của game (giãn theo từng trục để không chồng nhau)
   *  - lv.layout = "columns2" → 2 cột bám mép màn hình (cành chim: c.col 0 / 1, c.row)
   *  - lv.layout = "pile" → xếp đống từ dưới lên, so le (trứng rơi tự do)
   *  - không có gì → tự xếp hàng cân đối
   */
  function layout(lv, box, opts) {
    opts = opts || {};
    const cs = lv.containers || [];
    const n = cs.length;
    if (!n) return [];
    const style = lv.style.container;
    const horizontalStyle = style === "branch";
    const dirOf = (c, i) => c.dir || (horizontalStyle ? (i % 2 === 0 ? "right" : "left") : "up");
    const A = cs.map((c, i) => +c.aspect > 0 ? +c.aspect : aspect(style, (c.capacity || 1) / (c.size || 1), dirOf(c, i)));
    const hasPos = cs.every((c) => isFinite(c.x) && isFinite(c.y));
    if (lv.layout === "columns2" || (horizontalStyle && !hasPos)) return columns2(cs, box, A, dirOf);
    if (lv.layout === "pile" && !hasPos) return pile(cs, box, A, dirOf);
    let pts;
    const maxA = Math.max(...A);
    if (hasPos) {
      const yUp = lv.yUp !== false;
      pts = cs.map((c) => ({ x: +c.x, y: yUp ? -c.y : +c.y }));
    } else {
      const maxRow = opts.maxPerRow || (n <= 5 ? 5 : n <= 8 ? 4 : n <= 14 ? 5 : 6);
      const rows = Math.ceil(n / maxRow), per = Math.ceil(n / rows);
      const rowStep = maxA * 1.2;
      pts = cs.map((c, i) => {
        const r = Math.floor(i / per), inRow = Math.min(per, n - r * per);
        return { x: (i - r * per) - (inRow - 1) / 2, y: r * rowStep };
      });
    }
    // bề rộng w (đơn vị toạ độ của game) lớn nhất sao cho mọi cặp vật chứa tách nhau theo ngang HOẶC theo dọc
    const GX = 1.14, GY = 1.08;
    const sz = cs.map((c) => c.size || 1);
    let w = Infinity;
    // vật chứa khổng lồ (size > 1.5) nằm đè lên khu vực riêng trong game → không dùng để co các vật chứa thường
    const normal = sz.filter((s) => s <= 1.5).length >= 2;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (normal && (sz[i] > 1.5 || sz[j] > 1.5)) continue;
      const dx = Math.abs(pts[i].x - pts[j].x), dy = Math.abs(pts[i].y - pts[j].y);
      const byX = dx / ((sz[i] + sz[j]) / 2 * GX), byY = dy / ((sz[i] * A[i] + sz[j] * A[j]) / 2 * GY);
      w = Math.min(w, Math.max(byX, byY));
    }
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (!isFinite(w) || w <= 0) w = Math.max(1, x1 - x0, (y1 - y0) / maxA) || 1;
    // khung bao (đơn vị game) → px; vật chứa không to quá 24% bề ngang / 46% bề cao khung
    const left = Math.min(...cs.map((c, i) => pts[i].x - w * sz[i] / 2)), right = Math.max(...cs.map((c, i) => pts[i].x + w * sz[i] / 2));
    const top = Math.min(...cs.map((c, i) => pts[i].y - w * sz[i] * A[i] / 2)), bottom = Math.max(...cs.map((c, i) => pts[i].y + w * sz[i] * A[i] / 2));
    let k = Math.min(box.w / (right - left), box.h / (bottom - top));
    k = Math.min(k, (opts.maxW || box.w * 0.24) / w, box.h * 0.46 / (w * maxA));
    const ox = box.x + box.w / 2 - (left + right) / 2 * k, oy = box.y + box.h / 2 - (top + bottom) / 2 * k;
    return cs.map((c, i) => {
      const cw = w * sz[i] * k;
      return { cx: ox + pts[i].x * k, cy: oy + pts[i].y * k, w: cw, h: cw * A[i], dir: dirOf(c, i) };
    });
  }
  /** 2 cột bám mép trái / phải (cành chim). */
  function columns2(cs, box, A, dirOf) {
    const col = (c, i) => (c.col != null ? c.col : i % 2);
    const row = (c, i) => (c.row != null ? c.row : Math.floor(i / 2));
    const rows = Math.max(...cs.map(row)) + 1;
    const w = box.w * 0.46;
    let h = Math.max(...A) * w;
    let pitch = h * 1.35;
    if (pitch * rows > box.h) { pitch = box.h / rows; h = Math.min(h, pitch * 0.9); }
    const top = box.y + box.h / 2 - (rows * pitch) / 2 + pitch / 2;
    return cs.map((c, i) => {
      const left = col(c, i) === 0;
      return { cx: left ? box.x + w / 2 : box.x + box.w - w / 2, cy: top + row(c, i) * pitch, w, h, dir: dirOf(c, i) === "up" ? (left ? "right" : "left") : dirOf(c, i) };
    });
  }
  /** Xếp đống từ dưới lên, hàng so le — phần tử đầu (rơi trước) nằm dưới cùng. */
  function pile(cs, box, A, dirOf) {
    let unit = box.w / 4.6;
    for (let tries = 0; tries < 12; tries++) {
      const out = [];
      let row = [], rowW = 0, y = box.y + box.h, rowIdx = 0;
      const flush = () => {
        if (!row.length) return;
        const hMax = Math.max(...row.map((r) => r.h));
        const shift = (rowIdx % 2 ? 1 : -1) * unit * 0.18;
        let x = box.x + box.w / 2 - rowW / 2 + shift;
        for (const r of row) { out[r.i] = { cx: x + r.w / 2, cy: y - hMax / 2, w: r.w, h: r.h, dir: "up" }; x += r.w * 1.04; }
        y -= hMax * 1.02;
        rowIdx++; row = []; rowW = 0;
      };
      cs.forEach((c, i) => {
        const w = unit * (c.size || 1), h = w * A[i];
        if (rowW + w * 1.04 > box.w * 0.94 && row.length) flush();
        row.push({ i, w, h }); rowW += w * 1.04;
      });
      flush();
      if (y >= box.y || tries === 11) {
        const used = box.y + box.h - y;
        if (used < box.h) out.forEach((p) => { p.cy -= (box.h - used) * 0.15; });
        return out;
      }
      unit *= Math.sqrt(Math.max(0.3, (box.h) / (box.y + box.h - y))) * 0.97;
    }
    return [];
  }

  // ================================================================ so sánh 2 level
  function canon(lv) {
    if (lv.grid) return JSON.stringify(lv.grid.cells);
    return JSON.stringify({
      c: lv.containers.map((c) => [c.capacity, c.size || 1, c.items.map((i) => [i.c, i.hidden ? 1 : 0, i.key == null ? "" : i.key]),
        (c.marks || []).map((m) => [m.type, m.n, m.c, m.label]).sort()]),
      g: (lv.groups || []).map((g) => [g.type, g.members.slice().sort((a, b) => a - b)]),
      o: lv.orders || [],
    });
  }
  const canonPos = (lv) => JSON.stringify((lv.containers || []).map((c) => [c.x, c.y]));

  /** So level A (cũ) với B (mới): status same | layout | changed | onlyA | onlyB + danh sách thay đổi dễ đọc. */
  function diff(a, b) {
    if (a && !b) return { status: "onlyA", changes: ["Chỉ có ở bộ A"] };
    if (b && !a) return { status: "onlyB", changes: ["Chỉ có ở bộ B"] };
    if (a.image || b.image) return { status: "image", changes: [] };
    const ca = canon(a), cb = canon(b);
    if (ca === cb) return canonPos(a) === canonPos(b) ? { status: "same", changes: [] } : { status: "layout", changes: ["Chỉ đổi vị trí vật chứa"] };
    const sa = stats(a), sb = stats(b), ch = [];
    const d = (k, label) => { if (sa[k] !== sb[k]) ch.push(`${label} ${sa[k]} → ${sb[k]}`); };
    d("containers", "Vật chứa"); d("capacity", "Sức chứa"); d("colors", "Màu"); d("items", "Vật phẩm"); d("hidden", "Ẩn (?)");
    d("empty", "Vật chứa trống"); d("orders", "Đơn / mục tiêu");
    for (const k of uniq(Object.keys(sa.marks || {}).concat(Object.keys(sb.marks || {})))) {
      const x = (sa.marks || {})[k] || 0, y = (sb.marks || {})[k] || 0;
      if (x !== y) ch.push(`${k} ${x} → ${y}`);
    }
    const ta = (a.tags || []).join(", "), tb = (b.tags || []).join(", ");
    if (ta !== tb) ch.push(`Tag “${ta || "—"}” → “${tb || "—"}”`);
    if (!ch.length) ch.push("Đổi thứ tự / màu vật phẩm");
    return { status: "changed", changes: ch };
  }

  // ================================================================ đọc theo cấu hình (game mới, không cần code)
  /**
   * profile = {
   *   levels?: "đường dẫn tới mảng level trong file" (file chứa nhiều level), number?: "trường số level",
   *   containers: "B", items: "C" (rỗng = vật chứa chính là mảng), color: "BIM.CI" (rỗng = phần tử là màu),
   *   order: "bottom" | "top", capacity?: số | "trường", empty?: giá trị coi là ô trống,
   *   hidden?: {path, eq}, x?, y?, yUp?, orders?, tags?: [{path, label, eq?}],
   *   marks?: [{type, when, eq?, n?, label?}], style?: {container, item}, rules?: {colorMultiple}
   * }
   */
  function fromMapping(json, profile, fileName) {
    const p = profile || {};
    const list = p.levels != null && p.levels !== "" ? get(json, p.levels) : p.levels === "" && Array.isArray(json) ? json : [json];
    if (!Array.isArray(list)) throw new Error("Không thấy danh sách level ở “" + p.levels + "”.");
    const fromName = numberFromName(fileName);
    return list.map((src, li) => {
      const arr = get(src, p.containers);
      if (!Array.isArray(arr)) throw new Error("Không thấy danh sách vật chứa ở “" + (p.containers || "(gốc)") + "”.");
      const test = (obj, rule) => {
        if (!rule) return false;
        const v = get(obj, rule.path != null ? rule.path : rule.when);
        return rule.eq !== undefined ? v === rule.eq || String(v) === String(rule.eq) : !!v;
      };
      const containers = arr.map((ct) => {
        let raw = get(ct, p.items);
        if (!Array.isArray(raw)) raw = [];
        let items = raw.map((it) => {
          const c = get(it, p.color);
          if (p.hidden && test(it, p.hidden)) return { c: c == null ? null : c, hidden: true };
          if (c == null || c === "" || (p.empty !== undefined && c === p.empty)) return null;
          return { c };
        });
        if (p.order === "top") items = items.reverse();
        const capF = typeof p.capacity === "number" ? p.capacity : p.capacity ? +get(ct, p.capacity) : null;
        const out = { items: items.filter(Boolean), capacity: capF || (items.some((x) => x == null) ? raw.length : 0) };
        if (p.x && p.y) { const x = +get(ct, p.x), y = +get(ct, p.y); if (isFinite(x) && isFinite(y)) { out.x = x; out.y = y; } }
        out.marks = (p.marks || []).filter((m) => test(ct, m)).map((m) => {
          const o = { type: m.type || "badge" };
          if (m.n) o.n = get(ct, m.n);
          if (m.label) o.label = m.label;
          return o;
        });
        return out;
      });
      const capMax = Math.max(0, ...containers.map((c) => c.capacity || c.items.length));
      for (const c of containers) if (!c.capacity) c.capacity = capMax;
      const num = p.number ? +get(src, p.number) : NaN;
      const lv = {
        level: isFinite(num) ? num : list.length > 1 ? li + 1 : fromName ? fromName.n : li + 1,
        name: list.length > 1 ? (fileName || "") + " #" + (li + 1) : String(fileName || "").replace(/\.[^.]+$/, ""),
        containers, style: p.style, rules: p.rules,
        orders: p.orders ? (get(src, p.orders) || []).filter(isPrim).map((x) => (isObj(x) ? null : x)) : [],
        tags: (p.tags || []).filter((t) => test(src, t)).map((t) => t.label),
        yUp: p.yUp !== false,
      };
      if (fromName && fromName.v != null && list.length === 1) lv.version = fromName.v;
      return normalize(lv);
    });
  }

  /** Đoán cấu hình đọc file cho game chưa biết: tìm mảng "vật chứa" chứa mảng "vật phẩm" + trường màu. */
  function guessMapping(json) {
    const one = (obj) => {
      const cands = [];
      walk(obj, "", 0, (arr, path) => {
        if (arr.length < 1 || arr.length > 80) return;
        // (a) mảng các mảng: [[1,2,3],[...]]
        const arrs = arr.filter(Array.isArray);
        if (arrs.length >= arr.length * 0.6 && arrs.length >= 2) {
          const flat = arrs.flat();
          if (flat.every((x) => isPrim(x) || isObj(x)) && Math.max(...arrs.map((a) => a.length)) <= 24) {
            const color = flat.every(isPrim) ? "" : pickLeaf(flat.filter(isObj), COLOR_HINT);
            if (color != null) cands.push({ containers: path, items: "", color, score: 4 + hint(path, CONT_HINT) + (arr.length <= 40 ? 1 : 0) });
          }
          return;
        }
        // (b) mảng các object, mỗi object có 1 mảng con (vật phẩm)
        const objs = arr.filter(isObj);
        if (objs.length < arr.length * 0.6 || !objs.length) return;
        const keys = uniq(objs.flatMap((o) => Object.keys(o).filter((k) => Array.isArray(o[k]))));
        for (const k of keys) {
          const subs = objs.map((o) => o[k]).filter(Array.isArray);
          if (subs.length < objs.length * 0.6) continue;
          const flat = subs.flat();
          if (!flat.every((x) => isPrim(x) || isObj(x)) || Math.max(0, ...subs.map((s) => s.length)) > 24) continue;
          const color = !flat.length ? null : flat.every(isPrim) ? "" : pickLeaf(flat.filter(isObj), COLOR_HINT);
          if (color == null) continue;
          cands.push({ containers: path, items: k, color, score: 3 + hint(path, CONT_HINT) + hint(k, ITEM_HINT) * 1.5 + (objs.length >= 2 ? 1 : 0) });
        }
      });
      if (!cands.length) return null;
      cands.sort((a, b) => b.score - a.score);
      const best = cands[0];
      const prof = { containers: best.containers, items: best.items, color: best.color, order: "bottom" };
      const conts = get(obj, best.containers).filter(isObj);
      if (conts.length) {
        const pos = [["P.x", "P.y"], ["pos.x", "pos.y"], ["position.x", "position.y"], ["x", "y"], ["X", "Y"]].find(([a, b]) => conts.every((c) => isFinite(+get(c, a)) && get(c, a) !== null && isFinite(+get(c, b)) && get(c, b) !== null));
        if (pos) { prof.x = pos[0]; prof.y = pos[1]; }
        const cap = Object.keys(conts[0]).find((k) => /^(capacity|cap|max|maxitems|size|slots|height)$/i.test(k) && conts.every((c) => typeof c[k] === "number"));
        if (cap) prof.capacity = cap;
        const items = conts.flatMap((c) => get(c, best.items) || []).filter(isObj);
        const hid = items.length && Object.keys(items[0]).find((k) => /^(hidden|ishidden|blind|isblind|mystery|unknown|question)$/i.test(k));
        if (hid) prof.hidden = { path: hid };
      }
      if (isObj(obj)) {
        const ord = Object.keys(obj).find((k) => /order|goal|target|queue/i.test(k) && Array.isArray(obj[k]) && obj[k].length && obj[k].every(isPrim));
        if (ord) prof.orders = ord;
        prof.tags = Object.keys(obj).filter((k) => /^(is)?(super)?_?hard$/i.test(k) && typeof obj[k] === "boolean")
          .map((k) => ({ path: k, label: /super/i.test(k) ? "Super Hard" : "Hard" }));
        const nk = Object.keys(obj).find((k) => /^(level|lvl|levelid|level_id|levelnumber|stage|stageid|stage_id|index|id)$/i.test(k) && typeof obj[k] === "number");
        if (nk) prof.number = nk;
      }
      // số 0 trong mảng số đều nhau thường là ô trống (water sort dạng [[1,2,0,0],…])
      if (best.items === "" && best.color === "") {
        const arrs = get(obj, best.containers).filter(Array.isArray), flat = arrs.flat();
        if (flat.includes(0) && uniq(arrs.map((a) => a.length)).length === 1) prof.empty = 0;
      }
      return { prof, score: best.score };
    };
    // file chứa nhiều level: mảng các level
    if (Array.isArray(json) && json.length && json.every(isObj)) {
      const g = one(json[0]);
      if (g && g.prof.containers !== "") {
        const sample = json.slice(0, 5).every((o) => Array.isArray(get(o, g.prof.containers)));
        if (sample) return Object.assign(g.prof, { levels: "" });
      }
    }
    if (isObj(json)) {
      const lk = Object.keys(json).find((k) => /^(levels?|stages?|data|list)$/i.test(k) && Array.isArray(json[k]) && json[k].length && json[k].every(isObj));
      if (lk) {
        const g = one(json[lk][0]);
        if (g && g.prof.containers !== "") return Object.assign(g.prof, { levels: lk });
      }
    }
    const g = one(json);
    return g ? g.prof : null;
  }
  const CONT_HINT = /(^|\.)(b|tubes?|bottles?|containers?|stacks?|columns?|nests?|branch(es)?|jars?|glass(es)?|boxes|cups?|slots?|vials?|pipes?|holders?|lanes?)$/i;
  const ITEM_HINT = /^(c|items?|colors?|colours?|balls?|birds?|layers?|stack|waters?|liquids?|eggs?|pieces?|contents?|elements?|blocks?|units?)$/i;
  const COLOR_HINT = [/(^|\.)(c|ci)$/i, /(^|\.)(colou?r|colou?rid|colou?r_?id|colou?r_?index)$/i, /(^|\.)(type|kind|t)$/i, /(^|\.)(id|value|v)$/i];
  const hint = (path, re) => (re.test(String(path).split(".").pop() || "") ? 2 : 0);
  function walk(node, path, depth, fn) {
    if (depth > 6 || node == null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      fn(node, path);
      if (node.length && isObj(node[0])) return;      // không đi sâu vào từng phần tử của mảng object
      return;
    }
    for (const k of Object.keys(node)) walk(node[k], path ? path + "." + k : k, depth + 1, fn);
  }
  /** Chọn trường lá (≤ 2 cấp) làm "màu" trong các object vật phẩm. */
  function pickLeaf(objs, hints) {
    if (!objs.length) return null;
    const paths = {};
    for (const o of objs.slice(0, 200)) {
      for (const [k, v] of Object.entries(o)) {
        if (isPrim(v) && v !== null && typeof v !== "boolean") (paths[k] = paths[k] || []).push(v);
        else if (isObj(v)) for (const [k2, v2] of Object.entries(v)) if (isPrim(v2) && v2 !== null && typeof v2 !== "boolean") (paths[k + "." + k2] = paths[k + "." + k2] || []).push(v2);
      }
    }
    const ok = Object.keys(paths).filter((p) => !/(^|\.)(x|y|z|lp|pos|position|w|h|width|height|index|idx|order|sort)$/i.test(p) && uniq(paths[p]).length <= 40);
    for (const re of hints) {
      const hit = ok.filter((p) => re.test(p)).sort((a, b) => paths[b].length - paths[a].length);
      if (hit.length) return hit[0];
    }
    const multi = ok.filter((p) => uniq(paths[p]).length >= 2).sort((a, b) => paths[b].length - paths[a].length);
    return multi.length ? multi[0] : null;
  }

  // ================================================================ adapter (đọc file theo từng game)
  /** adapter = {id, name, game, exts:[".json"], detect(json, fileName) → điểm 0..1, parse(json, fileName, ctx) → [level…],
   *            rules?, note?}. ctx = {files: Map(tên → text)} cho game cần file phụ (vd file tag Hard). */
  const adapters = [];
  function register(a) {
    const i = adapters.findIndex((x) => x.id === a.id);
    if (i >= 0) adapters.splice(i, 1, a); else adapters.push(a);
    return a;
  }
  function unregister(id) { const i = adapters.findIndex((x) => x.id === id); if (i >= 0) adapters.splice(i, 1); }
  /** Adapter cho cấu hình đọc file (mapping) người dùng tự khai. */
  function mappingAdapter(profile) {
    return {
      id: "map:" + (profile.id || profile.name), name: profile.name || "Cấu hình riêng", game: profile.name, kind: "mapping", profile,
      detect: (json) => { try { const r = fromMapping(json, profile, ""); return r.length && r[0].containers.length ? 0.6 : 0; } catch (e) { return 0; } },
      parse: (json, name) => fromMapping(json, profile, name),
    };
  }
  /** JSON (chấp nhận BOM, dấu phẩy thừa, chú thích //). */
  function parseJSON(text) {
    const t = stripBom(String(text));
    try { return JSON.parse(t); } catch (e) {
      const cleaned = t.replace(/^\s*\/\/.*$/gm, "").replace(/,\s*([\]}])/g, "$1");
      return JSON.parse(cleaned);
    }
  }
  /** Chọn adapter khớp nhất cho file. Trả {adapter, score}. */
  function detect(json, fileName) {
    let best = null, bs = 0;
    for (const a of adapters) {
      let s = 0;
      try { s = +a.detect(json, fileName) || 0; } catch (e) { s = 0; }
      if (s > bs) { bs = s; best = a; }
    }
    return { adapter: best, score: bs };
  }

  return { get, numberFromName, parseRange, COLORS, colorMap, normalize, stats, lint, worst, aspect, layout, diff, canon,
    fromMapping, guessMapping, adapters, register, unregister, mappingAdapter, parseJSON, detect };
});

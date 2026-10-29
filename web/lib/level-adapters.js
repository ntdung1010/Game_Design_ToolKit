/* Level Preview — bộ đọc file level của từng game ("adapter"). Mỗi adapter chỉ làm 1 việc: đổi file của game
   về level chuẩn (levelkit.js). Vẽ, soát lỗi, so sánh, xuất ảnh… đều dùng chung.

   Thêm game mới (theo thứ tự ít công nhất):
   1. Cùng định dạng với game đã có (vd game sort mới dùng file B/C/BIM như CDS) → chỉ thêm 1 "skin":
      register(runtimeSkin({id, name, style, …})) — xem CDS / Magic Sort / Chirpy bên dưới.
   2. Định dạng khác → khai "cấu hình đọc file" ngay trên giao diện (không cần code, lưu trong data/).
   3. Cơ chế đặc biệt → viết adapter như birdSort bên dưới (~60 dòng). */
(function (root, factory) {
  const LK = typeof module === "object" && module.exports ? require("./levelkit.js") : root.GDK.lib.levelkit;
  const lib = factory(LK);
  if (typeof module === "object" && module.exports) module.exports = lib;
  else root.GDK.lib.leveladapters = lib;
})(typeof self !== "undefined" ? self : this, function (LK) {
  "use strict";
  const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);
  const stripBom = (s) => (s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s);
  const baseName = (n) => String(n || "").split(/[\\/]/).pop().replace(/\.[^.]+$/, "");
  const numOf = (fileName, fallback) => { const m = LK.numberFromName(fileName); return m ? m.n : LK.numberFromName(fallback || "")?.n ?? null; };
  /** Gán màu theo thứ tự xuất hiện (cách game sort map CI → bảng màu). order = mảng CI đã theo đúng thứ tự game duyệt. */
  function paletteByAppearance(order, colors) {
    const pal = {}, seen = [];
    for (const c of order) if (c != null && !seen.includes(c)) seen.push(c);
    seen.forEach((c, i) => { pal[c] = (colors || LK.COLORS)[i % (colors || LK.COLORS).length]; });
    return pal;
  }

  // ================================================================ 1. Định dạng chuẩn của Toolkit
  const gdk = {
    id: "gdk", name: "Level chuẩn GD Toolkit (.json)", game: "Chuẩn chung",
    note: "Định dạng chung — game mới xuất thẳng ra dạng này là xem được ngay, không cần cấu hình.",
    detect: (j) => (isObj(j) && (j.format === "gdk-level" || (Array.isArray(j.levels) && j.levels.length && isObj(j.levels[0]) && (j.levels[0].containers || j.levels[0].grid)))) ? 0.97
      : (isObj(j) && Array.isArray(j.containers) && j.containers.length && (Array.isArray(j.containers[0]) || isObj(j.containers[0]) && Array.isArray(j.containers[0].items))) ? 0.9
      : (isObj(j) && isObj(j.grid) && Array.isArray(j.grid.cells)) ? 0.9 : 0,
    parse(j, file) {
      const list = Array.isArray(j.levels) ? j.levels : [j];
      return list.map((lv, i) => LK.normalize(Object.assign({ level: lv.level != null ? lv.level : list.length > 1 ? i + 1 : numOf(file) || i + 1, name: lv.name || baseName(file) + (list.length > 1 ? " #" + (i + 1) : "") }, lv)));
    },
  };

  // ================================================================ 2. Định dạng "runtime" B / C / BIM (CDS, Magic Sort, Chirpy…)
  // B[] = vật chứa · C[] = ô DƯỚI → TRÊN (thứ tự mảng là chuẩn, LP.y chỉ trang trí) · không có BIM = ô trống
  // BIM.Id 2 = ẩn · CBIM.KLT = chìa của hộp khoá · OBIM[0].Id: 4 nắp (TA, Obj.CI) / 6 niêm / 7 đóng băng (TA)
  // / 15 khay gỗ (MCI) / 17 nắp kiểu mới (CI) / 18 ống sinh (NC) · OVBIM.KLT > 0 hộp khoá · OVBIM.Id 26 rèm (CAI)
  // hasVideo = ống xem ads · isBigBottle = ống khổng lồ · propIndex 1 = thú cần cứu · lstOrderCI = đơn hàng
  const isRuntime = (j) => isObj(j) && Array.isArray(j.B) && j.B.length > 0 && j.B.every((b) => isObj(b) && Array.isArray(b.C));
  function parseRuntime(j, file, skin) {
    const B = skin.arrange ? skin.arrange(j.B) : j.B;
    const groups = new Map();
    const addGroup = (type, key, i, label) => {
      const k = type + ":" + key;
      if (!groups.has(k)) groups.set(k, { type, members: [], label, key });
      groups.get(k).members.push(i);
    };
    const containers = B.map((b, i) => {
      const items = (b.C || []).map((w) => {
        const bim = w && w.BIM;
        if (!bim) return null;
        const it = { c: bim.CI };
        if (bim.Id === 2) it.hidden = true;
        if (w.CBIM && w.CBIM.KLT) it.key = w.CBIM.KLT;
        return it;
      });
      const ct = { items: items.filter(Boolean), capacity: (b.C || []).length || 4, marks: [] };
      if (skin.usePositions !== false && b.P && isFinite(b.P.x) && isFinite(b.P.y)) { ct.x = +b.P.x * (skin.sx || 1); ct.y = +b.P.y * (skin.sy || 1); }
      const ob = (b.OBIM || [])[0] || {};
      const obj = ob.Obj || {};
      const named = (m, key) => (skin.names && skin.names[key] ? Object.assign(m, { label: skin.names[key] + (m.n != null ? " " + m.n : "") }) : m);
      if (ob.Id === 4) ct.marks.push(named({ type: "cover", n: obj.TA, c: obj.CI }, "cover"));
      else if (ob.Id === 17) ct.marks.push(named({ type: "cover", n: 1, c: ob.CI }, "cover"));
      else if (ob.Id === 6) ct.marks.push({ type: "seal" });
      else if (ob.Id === 7) ct.marks.push(named({ type: "ice", n: obj.TA }, "ice"));
      else if (ob.Id === 15) addGroup("tray", ob.MCI, i, (skin.names?.tray || "khay") + " " + (ob.MCI ?? ""));
      else if (ob.Id === 18) ct.marks.push({ type: "spawn", items: ob.NC || [] });
      else if (ob.Id != null) ct.marks.push({ type: "badge", label: "OBIM " + ob.Id });
      const ov = b.OVBIM || {};
      if (ov.KLT > 0) addGroup("lockbox", ov.KLT, i, (skin.names?.lockbox || "hộp khoá") + " #" + ov.KLT);
      if (ov.Id === 26) addGroup("curtain", ov.CAI, i, (skin.names?.curtain || "rèm") + " " + (ov.CAI ?? ""));
      if (b.hasVideo) ct.marks.push({ type: "ads" });
      if (b.isBigBottle) { ct.size = skin.giantSize || 3.6; ct.aspect = skin.giantAspect || 1.5; ct.label = "khổng lồ" + (b.bigBottleShapeId ? " #" + b.bigBottleShapeId : ""); }
      if (b.isLongBottle) ct.label = "ống dài";
      if (b.propIndex === 1) ct.marks.push({ type: "help" });
      return ct;
    });
    const orders = (j.lstOrderCI || []).slice();
    const lv = {
      level: numOf(file, j.LId), name: j.LId || baseName(file), containers, orders,
      groups: [...groups.values()].map((g) => ({ type: g.type, members: g.members, label: g.label + ` ×${g.members.length}` })),
      style: skin.style, rules: skin.rules, ordersLabel: skin.ordersLabel, yUp: true,
    };
    // bảng màu: thứ tự game duyệt CI (mỗi skin khai cách duyệt riêng)
    lv.palette = paletteByAppearance(skin.colorOrder ? skin.colorOrder(j) : B.flatMap((b) => (b.C || []).map((w) => w && w.BIM && w.BIM.CI)), skin.colors);
    if (skin.post) skin.post(lv, j, file);
    return [LK.normalize(lv)];
  }
  /** Tạo adapter cho 1 game dùng định dạng runtime — game mới cùng họ chỉ cần thêm 1 skin. */
  function runtimeSkin(skin) {
    return {
      id: skin.id, name: skin.name, game: skin.game || skin.name, family: "runtime", note: skin.note, legend: skin.legend,
      detect: (j, file) => (isRuntime(j) ? (skin.match ? skin.match(j, file) : 0.8) : 0),
      parse: (j, file) => parseRuntime(j, file, skin),
    };
  }
  const cds = runtimeSkin({
    id: "cds", name: "Chaos Drink Sort (CDS)", game: "Chaos Drink Sort",
    note: "File level runtime (B / C / BIM) trong Assets/EncryptedAsset. Màu map theo thứ tự xuất hiện như InGameGroup.MapColor; tag Hard lấy từ Config/LevelConfig_v*.txt nếu bạn nạp kèm.",
    style: { container: "tube", item: "liquid" }, sx: 0.57, sy: 0.42, ordersLabel: "đơn",
    match: (j, file) => (/_cds(_v\d+)?$/i.test(baseName(file)) || /difficulty\d/i.test(String(j.LId || baseName(file))) ? 0.7 : 0.9),
  });
  const magic = runtimeSkin({
    id: "magicsort", name: "Magic Sort", game: "Magic Sort",
    note: "Cùng định dạng runtime với CDS. Tên file dạng <pack>_<pack><N>_difficulty<D>-<V>.txt → level N, tag “độ khó D”.",
    style: { container: "tube", item: "liquid" }, sx: 0.57, sy: 0.42,
    match: (j, file) => (/difficulty\d/i.test(String(j.LId || "") + " " + baseName(file)) ? 0.95 : 0.6),
    post(lv, j, file) {
      const m = /difficulty(\d+)/i.exec(String(j.LId || "") + " " + baseName(file));
      if (m) lv.tags = ["độ khó " + m[1]];
    },
  });
  const chirpy = runtimeSkin({
    id: "chirpy", name: "Chirpy Sort (cành chim)", game: "Chirpy Sort",
    note: "Cùng định dạng runtime với CDS nhưng vẽ thành cành: cành i ở cột i % 2 (trái trước), chim số 0 sát mép màn hình. BIM.Id 2 = trứng. Thứ tự level lấy từ level_v1_list.txt, tag Hard từ level_v1_config.txt nếu nạp kèm.",
    style: { container: "branch", item: "bird" }, usePositions: false, ordersLabel: "tổ",
    names: { cover: "bụi", ice: "mây", tray: "băng", lockbox: "hộp khoá", curtain: "rèm" },
    match: (j, file) => (/_cds(_v\d+)?$/i.test(baseName(file)) ? 0.95 : 0.55),
    arrange: arrangeGroups,
    // LevelLoader.MapColors: cành → chim refill (NC) → tổ (lstOrderCI) → màu bụi (tính trên thứ tự gốc, trước khi xếp nhóm)
    colorOrder: (j) => [
      ...j.B.flatMap((b) => (b.C || []).map((w) => w && w.BIM && w.BIM.CI)),
      ...j.B.flatMap((b) => (((b.OBIM || [])[0] || {}).Id === 18 ? ((b.OBIM || [])[0].NC || []) : [])),
      ...(j.lstOrderCI || []),
      ...j.B.map((b) => { const o = (b.OBIM || [])[0] || {}; return o.Id === 4 ? (o.Obj || {}).CI : null; }),
    ],
    post(lv) {
      lv.containers.forEach((c, i) => { c.dir = i % 2 === 0 ? "right" : "left"; c.col = i % 2; c.row = Math.floor(i / 2); });
      lv.layout = "columns2";
    },
  });

  /** Chirpy LevelLoader.ArrangeGroups: các cành cùng nhóm (hộp khoá / rèm / khay) phải nằm liền nhau trong 1 cột
   *  (cành i ở cột i % 2). Nhóm lớn xếp trước, ưu tiên cột đang chứa nhiều thành viên; cành lẻ giữ thứ tự. */
  function arrangeGroups(list) {
    if (!list || list.length < 2) return list;
    const key = (b) => {
      const ov = b.OVBIM || {}, ob = (b.OBIM || [])[0] || {};
      if (ov.KLT > 0) return "lock " + ov.KLT;
      if (ov.Id === 26) return "curtain " + ov.CAI;
      if (ob.Id === 15) return "tray " + ob.MCI;
      return null;
    };
    const groups = new Map();
    list.forEach((b, i) => { const k = key(b); if (k != null) { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); } });
    if (!groups.size) return list;
    const n = list.length, cap = [Math.ceil(n / 2), Math.floor(n / 2)];
    const clusters = [...groups.values()].sort((a, b) => b.length - a.length);
    const sides = new Array(clusters.length).fill(0);
    let used = [0, 0], greedy = true;
    for (let c = 0; c < clusters.length && greedy; c++) {
      const evens = clusters[c].filter((i) => i % 2 === 0).length;
      const pref = evens * 2 >= clusters[c].length ? 0 : 1;
      const side = used[pref] + clusters[c].length <= cap[pref] ? pref : 1 - pref;
      if (used[side] + clusters[c].length > cap[side]) greedy = false;
      sides[c] = side; used[side] += clusters[c].length;
    }
    if (!greedy) {
      if (clusters.length > 16) return list;
      let ok = false;
      for (let mask = 0; mask < 1 << clusters.length && !ok; mask++) {
        used = [0, 0];
        clusters.forEach((g, c) => { sides[c] = (mask >> c) & 1; used[sides[c]] += g.length; });
        ok = used[0] <= cap[0] && used[1] <= cap[1];
      }
      if (!ok) return list;
    }
    used = [0, 0];
    const cols = [[], []];
    clusters.forEach((g, c) => { cols[sides[c]].push({ anchor: g[0], items: g }); used[sides[c]] += g.length; });
    const grouped = new Set(clusters.flat());
    for (let i = 0; i < n; i++) {
      if (grouped.has(i)) continue;
      const side = used[i % 2] < cap[i % 2] ? i % 2 : 1 - (i % 2);
      used[side]++;
      cols[side].push({ anchor: i, items: [i] });
    }
    const flat = (c) => c.sort((a, b) => a.anchor - b.anchor).flatMap((r) => r.items);
    const left = flat(cols[0]), right = flat(cols[1]), out = [];
    for (let r = 0; r < left.length; r++) { out.push(list[left[r]]); if (r < right.length) out.push(list[right[r]]); }
    return out;
  }

  // ================================================================ 3. Định dạng editor ("Level_N": {bottles…})
  // colorOrder[0] = MIỆNG (trên cùng) → đảo lại thành dưới → trên. hiddenSegments / keys cùng chỉ số với colorOrder.
  const EDITOR_COLORS = { "Red": "#DF2219", "Yellow": "#F8C827", "Dark Blue": "#3232F9", "Light Green": "#6ACA1A", "Violet": "#8804D4",
    "Orange": "#FB671A", "Pink": "#F87EDD", "Dark Green": "#00734C", "Brown": "#8B340C", "Light Blue": "#42A6FD", "Milky": "#DDCBD4", "Cyan": "#18C8C8" };
  function editorBody(j) {
    if (!isObj(j)) return null;
    if (Array.isArray(j.bottles)) return { key: null, body: j };
    const keys = Object.keys(j).filter((k) => /^level_?\d+$/i.test(k) && isObj(j[k]) && Array.isArray(j[k].bottles));
    return keys.length ? { key: keys[0], body: j[keys[0]], all: keys } : null;
  }
  const editor = {
    id: "sort-editor", name: "Sort editor JSON (colorOrder)", game: "Sort (editor)",
    note: "File của level editor / solver: {\"Level_N\": {bottles: [{colorOrder, hiddenSegments, hasIce…}], objective}}. colorOrder[0] là miệng ống.",
    detect: (j) => { const e = editorBody(j); return e && e.body.bottles.every((b) => isObj(b) && (Array.isArray(b.colorOrder) || Array.isArray(b.segments))) ? 0.95 : 0; },
    parse(j, file) {
      const e = editorBody(j);
      const keys = e.all || [e.key];
      return keys.map((k) => {
        const L = k ? j[k] : j;
        const groups = new Map();
        const addGroup = (type, key, i, label) => { const id = type + key; if (!groups.has(id)) groups.set(id, { type, members: [], label }); groups.get(id).members.push(i); };
        const lockOf = new Map();
        for (const lb of L.lockBags || []) for (const t of lb.coveredTubeIndices || []) lockOf.set(t, lb.lockId);
        const containers = L.bottles.map((b, i) => {
          let top = Array.isArray(b.colorOrder) ? b.colorOrder : null;
          let cells;
          if (top) cells = top.map((c, k) => ({ c, hidden: !!(b.hiddenSegments || [])[k], key: (b.keys || [])[k] })).reverse();
          else cells = (b.segments || []).map((c) => ({ c }));
          const ct = { items: cells.filter((x) => x.c != null).map((x) => ({ c: x.c, hidden: x.hidden || undefined, key: x.key > 0 ? x.key : undefined })),
            capacity: cells.length || 4, marks: [] };
          if (isFinite(b.x) && isFinite(b.y)) { ct.x = +b.x * 0.57; ct.y = +b.y * 0.42; }
          if (b.hasIce) ct.marks.push({ type: "cover", n: b.iceCount, c: b.iceColor });
          if (b.hasBag) ct.marks.push({ type: "ice", n: b.bagCount });
          if (b.hasBlockBottle) ct.marks.push({ type: "seal" });
          if (b.isRefillBottle) ct.marks.push({ type: "spawn", items: b.refillColors || [] });
          if (b.hasVideo) ct.marks.push({ type: "ads" });
          if (b.isDisabled) ct.marks.push({ type: "badge", label: "tắt" });
          if (b.woodTrayId > 0 || b.hasWoodTray) addGroup("tray", b.woodTrayId || 0, i, "khay " + (b.woodTrayId || 0));
          const lock = b.lockBagId > 0 ? b.lockBagId : lockOf.get(i);
          if (lock) addGroup("lockbox", lock, i, "hộp khoá #" + lock);
          if (b.curtainId > 0 || b.hasCurtain) addGroup("curtain", b.curtainId || 0, i, "rèm " + (b.curtainId || 0));
          if (b.isBigBottle) { ct.size = 2.4; ct.label = "khổng lồ"; }
          return ct;
        });
        const tags = [];
        if (L.tag) tags.push(String(L.tag));
        const lv = {
          level: numOf(k || file), name: (k || baseName(file)) + (L.difficulty != null ? ` · điểm ${L.difficulty}` : ""),
          containers, orders: L.objective || [], ordersLabel: "đơn", tags, palette: Object.assign({}, EDITOR_COLORS),
          groups: [...groups.values()].map((g) => ({ type: g.type, members: g.members, label: g.label + ` ×${g.members.length}` })),
          style: { container: "tube", item: "liquid" }, yUp: true,
        };
        return LK.normalize(lv);
      });
    },
  };

  // ================================================================ 4. Dạng đơn giản {capacity, tubes: [[…]]} (0 = ô trống)
  const simple = {
    id: "simple-tubes", name: "Water sort đơn giản (tubes)", game: "Water sort",
    note: "{capacity, num_colors, tubes: [[màu dưới → trên]]}, 0 = ô trống — dạng của solver / generator.",
    detect: (j) => (isObj(j) && Array.isArray(j.tubes) && j.tubes.every(Array.isArray) ? 0.92 : 0),
    parse(j, file) {
      const cap = +j.capacity || Math.max(...j.tubes.map((t) => t.length));
      return [LK.normalize({ level: numOf(file) || j.level || 1, name: baseName(file), style: { container: "tube", item: "liquid" },
        containers: j.tubes.map((t) => ({ items: t.filter((x) => x !== 0 && x != null), capacity: cap })) })];
    },
  };

  // ================================================================ 5. Bird Sort (trứng rơi + chim)
  // clutch[] = trứng theo thứ tự rơi · slots = số chỗ chim (0–5, quyết định cỡ trứng) · birds = id loài
  // birds dài hơn slots = trứng lốc xoáy (tự nạp thêm) / băng chuyền · tier 2 Hard, 3 Super Hard · mỗi tổ 3 chim
  const EGG_R = [0.77, 0.77, 1.28, 1.49, 1.79, 2.0];
  const birdLabel = (id) => (id === -1 || id === 10000 ? "W" : id === -2 || id === 10001 ? "D" : null);
  const birdSort = {
    id: "birdsort", name: "Bird Sort (trứng & chim)", game: "Bird Sort",
    note: "Trứng rơi tự do trong game nên bố cục ở đây chỉ là minh hoạ (xếp đống từ dưới lên); thứ tự, số chỗ, loài chim và cơ chế đúng theo file. W = chim joker, D = chim mồi, F = băng giá, C = lồng, T = bị buộc.",
    legend: { W: "chim joker (wild)", D: "chim mồi (decoy)", "F": "băng giá (số lớp)", "C": "lồng (số lớp)", T: "bị buộc", "?": "ngụy trang" },
    detect: (j) => (isObj(j) && Array.isArray(j.clutch) ? 0.95 : Array.isArray(j) && j.length && j.every((x) => isObj(x) && "FishStr" in x) ? 0.9 : 0),
    parse(j, file) {
      if (Array.isArray(j)) return [legacyBubble(j, file)];
      const containers = j.clutch.map((e) => {
        const slots = Math.max(0, +e.slots || 0);
        const birds = e.birds || [];
        const items = birds.slice(0, slots).map((id, i) => {
          const it = birdLabel(id) === "W" ? { c: "joker", wild: true } : birdLabel(id) ? { c: "decoy", ignore: true } : { c: id };
          const lab = [];
          if (birdLabel(id)) lab.push(birdLabel(id));
          if ((e.disguised || []).includes(i)) lab.push("?");
          if ((e.tethered || []).includes(i)) lab.push("T");
          if ((e.frost || {})[i] != null) lab.push("F" + e.frost[i]);
          if ((e.cages || {})[i] != null) lab.push("C" + e.cages[i]);
          if ((e.keyBirds || []).includes(i)) it.key = true;
          if (lab.length) it.label = lab.join("");
          return it;
        });
        const ct = { items, capacity: slots || 1, size: (EGG_R[slots] || 1.49) / 1.49, marks: [] };
        if (birds.length > slots) ct.marks.push({ type: e.isConveyor ? "conveyor" : "vortex", label: (e.isConveyor ? "băng chuyền +" : "lốc xoáy +") + (birds.length - slots), items: birds.slice(slots).filter((id) => !birdLabel(id)) });
        else if (e.isConveyor) ct.marks.push({ type: "conveyor", label: "băng chuyền" });
        if (e.frozen) ct.marks.push({ type: "ice" });
        if (e.hidden) ct.marks.push({ type: "hidden" });
        if (e.vines) ct.marks.push({ type: "lock", label: "dây leo" });
        if (e.keyEgg) ct.marks.push({ type: "badge", label: "trứng chìa" });
        if (e.wraps) ct.marks.push({ type: "badge", label: "bọc " + e.wraps });
        if (e.boulder) ct.marks.push({ type: "badge", label: "đá" + (e.cracks ? " " + e.cracks : "") });
        if (e.revealAfter != null) ct.marks.push({ type: "badge", label: "lộ sau loài " + e.revealAfter });
        return ct;
      });
      const tags = [];
      if (+j.tier === 3) tags.push("Super Hard"); else if (+j.tier === 2) tags.push("Hard");
      if (j.hasPredator) tags.push("Predator");
      if ((j.timerNests || []).length) tags.push("Tổ đếm ngược ×" + j.timerNests.length);
      if ((j.props || []).length) tags.push("Vật cản cành ×" + j.props.length);
      return [LK.normalize({ level: numOf(file) || j.levelId || 1, name: baseName(file), containers, tags,
        style: { container: "egg", item: "bird" }, rules: { colorMultiple: 3, needFree: false, presolved: false }, colorMode: "appearance",
        palette: { joker: "#E8E8E8", decoy: "#555A66" }, layout: "pile" })];
    },
  };
  function legacyBubble(arr, file) {
    const containers = arr.map((b) => {
      const ids = String(b.FishStr || "").split(/[,;\s]+/).filter(Boolean).map(Number);
      const items = ids.map((c) => (birdLabel(c) === "W" ? { c: "joker", wild: true, label: "W" } : birdLabel(c) ? { c: "decoy", ignore: true, label: "D" } : { c }));
      const ct = { items, capacity: ids.length || 1, size: (EGG_R[ids.length] || 1.49) / 1.49, marks: [] };
      if (b.IsFrozen) ct.marks.push({ type: "ice" });
      if (b.IsUnknown) ct.marks.push({ type: "hidden" });
      if (b.LockCount > 0) ct.marks.push({ type: "lock", label: "khoá " + b.LockCount });
      if (b.IsKey) ct.marks.push({ type: "badge", label: "chìa" });
      return ct;
    });
    return LK.normalize({ level: numOf(file) || 1, name: baseName(file), containers, style: { container: "egg", item: "bird" },
      rules: { colorMultiple: 3, needFree: false, presolved: false }, colorMode: "appearance", layout: "pile", palette: { joker: "#E8E8E8", decoy: "#555A66" } });
  }

  // ================================================================ 6. Tự đoán (game chưa khai báo)
  const auto = {
    id: "auto", name: "Tự đoán cấu trúc (game mới)", game: "Chưa khai báo", kind: "auto",
    note: "Tool tự tìm mảng “vật chứa” và “vật phẩm” trong file. Kiểm tra lại ở mục “Cấu hình đọc file”, chỉnh rồi lưu thành game mới.",
    detect: (j) => { try { const p = LK.guessMapping(j); return p && LK.fromMapping(j, p, "x").some((l) => l.containers.length) ? 0.25 : 0; } catch (e) { return 0; } },
    parse: (j, file) => { const p = LK.guessMapping(j); if (!p) throw new Error("Không đoán được cấu trúc file."); return LK.fromMapping(j, p, file); },
  };

  const BUILTIN = [gdk, cds, magic, chirpy, editor, simple, birdSort, auto];
  BUILTIN.forEach((a) => LK.register(a));

  // ================================================================ file phụ: tag độ khó + thứ tự level
  /** {levelConfigModels:[{Level?, isHard, isSuperHard, isTutorial, seeds?:[LId]}]} → {byNumber: Map, byName: Map} */
  function readTagFile(j) {
    const list = isObj(j) && Array.isArray(j.levelConfigModels) ? j.levelConfigModels : null;
    if (!list) return null;
    const byNumber = new Map(), byName = new Map();
    list.forEach((m, i) => {
      const tags = [];
      if (m.isSuperHard) tags.push("Super Hard"); else if (m.isHard) tags.push("Hard");
      if (m.isTutorial) tags.push("Tutorial");
      const n = +m.Level > 0 ? +m.Level : +m.levelOrder > 0 ? +m.levelOrder : i + 1;
      byNumber.set(n, tags);
      for (const s of m.seeds || []) byName.set(String(s), tags);
    });
    return { byNumber, byName, count: list.length };
  }
  /** File .txt mỗi dòng 1 tên level (vd level_v1_list.txt) → [tên…] nếu ≥ 60% dòng khớp tên file đã nạp. */
  function readOrderList(text, knownNames) {
    const lines = stripBom(String(text)).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (lines.length < 3 || lines.some((l) => l.length > 120 || /[{}[\]]/.test(l))) return null;
    const names = lines.map((l) => baseName(l.split(/[,\t]/)[0]));
    const hit = names.filter((n) => knownNames.has(n.toLowerCase())).length;
    return hit >= Math.max(3, names.length * 0.6) ? names : null;
  }
  /** Unity: LevelConfig_vN.asset (danh sách {fileID, guid}) + các file .meta → [đường dẫn file theo thứ tự]. */
  function readUnityList(assetText, guidToPath) {
    const out = [];
    const re = /guid:\s*([0-9a-f]{32})/gi;
    let m;
    while ((m = re.exec(assetText))) { const p = guidToPath.get(m[1].toLowerCase()); if (p) out.push(p); }
    return out.length >= 3 ? out : null;
  }
  const metaGuid = (text) => { const m = /^guid:\s*([0-9a-f]{32})/im.exec(text); return m ? m[1].toLowerCase() : null; };

  return { BUILTIN, runtimeSkin, arrangeGroups, paletteByAppearance, readTagFile, readOrderList, readUnityList, metaGuid, isRuntime, editorBody, EDITOR_COLORS };
});

/* Level Stuck — LÕI kiểm tra "level có bị kẹt không" bằng chính luật của game (chạy trên trình duyệt + Node để test).

   Kẹt = không có chuỗi nước đi nào thắng được level theo luật game (như lúc ship: không booster, không revive).
   Cách làm (giống StuckKit C# của Bird Sort, xem web/docs/check-level-stuck.md):
     1. port luật game vào 1 "engine" (start / moves / apply / won / hash / hopeless…)
     2. bộ giải tìm hết mọi đường đi: DFS + bảng trạng thái đã duyệt + restart kiểu Luby; duyệt hết cây = CHỨNG MINH
     3. hậu kiểm: chạy lại lời giải trên ván mới, chạy lặp kiểm tính tất định, đối chứng âm (bản hỏng phải bị bắt),
        đối chứng dương (level chắc chắn thắng được phải ra OK), mâu thuẫn (soát data nói "không thắng được" mà vẫn thắng)

   Engine có sẵn: "cds" (Chaos Drink Sort — file runtime B / C / BIM, luật Bottle.cs / InGameGroup.cs) và
   "watersort" (level chuẩn Toolkit / file water sort đơn giản, không cơ chế). Game mới = thêm 1 engine. */
(function (root, factory) {
  const lib = factory();
  if (typeof module === "object" && module.exports) module.exports = lib;
  else { root.GDK = root.GDK || {}; root.GDK.lib = root.GDK.lib || {}; root.GDK.lib.stuckkit = lib; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  // ================================================================ tiện ích
  /** PRNG tất định (mulberry32) — cùng seed thì cùng kết quả. */
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /** Dãy Luby 1 1 2 1 1 2 4 1 1 2 … (i bắt đầu từ 1) — cỡ ngân sách của từng lượt restart. */
  function luby(i) {
    for (let k = 1; ; k++) {
      const top = (1 << k) - 1;
      if (i === top) return 1 << (k - 1);
      if (i < top) return luby(i - (1 << (k - 1)) + 1);
    }
  }

  // ================================================================ BỘ GIẢI (dùng chung mọi engine)
  /**
   * 1 lượt DFS từ gốc, tối đa `limit` nút. Trạng thái đã duyệt trong lượt không mở lại; khi cả 1 thành phần liên thông
   * mạnh (Tarjan) đóng lại mà không thắng thì mọi trạng thái trong đó CHẮC CHẮN chết → ghi vào `dead` dùng chung cho các
   * lượt sau (đúng cả khi có vòng lặp nước đi). Lượt đi hết cây mà không thắng = chứng minh kẹt.
   */
  function runPass(E, root, P) {
    const seen = new Map();            // hash → chỉ số DFS (đang mở) | -1 (đã đóng, chết)
    const scc = [], stack = [];
    let nodes = 0, idx = 0;
    const out = { won: false, complete: false, timedOut: false, nodes: 0, path: null, final: null };
    const order = (moves) => {
      if (P.jitter) for (const m of moves) m._s = m.score + P.rand() * P.jitter;
      else for (const m of moves) m._s = m.score;
      return moves.sort((a, b) => b._s - a._s);
    };
    const pathOf = (extra) => { const p = stack.slice(1).map((f) => f.via); if (extra) p.push(extra); return p; };
    const push = (state, hash, via) => {
      const moves = order(E.moves(state));
      const f = { state, hash, moves, next: 0, idx, low: idx, via };
      idx++; nodes++;
      seen.set(hash, f.idx); scc.push(f); stack.push(f);
      if (!moves.length) P.leaf(state, null, pathOf(), stack.length - 1);
      return f;
    };
    const rootHash = E.hash(root);
    if (P.dead.has(rootHash)) { out.complete = true; return out; }
    push(root, rootHash, null);
    while (stack.length) {
      const f = stack[stack.length - 1];
      if (f.next < f.moves.length) {
        if (nodes >= P.limit) { out.nodes = nodes; return out; }
        if ((nodes & 255) === 0 && now() > P.deadline) { out.timedOut = true; out.nodes = nodes; return out; }
        const mv = f.moves[f.next++];
        const child = mv.prepared || E.clone(f.state);
        if (!mv.prepared) E.apply(child, mv);
        mv.prepared = null;
        const h = E.hash(child);
        if (P.dead.has(h)) continue;
        const si = seen.get(h);
        if (si !== undefined) { if (si >= 0 && si < f.low) f.low = si; continue; }
        if (E.won(child)) {
          out.won = true; out.path = pathOf(mv); out.final = child; out.nodes = nodes + 1;
          return out;
        }
        const why = E.hopeless(child);
        if (why) { nodes++; P.dead.add(h); P.leaf(child, why, pathOf(mv), stack.length); continue; }
        push(child, h, mv);
      } else {
        stack.pop();
        f.state = null; f.moves = null;
        const parent = stack[stack.length - 1];
        if (parent && f.low < parent.low) parent.low = f.low;
        if (f.low === f.idx) {
          let x;
          do { x = scc.pop(); seen.set(x.hash, -1); P.dead.add(x.hash); } while (x !== f);
        }
      }
    }
    out.complete = true; out.nodes = nodes;
    return out;
  }

  /**
   * Giải 1 level với 1 biến thể (0 = như ship, 1 = thêm tài nguyên). opts: {nodes, timeMs, first, unit, jitter, seed}.
   * Trả {won, exhaustive, nodes, restarts, ms, timedOut, path:[move], deadEnds:{kind:n}, best:{path, state, why}}.
   */
  function solve(E, lv, variant, opts) {
    const o = Object.assign({ nodes: 150000, timeMs: 6000, first: 4000, unit: 1000, jitter: 130, seed: 1 }, opts || {});
    const t0 = now();
    const res = { variant, won: false, exhaustive: false, nodes: 0, restarts: 0, ms: 0, timedOut: false, path: null, deadEnds: {}, best: null };
    const root = E.start(lv, variant);
    const leaf = (state, why, path, depth) => {
      const d = why ? { kind: why.kind, detail: why.detail } : E.deadEnd(state);
      res.deadEnds[d.kind] = (res.deadEnds[d.kind] || 0) + 1;
      const pr = E.progress(state);
      if (!res.best || pr > res.best.progress || (pr === res.best.progress && depth > res.best.path.length))
        res.best = { progress: pr, path: path.slice(), board: E.board(state), kind: d.kind, detail: d.detail };
    };
    if (E.won(root)) { res.won = true; res.path = []; res.ms = now() - t0; return res; }
    const why0 = E.hopeless(root);
    if (why0) { leaf(root, why0, [], 0); res.exhaustive = true; res.ms = now() - t0; return res; }
    const dead = new Set();
    let left = o.nodes, pass = 0;
    while (left > 0) {
      const limit = Math.min(left, pass === 0 ? o.first : luby(pass) * o.unit);
      const r = runPass(E, root, { limit, jitter: pass ? o.jitter : 0, rand: rng(o.seed * 7919 + pass * 104729), dead, deadline: t0 + o.timeMs, leaf });
      res.nodes += r.nodes; left -= Math.max(1, r.nodes);
      if (r.won) { res.won = true; res.path = r.path; break; }
      if (r.complete) { res.exhaustive = true; break; }
      if (r.timedOut) { res.timedOut = true; break; }
      pass++;
    }
    res.restarts = pass;
    res.ms = now() - t0;
    return res;
  }

  /** Hậu kiểm V4: chạy lại lời giải trên ván MỚI chỉ bằng khoá nước đi (không dùng chỉ số của bộ giải). */
  function replay(E, lv, variant, keys, withView) {
    const s = E.start(lv, variant);
    const steps = [];
    for (let i = 0; i < keys.length; i++) {
      const mv = E.moves(s).find((m) => m.key === keys[i]);
      if (!mv) return { ok: false, at: i, steps, why: `Nước ${i + 1} (${keys[i]}) không còn hợp lệ khi chạy lại` };
      E.apply(s, mv);
      steps.push({ label: mv.label, board: E.board(s), view: withView && E.view ? E.view(s, mv) : null });
    }
    return E.won(s) ? { ok: true, steps } : { ok: false, at: keys.length, steps, why: "Chạy lại hết lời giải nhưng không thắng" };
  }

  // ================================================================ ENGINE SORT (CDS + water sort chuẩn)
  // Ống = mảng giá trị DƯỚI → TRÊN, giá trị = màu * 2 + (1 nếu ô ẩn "?").
  const COVER = 4, SEAL = 6, FROZEN = 7, ICE = 15, TAG = 17, SPAWN = 18;
  const SUPPORTED_OBIM = new Set([COVER, SEAL, FROZEN, ICE, TAG, SPAWN]);
  const KIND_NAME = { 4: "nắp", 6: "niêm", 7: "đóng băng", 15: "băng nhóm", 17: "ống tag màu", 18: "ống sinh nước" };
  const MAX_SLOT = 4, OPEN_SLOT = 2;      // InGameGroup.maxSlotOrder / unlockedSlots

  /** Level CDS (JSON runtime B / C / BIM) → cấu trúc engine. Không đoán: cơ chế chưa port → `unsupported`. */
  function loadCDS(raw, fileName) {
    if (!raw || !Array.isArray(raw.B) || !raw.B.length) throw new Error("Không phải file level runtime (thiếu mảng B).");
    const n = raw.B.length;
    const lv = { name: fileName || raw.LId || "level", n, tubes: [], cap: [], keys: [], kind: [], ci: [], ta: [], mci: [], klt: [], car: [], ads: [], pool: [],
      orders: (raw.lstOrderCI || []).filter((x) => Number.isInteger(x) && x >= 0), unsupported: [], findings: [], extraTube: false };
    const uns = new Set();
    raw.B.forEach((b, i) => {
      const C = Array.isArray(b.C) ? b.C : [];
      const ob = (b.OBIM || [])[0];
      const cap = ob && ob.Id === SPAWN ? 1 : 4;          // Bottle.m_MaxColor: ống sinh 1, ống thường 4
      const tube = [], keys = new Array(Math.max(cap, C.length)).fill(0);
      C.forEach((c, k) => {
        const bim = c && c.BIM;
        if (bim && Number.isInteger(bim.CI)) tube.push(bim.CI * 2 + (bim.Id === 2 ? 1 : 0));
        const cb = c && c.CBIM;
        if (cb && cb.KLT > 0 && k < cap) keys[k] = cb.KLT;
      });
      let kind = 0, ci = -1, ta = 0, mci = 0, pool = [];
      if (ob && ob.Id != null) {
        kind = ob.Id; const obj = ob.Obj || {};
        ci = kind === TAG ? (ob.CI != null ? ob.CI : -1) : obj.CI != null ? obj.CI : -1; ta = obj.TA || 0; mci = ob.MCI || 0;
        if (kind === SPAWN) pool = (ob.NC || []).filter((x) => Number.isInteger(x) && x >= 0);
        if (!SUPPORTED_OBIM.has(kind)) uns.add("OBIM " + kind);
      }
      const ov = b.OVBIM || {};
      for (const [f, label] of [["isLongBottle", "ống dài"], ["isBigBottle", "ống khổng lồ"], ["isFlyWaterBottle", "nước bay"], ["isMultiBottle", "ống ghép (multi bottle)"]])
        if (b[f]) uns.add(label);
      lv.tubes.push(tube); lv.cap.push(cap); lv.keys.push(keys);
      lv.kind.push(kind); lv.ci.push(ci); lv.ta.push(ta); lv.mci.push(mci);
      lv.klt.push(ov.KLT > 0 ? ov.KLT : 0);
      lv.car.push(ov.Id === 26 ? (ov.CAI | 0) + 1 : 0);          // nhóm rèm +1 (0 = không có rèm)
      lv.ads.push(!!b.hasVideo); lv.pool.push(pool);
    });
    lv.unsupported = [...uns];
    analyze(lv, true);
    return lv;
  }

  /** Level chuẩn GD Toolkit (levelkit.normalize) → engine. Chỉ water sort không cơ chế. */
  function loadStd(L, fileName) {
    const cs = (L && L.containers) || [];
    if (!cs.length) throw new Error("Level không có vật chứa.");
    const ids = new Map();
    const id = (c) => { const k = String(c); if (!ids.has(k)) ids.set(k, ids.size); return ids.get(k); };
    const lv = { name: fileName || L.name || "level", n: cs.length, tubes: [], cap: [], keys: [], kind: [], ci: [], ta: [], mci: [], klt: [], car: [], ads: [], pool: [],
      orders: [], unsupported: [], findings: [], colorNames: null, extraTube: false };
    const uns = new Set();
    cs.forEach((c) => {
      const cap = c.capacity || c.items.length || 4;
      lv.tubes.push(c.items.map((it) => { if (it.wild || it.ignore) uns.add("vật phẩm joker / mồi"); if (it.key != null) uns.add("chìa khoá"); return id(it.c) * 2 + (it.hidden ? 1 : 0); }));
      lv.cap.push(cap); lv.keys.push(new Array(cap).fill(0));
      lv.kind.push(0); lv.ci.push(-1); lv.ta.push(0); lv.mci.push(0); lv.klt.push(0); lv.car.push(0);
      const ads = (c.marks || []).some((m) => m.type === "ads");
      lv.ads.push(ads); lv.pool.push([]);
      for (const m of c.marks || []) if (m.type !== "ads") uns.add("cơ chế “" + m.type + "”");
      if ((c.size || 1) > 1.5) uns.add("vật chứa khổng lồ");
    });
    if ((L.groups || []).length) uns.add("nhóm vật chứa (" + L.groups.map((g) => g.type).join(", ") + ")");
    if (L.grid) uns.add("level dạng lưới");
    lv.colorNames = [...ids.keys()];
    lv.unsupported = [...uns];
    analyze(lv, false);
    return lv;
  }

  /** Soát data (không cần giải). error = chứng minh không thắng được · warn = rủi ro / sai quy ước · note = thông tin. */
  function analyze(lv, cds) {
    const F = lv.findings;
    const per = new Map();
    lv.tubes.forEach((t) => t.forEach((v) => per.set(v >> 1, (per.get(v >> 1) || 0) + 1)));
    lv.pool.forEach((p) => p.forEach((c) => per.set(c, (per.get(c) || 0) + 1)));
    lv.colors = per.size;
    lv.units = 0;
    const caps = [...new Set(lv.cap.filter((c, i) => lv.kind[i] !== SPAWN))];
    if (caps.length === 1) {
      const cap = caps[0];
      const bad = [...per].filter(([, k]) => k % cap !== 0);
      if (bad.length) F.push({ level: "error", code: "count", text: `${bad.length} màu không chia hết cho ${cap}: ` + bad.slice(0, 6).map(([c, k]) => `màu ${cname(lv, c)} có ${k} ô`).join(", ") + " → không ống nào chứa phần dư hoàn thành được." });
      lv.units = [...per.values()].reduce((s, k) => s + Math.floor(k / cap), 0);
    } else {
      F.push({ level: "warn", code: "caps", text: "Các ống có sức chứa khác nhau (" + caps.join(", ") + ") — không soát được số ô từng màu." });
      lv.units = Math.round([...per.values()].reduce((s, k) => s + k, 0) / (caps.reduce((a, b) => a + b, 0) / caps.length));
    }
    const total = lv.tubes.reduce((s, t) => s + t.length, 0), room = lv.tubes.reduce((s, t, i) => s + (lv.ads[i] || lv.kind[i] === SPAWN ? 0 : lv.cap[i] - t.length), 0);
    if (room === 0) F.push({ level: "warn", code: "nofree", text: "Không còn ô trống nào ngoài ống ads." });
    for (let i = 0; i < lv.n; i++) if (lv.tubes[i].length > lv.cap[i]) F.push({ level: "error", code: "overflow", text: `Ống ${i + 1} chứa ${lv.tubes[i].length} > sức chứa ${lv.cap[i]}.` });
    if (!cds) return;
    // order (lstOrderCI): mỗi ống hoàn thành = 1 phần tử, count[màu] = số ô / 4 (quy ước tool sinh order đã chốt)
    if (lv.orders.length) {
      const want = new Map();
      lv.orders.forEach((c) => want.set(c, (want.get(c) || 0) + 1));
      const cap = caps[0] || 4;
      const miss = [], extra = [];
      for (const [c, k] of per) { const u = Math.floor(k / cap), w = want.get(c) || 0; if (w < u) miss.push(`màu ${c}: ${w}/${u}`); }
      for (const [c, w] of want) { const u = Math.floor((per.get(c) || 0) / cap); if (w > u) extra.push(`màu ${c}: ${w}/${u}`); }
      if (miss.length) F.push({ level: "warn", code: "order-missing", text: "Thiếu order (MISSING_ORDER) — " + miss.join(", ") + ". Theo quy tắc đã chốt cho CDS: level thiếu / thừa order = KHÔNG PASS." });
      if (extra.length) F.push({ level: "warn", code: "order-extra", text: "Thừa order (EXTRA_ORDER) — " + extra.join(", ") + ". Theo quy tắc đã chốt cho CDS: level thiếu / thừa order = KHÔNG PASS." });
    } else {
      const blocked = [];
      for (let i = 0; i < lv.n; i++) if ((lv.kind[i] === COVER || lv.kind[i] === FROZEN) && lv.tubes[i].length) blocked.push(i + 1);
      if (blocked.length) F.push({ level: "error", code: "no-order", text: `Không có lstOrderCI → không ống nào được thu, nắp / đóng băng không bao giờ mở, mà ống ${blocked.join(", ")} còn nước.` });
      else F.push({ level: "note", code: "no-order", text: "Không có lstOrderCI — ống hoàn thành nằm lại trên bàn (game log “lstOrderCI is empty!”)." });
    }
    // hộp khoá có nước mà không có chìa nào trên bàn
    const keySet = new Set(lv.keys.flat().filter(Boolean));
    const lockGroups = [...new Set(lv.klt.filter(Boolean))];
    for (const g of lockGroups) {
      const water = lv.klt.some((k, i) => k === g && lv.tubes[i].length && !(lv.tubes[i].length === lv.cap[i] && lv.tubes[i].every((v) => v === lv.tubes[i][0] && !(v & 1))));
      if (!keySet.has(g) && water) F.push({ level: "error", code: "nokey", text: `Hộp khoá #${g} có nước nhưng không có chìa KLT ${g} nào trong level.` });
    }
    for (let i = 0; i < lv.n; i++) {
      if (lv.kind[i] === COVER && !per.has(lv.ci[i])) F.push({ level: "error", code: "cover-color", text: `Nắp ống ${i + 1} chờ màu ${lv.ci[i]} nhưng level không có màu đó.` });
      if (lv.kind[i] === TAG && lv.tubes[i].some((v) => (v >> 1) !== lv.ci[i])) F.push({ level: "note", code: "tag-mixed", text: `Ống tag ${i + 1} (màu ${lv.ci[i]}) đang chứa màu khác — phải rót hết ra mới nhận lại được.` });
      if (lv.kind[i] === SPAWN && !lv.pool[i].length && !lv.tubes[i].length) F.push({ level: "note", code: "spawn-empty", text: `Ống sinh ${i + 1} không có nước nào trong hàng chờ.` });
    }
    const full = lv.tubes.filter((t, i) => t.length === lv.cap[i] && t.every((v) => v === t[0] && !(v & 1))).length;
    if (full) F.push({ level: "note", code: "presolved", text: `${full} ống đã đầy 1 màu ngay từ đầu.` });
    const blind = total ? lv.tubes.flat().filter((v) => v & 1).length : 0;
    if (blind) F.push({ level: "note", code: "blind", text: `${blind} ô ẩn (?) — bộ giải biết màu thật (người chơi thì không).` });
  }
  const cname = (lv, c) => (lv.colorNames ? lv.colorNames[c] : String(c));

  /** Engine chung cho water sort / CDS. */
  const sortEngine = {
    start(lv, variant) {
      const n = lv.n;
      const s = {
        lv, t: lv.tubes.map((x) => x.slice()), cap: lv.cap.slice(), keys: lv.keys.map((k) => k.slice()),
        kind: lv.kind.slice(), ta: lv.ta.slice(), klt: lv.klt.slice(), car: lv.car.slice(),
        done: new Array(n).fill(false), rem: new Array(n).fill(false),
        off: lv.ads.map((a) => a && variant === 0), slots: [], qi: 0, served: 0, pi: new Array(n).fill(0),
      };
      if (variant === 1 && !lv.ads.some(Boolean)) {            // không có ống ads → biến thể 1 = thêm 1 ống trống (booster)
        const cap = mostCommon(lv.cap.filter((c, i) => lv.kind[i] !== SPAWN).concat([4]));
        s.t.push([]); s.cap.push(cap); s.keys.push(new Array(cap).fill(0)); s.kind.push(0); s.ta.push(0); s.klt.push(0); s.car.push(0);
        s.done.push(false); s.rem.push(false); s.off.push(false); s.pi.push(0);
      }
      for (let i = 0; i < MAX_SLOT && s.qi < lv.orders.length; i++) s.slots.push(i >= OPEN_SLOT ? -1 : lv.orders[s.qi++]);
      return s;
    },
    /** Biến thể "thêm tài nguyên" khi bản như ship không thắng. mode "ads": chỉ mở ống ads (nếu level có) ·
     *  "booster": mở ống ads, không có thì thêm 1 ống trống. Trả nhãn hoặc null (không có biến thể). */
    variants(lv, mode) {
      if (lv.ads.some(Boolean)) return "mở ống xem ads";
      return mode === "booster" ? "thêm 1 ống trống (booster)" : null;
    },
    clone(s) {
      return { lv: s.lv, t: s.t.map((x) => x.slice()), cap: s.cap, keys: s.keys.map((k) => k.slice()), kind: s.kind.slice(), ta: s.ta.slice(),
        klt: s.klt.slice(), car: s.car.slice(), done: s.done.slice(), rem: s.rem.slice(), off: s.off, slots: s.slots.slice(), qi: s.qi, served: s.served, pi: s.pi.slice() };
    },
    /** Bottle.IsCannotClick (đảo) + NumColorCanRemove → nguồn; IsCanAddColor → đích; lượng rót = min(rút được, chỗ trống). */
    moves(s) {
      const out = [];
      const n = s.t.length;
      for (let a = 0; a < n; a++) {
        const take = canRemove(s, a);
        if (!take) continue;
        const ta = s.t[a];
        const top = ta[ta.length - 1], ci = top >> 1;
        const wholePlain = ta.length === take && !(top & 1) && isPlain(s, a);
        const runBelow = ta.length > take ? ta[ta.length - take - 1] : null;
        let emptySeen = new Set();
        for (let d = 0; d < n; d++) {
          if (d === a || !canAdd(s, d, ci)) continue;
          const td = s.t[d];
          if (!td.length && plainEmpty(s, d)) {
            if (wholePlain) continue;                      // đổ cả ống 1 màu sang ống trống y hệt = chỉ đổi chỗ
            if (emptySeen.has(s.cap[d])) continue;         // các ống trống giống nhau: chỉ thử 1
            emptySeen.add(s.cap[d]);
          }
          const amt = Math.min(take, s.cap[d] - td.length);
          let score = 0;
          if (td.length) score += 300;
          if (td.length + amt === s.cap[d] && td.every((v) => v === ci * 2)) score += 1000 + (s.slots.includes(ci) ? 500 : 0);
          if (amt < take) score -= 120;
          if (amt === take) {
            if (runBelow != null && (runBelow & 1)) score += 220;               // lộ ô ẩn
            if (runBelow == null) score += 150;                                 // làm trống ống
            if (keyExposed(s, a, take)) score += 260;
          }
          if (!td.length && wholePlain) score -= 400;
          out.push({ key: a + ">" + d, a, d, amt, ci, label: `Ống ${a + 1} → ${d + 1}: ${amt} × màu ${cname(s.lv, ci)}`, score });
        }
      }
      return out;
    },
    apply(s, m) {
      const src = s.t[m.a], dst = s.t[m.d];
      src.length -= m.amt;
      for (let i = 0; i < m.amt; i++) dst.push(m.ci * 2);
      // Bottle.MoveBottleBack: ống sinh rót cạn thì lấy ngay màu kế tiếp trong hàng chờ NC
      if (s.kind[m.a] === SPAWN && !src.length && s.pi[m.a] < s.lv.pool[m.a].length) src.push(s.lv.pool[m.a][s.pi[m.a]++] * 2);
      // Bottle.ResetAfterAddColor: niêm vỡ khi ống đầy 1 màu
      if (s.kind[m.d] === SEAL && fullSame(s, m.d)) s.kind[m.d] = 0;
      // Bottle.MoveBottleBack → UnlockBlind (ống nguồn), rồi BottleKeyHolder.FlyKeysToLockBox
      unlockBlind(s, m.a);
      flyKeys(s, m.a, m.amt);
      // Bottle.CheckTubeDone (ống đích)
      if (fullSame(s, m.d)) { onDone(s, m.d); collect(s, m.d); }
      return true;
    },
    /** InGameGroup.CheckWin: mọi ống IsComplete (trống hoặc đầy 1 màu) VÀ hàng chờ order đã rút hết. */
    won(s) {
      if (s.qi < s.lv.orders.length) return false;
      for (let i = 0; i < s.t.length; i++) if (!s.rem[i] && s.t[i].length && !fullSame(s, i)) return false;
      return true;
    },
    /** Khoá trạng thái (chính xác, không băm mất thông tin). Ống "thường" đổi chỗ cho nhau không đổi gì → xếp lại. */
    hash(s) {
      let fixed = "";
      const plain = [];
      for (let i = 0; i < s.t.length; i++) {
        const t = s.t[i];
        let c = String.fromCharCode(48 + s.cap[i]);
        for (let j = 0; j < t.length; j++) c += String.fromCharCode(64 + t[j]);
        if (isPlain(s, i)) { plain.push(c); continue; }
        if (s.rem[i]) { fixed += String.fromCharCode(33 + i) + "r"; continue; }
        fixed += String.fromCharCode(33 + i) + c;
        if (s.kind[i]) fixed += "k" + s.kind[i] + "." + (s.kind[i] === SPAWN ? s.pi[i] : s.ta[i]);
        if (s.klt[i]) fixed += "l" + s.klt[i];
        if (s.car[i]) fixed += "c" + s.car[i];
        if (s.done[i]) fixed += "d";
        if (s.off[i]) fixed += "o";
        if (hasKey(s, i)) fixed += "y" + s.keys[i].join(".");
        fixed += ";";
      }
      plain.sort();
      return fixed + "#" + plain.join(",") + "#" + s.slots.join(",") + "@" + s.qi;
    },
    /** Chứng nhận chắc chắn kẹt (chỉ những gì không thể đổi được nữa). */
    hopeless(s) {
      const n = s.t.length;
      // hộp khoá còn nước mà chìa của nó đã hết trên bàn (chìa nằm trong ống đã hoàn thành / đã thu)
      for (let i = 0; i < n; i++) {
        if (!s.klt[i] || !s.t[i].length || s.rem[i] || fullSame(s, i)) continue;      // ống đã đầy 1 màu thì không cần mở
        let alive = false;
        for (let j = 0; j < n && !alive; j++) if (!s.rem[j] && !s.done[j] && s.keys[j].includes(s.klt[i])) alive = true;
        if (!alive) return { kind: "Hộp khoá mất chìa", detail: `Hộp khoá #${s.klt[i]} (ống ${i + 1}) còn nước nhưng chìa không còn rót ra được nữa.` };
      }
      // nắp / đóng băng cần thu thêm nhiều ống hơn số order còn lại
      const future = s.slots.filter((c) => c >= 0).concat(s.lv.orders.slice(s.qi));
      for (let i = 0; i < n; i++) {
        if (s.rem[i] || !s.t[i].length) continue;
        if (s.kind[i] === COVER) {
          const left = future.filter((c) => c === s.lv.ci[i]).length;
          if (s.ta[i] > left) return { kind: "Nắp không mở được", detail: `Nắp ống ${i + 1} cần thu thêm ${s.ta[i]} ống màu ${cname(s.lv, s.lv.ci[i])}, order chỉ còn ${left}.` };
        } else if (s.kind[i] === FROZEN && s.ta[i] > future.length) {
          return { kind: "Băng không tan", detail: `Ống ${i + 1} đóng băng cần thu thêm ${s.ta[i]} ống, order chỉ còn ${future.length}.` };
        }
      }
      return null;
    },
    deadEnd(s) {
      const n = s.t.length;
      const why = [];
      const cnt = (f) => { let k = 0; for (let i = 0; i < n; i++) if (!s.rem[i] && f(i)) k++; return k; };
      const cov = cnt((i) => s.kind[i] === COVER && s.t[i].length), fro = cnt((i) => s.kind[i] === FROZEN && s.t[i].length);
      const box = cnt((i) => s.klt[i] && s.t[i].length), car = cnt((i) => s.car[i] && s.t[i].length), ice = cnt((i) => s.kind[i] === ICE);
      const doneWait = cnt((i) => s.done[i]);
      if (cov) why.push(cov + " ống bị nắp"); if (fro) why.push(fro + " ống đóng băng"); if (box) why.push(box + " ống trong hộp khoá");
      if (car) why.push(car + " ống dưới rèm"); if (ice) why.push(ice + " ống băng nhóm (chỉ rót vào)");
      if (doneWait) why.push(doneWait + " ống xong nhưng chưa khớp order đang mở");
      const free = cnt((i) => !s.off[i] && !s.done[i] && s.t[i].length < s.cap[i] && s.kind[i] !== COVER && s.kind[i] !== FROZEN && !s.klt[i] && !s.car[i]);
      why.push(free ? `${free} ống còn chỗ nhưng ngọn khác màu` : "không ống nào còn chỗ rót vào");
      return { kind: "Hết nước đi", detail: why.join(" · ") };
    },
    progress(s) {
      let k = s.served;
      for (let i = 0; i < s.t.length; i++) if (!s.rem[i] && fullSame(s, i)) k++;
      return s.lv.units ? k / s.lv.units : 0;
    },
    /** Bàn chơi dạng dữ liệu để vẽ: [{i, cap, items:[{c, h}], tags:[…], done, off}] + order. mv = nước vừa đi (tô sáng). */
    view(s, mv) {
      const tubes = [];
      for (let i = 0; i < s.t.length; i++) {
        if (s.rem[i]) continue;
        const tags = [];
        if (s.off[i]) tags.push("ads");
        if (s.kind[i] === COVER) tags.push(`nắp ${cname(s.lv, s.lv.ci[i])}×${s.ta[i]}`);
        else if (s.kind[i] === FROZEN) tags.push(`băng ${s.ta[i]}`);
        else if (s.kind[i] === SEAL) tags.push("niêm");
        else if (s.kind[i] === ICE) tags.push("băng nhóm");
        else if (s.kind[i] === TAG) tags.push(`tag ${cname(s.lv, s.lv.ci[i])}`);
        else if (s.kind[i] === SPAWN) tags.push(`sinh +${s.lv.pool[i].length - s.pi[i]}`);
        if (s.klt[i]) tags.push(`khoá #${s.klt[i]}`);
        if (s.car[i]) tags.push("rèm");
        tubes.push({ i, cap: s.cap[i], items: s.t[i].map((v, k) => ({ c: v >> 1, h: !!(v & 1), key: s.keys[i][k] || 0 })), tags, done: s.done[i], off: s.off[i],
          from: !!mv && mv.a === i, to: !!mv && mv.d === i });
      }
      return { tubes, slots: s.slots.slice(), left: s.lv.orders.length - s.qi, names: s.lv.colorNames || null };
    },
    board(s) {
      const tubes = s.t.map((t, i) => {
        if (s.rem[i]) return null;
        const body = "[" + t.map((v) => ((v & 1) ? "?" : "") + cname(s.lv, v >> 1)).join(" ") + "]";
        const tag = [];
        if (s.off[i]) tag.push("ads🔒");
        if (s.kind[i] === COVER) tag.push(`nắp ${cname(s.lv, s.lv.ci[i])}×${s.ta[i]}`);
        else if (s.kind[i] === FROZEN) tag.push(`băng ${s.ta[i]}`);
        else if (s.kind[i] === SEAL) tag.push("niêm");
        else if (s.kind[i] === ICE) tag.push(`băng nhóm ${s.lv.mci[i]}`);
        else if (s.kind[i] === TAG) tag.push(`tag màu ${cname(s.lv, s.lv.ci[i])}`);
        else if (s.kind[i] === SPAWN) tag.push(`sinh: còn ${s.lv.pool[i].length - s.pi[i]}`);
        if (s.klt[i]) tag.push(`hộp khoá #${s.klt[i]}`);
        if (s.car[i]) tag.push(`rèm ${s.car[i] - 1}`);
        if (hasKey(s, i)) tag.push("chìa " + s.keys[i].map((k, j) => (k ? `#${k}@${j + 1}` : "")).filter(Boolean).join(","));
        if (s.done[i]) tag.push("✓ chờ order");
        return `${i + 1}${tag.length ? "(" + tag.join(", ") + ")" : ""}${body}`;
      }).filter(Boolean);
      const ord = s.lv.orders.length ? `  ‖ order đang mở: ${s.slots.filter((c) => c >= 0).map((c) => cname(s.lv, c)).join(", ") || "—"} · còn chờ ${s.lv.orders.length - s.qi}` : "";
      return tubes.join("  ") + ord;
    },
  };
  function mostCommon(arr) { const m = new Map(); let b = arr[0], bn = 0; for (const v of arr) { const k = (m.get(v) || 0) + 1; m.set(v, k); if (k > bn) { bn = k; b = v; } } return b; }
  const hasKey = (s, i) => s.keys[i].some(Boolean);
  const plainEmpty = (s, i) => isPlain(s, i) && !s.t[i].length;
  function isPlain(s, i) { return !s.rem[i] && !s.off[i] && !s.done[i] && s.kind[i] === 0 && !s.klt[i] && !s.car[i] && !hasKey(s, i); }
  /** Bottle.NumColorCanRemove (chế độ thường): ô ngọn + các ô cùng màu, không ẩn, ngay dưới. 0 nếu không được chạm. */
  function canRemove(s, i) {
    const t = s.t[i];
    const k0 = s.kind[i];
    if (!t.length || s.rem[i] || s.off[i] || s.done[i] || (k0 !== 0 && k0 !== TAG && k0 !== SPAWN) || s.klt[i] || s.car[i]) return 0;
    const top = t[t.length - 1] >> 1;
    let k = 1;
    for (let j = t.length - 2; j >= 0; j--) { if ((t[j] >> 1) === top && !(t[j] & 1)) k++; else break; }
    return k;
  }
  /** Bottle.IsCanAddColor: không đầy, không nắp / đóng băng / hộp khoá / rèm; trống thì nhận mọi màu, không thì khớp màu ngọn. */
  function canAdd(s, i, ci) {
    const t = s.t[i];
    if (s.rem[i] || s.off[i] || s.done[i] || t.length >= s.cap[i]) return false;
    if (s.kind[i] === COVER || s.kind[i] === FROZEN || s.klt[i] || s.car[i]) return false;
    if (s.kind[i] === TAG && ci !== s.lv.ci[i]) return false;
    return !t.length || (t[t.length - 1] >> 1) === ci;
  }
  /** Bottle.IsFullSameColor: đầy, 1 màu, không còn ô ẩn. */
  function fullSame(s, i) {
    const t = s.t[i];
    if (t.length !== s.cap[i] || !t.length || (t[0] & 1) || s.kind[i] === SPAWN) return false;
    for (let j = 1; j < t.length; j++) if (t[j] !== t[0]) return false;
    return true;
  }
  function unlockBlind(s, i) {
    const t = s.t[i], n = t.length;
    if (!n || !(t[n - 1] & 1)) return;
    t[n - 1] &= ~1;
    if (n >= 2 && (t[n - 2] & 1) && (t[n - 2] >> 1) === (t[n - 1] >> 1)) t[n - 2] &= ~1;
  }
  function keyExposed(s, i, amt) {
    const keys = s.keys[i];
    if (!keys.some(Boolean)) return false;
    // chìa bay khi ô chứa nó thành ngọn sau lượt rót (FlyKeysToLockBox xét từ ô ngọn mới trở lên)
    for (let x = 0; x < amt; x++) { const idx = s.t[i].length - amt - 1 + x; if (idx >= 0 && idx < keys.length && keys[idx]) return true; }
    return false;
  }
  /** BottleKeyHolder.FlyKeysToLockBox — giữ nguyên phép tính chỉ số của code game. */
  function flyKeys(s, i, removed) {
    const keys = s.keys[i];
    if (!keys.some(Boolean)) return;
    const t = s.t[i], cap = s.cap[i];
    for (let x = 0; x < removed; x++) {
      let idx = Math.min(Math.max(t.length - 1 + x, 0), cap);
      if (idx > cap - 1) continue;
      let kl = keys[idx];
      if (!kl) {
        let same = 0;
        if (t.length) { const last = t[t.length - 1] >> 1; for (let j = t.length - 2; j >= 0; j--) { if ((t[j] >> 1) === last) same++; else break; } }
        for (let j = 1; j < same + 1; j++) { if (idx - j < 0) break; if (keys[idx - j]) { idx -= j; kl = keys[idx]; break; } }
      }
      if (kl > 0) {
        keys[idx] = 0;
        for (let b = 0; b < s.klt.length; b++) if (s.klt[b] === kl) s.klt[b] = 0;
      }
    }
  }
  /** Bottle.OnDone: lật 1 ống rèm mỗi nhóm (phần tử cuối nhóm), tan băng cả nhóm nếu ống vừa xong là băng nhóm. */
  function onDone(s, i) {
    const last = new Map();
    for (let b = 0; b < s.t.length; b++) if (s.car[b] && !s.rem[b]) last.set(s.car[b], b);
    for (const b of last.values()) s.car[b] = 0;
    if (s.kind[i] === ICE) { const g = s.lv.mci[i]; for (let b = 0; b < s.t.length; b++) if (s.kind[b] === ICE && s.lv.mci[b] === g) s.kind[b] = 0; }
  }
  /** InGameGroup.CheckBottleCompleted: ống xong khớp ô order đang mở → thu đi, ô đó lấy order kế tiếp; mỗi lần thu
   *  thì nắp cùng màu −1 và mọi ống đóng băng −1. Không có order → ống xong nằm lại trên bàn. */
  function collect(s, i) {
    s.done[i] = true;
    if (!s.lv.orders.length) return;
    for (;;) {
      let hit = null;
      for (let b = 0; b < s.t.length && !hit; b++) {
        if (!s.done[b] || s.rem[b]) continue;
        const ci = s.t[b][0] >> 1;
        const si = s.slots.indexOf(ci);
        if (si >= 0) hit = [b, si, ci];
      }
      if (!hit) return;
      const [b, si, ci] = hit;
      s.rem[b] = true; s.t[b] = []; s.served++;
      s.slots.splice(si, 1);
      for (let j = 0; j < s.t.length; j++) {
        if (s.kind[j] === COVER && s.lv.ci[j] === ci) { if (--s.ta[j] <= 0) s.kind[j] = 0; }
        else if (s.kind[j] === FROZEN) { if (--s.ta[j] <= 0) s.kind[j] = 0; }
      }
      if (s.qi < s.lv.orders.length) s.slots.splice(si, 0, s.lv.orders[s.qi++]);
    }
  }

  // ================================================================ đăng ký game
  const CDS_RULES = [
    ["Đọc level", "GameConfig.BottleData (B / C / BIM / CBIM / OBIM / OVBIM)", "loadCDS", "chính xác", "đối chiếu 1.679 file khi viết tool sinh order (08/2026)"],
    ["Được chạm ống nguồn", "Bottle.IsCannotClick (Bottle.cs:1324)", "canRemove", "chính xác", "đọc lại code 15/10/2026"],
    ["Lượng rút", "Bottle.NumColorCanRemove (Bottle.cs:1426) — ngọn + ô cùng màu không ẩn", "canRemove", "chính xác", "đọc lại code 15/10/2026"],
    ["Ống đích nhận màu", "Bottle.IsCanAddColor (Bottle.cs:1405)", "canAdd", "chính xác", "đọc lại code 15/10/2026"],
    ["Rót 1 phần", "min(NumColorCanRemove, NumColorCanAdd)", "moves", "chính xác", "replay engine B (08/2026)"],
    ["Ô ẩn (BIM.Id 2)", "Bottle.MoveBottleBack → UnlockBlind", "unlockBlind", "chính xác", "replay engine B (08/2026)"],
    ["Niêm (OBIM 6)", "Bottle.ResetAfterAddColor (Bottle.cs:1487) — vỡ khi đầy 1 màu", "apply", "chính xác", "đọc lại code 15/10/2026"],
    ["Chìa → hộp khoá (CBIM.KLT / OVBIM.KLT)", "BottleKeyHolder.FlyKeysToLockBox (BottleKeyHolder.cs:96)", "flyKeys", "chính xác (giữ phép tính chỉ số)", "đọc lại code 15/10/2026"],
    ["Rèm (OVBIM 26) + băng nhóm (OBIM 15)", "Bottle.OnDone (Bottle.cs:2398) → CheckAndRemoveCarpet / RemoveIceFreeze", "onDone", "chính xác (bỏ thời gian hoạt cảnh)", "đọc lại code 15/10/2026"],
    ["Order: 4 ô, 2 mở, thu ống khớp ô mở, ô lấy order kế", "InGameGroup.InitializeSlotOrderSystem (1913) / CheckBottleCompleted (1957)", "collect", "chính xác (ô khoá không mở)", "đọc lại code 15/10/2026"],
    ["Nắp (OBIM 4) −1 khi thu ống đúng màu · Đóng băng (OBIM 7) −1 mỗi ống thu", "InGameGroup (RemoveSlot)", "collect", "chính xác", "replay engine B (08/2026)"],
    ["Thắng", "InGameGroup.CheckWin (4237): mọi ống IsComplete && hàng chờ order rỗng", "won", "chính xác", "đọc lại code 15/10/2026"],
    ["Ống ads (hasVideo)", "mở bằng xem quảng cáo", "biến thể 1", "bỏ khỏi bản như ship", "—"],
    ["Booster (thêm ống, undo, shuffle), revive", "—", "—", "bỏ", "—"],
    ["Sức chứa: ống thường 4, ống sinh 1", "Bottle.m_MaxColor (Bottle.cs:506)", "loadCDS", "chính xác", "đọc lại code 15/10/2026"],
    ["Ống tag màu (OBIM 17): chỉ nhận màu OBIM.CI, rót ra bình thường", "Bottle.IsCanAddColor / IsTagBottle (Bottle.cs:1072)", "canAdd", "chính xác", "đọc lại code 15/10/2026"],
    ["Ống sinh nước (OBIM 18): rót cạn thì lấy màu kế trong NC; không bao giờ “xong”", "Bottle.MoveBottleBack (Bottle.cs:1809) / EvaluateFullSameColor", "apply", "chính xác", "đọc lại code 15/10/2026"],
    ["Chưa port: ống dài / khổng lồ / nước bay / ghép (multi bottle), multi floor, mini tube", "—", "báo BỎ QUA", "bỏ", "—"],
  ];
  const ENGINES = {
    cds: Object.assign({}, sortEngine, {
      id: "cds", name: "Chaos Drink Sort (CDS)", load: loadCDS, rules: CDS_RULES,
      model: "Luật Bottle.cs / InGameGroup.cs (nhánh gd/game-design-andr, đọc lại 15/10/2026). Bộ giải biết màu ô ẩn; bỏ thời gian hoạt cảnh (chỉ giữ thứ tự sự kiện); không booster / revive; ống ads khoá ở bản như ship.",
      mutations: mutateCDS,
    }),
    watersort: Object.assign({}, sortEngine, {
      id: "watersort", name: "Water sort cơ bản", load: loadStd,
      rules: [["Rót", "ngọn + ô cùng màu ngay dưới sang ống trống / cùng màu ngọn, rót 1 phần nếu thiếu chỗ", "moves", "luật chung", "—"],
        ["Ô ẩn", "lộ khi thành ngọn sau lượt rót", "unlockBlind", "luật chung", "—"],
        ["Thắng", "mọi ống trống hoặc đầy 1 màu", "won", "luật chung", "—"]],
      model: "Luật water sort chung (không cơ chế). Game có luật riêng → thêm engine mới (xem file .md).",
      mutations: (lv) => mutateStd(lv),
    }),
  };

  /** Đối chứng âm (V6) cho CDS: bản hỏng tĩnh (bớt 1 ô) và bản hỏng động (bỏ mọi ống trống). Trả data thô. */
  function mutateCDS(raw) {
    const out = [];
    const B = raw.B || [];
    const ti = B.findIndex((b) => !(b.OBIM || []).length && (b.C || []).some((c) => c && c.BIM && !(c.CBIM && c.CBIM.KLT)));
    if (ti >= 0) {
      const r = JSON.parse(JSON.stringify(raw));
      const C = r.B[ti].C;
      let k = -1;
      for (let j = C.length - 1; j >= 0; j--) if (C[j] && C[j].BIM) { k = j; break; }
      C[k] = { LP: C[k].LP };
      out.push({ name: `bớt 1 ô ở ống ${ti + 1}`, data: r, expectProof: true });
    }
    const empties = B.map((b, i) => (!(b.C || []).some((c) => c && c.BIM) ? i : -1)).filter((i) => i >= 0);
    if (empties.length) {
      const r = JSON.parse(JSON.stringify(raw));
      r.B = r.B.filter((b, i) => !empties.includes(i));
      out.push({ name: `bỏ ${empties.length} ống trống`, data: r, expectProof: false });
    }
    return out;
  }
  function mutateStd(L) {
    const out = [];
    const ci = L.containers.findIndex((c) => c.items.length);
    if (ci >= 0) {
      const r = JSON.parse(JSON.stringify(L));
      r.containers[ci].items.pop();
      out.push({ name: `bớt 1 ô ở ống ${ci + 1}`, data: r, expectProof: true });
    }
    if (L.containers.some((c) => !c.items.length)) {
      const r = JSON.parse(JSON.stringify(L));
      const k = r.containers.filter((c) => !c.items.length).length;
      r.containers = r.containers.filter((c) => c.items.length);
      out.push({ name: `bỏ ${k} ống trống`, data: r, expectProof: false });
    }
    return out;
  }

  // ================================================================ KIỂM 1 LEVEL (kết luận + hậu kiểm từng level)
  const VERDICT = { OK: "OK", WARN: "CẢNH BÁO", PROVEN: "KẸT (chắc)", STUCK: "KẸT", ERR: "LỖI", SKIP: "BỎ QUA" };

  /**
   * engineId: "cds" | "watersort" · data: JSON thô (cds) hoặc level chuẩn (watersort) · opts: tham số bộ giải +
   * {extra: true} chạy biến thể thêm tài nguyên khi bản như ship không thắng.
   */
  function checkLevel(engineId, data, fileName, opts) {
    const E = ENGINES[engineId];
    if (!E) throw new Error("Không có engine " + engineId);
    opts = Object.assign({ extra: "ads", steps: true }, opts || {});
    const t0 = now();
    const r = { name: fileName, engine: engineId, verdict: VERDICT.ERR, proof: false, note: "", findings: [], strict: null, extra: null, extraLabel: "",
      solution: null, stats: null, ms: 0 };
    let lv;
    try { lv = E.load(data, fileName); }
    catch (e) { r.note = "Không đọc được: " + e.message; r.ms = now() - t0; return r; }
    r.findings = lv.findings;
    r.stats = { tubes: lv.n, colors: lv.colors, units: lv.units, empty: lv.tubes.filter((t) => !t.length).length, blind: lv.tubes.flat().filter((v) => v & 1).length,
      orders: lv.orders.length, ads: lv.ads.filter(Boolean).length, marks: markCount(lv) };
    if (lv.unsupported.length) {
      r.verdict = VERDICT.SKIP; r.note = "Có cơ chế chưa port: " + lv.unsupported.join(", ") + " — không đoán, bỏ qua level này.";
      r.ms = now() - t0; return r;
    }
    const errors = lv.findings.filter((f) => f.level === "error"), warns = lv.findings.filter((f) => f.level === "warn");
    const pack = (s) => ({ won: s.won, exhaustive: s.exhaustive, nodes: s.nodes, restarts: s.restarts, ms: Math.round(s.ms), timedOut: s.timedOut,
      moves: s.path ? s.path.length : null, deadEnds: s.deadEnds, best: s.best && !s.won ? { kind: s.best.kind, detail: s.best.detail, board: s.best.board,
        path: s.best.path.map((m) => m.label), keys: s.best.path.map((m) => m.key), progress: s.best.progress } : null });
    const strict = solve(E, lv, 0, opts);
    r.strict = pack(strict);
    const withReplay = (s, variant) => {
      const rp = replay(E, lv, variant, s.path.map((m) => m.key));
      return { variant, keys: s.path.map((m) => m.key), moves: s.path.map((m) => m.label), replayOk: rp.ok, replayWhy: rp.why || "",
        steps: opts.steps ? rp.steps : null, start: E.board(E.start(lv, variant)) };
    };
    if (strict.won) {
      r.solution = withReplay(strict, 0);
      if (!r.solution.replayOk) { r.verdict = VERDICT.ERR; r.note = "HẬU KIỂM HỎNG — " + r.solution.replayWhy + " (lỗi port, không phải lỗi level)."; }
      else if (errors.length) { r.verdict = VERDICT.ERR; r.note = "MÂU THUẪN — soát data nói không thắng được (" + errors[0].text + ") nhưng bộ giải thắng và chạy lại khớp. Xem lại luật thắng của game."; }
      else if (warns.length) { r.verdict = VERDICT.WARN; r.proof = true; r.note = "Thắng được, nhưng: " + warns.map((w) => w.text).join(" "); }
      else { r.verdict = VERDICT.OK; r.proof = true; r.note = `Thắng trong ${strict.path.length} nước.`; }
      r.ms = now() - t0; return r;
    }
    if (errors.length) {
      r.verdict = VERDICT.PROVEN; r.proof = true; r.note = "Lỗi data: " + errors.map((e) => e.text).join(" ");
      r.ms = now() - t0; return r;
    }
    r.extraLabel = opts.extra ? E.variants(lv, opts.extra) : null;
    if (r.extraLabel) {
      const ex = solve(E, lv, 1, opts);
      r.extra = pack(ex);
      if (ex.won) {
        r.solution = withReplay(ex, 1);
        if (!r.solution.replayOk) { r.verdict = VERDICT.ERR; r.note = "HẬU KIỂM HỎNG (biến thể) — " + r.solution.replayWhy; r.ms = now() - t0; return r; }
        r.verdict = VERDICT.WARN; r.proof = strict.exhaustive;
        r.note = (strict.exhaustive ? "Như ship CHẮC CHẮN kẹt" : "Như ship chưa tìm ra đường thắng") + ` — chỉ thắng khi ${r.extraLabel} (${ex.path.length} nước).`;
        r.ms = now() - t0; return r;
      }
    }
    const b = strict.best;
    if (strict.exhaustive) { r.verdict = VERDICT.PROVEN; r.proof = true; r.note = "Đã duyệt HẾT mọi đường đi, không có đường thắng." + (b ? ` Ngõ cụt xa nhất: ${b.kind} — ${b.detail}` : ""); }
    else { r.verdict = VERDICT.STUCK; r.note = `Chưa tìm ra đường thắng trong ${strict.nodes.toLocaleString("vi-VN")} trạng thái${strict.timedOut ? " (hết giờ)" : ""} — CHƯA phải chứng minh, tăng ngân sách rồi chạy lại.` + (b ? ` Xa nhất: ${b.kind} — ${b.detail}` : ""); }
    r.ms = now() - t0;
    return r;
  }
  function markCount(lv) {
    const m = {};
    const add = (k) => { m[k] = (m[k] || 0) + 1; };
    lv.kind.forEach((k) => { if (k) add(KIND_NAME[k] || "OBIM " + k); });
    lv.klt.forEach((k) => { if (k) add("hộp khoá"); });
    lv.car.forEach((k) => { if (k) add("rèm"); });
    if (lv.keys.some((k) => k.some(Boolean))) add("chìa");
    return m;
  }

  /** Đối chứng âm (V6): bản hỏng của 1 level OK phải KHÔNG ra OK (expectProof → phải là chứng minh). */
  function controls(engineId, data, fileName, opts) {
    const E = ENGINES[engineId];
    return E.mutations(data).map((m) => {
      const r = checkLevel(engineId, m.data, fileName + " · " + m.name, Object.assign({}, opts, { extra: false, steps: false }));
      const good = r.verdict !== VERDICT.OK && r.verdict !== VERDICT.WARN && r.verdict !== VERDICT.ERR && (!m.expectProof || r.proof);
      return { name: m.name, level: fileName, expectProof: m.expectProof, verdict: r.verdict, proof: r.proof, good, note: r.note };
    });
  }

  /** Tổng hợp hậu kiểm của cả bộ: V4 replay, V5 tất định, V6 đối chứng âm, V7 đối chứng dương, V8 mâu thuẫn. */
  function summarize(results, extra) {
    extra = extra || {};
    const counts = {};
    for (const v of Object.values(VERDICT)) counts[v] = 0;
    for (const r of results) counts[r.verdict] = (counts[r.verdict] || 0) + 1;
    const solved = results.filter((r) => r.solution);
    const replayGood = solved.filter((r) => r.solution.replayOk).length;
    const contradictions = results.filter((r) => /MÂU THUẪN/.test(r.note)).length;
    const det = extra.determinism || [], ctl = extra.controls || [], pos = extra.positives || [];
    const v = {
      replay: [replayGood, solved.length], determinism: [det.filter((d) => d.same).length, det.length],
      controls: [ctl.filter((c) => c.good).length, ctl.length], positives: [pos.filter((p) => p.good).length, pos.length], contradictions,
    };
    v.passed = v.replay[0] === v.replay[1] && v.determinism[0] === v.determinism[1] && v.controls[0] === v.controls[1] && v.positives[0] === v.positives[1] && !contradictions;
    const warnings = [];
    if (!ctl.length) warnings.push("Chưa chạy đối chứng âm — chưa chắc tool bắt được level kẹt.");
    if ((counts[VERDICT.PROVEN] + counts[VERDICT.STUCK]) && !pos.length) warnings.push("Có level kẹt nhưng chưa có đối chứng dương (level chắc chắn thắng được) — chưa loại được khả năng port sai luật.");
    return { counts, verification: v, warnings };
  }

  /** Báo cáo Markdown (giống báo cáo của StuckKit C#). */
  function reportMarkdown(meta, results, sum, extra) {
    const c = sum.counts, v = sum.verification, f = (p) => `${p[0]}/${p[1]}`;
    const L = [];
    L.push(`# Check Level Stuck — ${meta.game} — ${meta.label}`, "", `Ngày chạy: ${meta.date} · ${results.length} level · engine \`${meta.engine}\` · tham số: ${meta.params}`, "");
    L.push("## 1. Tóm tắt", "", `OK **${c[VERDICT.OK]}** · CẢNH BÁO **${c[VERDICT.WARN]}** · KẸT (chắc) **${c[VERDICT.PROVEN]}** · KẸT **${c[VERDICT.STUCK]}** · LỖI **${c[VERDICT.ERR]}** · BỎ QUA **${c[VERDICT.SKIP]}**`, "");
    for (const w of sum.warnings) L.push(`> ⚠ ${w}`);
    L.push("", "## 2. Hậu kiểm", "", "| | kiểm | kết quả |", "|---|---|---|",
      `| V4 | chạy lại mọi lời giải trên ván mới | ${f(v.replay)} ${v.replay[0] === v.replay[1] ? "✓" : "✗"} |`,
      `| V5 | chạy lặp cùng tham số ra cùng kết quả | ${f(v.determinism)} ${v.determinism[0] === v.determinism[1] ? "✓" : "✗"} |`,
      `| V6 | đối chứng âm (bản hỏng phải bị bắt) | ${f(v.controls)} ${v.controls[0] === v.controls[1] ? "✓" : "✗"} |`,
      `| V7 | đối chứng dương (level chắc thắng phải ra OK) | ${f(v.positives)} ${v.positives[0] === v.positives[1] ? "✓" : "✗"} |`,
      `| V8 | soát data ↔ bộ giải không mâu thuẫn | ${v.contradictions ? v.contradictions + " mâu thuẫn ✗" : "✓"} |`, "",
      `**${v.passed ? "Hậu kiểm ĐẠT" : "Hậu kiểm CHƯA ĐẠT — sửa port trước khi tin kết luận"}.** V1 (đọc file đúng như game), V2 (luật từng cơ chế), V3 (code game có đổi từ ngày port) là phần kiểm tay — xem mục 5.`, "");
    if ((extra.controls || []).length) {
      L.push("| Đối chứng | Cần | Ra | |", "|---|---|---|---|");
      for (const x of extra.controls) L.push(`| ${x.level} · ${x.name} | ${x.expectProof ? "KẸT (chắc)" : "không OK"} | ${x.verdict} | ${x.good ? "✓" : "✗"} |`);
      L.push("");
    }
    const bad = results.filter((r) => r.verdict !== VERDICT.OK);
    L.push("## 3. Level cần xem", "");
    if (!bad.length) L.push("Không có — mọi level OK.", "");
    for (const r of bad) {
      L.push(`### ${r.name} — ${r.verdict}`, "", r.note, "");
      for (const x of r.findings.filter((x) => x.level !== "note")) L.push(`- ${x.level === "error" ? "Lỗi data" : "Cảnh báo"}: ${x.text}`);
      const b = r.strict && r.strict.best;
      if (b) L.push("", `Ngõ cụt xa nhất (${Math.round(b.progress * 100)}% tiến độ, ${b.path.length} nước): **${b.kind}** — ${b.detail}`, "", "```", b.board, "```");
      L.push("");
    }
    L.push("## 4. Kết quả từng level", "", "| Level | Kết luận | Số nước | Trạng thái đã duyệt | Duyệt hết | Thời gian | Ghi chú |", "|---|---|---|---|---|---|---|");
    for (const r of results) {
      const s = r.strict || {};
      L.push(`| ${r.name} | ${r.verdict} | ${r.solution ? r.solution.moves.length + (r.solution.variant ? " (+" + r.extraLabel + ")" : "") : "—"} | ${s.nodes != null ? s.nodes : "—"} | ${s.exhaustive ? "có" : "—"} | ${(r.ms / 1000).toFixed(2)} s | ${String(r.note).replace(/\|/g, "/").slice(0, 160)} |`);
    }
    L.push("", "## 5. Mô hình và đối chiếu code game", "", meta.model, "", "| Luật | Nguồn trong code game | Port | Mức | Đã kiểm bằng |", "|---|---|---|---|---|");
    for (const row of meta.rules) L.push("| " + row.join(" | ") + " |");
    L.push("", "## 6. Cách đọc", "", "- **OK**: thắng được như lúc ship, lời giải đã chạy lại khớp (là bằng chứng).",
      "- **CẢNH BÁO**: thắng được nhưng phải nhờ ống ads / booster, hoặc data sai quy ước (vd thiếu / thừa order).",
      "- **KẸT (chắc)**: lỗi data chứng minh được, hoặc đã duyệt hết mọi đường đi.",
      "- **KẸT**: hết ngân sách mà chưa thắng — CHƯA phải chứng minh, tăng số trạng thái / thời gian rồi chạy lại.",
      "- **LỖI**: không đọc được file, lời giải chạy lại không khớp (lỗi port) hoặc mâu thuẫn.",
      "- **BỎ QUA**: level có cơ chế chưa port — tool không đoán.",
      "- Bộ giải chơi tối ưu và biết ô ẩn: **OK = giải được, KHÔNG có nghĩa là dễ**.", "");
    L.push("## 7. Lời giải", "");
    for (const r of results.filter((x) => x.solution)) L.push(`- **${r.name}** (${r.solution.moves.length} nước${r.solution.variant ? ", " + r.extraLabel : ""}): ${r.solution.moves.slice(0, 12).map((m) => m.replace(/^Ống /, "")).join(" · ")}${r.solution.moves.length > 12 ? " …" : ""}`);
    return L.join("\n");
  }

  // ================================================================ bộ level mẫu (định dạng CDS) — cho nút "Thử với level mẫu" + test
  /** spec: {tubes: ["0 1 0 1", "?2 1", ""…] (dưới → trên, "?" = ẩn, "k3" = chìa KLT 3 trên ô đó), orders, marks: {i: {...}}} */
  function cdsLevel(name, spec) {
    const B = spec.tubes.map((str, i) => {
      const cells = String(str).split(/\s+/).filter(Boolean).map((tok, k) => {
        const m = /^(\?)?(\d+)(?:k(\d+))?$/.exec(tok);
        const c = { LP: { x: 0, y: k, z: 0 }, BIM: { Id: m[1] ? 2 : 1, CI: +m[2], V: true } };
        if (m[3]) c.CBIM = { Id: 22, KLT: +m[3] };
        return c;
      });
      while (cells.length < 4) cells.push({ LP: { x: 0, y: cells.length, z: 0 } });
      return Object.assign({ Id: 0, P: { x: i % 5, y: 12 - Math.floor(i / 5) * 4, z: 0 }, C: cells, hasVideo: false, isLongBottle: false, isBigBottle: false,
        isFlyWaterBottle: false, propIndex: 0, bigBottleShapeId: 0, OBIM: [] }, (spec.marks || {})[i] || {});
    });
    const j = { UCCC: 0, CC: 0, LId: name, B };
    if (spec.orders) j.lstOrderCI = spec.orders;
    return { name: name + ".txt", json: j };
  }
  const SAMPLE = [
    ["level_1", { tubes: ["0 1 2 0", "1 2 0 1", "2 0 1 2", "", ""], orders: [0, 1, 2] }],
    ["level_2", { tubes: ["3 ?0 1 0", "1 3 0 3", "0k1 1 3 1", "2 2 2", "", "2"], orders: [3, 1, 0, 2],
      marks: { 3: { OVBIM: { KLT: 1 } } } }],
    ["level_3", { tubes: ["4 5 4 5", "0 4 5 0", "5 0 4 0", "", ""], orders: [0, 4, 5],
      marks: { 0: { OBIM: [{ Id: 4, Obj: { Id: 0, TA: 1, CI: 0 }, CI: 0 }] } } }],
    ["level_4", { tubes: ["0 1 0 1", "1 0 1 0", "0", "", ""], orders: [0, 1] }],
    ["level_5", { tubes: ["0 0 1 2", "0 2 2 1", "3 2 3 1", "0 3 1 3", ""], orders: [0, 1, 2, 3] }],
    ["level_6", { tubes: ["0 0 1 2", "0 2 2 1", "3 2 3 1", "0 3 1 3", "", ""], orders: [0, 1, 2, 3], marks: { 5: { hasVideo: true } } }],
    ["level_7", { tubes: ["0 1 2 0", "1 2 0 1", "2 0 1 2", "", ""], orders: [0] }],
    ["level_8", { tubes: ["0 1 0 1", "1 0 1 0", "", ""], orders: [0, 1], marks: { 2: { isBigBottle: true } } }],
  ];
  const sampleSet = () => SAMPLE.map(([n, spec]) => cdsLevel(n, spec));

  return { rng, luby, solve, replay, runPass, ENGINES, VERDICT, loadCDS, loadStd, checkLevel, controls, summarize, reportMarkdown, cdsLevel, sampleSet };
});

/* Level Preview — đọc 1 thư mục level của bất kỳ game nào: chia bộ (mỗi thư mục con 1 bộ), tự nhận game cho từng
   bộ, đọc file phụ (tag độ khó levelConfigModels, danh sách thứ tự level .txt, asset Unity + .meta), ghép nhiều bộ
   theo thứ tự ưu tiên (giống chuỗi pack v22 > v18 > … của game), gắn tag, soát lỗi. Không đụng giao diện —
   chạy được cả Node để test với thư mục thật.
   items = [{file: {size, text()}, path: "thư/mục/level_1.txt"}] (File của trình duyệt hoặc giả lập). */
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const lib = factory(node ? require("./levelkit.js") : root.GDK.lib.levelkit, node ? require("./level-adapters.js") : root.GDK.lib.leveladapters);
  if (node) module.exports = lib;
  else root.GDK.lib.levelset = lib;
})(typeof self !== "undefined" ? self : this, function (LK, LA) {
  "use strict";
  const LEVEL_EXT = /\.(txt|json)$/i, IMG_EXT = /\.(png|jpe?g|webp)$/i;
  const SPECIAL = /daily|challenge|loop|test|dynamic|bloom|event|tutorial|remove|giant|backup|old|tmp|temp/i;
  /** Số phiên bản trong tên bộ (NewLevel_v22 → 22, không có → 0) — để ghép chuỗi bản mới ưu tiên trước. */
  const packVersion = (label) => { const m = /v(\d+)(?!.*v\d)/i.exec(String(label).split("/").pop()); return m ? +m[1] : 0; };

  /** Gom file theo thư mục (= bộ level), đọc file phụ (tag độ khó, danh sách thứ tự), nhận game cho từng bộ. */
  async function scan(items, label, progress) {
    progress = progress || (() => {});
    const src = { label, packs: [], tagFiles: [], orderFiles: [], tagSel: "", orderSel: "name", adapterId: "", fileCount: items.length,
      entries: new Map(), errors: [], skipped: [], nonLevel: [], files: new Map() };
    const byDir = new Map();
    const metas = [], assets = [];
    for (const it of items) {
      const path = it.path.replace(/\\/g, "/");
      const name = path.split("/").pop();
      if (/\.meta$/i.test(name)) { metas.push({ file: it.file, path }); continue; }
      if (/\.asset$/i.test(name)) { if (it.file.size < 4e6) assets.push({ file: it.file, path }); continue; }
      if (!LEVEL_EXT.test(name) && !IMG_EXT.test(name)) continue;
      const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      if (!byDir.has(dir)) byDir.set(dir, []);
      const rec = { file: it.file, path, name, dir };
      byDir.get(dir).push(rec);
      src.files.set(name.replace(/\.[^.]+$/, "").toLowerCase(), rec);
    }
    // đọc toàn bộ file chữ (level + file phụ) — file nhỏ nên đọc song song theo lô
    const texts = [...byDir.values()].flat().filter((r) => LEVEL_EXT.test(r.name));
    let done = 0;
    for (let i = 0; i < texts.length; i += 64) {
      await Promise.all(texts.slice(i, i + 64).map(async (r) => {
        if (r.file.size > 8e6) { r.err = "file quá lớn (> 8 MB)"; return; }
        r.text = await r.file.text();
        try { r.json = LK.parseJSON(r.text); } catch (e) { r.json = undefined; }
      }));
      done = Math.min(texts.length, i + 64);
      progress(done, texts.length, "Đang đọc file");
    }
    const known = new Set(src.files.keys());
    for (const [dir, recs] of byDir) {
      const pack = { dir, label: dir ? dir.split("/").slice(-2).join("/") : label, recs: [], levels: 0, images: 0, on: false, adapterId: "" };
      for (const r of recs) {
        if (IMG_EXT.test(r.name)) { pack.recs.push(r); pack.images++; continue; }
        if (r.json !== undefined) {
          const tags = LA.readTagFile(r.json);
          if (tags) { src.tagFiles.push({ name: r.path, data: tags }); continue; }
          pack.recs.push(r); pack.levels++;
        } else if (r.text != null) {
          const list = LA.readOrderList(r.text, known);
          if (list) src.orderFiles.push({ name: r.path, kind: "list", names: list, count: list.length });
          else src.nonLevel.push(r.path);                   // ghi chú / CSV… trong thư mục level → bỏ qua
        }
      }
      if (pack.levels || pack.images) src.packs.push(pack);
    }
    // asset Unity chứa danh sách level (guid) — cần file .meta để biết guid ↔ file
    if (assets.length && metas.length) {
      const cands = assets.filter((a) => /level|list|config/i.test(a.path));
      const guidTo = new Map();
      const metaFor = metas.filter((m) => LEVEL_EXT.test(m.path.replace(/\.meta$/i, "")));
      for (let i = 0; i < metaFor.length; i += 128) {
        await Promise.all(metaFor.slice(i, i + 128).map(async (m) => {
          const g = LA.metaGuid(await m.file.text());
          if (g) guidTo.set(g, m.path.replace(/\.meta$/i, "").split("/").pop().replace(/\.[^.]+$/, ""));
        }));
        progress(Math.min(metaFor.length, i + 128), metaFor.length, "Đang đọc .meta");
      }
      for (const a of cands) {
        const list = LA.readUnityList(await a.file.text(), guidTo);
        if (list) src.orderFiles.push({ name: a.path, kind: "unity", names: list, count: list.length });
      }
    }
    // nhận game cho từng bộ (đa số phiếu trên ≤ 12 file đầu)
    for (const p of src.packs) {
      if (!p.levels) continue;
      const votes = new Map();
      for (const r of p.recs.filter((x) => x.json !== undefined).slice(0, 12)) {
        const d = LK.detect(r.json, r.name);
        if (d.adapter) votes.set(d.adapter.id, (votes.get(d.adapter.id) || 0) + d.score);
      }
      p.adapterId = [...votes.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0])[0] || "";
    }
    src.packs.sort((a, b) => a.label.localeCompare(b.label, "vi", { numeric: true }));
    // bộ mặc định = "bộ chính": đã nhận ra game, không phải bộ chế độ phụ (daily / challenge / loop / test…),
    // bắt đầu từ level 1, nhiều số level khác nhau nhất; hoà thì lấy tên ngắn / đứng trước (NewLevel trước NewLevel_v3)
    for (const p of src.packs) {
      const ns = p.recs.map((r) => (LK.numberFromName(r.name) || {}).n).filter((n) => n != null);
      p.minN = ns.length ? Math.min(...ns) : Infinity;
      p.uniq = new Set(ns).size;
      p.special = SPECIAL.test(p.label.split("/").pop());
    }
    const withLv = src.packs.filter((p) => p.levels && p.adapterId && p.adapterId !== "auto");
    const rank = (p) => (p.special ? 2 : 0) + (p.minN <= 1 ? 0 : 1);
    const pick = (withLv.length ? withLv : src.packs).slice().sort((a, b) => rank(a) - rank(b) || b.uniq - a.uniq
      || a.label.length - b.label.length || a.label.localeCompare(b.label, "vi", { numeric: true }))[0];
    if (pick) pick.on = true;
    src.imagesOnly = src.packs.every((p) => !p.levels);
    // file tag: ưu tiên file trùng phiên bản với bộ đang chọn (vd LevelConfig_v27 ↔ NewLevel_v27); chỉ 1 file thì dùng luôn
    if (src.tagFiles.length === 1) src.tagSel = "0";
    else if (pick) {
      const v = /v(\d+)/i.exec(pick.label);
      const i = v ? src.tagFiles.findIndex((t) => new RegExp("v" + v[1] + "(?!\\d)", "i").test(t.name.split("/").pop())) : -1;
      if (i >= 0) src.tagSel = String(i);
    }
    return src;
  }

  const adapterOf = (src) => LK.adapters.find((a) => a.id === (src.adapterId || (src.packs.find((p) => p.on && p.adapterId) || src.packs.find((p) => p.adapterId) || {}).adapterId));

  /** Dựng danh sách level: theo bộ được tick (bộ trên ưu tiên) hoặc theo file thứ tự; gắn tag; soát lỗi. */
  function buildEntries(src) {
    src.entries = new Map(); src.errors = []; src.skipped = (src.nonLevel || []).slice();
    const forced = src.adapterId ? LK.adapters.find((a) => a.id === src.adapterId) : null;
    const parseRec = (r, pack) => {
      if (r.parsed && r.parsedWith === (forced ? forced.id : pack.adapterId)) return r.parsed;
      r.parsed = null;
      if (r.err) { src.errors.push({ path: r.path, msg: r.err }); return null; }
      if (r.json === undefined) { src.errors.push({ path: r.path, msg: "không phải JSON" }); return null; }
      const ad = forced || LK.adapters.find((a) => a.id === pack.adapterId) || LK.detect(r.json, r.name).adapter;
      // file JSON lạ nằm trong thư mục ảnh / thư mục không nhận ra game → bỏ qua, không tính là lỗi
      if (!ad || (!forced && !pack.adapterId && pack.images)) { src.skipped.push(r.path); return null; }
      try {
        r.parsed = ad.parse(r.json, r.name).map((lv) => ({ lv, adapter: ad.id }));
        r.parsedWith = forced ? forced.id : pack.adapterId;
      } catch (e) { src.errors.push({ path: r.path, msg: e.message }); }
      return r.parsed;
    };
    const put = (n, entry) => {
      const old = src.entries.get(n);
      if (!old) return src.entries.set(n, entry);
      // trùng số trong cùng bộ: ưu tiên bản không phải biến thể (level_24 hơn level_24_1), rồi bản _vK lớn nhất
      if (old.pack === entry.pack) {
        const ma = LK.numberFromName(old.file) || {}, mb = LK.numberFromName(entry.file) || {};
        if ((ma.variant != null && mb.variant == null) || (ma.variant == null) === (mb.variant == null) && (mb.v || 0) > (ma.v || 0)) src.entries.set(n, entry);
      }
    };
    if (src.orderSel !== "name" && src.orderFiles[+src.orderSel]) {
      const list = src.orderFiles[+src.orderSel];
      list.names.forEach((nm, i) => {
        const r = src.files.get(nm.toLowerCase());
        if (!r) { src.errors.push({ path: nm, msg: `dòng ${i + 1} của ${list.name}: không có file này` }); return; }
        const pack = src.packs.find((p) => p.recs.includes(r)) || { adapterId: "" };
        const res = parseRec(r, pack);
        if (res && res[0]) src.entries.set(i + 1, mk(i + 1, res[0], r, pack));
      });
    } else {
      for (const pack of src.packs.filter((p) => p.on)) {
        for (const r of pack.recs) {
          if (IMG_EXT.test(r.name)) {
            const m = LK.numberFromName(r.name);
            if (m) put(m.n, { n: m.n, image: r.file, file: r.name, path: r.path, pack: pack.label, issues: [], worst: "ok" });
            continue;
          }
          const res = parseRec(r, pack);
          if (!res) continue;
          for (const x of res) if (x.lv.level != null && isFinite(x.lv.level)) put(+x.lv.level, mk(+x.lv.level, x, r, pack));
        }
      }
    }
    const tf = src.tagSel !== "" ? src.tagFiles[+src.tagSel] : null;
    for (const e of src.entries.values()) {
      if (!e.lv) continue;
      if (tf) {
        const t = tf.data.byName.get(String(e.lv.name)) || tf.data.byName.get(e.file.replace(/\.[^.]+$/, "")) || tf.data.byNumber.get(e.n);
        e.lv.tags = [...new Set((e.lv.tags || []).filter((x) => !/^(super hard|hard|tutorial)$/i.test(x)).concat(t || []))];
      }
      e.lv.level = e.n;
      e.issues = LK.lint(e.lv);
      e.worst = LK.worst(e.issues);
      e.stats = LK.stats(e.lv);
    }
  }
  const mk = (n, x, r, pack) => ({ n, lv: Object.assign({}, x.lv, { tags: (x.lv.tags || []).slice() }), adapter: x.adapter, file: r.name, path: r.path, pack: pack.label });


  /** Ghép bộ A (và B nếu có) theo số level → [{n, a, b, diff}]. */
  function merge(A, B) {
    const nums = new Set([...A.entries.keys(), ...(B ? B.entries.keys() : [])]);
    return [...nums].sort((x, y) => x - y).map((n) => {
      const a = A.entries.get(n) || null, b = B ? B.entries.get(n) || null : null;
      return { n, a, b, diff: B ? LK.diff(a && (a.lv || { image: 1 }), b && (b.lv || { image: 1 })) : null };
    });
  }

  return { scan, buildEntries, adapterOf, merge, packVersion, LEVEL_EXT, IMG_EXT };
});

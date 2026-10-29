/* Level Preview — xem cả bộ level thành ảnh sơ đồ, soát lỗi, so 2 bộ, xuất PNG / ảnh ghép / gallery.
   Logic dùng chung ở web/lib: levelkit.js (level chuẩn, bố cục, soát lỗi, so sánh, đọc theo cấu hình),
   level-adapters.js (đọc file từng game), levelrender.js (vẽ SVG). File level không rời khỏi máy. */
(() => {
  "use strict";
  const { $, $$, esc, icon, toast, store } = GDK;
  const K = GDK.kit, LK = GDK.lib.levelkit, LS = GDK.lib.levelset, LR = GDK.lib.levelrender, Z = GDK.lib.zip;
  const { scan, buildEntries, adapterOf } = LS;
  const { LEVEL_EXT, IMG_EXT } = GDK.lib.levelset;
  const SIZES = { s: 110, m: 150, l: 220 };
  const ASPECT = 1170 / 540;
  const MARK_NAMES = { ice: "đóng băng", cover: "nắp", seal: "niêm", ads: "ống ads", spawn: "ống sinh", lock: "khoá", hidden: "ẩn cả vật chứa",
    help: "cần cứu", tray: "khay gỗ", curtain: "rèm", lockbox: "hộp khoá", vortex: "lốc xoáy", conveyor: "băng chuyền", badge: "khác" };
  const STATUS = { same: ["Giống hệt", "ok"], layout: ["Chỉ đổi vị trí", "m"], changed: ["Khác", "warn"], onlyA: ["Chỉ có ở A", "bad"], onlyB: ["Chỉ có ở B", "bad"], image: ["Ảnh", "l"] };
  const session = (GDK.session = GDK.session || {});

  GDK.tools["level-preview"] = { mount };

  function mount(root) {
    const keep = session["level-preview"] || {};
    const S = {
      src: { A: keep.A || null, B: keep.B || null },
      view: Object.assign({ range: "", filter: "all", mech: "", size: "m", ids: false, theme: "dark", page: 1 }, store.get("gdk.lp.view", {})),
      rows: [], shown: [], games: [], urls: new Map(), io: null, busy: false,
    };
    S.view.page = 1; S.view.filter = "all"; S.view.mech = "";
    root.innerHTML = `
      <section class="panel">
        <div class="ph"><span class="step">1</span><h2>Nạp bộ level</h2><span class="sub">file không rời khỏi máy · tool tự nhận game</span>
          <div class="right"><button class="btn sm ghost" id="lpCmpBtn">${icon("split")} So sánh với bộ khác</button></div></div>
        <div class="pb"><div class="lp-srcs"><div id="srcA"></div><div id="srcB" hidden></div></div></div>
      </section>
      <section class="panel" id="lpGal" hidden>
        <div class="ph"><span class="step">2</span><h2>Xem level</h2><span class="sub" id="lpCount"></span>
          <div class="right"><button class="btn sm" id="lpStats"></button></div></div>
        <div class="pb">
          <div id="lpSum"></div>
          <div class="toolbar lp-tools">
            <input type="search" id="lpRange" placeholder="Level: vd 1-30, 45" value="${esc(S.view.range)}" title="Lọc theo số level: 1-30, 45, 100-">
            <div class="lp-chips" id="lpChips"></div>
            <select id="lpMech" title="Lọc theo cơ chế"></select>
            <span class="grow"></span>
            <label class="lp-tog" title="Hiện mã màu trên từng vật phẩm — dễ đối chiếu với file"><input type="checkbox" id="lpIds" ${S.view.ids ? "checked" : ""}> Mã màu</label>
            <div class="seg" id="lpTheme">${[["dark", "Nền tối"], ["light", "Nền sáng"]].map(([k, l]) => `<button data-k="${k}" class="${S.view.theme === k ? "on" : ""}">${l}</button>`).join("")}</div>
            <div class="seg" id="lpSize" title="Cỡ ảnh">${["s", "m", "l"].map((k) => `<button data-k="${k}" class="${S.view.size === k ? "on" : ""}">${k.toUpperCase()}</button>`).join("")}</div>
          </div>
          <div class="lp-grid" id="lpGrid"></div>
          <div id="lpMore"></div>
        </div>
      </section>
      <section class="panel" id="lpExp" hidden>
        <div class="ph"><span class="step">3</span><h2>Xuất</h2><span class="sub" id="lpExpSub"></span></div>
        <div class="pb">
          <div class="lp-exp">
            <div class="lp-ex"><b>${icon("image")} Ảnh PNG từng level</b><small>1 file .zip, đặt tên level_024.png…</small>
              <div class="row"><select id="lpPx"><option value="1">540 × 1170</option><option value="2" selected>1080 × 2340</option></select><button class="btn sm primary" id="lpZip">${icon("download")} Tải .zip</button></div></div>
            <div class="lp-ex"><b>${icon("layers")} Ảnh ghép 6 × 5</b><small>30 level / ảnh — gửi review nhanh qua Slack</small>
              <div class="row"><button class="btn sm" id="lpSheet">${icon("download")} Tải ảnh ghép</button></div></div>
            <div class="lp-ex"><b>${icon("doc")} Gallery .html</b><small>1 file mở bằng trình duyệt, không cần tool — có thể đặt mật khẩu</small>
              <div class="row"><button class="btn sm" id="lpHtml">${icon("download")} Tải</button><button class="btn sm ghost" id="lpHtmlPw">${icon("lock")} Có mật khẩu</button></div></div>
            <div class="lp-ex"><b>${icon("braces")} Level chuẩn (.json)</b><small>đổi mọi game về 1 định dạng chung — dùng cho tool khác / game mới</small>
              <div class="row"><button class="btn sm" id="lpJson">${icon("download")} Tải .json</button></div></div>
          </div>
          <div id="lpProg"></div>
        </div>
      </section>
      <section class="panel">
        <div class="ph"><span class="ibox sm">${icon("settings")}</span><h2>Game mới? Cấu hình đọc file</h2><span class="sub">không cần code · lưu lại cho cả team</span>
          <div class="right"><button class="btn sm ghost" id="lpMapTog">${icon("chevron-down")} Mở</button></div></div>
        <div class="pb" id="lpMap" hidden></div>
      </section>`;
    const el = (s) => $(s, root);

    // ------------------------------------------------------------------ nguồn level (A, B)
    function drawSource(slot) {
      const box = el("#src" + slot);
      const src = S.src[slot];
      if (slot === "B") box.hidden = !S.src.B && !S.cmpOpen;
      el("#lpCmpBtn").hidden = !!S.src.B || !!S.cmpOpen;
      if (!src) {
        box.innerHTML = `${slot === "B" ? `<div class="lp-slot">Bộ B — để so sánh <button class="btn sm ghost" data-act="closeB">${icon("x")}</button></div>` : ""}
          <label class="dz lp-dz" tabindex="0">
            <input type="file" multiple hidden data-kind="files" accept=".txt,.json,.png,.jpg,.jpeg,.webp,.asset">
            <span class="dz-ic">${icon("folder")}</span>
            <span class="dz-t">${slot === "A" ? "Kéo thả thư mục level vào đây" : "Kéo thả thư mục level thứ 2 (hoặc thư mục ảnh chụp thật)"}</span>
            <span class="dz-s">hoặc <u>chọn file</u> · .txt .json (+ ảnh .png) · nhiều thư mục con = nhiều bộ level</span>
          </label>
          <input type="file" webkitdirectory hidden data-kind="dir">
          <div class="dz-alt"><button class="btn sm" data-act="dir">${icon("folder")} Chọn thư mục</button>
            ${slot === "A" ? `<button class="btn sm ghost" data-act="sample">${icon("flask")} Thử với level mẫu</button>` : ""}</div>`;
        const dz = box.querySelector(".dz"), fin = box.querySelector('[data-kind="files"]'), din = box.querySelector('[data-kind="dir"]');
        fin.onchange = () => fin.files.length && load(slot, [...fin.files].map((f) => ({ file: f, path: f.name })), fin.files.length === 1 ? fin.files[0].name : "Nhiều file");
        din.onchange = () => din.files.length && load(slot, [...din.files].map((f) => ({ file: f, path: f.webkitRelativePath || f.name })), (din.files[0].webkitRelativePath || "").split("/")[0] || "Thư mục");
        box.querySelector('[data-act="dir"]').onclick = () => din.click();
        dz.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fin.click(); } };
        dz.ondragover = (e) => { e.preventDefault(); dz.classList.add("over"); };
        dz.ondragleave = () => dz.classList.remove("over");
        dz.ondrop = async (e) => {
          e.preventDefault(); dz.classList.remove("over");
          try {
            const { items, label } = await fromDrop(e.dataTransfer);
            if (!items.length) return toast("Không thấy file nào.", "bad");
            load(slot, items, label);
          } catch (err) { toast(err.message, "bad"); }
        };
        const sb = box.querySelector('[data-act="sample"]');
        if (sb) sb.onclick = () => sample();
        const cb = box.querySelector('[data-act="closeB"]');
        if (cb) cb.onclick = () => { S.cmpOpen = false; drawSource("B"); };
        return;
      }
      const ad = adapterOf(src);
      const packs = src.packs.filter((p) => p.levels || p.images);
      const opts = LK.adapters.map((a) => `<option value="${esc(a.id)}" ${src.adapterId === a.id ? "selected" : ""}>${esc(a.name)}</option>`).join("");
      const errs = src.errors || [];
      box.innerHTML = `
        ${slot === "B" || S.src.B ? `<div class="lp-slot">${slot === "A" ? "Bộ A (gốc)" : "Bộ B (so với A)"}</div>` : ""}
        <div class="file-chip">
          <span class="ibox sm">${icon(src.imagesOnly ? "image" : "folder")}</span>
          <div class="fc-main"><b>${esc(src.label)}</b><span>${K.fmt.int(src.entries.size)} level${src.imagesOnly ? " (ảnh chụp)" : ""} · ${packs.length} bộ · ${K.fmt.int(src.fileCount)} file${src.ms ? " · đọc trong " + (src.ms / 1000).toFixed(1).replace(".", ",") + " giây" : ""}</span></div>
          <button class="btn sm" data-act="change">${icon("refresh")} Đổi</button>
        </div>
        ${src.imagesOnly ? "" : `<div class="lp-opts">
          <label class="lb">Đọc theo game</label>
          <div class="row" style="gap:8px;align-items:center"><select data-act="adapter"><option value="">Tự nhận${ad ? " — " + esc(ad.name) : ""}</option>${opts}</select>
            ${ad && ad.note ? `<span class="hint lp-note" title="${esc(ad.note)}">${icon("info")} ${esc(ad.note.length > 120 ? ad.note.slice(0, 118) + "…" : ad.note)}</span>` : ""}</div>
        </div>`}
        ${packs.length > 1 && src.orderSel === "name" ? `<div class="lp-opts"><label class="lb">Bộ level (thư mục) — tick nhiều bộ = ghép theo thứ tự: level trùng số lấy ở bộ trên</label>
          <div class="row lp-packbar"><button class="btn sm ghost" data-act="byver" title="Đưa các bộ đang tick lên đầu, bản mới nhất (v số lớn nhất) ưu tiên trước — giống chuỗi pack của game">${icon("layers")} Sắp theo phiên bản (mới trước)</button>
            <button class="btn sm ghost" data-act="none">${icon("x")} Bỏ chọn hết</button><span class="hint">${packs.filter((p) => p.on).length} bộ đang chọn</span></div>
          <div class="lp-packs">${packs.map((p, i) => `<div class="lp-pack ${p.on ? "on" : ""}">
            <label><input type="checkbox" data-pack="${i}" ${p.on ? "checked" : ""}><b>${esc(p.label)}</b></label>
            <span class="hint">${p.images ? K.fmt.int(p.images) + " ảnh" : K.fmt.int(p.levels) + " file"}${p.adapterId ? " · " + esc((LK.adapters.find((a) => a.id === p.adapterId) || {}).game || "") : ""}</span>
            <span class="grow"></span>
            <button class="icon-btn sm" data-up="${i}" title="Ưu tiên lên" ${i === 0 ? "disabled" : ""}>▲</button><button class="icon-btn sm" data-down="${i}" title="Ưu tiên xuống" ${i === packs.length - 1 ? "disabled" : ""}>▼</button>
          </div>`).join("")}</div></div>` : ""}
        ${(src.orderFiles || []).length ? `<div class="lp-opts"><label class="lb">Thứ tự level</label><select data-act="order">
            <option value="name" ${src.orderSel === "name" ? "selected" : ""}>Theo số trong tên file</option>
            ${src.orderFiles.map((o, i) => `<option value="${i}" ${String(src.orderSel) === String(i) ? "selected" : ""}>Theo ${esc(o.name)} (${o.kind === "unity" ? "asset Unity" : K.fmt.int(o.count) + " dòng"})</option>`).join("")}</select></div>` : ""}
        ${(src.tagFiles || []).length ? `<div class="lp-opts"><label class="lb">Tag độ khó (Hard / Super Hard)</label><select data-act="tags">
            <option value="">Không dùng file tag</option>
            ${src.tagFiles.map((t, i) => `<option value="${i}" ${String(src.tagSel) === String(i) ? "selected" : ""}>${esc(t.name)} (${K.fmt.int(t.data.count)} level)</option>`).join("")}</select></div>` : ""}
        ${(src.skipped || []).length ? `<p class="hint">${icon("info")} Bỏ qua ${src.skipped.length} file không phải level (vd ${esc(src.skipped[0].split("/").pop())}).</p>` : ""}
        ${errs.length ? `<details class="lp-errs"><summary>${icon("alert")} ${errs.length} file không đọc được</summary><ul>${errs.slice(0, 40).map((x) => `<li><code>${esc(x.path)}</code> — ${esc(x.msg)}</li>`).join("")}</ul></details>` : ""}`;
      box.querySelector('[data-act="change"]').onclick = () => { S.src[slot] = null; saveSession(); drawSource(slot); rebuild(); };
      const sel = box.querySelector('[data-act="adapter"]');
      if (sel) sel.onchange = async () => { src.adapterId = sel.value; await refreshSource(slot); };
      box.querySelectorAll("[data-pack]").forEach((c) => c.onchange = async () => { packs[+c.dataset.pack].on = c.checked; await refreshSource(slot); });
      const move = async (i, d) => {
        const p = packs[i], j = src.packs.indexOf(p), k = src.packs.indexOf(packs[i + d]);
        [src.packs[j], src.packs[k]] = [src.packs[k], src.packs[j]];
        await refreshSource(slot);
      };
      const byver = box.querySelector('[data-act="byver"]');
      if (byver) byver.onclick = async () => {
        src.packs.sort((a, b) => (b.on - a.on) || (b.on && a.on ? LS.packVersion(b.label) - LS.packVersion(a.label) : 0) || a.label.localeCompare(b.label, "vi", { numeric: true }));
        await refreshSource(slot);
      };
      const none = box.querySelector('[data-act="none"]');
      if (none) none.onclick = async () => { src.packs.forEach((p) => { p.on = false; }); await refreshSource(slot); };
      box.querySelectorAll("[data-up]").forEach((b) => b.onclick = () => move(+b.dataset.up, -1));
      box.querySelectorAll("[data-down]").forEach((b) => b.onclick = () => move(+b.dataset.down, 1));
      const ord = box.querySelector('[data-act="order"]');
      if (ord) ord.onchange = async () => { src.orderSel = ord.value; await refreshSource(slot); };
      const tg = box.querySelector('[data-act="tags"]');
      if (tg) tg.onchange = async () => { src.tagSel = tg.value; await refreshSource(slot); };
    }
    el("#lpCmpBtn").onclick = () => { S.cmpOpen = true; drawSource("B"); };

    /** Kéo thả: đọc cả thư mục con (webkitGetAsEntry). */
    async function fromDrop(dt) {
      const entries = [...(dt.items || [])].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
      if (!entries.length) return { items: [...dt.files].map((f) => ({ file: f, path: f.name })), label: dt.files.length === 1 ? dt.files[0].name : "Nhiều file" };
      const items = [];
      const walk = async (entry, prefix) => {
        if (items.length > 60000) return;
        if (entry.isFile) {
          if (!LEVEL_EXT.test(entry.name) && !IMG_EXT.test(entry.name) && !/\.(asset|meta)$/i.test(entry.name)) return;
          const file = await new Promise((ok, fail) => entry.file(ok, fail));
          items.push({ file, path: prefix + entry.name });
        } else if (entry.isDirectory) {
          if (/^(Library|Temp|Logs|obj|node_modules|\.git)$/i.test(entry.name)) return;
          const reader = entry.createReader();
          for (;;) {
            const batch = await new Promise((ok, fail) => reader.readEntries(ok, fail));
            if (!batch.length) break;
            for (const e of batch) await walk(e, prefix + entry.name + "/");
          }
        }
      };
      for (const e of entries) await walk(e, "");
      const label = entries.length === 1 ? entries[0].name : entries.length + " mục";
      return { items, label };
    }

    // ------------------------------------------------------------------ đọc + phân bộ
    async function load(slot, items, label) {
      if (S.busy) return toast("Đang đọc bộ khác — chờ xong đã.", "bad");
      S.busy = true;
      const box = el("#src" + slot);
      box.innerHTML = `<div class="dz busy"><div class="row" style="align-items:center;gap:10px"><span class="spin"></span><span class="dz-msg">Đang quét ${K.fmt.int(items.length)} file…</span></div><div class="prog" style="width:min(360px,80%)"><i style="width:4%"></i></div></div>`;
      const t0 = performance.now();
      try {
        const src = await scan(items, label, (done, total, what) => {
          const m = box.querySelector(".dz-msg"), p = box.querySelector(".prog i");
          if (m) m.textContent = `${what} ${K.fmt.int(done)}/${K.fmt.int(total)}…`;
          if (p) p.style.width = Math.max(4, Math.round(done / Math.max(1, total) * 100)) + "%";
        });
        await buildEntries(src);
        src.ms = performance.now() - t0;
        if (!src.entries.size && !src.errors.length) throw new Error("Không thấy file level (.txt / .json) hay ảnh nào trong " + label + ".");
        S.src[slot] = src;
        if (slot === "B") S.cmpOpen = true;
        if (GDK.track) GDK.track("level-preview", "import", `${label} · ${src.entries.size} level · ${src.fileCount} file`);
        saveSession();
        S.view.page = 1;
        drawSource(slot); rebuild();
        const ad = adapterOf(src);
        toast(`Đã đọc ${K.fmt.int(src.entries.size)} level${ad ? " · " + ad.name : ""}.`, "ok");
        if (ad && ad.id === "auto") openMap(true);
      } catch (e) {
        toast(e.message, "bad");
        drawSource(slot);
      } finally { S.busy = false; }
    }

    async function refreshSource(slot) {
      const src = S.src[slot];
      await buildEntries(src);
      saveSession();
      drawSource(slot); rebuild();
    }
    function saveSession() { session["level-preview"] = { A: S.src.A, B: S.src.B }; }

    // ------------------------------------------------------------------ lưới ảnh
    function rebuild() {
      S.urls.forEach((u) => URL.revokeObjectURL(u)); S.urls.clear();
      const A = S.src.A, B = S.src.B;
      el("#lpGal").hidden = el("#lpExp").hidden = !A;
      if (!A) return;
      S.rows = LS.merge(A, B);
      drawSummary(); drawChips(); drawGrid();
    }
    function passes(r, ignore) {
      const v = S.view, e = r.a || r.b;
      if (ignore !== "range") { const f = LK.parseRange(v.range); if (f && !f(r.n)) return false; }
      if (ignore !== "mech" && v.mech) {
        const has = (x) => x && x.stats && (x.stats.marks || {})[v.mech];
        if (!has(r.a) && !has(r.b)) return false;
      }
      if (ignore === "filter") return true;
      switch (v.filter) {
        case "hard": return [r.a, r.b].some((x) => x && x.lv && (x.lv.tags || []).some((t) => /hard/i.test(t)));
        case "warn": return [r.a, r.b].some((x) => x && (x.worst === "bad" || x.worst === "warn"));
        case "diff": return r.diff && r.diff.status !== "same" && r.diff.status !== "image";
        case "same": return r.diff && r.diff.status === "same";
        default: return !!e;
      }
    }
    function drawSummary() {
      const A = S.src.A, B = S.src.B;
      const ents = [...A.entries.values()].filter((e) => e.lv);
      const st = ents.map((e) => e.stats);
      const warn = ents.filter((e) => e.worst === "bad" || e.worst === "warn").length;
      const hard = ents.filter((e) => (e.lv.tags || []).some((t) => /hard/i.test(t))).length;
      const avg = (k) => st.length ? st.reduce((s, x) => s + (x[k] || 0), 0) / st.length : 0;
      const tiles = [{ n: K.fmt.int(A.entries.size), label: A.imagesOnly ? "ảnh chụp" : "level" }];
      if (st.length) {
        tiles.push({ n: K.fmt.num(avg("containers"), 1), label: "vật chứa / level (TB)" }, { n: K.fmt.num(avg("colors"), 1), label: "màu / level (TB)" });
        tiles.push({ n: hard, label: "level Hard / Super Hard", cls: hard ? "acc" : "" });
        tiles.push({ n: warn, label: "level có cảnh báo", cls: warn ? "warn" : "ok" });
      }
      if (B) {
        const ch = S.rows.filter((r) => r.diff && ["changed", "layout", "onlyA", "onlyB"].includes(r.diff.status)).length;
        tiles.push({ n: ch, label: "level khác giữa A và B", cls: ch ? "warn" : "ok" });
      }
      el("#lpSum").innerHTML = K.tiles(tiles);
      // cơ chế có trong bộ
      const mechs = {};
      for (const e of [...A.entries.values(), ...(B ? B.entries.values() : [])]) for (const [k] of Object.entries((e.stats || {}).marks || {})) mechs[k] = (mechs[k] || 0) + 1;
      const sel = el("#lpMech");
      sel.innerHTML = `<option value="">Mọi cơ chế</option>` + Object.entries(mechs).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<option value="${esc(k)}" ${S.view.mech === k ? "selected" : ""}>${esc(MARK_NAMES[k] || k)} (${n} level)</option>`).join("");
      sel.hidden = !Object.keys(mechs).length;
    }
    function drawChips() {
      const B = S.src.B;
      const cnt = (f) => S.rows.filter((r) => { const o = S.view.filter; S.view.filter = f; const ok = passes(r); S.view.filter = o; return ok; }).length;
      const chips = [["all", "Tất cả"], ["hard", "Hard"], ["warn", "Có cảnh báo"]];
      if (B) chips.push(["diff", "Khác nhau"], ["same", "Giống hệt"]);
      el("#lpChips").innerHTML = chips.map(([k, l]) => `<button class="chip ${S.view.filter === k ? "on" : ""}" data-f="${k}">${l}<span class="n">${cnt(k)}</span></button>`).join("");
      $$("#lpChips .chip", root).forEach((c) => c.onclick = () => { S.view.filter = c.dataset.f; S.view.page = 1; drawChips(); drawGrid(); });
    }
    function thumbUrl(entry, key) {
      if (!entry) return null;
      const k = key + ":" + (entry.path || "") + ":" + entry.n;
      if (S.urls.has(k)) return S.urls.get(k);
      let url;
      if (entry.image) url = URL.createObjectURL(entry.image);
      else url = URL.createObjectURL(new Blob([LR.toSVG(entry.lv, { uid: "t" + entry.n, thumb: true, ids: S.view.ids, theme: S.view.theme })], { type: "image/svg+xml" }));
      S.urls.set(k, url);
      return url;
    }
    function drawGrid() {
      store.set("gdk.lp.view", { range: S.view.range, size: S.view.size, ids: S.view.ids, theme: S.view.theme });
      S.shown = S.rows.filter((r) => passes(r));
      const per = 300, lim = S.view.page * per;
      const list = S.shown.slice(0, lim);
      const B = S.src.B;
      el("#lpCount").textContent = `${K.fmt.int(S.shown.length)} / ${K.fmt.int(S.rows.length)} level`;
      el("#lpExpSub").textContent = `xuất ${K.fmt.int(S.shown.length)} level đang lọc`;
      const grid = el("#lpGrid");
      grid.style.setProperty("--lp-w", (SIZES[S.view.size] * (B ? 2 : 1) + (B ? 6 : 0)) + "px");
      grid.innerHTML = list.length ? list.map((r, i) => {
        const e = r.a || r.b, tags = (e.lv && e.lv.tags) || [];
        const tagHtml = tags.slice(0, 2).map((t) => `<span class="mini ${/super/i.test(t) ? "bad" : /hard/i.test(t) ? "m" : "l"}">${esc(t)}</span>`).join("");
        const w = [r.a, r.b].map((x) => x && x.worst).find((x) => x === "bad") || [r.a, r.b].map((x) => x && x.worst).find((x) => x === "warn");
        const st = e.stats;
        const ds = r.diff ? STATUS[r.diff.status] : null;
        const img = (x, side) => x ? `<img data-side="${side}" alt="" loading="lazy" decoding="async">` : `<div class="lp-none">không có</div>`;
        return `<button class="lp-card ${ds && r.diff.status !== "same" ? "lp-d-" + r.diff.status : ""}" data-i="${i}" title="${esc(e.file)}${r.diff && r.diff.changes.length ? "\n" + r.diff.changes.join("\n") : ""}">
          <div class="lp-thumbs">${B ? img(r.a, "a") + img(r.b, "b") : img(r.a, "a")}</div>
          <div class="lp-cap"><b>L${r.n}</b>${tagHtml}${w ? `<span class="lp-dot ${w}" title="có cảnh báo"></span>` : ""}
            ${ds ? `<span class="mini ${ds[1]} lp-ds">${ds[0]}</span>` : st ? `<span class="lp-st">${st.kind === "grid" ? st.w + "×" + st.h : st.containers + " vật chứa"} · ${st.colors} màu</span>` : ""}</div>
        </button>`;
      }).join("") : `<div class="empty">Không có level nào khớp bộ lọc.</div>`;
      el("#lpMore").innerHTML = S.shown.length > lim ? `<div class="row" style="justify-content:center;margin-top:12px"><button class="btn" id="lpMoreBtn">Hiện thêm ${Math.min(per, S.shown.length - lim)} level</button></div>` : "";
      const mb = el("#lpMoreBtn");
      if (mb) mb.onclick = () => { S.view.page++; drawGrid(); };
      if (S.io) S.io.disconnect();
      S.io = new IntersectionObserver((ents) => {
        for (const en of ents) {
          if (!en.isIntersecting) continue;
          const card = en.target, r = list[+card.dataset.i];
          card.querySelectorAll("img[data-side]").forEach((im) => { if (!im.src) im.src = thumbUrl(im.dataset.side === "a" ? r.a : r.b, S.view.ids + S.view.theme); });
          S.io.unobserve(card);
        }
      }, { rootMargin: "400px" });
      $$(".lp-card", grid).forEach((c) => { S.io.observe(c); c.onclick = () => openViewer(list.indexOf(list[+c.dataset.i]), list); });
    }
    el("#lpRange").oninput = debounce(() => { S.view.range = el("#lpRange").value; if (LK.parseRange(S.view.range) === null) return; S.view.page = 1; drawChips(); drawGrid(); }, 250);
    el("#lpMech").onchange = () => { S.view.mech = el("#lpMech").value; S.view.page = 1; drawChips(); drawGrid(); };
    el("#lpIds").onchange = (e) => { S.view.ids = e.target.checked; drawGrid(); };
    $$("#lpTheme button", root).forEach((b) => b.onclick = () => { S.view.theme = b.dataset.k; $$("#lpTheme button", root).forEach((x) => x.classList.toggle("on", x === b)); drawGrid(); });
    $$("#lpSize button", root).forEach((b) => b.onclick = () => { S.view.size = b.dataset.k; $$("#lpSize button", root).forEach((x) => x.classList.toggle("on", x === b)); drawGrid(); });

    // ------------------------------------------------------------------ xem to
    function openViewer(idx, list) {
      let i = idx;
      const wrap = document.createElement("div");
      wrap.className = "lp-view";
      document.body.appendChild(wrap);
      const close = () => { wrap.remove(); document.removeEventListener("keydown", key, true); };
      const key = (e) => {
        if (e.key === "Escape") { e.stopPropagation(); close(); }
        else if (e.key === "ArrowRight" && i < list.length - 1) { i++; draw(); }
        else if (e.key === "ArrowLeft" && i > 0) { i--; draw(); }
      };
      document.addEventListener("keydown", key, true);
      wrap.onclick = (e) => { if (e.target === wrap) close(); };
      function stage(x, label) {
        if (!x) return `<div class="lp-stage"><div class="lp-none big">Không có ở ${label}</div></div>`;
        if (x.image) return `<div class="lp-stage">${label ? `<div class="lp-sl">${label}</div>` : ""}<img src="${thumbUrl(x, "img")}" alt=""></div>`;
        return `<div class="lp-stage">${label ? `<div class="lp-sl">${label}</div>` : ""}${LR.toSVG(x.lv, { uid: "v" + label + x.n, ids: S.view.ids, theme: S.view.theme })}</div>`;
      }
      function info(x, label) {
        if (!x) return "";
        if (x.image) return `<div class="sectit">${label || "Ảnh"}</div><p class="hint"><code>${esc(x.path)}</code></p>`;
        const st = x.stats, ad = LK.adapters.find((a) => a.id === x.adapter);
        const marks = Object.entries(st.marks || {}).map(([k, n]) => `<span class="tag">${esc(MARK_NAMES[k] || k)} ×${n}</span>`).join(" ");
        const rows = st.kind === "grid" ? [["Lưới", st.w + " × " + st.h], ["Màu", st.colors], ["Ô có vật phẩm", st.items]]
          : [["Vật chứa", st.containers], ["Sức chứa", st.capacity], ["Màu", st.colors], ["Vật phẩm", st.items], ["Ẩn (?)", st.hidden], ["Vật chứa trống", st.empty], ["Ô trống", st.free], [x.lv.ordersLabel === "tổ" ? "Tổ" : "Đơn / mục tiêu", st.orders]];
        return `${label ? `<div class="sectit">${label}</div>` : ""}
          <div class="lp-kv">${rows.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join("")}</div>
          ${marks ? `<div class="lp-marks">${marks}</div>` : ""}
          ${x.issues.length ? `<div style="margin-top:10px">${K.issueList(x.issues)}</div>` : `<p class="hint">${icon("check")} Không có cảnh báo.</p>`}
          <p class="hint lp-file"><code>${esc(x.path)}</code><br>${esc(x.pack)} · đọc theo ${esc(ad ? ad.name : x.adapter)}</p>
          ${ad && ad.legend ? `<p class="hint">${Object.entries(ad.legend).map(([k, v]) => `<b>${esc(k)}</b> ${esc(v)}`).join(" · ")}</p>` : ""}`;
      }
      function draw() {
        const r = list[i], B = S.src.B;
        const e = r.a || r.b;
        wrap.innerHTML = `<div class="lp-vbox" role="dialog" aria-modal="true">
          <div class="lp-vh">
            <button class="icon-btn" data-act="prev" ${i === 0 ? "disabled" : ""} title="Level trước (←)">${icon("chevron-right", "flip")}</button>
            <b>Level ${r.n}</b>${(e.lv && e.lv.tags || []).map((t) => `<span class="mini ${/super/i.test(t) ? "bad" : /hard/i.test(t) ? "m" : "l"}">${esc(t)}</span>`).join("")}
            ${r.diff ? `<span class="mini ${STATUS[r.diff.status][1]}">${STATUS[r.diff.status][0]}</span>` : ""}
            <button class="icon-btn" data-act="next" ${i === list.length - 1 ? "disabled" : ""} title="Level sau (→)">${icon("chevron-right")}</button>
            <span class="hint">${i + 1} / ${list.length}</span>
            <span class="grow"></span>
            <button class="btn sm" data-act="png">${icon("download")} PNG</button>
            <button class="btn sm" data-act="copy">${icon("copy")} Copy ảnh</button>
            ${e.lv ? `<button class="btn sm ghost" data-act="json" title="Level chuẩn GD Toolkit">${icon("braces")} JSON</button>` : ""}
            <button class="icon-btn" data-act="close" title="Đóng (Esc)">${icon("x")}</button>
          </div>
          <div class="lp-vbody ${B ? "two" : ""}">
            <div class="lp-stages">${B ? stage(r.a, "A") + stage(r.b, "B") : stage(r.a, "")}</div>
            <div class="lp-side">
              ${r.diff && r.diff.changes.length ? `<div class="note ${r.diff.status === "same" ? "info" : ""}">${icon(r.diff.status === "same" ? "check" : "alert")}<div><b>So A → B</b><br>${r.diff.changes.map(esc).join("<br>")}</div></div>` : ""}
              ${B ? info(r.a, "Bộ A") + info(r.b, "Bộ B") : info(r.a, "")}
            </div>
          </div></div>`;
        wrap.querySelector('[data-act="close"]').onclick = close;
        wrap.querySelector('[data-act="prev"]').onclick = () => { if (i > 0) { i--; draw(); } };
        wrap.querySelector('[data-act="next"]').onclick = () => { if (i < list.length - 1) { i++; draw(); } };
        wrap.querySelector('[data-act="png"]').onclick = async () => { const b = await pngOf(r, 2); K.download(`level_${pad(r.n)}.png`, b); };
        wrap.querySelector('[data-act="copy"]').onclick = async () => {
          try { await navigator.clipboard.write([new ClipboardItem({ "image/png": pngOf(r, 1) })]); toast("Đã copy ảnh — dán thẳng vào Slack / Docs.", "ok"); }
          catch (err) { toast("Trình duyệt không cho copy ảnh — dùng nút PNG.", "bad"); }
        };
        const jb = wrap.querySelector('[data-act="json"]');
        if (jb) jb.onclick = () => K.download(`level_${pad(r.n)}.gdk.json`, JSON.stringify(toStd(e.lv), null, 1), "application/json");
      }
      draw();
    }

    // ------------------------------------------------------------------ xuất
    const pad = (n) => String(n).padStart(3, "0");
    /** Ảnh vẽ được lên canvas: SVG sơ đồ (Image) hoặc ảnh chụp (ImageBitmap). */
    async function drawable(x) {
      if (x.image) return createImageBitmap(x.image);
      const url = URL.createObjectURL(new Blob([LR.toSVG(x.lv, { uid: "p" + x.n, ids: S.view.ids, theme: S.view.theme })], { type: "image/svg+xml" }));
      try { const img = new Image(); img.src = url; await img.decode(); return img; }
      finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
    }
    /** Vẽ vừa khung (giữ tỉ lệ, ảnh chụp lệch tỉ lệ thì canh giữa trên nền tối). */
    function drawFit(g, im, x, y, w, h) {
      const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
      const s = Math.min(w / iw, h / ih);
      if (Math.abs(iw / ih - w / h) > 0.01) { g.fillStyle = "#111"; g.fillRect(x, y, w, h); }
      g.drawImage(im, x + (w - iw * s) / 2, y + (h - ih * s) / 2, iw * s, ih * s);
    }
    /** PNG 1 level; khi so sánh: A | B cạnh nhau. */
    async function pngOf(r, scale) {
      const w = 540 * scale, h = 1170 * scale, gap = 12 * scale;
      const sides = S.src.B ? [r.a, r.b] : [r.a || r.b];
      const c = document.createElement("canvas"); c.width = sides.length * w + (sides.length - 1) * gap; c.height = h;
      const g = c.getContext("2d");
      g.fillStyle = "#101014"; g.fillRect(0, 0, c.width, c.height);
      for (let k = 0; k < sides.length; k++) if (sides[k]) drawFit(g, await drawable(sides[k]), k * (w + gap), 0, w, h);
      return new Promise((ok) => c.toBlob(ok, "image/png"));
    }
    function progress(done, total, label) {
      const box = el("#lpProg");
      if (done == null) { box.innerHTML = ""; return; }
      box.innerHTML = `<div class="row" style="align-items:center;gap:10px;margin-top:12px"><span class="spin"></span><span class="hint" style="margin:0">${esc(label)} ${done}/${total}</span>
        <div class="prog" style="width:220px"><i style="width:${Math.round(done / Math.max(1, total) * 100)}%"></i></div></div>`;
    }
    async function guard(btn, fn) {
      if (!S.shown.length) return toast("Không có level nào để xuất (kiểm tra bộ lọc).", "bad");
      if (S.exporting) return;
      S.exporting = true; btn.disabled = true;
      if (GDK.track) GDK.track("level-preview", "export", `${btn.textContent.trim()} · ${S.shown.length} level`);
      try { await fn(); } catch (e) { toast(e.message, "bad"); } finally { S.exporting = false; btn.disabled = false; progress(null); }
    }
    el("#lpZip").onclick = (ev) => guard(ev.currentTarget, async () => {
      const scale = +el("#lpPx").value, files = [], list = S.shown;
      for (let k = 0; k < list.length; k++) {
        const r = list[k];
        files.push({ name: `level_${pad(r.n)}.png`, data: new Uint8Array(await (await pngOf(r, scale)).arrayBuffer()) });
        if (k % 4 === 0) { progress(k + 1, list.length, "Đang vẽ ảnh"); await tick(); }
      }
      files.push({ name: "levels.csv", data: GDK.lib.table.toCSV(...statsTable()) });
      K.download(`${zipBase()}_${list.length}_level.zip`, new Blob([Z.makeZip(files)], { type: "application/zip" }));
      toast(`Đã tạo ${list.length} ảnh PNG.`, "ok");
    });
    el("#lpSheet").onclick = (ev) => guard(ev.currentTarget, async () => {
      const list = S.shown, cols = 6, rows = 5, tw = 270, th = 585, cap = 30, gap = 6;
      const sheets = [];
      for (let s = 0; s < list.length; s += cols * rows) {
        const part = list.slice(s, s + cols * rows);
        const two = !!S.src.B, cw = two ? tw * 2 + 4 : tw;
        const c = document.createElement("canvas");
        c.width = cols * cw + (cols + 1) * gap; c.height = Math.ceil(part.length / cols) * (th + cap + gap) + gap;
        const g = c.getContext("2d");
        g.fillStyle = "#1d1f23"; g.fillRect(0, 0, c.width, c.height);
        for (let k = 0; k < part.length; k++) {
          const r = part[k], x = gap + (k % cols) * (cw + gap), y = gap + Math.floor(k / cols) * (th + cap + gap);
          const sides = two ? [r.a, r.b] : [r.a || r.b];
          for (let q = 0; q < sides.length; q++) if (sides[q]) drawFit(g, await drawable(sides[q]), x + q * (tw + 4), y, tw, th);
          const e = r.a || r.b, tags = (e.lv && e.lv.tags || []).join(" · ");
          g.fillStyle = "#e8e8ee"; g.font = "bold 17px Segoe UI, Arial"; g.textBaseline = "middle";
          g.fillText(`L${r.n}${tags ? "  " + tags : ""}${r.diff && r.diff.status !== "same" ? "  [" + STATUS[r.diff.status][0] + "]" : ""}`, x + 4, y + th + cap / 2);
          if (k % 6 === 0) { progress(s + k + 1, list.length, "Đang ghép ảnh"); await tick(); }
        }
        sheets.push(await new Promise((ok) => c.toBlob(ok, "image/png")));
      }
      if (sheets.length === 1) K.download(`${zipBase()}_anh_ghep.png`, sheets[0]);
      else K.download(`${zipBase()}_anh_ghep.zip`, new Blob([Z.makeZip(await Promise.all(sheets.map(async (b, i) => ({ name: `anh_ghep_${String(i + 1).padStart(2, "0")}.png`, data: new Uint8Array(await b.arrayBuffer()) }))))], { type: "application/zip" }));
      toast(`Đã tạo ${sheets.length} ảnh ghép.`, "ok");
    });
    const html = () => galleryHtml(S.shown, S.src, S.view);
    el("#lpHtml").onclick = (ev) => guard(ev.currentTarget, async () => { K.download(`${zipBase()}_gallery.html`, html(), "text/html;charset=utf-8"); });
    el("#lpHtmlPw").onclick = (ev) => guard(ev.currentTarget, async () => {
      const pw = await K.askPassword({ title: "Gallery có mật khẩu", note: "Tạo 1 file <b>.html</b>: người nhận mở bằng trình duyệt, nhập mật khẩu là tải được gallery. AES-256-GCM, chạy hoàn toàn trên máy." });
      if (!pw) return;
      if (!GDK.lib.secure) await new Promise((ok, fail) => { const s = document.createElement("script"); s.src = "lib/secure.js?v=" + GDK.version; s.onload = ok; s.onerror = () => fail(new Error("Không tải được bộ mã hoá.")); document.body.appendChild(s); });
      const SC = GDK.lib.secure, name = `${zipBase()}_gallery.html`;
      const pkg = await SC.encrypt(new TextEncoder().encode(html()), pw, { name, mime: "text/html" });
      K.download(name.replace(/\.html$/, ".gdk.html"), SC.toHtml(pkg), "text/html;charset=utf-8");
      toast("Đã tạo gallery mã hoá — gửi mật khẩu qua kênh khác.", "ok");
    });
    el("#lpJson").onclick = (ev) => guard(ev.currentTarget, async () => {
      const levels = S.shown.map((r) => r.a || r.b).filter((x) => x && x.lv).map((x) => toStd(x.lv));
      if (!levels.length) return toast("Bộ đang xem chỉ có ảnh chụp.", "bad");
      K.download(`${zipBase()}_levels.gdk.json`, JSON.stringify({ format: "gdk-level", version: 1, game: (adapterOf(S.src.A) || {}).game || "", levels }), "application/json");
    });
    K.exportMenu(el("#lpStats"), () => {
      if (!S.shown.length) return null;
      const [headers, rows] = statsTable();
      const sheets = [{ name: "Level", headers, rows }];
      if (S.src.B) sheets.push({ name: "So sánh A-B", headers: ["Level", "Trạng thái", "Thay đổi"], rows: S.shown.filter((r) => r.diff).map((r) => [r.n, STATUS[r.diff.status][0], r.diff.changes.join("; ")]) });
      return { name: zipBase() + "_thong_ke", sheets };
    }, { label: "Bảng thống kê" });
    function statsTable() {
      const headers = ["Level", "Bộ", "File", "Tag", "Vật chứa", "Sức chứa", "Màu", "Vật phẩm", "Ẩn", "Vật chứa trống", "Ô trống", "Đơn / tổ", "Cơ chế", "Cảnh báo"];
      const rows = S.shown.map((r) => r.a || r.b).filter(Boolean).map((x) => {
        const s = x.stats || {};
        return [x.n, x.pack, x.file, ((x.lv && x.lv.tags) || []).join(", "), s.containers ?? "", s.capacity ?? "", s.colors ?? "", s.items ?? "", s.hidden ?? "", s.empty ?? "", s.free ?? "", s.orders ?? "",
          Object.entries(s.marks || {}).map(([k, n]) => `${MARK_NAMES[k] || k} ${n}`).join(", "), (x.issues || []).filter((i) => i.level !== "info").map((i) => i.title).join("; ")];
      });
      return [headers, rows];
    }
    const zipBase = () => String((S.src.A && S.src.A.label) || "levels").replace(/[^\w\-]+/g, "_").slice(0, 40);

    // ------------------------------------------------------------------ cấu hình đọc file (game mới)
    const MAP = { open: false, sample: null, prof: null };
    function openMap(force) {
      MAP.open = force || !MAP.open;
      el("#lpMap").hidden = !MAP.open;
      el("#lpMapTog").innerHTML = `${icon(MAP.open ? "chevron-down" : "chevron-right")} ${MAP.open ? "Thu gọn" : "Mở"}`;
      if (MAP.open) drawMap();
    }
    el("#lpMapTog").onclick = () => openMap();
    function sampleRec() {
      const src = S.src.A;
      if (!src) return null;
      for (const p of src.packs.filter((x) => x.on).concat(src.packs)) for (const r of p.recs) if (r.json !== undefined) return r;
      return null;
    }
    function drawMap() {
      const box = el("#lpMap");
      const rec = MAP.sample || sampleRec();
      const games = S.games;
      const savedList = games.length ? `<div class="lp-games">${games.map((g) => `<span class="tag">${esc(g.name)} <button class="icon-btn sm" data-del="${esc(g.id)}" title="Xoá cấu hình">${icon("x")}</button></span>`).join(" ")}</div>` : `<p class="hint">Chưa có game nào tự khai.</p>`;
      if (!rec) {
        box.innerHTML = `<p>Game mới có 3 cách để xem được level, không cần sửa tool:</p>
          <ol class="aside-steps"><li><b>Cùng định dạng với game đã có</b> (vd file B / C / BIM như CDS) → chọn game đó ở ô “Đọc theo game”.</li>
          <li><b>Xuất thẳng ra “level chuẩn”</b> của Toolkit → xem ngay. Bấm <b>Tải file mẫu</b> ở khung bên phải để xem định dạng.</li>
          <li><b>Định dạng riêng</b> → nạp 1 file level ở bước 1, tool tự đoán cấu trúc, bạn sửa lại ở đây rồi lưu.</li></ol>
          <div class="sectit">Game đã khai</div>${savedList}
          <div class="row" style="margin-top:10px"><label class="btn sm ghost">${icon("upload")} Nạp cấu hình (.json)<input type="file" accept=".json" hidden id="lpMapImp"></label></div>`;
        bindMapCommon(box);
        return;
      }
      if (!MAP.prof || MAP.prof._rec !== rec.path) {
        const cur = adapterOf(S.src.A);
        MAP.prof = Object.assign(cur && cur.profile ? JSON.parse(JSON.stringify(cur.profile)) : LK.guessMapping(rec.json) || { containers: "", items: "", color: "", order: "bottom" }, { _rec: rec.path });
        if (!MAP.prof.name) MAP.prof.name = "";
      }
      const P = MAP.prof;
      const paths = jsonPaths(rec.json);
      const levelObj = P.levels != null && P.levels !== "" ? (LK.get(rec.json, P.levels) || [])[0] : P.levels === "" && Array.isArray(rec.json) ? rec.json[0] : rec.json;
      const lvPaths = jsonPaths(levelObj);
      const cont = (LK.get(levelObj, P.containers) || [])[0];
      const cPaths = jsonPaths(cont);
      const item = cont != null ? (LK.get(cont, P.items) || [])[0] : null;
      const iPaths = jsonPaths(item);
      const opt = (list, cur, none) => `${none != null ? `<option value="" ${cur === "" || cur == null ? "selected" : ""}>${esc(none)}</option>` : ""}${list.map((p) => `<option value="${esc(p)}" ${cur === p ? "selected" : ""}>${esc(p)}</option>`).join("")}`;
      let preview = "", err = "";
      try {
        const lv = LK.fromMapping(rec.json, P, rec.name)[0];
        if (!lv || !lv.containers.length) throw new Error("Chưa thấy vật chứa nào — chọn lại “Danh sách vật chứa”.");
        const st = LK.stats(lv);
        preview = `<div class="lp-mprev">${LR.toSVG(lv, { uid: "mp", theme: S.view.theme, ids: true })}</div>
          <p class="hint">${st.containers} vật chứa · sức chứa ${st.capacity} · ${st.colors} màu · ${st.items} vật phẩm${st.hidden ? " · " + st.hidden + " ẩn" : ""}</p>`;
      } catch (e) { err = e.message; }
      box.innerHTML = `<div class="lp-mapgrid"><div>
          <p class="hint" style="margin-top:0">${icon("info")} Đang dùng file mẫu <code>${esc(rec.path)}</code>. Tool đã tự đoán — kiểm tra ảnh bên phải, sửa các ô sai rồi lưu.</p>
          <div class="lp-form">
            <label class="lb">Tên game *</label><input type="text" id="mName" value="${esc(P.name || "")}" placeholder="vd: Ball Sort Mania" maxlength="60">
            <label class="lb">File chứa nhiều level?</label><select id="mLevels">${opt(paths.arrObj, P.levels, "Không — 1 file = 1 level")}${Array.isArray(rec.json) ? `<option value="__root" ${P.levels === "" ? "selected" : ""}>Có — cả file là mảng level</option>` : ""}</select>
            <label class="lb">Danh sách vật chứa (ống / cột / trứng…) *</label><select id="mCont">${opt(lvPaths.arr, P.containers, Array.isArray(levelObj) ? "(cả level là mảng vật chứa)" : null)}</select>
            <label class="lb">Vật phẩm trong mỗi vật chứa</label><select id="mItems">${opt(cPaths.arr, P.items, "(vật chứa chính là mảng vật phẩm)")}</select>
            <label class="lb">Màu của vật phẩm</label><select id="mColor">${opt(iPaths.leaf, P.color, "(vật phẩm chính là mã màu)")}</select>
            <label class="lb">Thứ tự vật phẩm trong file</label><div class="seg" id="mOrder"><button data-k="bottom" class="${P.order !== "top" ? "on" : ""}">Dưới → trên</button><button data-k="top" class="${P.order === "top" ? "on" : ""}">Trên → dưới</button></div>
            <label class="lb">Sức chứa</label><div class="row" style="gap:6px"><select id="mCap"><option value="">Tự tính (dài nhất)</option><option value="__num" ${typeof P.capacity === "number" ? "selected" : ""}>Số cố định</option>${opt(cPaths.leaf, typeof P.capacity === "string" ? P.capacity : null)}</select><input type="number" id="mCapN" min="1" max="64" value="${typeof P.capacity === "number" ? P.capacity : 4}" ${typeof P.capacity === "number" ? "" : "hidden"} style="width:80px"></div>
            <label class="lb">Giá trị coi là ô trống</label><input type="text" id="mEmpty" value="${P.empty === undefined ? "" : esc(P.empty)}" placeholder="vd: 0 (để trống nếu file không ghi ô trống)">
            <label class="lb">Vật phẩm bị ẩn (?) khi</label><div class="row" style="gap:6px"><select id="mHid">${opt(iPaths.leaf.concat(iPaths.bool), P.hidden && P.hidden.path, "— không có —")}</select><input type="text" id="mHidEq" placeholder="= giá trị (trống = true)" value="${P.hidden && P.hidden.eq !== undefined ? esc(P.hidden.eq) : ""}" style="width:150px"></div>
            <label class="lb">Toạ độ x / y của vật chứa</label><div class="row" style="gap:6px"><select id="mX">${opt(cPaths.leaf, P.x, "— tự xếp hàng —")}</select><select id="mY">${opt(cPaths.leaf, P.y, "—")}</select>
              <label class="lp-tog"><input type="checkbox" id="mYUp" ${P.yUp !== false ? "checked" : ""}> y hướng lên</label></div>
            <label class="lb">Đơn hàng / mục tiêu (không bắt buộc)</label><select id="mOrd">${opt(lvPaths.arrPrim, P.orders, "— không có —")}</select>
            <label class="lb">Kiểu vẽ</label><div class="seg lp-wrap" id="mStyle">${[["tube", "liquid", "Ống nước"], ["jar", "ball", "Bóng trong ống"], ["box", "block", "Khối trong cột"], ["egg", "bird", "Trứng / tổ"], ["branch", "bird", "Cành chim"]].map(([c, it, l]) => `<button data-c="${c}" data-i="${it}" class="${(P.style || {}).container === c || (!P.style && c === "tube") ? "on" : ""}">${l}</button>`).join("")}</div>
            <label class="lb">Soát: số vật phẩm mỗi màu chia hết cho</label><select id="mRule"><option value="capacity">Sức chứa</option><option value="3" ${(P.rules || {}).colorMultiple == 3 ? "selected" : ""}>3</option><option value="false" ${(P.rules || {}).colorMultiple === false ? "selected" : ""}>Không soát</option></select>
          </div>
          <div class="row" style="margin-top:14px;gap:8px;flex-wrap:wrap">
            <button class="btn primary" id="mSave">${icon("check")} Lưu thành game</button>
            <button class="btn" id="mExp">${icon("download")} Tải cấu hình (.json)</button>
            <label class="btn ghost">${icon("upload")} Nạp cấu hình<input type="file" accept=".json" hidden id="lpMapImp"></label>
          </div>
          <div class="sectit">Game đã khai</div>${savedList}
        </div>
        <div>${err ? `<div class="note bad">${icon("alert")}<div>${esc(err)}</div></div>` : preview}</div></div>`;
      const v = (id) => $("#" + id, box);
      const upd = () => {
        P.name = v("mName").value.trim();
        const lvSel = v("mLevels").value;
        P.levels = lvSel === "__root" ? "" : lvSel || undefined;
        P.containers = v("mCont").value;
        P.items = v("mItems").value;
        P.color = v("mColor").value;
        const cap = v("mCap").value;
        P.capacity = cap === "__num" ? Math.max(1, +v("mCapN").value || 4) : cap || undefined;
        const em = v("mEmpty").value.trim();
        P.empty = em === "" ? undefined : isFinite(+em) ? +em : em;
        const hp = v("mHid").value, he = v("mHidEq").value.trim();
        P.hidden = hp ? Object.assign({ path: hp }, he !== "" ? { eq: isFinite(+he) ? +he : he } : {}) : undefined;
        P.x = v("mX").value || undefined; P.y = v("mY").value || undefined;
        P.yUp = v("mYUp").checked;
        P.orders = v("mOrd").value || undefined;
        const r = v("mRule").value;
        P.rules = { colorMultiple: r === "false" ? false : r === "3" ? 3 : "capacity" };
        drawMap();
      };
      ["mLevels", "mCont", "mItems", "mColor", "mCap", "mHid", "mX", "mY", "mOrd", "mRule"].forEach((id) => v(id).onchange = upd);
      ["mCapN", "mEmpty", "mHidEq"].forEach((id) => v(id).onchange = upd);
      v("mYUp").onchange = upd;
      v("mName").oninput = () => { P.name = v("mName").value.trim(); };
      $$("#mOrder button", box).forEach((b) => b.onclick = () => { P.order = b.dataset.k; drawMap(); });
      $$("#mStyle button", box).forEach((b) => b.onclick = () => { P.style = { container: b.dataset.c, item: b.dataset.i }; drawMap(); });
      v("mSave").onclick = async () => {
        if (!P.name) { v("mName").focus(); return toast("Đặt tên game trước khi lưu.", "bad"); }
        try {
          const prof = Object.assign({}, P); delete prof._rec;
          const r = await GDK.api("tools/level-preview/games/save", { profile: prof });
          setGames(r.games);
          const ad = LK.adapters.find((a) => a.id === "map:" + r.saved.id);
          if (S.src.A && ad) { S.src.A.adapterId = ad.id; await refreshSource("A"); }
          toast(`Đã lưu “${r.saved.name}” — lần sau tool tự nhận file của game này.`, "ok");
        } catch (e) { toast(e.message, "bad"); }
      };
      v("mExp").onclick = () => { const prof = Object.assign({}, P); delete prof._rec; K.download(`${(P.name || "game").replace(/[^\w\-]+/g, "_")}.gdkmap.json`, JSON.stringify(prof, null, 1), "application/json"); };
      bindMapCommon(box);
    }
    function bindMapCommon(box) {
      $$("[data-del]", box).forEach((b) => b.onclick = async () => {
        if (!confirm("Xoá cấu hình “" + b.dataset.del + "”?")) return;
        try { setGames((await GDK.api("tools/level-preview/games/delete", { id: b.dataset.del })).games); drawMap(); } catch (e) { toast(e.message, "bad"); }
      });
      const imp = $("#lpMapImp", box);
      if (imp) imp.onchange = async () => {
        try {
          const prof = JSON.parse(await imp.files[0].text());
          if (!prof || typeof prof !== "object" || !prof.containers && prof.containers !== "") throw new Error("File không phải cấu hình đọc level.");
          MAP.prof = Object.assign(prof, { _rec: (MAP.sample || sampleRec() || {}).path });
          drawMap();
          toast("Đã nạp cấu hình — kiểm tra ảnh rồi bấm Lưu.", "ok");
        } catch (e) { toast(e.message, "bad"); }
      };
    }
    /** Liệt kê đường dẫn trong 1 object JSON: mảng object, mảng giá trị, trường lá. */
    function jsonPaths(obj) {
      const out = { arr: [], arrObj: [], arrPrim: [], leaf: [], bool: [] };
      const walk = (o, p, d) => {
        if (d > 4 || o == null || typeof o !== "object") return;
        for (const [k, v] of Object.entries(o)) {
          if (Array.isArray(o) && +k > 0) break;
          const path = p ? p + "." + k : k;
          if (Array.isArray(v)) {
            out.arr.push(path);
            if (v.length && v[0] && typeof v[0] === "object" && !Array.isArray(v[0])) { out.arrObj.push(path); walk(v[0], path + ".0", d + 1); }
            else if (v.length && typeof v[0] !== "object") out.arrPrim.push(path);
          } else if (v && typeof v === "object") walk(v, path, d + 1);
          else if (typeof v === "boolean") out.bool.push(path);
          else if (!Array.isArray(o)) out.leaf.push(path);
        }
      };
      walk(obj, "", 0);
      for (const k of Object.keys(out)) out[k] = out[k].filter((p) => !/\.0\./.test(p) && !/\.0$/.test(p));
      return out;
    }
    function setGames(games) {
      for (const a of LK.adapters.filter((x) => x.kind === "mapping")) LK.unregister(a.id);
      S.games = games || [];
      for (const g of S.games) LK.register(LK.mappingAdapter(g));
      ["A", "B"].forEach((s) => S.src[s] && drawSource(s));
    }
    GDK.api("tools/level-preview/games").then((r) => setGames(r.games)).catch(() => {});

    // ------------------------------------------------------------------ dữ liệu mẫu
    async function sample() {
      const { a, b } = makeSample();
      S.src.A = null; S.src.B = null;
      await load("A", a, "demo_v1");
      await load("B", b, "demo_v2");
      toast("Đã nạp 12 level mẫu (CDS) + bản sửa để so sánh.", "ok");
    }
    function template() {
      K.download("level_chuan_mau.gdk.json", JSON.stringify(STD_SAMPLE, null, 1), "application/json");
    }

    // để test tự động: nạp danh sách file giả lập như khi kéo thả 1 thư mục (trình duyệt không cho tạo thư mục giả)
    root.lpLoadForTest = (slot, items, label) => load(slot, items, label);
    drawSource("A"); drawSource("B"); rebuild();
    if (S.src.B) S.cmpOpen = true, drawSource("B");
    return {
      cleanup: () => { if (S.io) S.io.disconnect(); S.urls.forEach((u) => URL.revokeObjectURL(u)); $$(".lp-view").forEach((x) => x.remove()); },
      sample, template, sampleLabel: "Thử với level mẫu",
    };
  }

  // ==================================================================== tiện ích
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  const tick = () => new Promise((r) => setTimeout(r, 0));
  /** Level chuẩn để xuất (bỏ trường nội bộ). */
  function toStd(lv) {
    const o = { level: lv.level, name: lv.name, tags: lv.tags, style: lv.style };
    if (lv.grid) o.grid = lv.grid;
    else o.containers = lv.containers.map((c) => {
      const x = { items: c.items.map((i) => (Object.keys(i).length === 1 ? i.c : i)), capacity: c.capacity };
      for (const k of ["x", "y", "size", "dir", "label"]) if (c[k] != null) x[k] = c[k];
      if ((c.marks || []).length) x.marks = c.marks;
      return x;
    });
    if ((lv.groups || []).length) o.groups = lv.groups;
    if ((lv.orders || []).length) o.orders = lv.orders;
    if (lv.palette && Object.keys(lv.palette).length) o.palette = lv.palette;
    if (lv.yUp === false) o.yUp = false;
    return o;
  }

  /** Gallery .html tự chứa (SVG nhúng thẳng) — mở được ở mọi máy, không cần tool. */
  function galleryHtml(list, src, view) {
    const LR = GDK.lib.levelrender, esc = GDK.esc;
    const title = (src.A ? src.A.label : "levels") + (src.B ? " vs " + src.B.label : "");
    const fig = (x, n, side) => {
      if (!x) return `<div class="none">không có</div>`;
      if (x.image) return `<div class="none">ảnh chụp (${esc(x.file)})</div>`;
      return LR.toSVG(x.lv, { uid: "g" + side + n, theme: view.theme, ids: view.ids });
    };
    const cards = list.map((r) => {
      const e = r.a || r.b, tags = (e.lv && e.lv.tags) || [];
      const issues = [r.a, r.b].filter((x) => x && x.issues).flatMap((x) => x.issues.filter((i) => i.level !== "info").map((i) => i.title));
      return `<figure tabindex="0"><div class="th ${src.B ? "two" : ""}">${src.B ? fig(r.a, r.n, "a") + fig(r.b, r.n, "b") : fig(r.a || r.b, r.n, "a")}</div>
        <figcaption><b>L${r.n}</b> ${tags.map((t) => `<span class="t ${/super/i.test(t) ? "sh" : /hard/i.test(t) ? "h" : ""}">${esc(t)}</span>`).join(" ")}
        ${r.diff && r.diff.status !== "same" ? `<span class="t d">${esc(r.diff.changes.join(" · "))}</span>` : ""}
        ${issues.length ? `<span class="t w">⚠ ${esc(issues.join(" · "))}</span>` : ""}<small>${esc(e.file)}</small></figcaption></figure>`;
    }).join("");
    return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Level Preview</title>
<style>body{margin:0;background:#14161a;color:#e8e8ee;font:14px Segoe UI,Arial,sans-serif}header{padding:16px 20px;border-bottom:1px solid #2a2d34}h1{margin:0;font-size:18px}
header p{margin:4px 0 0;color:#9a9cb0;font-size:13px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(${src.B ? 330 : 190}px,1fr));gap:14px;padding:16px 20px}
figure{margin:0;background:#1d2026;border:1px solid #2a2d34;border-radius:10px;overflow:hidden;cursor:zoom-in}figure:focus{outline:2px solid #76D2DB}
.th{display:flex;gap:4px}.th>*{flex:1;min-width:0}.th svg{width:100%;height:auto;display:block}figcaption{padding:8px 10px;font-size:13px;line-height:1.5}
figcaption small{display:block;color:#7c7f92;word-break:break-all}.t{display:inline-block;padding:0 6px;border-radius:6px;background:#2a2d34;font-size:11.5px}.t.h{background:#4d2a7a}.t.sh{background:#7a2020}
.t.d{background:#5a4a14}.t.w{background:#5a3a14}.none{display:grid;place-items:center;aspect-ratio:540/1170;color:#7c7f92;font-size:12px;background:#121317}
figure.big{position:fixed;inset:0;z-index:9;cursor:zoom-out;border-radius:0;display:flex;flex-direction:column;background:#0e0f12}figure.big .th{flex:1;min-height:0;justify-content:center}
figure.big .th svg{height:100%;width:auto;max-width:100%}footer{padding:16px 20px;color:#7c7f92;font-size:12px}</style></head><body>
<header><h1>${esc(title)}</h1><p>${list.length} level · tạo ${new Date().toLocaleString("vi-VN")} bằng GD Toolkit · Level Preview · ảnh sơ đồ vẽ từ file level · bấm vào level để xem to (Esc để đóng)</p></header>
<main>${cards}</main><footer>Design by Dũng NT</footer>
<script>document.addEventListener("click",function(e){var f=e.target.closest("figure");if(f)f.classList.toggle("big")});document.addEventListener("keydown",function(e){if(e.key==="Escape")document.querySelectorAll("figure.big").forEach(function(f){f.classList.remove("big")})});</script>
</body></html>`;
  }

  // ==================================================================== mẫu
  /** 12 level kiểu CDS (định dạng runtime B / C / BIM) + bản sửa: L5 thêm 1 ống trống, L9 đổi màu, L12 đổi số ô ẩn. */
  function makeSample() {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const build = (n, v2) => {
      const k = Math.min(8, 3 + Math.floor((n + 1) / 2));
      let units, tubes;
      for (let tries = 0; tries < 50; tries++) {
        units = shuffle([].concat(...Array.from({ length: k }, (_, c) => [c + 1, c + 1, c + 1, c + 1])));
        if (n === 7) units.splice(units.indexOf(1), 1);           // L7: màu 1 chỉ còn 3 phần → cảnh báo
        tubes = Array.from({ length: k }, (_, t) => units.slice(t * 4, t * 4 + 4));
        if (tubes.every((t) => new Set(t).size > 1)) break;
      }
      if (v2 && n === 9) tubes = tubes.map((t) => t.slice().reverse());
      const empties = 2 + (v2 && n === 5 ? 1 : 0);
      const all = tubes.concat(Array.from({ length: empties }, () => []));
      const per = all.length <= 8 ? 4 : 5;
      const B = all.map((t, i) => {
        const r = Math.floor(i / per), inRow = Math.min(per, all.length - r * per), col = i - r * per;
        const hid = n === 3 || n >= 10 ? (v2 && n === 12 ? 1 : 2) : 0;
        const C = [0, 1, 2, 3].map((s) => (t[s] != null ? { LP: { x: 0, y: s, z: 0 }, BIM: { Id: s < hid && t.length === 4 ? 2 : 1, CI: t[s], V: true } } : { LP: { x: 0, y: s, z: 0 } }));
        const b = { Id: 0, P: { x: 3 + (col - (inRow - 1) / 2) * 1.5, y: 12 - r * 4, z: 0 }, C, hasVideo: false, isBigBottle: false, propIndex: -1 };
        if (n === 4 && i === 0) b.OBIM = [{ Id: 4, Obj: { Id: 0, TA: 2, CI: t[3] }, CI: 0 }];
        if (n === 6 && i === 1) b.OBIM = [{ Id: 7, Obj: { Id: 0, TA: 3, CI: 0 }, CI: 0 }];
        if (n === 8 && i === all.length - 1) b.hasVideo = true;
        if (n === 9 && (i === 0 || i === 1)) b.OVBIM = { Id: 21, KLT: 1 };
        if (n === 9 && i === 3) C[3].CBIM = { Id: 22, KLT: 1 };
        if (n === 11 && (i === 2 || i === 3)) b.OVBIM = { Id: 26, CAI: 1 };
        if (n === 12 && i === all.length - 1) b.OBIM = [{ Id: 18, NC: [2, 2, 2, 2], CI: 0 }];
        return b;
      });
      const orders = shuffle(Array.from({ length: k }, (_, c) => c + 1));
      return JSON.stringify({ UCCC: 2, CC: k, LId: "level_" + n, B, lstOrderCI: orders });
    };
    const cfg = JSON.stringify({ levelConfigModels: Array.from({ length: 12 }, (_, i) => ({ Level: i + 1, isHard: i + 1 === 5 || i + 1 === 9, isSuperHard: i + 1 === 10 })) });
    const files = (dir, v2) => Array.from({ length: 12 }, (_, i) => ({ file: new File([build(i + 1, v2)], `level_${i + 1}.txt`, { type: "text/plain" }), path: `${dir}/level_${i + 1}.txt` }))
      .concat([{ file: new File([cfg], "LevelConfig.txt"), path: `${dir}/Config/LevelConfig.txt` }]);
    seed = 7; const a = files("demo_v1", false);
    seed = 7; const b = files("demo_v2", true);
    return { a, b };
  }

  const STD_SAMPLE = {
    format: "gdk-level", version: 1, game: "Tên game của bạn",
    _huong_dan: [
      "Định dạng level chuẩn của GD Toolkit — game nào xuất ra dạng này là Level Preview xem được ngay.",
      "containers: danh sách vật chứa (ống / cột / trứng / cành). items: vật phẩm từ DƯỚI lên TRÊN; mỗi vật phẩm là mã màu hoặc {c, hidden, key, label}.",
      "capacity: sức chứa. x, y: toạ độ (tuỳ đơn vị, không có thì tool tự xếp hàng). marks: cơ chế — ice / cover / lock / ads / spawn / seal / hidden hoặc tên tuỳ ý.",
      "groups: nhóm nhiều vật chứa (tray / curtain / lockbox). orders: đơn hàng / mục tiêu. palette: mã màu → #hex (không có thì tool tự chọn).",
      "style.container: tube | jar | box | egg | branch · style.item: liquid | ball | block | bird. Game dạng lưới: dùng grid {w, h, cells} thay cho containers.",
    ],
    levels: [
      { level: 1, tags: ["Hard"], style: { container: "tube", item: "liquid" }, orders: [1, 2],
        containers: [{ items: [1, 2, 1, 2], capacity: 4, x: 0, y: 1 }, { items: [2, 1, 2, { c: 1, hidden: true }], capacity: 4, x: 1, y: 1, marks: [{ type: "ice", n: 2 }] },
          { items: [], capacity: 4, x: 0, y: 0 }, { items: [], capacity: 4, x: 1, y: 0, marks: [{ type: "ads" }] }] },
      { level: 2, style: { container: "jar", item: "ball" }, palette: { red: "#E53935", blue: "#1E63E9" },
        containers: [{ items: ["red", "blue", "red"], capacity: 3 }, { items: ["blue", "red", "blue"], capacity: 3 }, { items: [], capacity: 3 }] },
      { level: 3, grid: { w: 4, h: 3, cells: [[1, 1, 2, null], [2, { c: 3, n: 2 }, 3, 1], [{ block: true }, 2, 3, 3]] } },
    ],
  };
})();

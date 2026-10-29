/* GD Toolkit — bộ UI dùng chung cho các tool: nhập file, ghép cột, bảng, biểu đồ, xuất file.
   Mọi tool mới nên dùng lại các khối này để giao diện đồng bộ và dễ dùng. */
(() => {
  "use strict";
  const G = window.GDK;
  const { esc, icon, toast } = G;

  // ================================================================ định dạng số
  const fmt = {
    int: (n) => n == null || !isFinite(n) ? "—" : Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "."),
    num: (n, d = 2) => n == null || !isFinite(n) ? "—" : (+n.toFixed(d)).toLocaleString("vi-VN"),
    pct: (v, d) => v == null || !isFinite(v) ? "—" : (v * 100).toFixed(d == null ? (Math.abs(v) < 0.1 ? 1 : 0) : d).replace(".", ",") + "%",
    spct: (v, d = 1) => v == null || !isFinite(v) ? "—" : (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(d).replace(".", ",") + "%",
    money: (n) => n == null || !isFinite(n) ? "—" : (n < 1 ? n.toFixed(3) : n.toFixed(2)).replace(".", ","),
  };

  // ================================================================ tải / copy
  /** Tải về: data là chuỗi hoặc Blob. */
  function download(name, data, mime = "text/csv;charset=utf-8") {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  async function copy(text, msg = "Đã copy vào clipboard") {
    try { await navigator.clipboard.writeText(text); toast(msg, "ok"); }
    catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); toast(msg, "ok"); } catch (e2) { toast("Không copy được — hãy chọn chữ rồi Ctrl C", "bad"); }
      ta.remove();
    }
  }
  const mb = (n) => (n / 1048576).toFixed(n < 10485760 ? 1 : 0).replace(".", ",") + " MB";

  // ================================================================ đọc file bảng
  // CSV đọc trong Web Worker (không đơ trang); Excel gửi thẳng byte lên server local (openpyxl).
  let worker = null, wid = 0;
  const pending = new Map();
  function getWorker() {
    if (worker === false) return null;
    if (!worker) {
      try {
        worker = new Worker("assets/table-worker.js?v=" + G.version);
        worker.onmessage = (e) => {
          const p = pending.get(e.data.id);
          if (!p) return;
          if (e.data.type === "progress") return p.onProgress && p.onProgress(e.data);
          pending.delete(e.data.id);
          e.data.type === "error" ? p.fail(new Error(e.data.message)) : p.ok(e.data);
        };
        worker.onerror = () => { worker = false; for (const p of pending.values()) p.fail(new Error("Worker lỗi")); pending.clear(); };
      } catch (e) { worker = false; return null; }
    }
    return worker;
  }
  function parseInWorker(file, onProgress) {
    const w = getWorker();
    if (!w) return null;
    return new Promise((ok, fail) => {
      const id = ++wid;
      pending.set(id, { ok, fail, onProgress });
      w.postMessage({ id, file });
    });
  }

  /** Đọc File → bảng {headers, rows, name, ...}. onProgress({loaded,total,phase}) */
  async function readTable(file, sheet, onProgress) {
    const T = G.lib.table;
    const name = file.name || "file";
    const t0 = performance.now();
    if (/\.(xlsx|xlsm)$/i.test(name)) {
      onProgress && onProgress({ phase: "excel" });
      const r = await G.api("table/xlsx" + (sheet ? "?sheet=" + encodeURIComponent(sheet) : ""), file);
      return Object.assign(T.toTable(r.matrix), { name, sheets: r.sheets, sheet: r.sheet, file, ms: performance.now() - t0 });
    }
    if (/\.xls$/i.test(name)) throw new Error("File .xls (Excel cũ) chưa hỗ trợ — mở bằng Excel rồi Lưu thành .xlsx hoặc .csv.");
    const viaWorker = parseInWorker(file, onProgress);
    if (viaWorker) {
      const r = await viaWorker;
      if (r.note) toast(r.note);
      return Object.assign(T.toTable(r.matrix), { name, file, encoding: r.encoding, ms: performance.now() - t0 });
    }
    const text = await file.text();      // trình duyệt không cho Worker → đọc trực tiếp
    return Object.assign(T.parseTable(text), { name, file, ms: performance.now() - t0 });
  }

  // dữ liệu đã nạp được giữ trong bộ nhớ của tab (KHÔNG ghi ra ổ đĩa) → quay lại tool không phải nạp lại
  const session = (G.session = G.session || {});

  /**
   * Ô nhập bảng: kéo thả / chọn file / dán từ Google Sheets. opts:
   *  {title, accept, onTable(table), onSample, sampleLabel, cacheKey}
   */
  function importer(el, opts) {
    const T = G.lib.table;
    let table = null;
    const accept = opts.accept || ".csv,.tsv,.txt,.xlsx";
    function draw() {
      if (table) {
        el.innerHTML = `<div class="file-chip">
          <span class="ibox sm">${icon("sheet")}</span>
          <div class="fc-main"><b>${esc(table.name)}</b><span>${G.kit.fmt.int(table.rows.length)} dòng · ${table.headers.length} cột${table.file ? " · " + mb(table.file.size) : ""}${table.ms ? " · đọc trong " + (table.ms / 1000).toFixed(1).replace(".", ",") + " giây" : ""}${table.restored ? " · giữ từ lần trước" : ""}</span></div>
          ${table.sheets && table.sheets.length > 1 ? `<select class="fc-sheet" title="Chọn sheet">${table.sheets.map((s) => `<option ${s === table.sheet ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>` : ""}
          <button class="btn sm" data-act="change">${icon("refresh")} Đổi file</button></div>`;
        el.querySelector('[data-act="change"]').onclick = () => { table = null; if (opts.cacheKey) delete session[opts.cacheKey]; draw(); };
        const sh = el.querySelector(".fc-sheet");
        if (sh) sh.onchange = async () => { try { set(await readTable(table.file, sh.value, progress)); } catch (e) { toast(e.message, "bad"); } };
        return;
      }
      el.innerHTML = `
        <label class="dz" tabindex="0">
          <input type="file" accept="${accept}" hidden>
          <span class="dz-ic">${icon("upload")}</span>
          <span class="dz-t">${esc(opts.title || "Kéo thả file CSV / Excel vào đây")}</span>
          <span class="dz-s">hoặc <u>bấm để chọn file</u> · .csv .tsv .xlsx · file lớn vẫn đọc mượt</span>
        </label>
        <div class="dz-alt">
          <button class="btn sm ghost" data-act="paste">${icon("copy")} Dán từ Google Sheets / Excel</button>
          ${opts.onSample ? `<button class="btn sm" data-act="sample">${icon("flask")} ${esc(opts.sampleLabel || "Dùng dữ liệu mẫu")}</button>` : ""}
        </div>
        <div class="dz-paste" hidden>
          <textarea rows="6" placeholder="Bôi đen vùng dữ liệu trong Google Sheets (gồm cả dòng tiêu đề) → Ctrl C → dán vào đây"></textarea>
          <div class="row" style="margin-top:8px"><button class="btn primary sm" data-act="usepaste">${icon("check")} Dùng dữ liệu đã dán</button></div>
        </div>`;
      const dz = el.querySelector(".dz"), inp = el.querySelector("input[type=file]");
      inp.onchange = () => inp.files[0] && load(inp.files[0]);
      dz.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inp.click(); } };
      dz.ondragover = (e) => { e.preventDefault(); dz.classList.add("over"); };
      dz.ondragleave = () => dz.classList.remove("over");
      dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove("over"); if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]); };
      el.querySelector('[data-act="paste"]').onclick = () => { const p = el.querySelector(".dz-paste"); p.hidden = !p.hidden; if (!p.hidden) p.querySelector("textarea").focus(); };
      el.querySelector('[data-act="usepaste"]').onclick = () => {
        const text = el.querySelector(".dz-paste textarea").value;
        const t = T.parseTable(text);
        if (!t.headers.length || !t.rows.length) return toast("Chưa có dữ liệu — cần dòng tiêu đề + ít nhất 1 dòng số liệu.", "bad");
        set(Object.assign(t, { name: "Dữ liệu dán" }));
      };
      const s = el.querySelector('[data-act="sample"]');
      if (s) s.onclick = () => opts.onSample();
    }
    function progress(p) {
      const box = el.querySelector(".dz.busy");
      if (!box) return;
      const pct = p.total ? Math.min(100, Math.round(p.loaded / p.total * 100)) : null;
      const label = p.phase === "excel" ? "Đang đọc file Excel…" : p.phase === "parse" ? "Đang tách bảng…"
        : pct != null ? `Đang đọc ${pct}% · ${mb(p.loaded)} / ${mb(p.total)}` : "Đang đọc…";
      box.querySelector(".dz-msg").textContent = label;
      box.querySelector(".prog i").style.width = (p.phase === "parse" ? 100 : pct || 15) + "%";
    }
    async function load(file) {
      el.innerHTML = `<div class="dz busy"><div class="row" style="align-items:center;gap:10px"><span class="spin"></span><span class="dz-msg">Đang đọc ${esc(file.name)}…</span></div>
        <div class="prog" style="width:min(360px,80%)"><i style="width:5%"></i></div></div>`;
      try { set(await readTable(file, null, progress)); }
      catch (e) { toast(e.message, "bad"); table = null; draw(); }
    }
    function set(t, restored) {
      if (!t.headers.length) { toast("File không có dòng tiêu đề.", "bad"); table = null; draw(); return; }
      table = t;
      table.restored = !!restored;
      if (!restored && G.track) G.track(null, "import", `${t.name || "dữ liệu"} · ${t.rows.length} dòng`);
      if (opts.cacheKey) session[opts.cacheKey] = t;
      draw(); opts.onTable(t);
    }
    draw();
    if (opts.cacheKey && session[opts.cacheKey]) setTimeout(() => { if (!table) set(session[opts.cacheKey], true); }, 0);
    return { set, get: () => table, reset: () => { table = null; if (opts.cacheKey) delete session[opts.cacheKey]; draw(); } };
  }

  // ================================================================ mật khẩu
  function passwordStrength(pw) {
    pw = pw || "";
    let pool = 0;
    if (/[a-z]/.test(pw)) pool += 26;
    if (/[A-Z]/.test(pw)) pool += 26;
    if (/\d/.test(pw)) pool += 10;
    if (/[^A-Za-z0-9]/.test(pw)) pool += 32;
    const uniq = new Set(pw).size;
    const bits = Math.log2(Math.max(pool, 1)) * Math.min(pw.length, uniq * 2);
    const score = pw.length < 8 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
    return { score, label: ["Quá ngắn", "Yếu", "Tạm được", "Mạnh", "Rất mạnh"][score], cls: ["bad", "bad", "warn", "ok", "ok"][score] };
  }
  function genPassword() {
    const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    const r = new Uint32Array(18);
    crypto.getRandomValues(r);
    const s = Array.from(r, (x) => abc[x % abc.length]).join("");
    return s.slice(0, 6) + "-" + s.slice(6, 12) + "-" + s.slice(12);
  }
  /** Hộp nhập mật khẩu (nhập 2 lần, đo độ mạnh, nút tạo ngẫu nhiên). Trả về mật khẩu hoặc null. */
  function askPassword({ title = "Đặt mật khẩu", note = "", confirmLabel = "Tạo file", needConfirm = true } = {}) {
    return new Promise((done) => {
      const wrap = document.createElement("div");
      wrap.className = "modal";
      wrap.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true">
        <div class="modal-h">${icon("key")}<b>${esc(title)}</b></div>
        ${note ? `<p class="hint" style="margin:0 0 12px">${note}</p>` : ""}
        <label class="lb">Mật khẩu (ít nhất 8 ký tự)</label>
        <div class="pw-row"><input type="password" id="pw1" autocomplete="new-password" spellcheck="false">
          <button class="btn sm ghost" data-act="show" title="Hiện / ẩn">${icon("eye")}</button></div>
        <div class="pw-meter"><i></i></div><div class="pw-lbl hint" style="margin:4px 0 10px"></div>
        ${needConfirm ? `<label class="lb">Nhập lại mật khẩu</label><input type="password" id="pw2" autocomplete="new-password" spellcheck="false">` : ""}
        <div class="row" style="justify-content:space-between;align-items:center;margin-top:14px">
          ${needConfirm ? `<button class="btn sm ghost" data-act="gen">${icon("sparkles")} Tạo mật khẩu mạnh</button>` : "<span></span>"}
          <div class="row" style="gap:8px"><button class="btn" data-act="cancel">Huỷ</button><button class="btn primary" data-act="ok">${esc(confirmLabel)}</button></div>
        </div>
        <p class="hint" style="margin:12px 0 0">${icon("info")} Mật khẩu không được lưu ở đâu cả — quên là không mở lại được. Gửi mật khẩu qua kênh khác với file.</p>
      </div>`;
      document.body.appendChild(wrap);
      const p1 = wrap.querySelector("#pw1"), p2 = wrap.querySelector("#pw2");
      const meter = wrap.querySelector(".pw-meter i"), lbl = wrap.querySelector(".pw-lbl");
      const upd = () => {
        const s = passwordStrength(p1.value);
        meter.style.width = (p1.value ? 12 + s.score * 22 : 0) + "%";
        meter.className = s.cls;
        lbl.textContent = p1.value ? "Độ mạnh: " + s.label : "";
      };
      const close = (v) => { wrap.remove(); document.removeEventListener("keydown", key, true); done(v); };
      const submit = () => {
        if (p1.value.length < 8) return toast("Mật khẩu cần ít nhất 8 ký tự.", "bad");
        if (needConfirm && p1.value !== p2.value) return toast("Hai lần nhập mật khẩu không khớp.", "bad");
        close(p1.value);
      };
      const key = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(null); } else if (e.key === "Enter") { e.preventDefault(); submit(); } };
      document.addEventListener("keydown", key, true);
      p1.oninput = upd;
      wrap.querySelector('[data-act="show"]').onclick = () => { const t = p1.type === "password" ? "text" : "password"; p1.type = t; if (p2) p2.type = t; };
      const gen = wrap.querySelector('[data-act="gen"]');
      if (gen) gen.onclick = () => { const g = genPassword(); p1.value = g; p2.value = g; p1.type = p2.type = "text"; upd(); copy(g, "Đã tạo và copy mật khẩu — lưu lại ở nơi an toàn"); };
      wrap.querySelector('[data-act="cancel"]').onclick = () => close(null);
      wrap.querySelector('[data-act="ok"]').onclick = submit;
      wrap.onclick = (e) => { if (e.target === wrap) close(null); };
      p1.focus();
    });
  }

  // ================================================================ xuất file
  /** data = {name, sheets:[{name, headers, rows}]}. kind: csv | xlsx | xlsx-pw | enc */
  async function exportData(data, kind) {
    const T = G.lib.table;
    const base = (data.name || "du_lieu").replace(/\.(csv|xlsx)$/i, "");
    if (G.track) G.track(null, "export", `${{ csv: "CSV", xlsx: "Excel", "xlsx-pw": "Excel có mật khẩu", enc: "file mã hoá" }[kind] || kind} · ${base}`);
    if (kind === "csv") {
      const s = data.sheets[0];
      return download(base + ".csv", T.toCSV(s.headers, s.rows));
    }
    let password = null;
    if (kind === "xlsx-pw") {
      password = await askPassword({ title: "Excel có mật khẩu", note: "Excel sẽ hỏi mật khẩu khi mở file (mã hoá AES-256 chuẩn Office)." });
      if (!password) return;
    }
    let encPw = null;
    if (kind === "enc") {
      encPw = await askPassword({ title: "File mã hoá tự giải mã", note: "Tạo 1 file <b>.html</b>: người nhận mở bằng trình duyệt, nhập mật khẩu là tải được file Excel gốc. Mã hoá AES-256-GCM, chạy hoàn toàn trên máy." });
      if (!encPw) return;
    }
    const r = await G.api("export/xlsx", { name: base + ".xlsx", sheets: data.sheets, password }, { raw: true });
    const blob = await r.blob();
    if (kind !== "enc") return download(base + ".xlsx", blob);
    const S = G.lib.secure;
    const pkg = await S.encrypt(new Uint8Array(await blob.arrayBuffer()), encPw,
      { name: base + ".xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    download(base + ".xlsx.gdk.html", S.toHtml(pkg), "text/html;charset=utf-8");
    toast("Đã tạo file mã hoá — gửi file, còn mật khẩu gửi qua kênh khác.", "ok");
  }

  /** Gắn menu “Xuất” vào nút: CSV / Excel / Excel có mật khẩu / File mã hoá. getData() → data. */
  function exportMenu(btn, getData, opts = {}) {
    btn.innerHTML = `${icon("download")} ${esc(opts.label || "Xuất")} ${icon("chevron-down")}`;
    btn.onclick = (e) => {
      e.stopPropagation();
      document.querySelectorAll(".menu-pop").forEach((m) => m.remove());
      const items = [
        ["csv", "sheet", "CSV", "mở bằng Excel / Sheets"],
        ["xlsx", "sheet", "Excel (.xlsx)", "có định dạng, cố định dòng tiêu đề"],
        ["xlsx-pw", "key", "Excel có mật khẩu", "Excel hỏi mật khẩu khi mở"],
        ["enc", "lock", "File mã hoá (.html)", "người nhận chỉ cần trình duyệt + mật khẩu"],
      ].filter(([k]) => !(opts.hide || []).includes(k));
      const pop = document.createElement("div");
      pop.className = "menu-pop";
      pop.innerHTML = items.map(([k, ic, t, d]) => `<button data-k="${k}">${icon(ic)}<span><b>${t}</b><small>${d}</small></span></button>`).join("");
      document.body.appendChild(pop);
      const r = btn.getBoundingClientRect();
      pop.style.top = Math.min(r.bottom + 6, window.innerHeight - pop.offsetHeight - 8) + "px";
      pop.style.left = Math.max(8, Math.min(r.right - pop.offsetWidth, window.innerWidth - pop.offsetWidth - 8)) + "px";
      const off = () => { pop.remove(); document.removeEventListener("click", off); };
      setTimeout(() => document.addEventListener("click", off), 0);
      pop.onclick = async (ev) => {
        const b = ev.target.closest("button[data-k]");
        if (!b) return;
        off();
        const data = getData();
        if (!data) return toast("Chưa có dữ liệu để xuất.", "bad");
        btn.disabled = true;
        try { await exportData(data, b.dataset.k); }
        catch (err) { toast(err.message, "bad"); }
        finally { btn.disabled = false; }
      };
    };
  }

  /** Ô nhập văn bản (JSON…): dán hoặc thả file. opts {placeholder, accept, onChange, label} */
  function textDrop(textarea, onLoaded) {
    textarea.ondragover = (e) => { e.preventDefault(); textarea.classList.add("over"); };
    textarea.ondragleave = () => textarea.classList.remove("over");
    textarea.ondrop = async (e) => {
      e.preventDefault(); textarea.classList.remove("over");
      const f = e.dataTransfer.files[0];
      if (!f) return;
      textarea.value = await f.text();
      onLoaded && onLoaded(f.name);
    };
  }

  // ================================================================ ghép cột
  /** fields [{key,label,required,hint}], headers, map → vẽ lại khi đổi. onChange(map) */
  function mapper(el, { fields, headers, map, onChange, auto }) {
    let open = fields.some((f) => f.required && !map[f.key]);
    function draw() {
      const found = fields.filter((f) => map[f.key]).length;
      const missing = fields.filter((f) => f.required && !map[f.key]);
      el.innerHTML = `
        <div class="map-head">
          <span class="badge ${missing.length ? "bad" : "ok"}">${icon(missing.length ? "alert" : "check")}${missing.length ? "Thiếu cột bắt buộc: " + missing.map((f) => f.label).join(", ") : "Đã nhận " + found + "/" + fields.length + " cột"}</span>
          <button class="btn sm ghost" data-act="toggle">${open ? "Thu gọn" : "Xem / sửa cột"} ${icon(open ? "chevron-down" : "chevron-right")}</button>
        </div>
        <div class="map-grid" ${open ? "" : "hidden"}>
          ${fields.map((f) => `<label class="map-row">
            <span class="map-lbl">${esc(f.label)}${f.required ? ' <span class="req">*</span>' : ""}${f.hint ? `<small>${esc(f.hint)}</small>` : ""}</span>
            <select data-k="${f.key}"><option value="">— không có —</option>${headers.map((h) => `<option ${map[f.key] === h ? "selected" : ""}>${esc(h)}</option>`).join("")}</select>
            <span class="map-st">${map[f.key] ? (auto && auto[f.key] === map[f.key] ? `<span class="mini l">tự nhận</span>` : `<span class="mini m">đã chọn</span>`) : f.required ? `<span class="mini bad">thiếu</span>` : ""}</span>
          </label>`).join("")}
        </div>`;
      el.querySelector('[data-act="toggle"]').onclick = () => { open = !open; draw(); };
      el.querySelectorAll("select[data-k]").forEach((s) => s.onchange = () => { map[s.dataset.k] = s.value; draw(); onChange(map); });
    }
    draw();
  }

  // ================================================================ bảng sắp xếp được
  /** columns [{key,label,fmt(v,row),align:'r',sort:fn|true,cls(row),title}] rows [], opts {max, rowClass(row), empty} */
  function table(el, columns, rows, opts = {}) {
    let sortKey = opts.sortKey || null, dir = opts.sortDir || 1;
    function draw() {
      let list = rows.slice();
      if (sortKey) {
        const c = columns.find((x) => x.key === sortKey);
        const val = (r) => (c && typeof c.sortVal === "function" ? c.sortVal(r) : r[sortKey]);
        list.sort((a, b) => {
          const x = val(a), y = val(b);
          if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
          return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "vi", { numeric: true })) * dir;
        });
      }
      const max = opts.max || 2000, shown = list.slice(0, max);
      el.innerHTML = `<div class="tbl-wrap" ${opts.height ? `style="max-height:${opts.height}px"` : ""}><table class="tbl"><thead><tr>${columns.map((c) =>
        `<th class="${c.align === "r" ? "r" : ""} ${c.sort === false ? "" : "sortable"}" data-k="${c.key}" ${c.title ? `title="${esc(c.title)}"` : ""}>${esc(c.label)}${sortKey === c.key ? (dir > 0 ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead>
        <tbody>${shown.map((r) => `<tr class="${opts.rowClass ? opts.rowClass(r) : ""}">${columns.map((c) => {
          const v = r[c.key];
          return `<td class="${c.align === "r" ? "r num" : ""} ${c.cls ? c.cls(r) : ""}">${c.fmt ? c.fmt(v, r) : esc(v == null ? "—" : v)}</td>`;
        }).join("")}</tr>`).join("")}</tbody></table>
        ${shown.length ? "" : `<div class="empty">${esc(opts.empty || "Không có dòng nào.")}</div>`}</div>
        ${list.length > max ? `<p class="hint">Đang hiện ${max}/${list.length} dòng — xuất CSV để xem đủ.</p>` : ""}`;
      el.querySelectorAll("th.sortable").forEach((th) => th.onclick = () => {
        if (sortKey === th.dataset.k) dir = -dir; else { sortKey = th.dataset.k; dir = 1; }
        draw();
      });
    }
    draw();
  }

  // ================================================================ biểu đồ
  const SERIES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)"];
  function niceStep(range, count) {
    const raw = range / Math.max(1, count), p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  function ticks(lo, hi, count) {
    const st = niceStep(hi - lo || 1, count), out = [];
    for (let v = Math.ceil(lo / st) * st; v <= hi + st * 1e-9; v += st) out.push(+v.toFixed(10));
    return out;
  }
  const svgEl = (tag, attrs) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(" ")}/>`;

  /**
   * Biểu đồ đường có tooltip theo trục x. o = {
   *   series:[{name, points:[{x,y}], color?}], height, yMin, yMax, yFormat, xFormat, xLabel,
   *   markers:[{x, y, label, kind:'bad'|'warn'|'acc'}], bands:[{y0,y1,cls,label}], ref:{y,label},
   *   tooltipExtra(x) -> html, onClick(x)
   * }
   */
  function lineChart(el, o) {
    const ser = (o.series || []).slice(0, 4).map((s, i) => Object.assign({ color: SERIES[i] }, s));
    el.classList.add("chart");
    const legend = ser.length >= 2 ? `<div class="legend">${ser.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}</div>` : "";
    el.innerHTML = legend + `<div class="chart-box"><svg></svg><div class="chart-tip" hidden></div></div>`;
    const box = el.querySelector(".chart-box"), svg = el.querySelector("svg"), tip = el.querySelector(".chart-tip");
    const H = o.height || 260, pad = { l: 46, r: 14, t: 16, b: 30 };
    const all = ser.flatMap((s) => s.points.filter((p) => p.y != null && isFinite(p.y)));
    if (!all.length) { box.innerHTML = `<div class="empty">Chưa có dữ liệu để vẽ.</div>`; return; }
    const xs = [...new Set(all.map((p) => p.x))].sort((a, b) => a - b);
    const xMin = xs[0], xMax = xs[xs.length - 1] === xMin ? xMin + 1 : xs[xs.length - 1];
    const [lo, hi] = G.lib.table.extent(all.map((p) => p.y));
    let yMin = o.yMin != null ? o.yMin : Math.min(0, lo);
    let yMax = o.yMax != null ? o.yMax : hi;
    if (o.yMax == null) yMax = yMax + (yMax - yMin) * 0.08 || 1;
    const yt = ticks(yMin, yMax, 5);
    if (o.yMax == null) yMax = Math.max(yMax, yt[yt.length - 1]);
    const yf = o.yFormat || ((v) => String(v)), xf = o.xFormat || ((v) => String(v));

    function draw() {
      const W = Math.max(280, box.clientWidth);
      const X = (x) => pad.l + (W - pad.l - pad.r) * (x - xMin) / (xMax - xMin);
      const Y = (y) => pad.t + (H - pad.t - pad.b) * (1 - (y - yMin) / (yMax - yMin));
      let g = "";
      for (const b of o.bands || []) g += svgEl("rect", { class: "band " + (b.cls || ""), x: pad.l, width: W - pad.l - pad.r, y: Y(Math.min(b.y1, yMax)), height: Math.max(0, Y(Math.max(b.y0, yMin)) - Y(Math.min(b.y1, yMax))) });
      for (const t of yt) g += svgEl("line", { class: "grid", x1: pad.l, x2: W - pad.r, y1: Y(t), y2: Y(t) }) + `<text class="ax" x="${pad.l - 8}" y="${Y(t) + 4}" text-anchor="end">${esc(yf(t))}</text>`;
      const xt = ticks(xMin, xMax, Math.max(2, Math.floor((W - pad.l - pad.r) / 70)));
      for (const t of xt) g += `<text class="ax" x="${X(t)}" y="${H - 9}" text-anchor="middle">${esc(xf(t))}</text>`;
      if (o.xLabel) g += `<text class="ax lbl" x="${W - pad.r}" y="${H - 9}" text-anchor="end">${esc(o.xLabel)}</text>`;
      if (o.ref) g += svgEl("line", { class: "ref", x1: pad.l, x2: W - pad.r, y1: Y(o.ref.y), y2: Y(o.ref.y) }) + (o.ref.label ? `<text class="ax" x="${W - pad.r}" y="${Y(o.ref.y) - 5}" text-anchor="end">${esc(o.ref.label)}</text>` : "");
      for (const s of ser) {
        let d = "", pen = false;
        for (const p of s.points) {
          if (p.y == null || !isFinite(p.y)) { pen = false; continue; }
          d += (pen ? "L" : "M") + X(p.x).toFixed(1) + " " + Y(p.y).toFixed(1); pen = true;
        }
        g += `<path class="ln ${s.dash ? "dash" : ""}" d="${d}" style="stroke:${s.color}"/>`;
        if (s.points.length <= 40) for (const p of s.points) if (p.y != null) g += `<circle class="pt" cx="${X(p.x)}" cy="${Y(p.y)}" r="2.5" style="fill:${s.color}"/>`;
      }
      for (const m of o.markers || []) {
        if (m.y == null) continue;
        g += `<circle class="mk ${m.kind || "bad"}" cx="${X(m.x)}" cy="${Y(m.y)}" r="5.5"/>`;
        if (m.label) {
          const w = m.label.length * 6.6 + 12, x = Math.min(Math.max(X(m.x), pad.l + w / 2), W - pad.r - w / 2), y = Math.max(Y(m.y) - 18, pad.t + 8);
          g += `<g class="mk-tag ${m.kind || "bad"}"><rect x="${x - w / 2}" y="${y - 9}" width="${w}" height="17" rx="8.5"/><text x="${x}" y="${y + 3.5}" text-anchor="middle">${esc(m.label)}</text></g>`;
        }
      }
      g += `<line class="cross" x1="0" x2="0" y1="${pad.t}" y2="${H - pad.b}" visibility="hidden"/><g class="hov"></g>`;
      g += svgEl("rect", { class: "hit", x: pad.l, y: pad.t, width: W - pad.l - pad.r, height: H - pad.t - pad.b });
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      svg.setAttribute("height", H);
      svg.innerHTML = g;
      const hit = svg.querySelector(".hit"), cross = svg.querySelector(".cross"), hov = svg.querySelector(".hov");
      const pick = (ev) => {
        const r = svg.getBoundingClientRect();
        const px = (ev.clientX - r.left) * (W / r.width);
        const xv = xMin + (px - pad.l) / (W - pad.l - pad.r) * (xMax - xMin);
        let best = xs[0];
        for (const x of xs) if (Math.abs(x - xv) < Math.abs(best - xv)) best = x;
        return best;
      };
      hit.onmousemove = (ev) => {
        const x = pick(ev);
        cross.setAttribute("x1", X(x)); cross.setAttribute("x2", X(x)); cross.setAttribute("visibility", "visible");
        let dots = "", lines = "";
        for (const s of ser) {
          const p = s.points.find((q) => q.x === x);
          if (!p || p.y == null) continue;
          dots += `<circle class="hv" cx="${X(x)}" cy="${Y(p.y)}" r="5" style="fill:${s.color}"/>`;
          lines += `<div class="tl"><i style="background:${s.color}"></i><span>${esc(s.name)}</span><b>${esc(yf(p.y))}</b></div>`;
        }
        hov.innerHTML = dots;
        tip.innerHTML = `<div class="th">${esc(xf(x, true))}</div>${lines}${o.tooltipExtra ? o.tooltipExtra(x) || "" : ""}`;
        tip.hidden = false;
        const bw = box.clientWidth, left = X(x) * (bw / W);
        tip.style.left = (left + 14 + tip.offsetWidth > bw ? Math.max(0, left - tip.offsetWidth - 14) : left + 14) + "px";
        tip.style.top = "8px";
      };
      hit.onmouseleave = () => { cross.setAttribute("visibility", "hidden"); hov.innerHTML = ""; tip.hidden = true; };
      if (o.onClick) { hit.style.cursor = "pointer"; hit.onclick = (ev) => o.onClick(pick(ev)); }
    }
    draw();
    const ro = new ResizeObserver(() => draw());
    ro.observe(box);
    return { destroy: () => ro.disconnect() };
  }

  /** Biểu đồ khoảng tin cậy (forest). rows [{label, sub, est, lo, hi, status, tip}] — giá trị là % tương đối. */
  function forest(el, rows, opts = {}) {
    el.classList.add("chart");
    el.innerHTML = `<div class="chart-box"><svg></svg><div class="chart-tip" hidden></div></div>`;
    const box = el.querySelector(".chart-box"), svg = el.querySelector("svg"), tip = el.querySelector(".chart-tip");
    const rowH = 38, padT = 10, padB = 28, labW = Math.min(200, Math.max(120, ...rows.map((r) => (r.label.length + 2) * 7.2)));
    const H = padT + padB + rows.length * rowH;
    const ext = Math.max(0.02, ...rows.flatMap((r) => [Math.abs(r.lo ?? r.est ?? 0), Math.abs(r.hi ?? r.est ?? 0)])) * 1.15;
    function draw() {
      const W = Math.max(320, box.clientWidth), valW = 132;
      const X = (v) => labW + (W - labW - valW) * (v + ext) / (2 * ext);
      let g = "";
      for (const t of ticks(-ext, ext, 4)) {
        g += svgEl("line", { class: t === 0 ? "zero" : "grid", x1: X(t), x2: X(t), y1: padT, y2: H - padB });
        g += `<text class="ax" x="${X(t)}" y="${H - 8}" text-anchor="middle">${esc(fmt.spct(t, 0).replace("+0%", "0%").replace("−0%", "0%"))}</text>`;
      }
      rows.forEach((r, i) => {
        const y = padT + rowH * i + rowH / 2, cls = r.status || "mid";
        g += `<text class="fl" x="0" y="${y + 1}">${esc(r.label)}</text>${r.sub ? `<text class="fs" x="0" y="${y + 14}">${esc(r.sub)}</text>` : ""}`;
        if (r.lo != null) {
          g += `<line class="ci ${cls}" x1="${X(r.lo)}" x2="${X(r.hi)}" y1="${y}" y2="${y}"/>`;
          g += `<line class="ci ${cls}" x1="${X(r.lo)}" x2="${X(r.lo)}" y1="${y - 6}" y2="${y + 6}"/><line class="ci ${cls}" x1="${X(r.hi)}" x2="${X(r.hi)}" y1="${y - 6}" y2="${y + 6}"/>`;
        }
        if (r.est != null) g += `<circle class="dot ${cls}" cx="${X(Math.max(-ext, Math.min(ext, r.est)))}" cy="${y}" r="6"/>`;
        g += `<text class="fv" x="${W}" y="${y + 1}" text-anchor="end">${esc(fmt.spct(r.est))}</text>`;
        if (r.lo != null) g += `<text class="fs" x="${W}" y="${y + 14}" text-anchor="end">${esc(fmt.spct(r.lo) + " … " + fmt.spct(r.hi))}</text>`;
        g += svgEl("rect", { class: "hit", "data-i": i, x: 0, y: y - rowH / 2, width: W, height: rowH });
      });
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("height", H);
      svg.innerHTML = g;
      svg.querySelectorAll(".hit").forEach((h) => {
        h.onmousemove = (ev) => {
          const r = rows[+h.dataset.i];
          if (!r.tip) return;
          tip.innerHTML = r.tip; tip.hidden = false;
          const b = box.getBoundingClientRect();
          tip.style.left = Math.min(ev.clientX - b.left + 14, b.width - tip.offsetWidth - 4) + "px";
          tip.style.top = Math.max(0, ev.clientY - b.top - tip.offsetHeight - 10) + "px";
        };
        h.onmouseleave = () => { tip.hidden = true; };
      });
    }
    draw();
    const ro = new ResizeObserver(() => draw());
    ro.observe(box);
    return { destroy: () => ro.disconnect() };
  }

  /** Thanh ngang phân bố (vd số level mỗi mức khó). items [{label, value, cls}] */
  function bars(items, total) {
    total = total || items.reduce((s, x) => s + x.value, 0) || 1;
    return `<div class="dist">${items.map((x) => `<div class="dist-row"><span class="dl">${esc(x.label)}</span>
      <span class="dtrack"><i class="${x.cls || ""}" style="width:${(x.value / total * 100).toFixed(1)}%"></i></span>
      <span class="dv">${fmt.int(x.value)} <small>${fmt.pct(x.value / total)}</small></span></div>`).join("")}</div>`;
  }

  // ================================================================ khối hiển thị
  const tiles = (items) => `<div class="stats">${items.map((t) => `<div class="stat ${t.cls || ""}" ${t.title ? `title="${esc(t.title)}"` : ""}><b>${t.n}</b><span>${esc(t.label)}</span>${t.sub ? `<small>${esc(t.sub)}</small>` : ""}</div>`).join("")}</div>`;
  const verdict = (kind, title, detail, side) => `<div class="verdict ${kind === "ok" || kind === "win" ? "ok" : kind === "bad" || kind === "lose" ? "bad" : "mid"}">
    ${icon(kind === "ok" || kind === "win" ? "check" : kind === "bad" || kind === "lose" ? "alert" : "info")}
    <div><div>${esc(title)}</div>${detail ? `<div class="vd">${esc(detail)}</div>` : ""}</div>${side ? `<span class="sm">${esc(side)}</span>` : ""}</div>`;
  const issueList = (issues) => issues.length ? `<div class="issues">${issues.map((x) => `<div class="issue ${x.level}">
      <span class="lv">${icon(x.level === "bad" ? "alert" : x.level === "warn" ? "alert" : x.level === "ok" ? "check" : "info")}</span>
      <div><div class="it">${esc(x.title)}${x.where ? ` <code>${esc(x.where)}</code>` : ""}</div>${x.detail ? `<div class="id">${esc(x.detail)}</div>` : ""}</div></div>`).join("")}</div>`
    : `<div class="issues"><div class="issue ok"><span class="lv">${icon("check")}</span><div><div class="it">Không phát hiện vấn đề</div></div></div></div>`;

  /** Màn hình trống có minh hoạ + nút hành động. */
  const empty = ({ illus, title, text, actions }) => `<div class="empty-state">
      ${illus ? `<div class="es-icon" data-illus="${esc(illus)}" title="Giữ chuột để xem ảnh minh hoạ">${icon("image")}</div>` : ""}
      <div class="es-t">${esc(title)}</div>${text ? `<div class="es-d">${text}</div>` : ""}
      ${actions ? `<div class="row" style="justify-content:center;margin-top:12px">${actions}</div>` : ""}</div>`;

  G.kit = { fmt, download, copy, readTable, importer, textDrop, mapper, table, lineChart, forest, bars, tiles, verdict, issueList, empty, SERIES,
    askPassword, passwordStrength, genPassword, exportData, exportMenu };
})();

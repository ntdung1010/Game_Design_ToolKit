/* Level Stuck — kiểm tra level có bị kẹt không bằng chính luật game (lõi: web/lib/stuckkit.js, chạy trong Web Worker
   web/lib/stuck-worker.js nên trang không đơ). File level không rời khỏi máy. Kèm gói phương pháp .md
   (web/docs/check-level-stuck.md) để team tải về, điền thông tin game rồi prompt Claude dựng checker riêng. */
(() => {
  "use strict";
  const { $, $$, esc, icon, toast, store } = GDK;
  const K = GDK.kit, LK = GDK.lib.levelkit, LA = GDK.lib.leveladapters, SK = GDK.lib.stuckkit;
  const V = SK.VERDICT;
  const LEVEL_EXT = /\.(txt|json)$/i;
  const PRESETS = {
    fast: { label: "Nhanh", nodes: 60000, timeMs: 4000, hint: "60.000 trạng thái · 4 giây / level" },
    deep: { label: "Kỹ", nodes: 400000, timeMs: 20000, hint: "400.000 trạng thái · 20 giây / level (khuyên dùng)" },
    max: { label: "Rất kỹ", nodes: 2000000, timeMs: 90000, hint: "2 triệu trạng thái · 90 giây / level — cho level báo KẸT do hết ngân sách" },
  };
  const VCLS = { [V.OK]: "ok", [V.WARN]: "warn", [V.PROVEN]: "bad", [V.STUCK]: "bad", [V.ERR]: "bad", [V.SKIP]: "" };
  const ORDER = [V.PROVEN, V.STUCK, V.ERR, V.WARN, V.SKIP, V.OK];
  const DOC = "docs/check-level-stuck.md";
  const FORM = [
    ["game", "Tên game", "vd: Bird Sort Hyper Puzzle — BSHP"],
    ["engine", "Engine / ngôn ngữ", "vd: Unity C#"],
    ["project", "Thư mục project", "vd: D:\\1_Project\\bird-sort-puzzle"],
    ["levels", "Thư mục / định dạng level", "vd: Assets/EncryptedAsset/LevelData/v4/level-NNNN.json; level N = vị trí N trong LevelConfig_v4.asset"],
    ["code", "File luật chơi chính", "vd: BirdSortBoard.cs, OrderSelector.cs"],
    ["mech", "Cơ chế cần port", "vd: trứng ẩn, băng, dây leo, chìa khoá, lồng"],
    ["winlose", "Thắng / thua", "vd: thắng khi mọi chim có tổ; thua khi đầy hàng chờ 5 ô"],
    ["random", "Random trong lúc chơi", "vd: order rút ngẫu nhiên theo bảng độ khó → cần nhiều seed"],
    ["boost", "Booster / ads / revive", "vd: 2 tổ sau khoá bằng ads → biến thể thêm tài nguyên"],
    ["set", "Bộ level cần kiểm", "vd: v4 cả bộ, hoặc level 1–200"],
    ["positive", "Level chắc chắn thắng được (đối chứng dương)", "vd: 1–10 tutorial, level có win > 0 trên data live"],
  ];
  const session = (GDK.session = GDK.session || {});

  GDK.tools["level-stuck"] = { mount };

  function mount(root) {
    const keep = session["level-stuck"] || {};
    const S = {
      levels: keep.levels || [], label: keep.label || "", skipped: keep.skipped || [], results: keep.results || new Map(),
      post: keep.post || null, sum: keep.sum || null, opts: Object.assign({ preset: "deep", engine: "auto", range: "", positive: "", extra: "ads" }, store.get("gdk.stuck.opts", {})),
      running: false, pool: [], filter: "bad", sel: null, form: store.get("gdk.stuck.form", {}),
    };
    const save = () => { session["level-stuck"] = { levels: S.levels, label: S.label, skipped: S.skipped, results: S.results, post: S.post, sum: S.sum }; };
    root.innerHTML = `
      <section class="panel">
        <div class="ph"><span class="step">1</span><h2>Nạp level</h2><span class="sub">file không rời khỏi máy · CDS (B / C / BIM), level chuẩn Toolkit, water sort đơn giản</span></div>
        <div class="pb"><div id="stSrc"></div>
          <div class="st-opts">
            <div><label class="lb">Luật chơi</label><select id="stEngine">
              <option value="auto">Tự nhận (file CDS → luật CDS, còn lại → water sort)</option>
              <option value="cds">Chaos Drink Sort (Bottle.cs / InGameGroup.cs)</option>
              <option value="watersort">Water sort cơ bản (không cơ chế)</option></select></div>
            <div><label class="lb">Độ kỹ</label><div class="seg" id="stPreset">${Object.entries(PRESETS).map(([k, p]) => `<button data-k="${k}" title="${esc(p.hint)}">${p.label}</button>`).join("")}</div></div>
            <div><label class="lb">Level cần kiểm</label><input type="search" id="stRange" placeholder="tất cả · vd 1-30, 45" value="${esc(S.opts.range)}"></div>
            <div><label class="lb" title="Hậu kiểm V7: các level này phải ra OK, nếu không là port sai luật">Level chắc chắn thắng được</label><input type="search" id="stPos" placeholder="vd 1-10 (tutorial)" value="${esc(S.opts.positive)}"></div>
          </div>
          <p class="hint" id="stPresetHint"></p>
          <div class="row" style="margin-top:12px"><button class="btn primary" id="stRun" disabled>${icon("play")} Kiểm tra</button>
            <button class="btn" id="stStop" hidden>${icon("stop")} Dừng</button><span class="grow"></span><span class="hint" id="stRunInfo" style="margin:0"></span></div>
          <div id="stProg"></div>
        </div>
      </section>
      <section class="panel" id="stRes" hidden>
        <div class="ph"><span class="step">2</span><h2>Kết quả</h2><span class="sub" id="stResSub"></span>
          <div class="right"><button class="btn sm" id="stExp">${icon("download")} Xuất</button></div></div>
        <div class="pb"><div id="stSum"></div><div id="stTable"></div><div id="stDetail"></div></div>
      </section>
      <section class="panel">
        <div class="ph"><span class="ibox sm">${icon("doc")}</span><h2>Game khác? Gói phương pháp .md</h2><span class="sub">tải về → điền thông tin game → prompt Claude dựng checker riêng</span>
          <div class="right"><button class="btn sm ghost" id="stMdTog">${icon("chevron-down")} Mở</button></div></div>
        <div class="pb" id="stMd" hidden></div>
      </section>`;
    const el = (s) => $(s, root);

    // ------------------------------------------------------------------ tuỳ chọn
    const saveOpts = () => store.set("gdk.stuck.opts", S.opts);
    el("#stEngine").value = S.opts.engine;
    el("#stEngine").onchange = (e) => { S.opts.engine = e.target.value; saveOpts(); reassign(); drawSrc(); };
    const drawPreset = () => {
      $$("#stPreset button", root).forEach((b) => b.classList.toggle("on", b.dataset.k === S.opts.preset));
      el("#stPresetHint").innerHTML = `${esc(PRESETS[S.opts.preset].hint)} · chạy song song ${poolSize()} luồng. Bộ giải biết màu ô ẩn và chơi tối ưu: <b>OK = giải được, không có nghĩa là dễ</b>.`;
    };
    $$("#stPreset button", root).forEach((b) => b.onclick = () => { S.opts.preset = b.dataset.k; saveOpts(); drawPreset(); });
    el("#stRange").oninput = (e) => { S.opts.range = e.target.value; saveOpts(); drawSrc(); };
    el("#stPos").oninput = (e) => { S.opts.positive = e.target.value; saveOpts(); };
    drawPreset();

    // ------------------------------------------------------------------ nạp file
    function drawSrc() {
      const box = el("#stSrc");
      if (!S.levels.length) {
        box.innerHTML = `<label class="dz" tabindex="0"><input type="file" multiple hidden accept=".txt,.json">
            <span class="dz-ic">${icon("folder")}</span><span class="dz-t">Kéo thả thư mục level vào đây</span>
            <span class="dz-s">hoặc <u>chọn file</u> · .txt / .json · bỏ qua .meta và file khác</span></label>
          <input type="file" webkitdirectory hidden data-dir>
          <div class="dz-alt"><button class="btn sm" data-act="dir">${icon("folder")} Chọn thư mục</button>
            <button class="btn sm ghost" data-act="sample">${icon("flask")} Thử với 8 level mẫu CDS</button></div>`;
        const dz = box.querySelector(".dz"), fin = box.querySelector('input[type=file]:not([data-dir])'), din = box.querySelector("[data-dir]");
        fin.onchange = () => fin.files.length && load([...fin.files].map((f) => ({ file: f, path: f.name })), fin.files.length === 1 ? fin.files[0].name : "Nhiều file");
        din.onchange = () => din.files.length && load([...din.files].map((f) => ({ file: f, path: f.webkitRelativePath || f.name })), (din.files[0].webkitRelativePath || "").split("/")[0] || "Thư mục");
        box.querySelector('[data-act="dir"]').onclick = () => din.click();
        box.querySelector('[data-act="sample"]').onclick = sample;
        dz.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fin.click(); } };
        dz.ondragover = (e) => { e.preventDefault(); dz.classList.add("over"); };
        dz.ondragleave = () => dz.classList.remove("over");
        dz.ondrop = async (e) => {
          e.preventDefault(); dz.classList.remove("over");
          try { const { items, label } = await fromDrop(e.dataTransfer); items.length ? load(items, label) : toast("Không thấy file .txt / .json nào.", "bad"); }
          catch (err) { toast(err.message, "bad"); }
        };
        el("#stRun").disabled = true;
        return;
      }
      const sel = selected();
      const by = {};
      for (const l of S.levels) by[l.engine] = (by[l.engine] || 0) + 1;
      box.innerHTML = `<div class="file-chip"><span class="ibox sm">${icon("folder")}</span>
          <div class="fc-main"><b>${esc(S.label)}</b><span>${K.fmt.int(S.levels.length)} level · ${Object.entries(by).map(([k, n]) => `${n} theo luật ${esc(SK.ENGINES[k].name)}`).join(" · ")}${S.skipped.length ? ` · bỏ qua ${S.skipped.length} file không phải level` : ""}</span></div>
          <button class="icon-btn" data-act="clear" title="Bỏ bộ level này">${icon("x")}</button></div>
        ${sel.length !== S.levels.length ? `<p class="hint">Sẽ kiểm ${sel.length}/${S.levels.length} level theo ô “Level cần kiểm”.</p>` : ""}
        ${S.skipped.length ? `<details class="hint"><summary>File bị bỏ qua (${S.skipped.length})</summary>${S.skipped.slice(0, 30).map((s) => `<div>${esc(s)}</div>`).join("")}</details>` : ""}`;
      box.querySelector('[data-act="clear"]').onclick = () => { stop(); S.levels = []; S.results = new Map(); S.post = S.sum = null; S.sel = null; save(); drawSrc(); drawRes(); };
      el("#stRun").disabled = S.running || !sel.length;
      el("#stRunInfo").textContent = sel.length ? `${sel.length} level sẵn sàng` : "Không level nào khớp ô lọc";
    }
    function selected() {
      const f = LK.parseRange(S.opts.range) || (() => true);
      return S.levels.filter((l) => l.num == null || f(l.num));
    }
    async function fromDrop(dt) {
      const entries = [...(dt.items || [])].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
      if (!entries.length) return { items: [...dt.files].map((f) => ({ file: f, path: f.name })), label: dt.files.length === 1 ? dt.files[0].name : "Nhiều file" };
      const items = [];
      const walk = async (entry, prefix) => {
        if (items.length > 20000) return;
        if (entry.isFile) {
          if (!LEVEL_EXT.test(entry.name)) return;
          items.push({ file: await new Promise((ok, fail) => entry.file(ok, fail)), path: prefix + entry.name });
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
      return { items, label: entries.length === 1 ? entries[0].name : entries.length + " mục" };
    }
    async function load(items, label) {
      if (S.running) return toast("Đang kiểm — dừng trước đã.", "bad");
      const levels = [], skipped = [];
      el("#stSrc").innerHTML = `<div class="dz busy"><span class="spin"></span><span>Đang đọc ${K.fmt.int(items.length)} file…</span></div>`;
      for (const it of items.filter((x) => LEVEL_EXT.test(x.path) && x.file.size < 8e6)) {
        const name = it.path.split("/").pop();
        let j;
        try { j = LK.parseJSON(await it.file.text()); } catch (e) { skipped.push(name + " — không phải JSON"); continue; }
        try { levels.push(...toLevels(j, name, it.path)); } catch (e) { skipped.push(name + " — " + e.message); }
      }
      levels.sort((a, b) => (a.num ?? 1e9) - (b.num ?? 1e9) || a.name.localeCompare(b.name, "vi", { numeric: true }));
      Object.assign(S, { levels, skipped, label, results: new Map(), post: null, sum: null, sel: null });
      reassign(); save(); drawSrc(); drawRes();
      if (!levels.length) toast("Không thấy file level nào đọc được.", "bad");
      else toast(`Đã nạp ${levels.length} level.`, "ok");
    }
    /** 1 file → các level {name, num, raw, std}: file CDS giữ JSON thô (luật CDS cần chìa / order…), file khác đổi về level chuẩn. */
    function toLevels(j, name, path) {
      const num = (LK.numberFromName(name) || {}).n ?? null;
      if (LA.isRuntime(j)) return [{ name, path, num, raw: j }];
      const { adapter, score } = LK.detect(j, name);
      if (!adapter || score < 0.3 || adapter.kind === "auto") throw new Error("không nhận ra định dạng level");
      const list = adapter.parse(j, name);
      return list.map((lv, i) => ({ name: list.length > 1 ? `${name} #${i + 1}` : name, path, num: lv.level ?? num, std: lv }));
    }
    /** Gán luật chơi cho từng level theo ô "Luật chơi". */
    function reassign() {
      for (const l of S.levels) {
        const want = S.opts.engine === "auto" ? (l.raw ? "cds" : "watersort") : S.opts.engine;
        l.engine = want === "cds" && !l.raw ? "watersort" : want;
        if (l.engine === "watersort" && !l.std && l.raw) {
          const cds = LK.adapters.find((a) => a.id === "cds");
          try { l.std = cds.parse(l.raw, l.name)[0]; } catch (e) { l.std = null; }
        }
        l.data = l.engine === "cds" ? l.raw : l.std;
        l.pal = palette(l);
      }
    }
    function palette(l) {
      if (l.engine === "cds") {
        const order = (l.raw.B || []).flatMap((b) => (b.C || []).map((w) => w && w.BIM && w.BIM.CI));
        const pal = LA.paletteByAppearance(order.concat(l.raw.lstOrderCI || []));
        return (c) => pal[c] || LK.COLORS[c % LK.COLORS.length];
      }
      const map = l.std ? LK.colorMap(l.std) : {};
      const names = [];
      if (l.std) for (const ct of l.std.containers) for (const it of ct.items) if (!names.includes(String(it.c))) names.push(String(it.c));
      return (c) => map[names[c]] || LK.COLORS[c % LK.COLORS.length];
    }
    function sample() {
      const items = SK.sampleSet().map((s) => ({ name: s.name, path: s.name, num: (LK.numberFromName(s.name) || {}).n, raw: s.json }));
      Object.assign(S, { levels: items, skipped: [], label: "8 level mẫu CDS", results: new Map(), post: null, sum: null, sel: null });
      S.opts.range = ""; el("#stRange").value = "";
      if (!S.opts.positive) { S.opts.positive = "1-3"; el("#stPos").value = "1-3"; }
      reassign(); save(); drawSrc(); drawRes();
      run();
    }

    // ------------------------------------------------------------------ chạy song song
    function poolSize() { return Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1)); }
    function makeWorker() {
      const w = new Worker("lib/stuck-worker.js?v=" + GDK.version);
      w.jobs = new Map();
      w.onmessage = (e) => { const j = w.jobs.get(e.data.id); if (!j) return; w.jobs.delete(e.data.id); e.data.ok ? j.ok(e.data.out) : j.fail(new Error(e.data.message)); };
      w.onerror = (e) => { for (const j of w.jobs.values()) j.fail(new Error(e.message || "Worker lỗi")); w.jobs.clear(); };
      return w;
    }
    let jid = 0;
    const call = (w, msg) => new Promise((ok, fail) => { const id = ++jid; w.jobs.set(id, { ok, fail }); w.postMessage(Object.assign({ id }, msg)); });
    /** Chạy danh sách việc trên các worker, mỗi worker 1 việc 1 lúc. */
    async function runJobs(jobs, onDone) {
      let next = 0;
      const lane = async (w) => {
        while (S.running && next < jobs.length) {
          const job = jobs[next++];
          let out;
          try { out = await call(w, job.msg); } catch (e) { out = { error: e.message }; }
          if (!S.running) return;
          onDone(job, out);
        }
      };
      await Promise.all(S.pool.map(lane));
    }
    function stop() {
      S.running = false;
      for (const w of S.pool) w.terminate();
      S.pool = [];
      el("#stStop").hidden = true;
    }
    async function run() {
      if (S.running) return;
      const list = selected().filter((l) => l.data);
      if (!list.length) return toast("Không có level nào để kiểm.", "bad");
      try { S.pool = Array.from({ length: Math.min(poolSize(), list.length) }, makeWorker); }
      catch (e) { return toast("Trình duyệt không cho chạy Web Worker: " + e.message, "bad"); }
      S.running = true;
      const p = PRESETS[S.opts.preset];
      const opts = { nodes: p.nodes, timeMs: p.timeMs, extra: S.opts.extra, steps: false };
      S.runOpts = opts;
      S.results = new Map(); S.post = S.sum = null; S.sel = null;
      el("#stRun").disabled = true; el("#stStop").hidden = false;
      el("#stStop").onclick = () => { stop(); toast("Đã dừng — kết quả các level đã xong vẫn giữ.", "ok"); finish(list, false); };
      const t0 = performance.now();
      let done = 0, last = 0;
      const prog = (msg) => { el("#stProg").innerHTML = `<div class="prog"><i style="width:${Math.round(100 * done / list.length)}%"></i></div><p class="hint">${msg}</p>`; };
      prog(`Đang kiểm 0/${list.length} level…`);
      drawRes();
      await runJobs(list.map((l) => ({ l, msg: { type: "level", engine: l.engine, data: l.data, name: l.name, opts } })), (job, out) => {
        done++;
        S.results.set(job.l.name, out.error ? { name: job.l.name, verdict: V.ERR, note: "Worker lỗi: " + out.error, findings: [], ms: 0 } : out);
        prog(`Đã kiểm ${done}/${list.length} level · ${((performance.now() - t0) / 1000).toFixed(1).replace(".", ",")} giây`);
        if (performance.now() - last > 400 || done === list.length) { last = performance.now(); drawRes(); }
      });
      if (!S.running) return;
      prog(`Hậu kiểm: chạy lặp kiểm tất định, đối chứng âm…`);
      await postChecks(list, opts);
      finish(list, true, performance.now() - t0);
    }
    /** V5 tất định (chạy lại 3 level), V6 đối chứng âm (bản hỏng của 3 level OK), V7 đối chứng dương (level người dùng khai). */
    async function postChecks(list, opts) {
      const res = list.map((l) => ({ l, r: S.results.get(l.name) })).filter((x) => x.r);
      const pick = (arr, n) => (arr.length <= n ? arr : [arr[0], arr[Math.floor(arr.length / 2)], arr[arr.length - 1]]);
      const detCands = pick(res.filter((x) => x.r.strict && !x.r.strict.timedOut && !(x.r.extra && x.r.extra.timedOut) && x.r.verdict !== V.ERR), 3);
      const okCands = pick(res.filter((x) => x.r.verdict === V.OK), 3);
      const post = { determinism: [], controls: [], positives: [] };
      const jobs = detCands.map((x) => ({ kind: "det", x, msg: { type: "level", engine: x.l.engine, data: x.l.data, name: x.l.name, opts } }))
        .concat(okCands.map((x) => ({ kind: "ctl", x, msg: { type: "controls", engine: x.l.engine, data: x.l.data, name: x.l.name, opts: Object.assign({}, opts, { nodes: Math.min(opts.nodes, 150000) }) } })));
      await runJobs(jobs, (job, out) => {
        if (job.kind === "det") {
          const a = job.x.r, b = out;
          const same = !b.error && a.verdict === b.verdict && a.strict.nodes === b.strict.nodes && (a.solution ? a.solution.moves.length : -1) === (b.solution ? b.solution.moves.length : -1);
          post.determinism.push({ name: job.x.l.name, same });
        } else if (Array.isArray(out)) post.controls.push(...out);
      });
      const pf = S.opts.positive.trim() ? LK.parseRange(S.opts.positive) : null;
      if (pf) for (const x of res) if (x.l.num != null && pf(x.l.num)) post.positives.push({ name: x.l.name, good: !!(x.r.strict && x.r.strict.won), verdict: x.r.verdict });
      S.post = post;
    }
    function finish(list, complete, ms) {
      stop();
      const results = list.map((l) => S.results.get(l.name)).filter(Boolean);
      S.sum = SK.summarize(results, S.post || {});
      S.sum.complete = complete; S.sum.ms = ms || 0;
      el("#stProg").innerHTML = "";
      el("#stRun").disabled = false;
      save(); drawRes(); drawSrc();
      GDK.track && GDK.track("level-stuck", "run");
    }
    el("#stRun").onclick = run;

    // ------------------------------------------------------------------ kết quả
    function rows() {
      return S.levels.map((l) => ({ l, r: S.results.get(l.name) })).filter((x) => x.r);
    }
    function drawRes() {
      const box = el("#stRes");
      const rs = rows();
      box.hidden = !rs.length;
      if (!rs.length) return;
      const counts = {};
      for (const v of Object.values(V)) counts[v] = 0;
      for (const x of rs) counts[x.r.verdict]++;
      el("#stResSub").textContent = `${rs.length} level${S.running ? " · đang chạy…" : S.sum && S.sum.ms ? ` · ${(S.sum.ms / 1000).toFixed(1).replace(".", ",")} giây` : ""}`;
      const tile = (v, label, sub) => `<button class="stat ${VCLS[v] || ""} st-tile ${S.filter === v ? "on" : ""}" data-f="${esc(v)}"><b>${counts[v]}</b><span>${label}</span><small>${sub}</small></button>`;
      const bad = counts[V.PROVEN] + counts[V.STUCK] + counts[V.ERR] + counts[V.WARN];
      let html = `<div class="stats st-stats">
        ${tile(V.OK, "OK", "thắng được như ship")}${tile(V.WARN, "Cảnh báo", "cần ads / sai quy ước")}
        ${tile(V.PROVEN, "Kẹt chắc chắn", "lỗi data / duyệt hết")}${tile(V.STUCK, "Kẹt?", "hết ngân sách — chạy kỹ hơn")}
        ${tile(V.ERR, "Lỗi", "file / hậu kiểm")}${tile(V.SKIP, "Bỏ qua", "cơ chế chưa port")}</div>`;
      if (S.sum && !S.running) {
        const v = S.sum.verification, f = (p) => `${p[0]}/${p[1]}`;
        const chk = (ok, txt, title) => `<span class="badge ${ok ? "ok" : "bad"}" title="${esc(title)}">${icon(ok ? "check" : "alert")} ${txt}</span>`;
        html += `<div class="st-verify"><b>Hậu kiểm</b>
          ${chk(v.replay[0] === v.replay[1], "V4 chạy lại " + f(v.replay), "Mọi lời giải được chạy lại trên ván mới bằng khoá nước đi")}
          ${chk(v.determinism[0] === v.determinism[1], "V5 tất định " + f(v.determinism), "Chạy lặp vài level cùng tham số phải ra y hệt")}
          ${chk(v.controls[0] === v.controls[1] && v.controls[1] > 0, "V6 đối chứng âm " + f(v.controls), "Bản hỏng của level OK (bớt 1 ô, bỏ ống trống) phải bị bắt")}
          ${chk(v.positives[0] === v.positives[1], "V7 đối chứng dương " + f(v.positives), "Level khai là chắc thắng phải ra OK")}
          ${chk(!v.contradictions, "V8 " + (v.contradictions ? v.contradictions + " mâu thuẫn" : "không mâu thuẫn"), "Soát data nói không thắng được mà bộ giải vẫn thắng")}
          <span class="grow"></span><b class="${v.passed ? "st-pass" : "st-fail"}">${v.passed ? "ĐẠT" : "CHƯA ĐẠT — xem lại port trước khi tin kết luận"}</b></div>
          ${S.sum.warnings.map((w) => `<div class="note">${icon("info")}<div>${esc(w)}</div></div>`).join("")}
          ${S.sum.complete === false ? `<div class="note">${icon("info")}<div>Đã dừng giữa chừng — hậu kiểm chỉ tính trên các level đã xong.</div></div>` : ""}`;
      }
      if (bad === 0 && S.filter === "bad") S.filter = "all";
      const chips = [["bad", "Cần xem", bad], ["all", "Tất cả", rs.length]];
      html += `<div class="toolbar" style="margin-top:12px"><div class="lp-chips">${chips.map(([k, l, n]) => `<button class="chip ${S.filter === k ? "on" : ""}" data-f="${k}">${l}<span class="n">${n}</span></button>`).join("")}</div></div>`;
      el("#stSum").innerHTML = html;
      $$("[data-f]", el("#stSum")).forEach((b) => b.onclick = () => { S.filter = S.filter === b.dataset.f && b.classList.contains("st-tile") ? "all" : b.dataset.f; drawRes(); });
      let list = rs;
      if (S.filter === "bad") list = rs.filter((x) => [V.PROVEN, V.STUCK, V.ERR, V.WARN].includes(x.r.verdict));
      else if (S.filter !== "all") list = rs.filter((x) => x.r.verdict === S.filter);
      list = list.slice().sort((a, b) => ORDER.indexOf(a.r.verdict) - ORDER.indexOf(b.r.verdict) || (a.l.num ?? 1e9) - (b.l.num ?? 1e9));
      el("#stTable").innerHTML = `<div class="tbl-wrap" style="max-height:520px"><table class="tbl st-tbl"><thead><tr><th>Level</th><th>Kết luận</th><th class="r">Số nước</th><th class="r" title="Số trạng thái bộ giải đã duyệt (bản như ship)">Trạng thái</th><th class="r">Thời gian</th><th>Ghi chú</th></tr></thead>
        <tbody>${list.map((x) => {
          const r = x.r, s = r.strict || {};
          return `<tr data-n="${esc(x.l.name)}" class="${S.sel === x.l.name ? "on" : ""}"><td class="mono">${esc(x.l.name)}</td>
            <td><span class="badge ${VCLS[r.verdict] || ""}">${esc(r.verdict)}</span></td>
            <td class="r num">${r.solution ? r.solution.moves.length + (r.solution.variant ? "*" : "") : "—"}</td>
            <td class="r num">${s.nodes != null ? K.fmt.int(s.nodes) + (s.exhaustive ? " ✓" : "") : "—"}</td>
            <td class="r num">${K.fmt.num((r.ms || 0) / 1000, 1)} s</td><td class="st-note">${esc(r.note || "")}</td></tr>`;
        }).join("")}</tbody></table>${list.length ? "" : `<div class="empty">Không có level nào ở mục này.</div>`}</div>
        <p class="hint">Bấm 1 dòng để xem lời giải từng nước / ngõ cụt. <b>*</b> = lời giải cần ${esc("mở ống ads")}. <b>✓</b> = đã duyệt hết mọi trạng thái.</p>`;
      $$("tr[data-n]", el("#stTable")).forEach((tr) => tr.onclick = () => { S.sel = S.sel === tr.dataset.n ? null : tr.dataset.n; drawRes(); });
      drawDetail();
    }

    // ------------------------------------------------------------------ chi tiết 1 level
    function drawDetail() {
      const box = el("#stDetail");
      const l = S.levels.find((x) => x.name === S.sel), r = l && S.results.get(l.name);
      if (!r) { box.innerHTML = ""; return; }
      const E = SK.ENGINES[l.engine];
      let lv = null;
      try { lv = E.load(l.data, l.name); } catch (e) { /* hiện ghi chú lỗi bên dưới */ }
      let steps = [], start = null, title = "", variant = 0;
      if (lv && r.solution) {
        variant = r.solution.variant;
        start = E.view(E.start(lv, variant));
        steps = SK.replay(E, lv, variant, r.solution.keys, true).steps;
        title = `Lời giải ${steps.length} nước${variant ? " (" + r.extraLabel + ")" : ""} — đã chạy lại trên ván mới`;
      } else if (lv && r.strict && r.strict.best) {
        start = E.view(E.start(lv, 0));
        steps = SK.replay(E, lv, 0, r.strict.best.keys, true).steps;
        title = `Đường đi xa nhất trước ngõ cụt (${steps.length} nước, ${Math.round(r.strict.best.progress * 100)}% số ống hoàn thành)`;
      } else if (lv) start = E.view(E.start(lv, 0));
      const findings = (r.findings || []).map((f) => `<li class="st-f ${f.level}"><b>${f.level === "error" ? "Lỗi data" : f.level === "warn" ? "Cảnh báo" : "Ghi chú"}:</b> ${esc(f.text)}</li>`).join("");
      const best = r.strict && r.strict.best;
      const runInfo = (s, label) => s ? `<div><b>${label}</b> ${s.won ? "thắng" : s.exhaustive ? "duyệt hết, không thắng" : "chưa thắng (hết ngân sách)"} · ${K.fmt.int(s.nodes)} trạng thái · ${s.restarts} lượt restart · ${K.fmt.num(s.ms / 1000, 1)} s${s.timedOut ? " · hết giờ" : ""}</div>` : "";
      box.innerHTML = `<div class="st-detail">
        <div class="st-dh"><b class="mono">${esc(l.name)}</b><span class="badge ${VCLS[r.verdict] || ""}">${esc(r.verdict)}</span><span class="grow"></span>
          <button class="icon-btn" data-act="close" title="Đóng">${icon("x")}</button></div>
        <p>${esc(r.note)}</p>
        ${findings ? `<ul class="st-fl">${findings}</ul>` : ""}
        <div class="hint">${runInfo(r.strict, "Như ship:")}${runInfo(r.extra, (r.extraLabel || "Biến thể") + ":")}</div>
        ${best && !r.solution ? `<div class="note">${icon("alert")}<div><b>${esc(best.kind)}</b> — ${esc(best.detail)}</div></div>` : ""}
        ${start ? `<div class="sectit">Bàn chơi đầu màn</div>${boardHtml(start, l.pal)}` : ""}
        ${steps.length ? `<div class="sectit">${esc(title)}</div>
          <div class="st-steps">${steps.map((s, i) => `<details class="st-step" ${i === steps.length - 1 ? "open" : ""}><summary><span class="mono">${i + 1}.</span> ${swatch(s.view, l.pal)}${esc(s.label)}</summary>${s.view ? boardHtml(s.view, l.pal) : ""}</details>`).join("")}</div>
          <div class="row" style="margin-top:8px"><button class="btn sm" data-act="copy">${icon("copy")} Copy lời giải (chữ)</button></div>` : ""}
      </div>`;
      box.querySelector('[data-act="close"]').onclick = () => { S.sel = null; drawRes(); };
      const cp = box.querySelector('[data-act="copy"]');
      if (cp) cp.onclick = () => K.copy(`${l.name} — ${r.verdict}\n${r.note}\n\n` + steps.map((s, i) => `${i + 1}. ${s.label}\n   ${s.board}`).join("\n"));
      box.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    /** Ô màu của nước vừa đi (màu ở ngọn ống đích). */
    function swatch(view, pal) {
      const t = view && view.tubes.find((x) => x.to);
      const it = t && t.items[t.items.length - 1];
      return it ? `<i class="st-sw" style="background:${esc(pal(it.c))}"></i>` : "";
    }
    /** Vẽ bàn chơi bằng HTML: mỗi ống 1 cột, ô dưới → trên, "?" = ô ẩn, viền sáng = ống vừa rót đi / vào. */
    function boardHtml(view, pal) {
      const name = (c) => (view.names ? view.names[c] : c);
      const tubes = view.tubes.map((t) => {
        const cells = [];
        for (let k = t.cap - 1; k >= 0; k--) {
          const it = t.items[k];
          cells.push(it ? `<i style="background:${esc(pal(it.c))}" title="màu ${esc(name(it.c))}${it.h ? " (ẩn)" : ""}">${it.h ? "?" : ""}${it.key ? "🔑" : ""}</i>` : `<i class="e"></i>`);
        }
        return `<div class="st-tube ${t.from ? "from" : ""} ${t.to ? "to" : ""} ${t.done ? "done" : ""} ${t.off ? "off" : ""}" title="Ống ${t.i + 1}${t.tags.length ? " · " + esc(t.tags.join(", ")) : ""}">
          <div class="st-cells">${cells.join("")}</div><small>${t.i + 1}</small>${t.tags.length ? `<em>${esc(t.tags.join(" · "))}</em>` : ""}</div>`;
      }).join("");
      const ord = view.slots.length || view.left ? `<div class="st-orders">Order đang mở: ${view.slots.filter((c) => c >= 0).map((c) => `<i style="background:${esc(pal(c))}" title="màu ${esc(name(c))}"></i>`).join("") || "—"} <span>còn chờ ${view.left}</span></div>` : "";
      return `<div class="st-board">${tubes}</div>${ord}`;
    }

    // ------------------------------------------------------------------ xuất
    el("#stExp").onclick = (e) => {
      e.stopPropagation();
      const rs = rows();
      if (!rs.length) return;
      const menu = [
        ["Báo cáo .md", () => {
          const meta = reportMeta(rs);
          K.download(`stuckcheck_${slug(S.label)}_${stamp()}.md`, SK.reportMarkdown(meta, rs.map((x) => x.r), S.sum || SK.summarize(rs.map((x) => x.r), {}), S.post || {}), "text/markdown;charset=utf-8");
        }],
        ["Bảng .csv", () => {
          const q = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
          const head = ["level", "file", "verdict", "proof", "moves", "variant", "states", "exhaustive", "seconds", "note"];
          const lines = rs.map(({ l, r }) => [l.num ?? "", l.name, r.verdict, r.proof ? 1 : 0, r.solution ? r.solution.moves.length : "", r.solution && r.solution.variant ? r.extraLabel : "",
            r.strict ? r.strict.nodes : "", r.strict && r.strict.exhaustive ? 1 : 0, ((r.ms || 0) / 1000).toFixed(2), r.note].map(q).join(","));
          K.download(`stuckcheck_${slug(S.label)}_${stamp()}.csv`, "\uFEFF" + head.join(",") + "\n" + lines.join("\n"));
        }],
        ["Số liệu .json", () => K.download(`stuckcheck_${slug(S.label)}_${stamp()}.json`, JSON.stringify({ meta: reportMeta(rs), summary: S.sum, post: S.post, levels: rs.map((x) => x.r) }, null, 1), "application/json")],
      ];
      document.querySelectorAll(".menu-pop").forEach((m) => m.remove());
      const pop = document.createElement("div");
      pop.className = "menu-pop";
      const sub = ["đủ 7 mục: tóm tắt, hậu kiểm, level cần xem, bảng, mô hình, lời giải", "1 dòng / level — mở bằng Excel / Sheets", "toàn bộ số liệu, kể cả ngõ cụt"];
      pop.innerHTML = menu.map(([t], i) => `<button data-i="${i}">${icon(i === 1 ? "sheet" : i === 2 ? "braces" : "doc")}<span><b>${t}</b><small>${sub[i]}</small></span></button>`).join("");
      document.body.appendChild(pop);
      const r = el("#stExp").getBoundingClientRect();
      pop.style.top = Math.min(r.bottom + 6, window.innerHeight - pop.offsetHeight - 8) + "px";
      pop.style.left = Math.max(8, Math.min(r.right - pop.offsetWidth, window.innerWidth - pop.offsetWidth - 8)) + "px";
      const off = () => { pop.remove(); document.removeEventListener("click", off); };
      setTimeout(() => document.addEventListener("click", off), 0);
      pop.onclick = (ev) => { const b = ev.target.closest("button[data-i]"); if (!b) return; off(); menu[+b.dataset.i][1](); };
    };
    function reportMeta(rs) {
      const eng = SK.ENGINES[rs[0].l.engine];
      const p = S.runOpts || PRESETS[S.opts.preset];
      return { game: eng.name, label: S.label, engine: eng.id, date: new Date().toLocaleString("vi-VN"), model: eng.model, rules: eng.rules,
        params: `${K.fmt.int(p.nodes)} trạng thái · ${p.timeMs / 1000} s / level · biến thể: ${S.opts.extra === "ads" ? "mở ống ads" : S.opts.extra}` };
    }
    const slug = (s) => String(s || "levels").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40) || "levels";
    const stamp = () => { const d = new Date(), z = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}`; };

    // ------------------------------------------------------------------ gói .md cho game khác
    let docText = null;
    async function getDoc() {
      if (docText) return docText;
      const res = await fetch(DOC + "?v=" + GDK.version, { credentials: "same-origin" });
      if (!res.ok) throw new Error("Không tải được file .md (" + res.status + ")");
      docText = await res.text();
      return docText;
    }
    function filledDoc(text) {
      const F = S.form;
      const filled = FORM.some(([k]) => (F[k] || "").trim());
      if (!filled) return text;
      const block = `<!-- GAME-INFO:START -->\n## 0. Thông tin game${F.game ? " — " + F.game.trim() : ""}\n\n| | |\n|---|---|\n` +
        FORM.map(([k, label, ph]) => `| ${label} | ${(F[k] || "").trim().replace(/\|/g, "/").replace(/\r?\n/g, " ") || "_(" + ph + ")_"} |`).join("\n") + "\n<!-- GAME-INFO:END -->";
      return text.replace(/<!-- GAME-INFO:START -->[\s\S]*?<!-- GAME-INFO:END -->/, block);
    }
    function promptText() {
      const g = (S.form.game || "").trim() || "game của tôi";
      return `Đọc file check-level-stuck.md (đính kèm / skill). Game: ${g} — thông tin ở mục 0.\n` +
        "Hãy: (1) đọc code luật chơi, lập bảng luật mục 3 có file:dòng — gửi tôi xem trước khi code;\n" +
        "(2) port thành checker chạy hàng loạt 1 lệnh / 1 thư mục, có biến thể \"thêm tài nguyên\" và seed nếu luật có random;\n" +
        "(3) hậu kiểm đủ V1–V8 (đối chứng dương = các level ở mục 0);\n" +
        "(4) chạy bộ level ở mục 0 và trả lời đúng mẫu mục 6. Không đoán luật — chỗ nào không chắc thì hỏi.";
    }
    function drawMd() {
      const box = el("#stMd");
      box.innerHTML = `<p>File <b>check-level-stuck.md</b> gói toàn bộ cách làm của tool này: kết luận nào tin được, quy trình 5 bước, bảng luật mẫu,
          bộ giải tham chiếu, hậu kiểm V1–V8, mẫu báo cáo — kèm <b>2 ví dụ thật: CDS</b> (luật Bottle.cs, kết quả trên v22 / v18 / Hard) và
          <b>BSHP / Bird Sort</b> (order ngẫu nhiên, 8 seed, các lỗi hậu kiểm đã bắt).</p>
        <ol class="aside-steps"><li>Điền thông tin game bên dưới (không bắt buộc — để trống thì tải bản gốc).</li>
          <li>Tải .md → Claude Code: chép vào <code>&lt;project&gt;/.claude/skills/check-level-stuck/SKILL.md</code>; chat thường: đính kèm file.</li>
          <li>Dán prompt (nút <b>Copy prompt</b>) — Claude đọc code game, lập bảng luật cho bạn duyệt rồi mới dựng checker.</li></ol>
        <div class="st-form">${FORM.map(([k, label, ph]) => `<div><label class="lb">${esc(label)}</label><input type="text" data-k="${k}" placeholder="${esc(ph)}" value="${esc(S.form[k] || "")}"></div>`).join("")}</div>
        <div class="row" style="margin-top:12px">
          <button class="btn primary" data-act="dl">${icon("download")} Tải .md (đã điền)</button>
          <button class="btn" data-act="prompt">${icon("copy")} Copy prompt</button>
          <button class="btn ghost" data-act="raw">${icon("download")} Tải bản gốc</button>
          <button class="btn ghost" data-act="preview">${icon("eye")} Xem trước</button>
          <button class="btn ghost" data-act="reset">Xoá form</button></div>
        <pre class="st-pre" hidden></pre>`;
      $$("input[data-k]", box).forEach((inp) => inp.oninput = () => { S.form[inp.dataset.k] = inp.value; store.set("gdk.stuck.form", S.form); });
      const act = (k, fn) => { box.querySelector(`[data-act="${k}"]`).onclick = async () => { try { await fn(); } catch (e) { toast(e.message, "bad"); } }; };
      act("dl", async () => {
        const g = (S.form.game || "").trim();
        K.download(`check-level-stuck${g ? "_" + slug(g) : ""}.md`, filledDoc(await getDoc()), "text/markdown;charset=utf-8");
        GDK.track && GDK.track("level-stuck", "md");
      });
      act("raw", async () => K.download("check-level-stuck.md", await getDoc(), "text/markdown;charset=utf-8"));
      act("prompt", () => K.copy(promptText(), "Đã copy prompt — dán vào Claude kèm file .md"));
      act("preview", async () => { const pre = box.querySelector(".st-pre"); pre.hidden = !pre.hidden; if (!pre.hidden) pre.textContent = filledDoc(await getDoc()); });
      act("reset", () => { S.form = {}; store.set("gdk.stuck.form", {}); drawMd(); });
    }
    el("#stMdTog").onclick = () => {
      const box = el("#stMd");
      box.hidden = !box.hidden;
      el("#stMdTog").innerHTML = `${icon("chevron-down")} ${box.hidden ? "Mở" : "Thu gọn"}`;
      if (!box.hidden && !box.childElementCount) drawMd();
    };

    reassign();
    drawSrc();
    drawRes();
    // để test tự động
    root.stLoadForTest = (items, label) => load(items, label);
    return {
      sample, sampleLabel: "Thử với 8 level mẫu CDS",
      template: async () => { try { K.download("check-level-stuck.md", await getDoc(), "text/markdown;charset=utf-8"); } catch (e) { toast(e.message, "bad"); } },
      cleanup: () => stop(),
    };
  }
})();

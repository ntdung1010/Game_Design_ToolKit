/* Data Lint — soát + ĐÁNH GIÁ file dữ liệu: nhận ra loại file (Level insight / bảng level / cohort / bảng thường),
   hậu kiểm số liệu, chấm từng level theo giai đoạn, chẩn đoán vấn đề và đưa ra việc cần làm. Logic: lib/datareview.js
   (đánh giá) + lib/datalint.js (lỗi kỹ thuật của bảng). Dữ liệu chỉ xử lý trong trình duyệt, không gửi lên máy chủ. */
(() => {
  "use strict";
  const { $, $$, esc, icon, toast, store } = GDK;
  const K = GDK.kit, T = GDK.lib.table, DL = GDK.lib.datalint, DR = GDK.lib.datareview;
  const F = DR.fmt;
  const TYPE = { number: "Số", date: "Ngày", text: "Chữ", empty: "Trống" };
  const KIND = { "level-insight": "Level insight (chỉ số theo level, nhiều version)", "level-table": "Bảng dữ liệu theo level",
    cohort: "Cohort (retention / doanh thu theo ngày)", table: "Bảng dữ liệu" };
  const STATUS = { "đỏ": "bad", "vàng": "warn", "đạt": "ok" };

  GDK.tools["data-lint"] = { mount };

  function mount(root) {
    const S = { table: null, lint: null, parsed: null, ver: null, res: null, audit: [], cmp: null, tab: "overview", filter: "fix",
      opts: Object.assign({}, DR.DEFAULTS, store.get("gdk.datareview.opts", {})), charts: [] };
    root.innerHTML = `
      <section class="panel">
        <div class="ph"><span class="step">1</span><h2>File cần đánh giá</h2><span class="sub">export Level insight, bảng level, cohort hoặc bất kỳ bảng nào</span></div>
        <div class="pb"><div id="imp"></div></div>
      </section>
      <section class="panel" id="res" hidden>
        <div class="ph"><span class="step">2</span><h2>Đánh giá</h2><span class="sub" id="kind"></span></div>
        <div class="pb"><div id="head"></div><div class="tabs adm-tabs dr-tabs" id="tabs"></div><div id="body"></div></div>
      </section>
      <section class="panel" id="intro">
        <div class="pb">${K.empty({ illus: "data-lint", title: "Thả 1 file để đánh giá",
          text: "Tool nhận ra loại file rồi: hậu kiểm số liệu (event không bắn, droprate không khớp reach, thiếu mẫu…), chấm từng level theo giai đoạn, chỉ ra level nên sửa, <b>sửa gì, sửa thế nào, dễ hơn hay khó hơn</b>, và so sánh v0 / v1.",
          actions: `<button class="btn primary" id="introSample">${icon("flask")} Thử với file Level insight mẫu</button>
            <button class="btn" id="introSample2">${icon("table-check")} Mẫu bảng export thường</button>` })}</div>
      </section>`;
    const el = (s) => $(s, root);
    const imp = K.importer(el("#imp"), { cacheKey: "data-lint", onTable: (t) => run(t), onSample: () => sample() });
    el("#introSample").onclick = () => sample();
    el("#introSample2").onclick = () => sample(true);

    const isLevel = () => S.parsed && (S.parsed.kind === "level-insight" || S.parsed.kind === "level-table");

    function run(t) {
      S.table = t;
      S.parsed = DR.detect(t);
      S.lint = S.parsed.kind === "level-insight" ? null : DL.lint(t.headers, t.rows, t.rawHeaders || t.headers);
      if (isLevel()) {
        const vs = S.parsed.versions;
        if (!vs.includes(S.ver) && S.ver !== "__all") S.ver = vs[0];
      }
      S.tab = "overview"; S.filter = "fix";
      compute();
      el("#intro").hidden = true; el("#res").hidden = false;
      render();
    }
    function compute() {
      S.res = null; S.audit = []; S.cmp = null;
      if (isLevel()) {
        S.res = DR.review(DR.levelsFor(S.parsed, S.ver), S.opts);
        S.audit = DR.audit(S.parsed, S.ver, S.opts);
        S.cmp = DR.compare(S.parsed, S.opts);
      } else if (S.parsed.kind === "cohort") {
        S.audit = DR.auditCohort(S.table, S.parsed);
      }
    }
    /** Mọi vấn đề dữ liệu (hậu kiểm chuyên sâu + lỗi kỹ thuật của bảng), nặng trước. */
    function issues() {
      const order = { bad: 0, warn: 1, info: 2 };
      const lint = (S.lint ? S.lint.issues : []).map((x) => ({ level: x.level, title: x.title, detail: x.detail, action: x.action, where: x.column }));
      return S.audit.concat(lint).sort((a, b) => order[a.level] - order[b.level]);
    }

    // ================================================================ khung kết quả
    function render() {
      S.charts.forEach((c) => c.destroy()); S.charts = [];
      const t = S.table, p = S.parsed;
      el("#kind").textContent = KIND[p.kind] + (p.versions && p.versions.length > 1 ? " · " + p.versions.join(" / ") : "");
      const iss = issues(), nb = iss.filter((x) => x.level === "bad").length, nw = iss.filter((x) => x.level === "warn").length;
      let verdict;
      if (S.res) {
        const s = S.res.summary;
        verdict = K.verdict(nb ? "bad" : s.fixes ? "mid" : "ok",
          nb ? "Dữ liệu có lỗi cần biết trước khi kết luận — " + s.fixes + " level nên sửa" : s.fixes ? s.fixes + " level nên sửa, " + s.red + " level đỏ" : "Không có level nào cần sửa",
          `${F.int(t.rows.length)} dòng · ${s.levels} level · chấm ${s.rated} level đủ mẫu (reach ≥ ${S.opts.minReach})`);
      } else {
        verdict = K.verdict(nb ? "bad" : nw ? "mid" : "ok", nb ? "Có lỗi cần xử lý trước khi phân tích" : nw ? "Dùng được, nhưng có điểm cần xem lại" : "File sạch — dùng được",
          `${F.int(t.rows.length)} dòng · ${t.headers.length} cột`);
      }
      el("#head").innerHTML = verdict;
      const tabs = [["overview", "Tổng quan", "sparkles"]];
      if (isLevel()) tabs.push(["levels", "Đánh giá level", "layers"]);
      tabs.push(["data", "Chất lượng dữ liệu" + (nb + nw ? " (" + (nb + nw) + ")" : ""), "alert"]);
      if (S.cmp) tabs.push(["ab", "So sánh " + S.cmp.control + " / " + S.cmp.treat, "split"]);
      if (S.lint) tabs.push(["cols", "Hồ sơ cột", "table-check"]);
      if (!tabs.some(([k]) => k === S.tab)) S.tab = "overview";
      el("#tabs").innerHTML = tabs.map(([k, l, ic]) => `<a href="#" data-tab="${k}" class="${k === S.tab ? "on" : ""}">${icon(ic)} ${esc(l)}</a>`).join("");
      $$("#tabs a", root).forEach((a) => a.onclick = (e) => { e.preventDefault(); S.tab = a.dataset.tab; render(); });
      ({ overview, levels: levelsTab, data: dataTab, ab: abTab, cols: colsTab }[S.tab])(el("#body"));
    }

    // ================================================================ tổng quan: kết luận nhanh + việc cần làm
    function overview(box) {
      const iss = issues();
      const todo = [];
      iss.filter((x) => x.level !== "info" && x.action).forEach((x) => todo.push({ tag: "Dữ liệu", cls: x.level, title: x.title, what: x.action }));
      let html = "";
      if (S.res) {
        const s = S.res.summary, R = S.res.levels;
        const top = s.p0.slice(0, 6);
        top.forEach((x) => todo.push({ tag: "P0 · LV" + x.level, cls: "bad", title: x.fix.group + " — " + x.fix.change, what: x.fix.what }));
        const p1 = R.filter((x) => x.priority === "P1").length;
        if (p1) todo.push({ tag: "P1", cls: "warn", title: p1 + " level ưu tiên vừa", what: "Xem tab Đánh giá level (lọc “Cần sửa”) — xử lý sau đợt P0." });
        const groups = Object.entries(s.groups).sort((a, b) => b[1].length - a[1].length);
        const bullets = [
          `Chấm <b>${s.rated}</b>/${s.levels} level đủ mẫu: <span class="t-bad">${s.red} đỏ</span> · <span class="t-warn">${s.warn} vàng</span> · <span class="t-ok">${s.pass} đạt</span>${s.lowSample.length ? ` — ${s.lowSample.length} level thiếu mẫu không chấm` : ""}.`,
          s.fixes ? `<b>${s.fixes} level nên sửa</b>, đang mất khoảng <b>${F.int(s.lost)} người chơi</b> tại các level này. Nhiều nhất: ${groups.slice(0, 3).map(([g, l]) => `<b>${esc(g)}</b> (${l.length})`).join(", ")}.` : "Không có level nào cần sửa theo ngưỡng hiện tại.",
          s.superHard || s.hard ? `Tag độ khó: <b>${s.superHard}</b> Super Hard · <b>${s.hard}</b> Hard (điểm theo attempts, first win, ss_exit, droprate, mid_quit, trợ giúp).` : "",
          s.model ? `Droprate kỳ vọng tính theo độ khó (${esc(s.model.replace("droprate kỳ vọng theo ", ""))}) → tách được “bỏ vì khó” với “rò không do khó”.` : "",
        ];
        const bad = iss.find((x) => x.level === "bad");
        if (bad) bullets.push(`<span class="t-bad">Dữ liệu:</span> ${esc(bad.title)} — kết luận liên quan cần đọc thận trọng.`);
        if (S.cmp) {
          const pick = (k) => S.cmp.rows.find((r) => r.metric === k);
          const parts = ["droprate", "remain", "win_rate", "sra"].map(pick).filter(Boolean).map((r) => `${esc(r.label)} <b>${esc(r.verdict.toLowerCase())}</b> (${r.isPct ? F.pp(r.delta) : (r.delta >= 0 ? "+" : "−") + F.n1(Math.abs(r.delta))})`);
          if (parts.length) bullets.push(`${esc(S.cmp.treat)} so với ${esc(S.cmp.control)}: ${parts.join(" · ")}.`);
        }
        html += `<div class="sectit">Kết luận nhanh</div><ul class="dr-bullets">${bullets.filter(Boolean).map((b) => `<li>${b}</li>`).join("")}</ul>`;
        html += K.tiles([{ n: s.red, label: "level đỏ", cls: s.red ? "bad" : "ok" }, { n: s.warn, label: "level vàng", cls: s.warn ? "warn" : "" },
          { n: s.fixes, label: "nên sửa" }, { n: F.int(s.lost), label: "user mất ở level cần sửa" }, { n: s.p0.length, label: "ưu tiên P0", cls: s.p0.length ? "bad" : "" }]);
        if (groups.length) html += `<div class="sectit">Nhóm vấn đề</div>` + K.bars(groups.map(([g, l]) => ({ label: g + " · LV " + l.slice(0, 6).join(", ") + (l.length > 6 ? "…" : ""), value: l.length,
          cls: /Dễ hơn|Tường|Vừa khó/.test(g) ? "bad" : /Khó hơn|phẳng/.test(g) ? "ok" : "" })));
      } else {
        html += `<div class="sectit">Kết luận nhanh</div><ul class="dr-bullets">
          <li>Loại file: <b>${esc(KIND[S.parsed.kind])}</b>. ${S.parsed.kind === "table" ? "Không thấy cột level / ngày cài — chỉ soát lỗi kỹ thuật của bảng." : ""}</li>
          <li>${iss.filter((x) => x.level === "bad").length} lỗi nghiêm trọng · ${iss.filter((x) => x.level === "warn").length} điểm cần xem lại · ${iss.filter((x) => x.level === "info").length} lưu ý.</li>
          ${S.parsed.kind === "table" ? `<li>Muốn tool chấm từng level: file cần cột <code>level</code> + <code>users</code> (hoặc export Level insight).</li>` : ""}</ul>`;
      }
      html += `<div class="sectit">Việc cần làm</div>` + (todo.length ? `<ol class="dr-todo">${todo.map((x) => `<li><span class="mini ${x.cls === "bad" ? "bad" : x.cls === "warn" ? "warn" : ""}">${esc(x.tag)}</span>
          <div><b>${esc(x.title)}</b><span>${esc(x.what)}</span></div></li>`).join("")}</ol>` : `<p class="hint">Không có việc gì cần làm — dữ liệu dùng được.</p>`);
      if (isLevel()) {
        const need = [], ask = [];
        if (iss.some((x) => /thua không bắn|lượt thua = 0|lose_retry/.test(x.title))) need.push("Event thua (end_level_detail result = lose, param time) — để tách “bỏ vì thua” khỏi mid_quit.");
        need.push("levelDesignVer / tên pack trong event level — để biết số liệu thuộc bộ level nào.");
        if (S.parsed.metrics.includes("helper")) need.push("usage_type của use_item (in_pool / gold / sra) — để quy đổi item ra doanh thu thật.");
        ask.push(S.parsed.versions.length > 1 ? `${S.parsed.versions.join(" / ")} ứng với bộ level / nhánh AB nào đang live?` : "File này là bộ level / nhánh nào? (export không ghi levelVer)");
        ask.push("Ranh giới giai đoạn L" + S.opts.phase1 + " / L" + S.opts.phase2 + " đã đúng chỗ mở quảng cáo / item của game chưa? (sửa ở tab Đánh giá level → Ngưỡng)");
        if (S.cmp) ask.push("Có nhánh A/A để biết mức nhiễu không? (retention thường lệch ±4–5%, doanh thu ±30% dù không đổi gì)");
        html += `<div class="grid2 dr-two"><div><div class="sectit">Data cần thêm</div><ul class="adm-notes">${need.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
          <div><div class="sectit">Câu hỏi cần làm rõ</div><ul class="adm-notes">${ask.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div></div>`;
      }
      box.innerHTML = html;
    }

    // ================================================================ đánh giá từng level
    function levelsTab(box) {
      const vs = S.parsed.versions, o = S.opts;
      box.innerHTML = `
        <div class="dr-ctrl">
          ${vs.length > 1 ? `<label class="lb">Đánh giá theo</label><div class="seg" id="ver">${vs.map((v) => `<button data-v="${esc(v)}" class="${S.ver === v ? "on" : ""}">${esc(v)}</button>`).join("")}
            <button data-v="__all" class="${S.ver === "__all" ? "on" : ""}" title="Trung bình theo reach của mọi version">Gộp</button></div>` : ""}
          <div class="seg" id="flt">${[["fix", "Cần sửa"], ["flag", "Đỏ + vàng"], ["all", "Tất cả"]].map(([k, l]) => `<button data-f="${k}" class="${S.filter === k ? "on" : ""}">${l}</button>`).join("")}</div>
          <span class="grow"></span>
          <button class="btn sm" id="copyFix" title="Copy bảng (dán thẳng vào Google Sheet)">${icon("copy")} Copy cho Google Sheet</button>
          <button class="btn sm" id="expFix"></button>
        </div>
        <details class="adv dr-th"><summary>${icon("chevron-right")} Ngưỡng đánh giá <span class="dim">— giai đoạn L1–${o.phase1} / ${o.phase1 + 1}–${o.phase2} / ${o.phase2 + 1}+ · mẫu tối thiểu ${o.minReach} người</span></summary>
          <div class="dr-th-grid">
            <label><span>Hết giai đoạn 1 ở level</span><input type="number" min="1" data-o="phase1" value="${o.phase1}"></label>
            <label><span>Hết giai đoạn 2 ở level</span><input type="number" min="2" data-o="phase2" value="${o.phase2}"></label>
            <label><span>Reach tối thiểu để chấm</span><input type="number" min="5" data-o="minReach" value="${o.minReach}"></label>
            <label><span>Thời gian thắng mục tiêu (giây)</span><input type="number" min="20" data-o="ptWinTarget" value="${o.ptWinTarget}"></label>
            <label><span>Doanh thu: sra + k × sfa, k =</span><input type="number" step="0.01" min="0" data-o="sfaWeight" value="${o.sfaWeight}"></label>
            <button class="btn sm ghost" id="thReset">${icon("refresh")} Về mặc định</button>
          </div>
          <p class="hint">Đỏ / vàng theo giai đoạn: GĐ1 drop ≥ 4% (vàng ≥ 3,5% hoặc chơi ≥ 190s) · GĐ2 drop ≥ 4,5% (vàng ≥ 3,5% hoặc kết thúc phiên ≥ 30%) · GĐ3 drop ≥ 3,5%, win rate ≤ 45% hoặc người bỏ thử ≥ 5 lần (vàng drop ≥ 3% hoặc ≥ 2,5 lần chơi). Cờ riêng: gai droprate, tỉ lệ thắng tụt / nhảy ≥ 20pp so với level kề.</p>
        </details>
        <div class="dr-charts"><div><div class="sectit">Droprate thực tế và kỳ vọng theo độ khó</div><div id="chDrop"></div></div>
          <div><div class="sectit">Tỉ lệ thắng</div><div id="chWin"></div></div></div>
        <div id="lvTable" class="dr-lv"></div>`;
      $$("#ver button", box).forEach((b) => b.onclick = () => { S.ver = b.dataset.v; compute(); render(); });
      $$("#flt button", box).forEach((b) => b.onclick = () => { S.filter = b.dataset.f; render(); });
      $$("[data-o]", box).forEach((i) => i.onchange = () => {
        const v = parseFloat(i.value);
        if (!isFinite(v)) return;
        S.opts[i.dataset.o] = v;
        if (S.opts.phase2 <= S.opts.phase1) S.opts.phase2 = S.opts.phase1 + 1;
        store.set("gdk.datareview.opts", S.opts); compute(); render();
      });
      $("#thReset", box).onclick = () => { S.opts = Object.assign({}, DR.DEFAULTS); store.set("gdk.datareview.opts", {}); compute(); render(); };
      const R = S.res.levels;
      const rated = R.filter((x) => x.ok);
      const marks = R.filter((x) => x.priority === "P0").slice(0, 10);
      S.charts.push(K.lineChart($("#chDrop", box), {
        series: [{ name: "Droprate", points: rated.map((x) => ({ x: x.level, y: x.droprate })) },
          { name: "Kỳ vọng theo độ khó", points: rated.map((x) => ({ x: x.level, y: x.expDrop })), dash: true }],
        height: 220, yFormat: (v) => F.pct(v), xLabel: "level", markers: marks.map((x) => ({ x: x.level, y: x.droprate, label: "LV" + x.level, kind: "bad" })),
        tooltipExtra: (lv) => { const x = R.find((y) => y.level === lv); return x && x.fix ? `<div class="tl"><b>${esc(x.fix.group)}</b></div>` : ""; },
      }));
      S.charts.push(K.lineChart($("#chWin", box), {
        series: [{ name: "Win rate", points: rated.map((x) => ({ x: x.level, y: x.win_rate })) }, { name: "Thắng lần đầu", points: rated.map((x) => ({ x: x.level, y: x.first_win })) }],
        height: 200, yMin: 0, yMax: 1, yFormat: (v) => F.pct(v, 0), xLabel: "level",
      }));
      const list = R.filter((x) => S.filter === "all" ? true : S.filter === "flag" ? x.status === "đỏ" || x.status === "vàng" : x.fix && x.fix.change !== "Không sửa");
      const pv = (v) => v == null ? "—" : F.pct(v);
      K.table($("#lvTable", box), [
        { key: "priority", label: "Ưu tiên", fmt: (v, x) => v ? `<span class="mini ${v === "P0" ? "bad" : v === "P1" ? "warn" : ""}">${v}</span>${x.lowConf ? ` <span class="dim" title="ít người chơi — kết luận yếu">ít mẫu</span>` : ""}` : "" },
        { key: "level", label: "LV", fmt: (v) => `<b>${v}</b>` },
        { key: "phase", label: "GĐ" },
        { key: "reach", label: "Reach", align: "r", fmt: (v) => F.int(v) },
        { key: "status", label: "Trạng thái", fmt: (v) => STATUS[v] ? `<span class="mini ${STATUS[v]}">${esc(v)}</span>` : `<span class="dim">${esc(v || "")}</span>` },
        { key: "droprate", label: "Drop", align: "r", fmt: pv },
        { key: "expDrop", label: "Kỳ vọng", align: "r", fmt: pv, title: "Droprate dự báo theo độ khó của level" },
        { key: "excess", label: "Vượt (z)", align: "r", fmt: (v, x) => v == null ? "—" : `<span class="${v > 0.005 ? "t-bad" : v < -0.005 ? "t-ok" : ""}">${F.pp(v)}</span><small class="dim"> ${x.z == null ? "" : F.n1(x.z, 1)}</small>` },
        { key: "win_rate", label: "Win rate → đích", align: "r", fmt: (v, x) => pv(v) + (x.fix && x.fix.change === "Dễ hơn" && x.wrTarget != null ? ` <b>→ ${F.pct(x.wrTarget)}</b>` : "") },
        { key: "first_win", label: "Thắng lần đầu", align: "r", fmt: pv },
        { key: "jump", label: "Δ so LV trước", align: "r", fmt: (v) => v == null ? "—" : `<span class="${v <= -0.2 ? "t-bad" : v >= 0.2 ? "t-warn" : ""}">${F.pp(v)}</span>` },
        { key: "attempts", label: "Lần chơi", align: "r", fmt: (v) => F.n1(v) },
        { key: "pt_win", label: "T. thắng", align: "r", fmt: (v) => v == null ? "—" : Math.round(v) + "s" },
        { key: "quit_att", label: "Người bỏ thử", align: "r", fmt: (v) => F.n1(v, 1) },
        { key: "lost", label: "User mất", align: "r", fmt: (v) => F.int(v) },
        { key: "tag", label: "Tag", fmt: (v, x) => v ? `<span class="mini ${v === "Super Hard" ? "bad" : "warn"}" title="điểm ${x.hardScore}">${esc(v)}</span>` : "" },
        { key: "reasons", label: "Vì sao", sort: false, fmt: (v) => `<div class="dr-why dim">${esc((v || []).join("; "))}</div>` },
        { key: "fix", label: "Chẩn đoán → hướng sửa", sort: false, fmt: (v) => v ? `<b>${esc(v.group)}</b> <span class="mini ${v.change === "Dễ hơn" ? "bad" : v.change === "Khó hơn" ? "ok" : v.change === "Không sửa" ? "" : "l"}">${esc(v.change)}</span><div class="dr-what">${esc(v.what)}</div>` : "" },
      ], list, { rowClass: (x) => x.status === "đỏ" ? "row-bad" : x.status === "vàng" ? "row-warn" : "", sortKey: S.filter === "all" ? "level" : "lost", sortDir: S.filter === "all" ? 1 : -1,
        empty: S.filter === "fix" ? "Không có level nào cần sửa theo ngưỡng hiện tại." : "Không có level nào." });
      const fixData = () => ({ name: "level_fix_list_" + (S.table.name || "data").replace(/\.[^.]+$/, ""), sheets: [
        { name: "Danh sách sửa", headers: DR.FIX_HEADERS, rows: DR.fixRows(S.res) },
        { name: "Đánh giá level", headers: ["LV", "Giai_doan", "Reach", "Trang_thai", "Droprate_%", "Ky_vong_%", "Excess_pp", "z", "Win_rate_%", "First_win_%", "Attempts", "pt_win", "quit_att", "User_mat", "Tag", "Diem_kho", "Vi_sao", "Chan_doan", "Thay_doi", "Huong_sua"],
          rows: S.res.levels.map((x) => [x.level, x.phase, Math.round(x.reach || 0), x.status, pctN(x.droprate), pctN(x.expDrop), x.excess == null ? "" : +(x.excess * 100).toFixed(2), x.z == null ? "" : +x.z.toFixed(1),
            pctN(x.win_rate), pctN(x.first_win), x.attempts == null ? "" : +x.attempts.toFixed(2), x.pt_win == null ? "" : Math.round(x.pt_win), x.quit_att == null ? "" : +x.quit_att.toFixed(2),
            x.lost == null ? "" : Math.round(x.lost), x.tag || "", x.hardScore == null ? "" : x.hardScore, (x.reasons || []).join("; "), x.fix ? x.fix.group : "", x.fix ? x.fix.change : "", x.fix ? x.fix.what : ""]) },
      ] });
      K.exportMenu($("#expFix", box), fixData, { label: "Tải danh sách sửa" });
      $("#copyFix", box).onclick = () => {
        const rows = DR.fixRows(S.res);
        if (!rows.length) return toast("Không có level nào cần sửa.", "bad");
        const tsv = [DR.FIX_HEADERS].concat(rows).map((r) => r.map((c) => String(c == null ? "" : c).replace(/[\t\n]+/g, " ")).join("\t")).join("\n");
        K.copy(tsv, "Đã copy " + rows.length + " level — dán vào Google Sheet (ô A1).");
      };
    }
    const pctN = (v) => v == null ? "" : +(v * 100).toFixed(1);

    // ================================================================ chất lượng dữ liệu
    function dataTab(box) {
      const iss = issues();
      box.innerHTML = (iss.length ? `<div class="issues">${iss.map((x) => `<div class="issue ${x.level}">
          <span class="lv">${icon(x.level === "info" ? "info" : "alert")}</span>
          <div><div class="it">${esc(x.title)}${x.where ? ` <code>${esc(x.where)}</code>` : ""}</div>${x.detail ? `<div class="id">${esc(x.detail)}</div>` : ""}
            ${x.action ? `<div class="ia">${icon("arrow-right")} <b>Việc cần làm:</b> ${esc(x.action)}</div>` : ""}</div></div>`).join("")}</div>`
        : K.issueList([])) + (S.parsed.kind === "level-insight" ? `<p class="hint">Đã kiểm: event thua, thời gian lượt thua, lose + win + mid quit ≈ droprate, droprate ≈ 1 − reach(N+1)/reach(N), reach không tăng, thiếu level, thiếu mẫu, hàng avg, win rate ≈ 1/attempts, quảng cáo xen kẽ theo level.</p>` : "");
    }

    // ================================================================ so sánh version
    function abTab(box) {
      const c = S.cmp;
      box.innerHTML = `<p class="hint">Mỗi chỉ số: trung bình theo reach của ${esc(c.control)} (dùng chung trọng số cho cả 2 bên, như cách tính Δ của file). “Tốt hơn / Tệ hơn” theo hướng tốt của từng chỉ số; chênh &lt; 2% coi như không đổi. Không có nhánh A/A thì chênh nhỏ có thể chỉ là nhiễu.</p>
        <div id="abT"></div><div class="sectit">Level có droprate khác rõ giữa 2 version (≥ 1,5pp, z ≥ 2)</div><div id="abL"></div>`;
      K.table($("#abT", box), [
        { key: "label", label: "Chỉ số", fmt: (v, r) => `<b>${esc(v)}</b> <small class="dim mono">${esc(r.metric)}</small>` },
        { key: "control", label: c.control, align: "r", fmt: (v, r) => r.isPct ? F.pct(v) : F.n1(v) },
        { key: "treat", label: c.treat, align: "r", fmt: (v, r) => r.isPct ? F.pct(v) : F.n1(v) },
        { key: "delta", label: "Δ (tool tính)", align: "r", fmt: (v, r) => r.isPct ? F.pp(v) : (v >= 0 ? "+" : "−") + F.n1(Math.abs(v)) },
        { key: "fileDelta", label: "Δ trong file", align: "r", fmt: (v, r) => v == null ? "—" : r.isPct ? F.pp(v) : (v >= 0 ? "+" : "−") + F.n1(Math.abs(v)) },
        { key: "verdict", label: "Đánh giá", fmt: (v) => `<span class="mini ${v === "Tốt hơn" ? "ok" : v === "Tệ hơn" ? "bad" : ""}">${esc(v)}</span>` },
      ], c.rows);
      K.table($("#abL", box), [
        { key: "level", label: "LV", fmt: (v) => `<b>${v}</b>` },
        { key: "d", label: "Δ droprate", align: "r", fmt: (v) => `<span class="${v > 0 ? "t-bad" : "t-ok"}">${F.pp(v)}</span>` },
        { key: "z", label: "z", align: "r", fmt: (v) => F.n1(v, 1) },
        { key: "wr", label: "Δ win rate", align: "r", fmt: (v) => F.pp(v) },
        { key: "better", label: "Kết luận", fmt: (v, r) => v ? `<span class="mini ok">${esc(c.treat)} giữ chân tốt hơn</span>` : `<span class="mini bad">${esc(c.treat)} mất người hơn${r.wr != null && r.wr <= -0.1 ? " — do khó hơn" : ""}</span>` },
      ], c.levels, { empty: "Không có level nào khác biệt rõ." });
    }

    // ================================================================ hồ sơ cột (bảng thường)
    function colsTab(box) {
      const r = S.lint;
      box.innerHTML = `<div class="row" style="justify-content:flex-end"><button class="btn sm" id="exp"></button></div><div id="cols"></div>`;
      K.exportMenu($("#exp", box), () => ({ name: "data_lint_" + (S.table.name || "file").replace(/\.[^.]+$/, ""), sheets: [
        { name: "Vấn đề", headers: ["Mức", "Vấn đề", "Cột", "Chi tiết", "Việc cần làm"], rows: issues().map((x) => [{ bad: "LỖI", warn: "Xem lại", info: "Lưu ý" }[x.level], x.title, x.where || "", x.detail, x.action || ""]) },
        { name: "Hồ sơ cột", headers: ["Cột", "Kiểu", "Có giá trị", "Trống", "Khác nhau", "Nhỏ nhất", "Lớn nhất", "Tổng"],
          rows: r.columns.map((c) => [c.name, TYPE[c.type] || c.type, c.filled, c.empty, c.unique, c.min ?? "", c.max ?? "", c.sum ?? ""]) },
      ] }));
      const flagged = new Map();
      r.issues.forEach((x) => { if (x.column) flagged.set(x.column, x.level === "bad" || flagged.get(x.column) === "bad" ? "bad" : "warn"); });
      K.table($("#cols", box), [
        { key: "name", label: "Cột", fmt: (v) => `<b>${esc(v)}</b>` },
        { key: "type", label: "Kiểu", fmt: (v) => TYPE[v] || v },
        { key: "filled", label: "Có giá trị", align: "r", fmt: (v, c) => K.fmt.int(v) + (c.empty ? ` <span class="dim">(${K.fmt.pct(c.empty / (c.empty + c.filled))} trống)</span>` : "") },
        { key: "unique", label: "Khác nhau", align: "r", fmt: (v) => K.fmt.int(v) },
        { key: "min", label: "Nhỏ nhất", align: "r", fmt: (v) => v == null ? "—" : K.fmt.num(v, 3) },
        { key: "max", label: "Lớn nhất", align: "r", fmt: (v) => v == null ? "—" : K.fmt.num(v, 3) },
        { key: "sum", label: "Tổng", align: "r", fmt: (v) => v == null ? "—" : K.fmt.num(v, 2) },
        { key: "top", label: "Giá trị hay gặp", sort: false, fmt: (v) => `<span class="dim">${esc((v || []).slice(0, 3).map(([x, c]) => `${x.length > 18 ? x.slice(0, 17) + "…" : x} (${c})`).join(", "))}</span>` },
      ], r.columns, { rowClass: (c) => flagged.get(c.name) === "bad" ? "row-bad" : flagged.get(c.name) ? "row-warn" : "" });
    }

    function sample(plain) {
      if (plain) {
        imp.set(Object.assign(T.parseTable(plainCsv()), { name: "mau_level_export.csv" }));
        toast("Đã nạp file mẫu — có cài sẵn 4 lỗi hay gặp.", "ok");
      } else {
        imp.set(Object.assign(T.parseTable(insightCsv()), { name: "mau_level_insight_v0_v1.csv" }));
        toast("Đã nạp Level insight mẫu (60 level, 2 version) — có tường khó, màn dài, rò sau khi thắng, event thua không bắn.", "ok");
      }
    }
    return { sample: () => sample(), cleanup: () => S.charts.forEach((c) => c.destroy()) };
  }

  /** Export level thường: lose_quit luôn 0, thiếu level 45–46, 1 dòng trùng, ngày cuối kéo giữa ngày. */
  function plainCsv() {
    const lines = ["event_date,level,users,level_start,level_win,lose_quit"];
    for (let d = 1; d <= 7; d++) {
      const date = "2026-10-0" + d, part = d === 7 ? 0.2 : 1;
      for (let lv = 40; lv <= 52; lv++) {
        if (lv === 45 || lv === 46) continue;
        const u = Math.round((1200 - lv * 9) * part);
        lines.push([date, lv, u, Math.round(u * 1.4), Math.round(u * 0.97), 0].join(","));
      }
    }
    lines.push(lines[5]);
    return lines.join("\n");
  }

  /** Level insight mẫu (định dạng export 3 tầng tiêu đề, v0 / v1 / Δ): nhịp răng cưa 10 level, LV24 là tường (v1 đã nới),
      LV6–7 dài mà dễ, LV31 thắng xong bỏ game, LV50–54 quá dễ, event thua không bắn (lose_quit = 0, pt_lose = 0). */
  function insightCsv() {
    const M = ["droprate", "remain", "lose_quit", "win_quit", "mid_quit", "attempts", "first_win", "win_rate", "pt_total", "pt_win", "pt_lose",
      "lose_retry", "quit_att", "ss_exit", "sfa", "sra", "user_helper", "helper", "user_iap", "iap"];
    const P = new Set(["droprate", "remain", "lose_quit", "win_quit", "mid_quit", "first_win", "win_rate", "lose_retry", "ss_exit", "user_helper", "user_iap"]);
    let seed = 7;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280 - 0.5; };
    const gen = (ver) => {
      const out = [];
      let reach = ver === "v0" ? 5200 : 5150;
      for (let lv = 1; lv <= 60; lv++) {
        const t = lv % 10;
        let wr = t === 4 ? 0.66 : t === 9 ? 0.58 : t === 0 ? 0.97 : 0.9 - lv * 0.002;
        let drop = 0.012 + (1 - wr) * 0.035 + rnd() * 0.004, ptw = 75 + lv * 1.2 + rnd() * 10, wq = 0.35, ss = 0.17 + rnd() * 0.03;
        if (lv <= 3) drop += 0.02;
        if (lv === 24) { wr = ver === "v0" ? 0.38 : 0.6; drop = ver === "v0" ? 0.085 : 0.045; ss = 0.36; }
        if (lv === 6 || lv === 7) { wr = 0.96; drop = 0.046; ptw = 215; }
        if (lv === 31) { wr = 0.92; drop = 0.052; wq = 0.72; }
        if (lv >= 50 && lv <= 54) { wr = 0.985; drop = 0.01; ptw = 60; }
        const att = 1 / wr, fw = Math.min(0.99, wr * 0.97 + 0.02);
        out.push({ lv, reach: Math.round(reach), droprate: drop, remain: 0, lose_quit: 0, win_quit: drop * wq, mid_quit: drop * (1 - wq), attempts: att, first_win: fw, win_rate: wr,
          pt_total: Math.round(ptw + 8), pt_win: Math.round(ptw), pt_lose: 0, lose_retry: lv < 20 ? null : 0.2 + rnd() * 0.05, quit_att: 1.2 + (1 - wr) * 4.2,
          ss_exit: ss, sfa: 0.1 + lv * 0.012, sra: 0.15 + (1 - wr) * 1.6, user_helper: 0.1 + (1 - wr) * 0.9, helper: 0.12 + (1 - wr) * 2, user_iap: 0.001, iap: 0.001 });
        reach *= 1 - drop;
      }
      const r1 = out[0].reach; out.forEach((x) => { x.remain = x.reach / r1; });
      return out;
    };
    const A = gen("v0"), B = gen("v1");
    const f = (k, v) => v == null ? "" : P.has(k) ? (v * 100).toFixed(1) + "%" : k.startsWith("pt") ? String(Math.round(v)) : v.toFixed(2);
    const fd = (k, a, b) => { if (a == null || b == null) return ""; const d = b - a; const s = P.has(k) ? (Math.abs(d) * 100).toFixed(1) + "%" : k.startsWith("pt") ? String(Math.abs(Math.round(d))) : Math.abs(d).toFixed(2); return (d < 0 ? "−" : "+") + s; };
    const groups = { droprate: "RETENTION IMPACT", attempts: "DIFFICULTY CALIBRATION", lose_retry: "ENGAGEMENT QUALITY", sfa: "MONETIZATION HEALTH" };
    const h1 = ["LV", "REACH", ""], h2 = ["", "", ""], h3 = ["", "v0", "v1"];
    M.forEach((k) => { h1.push(groups[k] || "", "", ""); h2.push(k, "", ""); h3.push("v0", "v1", "Δ"); });
    const W = A.reduce((s, x) => s + x.reach, 0);
    const avg = ["avg", "", ""];
    M.forEach((k) => {
      const wa = A.reduce((s, x) => s + (x[k] || 0) * x.reach, 0) / W, wb = B.reduce((s, x, i) => s + (x[k] || 0) * A[i].reach, 0) / W;
      avg.push(f(k, wa), f(k, wb), fd(k, wa, wb));
    });
    const rows = A.map((a, i) => { const b = B[i], r = [a.lv, a.reach, b.reach]; M.forEach((k) => r.push(f(k, a[k]), f(k, b[k]), fd(k, a[k], b[k]))); return r; });
    const q = (c) => /[",]/.test(String(c)) ? '"' + String(c).replace(/"/g, '""') + '"' : String(c);
    return [h1, h2, h3, avg].concat(rows).map((r) => r.map(q).join(",")).join("\n");
  }
})();

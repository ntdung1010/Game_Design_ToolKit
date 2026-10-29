/* AB Readout — đọc kết quả AB: thắng / thua / chưa đủ chắc, kèm cảnh báo bẫy dữ liệu. */
(() => {
  "use strict";
  const { $, $$, esc, icon, toast } = GDK;
  const K = GDK.kit, T = GDK.lib.table, AB = GDK.lib.abtest;
  const STATUS = {
    win: ["THẮNG", "ok"], lose: ["THUA", "bad"], flat: ["Tương đương", "m"], unsure: ["Chưa đủ chắc", "warn"], noci: ["Không có khoảng tin cậy", "m"],
  };

  GDK.tools["ab-readout"] = { mount };

  function mount(root) {
    const S = { table: null, map: {}, auto: {}, metrics: [], control: "", aa: "", primary: "", exclude: 0, title: "", charts: [], res: null };
    root.innerHTML = `
      <section class="panel">
        <div class="ph"><span class="step">1</span><h2>Dữ liệu theo nhánh</h2><span class="sub">1 dòng / nhánh, hoặc nhiều dòng / nhánh theo ngày cài</span></div>
        <div class="pb"><div id="imp"></div><div id="map" style="margin-top:12px"></div></div>
      </section>
      <section class="panel" id="setup" hidden>
        <div class="ph"><span class="step">2</span><h2>So sánh cái gì</h2></div>
        <div class="pb" id="setupBody"></div>
      </section>
      <section class="panel" id="res" hidden>
        <div class="ph"><span class="step">3</span><h2>Kết quả</h2>
          <div class="right"><button class="btn sm" id="copy">${icon("copy")} Copy tóm tắt</button><button class="btn sm" id="exp"></button></div></div>
        <div class="pb" id="out"></div>
      </section>
      <section class="panel" id="intro">
        <div class="pb">${K.empty({ illus: "ab-readout", title: "Chưa có dữ liệu AB",
          text: "Thả file số liệu theo nhánh ở bước 1 — hoặc bấm <b>Thử với dữ liệu mẫu</b> (3 nhánh A / B / A2-A/A, 14 ngày cài).",
          actions: `<button class="btn primary" id="introSample">${icon("flask")} Thử với dữ liệu mẫu</button>` })}</div>
      </section>`;
    const el = (s) => $(s, root);
    const imp = K.importer(el("#imp"), { cacheKey: "ab-readout", title: "Kéo thả file số liệu AB (CSV / Excel)", onTable: (t) => load(t), onSample: () => sample() });
    el("#introSample").onclick = () => sample();
    el("#copy").onclick = () => S.res && K.copy(AB.summaryText(S.res, chosen(), S.title || "Kết quả AB"), "Đã copy tóm tắt — dán vào Slack / báo cáo");

    const chosen = () => S.metrics.filter((m) => m.on);
    K.exportMenu(el("#exp"), () => {
      if (!S.res) return null;
      const ms = chosen(), r = S.res;
      const rows = r.comps.flatMap((c) => ms.map((m) => {
        const x = c.metrics[m.col];
        const pct = (v) => (v == null ? "" : +(v * 100).toFixed(2));
        return [m.label, c.arm, r.control, x.control, x.test, pct(x.rel), pct(x.lo), pct(x.hi), x.p == null ? "" : +x.p.toFixed(4),
          { win: "THẮNG", lose: "THUA", flat: "Tương đương", unsure: "Chưa đủ chắc", noci: "Không có CI" }[x.status]];
      }));
      return { name: (S.title || "ab_readout").replace(/[^\w\-]+/g, "_"), sheets: [
        { name: "Kết quả", headers: ["Chỉ số", "Nhánh", "Nhánh gốc", "Giá trị gốc", "Giá trị nhánh", "Chênh (%)", "CI 95% thấp (%)", "CI 95% cao (%)", "p", "Kết luận"], rows },
        { name: "Tóm tắt", headers: ["Nội dung"], rows: AB.summaryText(r, ms, S.title || "Kết quả AB").split("\n").map((l) => [l]) },
      ] };
    }, { label: "Xuất" });

    function load(t, preset) {
      S.table = t;
      S.auto = T.autoMap(t.headers, AB.FIELDS);
      S.map = Object.assign({}, S.auto);
      K.mapper(el("#map"), { fields: AB.FIELDS, headers: t.headers, map: S.map, auto: S.auto, onChange: () => { initMetrics(); renderSetup(); run(); } });
      initMetrics(preset);
      renderSetup();
      run();
    }

    function arms() {
      if (!S.map.arm) return [];
      return [...new Set(S.table.rows.map((r) => String(r[S.map.arm] ?? "").trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "vi", { numeric: true }));
    }

    function initMetrics(preset) {
      const used = new Set([S.map.arm, S.map.users, S.map.date].filter(Boolean));
      const nums = T.numericColumns(S.table.headers, S.table.rows).filter((h) => !used.has(h));
      S.metrics = nums.map((h, i) => {
        const type = S.map.users ? AB.guessMetric(h, S.table.rows, S.map.users) : "rate";
        return {
        col: h, label: AB.prettyLabel(h, type), type,
        lowerBetter: /churn|quit|uninstall|lose|fail|crash|bo_game/.test(T.norm(h)), on: i < 6,
        };
      });
      const a = arms();
      S.control = a.find((x) => /^(a|ctrl|control|goc|gốc|baseline|v0|0)$/i.test(x) || /control|gốc|goc/i.test(x)) || a[0] || "";
      S.aa = a.find((x) => /a\/?a|aa$|a2/i.test(x) && x !== S.control) || "";
      S.primary = (S.metrics.find((m) => m.on && m.type === "rate") || S.metrics[0] || {}).col || "";
      const day = Math.max(0, ...chosen().map((m) => AB.metricDay(m.col)));
      S.exclude = S.map.date && day ? day : 0;
      if (preset) Object.assign(S, preset);
    }

    function renderSetup() {
      el("#intro").hidden = true;
      el("#setup").hidden = false;
      const a = arms();
      const day = Math.max(0, ...chosen().map((m) => AB.metricDay(m.col)));
      el("#setupBody").innerHTML = `
        <div class="grid3">
          <div><label class="lb">Tên AB (để ghi vào tóm tắt)</label><input type="text" id="title" placeholder="vd AB_20261005 booster sớm" value="${esc(S.title)}"></div>
          <div><label class="lb">Nhánh gốc (control)</label><select id="ctl">${a.map((x) => `<option ${x === S.control ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></div>
          <div><label class="lb" title="Nhánh giống hệt nhánh gốc — dùng để kiểm tra độ nhiễu của dữ liệu">Nhánh A/A (nếu có)</label><select id="aa"><option value="">— không có —</option>${a.filter((x) => x !== S.control).map((x) => `<option ${x === S.aa ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></div>
          ${S.map.date ? `<div><label class="lb">Bỏ N ngày cài cuối ${day ? `<span class="mini l">gợi ý ${day} vì có D${day}</span>` : ""}</label><input type="text" id="excl" inputmode="numeric" value="${S.exclude}"></div>` : ""}
        </div>
        <div class="sectit">Chỉ số so sánh <span class="dim" style="text-transform:none;font-family:var(--font);font-weight:400">— chọn ★ cho chỉ số chính</span></div>
        ${S.metrics.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Dùng</th><th>Cột</th><th>Loại chỉ số</th><th title="vd churn, crash: giảm mới là tốt">Càng thấp càng tốt</th><th>Chính</th></tr></thead><tbody>
          ${S.metrics.map((m, i) => `<tr>
            <td><input type="checkbox" data-i="${i}" data-f="on" ${m.on ? "checked" : ""}></td>
            <td><b>${esc(m.label)}</b>${m.label !== m.col ? ` <span class="dim mono" style="font-size:11.5px">${esc(m.col)}</span>` : ""}</td>
            <td><select data-i="${i}" data-f="type" style="height:30px;width:auto">
              <option value="rate" ${m.type === "rate" ? "selected" : ""}>Tỉ lệ — số user đạt / số user</option>
              <option value="mean" ${m.type === "mean" ? "selected" : ""}>Trung bình / user — vd doanh thu</option></select></td>
            <td><input type="checkbox" data-i="${i}" data-f="lowerBetter" ${m.lowerBetter ? "checked" : ""}></td>
            <td><input type="radio" name="prim" data-i="${i}" ${S.primary === m.col ? "checked" : ""}></td></tr>`).join("")}
          </tbody></table></div>` : `<div class="note">${icon("alert")}<div>Không thấy cột số nào để so sánh (ngoài cột nhánh / số user / ngày).</div></div>`}`;
      el("#title").oninput = (e) => { S.title = e.target.value; };
      el("#ctl").onchange = (e) => { S.control = e.target.value; if (S.aa === S.control) S.aa = ""; renderSetup(); run(); };
      el("#aa").onchange = (e) => { S.aa = e.target.value; run(); };
      const ex = el("#excl");
      if (ex) ex.oninput = () => { S.exclude = Math.max(0, Math.round(T.toNumber(ex.value) || 0)); run(); };
      $$("#setupBody [data-f]", root).forEach((inp) => inp.onchange = () => {
        const m = S.metrics[+inp.dataset.i];
        m[inp.dataset.f] = inp.type === "checkbox" ? inp.checked : inp.value;
        if (inp.dataset.f === "type") m.label = AB.prettyLabel(m.col, m.type);
        if (!chosen().some((x) => x.col === S.primary)) S.primary = (chosen()[0] || {}).col || "";
        renderSetup(); run();
      });
      $$('#setupBody input[name="prim"]', root).forEach((r) => r.onchange = () => {
        const m = S.metrics[+r.dataset.i]; m.on = true; S.primary = m.col; renderSetup(); run();
      });
    }

    function run() {
      S.charts.forEach((c) => c.destroy()); S.charts = [];
      el("#res").hidden = false;
      const ms = chosen();
      try {
        S.res = AB.analyze(S.table.rows, S.map, ms, { control: S.control, aa: S.aa, primary: S.primary, excludeLastDays: S.map.date ? S.exclude : 0 });
      } catch (e) {
        S.res = null;
        el("#out").innerHTML = K.verdict("bad", e.message, "Kiểm tra cột ở bước 1 và chỉ số ở bước 2.");
        return;
      }
      const r = S.res, v = r.verdict;
      const prim = ms.find((m) => m.col === r.primary);
      const vKind = { win: "ok", lose: "bad", flat: "mid", mixed: "mid", unsure: "mid" }[v.kind];
      const tiles = K.tiles([
        ...r.arms.map((a) => ({ n: K.fmt.int(a.users), label: "user · " + a.name + (a.name === r.control ? " (gốc)" : a.name === S.aa ? " (A/A)" : ""), cls: a.name === r.control ? "acc" : "" })),
        r.mdeRel != null ? { n: "±" + K.fmt.pct(r.mdeRel, 1), label: "chênh nhỏ nhất phát hiện được", sub: "cho " + prim.label, title: "Với cỡ mẫu này, chênh lệch nhỏ hơn mức này khó phân biệt với nhiễu (power 80%)" } : null,
        r.cut ? { n: r.cut.slice(5).split("-").reverse().join("/"), label: "chỉ tính cohort cài đến ngày" } : null,
      ].filter(Boolean));
      // nhánh test lên trước, nhánh A/A (kiểm tra nhiễu) xuống cuối
      const comps = r.comps.slice().sort((a, b) => (a.arm === S.aa) - (b.arm === S.aa));
      const rows = [];
      for (const c of comps) for (const m of ms) {
        const x = c.metrics[m.col];
        rows.push({
          label: m.label + " · " + c.arm, sub: fmtVal(x.control, m) + " → " + fmtVal(x.test, m), est: x.rel, lo: x.lo, hi: x.hi, status: x.status,
          tip: `<div class="th">${esc(m.label)}: ${esc(c.arm)} so với ${esc(r.control)}</div><div class="tl"><span>Gốc</span><b>${esc(fmtVal(x.control, m))}</b></div>
            <div class="tl"><span>${esc(c.arm)}</span><b>${esc(fmtVal(x.test, m))}</b></div><div class="tl"><span>Chênh</span><b>${K.fmt.spct(x.rel)}</b></div>
            ${x.lo != null ? `<div class="tl"><span>95%</span><b>${K.fmt.spct(x.lo)} … ${K.fmt.spct(x.hi)}</b></div><div class="tl"><span>p</span><b>${x.p < 0.001 ? "< 0,001" : x.p.toFixed(3).replace(".", ",")}</b></div>` : ""}
            <div class="tx">${esc(STATUS[x.status][0])}</div>`,
        });
      }
      el("#out").innerHTML = `${K.verdict(vKind, v.title, v.detail, prim ? "chỉ số chính: " + prim.label : "")}
        ${r.warnings.length ? `<div style="margin:12px 0">${K.issueList(r.warnings.map((w) => ({ level: w.level, title: w.text.split(" — ")[0], detail: w.text.split(" — ").slice(1).join(" — ") })))}</div>` : ""}
        ${tiles}
        <div class="sectit">Chênh lệch so với nhánh gốc (khoảng tin cậy 95%)</div>
        <div class="chart-title"><small>Thanh không chạm vạch 0% = khác biệt có ý nghĩa · xanh = tốt hơn · đỏ = xấu hơn</small></div>
        <div id="forest"></div>
        <div class="sectit">Bảng chi tiết</div><div id="tbl"></div>
        <div class="sectit">Tóm tắt để gửi</div>
        <textarea class="code" rows="6" readonly id="sum"></textarea>`;
      S.charts.push(K.forest(el("#forest"), rows));
      K.table(el("#tbl"), [
        { key: "metric", label: "Chỉ số" }, { key: "arm", label: "Nhánh" },
        { key: "control", label: "Gốc", align: "r" }, { key: "test", label: "Nhánh test", align: "r" },
        { key: "rel", label: "Chênh", align: "r", fmt: (v) => K.fmt.spct(v) },
        { key: "ci", label: "95%", align: "r", sort: false, cls: () => "nw" },
        { key: "p", label: "p", align: "r", fmt: (v) => v == null ? "—" : v < 0.001 ? "<0,001" : v.toFixed(3).replace(".", ",") },
        { key: "status", label: "Kết luận", fmt: (v) => `<span class="mini ${STATUS[v][1]}">${STATUS[v][0]}</span>` },
      ], comps.flatMap((c) => ms.map((m) => {
        const x = c.metrics[m.col];
        return { metric: m.label + (m.col === r.primary ? " ★" : ""), arm: c.arm, control: fmtVal(x.control, m), test: fmtVal(x.test, m), rel: x.rel,
          ci: x.lo != null ? K.fmt.spct(x.lo) + " … " + K.fmt.spct(x.hi) : "—", p: x.p, status: x.status };
      })), { rowClass: (row) => row.status === "win" ? "row-ok" : row.status === "lose" ? "row-bad" : "" });
      el("#sum").value = AB.summaryText(r, ms, S.title || "Kết quả AB");
    }

    function fmtVal(v, m) { return m.type === "rate" ? K.fmt.pct(v, 2) : K.fmt.money(v); }

    function sample() {
      imp.set(Object.assign(T.parseTable(sampleCsv()), { name: "mau_ab_cohort.csv" }));
      S.title = "AB_mẫu — booster sớm";
      renderSetup(); run();
      toast("Đã nạp dữ liệu mẫu: nhánh A (gốc), B (booster sớm), A2 (A/A) · 14 ngày cài.", "ok");
    }
    function template() {
      K.download("mau_ab_readout.csv", T.toCSV(["install_date", "arm", "installs", "d1_users", "d7_users", "revenue"],
        [["2026-10-01", "A", 2000, 800, 300, "210.5"], ["2026-10-01", "B", 2010, 845, 310, "220.1"], ["2026-10-02", "A", 1980, 790, 296, "205.0"]]));
    }
    return { cleanup: () => S.charts.forEach((c) => c.destroy()), sample, template };
  }

  /** Dữ liệu mẫu: B tăng D1 ~5%, A2 là A/A, 5 ngày cài cuối chưa đủ tuổi cho D7. */
  function sampleCsv() {
    let seed = 5;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const lines = ["install_date,arm,installs,d1_users,d3_users,d7_users,revenue"];
    const arms = [["A", 0.40, 0.21, 0.135, 0.105], ["B", 0.42, 0.222, 0.141, 0.108], ["A2", 0.40, 0.21, 0.135, 0.105]];
    for (let d = 0; d < 14; d++) {
      const date = "2026-09-" + String(d + 10).padStart(2, "0");
      const age = 13 - d;
      for (const [arm, d1, d3, d7, arpu] of arms) {
        const u = Math.round(2400 + (rnd() - 0.5) * 300);
        const nd1 = Math.round(u * (d1 + (rnd() - 0.5) * 0.02));
        const nd3 = age >= 3 ? Math.round(u * (d3 + (rnd() - 0.5) * 0.015)) : Math.round(u * d3 * 0.4);
        const nd7 = age >= 7 ? Math.round(u * (d7 + (rnd() - 0.5) * 0.012)) : Math.round(u * d7 * (age / 9));
        const rev = (u * arpu * (0.75 + rnd() * 0.5)).toFixed(2);
        lines.push([date, arm, u, nd1, nd3, nd7, rev].join(","));
      }
    }
    return lines.join("\n");
  }
})();

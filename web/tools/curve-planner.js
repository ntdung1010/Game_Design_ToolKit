/* Curve Planner — thiết kế đường độ khó mục tiêu và so với điểm độ khó thực tế. */
(() => {
  "use strict";
  const { $, $$, esc, icon, toast, store } = GDK;
  const K = GDK.kit, T = GDK.lib.table, CV = GDK.lib.curve;
  const SHAPES = [["linear", "Tăng đều"], ["easeOut", "Nhanh rồi chậm"], ["easeIn", "Chậm rồi nhanh"], ["log", "Rất êm"]];
  const CYCLES = {
    none: { label: "Không", cycle: [0] },
    c5: { label: "5 level", cycle: [-10, -4, 0, 6, 14] },
    c10: { label: "10 level", cycle: [-8, -6, -2, 0, 2, -4, 0, 4, 8, 0] },
  };
  const TIER_CLS = { easy: "easy", normal: "normal", hard: "hard", super: "super" };
  const FIELDS = [
    { key: "level", label: "Level", required: true, synonyms: ["level", "lvl", "level_id", "stage"] },
    { key: "score", label: "Điểm độ khó thực tế", required: true, synonyms: ["score", "difficulty", "diff", "do_kho", "struggle", "struggle_index", "hardness", "point", "diem"] },
  ];

  GDK.tools["curve-planner"] = { mount };

  function mount(root) {
    const p0 = Object.assign({}, CV.PRESETS.saw10, { cycleKey: "c10", preset: "saw10" });
    const S = { p: Object.assign(p0, store.get("gdk.curve", {})), table: null, map: {}, auto: {}, tol: 12, charts: [], target: [], cmp: null };
    root.innerHTML = `
      <section class="panel">
        <div class="ph"><span class="step">1</span><h2>Thiết kế đường mục tiêu</h2><span class="sub">thang 0–100 · dùng được cho mọi game</span></div>
        <div class="pb">
          <label class="lb">Bắt đầu từ mẫu</label>
          <div class="pill-toggle" id="presets" style="margin-bottom:16px">${Object.entries(CV.PRESETS).map(([k, v]) => `<button class="chip" data-p="${k}">${esc(v.label)}</button>`).join("")}</div>
          <div class="grid2" id="ctrls"></div>
        </div>
      </section>
      <section class="panel">
        <div class="ph"><span class="step">2</span><h2>Đường độ khó</h2>
          <div class="right"><button class="btn sm" id="csv"></button></div></div>
        <div class="pb">
          <div id="sum"></div>
          <div class="legend" style="margin-top:12px">${CV.TIERS.map((t) => `<span><i style="background:var(--${t.key === "easy" ? "ok" : t.key === "normal" ? "accent" : t.key === "hard" ? "warn" : "danger"})"></i>${esc(t.label)} ${t.key === "super" ? "≥ 80" : "< " + t.max}</span>`).join("")}</div>
          <div id="chart"></div>
          <div class="grid2" style="margin-top:14px"><div><div class="sectit" style="margin-top:0">Phân bố mức khó (mục tiêu)</div><div id="dist"></div></div><div id="distAct"></div></div>
        </div>
      </section>
      <section class="panel">
        <div class="ph"><span class="step">3</span><h2>So với độ khó thực tế</h2><span class="sub">không bắt buộc · điểm từ tool chấm độ khó, solver, hoặc 1 − winrate</span></div>
        <div class="pb"><div id="imp"></div><div id="map" style="margin-top:12px"></div><div id="cmp"></div></div>
      </section>`;
    const el = (s) => $(s, root);
    const imp = K.importer(el("#imp"), { cacheKey: "curve-planner:actual", title: "Thả file điểm độ khó theo level (CSV / Excel)", onTable: (t) => load(t), onSample: () => sample(), sampleLabel: "Dùng điểm thực tế mẫu" });

    function sliders() {
      const p = S.p;
      const sl = (k, label, min, max, step = 1, help = "") => `<div class="field"><label class="lb" ${help ? `title="${esc(help)}"` : ""}>${label}</label>
        <div class="slider"><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${p[k]}"><output id="o_${k}">${p[k]}</output></div></div>`;
      el("#ctrls").innerHTML = `
        ${sl("levels", "Số level", 10, 1000, 10)}
        <div class="field"><label class="lb">Dạng tăng độ khó</label><div class="seg" id="shape">${SHAPES.map(([k, l]) => `<button data-k="${k}" class="${p.shape === k ? "on" : ""}">${l}</button>`).join("")}</div></div>
        ${sl("start", "Độ khó level đầu (sau hướng dẫn)", 0, 100)}
        ${sl("end", "Độ khó level cuối", 0, 100)}
        <div class="field"><label class="lb" title="Lặp lại nhịp dễ–khó để người chơi được thở">Nhịp răng cưa</label><div class="seg" id="cyc">${Object.entries(CYCLES).map(([k, v]) => `<button data-k="${k}" class="${p.cycleKey === k ? "on" : ""}">${v.label}</button>`).join("")}</div></div>
        ${sl("tutorial", "Số level hướng dẫn (giữ dễ)", 0, 30)}
        ${sl("bossEvery", "Level boss mỗi … level (0 = không có)", 0, 50, 1)}
        ${sl("bossBoost", "Boss khó hơn bao nhiêu điểm", 0, 40)}
        <label class="check"><input type="checkbox" id="relief" ${p.reliefAfterBoss ? "checked" : ""}><span>Level ngay sau boss là level nghỉ (dễ hơn)</span></label>`;
      $$("#ctrls input[type=range]", root).forEach((r) => r.oninput = () => { S.p[r.dataset.k] = +r.value; el("#o_" + r.dataset.k).textContent = r.value; S.p.preset = ""; markPreset(); update(); });
      $$("#shape button", root).forEach((b) => b.onclick = () => { S.p.shape = b.dataset.k; S.p.preset = ""; sliders(); update(); });
      $$("#cyc button", root).forEach((b) => b.onclick = () => { S.p.cycleKey = b.dataset.k; S.p.cycle = CYCLES[b.dataset.k].cycle; S.p.preset = ""; sliders(); update(); });
      el("#relief").onchange = (e) => { S.p.reliefAfterBoss = e.target.checked; update(); };
      markPreset();
    }
    function markPreset() { $$("#presets .chip", root).forEach((c) => c.classList.toggle("on", c.dataset.p === S.p.preset)); }
    $$("#presets .chip", root).forEach((c) => c.onclick = () => applyPreset(c.dataset.p));
    function applyPreset(k) {
      const v = CV.PRESETS[k];
      S.p = Object.assign({}, v, { preset: k, cycleKey: Object.keys(CYCLES).find((x) => JSON.stringify(CYCLES[x].cycle) === JSON.stringify(v.cycle)) || "none" });
      sliders(); update();
    }

    function load(t) {
      S.table = t;
      S.auto = T.autoMap(t.headers, FIELDS);
      S.map = Object.assign({}, S.auto);
      K.mapper(el("#map"), { fields: FIELDS, headers: t.headers, map: S.map, auto: S.auto, onChange: () => update() });
      update();
    }

    function update() {
      store.set("gdk.curve", S.p);
      S.charts.forEach((c) => c.destroy()); S.charts = [];
      S.target = CV.generate(S.p);
      S.cmp = null;
      if (S.table && S.map.level && S.map.score) S.cmp = CV.compare(S.target, S.table.rows, S.map, S.tol);
      const tgt = S.target, d = CV.distribution(tgt, "target");
      const bosses = tgt.filter((x) => x.role === "boss");
      const tStreaks = CV.hardStreaks(tgt, "target", { minLen: 6 });
      el("#sum").innerHTML = K.tiles([
        { n: tgt.length, label: "level" },
        { n: tgt[0].target + " → " + tgt[tgt.length - 1].target, label: "độ khó đầu → cuối", cls: "acc" },
        { n: bosses.length, label: "level boss" },
        { n: K.fmt.pct((d.hard + d.super) / tgt.length), label: "level Khó + Rất khó" },
        S.cmp ? { n: K.fmt.pct(S.cmp.fit), label: `level thực tế lệch ≤ ${S.tol} điểm`, cls: S.cmp.fit >= 0.8 ? "ok" : S.cmp.fit >= 0.6 ? "warn" : "bad" } : null,
      ].filter(Boolean)) + (tStreaks.length ? `<div style="margin-top:10px">${K.issueList(tStreaks.slice(0, 3).map((s) => ({ level: "warn", title: `Mục tiêu có ${s.len} level khó liên tiếp: L${s.from}–L${s.to}`, detail: "Chuỗi khó dài dễ làm người chơi bỏ game — tăng nhịp răng cưa hoặc thêm level nghỉ." })))}</div>` : "");

      const series = [{ name: "Mục tiêu", points: tgt.map((x) => ({ x: x.level, y: x.target })) }];
      const markers = [];
      if (S.cmp) {
        series.push({ name: "Thực tế", dash: true, points: S.cmp.rows.map((x) => ({ x: x.level, y: x.actual })) });
        // gộp các level lệch liền nhau (cùng chiều) thành 1 nhãn "L41–45" để chữ không chồng nhau
        const off = S.cmp.rows.filter((x) => x.flag);
        const runs = [];
        for (const x of off) {
          const last = runs[runs.length - 1];
          if (last && last.flag === x.flag && x.level === last.to + 1) { last.to = x.level; last.items.push(x); }
          else runs.push({ flag: x.flag, from: x.level, to: x.level, items: [x] });
        }
        runs.sort((a, b) => Math.max(...b.items.map((i) => Math.abs(i.dev))) - Math.max(...a.items.map((i) => Math.abs(i.dev))));
        runs.forEach((r, k) => {
          const peak = r.items.reduce((m, i) => (Math.abs(i.dev) > Math.abs(m.dev) ? i : m));
          r.items.forEach((i) => markers.push({ x: i.level, y: i.actual, kind: r.flag === "harder" ? "bad" : "warn",
            label: i === peak && k < 8 ? (r.from === r.to ? "L" + r.from : "L" + r.from + "–" + r.to) : "" }));
        });
      }
      const byLv = new Map(tgt.map((x) => [x.level, x]));
      const cmpBy = S.cmp ? new Map(S.cmp.rows.map((x) => [x.level, x])) : null;
      S.charts.push(K.lineChart(el("#chart"), {
        series, height: 300, yMin: 0, yMax: 100, xFormat: (v, full) => (full ? "Level " : "L") + v,
        yFormat: (v) => String(Math.round(v)),
        bands: CV.TIERS.map((t, i) => ({ y0: i ? CV.TIERS[i - 1].max : 0, y1: Math.min(100, t.max), cls: TIER_CLS[t.key] })),
        markers,
        tooltipExtra: (x) => {
          const t = byLv.get(x), c = cmpBy && cmpBy.get(x);
          let h = `<div class="tx">${esc(CV.TIERS.find((z) => z.key === t.tier).label)}${t.role ? " · " + esc(t.role) : ""}</div>`;
          if (c && c.flag) h += `<div class="tx bad">${c.flag === "harder" ? "Khó hơn" : "Dễ hơn"} mục tiêu ${Math.abs(Math.round(c.dev))} điểm</div>`;
          return h;
        },
      }));
      const distItems = (dd) => CV.TIERS.map((t) => ({ label: t.label, value: dd[t.key], cls: TIER_CLS[t.key] }));
      el("#dist").innerHTML = K.bars(distItems(d));
      el("#distAct").innerHTML = S.cmp ? `<div class="sectit" style="margin-top:0">Phân bố mức khó (thực tế)</div>${K.bars(distItems(CV.distribution(S.cmp.rows, "actual")))}` : "";
      drawCompare();
    }

    function drawCompare() {
      const box = el("#cmp");
      if (!S.cmp) { box.innerHTML = ""; return; }
      const c = S.cmp, off = c.rows.filter((x) => x.flag);
      box.innerHTML = `<div class="row" style="align-items:flex-end;margin:16px 0 12px;gap:18px">
          <div style="width:260px"><label class="lb">Sai lệch cho phép (điểm)</label><div class="slider"><input type="range" id="tol" min="3" max="30" value="${S.tol}"><output id="oTol">${S.tol}</output></div></div>
          <span class="hint" style="margin:0">Điểm thực tế ${c.scale !== 1 ? `được đổi về thang 0–100 (×${c.scale})` : "đang ở thang 0–100"} · có ${c.counted}/${S.target.length} level.</span>
          <span class="grow"></span></div>
        ${K.issueList([
          ...c.streaks.slice(0, 4).map((s) => ({ level: "bad", title: `${s.len} level khó liên tiếp ngoài kế hoạch: L${s.from}–L${s.to}`, detail: "Mục tiêu ở đoạn này không khó nhưng thực tế khó — hạ 1–2 level hoặc chèn level nghỉ." })),
          { level: off.length ? "warn" : "ok", title: off.length ? `${off.filter((x) => x.flag === "harder").length} level khó hơn, ${off.filter((x) => x.flag === "easier").length} level dễ hơn mục tiêu` : "Mọi level nằm trong sai lệch cho phép" },
        ])}
        <div id="offT" style="margin-top:12px"></div>`;
      const tol = el("#tol");
      tol.oninput = () => { S.tol = +tol.value; el("#oTol").textContent = tol.value; update(); };
      K.table(el("#offT"), [
        { key: "level", label: "Level", fmt: (v) => `<b>L${v}</b>` },
        { key: "target", label: "Mục tiêu", align: "r" },
        { key: "actual", label: "Thực tế", align: "r" },
        { key: "dev", label: "Lệch", align: "r", fmt: (v) => (v > 0 ? "+" : "") + Math.round(v) },
        { key: "role", label: "Vai trò", fmt: (v) => esc(v || "") },
        { key: "flag", label: "Gợi ý", fmt: (v) => v === "harder" ? `<span class="mini bad">Hạ độ khó</span>` : `<span class="mini warn">Tăng độ khó</span>` },
      ], off, { empty: "Không có level lệch.", height: 360, sortKey: "level" });
    }

    K.exportMenu(el("#csv"), () => {
      const sheets = [{ name: "Đường mục tiêu", headers: ["Level", "Mục tiêu", "Mức", "Vai trò", "Thực tế", "Lệch"],
        rows: (S.cmp ? S.cmp.rows : S.target).map((x) => [x.level, x.target, CV.TIERS.find((t) => t.key === x.tier).label, x.role, x.actual ?? "", x.dev != null ? Math.round(x.dev) : ""]) }];
      if (S.cmp) sheets.push({ name: "Level lệch", headers: ["Level", "Mục tiêu", "Thực tế", "Lệch", "Gợi ý"],
        rows: S.cmp.rows.filter((x) => x.flag).map((x) => [x.level, x.target, x.actual, Math.round(x.dev), x.flag === "harder" ? "Hạ độ khó" : "Tăng độ khó"]) });
      return { name: "duong_do_kho", sheets };
    });

    function sample() {
      applyPreset("saw10");
      imp.set(Object.assign(T.parseTable(sampleCsv(CV.generate(CV.PRESETS.saw10))), { name: "mau_diem_do_kho.csv" }));
      toast("Đã nạp mẫu “Răng cưa 10 + boss” + điểm thực tế của 150 level.", "ok");
    }
    function template() { K.download("mau_diem_do_kho.csv", T.toCSV(["level", "score"], [[1, 8], [2, 12], [3, 15]])); }

    sliders(); update();
    return { cleanup: () => S.charts.forEach((c) => c.destroy()), sample, template };
  }

  /** Điểm thực tế mẫu: bám mục tiêu ± nhiễu, nhưng L41–45 bị làm khó quá tay, L88 dễ bất ngờ. Thang 0–1 như tool chấm điểm. */
  function sampleCsv(target) {
    let seed = 3;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const lines = ["level,score"];
    for (const t of target) {
      let s = t.target + (rnd() - 0.5) * 12;
      if (t.level >= 41 && t.level <= 45) s = 70 + rnd() * 10;
      if (t.level === 88) s = t.target - 30;
      lines.push(t.level + "," + (Math.max(0, Math.min(100, s)) / 100).toFixed(3));
    }
    return lines.join("\n");
  }
})();

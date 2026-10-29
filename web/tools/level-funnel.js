/* Level Funnel — tìm level "tường" từ số liệu theo level. */
(() => {
  "use strict";
  const { $, $$, esc, icon, toast } = GDK;
  const K = GDK.kit, T = GDK.lib.table, F = GDK.lib.funnel;
  const SENS = [["low", "Ít (chỉ tường rõ)"], ["medium", "Vừa"], ["high", "Nhạy"]];

  GDK.tools["level-funnel"] = { mount };

  function mount(root) {
    const S = { table: null, map: {}, auto: {}, sens: "medium", minUsers: 100, hidden: new Set(), res: null, charts: [] };
    root.innerHTML = `
      <section class="panel">
        <div class="ph"><span class="step">1</span><h2>Dữ liệu theo level</h2><span class="sub">1 dòng / level · nhiều dòng sẽ tự cộng dồn</span></div>
        <div class="pb"><div id="imp"></div><div id="map" style="margin-top:12px"></div></div>
      </section>
      <section class="panel" id="res" hidden>
        <div class="ph"><span class="step">2</span><h2>Kết quả</h2>
          <div class="right"><button class="btn sm" id="csv"></button></div></div>
        <div class="pb">
          <div class="row" style="align-items:center;gap:18px;margin-bottom:14px">
            <div><label class="lb">Độ nhạy phát hiện tường</label><div class="seg" id="sens">${SENS.map(([k, l]) => `<button data-k="${k}">${l}</button>`).join("")}</div></div>
            <div style="width:170px"><label class="lb" title="Level có ít người hơn số này bị bỏ qua vì số liệu dao động mạnh">Bỏ qua level có &lt; N người</label><input type="text" id="minU" inputmode="numeric"></div>
            <div id="groupsBox"></div>
          </div>
          <div id="out"></div>
        </div>
      </section>
      <section class="panel" id="intro">
        <div class="pb">${K.empty({ illus: "level-funnel", title: "Chưa có dữ liệu",
          text: "Thả file số liệu theo level ở bước 1 — hoặc bấm <b>Thử với dữ liệu mẫu</b> để xem tool chỉ ra level tường thế nào.",
          actions: `<button class="btn primary" id="introSample">${icon("flask")} Thử với dữ liệu mẫu</button>` })}</div>
      </section>`;
    const el = (s) => $(s, root);

    const imp = K.importer(el("#imp"), {
      cacheKey: "level-funnel",
      title: "Kéo thả file số liệu level (CSV / Excel)",
      onTable: (t) => load(t),
      onSample: () => sample(),
    });
    el("#introSample").onclick = () => sample();
    el("#minU").value = S.minUsers;
    el("#minU").oninput = (e) => { S.minUsers = Math.max(0, T.toNumber(e.target.value) || 0); run(); };
    el("#sens").onclick = (e) => { const b = e.target.closest("button"); if (b) { S.sens = b.dataset.k; run(); } };
    K.exportMenu(el("#csv"), () => exportData());

    function load(t) {
      S.table = t;
      S.auto = T.autoMap(t.headers, F.FIELDS);
      S.map = Object.assign({}, S.auto);
      S.hidden.clear();
      K.mapper(el("#map"), { fields: F.FIELDS, headers: t.headers, map: S.map, auto: S.auto, onChange: () => run() });
      run();
    }

    function run() {
      $$("#sens button", root).forEach((b) => b.classList.toggle("on", b.dataset.k === S.sens));
      S.charts.forEach((c) => c.destroy()); S.charts = [];
      if (!S.table) return;
      el("#intro").hidden = true;
      el("#res").hidden = false;
      try {
        S.res = F.analyze(S.table.rows, S.map, { sensitivity: S.sens, minUsers: S.minUsers });
      } catch (e) {
        S.res = null;
        el("#groupsBox").innerHTML = "";
        el("#out").innerHTML = K.verdict("bad", e.message, "Mở “Xem / sửa cột” ở bước 1 để chọn cột phù hợp.");
        return;
      }
      draw();
    }

    function draw() {
      const all = S.res.groups;
      const groups = all.filter((g) => !S.hidden.has(g.name));
      el("#groupsBox").innerHTML = all.length > 1 ? `<label class="lb">Hiện nhánh</label><div class="pill-toggle">${all.map((g, i) =>
        `<button class="chip ${S.hidden.has(g.name) ? "" : "on"}" data-g="${esc(g.name)}" ${i >= 4 ? "disabled title='Tối đa 4 nhánh trên biểu đồ'" : ""}>${esc(g.name)}</button>`).join("")}</div>` : "";
      $$("#groupsBox [data-g]", root).forEach((b) => b.onclick = () => {
        const n = b.dataset.g;
        if (S.hidden.has(n)) S.hidden.delete(n); else if (all.length - S.hidden.size > 1) S.hidden.add(n);
        draw();
      });
      const vis = groups.slice(0, 4);
      const main = vis[0];
      const walls = vis.flatMap((g) => g.walls.map((w) => Object.assign({ group: g.name }, w)));
      const early = main.levels.filter((x) => x.early);
      const hasWin = main.levels.some((x) => x.winrate != null);
      const byLv = (ws) => ws.slice().sort((a, b) => a.level - b.level);

      const head = walls.length
        ? K.verdict("bad", `Tìm thấy ${walls.length} level tường` + (vis.length > 1 ? "" : `: ${byLv(main.walls).slice(0, 8).map((w) => "L" + w.level).join(", ")}`),
          vis.length > 1 ? vis.map((g) => `${g.name}: ${g.walls.length ? byLv(g.walls).map((w) => "L" + w.level).join(", ") : "không có tường"}`).join(" · ") : "Xếp theo mức độ ở bảng bên dưới — tường nặng nhất ở trên cùng.",
          "độ nhạy: " + SENS.find((s) => s[0] === S.sens)[1])
        : K.verdict("ok", "Không thấy level tường rõ rệt", "Tỉ lệ rời bỏ khá đều giữa các level. Thử độ nhạy “Nhạy” nếu muốn soi kỹ hơn.");

      const k = main.kpi;
      const tiles = K.tiles([
        { n: `${k.from}–${k.to}`, label: "level có dữ liệu", sub: k.levels + " level" },
        { n: K.fmt.int(k.users), label: main.basis === "users" ? "người chơi level đầu" : "người thắng level đầu (ước lượng)" },
        { n: K.fmt.pct(k.reach10), label: "còn lại ở L10", cls: "acc" },
        { n: K.fmt.pct(k.reach30), label: "còn lại ở L30", cls: "acc" },
        { n: K.fmt.pct(k.medianDrop), label: "rời bỏ trung vị / level" },
        hasWin ? { n: K.fmt.pct(k.medianWin), label: "tỉ lệ thắng trung vị" } : null,
        { n: walls.length, label: "level tường", cls: walls.length ? "bad" : "ok" },
      ].filter(Boolean));

      const notes = [];
      if (main.basis === "wins") notes.push({ level: "info", title: "Không có cột số người chơi (Users)", detail: "Đang ước lượng số người tới level N bằng số lượt thắng level N−1. Kết quả đúng hướng, nhưng có cột Users sẽ chính xác hơn." });
      if (k.gaps.length) notes.push({ level: "warn", title: "Dãy level bị đứt", detail: `Thiếu dữ liệu trước level ${k.gaps.slice(0, 8).join(", ")} — tỉ lệ rời bỏ ở ngay trước chỗ đứt không tính được.` });
      if (early.length) notes.push({ level: "info", title: `Level ${early.map((x) => x.level).join(", ")} rời bỏ cao (${early.map((x) => K.fmt.pct(x.drop)).join(", ")})`, detail: "Đầu game người chơi thử rồi bỏ là bình thường — không tính là tường. So với game khác / bản trước để đánh giá." });
      if (S.res.skipped) notes.push({ level: "warn", title: `${S.res.skipped} dòng không đọc được số level`, detail: "Các dòng này đã bị bỏ qua." });

      el("#out").innerHTML = `${head}${tiles}
        ${notes.length ? `<div style="margin-top:12px">${K.issueList(notes)}</div>` : ""}
        <div class="sectit">Tỉ lệ rời bỏ từng level</div>
        <div class="chart-title"><small>% người tới level đó nhưng không tới level kế tiếp · chấm đỏ = tường · rê chuột để xem chi tiết</small></div>
        <div id="cDrop"></div>
        <div class="sectit">Giữ chân so với level đầu</div><div id="cSurv"></div>
        ${hasWin ? `<div class="sectit">Tỉ lệ thắng mỗi lượt chơi</div><div id="cWin"></div>` : ""}
        <div class="sectit">Danh sách level tường</div><div id="tWalls"></div>
        <details class="adv" style="margin-top:16px"><summary>${icon("chevron-right")} Bảng đầy đủ từng level</summary><div id="tAll" style="margin-top:10px"></div></details>`;

      const pts = (g, f) => g.levels.map((x) => ({ x: x.level, y: x[f] }));
      const byLevel = new Map(walls.map((w) => [w.group + "|" + w.level, w]));
      const extra = (x) => vis.map((g) => {
        const w = byLevel.get(g.name + "|" + x);
        return w ? `<div class="tx bad">${icon("alert")} ${vis.length > 1 ? esc(g.name) + ": " : ""}${esc(w.reasons.join(" · "))}</div>` : "";
      }).join("");
      const lvFmt = (v, full) => (full ? "Level " : "L") + v;
      // nhiều nhánh cùng tường ở 1 level → chỉ ghi nhãn 1 lần (ở chấm cao nhất) để không chồng chữ
      const dedupe = (ms) => {
        const top = new Map();
        ms.forEach((m) => { if (!top.has(m.x) || m.y > top.get(m.x).y) top.set(m.x, m); });
        return ms.map((m) => top.get(m.x) === m ? m : Object.assign({}, m, { label: "" }));
      };
      S.charts.push(K.lineChart(el("#cDrop"), {
        series: vis.map((g) => ({ name: g.name, points: pts(g, "drop") })), height: 280, yMin: 0,
        yFormat: (v) => K.fmt.pct(v), xFormat: lvFmt,
        markers: dedupe(vis.flatMap((g) => g.walls.slice(0, 8).map((w) => ({ x: w.level, y: w.drop, label: "L" + w.level, kind: "bad" })))),
        tooltipExtra: extra,
      }));
      S.charts.push(K.lineChart(el("#cSurv"), {
        series: vis.map((g) => ({ name: g.name, points: pts(g, "survival") })), height: 220, yMin: 0, yMax: 1,
        yFormat: (v) => K.fmt.pct(v, 0), xFormat: lvFmt,
        markers: vis.flatMap((g) => g.walls.slice(0, 8).map((w) => ({ x: w.level, y: w.survival, kind: "bad" }))),
        tooltipExtra: extra,
      }));
      if (hasWin) S.charts.push(K.lineChart(el("#cWin"), {
        series: vis.map((g) => ({ name: g.name, points: pts(g, "winrate") })), height: 200, yMin: 0, yMax: 1,
        yFormat: (v) => K.fmt.pct(v, 0), xFormat: lvFmt, tooltipExtra: extra,
      }));

      K.table(el("#tWalls"), [
        { key: "level", label: "Level", fmt: (v) => `<b>L${v}</b>` },
        vis.length > 1 ? { key: "group", label: "Nhánh" } : null,
        { key: "drop", label: "Rời bỏ", align: "r", fmt: (v) => K.fmt.pct(v) },
        { key: "ratio", label: "Gấp × xung quanh", align: "r", fmt: (v) => v == null ? "—" : v.toFixed(1) + "×" },
        hasWin ? { key: "winrate", label: "Thắng / lượt", align: "r", fmt: (v) => K.fmt.pct(v) } : null,
        { key: "attempts", label: "Lượt / người", align: "r", fmt: (v) => v == null ? "—" : v.toFixed(1) },
        { key: "reach", label: "Người tới", align: "r", fmt: (v) => K.fmt.int(v) },
        { key: "advice", label: "Gợi ý", sort: false, fmt: (v, r) => `<span class="dim">${esc(F.advice(r))}</span>` },
      ].filter(Boolean), walls, { empty: "Không có level tường ở độ nhạy này.", rowClass: () => "row-bad" });

      K.table(el("#tAll"), [
        { key: "level", label: "Level" },
        vis.length > 1 ? { key: "group", label: "Nhánh" } : null,
        { key: "reach", label: "Người tới", align: "r", fmt: (v) => K.fmt.int(v) },
        { key: "survival", label: "Còn lại", align: "r", fmt: (v) => K.fmt.pct(v) },
        { key: "drop", label: "Rời bỏ", align: "r", fmt: (v) => K.fmt.pct(v) },
        { key: "ratio", label: "Gấp ×", align: "r", fmt: (v) => v == null ? "—" : v.toFixed(1) + "×" },
        { key: "winrate", label: "Thắng", align: "r", fmt: (v) => K.fmt.pct(v) },
        { key: "attempts", label: "Lượt/người", align: "r", fmt: (v) => v == null ? "—" : v.toFixed(2) },
        { key: "starts", label: "Start", align: "r", fmt: (v) => K.fmt.int(v) },
        { key: "wins", label: "Win", align: "r", fmt: (v) => K.fmt.int(v) },
      ].filter(Boolean), vis.flatMap((g) => g.levels.map((x) => Object.assign({ group: g.name }, x))),
      { height: 460, rowClass: (r) => r.wall ? "row-bad" : r.lowData ? "row-warn" : "" });
    }

    function exportData() {
      if (!S.res) return null;
      const rows = [];
      for (const g of S.res.groups) for (const x of g.levels) {
        rows.push([g.name, x.level, x.reach ?? "", x.survival != null ? x.survival.toFixed(4) : "", x.drop != null ? x.drop.toFixed(4) : "",
          x.ratio != null ? x.ratio.toFixed(2) : "", x.winrate != null ? x.winrate.toFixed(4) : "", x.attempts != null ? x.attempts.toFixed(3) : "",
          x.wall ? "TƯỜNG" : "", x.reasons.join(" | ")]);
      }
      const walls = S.res.groups.flatMap((g) => g.walls.map((w) => [g.name, w.level, +(w.drop * 100).toFixed(2), +w.ratio.toFixed(2),
        w.winrate != null ? +(w.winrate * 100).toFixed(1) : "", w.reasons.join(" | "), F.advice(w)]));
      return { name: "level_funnel", sheets: [
        { name: "Level tường", headers: ["Nhánh", "Level", "Rời bỏ (%)", "Gấp x xung quanh", "Thắng (%)", "Lý do", "Gợi ý"], rows: walls },
        { name: "Tất cả level", headers: ["Nhánh", "Level", "Người tới", "Còn lại", "Rời bỏ", "Gấp x xung quanh", "Tỉ lệ thắng", "Lượt / người", "Đánh dấu", "Lý do"],
          rows: rows.map((r) => r.map((v, i) => (i >= 2 && i <= 7 && v !== "" ? +v : v))) },
      ] };
    }

    function sample() {
      imp.set(Object.assign(T.parseTable(sampleCsv()), { name: "mau_level_insight.csv" }));
      toast("Đã nạp dữ liệu mẫu: 2 bản level v1 (live) và v3 (test), 80 level.", "ok");
    }
    function template() {
      K.download("mau_level_funnel.csv", T.toCSV(["level", "users", "level_start", "level_win", "level_lose", "version"],
        [[1, 10000, 13500, 9300, 4200, "v1"], [2, 9300, 12400, 8650, 3750, "v1"], [3, 8650, 11600, 8040, 3560, "v1"]]));
    }
    return { cleanup: () => S.charts.forEach((c) => c.destroy()), sample, template };
  }

  /** Dữ liệu mẫu: 2 bản level, v1 có tường ở 24/29/32, v3 đã gỡ 24 & 29 nhưng còn 32. */
  function sampleCsv() {
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const lines = ["level,users,level_start,level_win,level_lose,version"];
    for (const [ver, walls] of [["v1 (live)", { 24: 0.085, 29: 0.07, 32: 0.11 }], ["v3 (test)", { 32: 0.095 }]]) {
      let users = 12000;
      for (let lv = 1; lv <= 80; lv++) {
        const drop = (walls[lv] || (lv <= 3 ? 0.07 - lv * 0.01 : 0.017 + rnd() * 0.008));
        const att = walls[lv] ? 2.6 + rnd() * 0.4 : 1.25 + rnd() * 0.3;
        const u = Math.round(users), st = Math.round(u * att), win = Math.round(u * (1 - drop));
        lines.push([lv, u, st, win, st - win, ver].join(","));
        users *= 1 - drop;
      }
    }
    return lines.join("\n");
  }
})();

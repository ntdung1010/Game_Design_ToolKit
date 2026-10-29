/* Config Diff — so 2 bản JSON / Remote Config và soát lỗi trước khi publish. */
(() => {
  "use strict";
  const { $, $$, esc, icon, toast, store } = GDK;
  const K = GDK.kit, CD = GDK.lib.configdiff;
  const KIND = { added: ["Thêm", "ok"], removed: ["Xoá", "bad"], changed: ["Đổi", "warn"], type: ["Đổi kiểu", "bad"] };

  GDK.tools["config-diff"] = { mount };

  function mount(root) {
    // nội dung config chỉ giữ trong phiên làm việc (đóng tab là xoá) — không ghi lâu dài xuống ổ đĩa
    const ss = { get: () => { try { return JSON.parse(sessionStorage.getItem("gdk.configDiff")) || { a: "", b: "" }; } catch (e) { return { a: "", b: "" }; } },
      set: (v) => { try { sessionStorage.setItem("gdk.configDiff", JSON.stringify(v)); } catch (e) { /* bỏ qua */ } } };
    try { localStorage.removeItem("gdk.configDiff"); } catch (e) { /* xoá bản lưu lâu dài của phiên bản cũ */ }
    const saved = ss.get();
    const S = { filter: "all", q: "", res: null, t: null };
    root.innerHTML = `
      <section class="panel">
        <div class="ph"><span class="step">1</span><h2>Dán 2 bản config</h2><span class="sub">JSON bất kỳ hoặc template Firebase Remote Config · thả file .json vào ô cũng được</span>
          <div class="right"><button class="btn sm ghost" id="swap" title="Đổi chỗ 2 bản">${icon("refresh")} Đổi chỗ</button><button class="btn sm ghost" id="clear">${icon("trash")} Xoá</button></div></div>
        <div class="pb">
          <div class="split2">
            ${["a", "b"].map((k) => `<div>
              <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:6px">
                <label class="lb" style="margin:0"><b style="color:var(--fg)">${k === "a" ? "Bản đang live (cũ)" : "Bản mới"}</b> <span id="${k}Info" class="mono"></span></label>
                <button class="btn sm ghost" data-pretty="${k}" title="Định dạng lại cho dễ đọc">{ } Định dạng</button></div>
              <textarea class="code" id="${k}" rows="16" spellcheck="false" placeholder='${k === "a" ? '{\n  "inter_cooldown": 30,\n  "CDS_Remove_IceTube": [[158, 9]]\n}' : "Dán bản mới vào đây — hoặc chỉ dán 1 bên để soát lỗi"}'></textarea>
            </div>`).join("")}
          </div>
        </div>
      </section>
      <section class="panel"><div class="ph"><span class="step">2</span><h2>Kết quả</h2></div><div class="pb" id="out"></div></section>`;
    const el = (s) => $(s, root);
    el("#a").value = saved.a; el("#b").value = saved.b;
    for (const k of ["a", "b"]) {
      K.textDrop(el("#" + k), (name) => { el("#" + k + "Info").textContent = "· " + name; schedule(0); });
      el("#" + k).oninput = () => schedule();
    }
    $$("[data-pretty]", root).forEach((b) => b.onclick = () => {
      const ta = el("#" + b.dataset.pretty), p = CD.parse(ta.value);
      if (!p.ok) return toast(p.error ? `Chưa định dạng được — lỗi dòng ${p.error.line}: ${p.error.message}` : "Ô đang trống", "bad");
      ta.value = JSON.stringify(p.value, null, 2); schedule(0);
    });
    el("#swap").onclick = () => { const t = el("#a").value; el("#a").value = el("#b").value; el("#b").value = t; schedule(0); };
    el("#clear").onclick = () => { el("#a").value = ""; el("#b").value = ""; schedule(0); };

    function schedule(ms = 300) { clearTimeout(S.t); S.t = setTimeout(run, ms); }

    function run() {
      const a = el("#a").value, b = el("#b").value;
      ss.set({ a: a.length < 400000 ? a : "", b: b.length < 400000 ? b : "" });
      for (const k of ["a", "b"]) {
        const v = el("#" + k).value;
        if (!el("#" + k + "Info").textContent.startsWith("· ") || !v) el("#" + k + "Info").textContent = v ? `· ${v.split("\n").length} dòng` : "";
      }
      if (!a.trim() && !b.trim()) {
        el("#out").innerHTML = K.empty({ illus: "config-diff", title: "Dán config để bắt đầu",
          text: "Dán bản đang live bên trái, bản mới bên phải. Chỉ dán 1 bên = chỉ soát lỗi cú pháp, khoá trùng, chuỗi JSON lồng hỏng.",
          actions: `<button class="btn primary" id="introSample">${icon("flask")} Thử với dữ liệu mẫu</button>` });
        el("#introSample").onclick = () => sample();
        return;
      }
      S.res = CD.compare(a, b);
      draw();
    }

    function draw() {
      const r = S.res, st = r.stats;
      const both = r.sides.A.ok && r.sides.B.ok;
      const one = !both && (r.sides.A.ok || r.sides.B.ok) && (r.sides.A.empty || r.sides.B.empty);
      const head = st.bad ? K.verdict("bad", `${st.bad} lỗi đỏ${st.warn ? ", " + st.warn + " cảnh báo" : ""} — chưa nên publish`, "Xử lý hết các mục đỏ bên dưới trước khi đẩy lên.")
        : st.warn ? K.verdict("mid", `Không có lỗi đỏ · ${st.warn} điểm cần xem lại`, both ? `${st.added + st.removed + st.changed + st.type} thay đổi` : "")
          : K.verdict("ok", both ? `Không có lỗi — ${st.added + st.removed + st.changed + st.type} thay đổi` : "JSON hợp lệ, không thấy lỗi", one ? "Đang chỉ soát lỗi 1 bản. Dán thêm bản còn lại để xem thay đổi." : "");
      const fbNote = (r.sides.A.firebase || r.sides.B.firebase) ? `<p class="hint">${icon("info")} Nhận diện template <b>Firebase Remote Config</b> — so theo tên tham số, giá trị theo điều kiện hiện dạng <span class="mono">tên ⟨điều kiện⟩</span>, chuỗi JSON bên trong được mở ra so từng trường.</p>` : "";
      const issues = r.issues.map((x) => ({ level: x.level, title: x.title + (x.side ? (x.side === "A" ? " · bản cũ" : " · bản mới") : ""), where: x.path, detail: x.detail }));
      el("#out").innerHTML = `${head}${fbNote}
        ${both ? K.tiles([
          { n: st.added, label: "trường thêm", cls: st.added ? "ok" : "" }, { n: st.removed, label: "trường xoá", cls: st.removed ? "bad" : "" },
          { n: st.changed, label: "giá trị đổi", cls: st.changed ? "warn" : "" }, { n: st.type, label: "đổi kiểu dữ liệu", cls: st.type ? "bad" : "" }]) : ""}
        <div class="sectit">Lỗi &amp; cảnh báo</div>${K.issueList(issues)}
        ${both ? `<div class="sectit">Thay đổi</div>
          <div class="toolbar"><div class="chips" id="flt" style="margin:0;justify-content:flex-start">
            ${[["all", "Tất cả", r.changes.length], ["added", "Thêm", st.added], ["removed", "Xoá", st.removed], ["changed", "Đổi", st.changed + st.type]].map(([k, l, n]) => `<button class="chip ${S.filter === k ? "on" : ""}" data-f="${k}">${l}<span class="n">${n}</span></button>`).join("")}
          </div><span class="grow"></span><input type="search" id="q" placeholder="Lọc theo tên trường…" value="${esc(S.q)}"><button class="btn sm" id="exp"></button></div>
          <div id="chg"></div>` : ""}`;
      if (!both) return;
      $$("#flt [data-f]", root).forEach((b) => b.onclick = () => { S.filter = b.dataset.f; draw(); });
      const q = el("#q");
      q.oninput = () => { S.q = q.value; drawChanges(); };
      K.exportMenu(el("#exp"), () => ({ name: "config_diff", sheets: [
        { name: "Thay đổi", headers: ["Loại", "Trường", "Bản cũ", "Bản mới"], rows: S.res.changes.map((c) => [KIND[c.kind][0], c.path, c.old ? CD.show(c.old) : "", c.new ? CD.show(c.new) : ""]) },
        { name: "Lỗi & cảnh báo", headers: ["Mức", "Vấn đề", "Bản", "Vị trí", "Chi tiết"], rows: S.res.issues.map((x) => [x.level === "bad" ? "LỖI" : "Cảnh báo", x.title, x.side === "A" ? "cũ" : "mới", x.path, x.detail]) },
      ] }));
      drawChanges();
    }

    function drawChanges() {
      const r = S.res, q = S.q.trim().toLowerCase();
      const list = r.changes.filter((c) => (S.filter === "all" || c.kind === S.filter || (S.filter === "changed" && c.kind === "type")) && (!q || c.path.toLowerCase().includes(q)));
      K.table(el("#chg"), [
        { key: "kind", label: "Loại", fmt: (v) => `<span class="mini ${KIND[v][1]}">${KIND[v][0]}</span>` },
        { key: "path", label: "Trường", fmt: (v) => `<span class="mono">${esc(v)}</span>` },
        { key: "old", label: "Bản cũ", sort: false, fmt: (v, c) => c.old ? `<span class="mono old" ${c.kind === "removed" ? 'style="text-decoration:line-through"' : ""}>${esc(trim(CD.show(c.old)))}</span>` : "—" },
        { key: "new", label: "Bản mới", sort: false, fmt: (v, c) => c.new ? `<span class="mono ren">${esc(trim(CD.show(c.new)))}</span>` : "—" },
      ], list, { empty: "Không có thay đổi nào khớp bộ lọc.", height: 480, rowClass: (c) => c.kind === "removed" || c.kind === "type" ? "row-bad" : c.kind === "added" ? "row-ok" : "" });
    }
    const trim = (s) => s.length > 140 ? s.slice(0, 137) + "…" : s;

    function sample() {
      el("#a").value = JSON.stringify({
        version: 42, inter_cooldown: 30, revive_price: 900, show_rate_popup: true,
        CDS_Remove_IceTube: [[158, 9], [160, 4]],
        booster: { hint: { price: 100, free_per_day: 1 }, add_tube: { price: 200, unlock_level: 12 } },
        level_config: '{"loop_from": 401, "hard_levels": [24, 29, 32], "time_limit": 120}',
        ab_groups: ["A", "B"],
      }, null, 2);
      el("#b").value = `{
  "version": 43,
  "inter_cooldown": 300,
  "revive_price": "900",
  "show_rate_popup": true,
  "CDS_Remove_IceTubes": [[158, 9], [160, 4]],
  "booster": {
    "hint": { "price": 120, "free_per_day": 1, "free_per_day": 2 },
    "add_tube": { "price": 200, "unlock_level": 12 }
  },
  "level_config": "{\\"loop_from\\": 401, \\"hard_levels\\": [], \\"time_limit\\": 90}",
  "ab_groups": ["A", "B", "C"],
  "piggy_bank": { "enabled": true, "unlock_level": 15 }
}`;
      el("#aInfo").textContent = "· mẫu: live"; el("#bInfo").textContent = "· mẫu: bản mới";
      run();
      toast("Đã nạp 2 bản config mẫu — có cài sẵn 5 lỗi hay gặp.", "ok");
    }
    function template() {
      K.download("mau_remote_config.json", JSON.stringify({ parameters: { inter_cooldown: { defaultValue: { value: "30" }, conditionalValues: { ios: { value: "45" } } } }, conditions: [{ name: "ios", expression: "device.os == 'ios'" }] }, null, 2), "application/json");
    }
    run();
    return { cleanup: () => clearTimeout(S.t), sample, template };
  }
})();

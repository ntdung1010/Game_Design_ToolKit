/* Trang quản trị (chỉ quản trị viên): tài khoản người dùng, bật / tắt + thứ tự tool, nhật ký sử dụng, thống kê, mạng nội bộ.
   Dữ liệu ở máy chủ: data/gdk.db (SQLite) + file nhật ký data/logs/usage-YYYY-MM.csv. */
(() => {
  "use strict";
  const { $, $$, esc, icon, toast, api } = GDK;
  const K = GDK.kit;
  const TABS = [["users", "Người dùng", "lock"], ["tools", "Tools", "grid"], ["usage", "Nhật ký sử dụng", "history"], ["stats", "Thống kê", "bars"], ["network", "Mạng nội bộ", "home"]];
  const ACTIONS = { login: "Đăng nhập", logout: "Đăng xuất", open: "Mở tool", import: "Nạp dữ liệu", export: "Xuất file",
    sample: "Thử dữ liệu mẫu", run: "Chạy", save: "Lưu", google: "Kết nối Google" };
  const toolName = (id) => ((GDK.allMeta || []).find((t) => t.id === id) || {}).name || id || "";
  const when = (s) => (s ? String(s).replace("T", " ").slice(0, 16) : "—");

  GDK.renderAdmin = (view, fx) => {
    const tab = (location.hash.split("/")[2] || "users");
    view.innerHTML = `<div class="wrap">
      <div class="crumbs"><a href="#/">Home</a>${icon("chevron-right")}<b>Quản lý</b></div>
      <div class="tool-head"><span class="ibox">${icon("shield")}</span>
        <div><h1>Quản lý</h1><p>Tạo tài khoản cho từng người trong team, bật / tắt và sắp xếp tool, xem ai dùng tool gì lúc nào, bật / tắt truy cập qua mạng nội bộ. Chỉ quản trị viên thấy trang này.</p></div></div>
      <div class="tabs adm-tabs">${TABS.map(([k, l, ic]) => `<a href="#/admin/${k}" class="${k === tab ? "on" : ""}">${icon(ic)} ${l}</a>`).join("")}</div>
      <div id="admBody"></div></div>`;
    fx.enter(view.querySelector(".wrap"));
    const body = $("#admBody");
    const charts = [];
    ({ users, tools: toolsTab, usage, stats, network }[tab] || users)(body, charts);
    return { cleanup: () => charts.forEach((c) => c.destroy()) };
  };

  // ================================================================ người dùng
  async function users(body) {
    body.innerHTML = `
      <section class="panel"><div class="ph"><span class="ibox sm">${icon("plus")}</span><h2>Thêm người dùng</h2><span class="sub">tool tạo mật khẩu tạm — người đó phải đổi ở lần đăng nhập đầu</span></div>
        <div class="pb"><div class="adm-add">
          <div><label class="lb">Tên đăng nhập</label><input type="text" id="nuUser" placeholder="vd: lan.anh" spellcheck="false" autocapitalize="off"></div>
          <div><label class="lb">Tên hiển thị</label><input type="text" id="nuName" placeholder="vd: Lan Anh"></div>
          <div><label class="lb">Vai trò</label><select id="nuRole"><option value="user">Người dùng</option><option value="admin">Quản trị viên</option></select></div>
          <button class="btn primary" id="nuAdd">${icon("plus")} Tạo tài khoản</button>
        </div><div id="nuOut"></div></div></section>
      <section class="panel"><div class="ph"><span class="ibox sm">${icon("lock")}</span><h2>Tài khoản</h2><span class="sub" id="uCount"></span>
        <div class="right"><button class="btn sm ghost" id="uRefresh">${icon("refresh")}</button></div></div><div class="pb" id="uList"><div class="load-msg"><span class="spin"></span>Đang tải…</div></div></section>
      <section class="panel"><div class="ph"><span class="ibox sm">${icon("key")}</span><h2>Phiên đang đăng nhập</h2><span class="sub">máy nào đang mở Tool Kit</span></div><div class="pb" id="sList"></div></section>`;
    const me = GDK.user || {};
    async function draw() {
      let d, ss, net;
      try { [d, ss, net] = await Promise.all([api("admin/users"), api("admin/sessions"), api("admin/network")]); }
      catch (e) { $("#uList").innerHTML = `<div class="note bad">${icon("alert")}<div>${esc(e.message)}</div></div>`; return; }
      GDK.admNet = net;
      $("#uCount").textContent = `${d.users.length} tài khoản · ${d.users.filter((u) => u.active).length} đang hoạt động`;
      $("#uList").innerHTML = `<div class="tbl-wrap"><table class="tbl adm-users"><thead><tr><th>Người dùng</th><th>Vai trò</th><th>Trạng thái</th><th>Đăng nhập gần nhất</th><th class="r">Phiên</th><th></th></tr></thead><tbody>
        ${d.users.map((u) => `<tr data-id="${u.id}" class="${u.active ? "" : "off"}">
          <td><b>${esc(u.name)}</b><small class="mono">${esc(u.username)}${u.id === me.id ? " · bạn" : ""}</small></td>
          <td><span class="mini ${u.role === "admin" ? "l" : "m"}">${u.role === "admin" ? "Quản trị viên" : "Người dùng"}</span></td>
          <td>${u.active ? (u.must_change ? `<span class="mini warn">Chờ đổi mật khẩu tạm</span>` : `<span class="mini ok">Hoạt động</span>`) : `<span class="mini bad">Đã khoá</span>`}</td>
          <td>${when(u.last_login)}<small class="mono">${esc(u.last_ip || "")}</small></td>
          <td class="r num">${u.sessions}</td>
          <td class="r"><div class="adm-acts">
            <button class="btn sm ghost" data-act="reset" title="Tạo mật khẩu tạm mới">${icon("key")} Đặt lại mật khẩu</button>
            ${u.id === me.id ? "" : `<button class="btn sm ghost" data-act="role" title="Đổi vai trò">${icon("shield")}</button>
            <button class="btn sm ghost" data-act="${u.active ? "lock" : "unlock"}" title="${u.active ? "Khoá tài khoản" : "Mở khoá"}">${icon(u.active ? "lock" : "unlock")}</button>
            <button class="btn sm ghost" data-act="logout" title="Đăng xuất mọi phiên của người này" ${u.sessions ? "" : "disabled"}>${icon("logout")}</button>
            <button class="btn sm ghost danger" data-act="delete" title="Xoá tài khoản">${icon("trash")}</button>`}
          </div></td></tr>`).join("")}</tbody></table></div>`;
      $("#sList").innerHTML = ss.sessions.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Người dùng</th><th>Máy (IP)</th><th>Trình duyệt</th><th>Bắt đầu</th><th>Hoạt động gần nhất</th><th></th></tr></thead><tbody>
        ${ss.sessions.map((x) => `<tr><td><b>${esc(x.name)}</b><small class="mono">${esc(x.username)}${x.remember ? " · ghi nhớ" : ""}</small></td><td class="mono">${esc(x.ip || "")}</td>
          <td>${esc(browser(x.ua))}</td><td>${when(x.created)}</td><td>${when(x.last_seen)}</td>
          <td class="r"><button class="btn sm ghost" data-kill="${esc(x.id)}">${icon("logout")} Đăng xuất</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">Không có phiên nào.</div>`;
      $$("#uList [data-act]").forEach((b) => b.onclick = () => act(b.dataset.act, d.users.find((u) => u.id === +b.closest("tr").dataset.id)));
      $$("#sList [data-kill]").forEach((b) => b.onclick = async () => {
        try { await api("admin/sessions/kill", { id: b.dataset.kill }); toast("Đã đăng xuất phiên.", "ok"); draw(); } catch (e) { toast(e.message, "bad"); }
      });
    }
    async function act(a, u) {
      try {
        if (a === "reset") {
          if (!confirm(`Đặt lại mật khẩu cho ${u.name} (${u.username})?\n\nTool tạo mật khẩu tạm mới, mọi phiên của người này bị đăng xuất.`)) return;
          showPassword(await api("admin/users/reset", { id: u.id }), "Mật khẩu tạm mới");
        } else if (a === "lock" || a === "unlock") {
          if (a === "lock" && !confirm(`Khoá tài khoản ${u.name}? Người này bị đăng xuất ngay và không đăng nhập được nữa (dữ liệu, nhật ký vẫn giữ).`)) return;
          await api("admin/users/update", { id: u.id, active: a === "unlock" });
          toast(a === "lock" ? "Đã khoá tài khoản." : "Đã mở khoá.", "ok");
        } else if (a === "role") {
          const to = u.role === "admin" ? "user" : "admin";
          if (!confirm(`Đổi ${u.name} thành ${to === "admin" ? "QUẢN TRỊ VIÊN (quản lý tài khoản, xem nhật ký, đổi cài đặt mạng)" : "người dùng thường"}?`)) return;
          await api("admin/users/update", { id: u.id, role: to });
          toast("Đã đổi vai trò.", "ok");
        } else if (a === "logout") {
          await api("admin/users/logout", { id: u.id }); toast("Đã đăng xuất mọi phiên của " + u.name + ".", "ok");
        } else if (a === "delete") {
          if (!confirm(`XOÁ tài khoản ${u.name} (${u.username})?\n\nToken Google của người này cũng bị xoá. Nhật ký sử dụng cũ vẫn giữ. Không hoàn tác được.`)) return;
          await api("admin/users/delete", { id: u.id }); toast("Đã xoá tài khoản.", "ok");
        }
        draw();
      } catch (e) { toast(e.message, "bad"); }
    }
    function showPassword(r, title) {
      const net = GDK.admNet || {};
      const addr = (net.lan && net.urls && net.urls[0]) || location.origin + "/";
      const msg = `Tool Kit GD: ${addr}\nTên đăng nhập: ${r.user.username}\nMật khẩu tạm: ${r.password}\n(Lần đầu đăng nhập sẽ được yêu cầu đặt mật khẩu riêng.)`;
      $("#nuOut").innerHTML = `<div class="pw-reveal">
        <div class="pr-h">${icon("key")} <b>${esc(title)} cho ${esc(r.user.name)}</b> — chỉ hiện 1 lần, copy gửi riêng cho người đó</div>
        <div class="pr-grid"><span>Địa chỉ</span><code>${esc(addr)}</code><span>Tên đăng nhập</span><code>${esc(r.user.username)}</code>
          <span>Mật khẩu tạm</span><code class="pr-pw">${esc(r.password)}</code></div>
        <div class="row" style="gap:8px;margin-top:10px"><button class="btn sm primary" id="prCopy">${icon("copy")} Copy tin nhắn gửi cho người dùng</button>
          <button class="btn sm ghost" id="prHide">${icon("x")} Đã gửi, ẩn đi</button></div></div>`;
      $("#prCopy").onclick = () => K.copy(msg, "Đã copy — dán gửi riêng cho người dùng (Slack / Zalo).");
      $("#prHide").onclick = () => { $("#nuOut").innerHTML = ""; };
      $("#nuOut").scrollIntoView({ behavior: "smooth", block: "center" });
    }
    $("#nuAdd").onclick = async () => {
      const b = $("#nuAdd");
      b.disabled = true;
      try {
        const r = await api("admin/users/create", { username: $("#nuUser").value, name: $("#nuName").value, role: $("#nuRole").value });
        $("#nuUser").value = ""; $("#nuName").value = "";
        showPassword(r, "Tài khoản mới");
        draw();
      } catch (e) { toast(e.message, "bad"); }
      finally { b.disabled = false; }
    };
    $("#nuName").onkeydown = $("#nuUser").onkeydown = (e) => { if (e.key === "Enter") $("#nuAdd").click(); };
    $("#uRefresh").onclick = draw;
    draw();
  }
  function browser(ua) {
    ua = ua || "";
    const b = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Trình duyệt";
    const os = /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
    return b + (os ? " · " + os : "");
  }

  // ================================================================ nhật ký sử dụng
  async function usage(body) {
    const today = new Date(), iso = (d) => d.toISOString().slice(0, 10);
    const from = new Date(today.getTime() - 6 * 864e5);
    let list = [];
    try { list = (await api("admin/users")).users; } catch (e) { /* bỏ qua */ }
    body.innerHTML = `<section class="panel"><div class="ph"><span class="ibox sm">${icon("history")}</span><h2>Nhật ký sử dụng</h2>
        <span class="sub">ai mở tool nào, nạp / xuất gì, lúc nào, từ máy nào</span><div class="right"><button class="btn sm" id="ugExport"></button></div></div>
      <div class="pb">
        <div class="adm-filters">
          <div><label class="lb">Người dùng</label><select id="fUser"><option value="">Tất cả</option>${list.map((u) => `<option value="${u.id}">${esc(u.name)} (${esc(u.username)})</option>`).join("")}</select></div>
          <div><label class="lb">Tool</label><select id="fTool"><option value="">Tất cả</option>${(GDK.allMeta || []).map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("")}</select></div>
          <div><label class="lb">Hành động</label><select id="fAct"><option value="">Tất cả</option>${Object.entries(ACTIONS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
          <div><label class="lb">Từ ngày</label><input type="date" id="fFrom" value="${iso(from)}"></div>
          <div><label class="lb">Đến ngày</label><input type="date" id="fTo" value="${iso(today)}"></div>
          <div><label class="lb">Tìm</label><input type="search" id="fQ" placeholder="tên file, IP…"></div>
        </div>
        <div id="ugSum" class="hint" style="margin:10px 0"></div>
        <div id="ugTable"></div><div id="ugMore"></div>
        <p class="hint">${icon("info")} Mỗi tháng có thêm 1 file <code>data/logs/usage-YYYY-MM.csv</code> trên máy chủ (mở bằng Excel). Không ghi mật khẩu hay nội dung file.</p>
      </div></section>`;
    const f = () => ({ uid: $("#fUser").value, tool: $("#fTool").value, action: $("#fAct").value, since: $("#fFrom").value, until: $("#fTo").value, q: $("#fQ").value.trim() });
    const qs = (o) => Object.entries(o).filter(([, v]) => v !== "" && v != null).map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&");
    let rows = [], total = 0;
    async function load(more) {
      try {
        const d = await api("admin/usage?" + qs(Object.assign(f(), { limit: 200, offset: more ? rows.length : 0 })));
        rows = more ? rows.concat(d.rows) : d.rows; total = d.total;
      } catch (e) { toast(e.message, "bad"); return; }
      $("#ugSum").innerHTML = `${K.fmt.int(total)} dòng khớp bộ lọc${total > rows.length ? ` · đang hiện ${K.fmt.int(rows.length)} dòng mới nhất` : ""}`;
      K.table($("#ugTable"), [
        { key: "ts", label: "Thời gian", fmt: (v) => `<span class="mono">${esc(when(v).slice(5))}</span>` },
        { key: "username", label: "Người dùng", fmt: (v) => `<b>${esc(v || "—")}</b>` },
        { key: "ip", label: "Máy (IP)", fmt: (v) => `<span class="mono dim">${esc(v || "")}</span>` },
        { key: "action", label: "Hành động", fmt: (v) => `<span class="mini ${v === "login" || v === "logout" ? "m" : v === "export" ? "warn" : "l"}">${esc(ACTIONS[v] || v)}</span>` },
        { key: "tool", label: "Tool", fmt: (v) => esc(toolName(v)) },
        { key: "detail", label: "Chi tiết", fmt: (v) => `<span class="ug-detail">${esc(v || "")}</span>` },
      ], rows, { empty: "Không có hoạt động nào trong khoảng này.", height: 560 });
      $("#ugMore").innerHTML = total > rows.length ? `<div class="row" style="justify-content:center;margin-top:10px"><button class="btn" id="ugMoreBtn">Tải thêm 200 dòng</button></div>` : "";
      const mb = $("#ugMoreBtn"); if (mb) mb.onclick = () => load(true);
    }
    $$("#fUser, #fTool, #fAct, #fFrom, #fTo").forEach((x) => x.onchange = () => load());
    let t; $("#fQ").oninput = () => { clearTimeout(t); t = setTimeout(() => load(), 300); };
    // xuất: tải đủ mọi dòng khớp bộ lọc (tối đa 20.000) rồi mới tạo file
    $("#ugExport").innerHTML = `${icon("download")} Xuất nhật ký ${icon("chevron-down")}`;
    $("#ugExport").onclick = (e) => { e.stopPropagation(); exportAll(e.currentTarget); };
    async function exportAll(btn) {
      document.querySelectorAll(".menu-pop").forEach((m) => m.remove());
      const pop = document.createElement("div");
      pop.className = "menu-pop";
      pop.innerHTML = [["csv", "sheet", "CSV", "mở bằng Excel / Sheets"], ["xlsx", "sheet", "Excel (.xlsx)", "có định dạng"], ["xlsx-pw", "key", "Excel có mật khẩu", "Excel hỏi mật khẩu khi mở"]]
        .map(([k, ic, tt, dd]) => `<button data-k="${k}">${icon(ic)}<span><b>${tt}</b><small>${dd}</small></span></button>`).join("");
      document.body.appendChild(pop);
      const r = btn.getBoundingClientRect();
      pop.style.top = (r.bottom + 6) + "px"; pop.style.left = Math.max(8, r.right - pop.offsetWidth) + "px";
      const off = () => { pop.remove(); document.removeEventListener("click", off); };
      setTimeout(() => document.addEventListener("click", off), 0);
      pop.onclick = async (ev) => {
        const b = ev.target.closest("button[data-k]"); if (!b) return;
        off();
        try {
          const d = await api("admin/usage?" + qs(Object.assign(f(), { limit: 20000, offset: 0 })));
          await K.exportData({ name: "nhat_ky_su_dung_" + (f().since || "") + "_" + (f().until || ""), sheets: [{ name: "Nhật ký",
            headers: ["Thời gian", "Người dùng", "Máy (IP)", "Hành động", "Tool", "Chi tiết"],
            rows: d.rows.map((x) => [x.ts.replace("T", " "), x.username, x.ip, ACTIONS[x.action] || x.action, toolName(x.tool), x.detail]) }] }, b.dataset.k);
        } catch (err) { toast(err.message, "bad"); }
      };
    }
    load();
  }

  // ================================================================ thống kê
  async function stats(body, charts) {
    let days = 30;
    body.innerHTML = `<section class="panel"><div class="ph"><span class="ibox sm">${icon("bars")}</span><h2>Thống kê sử dụng</h2>
        <div class="right"><div class="seg" id="stDays">${[7, 30, 90].map((d) => `<button data-d="${d}" class="${d === days ? "on" : ""}">${d} ngày</button>`).join("")}</div></div></div>
      <div class="pb" id="stBody"><div class="load-msg"><span class="spin"></span>Đang tính…</div></div></section>`;
    async function draw() {
      let d;
      try { d = await api("admin/stats?days=" + days); } catch (e) { $("#stBody").innerHTML = `<div class="note bad">${icon("alert")}<div>${esc(e.message)}</div></div>`; return; }
      charts.forEach((c) => c.destroy()); charts.length = 0;
      const top = d.by_tool[0];
      $("#stBody").innerHTML = `${K.tiles([
        { n: K.fmt.int(d.events), label: `lượt thao tác (${d.days} ngày)` },
        { n: d.active_users, label: "người dùng hoạt động", cls: "acc" },
        { n: top ? esc(toolName(top.tool)) : "—", label: "tool dùng nhiều nhất", sub: top ? `${K.fmt.int(top.n)} lượt · ${top.users} người` : "" },
      ])}
        <div class="sectit">Theo ngày</div><div id="stChart"></div>
        <div class="grid2" style="margin-top:6px"><div><div class="sectit">Theo tool</div>${d.by_tool.length ? K.bars(d.by_tool.map((x) => ({ label: toolName(x.tool), value: x.n }))) : `<div class="empty">Chưa có.</div>`}</div>
          <div><div class="sectit">Theo người dùng</div><div id="stUsers"></div></div></div>`;
      const full = [];
      for (let i = d.days - 1; i >= 0; i--) {
        const day = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
        const r = d.by_day.find((x) => x.day === day) || { n: 0, users: 0 };
        full.push({ day, n: r.n, users: r.users, x: d.days - i });
      }
      charts.push(K.lineChart($("#stChart"), { height: 220, yMin: 0,
        series: [{ name: "Lượt thao tác", points: full.map((p) => ({ x: p.x, y: p.n })) }, { name: "Người dùng", points: full.map((p) => ({ x: p.x, y: p.users })) }],
        xFormat: (v) => { const p = full[Math.round(v) - 1]; return p ? p.day.slice(5).split("-").reverse().join("/") : ""; },
        yFormat: (v) => String(Math.round(v)) }));
      K.table($("#stUsers"), [
        { key: "username", label: "Người dùng", fmt: (v) => `<b>${esc(v)}</b>` },
        { key: "n", label: "Lượt", align: "r" },
        { key: "last", label: "Gần nhất", fmt: (v) => esc(when(v)) },
      ], d.by_user, { empty: "Chưa có.", height: 320 });
    }
    $$("#stDays button", body).forEach((b) => b.onclick = () => { days = +b.dataset.d; $$("#stDays button", body).forEach((x) => x.classList.toggle("on", x === b)); draw(); });
    draw();
  }

  // ================================================================ tools: bật / tắt + thứ tự hiển thị
  async function toolsTab(body) {
    body.innerHTML = `<section class="panel"><div class="ph"><span class="ibox sm">${icon("grid")}</span><h2>Tool cho cả team</h2><span class="sub" id="tlCount"></span>
        <div class="right"><span class="ab-saved" id="tlSaved"></span></div></div>
      <div class="pb">
        <div class="tl-bar">
          <label class="sw-row"><input type="checkbox" id="tlAuto"><span class="sw"></span>Tự sắp theo thứ tự mặc định</label>
          <button class="btn sm" id="tlReset">${icon("refresh")} Về thứ tự mặc định</button>
          <a class="btn sm ghost" href="#/" id="tlHome">${icon("home")} Sắp xếp ngay trên trang chủ</a>
        </div>
        <div class="tl-list" id="tlList"><div class="load-msg"><span class="spin"></span>Đang tải…</div></div>
        <ul class="adm-notes">
          <li><b>Tắt</b> một tool: người dùng thường không thấy tool đó ở trang chủ / tìm kiếm (Ctrl K) và máy chủ từ chối chức năng của nó. Quản trị viên vẫn mở được để thử.</li>
          <li><b>Kéo</b> tay nắm ${icon("grip")} để đổi vị trí — hoặc bấm vào tay nắm rồi dùng phím ↑ ↓. Thứ tự áp dụng cho trang chủ và tìm kiếm của mọi người.</li>
          <li><b>Tự sắp theo thứ tự mặc định</b>: dùng thứ tự khai báo trong code, tool mới thêm tự vào đúng chỗ. Tắt đi là quay lại thứ tự bạn đã kéo (vẫn được giữ). Kéo thả cũng tự tắt chế độ này.</li>
          <li>Người khác đang mở Tool Kit thấy thay đổi khi quay về trang chủ hoặc tải lại trang.</li>
        </ul>
      </div></section>`;
    let st = null, sortOff = null, focusId = null;
    const row = (t, i) => `<div class="tl-row ${t.enabled ? "" : "off"}" data-id="${esc(t.id)}">
        <button class="tl-grip" type="button" aria-label="Đổi vị trí ${esc(t.name)}: kéo, hoặc bấm rồi dùng phím ↑ ↓">${icon("grip")}</button>
        <span class="tl-no">${String(i + 1).padStart(2, "0")}</span>
        <span class="ibox sm">${icon(t.icon)}</span>
        <div class="tl-main"><b>${esc(t.name)}</b><span>${esc(t.category)}${t.tagline ? " · " + esc(t.tagline) : ""}</span></div>
        <div class="tl-tags">${t.default_enabled ? "" : `<span class="mini warn" title="Khai báo trong code là tạm ẩn (đang sửa)">mặc định tắt</span>`}
          ${!st.auto && t.default_pos !== i ? `<span class="mini" title="Vị trí theo thứ tự mặc định">mặc định #${t.default_pos + 1}</span>` : ""}</div>
        <a class="btn sm ghost tl-open" href="#/tool/${esc(t.id)}" title="Mở tool">${icon("external")}</a>
        ${GDK.togBtn(t.id, t.enabled)}
      </div>`;
    const draw = () => {
      const on = st.tools.filter((t) => t.enabled).length;
      $("#tlCount").textContent = `${on}/${st.tools.length} đang bật · ${st.auto ? "thứ tự mặc định" : "thứ tự tuỳ chỉnh"}`;
      $("#tlAuto").checked = st.auto;
      $("#tlList").innerHTML = st.tools.map(row).join("");
      if (focusId) { const g = $(".tl-row[data-id='" + focusId + "'] .tl-grip"); if (g) g.focus(); focusId = null; }
    };
    const save = async (b) => {
      $("#tlSaved").textContent = "Đang lưu…";
      try {
        st = await api("admin/tools/save", b);
        $("#tlSaved").textContent = "Đã lưu " + new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        GDK.reloadTools().catch(() => {});
      } catch (e) { toast(e.message, "bad"); $("#tlSaved").textContent = ""; st = await api("admin/tools"); }
      draw();
    };
    try { st = await api("admin/tools"); }
    catch (e) { $("#tlList").innerHTML = `<div class="note bad">${icon("alert")}<div>${esc(e.message)}</div></div>`; return; }
    draw();
    $("#tlAuto").onchange = (e) => save({ auto: e.target.checked });
    $("#tlReset").onclick = () => { if (confirm("Đưa thứ tự tool về mặc định (theo khai báo trong code)?\nBật / tắt của từng tool giữ nguyên.")) save({ reset: true }); };
    $("#tlList").addEventListener("click", (e) => {
      const b = e.target.closest(".arr-tog"); if (!b) return;
      const t = st.tools.find((x) => x.id === b.dataset.tog); if (!t) return;
      if (t.enabled && st.tools.filter((x) => x.enabled).length === 1) { toast("Cần để lại ít nhất 1 tool đang bật.", "bad"); return; }
      save({ enabled: { [t.id]: !t.enabled } });
    });
    sortOff = GDK.sortable($("#tlList"), { item: ".tl-row", handle: ".tl-grip", keys: ".tl-grip",
      onEnd: (ids) => {
        const a = document.activeElement, r = a && a.closest ? a.closest(".tl-row") : null;
        focusId = r ? r.dataset.id : null;            // đổi chỗ bằng phím: vẽ lại xong vẫn giữ con trỏ ở tay nắm đó
        if (st.auto) toast("Đã chuyển sang thứ tự tuỳ chỉnh (tắt “Tự sắp theo mặc định”).", "ok");
        $$(".tl-row .tl-no", body).forEach((n, i) => { n.textContent = String(i + 1).padStart(2, "0"); });
        save({ order: ids, auto: false });
      } });
    const off = () => { if (sortOff) sortOff(); window.removeEventListener("hashchange", off); };
    window.addEventListener("hashchange", off);
  }

  // ================================================================ mạng nội bộ
  async function network(body) {
    async function draw(change) {
      let d;
      try { d = await api("admin/network", change === undefined ? undefined : { lan: change }); }
      catch (e) { body.innerHTML = `<div class="note bad">${icon("alert")}<div>${esc(e.message)}</div></div>`; return; }
      body.innerHTML = `<section class="panel"><div class="ph"><span class="ibox sm">${icon("home")}</span><h2>Truy cập qua mạng nội bộ</h2>
          <span class="badge ${d.lan ? "ok" : ""}">${d.lan ? icon("check") + "Đang bật" : "Đang tắt — chỉ máy này"}</span></div>
        <div class="pb">
          <div class="choice">
            <button class="${d.saved ? "on" : ""}" data-lan="1">${icon("home")}<span><b>Mạng nội bộ</b><small>Máy khác trong mạng công ty (cùng Wi-Fi / LAN) mở được bằng địa chỉ bên dưới. Chỉ nhận địa chỉ nội bộ — máy ngoài Internet bị chặn.</small></span></button>
            <button class="${d.saved ? "" : "on"}" data-lan="0">${icon("lock")}<span><b>Chỉ máy này</b><small>Chỉ mở được trên chính máy chủ (127.0.0.1).</small></span></button>
          </div>
          ${d.restart_needed ? `<div class="note" style="margin-top:12px">${icon("refresh")}<div>Đã lưu. <b>Mở lại start.bat</b> trên máy chủ để áp dụng (bản mới tự thay bản đang chạy). Lần đầu bật mạng nội bộ, Windows hỏi tường lửa → chọn <b>Allow / Cho phép</b> trên <b>Private networks</b>.</div></div>` : ""}
          <div class="sectit">Địa chỉ cho máy khác</div>
          ${d.ips.length ? `<div class="addr-list">${(d.urls.length ? d.urls : d.ips.map((ip) => "http://" + ip + ":" + location.port + "/")).map((u) => `<div class="addr"><code>${esc(u)}</code><button class="btn sm ghost" data-copy="${esc(u)}">${icon("copy")} Copy</button></div>`).join("")}</div>`
            : `<p class="hint">Không tìm thấy địa chỉ nội bộ — máy chủ có đang nối mạng không?</p>`}
          ${(d.ifaces || []).length ? `<div class="sectit">Card mạng của máy chủ</div><div class="addr-list">${d.ifaces.map((x) => `<div class="addr"><code>${esc(x.ip)}</code>
            <span class="dim">${esc(x.iface || "")}</span>${x.virtual ? `<span class="mini warn">VPN / máy ảo — không gửi địa chỉ này cho team</span>` : `<span class="mini ok">mạng thật</span>`}</div>`).join("")}</div>` : ""}
          <ul class="adm-notes">
            <li>Gửi địa chỉ này + tên đăng nhập + mật khẩu tạm (tab <a href="#/admin/users">Người dùng</a>) cho từng người.</li>
            <li>Máy chủ phải bật và chạy start.bat thì mọi người mới vào được. Địa chỉ IP có thể đổi khi máy chủ khởi động lại mạng — xem lại ở đây.</li>
            <li>Kết nối trong mạng nội bộ là HTTP (chưa mã hoá đường truyền) — chỉ dùng trong mạng công ty tin cậy, không mở cổng ${esc(location.port || "7700")} ra Internet.</li>
            <li>Google Drive: không cần cấp quyền ở đây — Drive Clone chạy bằng Google Apps Script, mỗi người đăng nhập Google của chính họ trên trang Drive Clone (quản trị viên cài web app 1 lần ở trang <a href="#/tool/drive-clone">Drive Clone</a>).</li>
          </ul>
        </div></section>`;
      $$("[data-lan]", body).forEach((b) => b.onclick = () => {
        const on = b.dataset.lan === "1";
        if (on === d.saved) return;
        if (on && !confirm("Bật truy cập qua mạng nội bộ?\n\nMọi máy trong mạng công ty có tài khoản sẽ vào được Tool Kit. Cần mở lại start.bat để áp dụng.")) return;
        draw(on);
      });
      $$("[data-copy]", body).forEach((b) => b.onclick = () => K.copy(b.dataset.copy, "Đã copy địa chỉ."));
    }
    draw();
  }
})();

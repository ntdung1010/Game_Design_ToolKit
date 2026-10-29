/* Trang đăng nhập / tạo mật khẩu của GD Toolkit (file riêng vì CSP không cho script inline). */
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const EYE = '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const box = $("#box");
  const card = document.querySelector(".lg-card");
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const mascot = window.GDK && GDK.mascot && $("#lgMascot") ? GDK.mascot($("#lgMascot"), { size: 128 }) : { mood() {} };
  const wait = (ms) => new Promise((r) => setTimeout(r, REDUCED ? 0 : ms));
  let timer = null;
  box.innerHTML = `<div class="lg-wait"><span class="spin"></span>Đang kết nối Tool Kit<span class="load-dots"><i></i><i></i><i></i></span></div>`;

  /** Nút đang chờ: hiện vòng quay + chữ, viền thẻ sáng lên. */
  function busy(btn, label) {
    mascot.mood("think");
    btn.dataset.label = btn.dataset.label || btn.textContent;
    btn.disabled = true;
    btn.innerHTML = `<span class="spin"></span>${esc(label)}`;
    card.classList.add("busy");
  }
  function idle(btn) {
    mascot.mood("");
    btn.disabled = false;
    btn.textContent = btn.dataset.label || btn.textContent;
    card.classList.remove("busy");
  }
  /** Sai: thẻ rung nhẹ. */
  function shake() {
    card.classList.remove("shake"); card.offsetWidth; card.classList.add("shake");
    mascot.mood("sad", 1400);
  }
  /** Đúng: nút xanh + dấu tick vẽ dần, thẻ trượt lên mờ đi rồi mới vào Tool Kit. */
  async function success(btn, label) {
    card.classList.remove("busy");
    mascot.mood("happy");
    btn.classList.add("ok");
    btn.innerHTML = `<svg class="check-draw" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>${esc(label)}`;
    card.classList.add("done");
    await wait(800);
    enter();
  }

  async function api(path, body) {
    const opt = body === undefined ? {} : {
      method: "POST", headers: { "Content-Type": "application/json", "X-GDK-Login": "1" }, body: JSON.stringify(body),
    };
    let r;
    try { r = await fetch("/api/auth/" + path, opt); }
    catch (e) { throw new Error("Không kết nối được server — cửa sổ GD Toolkit có đang chạy không?"); }
    let j = {};
    try { j = await r.json(); } catch (e) { /* bỏ qua */ }
    if (!r.ok) { const e = new Error(j.error || "Lỗi " + r.status); e.locked = j.locked; throw e; }
    return j;
  }

  function strength(pw) {
    let pool = 0;
    if (/[a-z]/.test(pw)) pool += 26;
    if (/[A-Z]/.test(pw)) pool += 26;
    if (/\d/.test(pw)) pool += 10;
    if (/[^A-Za-z0-9]/.test(pw)) pool += 32;
    const bits = Math.log2(Math.max(pool, 1)) * Math.min(pw.length, new Set(pw).size * 2);
    const score = pw.length < 8 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
    return { score, label: ["Quá ngắn (cần ≥ 8 ký tự)", "Yếu", "Tạm được", "Mạnh", "Rất mạnh"][score], cls: ["bad", "bad", "warn", "ok", "ok"][score] };
  }

  // đăng nhập xong: tải lại đúng địa chỉ đang mở (giữ #/tool/… nếu có)
  function enter() {
    if (/^\/login(\.html)?$/.test(location.pathname)) location.replace("/" + location.hash);
    else location.reload();
  }

  const pwField = (id, label, auto) => `<div class="lg-field"><label class="lb" for="${id}">${label}</label>
    <div class="lg-pw"><input type="password" id="${id}" autocomplete="${auto}" spellcheck="false">
    <button type="button" class="lg-eye" data-eye="${id}" title="Hiện / ẩn">${EYE}</button></div></div>`;
  const forgot = `<details class="lg-help"><summary>Quên mật khẩu?</summary>
    Quản trị viên: mở terminal trong thư mục Tool Kit trên máy chủ, chạy lệnh dưới rồi đặt mật khẩu mới:
    <code>python server.py set-password</code>
    Người dùng khác: nhờ quản trị viên vào <b>Quản lý người dùng → Đặt lại mật khẩu</b>.</details>`;

  function bindEyes() {
    box.querySelectorAll("[data-eye]").forEach((b) => b.onclick = () => {
      const i = $("#" + b.dataset.eye);
      i.type = i.type === "password" ? "text" : "password";
      i.focus();
    });
  }
  function showErr(msg) { const e = $("#err"); e.textContent = msg; e.classList.toggle("show", !!msg); }
  const textField = (id, label, auto, hint, value) => `<div class="lg-field"><label class="lb" for="${id}">${label}</label>
    <input type="text" id="${id}" autocomplete="${auto}" spellcheck="false" autocapitalize="off" value="${esc(value || "")}" class="lg-text">
    ${hint ? `<div class="lg-hint">${hint}</div>` : ""}</div>`;
  // nhớ tên đăng nhập lần trước trên máy này (chỉ tên, không bao giờ nhớ mật khẩu)
  const lastUser = { get() { try { return localStorage.getItem("gdk.lastUser") || ""; } catch (e) { return ""; } },
    set(v) { try { localStorage.setItem("gdk.lastUser", v); } catch (e) { /* bỏ qua */ } } };
  function meterFor(input) {
    input.oninput = () => {
      const s = strength(input.value);
      $("#meter").style.width = (input.value ? 12 + s.score * 22 : 0) + "%";
      $("#meter").className = s.cls;
      $("#hint").textContent = input.value ? "Độ mạnh: " + s.label : "Ít nhất 8 ký tự — nên dài, có chữ hoa, số, ký hiệu.";
    };
  }

  function drawSetup() {
    box.innerHTML = `<h1>Tạo tài khoản quản trị</h1>
      <p class="lead">Lần đầu dùng: tạo tài khoản quản trị viên. Sau đó bạn tạo tài khoản cho từng người trong team ở trang <b>Quản lý người dùng</b>.</p>
      ${textField("un", "Tên đăng nhập", "username", "chữ thường không dấu, vd: <code>admin</code>, <code>dung.nt</code>", "admin")}
      ${textField("nm", "Tên hiển thị", "name", "", "")}
      ${pwField("p1", "Mật khẩu", "new-password")}
      <div class="lg-meter"><i id="meter"></i></div><div class="lg-hint" id="hint">Ít nhất 8 ký tự — nên dài, có chữ hoa, số, ký hiệu.</div>
      <div style="height:10px"></div>
      ${pwField("p2", "Nhập lại mật khẩu", "new-password")}
      <div class="lg-err" id="err"></div>
      <button class="btn primary lg-btn" id="go">Tạo mật khẩu &amp; vào Tool Kit</button>
      ${forgot}`;
    bindEyes();
    const p1 = $("#p1"), p2 = $("#p2");
    meterFor(p1);
    const submit = async () => {
      if (!$("#un").value.trim()) { shake(); return showErr("Nhập tên đăng nhập."); }
      if (p1.value.length < 8) { shake(); return showErr("Mật khẩu cần ít nhất 8 ký tự."); }
      if (p1.value !== p2.value) { shake(); return showErr("Hai lần nhập mật khẩu không khớp."); }
      const go = $("#go");
      busy(go, "Đang tạo tài khoản…"); showErr("");
      try {
        await Promise.all([api("setup", { username: $("#un").value.trim(), name: $("#nm").value.trim(), password: p1.value }), wait(450)]);
        lastUser.set($("#un").value.trim().toLowerCase());
        await success(go, "Đã tạo — đang mở Tool Kit…");
      } catch (e) { idle(go); shake(); showErr(e.message); }
    };
    $("#go").onclick = submit;
    [$("#un"), $("#nm"), p1, p2].forEach((i) => i.onkeydown = (e) => { if (e.key === "Enter") submit(); });
    $("#nm").focus();
  }

  /** Lần đầu đăng nhập bằng mật khẩu tạm (quản trị viên vừa tạo / đặt lại) → bắt đặt mật khẩu riêng. */
  function drawChange(oldPw, who) {
    box.innerHTML = `<h1>Đặt mật khẩu của bạn</h1>
      <p class="lead">Chào ${esc(who || "bạn")}! Đây là mật khẩu tạm do quản trị viên cấp — hãy đặt mật khẩu riêng (chỉ bạn biết) trước khi vào Tool Kit.</p>
      ${oldPw ? "" : pwField("p0", "Mật khẩu tạm", "current-password")}
      ${pwField("p1", "Mật khẩu mới", "new-password")}
      <div class="lg-meter"><i id="meter"></i></div><div class="lg-hint" id="hint">Ít nhất 8 ký tự — nên dài, có chữ hoa, số, ký hiệu.</div>
      <div style="height:10px"></div>
      ${pwField("p2", "Nhập lại mật khẩu mới", "new-password")}
      <div class="lg-err" id="err"></div>
      <button class="btn primary lg-btn" id="go">Lưu mật khẩu &amp; vào Tool Kit</button>`;
    bindEyes();
    const p1 = $("#p1"), p2 = $("#p2");
    meterFor(p1);
    const submit = async () => {
      const old = oldPw || ($("#p0") || {}).value || "";
      if (p1.value.length < 8) { shake(); return showErr("Mật khẩu cần ít nhất 8 ký tự."); }
      if (p1.value !== p2.value) { shake(); return showErr("Hai lần nhập mật khẩu không khớp."); }
      const go = $("#go");
      busy(go, "Đang lưu…"); showErr("");
      try {
        await Promise.all([api("change", { old, new: p1.value }), wait(450)]);
        await success(go, "Đã lưu — đang mở Tool Kit…");
      } catch (e) { idle(go); shake(); showErr(e.message); }
    };
    $("#go").onclick = submit;
    [p1, p2].forEach((i) => i.onkeydown = (e) => { if (e.key === "Enter") submit(); });
    (oldPw ? p1 : $("#p0")).focus();
  }

  function drawLogin(locked) {
    box.innerHTML = `<h1>Đăng nhập</h1>
      <p class="lead">Dùng tài khoản quản trị viên cấp cho bạn.</p>
      ${textField("un", "Tên đăng nhập", "username", "", lastUser.get())}
      ${pwField("pw", "Mật khẩu", "current-password")}
      <label class="check" style="margin:2px 0 8px"><input type="checkbox" id="remember"><span>Ghi nhớ trên máy này 7 ngày</span></label>
      <div class="lg-err" id="err"></div>
      <button class="btn primary lg-btn" id="go">Đăng nhập</button>
      ${forgot}`;
    bindEyes();
    const pw = $("#pw"), un = $("#un");
    const submit = async () => {
      if (!un.value.trim()) { shake(); return un.focus(); }
      if (!pw.value) { shake(); return pw.focus(); }
      const go = $("#go");
      busy(go, "Đang kiểm tra…"); showErr("");
      try {
        // chờ tối thiểu 450 ms để thấy trạng thái đang kiểm tra (mật khẩu băm scrypt cũng mất ~0,1 giây)
        const [r] = await Promise.allSettled([api("login", { username: un.value.trim(), password: pw.value, remember: $("#remember").checked }), wait(450)]);
        if (r.status === "rejected") throw r.reason;
        lastUser.set(un.value.trim().toLowerCase());
        if (r.value.must_change) { const old = pw.value; idle(go); return drawChange(old, r.value.name || un.value.trim()); }
        await success(go, "Đúng mật khẩu — đang mở Tool Kit…");
      } catch (e) {
        idle(go); shake();
        pw.value = ""; pw.focus();
        if (e.locked) return countdown(e.locked);
        showErr(e.message);
      }
    };
    $("#go").onclick = submit;
    [un, pw].forEach((i) => i.onkeydown = (e) => { if (e.key === "Enter") submit(); });
    (un.value ? pw : un).focus();
    if (locked) countdown(locked);
  }

  /** Bị khoá tạm: vòng tròn đếm ngược vơi dần theo từng giây. */
  function countdown(sec) {
    clearInterval(timer);
    showErr("");
    const C = 2 * Math.PI * 22;
    const lock = document.createElement("div");
    lock.className = "lg-lock";
    lock.innerHTML = `<div class="lg-ring"><svg viewBox="0 0 52 52"><circle class="track" cx="26" cy="26" r="22"/><circle class="bar" cx="26" cy="26" r="22" stroke-dasharray="${C}" stroke-dashoffset="0"/></svg><b></b></div>
      <div>Sai mật khẩu quá nhiều lần — Tool Kit tạm khoá để chống dò mật khẩu.<br><small>Hết giờ là đăng nhập lại được.</small></div>`;
    $("#err").after(lock);
    const ring = lock.querySelector(".bar"), num = lock.querySelector("b"), go = $("#go");
    let left = sec;
    const tick = () => {
      if (left <= 0) { clearInterval(timer); lock.remove(); go.disabled = false; go.textContent = "Đăng nhập"; $("#pw").focus(); return; }
      num.textContent = left;
      ring.style.strokeDashoffset = String(C * (1 - (left - 1) / sec));
      go.disabled = true; go.textContent = `Thử lại sau ${left} giây`;
      left--;
    };
    tick();
    timer = setInterval(tick, 1000);
  }

  (async () => {
    try {
      const st = await api("status");
      if (st.authed && st.must_change) return drawChange("", st.user && (st.user.name || st.user.username));
      if (st.authed) return enter();
      st.setup ? drawLogin(st.locked) : drawSetup();
    } catch (e) {
      box.innerHTML = `<div class="lg-err show">${esc(e.message)}</div>`;
    }
  })();
})();

/* GD Toolkit — khung giao diện: router, trang chủ, cài đặt, tìm nhanh (Ctrl K), tiện ích dùng chung.
   Mỗi tool tự đăng ký trong web/tools/<id>.js:  GDK.tools["<id>"] = { mount(el, meta) { … return cleanupFn } } */
(() => {
  "use strict";
  const GDK = (window.GDK = { tools: {}, meta: [], version: "" });

  // ---------------------------------------------------------------- tiện ích
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ICONS = {
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    "folder-copy": '<path d="M2 7.5V18a2 2 0 0 0 2 2h11"/><path d="M20 16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-5.9a2 2 0 0 1-1.69-.9l-.82-1.2A2 2 0 0 0 9.9 3H8a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2Z"/>',
    folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
    sheet: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M8 13h2M14 13h2M8 17h2M14 17h2"/>',
    doc: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M16 13H8M16 17H8M10 9H8"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    "arrow-right": '<path d="M5 12h14M12 5l7 7-7 7"/>',
    "chevron-right": '<path d="m9 18 6-6-6-6"/>',
    "chevron-down": '<path d="m6 9 6 6 6-6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    "eye-off": '<path d="M9.9 5.2A9.5 9.5 0 0 1 12 5c7 0 10 7 10 7a17 17 0 0 1-2.3 3.3M6.6 6.6A17 17 0 0 0 2 12s3 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M2 2l20 20"/>',
    grip: '<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
    sort: '<path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.7 1.6-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5C21 6.6 17 3 12 3Z"/><circle cx="7.5" cy="11.5" r="1.1"/><circle cx="10" cy="7.5" r="1.1"/><circle cx="14.5" cy="7.5" r="1.1"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
    external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    "plus-square": '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8M8 12h8"/>',
    trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
    package: '<path d="M16.5 9.4 7.55 4.24M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
    copy: '<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    type: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    terminal: '<path d="m4 17 6-6-6-6M12 19h8"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
    shortcut: '<path d="m15 14 5-5-5-5"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    flask: '<path d="M9 3h6M10 3v6.5L4.5 19a1.5 1.5 0 0 0 1.3 2.25h12.4A1.5 1.5 0 0 0 19.5 19L14 9.5V3"/><path d="M7 15h10"/>',
    funnel: '<path d="M3 4h18l-7 8.5V19l-4 2v-8.5z"/>',
    split: '<path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.17-2.87L3 3"/><path d="m15 9 6-6"/>',
    braces: '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5a2 2 0 0 1 2-2 2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>',
    "table-check": '<path d="M13 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7"/><path d="M3 9h18M9 3v18"/><path d="m15 18 2 2 4-4"/>',
    trending: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
    "clipboard-check": '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
    bars: '<path d="M3 3v18h18"/><path d="M7 16v-4M12 16V8M17 16v-6"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    unlock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
    tubes: '<path d="M5 3v14a2.5 2.5 0 0 0 5 0V3M14 3v14a2.5 2.5 0 0 0 5 0V3M4 3h7M13 3h7"/><path d="M5 12h5M14 9h5"/>',
    maze: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 3v6h4M3 13h5v4M12 21v-6h4M16 3v8h5M12 9v3"/>',
    sparkles: '<path d="m12 3 1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z"/><path d="M19 17v4M17 19h4"/>',
  };
  const icon = (name, cls = "") => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.package}</svg>`;
  const hydrate = (root = document) => $$("[data-icon]", root).forEach((el) => { el.outerHTML = icon(el.dataset.icon); });

  // khoá phiên do server cấp mỗi lần khởi động (chèn vào <meta>) — API thiếu khoá sẽ bị từ chối
  const TOKEN = (document.querySelector('meta[name="gdk-token"]') || {}).content || "";
  let reloading = false;
  function sessionExpired(code) {
    if (reloading) return;
    reloading = true;
    toast(code === "login" ? "Phiên đăng nhập đã hết — đang chuyển tới trang đăng nhập…" : "Server vừa khởi động lại — đang tải lại trang…");
    setTimeout(() => location.reload(), 1200);      // server sẽ trả trang đăng nhập nếu cần, giữ nguyên #/tool/…
  }

  /** Gọi API. body: undefined = GET; object = POST JSON; Blob/File/ArrayBuffer = POST nhị phân. opts.raw → trả Response. */
  async function api(path, body, opts = {}) {
    const headers = { "X-GDK-Token": TOKEN };
    const init = { headers };
    if (body !== undefined) {
      init.method = "POST";
      const binary = body instanceof Blob || body instanceof ArrayBuffer;
      headers["Content-Type"] = binary ? "application/octet-stream" : "application/json";
      init.body = binary ? body : JSON.stringify(body);
    }
    let r;
    try { r = await fetch("/api/" + path, init); }
    catch (e) { throw new Error("Không gọi được server — cửa sổ chạy GD Toolkit có đang mở không?"); }
    if (r.status === 401) {
      let code = "";
      try { code = (await r.clone().json()).code; } catch (e) { /* bỏ qua */ }
      sessionExpired(code);
      throw new Error(code === "login" ? "Cần đăng nhập lại." : "Phiên làm việc đã hết hạn — đang tải lại trang.");
    }
    if (opts.raw && r.ok) return r;
    let j = {};
    try { j = await r.json(); } catch (e) { /* phản hồi không phải JSON */ }
    if (!r.ok || j.error) throw new Error(j.error || "HTTP " + r.status);
    return j;
  }
  /** Link tải file từ server (thẻ <a> không gửi được header → kèm khoá trong ?t=). */
  const fileUrl = (path) => "/api/" + path + (path.includes("?") ? "&" : "?") + "t=" + encodeURIComponent(TOKEN);

  function toast(msg, kind = "") {
    const el = document.createElement("div");
    el.className = "toast " + kind;
    el.innerHTML = icon(kind === "bad" ? "alert" : kind === "ok" ? "check" : "info") + `<div>${esc(msg)}</div>`;
    $("#toasts").appendChild(el);
    setTimeout(() => el.remove(), kind === "bad" ? 7000 : 3800);
  }

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* bỏ qua */ } },
  };

  const fmtBytes = (n) => {
    n = Number(n) || 0;
    if (n < 1024) return n + " B";
    const u = ["KB", "MB", "GB", "TB"]; let i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return n.toFixed(n < 10 ? 1 : 0) + " " + u[i];
  };

  /** Kéo thả để sắp xếp (chuột + cảm ứng) cho danh sách dọc lẫn lưới thẻ. Mỗi phần tử cần data-id.
      o: {item: selector phần tử, handle: chỗ bấm để kéo (mặc định cả phần tử), ignore: không bắt đầu kéo khi bấm vào đây,
          keys: phần tử nhận phím mũi tên để dời từng bước, onStart(), onEnd(ids)}. Trả về hàm gỡ. */
  function sortable(box, o) {
    const items = () => $$(o.item, box);
    const ids = () => items().map((x) => x.dataset.id);
    // vị trí theo bố cục (không tính transform đang chạy) — tránh đổi chỗ qua lại khi phần tử còn đang trượt
    const pos = (x) => ({ x: x.offsetLeft, y: x.offsetTop, w: x.offsetWidth, h: x.offsetHeight });
    const flip = (fn, skip) => {
      const els = items().filter((x) => x !== skip);
      const before = new Map(els.map((x) => [x, pos(x)]));
      fn();
      if (REDUCED) return;
      els.forEach((x) => {
        const a = before.get(x), b = pos(x), dx = a.x - b.x, dy = a.y - b.y;
        if (dx || dy) x.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 220, easing: "cubic-bezier(.2,.7,.2,1)" });
      });
    };
    let drag = null, scrollRaf = 0;
    const autoScroll = (y) => {
      cancelAnimationFrame(scrollRaf);
      const edge = 70, vh = window.innerHeight, v = y < edge ? -(edge - y) / 4 : y > vh - edge ? (y - (vh - edge)) / 4 : 0;
      if (v && drag) scrollRaf = requestAnimationFrame(() => { window.scrollBy(0, v); autoScroll(y); });
    };
    const move = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!drag.started) {
        if (Math.hypot(dx, dy) < 6) return;
        drag.started = true;
        if (getComputedStyle(box).position === "static") { box.style.position = "relative"; drag.posFix = true; }
        const r = drag.el.getBoundingClientRect(), g = drag.el.cloneNode(true);
        g.classList.add("sort-ghost"); g.removeAttribute("id");
        Object.assign(g.style, { width: r.width + "px", height: r.height + "px", left: r.left + "px", top: r.top + "px" });
        document.body.appendChild(g);
        drag.ghost = g; drag.r = r;
        drag.el.classList.add("sort-hole"); box.classList.add("sorting");
        if (o.onStart) o.onStart();
      }
      drag.ghost.style.transform = `translate(${dx}px, ${dy}px) rotate(${Math.max(-2.5, Math.min(2.5, dx / 80))}deg)`;
      const br = box.getBoundingClientRect(), px = e.clientX - br.left, py = e.clientY - br.top;
      const over = items().find((x) => { if (x === drag.el) return false; const p = pos(x); return px >= p.x && px <= p.x + p.w && py >= p.y && py <= p.y + p.h; });
      if (over) {
        const list = items(), after = list.indexOf(over) > list.indexOf(drag.el);
        flip(() => over.parentNode.insertBefore(drag.el, after ? over.nextSibling : over), drag.el);
      }
      autoScroll(e.clientY);
    };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      cancelAnimationFrame(scrollRaf);
      const d = drag; drag = null;
      if (!d || !d.started) return;
      const r = d.el.getBoundingClientRect(), g = d.ghost;
      const fin = () => { g.remove(); d.el.classList.remove("sort-hole"); box.classList.remove("sorting"); if (d.posFix) box.style.position = ""; };
      if (REDUCED) fin();
      else { g.style.transition = "transform .2s cubic-bezier(.2,.7,.2,1)"; g.style.transform = `translate(${r.left - d.r.left}px, ${r.top - d.r.top}px)`; setTimeout(fin, 200); }
      // thẻ là link: chặn cú click sinh ra ngay sau khi thả
      const stop = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
      window.addEventListener("click", stop, true);
      setTimeout(() => window.removeEventListener("click", stop, true), 0);
      const now = ids();
      if (now.join() !== d.start && o.onEnd) o.onEnd(now);
    };
    const down = (e) => {
      if (e.button !== 0 || drag) return;
      if (o.ignore && e.target.closest(o.ignore)) return;
      const h = e.target.closest(o.handle || o.item);
      if (!h || !box.contains(h)) return;
      if (e.target.closest("input, select, textarea")) return;
      e.preventDefault();
      drag = { el: h.closest(o.item), sx: e.clientX, sy: e.clientY, started: false, start: ids().join() };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
    };
    const key = (e) => {
      const k = o.keys && e.target.closest(o.keys);
      if (!k) return;
      const step = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[e.key];
      if (!step) return;
      e.preventDefault();
      const el = k.closest(o.item), list = items(), i = list.indexOf(el), j = i + step;
      if (j < 0 || j >= list.length) return;
      flip(() => list[j].parentNode.insertBefore(el, step > 0 ? list[j].nextSibling : list[j]));
      k.focus();
      if (o.onEnd) o.onEnd(ids());
    };
    box.addEventListener("pointerdown", down);
    box.addEventListener("keydown", key);
    return () => { box.removeEventListener("pointerdown", down); box.removeEventListener("keydown", key); up(); };
  }

  Object.assign(GDK, { $, $$, esc, icon, hydrate, api, fileUrl, toast, store, fmtBytes, sortable });

  // ---------------------------------------------------------------- theme
  function applyThemeIcon() {
    const light = document.documentElement.dataset.theme === "light";
    $("#themeBtn").innerHTML = icon(light ? "moon" : "sun");
  }
  $("#logoutBtn").onclick = async () => {
    if (!confirm("Đăng xuất khỏi GD Toolkit?")) return;
    try { await api("auth/logout", {}); } catch (e) { /* vẫn tải lại */ }
    location.reload();
  };
  $("#themeBtn").onclick = () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("gdk.theme", next); } catch (e) { /* bỏ qua */ }
    applyThemeIcon();
  };

  /** Ghi nhật ký sử dụng (mở tool, nạp / xuất file…) — không chặn giao diện, lỗi thì bỏ qua. */
  GDK.track = (tool, action, detail) => {
    if (!GDK.user) return;
    api("usage", { tool: tool || GDK.currentTool || "", action, detail: detail ? String(detail).slice(0, 300) : "" }).catch(() => {});
  };
  function drawUser() {
    const u = GDK.user || {};
    const chip = $("#uChip");
    if (!chip) return;
    const nm = u.name || u.username || "";
    $(".av", chip).textContent = (nm.trim() || "?").slice(0, 1).toUpperCase();
    $(".nm", chip).textContent = nm;
    chip.title = (u.username || "") + (u.role === "admin" ? " · quản trị viên" : "") + " — tài khoản & mật khẩu";
    chip.classList.toggle("admin", u.role === "admin");
    $("#navAdmin").hidden = u.role !== "admin";
  }
  /** Lấy lại danh sách tool (thứ tự + bật / tắt do quản trị viên chỉnh). Trả về true nếu có thay đổi. */
  let toolsAt = 0;
  async function reloadTools() {
    const r = await api("tools");
    toolsAt = Date.now();
    const sig = (l) => l.map((t) => t.id + (t.hidden ? "-" : "+")).join();
    const changed = sig(r.tools) !== sig(GDK.allMeta || []);
    // tool đang tắt: người dùng thường không nhận được; quản trị viên nhận kèm "hidden": true (vẫn mở được bằng link)
    GDK.allMeta = r.tools; GDK.meta = r.tools.filter((t) => !t.hidden); GDK.toolsAuto = r.tools_auto !== false;
    GDK.version = r.version; GDK.user = r.user || null; GDK.lan = !!r.lan;
    $("#navCount").textContent = GDK.meta.length;
    return changed;
  }
  GDK.reloadTools = reloadTools;

  // ---------------------------------------------------------------- chuyển động
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";   // trang tự lo vị trí cuộn (tránh nhảy giữa trang khi F5)
  /** Thanh tiến độ mảnh trên cùng: start() → set(0..1) → done(). */
  const bar = (() => {
    const el = document.createElement("div");
    el.className = "topbar";
    document.body.appendChild(el);
    let hideT = null;
    return {
      start() { clearTimeout(hideT); el.style.transition = "none"; el.style.width = "0"; el.offsetWidth; el.style.transition = ""; el.classList.add("on"); el.style.width = "18%"; },
      set(p) { el.style.width = Math.max(18, Math.min(92, p * 100)) + "%"; },
      done() { el.style.width = "100%"; hideT = setTimeout(() => { el.classList.remove("on"); setTimeout(() => { el.style.width = "0"; }, 350); }, 220); },
    };
  })();
  GDK.bar = bar;
  /** Chạy lại hiệu ứng vào trang cho khối vừa vẽ. */
  function enter(el) {
    if (!el || REDUCED) return;
    el.classList.remove("page-in"); el.offsetWidth; el.classList.add("page-in");
  }

  // ---------------------------------------------------------------- router
  let cleanup = null;
  const view = $("#view");

  async function route() {
    if (typeof cleanup === "function") { try { cleanup(); } catch (e) { /* bỏ qua */ } }
    cleanup = null;
    const h = location.hash.replace(/^#/, "") || "/";
    $$(".nav-links a").forEach((a) => a.classList.toggle("on",
      (a.dataset.nav === "home" && (h === "/" || h.startsWith("/tool"))) || (a.dataset.nav === "settings" && h === "/settings")
      || (a.dataset.nav === "admin" && h.startsWith("/admin"))));
    window.scrollTo(0, 0);
    bar.start();
    GDK.currentTool = "";
    if (h.startsWith("/tool/")) return renderTool(decodeURIComponent(h.slice(6)));
    if (h === "/settings") { renderSettings(); enter(view.querySelector(".wrap")); return bar.done(); }
    if (h.startsWith("/admin")) return renderAdmin();
    renderHome(); enter(view.querySelector(".hh-text")); bar.done();
    // quản trị viên có thể vừa bật / tắt / sắp xếp lại tool → về trang chủ thì lấy danh sách mới, khác thì vẽ lại
    if (Date.now() - toolsAt > 3000) reloadTools().then((changed) => {
      if (!changed || (location.hash.replace(/^#/, "") || "/") !== "/" || view.querySelector(".grid.arranging")) return;
      if (typeof cleanup === "function") { try { cleanup(); } catch (e) { /* bỏ qua */ } }
      renderHome();
    }).catch(() => {});
  }

  // ---------------------------------------------------------------- trang chủ
  let homeCat = "Tất cả", homeQ = "";
  const pad2 = (n) => String(n).padStart(2, "0");
  /** Công tắc bật / tắt tool (trang chủ chế độ sắp xếp + trang Quản lý · Tools). */
  const togBtn = (id, on) => `<button class="arr-tog ${on ? "on" : ""}" type="button" data-tog="${esc(id)}" role="switch" aria-checked="${on}"><i></i><span>${on ? "Đang bật" : "Đang tắt"}</span></button>`;
  GDK.togBtn = togBtn;
  function renderHome() {
    const isAdmin = (GDK.user || {}).role === "admin";
    const cats = ["Tất cả", ...new Set(GDK.meta.map((t) => t.category))];
    const n = GDK.meta.length;
    const names = GDK.meta.map((t) => t.name);
    const strip = names.map((x) => `<span>${esc(x)}</span><span class="sep">✦</span>`).join("");
    view.innerHTML = `
      <div class="wrap home">
        <section class="home-hero" id="intro">
          <div class="hh-text" data-fade-out>
            <div class="sec-k" data-scramble>GD Toolkit · bộ công cụ cho cả team</div>
            <h1 aria-label="Golden Game Design Toolkit"><span class="ln gold-text">Golden</span><span class="ln"><span class="box">Game Design</span></span><span class="ln rb-text">Toolkit</span></h1>
            <p class="lead">Soát số liệu, đọc kết quả AB, xem cả bộ level thành ảnh, clone thư mục Drive… mở bằng trình duyệt, chạy trên máy chủ nội bộ, mỗi người một tài khoản.</p>
            <div class="hh-cta">
              <button class="btn primary" id="goTools">${icon("arrow-right")} Xem danh sách tool</button>
              <button class="btn" id="hhSearch">${icon("search")} Tìm tool · Ctrl K</button>
            </div>
            <div class="hh-stats">
              <div><b>${pad2(n)}</b><span>tool đang mở</span></div>
              <div><b>${pad2(cats.length - 1)}</b><span>nhóm việc</span></div>
              <div><b>${GDK.lan ? "LAN" : "LOCAL"}</b><span>${GDK.lan ? "cả team truy cập" : "chỉ máy này"}</span></div>
            </div>
          </div>
          <div class="hh-art" data-parallax="0.14">
            <div class="orbit"></div><div class="orbit o2"></div>
            <div id="heroMascot" title="Bấm vào mình xem nào!"></div>
            ${GDK.mascot && GDK.mascot.COLORS ? `<div class="ms-pal" id="msPal">
              <button type="button" class="ms-pal-btn" id="msPalBtn" title="Đổi màu robot" aria-label="Đổi màu robot" aria-expanded="false">${icon("palette")}</button>
              <div class="ms-colors" id="msColors" role="radiogroup" aria-label="Màu robot">${GDK.mascot.COLORS.map((c, i) =>
              `<button type="button" role="radio" data-c="${i}" title="${esc(c.name)}" aria-label="Màu ${esc(c.name)}" style="--c:${c.clay};--j:${c.joint}"></button>`).join("")}</div></div>` : ""}
            ${names.slice(0, 3).map((x, i) => `<div class="tagf t${i + 1}">${esc(x.split(" ")[0])} <b>${esc(x.split(" ").slice(1).join(" ") || "tool")}</b></div>`).join("")}
          </div>
          <div class="scroll-hint"><i></i>CUỘN XUỐNG</div>
        </section>
        <div class="marquee" aria-hidden="true"><div class="marquee-track">${strip}${strip}</div></div>
        <section class="sec" id="tools">
          <div class="sec-head" data-reveal>
            <div class="no"><b>01</b> / TOOLS</div>
            <h2 data-scramble>Chọn tool để bắt đầu</h2>
            <div class="sec-tools"><label class="search">${icon("search")}<input id="homeQ" type="search" placeholder="Tìm tool… (gõ / để focus)" value="${esc(homeQ)}"></label>
              ${isAdmin ? `<button class="btn" id="arrBtn" title="Quản trị viên: kéo thả đổi vị trí, bật / tắt tool cho cả team">${icon("sort")} Sắp xếp</button>` : ""}</div>
          </div>
          <div class="chips" id="cats" style="justify-content:flex-start;margin:0 0 18px" data-reveal></div>
          <div class="arr-bar" id="arrBar" hidden></div>
          <div class="grid" id="grid"></div>
        </section>
        <section class="sec" id="how">
          <div class="sec-head" data-reveal><div class="no"><b>02</b> / CÁCH HOẠT ĐỘNG</div><h2 data-scramble>Một máy chủ, cả team cùng dùng</h2></div>
          <div class="feat">
            <div data-reveal style="--d:0s"><span class="k">01 · ĐĂNG NHẬP</span><div class="dash"></div><h3>Tài khoản riêng</h3><p>Quản trị viên cấp tài khoản cho từng người. Mỗi lần dùng tool đều được ghi vào nhật ký để cả team biết công cụ nào đang có ích.</p></div>
            <div data-reveal style="--d:.12s"><span class="k">02 · LÀM VIỆC</span><div class="dash"></div><h3>Dữ liệu ở lại trên máy bạn</h3><p>File thả vào các tool phân tích chỉ xử lý trong trình duyệt của bạn, không gửi lên máy chủ. Đóng tab là mất.</p></div>
            <div data-reveal style="--d:.24s"><span class="k">03 · KẾT NỐI</span><div class="dash"></div><h3>Google của chính bạn</h3><p>Drive Clone chạy bằng Google Apps Script: mỗi người đăng nhập Google của mình ngay trên trang, quyền tối thiểu — không OAuth client, không server.</p></div>
          </div>
        </section>
      </div>`;
    // ---- chế độ sắp xếp (quản trị viên): kéo thả thẻ, bật / tắt tool cho cả team — tự lưu lên máy chủ
    let arranging = false, sortOff = null;
    const drawCats = () => {
      const cs = ["Tất cả", ...new Set(GDK.meta.map((t) => t.category))];
      if (!cs.includes(homeCat)) homeCat = "Tất cả";
      $("#cats").innerHTML = cs.map((c) => `<button class="chip ${c === homeCat ? "on" : ""}" data-c="${esc(c)}">${esc(c)}<span class="n">${c === "Tất cả" ? GDK.meta.length : GDK.meta.filter((t) => t.category === c).length}</span></button>`).join("");
    };
    const arrCard = (t, i) => `
        <div class="card-tool arr ${t.hidden ? "off" : ""}" style="--i:${i}" data-id="${esc(t.id)}">
          <span class="no">${pad2(i + 1)}</span>
          <div class="top"><span class="ibox">${icon(t.icon)}</span><div><h3>${esc(t.name)}</h3><div class="cat">${esc(t.category)}</div></div></div>
          <p>${esc(t.tagline || t.desc)}</p>
          <div class="bot"><button class="arr-grip" type="button" aria-label="Đổi vị trí ${esc(t.name)}: kéo, hoặc bấm phím mũi tên">${icon("grip")} Kéo</button>
            ${togBtn(t.id, !t.hidden)}</div>
        </div>`;
    const savedAt = () => { const s = $("#arrSaved"); if (s) s.textContent = "Đã lưu " + new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); };
    const save = async (body, redraw) => {
      const s = $("#arrSaved"); if (s) s.textContent = "Đang lưu…";
      try { await api("admin/tools/save", body); await reloadTools(); savedAt(); }
      catch (e) { toast(e.message, "bad"); await reloadTools().catch(() => {}); redraw = true; }
      if (!arranging) return;
      if (redraw) draw(); else syncCards();
      drawBar();
    };
    const syncCards = () => $$("#grid .card-tool.arr").forEach((c, i) => {
      const t = GDK.allMeta.find((x) => x.id === c.dataset.id) || {};
      $(".no", c).textContent = pad2(i + 1);
      c.classList.toggle("off", !!t.hidden);
      $(".arr-tog", c).outerHTML = togBtn(t.id, !t.hidden);
    });
    const drawBar = () => {
      const bar = $("#arrBar");
      bar.hidden = !arranging; $("#cats").hidden = arranging;
      $("#homeQ").disabled = arranging;
      const b = $("#arrBtn"); if (b) b.classList.toggle("on", arranging);
      if (!arranging) return;
      const on = GDK.allMeta.filter((t) => !t.hidden).length, prev = ($("#arrSaved") || {}).textContent || "";
      bar.innerHTML = `<div class="ab-hint">${icon("grip")}<span><b>Đang sắp xếp</b> — kéo thẻ để đổi vị trí (hoặc bấm “Kéo” rồi dùng phím mũi tên), bấm công tắc để bật / tắt tool với cả team. Tự lưu.</span></div>
        <div class="ab-acts">
          <label class="sw-row"><input type="checkbox" id="arrAuto" ${GDK.toolsAuto ? "checked" : ""}><span class="sw"></span>Tự sắp theo thứ tự mặc định</label>
          <span class="ab-count">${on}/${GDK.allMeta.length} đang bật</span><span class="ab-saved" id="arrSaved">${esc(prev)}</span>
          <button class="btn sm" id="arrReset">${icon("refresh")} Về mặc định</button>
          <button class="btn sm primary" id="arrDone">${icon("check")} Xong</button>
        </div>`;
      $("#arrAuto").onchange = (e) => save({ auto: e.target.checked }, true);
      $("#arrReset").onclick = () => { if (confirm("Đưa thứ tự tool về mặc định (theo khai báo trong code)?\nBật / tắt của từng tool giữ nguyên.")) save({ reset: true }, true); };
      $("#arrDone").onclick = () => setArranging(false);
    };
    const setArranging = (on) => {
      arranging = on;
      if (sortOff) { sortOff(); sortOff = null; }
      if (on) {
        homeQ = ""; $("#homeQ").value = "";
        sortOff = GDK.sortable($("#grid"), { item: ".card-tool.arr", ignore: ".arr-tog", keys: ".arr-grip",
          onEnd: (ids) => { const wasAuto = GDK.toolsAuto; syncCards(); save({ order: ids, auto: false }); if (wasAuto) toast("Đã chuyển sang thứ tự tuỳ chỉnh (tắt “Tự sắp theo mặc định”).", "ok"); } });
      } else {
        drawCats();
        const st = $(".hh-stats b"); if (st) st.textContent = pad2(GDK.meta.length);
      }
      draw(); drawBar();
    };
    $("#grid").addEventListener("click", (e) => {
      const b = e.target.closest(".arr-tog"); if (!b || !arranging) return;
      const id = b.dataset.tog, t = GDK.allMeta.find((x) => x.id === id);
      if (!t) return;
      if (!t.hidden && GDK.allMeta.filter((x) => !x.hidden).length === 1) { toast("Cần để lại ít nhất 1 tool đang bật.", "bad"); return; }
      t.hidden = !t.hidden; syncCards();
      save({ enabled: { [id]: !t.hidden } });
    });
    if (isAdmin) $("#arrBtn").onclick = () => setArranging(!arranging);
    const draw = () => {
      const g = $("#grid");
      g.classList.toggle("arranging", arranging);
      if (arranging) { g.innerHTML = GDK.allMeta.map(arrCard).join(""); return; }
      const q = homeQ.trim().toLowerCase();
      const list = GDK.meta.filter((t) => (homeCat === "Tất cả" || t.category === homeCat) &&
        (!q || [t.name, t.tagline, t.desc, t.category, ...(t.tags || [])].join(" ").toLowerCase().includes(q)));
      $("#grid").innerHTML = list.map((t, i) => `
        <a class="card-tool" style="--i:${i}" href="#/tool/${esc(t.id)}" data-illus="${esc(t.id)}" data-illus-cap="${esc((t.example || {}).headline || t.tagline || "")}">
          <span class="no">${pad2(GDK.meta.indexOf(t) + 1)}</span>
          <div class="top"><span class="ibox">${icon(t.icon)}</span><div><h3>${esc(t.name)}</h3><div class="cat">${esc(t.category)}</div></div></div>
          <p>${esc(t.desc)}</p>
          <div class="bot"><span class="tag">v${esc(t.version || "1.0")}</span><span class="go">Mở tool ${icon("arrow-right")}</span></div>
        </a>`).join("") + (q ? "" : `
        <div class="card-tool ghost" style="--i:${list.length}">
          <div class="top"><span class="ibox">${icon("plus-square")}</span><div><h3>Tool tiếp theo</h3><div class="cat">Mở rộng</div></div></div>
          <p>Thêm tool mới: tạo <code>tools/&lt;id&gt;/</code> (Python) và <code>web/tools/&lt;id&gt;.js</code> (giao diện). Server tự nhận, không cần đăng ký. Xem README.</p>
        </div>`);
      if (!list.length && q) $("#grid").innerHTML = `<div class="empty" style="grid-column:1/-1;padding:40px">Không có tool nào khớp “${esc(homeQ)}”.</div>`;
    };
    $("#homeQ").oninput = (e) => { homeQ = e.target.value; draw(); };
    $("#cats").onclick = (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      homeCat = b.dataset.c; $$("#cats .chip").forEach((x) => x.classList.toggle("on", x === b)); draw();
    };
    // ánh sáng chạy theo chuột trên thẻ tool
    $("#grid").onpointermove = (e) => {
      const c = e.target.closest(".card-tool"); if (!c) return;
      const r = c.getBoundingClientRect();
      c.style.setProperty("--mx", (e.clientX - r.left) + "px"); c.style.setProperty("--my", (e.clientY - r.top) + "px");
    };
    $("#goTools").onclick = () => { const t = $("#tools"); window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - 64, behavior: REDUCED ? "auto" : "smooth" }); };
    $("#hhSearch").onclick = () => openPalette();
    drawCats(); draw();
    const ms = GDK.mascot ? GDK.mascot($("#heroMascot")) : null;
    // chọn 1 trong 5 màu thân robot (nhớ trong trình duyệt, trang đăng nhập cũng dùng màu này)
    const swatches = $("#msColors");
    if (swatches && ms) {
      const mark = (i) => $$("button", swatches).forEach((b) => { const on = +b.dataset.c === i; b.classList.toggle("on", on); b.setAttribute("aria-checked", on); });
      mark(GDK.mascot.color());
      swatches.onclick = (e) => { const b = e.target.closest("button[data-c]"); if (!b) return; GDK.mascot.setColor(+b.dataset.c); mark(+b.dataset.c); };
      // ẩn mặc định: chỉ 1 nút bảng màu nhỏ (hiện khi rê chuột vào vùng robot), bấm mới mở 5 màu
      const pal = $("#msPal"), pb = $("#msPalBtn");
      const close = (e) => { if (e && pal.contains(e.target)) return; pal.classList.remove("open"); pb.setAttribute("aria-expanded", "false"); document.removeEventListener("pointerdown", close); };
      pb.onclick = () => {
        const open = !pal.classList.contains("open");
        pal.classList.toggle("open", open); pb.setAttribute("aria-expanded", open);
        if (open) setTimeout(() => document.addEventListener("pointerdown", close), 0); else close();
      };
    }
    const fxOff = GDK.fx ? GDK.fx.page(view, { smooth: true, sections: [{ id: "intro", label: "Giới thiệu" }, { id: "tools", label: "Tools" }, { id: "how", label: "Cách hoạt động" }] }) : () => {};
    cleanup = () => { fxOff(); if (ms) ms.destroy(); if (sortOff) sortOff(); };
  }

  async function renderAdmin() {
    document.title = "Quản lý · GD Toolkit";
    if ((GDK.user || {}).role !== "admin") {
      view.innerHTML = `<div class="wrap"><div class="note bad" style="margin-top:30px">${icon("lock")}<div>Trang này chỉ dành cho quản trị viên.</div></div></div>`;
      return bar.done();
    }
    view.innerHTML = `<div class="wrap"><div class="load-msg"><span class="spin"></span>Đang mở trang quản lý<span class="load-dots"><i></i><i></i><i></i></span></div></div>`;
    try {
      await loadScript("assets/admin.js", true);
      const ret = GDK.renderAdmin(view, { enter, bar });
      cleanup = ret && ret.cleanup ? ret.cleanup : null;
    } catch (e) { view.innerHTML = `<div class="wrap"><div class="note bad">${icon("alert")}<div>${esc(e.message)}</div></div></div>`; }
    bar.done();
  }

  // ---------------------------------------------------------------- trang tool
  const loaded = {};
  function loadScript(id, raw) {
    if (raw && !loaded[id] && document.querySelector(`script[src="${id}"]`)) loaded[id] = Promise.resolve();   // đã nạp sẵn ở index.html
    if (!loaded[id]) {
      loaded[id] = new Promise((ok, fail) => {
        const s = document.createElement("script");
        s.src = (raw ? id : "tools/" + encodeURIComponent(id) + ".js") + "?v=" + GDK.version;
        s.onload = ok; s.onerror = () => fail(new Error("Không tải được giao diện tool " + id));
        document.body.appendChild(s);
      });
    }
    return loaded[id];
  }

  function asideHtml(t, hooks) {
    const ex = t.example || {};
    const small = window.matchMedia("(max-width: 1080px)").matches;
    return `<details class="aside-box" ${small ? "" : "open"}>
      <summary>${icon("sparkles")} Ví dụ &amp; cách dùng ${icon("chevron-down")}</summary>
      <div class="aside-body">
        <div class="eyebrow">Ví dụ ${GDK.illus && GDK.illus.has(t.id) ? `<span class="illus-hint" data-illus="${esc(t.id)}" data-illus-cap="${esc(ex.headline || "")}">${icon("image")} giữ chuột để xem ảnh minh hoạ</span>` : ""}</div>
        ${ex.headline ? `<p>${esc(ex.headline)}</p>` : ""}
        ${ex.input ? `<div class="in"><b>Cần:</b> ${esc(ex.input)}</div>` : ""}
        ${ex.steps ? `<div class="eyebrow">Cách dùng</div><ol class="aside-steps">${ex.steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>` : ""}
        <div class="aside-acts">
          ${hooks.sample ? `<button class="btn primary" data-aside="sample">${icon("flask")} ${esc(hooks.sampleLabel || "Thử với dữ liệu mẫu")}</button>` : ""}
          ${hooks.template ? `<button class="btn" data-aside="template">${icon("download")} Tải file mẫu</button>` : ""}
        </div>
      </div></details>`;
  }

  async function renderTool(id) {
    const t = (GDK.allMeta || GDK.meta).find((x) => x.id === id);
    if (!t) { view.innerHTML = `<div class="wrap"><div class="empty">Không có tool “${esc(id)}”, hoặc tool này đang được quản trị viên tạm tắt. <a href="#/">Về trang chủ</a></div></div>`; return bar.done(); }
    document.title = t.name + " · GD Toolkit";
    view.innerHTML = `
      <div class="wrap">
        <div class="crumbs"><a href="#/">Home</a>${icon("chevron-right")}<span>${esc(t.category)}</span>${icon("chevron-right")}<b>${esc(t.name)}</b></div>
        <div class="tool-head">
          <span class="ibox" ${GDK.illus && GDK.illus.has(t.id) ? `data-illus="${esc(t.id)}" data-illus-cap="${esc((t.example || {}).headline || "")}"` : ""}>${icon(t.icon)}</span>
          <div><h1>${esc(t.name)}</h1><p>${esc(t.desc)}</p>
            <div class="badges"><span class="badge"><span class="dot"></span>Chạy local</span>${(t.needs || []).includes("google") ? `<span class="badge">${icon("cloud")}Google Drive API</span>` : ""}<span class="badge mono">v${esc(t.version || "1.0")}</span></div>
          </div>
        </div>
        ${t.hidden ? `<div class="note" style="margin-top:14px">${icon("eye")}<div><b>Tool đang tắt</b> với cả team — người dùng khác không thấy và không dùng được, chỉ quản trị viên mở được để thử. Bật lại ở <a href="#/admin/tools">Quản lý · Tools</a> hoặc nút <b>Sắp xếp</b> trên trang chủ.</div></div>` : ""}
        <div class="tool-layout">
          <div id="toolMount">${skeleton(t)}</div>
          <aside class="tool-aside" id="toolAside"><div class="sk-panel"><div class="sk-line h"></div><div class="sk-line"></div><div class="sk-line" style="width:80%"></div><div class="sk-line" style="width:60%"></div></div></aside>
        </div>
      </div>`;
    enter(view.querySelector(".wrap"));
    try {
      const deps = (t.scripts || []).concat([null]);
      for (let k = 0; k < deps.length; k++) {
        await (deps[k] ? loadScript(deps[k], true) : loadScript(id));
        bar.set(0.2 + 0.7 * (k + 1) / deps.length);
      }
      const mod = GDK.tools[id];
      if (!mod) throw new Error("Tool chưa đăng ký giao diện.");
      if (location.hash !== "#/tool/" + id) return;
      const mountEl = $("#toolMount");
      mountEl.innerHTML = "";
      GDK.currentTool = id;
      GDK.track(id, "open");
      const ret = mod.mount(mountEl, t);
      if (!REDUCED) mountEl.classList.add("mounted");
      const hooks = ret && typeof ret === "object" ? ret : {};
      cleanup = typeof ret === "function" ? ret : hooks.cleanup || null;
      $("#toolAside").innerHTML = asideHtml(t, hooks);
      const sb = $('[data-aside="sample"]'), tb = $('[data-aside="template"]');
      if (sb) sb.onclick = () => { GDK.track(id, "sample"); hooks.sample(); if (window.matchMedia("(max-width: 1080px)").matches) $(".aside-box").open = false; };
      if (tb) tb.onclick = () => hooks.template();
    } catch (e) {
      $("#toolMount").innerHTML = `<div class="note bad">${icon("alert")}<div>${esc(e.message)}</div></div>`;
      $("#toolAside").innerHTML = "";
    } finally { bar.done(); }
  }
  /** Khung chờ lấp lánh trong lúc tải giao diện tool. */
  function skeleton(t) {
    const panel = (lines, block) => `<div class="sk-panel"><div class="sk-line h"></div>${lines.map((w) => `<div class="sk-line" style="width:${w}%"></div>`).join("")}${block ? `<div class="sk-line sk-block"></div>` : ""}</div>`;
    return `<div class="load-msg"><span class="spin"></span>Đang mở ${esc(t.name)}<span class="load-dots"><i></i><i></i><i></i></span></div>
      ${panel([92, 74], true)}${panel([86, 60, 70])}`;
  }

  // ---------------------------------------------------------------- cài đặt
  function renderSettings() {
    document.title = "Cài đặt · GD Toolkit";
    view.innerHTML = `
      <div class="wrap">
        <div class="crumbs"><a href="#/">Home</a>${icon("chevron-right")}<b>Cài đặt</b></div>
        <div class="tool-head"><span class="ibox">${icon("settings")}</span>
          <div><h1>Tài khoản &amp; bảo mật</h1><p>Mật khẩu, phiên đăng nhập và các lớp bảo vệ của Tool Kit. Google Drive không cần kết nối ở đây nữa — <b>Drive Clone</b> chạy bằng Google Apps Script, mỗi người đăng nhập Google của chính mình ngay trên trang Drive Clone.</p></div></div>
        <section class="panel"><div class="ph"><span class="ibox sm">${icon("shield")}</span><h2>Bảo mật</h2><span class="sub">các lớp bảo vệ đang bật</span>
          <div class="right"><button class="btn sm ghost" id="secRefresh">${icon("refresh")}</button></div></div><div class="pb" id="sec"></div></section>
        ${(GDK.allMeta || []).some((t) => t.hidden) ? `<section class="panel"><div class="ph"><span class="ibox sm">${icon("eye-off")}</span><h2>Tool đang tắt</h2><span class="sub">cả team không thấy — quản trị viên vẫn mở được để thử</span>
            <div class="right"><a class="btn sm" href="#/admin/tools">${icon("grid")} Quản lý tool</a></div></div>
          <div class="pb">${GDK.allMeta.filter((t) => t.hidden).map((t) => `<a class="file-chip" style="margin-bottom:8px;text-decoration:none;color:inherit" href="#/tool/${esc(t.id)}"><span class="ibox sm">${icon(t.icon)}</span><div class="fc-main"><b>${esc(t.name)}</b><span>${esc(t.tagline || "")}</span></div><span class="btn sm">Mở ${icon("arrow-right")}</span></a>`).join("")}</div></section>` : ""}
      </div>`;
    // ------------------------------------------------ khu bảo mật
    const item = (lv, ic, title, sub) => `<div class="sec-item ${lv}"><span class="lv">${icon(ic)}</span><div>${title}${sub ? `<small>${sub}</small>` : ""}</div></div>`;
    async function drawSecurity() {
      let st;
      try { st = await api("security/status"); } catch (e) { $("#sec").innerHTML = `<div class="note bad">${icon("alert")}<div>${esc(e.message)}</div></div>`; return; }
      const enc = (x, name) => !x.exists ? item("", "info", name + ": chưa có", "")
        : x.encrypted ? item("ok", "lock", name + ": đã mã hoá", "Windows DPAPI — chỉ mở được bằng tài khoản Windows này")
          : item("warn", "alert", name + ": chưa mã hoá", st.dpapi ? "khởi động lại GD Toolkit để tự mã hoá" : "máy không có DPAPI — chỉ chủ file được đọc");
      const fmtB = (n) => n < 1048576 ? (n / 1024).toFixed(0) + " KB" : (n / 1048576).toFixed(1).replace(".", ",") + " MB";
      $("#sec").innerHTML = `
        <div class="sec-grid">
          ${item("ok", "lock", "Tài khoản riêng từng người", "bạn có " + st.login.sessions + " phiên đang mở · băm scrypt, khoá tạm khi sai 5 lần")}
          ${st.lan ? item("ok", "home", "Mạng nội bộ", "chỉ nhận máy có địa chỉ nội bộ (10.x, 172.16–31.x, 192.168.x) · chặn tên miền lạ")
                   : item("ok", "home", "Chỉ truy cập từ máy này", "server nghe ở 127.0.0.1, chặn tên miền lạ (DNS rebinding)")}
          ${item("ok", "key", "Khoá phiên API", "đổi mỗi lần mở Tool Kit — trang web khác không gọi được API")}
          ${item("ok", "shield", "Chặn script lạ (CSP)", "chỉ chạy code của Tool Kit · không cho nhúng vào iframe")}
          ${item("ok", "sheet", "Chống chèn công thức", "file CSV / Excel xuất ra không tự chạy công thức lạ")}
          ${st.token.exists ? enc(st.token, "Token Google cũ của bạn (bản OAuth đã tắt — nên xoá)") : ""}
          ${st.credentials.exists ? enc(st.credentials, "credentials.json cũ (bản OAuth đã tắt — nên xoá)") : ""}
          ${st.admin && st.plaintext_leftovers.length ? item("bad", "alert", "Còn file bí mật dạng chữ thường", st.plaintext_leftovers.join(", ") + " — khởi động lại để tự mã hoá") : ""}
          ${st.admin ? item("", "history", "Lịch sử chạy (out/)", st.history.files + " file · " + fmtB(st.history.bytes)) : ""}
        </div>
        <div class="sectit">Mật khẩu đăng nhập</div>
        <div class="grid3" style="align-items:end">
          <div><label class="lb">Mật khẩu hiện tại</label><input type="password" id="pwOld" autocomplete="current-password"></div>
          <div><label class="lb">Mật khẩu mới (≥ 8 ký tự)</label><input type="password" id="pwNew" autocomplete="new-password">
            <div class="pw-meter"><i id="pwMeter"></i></div></div>
          <div><label class="lb">Nhập lại mật khẩu mới</label><input type="password" id="pwNew2" autocomplete="new-password"></div>
        </div>
        <div class="row" style="margin-top:10px">
          <button class="btn sm primary" id="pwChange">${icon("key")} Đổi mật khẩu</button>
          <button class="btn sm" id="logoutOthers">${icon("logout")} Đăng xuất các phiên khác</button>
          <span class="hint" style="margin:0" id="pwHint">Đổi mật khẩu sẽ đăng xuất mọi phiên khác của bạn. Quên mật khẩu: ${st.admin ? "chạy <code>python server.py set-password</code> trên máy chủ" : "nhờ quản trị viên đặt lại"}.</span>
        </div>
        <div class="sectit">Xoá dữ liệu</div>
        <div class="row">
          ${st.token.exists ? `<button class="btn sm" data-wipe="token">${icon("logout")} Xoá token Google cũ của tôi</button>` : ""}
          ${st.admin ? `<button class="btn sm" data-wipe="history">${icon("trash")} Xoá lịch sử chạy</button>
          ${st.credentials.exists ? `<button class="btn sm" data-wipe="credentials">${icon("key")} Xoá credentials.json cũ</button>` : ""}
          <button class="btn sm danger" data-wipe="all">${icon("trash")} Xoá tất cả</button>` : ""}
        </div>
        <p class="hint">File bí mật được ghi đè rồi mới xoá. Dữ liệu bạn thả vào các tool phân tích chỉ nằm trong bộ nhớ tab trên máy bạn — đóng tab là mất, không gửi lên máy chủ.</p>
        ${st.admin ? `<div class="sectit">Nhật ký bảo mật <span class="dim" style="text-transform:none;font-family:var(--font);font-weight:400">— data/audit.log, không bao giờ ghi mật khẩu / token · nhật ký sử dụng đầy đủ ở trang <a href="#/admin/usage">Quản lý</a></span></div>
        <div class="audit">${st.audit.length ? st.audit.map((a) => `<div><span>${esc(a.t.replace("T", " "))}</span><span><b>${esc(a.user || "")}</b> ${esc(a.action)} ${esc(Object.entries(a).filter(([k]) => !["t", "action", "user"].includes(k)).map(([k, v]) => k + "=" + (Array.isArray(v) ? v.join(",") : v)).join(" · "))}</span></div>`).join("") : "Chưa có sự kiện nào."}</div>` : ""}`;
      $$("#sec [data-wipe]").forEach((b) => b.onclick = async () => {
        const w = b.dataset.wipe;
        const what = w === "all" ? ["history", "token", "credentials", "audit"] : [w];
        const msg = { history: "Xoá toàn bộ lịch sử chạy trong out/ (của mọi người)?", token: "Xoá token Google cũ (bản OAuth đã tắt) của bạn?",
          credentials: "Xoá credentials.json cũ (bản OAuth đã tắt)?", all: "Xoá TẤT CẢ: lịch sử chạy, token, credentials, nhật ký?" }[w];
        if (!confirm(msg + "\n\nKhông hoàn tác được.")) return;
        try { await api("security/wipe", { what }); toast("Đã xoá.", "ok"); drawSecurity(); } catch (e) { toast(e.message, "bad"); }
      });
    }
    $("#sec").addEventListener("input", (e) => {
      if (e.target.id !== "pwNew" || !GDK.kit) return;
      const s = GDK.kit.passwordStrength(e.target.value), m = $("#pwMeter");
      m.style.width = (e.target.value ? 12 + s.score * 22 : 0) + "%"; m.className = s.cls;
    });
    $("#sec").addEventListener("click", async (e) => {
      if (e.target.closest("#pwChange")) {
        const o = $("#pwOld").value, n = $("#pwNew").value, n2 = $("#pwNew2").value;
        if (n.length < 8) return toast("Mật khẩu mới cần ít nhất 8 ký tự.", "bad");
        if (n !== n2) return toast("Hai lần nhập mật khẩu mới không khớp.", "bad");
        try { await api("auth/change", { old: o, new: n }); toast("Đã đổi mật khẩu — các phiên khác đã bị đăng xuất.", "ok"); drawSecurity(); }
        catch (err) { toast(err.message, "bad"); }
      } else if (e.target.closest("#logoutOthers")) {
        try { await api("auth/logout_others", {}); toast("Đã đăng xuất các phiên khác.", "ok"); drawSecurity(); }
        catch (err) { toast(err.message, "bad"); }
      }
    });
    $("#secRefresh").onclick = drawSecurity;
    drawSecurity();
  }

  // ---------------------------------------------------------------- tìm nhanh (Ctrl K)
  let pIdx = 0, pItems = [];
  function paletteItems(q) {
    const all = [
      ...GDK.meta.map((t) => ({ t: t.name, d: t.tagline || t.category, icon: t.icon, href: "#/tool/" + t.id, k: [t.name, t.desc, t.category, ...(t.tags || [])].join(" ") })),
      { t: "Trang chủ", d: "Danh sách tool", icon: "home", href: "#/", k: "home trang chu tools" },
      { t: "Cài đặt", d: "Mật khẩu, phiên đăng nhập, bảo mật", icon: "settings", href: "#/settings", k: "settings cai dat dang nhap mat khau bao mat" },
      ...((GDK.user || {}).role === "admin" ? [{ t: "Quản lý người dùng", d: "Tài khoản, nhật ký sử dụng, mạng nội bộ", icon: "shield", href: "#/admin", k: "admin quan ly nguoi dung tai khoan nhat ky log mang" },
        { t: "Quản lý tool", d: "Bật / tắt tool, kéo thả đổi thứ tự", icon: "grid", href: "#/admin/tools", k: "admin tool bat tat an hien sap xep thu tu keo tha" }] : []),
    ];
    q = q.trim().toLowerCase();
    return q ? all.filter((x) => (x.t + " " + x.k).toLowerCase().includes(q)) : all;
  }
  function drawPalette() {
    pItems = paletteItems($("#paletteInput").value);
    pIdx = Math.min(pIdx, Math.max(0, pItems.length - 1));
    $("#paletteList").innerHTML = pItems.map((x, i) => `<div class="p-item ${i === pIdx ? "on" : ""}" data-i="${i}"><span class="ibox">${icon(x.icon)}</span><div><div class="t">${esc(x.t)}</div><div class="d">${esc(x.d)}</div></div></div>`).join("")
      || `<div class="empty">Không thấy gì.</div>`;
  }
  function openPalette() { $("#palette").hidden = false; $("#paletteInput").value = ""; pIdx = 0; drawPalette(); $("#paletteInput").focus(); }
  function closePalette() { $("#palette").hidden = true; }
  function pick(i) { const x = pItems[i]; if (x) { closePalette(); location.hash = x.href.slice(1); } }
  $("#openPalette").onclick = openPalette;
  $("#palette").onclick = (e) => { if (e.target.id === "palette") closePalette(); const it = e.target.closest(".p-item"); if (it) pick(+it.dataset.i); };
  $("#paletteInput").oninput = () => { pIdx = 0; drawPalette(); };
  $("#paletteInput").onkeydown = (e) => {
    if (e.key === "ArrowDown") { pIdx = Math.min(pIdx + 1, pItems.length - 1); drawPalette(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { pIdx = Math.max(pIdx - 1, 0); drawPalette(); e.preventDefault(); }
    else if (e.key === "Enter") pick(pIdx);
    else if (e.key === "Escape") closePalette();
  };
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#palette").hidden ? openPalette() : closePalette(); }
    else if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && $("#homeQ")) { e.preventDefault(); $("#homeQ").focus(); }
    else if (e.key === "Escape" && !$("#palette").hidden) closePalette();
  });

  // ---------------------------------------------------------------- ảnh minh hoạ khi giữ chuột
  // Phần tử có data-illus="<id tool>": giữ chuột ~1,2 giây thì hiện ảnh minh hoạ (+ câu ví dụ).
  const HOVER_MS = 1200;
  const pop = document.createElement("div");
  pop.className = "illus-pop";
  pop.hidden = true;
  document.body.appendChild(pop);
  let hvEl = null, hvT = null;
  function hidePop() { clearTimeout(hvT); hvT = null; hvEl = null; pop.hidden = true; pop.classList.remove("show"); }
  function showPop(el) {
    if (!GDK.illus || !GDK.illus.has(el.dataset.illus)) return;
    const cap = el.dataset.illusCap || "";
    pop.innerHTML = GDK.illus.render(el.dataset.illus) + (cap ? `<div class="ip-cap">${esc(cap)}</div>` : "");
    pop.hidden = false;
    const r = el.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    let top = r.bottom + 10;
    if (top + h > vh - 8) top = Math.max(8, r.top - h - 10);       // không đủ chỗ phía dưới → hiện phía trên
    const left = Math.min(Math.max(8, r.left + Math.min(24, r.width / 4)), vw - w - 8);
    pop.style.top = top + "px"; pop.style.left = left + "px";
    void pop.offsetWidth;            // ép trình duyệt tính layout để hiệu ứng hiện dần chạy được
    pop.classList.add("show");
  }
  document.addEventListener("mouseover", (e) => {
    const el = e.target.closest && e.target.closest("[data-illus]");
    if (el === hvEl) return;
    hidePop();
    if (!el) return;
    hvEl = el;
    hvT = setTimeout(() => { if (hvEl === el) showPop(el); }, HOVER_MS);
  });
  document.addEventListener("mouseout", (e) => {
    if (hvEl && !(e.relatedTarget && hvEl.contains(e.relatedTarget))) hidePop();
  });
  window.addEventListener("scroll", hidePop, { passive: true });
  window.addEventListener("hashchange", hidePop);
  document.addEventListener("mousedown", hidePop);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hidePop(); });

  // ---------------------------------------------------------------- khởi động
  (async () => {
    hydrate();
    applyThemeIcon();
    try {
      await reloadTools();
      drawUser();
      $("#ver").textContent = "v" + GDK.version;
    } catch (e) {
      view.innerHTML = `<div class="wrap"><div class="note bad" style="margin-top:40px">${icon("alert")}<div>${esc(e.message)}</div></div></div>`;
      return;
    }
    window.addEventListener("hashchange", route);
    route();
  })();
})();

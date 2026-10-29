/* Hiệu ứng giao diện kiểu "web3": cuộn mượt, khối hiện dần khi cuộn tới, chữ nhảy ký tự (scramble), mục lục
   bên phải, chiều sâu khi cuộn (parallax). Tự viết — không cần thư viện ngoài. Tắt hết khi bật "giảm chuyển động".
   GDK.fx.page(root) → bật cho 1 trang, trả về hàm dọn dẹp. */
(() => {
  "use strict";
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const GLYPHS = "!<>-_/[]{}=+*^?#ABCDEFGHKMNPRSTUVXYZ0123456789";

  /** Chữ nhảy ký tự rồi hiện đúng chữ (giữ nguyên dấu cách / xuống dòng). */
  function scramble(el, opts) {
    opts = opts || {};
    const final = opts.text != null ? String(opts.text) : (el.dataset.text || el.textContent);
    el.dataset.text = final;
    if (REDUCED) { el.textContent = final; return; }
    const dur = opts.duration || Math.min(1100, 350 + final.length * 22);
    const start = performance.now();
    cancelAnimationFrame(el._scr || 0);
    const step = (t) => {
      const p = Math.min(1, (t - start) / dur);
      let out = "";
      for (let i = 0; i < final.length; i++) {
        const ch = final[i];
        if (ch === " " || ch === "\n") { out += ch; continue; }
        const at = i / final.length;
        out += p >= at + (1 - at) * 0.55 ? ch : p > at * 0.6 ? GLYPHS[(Math.random() * GLYPHS.length) | 0] : " ";
      }
      el.textContent = out;
      if (p < 1) el._scr = requestAnimationFrame(step); else el.textContent = final;
    };
    el._scr = requestAnimationFrame(step);
  }

  /** Cuộn mượt bằng con lăn chuột (chỉ khi chuột không nằm trên vùng cuộn riêng như bảng, hộp log). */
  function smoothScroll() {
    if (REDUCED || window.matchMedia("(pointer: coarse)").matches) return () => {};
    let target = window.scrollY, cur = window.scrollY, raf = 0, active = false;
    const max = () => document.documentElement.scrollHeight - window.innerHeight;
    const scrollable = (node) => {
      for (let n = node; n && n !== document.body && n.nodeType === 1; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1) return true;
        if (n.matches("input, textarea, select, .modal, .lp-view, .palette, .menu-pop")) return true;
      }
      return false;
    };
    const tick = () => {
      cur += (target - cur) * 0.11;
      if (Math.abs(target - cur) < 0.5) { cur = target; active = false; }
      window.scrollTo(0, cur);
      if (active) raf = requestAnimationFrame(tick);
    };
    const onWheel = (e) => {
      if (e.ctrlKey || e.defaultPrevented || scrollable(e.target)) return;
      e.preventDefault();
      if (!active) { cur = window.scrollY; target = cur; }
      const d = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaMode === 2 ? e.deltaY * window.innerHeight : e.deltaY;
      target = Math.max(0, Math.min(max(), target + d));
      if (!active) { active = true; raf = requestAnimationFrame(tick); }
    };
    const onOther = () => { if (!active) { cur = target = window.scrollY; } };   // cuộn bằng phím / thanh cuộn
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("scroll", onOther, { passive: true });
    return () => { cancelAnimationFrame(raf); window.removeEventListener("wheel", onWheel); window.removeEventListener("scroll", onOther); };
  }

  /** Khối có [data-reveal] hiện dần khi cuộn tới; [data-scramble] chạy chữ nhảy lúc hiện. */
  function reveal(root) {
    const els = [...root.querySelectorAll("[data-reveal], [data-scramble]")];
    if (REDUCED || !("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("in")); return () => {}; }
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const el = en.target;
        el.classList.add("in");
        if (el.hasAttribute("data-scramble")) scramble(el);
        el.querySelectorAll("[data-scramble]").forEach((x, i) => setTimeout(() => scramble(x), 80 * i));
        io.unobserve(el);
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }

  /** Mục lục cố định bên phải: chấm sáng theo phần đang xem, bấm để cuộn tới. */
  function sectionNav(root, sections) {
    const nav = document.createElement("nav");
    nav.className = "sec-nav";
    nav.innerHTML = sections.map((s) => `<a href="#" data-sec="${s.id}"><i></i><span>${s.label}</span></a>`).join("");
    document.body.appendChild(nav);
    nav.onclick = (e) => {
      const a = e.target.closest("a[data-sec]"); if (!a) return;
      e.preventDefault();
      const t = root.querySelector("#" + a.dataset.sec);
      if (t) window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - 70, behavior: REDUCED ? "auto" : "smooth" });
    };
    const set = () => {
      const mid = window.innerHeight * 0.4;
      let on = sections[0].id;
      for (const s of sections) { const t = root.querySelector("#" + s.id); if (t && t.getBoundingClientRect().top < mid) on = s.id; }
      nav.querySelectorAll("a").forEach((a) => a.classList.toggle("on", a.dataset.sec === on));
      const sc = document.documentElement;
      nav.style.setProperty("--p", (window.scrollY / Math.max(1, sc.scrollHeight - window.innerHeight)).toFixed(3));
    };
    window.addEventListener("scroll", set, { passive: true });
    set();
    return () => { window.removeEventListener("scroll", set); nav.remove(); };
  }

  /** [data-parallax="0.3"]: dịch chậm hơn khi cuộn; [data-fade-out]: mờ dần khi cuộn qua. */
  function parallax(root) {
    if (REDUCED) return () => {};
    const items = [...root.querySelectorAll("[data-parallax], [data-fade-out]")];
    if (!items.length) return () => {};
    let raf = 0;
    const run = () => {
      raf = 0;
      const y = window.scrollY, h = window.innerHeight;
      for (const el of items) {
        if (el.dataset.parallax) el.style.transform = `translate3d(0, ${(y * +el.dataset.parallax).toFixed(1)}px, 0)`;
        if (el.hasAttribute("data-fade-out")) el.style.opacity = String(Math.max(0, 1 - y / (h * 0.7)).toFixed(3));
      }
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(run); };
    window.addEventListener("scroll", on, { passive: true });
    run();
    return () => { window.removeEventListener("scroll", on); cancelAnimationFrame(raf); };
  }

  /** Bật hiệu ứng cho 1 trang. opts {smooth, sections:[{id,label}]} → hàm dọn dẹp. */
  function page(root, opts) {
    opts = opts || {};
    const offs = [reveal(root), parallax(root)];
    if (opts.smooth) offs.push(smoothScroll());
    if (opts.sections && opts.sections.length && window.innerWidth > 1100) offs.push(sectionNav(root, opts.sections));
    return () => offs.forEach((f) => { try { f(); } catch (e) { /* bỏ qua */ } });
  }

  window.GDK = window.GDK || {};
  GDK.fx = { page, scramble, reveal, REDUCED };
})();

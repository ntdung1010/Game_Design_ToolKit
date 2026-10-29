/* Linh vật GD Toolkit: một ống nghiệm (chủ đề game sort) có mặt cười, nước cầu vồng gợn sóng, bọt nổi, mắt nhìn
   theo chuột, chớp mắt, bồng bềnh. Vẽ bằng SVG + CSS — không dùng ảnh / video, không cần mạng.
   Có WebGL thì tự nâng cấp lên bản 3D (mascot3d.js + three.js), bản SVG hiện trước trong lúc tải / khi máy không hỗ trợ.
   GDK.mascot(el, {size, flat}) → {mood("happy" | "cute" | "sad" | "think" | ""), color(i), destroy()}
   GDK.mascot.COLORS: 5 màu thân robot 3D (màu đã chọn nhớ trong trình duyệt, mọi linh vật trên trang đổi theo). */
(() => {
  "use strict";
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const LAYERS = ["#34D399", "#FBBF24", "#FB7185", "#A78BFA", "#38BDF8"];
  let seq = 0;
  // 5 màu thân robot: clay = vỏ, joint = khớp / tai nghe / hông (đậm hơn cho hợp tông)
  const COLORS = [
    { key: "yellow", name: "Vàng", clay: "#F2C94C", joint: "#3B2F14" },
    { key: "porcelain", name: "Trắng sứ", clay: "#EEEBE6", joint: "#3B3A48" },
    { key: "graphite", name: "Than chì", clay: "#5B5966", joint: "#17161C" },
    { key: "lavender", name: "Tím oải hương", clay: "#B7A6F0", joint: "#2F2754" },
    { key: "mint", name: "Bạc hà", clay: "#98DCC5", joint: "#1F4038" },
  ];
  const COLOR_KEY = "gdk.botColor";
  const savedColor = () => { try { const v = +localStorage.getItem(COLOR_KEY); return v >= 0 && v < COLORS.length ? v : 0; } catch (_) { return 0; } };
  const live = new Set();          // các linh vật đang hiện — đổi màu thì đổi hết
  const BASE = (document.currentScript && document.currentScript.src) || location.href;
  let glOk = null;
  const hasGL = () => {
    if (glOk === null) {
      try {
        const gl = window.WebGL2RenderingContext && document.createElement("canvas").getContext("webgl2");
        glOk = !!gl; const lose = gl && gl.getExtension("WEBGL_lose_context"); if (lose) lose.loseContext();
      } catch (_) { glOk = false; }
    }
    return glOk;
  };

  function svg(id) {
    const g = (a) => a + id;
    // thân ống: 160 × 250 trong khung 240 × 300
    return `<svg class="ms-svg" viewBox="0 0 240 300" aria-hidden="true">
      <defs>
        <linearGradient id="${g("rb")}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#38BDF8"/><stop offset=".25" stop-color="#818CF8"/><stop offset=".5" stop-color="#E879F9"/>
          <stop offset=".72" stop-color="#FB7185"/><stop offset=".88" stop-color="#FBBF24"/><stop offset="1" stop-color="#34D399"/>
        </linearGradient>
        <linearGradient id="${g("glass")}" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#ffffff" stop-opacity=".10"/><stop offset=".35" stop-color="#ffffff" stop-opacity=".02"/>
          <stop offset="1" stop-color="#ffffff" stop-opacity=".08"/>
        </linearGradient>
        <radialGradient id="${g("glow")}" cx=".5" cy=".55" r=".5"><stop offset="0" stop-color="#A78BFA" stop-opacity=".45"/><stop offset="1" stop-color="#A78BFA" stop-opacity="0"/></radialGradient>
        <clipPath id="${g("in")}"><rect x="66" y="66" width="108" height="196" rx="54"/></clipPath>
      </defs>
      <ellipse class="ms-shadow" cx="120" cy="290" rx="58" ry="7" fill="#000" opacity=".45"/>
      <circle cx="120" cy="170" r="125" fill="url(#${g("glow")})" class="ms-aura"/>
      <g class="ms-body">
        <g class="ms-arm ms-arm-l"><path d="M64 178 q-26 4 -30 30" fill="none" stroke="url(#${g("rb")})" stroke-width="7" stroke-linecap="round"/><circle cx="34" cy="210" r="8" fill="#EFEFE5" stroke="#0A090F" stroke-opacity=".25" stroke-width="1.5"/></g>
        <g class="ms-arm ms-arm-r"><path d="M176 178 q26 4 30 30" fill="none" stroke="url(#${g("rb")})" stroke-width="7" stroke-linecap="round"/><circle cx="206" cy="210" r="8" fill="#EFEFE5" stroke="#0A090F" stroke-opacity=".25" stroke-width="1.5"/></g>
        <rect x="58" y="58" width="124" height="212" rx="62" fill="#0E0D14"/>
        <g clip-path="url(#${g("in")})">
          ${LAYERS.map((c, i) => `<rect x="60" y="${262 - (i + 1) * 30}" width="120" height="31" fill="${c}" opacity=".92"/>`).join("")}
          <g class="ms-wave"><path d="M40 112 q15 -9 30 0 t30 0 t30 0 t30 0 t30 0 t30 0 v20 h-180 z" fill="${LAYERS[4]}"/></g>
          <circle class="ms-bub b1" cx="92" cy="250" r="4" fill="#fff" opacity=".55"/>
          <circle class="ms-bub b2" cx="138" cy="250" r="3" fill="#fff" opacity=".5"/>
          <circle class="ms-bub b3" cx="116" cy="250" r="5" fill="#fff" opacity=".4"/>
          <rect x="60" y="60" width="120" height="210" fill="url(#${g("glass")})"/>
        </g>
        <rect x="58" y="58" width="124" height="212" rx="62" fill="none" stroke="url(#${g("rb")})" stroke-width="5"/>
        <path d="M80 92 q-6 30 -4 70" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="5" stroke-linecap="round"/>
        <rect x="74" y="34" width="92" height="30" rx="10" fill="#18171F" stroke="url(#${g("rb")})" stroke-width="4"/>
        <rect x="88" y="26" width="64" height="12" rx="6" fill="#EFEFE5" opacity=".9"/>
        <g class="ms-face">
          <rect x="70" y="104" width="100" height="62" rx="26" fill="#0E0D14" opacity=".82"/>
          <g class="ms-eyes">
            <g class="ms-eye"><rect x="88" y="118" width="20" height="26" rx="10" fill="#EFEFE5"/><circle class="ms-pupil" cx="98" cy="131" r="6" fill="#0A090F"/></g>
            <g class="ms-eye"><rect x="132" y="118" width="20" height="26" rx="10" fill="#EFEFE5"/><circle class="ms-pupil" cx="142" cy="131" r="6" fill="#0A090F"/></g>
          </g>
          <g class="ms-happy" opacity="0"><path d="M88 134 q10 -14 20 0 M132 134 q10 -14 20 0" fill="none" stroke="#EFEFE5" stroke-width="5" stroke-linecap="round"/></g>
          <circle cx="84" cy="152" r="5" fill="#FB7185" opacity=".55"/><circle cx="156" cy="152" r="5" fill="#FB7185" opacity=".55"/>
          <path class="ms-mouth" d="M110 152 q10 8 20 0" fill="none" stroke="#EFEFE5" stroke-width="4" stroke-linecap="round"/>
        </g>
      </g>
    </svg>`;
  }

  window.GDK = window.GDK || {};
  GDK.mascot = (el, opts) => {
    opts = opts || {};
    const id = "m" + (++seq);
    el.classList.add("mascot");
    if (opts.size) el.style.setProperty("--ms-size", opts.size + "px");
    el.innerHTML = svg(id);
    const root = el.querySelector(".ms-svg");
    const pupils = [...el.querySelectorAll(".ms-pupil")];
    const eyes = el.querySelector(".ms-eyes");
    let raf = 0, tx = 0, ty = 0, cx = 0, cy = 0, blinkT = 0, alive = true;

    // mắt nhìn theo chuột (đi tới mượt, tối đa ±5 px)
    const onMove = (e) => {
      const r = root.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height * 0.45);
      const d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 260);
      tx = dx / d * 5 * k; ty = dy / d * 4 * k;
    };
    const loop = () => {
      cx += (tx - cx) * 0.12; cy += (ty - cy) * 0.12;
      pupils.forEach((p) => p.setAttribute("transform", `translate(${cx.toFixed(2)} ${cy.toFixed(2)})`));
      if (alive) raf = requestAnimationFrame(loop);
    };
    // chớp mắt ngẫu nhiên 2,5–6 giây / lần
    const blink = () => {
      if (!alive) return;
      eyes.classList.add("blink");
      setTimeout(() => eyes.classList.remove("blink"), 140);
      blinkT = setTimeout(blink, 2500 + Math.random() * 3500);
    };
    if (!REDUCED) {
      window.addEventListener("pointermove", onMove, { passive: true });
      raf = requestAnimationFrame(loop);
      blinkT = setTimeout(blink, 1800);
    }
    // bấm vào: luân phiên nhảy xoay vòng và nhảy cute (lắc lư, tay cạnh má, mắt trái tim)
    let clicks = 0;
    el.addEventListener("click", () => { clicks++; api.mood(clicks % 2 ? "happy" : "cute", clicks % 2 ? 1200 : 1600); });
    let moodT = 0, three = null, curMood = "";
    const stopSvg = () => { alive = false; cancelAnimationFrame(raf); clearTimeout(blinkT); window.removeEventListener("pointermove", onMove); };
    const api = {
      mood(m, ms) {
        curMood = m || "";
        el.classList.remove("ms-happy-on", "ms-sad-on", "ms-think-on");
        if (m) el.classList.add("ms-" + (m === "cute" ? "happy" : m) + "-on");     // bản 2D: cute = vui
        if (three) three.mood(curMood);
        clearTimeout(moodT);
        if (m && ms) moodT = setTimeout(() => api.mood(""), ms);
      },
      /** Đổi màu thân (0…4); nhớ lựa chọn cho lần sau. */
      color(i) {
        colorIdx = i;
        try { localStorage.setItem(COLOR_KEY, String(i)); } catch (_) { /* bỏ qua */ }
        if (three && three.color) three.color(i);
      },
      destroy() { dead = true; live.delete(api); stopSvg(); clearTimeout(moodT); if (three) three.destroy(); },
    };
    let colorIdx = savedColor();
    live.add(api);
    // nâng cấp lên 3D: tải module sau khi bản SVG đã hiện, xong thì cross-fade
    let dead = false;
    if (!opts.flat && hasGL()) {
      el.classList.add("ms-wait");          // đang tải bản 3D: ẩn bản 2D để không bị "đổi nhân vật" giữa chừng
      import(new URL("mascot3d.js", BASE).href).then((mod) => {
        if (dead) return;
        three = mod.mount(el, { still: REDUCED, palette: COLORS, color: colorIdx });
        if (curMood) three.mood(curMood);
        el.classList.add("is-3d"); stopSvg();
      }).catch((e) => { console.warn("Linh vật 3D không chạy được, dùng bản 2D:", e); })
        .finally(() => el.classList.remove("ms-wait"));
    }
    return api;
  };
  GDK.mascot.COLORS = COLORS;
  GDK.mascot.color = () => savedColor();
  /** Đổi màu mọi linh vật đang hiện trên trang. */
  GDK.mascot.setColor = (i) => { live.forEach((a) => a.color(i)); if (!live.size) { try { localStorage.setItem(COLOR_KEY, String(i)); } catch (_) { /* bỏ qua */ } } };
})();

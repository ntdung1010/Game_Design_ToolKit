/* Level Preview — vẽ 1 level chuẩn (xem levelkit.js) thành SVG. Dùng chung cho mọi game:
   kiểu vật chứa (tube / jar / box / egg / branch) × kiểu vật phẩm (liquid / ball / block / bird) + cơ chế phổ biến
   (băng, nắp, khoá, ống ads, ống sinh, ẩn "?", nhóm khay / rèm / hộp khoá). Cơ chế lạ → nhãn chữ, không bị mất.
   Ảnh là SƠ ĐỒ (không có art của game) — mọi thứ vẽ ra đều lấy từ file level, không bịa thêm. */
(function (root, factory) {
  const LK = typeof module === "object" && module.exports ? require("./levelkit.js") : root.GDK.lib.levelkit;
  const lib = factory(LK);
  if (typeof module === "object" && module.exports) module.exports = lib;
  else root.GDK.lib.levelrender = lib;
})(typeof self !== "undefined" ? self : this, function (LK) {
  "use strict";

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const f1 = (v) => (Math.round(v * 10) / 10).toString();
  const FONT = "Segoe UI, Arial, Helvetica, sans-serif";
  const THEMES = {
    dark: { bg0: "#1A1642", bg1: "#090822", glass: "#4A5C96", glassFill: "#12143A", lip: "#28376E", text: "#F2F2FA", sub: "#9A9CC0",
      pill: "#4E2E8C", hard: "#7828BE", superHard: "#BE1E28", hidden: "#202028", hiddenText: "#9696A5", branch: "#8B5A2B", slot: "rgba(255,255,255,0.10)" },
    light: { bg0: "#F7F5F0", bg1: "#E3DFD4", glass: "#7C8AB8", glassFill: "#FFFFFF", lip: "#C9CFE6", text: "#1C1C28", sub: "#5C5E78",
      pill: "#5B3FA0", hard: "#7828BE", superHard: "#BE1E28", hidden: "#3A3A46", hiddenText: "#D0D0DA", branch: "#8B5A2B", slot: "rgba(0,0,0,0.08)" },
  };
  const DEFAULT_ITEM = { tube: "liquid", jar: "ball", box: "block", egg: "bird", branch: "bird" };

  function lum(hex) {
    const m = /^#?([0-9a-f]{6})/i.exec(hex || "");
    if (!m) return 0.5;
    const n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }
  const inkOn = (hex) => (lum(hex) > 0.6 ? "#1A1A1A" : "#FFFFFF");
  function lighten(hex, k) {
    const m = /^#?([0-9a-f]{6})/i.exec(hex || "");
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    const ch = (s) => Math.min(255, Math.round(((n >> s) & 255) + (255 - ((n >> s) & 255)) * k));
    return "#" + [16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("");
  }
  const text = (x, y, s, size, fill, opt) => {
    opt = opt || {};
    return `<text x="${f1(x)}" y="${f1(y)}" font-size="${f1(size)}" fill="${fill}" text-anchor="${opt.anchor || "middle"}" dominant-baseline="central"${opt.bold === false ? "" : ' font-weight="700"'}${opt.stroke ? ` stroke="${opt.stroke}" stroke-width="${f1(size * 0.14)}" paint-order="stroke"` : ""}${opt.opacity ? ` opacity="${opt.opacity}"` : ""}>${esc(s)}</text>`;
  };
  const pill = (cx, cy, label, size, fill, ink) => {
    const w = Math.max(size * 2.2, String(label).length * size * 0.6 + size * 1.2), h = size * 1.7;
    return `<rect x="${f1(cx - w / 2)}" y="${f1(cy - h / 2)}" width="${f1(w)}" height="${f1(h)}" rx="${f1(h / 2)}" fill="${fill}"/>` + text(cx, cy, label, size, ink || "#FFFFFF");
  };
  const keyGlyph = (cx, cy, r, label) => `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r)}" fill="#FAD23C" stroke="#785000" stroke-width="${f1(r * 0.15)}"/>` +
    `<rect x="${f1(cx + r * 0.7)}" y="${f1(cy - r * 0.22)}" width="${f1(r * 1.3)}" height="${f1(r * 0.44)}" fill="#FAD23C"/>` + text(cx, cy, label, r * 1.15, "#503200");
  const lockGlyph = (cx, cy, s, fill) => `<path d="M${f1(cx - s * 0.5)} ${f1(cy)}v${f1(-s * 0.35)}a${f1(s * 0.5)} ${f1(s * 0.5)} 0 0 1 ${f1(s)} 0v${f1(s * 0.35)}" fill="none" stroke="${fill}" stroke-width="${f1(s * 0.18)}"/>` +
    `<rect x="${f1(cx - s * 0.7)}" y="${f1(cy)}" width="${f1(s * 1.4)}" height="${f1(s * 1.0)}" rx="${f1(s * 0.18)}" fill="${fill}"/>`;

  /**
   * opts = {W, H, theme: "dark" | "light", ids: hiện mã màu trên vật phẩm, thumb: ảnh nhỏ (bỏ chữ phụ),
   *         uid: tiền tố id (bắt buộc khác nhau nếu nhiều SVG nằm chung 1 trang), footer, hud, scale (px thật / px SVG)}
   */
  function toSVG(lv, opts) {
    opts = Object.assign({ W: 540, H: 1170, theme: "dark", ids: false, thumb: false, footer: true, hud: true }, opts || {});
    const W = opts.W, H = opts.H, T = THEMES[opts.theme] || THEMES.dark;
    const uid = opts.uid || "l" + Math.random().toString(36).slice(2, 8);
    const out = [];
    const outW = opts.pxW || W, outH = opts.pxH || H;
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${outW}" height="${outH}" font-family="${FONT}">`);
    out.push(`<defs><linearGradient id="${uid}bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${T.bg0}"/><stop offset="1" stop-color="${T.bg1}"/></linearGradient></defs>`);
    out.push(`<rect width="${W}" height="${H}" fill="url(#${uid}bg)"/>`);
    if (lv.image) { out.push(text(W / 2, H / 2, "ảnh chụp", 24, T.sub)); out.push("</svg>"); return out.join(""); }
    const cmap = LK.colorMap(lv, lv.colorMode);
    const col = (c) => (c == null ? "#888888" : cmap[c] || "#888888");
    const hudH = opts.hud ? H * 0.155 : H * 0.03, footH = opts.footer && !opts.thumb ? H * 0.05 : H * 0.02;
    const board = { x: W * 0.05, y: hudH, w: W * 0.9, h: H - hudH - footH };
    const ids = opts.ids || lv.showIds;
    const st = LK.stats(lv);

    if (lv.grid) drawGrid(lv, board, out, col, T, ids);
    else drawContainers(lv, board, out, col, T, ids, uid, opts);
    if (opts.hud) drawHud(lv, W, H, out, col, T, opts, hudH);
    if (opts.footer && !opts.thumb) {
      const parts = [lv.name || "", st.kind === "grid" ? `lưới ${st.w}×${st.h}` : `${st.containers} vật chứa`, `${st.colors} màu`];
      if (st.hidden) parts.push(`${st.hidden} ẩn`);
      parts.push("sơ đồ · GD Toolkit");
      out.push(text(W / 2, H - footH / 2, parts.filter(Boolean).join("  ·  "), Math.min(13, W / 42), T.sub, { bold: false }));
    }
    out.push("</svg>");
    return out.join("");
  }

  // ---------------------------------------------------------------- HUD
  function drawHud(lv, W, H, out, col, T, opts, hudH) {
    const tags = lv.tags || [];
    const isSuper = tags.some((t) => /super/i.test(t)), isHard = !isSuper && tags.some((t) => /hard|khó/i.test(t));
    const fs = W / 19;
    const lab = "Level " + (lv.level != null ? lv.level : "?");
    const pw = Math.max(W * 0.36, lab.length * fs * 0.62 + fs * 1.6), ph = fs * 1.75, py = H * 0.045;
    out.push(`<rect x="${f1(W / 2 - pw / 2)}" y="${f1(py - ph / 2)}" width="${f1(pw)}" height="${f1(ph)}" rx="${f1(ph / 2)}" fill="${isSuper ? T.superHard : isHard ? T.hard : T.pill}" stroke="rgba(255,255,255,0.35)" stroke-width="2"/>`);
    out.push(text(W / 2, py, lab, fs, "#FFFFFF"));
    let ty = py + ph * 0.95;
    if (tags.length) {
      const t = tags.join(" · ").toUpperCase();
      out.push(text(W / 2, ty, t, fs * 0.6, isSuper ? "#FF8A8A" : isHard ? "#E3B8FF" : T.sub, { stroke: "rgba(0,0,0,0.35)" }));
      ty += fs * 0.85;
    }
    const lim = lv.limits || {};
    const chips = [];
    if (lim.moves) chips.push(lim.moves + " lượt");
    if (lim.time) chips.push(lim.time + " giây");
    chips.forEach((c, i) => out.push(pill(W - W * 0.12, H * 0.035 + i * fs * 1.15, c, fs * 0.5, "rgba(255,255,255,0.14)", T.text)));
    const orders = lv.orders || [];
    if (orders.length) {
      const r = Math.min(W * 0.022, (W * 0.86) / Math.min(orders.length, 24) / 2.5), gap = r * 2.5;
      const shown = orders.slice(0, Math.floor((W * 0.86) / gap));
      const y = Math.max(ty + r * 1.4, hudH - r * 2.6);
      const x0 = W / 2 - (shown.length - 1) * gap / 2;
      shown.forEach((c, i) => out.push(`<circle cx="${f1(x0 + i * gap)}" cy="${f1(y)}" r="${f1(i < 2 ? r * 1.25 : r)}" fill="${col(c)}" stroke="#FFFFFF" stroke-width="${i < 2 ? 2.5 : 1.2}"/>`));
      if (!opts.thumb) out.push(text(W / 2, y + r * 2.2, `${lv.ordersLabel || "đơn"}: ${orders.length}${shown.length < orders.length ? " (hiện " + shown.length + ")" : ""}`, W / 44, T.sub, { bold: false }));
    }
  }

  // ---------------------------------------------------------------- lưới (match / blast)
  function drawGrid(lv, box, out, col, T, ids) {
    const g = lv.grid, s = Math.min(box.w / g.w, box.h / g.h);
    const x0 = box.x + (box.w - s * g.w) / 2, y0 = box.y + (box.h - s * g.h) / 2;
    out.push(`<rect x="${f1(x0 - 6)}" y="${f1(y0 - 6)}" width="${f1(s * g.w + 12)}" height="${f1(s * g.h + 12)}" rx="12" fill="rgba(0,0,0,0.25)"/>`);
    g.cells.forEach((row, r) => row.forEach((cell, c) => {
      const x = x0 + c * s, y = y0 + r * s;
      if (!cell) { out.push(`<rect x="${f1(x + 2)}" y="${f1(y + 2)}" width="${f1(s - 4)}" height="${f1(s - 4)}" rx="${f1(s * 0.16)}" fill="${T.slot}"/>`); return; }
      if (cell.block) { out.push(`<rect x="${f1(x + 2)}" y="${f1(y + 2)}" width="${f1(s - 4)}" height="${f1(s - 4)}" rx="${f1(s * 0.12)}" fill="#55575F" stroke="#2A2B30" stroke-width="2"/>`); }
      else if (cell.c != null) {
        const fill = col(cell.c);
        out.push(`<rect x="${f1(x + 2)}" y="${f1(y + 2)}" width="${f1(s - 4)}" height="${f1(s - 4)}" rx="${f1(s * 0.2)}" fill="${fill}"/>`);
        if (ids) out.push(text(x + s / 2, y + s / 2, cell.c, s * 0.34, inkOn(fill)));
      }
      const lab = cell.label || (cell.n > 1 ? "×" + cell.n : "");
      if (lab) out.push(text(x + s * 0.72, y + s * 0.78, lab, s * 0.26, "#FFFFFF", { stroke: "#000" }));
    }));
  }

  // ---------------------------------------------------------------- vật chứa
  function drawContainers(lv, box, out, col, T, ids, uid, opts) {
    const cs = lv.containers || [];
    const pos = LK.layout(lv, box, { edge: true });
    const style = lv.style.container || "tube";
    const itemStyle = lv.style.item || DEFAULT_ITEM[style] || "liquid";
    const groups = lv.groups || [];
    const gbox = (g, pad) => {
      const ps = g.members.map((i) => pos[i]).filter(Boolean);
      if (!ps.length) return null;
      return [Math.min(...ps.map((p) => p.cx - p.w / 2)) - pad, Math.min(...ps.map((p) => p.cy - p.h / 2)) - pad,
        Math.max(...ps.map((p) => p.cx + p.w / 2)) + pad, Math.max(...ps.map((p) => p.cy + p.h / 2)) + pad];
    };
    const u = Math.min(...pos.map((p) => Math.min(p.w, p.h))) || 20;   // đơn vị cỡ chữ / nét theo vật chứa nhỏ nhất
    // khay gỗ (vẽ dưới vật chứa)
    for (const g of groups.filter((x) => x.type === "tray")) {
      const b = gbox(g, u * 0.18);
      if (!b) continue;
      out.push(`<rect x="${f1(b[0])}" y="${f1(b[1])}" width="${f1(b[2] - b[0])}" height="${f1(b[3] - b[1])}" rx="${f1(u * 0.25)}" fill="rgba(200,140,80,0.12)" stroke="rgba(230,150,70,0.7)" stroke-width="2"/>`);
      out.push(`<rect x="${f1(b[0])}" y="${f1(b[3] - u * 0.32)}" width="${f1(b[2] - b[0])}" height="${f1(u * 0.42)}" rx="${f1(u * 0.12)}" fill="#B06028" stroke="#E69646" stroke-width="2"/>`);
      if (!opts.thumb) out.push(text((b[0] + b[2]) / 2, b[3] - u * 0.11, g.label || `khay ×${g.members.length}`, u * 0.2, "#FFEBC8"));
    }
    cs.forEach((c, i) => {
      const p = pos[i];
      out.push(`<g>${opts.thumb ? "" : `<title>${esc(tip(c, i))}</title>`}`);
      drawOne(c, p, style, c.item || itemStyle, out, col, T, ids, `${uid}c${i}`, u, opts);
      out.push("</g>");
    });
    // rèm, hộp khoá, nhóm khác (vẽ đè, trong suốt để vẫn thấy bên trong)
    for (const g of groups.filter((x) => x.type !== "tray")) {
      const b = gbox(g, u * 0.22);
      if (!b) continue;
      const w = b[2] - b[0], h = b[3] - b[1], cx = (b[0] + b[2]) / 2;
      if (g.type === "curtain") {
        out.push(`<rect x="${f1(b[0])}" y="${f1(b[1])}" width="${f1(w)}" height="${f1(h)}" rx="${f1(u * 0.3)}" fill="rgba(175,40,160,0.45)" stroke="#FAC83C" stroke-width="3"/>`);
        out.push(`<rect x="${f1(b[0])}" y="${f1(b[1])}" width="${f1(w)}" height="${f1(u * 0.14)}" fill="#FAC83C"/>`);
      } else if (g.type === "lockbox") {
        out.push(`<rect x="${f1(b[0])}" y="${f1(b[1])}" width="${f1(w)}" height="${f1(h)}" rx="${f1(u * 0.35)}" fill="rgba(40,90,200,0.42)" stroke="#FFBE28" stroke-width="3"/>`);
        out.push(lockGlyph(cx, (b[1] + b[3]) / 2 - u * 0.2, u * 0.32, "#FFBE28"));
      } else {
        out.push(`<rect x="${f1(b[0])}" y="${f1(b[1])}" width="${f1(w)}" height="${f1(h)}" rx="${f1(u * 0.3)}" fill="rgba(118,210,219,0.10)" stroke="#76D2DB" stroke-width="2" stroke-dasharray="8 6"/>`);
      }
      if (!opts.thumb) out.push(pill(cx, b[3] - u * 0.18, g.label || `${g.type} ×${g.members.length}`, u * 0.18, "rgba(0,0,0,0.55)", "#FFFFFF"));
    }
  }

  function tip(c, i) {
    const items = c.items.map((it) => (it.hidden ? "?" : it.c) + (it.key != null ? "🔑" : "") + (it.label ? "(" + it.label + ")" : "")).join(", ");
    const marks = (c.marks || []).map((m) => m.type + (m.n != null ? " " + m.n : "") + (m.label ? " " + m.label : "")).join(", ");
    return `#${i + 1} · ${c.items.length}/${c.capacity}${c.label ? " · " + c.label : ""}\n${items ? "dưới→trên: " + items : "trống"}${marks ? "\ncơ chế: " + marks : ""}`;
  }

  function drawOne(c, p, style, itemStyle, out, col, T, ids, cid, u, opts) {
    const marks = c.marks || [];
    const has = (t) => marks.find((m) => m.type === t);
    const ads = has("ads");
    const x0 = p.cx - p.w / 2, y0 = p.cy - p.h / 2;
    let inner;                                      // vùng vẽ vật phẩm {x, y, w, h}
    if (style === "branch" || p.dir === "right" || p.dir === "left") {
      // cành: thanh gỗ ở dưới, gốc sát mép màn hình
      const barH = Math.max(3, p.h * 0.16), by = y0 + p.h - barH;
      out.push(`<rect x="${f1(x0)}" y="${f1(by)}" width="${f1(p.w)}" height="${f1(barH)}" rx="${f1(barH / 2)}" fill="${T.branch}"/>`);
      inner = { x: x0 + p.w * 0.04, y: y0, w: p.w * 0.92, h: p.h - barH };
      drawItemsRow(c, inner, p.dir === "left", itemStyle, out, col, T, ids, u);
    } else if (style === "egg") {
      const rx = p.w / 2, ry = p.h / 2;
      out.push(`<ellipse cx="${f1(p.cx)}" cy="${f1(p.cy)}" rx="${f1(rx)}" ry="${f1(ry)}" fill="#F4EEDC" fill-opacity="0.16" stroke="#F4EEDC" stroke-opacity="0.75" stroke-width="2"/>`);
      drawCluster(c, p, itemStyle, out, col, T, ids);
    } else {
      const rx = style === "box" ? p.w * 0.08 : style === "jar" ? p.w * 0.2 : p.w * 0.34;
      const lipH = style === "box" ? 0 : Math.max(3, p.w * 0.12);
      out.push(`<rect x="${f1(x0)}" y="${f1(y0 + lipH * 0.6)}" width="${f1(p.w)}" height="${f1(p.h - lipH * 0.6)}" rx="${f1(rx)}" fill="${ads ? "#0E1030" : T.glassFill}" fill-opacity="0.85" stroke="${T.glass}" stroke-width="${f1(Math.max(1.5, p.w * 0.035))}"/>`);
      if (lipH) out.push(`<rect x="${f1(p.cx - p.w * 0.38)}" y="${f1(y0)}" width="${f1(p.w * 0.76)}" height="${f1(lipH)}" rx="${f1(lipH * 0.4)}" fill="${T.lip}" stroke="${T.glass}" stroke-width="1.5"/>`);
      const ins = Math.max(2, p.w * 0.09);
      inner = { x: x0 + ins, y: y0 + lipH + ins * 0.6, w: p.w - ins * 2, h: p.h - lipH - ins * 1.6 };
      if (!ads) {
        out.push(`<clipPath id="${cid}"><rect x="${f1(inner.x)}" y="${f1(inner.y)}" width="${f1(inner.w)}" height="${f1(inner.h)}" rx="${f1(Math.max(0, rx - ins))}"/></clipPath>`);
        drawItemsColumn(c, inner, itemStyle, out, col, T, ids, cid);
      }
    }
    // ---- cơ chế trên vật chứa
    const bx = { x: x0, y: y0, w: p.w, h: p.h };
    const big = Math.min(p.w, p.h) * 0.5;
    let badgeY = y0 - u * 0.14;
    for (const m of marks) {
      switch (m.type) {
        case "ads": {
          const s = Math.min(p.w, p.h) * 0.3;
          out.push(`<rect x="${f1(p.cx - s)}" y="${f1(p.cy - s)}" width="${f1(s * 2)}" height="${f1(s * 2)}" rx="${f1(s * 0.3)}" fill="#EBE6DC"/>`);
          out.push(`<path d="M${f1(p.cx - s * 0.35)} ${f1(p.cy - s * 0.5)}L${f1(p.cx + s * 0.55)} ${f1(p.cy)}L${f1(p.cx - s * 0.35)} ${f1(p.cy + s * 0.5)}Z" fill="#1E1E28"/>`);
          break;
        }
        case "ice": case "frozen":
          out.push(`<rect x="${f1(bx.x)}" y="${f1(bx.y)}" width="${f1(bx.w)}" height="${f1(bx.h)}" rx="${f1(Math.min(bx.w, bx.h) * 0.3)}" fill="rgba(170,225,255,0.62)" stroke="#E6FAFF" stroke-width="2"/>`);
          if (m.n != null) out.push(text(p.cx, p.cy, m.n, big * 0.9, "#FFFFFF", { stroke: "#3C78C8" }));
          break;
        case "cover":
          out.push(`<rect x="${f1(bx.x)}" y="${f1(bx.y)}" width="${f1(bx.w)}" height="${f1(bx.h)}" rx="${f1(Math.min(bx.w, bx.h) * 0.3)}" fill="rgba(90,96,120,0.82)" stroke="#C8C8D7" stroke-width="2"/>`);
          if (m.n != null) out.push(text(p.cx, p.cy + big * 0.15, m.n, big * 0.8, "#FFFFFF", { stroke: "#28283C" }));
          if (m.c != null) out.push(`<circle cx="${f1(p.cx)}" cy="${f1(p.cy - big * 0.75)}" r="${f1(big * 0.28)}" fill="${col(m.c)}" stroke="#FFFFFF" stroke-width="2"/>`);
          break;
        case "hidden":
          out.push(`<rect x="${f1(bx.x)}" y="${f1(bx.y)}" width="${f1(bx.w)}" height="${f1(bx.h)}" rx="${f1(Math.min(bx.w, bx.h) * 0.3)}" fill="rgba(20,20,28,0.78)"/>`);
          out.push(text(p.cx, p.cy, "?", big, T.hiddenText));
          break;
        case "seal":
          out.push(`<rect x="${f1(bx.x)}" y="${f1(p.cy - big * 0.25)}" width="${f1(bx.w)}" height="${f1(big * 0.5)}" fill="rgba(200,60,60,0.9)"/>`);
          out.push(text(p.cx, p.cy, m.label || "SEAL", big * 0.3, "#FFFFFF"));
          break;
        case "lock":
          out.push(lockGlyph(p.cx, y0 - u * 0.3, u * 0.22, "#FFBE28"));
          if (m.label && !opts.thumb) out.push(text(p.cx, y0 - u * 0.62, m.label, u * 0.16, "#FFE6A0"));
          badgeY -= u * 0.5;
          break;
        case "spawn": {
          const items = m.items || [];
          const ph = Math.max(10, u * 0.3), py = y0 + p.h + ph * 0.75;
          out.push(`<rect x="${f1(p.cx - p.w * 0.55)}" y="${f1(py - ph / 2)}" width="${f1(p.w * 1.1)}" height="${f1(ph)}" rx="${f1(ph * 0.3)}" fill="#963CAA" stroke="#FAC83C" stroke-width="2"/>`);
          out.push(text(p.cx - p.w * 0.3, py, items.length || m.n || "", ph * 0.62, "#FFFFFF"));
          const r = ph * 0.2;
          items.slice(0, 4).forEach((ci, k) => out.push(`<circle cx="${f1(p.cx + k * r * 2.4 - r)}" cy="${f1(py)}" r="${f1(r)}" fill="${col(ci)}" stroke="#FFFFFF" stroke-width="1"/>`));
          break;
        }
        case "help":
          out.push(text(p.cx + p.w * 0.25, p.cy + p.h * 0.3, m.label || "HELP!", big * 0.4, "#FF503C", { stroke: "#FFFFFF" }));
          break;
        default:
          if (!opts.thumb || marks.length <= 2) {
            out.push(pill(p.cx, badgeY, m.label || (m.type + (m.n != null ? " " + m.n : "")), Math.max(8, u * 0.15), "rgba(0,0,0,0.6)", "#FFFFFF"));
            badgeY -= u * 0.3;
          }
      }
    }
    if (c.label && !opts.thumb) out.push(text(p.cx, y0 + p.h + u * 0.18, c.label, u * 0.15, T.sub, { bold: false }));
  }

  /** Vật phẩm xếp dọc trong ống / lọ / hộp (dưới → trên). */
  function drawItemsColumn(c, a, itemStyle, out, col, T, ids, cid) {
    const n = Math.max(1, c.capacity);
    const segH = a.h / n;
    const g = [`<g clip-path="url(#${cid})">`];
    c.items.forEach((it, i) => {
      const y1 = a.y + a.h - i * segH, y0 = y1 - segH;
      const cy = (y0 + y1) / 2;
      const fill = it.hidden ? T.hidden : col(it.c);
      if (itemStyle === "liquid") {
        g.push(`<rect x="${f1(a.x)}" y="${f1(y0)}" width="${f1(a.w)}" height="${f1(segH + 0.6)}" fill="${fill}"/>`);
        if (!it.hidden) g.push(`<rect x="${f1(a.x)}" y="${f1(y0)}" width="${f1(a.w)}" height="${f1(Math.max(1.5, segH * 0.15))}" fill="${lighten(fill, 0.25)}"/>`);
      } else if (itemStyle === "ball") {
        const r = Math.min(a.w, segH) * 0.46;
        g.push(`<circle cx="${f1(a.x + a.w / 2)}" cy="${f1(cy)}" r="${f1(r)}" fill="${fill}"/><circle cx="${f1(a.x + a.w / 2 - r * 0.35)}" cy="${f1(cy - r * 0.35)}" r="${f1(r * 0.25)}" fill="#FFFFFF" fill-opacity="${it.hidden ? 0 : 0.35}"/>`);
      } else if (itemStyle === "bird") {
        g.push(bird(a.x + a.w / 2, cy, Math.min(a.w, segH) * 0.44, fill, it.hidden, T));
      } else {
        const s = Math.min(a.w, segH) * 0.9;
        g.push(`<rect x="${f1(a.x + a.w / 2 - s / 2)}" y="${f1(cy - s / 2)}" width="${f1(s)}" height="${f1(s)}" rx="${f1(s * 0.18)}" fill="${fill}"/>`);
      }
      g.push(itemDecor(it, a.x + a.w / 2, cy, Math.min(a.w, segH), fill, ids, T));
    });
    g.push("</g>");
    out.push(g.join(""));
  }

  /** Vật phẩm xếp ngang trên cành (index 0 sát gốc). fromRight = gốc ở bên phải. */
  function drawItemsRow(c, a, fromRight, itemStyle, out, col, T, ids) {
    const n = Math.max(1, c.capacity), step = a.w / n;
    const r = Math.min(step * 0.42, a.h * 0.48);
    for (let i = 0; i < n; i++) {
      const cx = fromRight ? a.x + a.w - (i + 0.5) * step : a.x + (i + 0.5) * step, cy = a.y + a.h - r * 1.02;
      const it = c.items[i];
      if (!it) { out.push(`<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r * 0.35)}" fill="${T.slot}"/>`); continue; }
      const fill = it.hidden ? T.hidden : col(it.c);
      out.push(itemStyle === "bird" ? bird(cx, cy, r, fill, it.hidden, T, fromRight) : `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r)}" fill="${fill}"/>`);
      out.push(itemDecor(it, cx, cy, r * 2, fill, ids, T));
    }
  }

  /** Vật phẩm gom trong trứng / tổ (2: ngang · 3: tam giác · 4: vuông · 5: giữa + vuông). */
  const CLUSTER = {
    1: [[0, 0]], 2: [[-0.5, 0], [0.5, 0]], 3: [[0, -0.55], [-0.48, 0.32], [0.48, 0.32]],
    4: [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]], 5: [[0, 0], [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]],
  };
  function drawCluster(c, p, itemStyle, out, col, T, ids) {
    const n = Math.max(1, Math.min(c.capacity, 9));
    const spots = CLUSTER[n] || Array.from({ length: n }, (_, i) => [0.55 * Math.cos(i / n * 2 * Math.PI), 0.55 * Math.sin(i / n * 2 * Math.PI)]);
    const R = Math.min(p.w, p.h) / 2;
    const r = R * (n === 1 ? 0.55 : n === 2 ? 0.42 : n <= 4 ? 0.36 : 0.3);
    spots.forEach(([dx, dy], i) => {
      const it = c.items[i], cx = p.cx + dx * R * 0.92, cy = p.cy + dy * R * 0.92;
      if (!it) { out.push(`<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r * 0.3)}" fill="${T.slot}"/>`); return; }
      const fill = it.hidden ? T.hidden : col(it.c);
      out.push(itemStyle === "bird" ? bird(cx, cy, r, fill, it.hidden, T) : `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r)}" fill="${fill}"/>`);
      out.push(itemDecor(it, cx, cy, r * 2, fill, ids, T));
    });
    if (c.items.length > n) out.push(text(p.cx, p.cy + R * 0.82, "+" + (c.items.length - n), R * 0.3, "#FFFFFF", { stroke: "#000" }));
  }

  function bird(cx, cy, r, fill, hidden, T, faceLeft) {
    if (hidden) return `<ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="${f1(r * 0.82)}" ry="${f1(r)}" fill="#F1EBDC" stroke="#B8AE96" stroke-width="1.5"/>` + text(cx, cy, "?", r * 1.0, "#6A6250");
    const s = faceLeft ? -1 : 1;
    return `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r)}" fill="${fill}"/>` +
      `<path d="M${f1(cx + s * r * 0.85)} ${f1(cy - r * 0.15)}l${f1(s * r * 0.45)} ${f1(r * 0.18)}l${f1(-s * r * 0.45)} ${f1(r * 0.18)}Z" fill="#F5A623"/>` +
      `<circle cx="${f1(cx + s * r * 0.38)}" cy="${f1(cy - r * 0.3)}" r="${f1(r * 0.2)}" fill="#FFFFFF"/><circle cx="${f1(cx + s * r * 0.43)}" cy="${f1(cy - r * 0.3)}" r="${f1(r * 0.1)}" fill="#111111"/>`;
  }

  function itemDecor(it, cx, cy, size, fill, ids, T) {
    let s = "";
    if (it.hidden) s += text(cx, cy, "?", size * 0.5, T.hiddenText);
    else if (ids && it.c != null) s += text(cx, cy, it.c, size * 0.32, inkOn(fill), { stroke: lum(fill) > 0.6 ? null : "rgba(0,0,0,0.35)" });
    if (it.key != null) s += keyGlyph(cx + size * 0.28, cy, size * 0.14, it.key === true ? "" : it.key);
    if (it.label) s += text(cx, cy + size * 0.3, it.label, size * 0.26, "#FFFFFF", { stroke: "#000000" });
    return s;
  }

  return { toSVG, THEMES };
});

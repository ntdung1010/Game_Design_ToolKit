/* Ảnh minh hoạ cho từng tool (SVG, tự đổi màu theo theme sáng/tối qua biến CSS).
   Dùng ở thẻ tool trang chủ và khung "Ví dụ" góc phải trang tool. */
(() => {
  "use strict";
  const W = 320, H = 180;
  const frame = (inner) => `<svg class="illus" viewBox="0 0 ${W} ${H}" role="img" aria-hidden="true">
    <rect class="il-bg" x="0" y="0" width="${W}" height="${H}" rx="14"/>${inner}</svg>`;
  const tag = (x, y, text, cls = "") => {
    const w = text.length * 6.2 + 12;
    return `<g class="il-tag ${cls}"><rect x="${x - w / 2}" y="${y - 9}" width="${w}" height="18" rx="9"/><text x="${x}" y="${y + 3.5}" text-anchor="middle">${text}</text></g>`;
  };

  const ART = {
    "level-funnel": () => {
      // đường giữ chân giảm dần + cột rời bỏ, 3 cột đỏ là "tường"
      const n = 28, x0 = 26, x1 = 300, yTop = 30, yBot = 108;
      const walls = { 9: 1, 14: 1, 17: 1 };
      let surv = 1, pts = [], bars = "";
      for (let i = 0; i < n; i++) {
        const drop = walls[i] ? 0.09 : i < 3 ? 0.05 : 0.018;
        const x = x0 + (x1 - x0) * i / (n - 1);
        pts.push([x, yBot - (yBot - yTop) * surv]);
        const h = drop * 300;
        bars += `<rect class="${walls[i] ? "il-bad" : "il-faint"}" x="${x - 3}" y="${166 - h}" width="6" height="${h}" rx="2"/>`;
        surv *= 1 - drop;
      }
      const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join("");
      const dots = Object.keys(walls).map((i) => `<circle class="il-bad il-ring" cx="${pts[i][0]}" cy="${pts[i][1]}" r="4.5"/>`).join("");
      return frame(`<line class="il-grid" x1="20" x2="306" y1="${yBot + 6}" y2="${yBot + 6}"/>
        <path class="il-line" d="${line}"/>${dots}${bars}
        ${tag(pts[9][0], pts[9][1] - 17, "L24", "bad")}${tag(pts[17][0] + 10, pts[17][1] - 17, "L32", "bad")}
        <text class="il-cap" x="22" y="22">giữ chân</text><text class="il-cap" x="22" y="128">rời bỏ / level</text>`);
    },
    "ab-readout": () => {
      const zero = 168;
      const row = (y, label, lo, hi, est, cls) => `<text class="il-lbl" x="24" y="${y + 4}">${label}</text>
        <line class="il-ci ${cls}" x1="${lo}" x2="${hi}" y1="${y}" y2="${y}"/>
        <line class="il-ci ${cls}" x1="${lo}" x2="${lo}" y1="${y - 6}" y2="${y + 6}"/><line class="il-ci ${cls}" x1="${hi}" x2="${hi}" y1="${y - 6}" y2="${y + 6}"/>
        <circle class="il-dot ${cls} il-ring" cx="${est}" cy="${y}" r="6"/>`;
      return frame(`<line class="il-zero" x1="${zero}" x2="${zero}" y1="44" y2="160"/>
        <text class="il-cap" x="${zero}" y="172" text-anchor="middle">0%</text>
        ${row(66, "D1", 190, 250, 220, "ok")}${row(100, "D7", 138, 214, 176, "mid")}${row(134, "ARPU", 148, 232, 190, "mid")}
        ${tag(250, 24, "B THẮNG", "ok")}`);
    },
    "config-diff": () => {
      const panel = (x, title, lines) => `<rect class="il-card" x="${x}" y="22" width="132" height="128" rx="9"/>
        <text class="il-cap" x="${x + 10}" y="38">${title}</text>
        ${lines.map(([w, cls], i) => `<rect class="il-code ${cls}" x="${x + 10 + (cls === "ind" ? 10 : 0)}" y="${50 + i * 15}" width="${w}" height="8" rx="4"/>`).join("")}`;
      return frame(`${panel(20, "đang live", [[60, ""], [90, "ind"], [70, "del"], [50, "ind"], [84, ""], [40, ""]])}
        ${panel(168, "bản mới", [[60, ""], [90, "ind"], [78, "add"], [50, "ind"], [84, "chg"], [40, ""]])}
        <path class="il-arrow" d="M152 86h12m-5-5 5 5-5 5"/>
        ${tag(232, 164, "⚠ IceTube → IceTubes", "bad")}`);
    },
    "data-lint": () => {
      let g = "";
      const cols = [26, 92, 150, 208, 262], rows = 6;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols.length; c++) {
          const x = cols[c], y = 34 + r * 20;
          if (r === 0) { g += `<rect class="il-head" x="${x}" y="${y}" width="${c === 0 ? 52 : 44}" height="9" rx="4"/>`; continue; }
          if (c === 3) { g += `<text class="il-zero-t" x="${x + 20}" y="${y + 8}" text-anchor="middle">0</text>`; continue; }
          g += `<rect class="${r === rows - 1 ? "il-faint" : "il-cell"}" x="${x}" y="${y}" width="${c === 0 ? 52 - (r % 3) * 8 : 36 - (r * c) % 10}" height="8" rx="4"/>`;
        }
      }
      return frame(`<rect class="il-warnband" x="200" y="26" width="56" height="128" rx="8"/>${g}
        ${tag(228, 164, "luôn = 0", "bad")}${tag(70, 164, "ngày cuối 20%", "warn")}`);
    },
    "curve-planner": () => {
      const bands = [[30, 50, "il-b4"], [50, 80, "il-b3"], [80, 112, "il-b2"], [112, 150, "il-b1"]];
      let target = "", actual = "", boss = "";
      const n = 40, x0 = 22, x1 = 300;
      const cyc = [-8, -5, -2, 0, 3, -4, 0, 4, 8, 0];
      for (let i = 0; i < n; i++) {
        const x = x0 + (x1 - x0) * i / (n - 1);
        let s = 12 + 52 * (1 - Math.pow(1 - i / (n - 1), 1.8)) + cyc[i % 10];
        if (i % 10 === 9) s += 20;
        const y = 150 - s * 1.2;
        target += (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
        const a = i >= 22 && i <= 27 ? s + 16 : s + Math.sin(i * 1.7) * 3;
        actual += (i ? "L" : "M") + x.toFixed(1) + " " + (150 - a * 1.2).toFixed(1);
        if (i % 10 === 9) boss += `<circle class="il-bad il-ring" cx="${x}" cy="${y}" r="4"/>`;
      }
      return frame(`${bands.map(([a, b, c]) => `<rect class="${c}" x="16" y="${a}" width="290" height="${b - a}" rx="${a === 30 ? 6 : 0}"/>`).join("")}
        <path class="il-line2" d="${actual}"/><path class="il-line" d="${target}"/>${boss}
        ${tag(215, 22, "chuỗi khó dài", "warn")}<text class="il-cap" x="22" y="170">dễ → khó · boss mỗi 10 level</text>`);
    },
    "preflight": () => {
      const item = (y, ok, w) => `<rect class="${ok ? "il-okbox" : "il-badbox"}" x="74" y="${y - 7}" width="14" height="14" rx="4"/>
        ${ok ? `<path class="il-check" d="M77.5 ${y}l2.5 2.5 4.5-5"/>` : `<circle class="il-bad" cx="81" cy="${y}" r="2.5"/>`}
        <rect class="${ok ? "il-cell" : "il-faint"}" x="96" y="${y - 4}" width="${w}" height="8" rx="4"/>`;
      return frame(`<rect class="il-card" x="58" y="16" width="204" height="148" rx="10"/>
        <rect class="il-head" x="74" y="30" width="96" height="10" rx="5"/>
        ${item(62, 1, 120)}${item(86, 1, 96)}${item(110, 0, 132)}${item(134, 1, 84)}
        ${tag(238, 152, "Copy", "acc")}${tag(64, 24, "3/4", "warn")}`);
    },
    "secure-share": () => {
      const doc = (x, label, cls) => `<rect class="il-card" x="${x}" y="34" width="78" height="96" rx="9"/>
        <rect class="il-cell" x="${x + 12}" y="52" width="46" height="7" rx="3.5"/><rect class="il-cell" x="${x + 12}" y="66" width="54" height="7" rx="3.5"/>
        <rect class="il-cell" x="${x + 12}" y="80" width="38" height="7" rx="3.5"/><text class="il-file ${cls}" x="${x + 39}" y="120" text-anchor="middle">${label}</text>`;
      return frame(`${doc(22, "doanh_thu.xlsx", "")}
        <path class="il-arrow" d="M110 82h30m-6-6 6 6-6 6"/>
        <rect class="il-folder" x="146" y="56" width="40" height="34" rx="7"/><path class="il-arrow" d="M155 56v-8a11 11 0 0 1 22 0v8"/>
        <circle class="il-bad" cx="166" cy="72" r="4"/>
        <path class="il-arrow" d="M192 82h30m-6-6 6 6-6 6"/>
        ${doc(226, ".gdk.html", "acc")}
        ${tag(166, 152, "AES-256 · mật khẩu", "ok")}`);
    },
    "level-preview": () => {
      // 4 thẻ level nhỏ, mỗi thẻ vài ống màu; thẻ thứ 3 có cảnh báo, thẻ cuối là bản B khác bản A
      const COLS = ["#DF2219", "#F8C827", "#3232F9", "#6ACA1A", "#8804D4", "#FB671A", "#F87EDD", "#42A6FD"];
      let seed = 5;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const card = (x, n, cls, tubes) => {
        let g = `<rect class="il-card" x="${x}" y="22" width="64" height="118" rx="8"/>`;
        g += `<rect class="il-head" x="${x + 16}" y="30" width="32" height="8" rx="4"/>`;
        for (let t = 0; t < tubes; t++) {
          const tx = x + 9 + (t % 3) * 17, ty = 48 + Math.floor(t / 3) * 44;
          g += `<rect x="${tx}" y="${ty}" width="12" height="38" rx="5" fill="none" stroke="currentColor" opacity=".35"/>`;
          const fill = t >= tubes - 1 ? 1 : 4;
          for (let k = 0; k < fill; k++) g += `<rect x="${tx + 2}" y="${ty + 28 - k * 8.5}" width="8" height="7.5" rx="${k === 0 ? 3 : 1}" fill="${COLS[Math.floor(rnd() * COLS.length)]}"/>`;
        }
        return g + `<text class="il-cap" x="${x + 32}" y="152" text-anchor="middle">L${n}</text>` + (cls ? `<rect x="${x - 2}" y="20" width="68" height="122" rx="9" style="fill:none;stroke:var(--warn);stroke-width:2"/>` : "");
      };
      return frame(`${card(14, 5, "", 5)}${card(90, 6, "", 6)}${card(166, 7, "warn", 5)}${card(242, 8, "", 6)}
        ${tag(198, 14, "L7: màu thiếu", "warn")}${tag(262, 166, "A ↔ B: 3 khác", "acc")}${tag(60, 166, "PNG · ảnh ghép", "ok")}`);
    },
    "level-stuck": () => {
      // 1 level: 5 ống → cây tìm kiếm 2 nhánh: nhánh trên thắng (OK), nhánh dưới cụt (KẸT)
      const COLS = ["#DF2219", "#F8C827", "#3232F9", "#6ACA1A"];
      const tubes = [[0, 1, 2, 0], [1, 2, 0, 1], [2, 0, 1, 2], [], []];
      let g = `<rect class="il-card" x="14" y="30" width="104" height="104" rx="9"/>`;
      tubes.forEach((t, i) => {
        const tx = 22 + i * 19, ty = 52;
        g += `<rect x="${tx}" y="${ty}" width="14" height="62" rx="6" fill="none" stroke="currentColor" opacity=".35"/>`;
        t.forEach((c, k) => { g += `<rect x="${tx + 2}" y="${ty + 47 - k * 14}" width="10" height="12.5" rx="${k === 0 ? 4 : 1}" fill="${COLS[c]}"/>`; });
      });
      const node = (x, y) => `<circle class="il-card" cx="${x}" cy="${y}" r="7"/>`;
      g += `<path class="il-arrow" d="M124 82h22"/>${node(154, 82)}
        <path class="il-arrow" d="M160 78l26-26M160 86l26 26M200 48h24M200 116h24"/>${node(193, 48)}${node(193, 116)}
        ${node(232, 48)}${node(232, 116)}`;
      return frame(`${g}${tag(268, 48, "OK ✓", "ok")}${tag(281, 116, "KẸT chắc", "warn")}${tag(66, 156, "CDS · BSHP · .md", "acc")}`);
    },
    "drive-clone": () => {
      const folder = (x, y, label) => `<path class="il-folder" d="M${x} ${y + 8}a6 6 0 0 1 6-6h22l8 8h40a6 6 0 0 1 6 6v46a6 6 0 0 1-6 6H${x + 6}a6 6 0 0 1-6-6z"/>
        <text class="il-big" x="${x + 41}" y="${y + 50}" text-anchor="middle">${label}</text>`;
      const file = (x, y, t, cls) => `<rect class="il-card" x="${x}" y="${y}" width="96" height="18" rx="5"/><text class="il-file ${cls}" x="${x + 8}" y="${y + 12.5}">${t}</text>`;
      return frame(`${folder(28, 20, "A")}${folder(210, 20, "B")}
        <path class="il-arrow" d="M134 56h60m-7-7 7 7-7 7"/><text class="il-cap" x="164" y="44" text-anchor="middle">clone</text>
        ${file(22, 104, "BSHP_Level.xlsx", "")}${file(22, 128, "bshp_icon.png", "")}
        ${file(204, 104, "PRSP_Level.xlsx", "acc")}${file(204, 128, "prsp_icon.png", "acc")}
        ${tag(160, 160, "Change Log ✓", "ok")}`);
    },
  };

  window.GDK = window.GDK || {};
  GDK.illus = {
    has: (name) => !!ART[name],
    render: (name) => (ART[name] ? ART[name]() : frame(`<text class="il-cap" x="160" y="94" text-anchor="middle">${name}</text>`)),
  };
})();

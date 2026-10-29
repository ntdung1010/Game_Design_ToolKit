/* Đọc bảng dùng chung cho mọi tool: CSV/TSV, số kiểu VN/EN, tự ghép cột.
   Chạy được cả trên trình duyệt (GDK.lib.table) lẫn Node (require) để test. */
(function (root, factory) {
  const lib = factory();
  if (typeof module === "object" && module.exports) module.exports = lib;
  else { root.GDK = root.GDK || {}; root.GDK.lib = root.GDK.lib || {}; root.GDK.lib.table = lib; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** Đoán dấu phân cách bằng cách đếm ở vài dòng đầu (ngoài dấu nháy). */
  function sniffDelimiter(text) {
    const head = text.split(/\r?\n/).slice(0, 10).join("\n");
    let best = ",", bestScore = -1;
    for (const d of ["\t", ",", ";", "|"]) {
      let n = 0, q = false;
      for (const ch of head) { if (ch === '"') q = !q; else if (!q && ch === d) n++; }
      if (n > bestScore) { best = d; bestScore = n; }
    }
    return best;
  }

  /**
   * Parse CSV chuẩn RFC 4180 (nháy kép, xuống dòng trong ô). Trả về mảng các dòng (mảng ô).
   * Quét bằng charCodeAt + slice thay vì cộng chuỗi từng ký tự → nhanh ~3× với file lớn.
   */
  function parseCSV(text, delim) {
    text = String(text || "");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    delim = delim || sniffDelimiter(text);
    const D = delim.charCodeAt(0), Q = 34, LF = 10, CR = 13, n = text.length;
    const rows = [];
    let row = [], i = 0;
    const endField = (j) => { while (j < n) { const c = text.charCodeAt(j); if (c === D || c === LF || c === CR) break; j++; } return j; };
    while (i < n) {
      let field;
      if (text.charCodeAt(i) === Q) {
        let j = i + 1, buf = "";
        for (;;) {
          const k = text.indexOf('"', j);
          if (k === -1) { buf += text.slice(j); i = n; break; }
          if (text.charCodeAt(k + 1) === Q) { buf += text.slice(j, k + 1); j = k + 2; continue; }
          buf += text.slice(j, k); i = k + 1; break;
        }
        const e = endField(i);          // ký tự lạc sau dấu nháy đóng: giữ lại như parser cũ
        field = e > i ? buf + text.slice(i, e) : buf;
        i = e;
      } else {
        const e = endField(i);
        field = text.slice(i, e);
        i = e;
      }
      row.push(field);
      if (i >= n) break;
      const c = text.charCodeAt(i);
      if (c === D) { i++; if (i >= n) row.push(""); continue; }
      if (c === CR) i++;
      if (i < n && text.charCodeAt(i) === LF) i++;
      rows.push(row); row = [];
    }
    if (row.length) rows.push(row);
    return rows.filter((r) => r.some((c) => c !== "" && c.trim() !== ""));
  }

  /** Tách header + dòng dữ liệu. Header rỗng / trùng được đặt tên lại cho an toàn. */
  function toTable(matrix) {
    if (!matrix.length) return { headers: [], rows: [] };
    const seen = {};
    const headers = matrix[0].map((h, i) => {
      let name = String(h == null ? "" : h).trim() || "Cột " + (i + 1);
      if (seen[name]) name = name + " (" + (++seen[name]) + ")"; else seen[name] = 1;
      return name;
    });
    const rows = matrix.slice(1).map((r) => {
      const o = {};
      headers.forEach((h, i) => { o[h] = r[i] == null ? "" : r[i]; });
      return o;
    });
    return { headers, rows, rawHeaders: matrix[0].map((h) => String(h == null ? "" : h)) };
  }

  function parseTable(text) { return toTable(parseCSV(text)); }

  /** "1,234" / "1.234,5" / "12,5%" / "$3.20" / "1 234" → số. Không đọc được → null. */
  const SIMPLE_NUM = /^[-+]?(\d+\.?\d*|\.\d+)$/;
  function toNumber(v) {
    if (v == null) return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    let s = String(v).trim();
    if (!s) return null;
    if (SIMPLE_NUM.test(s)) return parseFloat(s);      // đường nhanh: 99% ô trong file export
    let pct = false;
    if (s.endsWith("%")) { pct = true; s = s.slice(0, -1).trim(); }
    s = s.replace(/[\s\u00a0]/g, "").replace(/^[$€£¥₫]|[$€£¥₫]$|đ$|VND$|USD$/gi, "");
    if (/^\(.*\)$/.test(s)) s = "-" + s.slice(1, -1);
    // "0.725" / "1.234" (1 dấu chấm) là số thập phân như mọi file export; chỉ coi dấu chấm là
    // ngăn hàng nghìn kiểu VN khi có ≥ 2 nhóm ("1.234.567") hoặc đi kèm phẩy thập phân ("1.234,5").
    const lead0 = /^[-+]?0[.,]/.test(s);
    if (!lead0 && /^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
    else if (!lead0 && (/^[-+]?\d{1,3}(\.\d{3}){2,}(,\d+)?$/.test(s) || /^[-+]?\d{1,3}(\.\d{3})+,\d+$/.test(s))) s = s.replace(/\./g, "").replace(",", ".");
    else if (/^[-+]?\d+,\d+$/.test(s)) s = s.replace(",", ".");
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
    const n = parseFloat(s);
    if (!isFinite(n)) return null;
    return pct ? n / 100 : n;
  }

  /** Lấy số level từ "12", "Level 12", "level_012", "L12" → 12. */
  function toLevel(v) {
    if (typeof v === "number") return isFinite(v) ? v : null;
    if (typeof v === "string" && /^\d+$/.test(v)) return +v;
    const m = String(v == null ? "" : v).match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }

  const DATE_RE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})|^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})|^(\d{4})(\d{2})(\d{2})$/;
  /** "2026-10-12", "12/10/2026", "20261012" → "2026-10-12". */
  function toDate(v) {
    const s = String(v == null ? "" : v).trim();
    const m = s.match(DATE_RE);
    if (!m) return null;
    let y, mo, d;
    if (m[1]) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if (m[4]) { y = +m[6]; mo = +m[5]; d = +m[4]; if (mo > 12 && d <= 12) { const t = mo; mo = d; d = t; } }
    else { y = +m[7]; mo = +m[8]; d = +m[9]; }
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return y + "-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  }

  /** Bỏ dấu tiếng Việt + về chữ thường + chỉ giữ chữ số và "_". */
  function norm(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D")
      .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  }

  /**
   * Tự ghép cột. fields = [{key, synonyms:[...]}]. Trả về {key: header|""}.
   * Khớp chính xác (sau norm) được ưu tiên hơn khớp một phần; mỗi header chỉ dùng 1 lần.
   */
  function autoMap(headers, fields) {
    const nh = headers.map((h) => ({ h, n: norm(h) }));
    const used = new Set(), out = {};
    for (const pass of [0, 1, 2]) {
      for (const f of fields) {
        if (out[f.key]) continue;
        const syns = [f.key, ...(f.synonyms || [])].map(norm);
        const hit = nh.find(({ h, n }) => !used.has(h) && syns.some((s) =>
          pass === 0 ? n === s
            : pass === 1 ? (n.startsWith(s + "_") || n.endsWith("_" + s) || n.split("_").includes(s))
              : s.length >= 4 && n.includes(s)));
        if (hit) { out[f.key] = hit.h; used.add(hit.h); }
      }
    }
    for (const f of fields) if (!out[f.key]) out[f.key] = "";
    return out;
  }

  /** Cột nào là số (≥ 80% ô có giá trị đọc được thành số). Lấy mẫu tối đa 5.000 ô / cột cho file lớn. */
  function numericColumns(headers, rows, sample = 5000) {
    const step = Math.max(1, Math.floor(rows.length / sample));
    return headers.filter((h) => {
      let n = 0, ok = 0;
      for (let i = 0; i < rows.length; i += step) {
        const v = rows[i][h];
        if (v == null || String(v).trim() === "") continue;
        n++; if (toNumber(v) != null) ok++;
      }
      return n > 0 && ok / n >= 0.8;
    });
  }

  /** min / max không dùng Math.min(...arr) — mảng > ~120k phần tử sẽ tràn stack. */
  function extent(arr) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < arr.length; i++) { const x = arr[i]; if (x == null || x !== x) continue; if (x < lo) lo = x; if (x > hi) hi = x; }
    return lo === Infinity ? [null, null] : [lo, hi];
  }

  function median(arr) {
    const a = arr.filter((x) => x != null && isFinite(x)).sort((x, y) => x - y);
    if (!a.length) return null;
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  function quantile(arr, q) {
    const a = arr.filter((x) => x != null && isFinite(x)).sort((x, y) => x - y);
    if (!a.length) return null;
    const pos = (a.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return a[lo] + (a[hi] - a[lo]) * (pos - lo);
  }

  /** Xuất CSV (có BOM để Excel đọc đúng tiếng Việt). */
  function toCSV(headers, rows) {
    // chuỗi bắt đầu bằng = + - @ (không phải số) → thêm ' để Excel KHÔNG chạy như công thức
    // (chống chèn công thức qua tên file / dữ liệu do người khác đặt)
    const esc = (v) => {
      let s = v == null ? "" : String(v);
      if (typeof v === "string" && /^[=+\-@\t\r]/.test(s) && !SIMPLE_NUM.test(s.trim())) s = "'" + s;
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return "\uFEFF" + [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\r\n");
  }

  return { sniffDelimiter, parseCSV, toTable, parseTable, toNumber, toLevel, toDate, norm, autoMap, numericColumns, extent, median, quantile, toCSV };
});

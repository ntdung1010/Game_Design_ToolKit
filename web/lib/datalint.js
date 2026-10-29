/* Data Lint — soát 1 file bảng (CSV / Excel export) trước khi phân tích.
   Bắt các lỗi hay làm sai kết luận: cột luôn = 0 (event không bắn), ngày cuối chưa đủ dữ liệu,
   level bị thiếu, dòng trùng, cột lẫn chữ và số, header trùng… Không phụ thuộc game. */
(function (root, factory) {
  const T = typeof module === "object" && module.exports ? require("./table.js") : root.GDK.lib.table;
  const lib = factory(T);
  if (typeof module === "object" && module.exports) module.exports = lib;
  else root.GDK.lib.datalint = lib;
})(typeof self !== "undefined" ? self : this, function (T) {
  "use strict";

  const LEVEL_RE = /(^|_)(level|lvl|stage|man)(_|$|id|number|num)/;
  const DATE_RE = /(^|_)(date|day|ngay|time|dt|ds)(_|$)/;
  const COUNT_RE = /(user|users|install|start|win|lose|count|play|session|impression|click|revenue|quit|fail|event|cnt|total|so_)/;

  /** Hồ sơ từng cột trong MỘT lượt quét (file 200k dòng vẫn < 1 giây). */
  function profile(headers, rows) {
    return headers.map((h) => {
      const nn = T.norm(h);
      const freq = new Map(), nums = [], texts = [];
      let filled = 0, dates = 0, textCount = 0, sum = 0, zeros = 0, negatives = 0;
      for (let i = 0; i < rows.length; i++) {
        const raw = rows[i][h];
        if (raw == null) continue;
        const v = typeof raw === "string" ? raw.trim() : String(raw);
        if (v === "") continue;
        filled++;
        freq.set(v, (freq.get(v) || 0) + 1);
        const n = T.toNumber(v);
        if (n != null) { nums.push(n); sum += n; if (n === 0) zeros++; else if (n < 0) negatives++; continue; }
        if (T.toDate(v)) { dates++; continue; }
        textCount++;
        if (texts.length < 5) texts.push(v);
      }
      let type = "empty";
      if (filled) type = nums.length / filled >= 0.8 ? "number" : dates / filled >= 0.8 ? "date" : "text";
      const p = {
        name: h, norm: nn, type, filled, empty: rows.length - filled, unique: freq.size,
        isLevel: LEVEL_RE.test(nn) && type === "number", isDate: type === "date" || (DATE_RE.test(nn) && dates > 0),
        isCount: COUNT_RE.test(nn), texts, textCount,
      };
      if (nums.length) {
        const sorted = Float64Array.from(nums).sort();          // sắp xếp 1 lần cho min/max/tứ phân vị
        const q = (f) => { const pos = (sorted.length - 1) * f, lo = Math.floor(pos), hi = Math.ceil(pos); return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo); };
        p.min = sorted[0]; p.max = sorted[sorted.length - 1];
        p.sum = sum; p.mean = sum / nums.length; p.zeros = zeros; p.negatives = negatives;
        p.q1 = q(0.25); p.q3 = q(0.75); p.median = q(0.5);
      }
      // top giá trị: chỉ giữ 4 cái nhiều nhất, không sắp xếp cả Map
      const top = [];
      for (const e of freq) {
        if (top.length < 4) { top.push(e); top.sort((x, y) => y[1] - x[1]); }
        else if (e[1] > top[3][1]) { top[3] = e; top.sort((x, y) => y[1] - x[1]); }
      }
      p.top = top;
      return p;
    });
  }

  function lint(headers, rows, rawHeaders) {
    const issues = [];
    const add = (level, title, detail, column, action) => issues.push({ level, title, detail, column, action: action || "" });
    const cols = profile(headers, rows);

    if (!rows.length) add("bad", "File không có dòng dữ liệu", "Chỉ thấy dòng tiêu đề (hoặc file rỗng).", "", "Xuất lại file — kiểm tra bộ lọc ngày / version khi export.");
    (rawHeaders || []).forEach((h, i) => {
      if (!String(h).trim()) add("warn", "Cột không có tên", `Cột thứ ${i + 1} trống tên — đã tạm đặt là “Cột ${i + 1}”.`, "", "Đặt tên cột trước khi đưa vào sheet / script khác.");
      else if (h !== h.trim()) add("warn", "Tên cột có dấu cách thừa", `“${h}” — công thức / script tìm theo tên có thể không thấy.`, h, "Xoá dấu cách thừa ở tên cột.");
    });
    const dupHeads = headers.filter((h) => / \(\d+\)$/.test(h));
    if (dupHeads.length) add("bad", "Tên cột bị trùng", `${dupHeads.length} cột trùng tên (đã đánh số lại: ${dupHeads.slice(0, 4).join(", ")}). Dễ lấy nhầm cột khi phân tích.`, "", "Đổi tên các cột trùng cho rõ nghĩa (vd thêm hậu tố version).");

    for (const c of cols) {
      if (c.type === "empty") { add("warn", "Cột trống hoàn toàn", "Không có giá trị nào.", c.name, "Kiểm tra event / param của cột này có được bắn không, hoặc bỏ cột khỏi báo cáo."); continue; }
      if (c.type === "number") {
        if (c.sum === 0 && c.filled >= 3) add("bad", "Cột luôn bằng 0", c.isCount ? "Có thể event này KHÔNG được bắn (tracking hỏng) — đừng kết luận “không ai làm hành động này” khi chưa kiểm tra." : "Mọi giá trị đều là 0.", c.name, c.isCount ? "Kiểm tra tracking của event trước khi kết luận; tạm loại cột này khỏi phân tích." : "Kiểm tra lại công thức / bộ lọc của cột.");
        else if (c.zeros / c.filled >= 0.9 && c.filled >= 20) add("warn", "Gần như toàn số 0", `${pct(c.zeros / c.filled)} ô bằng 0 — kiểm tra tracking / bộ lọc.`, c.name, "Đối chiếu với 1 nguồn khác (Firebase / GA4) xem event có bị mất ở một số version không.");
        if (c.negatives && c.isCount) add("warn", "Có số âm ở cột đếm", `${c.negatives} ô âm (nhỏ nhất ${fmt(c.min)}) — số lượt / user không thể âm.`, c.name, "Tìm dòng âm, có thể do trừ 2 cột lệch kỳ — sửa công thức rồi xuất lại.");
        if (c.textCount) add("warn", "Lẫn chữ trong cột số", `${c.textCount} ô không phải số, ví dụ: ${c.texts.map((t) => "“" + t + "”").join(", ")}.`, c.name, "Chuẩn hoá ô chữ (“-”, “N/A”…) thành ô trống hoặc 0 trước khi tính.");
        if (c.q3 != null && c.q1 != null && c.max > c.q3 + 10 * Math.max(c.q3 - c.q1, Math.abs(c.median) * 0.1, 1e-9) && c.filled >= 20) {
          add("info", "Có giá trị đột biến", `Lớn nhất ${fmt(c.max)} trong khi 75% giá trị ≤ ${fmt(c.q3)} — kiểm tra dòng đó có phải lỗi không.`, c.name, "Mở dòng có giá trị lớn nhất; nếu lỗi thì loại ra, nếu thật thì báo riêng (sự kiện / bug / cheat).");
        }
      }
      if (c.type === "text" && c.filled > 1 && c.unique === 1 && rows.length > 5) add("info", "Cột chỉ có 1 giá trị", `Toàn bộ là “${c.top[0][0]}”.`, c.name, "Nếu là cột tách nhóm (version / nhánh) thì file chỉ có 1 nhóm — kiểm tra bộ lọc khi export.");
      if (c.empty && (c.isLevel || c.isDate || /(^|_)(id|user_id|arm|variant|version)(_|$)/.test(c.norm))) {
        add("warn", "Thiếu giá trị ở cột khoá", `${c.empty} dòng trống ở cột dùng để nhóm / ghép dữ liệu.`, c.name, "Loại hoặc điền các dòng trống trước khi gộp — nếu không sẽ thành 1 nhóm “(trống)”.");
      } else if (c.empty / rows.length > 0.3 && c.type !== "empty") {
        add("info", "Nhiều ô trống", `${pct(c.empty / rows.length)} ô trống.`, c.name, "Phân biệt “không có dữ liệu” với “bằng 0” trước khi tính trung bình.");
      }
    }

    // dòng trùng hoàn toàn
    const seen = new Map();
    let dup = 0, firstDup = -1;
    rows.forEach((r, i) => {
      const k = headers.map((h) => String(r[h] ?? "").trim()).join("\u0001");
      if (seen.has(k)) { dup++; if (firstDup < 0) firstDup = i + 2; } else seen.set(k, i);
    });
    if (dup) add("bad", "Dòng bị trùng lặp", `${dup} dòng giống hệt dòng khác (đầu tiên ở dòng ${firstDup} của file) — cộng dồn sẽ bị đếm 2 lần.`, "", "Xoá dòng trùng (hoặc xuất lại) trước khi cộng dồn.");

    // level bị thiếu
    const lvCol = cols.find((c) => c.isLevel);
    if (lvCol) {
      const lvs = [...new Set(rows.map((r) => T.toLevel(r[lvCol.name])).filter((x) => x != null && Number.isInteger(x)))].sort((a, b) => a - b);
      const gaps = [];
      for (let k = 1; k < lvs.length; k++) for (let x = lvs[k - 1] + 1; x < lvs[k] && gaps.length < 200; x++) gaps.push(x);
      if (gaps.length) add("warn", "Thiếu level trong dãy", `Từ ${lvs[0]} đến ${lvs[lvs.length - 1]} thiếu ${gaps.length} level: ${ranges(gaps)}. Tỉ lệ rời bỏ quanh các level này sẽ sai.`, lvCol.name, "Xuất lại đủ dãy level, hoặc đừng đọc droprate ở các level ngay trước chỗ thiếu.");
    }

    // ngày: thiếu ngày + ngày cuối chưa đủ dữ liệu
    const dCol = cols.find((c) => c.isDate);
    if (dCol) {
      const byDay = new Map();
      const numCols = cols.filter((c) => c.type === "number" && !c.isLevel && c.sum > 0);
      const main = numCols.find((c) => c.isCount) || numCols[0];
      for (const r of rows) {
        const d = T.toDate(r[dCol.name]);
        if (!d) continue;
        byDay.set(d, (byDay.get(d) || 0) + (main ? T.toNumber(r[main.name]) || 0 : 1));
      }
      const days = [...byDay.keys()].sort();
      if (days.length >= 3) {
        const miss = [];
        for (let k = 1; k < days.length; k++) {
          let x = new Date(days[k - 1] + "T00:00:00Z");
          const end = new Date(days[k] + "T00:00:00Z");
          for (x.setUTCDate(x.getUTCDate() + 1); x < end && miss.length < 60; x.setUTCDate(x.getUTCDate() + 1)) miss.push(x.toISOString().slice(0, 10));
        }
        if (miss.length) add("warn", "Thiếu ngày", `${miss.length} ngày không có dữ liệu: ${miss.slice(0, 6).join(", ")}${miss.length > 6 ? "…" : ""}.`, dCol.name, "Kiểm tra pipeline dữ liệu những ngày đó; đừng nối thẳng 2 bên chỗ thiếu khi vẽ xu hướng.");
        const vals = days.map((d) => byDay.get(d));
        const med = T.median(vals.slice(0, -1));
        const last = vals[vals.length - 1];
        if (med > 0 && last < med * 0.6) {
          add("bad", "Ngày cuối có thể chưa đủ dữ liệu", `Ngày ${days[days.length - 1]}: ${main ? "tổng " + main.name + " = " : ""}${fmt(last)}, chỉ bằng ${pct(last / med)} mức thường (${fmt(med)}). Thường do kéo dữ liệu giữa ngày — nên bỏ ngày này, đừng đọc là “tụt”.`, dCol.name, "Bỏ ngày cuối khỏi phân tích hoặc xuất lại sau khi ngày đó kết thúc.");
        }
      }
    }

    const order = { bad: 0, warn: 1, info: 2 };
    issues.sort((a, b) => order[a.level] - order[b.level]);
    const bad = issues.filter((x) => x.level === "bad").length, warn = issues.filter((x) => x.level === "warn").length;
    const verdict = bad ? { kind: "bad", title: "Có lỗi cần xử lý trước khi phân tích" }
      : warn ? { kind: "warn", title: "Dùng được, nhưng có điểm cần xem lại" }
        : { kind: "ok", title: "File sạch — dùng được" };
    return { columns: cols, issues, verdict, rows: rows.length };
  }

  function ranges(xs) {
    const out = [];
    for (let i = 0; i < xs.length;) {
      let j = i;
      while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++;
      out.push(i === j ? String(xs[i]) : xs[i] + "–" + xs[j]);
      i = j + 1;
    }
    return out.slice(0, 12).join(", ") + (out.length > 12 ? "…" : "");
  }
  function pct(v) { return (v * 100).toFixed(v < 0.1 ? 1 : 0) + "%"; }
  function fmt(n) { return n == null ? "—" : Math.abs(n) >= 1000 ? Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") : String(+n.toFixed(3)); }

  return { profile, lint, ranges };
});

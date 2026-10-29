/* Config Diff — so 2 bản JSON (Remote Config, file config level…) và soát lỗi.
   Có parser JSON riêng để: báo đúng dòng/cột khi sai cú pháp, bắt KHOÁ TRÙNG (JSON.parse
   lặng lẽ lấy giá trị cuối), mở chuỗi JSON lồng bên trong, hiểu template Firebase Remote Config. */
(function (root, factory) {
  const lib = factory();
  if (typeof module === "object" && module.exports) module.exports = lib;
  else { root.GDK = root.GDK || {}; root.GDK.lib = root.GDK.lib || {}; root.GDK.lib.configdiff = lib; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ------------------------------------------------------------- parser
  function parse(text) {
    const s = String(text == null ? "" : text).replace(/^\uFEFF/, "");
    let i = 0;
    const dups = [];
    const fail = (msg, at) => { const e = new Error(msg); e.pos = at == null ? i : at; throw e; };
    const ws = () => { while (i < s.length && " \t\r\n".includes(s[i])) i++; };
    const setKey = (o, k, v) => Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });

    function value(path) {
      ws();
      const c = s[i];
      if (c === "{") return object(path);
      if (c === "[") return array(path);
      if (c === '"') return string();
      if (c === "t" && s.startsWith("true", i)) { i += 4; return true; }
      if (c === "f" && s.startsWith("false", i)) { i += 5; return false; }
      if (c === "n" && s.startsWith("null", i)) { i += 4; return null; }
      if (c === "-" || (c >= "0" && c <= "9")) return number();
      if (c === "'") fail("Chuỗi phải dùng nháy kép \" chứ không dùng nháy đơn '");
      if (c === undefined) fail("File kết thúc giữa chừng — thiếu dấu đóng } hoặc ]");
      fail("Ký tự không hợp lệ: " + JSON.stringify(c));
    }
    function object(path) {
      i++;
      const o = {}, seen = new Map();
      ws();
      if (s[i] === "}") { i++; return o; }
      for (;;) {
        ws();
        if (s[i] !== '"') fail(s[i] === "}" ? "Dấu phẩy thừa trước }" : "Thiếu tên trường trong nháy kép");
        const at = i, k = string();
        ws();
        if (s[i] !== ":") fail("Thiếu dấu : sau tên trường \"" + k + "\"");
        i++;
        const v = value(path.concat(k));
        if (seen.has(k)) dups.push({ path: path.concat(k), key: k, pos: at, firstPos: seen.get(k) });
        else seen.set(k, at);
        setKey(o, k, v);
        ws();
        if (s[i] === ",") { i++; continue; }
        if (s[i] === "}") { i++; return o; }
        fail(s[i] === undefined ? "Thiếu dấu } đóng object" : "Thiếu dấu , giữa các trường");
      }
    }
    function array(path) {
      i++;
      const a = [];
      ws();
      if (s[i] === "]") { i++; return a; }
      for (;;) {
        a.push(value(path.concat(a.length)));
        ws();
        if (s[i] === ",") { i++; ws(); if (s[i] === "]") fail("Dấu phẩy thừa trước ]"); continue; }
        if (s[i] === "]") { i++; return a; }
        fail(s[i] === undefined ? "Thiếu dấu ] đóng mảng" : "Thiếu dấu , giữa các phần tử");
      }
    }
    function string() {
      i++;
      let out = "";
      for (;;) {
        const c = s[i];
        if (c === undefined) fail("Chuỗi chưa đóng nháy kép");
        if (c === '"') { i++; return out; }
        if (c === "\n") fail("Chuỗi bị xuống dòng — thiếu nháy kép đóng?");
        if (c === "\\") {
          const e = s[i + 1];
          const map = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
          if (e in map) { out += map[e]; i += 2; continue; }
          if (e === "u" && /^[0-9a-fA-F]{4}$/.test(s.substr(i + 2, 4))) { out += String.fromCharCode(parseInt(s.substr(i + 2, 4), 16)); i += 6; continue; }
          fail("Ký tự thoát không hợp lệ: \\" + e);
        }
        out += c; i++;
      }
    }
    function number() {
      const re = /-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y;
      re.lastIndex = i;
      const m = re.exec(s);
      if (!m) fail("Số không hợp lệ");
      i = re.lastIndex;
      return parseFloat(m[0]);
    }

    try {
      ws();
      if (i >= s.length) return { ok: false, empty: true, error: null, dups: [] };
      const v = value([]);
      ws();
      if (i < s.length) fail("Còn ký tự thừa sau khi JSON đã kết thúc");
      return { ok: true, value: v, dups: dups.map((d) => Object.assign(d, lineCol(s, d.pos))) };
    } catch (e) {
      if (e.pos == null) throw e;
      return { ok: false, error: Object.assign({ message: e.message }, lineCol(s, e.pos)), dups: [] };
    }
  }

  function lineCol(s, pos) {
    let line = 1, col = 1;
    for (let k = 0; k < pos && k < s.length; k++) { if (s[k] === "\n") { line++; col = 1; } else col++; }
    return { line, col, pos };
  }

  // ------------------------------------------------------------- Firebase template
  function isFirebase(v) { return v && typeof v === "object" && !Array.isArray(v) && (v.parameters || v.parameterGroups) && typeof (v.parameters || v.parameterGroups) === "object"; }
  function normalizeFirebase(v) {
    const out = {};
    const val = (dv) => dv == null ? null : dv.useInAppDefault ? "(mặc định trong app)" : dv.value;
    const add = (params) => {
      for (const k of Object.keys(params || {})) {
        const p = params[k] || {};
        out[k] = val(p.defaultValue);
        for (const c of Object.keys(p.conditionalValues || {})) out[k + " ⟨" + c + "⟩"] = val(p.conditionalValues[c]);
      }
    };
    add(v.parameters);
    for (const g of Object.keys(v.parameterGroups || {})) add((v.parameterGroups[g] || {}).parameters);
    for (const c of v.conditions || []) if (c && c.name) out["⟨điều kiện⟩ " + c.name] = c.expression;
    return out;
  }

  // ------------------------------------------------------------- làm phẳng
  const typeOf = (v) => v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
  function showPath(path) {
    return path.map((k, i) => typeof k === "number" ? "[" + k + "]" : /^[A-Za-z_$][\w$]*$/.test(k) ? (i ? "." : "") + k : "[" + JSON.stringify(k) + "]").join("") || "(gốc)";
  }

  function flatten(root, issues, side) {
    const out = new Map();
    (function walk(v, path, viaString) {
      let t = typeOf(v);
      if (t === "string") {
        const tr = v.trim();
        if ((tr.startsWith("{") && tr.endsWith("}")) || (tr.startsWith("[") && tr.endsWith("]"))) {
          const p = parse(tr);
          if (p.ok) {
            p.dups.forEach((d) => issues.push({ level: "bad", kind: "dup", side, title: "Khoá trùng trong chuỗi JSON lồng", path: showPath(path.concat(d.path)), detail: `"${d.key}" xuất hiện 2 lần — game chỉ đọc được 1 giá trị.` }));
            return walk(p.value, path, true);
          }
          issues.push({ level: "bad", kind: "nested", side, title: "Chuỗi JSON lồng bên trong bị lỗi", path: showPath(path), detail: p.error ? p.error.message + ` (ký tự ${p.error.col} của chuỗi)` : "" });
        }
      }
      const key = showPath(path);
      if (t === "object" || t === "array") {
        const keys = t === "array" ? v.map((_, k) => k) : Object.keys(v);
        out.set(key, { path, type: t, size: keys.length, container: true, viaString });
        for (const k of keys) {
          if (typeof k === "string" && k !== k.trim()) issues.push({ level: "warn", kind: "space", side, title: "Tên trường có dấu cách thừa", path: showPath(path.concat(k)), detail: `"${k}" — có khoảng trắng ở đầu/cuối, game tìm "${k.trim()}" sẽ không thấy.` });
          if (k === "") issues.push({ level: "warn", kind: "space", side, title: "Tên trường rỗng", path: showPath(path), detail: "" });
          walk(v[k], path.concat(k), false);
        }
      } else {
        out.set(key, { path, type: t, value: v, container: false, viaString });
      }
    })(root, [], false);
    return out;
  }

  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 3) return 99;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    return d[a.length][b.length];
  }
  const loose = (k) => String(k).toLowerCase().replace(/[\s_\-.]/g, "");

  // ------------------------------------------------------------- so sánh
  function compare(textA, textB) {
    const issues = [];
    const sides = {};
    for (const [name, text] of [["A", textA], ["B", textB]]) {
      const p = parse(text);
      sides[name] = p;
      if (p.empty) continue;
      if (!p.ok) {
        issues.push({ level: "bad", kind: "syntax", side: name, title: "Sai cú pháp JSON", path: `dòng ${p.error.line}, cột ${p.error.col}`, detail: p.error.message, line: p.error.line });
        continue;
      }
      p.dups.forEach((d) => issues.push({ level: "bad", kind: "dup", side: name, title: "Khoá trùng", path: showPath(d.path) + ` (dòng ${d.line})`, detail: `"${d.key}" khai báo 2 lần trong cùng 1 object — chỉ giá trị CUỐI có hiệu lực, giá trị đầu bị bỏ âm thầm.`, line: d.line }));
      p.firebase = isFirebase(p.value);
      p.data = p.firebase ? normalizeFirebase(p.value) : p.value;
      p.flat = flatten(p.data, issues, name);
    }
    const A = sides.A, B = sides.B;
    const changes = [];
    if (A.ok && B.ok) {
      const covered = (map, path) => {
        for (let k = path.length - 1; k >= 1; k--) if (!map.has(showPath(path.slice(0, k)))) return true;
        return false;
      };
      for (const [key, a] of A.flat) {
        const b = B.flat.get(key);
        if (!b) { if (!covered(B.flat, a.path)) changes.push({ kind: "removed", path: key, raw: a.path, old: a }); continue; }
        if (a.type !== b.type && !(a.container && b.container && a.type === b.type)) {
          changes.push({ kind: "type", path: key, raw: a.path, old: a, new: b });
          issues.push({ level: "warn", kind: "type", side: "B", title: "Đổi kiểu dữ liệu", path: key, detail: `${label(a)} → ${label(b)} — code đọc theo kiểu cũ có thể lỗi hoặc ra giá trị mặc định.` });
          continue;
        }
        if (a.container) {
          if (a.size > 0 && b.size === 0) issues.push({ level: "bad", kind: "emptied", side: "B", title: "Danh sách bị xoá sạch", path: key, detail: `Bản cũ có ${a.size} phần tử, bản mới rỗng. Nếu không cố ý thì kiểm tra tên trường / định dạng.` });
          continue;
        }
        if (a.value !== b.value) {
          changes.push({ kind: "changed", path: key, raw: a.path, old: a, new: b });
          if (a.type === "number" && b.type === "number" && a.value !== 0 && b.value !== 0) {
            const r = b.value / a.value;
            if (r >= 5 || r <= 0.2 || r < 0) issues.push({ level: "warn", kind: "jump", side: "B", title: "Giá trị đổi bất thường", path: key, detail: `${a.value} → ${b.value} (×${r.toFixed(r < 1 ? 2 : 1).replace(".", ",")}) — có đúng ý không, hay gõ thừa/thiếu số 0?` });
          }
        }
      }
      for (const [key, b] of B.flat) {
        if (!A.flat.has(key) && !covered(A.flat, b.path)) changes.push({ kind: "added", path: key, raw: b.path, new: b });
      }
      // nghi gõ sai tên: xoá 1 trường + thêm 1 trường tên gần giống ở cùng cấp
      const removed = changes.filter((c) => c.kind === "removed"), added = changes.filter((c) => c.kind === "added");
      for (const r of removed) {
        const rk = r.raw[r.raw.length - 1], parent = showPath(r.raw.slice(0, -1));
        if (typeof rk !== "string") continue;
        for (const a of added) {
          const ak = a.raw[a.raw.length - 1];
          if (typeof ak !== "string" || showPath(a.raw.slice(0, -1)) !== parent) continue;
          if (loose(rk) === loose(ak) || lev(rk, ak) <= 2) {
            issues.push({ level: "bad", kind: "rename", side: "B", title: "Nghi gõ sai / đổi tên trường", path: a.path, detail: `Bản mới mất "${rk}" nhưng có thêm "${ak}". Game đọc tên cũ sẽ không thấy giá trị → dùng mặc định (có thể xoá sạch list).` });
          }
        }
      }
    }
    changes.sort((x, y) => x.path.localeCompare(y.path, "en", { numeric: true }));
    const order = { bad: 0, warn: 1, info: 2 };
    issues.sort((x, y) => order[x.level] - order[y.level]);
    const count = (k) => changes.filter((c) => c.kind === k).length;
    return {
      sides,
      changes,
      issues,
      stats: { added: count("added"), removed: count("removed"), changed: count("changed"), type: count("type"),
        bad: issues.filter((x) => x.level === "bad").length, warn: issues.filter((x) => x.level === "warn").length },
    };
  }

  function label(n) { return n.container ? (n.type === "array" ? "mảng" : "object") : { number: "số", string: "chuỗi", boolean: "true/false", null: "null" }[n.type] || n.type; }
  function show(n) {
    if (!n) return "";
    if (n.container) return n.type === "array" ? `[${n.size} phần tử]` : `{${n.size} trường}`;
    return typeof n.value === "string" ? JSON.stringify(n.value) : String(n.value);
  }

  return { parse, compare, normalizeFirebase, isFirebase, showPath, show, label, lev };
});

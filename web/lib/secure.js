/* Mã hoá file / đoạn chữ bằng mật khẩu — chạy hoàn toàn trên máy (WebCrypto), không gửi đi đâu.
   AES-256-GCM (mã hoá + chống sửa), khoá từ mật khẩu bằng PBKDF2-SHA256 600.000 vòng (OWASP 2023),
   tên / loại / kích thước file gốc được ràng buộc vào bản mã (AAD) nên sửa tên cũng bị phát hiện.
   Xuất ra: .gdkenc (JSON, mở bằng GD Toolkit) hoặc .html TỰ GIẢI MÃ (người nhận chỉ cần trình duyệt).
   Hàm giải mã nhúng vào file .html chính là decryptCore bên dưới → cùng 1 đoạn code đã được test. */
(function (root, factory) {
  const lib = factory();
  if (typeof module === "object" && module.exports) module.exports = lib;
  else { root.GDK = root.GDK || {}; root.GDK.lib = root.GDK.lib || {}; root.GDK.lib.secure = lib; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const ITER = 600000;
  const MAX_BYTES = 200 * 1024 * 1024;

  function b64(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(str) {
    const s = atob(str);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  function aadOf(m) {
    return new TextEncoder().encode(JSON.stringify({ v: 1, name: m.name, mime: m.mime, size: m.size }));
  }

  /** Giải mã gói. Được nhúng nguyên văn (toString) vào file .html tự giải mã. */
  async function decryptCore(pkg, password, subtle, unb64, aadOf) {
    const base = await subtle.importKey("raw", new TextEncoder().encode(String(password).normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
    const key = await subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: unb64(pkg.salt), iterations: pkg.iter },
      base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    try {
      const pt = await subtle.decrypt({ name: "AES-GCM", iv: unb64(pkg.iv), additionalData: aadOf(pkg) }, key, unb64(pkg.ct));
      return new Uint8Array(pt);
    } catch (e) {
      throw new Error("Sai mật khẩu, hoặc file đã bị sửa / hỏng.");
    }
  }

  function crypto_() {
    const c = typeof globalThis !== "undefined" ? globalThis.crypto : null;
    if (!c || !c.subtle) throw new Error("Trình duyệt không hỗ trợ mã hoá (WebCrypto). Hãy dùng Chrome / Edge / Firefox bản mới.");
    return c;
  }

  /** bytes: Uint8Array. meta: {name, mime}. Trả về gói (object JSON). */
  async function encrypt(bytes, password, meta, iter) {
    const c = crypto_();
    meta = meta || {};
    if (!password || String(password).length < 8) throw new Error("Mật khẩu cần ít nhất 8 ký tự.");
    if (bytes.length > MAX_BYTES) throw new Error("File quá lớn (tối đa 200 MB).");
    const salt = c.getRandomValues(new Uint8Array(16)), iv = c.getRandomValues(new Uint8Array(12));
    const m = { name: String(meta.name || "file").slice(0, 200), mime: String(meta.mime || "application/octet-stream").slice(0, 120), size: bytes.length };
    const base = await c.subtle.importKey("raw", new TextEncoder().encode(String(password).normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
    const it = iter || ITER;
    const key = await c.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: it }, base,
      { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
    const ct = new Uint8Array(await c.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aadOf(m) }, key, bytes));
    return { gdk: "enc", v: 1, alg: "AES-256-GCM", kdf: "PBKDF2-SHA256", iter: it, salt: b64(salt), iv: b64(iv),
      name: m.name, mime: m.mime, size: m.size, created: new Date().toISOString(), ct: b64(ct) };
  }

  async function decrypt(pkg, password) {
    check(pkg);
    return decryptCore(pkg, password, crypto_().subtle, unb64, aadOf);
  }

  function check(pkg) {
    if (!pkg || pkg.gdk !== "enc" || pkg.v !== 1 || pkg.alg !== "AES-256-GCM" || pkg.kdf !== "PBKDF2-SHA256")
      throw new Error("Không phải file mã hoá của GD Toolkit (hoặc phiên bản không hỗ trợ).");
    if (!(pkg.iter >= 100000 && pkg.iter <= 10000000)) throw new Error("Thông số mã hoá không hợp lệ.");
    for (const k of ["salt", "iv", "ct", "name", "mime"]) if (typeof pkg[k] !== "string") throw new Error("File mã hoá bị thiếu dữ liệu: " + k);
    return pkg;
  }

  /** Đọc gói từ nội dung file .gdkenc (JSON) hoặc .html tự giải mã. */
  function parsePackage(text) {
    text = String(text || "");
    let json = text.trim();
    if (!json.startsWith("{")) {
      const m = text.match(/<script type="application\/json" id="gdk-enc">([\s\S]*?)<\/script>/);
      if (!m) throw new Error("Không tìm thấy dữ liệu mã hoá trong file.");
      json = m[1];
    }
    let pkg;
    try { pkg = JSON.parse(json); } catch (e) { throw new Error("File mã hoá bị hỏng (không đọc được)."); }
    return check(pkg);
  }

  const toJson = (pkg) => JSON.stringify(pkg);

  /** File .html tự giải mã: không cần cài gì, không tải gì từ mạng. */
  function toHtml(pkg) {
    // nhúng JSON an toàn trong <script>: thoát "<" và 2 ký tự ngắt dòng U+2028/U+2029
    const LS = new RegExp("[" + String.fromCharCode(0x2028, 0x2029) + "]", "g");
    const data = JSON.stringify(pkg).replace(/</g, "\\u003c").replace(LS, (c) => "\\u" + c.charCodeAt(0).toString(16));
    const code = [unb64.toString(), aadOf.toString(), decryptCore.toString()].join("\n");
    return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:">
<title>File mã hoá · GD Toolkit</title>
<style>
:root{--bg:#0E1B1D;--card:#152527;--line:rgba(118,210,219,.24);--fg:#F7F6E5;--mut:rgba(247,246,229,.6);--acc:#76D2DB;--bad:#E07070;--ok:#7DD8A8}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px/1.55 "Segoe UI",system-ui,sans-serif;padding:16px}
.c{width:min(460px,100%);background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px}
h1{font-size:19px;margin:0 0 4px}.m{color:var(--mut);font-size:13px;margin:0 0 16px}.f{font-family:Consolas,monospace;font-size:12.5px;background:#0A1314;border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:16px;word-break:break-all}
input{width:100%;height:42px;border-radius:10px;border:1px solid var(--line);background:#0A1314;color:var(--fg);padding:0 12px;font:inherit;outline:0}input:focus{border-color:var(--acc)}
button,a.b{display:inline-flex;align-items:center;justify-content:center;width:100%;height:42px;margin-top:12px;border:0;border-radius:10px;background:var(--acc);color:#0E1B1D;font-weight:600;font-size:15px;font-family:inherit;cursor:pointer;text-decoration:none}
button:disabled{opacity:.6}.s{margin-top:12px;font-size:13.5px;min-height:20px}.s.bad{color:var(--bad)}.s.ok{color:var(--ok)}
pre{white-space:pre-wrap;word-break:break-word;background:#0A1314;border:1px solid var(--line);border-radius:10px;padding:12px;max-height:320px;overflow:auto;font-size:13px}
.ft{margin-top:16px;font-size:11.5px;color:var(--mut);text-align:center}
</style></head><body>
<div class="c">
  <h1>🔒 File đã được mã hoá</h1>
  <p class="m">Nhập mật khẩu người gửi đưa cho bạn. Giải mã ngay trên máy này — không gửi gì lên mạng.</p>
  <div class="f" id="info"></div>
  <input type="password" id="pw" placeholder="Mật khẩu" autocomplete="off" autofocus>
  <button id="go">Giải mã</button>
  <div class="s" id="st"></div>
  <div id="out"></div>
  <div class="ft">AES-256-GCM · PBKDF2-SHA256 · tạo bởi GD Toolkit — Design by Dũng NT</div>
</div>
<script type="application/json" id="gdk-enc">${data}</script>
<script>
${code}
(function () {
  var pkg = JSON.parse(document.getElementById("gdk-enc").textContent);
  var $ = function (id) { return document.getElementById(id); };
  var kb = pkg.size < 1048576 ? (pkg.size / 1024).toFixed(1) + " KB" : (pkg.size / 1048576).toFixed(1) + " MB";
  $("info").textContent = pkg.name + " · " + kb + " · tạo lúc " + (pkg.created ? new Date(pkg.created).toLocaleString("vi-VN") : "?");
  if (!window.crypto || !window.crypto.subtle) { $("st").className = "s bad"; $("st").textContent = "Trình duyệt này không hỗ trợ giải mã. Hãy mở bằng Chrome / Edge / Firefox bản mới."; return; }
  async function run() {
    var pw = $("pw").value;
    if (!pw) return;
    $("go").disabled = true; $("st").className = "s"; $("st").textContent = "Đang giải mã…";
    try {
      var bytes = await decryptCore(pkg, pw, window.crypto.subtle, unb64, aadOf);
      var blob = new Blob([bytes], { type: pkg.mime });
      var a = document.createElement("a");
      a.className = "b"; a.href = URL.createObjectURL(blob); a.download = pkg.name; a.textContent = "⬇ Tải về " + pkg.name;
      $("out").innerHTML = ""; $("out").appendChild(a);
      if (/^text\\//.test(pkg.mime) && bytes.length < 200000) {
        var pre = document.createElement("pre"); pre.textContent = new TextDecoder().decode(bytes); $("out").appendChild(pre);
      }
      $("st").className = "s ok"; $("st").textContent = "✓ Giải mã thành công.";
      a.click();
    } catch (e) {
      $("st").className = "s bad"; $("st").textContent = e.message || "Không giải mã được.";
    } finally { $("go").disabled = false; }
  }
  $("go").onclick = run;
  $("pw").onkeydown = function (e) { if (e.key === "Enter") run(); };
})();
</script>
</body></html>`;
  }

  return { ITER, MAX_BYTES, encrypt, decrypt, decryptCore, parsePackage, toHtml, toJson, b64, unb64, aadOf };
});

// Test mã hoá file (web/lib/secure.js) — chạy bằng WebCrypto của Node
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../../web/lib/secure.js");

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);
const FAST = 100000;   // ít vòng hơn cho test nhanh; 1 test riêng chạy đúng 600.000 vòng mặc định

test("secure: mã hoá → giải mã đúng, mỗi lần mã hoá ra bản khác nhau", async () => {
  const msg = "Doanh thu AB_20261005: B +3,9% — bí mật";
  const p1 = await S.encrypt(enc(msg), "mat-khau-dai-123", { name: "ghi chu.txt", mime: "text/plain" }, FAST);
  const p2 = await S.encrypt(enc(msg), "mat-khau-dai-123", { name: "ghi chu.txt", mime: "text/plain" }, FAST);
  assert.notEqual(p1.ct, p2.ct, "salt/iv ngẫu nhiên → bản mã khác nhau");
  assert.ok(!JSON.stringify(p1).includes("Doanh thu"), "bản mã không lộ nội dung");
  assert.equal(dec(await S.decrypt(p1, "mat-khau-dai-123")), msg);
  assert.equal(p1.size, enc(msg).length);
});

test("secure: sai mật khẩu, sửa bản mã, sửa tên file đều bị từ chối", async () => {
  const p = await S.encrypt(enc("abc"), "dung-mat-khau", { name: "a.txt", mime: "text/plain" }, FAST);
  await assert.rejects(S.decrypt(p, "sai-mat-khau"), /Sai mật khẩu/);
  const bytes = S.unb64(p.ct); bytes[0] ^= 1;
  await assert.rejects(S.decrypt({ ...p, ct: S.b64(bytes) }, "dung-mat-khau"), /Sai mật khẩu|bị sửa/);
  await assert.rejects(S.decrypt({ ...p, name: "doi-ten.exe" }, "dung-mat-khau"), /bị sửa/, "tên file ràng buộc bằng AAD");
  await assert.rejects(S.encrypt(enc("x"), "1234567"), /ít nhất 8/);
  assert.throws(() => S.parsePackage('{"gdk":"enc","v":1,"alg":"AES-256-GCM","kdf":"PBKDF2-SHA256","iter":5}'), /không hợp lệ/);
});

test("secure: mặc định PBKDF2 600.000 vòng + file nhị phân", async () => {
  const bin = new Uint8Array(70000).map((_, i) => (i * 31) & 255);
  const p = await S.encrypt(bin, "Mật-khẩu tiếng Việt 2026", { name: "data.xlsx" });
  assert.equal(p.iter, 600000);
  assert.deepEqual(await S.decrypt(p, "Mật-khẩu tiếng Việt 2026"), bin);
});

test("secure: file .html tự giải mã — đọc lại được, mã nhúng chạy đúng, tên file độc không thoát khỏi <script>", async () => {
  const evil = '</script><img src=x onerror=alert(1)>.txt';
  const p = await S.encrypt(enc("nội dung"), "mat-khau-html", { name: evil, mime: "text/plain" }, FAST);
  const html = S.toHtml(p);
  assert.ok(!html.includes("</script><img"), "tên file không phá được thẻ script");
  assert.match(html, /Content-Security-Policy/);
  const back = S.parsePackage(html);
  assert.equal(back.name, evil);
  // chạy chính đoạn code được nhúng trong file .html
  const code = html.slice(html.indexOf("<script>\n") + 9, html.indexOf("(function () {"));
  const fns = new Function(code + "\nreturn { unb64, aadOf, decryptCore };")();
  const out = await fns.decryptCore(back, "mat-khau-html", globalThis.crypto.subtle, fns.unb64, fns.aadOf);
  assert.equal(dec(out), "nội dung");
  await assert.rejects(fns.decryptCore(back, "sai", globalThis.crypto.subtle, fns.unb64, fns.aadOf), /Sai mật khẩu/);
});

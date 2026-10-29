// Test Level Stuck — lõi kiểm tra kẹt (web/lib/stuckkit.js): bộ giải, luật CDS, hậu kiểm, báo cáo, gói .md.
// Chạy: node --test tests/js  hoặc  python server.py test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const SK = require("../../web/lib/stuckkit.js");
const LK = require("../../web/lib/levelkit.js");
require("../../web/lib/level-adapters.js");

const V = SK.VERDICT;
const E = SK.ENGINES.cds;
const OPTS = { nodes: 60000, timeMs: 8000 };
const lvOf = (spec) => E.load(SK.cdsLevel("t", spec).json, "t.txt");
const keyMove = (s, key) => E.moves(s).find((m) => m.key === key);

test("stuckkit: dãy Luby + PRNG tất định", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(SK.luby), [1, 1, 2, 1, 1, 2, 4, 1]);
  const a = SK.rng(5), b = SK.rng(5);
  assert.equal(a(), b());
});

test("stuckkit: 8 level mẫu CDS ra đúng kết luận (khớp câu ví dụ của tool)", () => {
  const got = SK.sampleSet().map((s) => SK.checkLevel("cds", s.json, s.name, OPTS));
  const v = got.map((r) => r.verdict);
  assert.deepEqual(v, [V.OK, V.OK, V.OK, V.PROVEN, V.PROVEN, V.WARN, V.WARN, V.SKIP]);
  assert.deepEqual(got.slice(0, 3).map((r) => r.solution.moves.length), [12, 12, 12]);
  assert.match(got[3].note, /màu 0 có 5 ô/);
  assert.ok(got[4].strict.exhaustive && got[4].proof, "L5 phải là chứng minh (duyệt hết)");
  assert.equal(got[4].strict.nodes, 62);
  assert.match(got[5].note, /chỉ thắng khi mở ống xem ads/);
  assert.ok(got[5].proof, "L6: như ship đã duyệt hết");
  assert.match(got[6].note, /MISSING_ORDER/);
  assert.match(got[7].note, /ống khổng lồ/);
  for (const r of got.filter((x) => x.solution)) assert.ok(r.solution.replayOk, r.name + " phải chạy lại khớp");
});

test("stuckkit: chạy lại lời giải bằng khoá nước đi; khoá sai thì hỏng", () => {
  const s = SK.sampleSet()[0];
  const lv = E.load(s.json, s.name);
  const r = SK.solve(E, lv, 0, OPTS);
  assert.ok(r.won);
  const keys = r.path.map((m) => m.key);
  assert.ok(SK.replay(E, lv, 0, keys).ok);
  assert.equal(SK.replay(E, lv, 0, keys.slice(0, -1)).ok, false, "thiếu nước cuối thì không thắng");
  const bad = keys.slice(); bad[0] = "0>0";
  assert.equal(SK.replay(E, lv, 0, bad).ok, false);
  const st = SK.replay(E, lv, 0, keys, true).steps;
  assert.equal(st.length, keys.length);
  assert.ok(st[0].view && st[0].view.tubes.length, "có dữ liệu vẽ bàn chơi");
});

test("stuckkit: tất định — cùng tham số ra cùng số trạng thái", () => {
  const s = SK.sampleSet()[1];
  const a = SK.checkLevel("cds", s.json, s.name, OPTS), b = SK.checkLevel("cds", s.json, s.name, OPTS);
  assert.equal(a.strict.nodes, b.strict.nodes);
  assert.deepEqual(a.solution.keys, b.solution.keys);
});

test("stuckkit: đối chứng âm bắt được bản hỏng", () => {
  const s = SK.sampleSet()[0];
  const c = SK.controls("cds", s.json, s.name, OPTS);
  assert.equal(c.length, 2);
  assert.ok(c.every((x) => x.good), JSON.stringify(c));
  assert.equal(c[0].verdict, V.PROVEN);
});

test("stuckkit luật CDS: rót, rót 1 phần, ô ẩn lộ khi rót đi", () => {
  const lv = lvOf({ tubes: ["1 ?2 0 0", "0", "3 3 3"] });
  const s = E.start(lv, 0);
  const m = keyMove(s, "0>1");
  assert.equal(m.amt, 2, "rút 2 ô 0 nhưng ống đích chỉ còn... 3 chỗ → rót 2");
  E.apply(s, m);
  assert.deepEqual(s.t[1], [0, 0, 0]);
  assert.deepEqual(s.t[0], [2, 4], "ô ẩn màu 2 đã lộ (2*2, bit ẩn tắt)");
  assert.ok(!keyMove(s, "2>0"), "màu 3 không rót lên ngọn màu 2");
  const p = E.start(lvOf({ tubes: ["0 0 0", "0 0"] }), 0);
  const pm = keyMove(p, "0>1");
  assert.equal(pm.amt, 2, "rót 1 phần: chỉ còn 2 chỗ");
});

test("stuckkit luật CDS: nắp mở khi thu đúng màu, đóng băng tan theo số ống thu", () => {
  const lv = lvOf({ tubes: ["1 1 1 1", "0 0 0", "0", "", ""], orders: [0, 1],
    marks: { 0: { OBIM: [{ Id: 4, Obj: { Id: 0, TA: 1, CI: 0 }, CI: 0 }] }, 3: { OBIM: [{ Id: 7, Obj: { Id: 0, TA: 1 }, CI: 0 }] } } });
  const s = E.start(lv, 0);
  assert.ok(!E.moves(s).some((m) => m.a === 0), "ống có nắp không rót ra được");
  assert.ok(!E.moves(s).some((m) => m.d === 3), "ống đóng băng không nhận nước");
  E.apply(s, keyMove(s, "2>1"));
  assert.ok(s.rem[1], "ống 0 xong + khớp order đang mở → được thu");
  assert.equal(s.kind[0], 0, "nắp màu 0 TA 1 đã mở");
  assert.equal(s.kind[3], 0, "đóng băng TA 1 đã tan");
  assert.deepEqual(s.slots, [1], "order 1 còn mở, hàng chờ đã rút hết");
  assert.ok(E.won(s), "ống 1 1 1 1 đầy 1 màu + hàng chờ rỗng = thắng (CheckWin)");
});

test("stuckkit luật CDS: chìa mở hộp khoá, niêm vỡ khi đầy, ống sinh nạp màu kế, ống tag chỉ nhận màu tag", () => {
  const lv = lvOf({ tubes: ["2k1 0", "1 1 1", "", "1", "", ""],
    marks: { 1: { OVBIM: { KLT: 1 } }, 2: { OBIM: [{ Id: 6 }] }, 4: { OBIM: [{ Id: 18, NC: [5, 6] }] }, 5: { OBIM: [{ Id: 17, CI: 2 }] } } });
  const s = E.start(lv, 0);
  assert.ok(!E.moves(s).some((m) => m.a === 1 || m.d === 1), "ống trong hộp khoá không chạm được");
  E.apply(s, keyMove(s, "0>2"));
  assert.equal(s.klt[1], 0, "rót ô 0 đi → ô chứa chìa thành ngọn → hộp khoá #1 mở");
  assert.ok(!keyMove(s, "2>3"), "ống niêm không rót ra");
  const tagOk = E.moves(s).filter((m) => m.d === 5).map((m) => m.ci);
  assert.ok(tagOk.every((c) => c === 2) && tagOk.includes(2), "ống tag chỉ nhận màu 2");
  const sp = E.start(lvOf({ tubes: ["", "", "", "", "3"], marks: { 4: { OBIM: [{ Id: 18, NC: [5, 6] }] } } }), 0);
  assert.equal(sp.cap[4], 1, "ống sinh sức chứa 1");
  E.apply(sp, keyMove(sp, "4>0"));
  assert.deepEqual(sp.t[4], [10], "rót cạn → lấy ngay màu 5 trong NC");
  const seal = E.start(lvOf({ tubes: ["4 4 4", "4", "", ""], marks: { 0: { OBIM: [{ Id: 6 }] } } }), 0);
  E.apply(seal, keyMove(seal, "1>0"));
  assert.equal(seal.kind[0], 0, "niêm vỡ khi ống đầy 1 màu");
});

test("stuckkit: chứng nhận chắc chắn kẹt — hộp khoá mất chìa, nắp thiếu order", () => {
  const spec = { tubes: ["0 1 0 1", "1 0 1 0", "", ""], orders: [0, 1], marks: { 1: { OVBIM: { KLT: 2 } } } };
  assert.ok(lvOf(spec).findings.some((f) => f.code === "nokey" && f.level === "error"));
  assert.equal(SK.checkLevel("cds", SK.cdsLevel("k", spec).json, "k", OPTS).verdict, V.PROVEN);
  // ống trong hộp khoá đã đầy 1 màu = đã hoàn thành → không cần chìa (V8 từng bắt lỗi này)
  const full = { tubes: ["0 0 0 0", "1 1 1 1", "", ""], orders: [0, 1], marks: { 1: { OVBIM: { KLT: 2 } } } };
  assert.ok(!lvOf(full).findings.some((f) => f.code === "nokey"));
  const s = E.start(lvOf({ tubes: ["1 1 0 0", "0 0", "1 1", ""], orders: [1, 0], marks: { 0: { OBIM: [{ Id: 4, Obj: { Id: 0, TA: 3, CI: 0 }, CI: 0 }] } } }), 0);
  assert.match(E.hopeless(s).kind, /Nắp/, "nắp cần 3 ống màu 0 mà order chỉ có 1");
});

test("stuckkit: không có lstOrderCI + nắp còn nước = lỗi data; mâu thuẫn bị báo LỖI", () => {
  const lv = lvOf({ tubes: ["1 1 1 1", "0 0 0 0", ""], marks: { 0: { OBIM: [{ Id: 4, Obj: { Id: 0, TA: 1, CI: 0 }, CI: 0 }] } } });
  assert.ok(lv.findings.some((f) => f.code === "no-order" && f.level === "error"));
  const sum = SK.summarize([{ verdict: V.ERR, note: "MÂU THUẪN — x", findings: [] }], {});
  assert.equal(sum.verification.contradictions, 1);
  assert.equal(sum.verification.passed, false);
});

test("stuckkit: engine water sort đọc level chuẩn Toolkit", () => {
  const std = LK.normalize({ level: 3, containers: [{ items: ["a", "b", "a", "b"], capacity: 4 }, { items: ["b", "a", "b", "a"], capacity: 4 }, { items: [], capacity: 4 }, { items: [], capacity: 4 }] });
  const r = SK.checkLevel("watersort", std, "std.json", OPTS);
  assert.equal(r.verdict, V.OK);
  assert.ok(r.solution.replayOk);
  const odd = LK.normalize({ containers: [{ items: ["a", "b", "a"], capacity: 4 }, { items: ["b"], capacity: 4 }, { items: [], capacity: 4 }] });
  assert.equal(SK.checkLevel("watersort", odd, "odd.json", OPTS).verdict, V.PROVEN);
  const mech = LK.normalize({ containers: [{ items: ["a"], capacity: 4, marks: [{ type: "ice" }] }] });
  assert.equal(SK.checkLevel("watersort", mech, "m.json", OPTS).verdict, V.SKIP);
});

test("stuckkit: báo cáo .md đủ các mục + hậu kiểm", () => {
  const res = SK.sampleSet().map((s) => SK.checkLevel("cds", s.json, s.name, OPTS));
  const ctl = SK.controls("cds", SK.sampleSet()[0].json, "level_1.txt", OPTS);
  const sum = SK.summarize(res, { controls: ctl, determinism: [{ same: true }], positives: [{ good: true }] });
  assert.equal(sum.counts[V.OK], 3);
  assert.equal(sum.verification.passed, true);
  const md = SK.reportMarkdown({ game: E.name, label: "mẫu", engine: "cds", date: "x", params: "y", model: E.model, rules: E.rules }, res, sum, { controls: ctl });
  for (const h of ["## 1. Tóm tắt", "## 2. Hậu kiểm", "## 3. Level cần xem", "## 4. Kết quả từng level", "## 5. Mô hình", "## 7. Lời giải"]) assert.ok(md.includes(h), h);
  assert.match(md, /Hậu kiểm ĐẠT/);
  assert.match(md, /Bottle\.IsCanAddColor/);
});

test("gói .md: có frontmatter skill, khối thông tin game để điền, 2 ví dụ CDS + BSHP", () => {
  const md = fs.readFileSync(path.join(__dirname, "../../web/docs/check-level-stuck.md"), "utf8");
  assert.match(md, /^---\nname: check-level-stuck\ndescription: /);
  assert.ok(/<!-- GAME-INFO:START -->[\s\S]+<!-- GAME-INFO:END -->/.test(md));
  assert.match(md, /## 7\. Ví dụ 1 — CDS/);
  assert.match(md, /## 8\. Ví dụ 2 — BSHP/);
  assert.match(md, /## 10\. Prompt mẫu/);
});

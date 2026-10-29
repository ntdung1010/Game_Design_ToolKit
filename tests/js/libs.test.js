// Test phần tính toán của các tool phân tích (chạy: node --test tests/js  hoặc  python server.py test)
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../../web/lib/table.js");
const F = require("../../web/lib/funnel.js");
const AB = require("../../web/lib/abtest.js");
const CD = require("../../web/lib/configdiff.js");
const DL = require("../../web/lib/datalint.js");
const CV = require("../../web/lib/curve.js");

test("table: CSV có nháy kép, xuống dòng trong ô, dấu ; và tab", () => {
  const t = T.parseTable('level,name,note\n1,"A, B","dòng 1\ndòng 2"\n2,"say ""hi""",x\n');
  assert.deepEqual(t.headers, ["level", "name", "note"]);
  assert.equal(t.rows[0].name, "A, B");
  assert.equal(t.rows[0].note, "dòng 1\ndòng 2");
  assert.equal(t.rows[1].name, 'say "hi"');
  assert.equal(T.parseTable("a;b\n1;2").rows[0].b, "2");
  assert.equal(T.parseTable("a\tb\n1\t2").rows[0].b, "2");
  assert.deepEqual(T.parseTable("x,x,\n1,2,3").headers, ["x", "x (2)", "Cột 3"]);
});

test("table: đọc số kiểu VN / EN / %", () => {
  assert.equal(T.toNumber("1,234"), 1234);
  assert.equal(T.toNumber("1.234.567"), 1234567);
  assert.equal(T.toNumber("1.234,5"), 1234.5);
  assert.equal(T.toNumber("0.725"), 0.725, "điểm thang 0–1 không được đọc thành 725");
  assert.equal(T.toNumber("1.234"), 1.234, "1 dấu chấm = thập phân như file export");
  assert.equal(T.toNumber("0,725"), 0.725);
  assert.equal(T.toNumber("12.345.678"), 12345678);
  assert.equal(T.toNumber("12,5"), 12.5);
  assert.equal(T.toNumber("12.5%"), 0.125);
  assert.equal(T.toNumber("$3.20"), 3.2);
  assert.equal(T.toNumber("(5)"), -5);
  assert.equal(T.toNumber("abc"), null);
  assert.equal(T.toNumber(""), null);
  assert.equal(T.toLevel("Level_012"), 12);
  assert.equal(T.toDate("12/10/2026"), "2026-10-12");
  assert.equal(T.toDate("20261012"), "2026-10-12");
});

test("table: tự ghép cột tiếng Việt / tiếng Anh, mỗi cột chỉ dùng 1 lần", () => {
  const m = T.autoMap(["Level ID", "Users", "level_start", "Level Win", "Số lượt thua", "version"], F.FIELDS);
  assert.equal(m.level, "Level ID");
  assert.equal(m.users, "Users");
  assert.equal(m.starts, "level_start");
  assert.equal(m.wins, "Level Win");
  assert.equal(m.split, "version");
});

function funnelRows(walls) {
  const rows = [];
  let users = 10000;
  for (let lv = 1; lv <= 60; lv++) {
    const drop = walls[lv] || (lv <= 3 ? 0.08 : 0.02);
    const starts = Math.round(users * (walls[lv] ? 3.2 : 1.5));
    const wins = Math.round(users * (1 - drop));
    rows.push({ level: lv, users: Math.round(users), start: starts, win: wins });
    users = users * (1 - drop);
  }
  return rows;
}

test("funnel: bắt đúng level tường, bỏ qua level đầu game và level cuối", () => {
  const rows = funnelRows({ 24: 0.09, 29: 0.07, 32: 0.11 });
  const r = F.analyze(rows, { level: "level", users: "users", starts: "start", wins: "win" });
  const g = r.groups[0];
  const walls = g.walls.map((x) => x.level).sort((a, b) => a - b);
  assert.deepEqual(walls, [24, 29, 32]);
  assert.equal(g.walls[0].level, 32, "tường nặng nhất xếp đầu");
  assert.ok(Math.abs(g.levels.find((x) => x.level === 24).drop - 0.09) < 0.002);
  assert.equal(g.levels[59].drop, null, "level cuối không có level sau → không tính drop");
  assert.ok(!g.levels.slice(0, 3).some((x) => x.wall), "level 1-3 không bị gắn tường");
  assert.ok(Math.abs(g.kpi.reach10 - Math.pow(0.92, 3) * Math.pow(0.98, 6)) < 0.002, "reach L10 = 0.92³·0.98⁶");
});

test("funnel: không có cột users → ước lượng từ wins; tách nhánh theo version", () => {
  const a = funnelRows({ 20: 0.1 }).map((r) => ({ ...r, ver: "v1" }));
  const b = funnelRows({ 40: 0.1 }).map((r) => ({ ...r, ver: "v2" }));
  const r = F.analyze(a.concat(b), { level: "level", starts: "start", wins: "win", split: "ver" });
  assert.equal(r.groups.length, 2);
  assert.equal(r.groups[0].basis, "wins");
  assert.ok(r.groups[0].walls.some((x) => x.level === 20));
  assert.ok(r.groups[1].walls.some((x) => x.level === 40));
  assert.ok(!r.groups[1].walls.some((x) => x.level === 20));
});

test("funnel: báo lỗi rõ khi thiếu cột", () => {
  assert.throws(() => F.analyze([], { level: "level" }), /Users|Wins/);
});

function abRows({ days = 14, users = 2000, d1 = [0.40, 0.42, 0.40], rev = [0.10, 0.10, 0.10], arms = ["A", "B", "C"], last = 0 }) {
  const rows = [];
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let d = 0; d < days; d++) {
    const date = "2026-09-" + String(d + 1).padStart(2, "0");
    arms.forEach((arm, k) => {
      const u = users + Math.round((rnd() - 0.5) * 100);
      const young = d >= days - last;
      rows.push({ date, arm, installs: u, d1_users: Math.round(u * d1[k]), d7_users: Math.round(u * (young ? 0.05 : 0.15)), revenue: (u * rev[k] * (0.8 + rnd() * 0.4)).toFixed(2) });
    });
  }
  return rows;
}
const abMap = { arm: "arm", users: "installs", date: "date" };
const abMetrics = [
  { col: "d1_users", label: "D1", type: "rate" },
  { col: "d7_users", label: "D7", type: "rate" },
  { col: "revenue", label: "ARPU", type: "mean" },
];

test("ab: nhánh tăng D1 thật được kết luận THẮNG, nhánh giống gốc = tương đương / chưa chắc", () => {
  const r = AB.analyze(abRows({}), abMap, abMetrics, { control: "A", primary: "d1_users" });
  const b = r.comps.find((c) => c.arm === "B").metrics.d1_users;
  const c = r.comps.find((c) => c.arm === "C").metrics.d1_users;
  assert.ok(Math.abs(b.rel - 0.05) < 0.01);
  assert.equal(b.status, "win");
  assert.ok(b.lo > 0 && b.p < 0.001);
  assert.ok(["flat", "unsure"].includes(c.status));
  assert.equal(r.verdict.kind, "win");
  assert.equal(r.verdict.arm, "B");
  assert.ok(r.comps[0].metrics.revenue.lo != null, "doanh thu nhiều dòng/nhánh → có khoảng tin cậy");
});

test("ab: cảnh báo ngày cài cuối chưa đủ tuổi cho D7 và tự bỏ khi chọn", () => {
  const rows = abRows({ last: 5 });
  const r1 = AB.analyze(rows, abMap, abMetrics, { control: "A" });
  assert.ok(r1.warnings.some((w) => /D7/.test(w.text) && w.level === "warn"));
  const r2 = AB.analyze(rows, abMap, abMetrics, { control: "A", excludeLastDays: 7 });
  assert.ok(!r2.warnings.some((w) => /chưa đủ 7 ngày/.test(w.text)));
  assert.equal(r2.cut, "2026-09-07");
  assert.ok(r2.arms[0].values.d7_users.value > r1.arms[0].values.d7_users.value);
});

test("ab: bắt chia nhóm lệch (SRM) và nhánh A/A lệch", () => {
  const rows = abRows({ d1: [0.40, 0.40, 0.40], rev: [0.10, 0.14, 0.10] }).map((r) => r.arm === "B" ? { ...r, installs: r.installs * 1.3 } : r);
  const r = AB.analyze(rows, abMap, abMetrics, { control: "A", aa: "B" });
  assert.ok(r.warnings.some((w) => /SRM/.test(w.text)));
  assert.ok(r.warnings.some((w) => /A\/A/.test(w.text) && w.level === "bad"));
});

test("ab: 1 dòng / nhánh vẫn chạy được (kiểm định 2 tỉ lệ), doanh thu không có CI", () => {
  const rows = [{ arm: "ctrl", installs: 50000, d1_users: 20000, revenue: 5000 }, { arm: "test", installs: 50000, d1_users: 20600, revenue: 5200 }];
  const r = AB.analyze(rows, { arm: "arm", users: "installs" }, [abMetrics[0], abMetrics[2]], { control: "ctrl" });
  assert.equal(r.comps[0].metrics.d1_users.status, "win");
  assert.equal(r.comps[0].metrics.revenue.status, "noci");
  assert.ok(r.mdeRel > 0 && r.mdeRel < 0.05);
  assert.match(AB.summaryText(r, [abMetrics[0], abMetrics[2]], "AB_test"), /test vs ctrl/);
});

test("ab: đoán loại chỉ số và số ngày", () => {
  assert.equal(AB.guessMetric("D7 Retained", [], "u"), "rate");
  assert.equal(AB.guessMetric("ad_revenue", [], "u"), "mean");
  assert.equal(AB.metricDay("retention_d7"), 7);
  assert.equal(AB.metricDay("D1 users"), 1);
  assert.equal(AB.metricDay("revenue"), 0);
});

test("configdiff: báo sai cú pháp đúng dòng/cột, bắt khoá trùng", () => {
  const p = CD.parse('{\n  "a": 1,\n  "b": [1, 2,],\n}');
  assert.equal(p.ok, false);
  assert.equal(p.error.line, 3);
  assert.match(p.error.message, /phẩy thừa/);
  const d = CD.parse('{"a": 1, "x": {"k": 1, "k": 2}, "a": 3}');
  assert.equal(d.ok, true);
  assert.equal(d.dups.length, 2);
  assert.equal(d.value.x.k, 2);
});

test("configdiff: diff + nghi gõ sai tên + list bị xoá sạch + giá trị nhảy bất thường + JSON lồng", () => {
  const A = JSON.stringify({ CDS_Remove_IceTube: [[158, 9]], inter_cooldown: 30, levels: { cap: [1, 2, 3] }, nested: '{"x": 1}' });
  const B = JSON.stringify({ CDS_Remove_IceTubes: [[158, 9]], inter_cooldown: 300, levels: { cap: [] }, nested: '{"x": 2}', added: true });
  const r = CD.compare(A, B);
  assert.ok(r.issues.some((i) => i.kind === "rename" && /CDS_Remove_IceTube/.test(i.detail)));
  assert.ok(r.issues.some((i) => i.kind === "emptied" && i.path === "levels.cap"));
  assert.ok(r.issues.some((i) => i.kind === "jump" && i.path === "inter_cooldown"));
  assert.ok(r.changes.some((c) => c.kind === "changed" && c.path === "nested.x"), "mở được chuỗi JSON lồng");
  assert.ok(r.changes.some((c) => c.kind === "added" && c.path === "added"));
  assert.ok(!r.changes.some((c) => c.path.startsWith("CDS_Remove_IceTube[")), "không liệt kê từng phần tử con của mục bị xoá");
});

test("configdiff: hiểu template Firebase Remote Config + đổi kiểu dữ liệu", () => {
  const fb = (v, c) => JSON.stringify({ parameters: { hint_price: { defaultValue: { value: v }, conditionalValues: { ios: { value: c } } } }, conditions: [{ name: "ios", expression: "device.os == 'ios'" }] });
  const r = CD.compare(fb("100", "120"), fb("100", "150"));
  assert.ok(r.sides.A.firebase);
  assert.ok(r.changes.some((c) => c.path.includes("⟨ios⟩")));
  const t = CD.compare('{"a": 1}', '{"a": "1"}');
  assert.ok(t.issues.some((i) => i.kind === "type"));
});

test("datalint: cột luôn 0, dòng trùng, thiếu level, ngày cuối thiếu dữ liệu", () => {
  const rows = [];
  for (let d = 1; d <= 10; d++) {
    for (const lv of [1, 2, 3, 5, 6]) rows.push({ date: "2026-10-" + String(d).padStart(2, "0"), level: lv, users: d === 10 ? 20 : 100, lose_quit: 0 });
  }
  rows.push({ ...rows[0] });
  const t = { headers: ["date", "level", "users", "lose_quit"], rows };
  const r = DL.lint(t.headers, t.rows, t.headers);
  const titles = r.issues.map((i) => i.title);
  assert.ok(titles.includes("Cột luôn bằng 0"));
  assert.ok(titles.includes("Dòng bị trùng lặp"));
  assert.ok(titles.includes("Thiếu level trong dãy"));
  assert.ok(titles.includes("Ngày cuối có thể chưa đủ dữ liệu"));
  assert.equal(r.verdict.kind, "bad");
  const clean = DL.lint(["level", "users"], [1, 2, 3, 4].map((l) => ({ level: l, users: 100 - l })), ["level", "users"]);
  assert.equal(clean.verdict.kind, "ok");
});

test("curve: sinh đường mục tiêu, tutorial dễ, boss + level nghỉ", () => {
  const c = CV.generate(CV.PRESETS.saw10);
  assert.equal(c.length, 150);
  assert.ok(c.slice(0, 6).every((x) => x.role === "hướng dẫn" && x.target <= CV.PRESETS.saw10.start));
  const b = c.find((x) => x.level === 30), after = c.find((x) => x.level === 31);
  assert.equal(b.role, "boss");
  assert.ok(after.target < b.target - 15);
  assert.ok(c[149].target > c[10].target);
  assert.ok(c.every((x) => x.target >= 0 && x.target <= 100));
});

test("curve: so thực tế, tự đổi thang 0–1, bắt chuỗi khó dài", () => {
  const target = CV.generate({ levels: 20, start: 20, end: 40, shape: "linear", cycle: [0], tutorial: 0 });
  const rows = target.map((t) => ({ level: t.level, score: t.level >= 8 && t.level <= 12 ? 0.85 : t.target / 100 }));
  const r = CV.compare(target, rows, { level: "level", score: "score" }, 10);
  assert.equal(r.scale, 100);
  assert.equal(r.rows.filter((x) => x.flag === "harder").length, 5);
  assert.deepEqual(r.streaks, [{ from: 8, to: 12, len: 5 }]);
  assert.equal(r.within, 15);
});

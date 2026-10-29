// Test Data Lint — phần đánh giá (lib/datareview.js): đọc export Level insight 3 tầng tiêu đề, hậu kiểm, chẩn đoán level.
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../../web/lib/table.js");
const DR = require("../../web/lib/datareview.js");

const P = new Set(["droprate", "win_quit", "mid_quit", "lose_quit", "first_win", "win_rate", "ss_exit"]);
/** Dựng file đúng định dạng export: LV,REACH,,NHÓM… / ,,,droprate,,,… / ,v0,v1,v0,v1,Δ… / avg / từng level. */
function insight(levels, metrics) {
  const f = (k, v) => v == null ? "" : P.has(k) ? (v * 100).toFixed(1) + "%" : String(+v.toFixed(2));
  const h1 = ["LV", "REACH", ""], h2 = ["", "", ""], h3 = ["", "v0", "v1"];
  metrics.forEach((k, i) => { h1.push(i ? "" : "RETENTION IMPACT", "", ""); h2.push(k, "", ""); h3.push("v0", "v1", "Δ"); });
  const rows = levels.map((x) => {
    const r = [x.lv, x.reach, x.reach1 || x.reach];
    metrics.forEach((k) => { const a = x[k], b = x["v1_" + k] != null ? x["v1_" + k] : a; r.push(f(k, a), f(k, b), (b - a < 0 ? "−" : "+") + f(k, Math.abs(b - a))); });
    return r;
  });
  const avg = ["avg", "", ""].concat(metrics.flatMap(() => ["1.0%", "1.0%", "+0.0%"]));
  return T.parseTable([h1, h2, h3, avg].concat(rows).map((r) => r.join(",")).join("\n"));
}
function game(n, patch) {
  const out = [];
  let reach = 6000;
  for (let lv = 1; lv <= n; lv++) {
    const wr = lv % 10 === 0 ? 0.97 : 0.86 - (lv % 3) * 0.01;
    const x = { lv, reach: Math.round(reach), win_rate: wr, first_win: wr * 0.97 + 0.02, attempts: 1 / wr, droprate: 0.012 + (1 - wr) * 0.03,
      lose_quit: 0, win_quit: 0.006, mid_quit: 0.008, pt_win: 80 + (lv % 4) * 5, quit_att: 1.6, ss_exit: 0.18, sfa: 0.2, sra: 0.3, helper: 0.4 };
    Object.assign(x, (patch[lv] || {}));
    out.push(x);
    reach *= 1 - x.droprate;
  }
  return out;
}
const M = ["droprate", "lose_quit", "win_quit", "mid_quit", "attempts", "first_win", "win_rate", "pt_win", "quit_att", "ss_exit", "sfa", "sra", "helper"];

test("datareview: đọc export Level insight 3 tầng tiêu đề (REACH chỉ v0/v1, chỉ số v0/v1/Δ, % và dấu −)", () => {
  const t = insight(game(30, {}), M);
  const p = DR.detect(t);
  assert.equal(p.kind, "level-insight");
  assert.deepEqual(p.versions, ["v0", "v1"]);
  assert.ok(p.metrics.includes("reach") && p.metrics.includes("droprate") && p.metrics.includes("helper"));
  assert.equal(p.levels.length, 30);
  assert.ok(p.avg, "nhận ra hàng avg");
  const lv5 = p.levels.find((x) => x.level === 5);
  assert.ok(Math.abs(lv5.v.v0.win_rate - 0.84) < 1e-9);
  assert.equal(typeof lv5.d.droprate, "number");
});

test("datareview: tường khó → Dễ hơn (đích vẫn khó hơn lân cận), màn dài mà dễ → rút ngắn, hướng dẫn không chấm", () => {
  const patch = {
    1: { droprate: 0.09 },                                                         // màn hướng dẫn: rời nhiều là bình thường
    25: { win_rate: 0.40, first_win: 0.42, attempts: 2.5, droprate: 0.08, quit_att: 3 }, // tường
    33: { win_rate: 0.95, first_win: 0.94, attempts: 1.05, droprate: 0.03, pt_win: 230 },  // dài mà dễ
  };
  const t = insight(game(40, patch), M);
  const p = DR.detect(t);
  const r = DR.review(DR.levelsFor(p, "v0"), {});
  const L = (n) => r.levels.find((x) => x.level === n);
  assert.equal(L(1).status, "hướng dẫn");
  assert.equal(L(1).fix, undefined);
  assert.equal(L(25).status, "đỏ");
  assert.equal(L(25).fix.change, "Dễ hơn");
  assert.ok(L(25).wrTarget > 0.48 && L(25).wrTarget < L(25).targetWR, "đích tăng nhưng vẫn khó hơn lân cận");
  assert.equal(L(25).priority, "P0");
  assert.match(L(33).fix.group, /Quá dài/);
  assert.match(L(33).fix.change, /Rút ngắn/);
  const rows = DR.fixRows(r);
  assert.ok(rows.length >= 2 && rows[0].length === DR.FIX_HEADERS.length);
});

test("datareview: rò sau khi thắng, vùng phẳng chỉ sửa 1 level, không hạ khó level đang kiếm tiền", () => {
  const patch = { 22: { droprate: 0.06, win_quit: 0.045, mid_quit: 0.015 } };
  for (let lv = 31; lv <= 35; lv++) patch[lv] = { win_rate: 0.99, first_win: 0.98, attempts: 1.01 };
  patch[44] = { win_rate: 0.38, first_win: 0.4, attempts: 2.4, droprate: 0.026, sra: 1.6, helper: 1.5 };   // tường nhưng đang kiếm tiền, drop trong kỳ vọng
  patch[45] = { win_rate: 0.98, first_win: 0.97 };
  const r = DR.review(DR.levelsFor(DR.detect(insight(game(50, patch), M)), "v0"), {});
  const L = (n) => r.levels.find((x) => x.level === n);
  assert.match(L(22).fix.group, /Thắng xong/);
  const flat = [31, 32, 33, 34, 35].map(L).filter((x) => x.fix && x.fix.change === "Khó hơn");
  assert.equal(flat.length, 1, "dải phẳng chỉ đề xuất làm khó 1 level");
  assert.equal(L(44).fix.change, "Không sửa");
  assert.match(L(44).fix.what, /doanh thu/);
});

test("datareview: hậu kiểm — event thua không bắn, reach tăng, thiếu mẫu; so sánh v0/v1", () => {
  const lv = game(40, { 15: { win_rate: 0.6 }, 25: { win_rate: 0.6 }, 28: { win_rate: 0.65 } });   // có lượt thua thật
  lv.forEach((x) => { x.v1_droprate = x.droprate + (x.lv === 12 ? 0.04 : 0); });
  lv[20].reach = lv[19].reach * 1.2;
  for (let i = 35; i < 40; i++) lv[i].reach = 20;
  const p = DR.detect(insight(lv, M));
  const a = DR.audit(p, "v0", {});
  const titles = a.map((x) => x.title).join(" | ");
  assert.match(titles, /Event thua không bắn/);
  assert.match(titles, /Reach tăng/);
  assert.match(titles, /thiếu mẫu/);
  assert.ok(a.every((x) => x.level === "info" || x.action), "mỗi lỗi đều có việc cần làm");
  const c = DR.compare(p, {});
  assert.equal(c.control, "v0");
  assert.ok(c.levels.some((x) => x.level === 12 && !x.better), "LV12 v1 mất người hơn rõ");
});

test("datareview: bảng level thường + cohort có ô cuối là ngày chưa đủ", () => {
  const lines = ["level,users,level_start,level_win"];
  let u = 3000;
  for (let lv = 1; lv <= 25; lv++) { lines.push([lv, Math.round(u), Math.round(u * 1.3), Math.round(u * 0.95)].join(",")); u *= 0.97; }
  const p = DR.detect(T.parseTable(lines.join("\n")));
  assert.equal(p.kind, "level-table");
  const r = DR.review(DR.levelsFor(p, p.versions[0]), {});
  assert.ok(Math.abs(r.levels[5].droprate - 0.03) < 0.002, "droprate tính từ users");
  assert.ok(Math.abs(r.levels[5].win_rate - 0.95 / 1.3) < 0.01);

  const c = ["install_date,D0,D1,D2,D3,D4,D5"];
  const day = (k) => "2026-10-" + String(k).padStart(2, "0");
  for (let k = 1; k <= 5; k++) {
    const row = [day(k)];
    for (let d = 0; d <= 5; d++) { const date = k + d; row.push(date > 6 ? "" : date === 6 ? "9.0%" : (40 - d * 4) + ".0%"); }
    c.push(row.join(","));
  }
  const t = T.parseTable(c.join("\n"));
  const cp = DR.detect(t);
  assert.equal(cp.kind, "cohort");
  const iss = DR.auditCohort(t, cp);
  assert.ok(iss.some((x) => /ngày chưa đủ/.test(x.title) && /2026-10-06/.test(x.detail)));
});

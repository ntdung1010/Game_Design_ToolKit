// Test Level Preview — lõi dùng chung (levelkit), bộ đọc từng game (level-adapters), đọc thư mục (levelset),
// vẽ SVG (levelrender), file zip. Chạy: node --test tests/js  hoặc  python server.py test
const test = require("node:test");
const assert = require("node:assert/strict");
const LK = require("../../web/lib/levelkit.js");
const LA = require("../../web/lib/level-adapters.js");
const LS = require("../../web/lib/levelset.js");
const LR = require("../../web/lib/levelrender.js");
const Z = require("../../web/lib/zip.js");

const ad = (id) => LK.adapters.find((a) => a.id === id);
const cell = (ci, extra) => Object.assign({ LP: { x: 0, y: 0, z: 0 }, BIM: { Id: 1, CI: ci, V: true } }, extra || {});
const empty = () => ({ LP: { x: 0, y: 0, z: 0 } });
/** Level runtime (B / C / BIM) nhỏ: 2 ống đầy, 1 ống trống. */
function runtime(extra) {
  return Object.assign({ UCCC: 2, CC: 2, LId: "level_7", lstOrderCI: [9, 3],
    B: [{ Id: 0, P: { x: 0, y: 4 }, C: [cell(9), cell(3), cell(9), cell(3)] },
        { Id: 0, P: { x: 1, y: 4 }, C: [cell(3), cell(9, { BIM: { Id: 2, CI: 9 } }), cell(3), cell(9, { CBIM: { Id: 22, KLT: 1 } })] },
        { Id: 0, P: { x: 2, y: 4 }, C: [empty(), empty(), empty(), empty()], hasVideo: true }] }, extra || {});
}

test("levelkit: số level từ tên file các game", () => {
  const n = (s) => LK.numberFromName(s);
  assert.deepEqual(n("level_24.txt"), { n: 24, v: null, variant: null });
  assert.deepEqual(n("level-v5-0007.json"), { n: 7, v: 5, variant: null });
  assert.deepEqual(n("Level_7_v1.json"), { n: 7, v: 1, variant: null });
  assert.equal(n("level_101_cds_v22.txt").n, 101);
  assert.equal(n("v3magicsort_v3magicsort205_difficulty1-5.txt").n, 205);
  assert.deepEqual(n("loopv12_level501.txt"), { n: 501, v: 12, variant: null }, "loopv12 là phiên bản, không phải level 12");
  assert.equal(n("lv12.txt").n, 12, "lv12 = level 12");
  assert.equal(n("level_024__level_24.png").n, 24);
  assert.equal(n("level_24_2.txt").variant, 2);
  assert.equal(n("BubbleConfig_7.json").n, 7);
  assert.equal(n("README.txt"), null);
});

test("levelkit: lọc level 1-30, 45, 100-", () => {
  const f = LK.parseRange("1-3, 45, 100-");
  assert.deepEqual([1, 2, 3, 4, 45, 99, 100, 5000].filter(f), [1, 2, 3, 45, 100, 5000]);
  assert.equal(LK.parseRange("")(7), true);
  assert.equal(LK.parseRange("1-x"), null);
});

test("adapter CDS: ô dưới→trên, ẩn, chìa, ống ads, đơn hàng, màu theo thứ tự xuất hiện", () => {
  const j = runtime();
  assert.equal(LK.detect(j, "level_7.txt").adapter.id, "cds");
  const [lv] = ad("cds").parse(j, "level_7.txt");
  assert.equal(lv.level, 7);
  assert.deepEqual(lv.containers[0].items.map((i) => i.c), [9, 3, 9, 3], "giữ đúng thứ tự mảng C (C[0] = đáy)");
  assert.equal(lv.containers[1].items[1].hidden, true);
  assert.equal(lv.containers[1].items[3].key, 1);
  assert.equal(lv.containers[2].items.length, 0);
  assert.equal(lv.containers[2].capacity, 4);
  assert.deepEqual(lv.containers[2].marks.map((m) => m.type), ["ads"]);
  assert.deepEqual(lv.orders, [9, 3]);
  assert.equal(lv.palette[9], LK.COLORS[0], "CI gặp đầu tiên → màu đầu bảng (InGameGroup.MapColor)");
  assert.equal(lv.palette[3], LK.COLORS[1]);
  assert.deepEqual(LK.lint(lv), []);
});

test("adapter CDS: nắp, đóng băng, khay, hộp khoá, rèm, ống sinh, ống khổng lồ", () => {
  const j = runtime();
  j.B[0].OBIM = [{ Id: 4, Obj: { TA: 2, CI: 3 } }];
  j.B[1].OBIM = [{ Id: 7, Obj: { TA: 3 } }];
  j.B[2].OBIM = [{ Id: 18, NC: [9, 9, 3, 3] }];
  j.B.push({ Id: 0, P: { x: 3, y: 4 }, C: [empty(), empty()], OVBIM: { KLT: 2 }, isBigBottle: true });
  j.B.push({ Id: 0, P: { x: 4, y: 4 }, C: [empty(), empty()], OVBIM: { KLT: 2 } });
  const [lv] = ad("cds").parse(j, "level_7.txt");
  assert.deepEqual(lv.containers[0].marks[0], { type: "cover", n: 2, c: 3 });
  assert.equal(lv.containers[1].marks[0].type, "ice");
  assert.deepEqual(lv.containers[2].marks.find((m) => m.type === "spawn").items, [9, 9, 3, 3]);
  assert.deepEqual(lv.groups.map((g) => [g.type, g.members]), [["lockbox", [3, 4]]]);
  assert.ok(lv.containers[3].size > 1.5, "ống khổng lồ rộng hơn");
  const st = LK.stats(lv);
  assert.equal(st.marks.lockbox, 1);
  assert.equal(st.marks.cover, 1);
});

test("adapter Chirpy: xếp nhóm thành khối liền trong 1 cột (port LevelLoader.ArrangeGroups)", () => {
  // 6 cành; nhóm hộp khoá #1 ở cành 0 và 3 (khác cột) → phải dồn về cùng 1 cột, liền nhau
  const B = Array.from({ length: 6 }, (_, i) => ({ Id: i, C: [cell(1), cell(2)], OVBIM: i === 0 || i === 3 ? { KLT: 1 } : {} }));
  const out = LA.arrangeGroups(B);
  const pos = out.map((b, i) => ({ id: b.Id, col: i % 2, row: Math.floor(i / 2) }));
  const g = pos.filter((p) => p.id === 0 || p.id === 3);
  assert.equal(g[0].col, g[1].col, "cùng cột");
  assert.equal(Math.abs(g[0].row - g[1].row), 1, "liền nhau");
  assert.deepEqual(out.map((b) => b.Id).sort(), [0, 1, 2, 3, 4, 5], "không mất cành nào");
  // nhóm có thành viên đang ở cột phải (cành 1, 3) → giữ ở cột phải
  const B2 = Array.from({ length: 6 }, (_, i) => ({ Id: i, C: [cell(1)], OVBIM: i === 1 || i === 3 ? { Id: 26, CAI: 2 } : {} }));
  const out2 = LA.arrangeGroups(B2);
  const cols = out2.map((b, i) => [b.Id, i % 2]).filter(([id]) => id === 1 || id === 3).map(([, c]) => c);
  assert.deepEqual(cols, [1, 1], "rèm ở cột phải");
  const j = { LId: "level_3", B, lstOrderCI: [2] };
  assert.equal(LK.detect(j, "level_3_cds.txt").adapter.id, "chirpy", "tên *_cds.txt → Chirpy");
  const [lv] = ad("chirpy").parse(j, "level_3_cds.txt");
  assert.equal(lv.style.container, "branch");
  assert.deepEqual(lv.containers.slice(0, 2).map((c) => c.dir), ["right", "left"], "cột trái bám mép trái");
});

test("adapter Magic Sort: tên file → level + tag độ khó", () => {
  const j = runtime({ LId: "v3magicsort_v3magicsort205_difficulty3-1" });
  const d = LK.detect(j, "v3magicsort_v3magicsort205_difficulty3-1.txt");
  assert.equal(d.adapter.id, "magicsort");
  const [lv] = d.adapter.parse(j, "v3magicsort_v3magicsort205_difficulty3-1.txt");
  assert.equal(lv.level, 205);
  assert.deepEqual(lv.tags, ["độ khó 3"]);
});

test("adapter editor JSON: colorOrder[0] là miệng ống → đảo lại; ẩn / chìa cùng chỉ số", () => {
  const j = { Level_12: { tag: "Hard", objective: ["Red"], lockBags: [{ lockId: 4, coveredTubeIndices: [1] }],
    bottles: [{ x: 0, y: 1, colorOrder: ["Red", "Yellow", null, null], hiddenSegments: [true, false, false, false], keys: [0, 4, 0, 0], hasIce: true, iceCount: 2, iceColor: "Red" },
      { x: 1, y: 1, colorOrder: [null, null, null, null], hasVideo: true }] } };
  assert.equal(LK.detect(j, "x.json").adapter.id, "sort-editor");
  const [lv] = ad("sort-editor").parse(j, "x.json");
  assert.equal(lv.level, 12);
  assert.deepEqual(lv.containers[0].items.map((i) => i.c), ["Yellow", "Red"], "dưới → trên");
  assert.equal(lv.containers[0].items[1].hidden, true, "ẩn đi theo đúng ô (miệng ống)");
  assert.equal(lv.containers[0].items[0].key, 4);
  assert.equal(lv.containers[0].capacity, 4);
  assert.deepEqual(lv.tags, ["Hard"]);
  assert.equal(lv.palette.Red, "#DF2219");
  assert.deepEqual(lv.groups.map((g) => g.type), ["lockbox"]);
});

test("adapter water sort đơn giản + Bird Sort (trứng, lốc xoáy, tier, chim joker)", () => {
  const [w] = LK.detect({ capacity: 4, tubes: [[1, 2, 0, 0], [2, 1], []] }).adapter.parse({ capacity: 4, tubes: [[1, 2, 0, 0], [2, 1], []] }, "lv_3.json");
  assert.deepEqual(w.containers.map((c) => c.items.length), [2, 2, 0], "0 = ô trống");
  const bird = { levelId: 9, tier: 3, clutch: [{ id: 1, slots: 3, birds: [5, 5, 7] }, { id: 2, slots: 2, birds: [7, 7, 5, 10000], frozen: true }, { id: 3, slots: 4, birds: [9, 9, 9, -1], hidden: true }] };
  const d = LK.detect(bird, "level-v4-0009.json");
  assert.equal(d.adapter.id, "birdsort");
  const [lv] = d.adapter.parse(bird, "level-v4-0009.json");
  assert.equal(lv.level, 9);
  assert.deepEqual(lv.tags, ["Super Hard"]);
  assert.equal(lv.style.container, "egg");
  assert.equal(lv.containers[1].items.length, 2);
  const vortex = lv.containers[1].marks.find((m) => m.type === "vortex");
  assert.ok(vortex && vortex.label.endsWith("+2") && vortex.items.length === 1, "chim dư = trứng lốc xoáy (joker không tính màu)");
  assert.ok(lv.containers[0].size > lv.containers[1].size, "trứng nhiều chỗ to hơn");
  assert.equal(lv.containers[2].items[3].wild, true, "chim joker");
  assert.deepEqual(LK.lint(lv).filter((x) => x.code === "colorcount"), [], "5 ×3, 7 ×3, 9 ×3 + joker → không báo");
  lv.containers[0].items.pop();
  assert.equal(LK.lint(lv).filter((x) => x.code === "colorcount").length, 0, "thiếu 1 chim → joker bù được");
  lv.containers[0].items.pop();
  assert.equal(LK.lint(lv).filter((x) => x.code === "colorcount").length, 1, "thiếu 2 chim, 1 joker → báo");
});

test("levelkit: soát lỗi — tràn, hết ô trống, màu thiếu, ống đã xếp sẵn", () => {
  const lv = LK.normalize({ containers: [{ items: [1, 1, 1, 1], capacity: 4 }, { items: [2, 2, 2, 3, 3], capacity: 4 }] });
  const codes = LK.lint(lv).map((x) => x.code).sort();
  assert.deepEqual(codes, ["colorcount", "nofree", "presolved"]);
  assert.equal(LK.worst(LK.lint(lv)), "bad", "hết ô trống = lỗi đỏ");
  assert.equal(LK.lint(lv, { presolved: false }).some((x) => x.code === "presolved"), false);
  const over = LK.normalize({ containers: [{ items: [1, 2, 3], capacity: 2 }, { items: [], capacity: 2 }] });
  over.containers[0].capacity = 2;
  assert.ok(LK.lint(over).some((x) => x.code === "overflow" && x.level === "bad"));
  const ok = LK.normalize({ containers: [{ items: [1, 2, 1, 2] }, { items: [2, 1, 2, 1] }, { items: [] }] });
  assert.deepEqual(LK.lint(ok), []);
  assert.deepEqual(LK.lint(ok, { colorMultiple: 3 }).map((x) => x.code), ["colorcount"]);
  // joker bù chỗ thiếu: màu 1 có 3, màu 2 có 3, + 2 joker → đủ 2 bộ 4
  const wild = LK.normalize({ containers: [{ items: [1, 1, 1, { c: "j", wild: true }] }, { items: [2, 2, 2, { c: "j", wild: true }] }, { items: [] }] });
  assert.deepEqual(LK.lint(wild), []);
  wild.containers[0].items.pop();
  assert.deepEqual(LK.lint(wild).map((x) => x.code), ["colorcount"], "thiếu joker → báo");
  // level có vật chứa khổng lồ: luật riêng, không soát chia hết
  const giant = LK.normalize({ containers: [{ items: [1, 1, 1], capacity: 10, size: 3.6 }, { items: [2, 2, 2, 2] }, { items: [] }] });
  assert.equal(LK.lint(giant).some((x) => x.code === "colorcount"), false);
});

test("levelkit: bố cục không chồng nhau, nằm trong khung (toạ độ so le kiểu CDS, 2 cột, xếp đống)", () => {
  const box = { x: 27, y: 180, w: 486, h: 930 };
  const inside = (p) => p.cx - p.w / 2 >= box.x - 0.5 && p.cx + p.w / 2 <= box.x + box.w + 0.5 && p.cy - p.h / 2 >= box.y - 0.5 && p.cy + p.h / 2 <= box.y + box.h + 0.5;
  const overlap = (a, b) => Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 - 0.5 && Math.abs(a.cy - b.cy) < (a.h + b.h) / 2 - 0.5;
  const check = (lv, label) => {
    const ps = LK.layout(lv, box);
    assert.equal(ps.length, lv.containers.length);
    ps.forEach((p, i) => assert.ok(inside(p), `${label}: #${i} ra ngoài khung`));
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) assert.ok(!overlap(ps[i], ps[j]), `${label}: #${i} chồng #${j}`);
    return ps;
  };
  // vị trí thật của CDS level 24 (hàng so le 12 / 10 / 8 / 7 …)
  const P = [[0, 12], [2, 12], [3, 12], [4, 12], [6, 12], [1, 10], [5, 10], [2, 8], [3, 8], [4, 8], [0, 7], [6, 7], [1, 5], [5, 5], [2, 4], [3, 4], [4, 4], [0, 2], [6, 2], [1, 1], [5, 1], [2, 0], [3, 0], [4, 0]];
  const ps = check(LK.normalize({ containers: P.map(([x, y]) => ({ items: [1], capacity: 4, x: x * 0.57, y: y * 0.42 })) }), "CDS");
  assert.ok(ps[0].w > box.w * 0.08, "ống không bị co quá nhỏ");
  check(LK.normalize({ containers: Array.from({ length: 9 }, () => ({ items: [1, 2], capacity: 4 })) }), "tự xếp");
  check(LK.normalize({ style: { container: "branch" }, layout: "columns2", containers: Array.from({ length: 22 }, () => ({ items: [1], capacity: 4 })) }), "2 cột");
  check(LK.normalize({ style: { container: "egg" }, layout: "pile", containers: Array.from({ length: 17 }, (_, i) => ({ items: [1], capacity: 1 + (i % 5), size: 0.6 + (i % 5) * 0.2 })) }), "đống trứng");
});

test("levelkit: so 2 level — giống / chỉ đổi vị trí / khác (kèm mô tả)", () => {
  const a = LK.normalize({ containers: [{ items: [1, 2], capacity: 4, x: 0, y: 0 }, { items: [], capacity: 4, x: 1, y: 0 }] });
  const b = LK.normalize({ containers: [{ items: [1, 2], capacity: 4, x: 0, y: 0 }, { items: [], capacity: 4, x: 2, y: 0 }] });
  const c = LK.normalize({ containers: [{ items: [1, 2], capacity: 4 }, { items: [], capacity: 4 }, { items: [], capacity: 4, marks: [{ type: "ice", n: 2 }] }], tags: ["Hard"] });
  assert.equal(LK.diff(a, a).status, "same");
  assert.equal(LK.diff(a, b).status, "layout");
  const d = LK.diff(a, c);
  assert.equal(d.status, "changed");
  assert.ok(d.changes.includes("Vật chứa 2 → 3") && d.changes.includes("ice 0 → 1") && d.changes.some((x) => x.startsWith("Tag")), d.changes.join(" | "));
  assert.equal(LK.diff(a, null).status, "onlyA");
});

test("levelkit: game mới — tự đoán cấu trúc file lạ + đọc theo cấu hình", () => {
  const j = { stage: 3, isHard: true, goal: ["red", "blue"], tubes: [{ max: 4, balls: ["red", "blue", "red"] }, { max: 4, balls: ["blue", "red", "blue", "red"] }, { max: 4, balls: [] }] };
  const p = LK.guessMapping(j);
  assert.equal(p.containers, "tubes");
  assert.equal(p.items, "balls");
  assert.equal(p.color, "");
  assert.equal(p.capacity, "max");
  assert.equal(p.orders, "goal");
  assert.equal(p.number, "stage");
  const [lv] = LK.fromMapping(j, p, "stage_3.json");
  assert.equal(lv.level, 3);
  assert.deepEqual(lv.tags, ["Hard"]);
  assert.equal(lv.containers.length, 3);
  assert.equal(LK.colorMap(lv).red, LK.COLORS[0], "tên màu tiếng Anh → đúng màu");
  // mảng thuần [[1,2,0,0]…], 0 = trống, kèm "trên → dưới"
  const raw = [[1, 2, 0, 0], [2, 1, 2, 1], [0, 0, 0, 0]];
  const pr = LK.guessMapping(raw);
  assert.equal(pr.empty, 0);
  const [r] = LK.fromMapping(raw, Object.assign({}, pr, { order: "top" }), "lv5.json");
  assert.deepEqual(r.containers[0].items.map((i) => i.c), [2, 1]);
  // file chứa nhiều level
  const many = { levels: [{ cols: [[1, 1], [2, 2]] }, { cols: [[3, 3], [4, 4]] }] };
  const pm = LK.guessMapping(many);
  assert.equal(pm.levels, "levels");
  assert.deepEqual(LK.fromMapping(many, pm, "pack.json").map((l) => l.level), [1, 2]);
  // adapter từ cấu hình đã lưu
  const m = LK.mappingAdapter(Object.assign({ id: "ball", name: "Ball" }, p));
  assert.ok(m.detect(j) > 0.5 && m.parse(j, "s.json")[0].containers.length === 3);
});

test("levelrender: SVG hợp lệ cho mọi kiểu vật chứa + lưới, không NaN, id riêng mỗi ảnh", () => {
  const styles = [["tube", "liquid"], ["jar", "ball"], ["box", "block"], ["egg", "bird"], ["branch", "bird"]];
  for (const [container, item] of styles) {
    const lv = LK.normalize({ level: 3, tags: ["Super Hard"], orders: [1, 2], style: { container, item },
      containers: [{ items: [1, { c: 2, hidden: true }, { c: 1, key: 3, label: "F2" }], capacity: 4, marks: [{ type: "ice", n: 2 }, { type: "lạ", label: "cơ chế mới" }] },
        { items: [], capacity: 4, marks: [{ type: "ads" }, { type: "spawn", items: [1, 2] }] }, { items: [2, 2], capacity: 4, marks: [{ type: "cover", n: 1, c: 2 }] }],
      groups: [{ type: "lockbox", members: [0, 1] }, { type: "tray", members: [2] }] });
    const svg = LR.toSVG(lv, { uid: "x9" });
    assert.ok(svg.startsWith("<svg") && svg.endsWith("</svg>"), container);
    assert.ok(!/NaN|undefined/.test(svg), container + ": có NaN / undefined");
    assert.equal((svg.match(/<g>/g) || []).length, (svg.match(/<\/g>/g) || []).length - (svg.match(/<g clip-path/g) || []).length, container + ": thẻ g lệch");
    assert.ok(svg.includes("cơ chế mới"), "cơ chế lạ vẫn hiện thành nhãn");
    if (container !== "egg" && container !== "branch") assert.ok(/clipPath id="x9c0"/.test(svg), "clipPath dùng uid");
  }
  const g = LK.normalize({ grid: { cells: [[1, null], [{ block: true }, { c: 2, n: 3 }]] } });
  const svg = LR.toSVG(g, { uid: "g", theme: "light" });
  assert.ok(svg.includes("×3") && !/NaN/.test(svg));
});

test("levelset: chia bộ theo thư mục, ghép bộ ưu tiên, file tag, file thứ tự, bỏ qua file lạ", async () => {
  const f = (text) => ({ size: text.length, text: async () => text });
  const lvText = (ci, id) => JSON.stringify(runtime({ LId: id, B: [{ Id: 0, P: { x: 0, y: 0 }, C: [cell(ci), cell(ci), cell(ci), cell(ci)] }, { Id: 0, P: { x: 1, y: 0 }, C: [empty(), empty(), empty(), empty()] }] }));
  const items = [
    { path: "EA/NewLevel/level_1.txt", file: f(lvText(1, "level_1")) },
    { path: "EA/NewLevel/level_2.txt", file: f(lvText(1, "level_2")) },
    { path: "EA/NewLevel/level_3.txt", file: f(lvText(1, "level_3")) },
    { path: "EA/NewLevel_v22/v22_level_2.txt", file: f(lvText(5, "v22_level_2")) },
    { path: "EA/Daily_v6/level_1.txt", file: f(lvText(7, "level_1")) },
    { path: "EA/Daily_v6/level_2.txt", file: f(lvText(7, "level_2")) },
    { path: "EA/Daily_v6/level_3.txt", file: f(lvText(7, "level_3")) },
    { path: "EA/Daily_v6/level_4.txt", file: f(lvText(7, "level_4")) },
    { path: "EA/Config/LevelConfig_v22.txt", file: f(JSON.stringify({ levelConfigModels: [{ isHard: false }, { isHard: true }, { isSuperHard: true }] })) },
    { path: "EA/list.txt", file: f("level_3\nv22_level_2\nlevel_1\n") },
    { path: "EA/NewLevel/notes.txt", file: f("ghi chú, không phải JSON") },
    { path: "shots/level_001.png", file: f("x") },
    { path: "shots/levels.json", file: f("{\"a\":1}") },
  ];
  const src = await LS.scan(items, "EA");
  const on = src.packs.filter((p) => p.on).map((p) => p.label);
  assert.deepEqual(on, ["EA/NewLevel"], "bộ chính: bắt đầu từ level 1, không phải bộ daily");
  assert.equal(src.tagFiles.length, 1);
  assert.equal(src.orderFiles.length, 1);
  // ghép v22 lên trên NewLevel
  src.packs.find((p) => p.label === "EA/NewLevel_v22").on = true;
  src.packs.sort((a, b) => (b.on - a.on) || LS.packVersion(b.label) - LS.packVersion(a.label));
  src.tagSel = "0";
  LS.buildEntries(src);
  assert.deepEqual([...src.entries.keys()].sort(), [1, 2, 3, "shots"].filter((x) => x !== "shots"));
  assert.equal(src.entries.get(2).file, "v22_level_2.txt", "level trùng số lấy ở bộ trên (v22)");
  assert.equal(src.entries.get(1).file, "level_1.txt");
  assert.deepEqual(src.entries.get(2).lv.tags, ["Hard"]);
  assert.deepEqual(src.entries.get(3).lv.tags, ["Super Hard"]);
  assert.ok(src.skipped.some((p) => p.endsWith("notes.txt")), "file chữ lạ (ghi chú) → bỏ qua, không phải lỗi");
  assert.deepEqual(src.errors, []);
  // chế độ thứ tự theo file danh sách
  src.orderSel = "0";
  LS.buildEntries(src);
  assert.deepEqual([1, 2, 3].map((n) => src.entries.get(n).file), ["level_3.txt", "v22_level_2.txt", "level_1.txt"]);
  // thư mục ảnh chụp: ảnh thành level, file JSON lạ bị bỏ qua chứ không báo lỗi
  const shots = await LS.scan(items.filter((x) => x.path.startsWith("shots/")), "shots");
  LS.buildEntries(shots);
  assert.equal(shots.imagesOnly, false);
  assert.ok(shots.entries.get(1).image);
  assert.deepEqual(shots.errors, []);
  assert.deepEqual(shots.skipped, ["shots/levels.json"]);
  const rows = LS.merge(src, shots);
  assert.equal(rows.find((r) => r.n === 1).diff.status, "image");
});

test("zip: CRC32 chuẩn + cấu trúc file đọc được", () => {
  assert.equal(Z.crc32(new TextEncoder().encode("hello")).toString(16), "3610a686");
  const z = Z.makeZip([{ name: "a.txt", data: "xin chào" }, { name: "thư mục/ảnh.png", data: new Uint8Array([1, 2, 3]) }]);
  const dv = new DataView(z.buffer);
  assert.equal(dv.getUint32(0, true), 0x04034b50);
  const end = z.length - 22;
  assert.equal(dv.getUint32(end, true), 0x06054b50);
  assert.equal(dv.getUint16(end + 10, true), 2);
});

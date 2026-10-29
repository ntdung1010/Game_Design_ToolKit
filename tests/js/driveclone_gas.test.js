// Test Drive Clone bản Apps Script (tools/drive_clone/appsscript): lõi Pipeline.html chạy trên Drive giả lập (port các
// kịch bản của tools/drive_clone/selftest.py) + Code.gs gọi Google API đúng cách (UrlFetchApp giả lập).
// Chạy: node --test tests/js  hoặc  python server.py test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const DIR = path.join(__dirname, "../../tools/drive_clone/appsscript");
const src = (f) => fs.readFileSync(path.join(DIR, f), "utf8");
/** Pipeline.html = 1 thẻ <script> → chạy trong sandbox, lấy biến DC. */
function loadDC() {
  const code = src("Pipeline.html").replace(/^\s*<script>/, "").replace(/<\/script>\s*$/, "");
  const ctx = { module: { exports: {} }, console };
  vm.runInNewContext(code, ctx, { filename: "Pipeline.html" });
  return ctx.module.exports;
}
const DC = loadDC();
/** So sánh sau khi chuẩn hoá JSON — mảng / object tạo trong sandbox vm khác "realm" với test. */
const deq = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);

async function fullRun(drive, manifest, options, stopAfter) {
  const plan = DC.buildPlan(manifest, options);
  let calls = 0;
  const shouldStop = () => stopAfter != null && ++calls > stopAfter;
  const result = await DC.execute(drive, plan, { shouldStop });
  if (!result.dry_run) {
    result.remap = await DC.remapAll(drive, plan, result);
    if (plan.options.build_index && !result.stopped) result.index = await DC.buildIndexTab(drive, plan, result);
  }
  const report = await DC.verify(drive, manifest, plan, result);
  return { plan, result, report };
}
const chk = (rep, id) => rep.checks.find((c) => c.id === id);
async function under(drive, folderId) {
  const out = [], stack = [folderId];
  while (stack.length) {
    const kids = await drive.listChildren(stack.pop());
    for (const c of kids) { out.push(c); if (c.mimeType === DC.FOLDER_MIME) stack.push(c.id); }
  }
  return out;
}
const fails = (rep) => rep.checks.filter((c) => c.status === "FAIL").map((c) => c.id + ": " + c.detail);

test("Drive Clone GAS: đổi tên giữ kiểu chữ, regex, regex sai", () => {
  const r = { from: "BSHP", to: "PRSP", ignore_case: true };
  assert.equal(DC.rename("BSHP_Level", [r]), "PRSP_Level");
  assert.equal(DC.rename("bshp_icon", [r]), "prsp_icon");
  assert.equal(DC.rename("Bshp Notes", [r]), "Prsp Notes");
  assert.equal(DC.rename("BSHP-x-bshp", [r]), "PRSP-x-prsp");
  assert.equal(DC.rename("bshp BSHP", [{ from: "BSHP", to: "PRSP" }]), "bshp PRSP");
  assert.equal(DC.rename("Lv_012", [{ from: "Lv_(\\d+)", to: "Level \\1", regex: true }]), "Level 012", "\\1 kiểu Python vẫn hiểu");
  assert.equal(DC.rename("a$b", [{ from: "a", to: "$1x", regex: true }]), "$1x$b", "$ người dùng gõ giữ nguyên");
  assert.equal(DC.rename("abc", [{ from: "(", to: "x", regex: true }]), "abc");
  assert.ok(DC.ruleProblems([{ from: "(", regex: true }]).length);
  assert.equal(DC.parseId("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing"), "1AbCdEfGhIjKlMnOp");
  assert.equal(DC.parseId("  1AbCdEfGhIjKlMnOp  "), "1AbCdEfGhIjKlMnOp");
});

test("Drive Clone GAS: chế độ DỰNG KHUNG + đổi link master + mục lục + hậu kiểm bắt lỗi", async () => {
  const { drive, source, dest } = DC.demoSeed();
  const manifest = await DC.scan(drive, source);
  assert.equal(manifest.stats.folders, 19);
  assert.ok(manifest.stats.files >= 30);
  assert.equal(manifest.stats.depth, 3);
  assert.ok(manifest.items.some((i) => i.name === "TSM_ Segment ROAS/BLD"), "giữ tên có dấu /");
  const { plan, result, report } = await fullRun(drive, manifest, { dest_parent: dest, content_mode: "skeleton", wrap_root: true,
    new_root_name: "GWP_ Game Design", rename_rules: [{ from: "TSM_", to: "GWP_" }], remap_links: "masters", build_index: true });
  assert.equal(plan.stats.copy, 1, "tự nhận 1 master sheet");
  assert.ok(plan.ops.every((o) => !o.dst_name.startsWith("TSM_")));
  assert.ok(plan.ops.some((o) => o.note.includes("kiểu đặc biệt")), "Google Form xử lý riêng");
  deq(result.failed, []);
  assert.ok(result.remap.links_changed >= 18, String(result.remap.links_changed));
  assert.ok(result.index.rows >= 30);
  const master = result.done.find((o) => o.kind === "copy");
  const text = JSON.stringify(drive.nodes[master.dst_id].sheet);
  assert.ok(text.includes(DC.FOREIGN_ID), "không đụng link ra ngoài cây nguồn");
  assert.ok(!manifest.items.some((i) => text.includes(i.id)), "không còn ID nguồn sót trong master");
  const short = result.done.find((o) => o.kind === "shortcut" && o.src_name.startsWith("Link nhanh"));
  assert.ok(Object.values(result.id_map).includes(drive.nodes[short.dst_id].shortcutDetails.targetId), "shortcut trỏ sang file MỚI");
  assert.ok(report.ok, fails(report).join("; "));

  // cố tình làm hỏng → hậu kiểm phải bắt
  const doc = drive.nodes[master.dst_id].sheet;
  doc.sheets[0].data[0].rowData[1].values[1] = { userEnteredValue: { stringValue: "link hỏng" },
    textFormatRuns: [{ startIndex: 0, format: { link: { uri: DC.viewUrl(manifest.items[0].id, DC.FOLDER_MIME) } } }] };
  assert.equal(chk(await DC.verify(drive, manifest, plan, result), "C5").status, "FAIL", "bắt link còn trỏ bản gốc");
  const bin = result.done.find((o) => o.kind === "skeleton" && !o.dst_mime.startsWith(DC.GOOGLE_PREFIX));
  drive.nodes[bin.dst_id].quotaBytesUsed = "999";
  assert.equal(chk(await DC.verify(drive, manifest, plan, result), "C3").status, "FAIL", "bắt vỏ nhị phân lọt nội dung");
  drive.nodes[bin.dst_id].quotaBytesUsed = "0";
  const docf = result.done.find((o) => o.kind === "skeleton" && o.dst_mime === DC.DOC_MIME);
  drive.nodes[docf.dst_id].quotaBytesUsed = "1024";
  assert.equal(chk(await DC.verify(drive, manifest, plan, result), "C3").status, "PASS", "Google Doc rỗng vẫn tốn dung lượng → không báo nhầm");
  drive.nodes[docf.dst_id].blob = "có chữ";
  assert.equal(chk(await DC.verify(drive, manifest, plan, result), "C3").status, "FAIL", "bắt Google Doc vỏ lọt nội dung");
  drive.nodes[docf.dst_id].blob = "";
  drive.nodes[result.done.find((o) => o.kind === "folder").dst_id].trashed = true;
  assert.equal(chk(await DC.verify(drive, manifest, plan, result), "C1").status, "FAIL", "bắt thư mục bị thiếu");
});

test("Drive Clone GAS: COPY TOÀN BỘ đổ thẳng vào B, Change Log, chạy lại không trùng, C9 bắt tên sót", async () => {
  const { drive, source, dest } = DC.demoSeed();
  const manifest = await DC.scan(drive, source);
  const options = { dest_parent: dest, content_mode: "full", wrap_root: false, rename_rules: [{ from: "TSM_", to: "PRSP_", ignore_case: true }] };
  const { plan, result, report } = await fullRun(drive, manifest, options);
  const files = manifest.items.filter((i) => i.kind === "file");
  assert.equal(plan.stats.copy, files.length);
  deq(result.failed, []);
  const names = (await under(drive, dest)).map((c) => c.name);
  assert.ok(!names.some((n) => n.toLowerCase().includes("tsm_")));
  for (const n of ["prsp_icon.png", "Prsp_Notes", "PRSP_ Piggy Bank"]) assert.ok(names.includes(n), n);
  assert.ok(!names.includes("Game Design"), "đổ thẳng vào B");
  const bySrc = Object.fromEntries(result.done.map((o) => [o.src_id, o.dst_id]));
  assert.ok(files.every((f) => !bySrc[f.id] || drive.nodes[bySrc[f.id]].blob === drive.nodes[f.id].blob), "nội dung giống hệt");
  assert.ok(Object.values(drive.nodes).filter((n) => n.parents.includes(source)).every((n) => !n.name.startsWith("PRSP_")), "nguồn A không bị sửa");
  assert.ok((await under(drive, dest)).every((c) => (c.appProperties || {}).gdk_src), "mọi mục mang dấu gdk_src");
  assert.ok(report.ok, fails(report).join("; "));
  assert.equal(chk(report, "C9").status, "PASS");

  const counts = DC.summarize(result.entries);
  assert.equal(counts.total, manifest.items.length);
  assert.equal(counts.renamed, manifest.items.filter((i) => i.name.toLowerCase().includes("tsm_")).length);
  const csv = DC.toCsv(result.entries).trim().split("\r\n");
  assert.equal(csv[0].split(",")[0], "Time");
  assert.equal(csv.length, result.entries.length + 1);
  assert.equal(DC.toCsv([{ old_name: "=HYPERLINK(1)", size: "-5" }]).split("\r\n")[1].split(",")[4], "'=HYPERLINK(1)", "chống chèn công thức");

  const title = DC.sheetTitle(plan, "2026-10-21T10:00:00");
  const sheet = await DC.writeSheet(drive, result.root_id, title, DC.summaryRows(plan, result, report, counts, title), result.entries);
  const sdoc = drive.nodes[sheet.id].sheet;
  deq(sdoc.sheets.map((s) => s.properties.title).sort(), ["Change Log", "Summary"]);
  assert.equal(sdoc.sheets.find((s) => s.properties.title === "Change Log").data[0].rowData.length, result.entries.length + 1);
  assert.ok((await drive.listChildren(dest)).some((c) => c.id === sheet.id), "Change Log nằm trong thư mục đích");

  // chạy lại lần 2
  const before = (await under(drive, dest)).length;
  const r2 = await fullRun(drive, manifest, options);
  assert.equal(r2.result.done.length, 0);
  assert.equal((await under(drive, dest)).length, before, "lần 2 không tạo mục mới");
  assert.equal(r2.result.existing.length, manifest.items.filter((i) => i.kind !== "folder").length, "nhận ra bản do tool tạo");
  assert.ok(r2.report.ok, fails(r2.report).join("; "));
  assert.equal(chk(r2.report, "C7").status, "PASS", "Change Log không bị tính là mục lạ");
  const victim = (await under(drive, dest)).find((c) => c.name.startsWith("PRSP_"));
  drive.nodes[victim.id].name = victim.name.replace("PRSP_", "TSM_");
  assert.equal(chk(await DC.verify(drive, manifest, r2.plan, r2.result), "C9").status, "FAIL");
});

test("Drive Clone GAS: dừng → chạy tiếp; file cấm copy; B nằm trong A; trùng tên; chạy thử; My Drive", async () => {
  let { drive, source, dest } = DC.demoSeed();
  let manifest = await DC.scan(drive, source);
  const options = { dest_parent: dest, content_mode: "full", wrap_root: true, rename_rules: [{ from: "TSM_", to: "PRSP_" }], remap_links: "masters" };
  const a = await fullRun(drive, manifest, options, 25);
  assert.ok(a.result.stopped && a.result.done.length > 0 && a.result.done.length < manifest.items.length);
  assert.equal(a.report.checks[0].id, "C0", "lần dừng không báo FAIL oan");
  const master = a.result.done.find((o) => o.master);
  assert.ok(master, "master copy ở lần 1");
  const b = await fullRun(drive, manifest, options);
  const roots = (await drive.listChildren(dest)).filter((c) => c.mimeType === DC.FOLDER_MIME);
  assert.equal(roots.length, 1, "gộp vào đúng thư mục gốc cũ");
  assert.equal(a.result.done.length + b.result.done.length, b.plan.stats.active);
  assert.ok(!manifest.items.some((i) => JSON.stringify(drive.nodes[master.dst_id].sheet).includes(i.id)), "master lần 1 vẫn được đổi link ở lần 2");
  assert.ok(b.report.ok, fails(b.report).join("; "));

  ({ drive, source, dest } = DC.demoSeed());
  manifest = await DC.scan(drive, source);
  drive.failIds[manifest.items.find((i) => i.name === "Booster.xlsx").id] = 1;
  const c = await fullRun(drive, manifest, { dest_parent: dest, content_mode: "full" });
  assert.equal(c.result.entries.filter((e) => e.status === "ERROR").length, 1);
  assert.equal(c.result.done.length, c.plan.stats.active - 1);
  assert.ok(chk(c.report, "C8").status === "FAIL" && JSON.stringify(chk(c.report, "C8").rows).includes("Booster"));

  ({ drive, source, dest } = DC.demoSeed());
  const inner = drive._add("Ban sao", DC.FOLDER_MIME, source);
  drive._add("cu.xlsx", DC.XLSX_MIME, inner);
  manifest = await DC.scan(drive, source);
  const d = await fullRun(drive, manifest, { dest_parent: inner, content_mode: "full" });
  assert.ok(d.plan.ops.filter((o) => o.src_parts[0] === "Ban sao").every((o) => o.kind === "skip"), "không copy B vào chính nó");
  assert.ok(!d.result.failed.length && d.report.ok, fails(d.report).join("; "));

  ({ drive, source, dest } = DC.demoSeed());
  drive._add("PRSP_ Hint", DC.FOLDER_MIME, source);
  manifest = await DC.scan(drive, source);
  assert.ok(DC.buildPlan(manifest, { dest_parent: dest, rename_rules: [{ from: "TSM_", to: "PRSP_" }] }).warnings.some((w) => w.includes("PRSP_ Hint")));

  ({ drive, source, dest } = DC.demoSeed());
  manifest = await DC.scan(drive, source);
  const nBefore = Object.keys(drive.nodes).length;
  const e = await fullRun(drive, manifest, { dest_parent: dest, dry_run: true, rename_rules: [{ from: "TSM_", to: "PRSP_" }] });
  assert.equal(Object.keys(drive.nodes).length, nBefore);
  deq(drive.calls, [], "chạy thử không gọi lệnh ghi nào");
  assert.equal(e.result.entries.length, manifest.items.length);

  ({ drive, source, dest } = DC.demoSeed());
  manifest = await DC.scan(drive, source);
  const f = await fullRun(drive, manifest, { dest_parent: "", wrap_root: false, new_root_name: "Ban sao A" });
  const kids = Object.values(drive.nodes).filter((n) => n.parents.length === 1 && n.parents[0] === DC.MY_DRIVE);
  assert.ok(f.plan.dest_parent === DC.MY_DRIVE && f.plan.wrap_root && kids.length === 1 && kids[0].name === "Ban sao A" && f.result.dest_name === "My Drive");
});

test("Drive Clone GAS: chạy trọn 1 lượt (DC.run) + song song cho cùng kết quả", async () => {
  const opts = { content_mode: "full", wrap_root: true, rename_rules: [{ from: "TSM_", to: "PRSP_", ignore_case: true }], remap_links: "masters", write_log_sheet: true };
  const tree = async (workers) => {
    const { drive, source, dest } = DC.demoSeed();
    const manifest = await DC.scan(drive, source, { workers });
    const stages = [];
    const out = await DC.run(drive, manifest, Object.assign({ dest_parent: dest, workers }, opts), { stage: (s) => stages.push(s) });
    const items = (await DC.scan(drive, out.result.root_id)).items.map((i) => i.parts.join("/") + "|" + i.mime).sort();
    return { out, items, stages, entries: out.result.entries.map((e) => e.src_id + e.status) };
  };
  const one = await tree(1), six = await tree(6);
  assert.ok(one.out.ok && six.out.ok);
  assert.ok(six.out.log_sheet && six.out.log_sheet.url.includes("spreadsheets"), "ghi Change Log lên Drive");
  deq(six.stages, ["clone", "remap", "verify", "log", "done"]);
  deq(one.entries, six.entries, "Change Log giữ đúng thứ tự kế hoạch");
  deq(one.items.filter((x) => !x.startsWith("Change Log")), six.items.filter((x) => !x.startsWith("Change Log")), "cây đích giống hệt");
});

// ---------------------------------------------------------------- Code.gs với Google API giả lập
function loadGas(responses) {
  const requests = [];
  let slept = 0;
  const resp = (code, body) => ({ getResponseCode: () => code, getContentText: () => (typeof body === "string" ? body : JSON.stringify(body)),
    getBlob: () => ({ setContentType() {}, bytes: body }) });
  const ctx = {
    ScriptApp: { getOAuthToken: () => "TOKEN" },
    UrlFetchApp: { fetch: (url, opt) => { requests.push({ url, opt }); const r = responses.shift(); if (!r) throw new Error("hết response giả: " + url); return resp(r[0], r[1]); } },
    Utilities: {
      sleep: (ms) => { slept += ms; },
      unzip: (blob) => blob.bytes.map((p) => ({ getName: () => p.name, getDataAsString: () => p.text })),
      newBlob: (text, mime, name) => ({ getName: () => name, getDataAsString: () => text, setDataFromString() { return this; } }),
      zip: (blobs) => ({ getBytes: () => blobs.map((b) => ({ name: b.getName(), text: b.getDataAsString() })) }),
    },
    HtmlService: {}, encodeURIComponent, JSON, Math, Error, String, RegExp,
  };
  vm.runInNewContext(src("Code.gs"), ctx, { filename: "Code.gs" });
  return { ctx, requests, slept: () => slept };
}

test("Code.gs: liệt kê đủ trang, lọc đúng, hỗ trợ Shared Drive, xin appProperties", () => {
  const g = loadGas([[200, { files: [{ id: "A1", name: "BSHP_Level" }], nextPageToken: "P2" }], [200, { files: [{ id: "A2", name: "x.xlsx" }] }]]);
  const kids = g.ctx.listChildren("ROOTID");
  deq(kids.map((k) => k.id), ["A1", "A2"]);
  const u = new URL(g.requests[0].url);
  assert.equal(u.searchParams.get("q"), "'ROOTID' in parents and trashed = false");
  assert.ok(u.searchParams.get("fields").includes("appProperties"));
  assert.equal(u.searchParams.get("supportsAllDrives"), "true");
  assert.equal(u.searchParams.get("includeItemsFromAllDrives"), "true");
  assert.equal(new URL(g.requests[1].url).searchParams.get("pageToken"), "P2");
  assert.equal(g.requests[0].opt.headers.Authorization, "Bearer TOKEN", "dùng token của chính người mở web app");
});

test("Code.gs: copy gửi đúng tên / thư mục cha / dấu gdk_src; 403 rate-limit thì thử lại, 403 cấm copy thì báo ngay", () => {
  const rate = [403, { error: { code: 403, message: "User Rate Limit Exceeded", errors: [{ reason: "userRateLimitExceeded" }] } }];
  const denied = [403, { error: { code: 403, message: "The user does not have permission", errors: [{ reason: "cannotCopyFile" }] } }];
  const g = loadGas([rate, [200, { id: "NEW1" }], denied]);
  assert.equal(g.ctx.copyFile("SRC", "PRSP_Level", "DEST", { gdk_src: "SRC" }), "NEW1");
  assert.ok(g.slept() > 0, "có chờ trước khi thử lại");
  const r = g.requests[1];
  assert.ok(r.url.includes("/files/SRC/copy") && r.opt.method === "post");
  deq(JSON.parse(r.opt.payload), { name: "PRSP_Level", parents: ["DEST"], appProperties: { gdk_src: "SRC" } });
  assert.throws(() => g.ctx.copyFile("SRC2", "y", "DEST"), /permission/);
  assert.equal(g.requests.length, 3, "không thử lại lỗi quyền");
});

test("Code.gs: dán thư mục không do tool tạo → báo rõ cách làm; xlsx đổi link giữ phần không phải XML", () => {
  const g = loadGas([[403, { error: { message: "The user has not granted the app 123 write access to the file X", errors: [{ reason: "appNotAuthorizedToFile" }] } }]]);
  assert.throws(() => g.ctx.createFolder("x", "PARENT"), /không có quyền SỬA thư mục này/);
  const OLD = "OLDID000000000000000000000", NEW = "NEWID11111111111111111111";
  const parts = [{ name: "xl/worksheets/_rels/sheet1.xml.rels", text: `<Relationship Target="https://docs.google.com/spreadsheets/d/${OLD}/edit"/>` },
    { name: "xl/media/image1.png", text: "PNGBYTES" }];
  const x = loadGas([[200, parts], [200, { id: "F" }]]);
  assert.equal(x.ctx.xlsxRemap("F", { [OLD]: NEW }), 1);
  const up = x.requests[1];
  assert.ok(up.url.startsWith("https://www.googleapis.com/upload/drive/v3/files/F") && up.opt.method === "patch" && up.url.includes("uploadType=media"));
  const sent = up.opt.payload;
  assert.ok(sent[0].text.includes(NEW) && !sent[0].text.includes(OLD));
  assert.equal(sent[1].text, "PNGBYTES");
  const y = loadGas([[200, parts]]);
  deq(y.ctx.xlsxLinks("F"), [`https://docs.google.com/spreadsheets/d/${OLD}/edit`]);
});

test("Bộ Apps Script: không cần appsscript.json — code có DriveApp + UrlFetchApp để Apps Script tự xin quyền; Index include đủ file", () => {
  assert.ok(!fs.existsSync(path.join(DIR, "appsscript.json")), "không phát appsscript.json (bỏ bước sửa manifest)");
  const code = src("Code.gs");
  assert.ok(/function xinQuyenDrive_\(\)\s*\{\s*DriveApp\.getRootFolder\(\);/.test(code), "DriveApp → tự xin quyền Drive");
  assert.ok(/UrlFetchApp\.fetch\(/.test(code), "UrlFetchApp → tự xin quyền gọi Google API");
  assert.ok(!/xinQuyenDrive_\(\);/.test(code.replace(/function xinQuyenDrive_\(\)/, "")), "hàm xin quyền không bao giờ được gọi");
  const idx = src("Index.html");
  assert.ok(idx.includes("include('Pipeline')") && idx.includes("include('App')"));
  const app = src("App.html");
  for (const fn of ["whoami", "getFile", "listChildren", "createFolder", "createEmpty", "createShortcut", "copyFile", "exportText", "sheetsGet", "sheetsMeta", "sheetsBatchUpdate", "xlsxRemap", "xlsxLinks"])
    assert.ok(new RegExp("function " + fn + "\\(").test(src("Code.gs")) && app.includes('"' + fn + '"'), "Code.gs + App.html có " + fn);
});

test("Code.gs: include tìm được file lỡ đặt tên App.html (thành App.html.html); thiếu hẳn thì báo rõ cách sửa", () => {
  const files = { "App.html": "<script>app</script>", Pipeline: "<script>dc</script>" };
  const g = loadGas([]);
  g.ctx.HtmlService = { createHtmlOutputFromFile: (n) => { if (!(n in files)) throw new Error("No HTML file named " + n + " was found."); return { getContent: () => files[n] }; } };
  assert.equal(g.ctx.include("Pipeline"), "<script>dc</script>");
  assert.equal(g.ctx.include("App"), "<script>app</script>");
  assert.throws(() => g.ctx.include("Khac"), /Thiếu file HTML "Khac".*3 file/);
});

test("Code.gs: 403 do token thiếu quyền Drive (chưa dán appsscript.json) báo khác 403 do thư mục B không do tool tạo", () => {
  const scope = [403, { error: { code: 403, message: "Request had insufficient authentication scopes.", errors: [{ reason: "insufficientPermissions" }],
    details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] } }];
  const g = loadGas([scope]);
  assert.throws(() => g.ctx.getFile("A"), (e) => /CHƯA ĐƯỢC CẤP QUYỀN DRIVE.*kiemTraQuyen/.test(e.message) && !/quyền SỬA/.test(e.message));
  const h = loadGas([[403, { error: { message: "The user has not granted the app 1 write access to the file B", errors: [{ reason: "appNotAuthorizedToFile" }] } }]]);
  assert.throws(() => h.ctx.createFolder("x", "B"), (e) => /quyền SỬA/.test(e.message) && !/CHƯA ĐƯỢC CẤP/.test(e.message));
});

test("Code.gs: whoami soát quyền token — thiếu quyền Drive thì báo missing, không gọi Drive", () => {
  const g = loadGas([[200, { scope: "https://www.googleapis.com/auth/script.external_request" }]]);
  const u = g.ctx.whoami();
  deq(u.missing, ["https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/drive.file"]);
  assert.equal(g.requests.length, 1, "không gọi Drive about khi thiếu quyền");
  const ok = loadGas([[200, { scope: "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/script.external_request" }],
    [200, { user: { emailAddress: "a@b.c", displayName: "A" } }]]);
  const v = ok.ctx.whoami();
  assert.equal(v.emailAddress, "a@b.c"); deq(v.missing, []);
});

test("Code.gs: phát hiện file HTML tự tạo tên appsscript.json (manifest giả)", () => {
  const g = loadGas([[200, { scope: "https://www.googleapis.com/auth/script.external_request" }]]);
  g.ctx.HtmlService = { createHtmlOutputFromFile: (n) => { if (n !== "appsscript.json") throw new Error("No HTML file"); return { getContent: () => "{}" }; } };
  const u = g.ctx.whoami();
  assert.equal(u.fake_manifest, true);
  assert.equal(u.missing.length, 2);
  const h = loadGas([[200, { scope: "https://www.googleapis.com/auth/drive" }], [200, { user: { emailAddress: "x@y.z" } }]]);
  const v = h.ctx.whoami();
  assert.equal(v.fake_manifest, false); deq(v.missing, [], "quyền Drive đầy đủ cũng được coi là đủ");
});

/**
 * Drive Clone — bản Google Apps Script (web app). Thay cho bản cần "OAuth client loại Desktop app":
 *   • KHÔNG cần tạo gì trên Google Cloud Console, KHÔNG cần credentials.json, KHÔNG cần chạy server.
 *   • Web app chạy với quyền của NGƯỜI ĐANG MỞ (executeAs USER_ACCESSING): mỗi người đăng nhập Google của mình,
 *     bấm "Cho phép" 1 lần, tool đọc / tạo file trên Drive của chính người đó.
 *   • KHÔNG phải sửa appsscript.json: Apps Script tự xin quyền theo code (Drive đầy đủ + gọi Google API) — xem
 *     xinQuyenDrive_() bên dưới. Đánh đổi (user chọn 2026-10-21): màn hình hỏi quyền ghi "xem, sửa, xoá mọi file Drive",
 *     đổi lại thư mục đích B dán được BẤT KỲ thư mục nào bạn có quyền sửa. Tool vẫn chỉ ĐỌC thư mục A và TẠO MỚI trong B,
 *     không sửa / xoá file có sẵn nào.
 *
 * File này chỉ là lớp mỏng gọi Google Drive v3 / Sheets v4. Toàn bộ nghiệp vụ (quét, kế hoạch, clone, đổi link,
 * hậu kiểm, Change Log) chạy trên trình duyệt ở Pipeline.html — mỗi thao tác là 1 lần gọi ngắn nên không vướng giới
 * hạn 6 phút / lần chạy của Apps Script, và chạy song song được.
 * Nguồn: GD Toolkit — tools/drive_clone/appsscript/ (tải bản mới nhất ở trang Drive Clone của Tool Kit).
 */
var DC_VERSION = '2.0';
var DRIVE = 'https://www.googleapis.com/drive/v3';
var UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
var SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
var ITEM_FIELDS = 'id,name,mimeType,size,quotaBytesUsed,shortcutDetails,webViewLink,appProperties';
var FOLDER = 'application/vnd.google-apps.folder';
var SHORTCUT = 'application/vnd.google-apps.shortcut';
var XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
var ID_IN_URL = /(?:\/folders\/|\/d\/|[?&]id=)([A-Za-z0-9_-]{10,})/g;

// ============================================================ trang web
function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('Drive Clone · GD Toolkit')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}
/** <?!= include('Pipeline') ?> trong Index.html (chỉ dùng khi cài kiểu 5 file; bản tải từ Tool Kit đã gộp sẵn vào Index).
 *  Chấp nhận cả file lỡ đặt tên "App.html" (trình soạn thảo hiện thành App.html.html). */
function include(name) {
  var tries = [name, name + '.html'];
  for (var i = 0; i < tries.length; i++) {
    try { return HtmlService.createHtmlOutputFromFile(tries[i]).getContent(); } catch (e) { /* thử tên kế */ }
  }
  throw new Error('Thiếu file HTML "' + name + '". Cách nhanh nhất: tải lại bộ Apps Script từ Tool Kit (chỉ còn 3 file: '
    + 'appsscript.json, Code.gs, Index.html — Index đã gộp sẵn mọi thứ) rồi dán đè Index.html. Hoặc tạo file: bấm + → HTML, '
    + 'gõ đúng "' + name + '" (KHÔNG gõ .html).');
}

// ============================================================ hạ tầng gọi API
function qs_(params) {
  var out = [];
  for (var k in params) if (params[k] !== undefined && params[k] !== null) out.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
  return out.length ? '?' + out.join('&') : '';
}
/** Lỗi 403 / 404 do quyền drive.file (thư mục B không phải do tool tạo) → báo rõ cách làm. */
function message_(code, text) {
  var msg = '', reason = '';
  try {
    var data = JSON.parse(text);
    msg = (data.error && data.error.message) || '';
    reason = ((data.error && data.error.errors) || []).map(function (e) { return e.reason || ''; }).join(' ');
  } catch (e) { msg = String(text || '').slice(0, 300); }
  // (1) token THIẾU QUYỀN Drive: appsscript.json chưa dán / chưa Deploy version mới → Apps Script tự đoán quyền từ code
  //     (chỉ "gọi dịch vụ ngoài"), mọi lệnh Drive đều 403 — kể cả quét A
  if (code === 403 && (/insufficient authentication scopes/i.test(msg) || /insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT/.test(reason + ' ' + text))) {
    return 'HTTP 403 — Web app CHƯA ĐƯỢC CẤP QUYỀN DRIVE. Quản trị viên: dán Code.gs mới (từ Tool Kit) → chạy hàm kiemTraQuyen → Allow '
      + '→ Deploy → Manage deployments → Edit → Version: New version → Deploy. Sau đó mở lại trang và bấm Allow.';
  }
  // (2) có quyền nhưng không được GHI vào thư mục này (quyền tối thiểu drive.file: chỉ ghi vào thư mục do tool tạo)
  if ((code === 403 || code === 404) && /insufficientFilePermissions|appNotAuthorizedToFile/.test(reason)) {
    return 'HTTP ' + code + ' — Tài khoản Google của bạn không có quyền SỬA thư mục này (chỉ được xem). Nhờ chủ thư mục chia sẻ quyền '
      + 'Editor, hoặc chọn thư mục B khác / để trống ô B (= tạo thư mục mới trong My Drive). (Chi tiết: ' + msg + ')';
  }
  if (code === 404) return 'HTTP 404 — Không thấy file / thư mục (sai link, đã xoá, hoặc tài khoản Google này không được chia sẻ). ' + msg;
  return 'HTTP ' + code + (msg ? ' — ' + msg : '');
}
var NEED_SCOPES = ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/drive.file'];
function retryable_(code, text) {
  if (code === 429 || code >= 500) return true;
  return code === 403 && /ateLimitExceeded/.test(text || '');        // 403 thiếu quyền / cấm copy: thử lại vô ích
}
/** Gọi Google API bằng token của người đang dùng; tự thử lại khi bị giới hạn tốc độ. opt: {method, body, raw, contentType, blob} */
function api_(url, opt) {
  opt = opt || {};
  var req = { method: opt.method || 'get', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } };
  if (opt.body !== undefined) { req.contentType = 'application/json'; req.payload = JSON.stringify(opt.body); }
  if (opt.bytes !== undefined) { req.contentType = opt.contentType; req.payload = opt.bytes; }
  var delay = 1000;
  for (var attempt = 0; attempt < 6; attempt++) {
    var res = UrlFetchApp.fetch(url, req), code = res.getResponseCode();
    if (code >= 200 && code < 300) return opt.raw ? res : (res.getContentText() ? JSON.parse(res.getContentText()) : {});
    var text = res.getContentText();
    if (retryable_(code, text) && attempt < 5) { Utilities.sleep(delay + Math.floor(Math.random() * 1000)); delay *= 2; continue; }
    throw new Error(message_(code, text));
  }
  throw new Error('hết lượt thử lại');
}

// ============================================================ đọc
/**
 * KIỂM TRA CÀI ĐẶT — chạy tay trong trình soạn thảo: chọn hàm kiemTraQuyen ở ô cạnh nút ▷ Run → bấm Run → xem Execution log.
 *  • Google hỏi quyền "xem file Google Drive" → appsscript.json ĐÃ đúng → còn lại chỉ cần Deploy → Manage deployments →
 *    Edit → Version: New version → Deploy, rồi mở đúng link /exec của deployment đó.
 *  • Log báo THIẾU → file appsscript.json trong project chưa đúng / chưa lưu (Ctrl + S, xem có báo lỗi không).
 */
function kiemTraQuyen() {
  var info = whoami();
  if (info.fake_manifest) Logger.log('SAI CHỖ: project có file HTML tên "appsscript.json" do bạn tự tạo bằng nút + → Apps Script KHÔNG đọc file này.\n'
    + '→ Xoá file đó (⋮ → Delete). File manifest thật chỉ hiện sau khi Project Settings → tick "Show appsscript.json manifest file in editor".');
  if (info.missing.length) {
    Logger.log('THIẾU quyền: ' + info.missing.join(', ') + '\nĐang có: ' + (info.scopes || []).join(', ')
      + '\n→ File appsscript.json của project đang khoá cứng danh sách quyền ("oauthScopes"). Project Settings → tick "Show appsscript.json '
      + 'manifest file in editor" → mở appsscript.json → XOÁ cả khối "oauthScopes": [ … ], → Ctrl + S → chạy lại hàm này.');
  } else {
    Logger.log('ĐỦ quyền ✓ — tài khoản: ' + info.emailAddress + '\nĐang có: ' + (info.scopes || []).join(', ')
      + '\n→ Giờ Deploy → Manage deployments → Edit (bút chì) → Version: New version → Deploy, rồi mở lại link /exec.');
  }
  return info;
}

/**
 * KHÔNG BAO GIỜ được gọi — chỉ để Apps Script tự nhận quyền cần xin khi project không khai "oauthScopes" trong
 * appsscript.json: thấy DriveApp → xin quyền Google Drive; thấy UrlFetchApp ở trên → xin quyền gọi Google API.
 * Mọi thao tác thật vẫn đi qua Drive / Sheets API (api_) bằng token có các quyền này.
 */
function xinQuyenDrive_() {
  DriveApp.getRootFolder();
}

/** Có file HTML tự tạo tên "appsscript.json" (thành appsscript.json.html) — lỗi cài hay gặp, file này không có tác dụng. */
function hasFakeManifest_() {
  try { HtmlService.createHtmlOutputFromFile('appsscript.json'); return true; } catch (e) { return false; }
}

/** Ai đang dùng + token có đủ quyền Drive chưa (soát ngay khi mở trang, trước khi quét). */
function whoami() {
  var granted = null;
  try {
    var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(ScriptApp.getOAuthToken()), { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) granted = String(JSON.parse(res.getContentText()).scope || '').split(/\s+/).filter(String);
  } catch (e) { /* không soát được thì bỏ qua */ }
  var full = granted && granted.indexOf('https://www.googleapis.com/auth/drive') >= 0;          // quyền Drive đầy đủ cũng đủ dùng
  var missing = granted && !full ? NEED_SCOPES.filter(function (s) { return granted.indexOf(s) < 0; }) : [];
  var out = { emailAddress: '', displayName: '', version: DC_VERSION, scopes: granted, missing: missing, fake_manifest: hasFakeManifest_() };
  if (missing.length) return out;                   // thiếu quyền → about.get chắc chắn 403, trả luôn để trang hướng dẫn sửa
  var u = api_(DRIVE + '/about' + qs_({ fields: 'user(emailAddress,displayName)' })).user || {};
  out.emailAddress = u.emailAddress || ''; out.displayName = u.displayName || '';
  return out;
}
function getFile(id) {
  return api_(DRIVE + '/files/' + encodeURIComponent(id) + qs_({ fields: ITEM_FIELDS + ',parents,trashed', supportsAllDrives: true }));
}
function listChildren(id) {
  var out = [], token = null;
  do {
    var r = api_(DRIVE + '/files' + qs_({
      q: "'" + String(id).replace(/'/g, "\\'") + "' in parents and trashed = false", fields: 'nextPageToken, files(' + ITEM_FIELDS + ')',
      pageSize: 1000, orderBy: 'folder,name', pageToken: token, supportsAllDrives: true, includeItemsFromAllDrives: true }));
    out = out.concat(r.files || []);
    token = r.nextPageToken;
  } while (token);
  return out;
}
/** Xuất nội dung chữ (Doc / Slide) để hậu kiểm file vỏ rỗng. Không xuất được → null. */
function exportText(id) {
  try { return api_(DRIVE + '/files/' + encodeURIComponent(id) + '/export' + qs_({ mimeType: 'text/plain' }), { raw: true }).getContentText(); }
  catch (e) { return null; }
}

// ============================================================ ghi (mọi thứ tạo ra mang appProperties gdk_src = id nguồn)
function create_(body, props) {
  if (props) body.appProperties = props;
  return api_(DRIVE + '/files' + qs_({ supportsAllDrives: true, fields: 'id' }), { method: 'post', body: body }).id;
}
function createFolder(name, parentId, props) { return create_({ name: name, mimeType: FOLDER, parents: [parentId] }, props); }
function createEmpty(name, mime, parentId, props) { return create_({ name: name, mimeType: mime, parents: [parentId] }, props); }
function createShortcut(name, targetId, parentId, props) {
  return create_({ name: name, mimeType: SHORTCUT, parents: [parentId], shortcutDetails: { targetId: targetId } }, props);
}
function copyFile(id, name, parentId, props) {
  var body = { name: name, parents: [parentId] };
  if (props) body.appProperties = props;
  return api_(DRIVE + '/files/' + encodeURIComponent(id) + '/copy' + qs_({ supportsAllDrives: true, fields: 'id' }), { method: 'post', body: body }).id;
}

// ============================================================ Sheets
function sheetsGet(id) {
  var fields = 'spreadsheetId,properties.title,sheets(properties(sheetId,title,index),data(startRow,startColumn,rowData(values('
    + 'userEnteredValue,formattedValue,hyperlink,textFormatRuns,userEnteredFormat.textFormat.link))))';
  return api_(SHEETS + '/' + encodeURIComponent(id) + qs_({ includeGridData: true, fields: fields }));
}
function sheetsMeta(id) {
  return api_(SHEETS + '/' + encodeURIComponent(id) + qs_({ fields: 'sheets.properties(sheetId,title,index)' }));
}
function sheetsBatchUpdate(id, requests) {
  for (var i = 0; i < (requests || []).length; i += 200) {
    api_(SHEETS + '/' + encodeURIComponent(id) + ':batchUpdate', { method: 'post', body: { requests: requests.slice(i, i + 200) } });
  }
  return true;
}

// ============================================================ .xlsx: đổi link bằng cách viết lại XML trong file zip
function remapText_(text, idMap) {
  var hits = 0;
  var out = String(text).replace(new RegExp(ID_IN_URL.source, 'g'), function (m0, old) {
    var nw = idMap[old];
    if (!nw || nw === old) return m0;
    hits++;
    return m0.replace(old, nw);
  });
  return [out, hits];
}
function xlsxParts_(id) {
  var blob = api_(DRIVE + '/files/' + encodeURIComponent(id) + qs_({ alt: 'media', supportsAllDrives: true }), { raw: true }).getBlob();
  blob.setContentType('application/zip');
  return Utilities.unzip(blob);
}
var isXml_ = function (name) { return /\.(xml|rels)$/i.test(name); };
/** Sửa link trong .xlsx do tool tạo. Phần không phải XML giữ nguyên byte (không mất chart / ảnh / định dạng). Trả số link đã đổi. */
function xlsxRemap(id, idMap) {
  var parts = xlsxParts_(id), changed = 0;
  var out = parts.map(function (b) {
    if (!isXml_(b.getName())) return b;
    var r = remapText_(b.getDataAsString('UTF-8'), idMap);
    if (!r[1]) return b;
    changed += r[1];
    return Utilities.newBlob(r[0], 'application/xml', b.getName()).setDataFromString(r[0], 'UTF-8');
  });
  if (!changed) return 0;
  var zip = Utilities.zip(out, 'file.xlsx');
  api_(UPLOAD + '/files/' + encodeURIComponent(id) + qs_({ uploadType: 'media', supportsAllDrives: true, fields: 'id' }),
    { method: 'patch', bytes: zip.getBytes(), contentType: XLSX });
  return changed;
}
/** Các URL có ID Drive trong .xlsx (cho hậu kiểm link). */
function xlsxLinks(id) {
  var urls = [];
  xlsxParts_(id).forEach(function (b) {
    if (!isXml_(b.getName())) return;
    var text = b.getDataAsString('UTF-8'), m, re = /https?:\/\/[^"'<>\s]+/g;
    while ((m = re.exec(text))) if (new RegExp(ID_IN_URL.source).test(m[0])) urls.push(m[0]);
  });
  return urls;
}

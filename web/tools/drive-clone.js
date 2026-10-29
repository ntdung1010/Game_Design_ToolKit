/* Drive Clone — từ v2.0 chạy bằng Google Apps Script (tools/drive_clone/appsscript/). Trang này chỉ: mở web app,
   hướng dẫn quản trị viên cài 1 lần, tải bộ file Apps Script và bản xem thử Demo. Không còn OAuth client / server. */
(() => {
  "use strict";
  const { $, $$, esc, icon, api, toast } = GDK;
  const K = GDK.kit;
  const ID = "drive-clone";
  const call = (action, body) => api(`tools/${ID}/${action}`, body);
  const fileUrl = (name) => GDK.fileUrl(`tools/${ID}/files/${name}`);

  GDK.tools[ID] = { mount };

  function mount(root) {
    const S = { cfg: null, alive: true };
    root.innerHTML = `
      <section class="panel"><div class="pb" id="dcHero"><div class="empty"><span class="spin"></span></div></div></section>
      <section class="panel">
        <div class="ph"><span class="ibox sm">${icon("shield")}</span><h2>Chạy thế nào</h2><span class="sub">không còn OAuth client Desktop app, không cần server</span></div>
        <div class="pb"><div class="cols2 dc-how">
          <div><b>${icon("key")} Chỉ cần đăng nhập Google của bạn</b><p>Drive Clone là một <i>web app Google Apps Script</i> chạy bằng <b>tài khoản của người mở trang</b>. Lần đầu bấm <b>Cho phép</b> là xong — không credentials.json, không Google Cloud Console.</p></div>
          <div><b>${icon("lock")} Chỉ đọc A, chỉ tạo mới trong B</b><p>Google hỏi quyền Drive (“xem, sửa, xoá mọi file”) nhưng tool chỉ <b>đọc</b> thư mục A và <b>tạo mới</b> trong B — không sửa / xoá file có sẵn nào. B dán được bất kỳ thư mục bạn có quyền sửa.</p></div>
          <div><b>${icon("layers")} Đủ tính năng như trước</b><p>Copy toàn bộ / chỉ dựng khung, đổi tên giữ kiểu chữ (BSHP → PRSP), đổi link master sheet, mục lục <span class="mono">_INDEX_AUTO</span>, Change Log trên Drive + CSV, hậu kiểm C1–C9, chạy lại không tạo trùng.</p></div>
          <div><b>${icon("cloud")} Không vướng giới hạn 6 phút</b><p>Mỗi thao tác Drive là 1 lần gọi ngắn, chạy song song từ trình duyệt — thư mục vài nghìn file vẫn chạy được, Dừng / chạy tiếp được.</p></div>
        </div></div>
      </section>
      <section class="panel">
        <div class="ph"><span class="ibox sm">${icon("settings")}</span><h2>Cài 1 lần cho cả team</h2><span class="sub">quản trị viên · khoảng 3 phút</span>
          <div class="right"><a class="btn sm" href="${fileUrl("appsscript.zip")}">${icon("download")} Tải bộ Apps Script (.zip)</a></div></div>
        <div class="pb" id="dcSetup"></div>
      </section>`;
    const el = (s) => $(s, root);

    (async () => {
      try { S.cfg = await call("config"); } catch (e) { S.cfg = { webapp_url: "", files: [], admin: false }; toast(e.message, "bad"); }
      if (!S.alive) return;
      renderHero(); renderSetup();
    })();

    function renderHero() {
      const url = S.cfg.webapp_url;
      el("#dcHero").innerHTML = url ? `
        <div class="dc-hero">
          <span class="ibox">${icon("folder")}</span>
          <div class="grow"><h2 style="margin:0 0 4px">Mở Drive Clone</h2>
            <p class="dim" style="margin:0">Trang mở ra ở tab mới, chạy bằng <b>Google của chính bạn</b>. Lần đầu: chọn tài khoản → <i>Google hasn’t verified this app</i> → <b>Advanced → Go to Drive Clone (unsafe) → Allow</b> (app nội bộ của team, cảnh báo này là bình thường).</p></div>
          <a class="btn primary lg" href="${esc(url)}" target="_blank" rel="noopener">${icon("external")} Mở Drive Clone</a>
        </div>
        <p class="hint">Có nhiều tài khoản Google trên trình duyệt mà trang báo lỗi “Sorry, unable to open the file”? Mở link trong cửa sổ ẩn danh hoặc đăng xuất bớt tài khoản — giới hạn của Apps Script.
          · <a href="${fileUrl("demo.html")}">Tải bản xem thử Demo</a> (không cần Google).</p>`
        : `<div class="note">${icon("info")}<div><b>Chưa cài web app Drive Clone.</b> ${S.cfg.admin ? "Làm theo mục <b>Cài 1 lần cho cả team</b> bên dưới (khoảng 3 phút), rồi dán link web app vào ô cuối." : "Nhờ quản trị viên cài 1 lần (khoảng 3 phút) theo hướng dẫn bên dưới."}
          Trong lúc chờ, bạn có thể <a href="${fileUrl("demo.html")}">tải bản xem thử Demo</a> — mở bằng trình duyệt, chạy trên Drive giả lập.</div></div>`;
    }

    function renderSetup() {
      const files = S.cfg.files || [];
      const copyBtn = (f) => `<button class="btn sm ghost" data-copy="${esc(f)}" title="Copy nội dung file này">${icon("copy")} ${esc(f)}</button>`;
      el("#dcSetup").innerHTML = `
        <ol class="aside-steps dc-steps">
          <li><div>Vào <a href="https://script.google.com/home/projects/create" target="_blank" rel="noopener">script.google.com → New project</a>, đặt tên <b>Drive Clone</b>.</div></li>
          <li><div>Dán <b>2 file</b>, <b>đúng tên</b> — <b>không</b> cần đụng appsscript.json. <b>Code.gs</b>: dán đè file có sẵn. <b>Index</b>: bấm <b>+ → HTML</b>, gõ đúng <b>Index</b> — <b>không</b> gõ “.html”. Bấm để copy từng file:
            <div class="row" style="gap:6px;margin-top:8px">${files.map(copyBtn).join("")}</div>
            <span class="hint">Index.html đã gộp sẵn giao diện + xử lý. Sau đó chọn hàm <b>kiemTraQuyen</b> (ô cạnh nút ▷ Run) → <b>Run</b> → <b>Allow</b> → Execution log phải báo “ĐỦ quyền ✓”.</span></div></li>
          <li><div><b>Deploy → New deployment → Web app</b>: <i>Execute as</i> = <b>User accessing the web app</b>, <i>Who has access</i> = <b>Anyone with Google account</b>
            (công ty dùng Google Workspace: <b>Anyone within &lt;tên miền&gt;</b> — không còn cảnh báo “unverified”). → <b>Deploy</b> → copy <b>Web app URL</b>.</div></li>
          <li><div>Dán link vào ô dưới → <b>Lưu</b>. Từ giờ mọi người bấm <b>Mở Drive Clone</b> ở đầu trang này.</div></li>
        </ol>
        <div class="row" style="margin-top:12px">
          <div class="f"><label class="lb">Web app URL</label><input type="text" id="dcUrl" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(S.cfg.webapp_url)}" ${S.cfg.admin ? "" : "disabled"}></div>
          ${S.cfg.admin ? `<button class="btn primary" id="dcSave">${icon("check")} Lưu</button>` : ""}
        </div>
        ${S.cfg.admin ? "" : `<p class="hint">Chỉ quản trị viên đặt được link này cho cả team.</p>`}
        <p class="hint">Cập nhật bản mới của Drive Clone: dán lại 2 file → <b>Deploy → Manage deployments → Edit → Version: New version</b> (link giữ nguyên).</p>`;
      $$("[data-copy]", el("#dcSetup")).forEach((b) => b.onclick = async () => {
        try {
          const res = await fetch(fileUrl("appsscript/" + b.dataset.copy), { credentials: "same-origin" });
          if (!res.ok) throw new Error("Không tải được " + b.dataset.copy);
          await K.copy(await res.text(), "Đã copy " + b.dataset.copy + " — dán vào file cùng tên trong Apps Script");
        } catch (e) { toast(e.message, "bad"); }
      });
      const sv = el("#dcSave");
      if (sv) sv.onclick = async () => {
        try { S.cfg = Object.assign(S.cfg, await call("save", { webapp_url: el("#dcUrl").value })); toast(S.cfg.webapp_url ? "Đã lưu — mọi người mở được Drive Clone." : "Đã xoá link web app.", "ok"); renderHero(); }
        catch (e) { toast(e.message, "bad"); }
      };
    }

    return {
      cleanup: () => { S.alive = false; },
      sample: () => { location.href = fileUrl("demo.html"); },
      sampleLabel: "Tải bản xem thử Demo (.html)",
    };
  }
})();

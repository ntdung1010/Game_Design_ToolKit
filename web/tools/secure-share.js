/* Mã hoá file — khoá file / đoạn chữ bằng mật khẩu, giải mã file .html / .gdkenc. Chạy hoàn toàn trên máy. */
(() => {
  "use strict";
  const { $, $$, esc, icon, toast } = GDK;
  const K = GDK.kit, SEC = GDK.lib.secure;
  const SAMPLE_PW = "gdk-demo-2026";

  GDK.tools["secure-share"] = { mount };

  function mount(root) {
    const S = { tab: "enc", src: "file", file: null, fmt: "html", pkg: null, busy: false };
    root.innerHTML = `
      <section class="panel">
        <div class="ph"><div class="seg" id="tabs"><button data-t="enc">${icon("lock")} Mã hoá</button><button data-t="dec">${icon("unlock")} Giải mã</button></div>
          <div class="right"><span class="badge ok">${icon("shield")}Chạy trên máy · không gửi lên mạng</span></div></div>
        <div class="pb" id="body"></div>
      </section>
      <section class="panel"><div class="pb">
        <div class="sec-grid">
          <div class="sec-item ok"><span class="lv">${icon("lock")}</span><div>AES-256-GCM<small>mã hoá + phát hiện file bị sửa (kể cả đổi tên)</small></div></div>
          <div class="sec-item ok"><span class="lv">${icon("key")}</span><div>PBKDF2-SHA256 · 600.000 vòng<small>đoán mật khẩu bằng máy cực chậm (chuẩn OWASP)</small></div></div>
          <div class="sec-item warn"><span class="lv">${icon("alert")}</span><div>Quên mật khẩu = mất dữ liệu<small>không có cách khôi phục — lưu mật khẩu ở nơi an toàn</small></div></div>
          <div class="sec-item warn"><span class="lv">${icon("info")}</span><div>Gửi mật khẩu qua kênh khác<small>vd file qua Slack, mật khẩu qua Zalo / gặp trực tiếp</small></div></div>
        </div></div></section>`;
    const el = (s) => $(s, root);
    el("#tabs").onclick = (e) => { const b = e.target.closest("button"); if (b && !S.busy) { S.tab = b.dataset.t; draw(); } };

    function draw() {
      $$("#tabs button", root).forEach((b) => b.classList.toggle("on", b.dataset.t === S.tab));
      S.tab === "enc" ? drawEnc() : drawDec();
    }

    // ------------------------------------------------------------ mã hoá
    function drawEnc() {
      el("#body").innerHTML = `
        <label class="lb">Nội dung cần bảo vệ</label>
        <div class="seg" id="srcSeg" style="margin-bottom:12px"><button data-s="file">${icon("file")} File</button><button data-s="text">${icon("type")} Đoạn chữ</button></div>
        <div id="srcBox"></div>
        <div class="sectit">Định dạng file mã hoá</div>
        <label class="radio-line"><input type="radio" name="fmt" value="html" ${S.fmt === "html" ? "checked" : ""}><span><b>.html tự giải mã</b> — người nhận chỉ cần mở bằng trình duyệt (khuyên dùng)</span></label>
        <label class="radio-line"><input type="radio" name="fmt" value="gdkenc" ${S.fmt === "gdkenc" ? "checked" : ""}><span><b>.gdkenc</b> — gọn hơn, mở bằng tab Giải mã của GD Toolkit</span></label>
        <div class="row" style="margin-top:16px"><button class="btn primary" id="go">${icon("lock")} Đặt mật khẩu &amp; mã hoá</button><span class="hint" id="st" style="margin:0"></span></div>`;
      $$("#srcSeg button", root).forEach((b) => { b.classList.toggle("on", b.dataset.s === S.src); b.onclick = () => { S.src = b.dataset.s; drawEnc(); }; });
      $$('input[name="fmt"]', root).forEach((r) => r.onchange = () => { S.fmt = r.value; });
      const box = el("#srcBox");
      if (S.src === "file") {
        box.innerHTML = S.file ? `<div class="file-chip"><span class="ibox sm">${icon("file")}</span><div class="fc-main"><b>${esc(S.file.name)}</b><span>${GDK.fmtBytes(S.file.size)}</span></div>
            <button class="btn sm" id="chg">${icon("refresh")} Đổi file</button></div>`
          : `<label class="dz" tabindex="0"><input type="file" hidden><span class="dz-ic">${icon("upload")}</span>
            <span class="dz-t">Kéo thả file cần mã hoá vào đây</span><span class="dz-s">hoặc <u>bấm để chọn file</u> · mọi loại file, tối đa 200 MB</span></label>`;
        if (S.file) el("#chg").onclick = () => { S.file = null; drawEnc(); };
        else {
          const dz = box.querySelector(".dz"), inp = box.querySelector("input");
          const take = (f) => { if (f.size > SEC.MAX_BYTES) return toast("File quá lớn (tối đa 200 MB).", "bad"); S.file = f; drawEnc(); };
          inp.onchange = () => inp.files[0] && take(inp.files[0]);
          dz.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inp.click(); } };
          dz.ondragover = (e) => { e.preventDefault(); dz.classList.add("over"); };
          dz.ondragleave = () => dz.classList.remove("over");
          dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove("over"); if (e.dataTransfer.files[0]) take(e.dataTransfer.files[0]); };
        }
      } else {
        box.innerHTML = `<div class="row" style="margin-bottom:8px"><div class="f"><label class="lb">Tên file khi giải mã</label><input type="text" id="tname" value="${esc(S.tname || "ghi_chu.txt")}"></div></div>
          <textarea class="code" id="ttext" rows="8" placeholder="Gõ / dán nội dung cần bảo vệ: số liệu doanh thu, key, ghi chú nội bộ…">${esc(S.ttext || "")}</textarea>`;
        el("#tname").oninput = (e) => { S.tname = e.target.value; };
        el("#ttext").oninput = (e) => { S.ttext = e.target.value; };
      }
      el("#go").onclick = () => encryptNow();
    }

    async function encryptNow() {
      let bytes, name, mime;
      if (S.src === "file") {
        if (!S.file) return toast("Chọn file cần mã hoá trước.", "bad");
        bytes = new Uint8Array(await S.file.arrayBuffer()); name = S.file.name; mime = S.file.type || "application/octet-stream";
      } else {
        if (!(S.ttext || "").trim()) return toast("Chưa có nội dung để mã hoá.", "bad");
        bytes = new TextEncoder().encode(S.ttext); name = (S.tname || "ghi_chu.txt").trim() || "ghi_chu.txt"; mime = "text/plain;charset=utf-8";
      }
      const pw = S.presetPw || await K.askPassword({ title: "Đặt mật khẩu cho file", confirmLabel: "Mã hoá" });
      S.presetPw = null;
      if (!pw) return;
      S.busy = true; el("#go").disabled = true; el("#st").innerHTML = `<span class="spin"></span> Đang mã hoá…`;
      try {
        const pkg = await SEC.encrypt(bytes, pw, { name, mime });
        if (S.fmt === "html") K.download(name + ".gdk.html", SEC.toHtml(pkg), "text/html;charset=utf-8");
        else K.download(name + ".gdkenc", SEC.toJson(pkg), "application/json");
        el("#st").innerHTML = `<span style="color:var(--ok)">${icon("check")} Đã tạo ${esc(name)}${S.fmt === "html" ? ".gdk.html" : ".gdkenc"}</span>`;
        return pkg;
      } catch (e) { toast(e.message, "bad"); el("#st").textContent = ""; }
      finally { S.busy = false; const g = el("#go"); if (g) g.disabled = false; }
    }

    // ------------------------------------------------------------ giải mã
    function drawDec() {
      const p = S.pkg;
      el("#body").innerHTML = p ? `
          <div class="enc-info"><b>${esc(p.name)}</b> · ${GDK.fmtBytes(p.size)} · tạo lúc ${esc(p.created ? new Date(p.created).toLocaleString("vi-VN") : "?")}<br>${esc(p.alg)} · ${esc(p.kdf)} · ${p.iter.toLocaleString("vi-VN")} vòng</div>
          <div class="row" style="margin-top:12px"><div class="f"><label class="lb">Mật khẩu</label><input type="password" id="dpw" autocomplete="off"></div>
            <button class="btn primary" id="dgo">${icon("unlock")} Giải mã</button><button class="btn ghost" id="dchg">${icon("refresh")} File khác</button></div>
          <div id="dout" style="margin-top:12px"></div>`
        : `<label class="dz" tabindex="0"><input type="file" accept=".html,.htm,.gdkenc,.json" hidden><span class="dz-ic">${icon("unlock")}</span>
          <span class="dz-t">Thả file .gdk.html hoặc .gdkenc cần giải mã</span><span class="dz-s">hoặc <u>bấm để chọn file</u></span></label>`;
      if (!p) {
        const dz = el("#body").querySelector(".dz"), inp = dz.querySelector("input");
        const take = async (f) => {
          try { S.pkg = SEC.parsePackage(await f.text()); drawDec(); } catch (e) { toast(e.message, "bad"); }
        };
        inp.onchange = () => inp.files[0] && take(inp.files[0]);
        dz.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inp.click(); } };
        dz.ondragover = (e) => { e.preventDefault(); dz.classList.add("over"); };
        dz.ondragleave = () => dz.classList.remove("over");
        dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove("over"); if (e.dataTransfer.files[0]) take(e.dataTransfer.files[0]); };
        return;
      }
      el("#dchg").onclick = () => { S.pkg = null; drawDec(); };
      const run = async () => {
        const pw = el("#dpw").value;
        if (!pw) return;
        el("#dgo").disabled = true;
        el("#dout").innerHTML = `<span class="spin"></span> Đang giải mã…`;
        try {
          const bytes = await SEC.decrypt(p, pw);
          const isText = /^text\//.test(p.mime) && bytes.length < 300000;
          el("#dout").innerHTML = `${K.verdict("ok", "Giải mã thành công", p.name + " · " + GDK.fmtBytes(bytes.length))}
            <button class="btn primary" id="ddl">${icon("download")} Tải về ${esc(p.name)}</button>
            ${isText ? `<textarea class="code" rows="8" readonly style="margin-top:12px">${esc(new TextDecoder().decode(bytes))}</textarea>` : ""}`;
          el("#ddl").onclick = () => K.download(p.name, new Blob([bytes], { type: p.mime }));
        } catch (e) {
          el("#dout").innerHTML = K.verdict("bad", e.message, "Kiểm tra lại mật khẩu (phân biệt hoa thường, có dấu tiếng Việt hay không).");
        } finally { el("#dgo").disabled = false; }
      };
      el("#dgo").onclick = run;
      el("#dpw").onkeydown = (e) => { if (e.key === "Enter") run(); };
      el("#dpw").focus();
    }

    async function sample() {
      S.tab = "enc"; S.src = "text"; S.tname = "doanh_thu_AB_mau.txt";
      S.ttext = "AB_20261005 — kết quả nội bộ (mẫu)\nNhánh B: D1 +3,9% (95%: +1,2% … +6,6%)\nDoanh thu / user: −5,5% (chưa đủ chắc)\nQuyết định: chạy thêm 7 ngày trước khi rollout.";
      draw();
      el("#st").innerHTML = `<span class="spin"></span> Đang mã hoá mẫu với mật khẩu <b class="mono">${SAMPLE_PW}</b>…`;
      S.busy = true;
      try {
        S.pkg = await SEC.encrypt(new TextEncoder().encode(S.ttext), SAMPLE_PW, { name: S.tname, mime: "text/plain;charset=utf-8" });
      } finally { S.busy = false; }
      S.tab = "dec"; draw();
      el("#dout").innerHTML = `<div class="note info">${icon("info")}<div>Đây là gói mã hoá vừa tạo từ đoạn chữ mẫu. Nhập mật khẩu <b class="mono">${SAMPLE_PW}</b> để giải mã — thử nhập sai để xem tool từ chối.</div></div>`;
      toast("Đã tạo gói mã hoá mẫu — chuyển sang tab Giải mã.", "ok");
    }

    draw();
    return { sample, sampleLabel: "Thử mã hoá → giải mã mẫu" };
  }
})();

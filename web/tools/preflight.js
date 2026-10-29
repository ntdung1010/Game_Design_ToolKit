/* Preflight — soát đề xuất / AB plan / kết quả AB / giao level trước khi gửi sếp. */
(() => {
  "use strict";
  const { $, $$, esc, icon, toast, store } = GDK;
  const K = GDK.kit;

  const num = (s) => /\d/.test(s || "");
  const metricRe = /(d\d+\b|retention|giữ chân|doanh thu|revenue|arpu|arpdau|ltv|droprate|rời bỏ|winrate|tỉ lệ|ti le|%|session|playtime|thời gian chơi|impression|ecpm|iap|level)/i;
  const len = (s, n) => (s || "").trim().length >= n;
  const maxDay = (s) => Math.max(0, ...((s || "").match(/\bd(\d{1,3})\b/gi) || []).map((x) => +x.slice(1)));
  const days = (s) => { const m = (s || "").match(/(\d+)\s*(ngày|day|d\b)/i) || (s || "").match(/(\d+)\s*(tuần|week)/i); return m ? (+m[1]) * (/tuần|week/i.test(m[2]) ? 7 : 1) : null; };

  const TEMPLATES = {
    proposal: {
      label: "Đề xuất tính năng / thay đổi", icon: "sparkles",
      fields: [
        ["title", "Tên đề xuất", "vd Thêm booster “Gợi ý” miễn phí ở level 20–40", 1, "line"],
        ["problem", "Vấn đề hiện tại — kèm số liệu", "vd Rời bỏ ở L24 là 8,5%, gấp 3× các level xung quanh (Level Funnel, AB_20261005)", 1],
        ["goal", "Mục tiêu — chỉ số + mức muốn đạt", "vd Giảm rời bỏ L20–40 từ 3,1% xuống ≤ 2,5% / level", 1],
        ["solution", "Giải pháp", "Làm gì, ở đâu, cho ai", 1],
        ["evidence", "Bằng chứng / tham khảo", "Game gốc, game top, data, AB cũ…", 1],
        ["metrics", "Chỉ số theo dõi + guardrail", "vd Chính: D7. Guardrail: doanh thu / user không giảm"],
        ["risk", "Rủi ro & cách giảm", ""],
        ["measure", "Cách đo kết quả", "vd AB 2 nhánh 50/50, chạy 14 ngày"],
        ["effort", "Công sức / ai làm / ETA", ""],
      ],
      checks: [
        ["Vấn đề có số liệu", (f) => num(f.problem), "Thêm con số: tỉ lệ, level, nguồn data."],
        ["Mục tiêu có chỉ số + con số", (f) => metricRe.test(f.goal) && num(f.goal), "Ghi rõ chỉ số nào, từ bao nhiêu lên bao nhiêu."],
        ["Có bằng chứng / tham khảo", (f) => len(f.evidence, 15), "Dẫn game gốc / game top / data / AB trước."],
        ["Có guardrail (chỉ số không được xấu đi)", (f) => /guardrail|không (được )?(giảm|xấu|tụt)|giữ nguyên|không ảnh hưởng/i.test((f.metrics || "") + " " + (f.risk || "")), "Ghi chỉ số phải giữ nguyên, vd doanh thu / user."],
        ["Có cách đo kết quả", (f) => len(f.measure, 8), "AB hay so trước–sau? Chạy bao lâu?"],
      ],
    },
    abplan: {
      label: "AB test plan", icon: "split",
      fields: [
        ["name", "Tên AB", "vd AB_20261012 booster sớm", 1, "line"],
        ["hypothesis", "Giả thuyết: Nếu … thì … vì …", "vd Nếu tặng 1 booster ở L20 thì rời bỏ L20–40 giảm vì người chơi qua được level khó", 1],
        ["arms", "Các nhánh (gốc + test) — khác nhau ở đâu", "A: gốc (như hiện tại) · B: tặng 1 booster ở L20", 1],
        ["primary", "Chỉ số chính (chỉ 1)", "vd D7 retention", 1, "line"],
        ["guardrails", "Chỉ số bảo vệ (guardrail)", "vd Doanh thu / user, eCPM không giảm quá 2%"],
        ["decision", "Tiêu chí chốt — thắng khi…", "vd B thắng nếu D7 tăng ≥ 3% và khoảng tin cậy 95% không chạm 0", 1],
        ["duration", "Thời gian chạy", "vd 14 ngày (7 ngày cài + 7 ngày đủ tuổi D7)", 1, "line"],
        ["split", "Phân bổ user", "vd 50/50, chỉ user mới Android", 0, "line"],
        ["risk", "Rủi ro", ""],
      ],
      checks: [
        ["Giả thuyết dạng “Nếu … thì … vì …”", (f) => /nếu|if/i.test(f.hypothesis) && /thì|then/i.test(f.hypothesis) && /vì|bởi|do |because/i.test(f.hypothesis), "Viết đủ 3 vế: thay đổi gì → chỉ số nào đổi → tại sao."],
        ["Có nhánh gốc để so", (f) => /gốc|control|baseline|hiện tại|như cũ|a\s*[:=]/i.test(f.arms), "Ghi rõ nhánh A = gốc / control."],
        ["Chỉ 1 chỉ số chính", (f) => len(f.primary, 2) && !/[,;+&]| và | and /i.test(f.primary.trim()), "Chọn 1 chỉ số chính; các chỉ số khác đưa vào guardrail."],
        ["Tiêu chí chốt có con số", (f) => num(f.decision), "vd “tăng ≥ 3%”, “không giảm quá 2%”."],
        ["Thời gian đủ cho chỉ số", (f) => { const need = Math.max(7, maxDay(f.primary + " " + f.guardrails) + 7), d = days(f.duration); return d != null && d >= need; },
          (f) => { const md = maxDay(f.primary + " " + f.guardrails); return md ? `Đo D${md} cần chạy ≥ ${Math.max(7, md + 7)} ngày (${md + 7 > 7 ? "7 ngày cài + " + md + " ngày đủ tuổi" : "tối thiểu 1 tuần"}).` : "Chạy tối thiểu 7 ngày để đủ chu kỳ tuần."; }],
        ["Có guardrail", (f) => len(f.guardrails, 5), "Thêm chỉ số không được xấu đi (doanh thu, eCPM…)."],
      ],
    },
    abresult: {
      label: "Đọc kết quả AB", icon: "bars",
      fields: [
        ["name", "Tên AB", "", 1, "line"],
        ["result", "Kết quả chỉ số chính — số + khoảng tin cậy", "vd D1 +5,0% (95%: +2,9% … +7,1%) — dán từ AB Readout", 1],
        ["guardrails", "Chỉ số bảo vệ", "vd Doanh thu / user +0,8% (chưa đủ chắc)", 1],
        ["why", "Vì sao thắng / thua", "Giả thuyết đúng hay sai? Dữ liệu nào cho thấy?", 1],
        ["caveats", "Lưu ý dữ liệu", "Chia nhóm lệch? Ngày cuối? Nhánh A/A?"],
        ["learning", "Bài học", "", 1],
        ["decision", "Quyết định & bước tiếp", "vd Rollout B 100%, theo dõi D7 tuần tới", 1],
      ],
      checks: [
        ["Kết quả có con số", (f) => num(f.result), "Ghi % chênh lệch."],
        ["Có khoảng tin cậy / độ chắc", (f) => /khoảng|ci\b|95%|±|…|\.\.\.|p\s*[<=]|ý nghĩa|significant/i.test(f.result), "Dán khoảng tin cậy 95% từ AB Readout."],
        ["Có giải thích vì sao", (f) => len(f.why, 20), "1–2 câu: cơ chế nào làm chỉ số đổi."],
        ["Đã kiểm tra dữ liệu", (f) => len(f.caveats, 5), "Ghi đã kiểm SRM / ngày cuối / A/A chưa."],
        ["Quyết định rõ ràng", (f) => /chọn|giữ|bỏ|rollout|tung|dừng|chạy tiếp|chạy lại|ship|áp dụng/i.test(f.decision), "Chốt: chọn nhánh nào / chạy tiếp / dừng."],
      ],
    },
    handoff: {
      label: "Giao level / config", icon: "layers",
      fields: [
        ["what", "Giao gì", "vd Pack level v28 (L25–35 làm mềm) + remote config", 1, "line"],
        ["scope", "Phạm vi", "vd Level 25–35, key CDS_Level_Ver", 1],
        ["changes", "Thay đổi chính", "Liệt kê ngắn từng thay đổi", 1],
        ["tested", "Đã kiểm tra", "vd Stuck check 11/11 OK, chơi thử L25–35, Config Diff không lỗi", 1],
        ["config", "Remote config: key + giá trị", "vd CDS_Level_Ver = 28 (Android, 50%)"],
        ["rollback", "Cách rollback", "vd Đổi CDS_Level_Ver về 18", 1],
        ["notes", "Ghi chú cho dev / QA", ""],
      ],
      checks: [
        ["Phạm vi có số level / tên key", (f) => num(f.scope) || /[A-Z_]{4,}/.test(f.scope), "Ghi rõ level nào / key nào."],
        ["Đã ghi cách kiểm tra", (f) => len(f.tested, 10), "Stuck check, chơi thử, hậu kiểm…"],
        ["Có cách rollback", (f) => len(f.rollback, 6), "Nếu lỗi thì quay lại thế nào?"],
        ["Config đã soát (nếu có)", (f) => !len(f.config, 2) || /diff|soát|kiểm tra|check|ok/i.test(f.tested + " " + f.config), "Chạy Config Diff trước khi giao và ghi vào mục Đã kiểm tra."],
      ],
    },
  };

  GDK.tools.preflight = { mount };

  function mount(root) {
    const S = { type: store.get("gdk.preflight.type", "abplan"), fmt: store.get("gdk.preflight.fmt", "slack"), t: null };
    const draftKey = () => "gdk.preflight.draft." + S.type;
    root.innerHTML = `
      <section class="panel">
        <div class="ph"><span class="step">1</span><h2>Loại tài liệu</h2></div>
        <div class="pb"><div class="choice" id="types" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">${Object.entries(TEMPLATES).map(([k, t]) =>
          `<button data-t="${k}"><span class="ibox">${icon(t.icon)}</span><span><b class="ttl">${esc(t.label)}</b></span></button>`).join("")}</div></div>
      </section>
      <div class="split2" style="margin-top:0">
        <section class="panel"><div class="ph"><span class="step">2</span><h2>Điền nội dung</h2><div class="right"><button class="btn sm ghost" id="clr">${icon("trash")} Xoá nháp</button></div></div>
          <div class="pb" id="form"></div></section>
        <div>
          <section class="panel"><div class="ph"><span class="step">3</span><h2>Checklist</h2><div class="right" id="score"></div></div><div class="pb" id="checks"></div></section>
          <section class="panel"><div class="ph"><span class="step">4</span><h2>Bản gửi</h2>
            <div class="right"><div class="seg" id="fmt"><button data-f="slack">Slack</button><button data-f="md">Markdown</button></div></div></div>
            <div class="pb"><textarea class="code" id="out" rows="14" readonly></textarea>
              <div class="row" style="margin-top:10px"><button class="btn primary" id="copy">${icon("copy")} Copy bản gửi</button><button class="btn" id="dl">${icon("download")} Tải .md</button></div></div></section>
        </div>
      </div>`;
    const el = (s) => $(s, root);

    function form() {
      const t = TEMPLATES[S.type], d = store.get(draftKey(), {});
      $$("#types button", root).forEach((b) => b.classList.toggle("on", b.dataset.t === S.type));
      el("#form").innerHTML = t.fields.map(([k, label, ph, req, kind]) => `<div class="field"><label class="lb">${esc(label)}${req ? ' <span class="req">*</span>' : ""}</label>
        ${kind === "line" ? `<input type="text" data-k="${k}" placeholder="${esc(ph)}" value="${esc(d[k] || "")}">`
          : `<textarea data-k="${k}" rows="${req ? 3 : 2}" placeholder="${esc(ph)}">${esc(d[k] || "")}</textarea>`}</div>`).join("");
      $$("#form [data-k]", root).forEach((i) => i.oninput = () => { clearTimeout(S.t); S.t = setTimeout(check, 150); });
      check();
    }
    function values() {
      const f = {};
      $$("#form [data-k]", root).forEach((i) => { f[i.dataset.k] = i.value; });
      return f;
    }
    function check() {
      const t = TEMPLATES[S.type], f = values();
      store.set(draftKey(), f);
      const missing = t.fields.filter(([k, , , req]) => req && !(f[k] || "").trim());
      const res = t.checks.map(([label, test, hint]) => ({ label, ok: !!test(f), hint: typeof hint === "function" ? hint(f) : hint }));
      const total = res.length + 1, okN = res.filter((x) => x.ok).length + (missing.length ? 0 : 1);
      el("#score").innerHTML = `<span class="badge ${okN === total ? "ok" : okN >= total - 1 ? "warn" : "bad"}">${okN}/${total} đạt</span>`;
      el("#checks").innerHTML = K.issueList([
        { level: missing.length ? "bad" : "ok", title: missing.length ? `Còn ${missing.length} mục bắt buộc trống` : "Đã điền đủ mục bắt buộc", detail: missing.map((m) => m[1]).join(" · ") },
        ...res.map((x) => ({ level: x.ok ? "ok" : "bad", title: x.label, detail: x.ok ? "" : x.hint })),
      ]) + (okN === total ? `<p class="hint" style="color:var(--ok)">${icon("check")} Sẵn sàng gửi.</p>` : "");
      $$("#fmt button", root).forEach((b) => b.classList.toggle("on", b.dataset.f === S.fmt));
      el("#out").value = render(t, f, S.fmt);
    }
    function render(t, f, fmt) {
      const b = (s) => fmt === "slack" ? `*${s}*` : `**${s}**`;
      const title = f.title || f.name || f.what || "(chưa đặt tên)";
      const lines = [`${b(`[${t.label}] ${title}`)}`, ""];
      for (const [k, full] of t.fields) {
        if (["title", "name", "what"].includes(k) && (f[k] || "") === title) continue;
        const v = (f[k] || "").trim();
        if (!v) continue;
        const label = full.split(/ — |: | \(/)[0];   // "Giả thuyết: Nếu … thì …" → "Giả thuyết"
        lines.push(v.includes("\n") ? `${b(label)}\n${v.split("\n").map((x) => "• " + x.replace(/^[-•*]\s*/, "")).join("\n")}` : `• ${b(label)}: ${v}`);
      }
      return lines.join("\n");
    }

    $$("#types button", root).forEach((b) => b.onclick = () => { S.type = b.dataset.t; store.set("gdk.preflight.type", S.type); form(); });
    $$("#fmt button", root).forEach((b) => b.onclick = () => { S.fmt = b.dataset.f; store.set("gdk.preflight.fmt", S.fmt); check(); });
    el("#copy").onclick = () => K.copy(el("#out").value, "Đã copy bản gửi");
    el("#dl").onclick = () => K.download(((values().title || values().name || "tai_lieu").replace(/[^\w\-]+/g, "_")) + ".md", el("#out").value, "text/markdown;charset=utf-8");
    el("#clr").onclick = () => { if (confirm("Xoá nháp của loại tài liệu này?")) { store.set(draftKey(), {}); form(); } };

    function sample() {
      S.type = "abplan"; store.set("gdk.preflight.type", S.type);
      store.set(draftKey(), {
        name: "AB_20261012 booster sớm",
        hypothesis: "Nếu tặng 1 booster Gợi ý ở level 20 thì rời bỏ L20–40 giảm vì người chơi qua được các level tường L24, L29",
        arms: "A: gốc (như hiện tại)\nB: tặng 1 booster Gợi ý khi vào L20",
        primary: "D7 retention",
        guardrails: "Doanh thu / user, eCPM",
        decision: "B tốt hơn A rõ ràng",
        duration: "5 ngày",
        split: "50/50 user mới Android",
      });
      form();
      toast("Đã nạp AB plan mẫu — có 2 mục chưa đạt để xem tool bắt lỗi.", "ok");
    }
    form();
    return { cleanup: () => clearTimeout(S.t), sample, sampleLabel: "Thử với AB plan mẫu" };
  }
})();

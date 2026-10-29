"""Bộ tool phân tích dùng chung cho mọi game puzzle — chạy hoàn toàn trên trình duyệt
(phần tính toán ở web/lib/*.js, giao diện ở web/tools/<id>.js, test ở tests/js/).

Mỗi tool chỉ cần dữ liệu dạng chung (CSV / Excel / JSON), không phụ thuộc định dạng level
hay luật chơi của game nào.
"""

TOOLS = [
    {
        # tạm ẩn khỏi trang chủ / tìm kiếm để sửa (2026-10-13) — xoá dòng "hidden" để hiện lại
        "hidden": True,
        "id": "level-funnel", "order": 10, "name": "Level Funnel", "icon": "funnel", "freq": "Hằng ngày",
        "category": "Dữ liệu & AB",
        "tagline": "Tìm level “tường” làm người chơi bỏ game",
        "desc": "Thả file số liệu theo level (user / start / win / lose). Tool vẽ đường giữ chân, tỉ lệ rời bỏ "
                "từng level và chỉ ra level “tường” kèm gợi ý sửa. So được nhiều version / nhánh AB cùng lúc.",
        "tags": ["level", "funnel", "droprate", "wall", "tường", "retention", "churn"],
        "scripts": ["lib/table.js", "lib/funnel.js"],
        "example": {
            "headline": "Thả file level insight → tool chỉ ra L24, L29, L32 là tường: tỉ lệ rời bỏ gấp 2–4× "
                        "các level xung quanh, kèm gợi ý nên sửa gì.",
            "input": "1 dòng / level: level, users, start, win, lose (+ cột version nếu muốn so nhiều bản).",
            "steps": ["Thả file CSV / Excel, hoặc dán từ Google Sheets",
                      "Kiểm tra các cột tool tự nhận (Level, Users, Start, Win…)",
                      "Đọc danh sách level tường + biểu đồ, xuất CSV"],
        },
    },
    {
        # tạm ẩn khỏi trang chủ / tìm kiếm để sửa (2026-10-13) — xoá dòng "hidden" để hiện lại
        "hidden": True,
        "id": "ab-readout", "order": 20, "name": "AB Readout", "icon": "split", "freq": "Hằng tuần",
        "category": "Dữ liệu & AB",
        "tagline": "Đọc kết quả AB: thắng, thua hay chưa đủ chắc",
        "desc": "Thả bảng số liệu theo nhánh (D1, D7, doanh thu…). Tool tính chênh lệch kèm khoảng tin cậy, ra câu "
                "chốt rõ ràng và tự cảnh báo bẫy: chia nhóm lệch, ngày cài cuối chưa đủ tuổi, nhánh A/A lệch.",
        "tags": ["ab", "ab test", "experiment", "retention", "revenue", "arpu", "significance", "srm"],
        "scripts": ["lib/table.js", "lib/abtest.js"],
        "example": {
            "headline": "Nhánh B: D1 +3,9% (khoảng tin cậy +1,2% … +6,6%) → THẮNG. Tool tự bỏ 7 ngày cài cuối vì D7 "
                        "chưa đủ tuổi, kiểm tra nhánh A/A không lệch, và soạn sẵn đoạn tóm tắt dán Slack.",
            "input": "Mỗi dòng: nhánh, số user, các chỉ số (d1_users, d7_users, revenue…). Có cột ngày cài càng tốt.",
            "steps": ["Thả file cohort theo nhánh (theo ngày cài hoặc tổng)",
                      "Chọn nhánh gốc, chỉ số chính, các chỉ số phụ",
                      "Đọc câu chốt + biểu đồ chênh lệch, copy tóm tắt"],
        },
    },
    {
        "id": "config-diff", "order": 30, "name": "Config Diff", "icon": "braces", "freq": "Mỗi lần đổi config",
        "category": "Config",
        "tagline": "So & soát Remote Config trước khi đẩy lên",
        "desc": "Dán 2 bản JSON (đang live và bản mới) — kể cả template Firebase Remote Config. Tool liệt kê "
                "thay đổi và bắt lỗi: sai cú pháp, khoá trùng, nghi gõ sai tên trường, list bị xoá sạch, "
                "đổi kiểu dữ liệu, giá trị nhảy bất thường.",
        "tags": ["remote config", "firebase", "json", "diff", "config", "validator"],
        "scripts": ["lib/configdiff.js"],
        "example": {
            "headline": "Bản mới đổi “CDS_Remove_IceTube” thành “CDS_Remove_IceTubes” → tool báo đỏ: game đọc tên "
                        "cũ sẽ không thấy giá trị, list bị xoá sạch.",
            "input": "2 đoạn JSON bất kỳ, hoặc file template tải từ Firebase Remote Config.",
            "steps": ["Dán / thả bản đang live vào ô trái",
                      "Dán / thả bản mới vào ô phải (chỉ 1 ô = chỉ soát lỗi)",
                      "Xử lý hết lỗi đỏ trước khi publish"],
        },
    },
    {
        "id": "data-lint", "order": 40, "name": "Data Lint", "icon": "table-check", "freq": "Mỗi file export",
        "category": "Dữ liệu & AB",
        "tagline": "Soát & đánh giá file dữ liệu, chỉ ra level nên sửa",
        "desc": "Thả export Level insight / bảng level / cohort / bất kỳ CSV, Excel nào. Tool hậu kiểm số liệu (event không "
                "bắn, droprate lệch reach, thiếu mẫu, ngày chưa đủ…), chấm từng level theo giai đoạn, chẩn đoán vấn đề "
                "và đưa ra việc cần làm: sửa gì, sửa thế nào, dễ hơn hay khó hơn — kèm so sánh v0 / v1.",
        "tags": ["data", "csv", "export", "lint", "kiểm tra", "tracking", "quality", "level insight", "droprate",
                 "win rate", "review", "đánh giá", "sửa level", "cohort"],
        "scripts": ["lib/table.js", "lib/datalint.js", "lib/datareview.js"],
        "example": {
            "headline": "LV24: win rate 38% tụt 28pp so với LV23, droprate 8,5% → “Tường / spike khó — Dễ hơn”: nới về ~66% "
                        "hoặc chèn level đệm. lose_quit = 0 ở mọi level → event thua không bắn, đọc mid_quit là túi gộp.",
            "input": "Export “Level insight tool” (tiêu đề 3 tầng, v0 / v1 / Δ), bảng level + users / start / win, cohort "
                     "D0…Dn, hoặc bất kỳ bảng nào có dòng tiêu đề.",
            "steps": ["Thả file CSV / Excel", "Đọc Tổng quan: kết luận nhanh + việc cần làm",
                      "Tab Đánh giá level: lọc “Cần sửa”, chỉnh ngưỡng giai đoạn nếu cần",
                      "Tải / copy danh sách sửa level dán vào Google Sheet"],
        },
    },
    {
        "id": "curve-planner", "order": 50, "name": "Curve Planner", "icon": "trending", "freq": "Mỗi pack level",
        "category": "Level",
        "tagline": "Thiết kế đường độ khó & so với thực tế",
        "desc": "Chọn mẫu (răng cưa, boss, nhẹ nhàng…) hoặc tự chỉnh: số level, độ khó đầu–cuối, nhịp, boss, level "
                "nghỉ. Dán điểm độ khó thực tế để tool chỉ level nào khó / dễ hơn mục tiêu và chuỗi khó quá dài.",
        "tags": ["difficulty", "curve", "độ khó", "level", "pacing", "boss", "sawtooth"],
        "scripts": ["lib/table.js", "lib/curve.js"],
        "example": {
            "headline": "Mẫu “Răng cưa 10 + boss”: boss mỗi 10 level, level ngay sau là level nghỉ. Dán điểm thực "
                        "tế → L41–L45 là chuỗi 5 level khó liên tiếp, cần chèn level nghỉ.",
            "input": "Không cần file để thiết kế. Muốn so thực tế: cột level + điểm độ khó (0–100, 0–10 hay 0–1 đều được).",
            "steps": ["Chọn mẫu, chỉnh thanh trượt cho hợp game", "Dán điểm thực tế (không bắt buộc)",
                      "Xuất CSV mục tiêu / danh sách level lệch"],
        },
    },
    {
        "id": "preflight", "order": 60, "name": "Preflight", "icon": "clipboard-check", "freq": "Trước khi gửi",
        "category": "Tài liệu",
        "tagline": "Soát đề xuất / AB plan trước khi gửi sếp",
        "desc": "Chọn loại tài liệu (đề xuất, AB plan, kết quả AB, giao level / config), điền theo khung. Tool chấm "
                "checklist ngay khi gõ (có số liệu chưa, có chỉ số + tiêu chí chốt chưa…) và ra bản gửi gọn để copy.",
        "tags": ["đề xuất", "proposal", "ab plan", "checklist", "báo cáo", "gửi sếp"],
        "scripts": [],
        "example": {
            "headline": "AB plan thiếu “tiêu chí chốt có con số” và chạy 5 ngày nhưng đo D7 → 2 mục đỏ. Sửa xong, "
                        "copy bản gửi gọn dán Slack.",
            "input": "Không cần file — điền form.",
            "steps": ["Chọn loại tài liệu", "Điền form — checklist tự chấm", "Copy bản gửi (Markdown / Slack)"],
        },
    },
    {
        "id": "secure-share", "order": 65, "name": "Mã hoá file", "icon": "lock", "freq": "Khi gửi dữ liệu nhạy cảm",
        "category": "Bảo mật",
        "tagline": "Khoá file / đoạn chữ bằng mật khẩu trước khi gửi",
        "desc": "Mã hoá bất kỳ file nào (Excel doanh thu, config, tài liệu AB…) hoặc 1 đoạn chữ bằng mật khẩu. Ra file "
                ".html tự giải mã: người nhận chỉ cần mở bằng trình duyệt và nhập mật khẩu. AES-256-GCM, chạy hoàn "
                "toàn trên máy — không gửi gì lên mạng.",
        "tags": ["mã hoá", "encrypt", "mật khẩu", "password", "bảo mật", "security", "aes", "giải mã", "decrypt"],
        "scripts": ["lib/secure.js"],
        "example": {
            "headline": "Mã hoá “Doanh_thu_AB_T10.xlsx” → “Doanh_thu_AB_T10.xlsx.gdk.html”. Gửi file qua Slack, gửi mật "
                        "khẩu qua kênh khác. Người nhận mở file → nhập mật khẩu → tải về đúng file Excel gốc.",
            "input": "Bất kỳ file nào (tối đa 200 MB) hoặc 1 đoạn chữ. Muốn mở lại: thả file .html / .gdkenc vào tab Giải mã.",
            "steps": ["Thả file hoặc gõ đoạn chữ cần bảo vệ", "Đặt mật khẩu (có nút tạo mật khẩu mạnh)",
                      "Gửi file .html cho người nhận — mật khẩu gửi riêng"],
        },
    },
]


def api(action, body, query):
    from core import ToolError

    raise ToolError("Tool này chạy trên trình duyệt, không có API: " + action)

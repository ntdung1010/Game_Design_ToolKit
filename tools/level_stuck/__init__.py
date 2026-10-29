"""Level Stuck — kiểm tra level có bị kẹt không (không có đường nào thắng được) bằng chính luật của game.

Chạy hoàn toàn trên trình duyệt (web/lib/stuckkit.js + Web Worker web/lib/stuck-worker.js): file level không rời khỏi
máy. Kèm gói phương pháp 1 file Markdown (web/docs/check-level-stuck.md) để team tải về, điền thông tin game của mình rồi
prompt Claude dựng checker cho game đó.
"""
from core import ToolError

TOOL = {
    "id": "level-stuck", "order": 57, "name": "Level Stuck", "icon": "maze", "freq": "Mỗi bộ level",
    "category": "Level", "version": "1.0",
    "tagline": "Level có bị kẹt không? Chứng minh bằng luật game",
    "desc": "Thả thư mục level → tool tìm hết mọi đường đi theo đúng luật game (CDS: Bottle.cs / InGameGroup.cs) và "
            "kết luận từng level: OK (kèm lời giải), cần ống ads, KẸT chắc chắn (kèm lý do) hay chưa đủ ngân sách. Có hậu "
            "kiểm (chạy lại lời giải, đối chứng âm / dương) và báo cáo .md. Game khác: tải gói phương pháp .md, điền thông "
            "tin game rồi prompt Claude dựng checker riêng.",
    "tags": ["stuck", "kẹt", "deadlock", "solver", "giải", "level", "check", "hậu kiểm", "cds", "bshp", "bird sort",
             "water sort", "md", "prompt", "skill"],
    "scripts": ["lib/levelkit.js", "lib/level-adapters.js", "lib/stuckkit.js"],
    "example": {
        "headline": "Thả 8 level mẫu CDS → 3 OK (kèm lời giải 12 nước), L4 KẸT chắc (màu 0 có 5 ô), L5 KẸT chắc "
                    "(duyệt hết 62 trạng thái), L6 chỉ thắng khi mở ống ads, L7 thiếu order, L8 bỏ qua (ống khổng lồ).",
        "input": "Thư mục / file level: CDS runtime (B / C / BIM), level chuẩn Toolkit, water sort đơn giản.",
        "steps": ["Kéo thả thư mục level (hoặc bấm Thử với level mẫu)",
                  "Chọn độ kỹ, bấm Kiểm tra — tool chạy song song, không đơ trang",
                  "Đọc level KẸT / CẢNH BÁO + hậu kiểm, xem lời giải từng nước, xuất báo cáo .md / .csv"],
    },
}


def api(action, body, query):
    raise ToolError("Tool này chạy trên trình duyệt, không có API: " + action)

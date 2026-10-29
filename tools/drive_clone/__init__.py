"""Tool Drive Clone — clone thư mục Google Drive A sang B.

Từ v2.0 (2026-10-21) Drive Clone chạy bằng GOOGLE APPS SCRIPT (thư mục appsscript/ cạnh file này):
  • Không cần OAuth client loại Desktop app trên Google Cloud Console, không cần credentials.json, không cần chạy server.
  • Quản trị viên dán bộ file vào script.google.com và Deploy → Web app MỘT lần; mọi người chỉ mở link, đăng nhập
    Google của chính mình, bấm "Cho phép" — tool chạy bằng tài khoản đó (executeAs USER_ACCESSING).
  • Không phải sửa appsscript.json: Apps Script tự xin quyền Drive (user chọn 2026-10-21 — dễ cài hơn, B dán thư mục bất kỳ).

Phần Python ở đây chỉ: lưu link web app (data/drive_clone.json — quản trị viên đặt), phát bộ file Apps Script để tải,
và dựng bản xem thử Demo (1 file .html chạy Drive giả lập, mở thẳng bằng trình duyệt).
pipeline.py / changelog.py / gdrive.py / demo_seed.py là bản Python cũ — logic đã port 1-1 sang appsscript/Pipeline.html;
selftest.py vẫn chạy để giữ làm bản đối chiếu thuật toán.
"""
from __future__ import annotations

import io
import json
import os
import re
import zipfile

from core import DATA, ToolError, audit, context
from core.secure import write_atomic

TOOL = {
    "id": "drive-clone",
    "name": "Drive Clone",
    "tagline": "Clone thư mục Google Drive A → B",
    "desc": "Copy toàn bộ (hoặc chỉ dựng khung) một thư mục Drive sang chỗ khác, đổi tên hàng loạt kiểu BSHP → PRSP, "
            "đổi link master sheet sang cây mới, ghi Change Log và tự hậu kiểm. Chạy bằng Google Apps Script: chỉ cần đăng "
            "nhập Google của bạn — không cần OAuth client, không cần server.",
    "category": "Google Drive",
    "icon": "folder-copy",
    "tags": ["drive", "clone", "copy", "đổi tên", "rename", "change log", "master sheet", "apps script", "google"],
    "version": "2.0",
    "order": 70,
    "freq": "Mỗi project mới",
    "example": {
        "headline": "Copy folder “Game Design” của BSHP sang chỗ mới, mọi tên chứa BSHP / bshp / Bshp đổi thành "
                    "PRSP / prsp / Prsp, link trong master sheet trỏ sang file mới, kèm Change Log trong thư mục đích.",
        "input": "Link thư mục Google Drive A (nguồn) và B (đích, để trống = My Drive). Chỉ cần đăng nhập Google của bạn.",
        "steps": ["Bấm Mở Drive Clone → đăng nhập Google, Cho phép (lần đầu)", "Dán link A → Quét; chọn kiểu clone + đổi tên",
                  "Chạy thử → xem Change Log dự kiến → Clone thật"],
    },
}

GAS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "appsscript")
# Mã nguồn tách 5 file cho dễ sửa; bộ phát cho người cài chỉ 3 file — Index.html đã GỘP SẴN Pipeline + App
# (bớt chỗ gõ nhầm tên: tạo file "App.html" trong trình soạn thảo thành App.html.html → "No HTML file named App").
SOURCE_FILES = ["Code.gs", "Index.html", "Pipeline.html", "App.html"]
GAS_FILES = ["Code.gs", "Index.html"]
_URL = re.compile(r"^https://script\.google\.com/(?:a/macros/[A-Za-z0-9.-]+|macros)/s/[A-Za-z0-9_-]{20,}/(?:exec|dev)$")


def _cfg_file():
    return os.path.join(DATA, "drive_clone.json")


def load_config():
    try:
        with open(_cfg_file(), encoding="utf-8") as fh:
            data = json.load(fh)
        return {"webapp_url": str(data.get("webapp_url") or "")}
    except (OSError, ValueError):
        return {"webapp_url": ""}


def save_config(url):
    me = context.user() or {}
    if me and me.get("role") != "admin":
        raise ToolError("Chỉ quản trị viên được đặt link web app cho cả team.")
    url = str(url or "").strip()
    if url and not _URL.match(url):
        raise ToolError("Link chưa đúng — cần link Web app dạng https://script.google.com/macros/s/…/exec "
                        "(Deploy → Manage deployments → copy Web app URL).")
    write_atomic(_cfg_file(), json.dumps({"webapp_url": url}, ensure_ascii=False).encode("utf-8"))
    audit.record("drive_clone.webapp", url=url or "(xoá)")
    return load_config()


def _read(name):
    with open(os.path.join(GAS_DIR, name), encoding="utf-8") as fh:
        return fh.read()


def _inline_index():
    """Index.html với Pipeline + App ghép thẳng vào (không còn scriptlet include)."""
    page = _read("Index.html")
    for name in ("Pipeline", "App"):
        page = page.replace("<?!= include('{}'); ?>".format(name), _read(name + ".html"))
    if "<?" in page:
        raise ToolError("Index.html còn scriptlet chưa ghép.")
    return page


def bundle_file(name):
    """Nội dung file trong bộ cài (Index.html = bản gộp)."""
    return _inline_index() if name == "Index.html" else _read(name)


def bundle_zip():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in GAS_FILES:
            zf.writestr("DriveClone_AppsScript/" + name, bundle_file(name))
        zf.writestr("DriveClone_AppsScript/HUONG_DAN.txt", GUIDE)
    return buf.getvalue()


def demo_html():
    """1 file .html tự chạy (không cần Apps Script): ghép Pipeline + App vào Index, chỉ có chế độ Demo."""
    return _inline_index().replace("<head>", "<head>\n<title>Drive Clone — xem thử (Demo)</title>", 1)


GUIDE = """DRIVE CLONE — CÀI 1 LẦN CHO CẢ TEAM (khoảng 3 phút, không cần Google Cloud Console)

1. Vào https://script.google.com → New project. Đặt tên: Drive Clone.
2. Dán 2 file (KHÔNG cần đụng appsscript.json):
     Code.gs   (thay nội dung Code.gs có sẵn)
     Index     (bấm + → HTML, gõ đúng "Index" — KHÔNG gõ .html; trình soạn thảo tự hiện Index.html)
3. Chọn hàm kiemTraQuyen (ô cạnh nút ▷ Run) → Run → Allow → Execution log phải báo "ĐỦ quyền ✓".
4. Deploy → New deployment → Select type: Web app
     Execute as: User accessing the web app
     Who has access: Anyone with Google account  (công ty dùng Google Workspace: chọn "Anyone within <tên miền>")
   → Deploy → copy Web app URL (…/exec).
5. Mở Tool Kit → Drive Clone → dán Web app URL → Lưu. Từ giờ mọi người bấm "Mở Drive Clone".

Lần đầu mỗi người mở: chọn tài khoản Google → màn hình "Google hasn't verified this app" → Advanced →
Go to Drive Clone (unsafe) → Allow. Đây là app nội bộ của team nên cảnh báo này là bình thường
(Workspace + "Anyone within <tên miền>" thì không có cảnh báo).

Quyền xin: Google Drive (màn hình ghi "xem, sửa, xoá mọi file") + gọi Google API. Tool chỉ ĐỌC thư mục A và TẠO MỚI
trong B — không sửa / xoá file có sẵn nào; B dán được bất kỳ thư mục bạn có quyền sửa. Cập nhật bản mới: dán lại 2 file → Deploy → Manage deployments → Edit → Version: New version.
"""


def api(action, body, query):
    if action == "config":
        return {**load_config(), "files": GAS_FILES, "admin": (context.user() or {}).get("role") == "admin"}
    if action == "save":
        return save_config(body.get("webapp_url", ""))
    raise ToolError("Không có action: " + action)


def file(path):
    """GET /api/tools/drive-clone/files/<tên> — bộ file Apps Script, bản .zip, bản Demo .html, hướng dẫn."""
    path = path.strip("/")
    if path == "appsscript.zip":
        return bundle_zip(), "application/zip", "DriveClone_AppsScript.zip"
    if path == "demo.html":
        return demo_html().encode("utf-8"), "text/html; charset=utf-8", "DriveClone_Demo.html"
    if path == "guide.txt":
        return GUIDE.encode("utf-8"), "text/plain; charset=utf-8", None
    if path.startswith("appsscript/") and path.split("/", 1)[1] in GAS_FILES:
        name = path.split("/", 1)[1]
        return bundle_file(name).encode("utf-8"), "text/plain; charset=utf-8", None
    raise ToolError("Không tìm thấy file: " + path)


__all__ = ["TOOL", "api", "file", "GAS_FILES", "SOURCE_FILES", "bundle_file", "bundle_zip", "demo_html"]

"""Phần dùng chung cho mọi tool: đăng nhập Google, chạy job nền, cài thư viện."""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# GDK_DATA_DIR (hoặc `server.py --data-dir DIR`): dùng thư mục dữ liệu khác — để chạy thử / test
# mà không đụng mật khẩu, token, lịch sử thật trong data/ và out/.
_HOME = os.environ.get("GDK_DATA_DIR")
DATA = os.path.join(_HOME, "data") if _HOME else os.path.join(ROOT, "data")
OUT = os.path.join(_HOME, "out") if _HOME else os.path.join(ROOT, "out")


class ToolError(RuntimeError):
    """Lỗi do người dùng nhập sai / thiếu bước — trả về 400 kèm thông báo."""

"""Đăng nhập Google — MỖI NGƯỜI DÙNG TỰ ĐĂNG NHẬP GOOGLE CỦA CHÍNH MÌNH.

- credentials.json (OAuth client loại Desktop app) là "danh tính của ứng dụng": quản trị viên cài 1 lần, dùng chung,
  lưu mã hoá ở data/credentials.dat. (Google bắt buộc mọi ứng dụng đọc / ghi Drive phải đăng ký 1 client như vậy.)
- Mỗi người tự kết nối Google của mình; token mã hoá riêng: data/google/token-<id tài khoản>.dat. Drive Clone chạy
  bằng đúng tài khoản Google của người bấm.
- Quản trị viên bật / tắt quyền kết nối Google cho từng người (cột users.google); quản trị viên luôn được. Người bị tắt
  không kết nối được, token cũ (nếu có) cũng không được dùng. Xem Registry.for_user.
- Cách đăng nhập:
  · Người ngồi ngay máy chủ: mở trình duyệt, đăng nhập, xong tự quay về (như trước).
  · Người ở máy khác trong mạng nội bộ: Google chỉ cho ứng dụng Desktop chuyển về địa chỉ 127.0.0.1 — tức máy của
    người đó, nơi không có Tool Kit. Sau khi bấm Cho phép, trình duyệt báo “không kết nối được” — người dùng copy
    địa chỉ trên thanh trình duyệt (có chứa mã) dán vào Tool Kit. Mã chỉ dùng 1 lần, gắn với phiên đăng nhập đó (PKCE).
"""
from __future__ import annotations

import json
import os
import threading
import time
from urllib.parse import parse_qs, urlparse

from . import DATA, ToolError, audit, secure

CREDS = os.path.join(DATA, "credentials.dat")
TOKEN = os.path.join(DATA, "token.dat")                 # bản cũ (1 tài khoản chung) — chỉ để chuyển cho quản trị viên
CREDS_PLAIN = os.path.join(DATA, "credentials.json")   # bản cũ dạng chữ — chỉ để chuyển đổi
TOKEN_PLAIN = os.path.join(DATA, "token.json")
TOKENS_DIR = os.path.join(DATA, "google")

# Quyền tối thiểu: XEM mọi file Drive (đọc thư mục nguồn A) + chỉ SỬA / TẠO file do chính tool tạo (bản sao trong B).
# Tool không thể sửa / xoá bất kỳ file có sẵn nào của người dùng. Sheets API chạy được với 2 quyền này.
SCOPES = [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
]
MANUAL_REDIRECT = "http://127.0.0.1:8765/"
LOGIN_TIMEOUT_SEC = 300
MANUAL_TIMEOUT_SEC = 15 * 60
MAX_CREDENTIALS_BYTES = 64 * 1024


def libs_ok():
    try:
        import google.auth  # noqa: F401
        import google_auth_oauthlib  # noqa: F401
        import googleapiclient  # noqa: F401
        return True
    except ImportError:
        return False


def token_path(uid):
    return os.path.join(TOKENS_DIR, "token-{}.dat".format(int(uid)))


def migrate(admin_uid=None):
    """Mã hoá file bí mật dạng chữ còn sót; chuyển token Google chung của bản cũ thành token của quản trị viên."""
    moved = []
    for plain, enc in ((CREDS_PLAIN, CREDS), (TOKEN_PLAIN, TOKEN)):
        try:
            if secure.migrate_plain(plain, enc):
                moved.append(os.path.basename(plain))
        except Exception as exc:  # noqa: BLE001
            print("  ! không mã hoá được " + plain + ": " + str(exc))
    if admin_uid and os.path.exists(TOKEN) and not os.path.exists(token_path(admin_uid)):
        os.makedirs(TOKENS_DIR, exist_ok=True)
        os.replace(TOKEN, token_path(admin_uid))
        moved.append("token.dat → tài khoản quản trị")
    if moved:
        audit.record("secrets.migrated", files=moved)
    return moved


def parse_pasted(text):
    """Địa chỉ dán vào (http://127.0.0.1:8765/?state=…&code=…) hoặc chỉ mã → (code, state)."""
    t = (text or "").strip()
    if not t:
        raise ToolError("Chưa dán địa chỉ / mã.")
    if "code=" in t:
        q = parse_qs(urlparse(t if "://" in t else "http://x/?" + t.split("?", 1)[-1]).query)
        if q.get("error"):
            raise ToolError("Google báo: " + q["error"][0] + " — có thể bạn đã bấm Huỷ. Thử kết nối lại.")
        return (q.get("code") or [""])[0], (q.get("state") or [""])[0]
    if "error=" in t:
        raise ToolError("Google báo lỗi đăng nhập — có thể bạn đã bấm Huỷ. Thử kết nối lại.")
    return t, ""


class GoogleAuth:
    """Kết nối Google của 1 người dùng."""

    def __init__(self, uid):
        self.uid = uid
        self.token = token_path(uid)
        self._lock = threading.Lock()
        self.creds = None
        self.account = {}
        self.busy = False
        self.error = ""
        self.pending = None          # đăng nhập kiểu dán địa chỉ: {"flow", "state", "exp"}
        self._tried_token = False

    def status(self):
        if (self.creds is None and not self.busy and not self._tried_token
                and libs_ok() and os.path.exists(self.token)):
            self._tried_token = True     # chỉ tự nạp token 1 lần, tránh gọi API mỗi lần poll
            try:
                self._load_token()
            except Exception as exc:  # noqa: BLE001
                self.error = "Token cũ không dùng được: " + str(exc)
        if self.pending and time.time() > self.pending["exp"]:
            self.pending = None
        return {
            "libs_ok": libs_ok(),
            "has_credentials": os.path.exists(CREDS),
            "connected": self.creds is not None,
            "account": self.account,
            "busy": self.busy,
            "waiting_paste": bool(self.pending),
            "error": self.error,
            "encrypted": secure.dpapi_available(),
        }

    @staticmethod
    def _client_config():
        return json.loads(secure.load_secret(CREDS).decode("utf-8"))

    def _load_token(self):
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials

        info = json.loads(secure.load_secret(self.token).decode("utf-8"))
        creds = Credentials.from_authorized_user_info(info, SCOPES)
        if not creds.valid:
            if creds.expired and creds.refresh_token:
                creds.refresh(Request())
                self._save_token(creds)
            else:
                return None
        self._set(creds)
        return creds

    def _save_token(self, creds):
        os.makedirs(TOKENS_DIR, exist_ok=True)
        secure.save_secret(self.token, creds.to_json())

    def _set(self, creds):
        from googleapiclient.discovery import build

        drive = build("drive", "v3", credentials=creds, cache_discovery=False)
        about = drive.about().get(fields="user(emailAddress,displayName)").execute()
        self.creds = creds
        self.account = about.get("user", {})
        self.error = ""

    def connect(self, local):
        """local = người dùng ngồi ngay máy chủ → mở trình duyệt tự quay về. Không thì trả link + chờ dán địa chỉ."""
        if not libs_ok():
            raise ToolError("Máy chủ thiếu thư viện Google — nhờ quản trị viên bấm 'Cài thư viện' ở trang Cài đặt.")
        if self.busy:
            return {"started": False, "waiting": True}
        if os.path.exists(self.token):
            try:
                if self._load_token():
                    return {"started": False, "connected": True}
            except Exception:  # noqa: BLE001 — token hỏng thì đăng nhập lại
                pass
        if not os.path.exists(CREDS):
            raise ToolError("Quản trị viên chưa cài credentials.json cho Tool Kit (trang Cài đặt).")
        from google_auth_oauthlib.flow import InstalledAppFlow

        if not local:
            flow = InstalledAppFlow.from_client_config(self._client_config(), SCOPES, redirect_uri=MANUAL_REDIRECT,
                                                       autogenerate_code_verifier=True)
            url, state = flow.authorization_url(access_type="offline", prompt="consent")
            self.pending = {"flow": flow, "state": state, "exp": time.time() + MANUAL_TIMEOUT_SEC}
            self.error = ""
            return {"manual": True, "auth_url": url}

        self.busy = True
        self.error = ""

        def worker():
            try:
                flow = InstalledAppFlow.from_client_config(self._client_config(), SCOPES)
                creds = flow.run_local_server(
                    host="localhost", bind_addr="127.0.0.1", port=0, open_browser=True,
                    timeout_seconds=LOGIN_TIMEOUT_SEC,
                    success_message="Đã đăng nhập GD Toolkit. Bạn có thể đóng tab này.",
                )
                self._save_token(creds)
                self._set(creds)
                audit.record("google.connected", account=self.account.get("emailAddress"))
            except Exception as exc:  # noqa: BLE001
                self.error = "Đăng nhập không thành công: " + str(exc)
                audit.record("google.connect_failed", error=str(exc)[:200])
            finally:
                self.busy = False

        threading.Thread(target=worker, daemon=True).start()
        return {"started": True}

    def finish(self, pasted):
        """Kiểu dán địa chỉ: đổi mã lấy token."""
        p = self.pending
        if not p or time.time() > p["exp"]:
            self.pending = None
            raise ToolError("Hết thời gian chờ — bấm “Kết nối Google” lại để lấy link mới.")
        code, state = parse_pasted(pasted)
        if state and state != p["state"]:
            raise ToolError("Địa chỉ này thuộc một lần đăng nhập khác — dùng link mới nhất Tool Kit vừa mở.")
        try:
            p["flow"].fetch_token(code=code)
        except Exception as exc:  # noqa: BLE001
            audit.record("google.connect_failed", error=str(exc)[:200])
            raise ToolError("Google không chấp nhận mã (mã chỉ dùng được 1 lần, trong vài phút): " + str(exc)[:160]) from exc
        self.pending = None
        creds = p["flow"].credentials
        self._save_token(creds)
        self._set(creds)
        audit.record("google.connected", account=self.account.get("emailAddress"), via="paste")
        return {"connected": True, "account": self.account}

    def disconnect(self):
        with self._lock:
            who = self.account.get("emailAddress")
            self.creds = None
            self.account = {}
            self.pending = None
            self._tried_token = True
            secure.wipe(self.token)
        audit.record("google.disconnected", account=who)
        return {"ok": True}

    def credentials(self):
        if self.creds is None:
            self.status()
        if self.creds is None:
            raise ToolError("Bạn chưa kết nối Google. Vào trang Cài đặt → Kết nối Google (bằng tài khoản Google của bạn).")
        return self.creds


class Registry:
    """Kết nối Google theo từng tài khoản Tool Kit."""

    def __init__(self):
        self._lock = threading.Lock()
        self._by_uid = {}

    def get(self, uid):
        if uid is None:
            raise ToolError("Cần đăng nhập Tool Kit.")
        with self._lock:
            if uid not in self._by_uid:
                self._by_uid[uid] = GoogleAuth(uid)
            return self._by_uid[uid]

    def forget(self, uid):
        """Xoá tài khoản Tool Kit → xoá luôn token Google của người đó."""
        with self._lock:
            g = self._by_uid.pop(uid, None)
        if g:
            g.creds = None
        secure.wipe(token_path(uid))

    def for_user(self, user):
        """Kết nối Google của chính người này — nếu được phép (quản trị viên luôn được; người dùng cần quyền users.google)."""
        user = user or {}
        if user.get("id") is None:
            raise ToolError("Cần đăng nhập Tool Kit.")
        if user.get("role") != "admin" and not user.get("google"):
            raise ToolError("Tài khoản của bạn chưa được cấp quyền kết nối Google — nhờ quản trị viên bật ở Quản lý → Người dùng.")
        return self.get(user["id"])

    @staticmethod
    def has_credentials():
        return os.path.exists(CREDS)

    @staticmethod
    def save_credentials(text):
        if len(text or "") > MAX_CREDENTIALS_BYTES:
            raise ToolError("File quá lớn — credentials.json chỉ vài KB.")
        try:
            data = json.loads(text)
        except ValueError as exc:
            raise ToolError("File không phải JSON hợp lệ.") from exc
        if not isinstance(data, dict) or "installed" not in data:
            if isinstance(data, dict) and "web" in data:
                raise ToolError("Đây là OAuth client loại 'Web application'. "
                                "Hãy tạo lại với Application type = 'Desktop app'.")
            raise ToolError("Không thấy khoá 'installed' — có đúng file OAuth client "
                            "tải từ Google Cloud Console không?")
        inst = data["installed"]
        if not inst.get("client_id") or not inst.get("client_secret"):
            raise ToolError("Thiếu client_id / client_secret trong file.")
        secure.save_secret(CREDS, json.dumps(data))
        audit.record("google.credentials_saved", client=inst.get("client_id", "")[:12] + "…")
        return {"client_id": inst.get("client_id", "")[:24] + "…", "encrypted": secure.dpapi_available()}

    def forget_credentials(self):
        secure.wipe(CREDS)
        audit.record("google.credentials_removed")
        return {"ok": True}

    def tokens(self):
        """Số người đã kết nối Google (có file token)."""
        if not os.path.isdir(TOKENS_DIR):
            return 0
        return sum(1 for n in os.listdir(TOKENS_DIR) if n.startswith("token-") and n.endswith(".dat"))


GOOGLE = Registry()

#!/usr/bin/env python
"""GD Toolkit — bộ công cụ chung cho Game Design. Chạy trên 1 máy chủ, cả team dùng qua mạng nội bộ.

    python server.py                 # mở http://127.0.0.1:7700 (mạng nội bộ: theo cài đặt của quản trị viên)
    python server.py --lan           # cho máy khác trong mạng nội bộ truy cập (lưu lại cho lần sau)
    python server.py --local         # chỉ máy này (lưu lại cho lần sau)
    python server.py --port 7800     # đổi cổng
    python server.py --no-open       # không tự mở trình duyệt
    python server.py test            # chạy selftest của mọi tool (offline)

    python server.py set-password [tên đăng nhập]   # đặt lại mật khẩu khi quên (chạy ngay trên máy chủ)

Các lớp bảo mật:
  0. Tài khoản riêng từng người (core/users.py, băm scrypt) — chưa đăng nhập thì không vào được trang / API nào.
  1. Mạng nội bộ: chỉ nhận máy có địa chỉ nội bộ (10.x, 172.16–31.x, 192.168.x…); từ chối Host lạ (DNS rebinding).
  2. Khoá phiên ngẫu nhiên mỗi lần chạy: mọi API phải gửi X-GDK-Token (trang web lạ không lấy được).
  3. Header bảo mật + Content-Security-Policy: chỉ chạy script của chính Tool Kit, không cho nhúng iframe.
  4. Token Google / credentials lưu đã mã hoá (Windows DPAPI) — core/secure.py.
  5. Nhật ký bảo mật data/audit.log; xuất Excel có mật khẩu; tool “Mã hoá file”.
"""
from __future__ import annotations

import argparse
import getpass
import gzip
import hmac
import importlib
import ipaddress
import json
import mimetypes
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
import traceback
import urllib.request
import webbrowser
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, unquote, urlparse

for _stream in (sys.stdout, sys.stderr):   # console Windows mặc định không phải UTF-8
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, "web")
sys.path.insert(0, ROOT)

# --data-dir phải được đọc TRƯỚC khi nạp core (đường dẫn data/ out/ được tính lúc import)
if "--data-dir" in sys.argv[:-1]:
    os.environ["GDK_DATA_DIR"] = os.path.abspath(sys.argv[sys.argv.index("--data-dir") + 1])

from core.system import VENV_PY, in_venv  # noqa: E402

# Lỡ chạy bằng Python chung của máy mà Tool Kit đã có .venv riêng → chuyển sang .venv,
# để thư viện của Tool Kit không lẫn với project khác.
if __name__ == "__main__" and os.path.exists(VENV_PY) and not in_venv() and os.environ.get("GDK_NO_VENV") != "1":
    sys.exit(subprocess.call([VENV_PY, os.path.abspath(__file__)] + sys.argv[1:]))

import tools  # noqa: E402
from core import DATA, OUT, ToolError, audit, context, secure  # noqa: E402
from core import google_auth  # noqa: E402
from core.exporter import to_xlsx  # noqa: E402
from core.google_auth import CREDS, CREDS_PLAIN, GOOGLE, TOKEN_PLAIN  # noqa: E402
from core.login import LockedError  # noqa: E402
from core.system import INSTALLER  # noqa: E402
from core.tables import parse_xlsx_bytes  # noqa: E402
from core.users import USAGE_ACTIONS, Users  # noqa: E402

VERSION = "2.0"
TOOLS = tools.discover()
PORT = 7700
SESSION_TOKEN = secrets.token_urlsafe(32)        # đổi mỗi lần khởi động server
USERS = None          # tài khoản + phiên + nhật ký (data/gdk.db) — mở khi chạy server, KHÔNG mở lúc import (test)
# chưa đăng nhập thì chỉ được tải đúng mấy file của trang đăng nhập
PUBLIC_STATIC = {"login.html", "assets/login.js", "assets/app.css", "assets/logo.svg", "assets/theme.js", "assets/mascot.js",
                 "assets/mascot3d.js", "assets/vendor/three.module.min.js"}
NET_FILE = os.path.join(DATA, "server.json")
NET = {"lan": False, "hosts": {"127.0.0.1", "localhost", "[::1]"}, "urls": []}
# action API của tool không ghi nhật ký (gọi liên tục khi đang xem, không phải thao tác của người dùng)
QUIET_TOOL_ACTIONS = {"state", "manifest", "plan", "history", "run_detail", "games"}

MAX_JSON = 25 * 1024 * 1024
MAX_UPLOAD = 150 * 1024 * 1024
GZIP_MIN = 1400
TEXT_TYPES = ("text/", "application/json", "application/javascript", "image/svg+xml")

CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
])
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Content-Security-Policy": CSP,
}


# ------------------------------------------------------------------ bật / tắt + thứ tự tool (quản trị viên chỉnh)
# data/tools.json: {"enabled": {id: bool}, "order": [id, …], "auto": bool}
#   enabled — tool không có trong đây dùng mặc định của code (khai báo "hidden": True = mặc định tắt)
#   auto    — True: sắp theo "order" khai báo trong code; False: theo thứ tự quản trị viên kéo thả (giữ lại cả khi bật auto)
TOOLCFG_FILE = os.path.join(DATA, "tools.json")
_TOOLCFG = {"lock": threading.Lock(), "stamp": None, "cfg": None}


def load_toolcfg():
    try:
        st = os.stat(TOOLCFG_FILE)
        stamp = (st.st_mtime_ns, st.st_size)
    except OSError:
        stamp = None
    if _TOOLCFG["cfg"] is not None and stamp == _TOOLCFG["stamp"]:
        return _TOOLCFG["cfg"]
    d = {}
    if stamp:
        try:
            with open(TOOLCFG_FILE, encoding="utf-8") as fh:
                d = json.load(fh)
        except (OSError, ValueError):
            d = {}
    d = d if isinstance(d, dict) else {}
    en = d.get("enabled") if isinstance(d.get("enabled"), dict) else {}
    cfg = {"enabled": {str(k): bool(v) for k, v in en.items()},
           "order": [x for x in (d.get("order") or []) if isinstance(x, str)],
           "auto": bool(d.get("auto", True))}
    _TOOLCFG.update(stamp=stamp, cfg=cfg)
    return cfg


def save_toolcfg(cfg):
    os.makedirs(DATA, exist_ok=True)
    secure.write_atomic(TOOLCFG_FILE, json.dumps(cfg, ensure_ascii=False, indent=1).encode("utf-8"))
    _TOOLCFG["cfg"] = None


def tool_enabled(tid, cfg=None):
    cfg = cfg or load_toolcfg()
    return cfg["enabled"].get(tid, not TOOLS[tid][0].get("hidden")) if tid in TOOLS else False


def ordered_tool_ids(cfg=None):
    """Thứ tự hiển thị. Tool mới thêm (chưa có trong thứ tự tuỳ chỉnh) chèn ngay sau tool đứng trước nó ở thứ tự mặc định."""
    cfg = cfg or load_toolcfg()
    default = list(TOOLS)
    if cfg["auto"] or not cfg["order"]:
        return default
    out = []
    for tid in cfg["order"]:
        if tid in TOOLS and tid not in out:
            out.append(tid)
    for i, tid in enumerate(default):
        if tid in out:
            continue
        prev = [x for x in default[:i] if x in out]
        out.insert(out.index(prev[-1]) + 1 if prev else 0, tid)
    return out


def tool_list(admin=False):
    """Danh sách tool theo thứ tự hiển thị. Người dùng thường không thấy tool đang tắt; quản trị viên thấy với "hidden": True."""
    cfg = load_toolcfg()
    out = []
    for tid in ordered_tool_ids(cfg):
        meta = dict(TOOLS[tid][0])
        meta["hidden"] = not tool_enabled(tid, cfg)
        if meta["hidden"] and not admin:
            continue
        out.append(meta)
    return out


def tools_admin_state():
    cfg = load_toolcfg()
    default = list(TOOLS)
    return {"auto": cfg["auto"], "custom": bool(cfg["order"]),
            "tools": [{"id": tid, "name": TOOLS[tid][0]["name"], "icon": TOOLS[tid][0].get("icon", ""),
                       "category": TOOLS[tid][0].get("category", ""), "tagline": TOOLS[tid][0].get("tagline", ""),
                       "enabled": tool_enabled(tid, cfg), "default_enabled": not TOOLS[tid][0].get("hidden"),
                       "default_pos": default.index(tid)} for tid in ordered_tool_ids(cfg)]}


def tools_admin_save(body):
    with _TOOLCFG["lock"]:
        cfg = load_toolcfg()
        cfg = {"enabled": dict(cfg["enabled"]), "order": list(cfg["order"]), "auto": cfg["auto"]}
        changed = []
        if isinstance(body.get("enabled"), dict):
            for tid, on in body["enabled"].items():
                if tid not in TOOLS:
                    raise ToolError("Không có tool: " + str(tid))
                if tool_enabled(tid, cfg) != bool(on):
                    changed.append("{}={}".format(tid, "bật" if on else "tắt"))
                cfg["enabled"][tid] = bool(on)
        if body.get("order") is not None:
            order = body.get("order")
            if not isinstance(order, list) or any(x not in TOOLS for x in order) or len(set(order)) != len(order):
                raise ToolError("Thứ tự tool không hợp lệ.")
            cfg["order"] = list(order)
            changed.append("thứ tự")
        if body.get("reset"):
            cfg["order"], cfg["auto"] = [], True
            changed.append("về thứ tự mặc định")
        elif body.get("auto") is not None:
            cfg["auto"] = bool(body["auto"])
            changed.append("tự sắp" if cfg["auto"] else "thứ tự tuỳ chỉnh")
        save_toolcfg(cfg)
    audit.record("admin.tools_changed", change=", ".join(changed))
    USERS.log("save", detail="Quản lý tool: " + ", ".join(changed))
    return tools_admin_state()


# ------------------------------------------------------------------ mạng nội bộ
def load_net():
    try:
        with open(NET_FILE, encoding="utf-8") as fh:
            return bool(json.load(fh).get("lan"))
    except (OSError, ValueError):
        return False


def save_net(lan):
    os.makedirs(DATA, exist_ok=True)
    secure.write_atomic(NET_FILE, json.dumps({"lan": bool(lan)}).encode("utf-8"))


VIRTUAL_IFACE = re.compile(r"vpn|wireguard|surfshark|nord|express|proton|tailscale|zerotier|hamachi|openvpn|tap-|tun|"
                           r"virtualbox|vmware|hyper-v|vethernet|wsl|docker|loopback|bluetooth", re.I)


def interfaces():
    """[{ip, iface, virtual}] — Windows: tên card mạng (để phân biệt LAN thật với VPN / máy ảo)."""
    out = []
    if os.name == "nt":
        try:
            ps = ("[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-NetIPAddress -AddressFamily IPv4 | "
                  "Select-Object IPAddress,InterfaceAlias | ConvertTo-Json -Compress")
            raw = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, timeout=20).stdout
            rows = json.loads(raw.decode("utf-8-sig", "replace") or "[]", strict=False)
            for r in rows if isinstance(rows, list) else [rows]:
                ip = r.get("IPAddress") or ""
                if ip and not ip.startswith("127.") and not ip.startswith("169.254.") and _private(ip):
                    alias = r.get("InterfaceAlias") or ""
                    out.append({"ip": ip, "iface": alias, "virtual": bool(VIRTUAL_IFACE.search(alias))})
        except Exception:  # noqa: BLE001
            out = []
    if not out:
        _, ips = local_addresses()
        out = [{"ip": ip, "iface": "", "virtual": False} for ip in ips]
    return sorted(out, key=lambda x: (x["virtual"], x["ip"]))


def local_addresses():
    """Địa chỉ IPv4 nội bộ của máy chủ (để máy khác gõ vào trình duyệt)."""
    found = set()
    try:
        name = socket.gethostname()
        for info in socket.getaddrinfo(name, None, socket.AF_INET):
            found.add(info[4][0])
    except OSError:
        name = ""
    try:                                   # địa chỉ của card mạng đang ra ngoài (không gửi gói nào)
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as so:
            so.connect(("10.255.255.255", 1))
            found.add(so.getsockname()[0])
    except OSError:
        pass
    ips = sorted(a for a in found if not a.startswith("127.") and _private(a))
    return name, ips


def _private(addr):
    try:
        ip = ipaddress.ip_address(addr.split("%")[0])
    except ValueError:
        return False
    if ip.version == 6 and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_private or ip.is_loopback or ip.is_link_local


def setup_net(lan, port):
    NET["lan"] = lan
    hosts = {"127.0.0.1", "localhost", "[::1]"}
    urls = []
    ifaces = []
    if lan:
        name, ips = local_addresses()
        ifaces = interfaces()
        if name:
            hosts |= {name.lower(), (name + ".local").lower()}
            try:
                hosts.add(socket.getfqdn(name).lower())
            except OSError:
                pass
        hosts |= set(ips) | {x["ip"] for x in ifaces}
        # chỉ gợi ý địa chỉ của card mạng thật (bỏ VPN / máy ảo) — vẫn nhận truy cập qua mọi địa chỉ nội bộ
        real = [x["ip"] for x in ifaces if not x["virtual"]] or [x["ip"] for x in ifaces]
        urls = ["http://{}:{}/".format(a, port) for a in real] + (["http://{}:{}/".format(name.lower(), port)] if name else [])
    NET["hosts"], NET["urls"], NET["port"], NET["ifaces"] = hosts, urls, port, ifaces


# ------------------------------------------------------------------ API lõi
def _dir_size(path):
    total, files = 0, 0
    for base, _, names in os.walk(path):
        for n in names:
            try:
                total += os.path.getsize(os.path.join(base, n))
                files += 1
            except OSError:
                pass
    return total, files


def _me():
    return context.user() or {}


def _is_admin():
    return _me().get("role") == "admin"


def _need_admin():
    if not _is_admin():
        raise ToolError("Chỉ quản trị viên được làm việc này.")


def security_status():
    me = _me()
    mine = google_auth.token_path(me["id"]) if me.get("id") else ""
    out = {
        "dpapi": secure.dpapi_available(),
        "credentials": {"exists": os.path.exists(CREDS), "encrypted": secure.is_encrypted(CREDS)},
        "token": {"exists": bool(mine) and os.path.exists(mine), "encrypted": bool(mine) and secure.is_encrypted(mine)},
        "bind": "mạng nội bộ" if NET["lan"] else "127.0.0.1",
        "lan": NET["lan"],
        "login": {"setup": not USERS.needs_setup(), "sessions": len([x for x in USERS.sessions() if x["uid"] == me.get("id")])},
        "session_token": True,
        "csp": True,
        "admin": _is_admin(),
    }
    if _is_admin():
        size, files = _dir_size(OUT) if os.path.isdir(OUT) else (0, 0)
        out.update({
            "plaintext_leftovers": [os.path.basename(p) for p in (CREDS_PLAIN, TOKEN_PLAIN) if os.path.exists(p)],
            "history": {"bytes": size, "files": files},
            "audit": audit.tail(25),
            "users": USERS.count(), "google_tokens": GOOGLE.tokens(),
        })
    return out


GOOGLE_OFF = ("Đã tắt kết nối Google qua OAuth client (Desktop app). Drive Clone giờ chạy bằng Google Apps Script: "
              "mở Drive Clone → đăng nhập Google của bạn ngay trên trang đó.")


def security_wipe(what):
    done = []
    if "token" in what:
        GOOGLE.get(_me().get("id")).disconnect(); done.append("token")
    if what - {"token"}:
        _need_admin()
    if "credentials" in what:
        GOOGLE.forget_credentials(); done.append("credentials")
    if "history" in what and os.path.isdir(OUT):
        for name in os.listdir(OUT):
            p = os.path.join(OUT, name)
            if os.path.isdir(p):
                shutil.rmtree(p, ignore_errors=True)
        done.append("history")
    audit.record("security.wipe", items=done)
    if "audit" in what:
        secure.wipe(audit.AUDIT)
        done.append("audit")
    return {"ok": True, "done": done}


def core_api(action, body, query=None):
    query = query or {}
    me = _me()
    if action == "tools":
        return {"tools": tool_list(admin=_is_admin()), "version": VERSION, "user": me, "lan": NET["lan"],
                "tools_auto": load_toolcfg()["auto"]}
    # 2026-10-21: TẮT kết nối Google qua "OAuth client loại Desktop app" (credentials.json + token trên máy chủ).
    # Drive Clone giờ chạy bằng Google Apps Script — mỗi người đăng nhập Google của mình ngay trên trang web app.
    if action == "google/status":
        return {"disabled": True, "connected": False, "allowed": False, "admin": _is_admin(), "account": {},
                "note": GOOGLE_OFF}
    if action in ("google/credentials", "google/connect", "google/finish"):
        raise ToolError(GOOGLE_OFF)
    if action == "google/disconnect":
        return GOOGLE.get(me.get("id")).disconnect()     # ngắt của chính mình: luôn được (kể cả khi bị tắt quyền)
    if action == "system/install":
        _need_admin()
        return INSTALLER.start()
    if action == "security/status":
        return security_status()
    if action == "security/wipe":
        return security_wipe(set(body.get("what") or []))
    if action == "usage":
        act = str(body.get("action") or "")
        if act not in USAGE_ACTIONS:
            raise ToolError("Hành động không hợp lệ.")
        tool = str(body.get("tool") or "")
        if tool and tool not in TOOLS:
            raise ToolError("Không có tool: " + tool)
        USERS.log(act, tool=tool, detail=str(body.get("detail") or "")[:300])
        return {"ok": True}
    if action.startswith("admin/"):
        _need_admin()
        return admin_api(action[len("admin/"):], body, query)
    raise ToolError("Không có API: " + action)


def admin_api(action, body, query):
    me = _me()
    q = lambda k: (query.get(k) or [""])[0] or body.get(k)  # noqa: E731
    if action == "users":
        return {"users": USERS.list_users(),
                "google": {str(u["id"]): os.path.exists(google_auth.token_path(u["id"])) for u in USERS.list_users()}}
    if action == "users/create":
        r = USERS.create_user(body.get("username"), body.get("name"), body.get("role") or "user")
        if body.get("google"):
            r["user"] = USERS.update_user(r["user"]["id"], me["id"], google=True)
        return r
    if action == "users/update":
        return {"user": USERS.update_user(int(body.get("id")), me["id"], name=body.get("name"), role=body.get("role"),
                                          active=body.get("active"), google=body.get("google"))}
    if action == "users/reset":
        return USERS.reset_password(int(body.get("id")))
    if action == "users/delete":
        uid = int(body.get("id"))
        r = USERS.delete_user(uid, me["id"])
        GOOGLE.forget(uid)
        return r
    if action == "users/logout":
        USERS.logout_user(int(body.get("id")))
        audit.record("admin.user_logged_out", target=int(body.get("id")))
        return {"ok": True}
    if action == "tools":
        return tools_admin_state()
    if action == "tools/save":
        return tools_admin_save(body)
    if action == "sessions":
        return {"sessions": USERS.sessions()}
    if action == "sessions/kill":
        return USERS.kill_session(body.get("id"))
    if action == "usage":
        return USERS.usage(uid=q("uid"), tool=q("tool"), action=q("action"), since=q("since"), until=q("until"),
                           q=q("q"), limit=q("limit") or 200, offset=q("offset") or 0)
    if action == "stats":
        return USERS.stats(int(q("days") or 30))
    if action == "network":
        if body.get("lan") is not None:
            save_net(bool(body["lan"]))
            audit.record("admin.network_changed", lan=bool(body["lan"]))
        name, ips = local_addresses()
        ifaces = NET.get("ifaces") or interfaces()
        real = [x["ip"] for x in ifaces if not x["virtual"]] or ips
        return {"lan": NET["lan"], "saved": load_net(), "host": name, "ips": ips, "ifaces": ifaces,
                "urls": NET["urls"] or ["http://{}:{}/".format(a, NET.get("port", PORT)) for a in real],
                "restart_needed": load_net() != NET["lan"]}
    raise ToolError("Không có API: admin/" + action)


def host_allowed(host):
    """Chặn DNS-rebinding: chỉ phục vụ khi trình duyệt gọi bằng localhost / tên / địa chỉ IP nội bộ của máy chủ."""
    host = host[:host.rindex(":")] if ":" in host and not host.endswith("]") else host
    host = host.lower()
    if host in NET["hosts"]:
        return True
    return bool(NET["lan"]) and host.count(".") == 3 and _private(host)


def client_allowed(addr):
    """Chỉ nhận máy trong mạng nội bộ (và chính máy chủ) — kể cả khi lỡ mở cổng ra Internet."""
    return _is_loopback(addr) or (bool(NET["lan"]) and _private(addr))


def _is_loopback(addr):
    try:
        ip = ipaddress.ip_address((addr or "").split("%")[0])
    except ValueError:
        return False
    if ip.version == 6 and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_loopback


# ------------------------------------------------------------------ HTTP
_STATIC_CACHE = {}          # path -> (mtime_ns, size, raw, gz)


class Handler(BaseHTTPRequestHandler):
    server_version = "GDToolkit"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    # -- gửi phản hồi -----------------------------------------------------
    def _send(self, code, body, ctype="application/json; charset=utf-8", filename=None, cache="no-store",
              etag=None, gz=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False, separators=(",", ":"))
        data = body.encode("utf-8") if isinstance(body, str) else body
        accepts_gzip = "gzip" in (self.headers.get("Accept-Encoding") or "")
        compressed = False
        if accepts_gzip and len(data) >= GZIP_MIN and ctype.startswith(TEXT_TYPES):
            data = gz if gz is not None else gzip.compress(data, compresslevel=5)
            compressed = True
        if code >= 400:
            self.close_connection = True   # có thể còn dữ liệu chưa đọc trong socket → không tái dùng kết nối
            self._drain_body()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", cache)
        if code >= 400:
            self.send_header("Connection", "close")
        if compressed:
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Vary", "Accept-Encoding")
        if etag:
            self.send_header("ETag", etag)
        for k, v in SECURITY_HEADERS.items():
            self.send_header(k, v)
        if filename:
            self.send_header("Content-Disposition", "attachment; filename*=UTF-8''" + quote(filename))
        for k, v in getattr(self, "_extra_headers", []):
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _host_ok(self):
        return host_allowed(self.headers.get("Host") or "")

    def _client_ok(self):
        return client_allowed(self.client_address[0])

    # -- đăng nhập ---------------------------------------------------------
    def _cookie_name(self):
        return "gdk_sid_{}".format(self.server.server_address[1])   # cookie dùng chung host → tách theo cổng

    def _sid(self):
        jar = SimpleCookie()
        try:
            jar.load(self.headers.get("Cookie") or "")
        except Exception:  # noqa: BLE001
            return ""
        m = jar.get(self._cookie_name())
        return m.value if m else ""

    def _set_cookie(self, token, max_age):
        parts = ["{}={}".format(self._cookie_name(), token), "Path=/", "HttpOnly", "SameSite=Strict"]
        if max_age is not None:
            parts.append("Max-Age={}".format(int(max_age)))
        self._extra_headers.append(("Set-Cookie", "; ".join(parts)))

    def _auth_api(self, method, action, query, sid, user):
        ip, ua = self.client_address[0], self.headers.get("User-Agent") or ""
        try:
            if action == "status" and method == "GET":
                return self._send(200, USERS.status(sid, ip))
            if method != "POST":
                return self._send(405, {"error": "method"})
            if action in ("login", "setup"):
                # chưa có khoá phiên ở bước này → chống CSRF bằng header tuỳ chỉnh (trang lạ không gửi được)
                if self.headers.get("X-GDK-Login") != "1":
                    return self._send(403, {"error": "Thiếu header X-GDK-Login."})
                body = self._json_body()
                if action == "setup":
                    sess = USERS.setup(str(body.get("username") or ""), str(body.get("name") or ""),
                                       str(body.get("password") or ""), ip, ua)
                else:
                    sess = USERS.login(str(body.get("username") or ""), str(body.get("password") or ""),
                                       bool(body.get("remember")), ip, ua)
                self._set_cookie(sess["token"], sess["max_age"])
                me = USERS.check(sess["token"])
                return self._send(200, {"ok": True, "must_change": bool(me["must_change"]), "name": me["name"]})
            if not user:
                return self._send(401, {"error": "Cần đăng nhập lại.", "code": "login"})
            body = self._json_body()
            if action == "change":
                # đổi mật khẩu được gọi cả từ trang đăng nhập (lần đầu bắt đổi) — nơi chưa có khoá phiên
                if not self._token_ok(query) and self.headers.get("X-GDK-Login") != "1":
                    return self._send(403, {"error": "Thiếu khoá phiên."})
                return self._send(200, USERS.change_password(user["id"], str(body.get("old") or ""),
                                                             str(body.get("new") or ""), keep_token=sid))
            if not self._token_ok(query):
                return self._send(401, {"error": "Phiên làm việc đã hết hạn — tải lại trang (F5).", "code": "token"})
            if action == "logout":
                USERS.logout(sid)
                self._set_cookie("", 0)
                return self._send(200, {"ok": True})
            if action == "logout_others":
                USERS.logout_user(user["id"], except_token=sid)
                audit.record("auth.logout_others")
                return self._send(200, {"ok": True})
            return self._send(404, {"error": "Không có API: auth/" + action})
        except LockedError as exc:
            return self._send(429, {"error": str(exc), "locked": exc.seconds})
        except ToolError as exc:
            return self._send(400, {"error": str(exc)})

    def _token_ok(self, query):
        sent = self.headers.get("X-GDK-Token") or (query.get("t") or [""])[0]
        return bool(sent) and hmac.compare_digest(sent, SESSION_TOKEN)

    def _raw_body(self, limit):
        n = int(self.headers.get("Content-Length") or 0)
        if n > limit:
            raise ToolError("Dữ liệu gửi lên quá lớn (tối đa {} MB).".format(limit // (1024 * 1024)))
        self._body_read = True
        return self.rfile.read(n) if n else b""

    def _drain_body(self, limit=4 * 1024 * 1024):
        """Từ chối request (401 / 400…) khi chưa đọc phần thân: đọc bỏ phần thân trước khi trả lời. Nếu không, Windows
        đóng socket còn dữ liệu chưa đọc bằng RST → trình duyệt nhận "kết nối bị ngắt" thay vì thông báo lỗi rõ ràng."""
        if getattr(self, "_body_read", True):
            return
        self._body_read = True
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return
        if 0 < n <= limit:
            try:
                self.connection.settimeout(5)
                self.rfile.read(n)
            except OSError:
                pass

    def _json_body(self):
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip()
        raw = self._raw_body(MAX_JSON)
        if raw and ctype != "application/json":
            raise ToolError("Content-Type phải là application/json.")
        try:
            return json.loads(raw or b"{}")
        except ValueError as exc:
            raise ToolError("Dữ liệu JSON không hợp lệ.") from exc

    # -- file tĩnh: ETag + nén gzip có cache ------------------------------
    def _static(self, path):
        rel = "index.html" if path in ("", "/") else unquote(path).lstrip("/")
        full = os.path.normpath(os.path.join(WEB, rel))
        if not full.startswith(WEB + os.sep) or not os.path.isfile(full) or os.path.basename(full).startswith("."):
            full = os.path.join(WEB, "index.html")      # router phía client dùng #/…
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if full.endswith(".js"):
            ctype = "application/javascript"
        if ctype.startswith("text/") or ctype in ("application/javascript", "image/svg+xml", "application/json"):
            ctype += "; charset=utf-8"
        if os.path.basename(full) == "index.html":
            # chèn khoá phiên vào trang — không cache trang này
            with open(full, encoding="utf-8") as fh:
                html = fh.read().replace("__GDK_TOKEN__", SESSION_TOKEN)
            return self._send(200, html, ctype)
        st = os.stat(full)
        etag = 'W/"{:x}-{:x}"'.format(st.st_mtime_ns, st.st_size)
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None
        cached = _STATIC_CACHE.get(full)
        if not cached or cached[0] != st.st_mtime_ns or cached[1] != st.st_size:
            with open(full, "rb") as fh:
                raw = fh.read()
            gz = gzip.compress(raw, compresslevel=9) if len(raw) >= GZIP_MIN and ctype.startswith(TEXT_TYPES) else None
            cached = (st.st_mtime_ns, st.st_size, raw, gz)
            _STATIC_CACHE[full] = cached
        return self._send(200, cached[2], ctype, cache="no-cache", etag=etag, gz=cached[3])

    # -- định tuyến -------------------------------------------------------
    def _dispatch(self, method):
        self._extra_headers = []
        self._body_read = False
        context.clear()
        if not self._client_ok():
            return self._send(403, {"error": "Chỉ máy trong mạng nội bộ được truy cập."})
        if not self._host_ok():
            return self._send(403, {"error": "Địa chỉ truy cập không hợp lệ — dùng địa chỉ IP / tên máy chủ Tool Kit."})
        url = urlparse(self.path)
        path, query = url.path, parse_qs(url.query)
        sid = self._sid()
        user = USERS.check(sid)
        context.set_current(user, self.client_address[0])
        try:
            return self._route(method, path, query, sid, user)
        finally:
            context.clear()

    def _route(self, method, path, query, sid, user):
        authed = bool(user) and not user.get("must_change")      # phải đổi mật khẩu tạm trước khi dùng
        if path.startswith("/api/auth/"):
            return self._auth_api(method, path[len("/api/auth/"):].strip("/"), query, sid, user)
        if not path.startswith("/api/"):
            if method not in ("GET", "HEAD"):
                return self._send(405, {"error": "method"})
            rel = unquote(path).lstrip("/")
            if not authed:
                if rel in PUBLIC_STATIC:
                    return self._static(path)
                if rel in ("", "index.html", "login") or "." not in os.path.basename(rel):
                    return self._static("/login.html")          # trang đăng nhập / tạo mật khẩu
                return self._send(401, "Cần đăng nhập.", "text/plain; charset=utf-8")
            if rel in ("login", "login.html"):
                self._extra_headers.append(("Location", "/"))
                return self._send(302, "", "text/plain; charset=utf-8")
            return self._static(path)
        if not authed:
            return self._send(401, {"error": "Cần đăng nhập lại." if not user else "Cần đổi mật khẩu tạm trước.",
                                    "code": "login"})
        if not self._token_ok(query):
            return self._send(401, {"error": "Phiên làm việc đã hết hạn (server vừa khởi động lại) — tải lại trang (F5).",
                                    "code": "token"})
        try:
            parts = path[len("/api/"):].strip("/").split("/")
            # tải file Excel lên: gửi thẳng byte (không base64) để nhanh và nhẹ
            if parts == ["table", "xlsx"] and method == "POST":
                raw = self._raw_body(MAX_UPLOAD)
                return self._send(200, parse_xlsx_bytes(raw, (query.get("sheet") or [None])[0]))
            body = self._json_body() if method == "POST" else {}
            if parts == ["export", "xlsx"] and method == "POST":
                pw = body.get("password") or None
                data = to_xlsx(body.get("sheets") or [], pw)
                name = os.path.basename(str(body.get("name") or "export.xlsx")).replace('"', "")
                if not name.lower().endswith(".xlsx"):
                    name += ".xlsx"
                if pw:
                    audit.record("export.xlsx_encrypted", file=name)
                return self._send(200, data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename=name)
            if parts[0] == "tools" and len(parts) >= 3:
                entry = TOOLS.get(parts[1])
                if not entry:
                    return self._send(404, {"error": "Không có tool: " + parts[1]})
                if not tool_enabled(parts[1]) and not _is_admin():
                    return self._send(403, {"error": "Tool này đang tạm tắt — liên hệ quản trị viên để bật lại."})
                mod = entry[1]
                if parts[2] == "files" and hasattr(mod, "file"):
                    data, ctype, name = mod.file("/".join(parts[3:]))
                    USERS.log("export", tool=parts[1], detail="/".join(parts[3:]))
                    return self._send(200, data, ctype, filename=name)
                action = "/".join(parts[2:])
                result = mod.api(action, body, query) or {}
                if method == "POST" and parts[2] not in QUIET_TOOL_ACTIONS:
                    USERS.log("run", tool=parts[1], detail=_brief(action, body))
                return self._send(200, result)
            return self._send(200, core_api("/".join(parts), body, query) or {})
        except ToolError as exc:
            return self._send(400, {"error": str(exc)})
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            return self._send(500, {"error": "{}: {}".format(type(exc).__name__, exc)})

    def do_GET(self):
        self._dispatch("GET")

    def do_HEAD(self):
        self._dispatch("HEAD")

    def do_POST(self):
        self._dispatch("POST")


def _brief(action, body):
    """Tóm tắt thao tác cho nhật ký: tên action + vài trường ngắn (không ghi nội dung file / mật khẩu)."""
    keep = []
    for k, v in (body or {}).items():
        if k in ("password", "content", "data", "sheets", "profile") or isinstance(v, (dict, list)):
            continue
        keep.append("{}={}".format(k, str(v)[:60]))
    return (action + (" · " + ", ".join(keep[:4]) if keep else ""))[:300]


class _Server(ThreadingHTTPServer):
    # Windows: SO_REUSEADDR cho phép 2 server cùng nghe 1 cổng → mở start.bat lần 2 khi bản cũ còn chạy thì trình
    # duyệt vẫn nối vào BẢN CŨ (không thấy tool mới). Dùng cổng độc quyền để lần mở sau biết cổng đang bận.
    allow_reuse_address = os.name != "nt"

    def server_bind(self):
        if os.name == "nt" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

    def handle_error(self, request, client_address):
        # trình duyệt / client tự ngắt kết nối giữa chừng (đóng tab, huỷ tải) là bình thường — không in traceback
        if isinstance(sys.exc_info()[1], ConnectionError):
            return
        super().handle_error(request, client_address)


def make_server(port, lan=None):
    lan = NET["lan"] if lan is None else lan
    httpd = _Server(("0.0.0.0" if lan else "127.0.0.1", port), Handler)
    httpd.daemon_threads = True
    return httpd


# ------------------------------------------------------------------ chỉ chạy 1 bản trên 1 cổng
def listening_pids(port, netstat_text=None):
    """PID đang nghe cổng `port` — đọc `netstat -ano` (dựa vào địa chỉ 0.0.0.0:0, không phụ thuộc ngôn ngữ Windows)."""
    if netstat_text is None:
        netstat_text = subprocess.run(["netstat", "-ano", "-p", "TCP"], capture_output=True, text=True,
                                      errors="replace", timeout=15).stdout
    pids = set()
    for line in netstat_text.splitlines():
        p = line.split()
        if (len(p) >= 5 and p[0].upper() == "TCP" and p[1].rsplit(":", 1)[-1] == str(port)
                and p[2] in ("0.0.0.0:0", "[::]:0") and p[-1].isdigit()):
            pids.add(int(p[-1]))
    return sorted(pids)


def _is_toolkit(port):
    """Cổng đó có phải GD Toolkit không: hỏi API trạng thái đăng nhập (không cần mật khẩu)."""
    try:
        with urllib.request.urlopen("http://127.0.0.1:{}/api/auth/status".format(port), timeout=3) as r:
            data = json.loads(r.read().decode("utf-8"))
        return isinstance(data, dict) and "setup" in data and "min_len" in data
    except Exception:  # noqa: BLE001
        return False


def _processes():
    # xuất UTF-8 (tên / dòng lệnh có dấu) và đọc JSON không khắt khe: dòng lệnh của chương trình khác có thể chứa
    # ký tự điều khiển mà ConvertTo-Json của PowerShell 5 không escape
    ps = ("[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-CimInstance Win32_Process | "
          "Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress")
    out = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, timeout=40).stdout
    rows = json.loads(out.decode("utf-8-sig", "replace") or "[]", strict=False)
    return {r["ProcessId"]: r for r in (rows if isinstance(rows, list) else [rows])}


def old_instance_tree(pid, procs, root=ROOT):
    """Tiến trình gốc cần tắt để dừng hẳn bản cũ: đi ngược từ server lên launcher của .venv (cùng dòng lệnh) và
    cửa sổ cmd đang chạy start.bat của thư mục này — tắt cả cửa sổ cũ để người dùng không nhầm."""
    top, cur = pid, procs.get(pid)
    while cur:
        parent = procs.get(cur.get("ParentProcessId"))
        if not parent:
            break
        name, cmd = (parent.get("Name") or "").lower(), parent.get("CommandLine") or ""
        if (name == "python.exe" and cmd == cur.get("CommandLine")) or (
                name == "cmd.exe" and "start.bat" in cmd.lower() and root.lower() in cmd.lower()):
            top, cur = parent["ProcessId"], parent
        else:
            break
    return top


def stop_old_instance(port):
    """Windows: tắt GD Toolkit cũ còn giữ cổng (vd cửa sổ start.bat mở từ trước, quên chưa đóng). Chỉ tắt khi chắc
    chắn là Tool Kit: cổng trả lời đúng API của Tool Kit VÀ tiến trình đang chạy server.py. Không bao giờ tắt tiến
    trình cha của chính mình. Trả về danh sách PID đã tắt."""
    if os.name != "nt" or not _is_toolkit(port):
        return []
    try:
        procs = _processes()
    except Exception as exc:  # noqa: BLE001
        print("Không đọc được danh sách tiến trình để tắt bản cũ: {}".format(exc))
        return []
    mine, cur = set(), procs.get(os.getpid())
    while cur and cur["ProcessId"] not in mine:
        mine.add(cur["ProcessId"])
        cur = procs.get(cur.get("ParentProcessId"))
    killed = []
    for pid in listening_pids(port):
        p = procs.get(pid)
        if pid in mine or not p or "server.py" not in (p.get("CommandLine") or ""):
            continue
        top = old_instance_tree(pid, procs)
        if top in mine:
            top = pid
        subprocess.run(["taskkill", "/PID", str(top), "/T", "/F"], capture_output=True, timeout=15)
        killed.append(top)
    return killed


def serve(port, open_browser, lan=None):
    url = "http://127.0.0.1:{}/".format(port)
    os.makedirs(DATA, exist_ok=True)
    global USERS
    if lan is not None:
        save_net(lan)
    setup_net(load_net(), port)
    USERS = USERS or Users(DATA)
    admins = [u for u in USERS.list_users() if u["role"] == "admin"]
    google_auth.migrate(admins[0]["id"] if admins else None)
    try:
        httpd = make_server(port)
    except OSError:
        httpd = None
        killed = stop_old_instance(port)
        if killed:
            print("Đã tắt GD Toolkit bản cũ đang chạy ở cổng {} (PID {}) — từ giờ dùng bản mới này.".format(
                port, ", ".join(map(str, killed))))
            audit.record("server.replaced_old", port=port, pids=killed)
            for _ in range(40):                       # chờ Windows nhả cổng
                time.sleep(0.25)
                try:
                    httpd = make_server(port)
                    break
                except OSError:
                    pass
        if httpd is None:
            print("Cổng {} đang bị chương trình khác dùng. Đóng chương trình đó, hoặc mở bằng cổng khác:".format(port))
            print("    start.bat --port 7710")
            return 1
    audit.record("server.start", port=port, version=VERSION)
    print("GD Toolkit v{} — {} tool: {}".format(VERSION, len(TOOLS), ", ".join(TOOLS) or "(chưa có)"))
    print("Bảo mật: {} · tài khoản riêng · khoá phiên · CSP · bí mật mã hoá {}".format(
        "mạng nội bộ" if NET["lan"] else "chỉ máy này (127.0.0.1)",
        "DPAPI" if secure.dpapi_available() else "(không có DPAPI — chỉ chmod 600)"))
    print("Tài khoản: " + ("{} người · quản trị: {}".format(USERS.count(), ", ".join(u["username"] for u in admins))
                           if admins else "CHƯA có — mở trình duyệt để tạo tài khoản quản trị ngay"))
    print("Mở trình duyệt: " + url + "   (Ctrl+C để tắt)")
    if NET["lan"]:
        print("Máy khác trong mạng nội bộ mở: " + "  ·  ".join(NET["urls"] or ["(không tìm thấy địa chỉ nội bộ)"]))
        print("  (Windows hỏi tường lửa → chọn Cho phép trên mạng Private / mạng riêng)")
    if open_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nĐã tắt.")
    return 0


def run_tests():
    code = 0
    for name in ["core.selftest"] + sorted({mod.__name__ for _, mod in TOOLS.values()}):
        try:
            st = importlib.import_module(name + ("" if name == "core.selftest" else ".selftest"))
        except ImportError:
            continue
        code |= st.main()
    # phần tính toán chạy trên trình duyệt (web/lib) được test bằng Node
    tests = os.path.join(ROOT, "tests", "js")
    files = sorted(os.path.join(tests, f) for f in os.listdir(tests) if f.endswith(".test.js")) if os.path.isdir(tests) else []
    if files and shutil.which("node"):
        print("\n=== TEST JS (web/lib) ===", flush=True)
        code |= subprocess.call(["node", "--test", "--test-reporter=spec"] + files)
    elif files:
        print("\n[!] Không có Node.js — bỏ qua test JS ở tests/js.")
    return code


def set_password(username=None):
    global USERS
    USERS = USERS or Users(DATA)
    users = USERS.list_users()
    if not users:
        print("Chưa có tài khoản nào — mở Tool Kit trên trình duyệt để tạo tài khoản quản trị.")
        return 1
    if not username:
        print("Tài khoản: " + ", ".join("{} ({})".format(u["username"], u["role"]) for u in users))
        username = input("Đặt lại mật khẩu cho tài khoản [{}]: ".format(
            next(u["username"] for u in users if u["role"] == "admin"))).strip() or next(
            u["username"] for u in users if u["role"] == "admin")
    print("Đặt mật khẩu mới cho “{}” (ít nhất 8 ký tự). Mọi phiên của tài khoản này sẽ bị đăng xuất.".format(username))
    for _ in range(3):
        a = getpass.getpass("Mật khẩu mới: ")
        b = getpass.getpass("Nhập lại: ")
        if a != b:
            print("Hai lần nhập không khớp — thử lại.")
            continue
        try:
            USERS.set_password_cli(username, a)
        except ToolError as exc:
            print(exc)
            if "Không có tài khoản" in str(exc):
                return 1
            continue
        print("Đã đặt mật khẩu mới.")
        return 0
    return 1


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", nargs="?", default="serve", choices=["serve", "test", "set-password"])
    ap.add_argument("username", nargs="?", help="tên đăng nhập (cho set-password)")
    ap.add_argument("--port", type=int, default=PORT)
    ap.add_argument("--lan", action="store_true", help="cho máy khác trong mạng nội bộ truy cập (lưu lại)")
    ap.add_argument("--local", action="store_true", help="chỉ máy này truy cập (lưu lại)")
    ap.add_argument("--no-open", action="store_true")
    ap.add_argument("--data-dir", help="thư mục dữ liệu riêng (data/ + out/) — để chạy thử không đụng dữ liệu thật")
    args = ap.parse_args(argv)
    if args.cmd == "test":
        return run_tests()
    if args.cmd == "set-password":
        return set_password(args.username)
    return serve(args.port, not args.no_open, True if args.lan else False if args.local else None)


if __name__ == "__main__":
    sys.exit(main())

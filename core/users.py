"""Tài khoản người dùng, phiên đăng nhập và nhật ký sử dụng — 1 cơ sở dữ liệu SQLite: data/gdk.db.

- Mỗi người 1 tài khoản (tên đăng nhập + mật khẩu). Vai trò: "admin" (quản lý tài khoản, xem nhật ký, đổi cài đặt
  mạng) hoặc "user". Mật khẩu chỉ lưu băm scrypt (xem core/login.py), không bao giờ lưu dạng chữ.
- Quản trị viên tạo tài khoản → tool sinh mật khẩu tạm, người dùng phải đổi ở lần đăng nhập đầu.
- Phiên: cookie ngẫu nhiên 256-bit, DB chỉ giữ SHA-256. Phiên thường hết hạn sau 4 giờ không dùng, "ghi nhớ" 7 ngày.
- Chống dò mật khẩu: sai 5 lần (theo tên đăng nhập HOẶC theo máy) → khoá 30 giây, gấp đôi mỗi lần sai tiếp (≤ 15 phút).
- Nhật ký sử dụng: ai mở tool nào, nạp / xuất file gì, chạy gì, lúc nào, từ máy nào → bảng usage + file
  data/logs/usage-YYYY-MM.csv (mở bằng Excel).
- Bản cũ chỉ có 1 mật khẩu (data/auth.json) → tự chuyển thành tài khoản quản trị "admin" với đúng mật khẩu đó.
"""
from __future__ import annotations

import base64
import csv
import datetime
import getpass
import hmac
import json
import os
import re
import secrets
import sqlite3
import threading
import time

from . import ToolError, audit, context
from .login import (FREE_FAILS, IDLE_SEC, LOCK_BASE, LOCK_MAX, MIN_LEN, REMEMBER_SEC, LockedError, _b64, _hash,
                    _new_kdf, _sid_hash)

USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{1,31}$")
ROLES = ("admin", "user")
USAGE_ACTIONS = {"open", "import", "export", "sample", "run", "save"}
SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'user',
  pw TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, must_change INTEGER NOT NULL DEFAULT 0,
  created TEXT NOT NULL, last_login TEXT, last_ip TEXT, google INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions (
  h TEXT PRIMARY KEY, uid INTEGER NOT NULL, created REAL NOT NULL, exp REAL NOT NULL, idle REAL NOT NULL,
  remember INTEGER NOT NULL, ip TEXT, ua TEXT, last_seen REAL);
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY, ts TEXT NOT NULL, uid INTEGER, username TEXT, ip TEXT, action TEXT NOT NULL, tool TEXT, detail TEXT);
CREATE INDEX IF NOT EXISTS usage_ts ON usage(ts);
CREATE INDEX IF NOT EXISTS usage_user ON usage(uid, ts);
"""
_DUMMY = None


def _pw_record(password):
    if len(password or "") < MIN_LEN:
        raise ToolError("Mật khẩu cần ít nhất {} ký tự.".format(MIN_LEN))
    if password.strip() != password:
        raise ToolError("Mật khẩu không được có dấu cách ở đầu / cuối.")
    kdf, salt = _new_kdf(), secrets.token_bytes(16)
    return json.dumps({"v": 1, "kdf": kdf, "salt": _b64(salt), "hash": _b64(_hash(password, salt, kdf))})


def _pw_ok(record, password):
    data = json.loads(record)
    got = _hash(password or "", base64.b64decode(data["salt"]), data["kdf"])
    return hmac.compare_digest(got, base64.b64decode(data["hash"]))


def temp_password():
    """Mật khẩu tạm dễ đọc / gõ (không có 0/O, 1/l/I): Xxxx-xxxx-xxxx."""
    abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
    s = "".join(secrets.choice(abc) for _ in range(12))
    return s[:4] + "-" + s[4:8] + "-" + s[8:]


def clean_username(name):
    u = (name or "").strip().lower()
    if not USERNAME_RE.match(u):
        raise ToolError("Tên đăng nhập 2–32 ký tự: chữ thường không dấu, số, dấu chấm, gạch ngang / gạch dưới (vd: dung.nt).")
    return u


class Users:
    def __init__(self, folder, clock=time.time):
        self.folder = folder
        self.path = os.path.join(folder, "gdk.db")
        self.log_dir = os.path.join(folder, "logs")
        self.now = clock
        self._lock = threading.RLock()
        self._fails = {}            # "u:<tên>" / "ip:<địa chỉ>" -> [số lần sai, khoá tới lúc]
        os.makedirs(folder, exist_ok=True)
        self.db = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None, timeout=10)
        self.db.row_factory = sqlite3.Row
        with self._lock:
            self.db.execute("PRAGMA journal_mode=WAL")
            self.db.executescript(SCHEMA)
            # DB của bản trước chưa có cột google (quyền dùng Google dùng chung do quản trị viên cấp)
            if "google" not in [r[1] for r in self.db.execute("PRAGMA table_info(users)").fetchall()]:
                self.db.execute("ALTER TABLE users ADD COLUMN google INTEGER NOT NULL DEFAULT 0")
        self._migrate_single_password()

    # ------------------------------------------------------------ tiện ích DB
    def _all(self, sql, args=()):
        with self._lock:
            return [dict(r) for r in self.db.execute(sql, args).fetchall()]

    def _one(self, sql, args=()):
        with self._lock:
            r = self.db.execute(sql, args).fetchone()
        return dict(r) if r else None

    def _run(self, sql, args=()):
        with self._lock:
            return self.db.execute(sql, args)

    def _stamp(self, t=None):
        return datetime.datetime.fromtimestamp(self.now() if t is None else t).isoformat(timespec="seconds")

    @staticmethod
    def public(u):
        if not u:
            return None
        return {k: u.get(k) for k in ("id", "username", "name", "role", "active", "must_change", "created",
                                      "last_login", "last_ip", "google")}

    def close(self):
        with self._lock:
            self.db.close()

    # ------------------------------------------------------------ chuyển từ bản 1 mật khẩu
    def _migrate_single_password(self):
        old = os.path.join(self.folder, "auth.json")
        if self.count() or not os.path.exists(old):
            return
        with open(old, encoding="utf-8") as fh:
            rec = json.load(fh)
        try:
            owner = getpass.getuser()
        except Exception:  # noqa: BLE001
            owner = "Quản trị viên"
        self._run("INSERT INTO users(username, name, role, pw, created) VALUES (?, ?, 'admin', ?, ?)",
                  ("admin", owner, json.dumps({k: rec[k] for k in ("v", "kdf", "salt", "hash")}), self._stamp()))
        os.replace(old, old + ".migrated")
        try:
            os.remove(os.path.join(self.folder, "sessions.json"))
        except OSError:
            pass
        audit.record("auth.migrated_to_accounts", admin="admin")

    # ------------------------------------------------------------ tài khoản
    def count(self, role=None, active_only=False):
        sql, args = "SELECT COUNT(*) AS n FROM users WHERE 1=1", []
        if role:
            sql += " AND role = ?"; args.append(role)
        if active_only:
            sql += " AND active = 1"
        return self._one(sql, args)["n"]

    def needs_setup(self):
        return self.count() == 0

    def get(self, uid):
        return self._one("SELECT * FROM users WHERE id = ?", (uid,))

    def by_username(self, username):
        return self._one("SELECT * FROM users WHERE username = ?", ((username or "").strip().lower(),))

    def list_users(self):
        now = self.now()
        rows = self._all("SELECT * FROM users ORDER BY role = 'admin' DESC, username")
        open_ = {r["uid"]: r["n"] for r in self._all(
            "SELECT uid, COUNT(*) AS n FROM sessions WHERE exp >= ? AND idle >= ? GROUP BY uid", (now, now))}
        return [dict(self.public(u), sessions=open_.get(u["id"], 0)) for u in rows]

    def setup(self, username, name, password, ip="", ua=""):
        """Tài khoản đầu tiên = quản trị viên. Đã có tài khoản thì không ai tạo thêm qua đường này."""
        with self._lock:
            if not self.needs_setup():
                raise ToolError("Tool Kit đã có tài khoản. Hãy đăng nhập.")
            uid = self._insert(username, name, "admin", _pw_record(password), must_change=0)
        self._run("UPDATE users SET last_login = ?, last_ip = ? WHERE id = ?", (self._stamp(), ip, uid))
        u = self.get(uid)
        context.set_current(self.public(u), ip)
        audit.record("auth.admin_created", username=u["username"])
        self.log("login", user=u, ip=ip)
        return self.create_session(uid, False, ip, ua)

    def _insert(self, username, name, role, pw, must_change):
        u = clean_username(username)
        if role not in ROLES:
            raise ToolError("Vai trò không hợp lệ.")
        if self.by_username(u):
            raise ToolError("Tên đăng nhập “{}” đã có.".format(u))
        cur = self._run("INSERT INTO users(username, name, role, pw, must_change, created) VALUES (?, ?, ?, ?, ?, ?)",
                        (u, (name or "").strip()[:60] or u, role, pw, must_change, self._stamp()))
        return cur.lastrowid

    def create_user(self, username, name, role="user"):
        """Quản trị viên tạo tài khoản: sinh mật khẩu tạm (chỉ hiện 1 lần), bắt đổi ở lần đăng nhập đầu."""
        pw = temp_password()
        uid = self._insert(username, name, role, _pw_record(pw), must_change=1)
        audit.record("admin.user_created", target=clean_username(username), role=role)
        return {"user": self.public(self.get(uid)), "password": pw}

    def _guard_last_admin(self, uid, becomes_inactive_or_user):
        u = self.get(uid)
        if u and u["role"] == "admin" and u["active"] and becomes_inactive_or_user and self.count("admin", True) <= 1:
            raise ToolError("Phải còn ít nhất 1 quản trị viên đang hoạt động.")

    def update_user(self, uid, actor_id, name=None, role=None, active=None, google=None):
        u = self.get(uid)
        if not u:
            raise ToolError("Không có tài khoản này.")
        if role is not None and role not in ROLES:
            raise ToolError("Vai trò không hợp lệ.")
        if uid == actor_id and (active is False or role == "user"):
            raise ToolError("Không tự khoá / tự bỏ quyền quản trị của chính mình.")
        self._guard_last_admin(uid, active is False or role == "user")
        if name is not None:
            self._run("UPDATE users SET name = ? WHERE id = ?", ((name or "").strip()[:60] or u["username"], uid))
        if role is not None:
            self._run("UPDATE users SET role = ? WHERE id = ?", (role, uid))
        if active is not None:
            self._run("UPDATE users SET active = ? WHERE id = ?", (1 if active else 0, uid))
            if not active:
                self.logout_user(uid)
        if google is not None:
            self._run("UPDATE users SET google = ? WHERE id = ?", (1 if google else 0, uid))
        audit.record("admin.user_updated", target=u["username"], name=name, role=role, active=active, google=google)
        return self.public(self.get(uid))

    def reset_password(self, uid):
        u = self.get(uid)
        if not u:
            raise ToolError("Không có tài khoản này.")
        pw = temp_password()
        self._run("UPDATE users SET pw = ?, must_change = 1 WHERE id = ?", (_pw_record(pw), uid))
        self.logout_user(uid)
        self._fails.pop("u:" + u["username"], None)
        audit.record("admin.password_reset", target=u["username"])
        return {"user": self.public(self.get(uid)), "password": pw}

    def delete_user(self, uid, actor_id):
        u = self.get(uid)
        if not u:
            raise ToolError("Không có tài khoản này.")
        if uid == actor_id:
            raise ToolError("Không tự xoá tài khoản của chính mình.")
        self._guard_last_admin(uid, True)
        self._run("DELETE FROM sessions WHERE uid = ?", (uid,))
        self._run("DELETE FROM users WHERE id = ?", (uid,))
        audit.record("admin.user_deleted", target=u["username"])
        return {"ok": True}

    def set_password_cli(self, username, password):
        """Lệnh `server.py set-password` (người ngồi trước máy chủ): đặt lại mật khẩu, mở khoá, đăng xuất."""
        u = self.by_username(username)
        if not u:
            raise ToolError("Không có tài khoản “{}”.".format(username))
        self._run("UPDATE users SET pw = ?, must_change = 0, active = 1 WHERE id = ?", (_pw_record(password), u["id"]))
        self.logout_user(u["id"])
        self._fails.clear()
        audit.record("auth.password_reset_cli", target=u["username"])

    def change_password(self, uid, old, new, keep_token=None):
        u = self.get(uid)
        if not u or not _pw_ok(u["pw"], old):
            audit.record("auth.change_failed")
            raise ToolError("Mật khẩu hiện tại không đúng.")
        if old == new:
            raise ToolError("Mật khẩu mới phải khác mật khẩu cũ.")
        self._run("UPDATE users SET pw = ?, must_change = 0 WHERE id = ?", (_pw_record(new), uid))
        self.logout_user(uid, except_token=keep_token)
        audit.record("auth.password_changed")
        return {"ok": True}

    # ------------------------------------------------------------ đăng nhập
    def lock_left(self, key):
        f = self._fails.get(key)
        return max(0, int(round(f[1] - self.now()))) if f else 0

    def _fail(self, keys):
        n = 0
        with self._lock:
            for k in keys:
                f = self._fails.setdefault(k, [0, 0.0])
                f[0] += 1
                if f[0] >= FREE_FAILS:
                    f[1] = self.now() + min(LOCK_MAX, LOCK_BASE * 2 ** (f[0] - FREE_FAILS))
                n = max(n, f[0])
        return n

    def login(self, username, password, remember=False, ip="", ua=""):
        global _DUMMY
        uname = (username or "").strip().lower()
        keys = ["u:" + uname, "ip:" + (ip or "?")]
        left = max(self.lock_left(k) for k in keys)
        if left:
            raise LockedError(left)
        u = self.by_username(uname)
        if u:
            ok = _pw_ok(u["pw"], password)
        else:                                   # vẫn băm để không lộ "tên này có tồn tại" qua thời gian trả lời
            _DUMMY = _DUMMY or _pw_record("khong-phai-mat-khau")
            _pw_ok(_DUMMY, password)
            ok = False
        if not ok:
            n = self._fail(keys)
            audit.record("auth.login_failed", username=uname[:32], fails=n)
            if n >= FREE_FAILS:
                audit.record("auth.locked", username=uname[:32], seconds=max(self.lock_left(k) for k in keys))
                raise LockedError(max(self.lock_left(k) for k in keys))
            raise ToolError("Sai tên đăng nhập hoặc mật khẩu. Còn {} lần thử trước khi bị khoá tạm.".format(FREE_FAILS - n))
        if not u["active"]:
            audit.record("auth.login_disabled", username=uname)
            raise ToolError("Tài khoản này đang bị khoá — liên hệ quản trị viên.")
        for k in keys:
            self._fails.pop(k, None)
        self._run("UPDATE users SET last_login = ?, last_ip = ? WHERE id = ?", (self._stamp(), ip, u["id"]))
        context.set_current(self.public(u), ip)
        audit.record("auth.login", remember=bool(remember))
        self.log("login", user=u, ip=ip)
        return self.create_session(u["id"], remember, ip, ua)

    # ------------------------------------------------------------ phiên
    def create_session(self, uid, remember, ip="", ua=""):
        token = secrets.token_urlsafe(32)
        now = self.now()
        life = REMEMBER_SEC if remember else 24 * 3600
        self._run("INSERT INTO sessions(h, uid, created, exp, idle, remember, ip, ua, last_seen) VALUES (?,?,?,?,?,?,?,?,?)",
                  (_sid_hash(token), uid, now, now + life, now + (REMEMBER_SEC if remember else IDLE_SEC),
                   1 if remember else 0, ip, (ua or "")[:200], now))
        return {"token": token, "max_age": REMEMBER_SEC if remember else None}

    def check(self, token):
        """Cookie hợp lệ → người dùng (kèm hash phiên); không thì None. Phiên thường được gia hạn khi còn dùng."""
        if not token:
            return None
        h = _sid_hash(token)
        now = self.now()
        s = self._one("SELECT * FROM sessions WHERE h = ?", (h,))
        if not s:
            return None
        u = self.get(s["uid"])
        if now > s["exp"] or now > s["idle"] or not u or not u["active"]:
            self._run("DELETE FROM sessions WHERE h = ?", (h,))
            return None
        if now - (s["last_seen"] or 0) > 30:   # ghi lại tối đa 30 giây / lần — đỡ ghi DB mỗi request
            idle = s["idle"] if s["remember"] else now + IDLE_SEC
            self._run("UPDATE sessions SET last_seen = ?, idle = ? WHERE h = ?", (now, idle, h))
        return dict(self.public(u), session=h[:12])

    def logout(self, token):
        self._run("DELETE FROM sessions WHERE h = ?", (_sid_hash(token or ""),))
        audit.record("auth.logout")
        self.log("logout")

    def logout_user(self, uid, except_token=None):
        keep = _sid_hash(except_token) if except_token else ""
        self._run("DELETE FROM sessions WHERE uid = ? AND h != ?", (uid, keep))

    def sessions(self):
        now = self.now()
        self._run("DELETE FROM sessions WHERE exp < ? OR idle < ?", (now, now))
        rows = self._all("SELECT s.h, s.uid, s.created, s.last_seen, s.remember, s.ip, s.ua, u.username, u.name "
                         "FROM sessions s JOIN users u ON u.id = s.uid ORDER BY s.last_seen DESC")
        for r in rows:
            r["id"] = r.pop("h")[:12]
            r["created"] = self._stamp(r["created"])
            r["last_seen"] = self._stamp(r["last_seen"] or 0)
        return rows

    def kill_session(self, short_id):
        n = self._run("DELETE FROM sessions WHERE substr(h, 1, 12) = ?", (str(short_id)[:12],)).rowcount
        if not n:
            raise ToolError("Không còn phiên này.")
        audit.record("admin.session_killed")
        return {"ok": True}

    def status(self, token, ip=""):
        u = self.check(token)
        return {"setup": not self.needs_setup(), "authed": bool(u), "user": u, "must_change": bool(u and u["must_change"]),
                "locked": self.lock_left("ip:" + (ip or "?")), "min_len": MIN_LEN}

    # ------------------------------------------------------------ nhật ký sử dụng
    def log(self, action, tool=None, detail=None, user=None, ip=None):
        """Ghi 1 dòng nhật ký sử dụng vào DB + file CSV theo tháng (data/logs/usage-YYYY-MM.csv)."""
        user = user or context.user() or {}
        ip = ip if ip is not None else context.ip()
        ts = self._stamp()
        detail = (str(detail) if detail is not None else "")[:500]
        row = (ts, user.get("id"), user.get("username") or "", ip or "", str(action)[:40], (tool or "")[:60], detail)
        self._run("INSERT INTO usage(ts, uid, username, ip, action, tool, detail) VALUES (?,?,?,?,?,?,?)", row)
        try:
            os.makedirs(self.log_dir, exist_ok=True)
            path = os.path.join(self.log_dir, "usage-{}.csv".format(ts[:7]))
            new = not os.path.exists(path)
            with self._lock, open(path, "a", encoding="utf-8-sig" if new else "utf-8", newline="") as fh:
                w = csv.writer(fh)
                if new:
                    w.writerow(["thời gian", "tài khoản", "máy (IP)", "hành động", "tool", "chi tiết"])
                w.writerow([row[0], row[2], row[3], row[4], row[5], _csv_safe(row[6])])
        except OSError:
            pass

    def usage(self, uid=None, tool=None, action=None, since=None, until=None, q=None, limit=200, offset=0):
        where, args = ["1=1"], []
        if uid:
            where.append("uid = ?"); args.append(int(uid))
        if tool:
            where.append("tool = ?"); args.append(tool)
        if action:
            where.append("action = ?"); args.append(action)
        if since:
            where.append("ts >= ?"); args.append(str(since)[:10])
        if until:
            where.append("ts < ?"); args.append(_next_day(str(until)[:10]))
        if q:
            where.append("(detail LIKE ? OR username LIKE ? OR ip LIKE ?)"); args += ["%" + q + "%"] * 3
        w = " AND ".join(where)
        total = self._one("SELECT COUNT(*) AS n FROM usage WHERE " + w, args)["n"]
        limit = max(1, min(int(limit or 200), 20000))
        rows = self._all("SELECT ts, username, ip, action, tool, detail FROM usage WHERE " + w +
                         " ORDER BY id DESC LIMIT ? OFFSET ?", args + [limit, max(0, int(offset or 0))])
        return {"rows": rows, "total": total}

    def stats(self, days=30):
        since = (datetime.datetime.fromtimestamp(self.now()) - datetime.timedelta(days=int(days) - 1)).date().isoformat()
        by_tool = self._all("SELECT tool, COUNT(*) AS n, COUNT(DISTINCT uid) AS users FROM usage "
                            "WHERE ts >= ? AND tool != '' GROUP BY tool ORDER BY n DESC", (since,))
        by_user = self._all("SELECT username, COUNT(*) AS n, MAX(ts) AS last FROM usage WHERE ts >= ? AND username != '' "
                            "GROUP BY username ORDER BY n DESC", (since,))
        by_day = self._all("SELECT substr(ts, 1, 10) AS day, COUNT(*) AS n, COUNT(DISTINCT uid) AS users FROM usage "
                           "WHERE ts >= ? GROUP BY day ORDER BY day", (since,))
        return {"since": since, "days": int(days), "by_tool": by_tool, "by_user": by_user, "by_day": by_day,
                "events": sum(r["n"] for r in by_day), "active_users": len(by_user)}


def _next_day(day):
    try:
        return (datetime.date.fromisoformat(day) + datetime.timedelta(days=1)).isoformat()
    except ValueError:
        return day


def _csv_safe(s):
    # chặn chèn công thức khi mở file log bằng Excel
    return "'" + s if s[:1] in ("=", "+", "-", "@") else s


__all__ = ["Users", "LockedError", "temp_password", "clean_username", "USAGE_ACTIONS"]

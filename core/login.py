"""Băm mật khẩu + hằng số đăng nhập dùng chung (tài khoản, phiên: xem core/users.py).

- Mật khẩu KHÔNG lưu dạng chữ: chỉ lưu băm scrypt (n=2^15, r=8, p=1) + salt ngẫu nhiên.
- Phiên thường hết hạn sau 4 giờ không dùng; "ghi nhớ trên máy này" 7 ngày.
- Chống dò mật khẩu: sai 5 lần liên tiếp → khoá 30 giây, mỗi lần sai tiếp theo khoá gấp đôi (tối đa 15 phút).
- Quên mật khẩu: chạy `python server.py set-password` ngay trên máy chủ (cần quyền vào máy = chủ máy).
"""
from __future__ import annotations

import base64
import hashlib
import hmac

from . import ToolError

MIN_LEN = 8
IDLE_SEC = 4 * 3600
REMEMBER_SEC = 7 * 24 * 3600
FREE_FAILS = 5
LOCK_BASE, LOCK_MAX = 30, 15 * 60
SCRYPT = {"n": 2 ** 15, "r": 8, "p": 1}


def _b64(b):
    return base64.b64encode(b).decode("ascii")


def _hash(password, salt, kdf):
    pw = password.encode("utf-8")
    if kdf.get("name") == "scrypt":
        return hashlib.scrypt(pw, salt=salt, n=kdf["n"], r=kdf["r"], p=kdf["p"], maxmem=128 * 1024 * 1024, dklen=32)
    return hashlib.pbkdf2_hmac("sha256", pw, salt, kdf.get("iter", 600000), dklen=32)


def _new_kdf():
    try:
        hashlib.scrypt(b"x", salt=b"y", n=2, r=1, p=1)
        return dict(SCRYPT, name="scrypt")
    except (AttributeError, ValueError):       # Python thiếu scrypt → PBKDF2 600.000 vòng
        return {"name": "pbkdf2-sha256", "iter": 600000}


def _sid_hash(token):
    return hashlib.sha256(token.encode("ascii")).hexdigest()


class LockedError(ToolError):
    def __init__(self, seconds):
        super().__init__("Sai mật khẩu quá nhiều lần — thử lại sau {} giây.".format(seconds))
        self.seconds = seconds

"""Nhật ký bảo mật: ai làm gì lúc nào (kết nối Google, upload credentials, clone thật,
xoá dữ liệu…). Ghi nối tiếp dạng JSON Lines vào data/audit.log, KHÔNG BAO GIỜ ghi mật khẩu
hay token. File tự cắt bớt khi quá 512 KB."""
from __future__ import annotations

import datetime
import getpass
import json
import os
import threading

from . import DATA

AUDIT = os.path.join(DATA, "audit.log")
MAX_BYTES = 512 * 1024
_lock = threading.Lock()


def _user():
    """Người dùng Tool Kit đang gọi (đăng nhập qua web); ngoài request thì là tài khoản Windows của máy."""
    from . import context
    u = context.user()
    if u:
        return u.get("username") or "?"
    try:
        return getpass.getuser()
    except Exception:  # noqa: BLE001
        return "?"


def record(action, **detail):
    from . import context
    entry = {"t": datetime.datetime.now().isoformat(timespec="seconds"), "user": _user(), "action": action}
    if context.ip():
        entry["ip"] = context.ip()
    entry.update({k: v for k, v in detail.items() if v is not None})
    line = json.dumps(entry, ensure_ascii=False) + "\n"
    with _lock:
        os.makedirs(DATA, exist_ok=True)
        with open(AUDIT, "a", encoding="utf-8") as fh:
            fh.write(line)
        if os.path.getsize(AUDIT) > MAX_BYTES:
            with open(AUDIT, encoding="utf-8") as fh:
                lines = fh.readlines()
            with open(AUDIT, "w", encoding="utf-8") as fh:
                fh.writelines(lines[len(lines) // 2:])


def tail(n=30):
    if not os.path.exists(AUDIT):
        return []
    with _lock, open(AUDIT, encoding="utf-8") as fh:
        lines = fh.readlines()[-n:]
    out = []
    for ln in reversed(lines):
        try:
            out.append(json.loads(ln))
        except ValueError:
            continue
    return out

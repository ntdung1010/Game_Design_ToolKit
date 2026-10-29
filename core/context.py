"""Ai đang gọi: người dùng + địa chỉ IP của request hiện tại (lưu theo luồng). Server gán khi nhận request;
job chạy nền tự mang theo người đã bấm (xem core/jobs.py) — để nhật ký, token Google, lịch sử chạy đúng người."""
from __future__ import annotations

import threading

_local = threading.local()


def set_current(user, ip=""):
    _local.user = user
    _local.ip = ip


def clear():
    _local.user = None
    _local.ip = ""


def user():
    """dict {id, username, name, role} hoặc None (lệnh dòng lệnh / ngoài request)."""
    return getattr(_local, "user", None)


def ip():
    return getattr(_local, "ip", "")


def snapshot():
    return (user(), ip())


def restore(snap):
    set_current(*snap)

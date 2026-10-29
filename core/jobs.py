"""Job chạy nền có nhật ký, tiến độ và nút dừng — tool nào chạy lâu cũng dùng được."""
from __future__ import annotations

import datetime
import threading
import traceback


def now_iso():
    return datetime.datetime.now().isoformat(timespec="seconds")


class Job:
    def __init__(self, name):
        self.name = name
        self.status = "running"      # running | done | stopped | error
        self.stage = ""
        self.logs = []
        self.done = 0
        self.total = 0
        self.error = ""
        self.started_at = now_iso()
        self.finished_at = ""
        self.result = None
        self.cancel = threading.Event()
        self._lock = threading.Lock()

    def log(self, msg, level="info"):
        with self._lock:
            self.logs.append({"t": now_iso()[11:], "level": level, "msg": str(msg)})
        print(("  ! " if level == "error" else "  ") + str(msg), flush=True)

    def progress(self, done, total=None):
        self.done = done
        if total is not None:
            self.total = total

    def should_stop(self):
        return self.cancel.is_set()

    @property
    def busy(self):
        return self.status == "running"

    def snapshot(self, since=0):
        with self._lock:
            logs = self.logs[since:]
        return {
            "name": self.name,
            "status": self.status,
            "stage": self.stage,
            "done": self.done,
            "total": self.total,
            "error": self.error,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "log_count": since + len(logs),
            "logs": logs,
        }


def start(name, fn):
    """Chạy fn(job) trên thread riêng. fn trả về kết quả; job.cancel → status 'stopped'."""
    from . import context
    job = Job(name)
    who = context.snapshot()                 # job chạy nền vẫn mang đúng người đã bấm (nhật ký, token Google)
    job.owner = (who[0] or {}).get("id")

    def worker():
        context.restore(who)
        try:
            job.result = fn(job)
            job.status = "stopped" if job.cancel.is_set() else "done"
        except Exception as exc:  # noqa: BLE001 — mọi lỗi đều phải hiện lên UI
            job.error = str(exc)
            job.status = "error"
            job.log("DỪNG: " + str(exc), "error")
            traceback.print_exc()
        finally:
            job.finished_at = now_iso()

    threading.Thread(target=worker, daemon=True).start()
    return job

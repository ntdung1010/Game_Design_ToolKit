"""Cài thư viện Python ngay từ giao diện — GD không cần mở terminal.

Thư viện luôn cài vào môi trường riêng .venv của Tool Kit, KHÔNG cài vào Python
chung của máy (tránh nâng cấp chéo gói của project khác, vd protobuf).
"""
from __future__ import annotations

import importlib
import os
import subprocess
import sys
import threading

from . import ROOT

VENV = os.path.join(ROOT, ".venv")
VENV_PY = os.path.join(VENV, "Scripts", "python.exe") if os.name == "nt" else os.path.join(VENV, "bin", "python")


def in_venv():
    return os.path.normcase(os.path.abspath(sys.prefix)) == os.path.normcase(VENV)


class Installer:
    def __init__(self):
        self.busy = False
        self.log = []
        self.ok = None
        self.need_restart = False

    def status(self):
        return {"busy": self.busy, "ok": self.ok, "log": self.log[-60:], "need_restart": self.need_restart}

    def _run(self, cmd):
        self.log.append("$ " + " ".join(cmd))
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, encoding="utf-8", errors="replace")
        for line in proc.stdout:
            self.log.append(line.rstrip())
        return proc.wait() == 0

    def start(self):
        if self.busy:
            return self.status()
        self.busy, self.ok, self.log = True, None, []

        def worker():
            try:
                ok = True
                if not os.path.exists(VENV_PY):
                    self.log.append("Tạo môi trường riêng .venv cho Tool Kit…")
                    ok = self._run([sys.executable, "-m", "venv", VENV])
                if ok:
                    ok = self._run([VENV_PY, "-m", "pip", "install", "-r", os.path.join(ROOT, "requirements.txt")])
                self.ok = ok
                self.need_restart = ok and not in_venv()
                importlib.invalidate_caches()
            except Exception as exc:  # noqa: BLE001
                self.log.append("Lỗi: " + str(exc))
                self.ok = False
            finally:
                self.busy = False

        threading.Thread(target=worker, daemon=True).start()
        return self.status()


INSTALLER = Installer()

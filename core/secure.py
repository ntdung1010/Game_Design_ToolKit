"""Lưu bí mật (token Google, credentials.json) đã MÃ HOÁ trên ổ đĩa.

Windows: dùng DPAPI (CryptProtectData) — khoá gắn với tài khoản Windows đang đăng nhập,
không cần mật khẩu, file copy sang máy / tài khoản khác sẽ không giải mã được.
Hệ khác: không có DPAPI → lưu thường nhưng chỉ chủ file được đọc (chmod 600).

Định dạng file .dat:  b"GDK1" + 1 byte kiểu (1 = DPAPI, 0 = không mã hoá) + dữ liệu.
"""
from __future__ import annotations

import os
import tempfile

MAGIC = b"GDK1"
SCHEME_PLAIN, SCHEME_DPAPI = 0, 1
# entropy riêng của app: tiến trình khác cùng tài khoản muốn giải mã phải biết chuỗi này
ENTROPY = b"GD-Toolkit/secrets/v1"


class SecretError(RuntimeError):
    pass


# ------------------------------------------------------------------ DPAPI (Windows)
def dpapi_available():
    if os.name != "nt":
        return False
    try:
        import ctypes  # noqa: F401
        ctypes.windll.crypt32  # noqa: B018
        return True
    except Exception:  # noqa: BLE001
        return False


def _dpapi(data, protect):
    import ctypes
    from ctypes import wintypes

    class BLOB(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    def blob(b):
        buf = ctypes.create_string_buffer(b, len(b))
        return BLOB(len(b), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char))), buf

    crypt32, kernel32 = ctypes.windll.crypt32, ctypes.windll.kernel32
    fn = crypt32.CryptProtectData if protect else crypt32.CryptUnprotectData
    fn.argtypes = [ctypes.POINTER(BLOB), wintypes.LPCWSTR if protect else ctypes.c_void_p, ctypes.POINTER(BLOB),
                   ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(BLOB)]
    fn.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    src, _keep1 = blob(data)
    ent, _keep2 = blob(ENTROPY)
    out = BLOB()
    ok = fn(ctypes.byref(src), "GD Toolkit" if protect else None, ctypes.byref(ent), None, None,
            0x1,  # CRYPTPROTECT_UI_FORBIDDEN
            ctypes.byref(out))
    if not ok:
        raise SecretError("DPAPI {} lỗi (mã {}).".format("mã hoá" if protect else "giải mã", ctypes.GetLastError()))
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        kernel32.LocalFree(ctypes.cast(out.pbData, ctypes.c_void_p))


# ------------------------------------------------------------------ đọc / ghi file
def write_atomic(path, data):
    """Ghi qua file tạm rồi đổi tên — mất điện giữa chừng cũng không hỏng file cũ."""
    folder = os.path.dirname(path)
    os.makedirs(folder, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=folder, prefix=".tmp-")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass
        os.replace(tmp, path)
    except BaseException:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


def wipe(path):
    """Ghi đè 0 rồi xoá (nỗ lực tốt nhất — ổ SSD có thể vẫn giữ bản cũ ở mức phần cứng)."""
    if not os.path.exists(path):
        return False
    try:
        size = os.path.getsize(path)
        with open(path, "r+b") as fh:
            fh.write(b"\0" * size)
            fh.flush()
            os.fsync(fh.fileno())
    except OSError:
        pass
    os.remove(path)
    return True


def save_secret(path, data):
    if isinstance(data, str):
        data = data.encode("utf-8")
    if dpapi_available():
        payload = MAGIC + bytes([SCHEME_DPAPI]) + _dpapi(data, True)
    else:
        payload = MAGIC + bytes([SCHEME_PLAIN]) + data
    write_atomic(path, payload)


def load_secret(path):
    with open(path, "rb") as fh:
        raw = fh.read()
    if not raw.startswith(MAGIC) or len(raw) < 5:
        raise SecretError("File bí mật hỏng hoặc không đúng định dạng: " + os.path.basename(path))
    scheme, body = raw[4], raw[5:]
    if scheme == SCHEME_PLAIN:
        return body
    if scheme == SCHEME_DPAPI:
        if not dpapi_available():
            raise SecretError("File được mã hoá bằng DPAPI của Windows — chỉ mở được trên đúng máy / tài khoản đã tạo.")
        try:
            return _dpapi(body, False)
        except SecretError as exc:
            raise SecretError("Không giải mã được {} — file từ máy / tài khoản Windows khác? Hãy kết nối lại.".format(
                os.path.basename(path))) from exc
    raise SecretError("Kiểu mã hoá không hỗ trợ: {}".format(scheme))


def is_encrypted(path):
    try:
        with open(path, "rb") as fh:
            head = fh.read(5)
        return head[:4] == MAGIC and head[4] == SCHEME_DPAPI
    except OSError:
        return False


def migrate_plain(plain_path, secret_path):
    """Có file bí mật dạng chữ thường (bản cũ) → mã hoá sang .dat rồi xoá bản thường."""
    if not os.path.exists(plain_path):
        return False
    with open(plain_path, "rb") as fh:
        data = fh.read()
    if not os.path.exists(secret_path):
        save_secret(secret_path, data)
    wipe(plain_path)
    return True

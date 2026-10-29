"""Danh sách tool. Mỗi tool là một package con trong thư mục này, có:

    TOOL = {"id", "name", "tagline", "desc", "category", "icon", "tags", "needs", "version",
            "order", "freq", "scripts", "example": {"headline", "input", "steps"}}
    def api(action, body, query) -> dict          # POST/GET /api/tools/<id>/<action>
    def file(path) -> (bytes, content_type, tên_tải_về|None)   # tuỳ chọn

hoặc khai báo nhiều tool chạy thuần trên trình duyệt trong 1 package bằng TOOLS = [meta, …].
Giao diện mỗi tool ở web/tools/<id>.js. Server tự tìm, không phải đăng ký tay.
"""
import importlib
import pkgutil
import traceback


def discover():
    found = {}
    for info in pkgutil.iter_modules(__path__):
        if not info.ispkg:
            continue
        try:
            mod = importlib.import_module(__name__ + "." + info.name)
        except Exception:  # noqa: BLE001 — 1 tool hỏng không được làm sập cả bộ
            traceback.print_exc()
            continue
        metas = list(getattr(mod, "TOOLS", []) or [])
        if getattr(mod, "TOOL", None):
            metas.append(mod.TOOL)
        if not hasattr(mod, "api"):
            continue
        for meta in metas:
            found[meta["id"]] = (meta, mod)
    return dict(sorted(found.items(), key=lambda kv: (kv[1][0].get("order", 100), kv[1][0]["name"])))

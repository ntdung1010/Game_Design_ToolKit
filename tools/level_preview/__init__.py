"""Level Preview — vẽ / soát / so sánh level của mọi game puzzle ngay trên trình duyệt.

Phần đọc + vẽ chạy hoàn toàn ở web/lib (levelkit.js, level-adapters.js, levelrender.js): file level không rời
khỏi máy, server không đọc ổ đĩa. Server chỉ giữ "cấu hình đọc file" của game mới (mapping người dùng tự khai)
trong data/level_games.json để lần sau và người khác trong team dùng lại.
"""
import json
import os
import re
import unicodedata

from core import DATA, ToolError, audit
from core.secure import write_atomic

TOOL = {
    "id": "level-preview", "order": 55, "name": "Level Preview", "icon": "tubes", "freq": "Mỗi bộ level",
    "category": "Level", "version": "1.0",
    "tagline": "Xem cả bộ level thành ảnh, soát lỗi, so 2 bộ",
    "desc": "Thả thư mục level (CDS, Magic Sort, Chirpy, Bird Sort, file editor… hoặc game mới) → cả bộ hiện thành lưới "
            "ảnh sơ đồ, không cần mở Unity. Lọc level Hard / có cảnh báo / theo cơ chế, so 2 bộ level để thấy level nào "
            "đổi, xuất PNG / ảnh ghép / gallery .html. Game mới: khai cấu hình đọc file ngay trên giao diện, không cần code.",
    "tags": ["level", "preview", "ảnh", "chụp", "screenshot", "render", "sort", "tube", "bird", "pack", "so sánh", "diff",
             "gallery", "contact sheet"],
    "scripts": ["lib/levelkit.js", "lib/level-adapters.js", "lib/levelset.js", "lib/levelrender.js", "lib/zip.js"],
    "example": {
        "headline": "Thả bộ level mẫu → 12 level hiện thành lưới ảnh; L7 báo vàng vì 1 màu chỉ có 3 phần (ống chứa 4). "
                    "So với bản sửa: 3 level khác nhau, L5 thêm 1 ống trống.",
        "input": "Thư mục hoặc nhiều file level (.txt / .json). Thêm ảnh chụp thật (.png) để đặt cạnh ảnh sơ đồ.",
        "steps": ["Kéo thả thư mục level (hoặc chọn file) — tool tự nhận game",
                  "Lọc / bấm vào level để xem to, soát cảnh báo",
                  "Thêm bộ B để so sánh; xuất PNG, ảnh ghép, gallery .html"],
    },
}

MAX_GAMES = 60
MAX_PROFILE = 20000
_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,47}$")
_PATH_KEYS = ("levels", "number", "containers", "items", "color", "x", "y", "orders", "capacity")


def _file():
    return os.path.join(DATA, "level_games.json")


def load_games():
    try:
        with open(_file(), encoding="utf-8") as fh:
            data = json.load(fh)
        return [g for g in data.get("games", []) if isinstance(g, dict) and _ID.match(str(g.get("id", "")))]
    except (OSError, ValueError):
        return []


def _save(games):
    write_atomic(_file(), json.dumps({"games": games}, ensure_ascii=False, indent=1).encode("utf-8"))


def _slug(name):
    ascii_name = unicodedata.normalize("NFKD", str(name).lower().replace("đ", "d")).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9]+", "-", ascii_name).strip("-")
    return (s or "game")[:40]


def clean_profile(p):
    """Kiểm tra cấu hình đọc file người dùng gửi lên: chỉ giữ các trường biết, giới hạn độ dài."""
    if not isinstance(p, dict):
        raise ToolError("Cấu hình không hợp lệ.")
    name = str(p.get("name") or "").strip()[:60]
    if not name:
        raise ToolError("Đặt tên game trước khi lưu.")
    out = {"id": str(p.get("id") or "") or _slug(name), "name": name}
    if not _ID.match(out["id"]):
        out["id"] = _slug(name)
    for k in _PATH_KEYS:
        v = p.get(k)
        if v is None:
            continue
        if k == "capacity" and isinstance(v, (int, float)) and not isinstance(v, bool):
            out[k] = max(1, min(64, int(v)))
        elif isinstance(v, str) and len(v) <= 200:
            out[k] = v
    if p.get("order") in ("bottom", "top"):
        out["order"] = p["order"]
    if "empty" in p and (p["empty"] is None or isinstance(p["empty"], (int, float, str))) and not isinstance(p["empty"], bool):
        out["empty"] = p["empty"]
    if p.get("yUp") is False:
        out["yUp"] = False
    if isinstance(p.get("hidden"), dict) and isinstance(p["hidden"].get("path"), str):
        h = {"path": p["hidden"]["path"][:200]}
        if "eq" in p["hidden"] and isinstance(p["hidden"]["eq"], (int, float, str)):
            h["eq"] = p["hidden"]["eq"]
        out["hidden"] = h
    for key in ("tags", "marks"):
        lst = p.get(key)
        if isinstance(lst, list):
            keep = []
            for t in lst[:20]:
                if isinstance(t, dict) and isinstance(t.get("path") or t.get("when"), str):
                    keep.append({kk: vv for kk, vv in t.items() if kk in ("path", "when", "eq", "label", "type", "n")
                                 and isinstance(vv, (str, int, float)) and not isinstance(vv, bool)})
            out[key] = keep
    st = p.get("style")
    if isinstance(st, dict):
        out["style"] = {k: str(st[k]) for k in ("container", "item") if isinstance(st.get(k), str)
                        and st[k] in ("tube", "jar", "box", "egg", "branch", "liquid", "ball", "block", "bird")}
    rules = p.get("rules")
    if isinstance(rules, dict) and isinstance(rules.get("colorMultiple"), (int, str, bool)):
        out["rules"] = {"colorMultiple": rules["colorMultiple"]}
    if len(json.dumps(out, ensure_ascii=False)) > MAX_PROFILE:
        raise ToolError("Cấu hình quá lớn.")
    return out


def api(action, body, query):
    if action == "games":
        return {"games": load_games()}
    if action == "games/save":
        prof = clean_profile((body or {}).get("profile"))
        games = [g for g in load_games() if g["id"] != prof["id"]]
        if len(games) >= MAX_GAMES:
            raise ToolError("Đã có {} game — xoá bớt cấu hình cũ trước.".format(MAX_GAMES))
        games.append(prof)
        games.sort(key=lambda g: g["name"].lower())
        _save(games)
        audit.record("level_preview.game_saved", game=prof["name"])
        return {"games": games, "saved": prof}
    if action == "games/delete":
        gid = str((body or {}).get("id") or "")
        games = load_games()
        left = [g for g in games if g["id"] != gid]
        if len(left) == len(games):
            raise ToolError("Không có cấu hình: " + gid)
        _save(left)
        audit.record("level_preview.game_deleted", game=gid)
        return {"games": left}
    raise ToolError("Không có thao tác: " + action)

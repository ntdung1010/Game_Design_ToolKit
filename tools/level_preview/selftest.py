"""Selftest Level Preview (phần server: lưu cấu hình đọc file của game mới). Phần đọc / vẽ level test ở tests/js.

    python server.py test
    python -m tools.level_preview.selftest
"""
import os
import shutil
import sys
import tempfile

from core import ToolError, audit
import tools.level_preview as lp

FAILS = []


def check(name, cond, extra=""):
    print("  [{}] {}{}".format("PASS" if cond else "FAIL", name, ("  -> " + str(extra)) if extra else ""))
    if not cond:
        FAILS.append(name)


def test_profiles(tmp):
    lp._file = lambda: os.path.join(tmp, "level_games.json")
    check("chưa có cấu hình → danh sách rỗng", lp.api("games", {}, {})["games"] == [])
    r = lp.api("games/save", {"profile": {"name": "Ball Sort Mới", "containers": "tubes", "items": "", "color": "",
                                          "order": "top", "empty": 0, "evil": "<script>", "capacity": 999,
                                          "style": {"container": "jar", "item": "ball", "x": "bad"},
                                          "tags": [{"path": "isHard", "label": "Hard", "onclick": "x"}]}}, {})
    g = r["saved"]
    check("tự tạo id từ tên", g["id"] == "ball-sort-moi", g["id"])
    check("bỏ trường lạ", "evil" not in g)
    check("giới hạn sức chứa 1–64", g["capacity"] == 64, g.get("capacity"))
    check("giữ ô trống = 0 và thứ tự top", g["empty"] == 0 and g["order"] == "top")
    check("lọc style / tag chỉ giữ khoá hợp lệ", g["style"] == {"container": "jar", "item": "ball"} and g["tags"] == [{"path": "isHard", "label": "Hard"}],
          (g.get("style"), g.get("tags")))
    lp.api("games/save", {"profile": {"id": "ball-sort-moi", "name": "Ball Sort Mới", "containers": "data.tubes"}}, {})
    games = lp.api("games", {}, {})["games"]
    check("lưu lại cùng id → ghi đè, không nhân đôi", len(games) == 1 and games[0]["containers"] == "data.tubes", games)
    try:
        lp.api("games/save", {"profile": {"name": ""}}, {})
        check("thiếu tên → báo lỗi", False)
    except ToolError:
        check("thiếu tên → báo lỗi", True)
    try:
        lp.api("games/save", {"profile": {"name": "x", "containers": "a" * 50000}}, {})
        g2 = [x for x in lp.load_games() if x["name"] == "x"][0]
        check("đường dẫn quá dài bị bỏ", "containers" not in g2, g2)
    except ToolError as exc:
        check("đường dẫn quá dài bị bỏ", False, exc)
    lp.api("games/delete", {"id": "ball-sort-moi"}, {})
    check("xoá cấu hình", all(x["id"] != "ball-sort-moi" for x in lp.load_games()))
    with open(lp._file(), "w", encoding="utf-8") as fh:
        fh.write("{hỏng")
    check("file cấu hình hỏng → không sập, trả rỗng", lp.load_games() == [])


def main():
    FAILS.clear()
    print("\n=== SELFTEST Level Preview (server) ===")
    tmp = tempfile.mkdtemp(prefix="gdk-lp-")
    old_file, old_audit = lp._file, audit.AUDIT
    audit.AUDIT = os.path.join(tmp, "audit.log")     # không ghi sự kiện test vào nhật ký thật
    try:
        test_profiles(tmp)
    finally:
        lp._file, audit.AUDIT = old_file, old_audit
        shutil.rmtree(tmp, ignore_errors=True)
    print("\n=== KẾT QUẢ: {} ===\n".format("TẤT CẢ ĐẠT" if not FAILS else "HỎNG {} mục: {}".format(len(FAILS), FAILS)))
    return 0 if not FAILS else 1


if __name__ == "__main__":
    for _s in (sys.stdout, sys.stderr):
        try:
            _s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:  # noqa: BLE001
            pass
    sys.exit(main())

"""Selftest Drive Clone — chạy toàn bộ trên Drive giả lập, không cần mạng.

    python server.py test
    python -m tools.drive_clone.selftest
"""
from __future__ import annotations

import csv
import io
import json
import sys

from core import google_auth

from . import changelog, demo_seed, gdrive, pipeline

QUIET = staticmethod(lambda *a, **k: None)
FAILS = []


def check(name, cond, extra=""):
    print("  [{}] {}{}".format("PASS" if cond else "FAIL", name, ("  -> " + str(extra)) if extra else ""))
    if not cond:
        FAILS.append(name)


def _full_run(backend, manifest, options, stop_after=None):
    plan = pipeline.build_plan(manifest, options)
    calls = {"n": 0}

    def should_stop():
        calls["n"] += 1
        return stop_after is not None and calls["n"] > stop_after

    result = pipeline.execute(backend, plan, should_stop=should_stop)
    if not result["dry_run"]:
        result["remap"] = pipeline.remap_all(backend, plan, result)
        if plan["options"].get("build_index") and not result["stopped"]:
            result["index"] = pipeline.build_index_tab(backend, plan, result)
    report = pipeline.verify(backend, manifest, plan, result)
    return plan, result, report


def _chk(report, cid):
    return next(c for c in report["checks"] if c["id"] == cid)


def _names_under(backend, folder_id):
    out, stack = [], [folder_id]
    while stack:
        fid = stack.pop()
        for c in backend.list_children(fid):
            out.append(c)
            if c["mimeType"] == gdrive.FOLDER_MIME:
                stack.append(c["id"])
    return out


# --------------------------------------------------------------------------
def test_rename():
    print("\n1) Quy tắc đổi tên")
    r = {"from": "BSHP", "to": "PRSP", "ignore_case": True}
    check("BSHP_Level → PRSP_Level", pipeline.rename("BSHP_Level", [r]) == "PRSP_Level")
    check("bshp_icon → prsp_icon (giữ chữ thường)", pipeline.rename("bshp_icon", [r]) == "prsp_icon")
    check("Bshp Notes → Prsp Notes (giữ hoa chữ đầu)", pipeline.rename("Bshp Notes", [r]) == "Prsp Notes")
    check("đổi mọi lần xuất hiện", pipeline.rename("BSHP-x-bshp", [r]) == "PRSP-x-prsp")
    check("phân biệt hoa thường khi tắt ignore_case",
          pipeline.rename("bshp BSHP", [{"from": "BSHP", "to": "PRSP"}]) == "bshp PRSP")
    check("regex có nhóm", pipeline.rename("Lv_012", [{"from": r"Lv_(\d+)", "to": r"Level \1", "regex": True}])
          == "Level 012")
    check("regex sai không làm hỏng tên", pipeline.rename("abc", [{"from": "(", "to": "x", "regex": True}]) == "abc")
    check("báo regex sai trong kế hoạch", pipeline.rule_problems([{"from": "(", "regex": True}]) != [])


def test_skeleton():
    print("\n2) Chế độ DỰNG KHUNG (tool cds_drive_clone cũ: TSM_ → GWP_)")
    backend, src, dest = demo_seed.build()
    manifest = pipeline.scan(backend, src)
    st = manifest["stats"]
    check("quét đủ 19 thư mục", st["folders"] == 19, st["folders"])
    check("quét ra ≥ 30 file", st["files"] >= 30, st["files"])
    check("đi vào thư mục lồng 3 tầng", st["depth"] == 3)
    check("giữ nguyên tên có dấu '/'", any(i["name"] == "TSM_ Segment ROAS/BLD" for i in manifest["items"]))

    options = {"dest_parent": dest, "content_mode": "skeleton", "wrap_root": True,
               "new_root_name": "GWP_ Game Design", "rename_rules": [{"from": "TSM_", "to": "GWP_"}],
               "remap_links": "masters", "build_index": True}
    plan, result, report = _full_run(backend, manifest, options)
    ps = plan["stats"]
    check("tự nhận master sheet (1 file copy đầy đủ)", ps["copy"] == 1, ps["copy"])
    check("đổi tiền tố TSM_ → GWP_", all(not o["dst_name"].startswith("TSM_") for o in plan["ops"]))
    check("Google Form xử lý riêng", any("kiểu đặc biệt" in o["note"] for o in plan["ops"]))
    check("không có thao tác lỗi", not result["failed"], json.dumps(result["failed"][:2], ensure_ascii=False))
    check("đổi ≥ 18 link trong master", result["remap"]["links_changed"] >= 18, result["remap"]["links_changed"])
    check("sinh tab mục lục ≥ 30 dòng", result.get("index", {}).get("rows", 0) >= 30)

    master = next(o for o in result["done"] if o["kind"] == "copy")
    text = json.dumps(backend.nodes[master["dst_id"]]["sheet"])
    check("KHÔNG đụng link ra ngoài cây nguồn", demo_seed.FOREIGN_ID in text)
    check("không còn ID nguồn nào sót trong master", not any(i["id"] in text for i in manifest["items"]))
    short = next(o for o in result["done"] if o["kind"] == "shortcut" and o["src_name"].startswith("Link nhanh"))
    target = backend.nodes[short["dst_id"]]["shortcutDetails"]["targetId"]
    check("shortcut trỏ sang file MỚI (dù đích nằm sâu hơn)", target in result["id_map"].values())
    check("hậu kiểm không FAIL", report["ok"], [c["id"] for c in report["checks"] if c["status"] == "FAIL"])

    print("   Kiểm tra NGƯỢC — cố tình làm hỏng xem hậu kiểm có bắt được:")
    doc = backend.nodes[master["dst_id"]]["sheet"]
    doc["sheets"][0]["data"][0]["rowData"][1]["values"][1] = {
        "userEnteredValue": {"stringValue": "link hỏng"},
        "textFormatRuns": [{"startIndex": 0, "format": {"link": {"uri": gdrive.view_url(
            manifest["items"][0]["id"], gdrive.FOLDER_MIME)}}}]}
    c5 = _chk(pipeline.verify(backend, manifest, plan, result), "C5")
    check("bắt link còn trỏ bản gốc (C5)", c5["status"] == "FAIL", c5["detail"])

    binfile = next(o for o in result["done"] if o["kind"] == "skeleton"
                   and not o["dst_mime"].startswith(gdrive.GOOGLE_PREFIX))
    backend.nodes[binfile["dst_id"]]["quotaBytesUsed"] = "999"
    c3 = _chk(pipeline.verify(backend, manifest, plan, result), "C3")
    check("bắt file vỏ nhị phân lọt nội dung (C3)", c3["status"] == "FAIL", c3["detail"])
    backend.nodes[binfile["dst_id"]]["quotaBytesUsed"] = "0"

    docf = next(o for o in result["done"] if o["kind"] == "skeleton" and o["dst_mime"] == gdrive.DOC_MIME)
    backend.nodes[docf["dst_id"]]["quotaBytesUsed"] = "1024"
    c3b = _chk(pipeline.verify(backend, manifest, plan, result), "C3")
    check("KHÔNG báo nhầm vì Google Doc rỗng vẫn tốn dung lượng", c3b["status"] == "PASS", c3b["detail"])
    backend.nodes[docf["dst_id"]]["blob"] = "có chữ".encode("utf-8")
    c3c = _chk(pipeline.verify(backend, manifest, plan, result), "C3")
    check("bắt Google Doc vỏ lọt nội dung (C3)", c3c["status"] == "FAIL", c3c["detail"])
    backend.nodes[docf["dst_id"]]["blob"] = b""

    folder_op = next(o for o in result["done"] if o["kind"] == "folder")
    backend.nodes[folder_op["dst_id"]]["trashed"] = True
    c1 = _chk(pipeline.verify(backend, manifest, plan, result), "C1")
    check("bắt thư mục bị thiếu (C1)", c1["status"] == "FAIL", c1["detail"])
    return report


def test_full_copy():
    print("\n3) Chế độ COPY TOÀN BỘ + đổi tên giữ kiểu chữ (ca BSHP → PRSP), đổ thẳng vào B")
    backend, src, dest = demo_seed.build()
    manifest = pipeline.scan(backend, src)
    rule = {"from": "TSM_", "to": "PRSP_", "ignore_case": True}
    options = {"dest_parent": dest, "content_mode": "full", "wrap_root": False, "rename_rules": [rule]}
    plan, result, report = _full_run(backend, manifest, options)
    files = [i for i in manifest["items"] if i["kind"] == "file"]
    check("mọi file đều copy đầy đủ", plan["stats"]["copy"] == len(files), (plan["stats"]["copy"], len(files)))
    check("không lỗi", not result["failed"])

    dest_items = _names_under(backend, dest)
    names = [c["name"] for c in dest_items]
    check("không còn tên nào chứa 'tsm_' (mọi kiểu chữ)", not any("tsm_" in n.lower() for n in names),
          [n for n in names if "tsm_" in n.lower()][:3])
    check("tsm_icon.png → prsp_icon.png", "prsp_icon.png" in names)
    check("Tsm_Notes → Prsp_Notes", "Prsp_Notes" in names)
    check("TSM_ Piggy Bank → PRSP_ Piggy Bank", "PRSP_ Piggy Bank" in names)
    check("đổ thẳng vào B (không tạo thư mục gốc thừa)", "Game Design" not in names)

    by_src = {o["src_id"]: o["dst_id"] for o in result["done"]}
    same = all(backend.nodes[by_src[f["id"]]].get("blob") == backend.nodes[f["id"]].get("blob")
               for f in files if f["id"] in by_src and "blob" in backend.nodes[f["id"]])
    check("nội dung bản sao giống hệt bản gốc", same)
    check("nguồn A không bị sửa tên", all(not n["name"].startswith("PRSP_")
                                          for n in backend.nodes.values() if src in n["parents"]))
    check("mọi mục tạo ra mang dấu gdk_src", all((c.get("appProperties") or {}).get("gdk_src") for c in dest_items))
    check("hậu kiểm không FAIL", report["ok"], [(c["id"], c["detail"]) for c in report["checks"] if c["status"] == "FAIL"])
    check("C9 soát tên thật ở đích = PASS", _chk(report, "C9")["status"] == "PASS", _chk(report, "C9")["detail"])

    entries = result["entries"]
    counts = changelog.summarize(entries)
    check("change log đủ 1 dòng / mục", counts["total"] == len(manifest["items"]), (counts["total"], len(manifest["items"])))
    check("đếm đúng số mục đổi tên", counts["renamed"] == sum(1 for i in manifest["items"]
                                                             if "tsm_" in i["name"].lower()), counts["renamed"])
    rows = list(csv.reader(io.StringIO(changelog.to_csv(entries))))
    check("CSV có header + đủ dòng", rows[0][0] == "Time" and len(rows) == len(entries) + 1)

    title = changelog.sheet_title(plan, "2026-10-12T10:00:00")
    sheet = changelog.write_sheet(backend, result["root_id"], title,
                                  changelog.summary_rows(plan, result, report, counts, title), entries)
    doc = backend.nodes[sheet["id"]]["sheet"]
    tabs = [s["properties"]["title"] for s in doc["sheets"]]
    log_rows = next(s for s in doc["sheets"] if s["properties"]["title"] == "Change Log")["data"][0]["rowData"]
    check("Change Log sheet có tab Summary + Change Log", set(tabs) == {"Summary", "Change Log"}, tabs)
    check("Change Log sheet đủ dòng", len(log_rows) == len(entries) + 1, len(log_rows))
    check("Change Log nằm trong thư mục đích", sheet["id"] in [c["id"] for c in backend.list_children(dest)])

    # chạy lại: không tạo trùng, Change Log cũ không bị coi là mục lạ
    print("   Chạy lại lần 2 với cùng thiết lập:")
    before = len(_names_under(backend, dest))
    plan2, result2, report2 = _full_run(backend, manifest, options)
    after = len(_names_under(backend, dest))
    check("lần 2 không tạo mục mới nào", not result2["done"] and before == after, (len(result2["done"]), before, after))
    non_folders = sum(1 for i in manifest["items"] if i["kind"] != "folder")
    check("lần 2 nhận ra bản do tool tạo", len(result2["existing"]) == non_folders, (len(result2["existing"]), non_folders))
    check("lần 2 hậu kiểm vẫn đạt", report2["ok"], [c["id"] for c in report2["checks"] if c["status"] == "FAIL"])
    check("C7 không tính Change Log là mục lạ", _chk(report2, "C7")["status"] == "PASS", _chk(report2, "C7")["detail"])

    # C9 phải bắt được tên sót
    victim = next(c for c in _names_under(backend, dest) if c["name"].startswith("PRSP_"))
    backend.nodes[victim["id"]]["name"] = victim["name"].replace("PRSP_", "TSM_")
    c9 = _chk(pipeline.verify(backend, manifest, plan2, result2), "C9")
    check("bắt được tên còn sót chuỗi cũ (C9)", c9["status"] == "FAIL", c9["detail"])


def test_stop_resume_and_errors():
    print("\n4) Dừng giữa chừng → chạy tiếp; file cấm copy; B nằm trong A")
    backend, src, dest = demo_seed.build()
    manifest = pipeline.scan(backend, src)
    options = {"dest_parent": dest, "content_mode": "full", "wrap_root": True,
               "rename_rules": [{"from": "TSM_", "to": "PRSP_"}], "remap_links": "masters"}
    _, r1, rep1 = _full_run(backend, manifest, options, stop_after=25)
    check("lần 1 dừng giữa chừng", r1["stopped"] and 0 < len(r1["done"]) < len(manifest["items"]))
    check("hậu kiểm lần dừng = SKIP, không báo FAIL oan", rep1["checks"][0]["id"] == "C0")
    master = next(o for o in r1["done"] if o.get("master"))
    check("master đã được copy trong lần 1", bool(master))

    plan2, r2, rep2 = _full_run(backend, manifest, options)
    roots = [c for c in backend.list_children(dest) if c["mimeType"] == gdrive.FOLDER_MIME]
    check("chạy tiếp gộp vào đúng thư mục gốc cũ (không tạo gốc thứ 2)", len(roots) == 1, [c["name"] for c in roots])
    check("chạy tiếp hoàn tất phần còn lại", not r2["stopped"] and len(r1["done"]) + len(r2["done"]) == plan2["stats"]["active"],
          (len(r1["done"]), len(r2["done"]), plan2["stats"]["active"]))
    text = json.dumps(backend.nodes[master["dst_id"]]["sheet"])
    check("master copy ở lần 1 vẫn được đổi link đủ ở lần 2", not any(i["id"] in text for i in manifest["items"]))
    check("hậu kiểm sau khi chạy tiếp đạt", rep2["ok"], [(c["id"], c["detail"]) for c in rep2["checks"] if c["status"] == "FAIL"])

    # file cấm copy: ghi ERROR rồi đi tiếp
    backend, src, dest = demo_seed.build()
    manifest = pipeline.scan(backend, src)
    bad = next(i for i in manifest["items"] if i["kind"] == "file" and i["name"] == "Booster.xlsx")
    backend.fail_ids.add(bad["id"])
    plan, r, rep = _full_run(backend, manifest, {"dest_parent": dest, "content_mode": "full"})
    errs = [e for e in r["entries"] if e["status"] == "ERROR"]
    check("file cấm copy → 1 dòng ERROR, còn lại vẫn chạy", len(errs) == 1 and len(r["done"]) == plan["stats"]["active"] - 1,
          (len(errs), len(r["done"])))
    check("C8 báo FAIL đúng file lỗi", _chk(rep, "C8")["status"] == "FAIL" and "Booster" in json.dumps(_chk(rep, "C8")["rows"]))

    # B nằm trong A
    backend, src, dest = demo_seed.build()
    inner = backend._add("Ban sao", gdrive.FOLDER_MIME, src)
    backend._add("cu.xlsx", gdrive.XLSX_MIME, inner)
    manifest = pipeline.scan(backend, src)
    plan, r, rep = _full_run(backend, manifest, {"dest_parent": inner, "content_mode": "full"})
    check("B nằm trong A → không copy B vào chính nó",
          all(o["kind"] == "skip" for o in plan["ops"] if o["src_parts"][0] == "Ban sao"))
    check("…và vẫn chạy xong không lỗi", not r["failed"] and rep["ok"],
          [(c["id"], c["detail"]) for c in rep["checks"] if c["status"] == "FAIL"])

    # trùng tên sau khi đổi
    backend, src, dest = demo_seed.build()
    backend._add("PRSP_ Hint", gdrive.FOLDER_MIME, src)
    manifest = pipeline.scan(backend, src)
    plan = pipeline.build_plan(manifest, {"dest_parent": dest, "rename_rules": [{"from": "TSM_", "to": "PRSP_"}]})
    check("cảnh báo 2 thư mục trùng tên sau khi đổi", any("PRSP_ Hint" in w for w in plan["warnings"]), plan["warnings"])

    # chạy thử không tạo gì
    backend, src, dest = demo_seed.build()
    manifest = pipeline.scan(backend, src)
    n_before = len(backend.nodes)
    plan, r, rep = _full_run(backend, manifest, {"dest_parent": dest, "dry_run": True,
                                                  "rename_rules": [{"from": "TSM_", "to": "PRSP_"}]})
    check("chạy thử không tạo gì trên Drive", len(backend.nodes) == n_before and not backend.calls)
    check("chạy thử vẫn ra change log đầy đủ", len(r["entries"]) == len(manifest["items"]))

    # quyền tối thiểu (drive.file): để trống B = My Drive → luôn tạo thư mục mới, không đổ thẳng vào My Drive
    backend, src, dest = demo_seed.build()
    manifest = pipeline.scan(backend, src)
    plan, r, rep = _full_run(backend, manifest, {"dest_parent": "", "wrap_root": False, "new_root_name": "Ban sao A"})
    kids = [n for n in backend.nodes.values() if n.get("parents") == [gdrive.MY_DRIVE]]
    check("để trống thư mục B → tạo 1 thư mục mới trong My Drive (không rải file ra My Drive)",
          plan["dest_parent"] == gdrive.MY_DRIVE and plan["wrap_root"] and len(kids) == 1 and kids[0]["name"] == "Ban sao A"
          and r["dest_name"] == "My Drive", [k["name"] for k in kids])

    class _Resp:
        status = 403

    class _Err(Exception):
        resp = _Resp()
        content = json.dumps({"error": {"message": "The user has not granted the app 123 write access to the file X",
                                        "errors": [{"reason": "appNotAuthorizedToFile"}]}}).encode()
    check("dán thư mục tool không được ghi → báo rõ cách làm (để trống B / dùng thư mục do tool tạo)",
          "trống ô thư mục B" in gdrive._http_message(_Err()))
    check("chỉ xin quyền tối thiểu: xem Drive + sửa file do tool tạo",
          set(google_auth.SCOPES) == {"https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/drive.file"})


def test_parallel():
    import time

    print("\n5) Chạy song song: kết quả giống hệt chạy 1 luồng, nhanh hơn khi mạng chậm")
    opts = {"content_mode": "full", "wrap_root": True, "rename_rules": [{"from": "TSM_", "to": "PRSP_", "ignore_case": True}],
            "remap_links": "masters"}

    def run(workers, latency):
        backend, src, dest = demo_seed.build()
        backend.latency = latency
        t0 = time.perf_counter()
        manifest = pipeline.scan(backend, src, workers=workers)
        t_scan = time.perf_counter() - t0
        plan = pipeline.build_plan(manifest, dict(opts, dest_parent=dest, workers=workers))
        t1 = time.perf_counter()
        result = pipeline.execute(backend, plan)
        result["remap"] = pipeline.remap_all(backend, plan, result)
        t_exec = time.perf_counter() - t1
        report = pipeline.verify(backend, manifest, plan, result)
        tree = sorted("/".join(i["parts"]) + "|" + i["mime"] for i in pipeline.scan(backend, result["root_id"])["items"])
        return {"manifest": [i["path"] for i in manifest["items"]], "entries": [(e["src_id"], e["status"]) for e in result["entries"]],
                "tree": tree, "ok": report["ok"], "scan": t_scan, "exec": t_exec, "failed": result["failed"]}

    one, four = run(1, 0.004), run(4, 0.004)
    check("quét song song ra đúng danh sách & thứ tự như 1 luồng", one["manifest"] == four["manifest"])
    check("Change Log song song giữ đúng thứ tự kế hoạch", [s for s, _ in one["entries"]] == [s for s, _ in four["entries"]])
    check("cây đích giống hệt nhau", one["tree"] == four["tree"], len(one["tree"]))
    check("song song: không lỗi, hậu kiểm đạt", four["ok"] and not four["failed"], four["failed"][:1])
    speed = (one["scan"] + one["exec"]) / max(1e-9, four["scan"] + four["exec"])
    check("4 luồng nhanh hơn ≥ 2× khi mỗi lệnh API chờ mạng", speed >= 2, "×{:.1f} ({:.2f}s → {:.2f}s)".format(
        speed, one["scan"] + one["exec"], four["scan"] + four["exec"]))
    stress = [run(8, 0) for _ in range(3)]
    check("8 luồng chạy 3 lần liền vẫn cho cùng kết quả (không tranh chấp dữ liệu)",
          all(x["tree"] == one["tree"] and x["ok"] for x in stress))


def test_real_backend_wiring():
    print("\n5) Nối dây backend Google THẬT (HttpMockSequence — không cần mạng / tài khoản)")
    try:
        from googleapiclient.http import HttpMockSequence
    except ImportError:
        print("  [SKIP] chưa cài thư viện Google (chạy start.bat hoặc nút Cài thư viện)")
        return
    from urllib.parse import parse_qs, urlparse

    ok = {"status": "200"}
    rate = ({"status": "403"}, json.dumps({"error": {"code": 403, "message": "User Rate Limit Exceeded",
                                                     "errors": [{"reason": "userRateLimitExceeded"}]}}))
    denied = ({"status": "403"}, json.dumps({"error": {"code": 403, "message": "The user does not have permission",
                                                       "errors": [{"reason": "cannotCopyFile"}]}}))
    http = HttpMockSequence([
        (ok, json.dumps({"files": [{"id": "A1", "name": "BSHP_Level", "mimeType": gdrive.FOLDER_MIME}],
                         "nextPageToken": "P2"})),
        (ok, json.dumps({"files": [{"id": "A2", "name": "x.xlsx", "mimeType": gdrive.XLSX_MIME, "size": "12"}]})),
        rate,
        (ok, json.dumps({"id": "NEW1"})),
        denied,
    ])
    backend = gdrive.RealDrive(None, http=http)
    real_sleep = gdrive.time.sleep
    gdrive.time.sleep = lambda s: None
    try:
        kids = backend.list_children("ROOTID")
        check("list_children đọc đủ 2 trang", [k["id"] for k in kids] == ["A1", "A2"])
        q = parse_qs(urlparse(http.request_sequence[0][0]).query)
        check("…lọc đúng thư mục + bỏ file trong thùng rác", q["q"][0] == "'ROOTID' in parents and trashed = false")
        check("…xin appProperties để nhận ra bản do tool tạo", "appProperties" in q["fields"][0])
        check("…hỗ trợ Shared Drive", q.get("supportsAllDrives") == ["true"] and q.get("includeItemsFromAllDrives") == ["true"])
        new_id = backend.copy_file("SRC", "PRSP_Level", "DEST", props={"gdk_src": "SRC"})
        check("403 rate-limit → tự thử lại rồi copy được", new_id == "NEW1")
        uri, method, body, _ = http.request_sequence[3]
        sent = json.loads(body)
        check("copy gửi đúng tên mới + thư mục cha + dấu gdk_src",
              "/files/SRC/copy" in uri and sent == {"name": "PRSP_Level", "parents": ["DEST"],
                                                     "appProperties": {"gdk_src": "SRC"}}, sent)
        try:
            backend.copy_file("SRC2", "y", "DEST")
            check("403 cấm copy → báo lỗi ngay, không thử lại", False)
        except gdrive.DriveError as exc:
            check("403 cấm copy → báo lỗi ngay, không thử lại",
                  "permission" in str(exc) and len(http.request_sequence) == 5, str(exc))
    finally:
        gdrive.time.sleep = real_sleep


def main():
    FAILS.clear()
    print("\n=== SELFTEST Drive Clone (Drive giả lập, không cần mạng) ===")
    test_rename()
    test_skeleton()
    test_full_copy()
    test_stop_resume_and_errors()
    test_parallel()
    test_real_backend_wiring()
    print("\n=== KẾT QUẢ: {} ===\n".format("TẤT CẢ ĐẠT" if not FAILS else "HỎNG {} mục: {}".format(len(FAILS), FAILS)))
    return 0 if not FAILS else 1


if __name__ == "__main__":
    for _s in (sys.stdout, sys.stderr):
        try:
            _s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:  # noqa: BLE001
            pass
    sys.exit(main())

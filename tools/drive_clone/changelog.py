"""Change Log của mỗi lần clone: CSV lưu local + Google Sheet đặt ngay trong đích.

Cột giữ đúng format của bản Apps Script 'Copy BSHP → PRSP' trước đây để người
đã quen đọc không phải học lại.
"""
from __future__ import annotations

import csv
import io

from .gdrive import SHEET_MIME, view_url
from .pipeline import LOG_PREFIX, STATUS_LABEL

HEADERS = ["Time", "Type", "Status", "Renamed", "Old Name", "New Name", "Old Path", "New Path",
           "Note", "MIME Type", "Size (bytes)", "Old Link", "New Link", "Source ID", "New ID"]
KEYS = ["time", "type", "status", "renamed", "old_name", "new_name", "old_path", "new_path",
        "note", "mime", "size", "old_link", "new_link", "src_id", "new_id"]
WIDTHS = [140, 70, 90, 70, 260, 260, 360, 360, 260, 220, 90, 240, 240, 140, 140]
COL_STATUS, COL_RENAMED = 2, 3


def summarize(entries):
    c = {k: 0 for k in STATUS_LABEL}
    renamed = 0
    for e in entries:
        c[e["status"]] = c.get(e["status"], 0) + 1
        if e["renamed"] and e["status"] not in ("SKIPPED", "ERROR"):
            renamed += 1
    return {
        "folders_created": c["CREATED"],
        "folders_merged": c["MERGED"],
        "files_copied": c["COPIED"],
        "skeletons": c["SKELETON"],
        "shortcuts": c["SHORTCUT"],
        "exists": c["EXISTS"],
        "skipped": c["SKIPPED"],
        "errors": c["ERROR"],
        "renamed": renamed,
        "total": len(entries),
    }


COUNT_LABELS = [
    ("folders_created", "Thư mục tạo mới"),
    ("folders_merged", "Thư mục gộp vào có sẵn"),
    ("files_copied", "File copy đầy đủ"),
    ("skeletons", "File vỏ rỗng"),
    ("shortcuts", "Shortcut"),
    ("exists", "Đã có ở đích (bỏ qua)"),
    ("skipped", "Bỏ qua theo thiết lập"),
    ("errors", "Lỗi"),
    ("renamed", "Mục được đổi tên"),
    ("total", "Tổng số dòng"),
]


def _safe(v):
    """Chuỗi bắt đầu bằng = + - @ → thêm ' để Excel không chạy như công thức. Tên file trên Drive do
    người khác đặt (vd "=HYPERLINK(...)") không được tự thực thi khi mở Change Log bằng Excel."""
    if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r"):
        try:
            float(v)
        except ValueError:
            return "'" + v
    return v


def to_csv(entries):
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(HEADERS)
    for e in entries:
        writer.writerow([_safe(e.get(k, "")) for k in KEYS])
    return buf.getvalue()


def summary_rows(plan, result, report, counts, title):
    o = plan["options"]
    rules = "; ".join('"{}" → "{}"{}{}'.format(r["from"], r.get("to", ""),
                                                " (không phân biệt hoa thường, giữ kiểu chữ)" if r.get("ignore_case") else "",
                                                " (regex)" if r.get("regex") else "")
                      for r in o["rename_rules"]) or "(không đổi tên)"
    if result.get("stopped"):
        status = "STOPPED — chạy lại để tiếp tục"
    elif report and not report["ok"]:
        status = "DONE — hậu kiểm có mục FAIL"
    else:
        status = "DONE"
    rows = [
        (title, "", ""),
        ("", "", ""),
        ("Chế độ", "PREVIEW (chạy thử) — chưa tạo gì" if result.get("dry_run") else "CLONE", ""),
        ("Trạng thái", status, ""),
        ("Nguồn (A)", plan["source"]["name"], plan["source"].get("url", "")),
        ("Đích (B)", result.get("dest_name", ""), view_url(plan["dest_parent"], "application/vnd.google-apps.folder")),
        ("Thư mục bản sao", result.get("root_name", ""), result.get("root_url", "")),
        ("Kiểu nội dung", "Copy toàn bộ dữ liệu" if o["content_mode"] == "full" else "Chỉ dựng khung (file vỏ rỗng)", ""),
        ("Quy tắc đổi tên", rules, ""),
        ("Trùng tên ở đích", "Gộp thư mục, giữ nguyên file có sẵn" if o["skip_existing"] else "Luôn tạo mới", ""),
        ("Đổi link", {"off": "Tắt", "masters": "Master sheet", "all": "Mọi Sheet/xlsx được copy"}[o["remap_links"]], ""),
        ("Kết thúc", result.get("finished_at", "").replace("T", " "), ""),
        ("", "", ""),
    ]
    rows += [(label, counts.get(key, 0), "") for key, label in COUNT_LABELS]
    if report:
        s = report["summary"]
        rows += [("", "", ""),
                 ("Hậu kiểm", "PASS {} · FAIL {} · WARN {} · SKIP {}".format(
                     s.get("PASS", 0), s.get("FAIL", 0), s.get("WARN", 0), s.get("SKIP", 0)), "")]
        rows += [("  " + c["id"] + " " + c["name"], c["status"], c["detail"]) for c in report["checks"]]
    return rows


def sheet_title(plan, started):
    return "{}{} – {}".format(LOG_PREFIX, plan["source"]["name"], started[:16].replace("T", " "))


def _text(v):
    return {"userEnteredValue": {"stringValue": str(v)}}


def _cell(v, link=False):
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return {"userEnteredValue": {"numberValue": v}}
    v = "" if v is None else str(v)
    cell = _text(v)
    if link and v.startswith("http"):
        cell["textFormatRuns"] = [{"startIndex": 0, "format": {"link": {"uri": v}}}]
    return cell


def _rgb(hex6):
    return {"red": int(hex6[0:2], 16) / 255, "green": int(hex6[2:4], 16) / 255,
            "blue": int(hex6[4:6], 16) / 255}


def write_sheet(backend, parent_id, title, summary, entries):
    """Tạo Google Sheet Change Log trong thư mục đích. Trả về {id, url}."""
    sid = backend.create_empty(title, SHEET_MIME, parent_id, props={"gdk_kind": "changelog"})
    sheets = backend.sheets_meta(sid).get("sheets", [])
    log_tab = sheets[0]["properties"]["sheetId"] if sheets else 0
    sum_tab = log_tab + 7
    n = len(entries)
    link_cols = {KEYS.index("old_link"), KEYS.index("new_link")}

    reqs = [
        {"updateSheetProperties": {
            "properties": {"sheetId": log_tab, "title": "Change Log",
                           "gridProperties": {"rowCount": max(n + 1, 2), "columnCount": len(HEADERS),
                                              "frozenRowCount": 1}},
            "fields": "title,gridProperties.rowCount,gridProperties.columnCount,gridProperties.frozenRowCount"}},
        {"addSheet": {"properties": {"sheetId": sum_tab, "title": "Summary", "index": 0,
                                     "gridProperties": {"rowCount": len(summary) + 5, "columnCount": 3}}}},
        {"updateCells": {"start": {"sheetId": sum_tab, "rowIndex": 0, "columnIndex": 0},
                         "rows": [{"values": [_cell(a), _cell(b), _cell(c, link=True)]} for a, b, c in summary],
                         "fields": "userEnteredValue,textFormatRuns"}},
        {"updateCells": {"start": {"sheetId": log_tab, "rowIndex": 0, "columnIndex": 0},
                         "rows": [{"values": [_text(h) for h in HEADERS]}],
                         "fields": "userEnteredValue"}},
    ]
    backend.sheets_batch_update(sid, reqs)
    # mỗi lô 400 dòng một lần gọi riêng để không vượt giới hạn dung lượng request
    for i in range(0, n, 400):
        chunk = entries[i:i + 400]
        backend.sheets_batch_update(sid, [{"updateCells": {
            "start": {"sheetId": log_tab, "rowIndex": 1 + i, "columnIndex": 0},
            "rows": [{"values": [_cell(e.get(k, ""), link=(j in link_cols)) for j, k in enumerate(KEYS)]}
                     for e in chunk],
            "fields": "userEnteredValue,textFormatRuns"}}])

    # định dạng: header đậm nền xanh đậm, dòng đổi tên xanh lá, dòng lỗi đỏ…
    reqs = []
    reqs.append({"repeatCell": {
        "range": {"sheetId": log_tab, "startRowIndex": 0, "endRowIndex": 1},
        "cell": {"userEnteredFormat": {"backgroundColor": _rgb("1f3864"),
                                       "textFormat": {"bold": True, "foregroundColor": _rgb("ffffff")}}},
        "fields": "userEnteredFormat(backgroundColor,textFormat)"}})
    reqs.append({"repeatCell": {
        "range": {"sheetId": sum_tab, "startRowIndex": 0, "endRowIndex": 1, "startColumnIndex": 0, "endColumnIndex": 1},
        "cell": {"userEnteredFormat": {"textFormat": {"bold": True, "fontSize": 13}}},
        "fields": "userEnteredFormat.textFormat"}})
    for col, text, color in [(COL_STATUS, "ERROR", "f4c7c3"), (COL_STATUS, "EXISTS", "fce8b2"),
                             (COL_STATUS, "SKIPPED", "fce8b2"), (COL_STATUS, "MERGED", "d2e3fc"),
                             (COL_RENAMED, "YES", "ceead6")]:
        reqs.append({"addConditionalFormatRule": {"index": 0, "rule": {
            "ranges": [{"sheetId": log_tab, "startRowIndex": 1, "startColumnIndex": col, "endColumnIndex": col + 1}],
            "booleanRule": {"condition": {"type": "TEXT_EQ", "values": [{"userEnteredValue": text}]},
                            "format": {"backgroundColor": _rgb(color)}}}}})
    for i, w in enumerate(WIDTHS):
        reqs.append({"updateDimensionProperties": {
            "range": {"sheetId": log_tab, "dimension": "COLUMNS", "startIndex": i, "endIndex": i + 1},
            "properties": {"pixelSize": w}, "fields": "pixelSize"}})
    for i, w in enumerate([230, 420, 460]):
        reqs.append({"updateDimensionProperties": {
            "range": {"sheetId": sum_tab, "dimension": "COLUMNS", "startIndex": i, "endIndex": i + 1},
            "properties": {"pixelSize": w}, "fields": "pixelSize"}})

    backend.sheets_batch_update(sid, reqs)
    return {"id": sid, "url": view_url(sid, SHEET_MIME), "title": title}

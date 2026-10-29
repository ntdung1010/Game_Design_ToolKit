"""Nghiệp vụ Drive Clone: scan -> plan -> clone -> đổi link -> hậu kiểm.

Hai chế độ nội dung:
  full      — copy TOÀN BỘ dữ liệu, file nào cũng copy nguyên nội dung
              (ca "copy folder A sang B, đổi BSHP → PRSP, có change log")
  skeleton  — chỉ dựng khung: thư mục + file vỏ rỗng; master sheet copy đầy đủ
              (ca "dựng folder tài liệu mới theo bố cục folder mẫu TSM_ → GWP_")

Đường dẫn trong cây lưu dạng TUPLE các phần đoạn (parts), không nối bằng "/",
vì tên thư mục trên Drive được phép chứa "/" (ví dụ "TSM_ Segment ROAS/BLD").
"""
from __future__ import annotations

import datetime
import html
import io
import json
import re
import threading
import zipfile
from concurrent.futures import ThreadPoolExecutor

from .gdrive import (
    DOC_MIME,
    FOLDER_MIME,
    GOOGLE_PREFIX,
    NATIVE_CREATABLE,
    PROP_SRC,
    SHEET_MIME,
    SHORTCUT_MIME,
    SLIDE_MIME,
    XLSX_MIME,
    _ID_IN_URL,
    MY_DRIVE,
    DriveError,
    parse_id,
    view_url,
)

PATH_SEP = "  /  "
LOG_SEP = " / "
LOG_PREFIX = "Change Log – "
DEFAULT_MASTER_PATTERN = r"master|tong\s*hop|tổng\s*hợp|index|summary|muc\s*luc|mục\s*lục"


def now_iso():
    return datetime.datetime.now().isoformat(timespec="seconds")


def show_path(parts):
    return PATH_SEP.join(parts) if parts else "(gốc)"


def _noop(*_a, **_k):
    return None


# ==========================================================================
# 1. SCAN
# ==========================================================================
def scan(backend, root_id, log=None, max_depth=30, should_stop=None, workers=4):
    """Quét cây thư mục theo từng tầng; các thư mục cùng tầng được liệt kê SONG SONG."""
    log = log or _noop
    should_stop = should_stop or (lambda: False)
    root = backend.get_file(root_id)
    if root.get("mimeType") != FOLDER_MIME:
        raise DriveError("ID này không phải thư mục: " + root.get("name", root_id))

    items, seen, next_log = [], {root_id}, 200
    frontier, depth = [((), root_id)], 0
    log("Quét thư mục: " + root.get("name", "?"))

    def list_one(entry):
        if should_stop():
            raise DriveError("Đã dừng quét.")
        return backend.list_children(entry[1])

    with ThreadPoolExecutor(max_workers=max(1, min(int(workers or 1), 8))) as pool:
        while frontier and depth <= max_depth:
            nxt = []
            for (parts, _), kids in zip(frontier, pool.map(list_one, frontier)):
                for child in kids:
                    cparts = parts + (child["name"],)
                    mime = child["mimeType"]
                    item = {
                        "id": child["id"],
                        "name": child["name"],
                        "mime": mime,
                        "parts": list(cparts),
                        "path": show_path(cparts),
                        "parent_parts": list(parts),
                        "depth": depth + 1,
                        "kind": "folder" if mime == FOLDER_MIME else "file",
                        "bytes": int(child.get("size") or child.get("quotaBytesUsed") or 0),
                        "url": child.get("webViewLink") or view_url(child["id"], mime),
                        "props": child.get("appProperties") or {},
                    }
                    if mime == SHORTCUT_MIME:
                        item["kind"] = "shortcut"
                        item["target_id"] = (child.get("shortcutDetails") or {}).get("targetId", "")
                    items.append(item)
                    if mime == FOLDER_MIME and child["id"] not in seen:
                        seen.add(child["id"])
                        nxt.append((cparts, child["id"]))
            if len(items) >= next_log:
                log("  … đã thấy {} mục".format(len(items)))
                next_log = len(items) + 200
            frontier, depth = nxt, depth + 1

    folders = sum(1 for i in items if i["kind"] == "folder")
    manifest = {
        "root": {"id": root_id, "name": root.get("name", ""),
                 "url": view_url(root_id, FOLDER_MIME)},
        "scanned_at": now_iso(),
        "items": items,
        "stats": {
            "folders": folders,
            "files": len(items) - folders,
            "total": len(items),
            "depth": max([i["depth"] for i in items], default=0),
            "bytes": sum(i["bytes"] for i in items if i["kind"] == "file"),
        },
    }
    log("Quét xong: {} thư mục, {} file".format(folders, len(items) - folders))
    return manifest


# ==========================================================================
# 2. ĐỔI TÊN
# ==========================================================================
def match_case(sample, text):
    """Giữ kiểu chữ của đoạn bị thay: BSHP → PRSP, bshp → prsp, Bshp → Prsp."""
    if sample == sample.upper():
        return text.upper()
    if sample == sample.lower():
        return text.lower()
    if sample[:1] == sample[:1].upper() and sample[1:] == sample[1:].lower():
        return text[:1].upper() + text[1:].lower()
    return text


def apply_rule(name, rule):
    src = rule.get("from") or ""
    if not src:
        return name
    dst = rule.get("to") or ""
    ignore_case = bool(rule.get("ignore_case"))
    if rule.get("regex"):
        try:
            return re.sub(src, dst, name, flags=re.I if ignore_case else 0)
        except (re.error, IndexError):
            return name
    if not ignore_case:
        return name.replace(src, dst)
    return re.sub(re.escape(src),
                  lambda m: dst if m.group(0) == src else match_case(m.group(0), dst),
                  name, flags=re.I)


def rename(name, rules):
    for rule in rules or []:
        name = apply_rule(name, rule)
    return name


def rule_problems(rules):
    out = []
    for i, rule in enumerate(rules or [], 1):
        if rule.get("regex") and rule.get("from"):
            try:
                re.compile(rule["from"])
            except re.error as exc:
                out.append("Quy tắc {} — regex sai: {}".format(i, exc))
    return out


# ==========================================================================
# 3. PLAN
# ==========================================================================
DEFAULT_OPTIONS = {
    "dest_parent": "",
    "content_mode": "full",          # full | skeleton
    "wrap_root": False,              # True: tạo thư mục gốc mới trong B; False: đổ thẳng vào B
    "new_root_name": "",
    "rename_rules": [],              # [{"from","to","ignore_case","regex"}]
    "item_modes": {},                # id -> copy | skeleton | skip (chọn tay từng mục)
    "full_copy_ids": [],             # tương thích CLI cũ
    "skip_ids": [],
    "auto_master": True,
    "master_pattern": DEFAULT_MASTER_PATTERN,
    "binary_mode": "skeleton",       # (chế độ khung) skeleton | skip
    "uncreatable_mode": "placeholder_doc",  # (chế độ khung) placeholder_doc | shortcut | skip
    "shortcut_mode": "retarget",     # retarget | skip
    "remap_links": "masters",        # off | masters | all
    "build_index": False,
    "skip_existing": True,           # trùng tên ở đích: thư mục → gộp, file → giữ nguyên
    "write_log_sheet": True,
    "dry_run": False,
    "workers": 4,                    # số luồng song song (1–8); Drive giới hạn tốc độ ghi nên 4 là vừa
}


def normalize_options(opts):
    out = {**DEFAULT_OPTIONS, **(opts or {})}
    rl = out.get("remap_links")
    if rl is True:
        out["remap_links"] = "masters"
    elif rl in (False, None, ""):
        out["remap_links"] = "off"
    out["rename_rules"] = [r for r in out.get("rename_rules") or [] if r.get("from")]
    out["item_modes"] = dict(out.get("item_modes") or {})
    return out


def pick_masters(manifest, opts):
    """Sheet/xlsx khớp tên mẫu hoặc nằm ngay ở gốc = master (copy đầy đủ + đổi link)."""
    if not opts.get("auto_master", True):
        return set()
    try:
        pat = re.compile(opts.get("master_pattern") or DEFAULT_MASTER_PATTERN, re.I)
    except re.error:
        pat = re.compile(DEFAULT_MASTER_PATTERN, re.I)
    chosen = set()
    for item in manifest["items"]:
        if item["kind"] != "file" or item["mime"] not in (SHEET_MIME, XLSX_MIME):
            continue
        if pat.search(item["name"]) or len(item["parts"]) == 1:
            chosen.add(item["id"])
    return chosen


def build_plan(manifest, opts):
    opts = normalize_options(opts)
    rules = opts["rename_rules"]
    masters = pick_masters(manifest, opts)
    modes = dict(opts["item_modes"])
    for i in opts.get("full_copy_ids") or []:
        modes.setdefault(i, "copy")
    for i in opts.get("skip_ids") or []:
        modes.setdefault(i, "skip")
    full = opts["content_mode"] == "full"
    remap = opts["remap_links"]

    # để trống B = My Drive: luôn tạo thư mục mới (tool chỉ ghi được vào thư mục do chính nó tạo)
    dest_id = parse_id(opts.get("dest_parent", "")) or MY_DRIVE
    if dest_id == MY_DRIVE:
        opts["wrap_root"] = True
    root_name = ""
    if opts["wrap_root"]:
        root_name = (opts.get("new_root_name") or "").strip() or rename(manifest["root"]["name"], rules)

    ops, skipped_parents = [], set()
    for item in sorted(manifest["items"], key=lambda i: (i["depth"], i["path"])):
        parts = tuple(item["parts"])
        is_folder = item["kind"] == "folder"
        mode = modes.get(item["id"])

        if tuple(item["parent_parts"]) in skipped_parents:
            if is_folder:
                skipped_parents.add(parts)
            ops.append(_op(item, rules, "skip", "nằm trong thư mục bị loại trừ"))
            continue
        if item["id"] == dest_id:
            skipped_parents.add(parts)
            ops.append(_op(item, rules, "skip", "đây là thư mục ĐÍCH (nằm trong nguồn) — không copy chính nó"))
            continue
        if mode == "skip":
            if is_folder:
                skipped_parents.add(parts)
            ops.append(_op(item, rules, "skip", "bạn chọn bỏ qua"))
            continue
        if is_folder:
            ops.append(_op(item, rules, "folder", ""))
            continue
        if item["kind"] == "shortcut":
            if opts["shortcut_mode"] == "skip":
                ops.append(_op(item, rules, "skip", "shortcut — bỏ qua"))
            else:
                ops.append(_op(item, rules, "shortcut", "trỏ sang bản mới nếu đích nằm trong cây"))
            continue

        mime = item["mime"]
        is_master = item["id"] in masters
        is_google = mime.startswith(GOOGLE_PREFIX)
        want = mode or ("copy" if (full or is_master) else "skeleton")

        if want == "copy":
            op = _op(item, rules, "copy", "master — copy cả nội dung" if is_master and not full else "")
        elif is_google and mime not in NATIVE_CREATABLE:
            um = "placeholder_doc" if mode == "skeleton" else opts["uncreatable_mode"]
            if um == "skip":
                op = _op(item, rules, "skip", "Google API không tạo rỗng được kiểu này")
            elif um == "shortcut":
                op = _op(item, rules, "shortcut", "kiểu đặc biệt → shortcut về bản gốc")
                op["target_id"] = item["id"]
            else:
                op = _op(item, rules, "skeleton", "kiểu đặc biệt → tạo Doc rỗng thay thế")
                op["dst_mime"] = DOC_MIME
        elif not is_google and mode is None and opts["binary_mode"] == "skip":
            op = _op(item, rules, "skip", "file nhị phân — bỏ qua")
        else:
            op = _op(item, rules, "skeleton", "")

        op["master"] = is_master
        op["remap"] = (op["kind"] == "copy" and mime in (SHEET_MIME, XLSX_MIME)
                       and (remap == "all" or (remap == "masters" and is_master)))
        ops.append(op)

    counts = {}
    for op in ops:
        counts[op["kind"]] = counts.get(op["kind"], 0) + 1
    active = [o for o in ops if o["kind"] != "skip"]
    return {
        "created_at": now_iso(),
        "source": manifest["root"],
        "dest_parent": dest_id,
        "wrap_root": bool(opts["wrap_root"]),
        "new_root_name": root_name,
        "root_renamed": bool(root_name) and root_name != manifest["root"]["name"],
        "options": opts,
        "ops": ops,
        "warnings": rule_problems(rules) + _collisions(active),
        "stats": {
            "folders": counts.get("folder", 0),
            "skeleton": counts.get("skeleton", 0),
            "copy": counts.get("copy", 0),
            "shortcut": counts.get("shortcut", 0),
            "skip": counts.get("skip", 0),
            "renamed": sum(1 for o in active if o["renamed"]) + (1 if root_name and root_name != manifest["root"]["name"] else 0),
            "remap": sum(1 for o in active if o.get("remap")),
            "bytes_copy": sum(o["size"] for o in active if o["kind"] == "copy"),
            "total": len(ops),
            "active": len(active),
        },
    }


def _op(item, rules, kind, note):
    dst_name = rename(item["name"], rules)
    dst_parts = [rename(p, rules) for p in item["parts"]]
    return {
        "kind": kind,
        "item_kind": item["kind"],
        "src_id": item["id"],
        "src_name": item["name"],
        "src_parts": list(item["parts"]),
        "src_path": item["path"],
        "src_url": item.get("url", ""),
        "mime": item["mime"],
        "dst_mime": item["mime"],
        "dst_name": dst_name,
        "dst_parts": dst_parts,
        "dst_path": show_path(dst_parts),
        "parent_parts": dst_parts[:-1],
        "depth": item["depth"],
        "size": item.get("bytes", 0),
        "target_id": item.get("target_id", ""),
        "renamed": dst_name != item["name"],
        "master": False,
        "remap": False,
        "note": note,
    }


def _collisions(ops):
    seen = {}
    for o in ops:
        key = (tuple(o["parent_parts"]), o["dst_name"], o["kind"] == "folder")
        seen.setdefault(key, []).append(o["src_name"])
    out = []
    for (parent, name, _), srcs in seen.items():
        if len(srcs) > 1:
            out.append("Trùng tên sau khi đổi: {} mục → '{}' trong {} ({})".format(
                len(srcs), name, show_path(list(parent)), ", ".join(sorted(set(srcs)))[:160]))
    return out[:30]


# ==========================================================================
# 4. CLONE
# ==========================================================================
STATUS_LABEL = {
    "CREATED": "tạo thư mục mới",
    "MERGED": "gộp vào thư mục có sẵn",
    "COPIED": "copy đầy đủ",
    "SKELETON": "tạo vỏ rỗng",
    "SHORTCUT": "tạo shortcut",
    "EXISTS": "đã có ở đích — giữ nguyên",
    "SKIPPED": "bỏ qua",
    "ERROR": "lỗi",
}


def execute(backend, plan, log=None, progress=None, should_stop=None):
    """Tạo bản sao. Các mục CÙNG TẦNG chạy song song (opts.workers luồng, mặc định 4); tầng sau chỉ
    bắt đầu khi tầng trước xong để thư mục cha luôn có trước. Change Log giữ đúng thứ tự kế hoạch."""
    log = log or _noop
    progress = progress or _noop
    should_stop = should_stop or (lambda: False)
    opts = plan["options"]
    dry = bool(opts.get("dry_run"))
    skip_existing = bool(opts.get("skip_existing", True))
    dest_parent = plan["dest_parent"]
    if not dest_parent:
        raise DriveError("Chưa nhập thư mục ĐÍCH (B).")
    if dest_parent == plan["source"]["id"]:
        raise DriveError("Thư mục đích đang trùng thư mục nguồn.")
    dest = backend.get_file(dest_parent)
    if dest.get("mimeType") != FOLDER_MIME:
        raise DriveError("Link ĐÍCH không phải thư mục: " + dest.get("name", dest_parent))
    dest_name = dest.get("name", "")
    src_name = plan["source"]["name"]

    fresh, listing = set(), {}
    counter = {"n": 0}
    lock = threading.Lock()
    workers = max(1, min(int(opts.get("workers") or 4), 8))

    def children(pid):
        if pid in fresh:
            return []
        if pid not in listing:
            kids = backend.list_children(pid)
            with lock:
                listing.setdefault(pid, kids)
        return listing[pid]

    def find_existing(pid, name, is_folder):
        for c in children(pid):
            if c["name"] == name and (c["mimeType"] == FOLDER_MIME) == is_folder:
                return c
        return None

    def make(kind, *args, src_id=""):
        with lock:
            counter["n"] += 1
            k = counter["n"]
        if dry:
            return "DRY{:05d}".format(k)
        props = {PROP_SRC: src_id} if src_id else None
        if kind == "folder":
            return backend.create_folder(*args, props=props)
        if kind == "empty":
            return backend.create_empty(*args, props=props)
        if kind == "shortcut":
            return backend.create_shortcut(*args, props=props)
        return backend.copy_file(*args, props=props)

    root_prefix = [dest_name]
    entries = []

    def entry(op, status, new_id="", note=""):
        kind = op.get("item_kind", "folder")
        new_mime = op.get("dst_mime", FOLDER_MIME)
        return {
            "time": now_iso().replace("T", " "),
            "type": {"folder": "Folder", "shortcut": "Shortcut"}.get(kind, "File"),
            "status": status,
            "renamed": "YES" if op.get("renamed") else "",
            "old_name": op["src_name"],
            "new_name": op["dst_name"],
            "old_path": LOG_SEP.join([src_name] + op.get("src_parts", [])),
            "new_path": LOG_SEP.join(root_prefix + op.get("dst_parts", [])),
            "note": note or op.get("note", ""),
            "mime": op.get("mime", FOLDER_MIME),
            "size": op.get("size", "") if kind == "file" else "",
            "old_link": op.get("src_url", ""),
            "new_link": view_url(new_id, new_mime) if new_id and not new_id.startswith("DRY") else "",
            "src_id": op["src_id"],
            "new_id": "" if new_id.startswith("DRY") else new_id,
        }

    # -- thư mục gốc --------------------------------------------------------
    root_op = {"item_kind": "folder", "src_name": src_name, "dst_name": plan["new_root_name"],
               "src_parts": [], "dst_parts": [], "src_id": plan["source"]["id"],
               "src_url": plan["source"].get("url", ""), "renamed": plan.get("root_renamed")}
    if plan["wrap_root"]:
        root_prefix.append(plan["new_root_name"])
        ex = find_existing(dest_parent, plan["new_root_name"], True) if skip_existing else None
        if ex:
            root_id = ex["id"]
            log("Gộp vào thư mục có sẵn ở đích: " + plan["new_root_name"])
            entries.append(entry(root_op, "MERGED", root_id, "thư mục gốc đã có ở đích — gộp vào"))
        else:
            root_id = make("folder", plan["new_root_name"], dest_parent, src_id=plan["source"]["id"])
            fresh.add(root_id)
            log("Tạo thư mục gốc: " + plan["new_root_name"])
            entries.append(entry(root_op, "CREATED", root_id, "thư mục gốc của bản sao"))
    else:
        root_id = dest_parent

    path_map = {(): root_id}
    id_map = {plan["source"]["id"]: root_id}
    done, existing, failed, foreign = [], [], [], []
    stopped = False

    # shortcut làm sau cùng để trỏ được sang bản mới dù đích của nó nằm sâu hơn
    order = sorted(plan["ops"], key=lambda o: (o["kind"] == "shortcut", o["depth"], o["dst_path"]))
    total = sum(1 for o in order if o["kind"] != "skip")
    progress(0, total)
    state = {"n": 0}

    def process(op):
        """Xử lý 1 mục, trả về dòng Change Log. Mọi chỗ ghi vào dữ liệu chung đều có khoá."""
        parent_id = path_map.get(tuple(op["parent_parts"]))
        try:
            if parent_id is None:
                with lock:
                    failed.append({**op, "error": "thư mục cha không tạo được"})
                return entry(op, "ERROR", note="thư mục cha không tạo được")
            is_folder = op["kind"] == "folder"
            ex = find_existing(parent_id, op["dst_name"], is_folder) if skip_existing else None
            if ex:
                new_id = ex["id"]
                ours = (ex.get("appProperties") or {}).get(PROP_SRC) == op["src_id"]
                with lock:
                    id_map[op["src_id"]] = new_id
                    if is_folder:
                        path_map[tuple(op["dst_parts"])] = new_id
                    elif ours:
                        existing.append({**op, "dst_id": new_id})
                    else:
                        foreign.append(op["src_id"])
                if is_folder:
                    return entry(op, "MERGED", new_id, "thư mục đã có ở đích — gộp vào")
                return entry(op, "EXISTS", new_id, "đã clone ở lần chạy trước" if ours
                             else "đích đã có file cùng tên — giữ nguyên, không ghi đè")
            if is_folder:
                new_id = make("folder", op["dst_name"], parent_id, src_id=op["src_id"])
                status = "CREATED"
            elif op["kind"] == "skeleton":
                new_id = make("empty", op["dst_name"], op["dst_mime"], parent_id, src_id=op["src_id"])
                status = "SKELETON"
            elif op["kind"] == "copy":
                new_id = make("copy", op["src_id"], op["dst_name"], parent_id, src_id=op["src_id"])
                status = "COPIED"
            else:
                target = id_map.get(op["target_id"]) or op["target_id"] or op["src_id"]
                new_id = make("shortcut", op["dst_name"], target, parent_id, src_id=op["src_id"])
                status = "SHORTCUT"
            with lock:
                if is_folder:
                    fresh.add(new_id)
                    path_map[tuple(op["dst_parts"])] = new_id
                id_map[op["src_id"]] = new_id
                done.append({**op, "dst_id": new_id})
            return entry(op, status, new_id)
        except Exception as exc:  # noqa: BLE001 — 1 file lỗi không được làm hỏng cả lượt
            with lock:
                failed.append({**op, "error": str(exc)})
            log("  LỖI: " + op["dst_path"] + " → " + str(exc), "error")
            return entry(op, "ERROR", note=str(exc))
        finally:
            with lock:
                state["n"] += 1
                n = state["n"]
            progress(n)
            if n % 25 == 0:
                log("  … {} / {} mục".format(n, total))

    groups = []
    for op in order:
        key = (op["kind"] == "shortcut", op["depth"])
        if not groups or groups[-1][0] != key:
            groups.append((key, []))
        groups[-1][1].append(op)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for _, group in groups:
            # liệt kê trước (song song) các thư mục đích đã có sẵn → các luồng chỉ còn đọc cache
            if skip_existing:
                parents = {path_map.get(tuple(o["parent_parts"])) for o in group if o["kind"] != "skip"}
                list(pool.map(children, [p for p in parents if p and p not in fresh and p not in listing]))
            slots, futures = [None] * len(group), {}
            for i, op in enumerate(group):
                if op["kind"] == "skip":
                    slots[i] = entry(op, "SKIPPED")
                    continue
                if stopped or should_stop():
                    stopped = True
                    break
                futures[i] = pool.submit(process, op)
            for i, f in futures.items():
                slots[i] = f.result()
            entries.extend(x for x in slots if x is not None)
            if stopped:
                log("Đã dừng theo yêu cầu — {} / {} mục đã xử lý.".format(state["n"], total), "error")
                break

    log("Xong phần tạo: {} mục mới, {} mục đã có, {} lỗi{}".format(
        len(done), len(existing) + len(foreign), len(failed), " (CHẠY THỬ)" if dry else ""))
    return {
        "root_id": root_id,
        "root_url": view_url(root_id, FOLDER_MIME) if not root_id.startswith("DRY") else "",
        "root_name": plan["new_root_name"] if plan["wrap_root"] else dest_name,
        "dest_name": dest_name,
        "dry_run": dry,
        "stopped": stopped,
        "id_map": id_map,
        "done": done,
        "existing": existing,
        "foreign": foreign,
        "failed": failed,
        "entries": entries,
        "finished_at": now_iso(),
    }


# ==========================================================================
# 5. ĐỔI LINK
# ==========================================================================
def find_ids(text):
    return _ID_IN_URL.findall(text or "")


def remap_text(text, id_map):
    """Đổi mọi ID Drive nằm trong ngữ cảnh URL. Trả về (text_mới, số_lần_đổi)."""
    hits = {"n": 0}

    def sub(match):
        old = match.group(1)
        new = id_map.get(old)
        if not new or new == old:
            return match.group(0)
        hits["n"] += 1
        return match.group(0).replace(old, new)

    return _ID_IN_URL.sub(sub, text or ""), hits["n"]


def remap_sheet(backend, spreadsheet_id, id_map, log=None):
    log = log or _noop
    doc = backend.sheets_get(spreadsheet_id)
    requests, changed = [], 0
    for sheet in doc.get("sheets", []):
        sheet_id = sheet["properties"]["sheetId"]
        for grid in sheet.get("data", []):
            r0, c0 = grid.get("startRow", 0), grid.get("startColumn", 0)
            for ri, row in enumerate(grid.get("rowData", []) or []):
                for ci, cell in enumerate(row.get("values", []) or []):
                    patch, fields, n = _remap_cell(cell, id_map)
                    if not n:
                        continue
                    changed += n
                    requests.append({"updateCells": {
                        "start": {"sheetId": sheet_id, "rowIndex": r0 + ri, "columnIndex": c0 + ci},
                        "rows": [{"values": [patch]}],
                        "fields": ",".join(fields),
                    }})
    if requests:
        backend.sheets_batch_update(spreadsheet_id, requests)
    return {"links_changed": changed, "cells_touched": len(requests)}


def _remap_cell(cell, id_map):
    patch, fields, total = {}, [], 0

    uev = cell.get("userEnteredValue") or {}
    formula = uev.get("formulaValue")
    if formula and "HYPERLINK" in formula.upper():
        new_formula, n = remap_text(formula, id_map)
        if n:
            patch["userEnteredValue"] = {"formulaValue": new_formula}
            fields.append("userEnteredValue")
            total += n

    runs = cell.get("textFormatRuns")
    if runs:
        new_runs, n = [], 0
        for run in runs:
            run = json.loads(json.dumps(run))
            uri = (run.get("format", {}).get("link") or {}).get("uri")
            if uri:
                new_uri, k = remap_text(uri, id_map)
                if k:
                    run["format"]["link"]["uri"] = new_uri
                    n += k
            new_runs.append(run)
        if n:
            patch["textFormatRuns"] = new_runs
            if "userEnteredValue" not in patch and uev:
                patch["userEnteredValue"] = uev
            for f in ("userEnteredValue", "textFormatRuns"):
                if f not in fields:
                    fields.append(f)
            total += n

    link = ((cell.get("userEnteredFormat") or {}).get("textFormat") or {}).get("link")
    if link and link.get("uri"):
        new_uri, n = remap_text(link["uri"], id_map)
        if n:
            patch.setdefault("userEnteredFormat", {}).setdefault("textFormat", {})["link"] = {"uri": new_uri}
            fields.append("userEnteredFormat.textFormat.link")
            total += n

    return patch, fields, total


def remap_xlsx_bytes(data, id_map):
    """Sửa link trong .xlsx bằng cách viết lại XML trong zip — không làm mất
    chart/ảnh/định dạng vì các phần khác giữ nguyên byte."""
    out, changed = io.BytesIO(), 0
    with zipfile.ZipFile(io.BytesIO(data)) as zin, \
            zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            raw = zin.read(info.filename)
            if info.filename.endswith((".xml", ".rels")):
                try:
                    text = raw.decode("utf-8")
                except UnicodeDecodeError:
                    zout.writestr(info, raw)
                    continue
                new_text, n = remap_text(text, id_map)
                if n:
                    changed += n
                    raw = new_text.encode("utf-8")
            zout.writestr(info, raw)
    return out.getvalue(), changed


def remap_targets(result):
    """File được phép đổi link: tạo mới lượt này + bản do tool tạo ở lượt trước.
    File có sẵn của người dùng ở đích KHÔNG BAO GIỜ bị sửa."""
    return [o for o in result["done"] + result["existing"] if o.get("remap")]


def remap_all(backend, plan, result, log=None, should_stop=None):
    log = log or _noop
    should_stop = should_stop or (lambda: False)
    stats = {"files": 0, "links_changed": 0, "errors": []}
    if result.get("dry_run"):
        return stats
    id_map = result["id_map"]
    for op in remap_targets(result):
        if should_stop():
            break
        fid = op["dst_id"]
        try:
            if op["dst_mime"] == SHEET_MIME:
                n = remap_sheet(backend, fid, id_map)["links_changed"]
            elif op["dst_mime"] == XLSX_MIME:
                data = backend.download_bytes(fid)
                new_data, n = remap_xlsx_bytes(data, id_map)
                if n:
                    backend.upload_bytes(fid, new_data, XLSX_MIME)
            else:
                continue
            stats["files"] += 1
            stats["links_changed"] += n
            log("  Đổi {} link trong '{}'".format(n, op["dst_name"]))
        except Exception as exc:  # noqa: BLE001
            stats["errors"].append({"file": op["dst_name"], "error": str(exc)})
            log("  LỖI đổi link " + op["dst_name"] + ": " + str(exc), "error")
    return stats


# ==========================================================================
# 6. TAB MỤC LỤC TỰ ĐỘNG
# ==========================================================================
INDEX_TITLE = "_INDEX_AUTO"


def build_index_tab(backend, plan, result, log=None):
    """Thêm tab _INDEX_AUTO liệt kê toàn bộ cây mới kèm link — lưới an toàn để
    luôn có 'link tổng hợp' kể cả khi đổi link trong master thất bại."""
    log = log or _noop
    if result.get("dry_run"):
        return {"skipped": "chạy thử"}
    placed = result["done"] + result["existing"]
    targets = [o for o in placed if o.get("master") and o["kind"] == "copy" and o["dst_mime"] == SHEET_MIME]
    if not targets:
        return {"skipped": "không có master là Google Sheet"}

    sheet_id = targets[0]["dst_id"]
    meta = backend.sheets_meta(sheet_id)
    existing = {s["properties"]["title"]: s["properties"]["sheetId"] for s in meta.get("sheets", [])}
    tab_id = existing.get(INDEX_TITLE)
    if tab_id is None:
        tab_id = max(existing.values(), default=0) + 1000
        backend.sheets_batch_update(sheet_id, [{"addSheet": {"properties": {
            "sheetId": tab_id, "title": INDEX_TITLE}}}])

    rows = [_row(["THƯ MỤC", "TÊN MỤC", "LOẠI", "LINK"])]
    for op in sorted(placed, key=lambda o: (o["depth"], o["dst_path"])):
        if op["kind"] == "folder":
            continue
        rows.append(_row([show_path(op["parent_parts"]), op["dst_name"], _kind_label(op)],
                         link=(op["dst_name"], view_url(op["dst_id"], op["dst_mime"]))))
    backend.sheets_batch_update(sheet_id, [{"updateCells": {
        "start": {"sheetId": tab_id, "rowIndex": 0, "columnIndex": 0},
        "rows": rows, "fields": "userEnteredValue,textFormatRuns"}}])
    log("Tạo tab {} trong '{}' — {} dòng".format(INDEX_TITLE, targets[0]["dst_name"], len(rows) - 1))
    return {"sheet": targets[0]["dst_name"], "tab": INDEX_TITLE, "rows": len(rows) - 1}


def _row(texts, link=None):
    """Dùng link rich-text thay cho công thức HYPERLINK: dấu phân cách đối số
    của công thức phụ thuộc locale của bảng tính, còn link thì không."""
    values = [{"userEnteredValue": {"stringValue": t}} for t in texts]
    if link:
        label, url = link
        values.append({"userEnteredValue": {"stringValue": label},
                       "textFormatRuns": [{"startIndex": 0, "format": {"link": {"uri": url}}}]})
    return {"values": values}


def _kind_label(op):
    return {"skeleton": "vỏ rỗng", "copy": "bản đầy đủ", "shortcut": "shortcut"}.get(op["kind"], op["kind"])


# ==========================================================================
# 7. HẬU KIỂM
# ==========================================================================
def verify(backend, manifest, plan, result, log=None):
    log = log or _noop
    if result.get("dry_run"):
        return _report(plan, result, [_chk("C0", "Chạy thử", "SKIP",
                                           "Chạy thử — chưa tạo gì trên Drive nên không hậu kiểm.")])
    if result.get("stopped"):
        return _report(plan, result, [_chk(
            "C0", "Đã dừng giữa chừng", "SKIP",
            "Bấm 'Clone thật' lần nữa với cùng thiết lập để chạy tiếp — mục đã có ở đích sẽ được bỏ qua, "
            "không tạo trùng.")])

    log("Quét lại thư mục ĐÍCH để đối chiếu độc lập…")
    dest = scan(backend, result["root_id"])
    dest_by_parts = {tuple(i["parts"]): i for i in dest["items"]}
    expected = [o for o in plan["ops"] if o["kind"] != "skip"]
    created = {o["src_id"] for o in result["done"]}
    foreign = set(result.get("foreign") or [])
    src_bytes = {i["id"]: i["bytes"] for i in manifest["items"]}
    checks = []

    # C1 — cây thư mục
    exp_folders = [o for o in expected if o["kind"] == "folder"]
    missing = [o["dst_path"] for o in exp_folders if tuple(o["dst_parts"]) not in dest_by_parts]
    checks.append(_chk("C1", "Cây thư mục dựng đủ", "PASS" if not missing else "FAIL",
                       "{}/{} thư mục có mặt ở đích.".format(len(exp_folders) - len(missing), len(exp_folders)),
                       [{"Thiếu": m} for m in missing[:50]]))

    # C2 — file đúng tên + đúng loại
    exp_files = [o for o in expected if o["kind"] != "folder"]
    bad = []
    for o in exp_files:
        got = dest_by_parts.get(tuple(o["dst_parts"]))
        if not got:
            bad.append({"Mục": o["dst_path"], "Lỗi": "không tìm thấy"})
        elif o["src_id"] not in foreign and o["kind"] != "shortcut" and got["mime"] != o["dst_mime"]:
            bad.append({"Mục": o["dst_path"], "Lỗi": "sai kiểu: chờ {} nhận {}".format(o["dst_mime"], got["mime"])})
    detail = "{}/{} file khớp tên và loại.".format(len(exp_files) - len(bad), len(exp_files))
    if foreign:
        detail += " ({} file trùng tên đã có sẵn ở đích được giữ nguyên.)".format(len(foreign))
    checks.append(_chk("C2", "File đúng tên và đúng loại", "PASS" if not bad else "FAIL", detail, bad[:50]))

    # C3 — vỏ rỗng KHÔNG lọt nội dung (Google Doc rỗng vẫn tốn dung lượng → đọc nội dung thật)
    skeletons = [o for o in expected if o["kind"] == "skeleton" and o["src_id"] in created]
    leaked, unchecked = [], 0
    for o in skeletons:
        got = dest_by_parts.get(tuple(o["dst_parts"]))
        if not got:
            continue
        mime = got["mime"]
        if mime == SHEET_MIME:
            try:
                if _sheet_cell_count(backend.sheets_get(got["id"])) > 0:
                    leaked.append({"Mục": o["dst_path"], "Lỗi": "Sheet có dữ liệu"})
            except Exception:  # noqa: BLE001
                unchecked += 1
        elif mime in (DOC_MIME, SLIDE_MIME):
            text = backend.export_text(got["id"])
            if text is None:
                unchecked += 1
            elif text.strip():
                leaked.append({"Mục": o["dst_path"], "Lỗi": "còn {} ký tự nội dung".format(len(text.strip()))})
        elif mime.startswith(GOOGLE_PREFIX):
            unchecked += 1
        elif got["bytes"] > 0:
            leaked.append({"Mục": o["dst_path"], "Lỗi": "{} byte (phải = 0)".format(got["bytes"])})
    if skeletons:
        detail = "{}/{} file vỏ rỗng đúng nghĩa.".format(len(skeletons) - len(leaked), len(skeletons))
        if unchecked:
            detail += " ({} file kiểu đặc biệt không đọc được nội dung để kiểm.)".format(unchecked)
        checks.append(_chk("C3", "File vỏ KHÔNG chứa nội dung", "PASS" if not leaked else "FAIL",
                           detail, leaked[:50]))
    else:
        checks.append(_chk("C3", "File vỏ KHÔNG chứa nội dung", "SKIP", "Lượt này không tạo file vỏ nào."))

    # C4 — bản đầy đủ copy trọn nội dung
    copies = [o for o in expected if o["kind"] == "copy" and o["src_id"] in created]
    short = []
    for o in copies:
        got = dest_by_parts.get(tuple(o["dst_parts"]))
        if not got:
            continue
        if got["mime"] == SHEET_MIME and o.get("remap"):
            try:
                if _sheet_cell_count(backend.sheets_get(got["id"])) == 0:
                    short.append({"Mục": o["dst_path"], "Lỗi": "Sheet bản sao bị rỗng"})
            except Exception:  # noqa: BLE001
                pass
        elif not got["mime"].startswith(GOOGLE_PREFIX):
            want = src_bytes.get(o["src_id"], 0)
            if want and got["bytes"] != want and not o.get("remap"):
                short.append({"Mục": o["dst_path"],
                              "Lỗi": "dung lượng lệch: nguồn {} byte, bản sao {} byte".format(want, got["bytes"])})
            elif want and got["bytes"] == 0:
                short.append({"Mục": o["dst_path"], "Lỗi": "bản sao 0 byte"})
    if copies:
        checks.append(_chk("C4", "Bản đầy đủ copy trọn nội dung", "PASS" if not short else "FAIL",
                           "{}/{} file copy đủ nội dung.".format(len(copies) - len(short), len(copies)),
                           short[:50]))
    elif plan["options"]["content_mode"] == "skeleton" and not result["existing"]:
        checks.append(_chk("C4", "Bản đầy đủ copy trọn nội dung", "WARN",
                           "Không có file nào được chọn copy đầy đủ (master sheet)."))
    else:
        checks.append(_chk("C4", "Bản đầy đủ copy trọn nội dung", "SKIP", "Lượt này không copy file mới."))

    # C5 + C6 — link trong file đã đổi link
    targets = remap_targets(result)
    id_map = result["id_map"]
    old_ids, new_ids = set(id_map.keys()), set(id_map.values())
    dest_ids = {i["id"] for i in dest["items"]} | {result["root_id"]}
    stale, broken, ok_links, external = [], [], 0, 0
    for o in targets:
        got = dest_by_parts.get(tuple(o["dst_parts"]))
        if not got:
            continue
        for url in _links_of(backend, got["id"], got["mime"]):
            for fid in find_ids(url):
                if fid in new_ids and fid not in old_ids:
                    ok_links += 1
                    if fid not in dest_ids:
                        broken.append({"File": o["dst_name"], "Link": url[:200], "Lỗi": "trỏ ra ngoài cây mới"})
                elif fid in old_ids and fid not in new_ids:
                    stale.append({"File": o["dst_name"], "Link": url[:200], "Lỗi": "vẫn trỏ về bản GỐC"})
                else:
                    external += 1
    if targets:
        checks.append(_chk("C5", "Link đã trỏ sang cây MỚI", "PASS" if not stale else "FAIL",
                           "{} file đã đổi link: {} link trỏ đúng cây mới, {} link còn trỏ bản gốc, "
                           "{} link ngoài.".format(len(targets), ok_links, len(stale), external), stale[:50]))
        checks.append(_chk("C6", "Không có link gãy", "PASS" if not broken else "FAIL",
                           "Mọi đích đến của link đều tồn tại trong cây mới." if not broken
                           else "{} link trỏ tới mục không tồn tại.".format(len(broken)), broken[:50]))
    else:
        why = ("Đang tắt đổi link." if plan["options"]["remap_links"] == "off"
               else "Không có Sheet/xlsx nào cần đổi link.")
        checks.append(_chk("C5", "Link đã trỏ sang cây MỚI", "SKIP", why))
        checks.append(_chk("C6", "Không có link gãy", "SKIP", why))

    # C7 — mục lạ ở đích (không tính Change Log của các lần chạy)
    exp_parts = {tuple(o["dst_parts"]) for o in expected}
    extra = [i["path"] for i in dest["items"]
             if tuple(i["parts"]) not in exp_parts and not i["name"].startswith(LOG_PREFIX)
             and not any(tuple(i["parts"][:k]) not in exp_parts and k < len(i["parts"])
                         for k in range(1, len(i["parts"])))]
    checks.append(_chk("C7", "Không có mục lạ ở đích", "PASS" if not extra else "WARN",
                       "Đích khớp đúng kế hoạch." if not extra
                       else "{} mục ở đích không thuộc kế hoạch (thường là thứ có sẵn trong B).".format(len(extra)),
                       [{"Mục lạ": e} for e in extra[:50]]))

    # C8 — lỗi lúc tạo
    checks.append(_chk("C8", "Không có thao tác lỗi", "PASS" if not result["failed"] else "FAIL",
                       "Tất cả thao tác thành công." if not result["failed"]
                       else "{} thao tác thất bại.".format(len(result["failed"])),
                       [{"Mục": f["dst_path"], "Lỗi": f.get("error", "")} for f in result["failed"][:50]]))

    # C9 — đổi tên: quét lại tên THẬT ở đích, không tin tên tool đã tính
    rules = [r for r in plan["options"]["rename_rules"] if not r.get("regex")]
    checkable = [r for r in rules if (r["from"].lower() not in (r.get("to") or "").lower()
                                      if r.get("ignore_case") else r["from"] not in (r.get("to") or ""))]
    if checkable:
        ours = set(id_map.keys())
        names = [(i["path"], i["name"]) for i in dest["items"] if (i.get("props") or {}).get(PROP_SRC) in ours]
        if plan["wrap_root"]:
            names.append((plan["new_root_name"], plan["new_root_name"]))
        left = []
        for path, name in names:
            for r in checkable:
                hit = r["from"].lower() in name.lower() if r.get("ignore_case") else r["from"] in name
                if hit:
                    left.append({"Mục": path, "Còn chứa": r["from"]})
        checks.append(_chk("C9", "Không còn tên chứa chuỗi cần đổi", "PASS" if not left else "FAIL",
                           "Đã soát {} tên do tool tạo ở đích theo {} quy tắc.".format(len(names), len(checkable))
                           if not left else "{} tên vẫn còn chuỗi cũ.".format(len(left)), left[:50]))
    else:
        checks.append(_chk("C9", "Không còn tên chứa chuỗi cần đổi", "SKIP",
                           "Không có quy tắc đổi tên dạng chuỗi để soát."))

    return _report(plan, result, checks, dest)


def _sheet_cell_count(doc):
    n = 0
    for sheet in doc.get("sheets", []):
        for grid in sheet.get("data", []):
            for row in grid.get("rowData", []) or []:
                for cell in row.get("values", []) or []:
                    if cell.get("userEnteredValue"):
                        n += 1
    return n


def _links_of(backend, file_id, mime):
    urls = []
    if mime == SHEET_MIME:
        doc = backend.sheets_get(file_id)
        for sheet in doc.get("sheets", []):
            if sheet["properties"].get("title") == INDEX_TITLE:
                continue
            for grid in sheet.get("data", []):
                for row in grid.get("rowData", []) or []:
                    for cell in row.get("values", []) or []:
                        uev = cell.get("userEnteredValue") or {}
                        if uev.get("formulaValue"):
                            urls.append(uev["formulaValue"])
                        if cell.get("hyperlink"):
                            urls.append(cell["hyperlink"])
                        fmt = (cell.get("userEnteredFormat") or {}).get("textFormat") or {}
                        if (fmt.get("link") or {}).get("uri"):
                            urls.append(fmt["link"]["uri"])
                        for run in cell.get("textFormatRuns") or []:
                            uri = (run.get("format", {}).get("link") or {}).get("uri")
                            if uri:
                                urls.append(uri)
    elif mime == XLSX_MIME:
        data = backend.download_bytes(file_id)
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                for info in zf.infolist():
                    if info.filename.endswith((".xml", ".rels")):
                        try:
                            urls.append(zf.read(info.filename).decode("utf-8"))
                        except UnicodeDecodeError:
                            pass
        except zipfile.BadZipFile:
            pass
    return urls


def _chk(cid, name, status, detail, rows=None):
    return {"id": cid, "name": name, "status": status, "detail": detail, "rows": rows or []}


def _report(plan, result, checks, dest=None):
    summary = {"PASS": 0, "FAIL": 0, "WARN": 0, "SKIP": 0}
    for c in checks:
        summary[c["status"]] = summary.get(c["status"], 0) + 1
    return {
        "ran_at": now_iso(),
        "source": plan["source"],
        "dest": {"id": result["root_id"], "name": result.get("root_name", ""), "url": result.get("root_url", "")},
        "plan_stats": plan["stats"],
        "dest_stats": dest["stats"] if dest else {},
        "checks": checks,
        "summary": summary,
        "ok": summary["FAIL"] == 0,
    }


# ==========================================================================
# 8. REPORT HTML (bản lưu kèm mỗi lần chạy)
# ==========================================================================
def report_html(report, counts=None):
    esc = html.escape
    rows = []
    for c in report["checks"]:
        sub = ""
        if c["rows"]:
            keys = list(c["rows"][0].keys())
            sub = ('<table class="sub"><tr>' + "".join("<th>{}</th>".format(esc(k)) for k in keys) + "</tr>"
                   + "".join("<tr>" + "".join("<td>{}</td>".format(esc(str(r.get(k, "")))) for k in keys)
                             + "</tr>" for r in c["rows"]) + "</table>")
        rows.append('<tr><td class="id">{}</td><td>{}</td><td class="st {}">{}</td><td>{}{}</td></tr>'.format(
            esc(c["id"]), esc(c["name"]), c["status"].lower(), esc(c["status"]), esc(c["detail"]), sub))
    s = report["summary"]
    tally = ""
    if counts:
        tally = "<p class='meta'>" + " · ".join("{} <b>{}</b>".format(esc(k), v) for k, v in counts.items()) + "</p>"
    return """<!doctype html><meta charset="utf-8"><title>Hậu kiểm Drive Clone</title>
<style>
body{{font:14px/1.5 "Segoe UI",system-ui,sans-serif;margin:24px;color:#0a0a0a;background:#f9f8f6}}
h1{{font-size:20px;margin:0 0 4px}} .meta{{color:#555;font-size:13px}}
.verdict{{display:inline-block;padding:8px 14px;border-radius:8px;font-weight:700;margin:10px 0 16px}}
.ok{{background:#d8efe9;color:#14532d}} .bad{{background:#f6d5d5;color:#7f1d1d}}
table{{border-collapse:collapse;width:100%;background:#fff}}
th,td{{border:1px solid #e3e3e3;padding:8px 10px;text-align:left;vertical-align:top}}
th{{background:#f0efed}} td.id{{font-weight:700;width:48px}} td.st{{width:70px;font-weight:700}}
.st.pass{{color:#2f7d74}} .st.fail{{color:#b84040}} .st.warn{{color:#8a6a1a}} .st.skip{{color:#777}}
table.sub{{margin-top:8px;font-size:12.5px}} a{{color:#2f7d74}}
</style>
<h1>Hậu kiểm Drive Clone</h1>
<div class="meta">Chạy lúc {ran}<br>Nguồn: <b>{src}</b><br>Đích: <b>{dst}</b> · <a href="{url}">mở trên Drive</a></div>
{tally}
<div class="verdict {vcls}">{verdict} | PASS {p} · FAIL {f} · WARN {w} · SKIP {k}</div>
<table><tr><th>#</th><th>Hạng mục</th><th>KQ</th><th>Chi tiết</th></tr>{rows}</table>""".format(
        ran=esc(report["ran_at"]), src=esc(report["source"]["name"]), dst=esc(report["dest"]["name"]),
        url=esc(report["dest"].get("url") or "#"), tally=tally,
        vcls="ok" if report["ok"] else "bad", verdict="TOÀN BỘ ĐẠT" if report["ok"] else "CÓ MỤC KHÔNG ĐẠT",
        p=s.get("PASS", 0), f=s.get("FAIL", 0), w=s.get("WARN", 0), k=s.get("SKIP", 0), rows="".join(rows))

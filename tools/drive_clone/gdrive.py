"""Lớp backend Drive.

RealDrive  -> gọi Google Drive/Sheets API thật.
FakeDrive  -> Drive giả lập trong RAM, dùng cho chế độ demo và selftest offline.

Cả hai trả về CÙNG một hình dạng dữ liệu (dùng schema của Sheets API) để code
scan/clone/remap/verify chỉ có MỘT đường chạy duy nhất.

Mọi thứ tool tạo ra đều mang appProperties {"gdk_src": <id nguồn>}: lần chạy sau
nhận ra đâu là bản do tool tạo (được phép đổi link lại) và đâu là file có sẵn của
người dùng (không bao giờ đụng vào).
"""
from __future__ import annotations

import copy
import io
import json
import random
import re
import string
import threading
import time

FOLDER_MIME = "application/vnd.google-apps.folder"
SHORTCUT_MIME = "application/vnd.google-apps.shortcut"
SHEET_MIME = "application/vnd.google-apps.spreadsheet"
DOC_MIME = "application/vnd.google-apps.document"
SLIDE_MIME = "application/vnd.google-apps.presentation"
DRAW_MIME = "application/vnd.google-apps.drawing"
FORM_MIME = "application/vnd.google-apps.form"
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

# Google native tạo rỗng được bằng files.create
NATIVE_CREATABLE = {DOC_MIME, SHEET_MIME, SLIDE_MIME, DRAW_MIME}
GOOGLE_PREFIX = "application/vnd.google-apps."

PROP_SRC = "gdk_src"

_ID_IN_URL = re.compile(r"(?:/folders/|/d/|[?&]id=)([A-Za-z0-9_-]{10,})")


MY_DRIVE = "root"           # thư mục gốc My Drive của người dùng (bí danh của Drive API)


def parse_id(text):
    """Nhận URL Drive hoặc ID trần, trả về ID."""
    text = (text or "").strip()
    if not text:
        return ""
    m = _ID_IN_URL.search(text)
    if m:
        return m.group(1)
    return text.split("?")[0].strip("/")


def view_url(file_id, mime):
    if mime == FOLDER_MIME:
        return "https://drive.google.com/drive/folders/" + file_id
    if mime == SHEET_MIME:
        return "https://docs.google.com/spreadsheets/d/" + file_id + "/edit"
    if mime == DOC_MIME:
        return "https://docs.google.com/document/d/" + file_id + "/edit"
    if mime == SLIDE_MIME:
        return "https://docs.google.com/presentation/d/" + file_id + "/edit"
    return "https://drive.google.com/file/d/" + file_id + "/view"


class DriveError(RuntimeError):
    pass


# --------------------------------------------------------------------------
# Real backend
# --------------------------------------------------------------------------
class RealDrive:
    kind = "real"

    _SHARED = dict(supportsAllDrives=True)
    _SHARED_LIST = dict(supportsAllDrives=True, includeItemsFromAllDrives=True)
    _ITEM_FIELDS = ("id,name,mimeType,size,quotaBytesUsed,shortcutDetails,"
                    "webViewLink,appProperties")

    def __init__(self, creds, http=None):
        # http= chỉ dùng cho selftest (HttpMockSequence), chạy thật thì dùng creds
        self._auth = {"http": http} if http is not None else {"credentials": creds}
        self._local = threading.local()
        self.drive  # noqa: B018 — dựng sẵn service của luồng chính để báo lỗi sớm

    def _svc(self, name, version):
        """httplib2 KHÔNG an toàn khi nhiều luồng dùng chung → mỗi luồng 1 service riêng."""
        cache = self._local.__dict__.setdefault("svc", {})
        if name not in cache:
            from googleapiclient.discovery import build

            cache[name] = build(name, version, cache_discovery=False, static_discovery=True, **self._auth)
        return cache[name]

    @property
    def drive(self):
        return self._svc("drive", "v3")

    @property
    def sheets(self):
        return self._svc("sheets", "v4")

    # -- hạ tầng -----------------------------------------------------------
    @staticmethod
    def _retryable(exc):
        status = getattr(exc.resp, "status", 0)
        if status in (429, 500, 502, 503, 504):
            return True
        # 403 chỉ thử lại khi là giới hạn tốc độ; 403 do thiếu quyền / cấm copy thì
        # thử lại cũng vô ích, chỉ tốn thời gian.
        body = (getattr(exc, "content", b"") or b"").decode("utf-8", "replace")
        return status == 403 and "ateLimitExceeded" in body

    @classmethod
    def _exec(cls, request, tries=6):
        from googleapiclient.errors import HttpError

        delay = 1.0
        for attempt in range(tries):
            try:
                return request.execute()
            except HttpError as exc:
                if cls._retryable(exc) and attempt < tries - 1:
                    time.sleep(delay + random.random())
                    delay *= 2
                    continue
                raise DriveError(_http_message(exc)) from exc
        raise DriveError("hết lượt thử lại")

    # -- đọc ---------------------------------------------------------------
    def whoami(self):
        info = self._exec(self.drive.about().get(fields="user(emailAddress,displayName)"))
        return info.get("user", {})

    def get_file(self, file_id):
        return self._exec(self.drive.files().get(
            fileId=file_id, fields=self._ITEM_FIELDS + ",parents,trashed", **self._SHARED))

    def list_children(self, folder_id):
        out, token = [], None
        while True:
            resp = self._exec(self.drive.files().list(
                q="'" + folder_id + "' in parents and trashed = false",
                fields="nextPageToken, files(" + self._ITEM_FIELDS + ")",
                pageSize=1000, orderBy="folder,name", pageToken=token,
                **self._SHARED_LIST))
            out.extend(resp.get("files", []))
            token = resp.get("nextPageToken")
            if not token:
                return out

    # -- ghi ---------------------------------------------------------------
    def _create(self, body, props):
        if props:
            body["appProperties"] = props
        return self._exec(self.drive.files().create(body=body, fields="id", **self._SHARED))["id"]

    def create_folder(self, name, parent_id, props=None):
        return self._create({"name": name, "mimeType": FOLDER_MIME, "parents": [parent_id]}, props)

    def create_empty(self, name, mime, parent_id, props=None):
        return self._create({"name": name, "mimeType": mime, "parents": [parent_id]}, props)

    def create_shortcut(self, name, target_id, parent_id, props=None):
        return self._create({"name": name, "mimeType": SHORTCUT_MIME, "parents": [parent_id],
                             "shortcutDetails": {"targetId": target_id}}, props)

    def copy_file(self, file_id, name, parent_id, props=None):
        body = {"name": name, "parents": [parent_id]}
        if props:
            body["appProperties"] = props
        return self._exec(self.drive.files().copy(
            fileId=file_id, body=body, fields="id", **self._SHARED))["id"]

    # -- nội dung nhị phân (xlsx) -----------------------------------------
    def download_bytes(self, file_id):
        from googleapiclient.http import MediaIoBaseDownload

        buf = io.BytesIO()
        req = self.drive.files().get_media(fileId=file_id, supportsAllDrives=True)
        downloader = MediaIoBaseDownload(buf, req)
        done = False
        while not done:
            _, done = downloader.next_chunk()
        return buf.getvalue()

    def upload_bytes(self, file_id, data, mime):
        from googleapiclient.http import MediaIoBaseUpload

        media = MediaIoBaseUpload(io.BytesIO(data), mimetype=mime, resumable=False)
        self._exec(self.drive.files().update(
            fileId=file_id, media_body=media, fields="id", **self._SHARED))

    def export_text(self, file_id):
        """Xuất nội dung dạng chữ. Trả về None nếu kiểu file không xuất được."""
        try:
            data = self._exec(self.drive.files().export_media(fileId=file_id,
                                                              mimeType="text/plain"))
            return data.decode("utf-8", "replace") if isinstance(data, bytes) else str(data)
        except Exception:  # noqa: BLE001
            return None

    # -- Sheets ------------------------------------------------------------
    def sheets_get(self, spreadsheet_id):
        fields = (
            "spreadsheetId,properties.title,"
            "sheets(properties(sheetId,title,index),"
            "data(startRow,startColumn,rowData(values("
            "userEnteredValue,formattedValue,hyperlink,textFormatRuns,"
            "userEnteredFormat.textFormat.link))))"
        )
        return self._exec(self.sheets.spreadsheets().get(
            spreadsheetId=spreadsheet_id, includeGridData=True, fields=fields))

    def sheets_meta(self, spreadsheet_id):
        """Chỉ lấy danh sách tab — nhẹ, không kéo dữ liệu ô về."""
        return self._exec(self.sheets.spreadsheets().get(
            spreadsheetId=spreadsheet_id, fields="sheets.properties(sheetId,title,index)"))

    def sheets_batch_update(self, spreadsheet_id, requests):
        for i in range(0, len(requests or []), 200):
            self._exec(self.sheets.spreadsheets().batchUpdate(
                spreadsheetId=spreadsheet_id, body={"requests": requests[i:i + 200]}))


def _http_message(exc):
    try:
        data = json.loads(exc.content.decode("utf-8"))
        msg = data.get("error", {}).get("message")
        reason = " ".join(str(e.get("reason", "")) for e in data.get("error", {}).get("errors", []) or [])
        if exc.resp.status in (403, 404) and ("insufficient" in (msg or "").lower() or "insufficientFilePermissions" in reason
                                              or "appNotAuthorizedToFile" in reason):
            return ("HTTP {} — Tool chỉ được ghi vào thư mục DO TOOL TẠO (quyền tối thiểu). Để trống ô thư mục B để tool "
                    "tạo thư mục mới trong My Drive, hoặc dán link thư mục kết quả của một lần clone trước.").format(exc.resp.status)
        if msg:
            return "HTTP {} — {}".format(exc.resp.status, msg)
    except Exception:  # noqa: BLE001
        pass
    return str(exc)


# --------------------------------------------------------------------------
# Fake backend (demo / tự kiểm offline)
# --------------------------------------------------------------------------
class FakeDrive:
    kind = "demo"

    def __init__(self, seed=7, latency=0.0):
        self._rng = random.Random(seed)
        self.nodes = {}
        self.root_id = ""
        self.calls = []
        self.fail_ids = set()        # id nguồn mà copy_file sẽ báo lỗi (giả lập file cấm copy)
        self.latency = latency       # giây / lệnh API — mô phỏng độ trễ mạng khi đo chạy song song
        self.lock = threading.RLock()
        for name in ("get_file", "list_children", "create_folder", "create_empty", "create_shortcut",
                     "copy_file", "download_bytes", "upload_bytes", "export_text", "sheets_get",
                     "sheets_meta", "sheets_batch_update"):
            setattr(self, name, self._locked(getattr(self, name)))

    def _locked(self, fn):
        def wrapper(*args, **kwargs):
            if self.latency:
                time.sleep(self.latency)          # “chờ mạng” ngoài khoá → các luồng chờ song song
            with self.lock:
                return fn(*args, **kwargs)
        wrapper.__name__ = fn.__name__
        return wrapper

    def _new_id(self):
        alphabet = string.ascii_letters + string.digits
        return "FK" + "".join(self._rng.choice(alphabet) for _ in range(26))

    def _add(self, name, mime, parent, **extra):
        nid = self._new_id()
        node = {"id": nid, "name": name, "mimeType": mime,
                "parents": [parent] if parent else [], "quotaBytesUsed": "0",
                "trashed": False}
        node.update(extra)
        self.nodes[nid] = node
        return nid

    def _public(self, node):
        item = {k: node[k] for k in ("id", "name", "mimeType", "quotaBytesUsed") if k in node}
        for k in ("shortcutDetails", "appProperties"):
            if k in node:
                item[k] = copy.deepcopy(node[k])
        if not node["mimeType"].startswith(GOOGLE_PREFIX):
            item["size"] = node.get("quotaBytesUsed", "0")
        item["webViewLink"] = view_url(node["id"], node["mimeType"])
        return item

    def whoami(self):
        return {"emailAddress": "demo@local", "displayName": "Chế độ DEMO (offline)"}

    def get_file(self, file_id):
        if file_id == MY_DRIVE and MY_DRIVE not in self.nodes:      # My Drive giả lập (tạo khi cần)
            self.nodes[MY_DRIVE] = {"id": MY_DRIVE, "name": "My Drive", "mimeType": FOLDER_MIME, "parents": [],
                                    "quotaBytesUsed": "0", "trashed": False}
        node = self.nodes.get(file_id)
        if not node or node.get("trashed"):
            raise DriveError("không tìm thấy file " + file_id)
        out = self._public(node)
        out["parents"] = list(node["parents"])
        return out

    def list_children(self, folder_id):
        kids = [n for n in self.nodes.values()
                if folder_id in n.get("parents", []) and not n.get("trashed")]
        kids.sort(key=lambda n: (n["mimeType"] != FOLDER_MIME, n["name"]))
        return [self._public(n) for n in kids]

    # -- ghi ---------------------------------------------------------------
    def _props(self, nid, props):
        if props:
            self.nodes[nid]["appProperties"] = dict(props)
        return nid

    def create_folder(self, name, parent_id, props=None):
        self.calls.append("create_folder")
        return self._props(self._add(name, FOLDER_MIME, parent_id), props)

    def create_empty(self, name, mime, parent_id, props=None):
        self.calls.append("create_empty")
        if mime.startswith(GOOGLE_PREFIX) and mime not in NATIVE_CREATABLE:
            raise DriveError("không tạo rỗng được kiểu " + mime)
        extra = {"sheet": _blank_sheet(name)} if mime == SHEET_MIME else {"blob": b""}
        nid = self._add(name, mime, parent_id, **extra)
        if mime == SHEET_MIME:
            self.nodes[nid]["sheet"]["spreadsheetId"] = nid
        return self._props(nid, props)

    def create_shortcut(self, name, target_id, parent_id, props=None):
        self.calls.append("create_shortcut")
        return self._props(self._add(name, SHORTCUT_MIME, parent_id,
                                     shortcutDetails={"targetId": target_id}), props)

    def copy_file(self, file_id, name, parent_id, props=None):
        self.calls.append("copy_file")
        if file_id in self.fail_ids:
            raise DriveError("HTTP 403 — The user does not have permission to copy this file.")
        src = self.nodes[file_id]
        extra = {}
        if "sheet" in src:
            extra["sheet"] = copy.deepcopy(src["sheet"])
        if "blob" in src:
            extra["blob"] = src["blob"]
        nid = self._add(name, src["mimeType"], parent_id, **extra)
        self.nodes[nid]["quotaBytesUsed"] = src.get("quotaBytesUsed", "0")
        if "sheet" in extra:
            self.nodes[nid]["sheet"]["spreadsheetId"] = nid
        return self._props(nid, props)

    def download_bytes(self, file_id):
        return self.nodes[file_id].get("blob", b"")

    def upload_bytes(self, file_id, data, mime):
        self.nodes[file_id]["blob"] = data
        self.nodes[file_id]["quotaBytesUsed"] = str(len(data))

    def export_text(self, file_id):
        node = self.nodes.get(file_id) or {}
        if node.get("mimeType") not in (DOC_MIME, SLIDE_MIME):
            return None
        return (node.get("blob") or b"").decode("utf-8", "replace")

    # -- Sheets (cùng schema với Sheets API) -------------------------------
    def sheets_get(self, spreadsheet_id):
        node = self.nodes.get(spreadsheet_id)
        if not node or "sheet" not in node:
            raise DriveError(spreadsheet_id + " không phải Google Sheet")
        return copy.deepcopy(node["sheet"])

    def sheets_meta(self, spreadsheet_id):
        doc = self.sheets_get(spreadsheet_id)
        return {"sheets": [{"properties": s["properties"]} for s in doc["sheets"]]}

    def sheets_batch_update(self, spreadsheet_id, requests):
        doc = self.nodes[spreadsheet_id]["sheet"]
        for req in requests:
            if "addSheet" in req:
                props = req["addSheet"]["properties"]
                doc["sheets"].append({
                    "properties": {"sheetId": props.get("sheetId", len(doc["sheets"])),
                                   "title": props.get("title", "Sheet"),
                                   "index": len(doc["sheets"])},
                    "data": [{"startRow": 0, "startColumn": 0, "rowData": []}],
                })
            elif "updateSheetProperties" in req:
                props = req["updateSheetProperties"]["properties"]
                for s in doc["sheets"]:
                    if s["properties"]["sheetId"] == props.get("sheetId") and "title" in props:
                        s["properties"]["title"] = props["title"]
            elif "updateCells" in req:
                self._apply_update_cells(doc, req["updateCells"])
            # các request định dạng (repeatCell, conditional format…) không ảnh hưởng dữ liệu
        self.nodes[spreadsheet_id]["quotaBytesUsed"] = str(
            max(1, len(json.dumps(doc, default=str))))

    @staticmethod
    def _refresh_hyperlink(cell):
        """Sheets thật tự tính lại trường 'hyperlink' (chỉ đọc) sau mỗi lần ghi.
        Giả lập lại để hậu kiểm đọc được đúng như trên Drive thật."""
        uri = None
        for run in cell.get("textFormatRuns") or []:
            link = (run.get("format") or {}).get("link") or {}
            if link.get("uri"):
                uri = link["uri"]
                break
        if not uri:
            fmt = (cell.get("userEnteredFormat") or {}).get("textFormat") or {}
            uri = (fmt.get("link") or {}).get("uri")
        if not uri:
            formula = (cell.get("userEnteredValue") or {}).get("formulaValue") or ""
            m = re.search(r'HYPERLINK\(\s*"([^"]+)"', formula, re.I)
            if m:
                uri = m.group(1)
        if uri:
            cell["hyperlink"] = uri
        else:
            cell.pop("hyperlink", None)

    @staticmethod
    def _apply_update_cells(doc, req):
        start = req["start"]
        sheet = next((s for s in doc["sheets"]
                      if s["properties"]["sheetId"] == start["sheetId"]), None)
        if sheet is None:
            raise DriveError("sheetId không tồn tại")
        rows = sheet["data"][0].setdefault("rowData", [])
        fields = [f.strip() for f in req.get("fields", "*").split(",")]
        for dr, row in enumerate(req.get("rows", [])):
            r = start.get("rowIndex", 0) + dr
            while len(rows) <= r:
                rows.append({"values": []})
            values = rows[r].setdefault("values", [])
            for dc, cell in enumerate(row.get("values", [])):
                c = start.get("columnIndex", 0) + dc
                while len(values) <= c:
                    values.append({})
                if "*" in fields:
                    values[c] = copy.deepcopy(cell)
                else:
                    for field in fields:
                        head = field.split(".")[0]
                        if head in cell:
                            values[c][head] = copy.deepcopy(cell[head])
                        elif head == "textFormatRuns":
                            values[c].pop("textFormatRuns", None)
                FakeDrive._refresh_hyperlink(values[c])


def _blank_sheet(title):
    return {
        "spreadsheetId": "",
        "properties": {"title": title},
        "sheets": [{
            "properties": {"sheetId": 0, "title": "Sheet1", "index": 0},
            "data": [{"startRow": 0, "startColumn": 0, "rowData": []}],
        }],
    }

"""Du lieu gia lap cho che do DEMO / selftest.

Dung lai bo cuc thu muc "Game Design" va master sheet trong anh chup, ke ca cac
truong hop kho: ten thu muc co dau "/", Google Form (khong tao rong duoc),
shortcut, file nhi phan, thu muc long 3 tang, va 3 kieu link khac nhau trong
Sheet (rich-text run / cong thuc HYPERLINK / link ca o). Co ca ten viet thuong /
viet hoa chu dau (tsm_icon.png, Tsm_Notes) de thu doi ten giu kieu chu.
"""
from __future__ import annotations

from .gdrive import (
    DOC_MIME,
    FOLDER_MIME,
    FORM_MIME,
    SHEET_MIME,
    XLSX_MIME,
    FakeDrive,
    view_url,
)

EXT_MIME = {
    ".xlsx": XLSX_MIME,
    ".gdoc": DOC_MIME,
    ".gsheet": SHEET_MIME,
    ".gform": FORM_MIME,
    ".png": "image/png",
}

TREE = {
    "TSM_ Level Special": ["Level Special Design.xlsx", "Special Level List.xlsx",
                           "mockup.png"],
    "TSM_ Piggy Bank": ["Piggy Bank GDD.xlsx"],
    "TSM_ Hint": ["Hint Logic.xlsx"],
    "TSM_ LeaderBoard": ["LeaderBoard GDD.xlsx", "Reward Table.xlsx"],
    "TSM_ Gift Code": ["Gift Code Spec.xlsx"],
    "TSM_ AB Test": ["AB Test Plan.xlsx", "AB Result Template.xlsx"],
    "TSM_ Segment ROAS/BLD": ["Segment Definition.xlsx"],
    "TSM_ Combo": ["Combo Rule.xlsx"],
    "TSM_ Game Balancing": ["Logic Gameplay.xlsx", "Data Level.xlsx",
                            "Element in Level.xlsx", "Lives.xlsx"],
    "TSM_ Win Streak": ["Win Streak.xlsx"],
    "TSM_ Booster": ["Booster.xlsx", "Helper.xlsx", "Play On.xlsx",
                     "More Lives.xlsx"],
    "TSM_ Compare Foodie Sizzle": ["Compare Note.gdoc"],
    "TSM_ Improvement": ["Improvement Backlog.xlsx", "Feedback Form.gform"],
    "TSM_Remote Config": ["Remote config.xlsx"],
    "TSM_Shipper": ["Shipper.xlsx", "Flow Game.gdoc"],
    "TSM_ Tutorial": ["Tutorial.xlsx", "Ads Position.xlsx"],
    "TSM_ IAP": ["Shop IAP IOS.xlsx", "Shop IAP Andr.xlsx"],
    "TSM_ Misc": ["List AnimVfx.xlsx", "Soundfx & Vibrate.xlsx",
                  "Event tracking.xlsx", "tsm_icon.png", "Tsm_Notes.gdoc"],
}

NESTED = {"TSM_ AB Test": {"Archive": ["AB_2025 raw.xlsx", "AB_2024 raw.xlsx"]}}

# Tai lieu KHONG thuoc cay nguon -> tool phai giu nguyen link nay
FOREIGN_ID = "1aBcDeFgHiJkLmNoPqRsTuVwXyZ012345"
FOREIGN_URL = "https://docs.google.com/document/d/" + FOREIGN_ID + "/edit"

# Bo cuc master sheet dung theo anh chup: nhan -> file duoc tro toi
LAYOUT = [
    ("Game Play", [
        ("Logic Gameplay", "TSM_ Game Balancing/Logic Gameplay.xlsx"),
        ("Tutorial", "TSM_ Tutorial/Tutorial.xlsx"),
        ("Ads Position", "TSM_ Tutorial/Ads Position.xlsx"),
        ("Flow Game", "TSM_Shipper/Flow Game.gdoc"),
    ]),
    ("CORE MECHANICS", [
        ("Data Level", "TSM_ Game Balancing/Data Level.xlsx"),
        ("Element in Level", "TSM_ Game Balancing/Element in Level.xlsx"),
        ("Lives", "TSM_ Game Balancing/Lives.xlsx"),
        ("Booster", "TSM_ Booster/Booster.xlsx"),
    ]),
    ("SUB MECHANICS", [
        ("Helper", "TSM_ Booster/Helper.xlsx"),
        ("Play On", "TSM_ Booster/Play On.xlsx"),
        ("More Lives", "TSM_ Booster/More Lives.xlsx"),
        ("Shipper", "TSM_Shipper/Shipper.xlsx"),
        ("Win Streak", "TSM_ Win Streak/Win Streak.xlsx"),
    ]),
    ("IAP", [
        ("Shop IAP IOS", "TSM_ IAP/Shop IAP IOS.xlsx"),
        ("Shop IAP Andr", "TSM_ IAP/Shop IAP Andr.xlsx"),
    ]),
    ("MISCELLANEOUS", [
        ("List AnimVfx", "TSM_ Misc/List AnimVfx.xlsx"),
        ("Soundfx & Vibrate", "TSM_ Misc/Soundfx & Vibrate.xlsx"),
        ("Event tracking", "TSM_ Misc/Event tracking.xlsx"),
        ("Remote config", "TSM_Remote Config/Remote config.xlsx"),
    ]),
]


def _mime_and_name(fname):
    for ext, mime in EXT_MIME.items():
        if fname.endswith(ext):
            base = fname[: -len(ext)]
            # Google native khong mang duoi mo rong trong ten thuc te
            return (base if mime.startswith("application/vnd.google-apps") else fname), mime
    return fname, "application/octet-stream"


def build(seed=7):
    """Tao FakeDrive da nap san du lieu. Tra ve (backend, source_id, dest_id)."""
    fd = FakeDrive(seed=seed)
    my_drive = fd._add("My Drive", FOLDER_MIME, "")
    fd.root_id = my_drive
    src = fd._add("Game Design", FOLDER_MIME, my_drive)
    dest = fd._add("Dich thu nghiem", FOLDER_MIME, my_drive)

    by_path = {}
    for folder, files in TREE.items():
        fid = fd._add(folder, FOLDER_MIME, src)
        by_path[folder] = fid
        for fname in files:
            name, mime = _mime_and_name(fname)
            node_id = fd._add(name, mime, fid, blob=b"noi dung that " * 20)
            fd.nodes[node_id]["quotaBytesUsed"] = "280"
            by_path[folder + "/" + fname] = node_id
        for sub, subfiles in NESTED.get(folder, {}).items():
            sid = fd._add(sub, FOLDER_MIME, fid)
            by_path[folder + "/" + sub] = sid
            for fname in subfiles:
                name, mime = _mime_and_name(fname)
                nid = fd._add(name, mime, sid, blob=b"raw" * 50)
                fd.nodes[nid]["quotaBytesUsed"] = "150"
                by_path[folder + "/" + sub + "/" + fname] = nid

    # shortcut o goc tro toi mot file trong cay
    fd._add("Link nhanh - Data Level", "application/vnd.google-apps.shortcut", src,
            shortcutDetails={"targetId": by_path["TSM_ Game Balancing/Data Level.xlsx"]})

    master_id = fd._add("TSM_ Master Sheet", SHEET_MIME, src)
    fd.nodes[master_id]["quotaBytesUsed"] = "8400"
    fd.nodes[master_id]["sheet"] = _master_sheet(master_id, by_path)
    return fd, src, dest


def _master_sheet(sheet_id, by_path):
    rows = []
    for idx, (section, links) in enumerate(LAYOUT):
        rows.append({"values": [{"userEnteredValue": {"stringValue": section}}]})
        cells = [{}]  # cot A de trong, link bat dau tu cot B nhu anh chup
        for i, (label, path) in enumerate(links):
            target = by_path[path]
            mime = EXT_MIME.get("." + path.rsplit(".", 1)[-1], XLSX_MIME)
            url = view_url(target, mime)
            cells.append(_link_cell(label, url, style=(i + idx) % 3))
        rows.append({"values": cells})
    # Link RA NGOAI cay nguon (tai lieu cua ben khac) - tool phai de nguyen
    rows.append({"values": [
        {"userEnteredValue": {"stringValue": "Tham khao"}},
        _link_cell("Tai lieu ben ngoai", FOREIGN_URL, 0),
        _link_cell("Google Play", "https://play.google.com/store/apps/details", 1),
    ]})
    return {
        "spreadsheetId": sheet_id,
        "properties": {"title": "TSM_ Master Sheet"},
        "sheets": [{
            "properties": {"sheetId": 0, "title": "Master", "index": 0},
            "data": [{"startRow": 0, "startColumn": 0, "rowData": rows}],
        }],
    }


def _link_cell(label, url, style):
    """3 kieu link Sheets khac nhau -> ep tool phai xu ly du ca 3 duong."""
    if style == 0:  # rich-text run
        return {
            "userEnteredValue": {"stringValue": label},
            "textFormatRuns": [{"startIndex": 0, "format": {"link": {"uri": url}}}],
            "hyperlink": url,
        }
    if style == 1:  # cong thuc HYPERLINK
        return {
            "userEnteredValue": {
                "formulaValue": '=HYPERLINK("{}","{}")'.format(url, label)
            },
            "formattedValue": label,
        }
    return {  # link ap cho ca o
        "userEnteredValue": {"stringValue": label},
        "userEnteredFormat": {"textFormat": {"link": {"uri": url}}},
        "hyperlink": url,
    }

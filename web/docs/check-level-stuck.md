---
name: check-level-stuck
description: "Kiểm tra level của game puzzle / sort có bị KẸT không (không còn đường nào thắng) bằng chính luật của game: port luật vào bộ mô phỏng không giao diện + bộ giải tìm hết đường đi, có hậu kiểm (chạy lại lời giải, đối chứng âm / dương, mâu thuẫn) và báo cáo. Dùng khi được nhờ: check stuck, kiểm tra kẹt, level kẹt, level có giải được không, dựng tool check stuck / solver level cho game mới, kiểm lại sau khi đổi luật game. KHÔNG dùng để đo độ khó với người chơi (cần bot giống người)."
---

# Check Level Stuck — gói phương pháp dùng cho mọi game

> Gói này rút từ 2 tool đã chạy thật: **CDS** (Chaos Drink Sort, water sort + order) và **BSHP / Bird Sort**
> (trứng rơi + chim + order). Tải về, điền mục **0. Thông tin game**, rồi đưa cho Claude (Claude Code, hoặc
> đính kèm vào chat) kèm câu prompt ở mục 10. Claude sẽ đọc code game của bạn, port luật, dựng checker, tự hậu kiểm
> và báo cáo theo đúng khung dưới đây.

**3 cách dùng**

1. **Claude Code trong project game** (khuyên dùng): chép file này vào `<project>/.claude/skills/check-level-stuck/SKILL.md`
   → gõ `/check-level-stuck` hoặc chỉ cần nói "check stuck bộ level v3".
2. **Chat thường**: đính kèm file này + code luật chơi + vài file level, dán prompt ở mục 10.
3. **Game dạng water sort / file CDS**: dùng thẳng tool **Level Stuck** trên GD Toolkit (chạy trên trình duyệt, không cần code).

<!-- GAME-INFO:START -->
## 0. Thông tin game (điền trước khi prompt)

| | |
|---|---|
| Tên game | _(vd: Bird Sort Hyper Puzzle — BSHP)_ |
| Engine / ngôn ngữ | _(vd: Unity C#, Cocos TS…)_ |
| Thư mục project | _(vd: D:\1_Project\bird-sort-puzzle)_ |
| Thư mục / định dạng level | _(vd: Assets/EncryptedAsset/LevelData/v4/level-NNNN.json; level N = vị trí N trong LevelConfig_v4.asset)_ |
| File luật chơi chính | _(vd: BirdSortBoard.cs, OrderSelector.cs…)_ |
| Cơ chế cần port | _(vd: trứng ẩn, băng, dây leo, chìa khoá, lồng…)_ |
| Thắng / thua | _(vd: thắng khi mọi chim có tổ; thua khi đầy hàng chờ 5 ô)_ |
| Random trong lúc chơi | _(vd: order rút ngẫu nhiên theo bảng độ khó → cần nhiều seed)_ |
| Booster / ads / revive | _(vd: 2 tổ sau khoá bằng ads → biến thể "thêm tài nguyên")_ |
| Bộ level cần kiểm | _(vd: v4 cả bộ, hoặc level 1–200)_ |
| Level chắc chắn thắng được (đối chứng dương) | _(vd: 1–10 tutorial, level có win > 0 trên data live)_ |
<!-- GAME-INFO:END -->

## 1. "Kẹt" là gì — và kết luận nào tin được

Level **kẹt** = không có chuỗi nước đi nào thắng được theo luật game **như lúc ship** (không booster, không revive).
Tool trả lời bằng cách **port luật từ code game** vào một mô hình không giao diện, cho bộ giải đi thử mọi đường, rồi
**tự kiểm lại câu trả lời** trước khi ai đó tin nó.

| Kết luận | Nghĩa | Là chứng minh? |
|---|---|---|
| **OK** | thắng được như ship (mọi seed), lời giải đã chạy lại khớp | có — lời giải là bằng chứng |
| **CẢNH BÁO** | chỉ thắng được khi thêm tài nguyên (ống / tổ ads, booster) · chỉ thắng ở một số seed · hoặc data sai quy ước | một phần |
| **KẸT (chắc)** | lỗi data chứng minh được (vd số ô 1 màu không chia hết sức chứa) **hoặc** bộ giải đã duyệt HẾT mọi trạng thái | có |
| **KẸT** | hết ngân sách mà chưa tìm ra đường thắng — **chưa phải chứng minh**, tăng ngân sách rồi chạy lại | không |
| **LỖI** | không đọc được file · lời giải chạy lại không khớp (port sai) · **MÂU THUẪN**: soát data nói "không thắng được" nhưng bộ giải thắng | — |
| **BỎ QUA** | level có cơ chế chưa port — tool không đoán | — |

Bộ giải chơi tối ưu và biết cả ô ẩn: **OK = giải được, KHÔNG có nghĩa là dễ.** Độ khó với người chơi là câu hỏi khác
(cần bot giống người, hiệu chỉnh bằng data live — vd BotSim của Bird Sort).

## 2. Quy trình 5 bước

1. **Đọc luật — lập bảng luật, không đoán** (mục 3). Mỗi luật một dòng, ghi `file:dòng` trong code game.
   Đọc theo đúng thứ tự một level được chơi: level N lấy file nào → data bị biến đổi gì trước khi lên bàn → khởi tạo
   → điều kiện chạm (mọi `return false` ở đầu hàm input là 1 luật) → hiệu ứng 1 nước **theo đúng thứ tự xảy ra**
   (kể cả phần chạy sau hoạt cảnh / callback) → sinh / nạp thêm → **mọi lần rút random** → thắng / thua và **lúc nào**
   kiểm → từng cơ chế → cờ remote / AB / feature gate (lấy giá trị **LIVE**) → những gì cố ý bỏ (booster, revive…).
2. **Port** luật vào 1 "engine" theo giao diện ở mục 4. Đặt tên hàm theo hàm của game, đầu mỗi hàm ghi
   `// Port của Class.Method (file:dòng)`. Cơ chế chưa port → báo BỎ QUA, không đoán.
3. **Hậu kiểm** (mục 5) — chưa qua hậu kiểm thì chưa báo kết luận nào.
4. **Chạy** cả bộ: 1 lệnh / 1 thư mục, chạy song song, có tham số ngân sách (số trạng thái, giây / level, số seed).
5. **Báo cáo** (mục 6): file .md + .csv (+ .json), lời giải từng nước cho level OK, ngõ cụt cho level kẹt; trả lời
   ngắn trong chat theo mẫu.

Ngân sách thật: game sort vài cơ chế ≈ 1 ngày port cẩn thận; phần hậu kiểm là thứ làm nó đáng tin.

## 3. Bảng luật (RULES) — mẫu, điền TRƯỚC khi viết code

Ngày đối chiếu code: YYYY-MM-DD · nhánh / commit: `xxxxxxx`

| # | Luật | Nguồn trong code game (file:dòng) | Port (hàm) | Chính xác / xấp xỉ / bỏ | Đã kiểm bằng |
|---|---|---|---|---|---|
| 1 | Đọc level + đánh số (tên file? vị trí trong config? loop / replace?) | | `load` | | V1 |
| 2 | Trạng thái đầu màn (ô khoá, order đầu, sinh ban đầu…) | | `start` | | |
| 3 | Điều kiện được chạm / nước đi hợp lệ | | `moves` | | |
| 4 | Hiệu ứng 1 nước, đúng thứ tự | | `apply` | | |
| 5 | Sinh / rơi / nạp thêm | | | | |
| 6 | Random: rút gì, lúc nào (→ seed) | | | | |
| 7 | Thắng | | `won` | | |
| 8 | Thua và thời điểm kiểm | | | | |
| 9 | Từng cơ chế (blocker, khoá / chìa, ẩn…) | | | | |
| 10 | Cờ remote / AB / feature gate (giá trị LIVE) | | | | |
| 11 | Booster / ads / revive (thường bỏ; biến thể 1 = +1 tài nguyên) | | | bỏ | |

**Xấp xỉ có chủ đích** (ghi cả vào báo cáo và câu trả lời): vật lý → danh sách có thứ tự · hoạt cảnh → thứ tự sự kiện ·
ô ẩn → bộ giải biết trước (lạc quan) · đồng hồ → không mô phỏng (lạc quan) · booster → tắt.

## 4. Engine + bộ giải

### 4.1 Giao diện engine (ngôn ngữ nào cũng được)

| Hàm | Việc | Ghi chú |
|---|---|---|
| `load(file) → level` | đọc + biến đổi data như game, soát data (`findings`: error = chứng minh không thắng, warn = rủi ro, note) | cơ chế chưa port → `unsupported` |
| `start(level, variant, seed) → state` | trạng thái đầu màn; variant 1 = thêm tài nguyên (ống / tổ ads, booster) | không sửa `level` |
| `moves(state) → [move]` | mọi nước hợp lệ, mỗi kết quả khác nhau 1 nước; `move.key` ổn định khi chạy lại; `move.score` để xếp thứ tự | bỏ nước trùng kết quả (vd 2 ống trống giống hệt) |
| `apply(state, move)` | hiệu ứng đúng thứ tự game | tất định theo (state, seed) |
| `won(state)` | đúng hàm thắng của game | |
| `hash(state)` | khoá trạng thái **chính xác** (đừng băm mất thông tin); vật chứa hoán đổi được thì xếp lại | sai hash = gộp nhầm trạng thái |
| `hopeless(state) → lý do / null` | chứng nhận **chắc chắn** không thắng (chỉ những gì không thể đổi được nữa) | chứng nhận sai = "KẸT chắc" giả |
| `deadEnd(state)` | vì sao hết nước (loại + số liệu) | để báo cáo |
| `progress(state)` | 0..1 để chọn ngõ cụt xa nhất | |
| `board(state)` | 1 dòng chữ mô tả bàn chơi | để đọc lời giải / ngõ cụt |
| `mutations(level)` | bản hỏng cho đối chứng âm: 1 hỏng tĩnh (bớt 1 vật phẩm), 1 hỏng động (bỏ hết chỗ trống) | |

### 4.2 Bộ giải (đã dùng cho CDS + Bird Sort)

DFS có xếp thứ tự nước đi + bảng trạng thái đã duyệt; lượt đầu tất định ngắn (≈ 4.000 nút), sau đó **restart từ gốc**
với thứ tự hơi xáo (jitter) và ngân sách theo dãy **Luby** (1 1 2 1 1 2 4 … × 1.000 nút). Một lượt dài là chiến lược
tệ nhất (đuôi nặng — đo trên CDS L119: chỉ 22% hoán vị thứ tự ống giải được trong 20 s). Trạng thái chết được dùng lại
giữa các lượt — chỉ khi **cả thành phần liên thông mạnh** (Tarjan) đã đóng, nếu không vòng lặp nước đi sẽ làm "chết giả".
Lượt nào đi **hết cây** mà không thắng = chứng minh kẹt.

```js
// Bản tham chiếu (JS, rút gọn từ GD Toolkit web/lib/stuckkit.js)
function runPass(E, root, P) {            // P = {limit, jitter, rand, dead:Set, deadline, leaf(state, why, path)}
  const seen = new Map(), scc = [], stack = []; let nodes = 0, idx = 0;
  const order = (ms) => ms.map((m) => (m._s = m.score + (P.jitter ? P.rand() * P.jitter : 0), m)).sort((a, b) => b._s - a._s);
  const pathOf = (x) => stack.slice(1).map((f) => f.via).concat(x ? [x] : []);
  const push = (s, h, via) => { const f = { s, h, ms: order(E.moves(s)), next: 0, idx, low: idx++, via };
    nodes++; seen.set(h, f.idx); scc.push(f); stack.push(f); if (!f.ms.length) P.leaf(s, null, pathOf()); };
  const h0 = E.hash(root); if (P.dead.has(h0)) return { complete: true };
  push(root, h0, null);
  while (stack.length) {
    const f = stack[stack.length - 1];
    if (f.next < f.ms.length) {
      if (nodes >= P.limit || Date.now() > P.deadline) return { complete: false, nodes };
      const mv = f.ms[f.next++], c = E.clone(f.s); E.apply(c, mv);
      const h = E.hash(c);
      if (P.dead.has(h)) continue;
      const si = seen.get(h); if (si !== undefined) { if (si >= 0) f.low = Math.min(f.low, si); continue; }
      if (E.won(c)) return { won: true, path: pathOf(mv), nodes };
      const why = E.hopeless(c); if (why) { P.dead.add(h); P.leaf(c, why, pathOf(mv)); continue; }
      push(c, h, mv);
    } else {
      stack.pop(); f.s = f.ms = null;
      const p = stack[stack.length - 1]; if (p) p.low = Math.min(p.low, f.low);
      if (f.low === f.idx) { let x; do { x = scc.pop(); seen.set(x.h, -1); P.dead.add(x.h); } while (x !== f); }
    }
  }
  return { complete: true, nodes };       // duyệt hết cây, không thắng = CHỨNG MINH kẹt
}
// solve: pass 0 = tất định (limit 4000), pass k ≥ 1 = jitter 130, limit = luby(k) × 1000; dừng khi thắng / complete / hết ngân sách.
```

**Xếp thứ tự nước đi** quyết định tốc độ, không quyết định đúng sai: nước hoàn thành mục tiêu +1.000 (khớp order đang mở
thêm +500), rót vào cùng màu +300, lộ ô ẩn +220, lộ chìa +260, làm trống ống +150, rót thiếu −120; các nước gần bằng
nhau cách nhau trong khoảng jitter.

**Tốc độ** (Bird Sort 1.500 level: 249 s → 35 s, kết luận giữ nguyên): trạng thái copy-on-write · dùng lại trạng thái đã
nhìn trước (lookahead) · sinh nước đi không cấp phát bộ nhớ · khoá hash ngắn · chạy song song (level, seed) trên mọi lõi.
Đo trước khi tối ưu; tối ưu không được làm đổi kết luận / số nút.

### 4.3 Biến thể + seed

- **Biến thể 0 = như ship.** Không thắng → chạy **biến thể 1 = thêm tài nguyên** (mở ống / tổ ads, hoặc +1 ống booster
  nếu game bán). Chỉ biến thể 1 thắng → CẢNH BÁO "chỉ thắng khi …".
- **Seed** chỉ cần khi luật có random lúc chơi (order rút ngẫu nhiên, vật phẩm rơi ngẫu nhiên…). "Thắng x/N seed" = x trong
  N chuỗi rút random có đường thắng — không phải tỉ lệ thắng của người chơi. Giữ số seed là bội số của số luồng.

## 5. Hậu kiểm V1–V8 (bắt buộc trước khi tin kết luận)

| | Kiểm | Bắt được | Tự động? |
|---|---|---|---|
| V1 | **đọc file đúng như game**: biên dịch chính parser của game (dotnet + Unity DLL…) và so từng level với bản port | đọc sai data, gate / split chưa áp, đánh số lệch | không (1 lần / mỗi lần đổi định dạng) |
| V2 | **luật từng cơ chế**: level tí hon tự dựng / replay 1 ván chơi thật qua port | port sai 1 luật / sai thứ tự | không (mỗi lần đổi luật) |
| V3 | **độ mới**: `git log --since=<ngày bảng luật> -- <mọi file trong bảng luật>` | checker lặng lẽ lệch khỏi game | không (mỗi lần chạy) |
| V4 | **chạy lại** mọi lời giải trên ván MỚI chỉ bằng `move.key` | lỗi clone / hash / chỉ số | có |
| V5 | **tất định**: chạy lại vài level cùng tham số phải ra y hệt (số nút, kết luận) | trạng thái dùng chung, tranh chấp luồng | có |
| V6 | **đối chứng âm**: bản hỏng của level OK phải KHÔNG ra OK (bản hỏng tĩnh phải ra KẸT chắc) | checker chỉ biết nói "OK" | có |
| V7 | **đối chứng dương**: level chắc chắn thắng được (tutorial, có win trên data live) phải ra OK | port quá khắt / chứng nhận sai → "kẹt" giả | có (cần danh sách) |
| V8 | **mâu thuẫn**: soát data nói "không thắng được" mà bộ giải thắng + chạy lại khớp → LỖI | "chứng minh" tĩnh dựa trên hiểu sai luật thắng | có |

**Cổng chặn:** hậu kiểm ✗ → sửa port, chạy lại, KHÔNG báo kết luận về level. Trước khi nói 1 level kẹt: (a) mở chẩn
đoán ngõ cụt của nó, (b) kiểm trạng thái ngõ cụt có thể xảy ra trong game thật, (c) nói rõ là **chứng minh** (lỗi data /
duyệt hết) hay **hết ngân sách** (chạy lại với ngân sách ×5–10 trước).

## 6. Báo cáo + câu trả lời

File: `stuckcheck_<game>_<bộ>_<giờ>.md` (1 tóm tắt · 2 hậu kiểm · 3 level cần xem · 4 bảng từng level · 5 mô hình + bảng
luật · 6 tham số · 7 lời giải), `.csv` (1 dòng / level), `.json` (số liệu để viết câu trả lời), `steps/Level_N.txt`
(lời giải từng nước, đã chạy lại), `stuck/Level_N.txt` (chẩn đoán: data, từng seed, bàn chơi ở ngõ cụt).

Trả lời trong chat (tiếng Việt, ngắn — chi tiết nằm trong báo cáo):

```
**Kết luận bộ <bộ> (<n> level):** OK a · CẢNH BÁO b · KẸT c (chắc d) · LỖI e · BỎ QUA f. <1 câu ý nghĩa>

**Level cần xem**
| Level | Kết luận | Nguyên nhân (số liệu) | Hướng sửa |
|---|---|---|---|
| 12 | KẸT (chắc) | màu 3 có 5 ô, ống chứa 4 | bớt / thêm 1 ô màu 3 |
| 30 | CẢNH BÁO | như ship duyệt hết 4.212 trạng thái không thắng, chỉ thắng khi mở ống ads | thêm 1 ống trống hoặc đổi thứ tự 2 ống đầu |

**Hậu kiểm:** chạy lại 120/120 · tất định 3/3 · đối chứng âm 6/6 · đối chứng dương 10/10 · port đối chiếu code ngày … (commit …).
<Nói rõ mục nào chưa kiểm.>

**Mô hình:** <các xấp xỉ ảnh hưởng tới kết luận, mỗi cái 1 dòng>.
Chạy lại: `<lệnh>` · Báo cáo: <đường dẫn .md>
```

## 7. Ví dụ 1 — CDS (Chaos Drink Sort, water sort + order)

Đã chạy trên GD Toolkit → tool **Level Stuck** (thả thư mục level là chạy). Luật đọc lại từ code ngày 15/10/2026
(nhánh `gd/game-design-andr`, commit `dd68cd8bd2`).

**Định dạng level:** JSON runtime `B[]` (ống) → `C[]` ô **dưới → trên theo thứ tự mảng** (LP.y chỉ trang trí) →
`BIM {Id, CI}` (Id 2 = ô ẩn "?"), `CBIM.KLT` = chìa, `OBIM[0].Id` = cơ chế ống, `OVBIM` = hộp khoá / rèm,
`lstOrderCI` = hàng chờ order, `hasVideo` = ống ads.

| Luật | Nguồn | Port |
|---|---|---|
| Sức chứa: ống thường **4** (không lấy theo số ô trong file), ống sinh 1 | `Bottle.m_MaxColor` (Bottle.cs:506) | `loadCDS` |
| Chạm ống nguồn: không trống, không cơ chế (trừ tag / sinh), không hộp khoá / rèm, chưa xong | `Bottle.IsCannotClick` (1324) | `canRemove` |
| Lượng rút = ngọn + các ô cùng màu không ẩn ngay dưới; rót được 1 phần | `NumColorCanRemove` (1426) | `canRemove` |
| Ống đích: không đầy, không nắp / đóng băng / hộp khoá / rèm; trống nhận mọi màu (tag: chỉ màu tag), không thì khớp màu ngọn | `IsCanAddColor` (1405) | `canAdd` |
| Ô ẩn lộ khi ống vừa rót đi (lộ ngọn + ô ngay dưới nếu cùng màu) | `MoveBottleBack → UnlockBlind` | `unlockBlind` |
| Niêm (OBIM 6): không rót ra, rót vào được, vỡ khi đầy 1 màu | `ResetAfterAddColor` (1487) | `apply` |
| Chìa (CBIM.KLT) bay về hộp khoá khi ô chìa lộ ngọn — giữ nguyên phép tính chỉ số của game | `BottleKeyHolder.FlyKeysToLockBox` (96) | `flyKeys` |
| Ống xong → lật 1 ống rèm mỗi nhóm (phần tử cuối) · băng nhóm (OBIM 15) tan cả nhóm | `Bottle.OnDone` (2398) | `onDone` |
| Order: 4 ô, 2 mở; ống xong khớp ô mở → thu đi, ô lấy order kế · không có `lstOrderCI` → ống xong nằm lại, nắp / băng không bao giờ mở | `InGameGroup.InitializeSlotOrderSystem` (1913), `CheckBottleCompleted` (1957) | `collect` |
| Mỗi lần thu: nắp (OBIM 4) cùng màu −1, đóng băng (OBIM 7) −1 | `InGameGroup` (RemoveSlot) | `collect` |
| Ống sinh (OBIM 18): rót cạn thì lấy ngay màu kế trong `NC`; không bao giờ "xong" | `MoveBottleBack` (1809), `EvaluateFullSameColor` | `apply` |
| **Thắng** = mọi ống trống hoặc đầy 1 màu **VÀ** hàng chờ order đã rút hết | `InGameGroup.CheckWin` (4237) | `won` |
| Ống ads (`hasVideo`) | khoá khi như ship | biến thể 1 |
| Chưa port: ống dài / khổng lồ / nước bay / ghép (multi bottle), multi floor, mini tube | — | BỎ QUA |

**Chứng nhận chắc chắn kẹt:** hộp khoá còn nước mà chìa của nó đã nằm trong ống xong / đã thu · nắp cần thu thêm nhiều
ống màu X hơn số order màu X còn lại · đóng băng cần thu nhiều hơn tổng order còn lại.

**Soát data:** số ô 1 màu không chia hết 4 → KẸT chắc · không có `lstOrderCI` mà ống nắp / băng còn nước → KẸT chắc ·
hộp khoá có nước mà không có chìa → KẸT chắc · thiếu / thừa order so với số ống hoàn thành được → CẢNH BÁO (quy tắc
đã chốt cho CDS: level thiếu / thừa order = KHÔNG PASS).

**Kết quả thật (15/10/2026, ngân sách 150.000 trạng thái, 6 s / level, ~50 s cho 393 level):**

| Bộ | Level | OK | CẢNH BÁO | BỎ QUA | Chạy lại level cảnh báo với ngân sách lớn |
|---|---|---|---|---|---|
| NewLevel_v22 | 45 | 44 | 1 (L119) | 0 | L119 (26 ống, 21 order) thắng như ship sau **1,19 triệu** trạng thái |
| NewLevel_v18 | 201 | 198 | 3 (L280, L287, L290) | 0 | cả 3 thắng như ship: 151.000 · 358.000 · 513.000 trạng thái |
| NewLevel_Hard | 147 | 145 | 1 (L290) | 1 (ống khổng lồ) | L290: 2 triệu trạng thái vẫn chưa thắng như ship, có ống ads thì thắng → cần xem tay |

→ Mọi "chỉ thắng khi mở ống ads" ở ngân sách nhỏ đều là **hết ngân sách**, không phải kẹt thật: **chạy lại với
ngân sách ×5–10 trước khi kết luận.** Level khó của CDS cần 150.000–1.200.000 trạng thái (~25.000 trạng thái / giây / luồng
trên trình duyệt).

**Bẫy CDS:** sức chứa lấy từ `m_MaxColor`, không từ số ô trong file · `C[0]` là đáy · ống xong khi chưa khớp order vẫn nằm
trên bàn và không rót được nữa · thắng chỉ cần **hàng chờ** rỗng (ô order đang mở có thể còn) · `isDone` bị gán như
tác dụng phụ của `IsFullSameColor()` → ống đầy sẵn từ đầu là trường hợp biên, tránh trong data.

## 8. Ví dụ 2 — BSHP / Bird Sort (trứng rơi + chim + order)

Tool: `Tools\LevelStuckChecker\stuckcheck.bat v4 [--set]` (C# headless, dùng chung lõi với cửa sổ Unity
`IEC > BirdSort > Level Stuck Checker`); kit dùng lại cho game khác: `.claude/skills/check-stuck-level` (StuckKit C#).

| Luật | Nguồn | Port |
|---|---|---|
| Level N = vị trí N trong `LevelConfig_vN.asset` (GUID → file qua `.meta`); thư mục v2/v3/v4 chỉ chứa level đã sửa | `LevelConfig.GetJson` | `ScanFolder` (`--set`) |
| Parse + feature gate (bỏ cơ chế bị tắt, tách hàng lốc xoáy) | `LevelJson.ToDefinition`, `BirdSortFeatureGate.Apply` | `Load`, `StuckFeatureGate` |
| 2 tổ sau khoá ads từ đầu | `AdNestRule` | biến thể 1 |
| Order đầu: loài nhiều nhất trong 10 trứng đầu hàng | `PickInitialSpecies` | `PickInitialSpecies` |
| Order sau: rút hạng theo `DifficultyTable` (tier, tiến độ, hàng chờ) trên các loài dưới vạch với tới; TopUp đổi với hàng chờ | `PickRegularOrder`, `OrderScanner`, `TopUpOrder` | `StuckOrders.cs` (cùng tên hàm) |
| Tổ đầy nhận order mới **sau** hoạt cảnh (đống trứng đã rơi bù) | callback `CompleteNest` | `Settle` |
| Chạm: hàng chờ đầy thì từ chối; chim bay tới tổ đầy nhất nhận được | `TryCollectBird`, `FindNestFor` | `Apply` |
| Chìa mở trứng đầu chuỗi; băng −1 mỗi chim rời trứng kề; trứng ẩn lộ khi chạm đáy | rules + `FindNeighbours` | `PopBubble`, `UpdateFloor` |
| **Thắng** = mọi chim có tổ · **thua** = hàng chờ đầy | `CheckWin`, `RequestLose` | `Won`, `lost` |

**Xấp xỉ:** đống trứng vật lý = danh sách theo thứ tự rơi, giới hạn tổng diện tích (≈ 15 trứng); vạch với tới = 0,875
chiều cao đống; trứng kề = ±4 vị trí; không mô phỏng đồng hồ tổ đếm ngược; bộ giải biết loài trong trứng ẩn. Order có
random → **8 seed** = 8 chuỗi rút order.

**Đã sai và hậu kiểm bắt được:**

| Khi | Lỗi | Bắt bằng |
|---|---|---|
| 28/09 → 08/10/2026 | game đổi sang hệ rank + TopUp; checker giữ mô hình cũ (đọc config đã xoá, im lặng lấy mặc định) → v2 L1–40 báo 18 CẢNH BÁO + 4 KẸT, luật thật 37/37 OK | V3 độ mới — lý do có bậc này |
| 08/10/2026 | bảng độ khó dựng lười bởi nhiều luồng (tranh chấp) | đọc code; V5 tất định sẽ lộ |
| 09/10/2026 | soát data "số chim 1 loài không chia hết 3 = không xong được" (thói quen từ Fish Sort) sai: game thắng khi mọi chim có tổ | V6 đối chứng âm "bớt 1 chim" → bộ giải vẫn thắng → V8 báo MÂU THUẪN; hạ thành cảnh báo |

**Kết quả (09/10/2026, 8 seed, 2 tổ):** v1 1.500, v2 208, v3 23, v4 30 level — mọi level OK, mọi lời giải chạy lại khớp;
tất định 5/5; đối chứng âm (chuỗi mất chìa, mọi trứng đóng băng) đều KẸT chắc; đối chứng dương (v2 L3–30) 28/28.
Tốc độ v1 1.500 level: 249 s → 35 s.

## 9. Bẫy đã gặp (áp dụng cho mọi game)

- **Game đổi luật sau lưng checker** → V3 trước mỗi lần chạy; ghi ngày + commit vào bảng luật.
- **Config đã xoá vẫn được đọc với giá trị mặc định im lặng** → thiếu key = cảnh báo trong báo cáo, không lấy mặc định.
- **Hiệu ứng trễ sau hoạt cảnh** quyết định cái gì xảy ra trước → port **thứ tự sự kiện quan sát được**, không phải thứ tự
  gọi hàm trong handler.
- **"Phần tử đầu tiên khớp" trên Dictionary** → thứ tự duyệt không phải thứ tự thêm sau khi xoá; dùng cùng kiểu container.
- **Đánh số level** = vị trí trong list config / pack chồng nhiều pack, không phải số trong tên file.
- **"Chứng minh" tĩnh theo thói quen game khác** → mọi lỗi data loại error phải suy ra từ hàm thắng / thua của CHÍNH game,
  rồi để V6 + V8 kiểm.
- **Hết ngân sách ≠ kẹt.** Level khó của CDS (v18 L290, v22 L119) cần 500.000–1.200.000 trạng thái; ngân sách nhỏ báo nhầm "chỉ thắng khi có ads".
- **Hash thiếu 1 trường** gộp 2 trạng thái khác nhau → V4 chạy lại sẽ hỏng; luôn để V4 bật.
- **Đánh dấu "chết" khi còn vòng lặp mở** → dùng thành phần liên thông mạnh (Tarjan) như bản tham chiếu.
- Lõi checker nên chạy được ngoài engine game (C# 9 / netstandard2.1 cho Unity, JS thuần cho web) để chạy hàng loạt nhanh.

## 10. Prompt mẫu

**Dựng checker cho game mới:**

```
Đọc file check-level-stuck.md (đính kèm / skill). Game của tôi ở mục 0.
Hãy: (1) đọc code luật chơi, lập bảng luật mục 3 có file:dòng — gửi tôi xem trước khi code;
(2) port thành checker chạy hàng loạt 1 lệnh / 1 thư mục, có biến thể "thêm tài nguyên" và seed nếu luật có random;
(3) hậu kiểm đủ V1–V8 (đối chứng dương = các level ở mục 0);
(4) chạy bộ level ở mục 0 và trả lời đúng mẫu mục 6. Không đoán luật — chỗ nào không chắc thì hỏi.
```

**Kiểm 1 bộ level bằng checker đã có:**

```
Check stuck bộ <v4> bằng checker đã có. Trước khi chạy: kiểm độ mới (V3) so với bảng luật.
Level nào KẸT do hết ngân sách thì chạy lại với ngân sách ×10 trước khi kết luận. Trả lời theo mẫu mục 6.
```

**Hỏi 1 level:**

```
Vì sao level <12> kẹt? Mở chẩn đoán ngõ cụt, chỉ bàn chơi ở ngõ cụt + vài nước dẫn tới đó,
nói nguyên nhân trong data (con số cụ thể) và hướng sửa nhỏ nhất.
```

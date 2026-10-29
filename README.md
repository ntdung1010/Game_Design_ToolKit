# GD Toolkit

Bộ công cụ chung cho team Game Design, chạy trên máy (localhost), giao diện theo
phong cách [1devtool.com](https://1devtool.com/online-tools).

## Mở Tool Kit

Bấm đúp **`start.bat`**. Trình duyệt tự mở <http://127.0.0.1:7700>.

Cập nhật bản mới: chỉ cần bấm đúp `start.bat` lần nữa. Nếu bản cũ vẫn còn chạy (cửa sổ
cũ quên đóng / bị thu nhỏ), bản mới tự tắt bản cũ rồi chạy thay — cửa sổ mới ghi
*“Đã tắt GD Toolkit bản cũ…”*. Số phiên bản ở góc trên trang cho biết đang dùng bản nào.

Lần đầu chạy, `start.bat` tự tạo môi trường riêng `.venv` và cài thư viện (cần
mạng, khoảng 1 phút). Thư viện chỉ nằm trong `.venv`, không đụng tới Python chung
của máy nên không ảnh hưởng project khác.

Chạy bằng dòng lệnh:

```bash
python server.py
```

`server.py` tự chuyển sang `.venv` nếu thư mục đó đã có. Cờ thêm:

- `--port 7800`: đổi cổng;
- `--no-open`: không tự mở trình duyệt;
- `--lan` / `--local`: bật / tắt cho máy khác trong mạng nội bộ truy cập (lưu lại cho lần sau);
- `--data-dir THƯ_MỤC`: dùng thư mục dữ liệu riêng để chạy thử, không đụng mật
  khẩu / token / lịch sử thật.

## Tài khoản & mạng nội bộ

Tool Kit chạy trên **1 máy chủ** (máy bật `start.bat`). Mọi người trong team mở bằng
trình duyệt trên máy của mình, mỗi người **1 tài khoản riêng**. Chưa đăng nhập thì
không mở được trang, API hay file tải về nào.

**Quản trị viên** (vào **Quản lý** trên thanh trên cùng):

- **Người dùng**:
  - **Tạo tài khoản**: nhập tên đăng nhập (chữ thường không dấu, vd `lan.anh`) và
    tên hiển thị. Tool sinh **mật khẩu tạm**, chỉ hiện 1 lần, kèm nút copy tin nhắn
    (địa chỉ + tên + mật khẩu tạm) để gửi riêng. Lần đầu đăng nhập, người đó phải
    đặt mật khẩu riêng.
  - Với từng tài khoản: đặt lại mật khẩu (ra mật khẩu tạm mới), khoá / mở khoá, đổi
    vai trò, đăng xuất mọi phiên, xoá. Không thể tự khoá / tự xoá mình; luôn phải
    còn ít nhất 1 quản trị viên.
  - Xem phiên đang đăng nhập (ai, máy nào, trình duyệt nào) và đăng xuất từng phiên.
- **Nhật ký sử dụng**: ai đăng nhập, mở tool nào, nạp / xuất file gì, chạy gì, lúc
  nào, từ máy (IP) nào. Lọc theo người / tool / hành động / ngày, xuất CSV / Excel.
  Mỗi tháng có thêm file `data/logs/usage-YYYY-MM.csv` mở thẳng bằng Excel. Nhật ký
  không ghi mật khẩu hay nội dung file.
- **Thống kê**: số lượt và số người theo ngày, theo tool, theo người (7 / 30 / 90 ngày).
- **Mạng nội bộ**: bật / tắt cho máy khác truy cập, xem địa chỉ để gửi cho team.

**Mạng nội bộ:**

- Khi bật, server nghe trên mọi card mạng nhưng **chỉ nhận máy có địa chỉ nội bộ**
  (10.x, 172.16–31.x, 192.168.x). Máy ngoài Internet bị chặn, kể cả khi lỡ mở cổng.
  Tên miền lạ cũng bị chặn (chống DNS rebinding).
- Lần đầu bật, Windows hỏi tường lửa → chọn **Allow / Cho phép** cho **Private networks**.
- Bật / tắt ở trang Quản lý, hoặc mở bằng `start.bat --lan` / `start.bat --local`.
  Lựa chọn lưu ở `data/server.json`.
- Đường truyền trong mạng nội bộ là HTTP, chưa mã hoá. Chỉ dùng trong mạng công ty
  tin cậy, không mở cổng 7700 ra Internet.

**Người dùng:**

- Đăng nhập bằng tên + mật khẩu. Tick **Ghi nhớ trên máy này 7 ngày** để không phải
  đăng nhập lại; không tick thì phiên hết hạn sau 4 giờ không dùng. Phiên lưu trong
  cơ sở dữ liệu nên server khởi động lại cũng không bị đăng xuất.
- **Nhập sai 5 lần** (theo tên đăng nhập **hoặc** theo máy): khoá tạm 30 giây, gấp
  đôi mỗi lần sai tiếp (tối đa 15 phút). Tên không tồn tại báo chung "sai tên hoặc
  mật khẩu", nên không dò được tên nào có thật.
- **Đổi mật khẩu**, **Đăng xuất các phiên khác**: ở **Cài đặt**. Quên mật khẩu: nhờ
  quản trị viên đặt lại.
- **Quản trị viên quên mật khẩu**: mở terminal trong thư mục Tool Kit **trên máy
  chủ** rồi chạy:

  ```bash
  python server.py set-password admin
  ```

**Google Drive — mỗi người tự đăng nhập Google của mình, ngay trên trang Drive Clone:**

- Từ 21/10/2026 Drive Clone chạy bằng **Google Apps Script** (web app). **Không còn** OAuth client loại
  Desktop app, `credentials.json`, Test users trên Google Cloud Console hay token lưu trên máy chủ — phần
  kết nối Google cũ ở trang Cài đặt / Quản lý đã tắt (server từ chối `google/connect`).
- Quản trị viên cài web app **1 lần** (khoảng 3 phút, xem mục Drive Clone). Mọi người chỉ bấm
  **Mở Drive Clone**, chọn tài khoản Google của mình, bấm **Cho phép** lần đầu.
- **Quyền:** Apps Script tự xin quyền Google Drive + gọi Google API — không phải sửa `appsscript.json`. Tool chỉ
  **đọc** thư mục A và **tạo mới** trong B, không sửa / xoá file có sẵn nào. B: để trống = tạo thư mục mới trong My
  Drive, hoặc dán bất kỳ thư mục bạn có quyền sửa.
- Token / `credentials.json` của bản cũ (nếu còn) xoá được ở **Cài đặt → Bảo mật**.

**Chuyển từ bản cũ:** bản trước chỉ có 1 mật khẩu chung. Lần đầu chạy bản này, mật
khẩu đó tự thành tài khoản quản trị **`admin`**, mật khẩu giữ nguyên. Kết nối Google
cũ thành Google của `admin` (nay đã tắt — xem trên).

Mật khẩu chỉ lưu băm scrypt kèm salt ngẫu nhiên, trong cơ sở dữ liệu SQLite
`data/gdk.db`. Cookie phiên là `HttpOnly` + `SameSite=Strict`, script trong trang
không đọc được. Server chỉ giữ SHA-256 của cookie.

Tìm nhanh tool: **Ctrl K**. Đổi giao diện sáng/tối: nút mặt trời góc phải.
Giữ chuột lên thẻ tool (hoặc icon tool) khoảng 1 giây để xem ảnh minh hoạ.
Mỗi trang tool có khung **Ví dụ & cách dùng**, nút **Thử với dữ liệu mẫu** và nút
**Tải file mẫu**.

## Danh sách tool

| Tool | Dùng khi | Cần gì |
|---|---|---|
| **Level Funnel** *(mặc định tắt — đang sửa)* | Tìm level “tường”: rời bỏ cao bất thường so với các level xung quanh, so nhiều version / nhánh | CSV / Excel: level + users (hoặc win) + start / win / lose |
| **AB Readout** *(mặc định tắt — đang sửa)* | Đọc kết quả AB: thắng / thua / chưa đủ chắc, kèm khoảng tin cậy và đoạn tóm tắt dán Slack | CSV / Excel: nhánh + số user + các chỉ số (D1, D7, doanh thu…) |
| **Config Diff** | So 2 bản Remote Config / JSON trước khi publish | Dán 2 đoạn JSON hoặc template Firebase |
| **Data Lint** | Soát & đánh giá file dữ liệu: hậu kiểm số liệu, chấm từng level, chỉ ra level nên sửa (sửa gì, dễ hơn / khó hơn), so sánh v0 / v1 | Export Level insight, bảng level, cohort, hoặc bất kỳ CSV / Excel nào |
| **Curve Planner** | Thiết kế đường độ khó mục tiêu, so với điểm thực tế | Không cần file. Muốn so thì cần level + điểm độ khó |
| **Level Preview** | Xem cả bộ level thành ảnh, soát lỗi, so 2 bộ level, xuất PNG / ảnh ghép / gallery | Thư mục level (CDS, Magic Sort, Chirpy, Bird Sort, editor… hoặc game mới) |
| **Level Stuck** | Level có bị kẹt không: tìm hết mọi đường đi theo luật game, ra OK (kèm lời giải) / cần ống ads / KẸT chắc chắn / hết ngân sách, có hậu kiểm + báo cáo .md. Kèm gói phương pháp .md cho game khác | Thư mục level CDS (B / C / BIM), level chuẩn Toolkit, water sort đơn giản |
| **Preflight** | Soát đề xuất / AB plan / kết quả AB / giao level trước khi gửi | Điền form |
| **Mã hoá file** | Khoá file / đoạn chữ bằng mật khẩu trước khi gửi dữ liệu nhạy cảm | Bất kỳ file nào (≤ 200 MB) |
| **Drive Clone** | Clone thư mục Google Drive A → B, đổi tên hàng loạt | Đăng nhập Google của bạn (web app Apps Script) — hoặc bản Demo .html |

Sáu tool phân tích không phụ thuộc game nào. Tool tự nhận tên cột (tiếng Việt /
tiếng Anh), đọc được số kiểu `1,234`, `12,5%`, `$3.20`, và đọc đúng dấu cả file
CSV do Excel tiếng Việt lưu (bảng mã Windows-1258 / UTF-16). Tool chạy hoàn toàn
trên trình duyệt; dữ liệu không gửi đi đâu (file Excel được đọc bởi server local
trên máy).

Mọi tool phân tích có nút **Xuất** với 4 lựa chọn:

- **CSV**;
- **Excel** (.xlsx);
- **Excel có mật khẩu**: Excel hỏi mật khẩu khi mở (AES-256 chuẩn Office);
- **File mã hoá .html**: người nhận chỉ cần trình duyệt và mật khẩu.

Dữ liệu đã nạp được giữ lại khi chuyển qua tool khác rồi quay lại. Dữ liệu chỉ
nằm trong bộ nhớ của tab, đóng tab là mất.

### Các bẫy dữ liệu tool tự cảnh báo

- **AB Readout**:
  - chia nhóm lệch (SRM);
  - ngày cài cuối chưa đủ tuổi cho Dn (tự gợi ý bỏ n ngày cuối);
  - nhánh A/A lệch so với gốc;
  - nhánh dưới 1.000 user;
  - chênh nhỏ nhất phát hiện được với cỡ mẫu hiện tại.
- **Level Funnel**:
  - level 1–3 rơi tự nhiên (không tính là tường);
  - level ít người chơi (bỏ qua vì số liệu dao động mạnh);
  - dãy level bị đứt;
  - không có cột users thì ước lượng từ wins.
- **Config Diff**:
  - sai cú pháp (báo đúng dòng / cột);
  - khoá trùng (JSON.parse lặng lẽ lấy giá trị cuối);
  - nghi gõ sai tên trường;
  - list bị xoá sạch;
  - đổi kiểu dữ liệu;
  - giá trị đổi ×5 trở lên;
  - chuỗi JSON lồng bị lỗi.
- **Data Lint**:
  - cột luôn = 0 (event không bắn);
  - ngày cuối chưa đủ dữ liệu;
  - thiếu level / thiếu ngày;
  - dòng trùng;
  - lẫn chữ trong cột số;
  - header trùng;
  - mỗi lỗi kèm **việc cần làm**.
- **Data Lint — đánh giá** (`web/lib/datareview.js`, quy tắc rút từ các lần review export Level insight của team):
  - tự nhận loại file: Level insight (tiêu đề 3 tầng, v0 / v1 / Δ), bảng level (level + users / start / win),
    cohort (D0…Dn), bảng thường;
  - hậu kiểm: event thua không bắn (lose_quit ≈ 0, pt_lose = 0), lose + win + mid quit ≈ droprate,
    droprate ≈ 1 − reach(N+1)/reach(N), reach tăng vô lý, thiếu mẫu (reach < 50), hàng avg, ô cuối cohort là
    ngày chưa đủ;
  - chấm từng level theo giai đoạn (mặc định L1–23 / 24–40 / 41+, sửa được): đỏ / vàng / đạt, tag Hard /
    Super Hard, droprate kỳ vọng theo độ khó + excess + z-score, gai droprate, nhịp gãy (tỉ lệ thắng ±20pp);
  - chẩn đoán → hướng sửa: tường / spike khó (dễ hơn, đích vẫn khó hơn lân cận ~8pp), vừa khó vừa rò,
    bào mòn (cắt đuôi thất bại), quá dài không khó (rút ngắn), rò không do khó / thắng xong rời game
    (giữ độ khó, sửa móc câu), kết thúc phiên (sửa config), vùng phẳng (khó hơn 1 level); không hạ khó
    level đang kiếm tiền (sra + 0,67·sfa ≥ 1,5× lân cận) nếu droprate trong kỳ vọng; level hướng dẫn
    (L1–2) không chấm;
  - ưu tiên P0 / P1 / P2 theo số user mất; level ít mẫu không xếp cao;
  - xuất “Danh sách sửa” (CSV / Excel, hoặc copy dán thẳng Google Sheet), so sánh v0 / v1 theo trọng số reach.

## Bảo mật

| Lớp | Bảo vệ khỏi gì |
|---|---|
| **Tài khoản riêng từng người** (băm scrypt, khoá tạm khi dò theo tên và theo máy, mật khẩu tạm phải đổi) — xem mục Tài khoản | Người ngoài dùng Tool Kit; người trong team dùng tài khoản của nhau; dò mật khẩu |
| Mạng nội bộ: chỉ nhận máy địa chỉ nội bộ (hoặc chỉ `127.0.0.1` khi tắt), từ chối Host lạ | Máy ngoài Internet; tấn công DNS rebinding |
| **Khoá phiên** ngẫu nhiên mỗi lần mở Tool Kit, API thiếu khoá → 401 | Trang web khác lén gọi API localhost (CSRF) |
| **CSP** + `X-Frame-Options` + `nosniff` + `no-referrer` | Script lạ chạy trong trang; nhúng Tool Kit vào iframe; lộ đường dẫn qua Referer |
| Bí mật cục bộ (token / credentials của bản cũ) **mã hoá DPAPI**, xoá có ghi đè | Lộ token khi file `data/` bị copy hoặc đồng bộ nhầm |
| Drive Clone chạy bằng **tài khoản Google của người dùng** (Apps Script) | Máy chủ Tool Kit không giữ token Google nào |
| **Chống chèn công thức** khi xuất CSV / Excel | Tên file trên Drive kiểu `=HYPERLINK(...)` tự chạy khi mở Change Log bằng Excel |
| **Nhật ký bảo mật** `data/audit.log` | Biết ai đặt link Drive Clone, xuất file có mật khẩu, xoá dữ liệu lúc nào. Không ghi mật khẩu / token |
| Nội dung Config Diff chỉ giữ trong phiên | Config không bị lưu lâu dài trên ổ đĩa |
| Tool **Mã hoá file** + xuất **Excel có mật khẩu** | Gửi file doanh thu / kết quả AB qua Slack, email mà không lộ nội dung |

Trang **Cài đặt → Bảo mật** hiện trạng thái từng lớp, nhật ký gần nhất và các nút
xoá dữ liệu cục bộ (lịch sử chạy; token / credentials cũ nếu còn).

File mã hoá dùng AES-256-GCM, khoá tạo từ mật khẩu bằng PBKDF2-SHA256 với 600.000
vòng (theo khuyến nghị OWASP). Tên và kích thước file gốc được ràng buộc vào bản
mã, nên ai sửa hoặc đổi tên file đều bị phát hiện. Không có cách khôi phục nếu
quên mật khẩu. Hãy gửi mật khẩu qua kênh khác với file.

## Hiệu năng

| Việc | Cách làm |
|---|---|
| Đọc CSV lớn | Đọc trong luồng nền (Web Worker), có thanh tiến độ. 200.000 dòng (12 MB) xong khoảng 0,4 giây, trang chỉ khựng tối đa ~30 ms |
| Đọc Excel | File gửi thẳng dạng byte (không base64). Bộ đọc XML riêng nhanh 2–3× openpyxl, gặp file lạ thì tự quay về openpyxl |
| Phân tích file lớn | Đọc số có đường tắt; nhận diện cột theo mẫu 5.000 ô; Data Lint quét 1 lượt. 200.000 dòng: Data Lint ~1 giây (bản cũ bị lỗi “Maximum call stack”), Level Funnel ~0,13 giây |
| Drive Clone | Quét cây thư mục và copy theo nhiều luồng song song (mặc định 4, chỉnh 1–8 ở mục Nâng cao). Nhanh hơn ~2,8× khi mạng chậm; kết quả và thứ tự Change Log giống hệt chạy 1 luồng |
| Tải trang | File tĩnh nén gzip và có ETag: lần sau chỉ tải lại khi file đổi |

---

## Level Preview

Xem cả bộ level thành lưới ảnh sơ đồ, **không cần mở Unity**. Tool soát lỗi từng
level, so 2 bộ level, xuất PNG / ảnh ghép / gallery .html. File level chỉ được đọc
trên trình duyệt, không gửi lên server.

### Game đọc được ngay

| Game / định dạng | File | Vẽ thành |
|---|---|---|
| Chaos Drink Sort (CDS) | `.txt` runtime `B / C / BIM` trong `Assets/EncryptedAsset` | ống nước, đúng vị trí `P` của game |
| Magic Sort | cùng định dạng runtime, tên `<pack><N>_difficulty<D>-<V>.txt` | ống nước + tag “độ khó D” |
| Chirpy Sort | cùng định dạng runtime, tên `*_cds.txt` | 2 cột cành chim, chim số 0 sát mép (port `LevelLoader.ArrangeGroups`) |
| Sort editor / solver | `{"Level_N": {bottles: [{colorOrder…}], objective}}` | ống nước (`colorOrder[0]` là miệng ống) |
| Water sort đơn giản | `{capacity, tubes: [[…]]}`, 0 = ô trống | ống nước |
| Bird Sort | `level-v4-0007.json` (`clutch`) và `BubbleConfig_N.json` cũ | trứng + chim (bố cục đống trứng chỉ minh hoạ, game rơi tự do) |
| Level chuẩn GD Toolkit | `.gdk.json` (xem bên dưới) | theo `style` trong file |

Cùng một định dạng có thể vẽ theo nhiều kiểu (CDS / Magic Sort / Chirpy). Tool tự nhận
game theo nội dung + tên file; nhận sai thì đổi ở ô **Đọc theo game**.

### Cách dùng

1. Kéo thả thư mục level (hoặc bấm **Chọn thư mục**). Mỗi thư mục con là 1 **bộ**.
2. **Ghép nhiều bộ** như chuỗi pack của game: tick các bộ cần dùng, bấm **Sắp theo
   phiên bản (mới trước)** hoặc dùng ▲▼. Level trùng số lấy ở bộ đứng trên.
   Ví dụ bộ mặc định level 1–400 của CDS:
   `NewLevel_Giant_v4 > NewLevel_v22 > NewLevel_v18 > NewLevel_v14 > NewLevel_v11 > NewLevel`.
   Ghép như vậy khớp **400/400** level với file game thật sự nạp (đối chiếu
   `LevelShots/default_1-400`). Bộ ghi đè riêng (giant…) nhớ kéo lên đầu.
3. **File phụ** được nhận tự động khi nằm trong thư mục thả vào:
   - tag Hard / Super Hard: JSON có `levelConfigModels` (`Config/LevelConfig_v22.txt`, `level_v1_config.txt`…);
   - thứ tự level theo game: file `.txt` mỗi dòng 1 tên level (`level_v1_list.txt`) hoặc
     asset Unity `LevelConfig_vN.asset` + các file `.meta` (Bird Sort).
4. Lọc theo số level (`1-30, 45, 100-`), Hard, có cảnh báo, cơ chế. Bấm 1 level để xem to
   (← → chuyển level, Esc đóng), tải PNG, **Copy ảnh** để dán thẳng vào Slack.
5. **So sánh**: bấm *So sánh với bộ khác*, thả bộ thứ 2. Tool báo level nào giống hệt /
   chỉ đổi vị trí / khác (khác gì: số ống, màu, ô ẩn, cơ chế, tag). Bộ 2 có thể là thư
   mục **ảnh chụp thật** (`Level_0007.png`, `level_024__level_24.png`) để đặt cạnh ảnh sơ đồ.
6. **Xuất** (theo bộ lọc đang chọn): PNG từng level (.zip, kèm `levels.csv`), ảnh ghép
   6 × 5, gallery .html (có thể đặt mật khẩu), bảng thống kê CSV / Excel, level chuẩn .json.

Soát lỗi chung cho mọi game: vật chứa chứa quá sức chứa, không còn ô trống (không có
nước đi đầu), màu không đủ bộ (có tính chim joker bù chỗ thiếu; bỏ qua level có ống
khổng lồ), vật chứa đã đầy 1 màu từ đầu, nhóm trỏ tới vật chứa không có. Đã chạy thử
trên 3.180 level thật (CDS, Magic Sort, Chirpy, Bird Sort, file editor): đọc hết, không
lỗi; các cảnh báo nhầm ban đầu (chim joker, ống khổng lồ) đã sửa luật.

### Thêm game mới (không phải sửa tool)

1. **Cùng định dạng với game đã có** → chọn game đó ở ô *Đọc theo game*. Game sort mới
   dùng file `B / C / BIM` chỉ cần thêm 1 “skin” ~10 dòng: `runtimeSkin({…})` trong
   `web/lib/level-adapters.js`.
2. **Xuất thẳng ra level chuẩn** (nút *Tải file mẫu* trong tool):
   ```json
   {"format": "gdk-level", "version": 1, "levels": [{
     "level": 1, "tags": ["Hard"], "style": {"container": "tube", "item": "liquid"},
     "containers": [{"items": [1, 2, {"c": 1, "hidden": true}], "capacity": 4, "x": 0, "y": 1,
                     "marks": [{"type": "ice", "n": 2}]}],
     "groups": [{"type": "lockbox", "members": [0, 1]}], "orders": [1, 2]}]}
   ```
   `items` xếp từ **dưới lên trên**. `style.container`: `tube | jar | box | egg | branch`,
   `style.item`: `liquid | ball | block | bird`. Cơ chế (`marks`): `ice cover lock ads spawn
   seal hidden help` hoặc tên tuỳ ý (hiện thành nhãn). Game dạng lưới dùng `grid {w, h, cells}`.
3. **Định dạng riêng** → thả 1 file level vào, tool tự đoán cấu trúc và mở mục
   **Game mới? Cấu hình đọc file**. Chỉnh các ô (danh sách vật chứa, vật phẩm, màu, thứ
   tự, sức chứa, ô trống, vật phẩm ẩn, toạ độ, đơn hàng, kiểu vẽ), xem ảnh cập nhật ngay
   rồi bấm **Lưu thành game**. Cấu hình lưu ở `data/level_games.json`, lần sau tool tự
   nhận file của game đó. *Tải cấu hình (.json)* để gửi cho người khác trong team.
4. Cơ chế quá riêng → viết adapter JS ~60 dòng như `birdSort` trong `level-adapters.js`.

### Cần biết

- Ảnh là **sơ đồ** (không có art của game), mọi thứ vẽ ra đều lấy từ file level. Muốn
  ảnh thật trong game: dùng tool chụp trong Unity của từng project, rồi thả thư mục
  ảnh vào làm bộ B để đặt cạnh.
- CDS: ống khổng lồ vẽ thành khối chữ nhật (không đúng hình), hộp khoá / rèm vẽ trong
  suốt để vẫn thấy bên trong; level loop (> 400) tính lúc chạy game nên không có trong file.
- Màu: CDS / Magic Sort / Chirpy map theo thứ tự xuất hiện như code game; Bird Sort
  không có bảng màu cố định (game chọn art ngẫu nhiên), tool tô theo thứ tự xuất hiện.

---

## Level Stuck

Trả lời "level này có bị kẹt không" bằng **chính luật của game**: tool port luật vào bộ mô phỏng, cho bộ giải đi thử
mọi đường (DFS + bảng trạng thái + restart kiểu Luby), rồi **tự hậu kiểm** trước khi kết luận. Chạy hoàn toàn trên
trình duyệt, nhiều luồng song song (Web Worker) — file level không rời khỏi máy.

| Kết luận | Nghĩa |
|---|---|
| **OK** | thắng được như lúc ship, lời giải đã chạy lại khớp (bấm vào level để xem từng nước, có hình ống màu) |
| **CẢNH BÁO** | chỉ thắng khi mở ống ads, hoặc data sai quy ước (thiếu / thừa order — quy tắc CDS: KHÔNG PASS) |
| **KẸT (chắc)** | lỗi data chứng minh được (số ô 1 màu không chia hết 4, hộp khoá không có chìa…) hoặc đã duyệt HẾT mọi trạng thái |
| **KẸT** | hết ngân sách — **chưa phải chứng minh**, chạy lại với độ kỹ "Rất kỹ" |
| **LỖI / BỎ QUA** | file hỏng / hậu kiểm hỏng · level có cơ chế chưa port (tool không đoán) |

- **Luật CDS** đọc lại từ code ngày 15/10/2026 (`Bottle.cs`, `BottleKeyHolder.cs`, `InGameGroup.cs`): rót / rót 1 phần,
  ô ẩn, nắp, niêm, đóng băng, băng nhóm, hộp khoá + chìa, rèm, ống tag màu, ống sinh nước, order 4 ô (2 mở), thắng =
  mọi ống xong + hàng chờ order rỗng. Chưa port: ống dài / khổng lồ / nước bay / ghép, multi floor, mini tube.
- **Hậu kiểm tự động**: V4 chạy lại mọi lời giải trên ván mới · V5 chạy lặp phải ra y hệt · V6 đối chứng âm (bản hỏng
  của level OK phải bị bắt) · V7 đối chứng dương (ô "Level chắc chắn thắng được") · V8 soát data ↔ bộ giải không mâu thuẫn.
- **Độ kỹ**: Nhanh 60.000 trạng thái / 4 s · Kỹ 400.000 / 20 s (mặc định) · Rất kỹ 2 triệu / 90 s. Đo trên CDS:
  level khó cần 150.000–1.200.000 trạng thái (v22 L119) — "chỉ thắng khi có ads" ở ngân sách nhỏ thường là hết ngân sách.
- **Game khác**: mở mục *Game khác? Gói phương pháp .md* → điền thông tin game → tải `check-level-stuck.md` (dùng làm
  skill Claude Code ở `<project>/.claude/skills/check-level-stuck/SKILL.md`, hoặc đính kèm vào chat) → **Copy prompt**.
  File gói quy trình 5 bước, bảng luật mẫu, bộ giải tham chiếu, hậu kiểm V1–V8, mẫu báo cáo + 2 ví dụ thật CDS và
  BSHP / Bird Sort. Bản gốc: `web/docs/check-level-stuck.md`.
- Thêm luật game mới vào tool web: thêm 1 engine trong `web/lib/stuckkit.js` (start / moves / apply / won / hash /
  hopeless / deadEnd / view / mutations) và test ở `tests/js/stuck.test.js`.

---

## Tool 1 · Drive Clone

Clone một thư mục Google Drive **A** sang **B**: copy toàn bộ hoặc chỉ dựng khung, đổi tên hàng loạt giữ kiểu
chữ (`BSHP → PRSP`), đổi link master sheet sang cây mới, Change Log, hậu kiểm C1–C9. Gộp 2 tool cũ
(`cds_drive_clone` và Apps Script `Copy_BSHP_to_PRSP.gs`).

**Chạy bằng Google Apps Script (v2.0, 21/10/2026)** — chỉ cần đăng nhập Google của bạn:

- Không OAuth client Desktop app, không Google Cloud Console, không `credentials.json`, **không cần server**:
  web app chạy với quyền của **người mở trang** (*Execute as: User accessing the web app*).
- Toàn bộ nghiệp vụ chạy trên trình duyệt (`Pipeline.html`, port 1-1 từ bản Python), mỗi thao tác Drive là 1
  lần gọi ngắn tới `Code.gs` → không vướng giới hạn 6 phút / lần chạy của Apps Script, chạy song song được.
- Bộ file ở `tools/drive_clone/appsscript/`: `Code.gs`, `Index.html`, `Pipeline.html`, `App.html` (bộ cài gộp còn 2 file).
- **Không cần sửa `appsscript.json`** (bản 21/10/2026, theo lựa chọn của bạn): Apps Script tự xin quyền theo code —
  Google Drive đầy đủ + gọi Google API. Màn hình hỏi quyền ghi "xem, sửa, xoá mọi file Drive"; tool vẫn chỉ **đọc**
  A và **tạo mới** trong B, B dán được bất kỳ thư mục bạn có quyền sửa.

### Cài 1 lần cho cả team (quản trị viên, ~3 phút)

1. Tool Kit → **Drive Clone** → **Tải bộ Apps Script (.zip)** (hoặc bấm copy từng file).
2. <https://script.google.com> → New project. Dán **2 file**: `Code.gs` (đè file có sẵn) và `Index` (**+ → HTML**, gõ
   `Index`, KHÔNG gõ `.html` — gõ thêm sẽ thành `Index.html.html`). `Index.html` đã gộp sẵn `Pipeline.html` + `App.html`.
3. Chọn hàm `kiemTraQuyen` (ô cạnh **▷ Run**) → **Run** → **Allow** → Execution log phải báo "ĐỦ quyền ✓".
4. **Deploy → New deployment → Web app**: *Execute as* = **User accessing the web app**, *Who has access* =
   **Anyone with Google account** (Google Workspace: **Anyone within <tên miền>** — không còn cảnh báo
   "unverified"). Copy **Web app URL**.
5. Dán URL vào trang Drive Clone của Tool Kit → **Lưu**. Mọi người bấm **Mở Drive Clone**.

Lần đầu mỗi người mở: chọn tài khoản → *Google hasn't verified this app* → **Advanced → Go to Drive Clone
(unsafe) → Allow** (app nội bộ của team). Cập nhật bản mới: dán lại 2 file → *Manage deployments → Edit →
New version* (link giữ nguyên). Xem thử không cần Google: **Tải bản Demo (.html)** — mở bằng trình duyệt, chạy
trên Drive giả lập.

### Cách dùng (trong web app)

| Bước | Việc |
|---|---|
| Nguồn dữ liệu | **Google Drive của tôi**, hoặc **Demo** (Drive giả lập trong trình duyệt) |
| 1 · A và B | Dán link A → **Quét A**. B để trống = thư mục mới trong My Drive, hoặc thư mục kết quả lần trước |
| 2 · Kiểu clone | **Copy toàn bộ dữ liệu**, hoặc **Chỉ dựng khung** (file tạo vỏ rỗng, master sheet copy đầy đủ) |
| 3 · Đổi tên | Quy tắc `BSHP → PRSP`. **Aa** = không phân biệt hoa thường + giữ kiểu chữ. **.\*** = regex (`\1` dùng được) |
| 4 · Tuỳ chọn | Gộp khi trùng tên, ghi Change Log lên Drive, đổi link, tab mục lục `_INDEX_AUTO`, số việc song song |
| 5 · Xem trước | Cây thư mục kèm tên mới. Chọn tay từng mục: copy / vỏ rỗng / bỏ qua |
| Chạy | **Chạy thử** trước: ra Change Log dự kiến, không tạo gì. Ổn rồi mới bấm **Clone thật** |

### Change Log

Mỗi lần chạy có:

- **Google Sheet** `Change Log – <A> – <giờ>` đặt ngay trong thư mục bản sao,
  gồm tab *Summary* và tab *Change Log*. Dòng đổi tên tô xanh, dòng lỗi tô đỏ.
- **CSV** tải từ giao diện. File có BOM nên Excel hiển thị đúng tiếng Việt.
- *Lịch sử chạy* trong web app (lưu trên trình duyệt của bạn, 30 lần gần nhất) kèm link bản sao + Change Log.

Cột trong Change Log: Time, Type, Status, Renamed, Old/New Name, Old/New Path,
Note, MIME, Size, Old/New Link, Source/New ID.

| Status | Nghĩa |
|---|---|
| `CREATED` / `MERGED` | Tạo thư mục mới / gộp vào thư mục cùng tên đã có ở B |
| `COPIED` / `SKELETON` / `SHORTCUT` | Copy đầy đủ / tạo vỏ rỗng / tạo shortcut |
| `EXISTS` | B đã có file cùng tên nên giữ nguyên, không ghi đè |
| `SKIPPED` | Bị loại theo thiết lập |
| `ERROR` | Lỗi, ví dụ file bị chặn copy. Các file khác vẫn chạy tiếp |

### Hậu kiểm (tự chạy sau khi clone)

Tool **quét lại thư mục đích từ đầu** rồi đối chiếu với kế hoạch, không tin vào
dữ liệu nó vừa ghi.

| # | Đạt khi |
|---|---|
| C1 | Đủ mọi thư mục |
| C2 | File đúng tên, đúng loại |
| C3 | File vỏ thật sự rỗng. Google Doc đọc nội dung thật, không dựa vào dung lượng |
| C4 | Bản đầy đủ copy trọn nội dung (so dung lượng với bản gốc) |
| C5 | Link trong master đã trỏ sang cây mới |
| C6 | Không có link gãy |
| C7 | Không có mục lạ ở đích (WARN nếu B vốn đã có sẵn đồ) |
| C8 | Không có thao tác lỗi |
| C9 | Không còn tên nào ở đích chứa chuỗi cũ (vd `BSHP`). Soát tên thật trên Drive |

### Bị ngắt giữa chừng?

Bấm **Dừng** bất cứ lúc nào. Muốn chạy tiếp thì bấm **Clone thật** lần nữa với
cùng thiết lập (giữ tick *gộp khi trùng tên*). Mục đã có sẽ được bỏ qua, nên
không tạo trùng.

Tool đánh dấu mọi thứ nó tạo ra (`appProperties.gdk_src`). Nhờ vậy, lần chạy sau
phân biệt được bản do tool tạo (được phép đổi link lại) với file có sẵn của
người dùng (không bao giờ bị sửa).

### Cần biết

- Tool chỉ **đọc** A và **tạo mới** trong B. Không sửa, không xoá gì ở A.
- Chỉ đổi **tên**. Chữ "BSHP" bên trong nội dung Docs/Sheets giữ nguyên.
- Đổi link chỉ áp dụng cho **Google Sheet** và **.xlsx** (Google Doc thì không).
  Nếu cần mục lục link, dùng tab `_INDEX_AUTO`.
- Comment và lịch sử phiên bản không được copy theo. Đây là giới hạn của Google
  Drive.
- File bị chủ sở hữu chặn copy sẽ thành dòng `ERROR` trong Change Log.
- Nếu B nằm bên trong A, tool tự bỏ qua B để không tự copy vào chính nó.
- B là bất kỳ thư mục tài khoản của bạn có quyền sửa (Editor); để trống = tạo thư mục mới trong My Drive.
- Mở web app báo "Sorry, unable to open the file" khi trình duyệt đăng nhập nhiều tài khoản Google: mở trong cửa
  sổ ẩn danh hoặc đăng xuất bớt — giới hạn của Apps Script.
- Bản Python cũ (`pipeline.py`, `changelog.py`, `gdrive.py`) giữ lại làm bản đối chiếu thuật toán; selftest vẫn
  chạy. Logic chạy thật nằm ở `appsscript/Pipeline.html`.

---

## Thêm tool mới

Server tự tìm tool, không cần đăng ký tay. Một tool gồm 2 phần:

```
tools/<ten_tool>/__init__.py     # Python: TOOL + api()
web/tools/<id>.js                # giao diện
```

`tools/<ten_tool>/__init__.py`:

```python
TOOL = {
    "id": "level-diff", "name": "Level Diff", "tagline": "So 2 bộ level",
    "desc": "…", "category": "Level", "icon": "layers",   # tên icon trong web/assets/app.js
    "tags": ["level"], "needs": [], "version": "1.0",
}

def api(action, body, query):          # POST/GET /api/tools/level-diff/<action>
    if action == "run":
        return {"ok": True}
    raise ToolError("Không có action: " + action)   # from core import ToolError
```

`web/tools/level-diff.js`:

```js
GDK.tools["level-diff"] = {
  mount(el, meta) {
    el.innerHTML = `<section class="panel"><div class="pb">…</div></section>`;
    // GDK.api("tools/level-diff/run", {...}) — tự kèm header bảo mật
    return () => {};   // dọn dẹp khi rời trang
  },
};
```

Tool chỉ chạy trên trình duyệt (như 6 tool phân tích) không cần `api` riêng.
Khai báo thêm vào `TOOLS` trong `tools/gd_kit/__init__.py`, gồm:

- `scripts`: phần tính toán ở `web/lib/*.js` (test bằng Node ở `tests/js/`);
- `example`: câu ví dụ, đầu vào, các bước — hiện ở khung *Ví dụ & cách dùng*;
- ảnh minh hoạ: thêm vào `web/assets/illus.js` theo `id` tool.

`mount()` trả về `{ cleanup, sample, template }` thì khung ví dụ tự có nút
**Thử với dữ liệu mẫu** và **Tải file mẫu**.

Dùng chung được:

- `GDK.kit` (`web/assets/kit.js`): ô thả file CSV / Excel / dán từ Sheets, ghép
  cột tự động, bảng sắp xếp được, biểu đồ đường có tooltip, biểu đồ khoảng tin
  cậy, ô số liệu, danh sách vấn đề, xuất CSV, copy.
- `GDK.lib.table`: đọc CSV, đọc số kiểu VN / EN, tự ghép cột.
- Phía Python:
  - cần Google Drive / Sheets: làm như Drive Clone — web app Google Apps Script chạy bằng tài khoản người dùng (kết nối OAuth trên máy chủ đã tắt);
  - `core.jobs.start(name, fn)` để chạy việc lâu ở nền (có nhật ký, tiến độ, nút dừng);
  - `out/<id>/` để lưu kết quả.
- Class CSS: `panel`, `btn`, `stats`, `tbl`, `chip`, `badge`, `note`, `issue`…
- Màu biểu đồ `--s1..--s4` đã kiểm tra an toàn cho người mù màu ở cả nền sáng và
  nền tối. Tối đa 4 series mỗi biểu đồ.


### Bật / tắt và sắp xếp tool (quản trị viên)

Không cần sửa code — quản trị viên làm ngay trên web, có 2 chỗ:

- **Trang chủ → nút “Sắp xếp”** (cạnh ô tìm tool): kéo thả thẻ để đổi vị trí, bấm công tắc để bật / tắt.
- **Quản lý → Tools**: danh sách đầy đủ, kéo tay nắm ⋮⋮ (hoặc bấm vào rồi dùng phím ↑ ↓), công tắc bật / tắt,
  nút mở tool để thử.

Mọi thay đổi tự lưu vào `data/tools.json`, áp dụng cho cả team (người khác thấy khi về trang chủ / tải lại).

- **Tắt** tool: người dùng thường không thấy ở trang chủ, tìm kiếm (Ctrl K), số đếm, và máy chủ từ chối gọi
  chức năng của tool đó (403). Quản trị viên vẫn mở được bằng link để thử.
- **Tự sắp theo thứ tự mặc định** (bật sẵn): thứ tự theo `"order"` khai báo trong code — tool mới tự vào đúng
  chỗ. Kéo thả sẽ chuyển sang thứ tự tuỳ chỉnh; bật lại công tắc này là về mặc định nhưng thứ tự đã kéo vẫn
  được giữ (tắt công tắc là dùng lại). Nút **Về mặc định** xoá hẳn thứ tự tuỳ chỉnh.
- Tool mới thêm khi đang dùng thứ tự tuỳ chỉnh: tự chèn ngay sau tool đứng trước nó ở thứ tự mặc định.

Khai báo `"hidden": True` trong code (`TOOL` / `TOOLS` trong `tools/<pkg>/__init__.py`) nay nghĩa là
**mặc định tắt** — quản trị viên bật lên được trên web. Đang mặc định tắt: **Level Funnel**, **AB Readout**.

## Kiểm thử

```bash
python server.py test
```

Lệnh này chạy toàn bộ selftest, offline:

- **Lớp lõi & bảo mật** có khoảng 100 kiểm tra (gồm tài khoản: tạo / mật khẩu tạm / quyền / khoá / xoá, dò mật khẩu theo tên và theo máy, nhật ký sử dụng, chuyển từ bản 1 mật khẩu, chặn máy ngoài mạng nội bộ, kết nối Google kiểu OAuth đã tắt, Drive Clone: link web app + tải bộ Apps Script). Lệnh dựng server thật trên cổng ngẫu
  nhiên (dữ liệu tạm) rồi thử: chưa đăng nhập, dò mật khẩu bị khoá, cookie giả,
  phiên hết hạn / ghi nhớ, đổi mật khẩu, thiếu khoá phiên, Host lạ, path
  traversal, sai Content-Type. Nó
  cũng kiểm tra mã hoá DPAPI, Excel có mật khẩu, chống chèn công thức, và so bộ
  đọc Excel nhanh với openpyxl, và chạy thật 2 server trên cùng 1 cổng để chắc
  bản mới tắt được bản cũ (trước v1.3, Windows cho 2 bản cùng nghe 1 cổng nên trình
  duyệt vẫn vào bản cũ).
- **Phần tính toán chạy trên trình duyệt** có 63 nhóm test JS (chạy bằng Node nếu
  máy có), gồm cả mã hoá file .html tự giải mã và 15 nhóm của Level Preview (đọc từng
  game, ghép bộ, soát lỗi, bố cục không chồng nhau, so sánh, đoán cấu trúc game mới,
  SVG, zip), 13 nhóm của Level Stuck (luật từng cơ chế CDS, bộ giải, chạy lại lời giải,
  đối chứng âm, kết luận 8 level mẫu, báo cáo, gói .md) và 9 nhóm của Drive Clone bản Apps Script (đổi tên,
  dựng khung, copy toàn bộ, chạy lại không trùng, dừng / chạy tiếp, hậu kiểm bắt lỗi, Code.gs gọi Google API đúng cách).
- **Level Preview** (server) có 11 kiểm tra cho phần lưu cấu hình game mới.
- **Drive Clone** có 77 kiểm tra trên
Drive giả lập: 2 chế độ clone, đổi tên giữ kiểu chữ, chạy lại không trùng, dừng
rồi chạy tiếp, file cấm copy, B nằm trong A, chạy thử không ghi. Có cả các ca
**cố tình làm hỏng** để chứng minh hậu kiểm bắt được lỗi, phần chạy song song
(phải ra kết quả giống hệt chạy 1 luồng), và phần nối dây với Google API thật
(giả lập HTTP).

Nên chạy lệnh này sau mỗi lần sửa code.

## Cấu trúc

| Đường dẫn | Việc |
|---|---|
| `start.bat` | Mở Tool Kit (tự tạo `.venv` lần đầu) |
| `server.py` | HTTP server localhost, định tuyến API, tự nạp tool |
| `core/` | Dùng chung: tài khoản + phiên + nhật ký sử dụng (`users.py`, SQLite), băm mật khẩu (`login.py`), người dùng của request hiện tại (`context.py`), đăng nhập Google theo từng người (`google_auth.py`), mã hoá bí mật DPAPI (`secure.py`), nhật ký bảo mật (`audit.py`), xuất Excel / mật khẩu (`exporter.py`), đọc Excel nhanh (`tables.py`), job nền, cài thư viện, `selftest.py` |
| `tools/drive_clone/` | `appsscript/` = Drive Clone chạy thật (web app Apps Script: `Code.gs` gọi Drive / Sheets API, `Pipeline.html` lõi nghiệp vụ + Drive giả lập, `App.html` giao diện); `__init__.py` lưu link web app + phát bộ file / bản Demo; `pipeline.py` … = bản Python cũ để đối chiếu, `selftest.py` |
| `tools/gd_kit/` | Khai báo 6 tool phân tích chạy trên trình duyệt |
| `tools/level_preview/` | Khai báo Level Preview + API lưu cấu hình đọc file của game mới (`data/level_games.json`), `selftest.py` |
| `web/` | Giao diện: `index.html`, `login.html` + `assets/login.js` (đăng nhập), `assets/admin.js` (trang Quản lý), `assets/app.*` (khung), `assets/kit.*` (khối dùng chung), `assets/illus.js` (ảnh minh hoạ), `tools/*.js` (giao diện từng tool) |
| `web/lib/` | Phần tính toán thuần JS (table, funnel, abtest, configdiff, datalint, curve, secure). Level Preview: `levelkit.js` (level chuẩn, bố cục, soát lỗi, so sánh, đọc theo cấu hình), `level-adapters.js` (đọc từng game), `levelset.js` (đọc thư mục, ghép bộ, file tag / thứ tự), `levelrender.js` (vẽ SVG), `zip.js` |
| `tools/level_stuck/` | Khai báo Level Stuck (chạy trên trình duyệt). Lõi `web/lib/stuckkit.js` (luật CDS + water sort, bộ giải, hậu kiểm, báo cáo), `web/lib/stuck-worker.js` (chạy song song), gói phương pháp `web/docs/check-level-stuck.md` |
| `web/assets/table-worker.js` | Đọc CSV trong luồng nền |
| `web/assets/mascot.js`, `mascot3d.js` | Linh vật: bản SVG hiện ngay, máy có WebGL2 tự chuyển sang bản 3D (dựng bằng code, không có file model) |
| `web/assets/vendor/three.module.min.js` | three.js r170 (giấy phép MIT, xem `three.LICENSE.txt`) — để sẵn trong máy, không cần Internet |
| `tests/js/` | Test Node cho `web/lib/` |
| `data/` | `gdk.db` (tài khoản — mật khẩu chỉ lưu băm, phiên — chỉ lưu SHA-256, nhật ký sử dụng), `logs/usage-YYYY-MM.csv`, `server.json` (bật mạng nội bộ), `credentials.dat`, `google/token-<id>.dat` (đã mã hoá, riêng từng người), `audit.log`, `level_games.json` — đã gitignore |
| `out/` | Kết quả các lần chạy (đã gitignore) |

Chi tiết các lớp bảo vệ: xem mục **Bảo mật** ở trên.

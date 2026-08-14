# Dashboard Kinh Doanh — Thầu / KPI / Sale

Website theo dõi 3 mảng dữ liệu, lấy trực tiếp (live) từ 4 Google Sheet hiện có
của bạn, không cần nhập liệu lại:

1. **Tiến độ Thầu** theo từng tỉnh / từng khách hàng (kế hoạch vs thực hiện,
   cảnh báo hợp đồng sắp hết hạn mà tỷ lệ thực hiện còn thấp).
2. **KPI từng nhân viên** (rút gọn theo nhóm chính: doanh số kê đơn, doanh số
   thầu, sản phẩm trọng tâm, nhân sự, coaching call, tổng điểm TH/KH, xếp hạng),
   có kèm hoạt động viếng thăm khách hàng (checkin GPS).
3. **Data sale khách hàng** (doanh thu theo thời gian / tỉnh / nhóm hàng, top
   khách hàng, chi tiết từng đơn).

## Kiến trúc

```
Google Sheets (4 file bạn đang dùng)
        │  (Apps Script đọc trực tiếp, KHÔNG copy dữ liệu ra đâu khác)
        ▼
Google Apps Script — triển khai thành "Web app" trả về JSON
        │  (gọi qua fetch, dữ liệu luôn mới nhất)
        ▼
Website tĩnh (HTML/CSS/JS thuần, không framework) — host trên Netlify
        │  (được khoá bằng mật khẩu chung qua Netlify Function)
        ▼
Trình duyệt người dùng
```

Không có bước đồng bộ hay lưu trữ trung gian — mỗi lần mở trang / bấm "Làm
mới", trang gọi thẳng vào Apps Script, Apps Script đọc trực tiếp từ 4 Google
Sheet tại thời điểm đó.

## Cấu trúc thư mục

```
apps-script/Code.gs        → dán vào Google Apps Script (backend/API)
site/                       → toàn bộ frontend, publish lên Netlify
  index.html
  style.css
  app.js
  config.js                → SỬA FILE NÀY sau khi deploy Apps Script
netlify/functions/login.js  → kiểm tra mật khẩu chung (Netlify Function)
netlify.toml                → cấu hình build cho Netlify
```

---

## BƯỚC 1 — Triển khai Apps Script (API dữ liệu)

1. Mở https://script.google.com/ → **Dự án mới**.
2. Xoá hết code mẫu trong `Code.gs`, dán toàn bộ nội dung file
   `apps-script/Code.gs` (trong bộ file này) vào.
3. File đã có sẵn ID của 4 Google Sheet bạn gửi (KPI, checkin, sale, thầu) —
   không cần sửa gì nếu bạn dùng đúng 4 file đó. Nếu muốn đổi mật khẩu API,
   sửa dòng:
   ```js
   API_KEY: 'thay-doi-chuoi-nay',
   ```
   thành một chuỗi bất kỳ do bạn đặt (nhớ đổi giống hệt trong
   `site/config.js` ở Bước 2).
4. Bấm **Triển khai (Deploy) → Triển khai mới (New deployment)**.
   - Loại: **Ứng dụng web (Web app)**
   - Thực thi với quyền của (Execute as): **Tôi (email của bạn)**
   - Người có quyền truy cập (Who has access): **Bất kỳ ai (Anyone)**
5. Lần đầu triển khai, Google sẽ yêu cầu **cấp quyền** truy cập 4 Google Sheet
   — bấm cho phép (chọn tài khoản Google có quyền xem 4 sheet đó).
6. Sau khi triển khai xong, copy **URL ứng dụng web**, dạng:
   `https://script.google.com/macros/s/xxxxxxxxxxxxxxxxxxxxxxxxxxxx/exec`

   Kiểm tra nhanh: dán URL đó + `?type=ping` vào trình duyệt, ví dụ:
   `.../exec?type=ping&key=thay-doi-chuoi-nay` → phải thấy
   `{"ok":true, ... "data":{"pong":true}}`.

**Lưu ý quan trọng:** mỗi khi bạn sửa `Code.gs` sau này, phải vào **Quản lý
triển khai (Manage deployments) → biểu tượng bút chì → Phiên bản mới (New
version) → Triển khai** thì URL mới nhận code mới (không tự cập nhật).

## BƯỚC 2 — Cập nhật URL vào frontend

Mở `site/config.js`, sửa:

```js
API_URL: 'https://script.google.com/macros/s/.../exec',   // URL từ bước 1
API_KEY: 'thay-doi-chuoi-nay',                             // giống hệt Code.gs
```

## BƯỚC 3 — Đưa lên Netlify

**Cách A — kéo thả (nhanh nhất, không cần Git):**
1. Vào https://app.netlify.com/ → **Add new site → Deploy manually**.
2. Kéo thả **toàn bộ thư mục** `webapp/` (chứa `netlify.toml`, `site/`,
   `netlify/functions/`) vào ô upload.

**Cách B — qua GitHub (khuyến nghị nếu sẽ sửa code nhiều lần):**
1. Đẩy toàn bộ thư mục này lên một repo GitHub.
2. Trên Netlify: **Add new site → Import from Git** → chọn repo đó.
3. Build command: để trống. Publish directory: `site`. Functions directory:
   `netlify/functions` (đã khai báo sẵn trong `netlify.toml`, Netlify sẽ tự
   nhận).

## BƯỚC 4 — Đặt mật khẩu chung

Trên Netlify: **Site settings → Environment variables → Add a variable**:

| Key | Value |
|---|---|
| `SITE_PASSWORD` | mật khẩu bạn muốn dùng chung cho cả team |
| `AUTH_SECRET` | một chuỗi bất kỳ, càng dài random càng tốt (dùng để ký token nội bộ) |

Sau khi thêm biến môi trường, vào **Deploys → Trigger deploy → Deploy site**
để Netlify build lại và nhận biến mới.

## BƯỚC 5 — Kiểm tra

Mở URL Netlify (dạng `https://ten-site.netlify.app`) → nhập mật khẩu →
dashboard sẽ tự gọi Apps Script và hiển thị dữ liệu.

---

## Cách dữ liệu được đọc & tính toán

- **Thầu**: đọc trực tiếp sheet `THAU`. Tỷ lệ hoàn thành = SL thực hiện / SL
  kế hoạch thực (nếu có), hoặc / SL kế hoạch nếu chưa có kế hoạch thực. Mục
  "cảnh báo" lọc hợp đồng còn ≤ 60 ngày hiệu lực và tỷ lệ thực hiện < 60%.
- **KPI**: đọc tab **cuối cùng** (bên phải nhất) trong file KPI — quy ước là
  tab của tháng gần nhất. Bảng gốc có ~230 cột chia theo nhiều nhóm chỉ tiêu;
  script tự nhận diện các nhóm theo tiêu đề (không hard-code số cột) và gộp
  thành: Doanh số kê đơn, Doanh số thầu, SP trọng tâm, Nhân sự, Coaching
  call, Điểm cộng/trừ, và Tổng điểm TH/KH/Xếp hạng lấy trực tiếp từ 5 cột
  tổng kết cuối bảng. Khi bạn thêm tab tháng mới, script tự động dùng tab mới
  nhất — **không cần sửa code**, miễn tab mới có cùng cấu trúc tiêu đề.
- **Checkin**: sheet log GPS được gộp theo nhân viên (tổng lượt checkin, số
  khách hàng đã ghé thăm, lượt trong 7/30 ngày gần nhất) để hiển thị trong
  phần chi tiết mỗi nhân viên ở tab KPI — không hiển thị toàn bộ 10,000+ dòng
  thô để tránh nặng trang.
- **Sale**: đọc trực tiếp sheet `Sale T1-T7`, filter theo tỉnh / nhân viên /
  nhóm hàng / khoảng ngày ngay trên trình duyệt (dữ liệu ~2,000 dòng nên lọc
  phía client cho nhanh, không cần gọi lại server mỗi lần đổi bộ lọc).

## Giới hạn bảo mật cần biết

Đây là giải pháp **mật khẩu chung, dễ triển khai** theo đúng lựa chọn ban
đầu — không phải bảo mật cấp doanh nghiệp:

- Mật khẩu (`SITE_PASSWORD`) được kiểm tra qua Netlify Function phía server
  nên **không** bị lộ trong code frontend.
- Tuy nhiên, `API_KEY` trong `site/config.js` và URL Apps Script **có nằm
  trong code JS công khai** của trang — ai xem được mã nguồn trình duyệt
  (F12) đều có thể lấy URL này và gọi thẳng API mà không cần qua trang đăng
  nhập. `API_KEY` chỉ giúp chặn người lạ dò URL Apps Script ngẫu nhiên trên
  Internet, không chặn được người đã từng đăng nhập hợp lệ vào trang.
- Nếu cần bảo mật chặt hơn (ví dụ dữ liệu doanh thu/KPI rất nhạy cảm), nên
  nâng cấp lên đăng nhập bằng **tài khoản Google giới hạn theo email công
  ty** — có thể làm ở lần sau, cấu trúc code hiện tại (Apps Script tách
  riêng khỏi frontend) hỗ trợ nâng cấp này mà không phải viết lại từ đầu.

## Khi cần chỉnh sửa / mở rộng sau này

- Đổi ngưỡng màu tốt/vàng/đỏ của thanh tiến độ: sửa `THRESHOLDS` trong
  `site/config.js`.
- Đổi tên công ty / tiêu đề trang: sửa `APP_TITLE` trong `site/config.js`.
- Muốn tự động làm mới dữ liệu định kỳ (không cần bấm nút): có thể thêm
  `setInterval(loadAll, ...)` trong `site/app.js` — hỏi lại nếu cần, mình sẽ
  bổ sung.
- Nếu một trong 4 Google Sheet đổi cấu trúc cột/tiêu đề, phần đọc dữ liệu
  tương ứng trong `Code.gs` có thể cần cập nhật lại theo tên cột mới.

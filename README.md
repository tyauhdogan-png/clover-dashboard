Dashboard Kinh Doanh — Thầu / KPI / Sale
Website theo dõi 3 mảng dữ liệu, lấy trực tiếp (live) từ 4 Google Sheet hiện có
của bạn, không cần nhập liệu lại:
Tiến độ Thầu theo từng tỉnh / từng khách hàng (kế hoạch vs thực hiện,
cảnh báo hợp đồng sắp hết hạn mà tỷ lệ thực hiện còn thấp).
KPI từng nhân viên — mỗi người có 1 bảng điểm KPI riêng (10 chỉ tiêu +
điểm cộng thêm), xem theo tên, nhân viên tự sửa cột "Thực hiện" của
chính mình ngay trên web (Admin sửa được của tất cả mọi người), điểm và
tổng điểm tự tính lại theo công thức, lưu thẳng về Google Sheet.
Data sale khách hàng (doanh thu theo thời gian / tỉnh / nhóm hàng, top
khách hàng, chi tiết từng đơn).
Kiến trúc
```
Google Sheets (4 file bạn đang dùng)
        │  (Apps Script đọc trực tiếp, KHÔNG copy dữ liệu ra đâu khác)
        ▼
Google Apps Script — triển khai thành "Web app" trả về JSON
        │  (gọi qua fetch, dữ liệu luôn mới nhất)
        ▼
Website tĩnh (HTML/CSS/JS thuần, không framework) — host trên Netlify
        │  (được khoá bằng tài khoản đăng nhập riêng từng người, qua Netlify Function)
        ▼
Trình duyệt người dùng
```
Không có bước đồng bộ hay lưu trữ trung gian — mỗi lần mở trang / bấm "Làm
mới", trang gọi thẳng vào Apps Script, Apps Script đọc trực tiếp từ 4 Google
Sheet tại thời điểm đó.
Cấu trúc thư mục
```
apps-script/Code.gs        → dán vào Google Apps Script (backend/API)
site/                       → toàn bộ frontend, publish lên Netlify
  index.html
  style.css
  app.js
  config.js                → SỬA FILE NÀY sau khi deploy Apps Script
netlify/functions/login.js    → kiểm tra tên đăng nhập/mật khẩu (Netlify Function)
netlify/functions/messages.js → mục "Trao đổi" (chat Admin ↔ nhân viên)
netlify/functions/kpi.js      → lưu số liệu "Thực hiện" trong mục KPI
netlify/functions/thau.js     → lưu "Ghi chú" theo từng hợp đồng trong mục Thầu
netlify/functions/tasks.js    → mục "Giao việc" (giao nhiệm vụ, phản hồi)
netlify/functions/task-ack.js → xác nhận "Đã nhận mail" khi bấm nút trong email (công khai, không cần đăng nhập)
netlify.toml                → cấu hình build cho Netlify
```
---
BƯỚC 1 — Triển khai Apps Script (API dữ liệu)
Mở https://script.google.com/ → Dự án mới.
Xoá hết code mẫu trong `Code.gs`, dán toàn bộ nội dung file
`apps-script/Code.gs` (trong bộ file này) vào.
File đã có sẵn ID của 4 Google Sheet bạn gửi (KPI, checkin, sale, thầu) —
không cần sửa gì nếu bạn dùng đúng 4 file đó. Nếu muốn đổi mật khẩu API,
sửa dòng:
```js
   API_KEY: 'thay-doi-chuoi-nay',
   ```
thành một chuỗi bất kỳ do bạn đặt (nhớ đổi giống hệt trong
`site/config.js` ở Bước 2).
Bấm Triển khai (Deploy) → Triển khai mới (New deployment).
Loại: Ứng dụng web (Web app)
Thực thi với quyền của (Execute as): Tôi (email của bạn)
Người có quyền truy cập (Who has access): Bất kỳ ai (Anyone)
Lần đầu triển khai, Google sẽ yêu cầu cấp quyền truy cập 4 Google Sheet
— bấm cho phép (chọn tài khoản Google có quyền xem 4 sheet đó).
Sau khi triển khai xong, copy URL ứng dụng web, dạng:
`https://script.google.com/macros/s/xxxxxxxxxxxxxxxxxxxxxxxxxxxx/exec`
Kiểm tra nhanh: dán URL đó + `?type=ping` vào trình duyệt, ví dụ:
`.../exec?type=ping&key=thay-doi-chuoi-nay` → phải thấy
`{"ok":true, ... "data":{"pong":true}}`.
Lưu ý quan trọng: mỗi khi bạn sửa `Code.gs` sau này, phải vào Quản lý
triển khai (Manage deployments) → biểu tượng bút chì → Phiên bản mới (New
version) → Triển khai thì URL mới nhận code mới (không tự cập nhật).
BƯỚC 2 — Cập nhật URL vào frontend
Mở `site/config.js`, sửa:
```js
API_URL: 'https://script.google.com/macros/s/.../exec',   // URL từ bước 1
API_KEY: 'thay-doi-chuoi-nay',                             // giống hệt Code.gs
```
BƯỚC 3 — Đưa lên Netlify
⚠️ Lưu ý quan trọng: trang này có một phần chạy trên server (Netlify
Function `login.js`, dùng để kiểm tra mật khẩu). Kiểu deploy "kéo thả"
(Deploy manually / Netlify Drop) của Netlify KHÔNG chạy phần này và
KHÔNG đọc file `netlify.toml` — nếu bạn kéo thả, trang sẽ hiển thị được
(có giao diện, có style) nhưng bấm "Đăng nhập" sẽ luôn báo lỗi, vì
server-side chưa được bật. Vì vậy bắt buộc phải deploy qua GitHub như
dưới đây (không cần biết dùng dòng lệnh Git, làm hết trên trình duyệt được):
Vào https://github.com/ → New repository → đặt tên bất kỳ (vd.
`dashboard-kinh-doanh`) → tạo repo (để Public hoặc Private đều
được).
Trong trang repo vừa tạo, bấm "uploading an existing file" (hoặc
Add file → Upload files) → kéo thả toàn bộ nội dung bên trong
thư mục `webapp/` (tức là kéo `netlify.toml`, `site/`, `netlify/`,
`README.md`, `package.json` — không kéo bản thân thư mục `webapp` vào
trong, mà kéo từng thứ bên trong nó ra) → bấm Commit changes.
Vào https://app.netlify.com/ → Add new site → Import an existing
project → Deploy with GitHub → chọn repo vừa tạo.
Ở màn hình cấu hình build: Build command để trống, Publish
directory để `site` (Netlify thường tự điền đúng vì đã có
`netlify.toml`, cứ kiểm tra lại cho chắc) → bấm Deploy.
Sau bước này, mỗi khi bạn sửa file nào trong repo GitHub (kể cả sửa trực
tiếp trên web GitHub), Netlify sẽ tự động deploy lại — không cần làm lại
từ đầu.
BƯỚC 4 — Tạo danh sách tài khoản đăng nhập (tài khoản chính + tài khoản nhân viên)
Thay vì 1 mật khẩu chung, mỗi người có tên đăng nhập + mật khẩu riêng.
Danh sách tài khoản được quản lý ngay trong Google Sheet — muốn thêm/xoá/khoá
ai, chỉ cần sửa 1 dòng trong sheet, không cần đụng code.
Mở file Google Sheet KPI (file đầu tiên trong 4 file bạn gửi) → tạo
thêm 1 tab mới, đặt tên chính xác là `TAI_KHOAN` (viết hoa, gạch
dưới, không dấu).
Dòng 1 (tiêu đề), gõ đúng 5 cột theo thứ tự này:
Tên đăng nhập	Mật khẩu	Họ tên	Vai trò	Hoạt động
Từ dòng 2 trở đi, mỗi dòng là 1 tài khoản. Ví dụ:
Tên đăng nhập	Mật khẩu	Họ tên	Vai trò	Hoạt động
admin	MatKhauCuaBan123	Nguyễn Văn A	admin	TRUE
sen.tth	123456	Trương Thị Hồng Sen	nhanvien	TRUE
hiep.lbq	123456	Lê Bùi Quang Hiệp	nhanvien	TRUE
Cột Vai trò: gõ `admin` cho tài khoản chính của bạn, `nhanvien` cho
các tài khoản còn lại (chỉ để phân biệt, hiện tại ai đăng nhập cũng xem
được toàn bộ dashboard như nhau).
Cột Hoạt động: để `TRUE` (hoặc để trống) nếu tài khoản được phép
đăng nhập; đổi thành `FALSE` để tạm khoá 1 người mà không cần xoá dòng.
Tên đăng nhập nên viết liền không dấu, không khoảng trắng cho dễ gõ.
Vì bạn vừa sửa `Code.gs` (nếu bạn tự thêm tab này sau khi đã deploy Apps
Script) thì không cần deploy lại Apps Script — script tự đọc tab mới
mỗi lần có người đăng nhập.
BƯỚC 5 — Cấu hình biến môi trường trên Netlify
Trên Netlify: vào project → Project configuration → Environment
variables → Add a variable, thêm đúng 3 biến sau (tên phải viết hoa y hệt):
Key	Value
`APPS_SCRIPT_URL`	URL Apps Script từ Bước 1 (giống hệt `API_URL` trong `config.js`)
`APPS_SCRIPT_KEY`	giống hệt `API_KEY` trong `Code.gs` (để trống nếu bạn để trống bên đó)
`AUTH_SECRET`	một chuỗi bất kỳ, càng dài random càng tốt (dùng để ký token nội bộ, không cần nhớ)
Sau khi thêm biến môi trường, vào Deploys → Trigger deploy → Deploy site
để Netlify build lại và nhận biến mới.
BƯỚC 6 — Kiểm tra
Mở URL Netlify (dạng `https://ten-site.netlify.app`) → nhập đúng tên đăng
nhập + mật khẩu của 1 tài khoản bạn vừa tạo trong tab `TAI_KHOAN` →
dashboard sẽ tự gọi Apps Script và hiển thị dữ liệu, góc trên bên phải hiện
"Xin chào, `<tên bạn>`".
Muốn thêm nhân viên mới sau này: chỉ cần mở lại tab `TAI_KHOAN`, thêm 1 dòng
mới — không cần deploy lại gì cả, họ đăng nhập được ngay.
---
Mục "Trao đổi" — chat riêng giữa Admin và từng nhân viên
Tài khoản admin (vai trò `admin` trong tab `TAI_KHOAN`) thấy danh sách
tất cả nhân viên bên trái, bấm vào 1 người để nhắn riêng với người đó.
Tài khoản nhân viên chỉ thấy đúng đoạn chat của mình với Admin, không
thấy được đoạn chat của người khác — việc này được kiểm tra ở phía server
(Netlify Function), không phải chỉ ẩn trên giao diện, nên không thể lách
bằng cách sửa code trình duyệt.
Tin nhắn được lưu trong 1 tab mới tên `TIN_NHAN`, nằm trong chính file
KPI — tab này tự động được tạo ngay lần đầu có ai gửi tin nhắn, bạn
không cần tạo tay. Không nên tự ý sửa tay dữ liệu trong tab này.
Trang tự động kiểm tra tin nhắn mới mỗi 12 giây khi đang mở tab Trao đổi
(không phải chat thời gian thực tức thì, nhưng đủ dùng cho trao đổi công
việc nội bộ).
Không cần thêm biến môi trường nào mới trên Netlify — dùng lại đúng 3 biến
đã có (`APPS_SCRIPT_URL`, `APPS_SCRIPT_KEY`, `AUTH_SECRET`).
Cần 1 file MỚI trong repo: `netlify/functions/messages.js` (khác với sửa
file có sẵn — bạn cần bấm Add file → Create new file trên GitHub, gõ
đúng đường dẫn `netlify/functions/messages.js`, rồi dán nội dung vào).
---
Mục "Giao việc" — admin giao nhiệm vụ, gửi mail qua n8n, nhân viên phản hồi
Tài khoản admin thấy khối "Giao việc mới" ở đầu trang: chọn 1 nhân
viên, gõ tên nhiệm vụ / nội dung / ngày thực hiện, bấm Giao việc.
Tài khoản nhân viên KHÔNG thấy khối "Giao việc mới" (chỉ admin mới giao
được việc) — chỉ thấy danh sách đúng những nhiệm vụ được giao cho mình, và
có thể tự cập nhật Trạng thái hoàn thành (Chưa bắt đầu / Đang làm /
Hoàn thành) + Ghi chú phản hồi ngay trên từng nhiệm vụ. Việc này cũng
được kiểm tra ở phía server (Netlify Function) như mục Trao đổi, không thể
lách bằng cách sửa code trình duyệt.
Nhiệm vụ được lưu trong 1 tab mới tên `GIAO_VIEC`, nằm trong chính file
KPI — tab này tự động được tạo ngay lần đầu admin giao việc, bạn không
cần tạo tay. Không nên tự ý sửa tay dữ liệu trong tab này.
Cần 2 file MỚI trong repo: `netlify/functions/tasks.js` và
`netlify/functions/task-ack.js` (bấm Add file → Create new file trên
GitHub cho từng file, gõ đúng đường dẫn, rồi dán nội dung vào).
Không cần thêm biến môi trường nào để dùng cơ bản (dùng lại đúng 3 biến đã
có). Chỉ cần thêm biến môi trường nếu muốn tự động gửi mail báo nhiệm
vụ mới — xem phần "Gửi mail tự động qua n8n" ngay dưới đây.
Gửi mail tự động qua n8n (tuỳ chọn)
Mỗi khi admin giao việc, web có thể tự gửi 1 email HTML báo cho nhân viên qua
workflow n8n, kèm 1 nút "✅ Xác nhận đã nhận nhiệm vụ" — bấm vào nút đó trong
mail sẽ tự ghi nhận lại trên web (cột "Đã nhận mail" trong tab `GIAO_VIEC`),
admin thấy ngay ai đã mở mail, ai chưa.
Mình đã dựng sẵn workflow này trong n8n của bạn, tên
"CPC1HN - Gửi mail giao việc nhân viên"
(`https://n8n.cpc1hn.com.vn/workflow/PNx4wfY4TQIFxrrQ`), dùng credential Gmail
có sẵn tên `Gmail_duy` để gửi mail — nhưng CỐ Ý ĐỂ Ở TRẠNG THÁI TẮT
(Inactive), chưa gửi được mail thật cho ai, để bạn tự kiểm tra trước khi
bật (nội dung mail, đúng người nhận…). Muốn bật:
Mở link workflow ở trên trong n8n → xem qua 3 bước: Webhook nhận dữ liệu →
node "Gửi mail giao việc" (có thể mở ra xem trước mẫu email) → phản hồi
webhook.
Bấm nút Activate (góc trên bên phải) để bật workflow.
Sau khi bật, bấm vào node "Nhận thông tin giao việc" (webhook đầu
tiên) → copy Production URL (dạng
`https://n8n.cpc1hn.com.vn/webhook/cpc1hn-giao-viec`).
Vào Netlify → Project configuration → Environment variables → Add a
variable, thêm:
Key	Value
`N8N_TASK_WEBHOOK_URL`	Production URL vừa copy ở bước 3
Deploys → Trigger deploy → Deploy site để Netlify nhận biến mới.
Từ lúc này, mỗi lần admin giao việc, nhân viên tương ứng sẽ nhận được mail
ngay. Nếu CHƯA làm bước này (hoặc chưa bật workflow), việc giao việc trên web
vẫn hoạt động bình thường, chỉ là không có mail nào được gửi — trạng thái
"Chưa gửi được mail" sẽ hiện ngay dưới nút Giao việc để bạn biết.
Email nhân viên đang dùng để gửi mail được khai báo sẵn trong
`netlify/functions/tasks.js` (hằng số `EMPLOYEE_EMAILS`, khớp đúng "Tên đăng
nhập" trong tab `TAI_KHOAN` với email nội bộ `@cpc1hn.com.vn` của từng người).
Công ty có nhân viên mới hoặc đổi mail thì sửa trực tiếp trong file này (thêm
1 dòng `'<tên đăng nhập>': '<email>',`) — không cần sửa Google Sheet hay Apps
Script.
---
Mục "KPI" — mỗi nhân viên 1 bảng điểm riêng, sửa "Thực hiện" ngay trên web
Mỗi nhân viên có 1 tab riêng trong file Google Sheet KPI, tên tab bắt
đầu bằng `KPIS` (ví dụ `KPIS HỒNG SEN`, `KPIS TẠ HOÀNG DUY`...). Trang
web tự nhận diện tất cả các tab như vậy, không quan tâm thứ tự hay số
lượng.
Trên tab KPI của web: chọn tên nhân viên ở khu vực "Chọn nhân viên" để
xem bảng điểm chi tiết của người đó, chia làm 3 phần tách biệt:
Nhóm 1 — Doanh số: Doanh số kê đơn, Doanh số thầu.
Nhóm 2 — Sản phẩm trọng tâm: tách thành từng bảng con theo tên sản
phẩm (hiện có `SUGAM-BFS` và `PROPOFOL-BFS`, mỗi sản phẩm 4 chỉ tiêu:
Khảo sát / Mở mới điểm bán / Duy trì điểm bán / Sản lượng). Trang web tự
nhận diện sản phẩm dựa vào TÊN chỉ tiêu trên sheet (không hard-code thứ
tự dòng), nên nếu công ty đổi/thêm sản phẩm trọng tâm sau này, chỉ cần
gõ tên chỉ tiêu theo đúng mẫu "Khảo sát <tên SP>", "Mở mới
điểm bán <tên SP>", "Duy trì điểm bán <tên SP>", "Sản
lượng <tên SP>" là web tự gộp đúng nhóm, không cần sửa code.
Điểm cộng thêm và Điểm trừ KPI — hiển thị tách riêng bên dưới 2
nhóm chỉ tiêu chính (xem "Điểm trừ KPI" ở mục riêng bên dưới).
Mỗi chỉ tiêu có thêm cột "Ghi chú" để nhân viên ghi chú tự do (vd lý do
chưa đạt, kế hoạch bù...).
Ai sửa được gì:
Nhân viên: chỉ sửa được (Thực hiện + Ghi chú + Điểm trừ) trong đúng bảng
KPI mang tên của chính mình (đăng nhập bằng tài khoản nào thì sửa bảng
của tài khoản đó); xem bảng của người khác thì chỉ đọc, không sửa được.
Admin: sửa được của tất cả mọi người.
Việc này được kiểm tra ở phía server (Netlify Function `kpi.js`), so
khớp tên người đăng nhập với tên chủ bảng KPI lấy trực tiếp từ Apps
Script — không thể lách bằng cách sửa code trình duyệt.
Sửa xong 1 ô (gõ số/gõ ghi chú/chọn trạng thái rồi bấm ra ngoài ô), trang tự
lưu ngay về đúng ô đó trên Google Sheet, đồng thời tự tính lại điểm của dòng
đó, tổng từng nhóm, và kết quả KPI cuối cùng — không cần bấm nút lưu
riêng, không cần tải lại trang.
Công thức tính điểm mỗi chỉ tiêu (áp dụng như nhau cho cả Nhóm 1 Doanh
số và Nhóm 2 Sản phẩm trọng tâm): Điểm thực hiện = (Thực hiện ÷ Kế hoạch) ×
Điểm kế hoạch, có giới hạn theo cột "Vượt max" của chỉ tiêu đó (ví dụ
"120%" nghĩa là dù thực hiện vượt kế hoạch bao nhiêu, tỷ lệ tính điểm cũng
không vượt quá 120%; ghi "NO LIMIT" thì không giới hạn).
Kết quả KPI cuối cùng (ĐẠT / BỊ LIỆT) — hiển thị ngay đầu phần chi tiết
mỗi nhân viên, kèm lý do cụ thể nếu bị liệt. Một nhân viên ĐẠT KPI khi thoả
TẤT CẢ các điều kiện sau (nếu thiếu dù chỉ 1 điều kiện, vẫn bị liệt dù
các điều kiện khác đạt hết):
Tổng điểm cuối cùng (= tổng điểm 10 chỉ tiêu + Điểm cộng thêm − Điểm trừ)
phải ≥ 850 điểm.
Điểm KPIs thực hiện của từng chỉ tiêu trong Nhóm 1 Doanh số (Doanh số
kê đơn, Doanh số thầu) phải lớn hơn 50% điểm kế hoạch của chính chỉ
tiêu đó (vd điểm kế hoạch 150 thì điểm thực hiện phải trên 75).
Tổng điểm thực hiện của cả Nhóm 2 Sản phẩm trọng tâm (gộp cả 2 sản
phẩm, 8 chỉ tiêu) phải từ 50% tổng điểm kế hoạch nhóm trở lên (vd
tổng kế hoạch 800 thì tổng thực hiện phải từ 400 điểm trở lên).
Các ngưỡng "850 điểm" và "50%" này đang cố định trong code (`Code.gs`,
hàm `parseKpiSheet_`) — nếu sau này công ty muốn đổi ngưỡng, cần nhờ chỉnh
lại code (không sửa được bằng cách gõ trong Sheet).
Điểm trừ KPI — mục mới, 2 hạng mục cố định: "Học LMS 4 bài / 1 tháng"
và "Tổ chức hội thảo trong quý". Mỗi hạng mục có trạng thái ĐẠT / KHÔNG
ĐẠT (chọn trong ô dropdown trên web); chọn "KHÔNG ĐẠT" thì tự trừ 80 điểm
KPI/tháng cho hạng mục đó vào tổng điểm cuối cùng. Muốn đổi mức trừ 80 điểm
thành số khác cho 1 người cụ thể: mở tab `KPIS <Tên>` của người đó trên
Google Sheet, sửa trực tiếp cột D ("Mức trừ") ở dòng hạng mục tương ứng
— không cần sửa code.
Không cần thêm biến môi trường nào mới trên Netlify — `kpi.js` dùng lại
đúng 3 biến đã có (`APPS_SCRIPT_URL`, `APPS_SCRIPT_KEY`, `AUTH_SECRET`).
Cần 1 file MỚI trong repo: `netlify/functions/kpi.js` (giống `messages.js`
trước đây — bấm Add file → Create new file trên GitHub, gõ đúng đường
dẫn `netlify/functions/kpi.js`, dán nội dung vào, Commit).
Tự nâng cấp cấu trúc Sheet, không cần bạn làm tay: lần đầu tiên mỗi tab
`KPIS <Tên>` được đọc sau khi bạn deploy bản `Code.gs` mới này, trang web sẽ
tự động thêm vào cuối tab đó: cột "Ghi chú" (cột G), phần "ĐIỂM TRỪ"
(2 hạng mục ở trên, mặc định ĐẠT), và phần "KẾT QUẢ CUỐI CÙNG" (tổng
điểm cuối cùng + kết quả ĐẠT/BỊ LIỆT + lý do, luôn tự cập nhật mỗi lần có ai
mở trang — mở thẳng Google Sheet cũng thấy số mới nhất, không chỉ trên
web). Bạn không cần tự tay thêm các phần này vào 7 tab hiện có.
Bảng xếp hạng huy chương: ở đầu tab KPI (dưới biểu đồ "Tỉ lệ hoàn
thành"), có danh sách xếp hạng toàn bộ nhân viên theo tổng điểm cuối
cùng (đã gồm cộng/trừ), 3 người cao nhất được gắn 🥇🥈🥉, kèm trạng thái
Đạt KPI / Bị liệt của từng người.
Bước một lần — tự động tạo bảng KPI cho các nhân viên còn thiếu tab
Nếu bạn chỉ mới có sẵn 1 tab KPI mẫu (ví dụ `KPIS HỒNG SEN`) và muốn tạo
nhanh tab tương tự cho những nhân viên còn lại (không phải gõ tay từng tab):
Mở lại Apps Script editor (nơi bạn dán `Code.gs`).
Ở thanh công cụ phía trên, chỗ có nút ▷ Run, mở ô chọn hàm bên cạnh nó
(mặc định đang là `doGet` hoặc tên hàm nào đó) → chọn hàm
`setupKpiSheetsForAllEmployees`.
Bấm ▷ Run. Lần đầu chạy, Google có thể hỏi cấp quyền lần nữa — bấm
cho phép.
Hàm này sẽ tự sao chép tab KPI mẫu, đổi tên thành `KPIS <Họ Tên>` cho từng
nhân viên đang hoạt động trong tab `TAI_KHOAN` (bỏ qua admin, bỏ qua ai
đã có sẵn tab KPI rồi — chạy lại nhiều lần cũng không tạo trùng).
Sau khi chạy xong, vào từng tab `KPIS <Tên>` mới được tạo, kiểm tra
và điền lại cho đúng:
Dòng "THÂM NIÊN" — hàm để tạm chỗ này là `(điền số tháng)`, bạn cần
tự điền số tháng thâm niên đúng của từng người.
Dòng "NHÓM" / "SS" — hàm mặc định copy nguyên từ tab mẫu, bạn
nên kiểm tra lại xem có cần đổi cho đúng người đó không.
Cột "Kế hoạch" của 10 chỉ tiêu — cũng copy từ tab mẫu, cần sửa lại
đúng chỉ tiêu/số liệu kế hoạch riêng của từng người nếu khác nhau.
Không cần deploy lại Apps Script cho bước này — hàm `setupKpiSheetsForAllEmployees`
chỉ chạy tay 1 lần khi cần, không liên quan gì đến việc trang web đọc dữ
liệu (`doGet`/`doPost` vẫn hoạt động bình thường trong lúc bạn chạy hàm
này).
Lưu ý — đã sửa 2 lỗi tính điểm phát hiện khi soát lại code lần này
Trong lúc làm tính năng chia nhóm/điểm trừ ở trên, phát hiện và sửa luôn 2 lỗi
có sẵn từ trước (chưa ai để ý vì trước giờ chưa có ai nhập số liệu "Thực
hiện"), không liên quan tới yêu cầu chia nhóm nhưng ảnh hưởng trực tiếp tới
độ chính xác điểm số nên cần biết:
Cột "Vượt max" từng bị bỏ qua với mọi ô định dạng %. Google Sheets lưu
ô định dạng phần trăm (vd hiển thị "120%") dưới dạng số thập phân (`1.2`),
không phải chữ "120%" — code cũ chỉ nhận diện được chữ có dấu "%" nên hiểu
nhầm mọi ô "Vượt max" dạng số là "không giới hạn", khiến điểm thực hiện có
thể tính vượt quá mức cho phép. Đã sửa để nhận đúng cả 2 dạng.
Dòng "TỔNG (1000 ĐIỂM)" trên sheet thật nằm ở cột D, không phải
cột A như code cũ kiểm tra — khiến code cũ đọc lố qua dòng TỔNG, đọc luôn
cả phần "ĐIỂM CỘNG THÊM" phía sau nhầm thành chỉ tiêu bình thường (bạn có
thể đã thấy hiện tượng này trên web: phần "Điểm cộng thêm" hiện trống,
trong khi 3 dòng thưởng lại bị lẫn vào bảng chỉ tiêu chính). Đã sửa lại để
đọc đúng cột.
Cả 2 lỗi này chỉ ảnh hưởng số liệu TÍNH TOÁN hiển thị trên web/ghi lại vào
Sheet — không làm mất dữ liệu gốc bạn đã nhập (Kế hoạch, Điểm kế hoạch, Vượt
max...). Sau khi deploy `Code.gs` mới này, mọi điểm số sẽ tự tính lại đúng
ngay lần mở trang kế tiếp, không cần thao tác gì thêm.
Cập nhật mới nhất — tổng điểm cuối trang, định dạng số, biểu đồ
Mục tổng điểm cuối trang: cuối phần chi tiết KPI của mỗi nhân viên (dưới
bảng "Điểm trừ KPI"), có thêm 1 ô nổi bật ghi "<X> điểm kpis / 1000
điểm kpis" — chính là tổng điểm cuối cùng (đã cộng "Điểm cộng thêm" và trừ
"Điểm trừ KPI") trên nền 1000 điểm cố định, để xem nhanh không cần tự cộng
trừ các phần ở trên. Lưu ý: vì "Doanh số kê đơn" không giới hạn (NO LIMIT),
ai vượt kế hoạch nhiều có thể ra số lớn hơn 1000 — đúng theo luật tính điểm,
không phải lỗi.
Định dạng số kiểu Việt Nam: cột "Kế hoạch" và "Thực hiện" giờ hiển thị có
dấu chấm phân cách hàng nghìn, ví dụ `250.000.000` thay vì `250000000` như
trước — kể cả ô "Thực hiện" đang SỬA ĐƯỢC (không chỉ khi chỉ xem): bấm vào ô
để gõ thì web tự bỏ dấu chấm cho dễ gõ số, gõ xong bấm ra ngoài ô thì web tự
thêm lại dấu chấm để dễ đọc.
Cột "Vượt max" giờ luôn hiển thị dạng phần trăm dễ đọc (`120%`) thay vì
số thập phân thô (`1.2`) — dù ô gốc trên Sheet là số %-format hay chữ, web
đều quy về cùng 1 cách hiển thị.
Biểu đồ "Tỉ lệ hoàn thành KPI" không hiện được ("Không tải được thư viện
biểu đồ"): nguyên nhân là trang web trước đây tải thư viện vẽ biểu đồ
(Chart.js) từ 1 địa chỉ CDN bên ngoài (`cdnjs.cloudflare.com`) — nếu mạng
của người xem (mạng công ty, mạng di động…) chặn hoặc không vào được địa chỉ
đó, biểu đồ trống hẳn dù số liệu vẫn đúng. Đã sửa: đóng gói thẳng file thư
viện đó vào cùng trang web (`site/vendor/chart.umd.min.js`), không phụ
thuộc CDN ngoài nữa. Đây là 1 FILE MỚI cần thêm vào repo (khác với sửa
file có sẵn) — trên GitHub: Add file → Upload files (hoặc Create new
file rồi dán đường dẫn `site/vendor/chart.umd.min.js`), tải file này lên
đúng đường dẫn đó rồi Commit. Không cần deploy lại Apps Script cho việc
này (chỉ cần Netlify build lại, việc này tự động sau khi commit).
⚠️ Lỗi đang chờ xác nhận — "Điểm KPIs thực hiện" không nhảy điểm khi gõ Thực hiện
Trên site thật, có báo lỗi là gõ số vào cột "Thực hiện" xong thì cột "Điểm
KPIs thực hiện" vẫn hiện "—" (không tính), và tổng các nhóm hiện 0. Đã kiểm
tra kỹ code tính điểm (`computeKpiRowDiem_`/`parseKpiSheet_` trong `Code.gs`)
và đọc trực tiếp dữ liệu thật trên Google Sheet — KHÔNG tìm thấy lỗi logic
nào trong code hiện tại có thể gây ra hiện tượng này với dữ liệu đang có.
Nghi ngờ nhiều nhất là bản Apps Script đang chạy trên URL thật (`.../exec`)
chưa phải là bản `Code.gs` mới nhất trong lần cập nhật này (quên bước
"Deploy → Manage deployments → bấm biểu tượng bút chì sửa bản deploy ĐANG
CHẠY → Version: New version → Deploy" — xem lại đúng BƯỚC 1 bên dưới, đặc
biệt chú ý KHÔNG bấm nhầm "New deployment", vì thao tác đó sẽ tạo ra 1 URL
`/exec` HOÀN TOÀN MỚI khác với URL đang dán trong `site/config.js`, khiến
trang web vẫn gọi vào bản code CŨ dù bạn đã sửa/deploy bản mới).
Nếu sau khi deploy lại đúng cách (kiểm tra kỹ bước trên) mà vẫn còn lỗi này,
cần gửi lại: (1) đúng URL Apps Script `.../exec` đang dán trong `config.js`
trên trang web thật, để kiểm tra trực tiếp, hoặc (2) mở trang web thật → nhấn
F12 (hoặc chuột phải → "Kiểm tra"/"Inspect") → tab Network → tải lại tab
KPI → tìm dòng gọi tới `script.google.com` → xem nội dung trả về (tab
"Response"/"Preview") → chụp màn hình gửi lại, để xác định chính xác nguyên
nhân thay vì đoán.
---
Mục "Thầu" — nâng cấp đối chiếu, cảnh báo, ghi chú (cập nhật mới nhất)
Mục Thầu đọc sheet Thầu chi tiết hơn (mỗi dòng = 1 sản phẩm trong 1 hợp đồng
tại 1 bệnh viện). So với bản trước, có 4 tính năng mới:
Tự tính lại "SL còn lại"/"Tỷ lệ %" thay vì tin trực tiếp 2 cột đó trên
sheet (một số dòng thêm sau có công thức không đúng) — công thức: SL kế
hoạch − SL thực hiện.
Đối chiếu với đơn kế toán: 1 workflow n8n (chạy 6h35 sáng mỗi ngày) đọc
sheet đơn hàng, lọc các đơn phân loại "thầu" (mã vụ việc AT/TH) của team, và
ghi tổng số lượng đã giao trong tháng vào tab `THAU_DOICHIEU` (tự tạo trong
file KPI). Code.gs đối chiếu số này với "SL còn lại" đã tự tính — nếu vượt,
hiện chip cảnh báo "⚠️ Chênh lệch" ở cột "Đối chiếu" trong bảng chi tiết
(CHỈ hiển thị cảnh báo, KHÔNG tự động sửa số liệu trong sheet Thầu).
2 khối cảnh báo tự động (tính ngay trên trình duyệt từ ngày hết hạn hợp
đồng, không cần cấu hình gì thêm): "🚨 Cảnh báo vét thầu" cho các hợp đồng
còn dưới 3 tháng (90 ngày) hiệu lực, và "🆕 Cài gói thầu mới" cho các hợp
đồng còn khoảng 5–7 tháng (150–210 ngày) hiệu lực, gộp theo từng nhân sự
phụ trách để dễ chuẩn bị trước. Cả 2 khối gộp theo Số HĐ (1 hợp đồng có
thể có nhiều dòng sản phẩm/nhiều bệnh viện có nhiều hợp đồng khác nhau).
Ghi chú theo từng hợp đồng: cột "Ghi chú" (tự thêm vào sheet Thầu nếu
chưa có) cho phép gõ ghi chú áp dụng cho CẢ hợp đồng (Số HĐ) — sửa ở bất kỳ
dòng nào thuộc hợp đồng đó trong bảng chi tiết trên web đều lưu vào đúng 1
ô đại diện trên sheet, và hiển thị lại ở MỌI dòng cùng hợp đồng. Không phân
quyền riêng — mọi tài khoản đã đăng nhập đều ghi chú được (giống việc xem
dữ liệu Thầu, không giới hạn theo người phụ trách).
Không cần thêm biến môi trường Netlify nào cho tính năng Ghi chú — file
mới `netlify/functions/thau.js` dùng lại đúng 3 biến đã có (`APPS_SCRIPT_URL`,
`APPS_SCRIPT_KEY`, `AUTH_SECRET`). Bắt buộc phải Deploy lại Apps Script
(bản `Code.gs` này có sửa/thêm hàm) theo đúng BƯỚC 1 — nếu quên, cột Đối
chiếu/Ghi chú và 2 khối cảnh báo mới sẽ không hoạt động dù đã cập nhật
`site/`.
---
Mục "Sản phẩm trọng tâm" — danh sách khách hàng theo từng nhân viên (cập nhật mới nhất)
Trong mỗi thẻ nhân viên ở tab "SP trọng tâm", bên dưới 2 thanh tiến độ
Sugam/Propofol giờ có thêm 1 khối gấp gọn "🛍️ Khách hàng đang mua (N)" —
bấm vào để mở ra danh sách các khách hàng người đó đang bán Sugam-BFS/
Propofol-BFS trong tháng, mỗi khách hàng hiện kèm badge riêng từng sản phẩm:
số lượng (ống) + số đơn hàng (đếm theo "Mã chứng từ" riêng biệt, 1 khách có
thể mua nhiều lần trong tháng thì tính gộp). Mặc định khối này ĐÓNG để thẻ
nhân viên vẫn gọn — chỉ mở ra khi bấm, giống cách khối "Theo từng nhân viên"
ở tab Giao việc đã làm.
Dữ liệu này do chính workflow n8n "Sản phẩm trọng tâm" đã có sẵn (chạy
6h sáng mỗi ngày) tự tính thêm và ghi vào 1 tab MỚI tên `SPTT_KHACHHANG`
trong file KPI (tự tạo nếu chưa có, ghi đè mỗi ngày cùng lúc với tab
`SAN_PHAM_TRONG_TAM` cũ) — không cần thêm workflow n8n mới, không cần cấu
hình gì thêm. Code.gs chỉ đọc lại tab này (hàm `getSpttKhachHangByNV_()`) và
gộp vào kết quả trả về của mục Sản phẩm trọng tâm.
Bắt buộc phải Deploy lại Apps Script (bản `Code.gs` này có thêm hàm mới
1 dòng CONFIG mới) theo đúng BƯỚC 1 — nếu quên, khối "Khách hàng đang mua"
sẽ luôn hiện "(0)" dù n8n đã có dữ liệu thật.
---
Cách dữ liệu được đọc & tính toán
Thầu: đọc trực tiếp sheet `THAU` (mỗi dòng = 1 sản phẩm trong 1 hợp
đồng tại 1 bệnh viện). Tỷ lệ hoàn thành = SL thực hiện / SL kế hoạch thực
(nếu có), hoặc / SL kế hoạch nếu chưa có kế hoạch thực — "SL còn lại" và tỷ
lệ này Code.gs LUÔN TỰ TÍNH LẠI, không tin trực tiếp 2 cột có sẵn trên
sheet. Mục "cảnh báo hết hạn" (bảng) lọc dòng còn ≤ 60 ngày hiệu lực và tỷ
lệ thực hiện < 60%; 2 khối "cảnh báo vét thầu"/"cài gói thầu mới" (thẻ, gộp
theo Số HĐ) xem chi tiết ở mục "Mục Thầu — nâng cấp đối chiếu, cảnh báo,
ghi chú" phía trên.
KPI: đọc tất cả các tab có tên bắt đầu bằng `KPIS` trong file KPI —
mỗi tab là bảng điểm riêng của 1 nhân viên (10 chỉ tiêu + điểm cộng thêm).
Script tự tính điểm từng chỉ tiêu theo công thức Thực hiện ÷ Kế hoạch ×
Điểm kế hoạch (có giới hạn theo cột "Vượt max"), cộng lại thành tổng điểm.
Xem chi tiết cách sửa/lưu và cách tạo tab cho nhân viên mới ở mục "KPI —
mỗi nhân viên 1 bảng điểm riêng" phía trên.
Checkin: sheet log GPS được gộp theo nhân viên (tổng lượt checkin, số
khách hàng đã ghé thăm, lượt trong 7/30 ngày gần nhất) để hiển thị trong
phần chi tiết mỗi nhân viên ở tab KPI (khớp theo Họ tên) — không hiển thị
toàn bộ 10,000+ dòng thô để tránh nặng trang.
Sale: đọc trực tiếp sheet `Sale T1-T7`, filter theo tỉnh / nhân viên /
nhóm hàng / khoảng ngày ngay trên trình duyệt (dữ liệu ~2,000 dòng nên lọc
phía client cho nhanh, không cần gọi lại server mỗi lần đổi bộ lọc).
Giới hạn bảo mật cần biết
Đây là giải pháp đăng nhập bằng tài khoản riêng, quản lý qua Google
Sheet — dễ triển khai và đủ dùng cho nội bộ team, không phải bảo mật cấp
doanh nghiệp:
Việc so khớp tên đăng nhập/mật khẩu diễn ra ở Netlify Function (phía
server), danh sách tài khoản (kể cả mật khẩu) không bao giờ được gửi
xuống trình duyệt — trình duyệt chỉ nhận về kết quả đúng/sai.
Mật khẩu trong tab `TAI_KHOAN` đang lưu ở dạng chữ thường (không mã hoá).
Vì vậy: (1) chỉ những ai có quyền chỉnh sửa file Sheet KPI mới nên được
xem tab đó, (2) không nên dùng chung mật khẩu với các tài khoản quan
trọng khác (email, ngân hàng...) của nhân viên.
`API_KEY` và URL Apps Script trong `site/config.js` có nằm trong code JS
công khai của trang — ai xem được mã nguồn trình duyệt (F12) đều có thể
lấy URL này và gọi thẳng API mà không cần qua trang đăng nhập. `API_KEY`
chỉ giúp chặn người lạ dò URL ngẫu nhiên trên Internet, không chặn được
người đã từng đăng nhập hợp lệ vào trang.
Nếu cần bảo mật chặt hơn (ví dụ dữ liệu doanh thu/KPI rất nhạy cảm), nên
nâng cấp lên đăng nhập bằng tài khoản Google giới hạn theo email công
ty — có thể làm ở lần sau, cấu trúc code hiện tại (Apps Script tách
riêng khỏi frontend) hỗ trợ nâng cấp này mà không phải viết lại từ đầu.
Khi cần chỉnh sửa / mở rộng sau này
Đổi ngưỡng màu tốt/vàng/đỏ của thanh tiến độ: sửa `THRESHOLDS` trong
`site/config.js`.
Đổi tên công ty / tiêu đề trang: sửa `APP_TITLE` trong `site/config.js`.
Muốn tự động làm mới dữ liệu định kỳ (không cần bấm nút): có thể thêm
`setInterval(loadAll, ...)` trong `site/app.js` — hỏi lại nếu cần, mình sẽ
bổ sung.
Nếu một trong 4 Google Sheet đổi cấu trúc cột/tiêu đề, phần đọc dữ liệu
tương ứng trong `Code.gs` có thể cần cập nhật lại theo tên cột mới.

// Netlify Function CÔNG KHAI (không cần đăng nhập): nhân viên bấm nút
// "✅ Xác nhận đã nhận nhiệm vụ" ngay trong email sẽ mở link trỏ tới đây,
// hàm này tự xác minh chữ ký token (ký bằng AUTH_SECRET, xem tasks.js) rồi
// ghi nhận "Đã nhận mail" = TRUE vào tab GIAO_VIEC, và trả về 1 trang HTML
// đơn giản báo đã xác nhận thành công — KHÔNG cần thêm biến môi trường nào
// mới (dùng lại APPS_SCRIPT_URL, APPS_SCRIPT_KEY, AUTH_SECRET có sẵn).
const crypto = require('crypto');

function verifyToken(token, secret) {
  if (!token) return null;
  var parts = token.split('.');
  if (parts.length !== 2) return null;
  var payloadB64 = parts[0];
  var sig = parts[1];
  var expected = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex').slice(0, 24);
  var a = Buffer.from(sig);
  var b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
  } catch (e) {
    return null;
  }
}

function htmlPage(title, message, ok) {
  var color = ok ? '#1e7d34' : '#b3261e';
  var icon = ok ? '✅' : '⚠️';
  return '<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + title + '</title>' +
    '<style>body{font-family:Arial,Helvetica,sans-serif;background:#f4f6fb;display:flex;' +
    'align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;box-sizing:border-box;}' +
    '.card{background:#fff;max-width:420px;width:100%;border-radius:14px;padding:36px 28px;text-align:center;' +
    'box-shadow:0 4px 24px rgba(20,30,60,0.1);}' +
    '.icon{font-size:44px;margin-bottom:12px;}' +
    'h1{font-size:19px;color:' + color + ';margin:0 0 10px;}' +
    'p{color:#555;font-size:14px;line-height:1.6;margin:0;}</style></head>' +
    '<body><div class="card"><div class="icon">' + icon + '</div><h1>' + title + '</h1><p>' + message + '</p></div></body></html>';
}

exports.handler = async function (event) {
  var appsScriptUrl = process.env.APPS_SCRIPT_URL;
  var appsScriptKey = process.env.APPS_SCRIPT_KEY || '';
  var secret = process.env.AUTH_SECRET || 'default-secret-change-me';

  var qp = event.queryStringParameters || {};
  var token = qp.token || '';
  var payload = verifyToken(token, secret);

  if (!payload || !payload.id) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: htmlPage('Đường liên kết không hợp lệ', 'Đường liên kết xác nhận này không đúng hoặc đã bị sửa đổi. Vui lòng đăng nhập vào TEAM CLOVER CPC1HN và mở mục "Giao việc" để xem nhiệm vụ.', false)
    };
  }
  if (!appsScriptUrl) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: htmlPage('Lỗi cấu hình', 'Trang web chưa cấu hình APPS_SCRIPT_URL. Vui lòng báo cho quản trị hệ thống.', false)
    };
  }

  try {
    var res = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: appsScriptKey, action: 'task_mark_received', id: payload.id })
    });
    var json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Apps Script trả lỗi');

    var task = json.data || {};
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: htmlPage('Đã xác nhận nhận nhiệm vụ!',
        'Cảm ơn bạn đã xác nhận' + (task.tenNhiemVu ? (': <b>' + task.tenNhiemVu + '</b>') : '') +
        '. Đăng nhập vào TEAM CLOVER CPC1HN &gt; mục "Giao việc" để xem chi tiết và cập nhật tiến độ.', true)
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: htmlPage('Không xác nhận được', 'Có lỗi khi kết nối máy chủ: ' + e.message + '. Vui lòng thử lại sau hoặc báo cho quản trị hệ thống.', false)
    };
  }
};

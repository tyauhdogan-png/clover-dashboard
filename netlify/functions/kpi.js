// Netlify Function: cập nhật số liệu "Thực hiện" trong bảng KPI của từng
// nhân viên. KHÔNG cần thêm biến môi trường nào mới, dùng lại đúng 3 biến đã
// cấu hình cho login.js / messages.js:
//   APPS_SCRIPT_URL, APPS_SCRIPT_KEY, AUTH_SECRET
//
// Quy tắc quyền (áp dụng ngay tại đây, phía server — KHÔNG tin phía trình
// duyệt): trước khi cho ghi, hàm này gọi Apps Script lấy toàn bộ danh sách
// KPI hiện tại để biết chính xác bảng KPI (sheetName) đó là của ai, rồi so
// sánh với tên của người đang đăng nhập (lấy từ token, không lấy từ dữ liệu
// trình duyệt gửi lên vì có thể bị giả mạo):
//   - Admin: sửa được KPI của bất kỳ ai.
//   - Nhân viên: CHỈ sửa được đúng bảng KPI mang tên của chính mình, dù có
//     truyền sheetName khác lên cũng bị từ chối (403).
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
    return JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8')); // { u, r, n, t }
  } catch (e) {
    return null;
  }
}

function normName(s) {
  return String(s || '').trim().toUpperCase();
}

exports.handler = async function (event) {
  var appsScriptUrl = process.env.APPS_SCRIPT_URL;
  var appsScriptKey = process.env.APPS_SCRIPT_KEY || '';
  var secret = process.env.AUTH_SECRET || 'default-secret-change-me';

  if (!appsScriptUrl) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: 'Chưa cấu hình biến môi trường APPS_SCRIPT_URL trên Netlify.' })
    };
  }

  var authHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  var token = authHeader.replace(/^Bearer\s+/i, '').trim();
  var caller = verifyToken(token, secret);
  if (!caller || !caller.u) {
    return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'Chưa đăng nhập hoặc phiên đăng nhập đã hết hạn' }) };
  }
  var isAdmin = String(caller.r || '').toLowerCase() === 'admin';
  var callerHoTen = caller.n || '';

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };
  }

  function callAppsScriptGet(params) {
    var sep = appsScriptUrl.indexOf('?') === -1 ? '?' : '&';
    var qs = Object.keys(params)
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k] == null ? '' : params[k]); })
      .join('&');
    return fetch(appsScriptUrl + sep + qs).then(function (res) { return res.json(); });
  }

  try {
    var body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (e) {}
    var sheetName = String(body.sheetName || '').trim();
    var rowType = String(body.rowType || 'chiTieu').trim();
    var rowIndex = body.rowIndex;
    var thucHien = body.thucHien;
    if (!sheetName || !rowIndex) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Thiếu sheetName/rowIndex' }) };
    }
    if (typeof thucHien === 'string' && thucHien.trim() === '') thucHien = 0;
    if (isNaN(Number(thucHien))) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Giá trị thực hiện phải là số' }) };
    }

    // Xác thực quyền: tra xem bảng KPI (sheetName) này thật sự là của ai.
    var kpiJson = await callAppsScriptGet({ type: 'kpi', key: appsScriptKey });
    if (!kpiJson.ok) throw new Error(kpiJson.error || 'Apps Script trả lỗi');
    var employees = (kpiJson.data && kpiJson.data.employees) || [];
    var target = employees.filter(function (emp) { return emp.sheetName === sheetName; })[0];
    if (!target) {
      return { statusCode: 404, body: JSON.stringify({ ok: false, error: 'Không tìm thấy bảng KPI này' }) };
    }
    if (!isAdmin && normName(target.hoTen) !== normName(callerHoTen)) {
      return { statusCode: 403, body: JSON.stringify({ ok: false, error: 'Bạn chỉ được sửa KPI của chính mình' }) };
    }

    var res = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: appsScriptKey,
        action: 'update_kpi',
        sheetName: sheetName,
        rowType: rowType,
        rowIndex: rowIndex,
        thucHien: thucHien
      })
    });
    var updJson = await res.json();
    if (!updJson.ok) throw new Error(updJson.error || 'Apps Script trả lỗi');
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, data: updJson.data }) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ ok: false, error: 'Lỗi kết nối Apps Script: ' + e.message }) };
  }
};

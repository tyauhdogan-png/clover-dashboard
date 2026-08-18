// Netlify Function: ghi "Ghi chú" thủ công cho 1 hợp đồng thầu (mục Thầu).
// KHÔNG cần thêm biến môi trường nào mới, dùng lại đúng 3 biến đã cấu hình
// cho login.js / messages.js / kpi.js: APPS_SCRIPT_URL, APPS_SCRIPT_KEY,
// AUTH_SECRET.
//
// Quy tắc quyền: mục Thầu KHÔNG phân quyền riêng (mọi tài khoản đã đăng nhập
// đều xem TOÀN BỘ dữ liệu Thầu, giống Sản phẩm trọng tâm/Doanh số) — nên chỉ
// cần kiểm tra ĐÃ ĐĂNG NHẬP (token hợp lệ), không cần so sánh chủ sở hữu như
// kpi.js.
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

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };
  }

  try {
    var body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (e) {}
    var rowIndex = body.rowIndex;
    var ghiChu = String(body.ghiChu == null ? '' : body.ghiChu).slice(0, 500);
    if (!rowIndex) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Thiếu rowIndex' }) };
    }

    var res = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: appsScriptKey,
        action: 'update_thau_ghichu',
        rowIndex: rowIndex,
        ghiChu: ghiChu
      })
    });
    var updJson = await res.json();
    if (!updJson.ok) throw new Error(updJson.error || 'Apps Script trả lỗi');
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, data: updJson.data }) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ ok: false, error: 'Lỗi kết nối Apps Script: ' + e.message }) };
  }
};

// Netlify Function: kiểm tra tên đăng nhập + mật khẩu theo danh sách tài
// khoản quản lý trong tab "TAI_KHOAN" của Google Sheet KPI (đọc qua Apps
// Script). Cần 3 biến môi trường trên Netlify:
//   APPS_SCRIPT_URL  — URL Web app Apps Script (giống hệt trong site/config.js)
//   APPS_SCRIPT_KEY  — API key (giống hệt CONFIG.API_KEY trong Code.gs, có
//                       thể để trống nếu bên Apps Script cũng để trống)
//   AUTH_SECRET      — chuỗi bí mật bất kỳ dùng để ký token đăng nhập
const crypto = require('crypto');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Yêu cầu không hợp lệ' }) };
  }

  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!username || !password) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Vui lòng nhập tên đăng nhập và mật khẩu' }) };
  }

  const appsScriptUrl = process.env.APPS_SCRIPT_URL;
  if (!appsScriptUrl) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: 'Chưa cấu hình biến môi trường APPS_SCRIPT_URL trên Netlify.' })
    };
  }
  const appsScriptKey = process.env.APPS_SCRIPT_KEY || '';

  let accounts;
  try {
    const sep = appsScriptUrl.indexOf('?') === -1 ? '?' : '&';
    const url = appsScriptUrl + sep + 'type=accounts' + (appsScriptKey ? '&key=' + encodeURIComponent(appsScriptKey) : '');
    const res = await fetch(url);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Apps Script trả lỗi');
    accounts = json.data || [];
  } catch (e) {
    return {
      statusCode: 502,
      body: JSON.stringify({ ok: false, error: 'Không lấy được danh sách tài khoản từ Apps Script: ' + e.message })
    };
  }

  const match = accounts.find(function (a) {
    return String(a.username || '').trim().toLowerCase() === username.toLowerCase() &&
      String(a.password || '') === password &&
      a.active !== false;
  });

  if (!match) {
    return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'Sai tên đăng nhập/mật khẩu, hoặc tài khoản đã bị khoá' }) };
  }

  const secret = process.env.AUTH_SECRET || 'default-secret-change-me';
  const payload = { u: match.username, r: match.vaiTro || 'nhanvien', n: match.hoTen || match.username, t: Date.now() };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64');
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex').slice(0, 24);
  const token = payloadB64 + '.' + sig;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      token: token,
      username: match.username,
      hoTen: match.hoTen || match.username,
      vaiTro: match.vaiTro || 'nhanvien'
    })
  };
};

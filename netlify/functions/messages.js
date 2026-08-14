// Netlify Function: đọc / gửi tin nhắn mục "Trao đổi" — chat riêng giữa
// Admin và từng nhân viên. KHÔNG cần thêm biến môi trường nào mới, dùng lại
// đúng 3 biến đã cấu hình cho login.js:
//   APPS_SCRIPT_URL, APPS_SCRIPT_KEY, AUTH_SECRET
//
// Quy tắc quyền (áp dụng ngay tại đây, phía server — KHÔNG tin phía trình
// duyệt): mỗi người chỉ xem được token đăng nhập hợp lệ của chính họ.
//   - Admin: xem/gửi được vào thread của bất kỳ nhân viên nào (?thread=...),
//     và gọi được action=threads để lấy danh sách nhân viên.
//   - Nhân viên: LUÔN bị ép về đúng thread mang tên đăng nhập của chính họ,
//     dù có truyền thread khác lên cũng bị bỏ qua — không xem được chat của
//     người khác.
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
  var callerUsername = String(caller.u);
  var isAdmin = String(caller.r || '').toLowerCase() === 'admin';

  function callAppsScriptGet(params) {
    var sep = appsScriptUrl.indexOf('?') === -1 ? '?' : '&';
    var qs = Object.keys(params)
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k] == null ? '' : params[k]); })
      .join('&');
    return fetch(appsScriptUrl + sep + qs).then(function (res) { return res.json(); });
  }

  try {
    if (event.httpMethod === 'GET') {
      var qp = event.queryStringParameters || {};
      var action = qp.action || 'list';

      if (action === 'threads') {
        if (!isAdmin) {
          return { statusCode: 403, body: JSON.stringify({ ok: false, error: 'Chỉ admin mới xem được danh sách trao đổi' }) };
        }
        var accJson = await callAppsScriptGet({ type: 'accounts', key: appsScriptKey });
        if (!accJson.ok) throw new Error(accJson.error || 'Apps Script trả lỗi');
        var threads = (accJson.data || [])
          .filter(function (a) { return String(a.vaiTro || '').toLowerCase() !== 'admin'; })
          .map(function (a) { return { username: a.username, hoTen: a.hoTen, active: a.active }; });
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, data: threads }) };
      }

      // action === 'list' (mặc định): lấy tin nhắn của 1 thread
      var thread = qp.thread ? String(qp.thread) : callerUsername;
      if (!isAdmin) thread = callerUsername; // nhân viên: luôn ép về đúng thread của mình
      var since = qp.since || '';
      var msgJson = await callAppsScriptGet({ type: 'messages', thread: thread, since: since, key: appsScriptKey });
      if (!msgJson.ok) throw new Error(msgJson.error || 'Apps Script trả lỗi');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, thread: thread, data: msgJson.data, me: { username: callerUsername, isAdmin: isAdmin } })
      };
    }

    if (event.httpMethod === 'POST') {
      var body = {};
      try { body = JSON.parse(event.body || '{}'); } catch (e) {}
      var text = String(body.text || '').trim();
      if (!text) {
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Nội dung tin nhắn trống' }) };
      }
      if (text.length > 2000) text = text.slice(0, 2000);
      var targetThread = isAdmin ? String(body.thread || '').trim() : callerUsername;
      if (!targetThread) {
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Thiếu người nhận (thread)' }) };
      }
      var res = await fetch(appsScriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: appsScriptKey,
          action: 'send_message',
          thread: targetThread,
          from: callerUsername,
          fromRole: caller.r || 'nhanvien',
          text: text
        })
      });
      var sendJson = await res.json();
      if (!sendJson.ok) throw new Error(sendJson.error || 'Apps Script trả lỗi');
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, data: sendJson.data }) };
    }

    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ ok: false, error: 'Lỗi kết nối Apps Script: ' + e.message }) };
  }
};

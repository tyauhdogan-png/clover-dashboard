// Netlify Function: mục "Dự kiến tuần sau" (trong tab Call & Cung tuyến) —
// thêm/xoá khách hàng tổ chức dự kiến ghé làm việc trong 1 tuần cụ thể.
// KHÔNG cần thêm biến môi trường nào mới, dùng lại đúng 3 biến đã cấu hình
// cho login.js / messages.js / kpi.js / tasks.js: APPS_SCRIPT_URL,
// APPS_SCRIPT_KEY, AUTH_SECRET.
//
// Quy tắc quyền (áp dụng ngay tại đây, phía server — KHÔNG tin phía trình
// duyệt):
//   - Admin: thêm được kế hoạch cho BẤT KỲ nhân viên nào, xoá được MỌI kế
//     hoạch (của mình hoặc của người khác).
//   - Nhân viên: CHỈ thêm/xoá được đúng kế hoạch mang tên đăng nhập của
//     chính mình — dù có truyền username/id khác lên cũng bị từ chối (403).
// (Việc XEM kế hoạch — type=cctKeHoach — vẫn gọi TRỰC TIẾP Apps Script từ
// trình duyệt, không qua file này, giống mọi dữ liệu xem khác trong app.)
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

function normUser(s) {
  return String(s || '').trim().toLowerCase();
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

  function callAppsScriptPost(payload) {
    return fetch(appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ key: appsScriptKey }, payload))
    }).then(function (res) { return res.json(); });
  }

  try {
    var body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (e) {}
    var action = String(body.action || '').trim();

    if (action === 'add') {
      var tuan = String(body.tuan || '').trim(); // "yyyy-MM-dd" (ngày Thứ 2 đầu tuần)
      var khachHang = String(body.khachHang || '').trim();
      var ghiChu = String(body.ghiChu || '').slice(0, 1000);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(tuan)) {
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Thiếu hoặc sai định dạng tuần (cần ngày Thứ 2 đầu tuần)' }) };
      }
      if (!khachHang) {
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Thiếu tên khách hàng tổ chức' }) };
      }

      // Admin được chỉ định nhân viên khác (body.username); nhân viên thường
      // KHÔNG được truyền username khác — luôn ép về đúng tài khoản đang
      // đăng nhập, dù trình duyệt có gửi gì lên cũng bị ép lại ở đây.
      var targetUsername = isAdmin ? String(body.username || '').trim() || callerUsername : callerUsername;

      // Tra họ tên thật của nhân viên từ tab TAI_KHOAN (không tin họ tên do
      // trình duyệt tự gửi lên) để ghi đúng vào CCT_KE_HOACH_TUAN.
      var accJson = await callAppsScriptGet({ type: 'accounts', key: appsScriptKey });
      if (!accJson.ok) throw new Error(accJson.error || 'Apps Script trả lỗi');
      var targetAcc = (accJson.data || []).find(function (a) { return normUser(a.username) === normUser(targetUsername); });
      if (!targetAcc) {
        return { statusCode: 404, body: JSON.stringify({ ok: false, error: 'Không tìm thấy nhân viên này' }) };
      }
      if (!isAdmin && normUser(targetAcc.username) !== normUser(callerUsername)) {
        return { statusCode: 403, body: JSON.stringify({ ok: false, error: 'Bạn chỉ được thêm kế hoạch của chính mình' }) };
      }

      var addJson = await callAppsScriptPost({
        action: 'cct_kehoach_add',
        tuan: tuan,
        username: targetAcc.username,
        hoTen: targetAcc.hoTen,
        khachHang: khachHang,
        ghiChu: ghiChu,
        nguoiTao: caller.n || callerUsername
      });
      if (!addJson.ok) throw new Error(addJson.error || 'Apps Script trả lỗi');
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, data: addJson.data }) };
    }

    if (action === 'delete') {
      var id = String(body.id || '').trim();
      var tuanOfId = String(body.tuan || '').trim(); // client luôn biết tuần của dòng đang xoá (đang hiển thị trên màn hình)
      if (!id) {
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Thiếu id kế hoạch' }) };
      }
      if (!isAdmin) {
        // Xác minh đúng dòng này là của nhân viên đang đăng nhập trước khi
        // cho xoá.
        var listJson = await callAppsScriptGet({ type: 'cctKeHoach', tuan: tuanOfId, key: appsScriptKey });
        if (!listJson.ok) throw new Error(listJson.error || 'Apps Script trả lỗi');
        var ownItem = (listJson.data || []).find(function (x) { return x.id === id; });
        if (!ownItem || normUser(ownItem.username) !== normUser(callerUsername)) {
          return { statusCode: 403, body: JSON.stringify({ ok: false, error: 'Bạn chỉ được xoá kế hoạch của chính mình' }) };
        }
      }
      var delJson = await callAppsScriptPost({ action: 'cct_kehoach_delete', id: id });
      if (!delJson.ok) throw new Error(delJson.error || 'Apps Script trả lỗi');
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, data: delJson.data }) };
    }

    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'action không hợp lệ: ' + action }) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ ok: false, error: 'Lỗi kết nối Apps Script: ' + e.message }) };
  }
};

// Netlify Function: mục "Phát triển cá nhân" — nhập điểm đào tạo sản phẩm
// cho từng nhân viên, và "Chọn lại" 2 học viên + 2 speaker của 1 tháng.
// KHÔNG cần thêm biến môi trường nào mới, dùng lại đúng 3 biến đã cấu hình
// cho login.js / messages.js / kpi.js / tasks.js: APPS_SCRIPT_URL,
// APPS_SCRIPT_KEY, AUTH_SECRET.
//
// Quy tắc quyền (áp dụng ngay tại đây, phía server — KHÔNG tin phía trình
// duyệt): CHỈ ADMIN mới được nhập điểm đào tạo và bấm "Chọn lại" — nhân viên
// chỉ được XEM (các endpoint xem — danhMucSp/daoTaoSp/ptcChonThang/
// ptcTangTruong — gọi trực tiếp Apps Script từ trình duyệt, giống Sản phẩm
// trọng tâm/Doanh số, không cần đăng nhập vì không phải dữ liệu riêng tư của
// từng người).
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

  if (!isAdmin) {
    return { statusCode: 403, body: JSON.stringify({ ok: false, error: 'Chỉ admin mới được nhập điểm đào tạo / chọn lại học viên-speaker' }) };
  }

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

    if (action === 'submit_diem') {
      var targetUsername = String(body.username || '').trim();
      var sanPham = String(body.sanPham || '').trim();
      var thang = String(body.thang || '').trim(); // dạng "yyyy-MM"
      var diem = body.diem;
      if (!targetUsername || !sanPham || !thang) {
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Thiếu nhân viên / sản phẩm / tháng' }) };
      }
      if (diem === undefined || diem === null || diem === '' || isNaN(Number(diem))) {
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Điểm phải là số' }) };
      }

      // Tra họ tên thật của nhân viên từ tab TAI_KHOAN (không tin họ tên do
      // trình duyệt tự gửi lên) để ghi đúng vào DAO_TAO_SP.
      var accJson = await callAppsScriptGet({ type: 'accounts', key: appsScriptKey });
      if (!accJson.ok) throw new Error(accJson.error || 'Apps Script trả lỗi');
      var targetAcc = (accJson.data || []).find(function (a) { return normUser(a.username) === normUser(targetUsername); });
      if (!targetAcc) {
        return { statusCode: 404, body: JSON.stringify({ ok: false, error: 'Không tìm thấy nhân viên này' }) };
      }

      var submitJson = await callAppsScriptPost({
        action: 'submit_diem_dao_tao',
        username: targetAcc.username,
        hoTen: targetAcc.hoTen,
        thang: thang,
        sanPham: sanPham,
        diem: diem,
        nguoiCham: caller.n || callerUsername,
        ghiChu: String(body.ghiChu || '').slice(0, 1000)
      });
      if (!submitJson.ok) throw new Error(submitJson.error || 'Apps Script trả lỗi');
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, data: submitJson.data }) };
    }

    if (action === 'reroll_thang') {
      var nam = parseInt(body.nam, 10) || new Date().getFullYear();
      var rrThang = parseInt(body.thang, 10) || (new Date().getMonth() + 1);
      var rerollJson = await callAppsScriptPost({ action: 'reroll_ptc_thang', nam: nam, thang: rrThang });
      if (!rerollJson.ok) throw new Error(rerollJson.error || 'Apps Script trả lỗi');
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, data: rerollJson.data }) };
    }

    // Vòng 15: "Sản phẩm đào tạo khi họp" — team họp 2 lần/tháng, admin ghi
    // lại sản phẩm nào đã đào tạo/trình bày trong từng buổi.
    if (action === 'add_hop') {
      var hopNgay = String(body.ngayHop || '').trim(); // "yyyy-MM-dd"
      var hopSanPham = String(body.sanPham || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(hopNgay)) {
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Thiếu hoặc sai định dạng ngày họp (cần yyyy-MM-dd)' }) };
      }
      if (!hopSanPham) {
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Thiếu sản phẩm đào tạo' }) };
      }
      var addHopJson = await callAppsScriptPost({
        action: 'add_hop_dao_tao',
        ngayHop: hopNgay,
        sanPham: hopSanPham,
        nguoiTrinhBay: String(body.nguoiTrinhBay || '').trim().slice(0, 200),
        ghiChu: String(body.ghiChu || '').slice(0, 1000),
        nguoiTao: caller.n || callerUsername
      });
      if (!addHopJson.ok) throw new Error(addHopJson.error || 'Apps Script trả lỗi');
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, data: addHopJson.data }) };
    }

    if (action === 'delete_hop') {
      var hopId = String(body.id || '').trim();
      if (!hopId) return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Thiếu id' }) };
      var delHopJson = await callAppsScriptPost({ action: 'delete_hop_dao_tao', id: hopId });
      if (!delHopJson.ok) throw new Error(delHopJson.error || 'Apps Script trả lỗi');
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, data: delHopJson.data }) };
    }

    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'action không hợp lệ: ' + action }) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ ok: false, error: 'Lỗi kết nối Apps Script: ' + e.message }) };
  }
};

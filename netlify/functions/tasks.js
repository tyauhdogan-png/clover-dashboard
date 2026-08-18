// Netlify Function: mục "Giao việc" — admin giao nhiệm vụ cho từng nhân
// viên, nhân viên phản hồi tiến độ. KHÔNG cần thêm biến môi trường nào để
// dùng cơ bản (dùng lại đúng 3 biến đã cấu hình cho login.js/messages.js:
// APPS_SCRIPT_URL, APPS_SCRIPT_KEY, AUTH_SECRET). Muốn TỰ ĐỘNG GỬI MAIL báo
// nhiệm vụ mới qua n8n thì thêm 1 biến môi trường:
//   N8N_TASK_WEBHOOK_URL — URL Webhook (Production URL) của workflow n8n
//                          "CPC1HN - Gửi mail giao việc nhân viên", lấy trong
//                          n8n sau khi bấm Activate. Để trống thì việc giao
//                          việc vẫn lưu bình thường, chỉ là không gửi mail.
//
// Quy tắc quyền (áp dụng ngay tại đây, phía server — KHÔNG tin phía trình
// duyệt):
//   - Admin: xem TẤT CẢ nhiệm vụ, tạo nhiệm vụ mới cho bất kỳ ai, phản hồi/sửa
//     được mọi nhiệm vụ.
//   - Nhân viên: CHỈ xem/phản hồi được đúng nhiệm vụ giao cho tên đăng nhập
//     của chính mình — không tạo được nhiệm vụ mới, không xem/sửa được nhiệm
//     vụ của người khác dù có truyền id khác lên cũng bị từ chối (403).
const crypto = require('crypto');

// Email nội bộ công ty của từng nhân viên, dùng để n8n gửi mail báo nhiệm vụ
// mới. Sửa/thêm trực tiếp ở đây nếu công ty có nhân viên mới hoặc đổi mail —
// không cần sửa Google Sheet hay Apps Script.
const EMPLOYEE_EMAILS = {
  '018271': 'hoang.nguyenhuy.hcm.ps@cpc1hn.com.vn',       // Nguyễn Huy Hoàng
  '018981': 'trinh.dinhthikieu.dongnai.etc@cpc1hn.com.vn', // Đinh Thị Kiều Trinh
  '020005': 'nghia.nguyentrong.hcm.etc@cpc1hn.com.vn',     // Nguyễn Trọng Nghĩa
  '017349': 'ly.nguyenthikhanh.binhthuan.gp@cpc1hn.com.vn',// Nguyễn Thị Khánh Ly
  '014330': 'hiep.lebuiquang.khanhhoa.etc@cpc1hn.com.vn',  // Lê Bùi Quang Hiệp
  '020181': 'khuyen.duonghong.hcm.etc@cpc1hn.com.vn',      // Dương Hồng Khuyên
  '017452': 'sen.truongthihong.hcm.ps@cpc1hn.com.vn'       // Trương Thị Hồng Sen
};

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

function signToken(payload, secret) {
  var payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64');
  var sig = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex').slice(0, 24);
  return payloadB64 + '.' + sig;
}

function normUser(s) {
  return String(s || '').trim().toLowerCase();
}

exports.handler = async function (event) {
  var appsScriptUrl = process.env.APPS_SCRIPT_URL;
  var appsScriptKey = process.env.APPS_SCRIPT_KEY || '';
  var secret = process.env.AUTH_SECRET || 'default-secret-change-me';
  var n8nWebhookUrl = process.env.N8N_TASK_WEBHOOK_URL || '';
  var siteUrl = process.env.URL || '';

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

  function callAppsScriptPost(payload) {
    return fetch(appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ key: appsScriptKey }, payload))
    }).then(function (res) { return res.json(); });
  }

  try {
    if (event.httpMethod === 'GET') {
      var tasksJson = await callAppsScriptGet({ type: 'tasks', key: appsScriptKey });
      if (!tasksJson.ok) throw new Error(tasksJson.error || 'Apps Script trả lỗi');
      var allTasks = tasksJson.data || [];
      var visibleTasks = isAdmin ? allTasks : allTasks.filter(function (t) {
        return normUser(t.username) === normUser(callerUsername);
      });
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, data: visibleTasks, me: { username: callerUsername, isAdmin: isAdmin } })
      };
    }

    if (event.httpMethod === 'POST') {
      var body = {};
      try { body = JSON.parse(event.body || '{}'); } catch (e) {}
      var action = String(body.action || '').trim();

      if (action === 'create') {
        if (!isAdmin) {
          return { statusCode: 403, body: JSON.stringify({ ok: false, error: 'Chỉ admin mới giao được việc' }) };
        }
        var targetUsername = String(body.username || '').trim();
        var tenNhiemVu = String(body.tenNhiemVu || '').trim();
        if (!targetUsername || !tenNhiemVu) {
          return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Thiếu tên nhân viên hoặc tên nhiệm vụ' }) };
        }
        var noiDung = String(body.noiDung || '').slice(0, 4000);
        var ngayThucHien = String(body.ngayThucHien || '').slice(0, 100);

        // Tra họ tên thật của nhân viên từ tab TAI_KHOAN (không tin họ tên do
        // trình duyệt tự gửi lên) để ghi đúng vào GIAO_VIEC.
        var accJson = await callAppsScriptGet({ type: 'accounts', key: appsScriptKey });
        if (!accJson.ok) throw new Error(accJson.error || 'Apps Script trả lỗi');
        var targetAcc = (accJson.data || []).find(function (a) { return normUser(a.username) === normUser(targetUsername); });
        if (!targetAcc) {
          return { statusCode: 404, body: JSON.stringify({ ok: false, error: 'Không tìm thấy nhân viên này' }) };
        }

        var createJson = await callAppsScriptPost({
          action: 'create_task',
          username: targetAcc.username,
          hoTen: targetAcc.hoTen,
          nguoiGiao: caller.n || callerUsername,
          tenNhiemVu: tenNhiemVu,
          noiDung: noiDung,
          ngayThucHien: ngayThucHien
        });
        if (!createJson.ok) throw new Error(createJson.error || 'Apps Script trả lỗi');
        var newTask = createJson.data;

        // Gửi mail báo nhiệm vụ mới qua n8n (không chặn việc tạo nhiệm vụ nếu
        // bước gửi mail lỗi — chỉ báo lại cho admin biết qua mailSent).
        var mailSent = false;
        var mailError = '';
        var toEmail = EMPLOYEE_EMAILS[targetAcc.username] || '';
        if (n8nWebhookUrl && toEmail) {
          try {
            var ackToken = signToken({ id: newTask.id, t: Date.now() }, secret);
            var ackUrl = (siteUrl || '') + '/.netlify/functions/task-ack?token=' + encodeURIComponent(ackToken);
            var mailRes = await fetch(n8nWebhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                toEmail: toEmail,
                toName: targetAcc.hoTen,
                taskName: tenNhiemVu,
                taskContent: noiDung,
                dueDate: ngayThucHien,
                assignerName: caller.n || callerUsername,
                ackUrl: ackUrl
              })
            });
            mailSent = mailRes.ok;
            if (!mailRes.ok) mailError = 'n8n trả về mã lỗi ' + mailRes.status;
          } catch (mailErr) {
            mailError = String(mailErr.message || mailErr);
          }
        } else if (!toEmail) {
          mailError = 'Chưa có email cho tài khoản này trong EMPLOYEE_EMAILS (tasks.js)';
        } else if (!n8nWebhookUrl) {
          mailError = 'Chưa cấu hình N8N_TASK_WEBHOOK_URL';
        }

        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ok: true, data: newTask, mailSent: mailSent, mailError: mailError })
        };
      }

      if (action === 'feedback') {
        var fId = String(body.id || '').trim();
        var trangThai = String(body.trangThai || '').trim();
        var ghiChu = String(body.ghiChu || '').slice(0, 2000);
        if (!fId) {
          return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Thiếu id nhiệm vụ' }) };
        }
        if (!isAdmin) {
          // Xác minh nhiệm vụ này đúng là của nhân viên đang đăng nhập trước
          // khi cho phản hồi.
          var checkJson = await callAppsScriptGet({ type: 'tasks', key: appsScriptKey });
          if (!checkJson.ok) throw new Error(checkJson.error || 'Apps Script trả lỗi');
          var ownTask = (checkJson.data || []).find(function (t) { return t.id === fId; });
          if (!ownTask || normUser(ownTask.username) !== normUser(callerUsername)) {
            return { statusCode: 403, body: JSON.stringify({ ok: false, error: 'Bạn chỉ được phản hồi nhiệm vụ của chính mình' }) };
          }
        }
        var fbJson = await callAppsScriptPost({ action: 'task_feedback', id: fId, trangThai: trangThai, ghiChu: ghiChu });
        if (!fbJson.ok) throw new Error(fbJson.error || 'Apps Script trả lỗi');
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, data: fbJson.data }) };
      }

      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'action không hợp lệ' }) };
    }

    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ ok: false, error: 'Lỗi kết nối Apps Script: ' + e.message }) };
  }
};

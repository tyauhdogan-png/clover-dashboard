// Netlify Function: kiểm tra mật khẩu chung để mở dashboard.
// Mật khẩu thật được cấu hình trong Netlify → Site settings → Environment
// variables → SITE_PASSWORD (không bao giờ nằm trong code frontend công khai).
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

  const expected = process.env.SITE_PASSWORD;
  if (!expected) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        ok: false,
        error: 'Chưa cấu hình biến môi trường SITE_PASSWORD trên Netlify.'
      })
    };
  }

  const password = String(body.password || '');
  if (password !== expected) {
    return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'Sai mật khẩu' }) };
  }

  const secret = process.env.AUTH_SECRET || 'default-secret-change-me';
  const token = crypto.createHmac('sha256', secret).update(String(Date.now())).digest('hex').slice(0, 40);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, token })
  };
};

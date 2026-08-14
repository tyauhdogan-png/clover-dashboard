// ============================================================================
// CẤU HÌNH FRONTEND — điền URL Apps Script sau khi triển khai (xem README.md)
// ============================================================================
window.APP_CONFIG = {
  // Dán URL "Web app" từ Apps Script vào đây, dạng:
  // https://script.google.com/macros/s/XXXXXXXXXXXXXXXXXXXXXXXX/exec
  API_URL: 'https://script.google.com/macros/s/AKfycbziOiNqe-RTAci-IhdK5Y4SHw2jacRU6eyX30inasx_pZF9b4hiRnwKG5Ns2jn0pROnZw/exec',

  // Phải khớp với CONFIG.API_KEY trong file Code.gs. Để '' nếu bạn để trống
  // API_KEY bên Apps Script.
  API_KEY: 'thay-doi-chuoi-nay',

  // Tên công ty / nhóm hiển thị trên header (tuỳ chỉnh tự do)
  APP_TITLE: 'Dashboard Kinh Doanh',

  // Ngưỡng màu cho thanh tiến độ % hoàn thành
  THRESHOLDS: { good: 0.8, warn: 0.4 }
};

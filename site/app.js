/* ============================================================================
   DASHBOARD KINH DOANH — logic phía client
   Không dùng framework, không dùng localStorage/sessionStorage cho dữ liệu
   nhạy cảm (chỉ dùng sessionStorage để nhớ trạng thái đã đăng nhập trong tab).
   ============================================================================ */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG || {};
  var SESSION_KEY = 'kd_dashboard_auth';

  var RAW = { thau: [], kpi: { employees: [], thang: '' }, sales: [], checkin: { employees: [] }, sptt: { capNhatLuc: '', team: [], employees: [] }, doanhso: { capNhatLuc: '', team: [], employees: [], khachHang: [] }, meta: {} };
  var CHARTS = {};
  var SORT_STATE = {}; // { tableId: { key, dir } }

  document.title = CFG.APP_TITLE || document.title;
  setText('login-title', CFG.APP_TITLE || 'Dashboard Kinh Doanh');
  setText('app-title', CFG.APP_TITLE || 'Dashboard Kinh Doanh');

  // --------------------------------------------------------------------------
  // TIỆN ÍCH CHUNG
  // --------------------------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function setText(id, text) { var el = $(id); if (el) el.textContent = text; }
  // Vòng 15: dùng thay cho việc gọi thẳng res.json() ở MỌI nơi gọi fetch() —
  // đọc text() trước rồi mới tự parse JSON, để khi Apps Script
  // trả về HTML (thường do CHƯA Deploy lại bản mới nhất sau khi cập nhật
  // code, hoặc do URL API/API_KEY sai khiến Google trả trang đăng nhập) thì
  // báo lỗi tiếng Việt dễ hiểu, thay vì lỗi khó hiểu "Unexpected token '<'".
  function parseJsonRes_(res) {
    return res.text().then(function (text) {
      try {
        return JSON.parse(text);
      } catch (eParse) {
        var loi = 'Server trả về dữ liệu không phải JSON (có thể do Apps Script CHƯA được Deploy lại bản mới nhất sau khi cập nhật code, hoặc sai URL API/API_KEY).';
        if (text) loi += ' Nội dung nhận được: ' + String(text).slice(0, 150);
        throw new Error(loi);
      }
    });
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var fmtNum = new Intl.NumberFormat('vi-VN');
  var fmtMoney = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
  function fmtVnd(n) { return fmtMoney.format(Math.round(n || 0)) + ' đ'; }
  function fmtPct(ratio) {
    if (ratio === null || ratio === undefined || isNaN(ratio)) return '—';
    return (ratio * 100).toFixed(1).replace('.0', '') + '%';
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    var p = iso.split('-');
    if (p.length !== 3) return iso;
    return p[2] + '/' + p[1] + '/' + p[0];
  }
  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }
  function getPath(obj, path) {
    return path.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj);
  }
  function progressClass(ratio) {
    var th = (CFG.THRESHOLDS || { good: 0.8, warn: 0.4 });
    if (ratio >= th.good) return 'good';
    if (ratio >= th.warn) return 'warn';
    return 'critical';
  }
  function progressCellHtml(ratio) {
    var r = Math.max(0, Math.min(1, ratio || 0));
    var cls = progressClass(ratio || 0);
    return '<div class="progress-cell">' +
      '<div class="progress-track"><div class="progress-fill ' + cls + '" style="width:' + (r * 100) + '%"></div></div>' +
      '<div class="progress-pct">' + fmtPct(ratio) + '</div></div>';
  }
  function fillSelect(select, values, placeholder) {
    if (!select) return;
    var current = select.value;
    select.innerHTML = '<option value="">' + placeholder + '</option>' +
      values.map(function (v) { return '<option value="' + escapeHtml(v) + '">' + escapeHtml(v) + '</option>'; }).join('');
    if (values.indexOf(current) !== -1) select.value = current;
  }
  function daysUntil(iso) {
    if (!iso) return Infinity;
    var d = new Date(iso + 'T00:00:00');
    var now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.round((d - now) / 86400000);
  }

  // --------------------------------------------------------------------------
  // AUTH
  // --------------------------------------------------------------------------
  function getSession() {
    try {
      var raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      return (obj && obj.token) ? obj : null;
    } catch (e) { return null; }
  }
  function isAuthed() { return !!getSession(); }

  function showApp() {
    $('login-screen').classList.add('hidden');
    $('app').classList.remove('hidden');
    var session = getSession();
    var badge = $('user-badge');
    if (badge) {
      badge.innerHTML = session
        ? 'Xin chào, <b>' + escapeHtml(session.hoTen || session.username || '') + '</b>' +
          (session.vaiTro === 'admin' ? ' · Quản trị' : '')
        : '';
    }
    loadAll();
  }

  function showLogin() {
    $('app').classList.add('hidden');
    $('login-screen').classList.remove('hidden');
  }

  $('login-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var username = $('login-username').value;
    var pwd = $('login-password').value;
    var btn = $('login-btn');
    var err = $('login-error');
    err.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Đang kiểm tra…';
    fetch('/.netlify/functions/login', {
      method: 'POST',
      body: JSON.stringify({ username: username, password: pwd })
    }).then(function (res) { return res.json().then(function (j) { return { status: res.status, body: j }; }); })
      .then(function (r) {
        if (r.body && r.body.ok) {
          sessionStorage.setItem(SESSION_KEY, JSON.stringify({
            token: r.body.token,
            username: r.body.username,
            hoTen: r.body.hoTen,
            vaiTro: r.body.vaiTro,
            ts: Date.now()
          }));
          showApp();
        } else {
          err.textContent = (r.body && r.body.error) || 'Đăng nhập thất bại';
        }
      })
      .catch(function () {
        err.textContent = 'Không kết nối được máy chủ đăng nhập. Thử lại sau.';
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = 'Đăng nhập';
      });
  });

  $('logout-btn').addEventListener('click', function () {
    stopChatPolling();
    sessionStorage.removeItem(SESSION_KEY);
    showLogin();
  });

  // --------------------------------------------------------------------------
  // TẢI DỮ LIỆU
  // --------------------------------------------------------------------------
  function apiUrl(type) {
    var u = CFG.API_URL + (CFG.API_URL.indexOf('?') === -1 ? '?' : '&') + 'type=' + type;
    if (CFG.API_KEY) u += '&key=' + encodeURIComponent(CFG.API_KEY);
    return u;
  }

  function loadAll() {
    setText('updated-at', 'Đang tải dữ liệu…');
    $('global-error').classList.add('hidden');
    if (!CFG.API_URL || CFG.API_URL.indexOf('PASTE_YOUR_DEPLOYMENT_ID_HERE') !== -1) {
      showGlobalError('Chưa cấu hình API_URL trong site/config.js — xem hướng dẫn trong README.md để lấy URL Apps Script.');
      return;
    }
    fetch(apiUrl('all'))
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return parseJsonRes_(res);
      })
      .then(function (json) {
        if (!json.ok) throw new Error(json.error || 'Lỗi không xác định từ API');
        RAW.thau = json.data.thau || [];
        RAW.kpi = json.data.kpi || { employees: [] };
        RAW.sales = json.data.sales || [];
        RAW.checkin = json.data.checkin || { employees: [] };
        RAW.sptt = json.data.sptt || { capNhatLuc: '', team: [], employees: [] };
        RAW.doanhso = json.data.doanhso || { capNhatLuc: '', team: [], employees: [], khachHang: [] };
        RAW.meta = json.data.meta || {};
        setText('updated-at', 'Cập nhật lúc ' + new Date(json.updatedAt).toLocaleString('vi-VN'));
        safeRun(initFilters);
        safeRun(renderThau);
        safeRun(renderKpi);
        safeRun(renderSales);
        safeRun(renderSptt);
        safeRun(renderDoanhSo);
      })
      .catch(function (err) {
        showGlobalError('Không tải được dữ liệu: ' + err.message + '. Kiểm tra API_URL trong config.js, kiểm tra Apps Script đã Deploy đúng quyền "Anyone", hoặc thử Làm mới.');
      });
  }

  function safeRun(fn) {
    try { fn(); } catch (e) {
      console.error('Lỗi khi hiển thị dữ liệu (' + (fn.name || 'anonymous') + ')', e);
    }
  }

  function showGlobalError(msg) {
    var el = $('global-error');
    el.textContent = msg;
    el.classList.remove('hidden');
    setText('updated-at', 'Chưa có dữ liệu');
  }

  $('refresh-btn').addEventListener('click', loadAll);

  // --------------------------------------------------------------------------
  // TABS
  // --------------------------------------------------------------------------
  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
      document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.add('hidden'); });
      btn.classList.add('active');
      $('tab-' + btn.dataset.tab).classList.remove('hidden');
      // Vòng 15: banner lỗi dùng chung 1 vùng #global-error cho mọi tab — nếu
      // không ẩn khi chuyển tab thì lỗi của tab TRƯỚC vẫn còn hiện khi đã
      // sang tab khác (đã gặp trong ảnh chụp màn hình: lỗi "Phát triển cá
      // nhân" vẫn hiện dù đang xem tab khác). Tab mới nếu tự lỗi sẽ tự hiện
      // lại banner ngay trong lúc tải.
      $('global-error').classList.add('hidden');
      onTabSwitch(btn.dataset.tab);
    });
  });
  function onTabSwitch(tabName) {
    if (tabName === 'chat') { initChatTab(); } else { stopChatPolling(); }
    if (tabName === 'giaoviec') { initGiaoViecTab(); }
    if (tabName === 'callcungtuyen') { initCallCungTuyenTab(); }
    if (tabName === 'ptc') { initPtcTab(); }
  }

  // --------------------------------------------------------------------------
  // BỘ LỌC — khởi tạo danh sách từ meta
  // --------------------------------------------------------------------------
  function initFilters() {
    fillSelect($('thau-filter-tinh'), RAW.meta.tinh || [], 'Tất cả tỉnh');
    var thauNv = uniqueSorted(RAW.thau.map(function (r) { return r.phuTrach; }));
    fillSelect($('thau-filter-nv'), thauNv, 'Tất cả nhân sự phụ trách');

    fillSelect($('sales-filter-tinh'), RAW.meta.tinh || [], 'Tất cả tỉnh');
    fillSelect($('sales-filter-nv'), RAW.meta.nhanVien || [], 'Tất cả nhân viên');
    fillSelect($('sales-filter-nhom'), RAW.meta.nhomHang || [], 'Tất cả nhóm hàng');
  }
  function uniqueSorted(arr) {
    var s = {};
    arr.forEach(function (v) { if (v) s[v] = true; });
    return Object.keys(s).sort();
  }

  ['thau-filter-tinh', 'thau-filter-nv'].forEach(function (id) { $(id).addEventListener('change', renderThau); });
  $('thau-filter-search').addEventListener('input', debounce(renderThau, 200));
  $('thau-clear').addEventListener('click', function () {
    $('thau-filter-tinh').value = ''; $('thau-filter-nv').value = ''; $('thau-filter-search').value = '';
    renderThau();
  });

  $('kpi-filter-search').addEventListener('input', debounce(renderKpi, 200));

  ['sales-filter-tinh', 'sales-filter-nv', 'sales-filter-nhom', 'sales-filter-from', 'sales-filter-to'].forEach(function (id) {
    $(id).addEventListener('change', renderSales);
  });
  $('sales-filter-search').addEventListener('input', debounce(renderSales, 200));
  $('sales-clear').addEventListener('click', function () {
    ['sales-filter-tinh', 'sales-filter-nv', 'sales-filter-nhom', 'sales-filter-from', 'sales-filter-to', 'sales-filter-search']
      .forEach(function (id) { $(id).value = ''; });
    renderSales();
  });

  // --------------------------------------------------------------------------
  // SẮP XẾP BẢNG (generic)
  // --------------------------------------------------------------------------
  function attachSort(tableId, rowsGetter, renderBody) {
    var table = $(tableId);
    table.querySelectorAll('th[data-sort]').forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.dataset.sort;
        var state = SORT_STATE[tableId] || { key: null, dir: 1 };
        state.dir = (state.key === key) ? -state.dir : 1;
        state.key = key;
        SORT_STATE[tableId] = state;
        table.querySelectorAll('th').forEach(function (h) { h.classList.remove('sorted'); });
        th.classList.add('sorted');
        renderBody(sortRows(rowsGetter(), key, state.dir));
      });
    });
  }
  function sortRows(rows, key, dir) {
    var copy = rows.slice();
    copy.sort(function (a, b) {
      var av = getPath(a, key), bv = getPath(b, key);
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      if (av === undefined || av === null) av = '';
      if (bv === undefined || bv === null) bv = '';
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return copy;
  }

  function upsertChart(canvasId, config) {
    var canvas = $(canvasId);
    if (!canvas) return;
    if (typeof Chart === 'undefined') {
      // Chart.js chưa tải được (mất mạng, bị chặn CDN…) — không chặn phần
      // còn lại của trang (bảng số liệu vẫn phải hiển thị bình thường).
      var box = canvas.closest('.chart-box');
      if (box && !box.querySelector('.chart-fallback-msg')) {
        var msg = document.createElement('div');
        msg.className = 'chart-fallback-msg empty-state';
        msg.textContent = 'Không tải được thư viện biểu đồ (Chart.js). Số liệu vẫn đầy đủ trong bảng bên dưới.';
        box.appendChild(msg);
      }
      return;
    }
    try {
      if (CHARTS[canvasId]) CHARTS[canvasId].destroy();
      CHARTS[canvasId] = new Chart(canvas.getContext('2d'), config);
    } catch (e) {
      console.error('Lỗi vẽ biểu đồ ' + canvasId, e);
    }
  }

  var PALETTE = ['#6fa8dc', '#f3a879', '#5bccbb', '#f7cb6e', '#f2a4c4', '#8bcf7e', '#b3a0e6', '#f0847f'];
  var CHART_BASE_OPTS = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { padding: 10 } },
    scales: {
      x: { grid: { display: false }, ticks: { color: '#b39aae', font: { size: 11 } } },
      y: { grid: { color: '#f4dcec' }, ticks: { color: '#b39aae', font: { size: 11 } }, beginAtZero: true }
    }
  };

  // ==========================================================================
  // TAB 1: THẦU
  // ==========================================================================
  function getThauFiltered() {
    var tinh = $('thau-filter-tinh').value;
    var nv = $('thau-filter-nv').value;
    var q = $('thau-filter-search').value.trim().toLowerCase();
    return RAW.thau.filter(function (r) {
      if (tinh && r.tinh !== tinh) return false;
      if (nv && r.phuTrach !== nv) return false;
      if (q) {
        var hay = (r.tenKhach + ' ' + r.tenHang + ' ' + r.soHD + ' ' + r.maKhach).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function renderThau() {
    var rows = getThauFiltered();

    var totalKH = sumBy(rows, function (r) { return r.slKeHoachThuc > 0 ? r.slKeHoachThuc : r.slKeHoach; });
    var totalTH = sumBy(rows, 'slThucHien');
    var soHopDong = uniqueSorted(rows.map(function (r) { return r.soHD; })).length;
    var soKhachHang = uniqueSorted(rows.map(function (r) { return r.maKhach; })).length;
    var tyLeChung = totalKH > 0 ? totalTH / totalKH : 0;

    $('thau-stats').innerHTML = [
      statTile('Số hợp đồng thầu', fmtNum.format(soHopDong)),
      statTile('Số khách hàng', fmtNum.format(soKhachHang)),
      statTile('Tổng SL kế hoạch', fmtNum.format(totalKH)),
      statTile('Tổng SL thực hiện', fmtNum.format(totalTH)),
      statTile('Tỷ lệ hoàn thành chung', fmtPct(tyLeChung), progressClass(tyLeChung))
    ].join('');

    // --- charts: % hoàn thành theo tỉnh & theo nhân sự phụ trách ---
    var byTinh = groupAgg(rows, function (r) { return r.tinh; });
    var byNv = groupAgg(rows, function (r) { return r.phuTrach; });
    renderRatioBarChart('chart-thau-tinh', 'Theo Tỉnh', byTinh);
    renderRatioBarChart('chart-thau-nv', 'Theo nhân sự phụ trách', byNv);

    // --- cảnh báo hết hạn ---
    var canhBao = rows.filter(function (r) {
      var d = daysUntil(r.ngayHetHan);
      return d <= 60 && d >= 0 && r.tyLe < 0.6;
    }).sort(function (a, b) { return daysUntil(a.ngayHetHan) - daysUntil(b.ngayHetHan); });
    var cbBody = $('table-thau-canhbao').querySelector('tbody');
    if (!canhBao.length) {
      cbBody.innerHTML = '<tr><td colspan="6" class="empty-state">Không có hợp đồng nào sắp hết hạn với tỷ lệ thực hiện thấp.</td></tr>';
    } else {
      cbBody.innerHTML = canhBao.map(function (r) {
        return '<tr><td>' + escapeHtml(r.tenKhach) + '</td><td>' + escapeHtml(r.tinh) + '</td>' +
          '<td>' + escapeHtml(r.tenHang) + '</td><td>' + escapeHtml(r.phuTrach) + '</td>' +
          '<td>' + fmtDate(r.ngayHetHan) + ' <span class="muted small">(' + daysUntil(r.ngayHetHan) + ' ngày)</span></td>' +
          '<td class="num">' + progressCellHtml(r.tyLe) + '</td></tr>';
      }).join('');
    }

    // --- cảnh báo vét thầu (< 3 tháng) + cài gói thầu mới (~6 tháng), gộp
    // theo TỪNG HỢP ĐỒNG (Số HĐ), vì 1 hợp đồng có nhiều dòng sản phẩm và
    // ngày hết hạn tính theo hợp đồng chứ không phải theo bệnh viện ---
    var hopDongGroups = groupThauBySoHD(rows);
    renderThauAlerts(hopDongGroups);

    // --- tổng hợp theo nhân sự phụ trách (số bệnh viện + số tỉnh) ---
    renderThauEmpSummary(rows);

    // --- bảng chi tiết ---
    setText('thau-row-count', '(' + fmtNum.format(rows.length) + ' dòng)');
    renderThauTableBody(rows);
    attachSort('table-thau', getThauFiltered, renderThauTableBody);
  }

  // Gộp các dòng Thầu theo Số HĐ (1 hợp đồng có thể có nhiều dòng sản phẩm) —
  // dùng cho 2 khối cảnh báo "vét thầu"/"cài gói thầu mới" vì ngày hết hạn +
  // ghi chú áp dụng theo TỪNG HỢP ĐỒNG, không phải theo từng dòng sản phẩm.
  function groupThauBySoHD(rows) {
    var map = {};
    var order = [];
    rows.forEach(function (r) {
      var key = r.soHD || ('(không rõ #' + r.maKhach + ')');
      if (!map[key]) {
        map[key] = {
          soHD: r.soHD, tenKhach: r.tenKhach, tinh: r.tinh, phuTrach: r.phuTrach,
          maKhach: r.maKhach, ngayHetHan: r.ngayHetHan, ngayBatDau: r.ngayBatDau,
          slKeHoach: 0, slThucHien: 0, soSanPham: 0, ghiChu: r.ghiChu,
          ghiChuRowIndex: r.ghiChuRowIndex, coCanhBaoDoiChieu: false
        };
        order.push(key);
      }
      var g = map[key];
      g.slKeHoach += (r.slKeHoachThuc > 0 ? r.slKeHoachThuc : r.slKeHoach);
      g.slThucHien += r.slThucHien;
      g.soSanPham += 1;
      if (r.doiChieu && r.doiChieu.canhBao) g.coCanhBaoDoiChieu = true;
    });
    return order.map(function (key) {
      var g = map[key];
      g.tyLe = g.slKeHoach > 0 ? g.slThucHien / g.slKeHoach : 0;
      g.daysLeft = daysUntil(g.ngayHetHan);
      return g;
    });
  }

  function renderThauAlerts(groups) {
    // Vét thầu: hợp đồng còn hiệu lực nhưng dưới 3 tháng (90 ngày) nữa hết hạn.
    var vet = groups.filter(function (g) { return g.daysLeft >= 0 && g.daysLeft <= 90; })
      .sort(function (a, b) { return a.daysLeft - b.daysLeft; });
    var vetEl = $('thau-vetthau-list');
    if (!vet.length) {
      vetEl.innerHTML = '<div class="empty-state">Không có gói thầu nào sắp hết hạn trong 3 tháng tới.</div>';
    } else {
      vetEl.innerHTML = vet.map(function (g) {
        var urgentCls = g.daysLeft <= 30 ? 'thau-alert-days--urgent' : 'thau-alert-days--soon';
        return thauAlertCardHtml(g, urgentCls, g.daysLeft + ' ngày nữa hết hạn');
      }).join('');
    }

    // Cài gói thầu mới: hợp đồng còn khoảng 6 tháng (150–210 ngày) nữa hết
    // hạn — gộp hiển thị THEO NHÂN VIÊN phụ trách để dễ chuẩn bị trước.
    var newPkg = groups.filter(function (g) { return g.daysLeft > 150 && g.daysLeft <= 210; })
      .sort(function (a, b) { return a.daysLeft - b.daysLeft; });
    var newPkgEl = $('thau-caigoimoi-list');
    if (!newPkg.length) {
      newPkgEl.innerHTML = '<div class="empty-state">Không có gói thầu nào cần chuẩn bị cài mới trong khoảng 6 tháng tới.</div>';
    } else {
      var byNv = {};
      var nvOrder = [];
      newPkg.forEach(function (g) {
        var nv = g.phuTrach || '(chưa rõ)';
        if (!byNv[nv]) { byNv[nv] = []; nvOrder.push(nv); }
        byNv[nv].push(g);
      });
      newPkgEl.innerHTML = nvOrder.map(function (nv) {
        return '<div class="thau-alert-nvgroup">' +
          '<div class="thau-alert-nvgroup-title">👤 ' + escapeHtml(nv) + ' <span class="muted small">(' + byNv[nv].length + ' gói)</span></div>' +
          byNv[nv].map(function (g) { return thauAlertCardHtml(g, 'thau-alert-days--soon', g.daysLeft + ' ngày nữa hết hạn'); }).join('') +
          '</div>';
      }).join('');
    }
  }

  function thauAlertCardHtml(g, daysCls, daysLabel) {
    var doiChieuBadge = g.coCanhBaoDoiChieu
      ? '<span class="chip critical" title="Đơn kế toán tháng này đã giao vượt SL còn lại của gói — có thể bảng Thầu chưa cập nhật kịp">⚠️ Chênh lệch đơn kế toán</span>'
      : '';
    return '<div class="thau-alert-card">' +
      '<div class="thau-alert-card-top">' +
        '<span class="thau-alert-card-name">' + escapeHtml(g.tenKhach) + '</span>' +
        '<span class="thau-alert-days ' + daysCls + '">' + escapeHtml(daysLabel) + '</span>' +
      '</div>' +
      '<div class="thau-alert-card-meta">' +
        '<span>' + escapeHtml(g.tinh) + '</span><span>·</span>' +
        '<span>👤 ' + escapeHtml(g.phuTrach) + '</span><span>·</span>' +
        '<span class="muted small">HĐ ' + escapeHtml(g.soHD) + '</span>' +
      '</div>' +
      '<div class="thau-alert-card-bottom">' +
        '<span class="muted small">' + g.soSanPham + ' mặt hàng · Hết hạn ' + fmtDate(g.ngayHetHan) + '</span>' +
        progressCellHtml(g.tyLe) +
      '</div>' +
      (doiChieuBadge ? '<div class="thau-alert-card-badges">' + doiChieuBadge + '</div>' : '') +
      (g.ghiChu ? '<div class="thau-alert-card-note">📝 ' + escapeHtml(g.ghiChu) + '</div>' : '') +
      '</div>';
  }

  function renderThauEmpSummary(rows) {
    var byNv = {};
    var order = [];
    rows.forEach(function (r) {
      var nv = r.phuTrach || '(chưa rõ)';
      if (!byNv[nv]) { byNv[nv] = { benhVien: {}, tinh: {}, slKeHoach: 0, slThucHien: 0 }; order.push(nv); }
      var g = byNv[nv];
      if (r.maKhach) g.benhVien[r.maKhach] = true;
      if (r.tinh) g.tinh[r.tinh] = true;
      g.slKeHoach += (r.slKeHoachThuc > 0 ? r.slKeHoachThuc : r.slKeHoach);
      g.slThucHien += r.slThucHien;
    });
    order.sort();
    var el = $('thau-emp-summary');
    if (!order.length) { el.innerHTML = '<div class="empty-state">Không có dữ liệu.</div>'; return; }
    el.innerHTML = order.map(function (nv) {
      var g = byNv[nv];
      var soBv = Object.keys(g.benhVien).length;
      var soTinh = Object.keys(g.tinh).length;
      var tyLe = g.slKeHoach > 0 ? g.slThucHien / g.slKeHoach : 0;
      return '<div class="sptt-emp-card thau-emp-card">' +
        '<div class="sptt-emp-card-head"><span class="sptt-emp-name">👤 ' + escapeHtml(nv) + '</span></div>' +
        '<div class="thau-emp-stats">' +
          '<div class="thau-emp-stat"><span class="thau-emp-stat-value">' + soBv + '</span><span class="thau-emp-stat-label">bệnh viện</span></div>' +
          '<div class="thau-emp-stat"><span class="thau-emp-stat-value">' + soTinh + '</span><span class="thau-emp-stat-label">tỉnh</span></div>' +
        '</div>' +
        progressCellHtml(tyLe) +
        '</div>';
    }).join('');
  }

  function renderThauTableBody(rows) {
    var body = $('table-thau').querySelector('tbody');
    if (!rows.length) { body.innerHTML = '<tr><td colspan="11" class="empty-state">Không có dữ liệu phù hợp bộ lọc.</td></tr>'; return; }
    body.innerHTML = rows.map(function (r) {
      var doiChieuCell = (r.doiChieu && r.doiChieu.canhBao)
        ? '<span class="chip critical" title="Đơn kế toán tháng này (' + fmtNum.format(r.doiChieu.slThangNay) + ' SL) đã giao vượt SL còn lại — có thể bảng Thầu chưa cập nhật kịp">⚠️ Chênh lệch</span>'
        : (r.doiChieu ? '<span class="chip good" title="Đã giao ' + fmtNum.format(r.doiChieu.slThangNay) + ' SL trong tháng theo đơn kế toán, khớp với SL còn lại">✓ Khớp</span>' : '<span class="muted small">—</span>');
      return '<tr><td>' + escapeHtml(r.tenKhach) + '</td><td>' + escapeHtml(r.tinh) + '</td>' +
        '<td>' + escapeHtml(r.phuTrach) + '</td><td>' + escapeHtml(r.tenHang) + '</td>' +
        '<td class="muted small">' + escapeHtml(r.soHD) + '</td>' +
        '<td class="num">' + fmtNum.format(r.slKeHoach) + '</td>' +
        '<td class="num">' + fmtNum.format(r.slThucHien) + '</td>' +
        '<td>' + progressCellHtml(r.tyLe) + '</td>' +
        '<td>' + fmtDate(r.ngayHetHan) + '</td>' +
        '<td>' + doiChieuCell + '</td>' +
        '<td><textarea class="thau-ghichu-input" rows="1" placeholder="Ghi chú…" data-rowindex="' + r.ghiChuRowIndex + '">' + escapeHtml(r.ghiChu) + '</textarea></td></tr>';
    }).join('');
    attachThauGhiChuHandlers();
  }

  function attachThauGhiChuHandlers() {
    var els = $('table-thau').querySelectorAll('.thau-ghichu-input');
    els.forEach(function (el) {
      el.addEventListener('change', function () {
        saveThauGhiChu(+el.dataset.rowindex, el.value, el);
      });
    });
  }

  function saveThauGhiChu(rowIndex, ghiChu, inputEl) {
    if (inputEl) inputEl.disabled = true;
    fetch('/.netlify/functions/thau', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeader()),
      body: JSON.stringify({ rowIndex: rowIndex, ghiChu: ghiChu })
    })
      .then(function (res) { return res.json().then(function (j) { return { status: res.status, body: j }; }); })
      .then(function (r) {
        if (!r.body || !r.body.ok) throw new Error((r.body && r.body.error) || 'Lưu ghi chú thất bại');
        RAW.thau = r.body.data || [];
        renderThau();
      })
      .catch(function (err) {
        if (inputEl) inputEl.disabled = false;
        alert('Không lưu được ghi chú: ' + err.message);
      });
  }

  function groupAgg(rows, keyFn) {
    var map = {};
    rows.forEach(function (r) {
      var k = keyFn(r) || '(không rõ)';
      if (!map[k]) map[k] = { kh: 0, th: 0 };
      map[k].kh += (r.slKeHoachThuc > 0 ? r.slKeHoachThuc : r.slKeHoach);
      map[k].th += r.slThucHien;
    });
    return Object.keys(map).map(function (k) {
      return { label: k, ratio: map[k].kh > 0 ? map[k].th / map[k].kh : 0, kh: map[k].kh, th: map[k].th };
    }).sort(function (a, b) { return b.ratio - a.ratio; });
  }

  function renderRatioBarChart(canvasId, title, data) {
    var colors = data.map(function (d) {
      var cls = progressClass(d.ratio);
      return cls === 'good' ? '#6fbf73' : (cls === 'warn' ? '#f6c877' : '#ee7e79');
    });
    upsertChart(canvasId, {
      type: 'bar',
      data: {
        labels: data.map(function (d) { return d.label; }),
        datasets: [{ label: title, data: data.map(function (d) { return +(d.ratio * 100).toFixed(1); }), backgroundColor: colors, borderRadius: 4, maxBarThickness: 34 }]
      },
      options: Object.assign({}, CHART_BASE_OPTS, {
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (ctx) { return ctx.parsed.y + '% hoàn thành'; } } }
        },
        scales: Object.assign({}, CHART_BASE_OPTS.scales, { y: Object.assign({}, CHART_BASE_OPTS.scales.y, { suggestedMax: 100 }) })
      })
    });
  }

  function sumBy(rows, keyOrFn) {
    var fn = typeof keyOrFn === 'function' ? keyOrFn : function (r) { return r[keyOrFn]; };
    return rows.reduce(function (s, r) { return s + (fn(r) || 0); }, 0);
  }

  function statTile(label, value, statusCls, sub) {
    return '<div class="stat-tile"><div class="label">' + escapeHtml(label) + '</div>' +
      '<div class="value" style="' + (statusCls ? 'color:var(--status-' + statusCls + ')' : '') + '">' + value + '</div>' +
      (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>';
  }

  // ==========================================================================
  // TAB 2: KPI NHÂN VIÊN — mỗi người có 1 bảng KPI chi tiết riêng, xem theo
  // tên, chia 3 nhóm chỉ tiêu (Doanh số / Sản phẩm trọng tâm / Điểm cộng thêm
  // + Điểm trừ tách riêng), có xếp hạng huy chương theo tổng điểm cuối cùng.
  // ==========================================================================
  var KPI_SELECTED_SHEET = null; // sheetName của nhân viên đang xem chi tiết
  var KPI_MEDALS = ['🥇', '🥈', '🥉'];

  function getKpiFiltered() {
    var q = $('kpi-filter-search').value.trim().toLowerCase();
    var emps = (RAW.kpi.employees || []);
    if (!q) return emps;
    return emps.filter(function (e) { return e.hoTen.toLowerCase().indexOf(q) !== -1; });
  }

  function kpiNormName(s) { return String(s || '').trim().toUpperCase(); }

  // Lấy riêng "tên gọi" (từ cuối cùng) từ họ tên đầy đủ, dùng cho nhãn trục
  // biểu đồ cho gọn — VD "Trương Thị Hồng Sen" -> "Sen".
  function kpiShortName(hoTen) {
    var parts = String(hoTen || '').trim().split(/\s+/);
    return parts.length ? parts[parts.length - 1] : hoTen;
  }

  function kpiCanEdit(emp) {
    var session = getSession();
    if (!session || !emp) return false;
    if (session.vaiTro === 'admin') return true;
    return kpiNormName(emp.hoTen) === kpiNormName(session.hoTen);
  }

  // Tổng điểm dùng để xếp hạng & tính %: ưu tiên "tổng điểm cuối cùng" (đã
  // gồm cộng/trừ) do Apps Script trả về; nếu vì lý do gì đó server cũ chưa
  // có trường này thì tạm lùi về tổng điểm chỉ tiêu gốc để không vỡ giao diện.
  function kpiFinalScore(e) {
    return (typeof e.tongDiemCuoiCung === 'number') ? e.tongDiemCuoiCung : (e.tongDiemThucHien || 0);
  }

  function renderKpi() {
    var all = RAW.kpi.employees || [];
    var emps = getKpiFiltered();
    setText('kpi-thang', RAW.kpi.thang || '');

    var datCount = all.filter(function (e) { return e.ketQuaKpi && e.ketQuaKpi.dat; }).length;
    var avgTyLe = all.length ? sumBy(all, 'tyLeTong') / all.length : 0;
    var totalTH = sumBy(all, 'tongDiemThucHien');
    var totalKH = sumBy(all, 'tongDiemKeHoach');

    $('kpi-stats').innerHTML = [
      statTile('Số nhân viên', fmtNum.format(all.length)),
      statTile('Đạt KPI (≥850đ, đủ điều kiện)', fmtNum.format(datCount) + ' / ' + fmtNum.format(all.length)),
      statTile('Tỉ lệ TH/KH trung bình (nhóm chỉ tiêu)', fmtPct(avgTyLe), progressClass(avgTyLe)),
      statTile('Tổng điểm TH / KH nhóm', fmtNum.format(totalTH) + ' / ' + fmtNum.format(totalKH))
    ].join('');

    var ranked = all.slice().sort(function (a, b) { return kpiFinalScore(b) - kpiFinalScore(a); });
    // Cột đứng: trục hoành (x) = tên nhân viên (chỉ lấy tên gọi cho gọn),
    // trục tung (y) = điểm KPI cuối cùng (đã gồm cộng/trừ). Màu xanh/đỏ theo
    // đúng kết quả Đạt KPI / Bị liệt (đồng bộ với bảng xếp hạng bên dưới).
    var colors = ranked.map(function (e) {
      var dat = e.ketQuaKpi && e.ketQuaKpi.dat;
      return dat ? '#6fbf73' : '#ee7e79';
    });
    upsertChart('chart-kpi-tyle', {
      type: 'bar',
      data: {
        labels: ranked.map(function (e) { return kpiShortName(e.hoTen); }),
        datasets: [{ data: ranked.map(function (e) { return kpiFinalScore(e); }), backgroundColor: colors, borderRadius: 4, maxBarThickness: 48 }]
      },
      options: Object.assign({}, CHART_BASE_OPTS, {
        plugins: {
          legend: { display: false },
          tooltip: {
            padding: 10,
            callbacks: {
              title: function (items) { return ranked[items[0].dataIndex].hoTen; },
              label: function (ctx) { return fmtNum.format(ctx.parsed.y) + ' điểm KPI'; }
            }
          }
        },
        scales: Object.assign({}, CHART_BASE_OPTS.scales, {
          y: Object.assign({}, CHART_BASE_OPTS.scales.y, { suggestedMax: 1000 }),
          x: Object.assign({}, CHART_BASE_OPTS.scales.x, { ticks: { color: '#7a5c76', font: { size: 12, weight: '600' } } })
        })
      })
    });

    renderKpiLeaderboard(ranked);
    setText('kpi-row-count', '(' + fmtNum.format(emps.length) + ' người)');
    renderKpiPicker(emps);

    // Nhân viên (không phải admin) mở tab KPI lần đầu -> tự chọn sẵn bảng của
    // chính mình cho tiện, khỏi phải tự tìm trong danh sách.
    if (!KPI_SELECTED_SHEET) {
      var session = getSession();
      if (session && session.vaiTro !== 'admin') {
        var mine = all.filter(function (e) { return kpiNormName(e.hoTen) === kpiNormName(session.hoTen); })[0];
        if (mine) KPI_SELECTED_SHEET = mine.sheetName;
      }
    }
    // Vòng 15: mọi trường hợp KHÁC (admin, hoặc tài khoản không khớp tên với
    // bảng KPI nào) -> mặc định LUÔN hiện sẵn KPI của Dương Hồng Khuyên, thay
    // vì để trống và bắt phải bấm chọn mới hiện.
    if (!KPI_SELECTED_SHEET) {
      var khuyen = all.filter(function (e) { return kpiNormName(e.hoTen) === kpiNormName('Dương Hồng Khuyên'); })[0];
      if (khuyen) KPI_SELECTED_SHEET = khuyen.sheetName;
    }
    if (KPI_SELECTED_SHEET && !all.some(function (e) { return e.sheetName === KPI_SELECTED_SHEET; })) {
      KPI_SELECTED_SHEET = null;
    }
    renderKpiDetail();
  }

  // Bảng xếp hạng theo tổng điểm cuối cùng (đã gồm cộng/trừ) — huy chương
  // vàng/bạc/đồng cho top 3, còn lại đánh số thứ hạng.
  function renderKpiLeaderboard(ranked) {
    var box = $('kpi-leaderboard');
    if (!box) return;
    if (!ranked.length) { box.innerHTML = ''; return; }
    box.innerHTML = ranked.map(function (e, i) {
      var medal = KPI_MEDALS[i] ? '<span class="kpi-medal">' + KPI_MEDALS[i] + '</span>' : '<span class="kpi-rank-num">#' + (i + 1) + '</span>';
      var dat = e.ketQuaKpi && e.ketQuaKpi.dat;
      var resultChip = '<span class="chip small ' + (dat ? 'good' : 'critical') + '">' + (dat ? 'Đạt KPI' : 'Bị liệt') + '</span>';
      return '<div class="kpi-leaderboard-row' + (i < 3 ? ' top3' : '') + '">' +
        medal +
        '<span class="kpi-leaderboard-name">' + escapeHtml(e.hoTen) + '</span>' +
        resultChip +
        '<span class="kpi-leaderboard-score">' + fmtNum.format(kpiFinalScore(e)) + ' điểm</span>' +
        '</div>';
    }).join('');
  }

  function renderKpiPicker(emps) {
    var box = $('kpi-emp-picker');
    if (!emps.length) { box.innerHTML = '<div class="empty-state small">Không tìm thấy nhân viên phù hợp.</div>'; return; }
    box.innerHTML = emps.map(function (e) {
      var cls = progressClass(e.tyLeTong || 0);
      var active = e.sheetName === KPI_SELECTED_SHEET ? ' active' : '';
      return '<button type="button" class="kpi-emp-chip ' + cls + active + '" data-sheet="' + escapeHtml(e.sheetName) + '">' +
        '<span class="kpi-emp-name">' + escapeHtml(e.hoTen) + '</span>' +
        '<span class="kpi-emp-pct">' + fmtPct(e.tyLeTong) + '</span></button>';
    }).join('');
    box.querySelectorAll('.kpi-emp-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        KPI_SELECTED_SHEET = btn.dataset.sheet;
        renderKpiPicker(getKpiFiltered());
        renderKpiDetail();
      });
    });
  }

  // Ô "Thực hiện" (chỉ tiêu) và "Điểm đạt được" (điểm cộng thêm): server luôn
  // trả về giá trị đã được PARSE SẴN thành số (hoặc null) — không còn là
  // chuỗi thô lấy nguyên văn từ ô Sheet như trước — nên hiển thị an toàn qua
  // Intl.NumberFormat('vi-VN') (tự thêm dấu chấm phân cách hàng nghìn, vd
  // "10.000.000") khi chỉ xem (không sửa được). Khi có thể sửa thì dùng
  // input type=text (chứ không phải type=number, vì trình duyệt sẽ từ chối
  // ký tự dấu chấm trong ô number) để vẫn hiện được dấu chấm hàng nghìn ngay
  // trong lúc sửa — xem thêm 2 hàm kpiParseVnNumber()/format lại khi
  // focus/blur ở attachKpiInputHandlers().
  function kpiValueCellHtml(rowType, rowIndex, value, canEdit) {
    if (!canEdit) {
      if (value === null || value === undefined || value === '') return '—';
      var num = (typeof value === 'number') ? value : parseFloat(value);
      return escapeHtml(isNaN(num) ? String(value) : fmtNum.format(num));
    }
    var v = (value === null || value === undefined || value === '') ? '' : fmtNum.format(value);
    return '<input type="text" inputmode="decimal" class="kpi-input kpi-input-number" ' +
      'data-row-type="' + rowType + '" data-row-index="' + rowIndex + '" value="' + escapeHtml(v) + '" />';
  }

  // Đổi qua lại giữa "500.000.000" (hiển thị, kiểu Việt Nam: dấu chấm ngăn
  // hàng nghìn, dấu phẩy là phần thập phân) và số JS thật để gửi lên server/
  // tính toán. Trả về null nếu không phải số hợp lệ (ô trống cũng ra null).
  function kpiParseVnNumber(s) {
    s = String(s === null || s === undefined ? '' : s).trim();
    if (!s) return null;
    s = s.replace(/\./g, '').replace(',', '.');
    var n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  // Cột "Kế hoạch" là VĂN BẢN lấy nguyên từ Sheet, có thể là số tiền lớn
  // ("250,000,000") hoặc số kèm đơn vị ("2 BỆNH VIỆN", "100 ỐNG"). Hàm này chỉ
  // định dạng lại PHẦN SỐ ở đầu chuỗi theo kiểu Việt Nam (dấu chấm phân cách
  // hàng nghìn, vd "250.000.000"), giữ nguyên phần đơn vị/chữ phía sau.
  function kpiFmtKeHoach(raw) {
    var s = String(raw === null || raw === undefined ? '' : raw).trim();
    if (!s) return '';
    var m = s.match(/^(-?[\d.,]+)(.*)$/);
    if (!m) return s;
    var n = parseFloat(m[1].replace(/,/g, ''));
    if (isNaN(n)) return s;
    return fmtNum.format(n) + m[2];
  }

  function kpiGhiChuCellHtml(rowIndex, value, canEdit) {
    var v = value || '';
    if (!canEdit) return v === '' ? '—' : escapeHtml(v);
    return '<input type="text" maxlength="500" class="kpi-input kpi-input-text" placeholder="Ghi chú…" ' +
      'data-row-type="chiTieuGhiChu" data-row-index="' + rowIndex + '" value="' + escapeHtml(v) + '" />';
  }

  function kpiDiemTruCellHtml(d, canEdit) {
    if (!canEdit) {
      return '<span class="chip small ' + (d.trangThai === 'KHÔNG ĐẠT' ? 'critical' : 'good') + '">' + escapeHtml(d.trangThai) + '</span>';
    }
    return '<select class="kpi-input kpi-select" data-row-type="diemTru" data-row-index="' + d.rowIndex + '">' +
      '<option value="ĐẠT"' + (d.trangThai !== 'KHÔNG ĐẠT' ? ' selected' : '') + '>ĐẠT</option>' +
      '<option value="KHÔNG ĐẠT"' + (d.trangThai === 'KHÔNG ĐẠT' ? ' selected' : '') + '>KHÔNG ĐẠT</option>' +
      '</select>';
  }

  // 1 dòng chỉ tiêu (dùng chung cho bảng "Doanh số" và mỗi bảng sản phẩm
  // trong "Sản phẩm trọng tâm") — showLoai=true thì cột đầu hiển thị tên loại
  // chỉ tiêu ngắn gọn (Khảo sát / Mở mới điểm bán / ...) thay vì tên đầy đủ,
  // vì tên sản phẩm đã lên tiêu đề bảng con rồi, khỏi lặp lại.
  function kpiChiTieuRowHtml(c, canEdit, showLoai) {
    return '<tr>' +
      '<td>' + escapeHtml(showLoai && c.loai ? c.loai : c.chiTieu) + '</td>' +
      '<td>' + escapeHtml(kpiFmtKeHoach(c.keHoach)) + '</td>' +
      '<td class="num">' + kpiValueCellHtml('chiTieu', c.rowIndex, c.thucHien, canEdit) + '</td>' +
      '<td class="num">' + fmtNum.format(c.diemKeHoach || 0) + '</td>' +
      '<td class="num">' + (c.diemThucHien === null || c.diemThucHien === undefined ? '—' : fmtNum.format(c.diemThucHien)) + '</td>' +
      '<td>' + escapeHtml(c.vuotMax) + '</td>' +
      '<td>' + kpiGhiChuCellHtml(c.rowIndex, c.ghiChu, canEdit) + '</td>' +
      '</tr>';
  }

  var KPI_TABLE_HEAD = '<thead><tr><th>Chỉ tiêu</th><th>Kế hoạch</th><th class="num">Thực hiện</th>' +
    '<th class="num">Điểm KH</th><th class="num">Điểm TH</th><th>Vượt max</th><th>Ghi chú</th></tr></thead>';

  // Ghép hoạt động viếng thăm khách hàng (checkin GPS) vào đúng nhân viên
  // đang xem chi tiết KPI, khớp theo họ tên (dữ liệu checkin và KPI nằm ở 2
  // sheet khác nhau, không có ID chung nên khớp theo tên đã chuẩn hoá).
  function kpiFindCheckin(emp) {
    var list = (RAW.checkin && RAW.checkin.employees) || [];
    return list.filter(function (c) { return kpiNormName(c.hoTen) === kpiNormName(emp.hoTen); })[0] || null;
  }

  function renderKpiDetail() {
    var panel = $('kpi-detail-panel');
    if (!KPI_SELECTED_SHEET) { panel.style.display = 'none'; return; }
    var emp = (RAW.kpi.employees || []).filter(function (e) { return e.sheetName === KPI_SELECTED_SHEET; })[0];
    if (!emp) { panel.style.display = 'none'; return; }
    panel.style.display = '';

    var canEdit = kpiCanEdit(emp);
    $('kpi-detail-header').innerHTML =
      '<div class="kpi-detail-title">' + escapeHtml(emp.hoTen) +
      '<span class="chip small ' + (canEdit ? 'good' : 'muted') + '" style="margin-left:8px;">' +
      (canEdit ? 'Bạn có thể sửa' : 'Chỉ xem') + '</span></div>' +
      '<div class="kpi-detail-meta">' +
      [emp.thang, emp.thamNien ? 'Thâm niên: ' + emp.thamNien : '', emp.nhom ? 'Nhóm: ' + emp.nhom : '', emp.ss ? 'SS: ' + emp.ss : '']
        .filter(Boolean).map(escapeHtml).join(' · ') + '</div>';

    var checkin = kpiFindCheckin(emp);
    var checkinEl = $('kpi-checkin-summary');
    if (checkinEl) {
      checkinEl.innerHTML = checkin
        ? 'Hoạt động thăm khách hàng: <b>' + fmtNum.format(checkin.tongLuotCheckin) + '</b> lượt checkin · <b>' +
          fmtNum.format(checkin.soKhachDaTham) + '</b> khách đã ghé · 7 ngày qua: <b>' + fmtNum.format(checkin.luot7Ngay) +
          '</b> · 30 ngày qua: <b>' + fmtNum.format(checkin.luot30Ngay) + '</b>'
        : 'Chưa có dữ liệu checkin thăm khách hàng cho nhân viên này.';
    }

    // Ô tóm tắt kết quả KPI: tổng điểm cuối cùng (đã gồm cộng/trừ) + kết quả
    // ĐẠT / BỊ LIỆT + lý do cụ thể nếu bị liệt, để nhân viên biết ngay cần
    // cải thiện chỉ tiêu nào mà không phải tự cộng trừ thủ công.
    var ketQua = emp.ketQuaKpi || { dat: false, lyDoLiet: [] };
    var resultHtml = '<div class="kpi-result-summary ' + (ketQua.dat ? 'ok' : 'fail') + '">' +
      '<div class="kpi-result-top">' +
      '<span class="chip ' + (ketQua.dat ? 'good' : 'critical') + '">' + (ketQua.dat ? 'ĐẠT KPI' : 'BỊ LIỆT KPI') + '</span>' +
      '<span class="kpi-result-score">Tổng điểm cuối cùng: <b>' + fmtNum.format(kpiFinalScore(emp)) + '</b> điểm (chỉ tiêu ' +
      fmtNum.format(emp.tongDiemThucHien) + ' + cộng thêm ' + fmtNum.format(emp.tongCongThem) + ' − trừ ' +
      fmtNum.format(Math.abs(emp.tongDiemTru || 0)) + ')</span></div>' +
      (ketQua.lyDoLiet && ketQua.lyDoLiet.length
        ? '<ul class="kpi-result-reasons">' + ketQua.lyDoLiet.map(function (r) { return '<li>' + escapeHtml(r) + '</li>'; }).join('') + '</ul>'
        : '') + '</div>';
    $('kpi-result-summary').innerHTML = resultHtml;

    // Nhóm 1 — Doanh số
    var doanhSoRows = emp.chiTieu.filter(function (c) { return c.nhom === 'doanh_so'; });
    var dsBody = $('table-kpi-doanhso').querySelector('tbody');
    dsBody.innerHTML = doanhSoRows.length
      ? doanhSoRows.map(function (c) { return kpiChiTieuRowHtml(c, canEdit, false); }).join('')
      : '<tr><td colspan="7" class="empty-state">Chưa có chỉ tiêu doanh số.</td></tr>';
    var dsKH = sumBy(doanhSoRows, 'diemKeHoach');
    var dsTH = sumBy(doanhSoRows, function (c) { return c.diemThucHien || 0; });
    $('table-kpi-doanhso').querySelector('tfoot').innerHTML =
      '<tr><td colspan="7" class="kpi-group-total-bar">Tổng nhóm Doanh số: <b>' +
      fmtNum.format(dsTH) + ' / ' + fmtNum.format(dsKH) + '</b> điểm' +
      (dsKH > 0 ? ' (' + fmtPct(dsTH / dsKH) + ')' : '') + '</td></tr>';

    // Nhóm 2 — Sản phẩm trọng tâm, tách theo từng sản phẩm (SUGAM-BFS,
    // PROPOFOL-BFS, hoặc bất kỳ sản phẩm nào khác nếu công ty đổi/thêm sau này)
    var spRows = emp.chiTieu.filter(function (c) { return c.nhom === 'san_pham_trong_tam'; });
    var spByProduct = {};
    var spOrder = [];
    spRows.forEach(function (c) {
      var key = c.sanPham || 'Khác';
      if (!spByProduct[key]) { spByProduct[key] = []; spOrder.push(key); }
      spByProduct[key].push(c);
    });
    var spGroupsEl = $('kpi-sp-groups');
    spGroupsEl.innerHTML = spOrder.map(function (key) {
      var rows = spByProduct[key];
      return '<h4 class="kpi-subgroup-title">' + escapeHtml(key) + '</h4>' +
        '<div class="table-wrap"><table class="data-table kpi-detail-table">' + KPI_TABLE_HEAD +
        '<tbody>' + rows.map(function (c) { return kpiChiTieuRowHtml(c, canEdit, true); }).join('') + '</tbody>' +
        '</table></div>';
    }).join('') || '<div class="empty-state small">Chưa có chỉ tiêu sản phẩm trọng tâm.</div>';
    var spKH = sumBy(spRows, 'diemKeHoach');
    var spTH = sumBy(spRows, function (c) { return c.diemThucHien || 0; });
    $('kpi-sp-subtotal').innerHTML = 'Tổng nhóm Sản phẩm trọng tâm: <b>' + fmtNum.format(spTH) + ' / ' + fmtNum.format(spKH) + '</b> điểm' +
      (spKH > 0 ? ' (' + fmtPct(spTH / spKH) + ')' : '');

    // Điểm cộng thêm — tách riêng bên dưới nhóm chỉ tiêu chính
    var bonusBody = $('table-kpi-bonus').querySelector('tbody');
    if (!emp.congThem.length) {
      bonusBody.innerHTML = '<tr><td colspan="3" class="empty-state">Không có mục điểm cộng thêm.</td></tr>';
    } else {
      bonusBody.innerHTML = emp.congThem.map(function (c) {
        return '<tr><td>' + escapeHtml(c.moTa) + '</td><td>' + escapeHtml(c.diemToiDa) + '</td>' +
          '<td class="num">' + kpiValueCellHtml('congThem', c.rowIndex, c.diemThucHien, canEdit) + '</td></tr>';
      }).join('');
    }

    // Điểm trừ KPI — mục mới, KHÔNG đạt thì trừ thẳng vào tổng điểm cuối cùng
    var truBody = $('table-kpi-tru').querySelector('tbody');
    var diemTru = emp.diemTru || [];
    truBody.innerHTML = diemTru.length
      ? diemTru.map(function (d) {
          return '<tr><td>' + escapeHtml(d.moTa) + '</td>' +
            '<td>' + kpiDiemTruCellHtml(d, canEdit) + '</td>' +
            '<td class="num">' + fmtNum.format(d.mucTru) + '</td>' +
            '<td class="num">' + fmtNum.format(d.diemThucTe) + '</td></tr>';
        }).join('')
      : '<tr><td colspan="4" class="empty-state">Không có mục điểm trừ.</td></tr>';

    // Tổng điểm cuối cùng dạng "940 điểm kpis / 1000 điểm kpis" — 1 mục RIÊNG
    // ở cuối trang, sau khi đã cộng điểm cộng thêm và trừ điểm trừ, để nhân
    // viên thấy ngay kết quả tổng mà không phải tự cộng trừ các mục phía trên.
    var finalScoreEl = $('kpi-final-score');
    if (finalScoreEl) {
      var finalScore = kpiFinalScore(emp);
      finalScoreEl.innerHTML =
        '<span class="kpi-final-score-label">Tổng điểm KPI sau cộng/trừ</span>' +
        '<span class="kpi-final-score-value">' + fmtNum.format(finalScore) + ' điểm kpis</span>' +
        '<span class="kpi-final-score-sep">/</span>' +
        '<span class="kpi-final-score-max">1000 điểm kpis</span>';
    }

    $('kpi-save-status').textContent = '';
    $('kpi-save-status').className = 'kpi-save-status';
    if (canEdit) attachKpiInputHandlers(emp);
  }

  function kpiFindRowMeta(emp, rowType, rowIndex) {
    var list = (rowType === 'congThem') ? emp.congThem : (rowType === 'diemTru') ? emp.diemTru : emp.chiTieu;
    return (list || []).filter(function (r) { return r.rowIndex === rowIndex; })[0] || null;
  }

  function attachKpiInputHandlers(emp) {
    var els = $('kpi-detail-panel').querySelectorAll('.kpi-input');
    els.forEach(function (el) {
      // Ô số (Thực hiện / Điểm đạt được): bỏ dấu chấm khi bấm vào để gõ cho dễ
      // (vd "500.000.000" -> "500000000"), rồi tự thêm lại dấu chấm khi rời ô
      // (vd gõ xong -> "500.000.000") — thuần hiển thị, KHÔNG liên quan việc
      // lưu (việc lưu đọc trực tiếp từ el.value tại thời điểm sự kiện "change",
      // luôn parse đúng dù đang có dấu chấm hay không nhờ kpiParseVnNumber()).
      if (el.classList.contains('kpi-input-number')) {
        el.addEventListener('focus', function () {
          var n = kpiParseVnNumber(el.value);
          el.value = (n === null) ? '' : String(n);
        });
        el.addEventListener('blur', function () {
          var n = kpiParseVnNumber(el.value);
          el.value = (n === null) ? '' : fmtNum.format(n);
        });
      }

      el.addEventListener('change', function () {
        var rowType = el.dataset.rowType;
        var rowIndex = +el.dataset.rowIndex;
        var rowMeta = kpiFindRowMeta(emp, rowType, rowIndex);
        if (!rowMeta) return;
        var newVal;
        if (rowType === 'chiTieuGhiChu') {
          newVal = el.value;
        } else if (rowType === 'diemTru') {
          newVal = el.value;
        } else {
          var parsed = el.value.trim() === '' ? 0 : kpiParseVnNumber(el.value);
          if (parsed === null) {
            var fallback = rowType === 'congThem' ? (rowMeta.diemThucHien || 0) : (rowMeta.thucHien != null ? rowMeta.thucHien : 0);
            el.value = fmtNum.format(fallback);
            return;
          }
          newVal = parsed;
        }
        saveKpiValue(emp.sheetName, rowType, rowIndex, newVal, el);
      });
    });
  }

  function saveKpiValue(sheetName, rowType, rowIndex, thucHien, inputEl) {
    var statusEl = $('kpi-save-status');
    statusEl.textContent = 'Đang lưu…';
    statusEl.className = 'kpi-save-status';
    if (inputEl) inputEl.disabled = true;
    fetch('/.netlify/functions/kpi', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeader()),
      body: JSON.stringify({ sheetName: sheetName, rowType: rowType, rowIndex: rowIndex, thucHien: thucHien })
    })
      .then(function (res) { return res.json().then(function (j) { return { status: res.status, body: j }; }); })
      .then(function (r) {
        if (!r.body || !r.body.ok) throw new Error((r.body && r.body.error) || 'Lưu thất bại');
        var idx = -1;
        for (var i = 0; i < RAW.kpi.employees.length; i++) {
          if (RAW.kpi.employees[i].sheetName === sheetName) { idx = i; break; }
        }
        if (idx !== -1) RAW.kpi.employees[idx] = r.body.data;
        // renderKpi() -> renderKpiDetail() luôn xoá trắng #kpi-save-status khi vẽ
        // lại (để dọn trạng thái "Đang lưu…" cũ), nên PHẢI render xong rồi mới
        // ghi thông báo "Đã lưu" — nếu làm ngược lại, thông báo bị xoá ngay lập
        // tức trong cùng một lượt và người dùng sẽ không thấy xác nhận lưu thành công.
        renderKpi();
        var doneEl = $('kpi-save-status');
        doneEl.textContent = 'Đã lưu lúc ' + new Date().toLocaleTimeString('vi-VN');
        doneEl.className = 'kpi-save-status ok';
      })
      .catch(function (err) {
        statusEl.textContent = 'Lỗi: ' + err.message;
        statusEl.className = 'kpi-save-status error';
      })
      .finally(function () {
        if (inputEl) inputEl.disabled = false;
      });
  }

  // ==========================================================================
  // TAB 3: SALE KHÁCH HÀNG
  // ==========================================================================
  function getSalesFiltered() {
    var tinh = $('sales-filter-tinh').value;
    var nv = $('sales-filter-nv').value;
    var nhom = $('sales-filter-nhom').value;
    var from = $('sales-filter-from').value;
    var to = $('sales-filter-to').value;
    var q = $('sales-filter-search').value.trim().toLowerCase();
    return RAW.sales.filter(function (r) {
      if (tinh && r.tinh !== tinh) return false;
      if (nv && r.nhanVien !== nv) return false;
      if (nhom && r.nhomHang !== nhom) return false;
      if (from && r.ngay < from) return false;
      if (to && r.ngay > to) return false;
      if (q) {
        var hay = (r.tenKhach + ' ' + r.tenHang + ' ' + r.maKhach).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function renderSales() {
    var rows = getSalesFiltered();
    var totalDoanhThu = sumBy(rows, 'doanhThu');
    var soDon = rows.length;
    var soKhach = uniqueSorted(rows.map(function (r) { return r.maKhach; })).length;
    var tbDon = soDon > 0 ? totalDoanhThu / soDon : 0;

    $('sales-stats').innerHTML = [
      statTile('Tổng doanh thu', fmtVnd(totalDoanhThu)),
      statTile('Số đơn / dòng hàng', fmtNum.format(soDon)),
      statTile('Số khách hàng', fmtNum.format(soKhach)),
      statTile('Doanh thu TB / dòng', fmtVnd(tbDon))
    ].join('');

    renderSalesTimeChart(rows);
    renderSalesBreakdownCharts(rows);

    var custMap = {};
    rows.forEach(function (r) {
      var k = r.maKhach;
      if (!custMap[k]) custMap[k] = { tenKhach: r.tenKhach, tinh: r.tinh, nhanVien: r.nhanVien, soDon: 0, doanhThu: 0 };
      custMap[k].soDon++;
      custMap[k].doanhThu += r.doanhThu;
    });
    var custRows = Object.keys(custMap).map(function (k) { return custMap[k]; }).sort(function (a, b) { return b.doanhThu - a.doanhThu; }).slice(0, 50);
    setText('sales-cust-count', '(top ' + custRows.length + ')');
    var custBody = $('table-sales-cust').querySelector('tbody');
    custBody.innerHTML = custRows.length ? custRows.map(function (r) {
      return '<tr><td>' + escapeHtml(r.tenKhach) + '</td><td>' + escapeHtml(r.tinh) + '</td>' +
        '<td>' + escapeHtml(r.nhanVien) + '</td><td class="num">' + fmtNum.format(r.soDon) + '</td>' +
        '<td class="num">' + fmtVnd(r.doanhThu) + '</td></tr>';
    }).join('') : '<tr><td colspan="5" class="empty-state">Không có dữ liệu phù hợp bộ lọc.</td></tr>';

    setText('sales-row-count', '(' + fmtNum.format(rows.length) + ' dòng, hiển thị tối đa 500 dòng gần nhất)');
    renderSalesTableBody(rows);
    attachSort('table-sales', getSalesFiltered, renderSalesTableBody);
  }

  function renderSalesTableBody(rows) {
    var body = $('table-sales').querySelector('tbody');
    var display = rows.slice().sort(function (a, b) { return b.ngay < a.ngay ? -1 : 1; }).slice(0, 500);
    if (!display.length) { body.innerHTML = '<tr><td colspan="8" class="empty-state">Không có dữ liệu phù hợp bộ lọc.</td></tr>'; return; }
    body.innerHTML = display.map(function (r) {
      return '<tr><td>' + fmtDate(r.ngay) + '</td><td>' + escapeHtml(r.nhanVien) + '</td>' +
        '<td>' + escapeHtml(r.tenKhach) + '</td><td>' + escapeHtml(r.tinh) + '</td>' +
        '<td>' + escapeHtml(r.nhomHang) + '</td><td>' + escapeHtml(r.tenHang) + '</td>' +
        '<td class="num">' + fmtNum.format(r.soLuong) + '</td><td class="num">' + fmtVnd(r.doanhThu) + '</td></tr>';
    }).join('');
  }

  function renderSalesTimeChart(rows) {
    var byDate = {};
    rows.forEach(function (r) { byDate[r.ngay] = (byDate[r.ngay] || 0) + r.doanhThu; });
    var dates = Object.keys(byDate).sort();
    upsertChart('chart-sales-time', {
      type: 'line',
      data: {
        labels: dates.map(fmtDate),
        datasets: [{
          data: dates.map(function (d) { return byDate[d]; }),
          borderColor: '#6fa8dc', backgroundColor: 'rgba(111,168,220,0.12)',
          fill: true, tension: 0.25, pointRadius: 0, borderWidth: 2
        }]
      },
      options: Object.assign({}, CHART_BASE_OPTS, {
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (ctx) { return fmtVnd(ctx.parsed.y); } } } }
      })
    });
  }

  function renderSalesBreakdownCharts(rows) {
    var byTinh = {}, byNhom = {};
    rows.forEach(function (r) {
      byTinh[r.tinh || '(khác)'] = (byTinh[r.tinh || '(khác)'] || 0) + r.doanhThu;
      byNhom[r.nhomHang || '(khác)'] = (byNhom[r.nhomHang || '(khác)'] || 0) + r.doanhThu;
    });
    var tinhKeys = Object.keys(byTinh).sort(function (a, b) { return byTinh[b] - byTinh[a]; });
    upsertChart('chart-sales-tinh', {
      type: 'bar',
      data: { labels: tinhKeys, datasets: [{ data: tinhKeys.map(function (k) { return byTinh[k]; }), backgroundColor: '#6fa8dc', borderRadius: 4, maxBarThickness: 32 }] },
      options: Object.assign({}, CHART_BASE_OPTS, {
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (ctx) { return fmtVnd(ctx.parsed.y); } } } }
      })
    });
    var nhomKeys = Object.keys(byNhom).sort(function (a, b) { return byNhom[b] - byNhom[a]; });
    upsertChart('chart-sales-nhom', {
      type: 'bar',
      data: { labels: nhomKeys, datasets: [{ data: nhomKeys.map(function (k) { return byNhom[k]; }), backgroundColor: nhomKeys.map(function (_, i) { return PALETTE[i % PALETTE.length]; }), borderRadius: 4, maxBarThickness: 32 }] },
      options: Object.assign({}, CHART_BASE_OPTS, {
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (ctx) { return fmtVnd(ctx.parsed.y); } } } }
      })
    });
  }

  // ==========================================================================
  // TAB: SẢN PHẨM TRỌNG TÂM — Sugam-BFS / Propofol-BFS của Team SS Tạ Hoàng
  // Duy. Dữ liệu được 1 workflow n8n tự tính lũy kế mỗi ngày (đọc từ sheet đơn
  // hàng), Apps Script chỉ đọc lại tab đã tính sẵn, xem thêm getSanPhamTrongTam_
  // trong Code.gs. Không có bộ lọc/bảng chi tiết — chỉ hiển thị thẻ tổng quan
  // (lũy kế quý của team + lũy kế tháng của từng nhân viên), theo đúng yêu cầu
  // "tên nhân viên và tiêu đề to rõ ràng, icon ngộ nghĩnh cho sinh động".
  // ==========================================================================
  var SPTT_PRODUCT_ICON = { 'Propofol BFS': '💉', 'Sugam BFS': '🧴' };
  var SPTT_MEDALS = ['🥇', '🥈', '🥉'];

  function spttProgressBar(ratioPct) {
    var ratio = Math.max(0, (ratioPct || 0) / 100);
    var cls = progressClass(ratio);
    return '<div class="progress-cell"><div class="progress-track">' +
      '<div class="progress-fill ' + cls + '" style="width:' + (Math.min(1, ratio) * 100) + '%"></div></div>' +
      '<div class="progress-pct">' + (ratioPct || 0).toFixed(1).replace('.0', '') + '%</div></div>';
  }

  function spttTeamCardHtml(t) {
    var icon = SPTT_PRODUCT_ICON[t.sanPham] || '🎯';
    return '<div class="sptt-team-card">' +
      '<div class="sptt-team-card-head"><span class="sptt-card-icon">' + icon + '</span>' +
      '<span class="sptt-team-card-name">' + escapeHtml(t.sanPham) + '</span></div>' +
      '<div class="sptt-team-card-nums">' +
      '<span class="sptt-luyke">' + fmtNum.format(t.luyKe) + '</span>' +
      '<span class="sptt-target">/ ' + fmtNum.format(t.target) + ' ống (Target Quý 3)</span></div>' +
      spttProgressBar(t.tyLe) + '</div>';
  }

  function spttEmpAvgTyLe(emp) {
    if (!emp.items.length) return 0;
    return sumBy(emp.items, 'tyLe') / emp.items.length;
  }

  // Danh sách khách hàng đang mua Sugam-BFS/Propofol-BFS theo từng nhân viên
  // (số lượng + số đơn hàng trong tháng) — xem getSpttKhachHangByNV_ trong
  // Code.gs. Gộp gọn trong 1 khối gấp (<details>) bên trong thẻ nhân viên,
  // đúng phong cách "khối gấp theo từng nhân viên" đã dùng ở tab Giao việc,
  // để thẻ mặc định vẫn gọn mà vẫn xem chi tiết được khi cần.
  var SPTT_PRODUCT_SHORT = { SUGAM: 'Sugam', PROPOFOL: 'Propofol' };
  var SPTT_PRODUCT_BADGE_ICON = { SUGAM: '🧴', PROPOFOL: '💉' };

  function spttCustProductBadgeHtml(p) {
    var icon = SPTT_PRODUCT_BADGE_ICON[p.sanPham] || '🎯';
    var label = SPTT_PRODUCT_SHORT[p.sanPham] || p.sanPham;
    var cls = 'sptt-cust-badge sptt-cust-badge--' + String(p.sanPham || '').toLowerCase();
    return '<span class="' + cls + '">' + icon + ' ' + escapeHtml(label) + ': ' +
      fmtNum.format(p.soLuong) + ' ống (' + fmtNum.format(p.soDon) + ' đơn)</span>';
  }

  function spttCustRowHtml(c) {
    var badges = (c.products || []).map(spttCustProductBadgeHtml).join('');
    return '<div class="sptt-cust-row">' +
      '<span class="sptt-cust-name">🏥 ' + escapeHtml(c.tenKhach || c.maKhach || '—') + '</span>' +
      '<span class="sptt-cust-products">' + badges + '</span></div>';
  }

  function spttEmpCustDetailsHtml(emp) {
    var list = emp.khachHang || [];
    var body = list.length
      ? list.map(spttCustRowHtml).join('')
      : '<div class="empty-state small">Chưa có khách hàng nào mua sản phẩm trọng tâm tháng này.</div>';
    return '<details class="sptt-cust-details">' +
      '<summary class="sptt-cust-summary">🛍️ Khách hàng đang mua (' + list.length + ')</summary>' +
      '<div class="sptt-cust-list">' + body + '</div></details>';
  }

  function spttEmpCardHtml(emp, rankIdx) {
    var medal = SPTT_MEDALS[rankIdx] ? '<span class="sptt-emp-medal">' + SPTT_MEDALS[rankIdx] + '</span>' : '';
    var rows = emp.items.map(function (it) {
      var icon = SPTT_PRODUCT_ICON[it.sanPham] || '🎯';
      return '<div class="sptt-product-row">' +
        '<span class="sptt-product-icon">' + icon + '</span>' +
        '<span class="sptt-product-label">' + escapeHtml(it.sanPham) + '</span>' +
        '<span class="sptt-product-nums">' + fmtNum.format(it.luyKe) + ' / ' + fmtNum.format(it.target) + ' ống</span>' +
        spttProgressBar(it.tyLe) + '</div>';
    }).join('');
    return '<div class="sptt-emp-card">' +
      '<div class="sptt-emp-card-head">' + medal + chatAvatarHtml(emp.hoTen, emp.maNhanVien || emp.hoTen) +
      '<span class="sptt-emp-name">' + escapeHtml(emp.hoTen) + '</span></div>' +
      rows + spttEmpCustDetailsHtml(emp) + '</div>';
  }

  function renderSptt() {
    var data = RAW.sptt || { capNhatLuc: '', team: [], employees: [] };
    var teamBox = $('sptt-team-cards');
    var empBox = $('sptt-emp-cards');
    if (!teamBox || !empBox) return;

    teamBox.innerHTML = data.team.length
      ? data.team.map(spttTeamCardHtml).join('')
      : '<div class="empty-state small">Chưa có dữ liệu — workflow n8n chưa chạy lần nào hoặc chưa tới giờ chạy đầu tiên (6h sáng hàng ngày).</div>';

    var emps = data.employees.slice().sort(function (a, b) { return spttEmpAvgTyLe(b) - spttEmpAvgTyLe(a); });
    empBox.innerHTML = emps.length
      ? emps.map(function (e, i) { return spttEmpCardHtml(e, i); }).join('')
      : '<div class="empty-state small">Chưa có dữ liệu nhân viên.</div>';

    setText('sptt-updated', data.capNhatLuc ? 'n8n cập nhật lúc ' + new Date(data.capNhatLuc).toLocaleString('vi-VN') : '');
  }

  // ==========================================================================
  // TAB: DOANH SỐ — Kê đơn + Thầu của Team SS Tạ Hoàng Duy. Cũng do 1 workflow
  // n8n khác tự lọc/tính mỗi ngày từ sheet đơn hàng (xem getDoanhSo_ trong
  // Code.gs), Apps Script chỉ đọc lại tab đã tính sẵn. Gồm: 2 thẻ tổng team
  // (Kê đơn / Thầu), xếp hạng hoàn thành chỉ tiêu từng nhân viên, và top 10
  // khách hàng doanh số cao nhất — phong cách chibi dễ thương, icon ngộ nghĩnh.
  // ==========================================================================
  var DS_LOAI_ICON = { KEDON: '💊', THAU: '🏛️' };
  var DS_LOAI_LABEL = { KEDON: 'Kê đơn', THAU: 'Thầu' };
  var DS_CROWNS = ['👑', '🥈', '🥉'];

  function fmtTrieu(n) {
    var trieu = (n || 0) / 1000000;
    return trieu.toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' triệu';
  }

  function dsTeamCardHtml(t) {
    var icon = DS_LOAI_ICON[t.loai] || '💰';
    var label = DS_LOAI_LABEL[t.loai] || t.loai;
    return '<div class="ds-team-card ds-team-card--' + String(t.loai || '').toLowerCase() + '">' +
      '<div class="ds-team-card-head"><span class="ds-card-icon">' + icon + '</span>' +
      '<span class="ds-team-card-name">' + escapeHtml(label) + '</span></div>' +
      '<div class="ds-team-card-nums">' +
      '<span class="ds-luyke">' + fmtTrieu(t.luyKe) + '</span>' +
      '<span class="ds-target">/ ' + fmtTrieu(t.target) + ' (Target tháng 9)</span></div>' +
      spttProgressBar(t.tyLe) + '</div>';
  }

  function dsEmpAvgTyLe(emp) {
    if (!emp.items.length) return 0;
    return sumBy(emp.items, 'tyLe') / emp.items.length;
  }

  function dsEmpCardHtml(emp, rankIdx) {
    var medal = SPTT_MEDALS[rankIdx] ? '<span class="ds-emp-medal">' + SPTT_MEDALS[rankIdx] + '</span>' : '';
    var rows = emp.items.map(function (it) {
      var icon = DS_LOAI_ICON[it.loai] || '💰';
      var label = DS_LOAI_LABEL[it.loai] || it.loai;
      return '<div class="ds-product-row">' +
        '<span class="ds-product-icon">' + icon + '</span>' +
        '<span class="ds-product-label">' + escapeHtml(label) + '</span>' +
        '<span class="ds-product-nums">' + fmtTrieu(it.luyKe) + ' / ' + fmtTrieu(it.target) + '</span>' +
        spttProgressBar(it.tyLe) + '</div>';
    }).join('');
    return '<div class="ds-emp-card">' +
      '<div class="ds-emp-card-head">' + medal + chatAvatarHtml(emp.hoTen, emp.maNhanVien || emp.hoTen) +
      '<span class="ds-emp-name">' + escapeHtml(emp.hoTen) + '</span></div>' +
      rows + '</div>';
  }

  function dsCustRowHtml(c, rankIdx) {
    var crown = DS_CROWNS[rankIdx] ? '<span class="ds-cust-crown">' + DS_CROWNS[rankIdx] + '</span>' : '';
    var sharePct = (c.tyLe || 0).toFixed(1).replace('.0', '');
    return '<div class="ds-cust-row">' +
      '<span class="ds-cust-rank">#' + (rankIdx + 1) + '</span>' + crown +
      '<span class="ds-cust-name">' + escapeHtml(c.tenToChuc || c.maToChuc || '—') + '</span>' +
      '<span class="ds-cust-amount">' + fmtTrieu(c.luyKe) + '</span>' +
      '<span class="ds-cust-share">' + sharePct + '% doanh số team</span></div>';
  }

  function renderDoanhSo() {
    var data = RAW.doanhso || { capNhatLuc: '', team: [], employees: [], khachHang: [] };
    var teamBox = $('ds-team-cards');
    var empBox = $('ds-emp-cards');
    var custBox = $('ds-cust-list');
    if (!teamBox || !empBox || !custBox) return;

    teamBox.innerHTML = data.team.length
      ? data.team.map(dsTeamCardHtml).join('')
      : '<div class="empty-state small">Chưa có dữ liệu — workflow n8n chưa chạy lần nào hoặc chưa tới giờ chạy đầu tiên (6h10 sáng hàng ngày).</div>';

    var emps = data.employees.slice().sort(function (a, b) { return dsEmpAvgTyLe(b) - dsEmpAvgTyLe(a); });
    empBox.innerHTML = emps.length
      ? emps.map(function (e, i) { return dsEmpCardHtml(e, i); }).join('')
      : '<div class="empty-state small">Chưa có dữ liệu nhân viên.</div>';

    var custs = (data.khachHang || []).slice().sort(function (a, b) { return b.luyKe - a.luyKe; });
    custBox.innerHTML = custs.length
      ? custs.map(function (c, i) { return dsCustRowHtml(c, i); }).join('')
      : '<div class="empty-state small">Chưa có dữ liệu khách hàng.</div>';

    setText('ds-updated', data.capNhatLuc ? 'n8n cập nhật lúc ' + new Date(data.capNhatLuc).toLocaleString('vi-VN') : '');
  }

  // --------------------------------------------------------------------------
  // CALL & CUNG TUYẾN — "đã gặp khách nào trong tháng" + gợi ý cung tuyến tuần
  // Nguồn dữ liệu: sheet CALL / CUNG-TUYEN (nhật ký check-in gặp khách của
  // trình dược viên) — gộp lại ở phía Apps Script (getAllVisitLogs_), không
  // phải 1 sheet cố định, nên phần này KHÔNG nằm trong loadAll()/type=all mà
  // tự gọi API riêng (type=callCungTuyen / type=goiyCungTuyen) khi người dùng
  // mở tab, để không làm chậm lần tải trang đầu tiên.
  // --------------------------------------------------------------------------
  // Vòng 15: mặc định mở subtab "Gợi ý cung tuyến tuần" (sub: 'goiy') thay vì
  // "Đã gặp khách trong tháng" — theo yêu cầu, đây là phần nhân viên cần xem
  // ngay khi mở web mỗi sáng để biết hôm nay đi đâu.
  var CCT = { inited: false, sub: 'goiy', gapkhachLoaded: false, data: { nam: 0, thang: 0, nhanVien: [] } };
  var GOIY = { loaded: false, data: { soNgayNguong: 30, soKhachMoiNgay: 5, nhanVien: [] } };
  var VN_MONTHS_FULL = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'];

  function apiUrlExtra(type, extra) {
    var u = apiUrl(type);
    for (var k in extra) {
      if (extra[k] !== undefined && extra[k] !== null && extra[k] !== '') {
        u += '&' + k + '=' + encodeURIComponent(extra[k]);
      }
    }
    return u;
  }

  function initCallCungTuyenTab() {
    if (CCT.inited) return;
    CCT.inited = true;

    var now = new Date();
    var thangSel = $('cct-thang');
    var namSel = $('cct-nam');
    thangSel.innerHTML = VN_MONTHS_FULL.map(function (label, i) {
      return '<option value="' + (i + 1) + '">' + label + '</option>';
    }).join('');
    thangSel.value = String(now.getMonth() + 1); // mặc định THÁNG HIỆN TẠI (tháng 9)
    var namNow = now.getFullYear();
    namSel.innerHTML = [namNow - 1, namNow, namNow + 1].map(function (y) {
      return '<option value="' + y + '">' + y + '</option>';
    }).join('');
    namSel.value = String(namNow);

    fillSelect($('cct-filter-nv'), RAW.meta.nhanVien || [], 'Tất cả nhân viên');

    document.querySelectorAll('.cct-subtab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.cct-subtab-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        CCT.sub = btn.dataset.cct;
        $('cct-panel-gapkhach').classList.toggle('hidden', CCT.sub !== 'gapkhach');
        $('cct-panel-goiy').classList.toggle('hidden', CCT.sub !== 'goiy');
        $('cct-panel-kehoach').classList.toggle('hidden', CCT.sub !== 'kehoach');
        // Vòng 15: mỗi subtab chỉ tải dữ liệu lần ĐẦU TIÊN được mở tới (lazy),
        // "Gợi ý cung tuyến tuần" đã tải sẵn ngay lúc mở tab (xem bên dưới) vì
        // giờ là subtab mặc định.
        if (CCT.sub === 'gapkhach' && !CCT.gapkhachLoaded) { CCT.gapkhachLoaded = true; loadCallCungTuyenThang(); }
        if (CCT.sub === 'goiy' && !GOIY.loaded) loadGoiYCungTuyen();
        if (CCT.sub === 'kehoach') initKeHoachTab();
      });
    });

    ['cct-thang', 'cct-nam'].forEach(function (id) { $(id).addEventListener('change', loadCallCungTuyenThang); });
    $('cct-refresh').addEventListener('click', loadCallCungTuyenThang);
    $('cct-filter-nv').addEventListener('change', renderCctTable);
    $('cct-filter-search').addEventListener('input', debounce(renderCctTable, 200));
    $('goiy-apply').addEventListener('click', loadGoiYCungTuyen);

    // Vòng 15: tải ngay "Gợi ý cung tuyến tuần" khi vừa mở tab Call & Cung
    // tuyến (đây là subtab mặc định), không đợi bấm mới tải.
    loadGoiYCungTuyen();
  }

  function loadCallCungTuyenThang() {
    var thang = $('cct-thang').value;
    var nam = $('cct-nam').value;
    setText('cct-updated', 'Đang tải…');
    fetch(apiUrlExtra('callCungTuyen', { thang: thang, nam: nam }))
      .then(parseJsonRes_)
      .then(function (json) {
        if (!json.ok) throw new Error(json.error || 'Lỗi không xác định từ API');
        CCT.data = json.data || { nam: nam, thang: thang, nhanVien: [] };
        setText('cct-updated', 'Cập nhật lúc ' + new Date(json.updatedAt).toLocaleString('vi-VN'));
        renderCctSummary();
        renderCctTable();
      })
      .catch(function (err) {
        setText('cct-updated', '');
        showGlobalError('Không tải được dữ liệu Call/Cung tuyến: ' + err.message);
      });
  }

  function renderCctSummary() {
    var box = $('cct-summary-cards');
    var nv = CCT.data.nhanVien || [];
    var tongKhach = nv.reduce(function (s, e) { return s + e.soKhachDaGap; }, 0);
    var tongLuot = nv.reduce(function (s, e) { return s + e.tongLuotGap; }, 0);
    var monthLabel = (VN_MONTHS_FULL[(CCT.data.thang || 1) - 1] || '') + '/' + CCT.data.nam;
    box.innerHTML = [
      cctStatCardHtml('Tháng đang xem', monthLabel, ''),
      cctStatCardHtml('Nhân viên có dữ liệu', String(nv.length), ''),
      cctStatCardHtml('Khách hàng tổ chức đã ghé', fmtNum.format(tongKhach), '(không trùng cơ sở/nhân viên)'),
      cctStatCardHtml('Tổng số call phát sinh', fmtNum.format(tongLuot), '')
    ].join('');
  }
  function cctStatCardHtml(label, value, sub) {
    return '<div class="cct-stat-card"><div class="cct-stat-label">' + escapeHtml(label) + '</div>' +
      '<div class="cct-stat-value">' + escapeHtml(value) + '</div>' +
      (sub ? '<div class="cct-stat-sub">' + escapeHtml(sub) + '</div>' : '') + '</div>';
  }

  // Bảng "Khách hàng tổ chức ghé thường xuyên nhất" — mỗi dòng = 1 khách hàng
  // tổ chức (cơ sở/bệnh viện, KHÔNG phải người liên hệ cá nhân) của 1 nhân
  // viên trong tháng đang xem, xếp theo `thuHang` (Apps Script đã xếp theo số
  // call phát sinh giảm dần — xem getCallCungTuyenTheoThang_).
  function renderCctTable() {
    var tbody = document.querySelector('#table-cct-gapkhach tbody');
    if (!tbody) return;
    var nvFilter = $('cct-filter-nv').value;
    var search = ($('cct-filter-search').value || '').toLowerCase().trim();
    var rows = [];
    (CCT.data.nhanVien || []).forEach(function (emp) {
      if (nvFilter && emp.hoTen !== nvFilter) return;
      (emp.khach || []).forEach(function (kh) {
        if (search && (kh.tenKH || '').toLowerCase().indexOf(search) === -1) return;
        rows.push({ emp: emp, kh: kh });
      });
    });
    // Nhân viên (theo tên) rồi thứ hạng trong nội bộ nhân viên đó — để mỗi
    // khối nhân viên tự đứng thành nhóm, dễ nhìn khi xem "Tất cả nhân viên".
    rows.sort(function (a, b) {
      var h = (a.emp.hoTen || '').localeCompare(b.emp.hoTen || '', 'vi');
      return h !== 0 ? h : (a.kh.thuHang || 0) - (b.kh.thuHang || 0);
    });
    setText('cct-table-count', '(' + rows.length + ')');
    tbody.innerHTML = rows.length ? rows.map(function (r) {
      return '<tr>' +
        '<td><span class="cct-rank-badge">' + cctRankMedal(r.kh.thuHang) + (r.kh.thuHang || '') + '</span></td>' +
        '<td>' + escapeHtml(r.emp.hoTen) + '</td>' +
        '<td>' + escapeHtml(r.kh.tenKH || r.kh.maKH || '—') + '</td>' +
        '<td>' + fmtNum.format(r.kh.soLanGap) + '</td>' +
        '<td>' + fmtDate(r.kh.lanDau) + '</td>' +
        '<td>' + fmtDate(r.kh.lanCuoi) + '</td>' +
        '<td>' + escapeHtml(r.kh.ghiChuGanNhat || '—') + '</td>' +
        '</tr>';
    }).join('') : '<tr><td colspan="7" class="empty-state small">Không có dữ liệu phù hợp bộ lọc.</td></tr>';
  }

  function cctRankMedal(thuHang) {
    if (thuHang === 1) return '🥇 ';
    if (thuHang === 2) return '🥈 ';
    if (thuHang === 3) return '🥉 ';
    return '#';
  }

  function loadGoiYCungTuyen() {
    var soNgay = $('goiy-songay').value || 30;
    var soKhach = $('goiy-sokhach').value || 5;
    setText('goiy-updated', 'Đang tải…');
    fetch(apiUrlExtra('goiyCungTuyen', { soNgay: soNgay, soKhach: soKhach }))
      .then(parseJsonRes_)
      .then(function (json) {
        if (!json.ok) throw new Error(json.error || 'Lỗi không xác định từ API');
        GOIY.loaded = true;
        GOIY.data = json.data || { nhanVien: [] };
        setText('goiy-updated', 'Cập nhật lúc ' + new Date(json.updatedAt).toLocaleString('vi-VN') +
          ' · Ngưỡng ' + GOIY.data.soNgayNguong + ' ngày · ' + GOIY.data.soKhachMoiNgay + ' khách/ngày');
        renderGoiYCungTuyen();
      })
      .catch(function (err) {
        setText('goiy-updated', '');
        showGlobalError('Không tải được gợi ý cung tuyến: ' + err.message);
      });
  }

  function renderGoiYCungTuyen() {
    var box = $('goiy-employee-list');
    var list = GOIY.data.nhanVien || [];
    $('goiy-empty').classList.toggle('hidden', list.length > 0);
    box.innerHTML = list.map(goiyEmployeeCardHtml).join('');
  }

  function goiyEmployeeCardHtml(emp) {
    var daysHtml = (emp.ngay || []).map(function (d) {
      var khHtml = d.khach.map(function (k) {
        return '<div class="goiy-khach-item">' +
          '<div class="goiy-khach-ten">' + escapeHtml(k.tenKhach || k.maKhach) + '</div>' +
          '<div class="goiy-khach-meta">Mã ' + escapeHtml(k.maKhach) + ' · ' + k.soNgayChuaLapLai + ' ngày chưa lặp lại đơn</div>' +
          '<div class="goiy-khach-meta">Mua gần nhất: ' + fmtDate(k.ngayMuaGanNhat) + ' · ' + k.soDonDaMua + ' đơn</div>' +
          '</div>';
      }).join('');
      return '<div class="goiy-day-col"><div class="goiy-day-label">' + escapeHtml(d.thu) + '</div>' + khHtml + '</div>';
    }).join('');
    return '<div class="panel goiy-emp-card">' +
      '<h2>' + escapeHtml(emp.nhanVien) + ' <span class="count">' + emp.tongSoKhachGoiY + ' khách cần ghé lại</span></h2>' +
      '<div class="goiy-week-grid">' + daysHtml + '</div>' +
      '</div>';
  }

  // --------------------------------------------------------------------------
  // DỰ KIẾN TUẦN SAU — kế hoạch ghé khách hàng tổ chức cho 1 tuần cụ thể.
  // Admin điền được cho bất kỳ ai; nhân viên chỉ tự điền/xoá của chính mình.
  // Việc XEM (danh sách kế hoạch + gợi ý tên khách hàng tổ chức) gọi TRỰC
  // TIẾP Apps Script, giống mọi dữ liệu xem khác — chỉ 2 hành động GHI (thêm
  // /xoá) mới đi qua Netlify Function cct-plan.js để kiểm tra quyền.
  // --------------------------------------------------------------------------
  var KEHOACH = { inited: false, tuanKey: '', list: [], employees: [], employeesLoaded: false, goiYMap: {} };

  // Trả về ngày Thứ 2 (đầu tuần) của tuần CHỨA dateStr (yyyy-MM-dd) — dùng
  // chung cho cả input <type=date> (người dùng có thể chọn bất kỳ ngày nào
  // trong tuần, tự động quy về đúng Thứ 2) và cho nút "Tuần trước/Tuần sau".
  function mondayOfWeek(dateStr) {
    var d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) d = new Date();
    var day = d.getDay(); // 0 = Chủ nhật
    var diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return isoDateStr(d);
  }
  function isoDateStr(d) {
    var y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
    return y + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }
  function addDaysStr(dateStr, days) {
    var d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return isoDateStr(d);
  }
  function fmtDateVN(dateStr) {
    if (!dateStr) return '';
    var p = dateStr.split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : dateStr;
  }

  function initKeHoachTab() {
    var session = getSession();
    var isAdmin = !!session && session.vaiTro === 'admin';
    $('kehoach-nv-field').classList.toggle('hidden', !isAdmin);
    if (isAdmin && !KEHOACH.employeesLoaded) loadKeHoachEmployees();
    if (!KEHOACH.goiYLoaded) loadKeHoachGoiY();

    if (!KEHOACH.inited) {
      KEHOACH.inited = true;
      // Mặc định mở đúng "tuần SAU" (tuần kế tiếp tuần hiện tại), đúng như
      // tên mục — người dùng vẫn đổi được qua ô chọn ngày hoặc nút tuần trước/sau.
      var todayStr = isoDateStr(new Date());
      KEHOACH.tuanKey = addDaysStr(mondayOfWeek(todayStr), 7);
      $('kehoach-tuan-input').value = KEHOACH.tuanKey;

      $('kehoach-tuan-input').addEventListener('change', function () {
        KEHOACH.tuanKey = mondayOfWeek($('kehoach-tuan-input').value || KEHOACH.tuanKey);
        $('kehoach-tuan-input').value = KEHOACH.tuanKey;
        loadKeHoachTuan();
      });
      $('kehoach-prevweek').addEventListener('click', function () {
        KEHOACH.tuanKey = addDaysStr(KEHOACH.tuanKey, -7);
        $('kehoach-tuan-input').value = KEHOACH.tuanKey;
        loadKeHoachTuan();
      });
      $('kehoach-nextweek').addEventListener('click', function () {
        KEHOACH.tuanKey = addDaysStr(KEHOACH.tuanKey, 7);
        $('kehoach-tuan-input').value = KEHOACH.tuanKey;
        loadKeHoachTuan();
      });
      $('kehoach-refresh').addEventListener('click', loadKeHoachTuan);
      $('kehoach-nv').addEventListener('change', renderKeHoachDatalist);
      $('kehoach-form').addEventListener('submit', submitKeHoach);
    }

    renderKeHoachDatalist();
    loadKeHoachTuan();
  }

  function loadKeHoachEmployees() {
    fetch('/.netlify/functions/messages?action=threads', { headers: authHeader() })
      .then(parseJsonRes_)
      .then(function (json) {
        if (!json.ok) throw new Error(json.error || 'Lỗi tải danh sách nhân viên');
        KEHOACH.employeesLoaded = true;
        var contacts = (json.data || []).filter(function (c) { return c.active !== false; });
        KEHOACH.employees = contacts;
        var sel = $('kehoach-nv');
        sel.innerHTML = '<option value="">— Chọn nhân viên —</option>' + contacts.map(function (c) {
          return '<option value="' + escapeHtml(c.username) + '">' + escapeHtml(c.hoTen || c.username) + '</option>';
        }).join('');
      })
      .catch(function (err) {
        setText('kehoach-form-status', 'Không tải được danh sách nhân viên: ' + err.message);
      });
  }

  function loadKeHoachGoiY() {
    fetch(apiUrl('cctToChucGoiY'))
      .then(parseJsonRes_)
      .then(function (json) {
        if (!json.ok) throw new Error(json.error || 'Lỗi tải gợi ý khách hàng tổ chức');
        KEHOACH.goiYLoaded = true;
        var map = {};
        (json.data || []).forEach(function (emp) {
          map[normalizeUsernameKey(emp.maNV || emp.hoTen)] = emp.toChuc || [];
          if (emp.hoTen) map[normalizeUsernameKey(emp.hoTen)] = emp.toChuc || [];
        });
        KEHOACH.goiYMap = map;
        renderKeHoachDatalist();
      })
      .catch(function () { /* gợi ý là phụ, lỗi thì bỏ qua, vẫn gõ tự do được */ });
  }

  // Đổ gợi ý (autocomplete) đúng theo nhân viên đang được chọn — admin thì
  // theo select "kehoach-nv", nhân viên thường thì theo chính tài khoản
  // đang đăng nhập.
  function renderKeHoachDatalist() {
    var session = getSession();
    var isAdmin = !!session && session.vaiTro === 'admin';
    var key = isAdmin ? $('kehoach-nv').value : (session && session.username);
    var list = (key && KEHOACH.goiYMap[normalizeUsernameKey(key)]) || [];
    var datalist = $('kehoach-khachhang-list');
    if (datalist) {
      datalist.innerHTML = list.map(function (t) { return '<option value="' + escapeHtml(t.ten) + '"></option>'; }).join('');
    }
  }

  function loadKeHoachTuan() {
    setText('kehoach-updated', 'Đang tải…');
    fetch(apiUrlExtra('cctKeHoach', { tuan: KEHOACH.tuanKey }))
      .then(parseJsonRes_)
      .then(function (json) {
        if (!json.ok) throw new Error(json.error || 'Lỗi tải kế hoạch tuần');
        KEHOACH.list = json.data || [];
        var tuanCuoi = addDaysStr(KEHOACH.tuanKey, 6);
        setText('kehoach-updated', '🗓️ Tuần từ ' + fmtDateVN(KEHOACH.tuanKey) + ' đến ' + fmtDateVN(tuanCuoi) + ' · Cập nhật lúc ' + new Date().toLocaleString('vi-VN'));
        renderKeHoachByEmployee();
      })
      .catch(function (err) {
        setText('kehoach-updated', '');
        showGlobalError('Không tải được kế hoạch tuần: ' + err.message);
      });
  }

  function renderKeHoachByEmployee() {
    var box = $('kehoach-by-employee');
    if (!box) return;
    $('kehoach-empty').classList.toggle('hidden', KEHOACH.list.length > 0);
    var session = getSession();
    var isAdmin = !!session && session.vaiTro === 'admin';
    var byEmp = {};
    var order = [];
    KEHOACH.list.forEach(function (item) {
      var key = normalizeUsernameKey(item.username);
      if (!byEmp[key]) { byEmp[key] = { hoTen: item.hoTen || item.username, items: [] }; order.push(key); }
      byEmp[key].items.push(item);
    });
    box.innerHTML = order.map(function (key) {
      var emp = byEmp[key];
      var canEdit = isAdmin || (session && normalizeUsernameKey(session.username) === key);
      var cardsHtml = emp.items.map(function (item) {
        return '<div class="kehoach-item-card" data-id="' + escapeHtml(item.id) + '">' +
          '<div class="kehoach-item-icon">🏥</div>' +
          '<div class="kehoach-item-body">' +
          '<div class="kehoach-item-name">' + escapeHtml(item.khachHang) + '</div>' +
          (item.ghiChu ? '<div class="kehoach-item-note">📝 ' + escapeHtml(item.ghiChu) + '</div>' : '') +
          '<div class="kehoach-item-meta">Thêm bởi ' + escapeHtml(item.nguoiTao || '—') + '</div>' +
          '</div>' +
          (canEdit ? '<button type="button" class="kehoach-item-del" title="Xoá khỏi kế hoạch">✕</button>' : '') +
          '</div>';
      }).join('');
      return '<div class="panel kehoach-emp-card">' +
        '<h2>🐰 ' + escapeHtml(emp.hoTen) + ' <span class="count">' + emp.items.length + ' khách hàng tổ chức</span></h2>' +
        '<div class="kehoach-item-list">' + cardsHtml + '</div>' +
        '</div>';
    }).join('');
    wireKeHoachDeleteButtons(box);
  }

  function wireKeHoachDeleteButtons(container) {
    container.querySelectorAll('.kehoach-item-del').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var card = btn.closest('.kehoach-item-card');
        var id = card.dataset.id;
        if (!window.confirm('Xoá khách hàng tổ chức này khỏi kế hoạch tuần?')) return;
        btn.disabled = true;
        fetch('/.netlify/functions/cct-plan', {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, authHeader()),
          body: JSON.stringify({ action: 'delete', id: id, tuan: KEHOACH.tuanKey })
        })
          .then(parseJsonRes_)
          .then(function (json) {
            if (!json.ok) throw new Error(json.error || 'Xoá thất bại');
            loadKeHoachTuan();
          })
          .catch(function (err) {
            showGlobalError('Xoá kế hoạch thất bại: ' + err.message);
            btn.disabled = false;
          });
      });
    });
  }

  function submitKeHoach(ev) {
    ev.preventDefault();
    var statusEl = $('kehoach-form-status');
    var btn = $('kehoach-submit-btn');
    var session = getSession();
    var isAdmin = !!session && session.vaiTro === 'admin';
    var username = isAdmin ? $('kehoach-nv').value : (session && session.username);
    var khachHang = $('kehoach-khachhang').value.trim();
    var ghiChu = $('kehoach-ghichu').value.trim();
    statusEl.textContent = '';
    if (isAdmin && !username) { statusEl.textContent = 'Vui lòng chọn nhân viên.'; return; }
    if (!khachHang) { statusEl.textContent = 'Vui lòng nhập tên khách hàng tổ chức.'; return; }
    btn.disabled = true;
    statusEl.textContent = 'Đang lưu…';
    fetch('/.netlify/functions/cct-plan', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeader()),
      body: JSON.stringify({ action: 'add', tuan: KEHOACH.tuanKey, username: username, khachHang: khachHang, ghiChu: ghiChu })
    })
      .then(parseJsonRes_)
      .then(function (json) {
        if (!json.ok) throw new Error(json.error || 'Thêm kế hoạch thất bại');
        statusEl.textContent = 'Đã thêm vào kế hoạch! 🎉';
        $('kehoach-khachhang').value = '';
        $('kehoach-ghichu').value = '';
        loadKeHoachTuan();
      })
      .catch(function (err) { statusEl.textContent = 'Lỗi: ' + err.message; })
      .finally(function () { btn.disabled = false; });
  }

  // --------------------------------------------------------------------------
  // TRAO ĐỔI — chat riêng giữa Admin và từng nhân viên
  // --------------------------------------------------------------------------
  var CHAT = { thread: null, pollTimer: null, loading: false, contactsLoaded: false };
  var CHAT_POLL_MS = 12000;

  function authHeader() {
    var session = getSession();
    return session ? { 'Authorization': 'Bearer ' + session.token } : {};
  }

  // Màu + chữ cái đầu avatar cho từng nhân viên trong mục Trao đổi — hash tên
  // đăng nhập ra 1 màu cố định trong PALETTE (đã khai báo ở phần biểu đồ) để
  // mỗi người luôn có cùng 1 màu, giúp danh sách sinh động và dễ phân biệt.
  function chatColorForUser(key) {
    var s = String(key || '');
    var hash = 0;
    for (var i = 0; i < s.length; i++) { hash = (hash * 31 + s.charCodeAt(i)) >>> 0; }
    return PALETTE[hash % PALETTE.length];
  }

  function chatInitial(name) {
    var shortName = kpiShortName(name);
    return shortName ? shortName.charAt(0).toUpperCase() : '?';
  }

  function chatAvatarHtml(name, key) {
    var color = chatColorForUser(key || name);
    return '<span class="chat-avatar" style="background:' + color + '">' + escapeHtml(chatInitial(name)) + '</span>';
  }

  function chatFmtTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    var sameDay = d.toDateString() === now.toDateString();
    var hhmm = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    return sameDay ? hhmm : (d.toLocaleDateString('vi-VN') + ' ' + hhmm);
  }

  function initChatTab() {
    var session = getSession();
    if (!session) return;
    var isAdmin = session.vaiTro === 'admin';
    $('chat-contacts').classList.toggle('hidden', !isAdmin);

    if (isAdmin) {
      if (!CHAT.contactsLoaded) loadChatContacts();
      if (CHAT.thread) startChatPolling();
      else $('chat-thread-header').innerHTML = '<svg class="chat-thread-placeholder-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 4.5h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H8l-3.5 3v-3H3a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z"/></svg>' +
        '<span class="chat-thread-header-name">Chọn 1 nhân viên bên trái để bắt đầu trao đổi</span>';
    } else {
      CHAT.thread = session.username;
      $('chat-thread-header').innerHTML = chatAvatarHtml('Quản trị', 'admin') +
        '<span class="chat-thread-header-name">Trao đổi với Quản trị</span>';
      loadChatMessages(true);
      startChatPolling();
    }
  }

  function loadChatContacts() {
    var list = $('chat-contacts-list');
    list.innerHTML = '<div class="empty-state small">Đang tải…</div>';
    fetch('/.netlify/functions/messages?action=threads', { headers: authHeader() })
      .then(parseJsonRes_)
      .then(function (json) {
        if (!json.ok) throw new Error(json.error || 'Lỗi tải danh sách');
        CHAT.contactsLoaded = true;
        var contacts = json.data || [];
        if (!contacts.length) {
          list.innerHTML = '<div class="empty-state small">Chưa có tài khoản nhân viên nào.</div>';
          return;
        }
        list.innerHTML = contacts.map(function (c) {
          return '<button type="button" class="chat-contact-item" data-user="' + escapeHtml(c.username) + '">' +
            '<span class="chat-contact-main">' +
            chatAvatarHtml(c.hoTen || c.username, c.username) +
            '<span class="chat-contact-name">' + escapeHtml(c.hoTen || c.username) + '</span>' +
            '</span>' +
            (c.active === false ? '<span class="chip warn small">Đã khoá</span>' : '') +
            '</button>';
        }).join('');
        list.querySelectorAll('.chat-contact-item').forEach(function (btn) {
          btn.addEventListener('click', function () { selectChatContact(btn.dataset.user, btn); });
        });
      })
      .catch(function (err) {
        list.innerHTML = '<div class="empty-state small">Không tải được danh sách: ' + escapeHtml(err.message) + '</div>';
      });
  }

  function selectChatContact(username, btnEl) {
    CHAT.thread = username;
    $('chat-contacts-list').querySelectorAll('.chat-contact-item').forEach(function (b) { b.classList.remove('active'); });
    if (btnEl) btnEl.classList.add('active');
    var name = btnEl ? btnEl.querySelector('.chat-contact-name').textContent : username;
    $('chat-thread-header').innerHTML = chatAvatarHtml(name, username) +
      '<span class="chat-thread-header-name">Trao đổi với ' + escapeHtml(name) + '</span>';
    $('chat-messages').innerHTML = '';
    loadChatMessages(true);
    startChatPolling();
  }

  function loadChatMessages(scrollToBottom) {
    if (!CHAT.thread || CHAT.loading) return;
    CHAT.loading = true;
    var url = '/.netlify/functions/messages?action=list&thread=' + encodeURIComponent(CHAT.thread);
    fetch(url, { headers: authHeader() })
      .then(parseJsonRes_)
      .then(function (json) {
        if (!json.ok) throw new Error(json.error || 'Lỗi tải tin nhắn');
        renderChatMessages(json.data || [], json.me || {});
        if (scrollToBottom) chatScrollToBottom();
      })
      .catch(function (err) {
        $('chat-messages').innerHTML = '<div class="empty-state">Không tải được tin nhắn: ' + escapeHtml(err.message) + '</div>';
      })
      .finally(function () { CHAT.loading = false; });
  }

  function renderChatMessages(msgs, me) {
    var box = $('chat-messages');
    var wasNearBottom = (box.scrollHeight - box.scrollTop - box.clientHeight) < 60;
    if (!msgs.length) {
      box.innerHTML = '<div class="empty-state">Chưa có tin nhắn nào. Gửi lời chào đầu tiên nhé!</div>';
      return;
    }
    box.innerHTML = msgs.map(function (m) {
      var mine = m.from === (me && me.username);
      return '<div class="chat-bubble-row ' + (mine ? 'mine' : 'theirs') + '">' +
        '<div class="chat-bubble">' +
        (mine ? '' : '<div class="chat-bubble-sender">' + escapeHtml(m.fromRole === 'admin' ? 'Quản trị' : m.from) + '</div>') +
        '<div class="chat-bubble-text">' + escapeHtml(m.text) + '</div>' +
        '<div class="chat-bubble-time">' + chatFmtTime(m.time) + '</div>' +
        '</div></div>';
    }).join('');
    if (wasNearBottom) chatScrollToBottom();
  }

  function chatScrollToBottom() {
    var box = $('chat-messages');
    box.scrollTop = box.scrollHeight;
  }

  function startChatPolling() {
    stopChatPolling();
    CHAT.pollTimer = setInterval(function () {
      if (CHAT.thread) loadChatMessages(false);
    }, CHAT_POLL_MS);
  }
  function stopChatPolling() {
    if (CHAT.pollTimer) { clearInterval(CHAT.pollTimer); CHAT.pollTimer = null; }
  }

  $('chat-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var input = $('chat-input');
    var text = input.value.trim();
    var errEl = $('chat-error');
    errEl.textContent = '';
    if (!CHAT.thread) { errEl.textContent = 'Chọn 1 nhân viên bên trái trước đã.'; return; }
    if (!text) return;
    var btn = $('chat-send-btn');
    btn.disabled = true;
    fetch('/.netlify/functions/messages', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeader()),
      body: JSON.stringify({ thread: CHAT.thread, text: text })
    })
      .then(parseJsonRes_)
      .then(function (json) {
        if (!json.ok) throw new Error(json.error || 'Gửi tin nhắn thất bại');
        input.value = '';
        loadChatMessages(true);
      })
      .catch(function (err) {
        errEl.textContent = 'Không gửi được: ' + err.message;
      })
      .finally(function () { btn.disabled = false; });
  });

  // --------------------------------------------------------------------------
  // GIAO VIỆC — admin giao nhiệm vụ cho từng nhân viên, nhân viên phản hồi
  // --------------------------------------------------------------------------
  var GIAOVIEC = { employeesLoaded: false, employees: [], tasks: [], loading: false, lastMe: {} };

  var GIAOVIEC_STATUS_OPTIONS = ['Chưa bắt đầu', 'Đang làm', 'Hoàn thành'];

  function giaoViecStatusClass(trangThai) {
    if (trangThai === 'Hoàn thành') return 'good';
    if (trangThai === 'Đang làm') return 'warn';
    return 'muted';
  }

  function giaoViecFmtTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('vi-VN') + ' ' + d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  }

  // Input <input type="date"> trả về "yyyy-mm-dd" — đổi sang "dd/mm/yyyy" để
  // hiển thị/lưu đồng nhất với phần còn lại của app + nội dung mail n8n.
  function giaoViecDateInputToVN(value) {
    if (!value) return '';
    var parts = String(value).split('-');
    if (parts.length !== 3) return value;
    return parts[2] + '/' + parts[1] + '/' + parts[0];
  }

  function initGiaoViecTab() {
    var session = getSession();
    if (!session) return;
    var isAdmin = session.vaiTro === 'admin';
    $('giaoviec-new-panel').classList.toggle('hidden', !isAdmin);
    $('giaoviec-byemployee-panel').classList.toggle('hidden', !isAdmin);
    if (isAdmin && !GIAOVIEC.employeesLoaded) loadGiaoViecEmployees();
    loadGiaoViecTasks();
  }

  function loadGiaoViecEmployees() {
    fetch('/.netlify/functions/messages?action=threads', { headers: authHeader() })
      .then(parseJsonRes_)
      .then(function (json) {
        if (!json.ok) throw new Error(json.error || 'Lỗi tải danh sách nhân viên');
        GIAOVIEC.employeesLoaded = true;
        var sel = $('giaoviec-nv');
        var contacts = (json.data || []).filter(function (c) { return c.active !== false; });
        GIAOVIEC.employees = contacts;
        sel.innerHTML = '<option value="">— Chọn nhân viên —</option>' + contacts.map(function (c) {
          return '<option value="' + escapeHtml(c.username) + '">' + escapeHtml(c.hoTen || c.username) + '</option>';
        }).join('');
        renderGiaoViecByEmployee();
      })
      .catch(function (err) {
        setText('giaoviec-form-status', 'Không tải được danh sách nhân viên: ' + err.message);
      });
  }

  function loadGiaoViecTasks() {
    if (GIAOVIEC.loading) return;
    GIAOVIEC.loading = true;
    var box = $('giaoviec-list');
    if (!GIAOVIEC.tasks.length) box.innerHTML = '<div class="empty-state">Đang tải…</div>';
    fetch('/.netlify/functions/tasks', { headers: authHeader() })
      .then(parseJsonRes_)
      .then(function (json) {
        if (!json.ok) throw new Error(json.error || 'Lỗi tải danh sách nhiệm vụ');
        GIAOVIEC.tasks = json.data || [];
        GIAOVIEC.lastMe = json.me || {};
        renderGiaoViecList(GIAOVIEC.lastMe);
        renderGiaoViecByEmployee();
      })
      .catch(function (err) {
        box.innerHTML = '<div class="empty-state">Không tải được danh sách nhiệm vụ: ' + escapeHtml(err.message) + '</div>';
      })
      .finally(function () { GIAOVIEC.loading = false; });
  }

  function giaoViecCardHtml(t, isAdmin) {
    var statusBadge = '<span class="chip ' + giaoViecStatusClass(t.trangThai) + '">' + escapeHtml(t.trangThai) + '</span>';
    var mailBadge = t.daNhanMail
      ? '<span class="chip good small">Đã nhận mail' + (t.ngayNhanMail ? ' · ' + giaoViecFmtTime(t.ngayNhanMail) : '') + '</span>'
      : '<span class="chip muted small">Chưa xác nhận nhận mail</span>';
    var statusOptions = GIAOVIEC_STATUS_OPTIONS.map(function (s) {
      return '<option value="' + escapeHtml(s) + '"' + (s === t.trangThai ? ' selected' : '') + '>' + escapeHtml(s) + '</option>';
    }).join('');
    return '<div class="giaoviec-card" data-id="' + escapeHtml(t.id) + '">' +
      '<div class="giaoviec-card-head">' +
      '<div class="giaoviec-card-title">' + escapeHtml(t.tenNhiemVu) + '</div>' +
      statusBadge +
      '</div>' +
      '<div class="giaoviec-card-meta">' +
      (isAdmin ? '<span>Nhân viên: <b>' + escapeHtml(t.hoTen || t.username) + '</b></span>' : '<span>Người giao: <b>' + escapeHtml(t.nguoiGiao) + '</b></span>') +
      (t.ngayThucHien ? '<span>Ngày thực hiện: <b>' + escapeHtml(t.ngayThucHien) + '</b></span>' : '') +
      '<span>Giao lúc: ' + giaoViecFmtTime(t.thoiGianGiao) + '</span>' +
      '</div>' +
      (t.noiDung ? '<div class="giaoviec-card-content">' + escapeHtml(t.noiDung).replace(/\n/g, '<br>') + '</div>' : '') +
      '<div class="giaoviec-card-mail">' + mailBadge + '</div>' +
      '<form class="giaoviec-feedback-form" data-id="' + escapeHtml(t.id) + '">' +
      '<label class="giaoviec-field">' +
      '<span>Trạng thái hoàn thành</span>' +
      '<select class="giaoviec-fb-status">' + statusOptions + '</select>' +
      '</label>' +
      '<label class="giaoviec-field">' +
      '<span>Ghi chú phản hồi</span>' +
      '<textarea class="giaoviec-fb-note" rows="2" maxlength="2000" placeholder="Tình hình thực hiện, khó khăn…">' + escapeHtml(t.ghiChuPhanHoi || '') + '</textarea>' +
      '</label>' +
      '<div class="giaoviec-form-actions">' +
      '<button type="submit" class="btn btn-primary btn-small">Lưu phản hồi</button>' +
      '<span class="giaoviec-fb-status-text">' + (t.ngayPhanHoi ? 'Cập nhật lần cuối: ' + giaoViecFmtTime(t.ngayPhanHoi) : '') + '</span>' +
      '</div>' +
      '</form>' +
      '</div>';
  }

  function wireGiaoViecFeedbackForms(container) {
    container.querySelectorAll('.giaoviec-feedback-form').forEach(function (form) {
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var id = form.dataset.id;
        var trangThai = form.querySelector('.giaoviec-fb-status').value;
        var ghiChu = form.querySelector('.giaoviec-fb-note').value;
        var btn = form.querySelector('button[type="submit"]');
        var statusText = form.querySelector('.giaoviec-fb-status-text');
        btn.disabled = true;
        statusText.textContent = 'Đang lưu…';
        fetch('/.netlify/functions/tasks', {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, authHeader()),
          body: JSON.stringify({ action: 'feedback', id: id, trangThai: trangThai, ghiChu: ghiChu })
        })
          .then(parseJsonRes_)
          .then(function (json) {
            if (!json.ok) throw new Error(json.error || 'Lưu phản hồi thất bại');
            statusText.textContent = 'Đã lưu lúc ' + giaoViecFmtTime(new Date().toISOString());
            loadGiaoViecTasks();
          })
          .catch(function (err) {
            statusText.textContent = 'Lỗi: ' + err.message;
          })
          .finally(function () { btn.disabled = false; });
      });
    });
  }

  function renderGiaoViecList(me) {
    var box = $('giaoviec-list');
    var isAdmin = !!me.isAdmin;
    setText('giaoviec-count', GIAOVIEC.tasks.length ? '(' + GIAOVIEC.tasks.length + ')' : '');
    if (!GIAOVIEC.tasks.length) {
      box.innerHTML = '<div class="empty-state">' + (isAdmin ? 'Chưa giao nhiệm vụ nào.' : 'Bạn chưa được giao nhiệm vụ nào.') + '</div>';
      return;
    }
    box.innerHTML = GIAOVIEC.tasks.map(function (t) { return giaoViecCardHtml(t, isAdmin); }).join('');
    wireGiaoViecFeedbackForms(box);
  }

  // Bảng "Theo từng nhân viên" — chỉ admin thấy: mỗi nhân viên 1 khối gấp
  // gọn (details/summary), bên trong là các nhiệm vụ CỦA RIÊNG người đó, kể
  // cả nhân viên chưa có nhiệm vụ nào (để admin biết ai đang chưa được giao
  // việc).
  function renderGiaoViecByEmployee() {
    var box = $('giaoviec-by-employee');
    if (!box) return;
    var isAdmin = !!GIAOVIEC.lastMe.isAdmin;
    var panel = $('giaoviec-byemployee-panel');
    if (panel) panel.classList.toggle('hidden', !isAdmin);
    if (!isAdmin) return;
    if (!GIAOVIEC.employees.length) {
      box.innerHTML = '<div class="empty-state">Đang tải danh sách nhân viên…</div>';
      return;
    }
    var byUser = {};
    GIAOVIEC.tasks.forEach(function (t) {
      var key = normalizeUsernameKey(t.username);
      (byUser[key] = byUser[key] || []).push(t);
    });
    box.innerHTML = GIAOVIEC.employees.map(function (emp) {
      var key = normalizeUsernameKey(emp.username);
      var tasks = byUser[key] || [];
      var body = tasks.length
        ? tasks.map(function (t) { return giaoViecCardHtml(t, true); }).join('')
        : '<div class="giaoviec-emp-empty">Chưa có nhiệm vụ nào.</div>';
      return '<details class="giaoviec-emp-group">' +
        '<summary class="giaoviec-emp-summary">' +
        '<span>' + escapeHtml(emp.hoTen || emp.username) + '</span>' +
        '<span class="chip ' + (tasks.length ? 'muted' : 'muted') + ' small">' + tasks.length + ' nhiệm vụ</span>' +
        '</summary>' +
        '<div class="giaoviec-emp-body">' + body + '</div>' +
        '</details>';
    }).join('');
    wireGiaoViecFeedbackForms(box);
  }

  function normalizeUsernameKey(s) {
    return String(s || '').trim().toLowerCase();
  }

  $('giaoviec-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var statusEl = $('giaoviec-form-status');
    var btn = $('giaoviec-submit-btn');
    var username = $('giaoviec-nv').value;
    var tenNhiemVu = $('giaoviec-ten').value.trim();
    var noiDung = $('giaoviec-noidung').value.trim();
    var ngayThucHien = giaoViecDateInputToVN($('giaoviec-ngay').value);
    statusEl.textContent = '';
    if (!username) { statusEl.textContent = 'Vui lòng chọn nhân viên.'; return; }
    if (!tenNhiemVu) { statusEl.textContent = 'Vui lòng nhập tên nhiệm vụ.'; return; }
    btn.disabled = true;
    statusEl.textContent = 'Đang giao việc…';
    fetch('/.netlify/functions/tasks', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeader()),
      body: JSON.stringify({ action: 'create', username: username, tenNhiemVu: tenNhiemVu, noiDung: noiDung, ngayThucHien: ngayThucHien })
    })
      .then(parseJsonRes_)
      .then(function (json) {
        if (!json.ok) throw new Error(json.error || 'Giao việc thất bại');
        var mailNote = json.mailSent ? ' Đã gửi mail báo cho nhân viên.' :
          (json.mailError ? ' (Chưa gửi được mail: ' + json.mailError + ')' : '');
        statusEl.textContent = 'Đã giao việc thành công!' + mailNote;
        $('giaoviec-form').reset();
        loadGiaoViecTasks();
      })
      .catch(function (err) {
        statusEl.textContent = 'Lỗi: ' + err.message;
      })
      .finally(function () { btn.disabled = false; });
  });

  // --------------------------------------------------------------------------
  // PHÁT TRIỂN CÁ NHÂN — danh mục sản phẩm, điểm đào tạo, chọn 2 học viên + 2
  // speaker mỗi tháng (xoay vòng công bằng), tăng trưởng học SP + doanh số.
  // Các endpoint XEM (danhMucSp/daoTaoSp/ptcChonThang/ptcTangTruong) gọi
  // TRỰC TIẾP Apps Script (giống Sản phẩm trọng tâm/Doanh số, không cần
  // đăng nhập) — chỉ 2 hành động GHI (nhập điểm / chọn lại) mới đi qua
  // Netlify Function training.js để kiểm tra CHỈ ADMIN mới được ghi.
  // --------------------------------------------------------------------------
  var PTC = { inited: false, danhMuc: [], diem: [], pick: null, tangTruong: [], employeesLoaded: false, employees: [], hopDaoTao: [] };

  function initPtcTab() {
    if (!PTC.inited) {
      PTC.inited = true;
      var now = new Date();
      var thangSel = $('ptc-thang');
      var namSel = $('ptc-nam');
      thangSel.innerHTML = VN_MONTHS_FULL.map(function (label, i) {
        return '<option value="' + (i + 1) + '">' + label + '</option>';
      }).join('');
      thangSel.value = String(now.getMonth() + 1); // mặc định THÁNG HIỆN TẠI
      var namNow = now.getFullYear();
      namSel.innerHTML = [namNow - 1, namNow, namNow + 1].map(function (y) {
        return '<option value="' + y + '">' + y + '</option>';
      }).join('');
      namSel.value = String(namNow);

      ['ptc-thang', 'ptc-nam'].forEach(function (id) { $(id).addEventListener('change', loadPtcThang); });
      $('ptc-refresh').addEventListener('click', loadPtcThang);
      $('ptc-reroll-btn').addEventListener('click', rerollPtcThang);
      $('ptc-diem-form').addEventListener('submit', submitPtcDiem);
      $('hop-daotao-form').addEventListener('submit', submitHopDaoTao);
      $('hop-daotao-ngay').value = new Date().toISOString().slice(0, 10); // mặc định hôm nay
    }

    var session = getSession();
    var isAdmin = !!session && session.vaiTro === 'admin';
    $('ptc-reroll-btn').classList.toggle('hidden', !isAdmin);
    $('ptc-nhapdiem-panel').classList.toggle('hidden', !isAdmin);
    $('hop-daotao-form-wrap').classList.toggle('hidden', !isAdmin);
    $('hop-daotao-col-xoa').classList.toggle('hidden', !isAdmin);
    if (isAdmin && !PTC.employeesLoaded) loadPtcEmployees();
    if (!PTC.danhMuc.length) loadPtcDanhMuc();
    loadHopDaoTao();

    loadPtcThang();
  }

  // Danh sách nhân viên để đổ vào select "Nhân viên" của form nhập điểm — tái
  // dùng đúng endpoint messages?action=threads đã có sẵn (trả về danh sách
  // tài khoản nhân viên, giống cách mục Giao việc đang làm).
  function loadPtcEmployees() {
    fetch('/.netlify/functions/messages?action=threads', { headers: authHeader() })
      .then(parseJsonRes_)
      .then(function (json) {
        if (!json.ok) throw new Error(json.error || 'Lỗi tải danh sách nhân viên');
        PTC.employeesLoaded = true;
        var contacts = (json.data || []).filter(function (c) { return c.active !== false; });
        PTC.employees = contacts;
        var sel = $('ptc-diem-nv');
        sel.innerHTML = '<option value="">— Chọn nhân viên —</option>' + contacts.map(function (c) {
          return '<option value="' + escapeHtml(c.username) + '">' + escapeHtml(c.hoTen || c.username) + '</option>';
        }).join('');
        var selTrinhBay = $('hop-daotao-nguoitrinhbay');
        if (selTrinhBay) {
          selTrinhBay.innerHTML = '<option value="">— (không bắt buộc) —</option>' + contacts.map(function (c) {
            return '<option value="' + escapeHtml(c.hoTen || c.username) + '">' + escapeHtml(c.hoTen || c.username) + '</option>';
          }).join('');
        }
      })
      .catch(function (err) {
        setText('ptc-diem-form-status', 'Không tải được danh sách nhân viên: ' + err.message);
      });
  }

  function loadPtcDanhMuc() {
    fetch(apiUrl('danhMucSp'))
      .then(parseJsonRes_)
      .then(function (json) {
        if (!json.ok) throw new Error(json.error || 'Lỗi tải danh mục sản phẩm');
        PTC.danhMuc = json.data || [];
        var sel = $('ptc-diem-sp');
        sel.innerHTML = '<option value="">— Chọn sản phẩm —</option>' + PTC.danhMuc.map(function (p) {
          return '<option value="' + escapeHtml(p.tenSanPham) + '">' + escapeHtml(p.tenSanPham) + '</option>';
        }).join('');
        var selHop = $('hop-daotao-sp');
        if (selHop) {
          selHop.innerHTML = '<option value="">— Chọn sản phẩm —</option>' + PTC.danhMuc.map(function (p) {
            return '<option value="' + escapeHtml(p.tenSanPham) + '">' + escapeHtml(p.tenSanPham) + '</option>';
          }).join('');
        }
      })
      .catch(function (err) {
        showGlobalError('Không tải được danh mục sản phẩm: ' + err.message);
      });
  }

  function loadPtcThang() {
    var thang = $('ptc-thang').value;
    var nam = $('ptc-nam').value;
    setText('ptc-updated', 'Đang tải…');
    Promise.all([
      fetch(apiUrlExtra('ptcChonThang', { thang: thang, nam: nam })).then(parseJsonRes_),
      fetch(apiUrlExtra('ptcTangTruong', { thang: thang, nam: nam })).then(parseJsonRes_),
      fetch(apiUrl('daoTaoSp')).then(parseJsonRes_)
    ]).then(function (results) {
      var pickJson = results[0], ttJson = results[1], diemJson = results[2];
      if (!pickJson.ok) throw new Error(pickJson.error || 'Lỗi tải chọn học viên/speaker');
      if (!ttJson.ok) throw new Error(ttJson.error || 'Lỗi tải tăng trưởng cá nhân');
      if (!diemJson.ok) throw new Error(diemJson.error || 'Lỗi tải lịch sử điểm đào tạo');
      PTC.pick = pickJson.data || null;
      PTC.tangTruong = ttJson.data || [];
      PTC.diem = diemJson.data || [];
      setText('ptc-updated', 'Cập nhật lúc ' + new Date().toLocaleString('vi-VN'));
      renderPtcPickGrid();
      renderPtcTangTruong();
      renderPtcDiemHistory();
    }).catch(function (err) {
      setText('ptc-updated', '');
      showGlobalError('Không tải được dữ liệu Phát triển cá nhân: ' + err.message);
    });
  }

  function renderPtcPickGrid() {
    var box = $('ptc-pick-grid');
    if (!box) return;
    if (!PTC.pick) { box.innerHTML = '<div class="empty-state small">Chưa có dữ liệu.</div>'; return; }
    var cards = [];
    (PTC.pick.hocVien || []).forEach(function (p, i) {
      cards.push(ptcPersonCardHtml('🎓 Học viên ' + (i + 1), p));
    });
    (PTC.pick.speaker || []).forEach(function (p, i) {
      cards.push(ptcPersonCardHtml('🎤 Speaker ' + (i + 1), p));
    });
    box.innerHTML = cards.join('');
  }

  function ptcPersonCardHtml(label, p) {
    var name = (p && (p.hoTen || p.username)) || '—';
    return '<div class="ptc-pick-card"><div class="ptc-pick-role">' + escapeHtml(label) + '</div>' +
      '<div class="ptc-pick-name">' + escapeHtml(name) + '</div></div>';
  }

  // Chỉ admin thấy nút này — random lại 4 người cho đúng tháng đang xem, có
  // ưu tiên người bị chọn ít lần nhất trong lịch sử (xoay vòng công bằng),
  // KHÔNG xoá lượt chọn cũ (giữ lịch sử để lần xoay vòng sau vẫn tính đúng).
  function rerollPtcThang() {
    var thang = $('ptc-thang').value;
    var nam = $('ptc-nam').value;
    var btn = $('ptc-reroll-btn');
    if (!window.confirm('Chọn lại 2 học viên + 2 speaker cho tháng này? Lượt chọn hiện tại của tháng sẽ được thay bằng 1 lượt random mới.')) return;
    btn.disabled = true;
    fetch('/.netlify/functions/training', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeader()),
      body: JSON.stringify({ action: 'reroll_thang', nam: nam, thang: thang })
    })
      .then(parseJsonRes_)
      .then(function (json) {
        if (!json.ok) throw new Error(json.error || 'Chọn lại thất bại');
        PTC.pick = json.data;
        renderPtcPickGrid();
      })
      .catch(function (err) { showGlobalError('Chọn lại thất bại: ' + err.message); })
      .finally(function () { btn.disabled = false; });
  }

  function renderPtcTangTruong() {
    var tbody = document.querySelector('#table-ptc-tangtruong tbody');
    if (!tbody) return;
    var rows = PTC.tangTruong || [];
    tbody.innerHTML = rows.length ? rows.map(function (r) {
      var dsGrowthClass = r.tangTruongDoanhSo > 0 ? 'good' : (r.tangTruongDoanhSo < 0 ? 'critical' : 'muted');
      var dsGrowthText = (r.tangTruongDoanhSo > 0 ? '+' : '') + fmtVnd(r.tangTruongDoanhSo) +
        (r.tangTruongDoanhSoPhanTram !== null ? ' (' + (r.tangTruongDoanhSoPhanTram > 0 ? '+' : '') + r.tangTruongDoanhSoPhanTram + '%)' : '');
      var diemGrowthClass = r.tangTruongDiem > 0 ? 'good' : (r.tangTruongDiem < 0 ? 'critical' : 'muted');
      return '<tr>' +
        '<td>' + escapeHtml(r.hoTen) + '</td>' +
        '<td class="num">' + fmtNum.format(r.diemThangNay) + '</td>' +
        '<td class="num">' + fmtNum.format(r.diemThangTruoc) + '</td>' +
        '<td class="num"><span class="chip ' + diemGrowthClass + ' small">' + (r.tangTruongDiem > 0 ? '+' : '') + fmtNum.format(r.tangTruongDiem) + '</span></td>' +
        '<td class="num">' + fmtNum.format(r.soSanPhamDaHocLuyKe) + '</td>' +
        '<td class="num">' + fmtVnd(r.doanhSoThangNay) + '</td>' +
        '<td class="num">' + fmtVnd(r.doanhSoThangTruoc) + '</td>' +
        '<td class="num"><span class="chip ' + dsGrowthClass + ' small">' + escapeHtml(dsGrowthText) + '</span></td>' +
        '</tr>';
    }).join('') : '<tr><td colspan="8" class="empty-state small">Chưa có dữ liệu.</td></tr>';
  }

  function renderPtcDiemHistory() {
    var tbody = document.querySelector('#table-ptc-diem tbody');
    if (!tbody) return;
    var all = PTC.diem || [];
    setText('ptc-diem-count', '(' + fmtNum.format(all.length) + ')');
    var rows = all.slice(0, 200); // đã được Apps Script sắp xếp mới nhất trước
    tbody.innerHTML = rows.length ? rows.map(function (r) {
      return '<tr>' +
        '<td>' + escapeHtml(r.thang) + '</td>' +
        '<td>' + escapeHtml(r.hoTen || r.username) + '</td>' +
        '<td>' + escapeHtml(r.sanPham) + '</td>' +
        '<td class="num">' + fmtNum.format(r.diem) + '</td>' +
        '<td>' + escapeHtml(r.nguoiCham) + '</td>' +
        '<td>' + escapeHtml(r.ghiChu || '—') + '</td>' +
        '<td>' + (r.thoiGianNhap ? new Date(r.thoiGianNhap).toLocaleString('vi-VN') : '') + '</td>' +
        '</tr>';
    }).join('') : '<tr><td colspan="7" class="empty-state small">Chưa có điểm đào tạo nào được nhập.</td></tr>';
  }

  function submitPtcDiem(ev) {
    ev.preventDefault();
    var statusEl = $('ptc-diem-form-status');
    var btn = $('ptc-diem-submit-btn');
    var username = $('ptc-diem-nv').value;
    var sanPham = $('ptc-diem-sp').value;
    var thangVal = $('ptc-diem-thang').value; // input type="month" -> "yyyy-MM"
    var diem = $('ptc-diem-diem').value;
    var ghiChu = $('ptc-diem-ghichu').value.trim();
    statusEl.textContent = '';
    if (!username) { statusEl.textContent = 'Vui lòng chọn nhân viên.'; return; }
    if (!sanPham) { statusEl.textContent = 'Vui lòng chọn sản phẩm.'; return; }
    if (!thangVal) { statusEl.textContent = 'Vui lòng chọn tháng chấm điểm.'; return; }
    if (diem === '' || isNaN(Number(diem))) { statusEl.textContent = 'Vui lòng nhập điểm hợp lệ.'; return; }
    btn.disabled = true;
    statusEl.textContent = 'Đang lưu…';
    fetch('/.netlify/functions/training', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeader()),
      body: JSON.stringify({ action: 'submit_diem', username: username, sanPham: sanPham, thang: thangVal, diem: diem, ghiChu: ghiChu })
    })
      .then(parseJsonRes_)
      .then(function (json) {
        if (!json.ok) throw new Error(json.error || 'Lưu điểm thất bại');
        statusEl.textContent = 'Đã lưu điểm thành công!';
        $('ptc-diem-form').reset();
        loadPtcThang();
      })
      .catch(function (err) { statusEl.textContent = 'Lỗi: ' + err.message; })
      .finally(function () { btn.disabled = false; });
  }

  // ---- Vòng 15: "Sản phẩm đào tạo khi họp" (2 buổi/tháng) — mọi người xem
  // được (gọi thẳng Apps Script, giống danhMucSp/daoTaoSp), chỉ admin mới
  // thêm/xoá được (qua Netlify Function training.js). ----
  function loadHopDaoTao() {
    fetch(apiUrl('hopDaoTaoSp'))
      .then(parseJsonRes_)
      .then(function (json) {
        if (!json.ok) throw new Error(json.error || 'Lỗi tải sản phẩm đào tạo khi họp');
        PTC.hopDaoTao = json.data || [];
        renderHopDaoTao();
      })
      .catch(function (err) {
        showGlobalError('Không tải được "Sản phẩm đào tạo khi họp": ' + err.message);
      });
  }

  function renderHopDaoTao() {
    var tbody = document.querySelector('#table-hop-daotao tbody');
    if (!tbody) return;
    var session = getSession();
    var isAdmin = !!session && session.vaiTro === 'admin';
    var rows = PTC.hopDaoTao || [];
    tbody.innerHTML = rows.length ? rows.map(function (r) {
      return '<tr>' +
        '<td>' + fmtDate(r.ngayHop) + '</td>' +
        '<td>' + escapeHtml(r.sanPham) + '</td>' +
        '<td>' + escapeHtml(r.nguoiTrinhBay || '—') + '</td>' +
        '<td>' + escapeHtml(r.ghiChu || '—') + '</td>' +
        (isAdmin ? '<td><button type="button" class="btn btn-small btn-danger hop-daotao-xoa-btn" data-id="' + escapeHtml(r.id) + '">Xoá</button></td>' : '') +
        '</tr>';
    }).join('') : '<tr><td colspan="' + (isAdmin ? 5 : 4) + '" class="empty-state small">Chưa có sản phẩm đào tạo nào được ghi nhận.</td></tr>';
    if (isAdmin) {
      tbody.querySelectorAll('.hop-daotao-xoa-btn').forEach(function (btn) {
        btn.addEventListener('click', function () { deleteHopDaoTao(btn.dataset.id); });
      });
    }
  }

  function submitHopDaoTao(ev) {
    ev.preventDefault();
    var statusEl = $('hop-daotao-form-status');
    var btn = $('hop-daotao-submit-btn');
    var ngayHop = $('hop-daotao-ngay').value; // input type="date" -> "yyyy-MM-dd"
    var sanPham = $('hop-daotao-sp').value;
    var nguoiTrinhBay = $('hop-daotao-nguoitrinhbay').value;
    var ghiChu = $('hop-daotao-ghichu').value.trim();
    statusEl.textContent = '';
    if (!ngayHop) { statusEl.textContent = 'Vui lòng chọn ngày họp.'; return; }
    if (!sanPham) { statusEl.textContent = 'Vui lòng chọn sản phẩm.'; return; }
    btn.disabled = true;
    statusEl.textContent = 'Đang lưu…';
    fetch('/.netlify/functions/training', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeader()),
      body: JSON.stringify({ action: 'add_hop', ngayHop: ngayHop, sanPham: sanPham, nguoiTrinhBay: nguoiTrinhBay, ghiChu: ghiChu })
    })
      .then(parseJsonRes_)
      .then(function (json) {
        if (!json.ok) throw new Error(json.error || 'Lưu thất bại');
        statusEl.textContent = 'Đã thêm!';
        $('hop-daotao-sp').value = '';
        $('hop-daotao-nguoitrinhbay').value = '';
        $('hop-daotao-ghichu').value = '';
        loadHopDaoTao();
      })
      .catch(function (err) { statusEl.textContent = 'Lỗi: ' + err.message; })
      .finally(function () { btn.disabled = false; });
  }

  function deleteHopDaoTao(id) {
    if (!window.confirm('Xoá dòng "sản phẩm đào tạo" này?')) return;
    fetch('/.netlify/functions/training', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeader()),
      body: JSON.stringify({ action: 'delete_hop', id: id })
    })
      .then(parseJsonRes_)
      .then(function (json) {
        if (!json.ok) throw new Error(json.error || 'Xoá thất bại');
        loadHopDaoTao();
      })
      .catch(function (err) { showGlobalError('Xoá thất bại: ' + err.message); });
  }

  // --------------------------------------------------------------------------
  // KHỞI ĐỘNG
  // --------------------------------------------------------------------------
  if (isAuthed()) { showApp(); } else { showLogin(); }
})();

/* ============================================================================
   DASHBOARD KINH DOANH — logic phía client
   Không dùng framework, không dùng localStorage/sessionStorage cho dữ liệu
   nhạy cảm (chỉ dùng sessionStorage để nhớ trạng thái đã đăng nhập trong tab).
   ============================================================================ */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG || {};
  var SESSION_KEY = 'kd_dashboard_auth';

  var RAW = { thau: [], kpi: { employees: [], thang: '' }, sales: [], checkin: { employees: [] }, meta: {} };
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
        return res.json();
      })
      .then(function (json) {
        if (!json.ok) throw new Error(json.error || 'Lỗi không xác định từ API');
        RAW.thau = json.data.thau || [];
        RAW.kpi = json.data.kpi || { employees: [] };
        RAW.sales = json.data.sales || [];
        RAW.checkin = json.data.checkin || { employees: [] };
        RAW.meta = json.data.meta || {};
        setText('updated-at', 'Cập nhật lúc ' + new Date(json.updatedAt).toLocaleString('vi-VN'));
        safeRun(initFilters);
        safeRun(renderThau);
        safeRun(renderKpi);
        safeRun(renderSales);
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
      onTabSwitch(btn.dataset.tab);
    });
  });
  function onTabSwitch(tabName) {
    if (tabName === 'chat') { initChatTab(); } else { stopChatPolling(); }
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

  var PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
  var CHART_BASE_OPTS = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { padding: 10 } },
    scales: {
      x: { grid: { display: false }, ticks: { color: '#898781', font: { size: 11 } } },
      y: { grid: { color: '#e1e0d9' }, ticks: { color: '#898781', font: { size: 11 } }, beginAtZero: true }
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

    // --- bảng chi tiết ---
    setText('thau-row-count', '(' + fmtNum.format(rows.length) + ' dòng)');
    renderThauTableBody(rows);
    attachSort('table-thau', getThauFiltered, renderThauTableBody);
  }

  function renderThauTableBody(rows) {
    var body = $('table-thau').querySelector('tbody');
    if (!rows.length) { body.innerHTML = '<tr><td colspan="9" class="empty-state">Không có dữ liệu phù hợp bộ lọc.</td></tr>'; return; }
    body.innerHTML = rows.map(function (r) {
      return '<tr><td>' + escapeHtml(r.tenKhach) + '</td><td>' + escapeHtml(r.tinh) + '</td>' +
        '<td>' + escapeHtml(r.phuTrach) + '</td><td>' + escapeHtml(r.tenHang) + '</td>' +
        '<td class="muted small">' + escapeHtml(r.soHD) + '</td>' +
        '<td class="num">' + fmtNum.format(r.slKeHoach) + '</td>' +
        '<td class="num">' + fmtNum.format(r.slThucHien) + '</td>' +
        '<td>' + progressCellHtml(r.tyLe) + '</td>' +
        '<td>' + fmtDate(r.ngayHetHan) + '</td></tr>';
    }).join('');
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
      return cls === 'good' ? '#0ca30c' : (cls === 'warn' ? '#fab219' : '#d03b3b');
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
  // TAB 2: KPI NHÂN VIÊN
  // ==========================================================================
  function getKpiFiltered() {
    var q = $('kpi-filter-search').value.trim().toLowerCase();
    var emps = (RAW.kpi.employees || []);
    if (!q) return emps;
    return emps.filter(function (e) { return e.hoTen.toLowerCase().indexOf(q) !== -1; });
  }

  function checkinFor(emp) {
    var list = RAW.checkin.employees || [];
    var maNvNum = parseInt(emp.maNV, 10);
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c.maNV && !isNaN(maNvNum) && parseInt(c.maNV, 10) === maNvNum) return c;
      if (c.hoTen && c.hoTen.trim() === emp.hoTen.trim()) return c;
    }
    return null;
  }

  function renderKpi() {
    var emps = getKpiFiltered();
    setText('kpi-thang', RAW.kpi.thang || '');

    var dat100 = emps.filter(function (e) { return e.tyLeTong >= 1; }).length;
    var avgTyLe = emps.length ? sumBy(emps, 'tyLeTong') / emps.length : 0;
    var totalTH = sumBy(emps, 'tongDiemThucHien');
    var totalKH = sumBy(emps, 'tongDiemKeHoach');

    $('kpi-stats').innerHTML = [
      statTile('Số nhân viên', fmtNum.format(emps.length)),
      statTile('Đạt/vượt 100% KPI', fmtNum.format(dat100)),
      statTile('Tỉ lệ TH/KH trung bình', fmtPct(avgTyLe), progressClass(avgTyLe)),
      statTile('Tổng điểm TH / KH nhóm', fmtNum.format(totalTH) + ' / ' + fmtNum.format(totalKH))
    ].join('');

    var sorted = emps.slice().sort(function (a, b) { return b.tyLeTong - a.tyLeTong; });
    var colors = sorted.map(function (e) {
      var cls = progressClass(e.tyLeTong);
      return cls === 'good' ? '#0ca30c' : (cls === 'warn' ? '#fab219' : '#d03b3b');
    });
    upsertChart('chart-kpi-tyle', {
      type: 'bar',
      data: {
        labels: sorted.map(function (e) { return e.hoTen; }),
        datasets: [{ data: sorted.map(function (e) { return +(e.tyLeTong * 100).toFixed(1); }), backgroundColor: colors, borderRadius: 4, maxBarThickness: 40 }]
      },
      options: Object.assign({}, CHART_BASE_OPTS, {
        indexAxis: 'y',
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (ctx) { return ctx.parsed.x + '% TH/KH'; } } } },
        scales: { x: { beginAtZero: true, suggestedMax: 100, grid: { color: '#e1e0d9' } }, y: { grid: { display: false } } }
      })
    });

    setText('kpi-row-count', '(' + fmtNum.format(emps.length) + ' người)');
    renderKpiTableBody(emps);
    attachSort('table-kpi', getKpiFiltered, renderKpiTableBody);
  }

  function renderKpiTableBody(emps) {
    var body = $('table-kpi').querySelector('tbody');
    if (!emps.length) { body.innerHTML = '<tr><td colspan="8" class="empty-state">Không có dữ liệu.</td></tr>'; return; }
    body.innerHTML = emps.map(function (e, i) {
      return '<tr class="emp-row" data-idx="' + i + '"><td>' + escapeHtml(e.hoTen) + ' <span class="muted small">(' + escapeHtml(e.maNV) + ')</span></td>' +
        '<td>' + escapeHtml(e.vaiTro) + '</td>' +
        '<td class="num">' + fmtPct(e.keDon.tyLe) + '</td>' +
        '<td class="num">' + fmtPct(e.thau.tyLe) + '</td>' +
        '<td class="num">' + fmtPct(e.spTrongTam.tyLe) + '</td>' +
        '<td class="num">' + fmtPct(e.nhanSu.tyLe) + '</td>' +
        '<td>' + progressCellHtml(e.tyLeTong) + '</td>' +
        '<td class="num">' + escapeHtml(e.xepHang || '—') + '</td></tr>';
    }).join('');
    body.querySelectorAll('tr.emp-row').forEach(function (tr) {
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', function () { toggleEmpDetail(tr, emps[+tr.dataset.idx]); });
    });
  }

  function toggleEmpDetail(tr, emp) {
    var next = tr.nextElementSibling;
    if (next && next.classList.contains('emp-detail-row')) { next.remove(); return; }
    document.querySelectorAll('.emp-detail-row').forEach(function (r) { r.remove(); });
    var activity = checkinFor(emp);
    var row = document.createElement('tr');
    row.className = 'emp-detail-row';
    row.innerHTML = '<td colspan="8"><div class="detail-grid">' +
      detailMetric('Doanh số kê đơn', fmtVnd(emp.keDon.thucHien) + ' / ' + fmtVnd(emp.keDon.keHoach), fmtPct(emp.keDon.tyLe)) +
      detailMetric('Doanh số thầu', fmtVnd(emp.thau.thucHien) + ' / ' + fmtVnd(emp.thau.keHoach), fmtPct(emp.thau.tyLe)) +
      detailMetric('Điểm SP trọng tâm', emp.spTrongTam.diemThucHien + ' / ' + emp.spTrongTam.diemKeHoach, fmtPct(emp.spTrongTam.tyLe)) +
      detailMetric('Điểm nhân sự', emp.nhanSu.diemThucHien + ' / ' + emp.nhanSu.diemKeHoach, fmtPct(emp.nhanSu.tyLe)) +
      detailMetric('Điểm coaching call', emp.coaching.diemThucHien + ' / ' + emp.coaching.diemKeHoach, fmtPct(emp.coaching.tyLe)) +
      detailMetric('Điểm cộng / trừ', fmtNum.format(emp.congTru), '') +
      detailMetric('Tổng điểm TH/KH', fmtNum.format(emp.tongDiemThucHien) + ' / ' + fmtNum.format(emp.tongDiemKeHoach), fmtPct(emp.tyLeTong)) +
      (activity ? detailMetric('Hoạt động viếng thăm (Jan–Jul)', fmtNum.format(activity.tongLuotCheckin) + ' lượt checkin', fmtNum.format(activity.soKhachDaTham) + ' khách hàng đã thăm') : '') +
      (emp.ghiChu ? detailMetric('Ghi chú', emp.ghiChu, '') : '') +
      '</div></td>';
    tr.parentNode.insertBefore(row, tr.nextSibling);
  }
  function detailMetric(k, v, v2) {
    return '<div class="detail-metric"><div class="k">' + escapeHtml(k) + '</div><div class="v">' + v + '</div>' + (v2 ? '<div class="v2">' + v2 + '</div>' : '') + '</div>';
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
          borderColor: '#2a78d6', backgroundColor: 'rgba(42,120,214,0.12)',
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
      data: { labels: tinhKeys, datasets: [{ data: tinhKeys.map(function (k) { return byTinh[k]; }), backgroundColor: '#2a78d6', borderRadius: 4, maxBarThickness: 32 }] },
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

  // --------------------------------------------------------------------------
  // TRAO ĐỔI — chat riêng giữa Admin và từng nhân viên
  // --------------------------------------------------------------------------
  var CHAT = { thread: null, pollTimer: null, loading: false, contactsLoaded: false };
  var CHAT_POLL_MS = 12000;

  function chatAuthHeader() {
    var session = getSession();
    return session ? { 'Authorization': 'Bearer ' + session.token } : {};
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
      else setText('chat-thread-header', 'Chọn 1 nhân viên bên trái để bắt đầu trao đổi');
    } else {
      CHAT.thread = session.username;
      setText('chat-thread-header', 'Trao đổi với Quản trị');
      loadChatMessages(true);
      startChatPolling();
    }
  }

  function loadChatContacts() {
    var list = $('chat-contacts-list');
    list.innerHTML = '<div class="empty-state small">Đang tải…</div>';
    fetch('/.netlify/functions/messages?action=threads', { headers: chatAuthHeader() })
      .then(function (res) { return res.json(); })
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
            '<span class="chat-contact-name">' + escapeHtml(c.hoTen || c.username) + '</span>' +
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
    setText('chat-thread-header', 'Trao đổi với ' + name);
    $('chat-messages').innerHTML = '';
    loadChatMessages(true);
    startChatPolling();
  }

  function loadChatMessages(scrollToBottom) {
    if (!CHAT.thread || CHAT.loading) return;
    CHAT.loading = true;
    var url = '/.netlify/functions/messages?action=list&thread=' + encodeURIComponent(CHAT.thread);
    fetch(url, { headers: chatAuthHeader() })
      .then(function (res) { return res.json(); })
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
      headers: Object.assign({ 'Content-Type': 'application/json' }, chatAuthHeader()),
      body: JSON.stringify({ thread: CHAT.thread, text: text })
    })
      .then(function (res) { return res.json(); })
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
  // KHỞI ĐỘNG
  // --------------------------------------------------------------------------
  if (isAuthed()) { showApp(); } else { showLogin(); }
})();

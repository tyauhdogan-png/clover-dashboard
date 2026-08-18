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
    if (tabName === 'giaoviec') { initGiaoViecTab(); }
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
      return dat ? '#0ca30c' : '#d03b3b';
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
          x: Object.assign({}, CHART_BASE_OPTS.scales.x, { ticks: { color: '#3a3830', font: { size: 12, weight: '600' } } })
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
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeader()),
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
      .then(function (res) { return res.json(); })
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
      .then(function (res) { return res.json(); })
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
          .then(function (res) { return res.json(); })
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
      .then(function (res) { return res.json(); })
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
  // KHỞI ĐỘNG
  // --------------------------------------------------------------------------
  if (isAuthed()) { showApp(); } else { showLogin(); }
})();

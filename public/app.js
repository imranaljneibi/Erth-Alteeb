import { calculate, todayDubai } from './calculations.mjs';

const $ = (selector, root = document) => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const icons = {
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  sales: '<path d="M3 3h2l2 12h12l2-9H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>',
  expenses: '<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 9h18M16 14h3M7 5V3"/>',
  products: '<path d="m12 3 9 5v9l-9 5-9-5V8l9-5Z"/><path d="m3 8 9 5 9-5M12 13v9M7.5 5.5l9 5"/>',
  payments: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20M6 15h3M16 15h2"/>',
  reports: '<path d="M7 3h8l4 4v14H5V3h2Z"/><path d="M14 3v5h5M8 12h8M8 16h6"/>',
  audit: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  settings: '<path d="m9 3-1 3-3 1-2 4 2 3v3l4 3 3-1 3 1 4-3v-3l2-3-2-4-3-1-1-3H9Z"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
  arrow: '<path d="m14 5-7 7 7 7M7 12h14"/>', check: '<path d="m5 12 4 4L19 6"/>',
  edit: '<path d="m16 3 5 5-12 12-6 1 1-6L16 3ZM13 6l5 5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  print: '<path d="M7 8V3h10v5M7 17H3V8h18v9h-4"/><path d="M7 13h10v8H7zM17 11h1"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  logout: '<path d="M9 3H4v18h5M10 12h11m-4-4 4 4-4 4"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  wallet: '<path d="M20 8V5H5a3 3 0 0 0 0 6h16v9H5a3 3 0 0 1-3-3V8M17 14h4"/>',
  trend: '<path d="m3 17 6-6 4 4 8-11M15 4h6v6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 11h18"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 8-3 8-3 10h18c0-2-3-2-3-10M10 21h4"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  empty: '<path d="m3 8 9-5 9 5v12H3V8Z"/><path d="M3 9h5l2 4h4l2-4h5"/>',
  refresh: '<path d="M20 7a9 9 0 0 0-15-1L3 8m0-5v5h5M4 17a9 9 0 0 0 15 1l2-2m0 5v-5h-5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3M12 14v3"/>'
};
const icon = (name, className = '') => `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.dashboard}</svg>`;
const logo = (extra = '') => `<span class="logo-circle ${extra}"><img class="logo-img" src="/logo.png" alt="شعار إرث الطيب الرسمي" /></span>`;
const pageNames = { dashboard: 'نظرة عامة', sales: 'المبيعات', expenses: 'المصروفات', products: 'المنتجات والمخزون', payments: 'الدفعات والمستحقات', reports: 'التقارير', audit: 'سجل التعديلات', settings: 'الإعدادات والنسخ الاحتياطي' };
const entityNames = { products: 'منتج', sales: 'عملية بيع', expenses: 'مصروف', payments: 'دفعة' };
let user = null, csrfToken = '', state = null, page = 'dashboard', period = 'month', anchor = todayDubai(), search = '', online = false, initialized = true, source = null, fallbackTimer = null, authSubmitting = false, requiresSetupToken = false;
let lastSynced = null, refreshPromise = null, refreshPending = false;
const number = value => new Intl.NumberFormat('ar-AE', { maximumFractionDigits: 2 }).format(Number(value) || 0);
const money = value => `<span class="amount-number" dir="ltr">${number(value)}</span><small class="currency">${esc(state?.settings?.currency || 'د.إ')}</small>`;
const plainMoney = value => `${number(value)} ${state?.settings?.currency || 'د.إ'}`;
const dateLabel = value => value ? new Intl.DateTimeFormat('ar-AE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' }).format(new Date(String(value).length === 10 ? `${value}T12:00:00Z` : value)) : '—';
const timeLabel = value => value ? new Intl.DateTimeFormat('ar-AE', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Dubai' }).format(new Date(value)) : '—';
const fullDate = value => value ? `${dateLabel(value)}، ${timeLabel(value)}` : '—';
const data = () => calculate(state, { period, anchor });
const byId = (entity, id) => (state?.[entity] || []).find(item => item.id === id);
const productName = id => byId('products', id)?.name || 'منتج محذوف';
const cents = value => Math.round((Number(value || 0) + Number.EPSILON) * 100);
const totalSale = sale => Number(sale.quantity) * cents(sale.unitPrice) / 100;
const paidSale = id => (state?.payments || []).filter(payment => payment.saleId === id).reduce((sum, payment) => sum + cents(payment.amount), 0) / 100;
const dueSale = sale => Math.max(0, cents(totalSale(sale)) - cents(paidSale(sale.id))) / 100;
const normalizeState = value => value?.state || value;
function requestKey() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

class ApiError extends Error { constructor(message, status, code = '') { super(message); this.status = status; this.code = code; } }
async function api(path, options = {}) {
  let response;
  try { response = await fetch(`/api${path}`, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}), ...options.headers }, body: options.body ? JSON.stringify(options.body) : undefined }); }
  catch { setOnline(false); throw new ApiError('تعذر تأكيد الحفظ أو الاتصال بالخادم. زامن البيانات وراجع السجل قبل إعادة المحاولة.', 0); }
  const result = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof result.error === 'string' ? result.error : result.error?.message || result.message || 'تعذر إكمال العملية. حاول مرة أخرى.';
    if (response.status === 401 && user && path !== '/restore') { user = null; stopSync(); renderAuth(); }
    throw new ApiError(message, response.status, result.code);
  }
  return result;
}
function setOnline(value) { online = value; const element = $('#sync-status'); if (element) element.outerHTML = syncStatus(); }
function applyState(value) {
  const next = normalizeState(value);
  if (!next || !Array.isArray(next.products)) return false;
  if (state && Number(next.revision) < Number(state.revision)) return false;
  state = next; lastSynced = new Date().toISOString(); setOnline(true); renderPage(); return true;
}
async function refresh({ silent = false } = {}) {
  if (refreshPromise) { refreshPending = true; return refreshPromise; }
  refreshPromise = (async () => {
    try {
      do { refreshPending = false; applyState(await api('/state')); } while (refreshPending && user);
    } catch (error) { setOnline(false); if (!silent && user) toast(error.message, 'error'); }
    finally { refreshPromise = null; }
  })();
  return refreshPromise;
}
function stopSync() { source?.close(); source = null; clearInterval(fallbackTimer); fallbackTimer = null; }
function startSync() {
  stopSync(); source = new EventSource('/api/events');
  source.addEventListener('revision', event => {
    let incoming; try { incoming = JSON.parse(event.data); } catch { incoming = null; }
    if (!incoming || Number(incoming.revision ?? incoming) > Number(state?.revision || 0)) refresh({ silent: true });
  });
  source.onopen = () => { clearInterval(fallbackTimer); fallbackTimer = null; refresh({ silent: true }); };
  source.onerror = () => { setOnline(false); if (!fallbackTimer) fallbackTimer = setInterval(() => { if (user) refresh({ silent: true }); }, 20000); };
}
function toast(message, type = 'success') {
  const element = document.createElement('div'); element.className = `toast ${type}`; element.innerHTML = `${icon(type === 'success' ? 'check' : type === 'error' ? 'bell' : 'refresh')}<span>${esc(message)}</span>`; $('#toast-stack').append(element); setTimeout(() => element.remove(), type === 'error' ? 8500 : 4500);
}
function syncStatus() {
  return `<div id="sync-status" class="sync-info"><span class="connection ${online ? 'online' : 'offline'}"><i></i>${online ? 'متصل · محفوظ تلقائيًا' : 'المزامنة متوقفة مؤقتًا'}</span><small>آخر مزامنة ${lastSynced ? timeLabel(lastSynced) : '—'}${state?.updatedAt ? ` · آخر تعديل ${dateLabel(state.updatedAt)} ${timeLabel(state.updatedAt)}` : ''}</small></div>`;
}

function renderAuth(error = '') {
  $('#app').innerHTML = `<main class="auth-page"><section class="auth-story"><div class="auth-brand">${logo()}<div><strong>إرث الطيب</strong><span>أصالةٌ تنمو، وأثرٌ يدوم</span></div></div><div class="auth-story-content"><span class="eyebrow">كل التفاصيل. في مكان واحد.</span><h1>أعمالك بوضوح،<br><em>ونموّك بثقة.</em></h1><p>تابع مبيعاتك ومخزونك وأرباحك، وامنح كل قرار صورة أوضح.</p><div class="auth-features"><span>${icon('shield')} حساب خاص وآمن</span><span>${icon('refresh')} تحديث ومزامنة فورية</span><span>${icon('reports')} تقارير من بياناتك الفعلية</span></div></div><span class="auth-story-footer">إرث الطيب · إدارة الأعمال</span></section><section class="auth-card"><div class="auth-mobile-logo">${logo()}</div><span class="eyebrow">مرحبًا بك في إرث الطيب</span><h2 class="auth-title">${initialized ? 'تسجيل الدخول' : 'لنبدأ حكاية النمو'}</h2><p class="auth-subtitle">${initialized ? 'سجّل الدخول للوصول إلى مساحة أعمالك.' : 'أنشئ حساب المالك الخاص بك. تُحفظ جميع بياناتك في قاعدة البيانات.'}</p>${!initialized ? '<div class="setup-notice">إعداد أول مرة · لا توجد بيانات تجريبية أو أرقام افتراضية.</div>' : ''}<div id="auth-error" class="auth-error" ${error ? '' : 'hidden'} role="alert">${esc(error)}</div><form id="auth-form" class="auth-form">${!initialized ? '<label class="field">اسم المالك<input name="name" required maxlength="100" autocomplete="name" placeholder="اسمك الكامل"></label>' : ''}<label class="field">البريد الإلكتروني<input type="email" name="email" required maxlength="254" dir="ltr" autocomplete="username" placeholder="you@example.com"></label><label class="field">كلمة المرور<input type="password" name="password" required minlength="${initialized ? 1 : 12}" maxlength="200" dir="ltr" autocomplete="${initialized ? 'current-password' : 'new-password'}" placeholder="${initialized ? 'أدخل كلمة المرور' : '12 حرفًا على الأقل'}"></label>${!initialized && requiresSetupToken ? '<label class="field">رمز إعداد الخادم<input name="setupToken" type="password" required autocomplete="off" dir="ltr"><small class="form-hint">أدخل رمز الإعداد الذي حدده مسؤول الاستضافة.</small></label>' : ''}${!initialized ? '<div class="form-grid"><label class="field">رأس المال الأولي<input type="number" name="capital" min="0" max="100000000" step="0.01" value="0" required inputmode="decimal"></label><label class="field">العملة<select name="currency"><option value="AED">درهم إماراتي AED</option><option value="SAR">ريال سعودي SAR</option><option value="QAR">ريال قطري QAR</option><option value="USD">دولار أمريكي USD</option></select></label></div><p class="form-hint">يمكن تعديل رأس المال لاحقًا. تُثبّت العملة بعد تسجيل أول عملية مالية.</p>' : ''}<button class="button primary auth-submit" type="submit">${initialized ? 'الدخول إلى البرنامج' : 'إنشاء الحساب وبدء العمل'}${icon('arrow')}</button></form><div class="auth-security">${icon('lock')} اتصال خاص · حفظ تلقائي بعد كل عملية</div></section></main>`;
  $('#auth-form').addEventListener('submit', submitAuth);
}
async function submitAuth(event) {
  event.preventDefault(); if (authSubmitting) return; authSubmitting = true; const form = event.target, button = $('button[type="submit"]', form), values = Object.fromEntries(new FormData(form));
  button.disabled = true; button.textContent = 'جارٍ التحقق…'; $('#auth-error').hidden = true;
  if (!initialized) values.capital = Number(values.capital);
  try {
    await api(initialized ? '/login' : '/setup', { method: 'POST', body: values });
    initialized = true; const me = await api('/me'); user = me.user; csrfToken = me.csrfToken; const next = await api('/state'); state = normalizeState(next); lastSynced = new Date().toISOString(); online = true; renderShell(); startSync();
  } catch (error) { const errorBox = $('#auth-error'); if (errorBox) { errorBox.textContent = error.message; errorBox.hidden = false; } }
  finally { authSubmitting = false; if (button.isConnected) { button.disabled = false; button.innerHTML = `${initialized ? 'الدخول إلى البرنامج' : 'إنشاء الحساب وبدء العمل'}${icon('arrow')}`; } }
}

function renderShell() {
  $('#app').innerHTML = `<div class="app-shell"><div class="drawer-overlay" data-action="close-menu"></div><aside class="sidebar"><a class="brand" href="#dashboard" aria-label="إرث الطيب، الرئيسية">${logo()}<span><strong>إرث الطيب</strong><small>إدارة الأعمال</small></span></a><span class="nav-caption">مساحة أعمالك</span><nav class="sidebar-nav" aria-label="القائمة الرئيسية">${Object.entries(pageNames).map(([key, label]) => `<a href="#${key}" class="nav-item ${key === page ? 'active' : ''}" data-page="${key}">${icon(key)}<span>${label}</span>${key === 'dashboard' ? '<i class="nav-active-dot"></i>' : ''}</a>`).join('')}</nav><div class="sidebar-note">${icon('shield')}<div><strong>كل عملية محفوظة</strong><small>بياناتك متزامنة بين أجهزتك</small></div></div><div class="sidebar-footer"><span class="avatar">${esc((user?.name || 'إ').slice(0, 1))}</span><div><strong>${esc(user?.name || 'المالك')}</strong><small>حساب المالك</small></div><button class="icon-btn" data-action="logout" title="تسجيل الخروج" aria-label="تسجيل الخروج">${icon('logout')}</button></div></aside><main class="main-content"><header class="topbar"><div class="topbar-title"><button class="icon-btn mobile-menu" data-action="menu" aria-label="فتح القائمة">${icon('menu')}</button>${logo('header-logo')}<div><strong id="topbar-page-title">${pageNames[page]}</strong><small>إرث الطيب / مساحة أعمالك</small></div></div><div class="topbar-tools">${syncStatus()}<button class="icon-btn" data-action="refresh" title="مزامنة الآن" aria-label="مزامنة البيانات الآن">${icon('refresh')}</button><button class="icon-btn notification-btn" data-action="alerts" title="التنبيهات" aria-label="عرض التنبيهات">${icon('bell')}<i id="alert-dot" hidden></i></button><span class="header-avatar">${esc((user?.name || 'إ').slice(0, 1))}</span></div></header><div id="page-content" class="page-content"></div><footer class="app-footer"><span>إرث الطيب · لكل تفصيل أثر</span><span>التوقيت المعتمد: الإمارات GMT+4</span></footer></main></div>`;
  renderPage();
}
function heading(title, subtitle, actions = '') { return `<div class="page-heading"><div><span class="eyebrow">${dateLabel(todayDubai())}</span><h1>${title}</h1><p class="lead">${subtitle}</p></div><div class="action-row">${actions}</div></div>`; }
function addButton(entity, title) { return `<button class="button primary" data-action="add" data-entity="${entity}">${icon('plus')}${title}</button>`; }
function periodBar() {
  return `<div class="period-bar"><div class="period-tabs" role="group" aria-label="الفترة الزمنية">${Object.entries({ day: 'اليوم', week: 'الأسبوع', month: 'الشهر', year: 'السنة', all: 'كل الفترات' }).map(([key, label]) => `<button class="period-tab ${period === key ? 'active' : ''}" data-action="period" data-period="${key}" aria-pressed="${period === key}" ${key === 'week' ? 'title="من الاثنين إلى الأحد"' : ''}>${label}</button>`).join('')}</div><label class="date-control">${icon('calendar')}<span>التاريخ المرجعي</span><input id="date-anchor" type="date" min="1900-01-01" max="2100-12-31" value="${anchor}" aria-label="التاريخ المرجعي للتقارير" ${period === 'all' ? 'disabled' : ''}></label></div>`;
}
function metric(label, value, iconName, note = '', type = '') { return `<article class="metric-card ${type}"><div class="metric-top"><span class="metric-label">${label}</span><span class="metric-icon">${icon(iconName)}</span></div><div class="metric-value">${value}</div><span class="metric-note">${note}</span></article>`; }
function empty(title, description, action = '') { return `<div class="empty-state">${icon('empty')}<h3>${title}</h3><p>${description}</p>${action}</div>`; }
function table(headers, rows, emptyMessage = 'لا توجد بيانات لهذه الفترة.', tableClass = '') { return rows.length ? `<div class="table-wrap"><table class="table ${tableClass}"><thead><tr>${headers.map(label => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>` : empty('مساحة تنتظر أول خطوة', emptyMessage); }
function actions(entity, row) { return `<div class="row-actions"><button class="icon-btn" data-action="edit" data-entity="${entity}" data-id="${esc(row.id)}" aria-label="تعديل ${entityNames[entity]}" title="تعديل">${icon('edit')}</button><button class="icon-btn delete-action" data-action="delete" data-entity="${entity}" data-id="${esc(row.id)}" aria-label="حذف ${entityNames[entity]}" title="حذف">${icon('trash')}</button></div>`; }
function statusTag(due, total) { return due <= .001 ? '<span class="tag success">مدفوع</span>' : `<span class="tag ${due < total - .001 ? 'warning' : 'danger'}">${due < total - .001 ? 'مدفوع جزئيًا' : 'غير مدفوع'}</span>`; }
function matches(...values) { return !search || values.some(value => String(value || '').toLocaleLowerCase().includes(search.toLocaleLowerCase())); }
function searchBar(placeholder, meta = '') { return `<div class="toolbar"><label class="search-wrap">${icon('search')}<input id="table-search" class="search-input" type="search" value="${esc(search)}" placeholder="${placeholder}" aria-label="${placeholder}"></label><span class="table-count">${meta}</span></div>`; }
function renderPage() {
  if (!user || !state || !$('#page-content')) return;
  const editedSettings = $('#settings-form')?.dataset.dirty === 'true' ? { values: Object.fromEntries(new FormData($('#settings-form'))), revision: $('#settings-form').dataset.revision, requestKey: $('#settings-form').dataset.requestKey || '', conflict: $('#settings-form').dataset.conflict || 'false', nextRevision: $('#settings-form').dataset.nextRevision || '', error: $('.form-error', $('#settings-form')).innerHTML, errorHidden: $('.form-error', $('#settings-form')).hidden } : null;
  const focused = document.activeElement, focusId = focused?.id, selection = focused && ['text', 'search'].includes(focused.type) ? focused.selectionStart : null;
  const views = { dashboard: dashboardPage, sales: salesPage, expenses: expensesPage, products: productsPage, payments: paymentsPage, reports: reportsPage, audit: auditPage, settings: settingsPage };
  $('#page-content').innerHTML = (views[page] || dashboardPage)();
  if (editedSettings && $('#settings-form')) { const form = $('#settings-form'); Object.entries(editedSettings.values).forEach(([key,value]) => { if (form.elements[key]) form.elements[key].value = value; }); form.dataset.revision = editedSettings.revision; form.dataset.requestKey = editedSettings.requestKey; form.dataset.conflict = editedSettings.conflict; form.dataset.nextRevision = editedSettings.nextRevision; form.dataset.dirty = 'true'; $('.form-error',form).innerHTML = editedSettings.error; $('.form-error',form).hidden = editedSettings.errorHidden; $('button[type="submit"]',form).disabled = editedSettings.conflict === 'true'; }
  $('#topbar-page-title').textContent = pageNames[page];
  document.querySelectorAll('[data-page]').forEach(element => { element.classList.toggle('active', element.dataset.page === page); if (element.dataset.page === page) element.setAttribute('aria-current', 'page'); else element.removeAttribute('aria-current'); });
  setOnline(online); const stats = data(); $('#alert-dot').hidden = !((stats.lowStock || []).length + (stats.unpaidSales || []).length);
  if (focusId && !focused.closest('#modal-root')) { const target = document.getElementById(focusId); if (target) { target.focus({ preventScroll: true }); if (selection != null && target.setSelectionRange) target.setSelectionRange(selection, selection); } }
}
function chart(series) {
  const values = (series || []).slice(-31), hasData = values.some(item => item.sales || item.expenses);
  if (!hasData) return `<div class="chart-empty">${icon('trend')}<strong>تبدأ الصورة بأول عملية</strong><span>أضف مبيعاتك ومصروفاتك لتظهر حركة أعمالك هنا.</span><div class="chart-placeholder"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></div>`;
  const width = 780, height = 260, left = 60, right = 20, top = 16, bottom = 42, innerWidth = width - left - right, innerHeight = height - top - bottom;
  const max = Math.max(1, ...values.flatMap(item => [Number(item.sales), Number(item.expenses)])) * 1.12;
  const slot = innerWidth / values.length, barWidth = Math.min(16, slot * .29), ticks = [0, .25, .5, .75, 1];
  return `<div class="chart" role="img" aria-label="مقارنة المبيعات والمصروفات لآخر ${values.length} نقاط زمنية في الفترة المختارة"><svg viewBox="0 0 ${width} ${height}" aria-hidden="true">${ticks.map(value => { const y = top + innerHeight * (1 - value); return `<line x1="${left}" x2="${width - right}" y1="${y}" y2="${y}" stroke="#eee7dd" stroke-dasharray="4 5"/><text x="${left - 10}" y="${y + 4}" fill="#927f73" font-size="11" text-anchor="end">${esc(number(max * value))}</text>`; }).join('')}${values.map((item, index) => { const x = left + index * slot + slot / 2, ySale = innerHeight * Number(item.sales) / max, yExp = innerHeight * Number(item.expenses) / max; return `<g><title>${esc(dateLabel(item.date))}: مبيعات ${esc(plainMoney(item.sales))}، مصروفات ${esc(plainMoney(item.expenses))}</title><rect x="${x - barWidth - 2}" y="${top + innerHeight - ySale}" width="${barWidth}" height="${Math.max(0, ySale)}" rx="3" fill="#9B0025"/><rect x="${x + 2}" y="${top + innerHeight - yExp}" width="${barWidth}" height="${Math.max(0, yExp)}" rx="3" fill="#C69A45"/>${values.length < 12 || index % Math.ceil(values.length / 8) === 0 ? `<text x="${x}" y="${height - 15}" text-anchor="middle" font-size="11" fill="#927f73">${esc(item.date?.slice(5) || '')}</text>` : ''}</g>`; }).join('')}</svg></div>`;
}
function dashboardPage() {
  const stats = data(), alertsCount = (stats.lowStock || []).length + (stats.unpaidSales || []).length, recentSales = [...(state.sales || [])].sort((a, b) => `${b.date}${b.createdAt || ''}`.localeCompare(`${a.date}${a.createdAt || ''}`)).slice(0, 5);
  return `${heading('كلّ التفاصيل، أمامك.', `أهلًا ${esc((user.name || '').split(' ')[0] || 'بك')}، هذه صورة أعمالك اليوم.`, `<button class="button secondary" data-action="add" data-entity="expenses">${icon('plus')}إضافة مصروف</button>${addButton('sales', 'عملية بيع جديدة')}`)}${periodBar()}<div class="metric-grid">${metric('إجمالي المبيعات', money(stats.sales), 'sales', 'خلال الفترة المختارة')}${metric('إجمالي المصروفات', money(stats.expenses), 'expenses', 'خلال الفترة المختارة')}${metric('صافي الأرباح', money(stats.netProfit), 'trend', `بعد تكلفة البضاعة والمصروفات · هامش ${number(stats.profitMargin)}٪`, 'featured')}${metric('المبالغ المستحقة', money(stats.outstanding), 'wallet', 'إجمالي غير المدفوع · جميع الفترات')}</div><div class="dashboard-grid"><section class="panel revenue-panel"><div class="panel-header"><div><h2>حركة الأعمال</h2><p>نظرة على المبيعات والمصروفات خلال الفترة</p></div><div class="legend"><span><i class="dot sales"></i>المبيعات</span><span><i class="dot expenses"></i>المصروفات</span></div></div>${chart(stats.series)}<div class="chart-footnote">صافي الربح = المبيعات − تكلفة البضاعة المباعة − المصروفات${stats.series.length > 31 ? ' · الرسم يعرض آخر 31 نقطة من الفترة' : ''}</div></section><section class="panel capital-panel"><div class="panel-header"><div><span class="eyebrow">خطوة أقرب إلى هدفك</span><h2>استرداد رأس المال</h2></div><span class="capital-icon">${icon('trend')}</span></div><span class="capital-caption">المتبقي لاسترداد رأس المال</span><div class="capital-value">${money(stats.capitalRemaining)}</div><div class="progress-track" role="progressbar" aria-label="نسبة استرداد رأس المال" aria-valuenow="${Math.min(100, Math.max(0, stats.capitalProgress))}" aria-valuemin="0" aria-valuemax="100"><span class="progress-bar" style="width:${Math.min(100, Math.max(0, stats.capitalProgress))}%"></span></div><div class="progress-label"><span>تم استرداد ${number(stats.capitalProgress)}٪</span><strong>${money(stats.capitalRecovered)}</strong></div><div class="capital-bottom"><span>رأس المال الأولي</span><strong>${money(state.settings.capital)}</strong></div><p class="form-hint">يُحتسب من صافي الربح التراكمي لجميع الفترات، وليس التدفق النقدي.</p></section></div><div class="daily-banner"><div class="daily-title"><span>${icon('calendar')}</span><div><h2>يومك في سطور</h2><p>ملخص اليوم · ${dateLabel(todayDubai())}</p></div></div><div><small>مبيعات اليوم</small><strong>${money(stats.daily.sales)}</strong></div><div><small>مصروفات اليوم</small><strong>${money(stats.daily.expenses)}</strong></div><div><small>صافي ربح اليوم</small><strong class="burgundy-text">${money(stats.daily.netProfit)}</strong></div></div><div class="dashboard-grid bottom-grid"><section class="panel"><div class="panel-header"><div><h2>آخر المبيعات</h2><p>أحدث العمليات في جميع الفترات</p></div><button class="text-button" data-action="navigate" data-page="sales">عرض الكل ${icon('arrow')}</button></div>${table(['المنتج / العميل', 'المبلغ', 'الحالة'], recentSales.map(sale => `<tr><td><strong>${esc(productName(sale.productId))}</strong><small class="cell-sub">${esc(sale.customer || 'عميل نقدي')} · ${dateLabel(sale.date)}</small></td><td class="nowrap">${money(totalSale(sale))}</td><td>${statusTag(dueSale(sale), totalSale(sale))}</td></tr>`), 'أضف أول عملية بيع لتظهر هنا.')}</section><section class="panel"><div class="panel-header"><div><h2>تحتاج إلى انتباهك</h2><p>تنبيهات المخزون والمبالغ المستحقة</p></div><span class="count-badge">${number(alertsCount)}</span></div>${alertsContent(stats, 4)}</section></div>`;
}
function alertsContent(stats, limit = Infinity) {
  const stock = (stats.lowStock || []).map(product => `<button class="alert-row warning" data-action="edit" data-entity="products" data-id="${esc(product.id)}"><span class="alert-icon">${icon('products')}</span><span><strong>مخزون ${esc(product.name)} ${product.remaining <= 0 ? 'نفد' : 'منخفض'}</strong><small>المتبقي ${number(product.remaining)} · حد التنبيه ${number(product.lowStock)}</small></span>${icon('arrow')}</button>`);
  const unpaid = (stats.unpaidSales || []).map(sale => `<button class="alert-row danger" data-action="pay-sale" data-id="${esc(sale.id)}"><span class="alert-icon">${icon('wallet')}</span><span><strong>مبلغ مستحق على ${esc(sale.customer || 'عميل نقدي')}</strong><small>${plainMoney(sale.due ?? dueSale(sale))} · ${dateLabel(sale.date)}</small></span>${icon('arrow')}</button>`);
  return [...stock, ...unpaid].length ? `<div class="alert-list">${[...stock, ...unpaid].slice(0, limit).join('')}</div>` : `<div class="all-clear">${icon('check')}<strong>كل شيء على ما يرام</strong><p>ستظهر هنا تنبيهات نقص المخزون والمبالغ غير المدفوعة.</p></div>`;
}
function salesPage() {
  const stats = data(), rows = stats.filteredSales.filter(sale => matches(sale.customer, productName(sale.productId), sale.notes)).sort((a, b) => b.date.localeCompare(a.date));
  return `${heading('المبيعات', 'كل عملية بيع مرتبطة بمخزونك وأرباحك ومستحقاتك.', addButton('sales', 'عملية بيع جديدة'))}${periodBar()}<div class="mini-stats"><span>المبيعات <strong>${money(stats.sales)}</strong></span><span>تكلفة البضاعة <strong>${money(stats.costOfGoods)}</strong></span><span>عدد العمليات <strong>${number(stats.filteredSales.length)}</strong></span></div><section class="panel">${searchBar('ابحث بالمنتج أو اسم العميل…', `${number(rows.length)} عملية`)}${table(['المنتج', 'العميل', 'التاريخ', 'الكمية', 'الإجمالي', 'المدفوع', 'المستحق', 'الحالة', 'الإجراءات'], rows.map(sale => `<tr><td><strong>${esc(productName(sale.productId))}</strong>${sale.notes ? `<small class="cell-sub">${esc(sale.notes)}</small>` : ''}</td><td>${esc(sale.customer || 'عميل نقدي')}</td><td class="nowrap">${dateLabel(sale.date)}</td><td>${number(sale.quantity)}</td><td class="nowrap">${money(totalSale(sale))}</td><td class="nowrap">${money(paidSale(sale.id))}</td><td class="nowrap">${money(dueSale(sale))}${dueSale(sale) > 0 ? `<button class="inline-link" data-action="pay-sale" data-id="${esc(sale.id)}">تسجيل دفعة</button>` : ''}</td><td>${statusTag(dueSale(sale), totalSale(sale))}</td><td>${actions('sales', sale)}</td></tr>`), search ? 'لا توجد نتائج مطابقة للبحث.' : 'لا توجد عمليات بيع خلال الفترة المختارة.')}</section>`;
}
function expensesPage() {
  const stats = data(), rows = stats.filteredExpenses.filter(expense => matches(expense.title, expense.category, expense.notes)).sort((a, b) => b.date.localeCompare(a.date));
  return `${heading('المصروفات', 'سجّل كل مصروف لتبقى الأرباح دقيقة وواضحة.', addButton('expenses', 'إضافة مصروف'))}${periodBar()}<div class="mini-stats"><span>إجمالي المصروفات <strong>${money(stats.expenses)}</strong></span><span>عدد المصروفات <strong>${number(stats.filteredExpenses.length)}</strong></span></div><section class="panel">${searchBar('ابحث بعنوان المصروف أو التصنيف…', `${number(rows.length)} مصروف`)}${table(['المصروف', 'التصنيف', 'التاريخ', 'المبلغ', 'ملاحظات', 'الإجراءات'], rows.map(expense => `<tr><td><strong>${esc(expense.title)}</strong></td><td><span class="tag neutral">${esc(expense.category || 'عام')}</span></td><td>${dateLabel(expense.date)}</td><td class="nowrap">${money(expense.amount)}</td><td>${esc(expense.notes || '—')}</td><td>${actions('expenses', expense)}</td></tr>`), search ? 'لا توجد نتائج مطابقة للبحث.' : 'لا توجد مصروفات خلال الفترة المختارة.')}</section>`;
}
function productsPage() {
  const stats = data(), rows = stats.inventory.filter(product => matches(product.name, product.sku, product.category));
  return `${heading('المنتجات والمخزون', 'مخزونك الحالي يتحدّث تلقائيًا مع كل عملية بيع وتعديل.', addButton('products', 'إضافة منتج'))}<div class="metric-grid three-metrics">${metric('عدد المنتجات', number(state.products.length), 'products', 'جميع المنتجات المسجلة')}${metric('الكمية المتبقية', number(stats.stockUnits), 'products', 'وحدة متاحة حاليًا · جميع الفترات')}${metric('منتجات تحتاج تزويدًا', number(stats.lowStock.length), 'bell', 'وصلت إلى حد التنبيه أو أقل')}</div><section class="panel">${searchBar('ابحث بالاسم أو الرمز أو التصنيف…', `${number(rows.length)} منتج`)}${table(['المنتج', 'التصنيف', 'سعر التكلفة', 'سعر البيع', 'المخزون المسجل', 'المتبقي', 'الحالة', 'الإجراءات'], rows.map(product => `<tr><td><div class="product-cell"><span class="product-avatar">${icon('products')}</span><div><strong>${esc(product.name)}</strong><small class="cell-sub" dir="ltr">${esc(product.sku || '—')}</small></div></div></td><td>${esc(product.category || 'عام')}</td><td class="nowrap">${money(product.cost)}</td><td class="nowrap">${money(product.price)}</td><td>${number(product.initialStock)}</td><td><strong>${number(product.remaining)}</strong><small class="cell-sub">حد التنبيه ${number(product.lowStock)}</small></td><td><span class="tag ${product.remaining <= 0 ? 'danger' : product.remaining <= product.lowStock ? 'warning' : 'success'}">${product.remaining <= 0 ? 'نفد المخزون' : product.remaining <= product.lowStock ? 'مخزون منخفض' : 'متوفر'}</span></td><td>${actions('products', product)}</td></tr>`), search ? 'لا توجد نتائج مطابقة للبحث.' : 'أضف أول منتج لبدء إدارة المخزون والمبيعات.')}</section><p class="page-note">المخزون المتبقي = المخزون المسجل − مجموع الكميات المباعة. عند التوريد، زد المخزون المسجل. تعديل تكلفة المنتج لا يغيّر تكلفة المبيعات السابقة.</p>`;
}
function paymentsPage() {
  const stats = data(), rows = stats.filteredPayments.filter(payment => { const sale = byId('sales', payment.saleId); return matches(sale?.customer, sale ? productName(sale.productId) : '', payment.method, payment.notes); }).sort((a, b) => b.date.localeCompare(a.date));
  return `${heading('الدفعات والمستحقات', 'تابع التحصيل دون تكرار احتساب إيرادات المبيعات.', addButton('payments', 'تسجيل دفعة'))}${periodBar()}<div class="mini-stats"><span>المستحق حاليًا · كل الفترات <strong>${money(stats.outstanding)}</strong></span><span>الدفعات خلال الفترة <strong>${money(stats.filteredPayments.reduce((sum, payment) => sum + Number(payment.amount), 0))}</strong></span></div><section class="panel">${searchBar('ابحث بالعميل أو المنتج أو طريقة الدفع…', `${number(rows.length)} دفعة`)}${table(['العميل / المنتج', 'التاريخ', 'المبلغ', 'طريقة الدفع', 'ملاحظات', 'الإجراءات'], rows.map(payment => { const sale = byId('sales', payment.saleId); return `<tr><td><strong>${esc(sale?.customer || 'عميل نقدي')}</strong><small class="cell-sub">${esc(sale ? productName(sale.productId) : '—')}</small></td><td>${dateLabel(payment.date)}</td><td class="nowrap">${money(payment.amount)}</td><td><span class="tag neutral">${esc(payment.method || 'نقدي')}</span></td><td>${esc(payment.notes || '—')}</td><td>${actions('payments', payment)}</td></tr>`; }), search ? 'لا توجد نتائج مطابقة للبحث.' : 'لم تُسجّل دفعات خلال الفترة المختارة.')}</section><section class="panel outstanding-panel"><div class="panel-header"><div><h2>المبالغ غير المدفوعة</h2><p>رصيد مستحق حاليًا لجميع الفترات</p></div></div>${table(['العميل', 'المنتج', 'تاريخ البيع', 'الإجمالي', 'المدفوع', 'المتبقي', ''], stats.unpaidSales.map(sale => `<tr><td>${esc(sale.customer || 'عميل نقدي')}</td><td>${esc(productName(sale.productId))}</td><td>${dateLabel(sale.date)}</td><td>${money(sale.total ?? totalSale(sale))}</td><td>${money(sale.paid ?? paidSale(sale.id))}</td><td><strong>${money(sale.due ?? dueSale(sale))}</strong></td><td><button class="button secondary small" data-action="pay-sale" data-id="${esc(sale.id)}">تسجيل دفعة</button></td></tr>`), 'لا توجد مبالغ مستحقة. جميع المبيعات مدفوعة.')}</section>`;
}
function reportRangeLabel() { return `${{ day: 'يومي', week: 'أسبوعي', month: 'شهري', year: 'سنوي', all: 'جميع الفترات' }[period]}${period === 'all' ? '' : ` · التاريخ المرجعي: ${dateLabel(anchor)}`}`; }
function reportsPage() {
  const stats = data();
  return `${heading('التقارير', 'قراءة دقيقة لأعمالك، جاهزة للمراجعة والطباعة.', `<button class="button secondary" data-action="csv">${icon('download')}تصدير CSV</button><button class="button primary" data-action="print">${icon('print')}طباعة التقرير</button>`)}${periodBar()}<div class="print-report"><div class="print-only print-header">${logo()}<div><h1>إرث الطيب</h1><p>التقرير المالي · ${reportRangeLabel()}</p><small>تاريخ الإصدار: ${fullDate(new Date().toISOString())}</small></div></div><div class="metric-grid">${metric('إجمالي المبيعات', money(stats.sales), 'sales', 'الفترة المختارة')}${metric('تكلفة البضاعة المباعة', money(stats.costOfGoods), 'products', 'تكلفة المبيعات عند تسجيلها')}${metric('المصروفات', money(stats.expenses), 'expenses', 'الفترة المختارة')}${metric('صافي الربح', money(stats.netProfit), 'trend', `هامش الربح ${number(stats.profitMargin)}٪`, 'featured')}</div><div class="two-column"><section class="panel"><div class="panel-header"><h2>ملخص الأداء المالي</h2></div><div class="summary-list"><div class="summary-row"><span>المبيعات</span><strong>${money(stats.sales)}</strong></div><div class="summary-row"><span>تكلفة البضاعة المباعة</span><strong>${money(stats.costOfGoods)}</strong></div><div class="summary-row"><span>مجمل الربح</span><strong>${money(stats.sales - stats.costOfGoods)}</strong></div><div class="summary-row"><span>المصروفات</span><strong>${money(stats.expenses)}</strong></div><div class="summary-row total"><span>صافي الربح</span><strong>${money(stats.netProfit)}</strong></div></div></section><section class="panel"><div class="panel-header"><h2>الأرصدة الحالية · جميع الفترات</h2></div><div class="summary-list"><div class="summary-row"><span>المبالغ المستحقة</span><strong>${money(stats.outstanding)}</strong></div><div class="summary-row"><span>الوحدات المتبقية بالمخزون</span><strong>${number(stats.stockUnits)}</strong></div><div class="summary-row"><span>رأس المال الأولي</span><strong>${money(state.settings.capital)}</strong></div><div class="summary-row"><span>صافي الربح التراكمي</span><strong>${money(stats.allTimeProfit)}</strong></div><div class="summary-row total"><span>المتبقي لاسترداد رأس المال</span><strong>${money(stats.capitalRemaining)}</strong></div></div></section></div><section class="panel report-section"><div class="panel-header"><h2>أداء المنتجات خلال الفترة</h2></div>${table(['المنتج', 'الكمية المباعة', 'المبيعات', 'مجمل الربح قبل المصروفات'], stats.productPerformance.map(product => `<tr><td>${esc(product.name)}</td><td>${number(product.quantity)}</td><td>${money(product.revenue)}</td><td>${money(product.profit)}</td></tr>`), 'لم تُسجّل مبيعات خلال هذه الفترة.')}</section><section class="panel report-section"><div class="panel-header"><h2>تفاصيل المبيعات</h2></div>${table(['التاريخ', 'المنتج', 'العميل', 'الكمية', 'المبيعات', 'تكلفة البضاعة', 'المستحق حاليًا'], stats.filteredSales.map(sale => `<tr><td>${dateLabel(sale.date)}</td><td>${esc(productName(sale.productId))}</td><td>${esc(sale.customer || 'عميل نقدي')}</td><td>${number(sale.quantity)}</td><td>${money(totalSale(sale))}</td><td>${money(sale.quantity * sale.unitCost)}</td><td>${money(dueSale(sale))}</td></tr>`))}</section><section class="panel report-section"><div class="panel-header"><h2>تفاصيل المصروفات</h2></div>${table(['التاريخ', 'المصروف', 'التصنيف', 'المبلغ'], stats.filteredExpenses.map(expense => `<tr><td>${dateLabel(expense.date)}</td><td>${esc(expense.title)}</td><td>${esc(expense.category || 'عام')}</td><td>${money(expense.amount)}</td></tr>`))}</section><section class="panel report-section"><div class="panel-header"><h2>تفاصيل الدفعات</h2></div>${table(['التاريخ', 'العميل', 'طريقة الدفع', 'المبلغ'], stats.filteredPayments.map(payment => `<tr><td>${dateLabel(payment.date)}</td><td>${esc(byId('sales', payment.saleId)?.customer || 'عميل نقدي')}</td><td>${esc(payment.method || 'نقدي')}</td><td>${money(payment.amount)}</td></tr>`))}</section><p class="page-note">تُحتسب الأرباح على أساس المبيعات وتكلفة البضاعة والمصروفات. تحصيل الدفعات لا يُضاف إلى الإيراد مرة أخرى. المخزون والمستحقات واسترداد رأس المال أرصدة حالية لجميع الفترات.</p><div class="print-only print-footer">إرث الطيب · تقرير صادر من البيانات المحفوظة · آخر تعديل ${fullDate(state.updatedAt)}</div></div>`;
}
function auditPage() {
  const titles = { create: 'إضافة', update: 'تعديل', delete: 'حذف', restore: 'استعادة', setup: 'إعداد الحساب' }, entities = { product: 'منتج', sale: 'عملية بيع', expense: 'مصروف', payment: 'دفعة', settings: 'الإعدادات', backup: 'نسخة احتياطية', ...entityNames };
  const rows = [...(state.audit || [])].filter(item => matches(item.description, item.action, entities[item.entity])).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return `${heading('سجل التعديلات', 'أثر واضح لكل إضافة وتعديل وحذف، مع التاريخ والوقت.')}<section class="panel">${searchBar('ابحث في سجل العمليات…', `${number(rows.length)} حدث`)}${rows.length ? `<div class="audit-list">${rows.map(item => `<article class="audit-item"><span class="audit-icon ${item.action === 'delete' ? 'danger-text' : ''}">${icon(item.action === 'delete' ? 'trash' : item.action === 'create' ? 'plus' : 'audit')}</span><div class="audit-main"><strong>${esc(item.description || `${titles[item.action] || item.action} ${entities[item.entity] || item.entity}`)}</strong><small>${esc(titles[item.action] || item.action)} · ${esc(entities[item.entity] || item.entity)}</small>${item.before || item.after ? `<details><summary>عرض تفاصيل التغيير</summary><div class="audit-details">${item.before ? `<div><span>قبل</span><pre dir="ltr">${esc(JSON.stringify(item.before, null, 2))}</pre></div>` : ''}${item.after ? `<div><span>بعد</span><pre dir="ltr">${esc(JSON.stringify(item.after, null, 2))}</pre></div>` : ''}</div></details>` : ''}</div><time datetime="${esc(item.at)}">${dateLabel(item.at)}<small>${timeLabel(item.at)}</small></time></article>`).join('')}</div>` : empty('لا توجد تعديلات بعد', 'ستظهر عملياتك هنا تلقائيًا بعد الحفظ.')}</section>`;
}
function settingsPage() {
  return `${heading('الإعدادات والنسخ الاحتياطي', 'أساس متين لأعمالك، ونسخة محفوظة من كل تفاصيلها.')}<div class="settings-grid"><section class="panel"><div class="panel-header"><div><h2>إعدادات النشاط</h2><p>رأس المال والعملة المستخدمة في الحسابات</p></div>${icon('settings')}</div><form id="settings-form" class="settings-form" data-revision="${state.revision}"><div class="form-grid"><label class="field">رأس المال الأولي<input name="capital" type="number" step="0.01" min="0" max="100000000" required value="${state.settings.capital}" inputmode="decimal"></label><label class="field">العملة<select name="currency">${[['AED','درهم إماراتي AED'],['SAR','ريال سعودي SAR'],['QAR','ريال قطري QAR'],['USD','دولار أمريكي USD']].map(([value,label]) => `<option value="${value}" ${state.settings.currency === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div><p class="form-hint">تُحدد العملة قبل تسجيل العمليات المالية؛ لا يمكن تغييرها بعد وجود مبيعات أو مصروفات أو دفعات. لا يجري البرنامج تحويلًا لأسعار الصرف.</p><div class="form-error" role="alert" hidden></div><button class="button primary" type="submit">${icon('check')}حفظ الإعدادات</button></form></section><section class="panel"><div class="panel-header"><div><h2>حساب المالك</h2><p>مساحة أعمال خاصة بك</p></div>${icon('shield')}</div><div class="summary-list"><div class="summary-row"><span>الاسم</span><strong>${esc(user.name)}</strong></div><div class="summary-row"><span>البريد الإلكتروني</span><strong dir="ltr">${esc(user.email)}</strong></div><div class="summary-row"><span>التوقيت</span><strong>الإمارات · GMT+4</strong></div><div class="summary-row"><span>آخر تعديل للبيانات</span><strong>${fullDate(state.updatedAt)}</strong></div></div></section><section class="panel backup-panel"><div class="panel-header"><div><h2>نسخة احتياطية</h2><p>احتفظ بنسخة مستقلة من بيانات أعمالك</p></div>${icon('download')}</div><p class="panel-description">نزّل المنتجات والمبيعات والمصروفات والدفعات والإعدادات وسجل التعديلات في ملف JSON قابل للاستعادة.</p><button class="button primary" data-action="backup">${icon('download')}تنزيل نسخة احتياطية</button><p class="form-hint">احفظ الملف في مكان آمن؛ فهو يحتوي على بيانات النشاط.</p></section><section class="panel restore-panel"><div class="panel-header"><div><h2>استعادة البيانات</h2><p>العودة إلى نسخة احتياطية سابقة</p></div>${icon('upload')}</div><p class="panel-description">اختر نسخة صادرة من البرنامج. ستظهر تفاصيلها للمراجعة قبل تأكيد استبدال بيانات النشاط بكلمة المرور. يبقى سجل التعديلات الحالي محفوظًا.</p><button class="button secondary" data-action="restore">${icon('upload')}اختيار نسخة للاستعادة</button><p class="form-hint">ننصح بتنزيل نسخة من البيانات الحالية قبل الاستعادة.</p></section></div><div class="info-card">${icon('refresh')}<div><strong>الحفظ والمزامنة</strong><p>تُحفظ كل عملية في قاعدة البيانات فور نجاحها. افتح عنوان البرنامج نفسه على أجهزتك وسجّل الدخول بحسابك لمتابعة الأرقام المحدثة.</p></div></div>`;
}

const field = (label, name, value = '', options = {}) => `<label class="field ${options.full ? 'full' : ''}">${label}<input name="${name}" id="form-${name}" value="${esc(value)}" ${options.type ? `type="${options.type}"` : 'type="text"'} ${options.required === false ? '' : 'required'} ${options.min != null ? `min="${options.min}"` : ''} ${options.max != null ? `max="${options.max}"` : ''} ${options.step ? `step="${options.step}"` : ''} ${options.placeholder ? `placeholder="${esc(options.placeholder)}"` : ''} ${options.type === 'number' ? 'inputmode="decimal"' : ''} ${options.type === 'date' ? 'min="1900-01-01" max="2100-12-31"' : ''} maxlength="${options.maxlength || 500}"${options.readonly ? ' readonly' : ''}>${options.hint ? `<small class="form-hint">${options.hint}</small>` : ''}</label>`;
const selectField = (label, name, options, value = '', hint = '') => `<label class="field">${label}<select name="${name}" id="form-${name}" required>${options.map(([key, text]) => `<option value="${esc(key)}" ${String(value) === String(key) ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select>${hint ? `<small class="form-hint">${hint}</small>` : ''}</label>`;
function showModal(title, body, footer, formAttributes = '') {
  const previousFocus = document.activeElement;
  $('#modal-root').innerHTML = `<dialog class="modal" id="active-modal" aria-labelledby="modal-title"><form id="modal-form" ${formAttributes}><div class="modal-header"><div><span class="eyebrow">إرث الطيب · مساحة أعمالك</span><h2 id="modal-title">${title}</h2></div><button class="icon-btn" type="button" data-action="close-modal" aria-label="إغلاق">${icon('close')}</button></div><div class="modal-body">${body}<div id="modal-error" class="form-error" role="alert" hidden></div></div><div class="modal-footer">${footer}</div></form></dialog>`;
  const dialog = $('#active-modal'); dialog.showModal(); dialog.addEventListener('close', () => previousFocus?.focus({ preventScroll: true })); dialog.addEventListener('cancel', event => { if ($('#modal-form')?.dataset.saving === 'true') event.preventDefault(); });
  dialog.addEventListener('click', event => { if (event.target === dialog && $('#modal-form')?.dataset.saving !== 'true') closeModal(); });
}
function closeModal() { const form = $('#modal-form'); if (form?.dataset.saving === 'true') return; $('#active-modal')?.close(); $('#modal-root').innerHTML = ''; }
function openEditor(entity, id = '', saleId = '') {
  const item = id ? byId(entity, id) : null;
  if (id && !item) { toast('هذه العملية لم تعد موجودة. تم تحديث البيانات.', 'error'); refresh(); return; }
  if (entity === 'sales' && !state.products.length) { toast('أضف منتجًا أولًا لتتمكن من تسجيل عملية بيع.', 'info'); openEditor('products'); return; }
  if (entity === 'payments' && !state.sales.length) { toast('أضف عملية بيع أولًا قبل تسجيل دفعة.', 'info'); return; }
  let body = '', title = `${item ? 'تعديل' : 'إضافة'} ${entityNames[entity]}`;
  if (entity === 'products') {
    body = `${field('اسم المنتج', 'name', item?.name, { full: true, maxlength: 120, placeholder: 'مثل: بخور الإرث' })}${field('رمز المنتج', 'sku', item?.sku, { required: false, maxlength: 80, placeholder: 'اختياري' })}${field('التصنيف', 'category', item?.category, { required: false, maxlength: 80, placeholder: 'مثل: بخور، عطور' })}${field('تكلفة الوحدة', 'cost', item?.cost ?? 0, { type: 'number', min: 0, max: 100000000, step: '.01' })}${field('سعر بيع الوحدة', 'price', item?.price ?? 0, { type: 'number', min: 0, max: 100000000, step: '.01' })}${field('المخزون المسجل', 'initialStock', item?.initialStock ?? 0, { type: 'number', min: 0, max: 100000000, step: 1, hint: 'الرصيد الأولي مضافًا إليه جميع التوريدات.' })}${field('حد تنبيه انخفاض المخزون', 'lowStock', item?.lowStock ?? 5, { type: 'number', min: 0, max: 100000000, step: 1 })}<p class="form-hint field full">تعديل تكلفة المنتج يؤثر في المبيعات الجديدة فقط. يظل الربح التاريخي مرتبطًا بالتكلفة المسجلة في كل عملية بيع.</p>`;
  } else if (entity === 'sales') {
    const product = byId('products', item?.productId) || state.products[0], inventory = data().inventory;
    body = `${selectField('المنتج', 'productId', state.products.map(product => [product.id, `${product.name} · المتبقي ${number(inventory.find(item => item.id === product.id)?.remaining || 0)}`]), item?.productId || product.id)}${field('اسم العميل', 'customer', item?.customer || '', { required: false, maxlength: 120, placeholder: 'عميل نقدي' })}${field('الكمية', 'quantity', item?.quantity ?? 1, { type: 'number', min: 1, max: 100000000, step: 1 })}${field('سعر بيع الوحدة', 'unitPrice', item?.unitPrice ?? product.price, { type: 'number', min: 0, max: 100000000, step: '.01' })}${field('تكلفة الوحدة لهذه العملية', 'unitCost', item?.unitCost ?? product.cost, { type: 'number', min: 0, max: 100000000, step: '.01' })}${field('تاريخ البيع', 'date', item?.date || todayDubai(), { type: 'date' })}${!item ? field('المبلغ المدفوع الآن', 'paid', 0, { type: 'number', min: 0, max: 100000000, step: '.01', hint: 'سجّل المبلغ المحصّل فعلًا؛ الباقي يظهر ضمن المستحقات.' }) : `<div class="field"><span>المدفوع حتى الآن</span><strong class="form-paid">${money(paidSale(item.id))}</strong><small class="form-hint">لتعديل التحصيل، عدّل الدفعات المرتبطة من صفحة الدفعات.</small></div>`}${field('ملاحظات', 'notes', item?.notes, { required: false, full: true, maxlength: 1000 })}<div class="sale-preview field full" id="sale-preview"></div>`;
  } else if (entity === 'expenses') {
    body = `${field('عنوان المصروف', 'title', item?.title, { full: true, maxlength: 120, placeholder: 'مثل: تغليف الطلبات' })}${selectField('التصنيف', 'category', ['تشغيل', 'تغليف', 'توصيل', 'تسويق', 'إيجار', 'رواتب', 'عام'].map(value => [value, value]).concat(item?.category && !['تشغيل', 'تغليف', 'توصيل', 'تسويق', 'إيجار', 'رواتب', 'عام'].includes(item.category) ? [[item.category, item.category]] : []), item?.category || 'عام')}${field('المبلغ', 'amount', item?.amount ?? '', { type: 'number', min: .01, max: 100000000, step: '.01' })}${field('التاريخ', 'date', item?.date || todayDubai(), { type: 'date' })}${field('ملاحظات', 'notes', item?.notes, { required: false, full: true, maxlength: 1000 })}`;
  } else if (entity === 'payments') {
    const sales = state.sales.filter(sale => dueSale(sale) > .001 || sale.id === item?.saleId || sale.id === saleId), selected = item?.saleId || saleId || sales[0]?.id;
    if (!sales.length) { toast('جميع المبيعات مدفوعة بالكامل. لا يوجد رصيد يحتاج إلى دفعة.', 'info'); return; }
    body = `${selectField('عملية البيع', 'saleId', sales.map(sale => [sale.id, `${sale.customer || 'عميل نقدي'} · ${productName(sale.productId)} · ${dateLabel(sale.date)} · المستحق ${plainMoney(dueSale(sale))}`]), selected)}${field('المبلغ', 'amount', item?.amount ?? (selected ? dueSale(byId('sales', selected)) : ''), { type: 'number', min: .01, max: 100000000, step: '.01' })}${field('تاريخ الدفع', 'date', item?.date || todayDubai(), { type: 'date' })}${selectField('طريقة الدفع', 'method', ['نقدي', 'تحويل بنكي', 'بطاقة', 'أخرى'].map(value => [value, value]).concat(item?.method && !['نقدي', 'تحويل بنكي', 'بطاقة', 'أخرى'].includes(item.method) ? [[item.method,item.method]] : []), item?.method || 'نقدي')}${field('ملاحظات', 'notes', item?.notes, { required: false, full: true, maxlength: 1000 })}<p class="form-hint field full">تسجيل الدفعة يخفض المبلغ المستحق، ولا يزيد المبيعات أو الأرباح مرة أخرى.</p>`;
  }
  showModal(title, `<div class="form-grid">${body}</div>`, `<span class="save-note">${icon('shield')} يحفظ تلقائيًا عند التأكيد</span><button type="button" class="button ghost" data-action="close-modal">إلغاء</button><button type="submit" class="button primary">${icon('check')}حفظ ${entityNames[entity]}</button>`, `data-entity="${entity}" data-id="${esc(id)}" data-version="${item?.version || ''}" data-kind="editor"`);
  if (entity === 'sales') updateSalePreview();
}
function updateSalePreview() {
  const form = $('#modal-form'), preview = $('#sale-preview'); if (!form || !preview) return;
  const quantity = Number(form.elements.quantity.value) || 0, price = Number(form.elements.unitPrice.value) || 0, cost = Number(form.elements.unitCost.value) || 0;
  preview.innerHTML = `<span>إجمالي العملية<strong>${money(quantity * cents(price) / 100)}</strong></span><span>مجمل الربح قبل المصروفات<strong>${money(quantity * (cents(price) - cents(cost)) / 100)}</strong></span>`;
}
function confirmDelete(entity, id) {
  const item = byId(entity, id); if (!item) return;
  const desc = { sales: 'ستُحذف عملية البيع والدفعات المرتبطة بها، وتعود الكمية إلى المخزون وتُعاد حسابات الأرباح والمستحقات.', expenses: 'سيُحذف المصروف وتُعاد حسابات صافي الأرباح والتقارير.', products: 'يمكن حذف المنتج إذا لم تكن هناك مبيعات مرتبطة به. لا يمكن حذف منتج له سجل مبيعات.', payments: 'ستُحذف الدفعة ويزداد الرصيد المستحق على عملية البيع المرتبطة بها.' };
  showModal(`حذف ${entityNames[entity]}؟`, `<div class="delete-warning">${icon('trash')}<p>${desc[entity]}</p><strong>${esc(item.name || item.title || item.customer || (entity === 'payments' ? plainMoney(item.amount) : productName(item.productId)))}</strong></div>`, `<button type="button" class="button ghost" data-action="close-modal">إلغاء</button><button type="submit" class="button danger">${icon('trash')}تأكيد الحذف</button>`, `data-kind="delete" data-entity="${entity}" data-id="${esc(id)}" data-version="${item.version}"`);
}
async function submitModal(event) {
  event.preventDefault(); const form = event.target; if (form.dataset.saving === 'true' || form.dataset.conflict === 'true') return;
  const kind = form.dataset.kind; if (!['editor', 'delete', 'restore'].includes(kind)) return;
  form.dataset.requestKey ||= requestKey();
  form.dataset.saving = 'true'; const submit = $('button[type="submit"]', form), oldText = submit.innerHTML; submit.disabled = true; submit.textContent = 'جارٍ الحفظ…'; $('#modal-error').hidden = true;
  let success = false;
  try {
    let next;
    if (kind === 'restore') {
      if (!form.backupData) throw new ApiError('اختر ملف نسخة احتياطية صالحًا أولًا.', 400);
      if (!form.elements.confirmRestore.checked) throw new ApiError('أكد موافقتك على استبدال البيانات الحالية قبل المتابعة.', 400);
      next = await api('/restore', { method: 'POST', headers: { 'Idempotency-Key': form.dataset.requestKey }, body: { backup: (() => { const { audit, ...businessBackup } = form.backupData; return businessBackup; })(), password: form.elements.password.value, expectedRevision: Number(form.dataset.revision) } });
    } else {
      const { entity, id, version } = form.dataset;
      let body;
      if (kind === 'delete') body = { version: Number(version) };
      else { body = Object.fromEntries(new FormData(form)); ['cost','price','initialStock','lowStock','quantity','unitPrice','unitCost','paid','amount'].forEach(key => { if (key in body) body[key] = Number(body[key]); }); if (id) body.version = Number(version); }
      next = await api(`/${entity}${id ? `/${encodeURIComponent(id)}` : ''}`, { method: kind === 'delete' ? 'DELETE' : id ? 'PUT' : 'POST', headers: { 'Idempotency-Key': form.dataset.requestKey }, body });
    }
    if (!applyState(next)) await refresh(); success = true; toast(kind === 'restore' ? 'تمت استعادة البيانات وتحديث جميع الحسابات بنجاح.' : kind === 'delete' ? 'تم الحذف وتحديث جميع الحسابات بنجاح.' : 'تم الحفظ وتحديث جميع الحسابات بنجاح.');
  } catch (error) {
    if (error.status === 409) {
      await refresh({ silent: true });
      const current = byId(form.dataset.entity, form.dataset.id);
      showFormError(`${error.message} احتفظنا بإدخالك. راجع البيانات الحالية أدناه قبل تقرير المتابعة.`);
      if (error.code === 'IDEMPOTENCY_CONFLICT' && !form.dataset.id && kind !== 'restore') {
        form.dataset.conflict = 'true';
        $('#modal-error').insertAdjacentHTML('beforeend', '<p>قد تكون العملية السابقة قد حُفظت بالفعل. راجع سجل التعديلات قبل إضافة عملية أخرى.</p><button type="button" class="button secondary small" data-action="review-saved-operation">إغلاق ومراجعة السجل</button>');
      } else if (current || kind === 'restore') {
        form.dataset.conflict = 'true';
        form.dataset.nextVersion = current?.version || '';
        form.dataset.nextRevision = state.revision;
        const currentValues = current || { products: state.products.length, sales: state.sales.length, expenses: state.expenses.length, payments: state.payments.length };
        $('#modal-error').insertAdjacentHTML('beforeend', `${conflictDetails(currentValues)}<button type="button" class="button secondary small" data-action="accept-conflict">${kind === 'delete' ? 'راجعت البيانات الحالية وأريد حذفها' : kind === 'restore' ? 'راجعت البيانات الحالية وأريد استبدالها بالنسخة' : 'راجعت القيم الحالية وأريد استبدالها بإدخالي'}</button>`);
      }
    } else showFormError(error.message);
  } finally { form.dataset.saving = 'false'; if (success) closeModal(); else { submit.disabled = form.dataset.conflict === 'true'; submit.innerHTML = oldText; } }
}
function showFormError(message) { const error = $('#modal-error'); if (error) { error.textContent = message; error.hidden = false; error.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } else toast(message, 'error'); }
function openRestore() {
  showModal('استعادة نسخة احتياطية', `<div class="restore-warning">ستستبدل الاستعادة بيانات النشاط الحالية بالنسخة المختارة، مع الاحتفاظ بسجل التعديلات الحالي. سجل التعديلات داخل النسخة للتوثيق ولا يُستورد. نزّل نسخة من البيانات الحالية قبل المتابعة.</div><label class="field">ملف النسخة الاحتياطية<input type="file" id="restore-file" name="backupFile" accept="application/json,.json" required></label><div id="restore-preview" class="restore-preview" hidden></div><label class="field">كلمة مرور حساب المالك<input type="password" name="password" required autocomplete="current-password" dir="ltr"></label><label class="checkbox-row"><input type="checkbox" name="confirmRestore" required><span>راجعت النسخة وأوافق على استبدال البيانات الحالية بها.</span></label>`, `<button type="button" class="button ghost" data-action="close-modal">إلغاء</button><button type="submit" class="button danger">${icon('upload')}تأكيد الاستعادة</button>`, `data-kind="restore" data-revision="${state.revision}"`);
}
async function inspectBackup(file) {
  const form = $('#modal-form'); form.backupData = null;
  if (!file) return;
  try {
    if (file.size > 32 * 1024 * 1024) throw new Error('حجم الملف أكبر من الحد المسموح (32 ميغابايت).');
    const backup = JSON.parse(await file.text()), content = backup.state || backup.data || backup;
    if (!Array.isArray(content.products) || !Array.isArray(content.sales) || !Array.isArray(content.expenses) || !Array.isArray(content.payments)) throw new Error('الملف لا يحتوي على بنية نسخة احتياطية صالحة.');
    form.backupData = backup; const preview = $('#restore-preview'); preview.hidden = false; preview.innerHTML = `<strong>محتويات النسخة</strong><div class="backup-counts"><span>${number(content.products.length)} منتج</span><span>${number(content.sales.length)} عملية بيع</span><span>${number(content.expenses.length)} مصروف</span><span>${number(content.payments.length)} دفعة</span></div>${backup.exportedAt || backup.createdAt ? `<small>تاريخ النسخة: ${fullDate(backup.exportedAt || backup.createdAt)}</small>` : ''}`; $('#modal-error').hidden = true;
  } catch (error) { $('#restore-preview').hidden = true; showFormError(error.message || 'تعذر قراءة الملف. اختر نسخة JSON صالحة.'); }
}
function conflictDetails(record) {
  const labels = { productId:'المنتج المرتبط', saleId:'عملية البيع المرتبطة', name:'اسم المنتج', sku:'الرمز', category:'التصنيف', cost:'التكلفة', price:'السعر', initialStock:'المخزون المسجل', lowStock:'حد التنبيه', customer:'العميل', quantity:'الكمية', unitPrice:'سعر الوحدة', unitCost:'تكلفة الوحدة', date:'التاريخ', notes:'الملاحظات', amount:'المبلغ', method:'طريقة الدفع', title:'العنوان', capital:'رأس المال', currency:'العملة', products:'عدد المنتجات', sales:'عدد المبيعات', expenses:'عدد المصروفات', payments:'عدد الدفعات' };
  return `<div class="conflict-details"><strong>القيم المحفوظة حاليًا على الخادم</strong><dl>${Object.entries(record).filter(([key]) => labels[key]).map(([key,value]) => `<div><dt>${labels[key]}</dt><dd>${esc(key === 'productId' ? productName(value) : key === 'saleId' ? (() => { const sale = byId('sales',value); return sale ? `${sale.customer || 'عميل نقدي'} · ${productName(sale.productId)} · ${dateLabel(sale.date)}` : value; })() : value ?? '—')}</dd></div>`).join('')}</dl></div>`;
}
async function saveSettings(form) {
  if (form.dataset.conflict === 'true') return;
  form.dataset.requestKey ||= requestKey(); form.dataset.dirty = 'true';
  const button = $('button[type="submit"]', form), values = Object.fromEntries(new FormData(form)), errorBox = $('.form-error', form); button.disabled = true; errorBox.hidden = true;
  try { const next = await api('/settings', { method: 'PUT', headers: { 'Idempotency-Key': form.dataset.requestKey }, body: { capital: Number(values.capital), currency: values.currency, expectedRevision: Number(form.dataset.revision) } }); form.dataset.dirty = 'false'; if (!applyState(next)) await refresh(); toast('تم حفظ الإعدادات وتحديث الحسابات بنجاح.'); }
  catch (error) {
    if (error.status === 409) {
      await refresh({ silent: true });
      const currentForm = $('#settings-form');
      if (currentForm) {
        currentForm.dataset.conflict = 'true'; currentForm.dataset.nextRevision = state.revision;
        const currentError = $('.form-error', currentForm); currentError.hidden = false;
        currentError.innerHTML = `${esc(error.message)} احتفظنا بإدخالك للمراجعة.${conflictDetails(state.settings)}<button type="button" class="button secondary small" data-action="accept-settings-conflict">راجعت القيم الحالية وأريد استبدالها بإدخالي</button>`;
        $('button[type="submit"]', currentForm).disabled = true;
      }
    } else { errorBox.textContent = error.message; errorBox.hidden = false; }
  } finally { if (button.isConnected) button.disabled = form.dataset.conflict === 'true'; }
}
function downloadBlob(blob, filename) { const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
async function downloadBackup(button) {
  button.disabled = true;
  try { const response = await fetch('/api/backup', { credentials: 'same-origin', headers: { 'X-CSRF-Token': csrfToken } }); if (!response.ok) throw new Error('تعذر تنزيل النسخة الاحتياطية. أعد المحاولة.'); const blob = await response.blob(); downloadBlob(blob, `irth-al-tayeb-backup-${todayDubai()}.json`); toast('تم تجهيز النسخة الاحتياطية للتنزيل.'); }
  catch (error) { toast(error.message, 'error'); } finally { button.disabled = false; }
}
function csvExport() {
  const stats = data(), rows = [['إرث الطيب', 'التقرير المالي', reportRangeLabel()], ['المؤشر', 'القيمة', 'العملة'], ['المبيعات', stats.sales, state.settings.currency], ['تكلفة البضاعة', stats.costOfGoods, state.settings.currency], ['المصروفات', stats.expenses, state.settings.currency], ['صافي الربح', stats.netProfit, state.settings.currency], ['المستحق حاليًا لجميع الفترات', stats.outstanding, state.settings.currency], [], ['النوع', 'التاريخ', 'الوصف', 'العميل', 'الكمية', 'المبلغ'], ...stats.filteredSales.map(sale => ['بيع', sale.date, productName(sale.productId), sale.customer || '', sale.quantity, totalSale(sale)]), ...stats.filteredExpenses.map(expense => ['مصروف', expense.date, expense.title, '', '', expense.amount]), ...stats.filteredPayments.map(payment => ['دفعة', payment.date, payment.method || '', byId('sales', payment.saleId)?.customer || '', '', payment.amount])];
  const safeCell = value => { const text = String(value ?? ''); return `"${(/^[=+@\-\t\r]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`; };
  downloadBlob(new Blob(['\uFEFF', rows.map(row => row.map(safeCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8;' }), `irth-al-tayeb-report-${todayDubai()}.csv`); toast('تم تجهيز التقرير للتنزيل.');
}
function navigate(next) { if (!pageNames[next]) return; page = next; search = ''; history.replaceState(null, '', `#${page}`); document.body.classList.remove('menu-open'); renderPage(); window.scrollTo({ top: 0, behavior: 'instant' }); }

document.addEventListener('click', async event => {
  const target = event.target.closest('[data-action],a[data-page]'); if (!target) return;
  if (target.matches('a[data-page]')) { event.preventDefault(); navigate(target.dataset.page); return; }
  const { action, entity, id } = target.dataset;
  switch (action) {
    case 'navigate': navigate(target.dataset.page); break;
    case 'menu': document.body.classList.add('menu-open'); break;
    case 'close-menu': document.body.classList.remove('menu-open'); break;
    case 'close-modal': closeModal(); break;
    case 'review-saved-operation': closeModal(); navigate('audit'); break;
    case 'accept-conflict': { const form = $('#modal-form'); if (!form) break; form.dataset.version = form.dataset.nextVersion; form.dataset.revision = form.dataset.nextRevision; form.dataset.conflict = 'false'; delete form.dataset.requestKey; $('button[type="submit"]', form).disabled = false; target.disabled = true; target.textContent = 'تمت المراجعة. اضغط زر التأكيد لإتمام العملية.'; break; }
    case 'accept-settings-conflict': { const form = $('#settings-form'); if (!form) break; form.dataset.revision = form.dataset.nextRevision; form.dataset.conflict = 'false'; delete form.dataset.requestKey; $('button[type="submit"]', form).disabled = false; target.disabled = true; target.textContent = 'تمت المراجعة. اضغط حفظ الإعدادات للمتابعة.'; break; }
    case 'add': openEditor(entity); break;
    case 'edit': openEditor(entity, id); break;
    case 'delete': confirmDelete(entity, id); break;
    case 'pay-sale': openEditor('payments', '', id); break;
    case 'period': period = target.dataset.period; renderPage(); break;
    case 'refresh': target.disabled = true; await refresh(); if (target.isConnected) target.disabled = false; break;
    case 'alerts': showModal('تنبيهات أعمالك', alertsContent(data()), '<button type="button" class="button primary" data-action="close-modal">تم</button>'); break;
    case 'print': window.print(); break;
    case 'csv': csvExport(); break;
    case 'backup': await downloadBackup(target); break;
    case 'restore': openRestore(); break;
    case 'logout': try { await api('/logout', { method: 'POST', body: {} }); user = null; state = null; csrfToken = ''; stopSync(); closeModal(); renderAuth(); } catch (error) { toast(error.message, 'error'); } break;
  }
});
document.addEventListener('submit', event => { if (event.target.id === 'modal-form') submitModal(event); if (event.target.id === 'settings-form') { event.preventDefault(); saveSettings(event.target); } });
document.addEventListener('input', event => { if (event.target.closest('#settings-form')) event.target.closest('#settings-form').dataset.dirty = 'true'; if (event.target.id === 'table-search') { search = event.target.value; renderPage(); } if (['form-quantity','form-unitPrice','form-unitCost'].includes(event.target.id)) updateSalePreview(); });
document.addEventListener('change', event => {
  if (event.target.closest('#settings-form')) event.target.closest('#settings-form').dataset.dirty = 'true';
  if (event.target.id === 'date-anchor' && event.target.value && event.target.checkValidity()) { anchor = event.target.value; renderPage(); }
  if (event.target.id === 'form-productId' && $('#modal-form')?.dataset.entity === 'sales') { const product = byId('products', event.target.value); if (product) { $('#form-unitPrice').value = product.price; $('#form-unitCost').value = product.cost; updateSalePreview(); } }
  if (event.target.id === 'form-saleId' && $('#modal-form')?.dataset.entity === 'payments' && !$('#modal-form').dataset.id) { const sale = byId('sales', event.target.value); if (sale) $('#form-amount').value = dueSale(sale).toFixed(2); }
  if (event.target.id === 'restore-file') inspectBackup(event.target.files[0]);
});
window.addEventListener('online', () => { if (user) { refresh({ silent: true }); startSync(); } });
window.addEventListener('offline', () => setOnline(false));
window.addEventListener('hashchange', () => { if (user) navigate(location.hash.slice(1)); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && user) refresh({ silent: true }); });

async function boot() {
  try {
    const status = await api('/status'); initialized = status.initialized; requiresSetupToken = Boolean(status.requiresSetupToken);
    if (!initialized) { renderAuth(); return; }
    const me = await api('/me'); user = me.user; csrfToken = me.csrfToken;
    state = normalizeState(await api('/state')); lastSynced = new Date().toISOString(); online = true;
    if (pageNames[location.hash.slice(1)]) page = location.hash.slice(1);
    renderShell(); startSync();
  } catch (error) { renderAuth(error.status === 401 ? '' : error.message); }
}
boot();

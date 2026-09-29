import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApp } from '../server.mjs';
import { calculate, periodBounds, todayDubai } from '../public/calculations.mjs';

const OWNER = { name: 'مالك الاختبار', email: 'owner@example.test', password: 'Safe-Test-Password-42!' };
const DATE = '2026-09-28';
const NOW = new Date(`${DATE}T12:00:00Z`);
const PRODUCT = { name: 'دخون إرث', sku: 'IRTH-001', category: 'دخون', cost: 40, price: 100, initialStock: 10, lowStock: 2 };

function session(base) {
  let cookie = '';
  let csrfToken = '';
  return {
    get csrfToken() { return csrfToken; },
    get cookie() { return cookie; },
    async request(method, path, body, options = {}) {
      const headers = { Origin: base, ...options.headers };
      if (cookie) headers.Cookie = cookie;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (csrfToken && options.csrf !== false) headers['X-CSRF-Token'] = csrfToken;
      const response = await fetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
      });
      const setCookies = response.headers.getSetCookie();
      if (setCookies.length) cookie = setCookies.map(item => item.split(';', 1)[0]).join('; ');
      const text = await response.text();
      let data;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      if (data?.csrfToken) csrfToken = data.csrfToken;
      if (options.status !== undefined) {
        assert.equal(response.status, options.status, `${method} ${path}: ${JSON.stringify(data)}`);
      }
      if (options.ok) assert.ok(response.ok, `${method} ${path}: HTTP ${response.status} ${JSON.stringify(data)}`);
      return { response, data };
    },
  };
}

async function fixture(t, { setup = true, product = true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'irth-integration-'));
  const dbPath = join(directory, 'test.sqlite');
  const context = { directory, dbPath };
  context.start = async () => {
    context.app = await createApp({ dbPath, port: 0, host: '127.0.0.1', publicOrigin: '', setupToken: '', cookieSecure: false });
    await context.app.start();
    context.base = `http://127.0.0.1:${context.app.server.address().port}`;
    context.client = session(context.base);
  };
  t.after(async () => {
    await context.app?.close();
    await rm(directory, { recursive: true, force: true });
  });
  await context.start();
  if (setup) {
    await context.client.request('POST', '/api/setup', { ...OWNER, capital: 1000, currency: 'AED' }, { ok: true });
    if (product) {
      const { data } = await context.client.request('POST', '/api/products', PRODUCT, { ok: true });
      context.product = data.products[0];
    }
  }
  context.state = async () => (await context.client.request('GET', '/api/state', undefined, { ok: true })).data;
  return context;
}

async function sale(context, overrides = {}) {
  return (await context.client.request('POST', '/api/sales', {
    productId: context.product.id, customer: 'عميل الاختبار', quantity: 2, unitPrice: 100,
    paid: 50, date: DATE, notes: 'بيع اختباري', ...overrides,
  }, { ok: true })).data;
}

async function expense(context, overrides = {}) {
  return (await context.client.request('POST', '/api/expenses', {
    title: 'تغليف', category: 'تشغيلية', amount: 20, date: DATE, notes: '', ...overrides,
  }, { ok: true })).data;
}

function totals(state, expected) {
  const actual = calculate(state, { period: 'all', anchor: DATE, now: NOW });
  for (const [key, value] of Object.entries(expected)) assert.equal(actual[key], value, key);
  assert.equal(actual.series.reduce((sum, day) => sum + day.sales, 0), actual.sales, 'report revenue equals transactions');
  assert.equal(actual.series.reduce((sum, day) => sum + day.netProfit, 0), actual.netProfit, 'report profit equals transactions');
  return actual;
}

function businessRows(rows) {
  return rows.map(({ version, updatedAt, ...row }) => row);
}

test('owner setup, authentication, CSRF protection, and logout enforce private access', async t => {
  const context = await fixture(t, { setup: false });
  const { client } = context;
  assert.equal((await client.request('GET', '/api/status', undefined, { ok: true })).data.initialized, false);
  await client.request('GET', '/api/state', undefined, { status: 401 });
  const setup = await client.request('POST', '/api/setup', { ...OWNER, capital: 1000, currency: 'AED' }, { ok: true });
  assert.equal(setup.data.user.email, OWNER.email);
  assert.ok(client.csrfToken);
  assert.match(setup.response.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(setup.response.headers.get('set-cookie'), /SameSite=Strict/i);
  assert.equal((await client.request('GET', '/api/status', undefined, { ok: true })).data.initialized, true);
  assert.equal((await client.request('GET', '/api/me', undefined, { ok: true })).data.user.email, OWNER.email);
  const repeatedSetup = await client.request('POST', '/api/setup', { ...OWNER, email: 'intruder@example.test' });
  assert.ok(repeatedSetup.response.status >= 400 && repeatedSetup.response.status < 500);
  await client.request('POST', '/api/products', PRODUCT, { csrf: false, status: 403 });
  await client.request('POST', '/api/products', PRODUCT, { headers: { Origin: 'https://untrusted.example.test' }, status: 403 });
  const anonymous = session(context.base);
  await anonymous.request('POST', '/api/login', { email: OWNER.email, password: 'wrong-password' }, { status: 401 });
  await anonymous.request('POST', '/api/login', OWNER, { ok: true });
  assert.equal((await anonymous.request('GET', '/api/me', undefined, { ok: true })).data.user.email, OWNER.email);
  await client.request('POST', '/api/logout', {}, { csrf: false, status: 403 });
  await client.request('POST', '/api/logout', {}, { ok: true });
  await client.request('GET', '/api/state', undefined, { status: 401 });
  await anonymous.request('GET', '/api/state', undefined, { ok: true });
});

test('sale and expense create, edit, and delete immediately recalculate stock, profit, capital, and reports', async t => {
  const context = await fixture(t);
  totals(await context.state(), { sales: 0, expenses: 0, netProfit: 0, stockUnits: 10, outstanding: 0, capitalRemaining: 1000 });
  let state = await sale(context);
  const saleId = state.sales[0].id;
  assert.equal(state.sales[0].unitCost, 40, 'cost snapshot comes from the saved product');
  totals(state, { sales: 200, costOfGoods: 80, netProfit: 120, profitMargin: 60, stockUnits: 8, outstanding: 150, capitalRemaining: 880 });
  assert.equal(state.payments.length, 1, 'initial payment is committed with the sale');
  state = await expense(context);
  const expenseId = state.expenses[0].id;
  let report = totals(state, { sales: 200, expenses: 20, netProfit: 100, stockUnits: 8, outstanding: 150, capitalRemaining: 900 });
  assert.deepEqual(report.daily, { sales: 200, expenses: 20, costOfGoods: 80, netProfit: 100, profitMargin: 50 });
  state = (await context.client.request('PUT', `/api/expenses/${expenseId}`, { ...state.expenses[0], amount: 30 }, { ok: true })).data;
  totals(state, { sales: 200, expenses: 30, netProfit: 90, stockUnits: 8, outstanding: 150 });
  state = (await context.client.request('PUT', `/api/sales/${saleId}`, { ...state.sales[0], quantity: 3 }, { ok: true })).data;
  totals(state, { sales: 300, expenses: 30, costOfGoods: 120, netProfit: 150, stockUnits: 7, outstanding: 250, capitalRemaining: 850 });
  state = (await context.client.request('DELETE', `/api/expenses/${expenseId}`, { version: state.expenses[0].version }, { ok: true })).data;
  totals(state, { sales: 300, expenses: 0, costOfGoods: 120, netProfit: 180, stockUnits: 7, outstanding: 250, capitalRemaining: 820 });
  state = (await context.client.request('DELETE', `/api/sales/${saleId}`, { version: state.sales[0].version }, { ok: true })).data;
  totals(state, { sales: 0, expenses: 0, costOfGoods: 0, netProfit: 0, stockUnits: 10, outstanding: 0, capitalRemaining: 1000 });
  assert.equal(state.payments.length, 0, 'sale deletion also removes its payments');
  assert.ok(state.audit.length >= 7, 'each successful mutation is recorded');
  for (const entry of state.audit) assert.ok(Number.isFinite(Date.parse(entry.at)), 'audit records include an exact timestamp');
  for (const entity of ['sales', 'expenses']) {
    const actions = new Set(state.audit.filter(entry => entry.entity === entity).map(entry => entry.action));
    for (const action of ['create', 'update', 'delete']) assert.ok(actions.has(action), `${entity} ${action} appears in the audit trail`);
  }
  assert.ok(state.revision >= 7);
  assert.ok(Number.isFinite(Date.parse(state.updatedAt)), 'last update is a real timestamp');
  const persisted = await context.state();
  assert.deepEqual(persisted, state, 'mutation response is the committed database state');
});

test('payment create, edit, and delete change outstanding without double counting revenue or profit', async t => {
  const context = await fixture(t);
  let state = await sale(context);
  const saleId = state.sales[0].id;
  state = (await context.client.request('POST', '/api/payments', { saleId, amount: 60, date: DATE, method: 'تحويل', notes: '' }, { ok: true })).data;
  const payment = state.payments.find(row => row.amount === 60);
  totals(state, { sales: 200, netProfit: 120, stockUnits: 8, outstanding: 90 });
  state = (await context.client.request('PUT', `/api/payments/${payment.id}`, { ...payment, amount: 80 }, { ok: true })).data;
  totals(state, { sales: 200, netProfit: 120, stockUnits: 8, outstanding: 70 });
  const currentPayment = state.payments.find(row => row.id === payment.id);
  state = (await context.client.request('DELETE', `/api/payments/${payment.id}`, { version: currentPayment.version }, { ok: true })).data;
  const report = totals(state, { sales: 200, netProfit: 120, stockUnits: 8, outstanding: 150 });
  assert.equal(report.unpaidSales[0].due, 150);
  assert.equal(report.saleBalances[0].paid, 50);
});

test('historical cost snapshots survive product edits and future sales use the new cost', async t => {
  const context = await fixture(t);
  let state = await sale(context);
  state = (await context.client.request('PUT', `/api/products/${context.product.id}`, { ...state.products[0], cost: 70, price: 150 }, { ok: true })).data;
  assert.equal(state.sales[0].unitCost, 40);
  totals(state, { sales: 200, costOfGoods: 80, netProfit: 120, stockUnits: 8 });
  state = await sale(context, { quantity: 1, unitPrice: 150, paid: 0 });
  assert.equal(state.sales.find(row => row.unitPrice === 150).unitCost, 70);
  totals(state, { sales: 350, costOfGoods: 150, netProfit: 200, stockUnits: 7, outstanding: 300 });
});

test('low-stock alerts follow live quantities and product changes cannot orphan historical sales', async t => {
  const context = await fixture(t);
  let state = await sale(context, { quantity: 8 });
  const report = totals(state, { sales: 800, costOfGoods: 320, netProfit: 480, stockUnits: 2, outstanding: 750 });
  assert.equal(report.lowStock.length, 1);
  assert.equal(report.lowStock[0].id, context.product.id);
  assert.equal(report.lowStock[0].remaining, 2);
  const invalidStock = await context.client.request('PUT', `/api/products/${context.product.id}`, { ...state.products[0], initialStock: 7 });
  assert.ok(invalidStock.response.status >= 400 && invalidStock.response.status < 500);
  assert.deepEqual(await context.state(), state);
  await context.client.request('DELETE', `/api/products/${context.product.id}`, { version: state.products[0].version }, { status: 409 });
  assert.deepEqual(await context.state(), state);
  state = (await context.client.request('POST', '/api/products', { ...PRODUCT, name: 'منتج إضافي', sku: 'IRTH-002', initialStock: 3 }, { ok: true })).data;
  totals(state, { sales: 800, netProfit: 480, stockUnits: 5 });
  const removable = state.products.find(row => row.sku === 'IRTH-002');
  state = (await context.client.request('DELETE', `/api/products/${removable.id}`, { version: removable.version }, { ok: true })).data;
  totals(state, { sales: 800, netProfit: 480, stockUnits: 2 });
});

test('overselling and stale edits fail atomically without changing stock, audit, or revision', async t => {
  const context = await fixture(t);
  let state = await sale(context);
  const previous = structuredClone(state);
  const oversell = await context.client.request('POST', '/api/sales', { productId: context.product.id, customer: '', quantity: 9, unitPrice: 100, paid: 50, date: DATE });
  assert.ok(oversell.response.status >= 400 && oversell.response.status < 500);
  assert.deepEqual(await context.state(), previous, 'rejected sale cannot leave a payment, audit event, or stock change');
  const overpaid = await context.client.request('POST', '/api/sales', { productId: context.product.id, customer: '', quantity: 1, unitPrice: 100, paid: 150, date: DATE });
  assert.ok(overpaid.response.status >= 400 && overpaid.response.status < 500);
  assert.deepEqual(await context.state(), previous, 'invalid initial payment rolls back the sale and audit already inserted inside the transaction');
  const oldSale = state.sales[0];
  const excessiveEdit = await context.client.request('PUT', `/api/sales/${oldSale.id}`, { ...oldSale, quantity: 11 });
  assert.ok(excessiveEdit.response.status >= 400 && excessiveEdit.response.status < 500);
  assert.deepEqual(await context.state(), previous);
  state = (await context.client.request('PUT', `/api/sales/${oldSale.id}`, { ...oldSale, quantity: 3 }, { ok: true })).data;
  await context.client.request('PUT', `/api/sales/${oldSale.id}`, { ...oldSale, quantity: 1 }, { status: 409 });
  assert.deepEqual(await context.state(), state);
  await context.client.request('DELETE', `/api/sales/${oldSale.id}`, { version: oldSale.version }, { status: 409 });
  assert.deepEqual(await context.state(), state);
  totals(state, { sales: 300, costOfGoods: 120, netProfit: 180, stockUnits: 7, outstanding: 250 });
});

test('automatic saves persist across application restarts', async t => {
  const context = await fixture(t);
  await sale(context);
  const state = await expense(context);
  await context.app.close();
  await context.start();
  await context.client.request('POST', '/api/login', OWNER, { ok: true });
  assert.deepEqual(await context.state(), state);
  totals(await context.state(), { sales: 200, expenses: 20, netProfit: 100, stockUnits: 8, outstanding: 150, capitalRemaining: 900 });
});

test('idempotent sale retries stay unique after later mutations and a database restart', async t => {
  const context = await fixture(t);
  const headers = { 'Idempotency-Key': '00000000-0000-4000-8000-000000000099' };
  const body = { productId: context.product.id, customer: 'عميل الاختبار', quantity: 2, unitPrice: 100, paid: 50, date: DATE };
  const first = (await context.client.request('POST', '/api/sales', body, { headers, ok: true })).data;
  assert.equal(first.sales.length, 1);
  assert.equal(first.payments.length, 1);
  const repeated = (await context.client.request('POST', '/api/sales', body, { headers, ok: true })).data;
  assert.deepEqual(repeated, first, 'same request creates no second sale, payment, audit entry, or revision');

  const latest = await expense(context);
  const reorderedBody = Object.fromEntries(Object.entries(body).reverse());
  const afterExpense = (await context.client.request('POST', '/api/sales', reorderedBody, { headers, ok: true })).data;
  assert.deepEqual(afterExpense, latest, 'replay returns current state and accepts equivalent JSON property order');
  const conflict = await context.client.request('POST', '/api/sales', { ...body, quantity: 3 }, { headers, status: 409 });
  assert.equal(conflict.data.code, 'IDEMPOTENCY_CONFLICT');
  assert.deepEqual(await context.state(), latest, 'a reused key with changed data cannot create another sale');

  await context.app.close();
  await context.start();
  await context.client.request('POST', '/api/login', OWNER, { ok: true });
  const afterRestart = (await context.client.request('POST', '/api/sales', body, { headers, ok: true })).data;
  assert.deepEqual(afterRestart, latest, 'deduplication survives the process and session restart');
  totals(afterRestart, { sales: 200, expenses: 20, netProfit: 100, stockUnits: 8, outstanding: 150, capitalRemaining: 900 });
});

test('backup export contains business data without credentials; restore requires password and is atomic', async t => {
  const context = await fixture(t);
  await sale(context);
  const backedState = await expense(context);
  const backup = (await context.client.request('GET', '/api/backup', undefined, { ok: true })).data;
  assert.equal(backup.schemaVersion, 1);
  assert.deepEqual(backup.products, backedState.products);
  assert.deepEqual(backup.sales, backedState.sales);
  assert.deepEqual(backup.payments, backedState.payments);
  for (const key of ['users', 'user', 'sessions', 'password', 'passwordHash', 'password_hash', 'csrfToken']) assert.equal(Object.hasOwn(backup, key), false, key);
  assert.equal(JSON.stringify(backup).includes(OWNER.password), false);
  let state = await expense(context, { title: 'عملية بعد النسخة', amount: 35 });
  const wrongPassword = await context.client.request('POST', '/api/restore', { backup, password: 'wrong-password', expectedRevision: state.revision });
  assert.ok(wrongPassword.response.status === 401 || wrongPassword.response.status === 403);
  assert.deepEqual(await context.state(), state);
  const invalidBackup = structuredClone(backup);
  invalidBackup.sales[0].productId = '00000000-0000-4000-8000-000000000001';
  const invalid = await context.client.request('POST', '/api/restore', { backup: invalidBackup, password: OWNER.password, expectedRevision: state.revision });
  assert.ok(invalid.response.status >= 400 && invalid.response.status < 500);
  assert.deepEqual(await context.state(), state, 'invalid restore cannot partially replace the database');
  await context.client.request('POST', '/api/restore', { backup, password: OWNER.password, expectedRevision: state.revision - 1 }, { status: 409 });
  assert.deepEqual(await context.state(), state);
  state = (await context.client.request('POST', '/api/restore', { backup, password: OWNER.password, expectedRevision: state.revision }, { ok: true })).data;
  for (const collection of ['products', 'sales', 'expenses', 'payments']) {
    assert.deepEqual(businessRows(state[collection]), businessRows(backedState[collection]));
  }
  assert.ok(state.sales[0].version > backedState.sales[0].version, 'restore invalidates stale forms open on other devices');
  assert.ok(state.revision > backedState.revision, 'restore publishes a new revision');
  totals(state, { sales: 200, expenses: 20, netProfit: 100, stockUnits: 8, outstanding: 150, capitalRemaining: 900 });
  const fresh = session(context.base);
  await fresh.request('POST', '/api/login', OWNER, { ok: true });
});

test('a second signed-in device receives a live event and sees the committed mutation', async t => {
  const controller = new AbortController();
  t.after(() => controller.abort());
  const context = await fixture(t);
  const second = session(context.base);
  await second.request('POST', '/api/login', OWNER, { ok: true });
  let reader;
  t.after(async () => {
    controller.abort();
    try { await reader?.cancel(); } catch {}
  });
  const response = await fetch(`${context.base}/api/events`, { headers: { Cookie: second.cookie, Accept: 'text/event-stream' }, signal: controller.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  reader = response.body.getReader();
  await nextSseEvent(reader, /event:\s*revision/);
  const event = nextSseEvent(reader, /event:\s*revision/);
  const state = await sale(context);
  const eventText = await event;
  const revision = eventText.split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5).trim())).find(data => data.revision === state.revision);
  assert.ok(revision, `event contains committed revision ${state.revision}`);
  const secondState = (await second.request('GET', '/api/state', undefined, { ok: true })).data;
  assert.deepEqual(secondState, state);
  totals(secondState, { sales: 200, netProfit: 120, stockUnits: 8, outstanding: 150 });
  controller.abort();
  try { await reader.cancel(); } catch {}
});

test('restoring a deleted record cannot reuse the version of a stale edit form', async t => {
  const context = await fixture(t);
  let state = await sale(context);
  const backup = (await context.client.request('GET', '/api/backup', undefined, { ok: true })).data;
  state = (await context.client.request('PUT', `/api/sales/${state.sales[0].id}`, { ...state.sales[0], quantity: 3 }, { ok: true })).data;
  const staleSale = structuredClone(state.sales[0]);
  state = (await context.client.request('DELETE', `/api/sales/${staleSale.id}`, { version: staleSale.version }, { ok: true })).data;
  state = (await context.client.request('POST', '/api/restore', { backup, password: OWNER.password, expectedRevision: state.revision }, { ok: true })).data;
  assert.ok(state.sales[0].version > staleSale.version, 'restored version must exceed deleted record versions');
  await context.client.request('PUT', `/api/sales/${staleSale.id}`, { ...staleSale, quantity: 5 }, { status: 409 });
  assert.deepEqual(await context.state(), state);
  totals(state, { sales: 200, netProfit: 120, stockUnits: 8, outstanding: 150 });
});

test('calendar filters include correct Dubai days, Monday weeks, leap months, and years', () => {
  assert.equal(todayDubai(new Date('2026-09-28T20:01:00Z')), '2026-09-29');
  assert.deepEqual(periodBounds('day', '2024-02-29'), { start: '2024-02-29', end: '2024-02-29' });
  assert.deepEqual(periodBounds('week', '2026-01-01'), { start: '2025-12-29', end: '2026-01-04' });
  assert.deepEqual(periodBounds('month', '2024-02-29'), { start: '2024-02-01', end: '2024-02-29' });
  assert.deepEqual(periodBounds('month', '2026-02-01'), { start: '2026-02-01', end: '2026-02-28' });
  assert.deepEqual(periodBounds('year', '2026-09-28'), { start: '2026-01-01', end: '2026-12-31' });
  assert.throws(() => periodBounds('month', '2026-02-29'));
  const dates = ['2025-12-28', '2025-12-29', '2026-01-01', '2026-01-04', '2026-01-05', '2026-02-01', '2027-01-01'];
  const state = {
    settings: { capital: 1000 }, products: [{ ...PRODUCT, id: 'p', initialStock: 20 }],
    sales: dates.map((date, i) => ({ id: `s${i}`, productId: 'p', quantity: 1, unitPrice: 100, unitCost: 40, date })),
    expenses: dates.map((date, i) => ({ id: `e${i}`, amount: 10, date })),
    payments: [{ id: 'pay', saleId: 's0', amount: 100, date: '2026-01-01' }],
  };
  for (const [period, count] of [['day', 1], ['week', 3], ['month', 3], ['year', 4], ['all', 7]]) {
    const report = calculate(state, { period, anchor: '2026-01-01', now: new Date('2026-01-01T12:00:00Z') });
    assert.equal(report.sales, count * 100, `${period} sales`);
    assert.equal(report.expenses, count * 10, `${period} expenses`);
    assert.equal(report.netProfit, count * 50, `${period} profit`);
    assert.equal(report.stockUnits, 13, 'inventory is lifetime even when report is filtered');
    assert.equal(report.outstanding, 600, 'outstanding is lifetime even when report is filtered');
    assert.equal(report.capitalRemaining, 650, 'capital recovery is lifetime even when report is filtered');
    assert.equal(report.series.reduce((sum, row) => sum + row.sales, 0), report.sales);
    assert.equal(report.series.reduce((sum, row) => sum + row.netProfit, 0), report.netProfit);
    assert.equal(report.daily.netProfit, 50);
  }
});

test('currency calculations use minor units and reconcile graph and product totals', () => {
  const state = {
    settings: { capital: 1 }, products: [{ ...PRODUCT, id: 'p' }],
    sales: [{ id: 's', productId: 'p', quantity: 3, unitPrice: 0.1, unitCost: 0.03, date: DATE }],
    expenses: [{ id: 'e', amount: 0.07, date: DATE }],
    payments: [{ id: 'pay1', saleId: 's', amount: 0.1, date: DATE }, { id: 'pay2', saleId: 's', amount: 0.1, date: DATE }],
  };
  const report = totals(state, { sales: 0.3, costOfGoods: 0.09, expenses: 0.07, netProfit: 0.14, outstanding: 0.1, capitalRemaining: 0.86 });
  assert.equal(report.productPerformance[0].revenue, 0.3);
  assert.equal(report.productPerformance[0].profit, 0.21);
  assert.equal(report.saleBalances[0].paid, 0.2);
});

async function nextSseEvent(reader, pattern, timeout = 4000) {
  let timer;
  const read = async () => {
    let text = '';
    const decoder = new TextDecoder();
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error('SSE stream ended before receiving the expected event');
      text += decoder.decode(chunk.value, { stream: true });
      if (pattern.test(text)) return text;
    }
  };
  try {
    return await Promise.race([
      read(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('SSE event timed out')), timeout); }),
    ]);
  } finally { clearTimeout(timer); }
}

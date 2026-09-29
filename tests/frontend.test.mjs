import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { test } from 'node:test';
import vm from 'node:vm';
import { calculate, todayDubai } from '../public/calculations.mjs';

// These are focused JavaScript regression tests, not browser or layout tests.
// The application's own functions execute unchanged; only browser boundaries are
// replaced with a tiny DOM, controlled HTTP responses, and an EventSource double.
async function loadApp(fetchImpl, cryptoImpl = webcrypto) {
  const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8'))
    .replace(/^import \{ calculate, todayDubai \} from '\.\/calculations\.mjs';\s*/, '')
    .replace(/\nboot\(\);\s*$/, '\n');
  const nodes = new Map();
  const listeners = new Map();
  const streams = [];
  const document = {
    hidden: false,
    activeElement: null,
    querySelector(selector) { return nodes.get(selector) ?? null; },
    addEventListener(type, handler) { listeners.set(type, handler); },
    createElement() { return { innerHTML: '', className: '', remove() {} }; },
    body: { classList: { add() {}, remove() {} }, append() {} },
  };
  nodes.set('#toast-stack', { append() {} });
  nodes.set('#modal-root', { innerHTML: '' });
  nodes.set('#modal-error', { hidden: true, textContent: '', innerHTML: '', scrollIntoView() {}, insertAdjacentHTML(_position, html) { this.innerHTML += html; } });
  class EventSource {
    constructor(url) { this.url = url; this.listeners = new Map(); streams.push(this); }
    addEventListener(type, handler) { this.listeners.set(type, handler); }
    emitRevision(revision) { this.listeners.get('revision')?.({ data: JSON.stringify({ revision }) }); }
    close() { this.closed = true; }
  }
  class FormData {
    constructor(form) { this.values = Object.entries(form.values ?? {}); }
    [Symbol.iterator]() { return this.values[Symbol.iterator](); }
  }
  const context = vm.createContext({
    calculate, todayDubai, document, EventSource, FormData, fetch: fetchImpl, crypto: cryptoImpl,
    window: { addEventListener() {} },
    setInterval() { return 1; }, clearInterval() {},
    setTimeout() { return 1; }, clearTimeout() {},
  });
  vm.runInContext(`${source}\n;globalThis.__testApp = {
    refresh, startSync, stopSync, applyState, submitModal, requestKey,
    state: () => state,
    pendingRefresh: () => refreshPromise,
    seed(value) { state = value; user = { name: 'Test owner' }; },
  };`, context, { filename: 'public/app.js' });
  return { app: context.__testApp, nodes, listeners, streams };
}

function response(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return data; } };
}

function snapshot(revision, products = []) {
  return { revision, updatedAt: '2026-09-28T12:00:00.000Z', settings: { capital: 1000, currency: 'AED' }, products, sales: [], expenses: [], payments: [], audit: [] };
}

test('a newer SSE revision arriving during an older state request triggers a follow-up fetch', async () => {
  const requests = [];
  const { app, streams } = await loadApp((url, options) => new Promise(resolve => { requests.push({ url, options, resolve }); }));
  app.seed(snapshot(9));
  app.startSync();
  streams[0].emitRevision(10);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/state');
  const refreshing = app.pendingRefresh();

  streams[0].emitRevision(11);
  assert.equal(requests.length, 1, 'live events coalesce while the original request is in flight');
  requests[0].resolve(response(snapshot(10)));
  await nextTurn();
  assert.equal(requests.length, 2, 'the newer revision cannot be dropped when the first request completes');
  assert.equal(requests[1].url, '/api/state');
  requests[1].resolve(response(snapshot(11)));
  await refreshing;
  assert.equal(app.state().revision, 11);
  assert.equal(app.pendingRefresh(), null);
  app.stopSync();
  assert.equal(streams[0].closed, true);
});

test('a stale edit stays blocked until the user explicitly reviews current values and accepts replacement', async () => {
  const product = { id: 'p1', version: 1, name: 'دخون', sku: 'P1', category: 'دخون', cost: 40, price: 100, initialStock: 10, lowStock: 2 };
  const currentProduct = { ...product, version: 2, cost: 70 };
  const requests = [];
  let writes = 0;
  const { app, nodes, listeners } = await loadApp(async (url, options) => {
    requests.push({ url, options });
    if (url === '/api/state') return response(snapshot(2, [currentProduct]));
    assert.equal(url, '/api/products/p1');
    assert.equal(options.method, 'PUT');
    writes += 1;
    if (writes === 1) return response({ error: 'تغير المنتج على جهاز آخر.' }, 409);
    const body = JSON.parse(options.body);
    return response(snapshot(3, [{ ...currentProduct, ...body, version: 3 }]));
  });
  app.seed(snapshot(1, [product]));
  const submitButton = { innerHTML: 'حفظ', textContent: '', disabled: false };
  const form = {
    dataset: { kind: 'editor', entity: 'products', id: 'p1', version: '1' },
    values: { name: 'دخون', sku: 'P1', category: 'دخون', cost: '40', price: '110', initialStock: '10', lowStock: '2' },
    querySelector(selector) { return selector === 'button[type="submit"]' ? submitButton : null; },
  };
  nodes.set('#modal-form', form);
  const event = { target: form, preventDefault() {} };
  await app.submitModal(event);

  assert.equal(writes, 1);
  assert.equal(app.state().products[0].cost, 70, 'fresh state includes the other device’s cost edit');
  assert.equal(Number(form.dataset.version), 1, 'the stale form version is not silently rebased');
  assert.equal(form.values.cost, '40', 'local input remains available for explicit review');
  assert.equal(submitButton.disabled, true);
  assert.match(nodes.get('#modal-error').innerHTML, /التكلفة/);
  assert.match(nodes.get('#modal-error').innerHTML, /<dd>70<\/dd>/, 'the current saved cost is shown for review');
  await app.submitModal(event);
  assert.equal(writes, 1, 'even a directly dispatched repeat submit cannot overwrite current data');

  const accept = { dataset: { action: 'accept-conflict' }, matches() { return false; }, closest() { return this; } };
  const beforeReview = requests.length;
  await listeners.get('click')({ target: accept, preventDefault() {} });
  assert.equal(requests.length, beforeReview, 'accepting the review does not itself save a mutation');
  assert.equal(Number(form.dataset.version), 2);
  assert.equal(submitButton.disabled, false);
  await app.submitModal(event);
  assert.equal(writes, 2);
  const sent = JSON.parse(requests.at(-1).options.body);
  assert.equal(sent.version, 2);
  assert.equal(sent.cost, 40, 'replacement occurs only after review and a separate save action');
  assert.equal(app.state().revision, 3);
});

test('LAN browsers without crypto.randomUUID generate server-compatible idempotency keys', async () => {
  const cryptoWithoutRandomUUID = { getRandomValues(array) { return webcrypto.getRandomValues(array); } };
  const { app } = await loadApp(() => assert.fail('generating a request key must not require the network'), cryptoWithoutRandomUUID);
  const first = app.requestKey();
  const second = app.requestKey();
  const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  assert.match(first, uuidV4);
  assert.match(second, uuidV4);
  assert.notEqual(first, second);
});

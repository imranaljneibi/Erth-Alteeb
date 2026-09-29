import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as validate from './validation.mjs';

export const TABLES = ['products', 'sales', 'expenses', 'payments'];
const LABELS = { products: 'المنتج', sales: 'عملية البيع', expenses: 'المصروف', payments: 'الدفعة' };
const COLUMNS = {
  products: ['name', 'sku', 'category', 'costCents', 'priceCents', 'initialStock', 'lowStock'],
  sales: ['productId', 'customer', 'quantity', 'unitPriceCents', 'unitCostCents', 'date', 'notes'],
  expenses: ['title', 'category', 'amountCents', 'date', 'notes'],
  payments: ['saleId', 'amountCents', 'date', 'method', 'notes'],
};

export function serialize(row) {
  if (!row) return null;
  const out = { ...row };
  for (const key of ['costCents', 'priceCents', 'unitPriceCents', 'unitCostCents', 'amountCents', 'capitalCents']) {
    if (key in out) {
      out[key.replace('Cents', '')] = out[key] / 100;
      delete out[key];
    }
  }
  return out;
}

export class Store {
  constructor(dbPath) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(dbPath, { timeout: 5000 });
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS owner (
        id INTEGER PRIMARY KEY CHECK(id=1), name TEXT NOT NULL, email TEXT NOT NULL,
        passwordHash TEXT NOT NULL, createdAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        tokenHash TEXT PRIMARY KEY, csrfToken TEXT NOT NULL,
        createdAt TEXT NOT NULL, expiresAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK(id=1), capitalCents INTEGER NOT NULL CHECK(capitalCents>=0),
        currency TEXT NOT NULL, timeZone TEXT NOT NULL DEFAULT 'Asia/Dubai',
        revision INTEGER NOT NULL DEFAULT 0, updatedAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, sku TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '',
        costCents INTEGER NOT NULL CHECK(costCents>=0), priceCents INTEGER NOT NULL CHECK(priceCents>=0),
        initialStock INTEGER NOT NULL CHECK(initialStock>=0), lowStock INTEGER NOT NULL CHECK(lowStock>=0),
        version INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS unique_product_sku ON products(lower(sku)) WHERE sku <> '';
      CREATE TABLE IF NOT EXISTS sales (
        id TEXT PRIMARY KEY, productId TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        customer TEXT NOT NULL DEFAULT '', quantity INTEGER NOT NULL CHECK(quantity>0),
        unitPriceCents INTEGER NOT NULL CHECK(unitPriceCents>=0), unitCostCents INTEGER NOT NULL CHECK(unitCostCents>=0),
        date TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sales_product_idx ON sales(productId);
      CREATE INDEX IF NOT EXISTS sales_date_idx ON sales(date);
      CREATE TABLE IF NOT EXISTS expenses (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL DEFAULT '',
        amountCents INTEGER NOT NULL CHECK(amountCents>0), date TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
        version INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS expenses_date_idx ON expenses(date);
      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY, saleId TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
        amountCents INTEGER NOT NULL CHECK(amountCents>0), date TEXT NOT NULL,
        method TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS payments_sale_idx ON payments(saleId);
      CREATE TABLE IF NOT EXISTS audit (
        id TEXT PRIMARY KEY, action TEXT NOT NULL, entity TEXT NOT NULL, entityId TEXT NOT NULL,
        description TEXT NOT NULL, at TEXT NOT NULL, beforeJson TEXT, afterJson TEXT
      );
      CREATE INDEX IF NOT EXISTS audit_at_idx ON audit(at);
      CREATE TABLE IF NOT EXISTS idempotency_requests (
        key TEXT PRIMARY KEY, requestHash TEXT NOT NULL, createdAt TEXT NOT NULL
      );
      PRAGMA user_version = 1;
    `);
  }

  initialized() { return Boolean(this.db.prepare('SELECT id FROM owner WHERE id=1').get()); }
  owner() { return this.db.prepare('SELECT * FROM owner WHERE id=1').get(); }

  transaction(callback, { bump = true, request } = {}) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (request) {
        const previous = this.db.prepare('SELECT requestHash FROM idempotency_requests WHERE key=?').get(request.key);
        if (previous) {
          if (previous.requestHash !== request.hash) {
            validate.fail('استُخدم معرّف الحفظ نفسه لعملية مختلفة. تحقّق من العملية ثم أعد المحاولة بمعرّف جديد.', 409, 'IDEMPOTENCY_CONFLICT');
          }
          this.db.exec('COMMIT');
          return { replayed: true };
        }
      }
      const result = callback();
      if (bump) this.db.prepare('UPDATE settings SET revision=revision+1, updatedAt=? WHERE id=1').run(new Date().toISOString());
      if (request) {
        this.db.prepare('INSERT INTO idempotency_requests (key,requestHash,createdAt) VALUES (?,?,?)').run(request.key, request.hash, new Date().toISOString());
      }
      this.db.exec('COMMIT');
      return { replayed: false, value: result };
    } catch (error) {
      this.db.exec('ROLLBACK');
      if (error.code?.startsWith('ERR_SQLITE') && /UNIQUE constraint failed: index 'unique_product_sku'|UNIQUE constraint failed: products\.sku/i.test(error.message)) {
        validate.fail('رمز المنتج مستخدم بالفعل. اختر رمزاً مختلفاً.', 409, 'DUPLICATE_SKU');
      }
      throw error;
    }
  }

  initialize({ name, email, passwordHash, settings }) {
    return this.transaction(() => {
      if (this.initialized()) validate.fail('تم إعداد الحساب بالفعل. استخدم تسجيل الدخول.', 409, 'ALREADY_INITIALIZED');
      const now = new Date().toISOString();
      this.db.prepare('INSERT INTO owner (id,name,email,passwordHash,createdAt) VALUES (1,?,?,?,?)').run(name, email, passwordHash, now);
      this.db.prepare('INSERT INTO settings (id,capitalCents,currency,timeZone,revision,updatedAt) VALUES (1,?,?,?,0,?)').run(settings.capitalCents, settings.currency, settings.timeZone, now);
      this.audit('setup', 'settings', 'settings', 'إنشاء الحساب وإعداد رأس المال والعملة', null, { capital: settings.capitalCents / 100, currency: settings.currency, timeZone: settings.timeZone });
    });
  }

  meta() {
    const row = this.db.prepare('SELECT revision, updatedAt FROM settings WHERE id=1').get();
    return row ? { ...row } : { revision: 0, updatedAt: null };
  }

  settings() {
    const row = this.db.prepare('SELECT capitalCents,currency,timeZone FROM settings WHERE id=1').get();
    return serialize(row);
  }

  state() {
    const state = { ...this.meta(), settings: this.settings() };
    for (const table of TABLES) state[table] = this.db.prepare(`SELECT * FROM ${table} ORDER BY createdAt DESC,id`).all().map(serialize);
    state.audit = this.db.prepare('SELECT * FROM audit ORDER BY at DESC,rowid DESC').all().map(row => ({
      id: row.id, action: row.action, entity: row.entity, entityId: row.entityId,
      description: row.description, at: row.at,
      before: row.beforeJson ? JSON.parse(row.beforeJson) : null,
      after: row.afterJson ? JSON.parse(row.afterJson) : null,
    }));
    return state;
  }

  audit(action, entity, entityId, description, before, after) {
    this.db.prepare('INSERT INTO audit (id,action,entity,entityId,description,at,beforeJson,afterJson) VALUES (?,?,?,?,?,?,?,?)').run(
      randomUUID(), action, entity, entityId, description, new Date().toISOString(),
      before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null,
    );
  }

  get(table, id) {
    if (!TABLES.includes(table)) validate.fail('نوع السجل غير صالح.');
    return this.db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
  }

  require(table, id) {
    const row = this.get(table, id);
    if (!row) validate.fail(`${LABELS[table]} غير موجود. ربما تم حذفه من جهاز آخر.`, 404, 'NOT_FOUND');
    return row;
  }

  checkVersion(row, inputVersion) {
    validate.version(inputVersion);
    if (row.version !== inputVersion) validate.fail('عُدّل هذا السجل من جهاز آخر. حدّث البيانات ثم حاول مجدداً.', 409, 'CONFLICT');
  }

  checkRevision(expected) {
    validate.integer(expected, 'نسخة البيانات', { min: 0, max: Number.MAX_SAFE_INTEGER - 1 });
    if (this.meta().revision !== expected) validate.fail('تغيّرت البيانات أثناء العملية. حدّث البيانات ثم حاول مجدداً.', 409, 'CONFLICT');
  }

  sold(productId, excludedSale = '') {
    return this.db.prepare('SELECT COALESCE(SUM(quantity),0) AS count FROM sales WHERE productId=? AND id<>?').get(productId, excludedSale).count;
  }

  paid(saleId, excludedPayment = '') {
    return this.db.prepare('SELECT COALESCE(SUM(amountCents),0) AS amount FROM payments WHERE saleId=? AND id<>?').get(saleId, excludedPayment).amount;
  }

  insert(table, data, { preserveMetadata = false } = {}) {
    const now = new Date().toISOString();
    const row = preserveMetadata ? data : { ...data, id: randomUUID(), version: 1, createdAt: now, updatedAt: now };
    const cols = ['id', ...COLUMNS[table], 'version', 'createdAt', 'updatedAt'];
    this.db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map(key => row[key]));
    return this.get(table, row.id);
  }

  update(table, before, data) {
    const cols = COLUMNS[table];
    this.db.prepare(`UPDATE ${table} SET ${cols.map(key => `${key}=?`).join(',')},version=version+1,updatedAt=? WHERE id=?`).run(...cols.map(key => data[key]), new Date().toISOString(), before.id);
    return this.get(table, before.id);
  }

  validateRecord(table, input, previous) {
    if (table === 'products') {
      const row = validate.product(input);
      if (previous && row.initialStock < this.sold(previous.id)) validate.fail('لا يمكن خفض إجمالي المخزون دون الكميات المباعة.');
      if (row.sku) {
        const duplicate = this.db.prepare('SELECT id FROM products WHERE lower(sku)=lower(?) AND id<>?').get(row.sku, previous?.id ?? '');
        if (duplicate) validate.fail('رمز المنتج مستخدم بالفعل.', 409, 'DUPLICATE_SKU');
      }
      return row;
    }
    if (table === 'sales') {
      const relatedProduct = this.require('products', validate.identifier(input.productId, 'معرّف المنتج'));
      const defaultCost = previous?.productId === relatedProduct.id ? previous.unitCostCents : relatedProduct.costCents;
      const row = validate.sale(input, { defaultCost });
      if (this.sold(relatedProduct.id, previous?.id) + row.quantity > relatedProduct.initialStock) validate.fail('الكمية المطلوبة تتجاوز المخزون المتاح.', 409, 'INSUFFICIENT_STOCK');
      if (previous && this.paid(previous.id) > row.quantity * row.unitPriceCents) validate.fail('قيمة البيع الجديدة أقل من مجموع الدفعات. عدّل الدفعات أولاً.', 409, 'OVERPAYMENT');
      return row;
    }
    if (table === 'expenses') return validate.expense(input);
    const row = validate.payment(input);
    const relatedSale = this.require('sales', row.saleId);
    if (this.paid(row.saleId, previous?.id) + row.amountCents > relatedSale.quantity * relatedSale.unitPriceCents) validate.fail('قيمة الدفعة تتجاوز المبلغ المستحق.', 409, 'OVERPAYMENT');
    return row;
  }

  mutate(table, method, id, input, request) {
    validate.object(input);
    return this.transaction(() => {
      let before;
      if (method !== 'POST') {
        validate.identifier(id);
        before = this.require(table, id);
        this.checkVersion(before, input.version);
      }
      if (method === 'DELETE') {
        if (table === 'products' && this.db.prepare('SELECT 1 FROM sales WHERE productId=? LIMIT 1').get(id)) {
          validate.fail('لا يمكن حذف منتج مرتبط بمبيعات. احذف المبيعات المرتبطة أولاً.', 409, 'REFERENCED_PRODUCT');
        }
        if (table === 'sales') {
          const payments = this.db.prepare('SELECT * FROM payments WHERE saleId=?').all(id);
          for (const payment of payments) this.audit('delete', 'payments', payment.id, 'حذف دفعة تبعاً لحذف عملية البيع المرتبطة', serialize(payment), null);
        }
        this.db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
        this.audit('delete', table, id, `حذف ${LABELS[table]}`, serialize(before), null);
        return;
      }
      const data = this.validateRecord(table, input, before);
      const result = before ? this.update(table, before, data) : this.insert(table, data);
      this.audit(before ? 'update' : 'create', table, result.id, `${before ? 'تعديل' : 'إضافة'} ${LABELS[table]}`, serialize(before), serialize(result));
      if (table === 'sales' && method === 'POST' && input.paid !== undefined) {
        const amountCents = validate.money(input.paid, 'الدفعة الأولية');
        if (amountCents > result.quantity * result.unitPriceCents) validate.fail('الدفعة الأولية تتجاوز قيمة البيع.', 409, 'OVERPAYMENT');
        if (amountCents > 0) {
          const payment = this.insert('payments', {
            saleId: result.id, amountCents, date: result.date,
            method: validate.text(input.paymentMethod ?? 'cash', 'طريقة الدفع', { max: 60 }),
            notes: 'دفعة عند تسجيل البيع',
          });
          this.audit('create', 'payments', payment.id, 'إضافة دفعة عند تسجيل البيع', null, serialize(payment));
        }
      }
    }, { request });
  }

  updateSettings(input, request) {
    const data = validate.settings(input);
    return this.transaction(() => {
      this.checkRevision(input.expectedRevision);
      const before = this.settings();
      if (data.currency !== before.currency && ['sales', 'expenses', 'payments'].some(table => this.db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get())) {
        validate.fail('لا يمكن تغيير العملة بعد تسجيل عمليات؛ لا توجد آلية تحويل عملات.', 409, 'CURRENCY_LOCKED');
      }
      this.db.prepare('UPDATE settings SET capitalCents=?,currency=?,timeZone=? WHERE id=1').run(data.capitalCents, data.currency, data.timeZone);
      this.audit('update', 'settings', 'settings', 'تعديل رأس المال وإعدادات البرنامج', before, this.settings());
    }, { request });
  }

  backup() {
    const { settings, products, sales, expenses, payments, audit } = this.state();
    return { schemaVersion: 1, exportedAt: new Date().toISOString(), settings, products, sales, expenses, payments, audit };
  }

  restore(input, request) {
    const data = validate.validateBackup(input.backup);
    return this.transaction(() => {
      this.checkRevision(input.expectedRevision);
      const previousVersions = Object.fromEntries(TABLES.map(table => [table, new Map(this.db.prepare(`SELECT id,version FROM ${table}`).all().map(row => [row.id, row.version]))]));
      const beforeCounts = Object.fromEntries(TABLES.map(table => [table, previousVersions[table].size]));
      // Revisions never decrease and bound every version ever issued, including deleted
      // rows. Imported backups can raise this floor, preventing stale-version reuse.
      let versionFloor = this.meta().revision;
      for (const table of TABLES) for (const row of data[table]) versionFloor = Math.max(versionFloor, row.version);
      validate.version(versionFloor + 1);
      this.db.prepare('UPDATE settings SET revision=? WHERE id=1').run(versionFloor);
      for (const table of ['payments', 'sales', 'expenses', 'products']) this.db.exec(`DELETE FROM ${table}`);
      const now = new Date().toISOString();
      for (const table of TABLES) {
        for (const row of data[table]) {
          this.insert(table, { ...row, version: versionFloor + 1, updatedAt: now, createdAt: row.createdAt > now ? now : row.createdAt }, { preserveMetadata: true });
        }
      }
      this.db.prepare('UPDATE settings SET capitalCents=?,currency=?,timeZone=? WHERE id=1').run(data.settings.capitalCents, data.settings.currency, data.settings.timeZone);
      this.audit('restore', 'backup', 'backup', 'استعادة نسخة احتياطية مع الاحتفاظ بسجل التعديلات الحالي', beforeCounts, Object.fromEntries(TABLES.map(table => [table, data[table].length])));
    }, { request });
  }
}

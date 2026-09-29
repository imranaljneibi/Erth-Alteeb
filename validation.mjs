export const MAX_CENTS = 1_000_000_000_000;
export const MAX_QUANTITY = 1_000_000;

export class AppError extends Error {
  constructor(status, message, code = 'VALIDATION_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function fail(message, status = 400, code) {
  throw new AppError(status, message, code);
}

export function object(value, label = 'البيانات') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} غير صالحة.`);
  return value;
}

export function text(value, label, { required = true, max = 200 } = {}) {
  if (value === undefined || value === null) {
    if (!required) return '';
    fail(`${label} مطلوب.`);
  }
  if (typeof value !== 'string') fail(`${label} يجب أن يكون نصاً.`);
  const result = value.trim();
  if ((required && !result) || result.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(result)) {
    fail(`${label} غير صالح أو أطول من الحد المسموح (${max}).`);
  }
  return result;
}

export function integer(value, label, { min = 0, max = MAX_QUANTITY } = {}) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    fail(`${label} يجب أن يكون عدداً صحيحاً بين ${min} و${max}.`);
  }
  return value;
}

export function money(value, label, { min = 0 } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > MAX_CENTS / 100) {
    fail(`${label} مبلغ غير صالح.`);
  }
  const cents = Math.round(value * 100);
  if (Math.abs(value * 100 - cents) > 0.0001 || !Number.isSafeInteger(cents)) {
    fail(`${label} يقبل منزلتين عشريتين فقط.`);
  }
  return cents;
}

export function date(value, label = 'التاريخ') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${label} غير صالح.`);
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) fail(`${label} يجب أن يكون يوماً صحيحاً بين عامي 1900 و2100.`);
  return value;
}

export function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function identifier(value, label = 'المعرّف') {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) fail(`${label} غير صالح.`);
  return value;
}

export function version(value) {
  return integer(value, 'رقم النسخة', { min: 1, max: Number.MAX_SAFE_INTEGER - 1 });
}

export function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail('وقت السجل غير صالح.');
  }
  return value;
}

export function currency(value) {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) fail('رمز العملة يجب أن يتكون من ثلاثة أحرف كبيرة مثل AED.');
  return value;
}

export function product(input, { restore = false } = {}) {
  object(input);
  const out = {
    name: text(input.name, 'اسم المنتج', { max: 120 }),
    sku: text(input.sku, 'رمز المنتج', { required: false, max: 80 }),
    category: text(input.category, 'التصنيف', { required: false, max: 80 }),
    costCents: money(input.cost, 'تكلفة المنتج'),
    priceCents: money(input.price, 'سعر المنتج'),
    initialStock: integer(input.initialStock, 'إجمالي الكمية المتاحة'),
    lowStock: integer(input.lowStock ?? 5, 'حد تنبيه المخزون'),
  };
  return restore ? { ...out, ...metadata(input) } : out;
}

export function sale(input, { restore = false, defaultCost } = {}) {
  object(input);
  const quantity = integer(input.quantity, 'الكمية', { min: 1 });
  const unitPriceCents = money(input.unitPrice, 'سعر الوحدة');
  if (!Number.isSafeInteger(quantity * unitPriceCents) || quantity * unitPriceCents > MAX_CENTS) fail('إجمالي البيع يتجاوز الحد المسموح.');
  const out = {
    productId: identifier(input.productId, 'معرّف المنتج'),
    customer: text(input.customer, 'اسم العميل', { required: false, max: 120 }),
    quantity,
    unitPriceCents,
    unitCostCents: input.unitCost === undefined && defaultCost !== undefined ? defaultCost : money(input.unitCost, 'تكلفة الوحدة'),
    date: date(input.date ?? (restore ? undefined : today())),
    notes: text(input.notes, 'الملاحظات', { required: false, max: 2000 }),
  };
  if (quantity * out.unitCostCents > MAX_CENTS) fail('إجمالي تكلفة البيع يتجاوز الحد المسموح.');
  return restore ? { ...out, ...metadata(input) } : out;
}

export function expense(input, { restore = false } = {}) {
  object(input);
  const out = {
    title: text(input.title, 'عنوان المصروف', { max: 160 }),
    category: text(input.category, 'تصنيف المصروف', { required: false, max: 80 }),
    amountCents: money(input.amount, 'قيمة المصروف', { min: 0.01 }),
    date: date(input.date ?? (restore ? undefined : today())),
    notes: text(input.notes, 'الملاحظات', { required: false, max: 2000 }),
  };
  return restore ? { ...out, ...metadata(input) } : out;
}

export function payment(input, { restore = false } = {}) {
  object(input);
  const out = {
    saleId: identifier(input.saleId, 'معرّف عملية البيع'),
    amountCents: money(input.amount, 'قيمة الدفعة', { min: 0.01 }),
    date: date(input.date ?? (restore ? undefined : today())),
    method: text(input.method ?? 'cash', 'طريقة الدفع', { max: 60 }),
    notes: text(input.notes, 'الملاحظات', { required: false, max: 2000 }),
  };
  return restore ? { ...out, ...metadata(input) } : out;
}

function metadata(input) {
  return {
    id: identifier(input.id),
    version: version(input.version),
    createdAt: timestamp(input.createdAt),
    updatedAt: timestamp(input.updatedAt),
  };
}

export function settings(input) {
  object(input, 'الإعدادات');
  if (input.timeZone !== undefined && input.timeZone !== 'Asia/Dubai') fail('المنطقة الزمنية يجب أن تكون Asia/Dubai.');
  return { capitalCents: money(input.capital, 'رأس المال'), currency: currency(input.currency), timeZone: 'Asia/Dubai' };
}

export function validateBackup(input) {
  object(input, 'النسخة الاحتياطية');
  if (input.schemaVersion !== 1) fail('صيغة النسخة الاحتياطية غير مدعومة.');
  timestamp(input.exportedAt);
  const result = { settings: settings(input.settings) };
  const validators = { products: product, sales: sale, expenses: expense, payments: payment };
  let total = 0;
  for (const [kind, validator] of Object.entries(validators)) {
    if (!Array.isArray(input[kind]) || input[kind].length > 50_000) fail(`قائمة ${kind} في النسخة الاحتياطية غير صالحة.`);
    total += input[kind].length;
    if (total > 100_000) fail('النسخة الاحتياطية تتجاوز 100 ألف سجل.');
    const ids = new Set();
    result[kind] = input[kind].map(raw => {
      const row = validator(raw, { restore: true });
      if (ids.has(row.id)) fail('النسخة الاحتياطية تحتوي على معرّفات مكررة.');
      ids.add(row.id);
      if (row.updatedAt < row.createdAt) fail('وقت تعديل السجل أقدم من وقت إنشائه.');
      return row;
    });
  }
  const products = new Map(result.products.map(row => [row.id, row]));
  const sales = new Map(result.sales.map(row => [row.id, row]));
  const sold = new Map();
  const paid = new Map();
  const skus = new Set();
  for (const row of result.products) {
    if (row.sku && skus.has(row.sku.toLowerCase())) fail('النسخة الاحتياطية تحتوي على رموز منتجات مكررة.');
    if (row.sku) skus.add(row.sku.toLowerCase());
  }
  for (const row of result.sales) {
    if (!products.has(row.productId)) fail('توجد عملية بيع مرتبطة بمنتج مفقود.');
    sold.set(row.productId, (sold.get(row.productId) ?? 0) + row.quantity);
    if (sold.get(row.productId) > products.get(row.productId).initialStock) fail('كميات البيع في النسخة الاحتياطية تتجاوز المخزون.');
  }
  for (const row of result.payments) {
    const relatedSale = sales.get(row.saleId);
    if (!relatedSale) fail('توجد دفعة مرتبطة بعملية بيع مفقودة.');
    paid.set(row.saleId, (paid.get(row.saleId) ?? 0) + row.amountCents);
    if (paid.get(row.saleId) > relatedSale.quantity * relatedSale.unitPriceCents) fail('الدفعات في النسخة الاحتياطية تتجاوز قيمة البيع.');
  }
  // Exported history is informational: restoration keeps the database's existing audit trail.
  if (input.audit !== undefined) {
    if (!Array.isArray(input.audit) || input.audit.length > 100_000) fail('سجل التعديلات غير صالح.');
    for (const entry of input.audit) {
      object(entry, 'سجل التعديل');
      identifier(entry.id);
      text(entry.action, 'نوع التعديل', { max: 40 });
      text(entry.entity, 'نوع السجل', { max: 40 });
      text(entry.entityId, 'معرّف السجل', { required: false, max: 100 });
      text(entry.description, 'وصف التعديل', { max: 300 });
      timestamp(entry.at);
      for (const field of ['before', 'after']) {
        if (entry[field] !== null && entry[field] !== undefined) object(entry[field], 'تفاصيل التعديل');
      }
    }
  }
  return result;
}

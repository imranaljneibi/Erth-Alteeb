import http from 'node:http';
import { createReadStream, chmodSync, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Store, TABLES } from './lib/database.mjs';
import * as validate from './lib/validation.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const scryptAsync = promisify(scrypt);
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const SESSION_COOKIE = 'irth_session';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.pdf': 'application/pdf',
};

const digest = token => createHash('sha256').update(token).digest('hex');
const equal = (left, right) => typeof left === 'string' && typeof right === 'string' && Buffer.byteLength(left) === Buffer.byteLength(right) && timingSafeEqual(Buffer.from(left), Buffer.from(right));

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function idempotencyRequest(req, path, input) {
  const rawKey = req.headers['idempotency-key'];
  if (rawKey === undefined) return undefined;
  const key = validate.identifier(rawKey, 'معرّف الحفظ').toLowerCase();
  // Passwords authenticate restore; they are not part of its business effect.
  // Excluding them avoids storing a fast unsalted password verifier in this table.
  const payload = path === '/api/restore' ? Object.fromEntries(Object.entries(input).filter(([field]) => field !== 'password')) : input;
  return { key, hash: digest(`${req.method}\n${path}\n${canonicalJson(payload)}`) };
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scryptAsync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$32768$8$1$${salt}$${key.toString('hex')}`;
}

async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 256 || typeof encoded !== 'string') return false;
  const [algorithm, n, r, p, salt, hash] = encoded.split('$');
  if (algorithm !== 'scrypt' || !salt || !hash) return false;
  const key = await scryptAsync(password, salt, 64, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return equal(key.toString('hex'), hash);
}

function credentials(input, { setup = false } = {}) {
  validate.object(input);
  const email = validate.text(input.email, 'البريد الإلكتروني', { max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) validate.fail('البريد الإلكتروني غير صالح.');
  if (typeof input.password !== 'string' || input.password.length > 256 || input.password.length < (setup ? 10 : 1)) {
    validate.fail(setup ? 'كلمة المرور يجب أن تحتوي على 10 أحرف على الأقل.' : 'أدخل كلمة المرور.');
  }
  return { email, password: input.password };
}

function readJson(req, limit = 1_048_576) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) validate.fail('أرسل البيانات بصيغة JSON.', 415, 'CONTENT_TYPE');
  if (Number(req.headers['content-length'] ?? 0) > limit) validate.fail('حجم الطلب يتجاوز الحد المسموح.', 413, 'TOO_LARGE');
  return new Promise((resolveBody, rejectBody) => {
    let size = 0;
    let finished = false;
    const chunks = [];
    req.on('data', chunk => {
      if (finished) return;
      size += chunk.length;
      if (size > limit) {
        finished = true;
        chunks.length = 0;
        rejectBody(new validate.AppError(413, 'حجم الطلب يتجاوز الحد المسموح.', 'TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (finished) return;
      finished = true;
      try { resolveBody(validate.object(JSON.parse(Buffer.concat(chunks).toString('utf8')))); }
      catch (error) { rejectBody(error instanceof validate.AppError ? error : new validate.AppError(400, 'صيغة JSON غير صالحة.', 'INVALID_JSON')); }
    });
    req.on('error', error => { if (!finished) { finished = true; rejectBody(error); } });
    req.on('aborted', () => { if (!finished) { finished = true; rejectBody(new validate.AppError(400, 'انقطع إرسال الطلب.', 'ABORTED')); } });
  });
}

function json(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), ...extraHeaders });
  res.end(body);
}

export function createApp(options = {}) {
  const dbPath = options.dbPath ?? process.env.DB_PATH ?? resolve(ROOT, 'data', 'irth.sqlite');
  const publicDir = resolve(options.publicDir ?? resolve(ROOT, 'public'));
  const port = options.port ?? Number(process.env.PORT ?? 3000);
  const host = options.host ?? process.env.HOST ?? '0.0.0.0';
  const secureCookie = options.cookieSecure ?? process.env.COOKIE_SECURE === 'true';
  const setupToken = options.setupToken ?? process.env.SETUP_TOKEN ?? '';
  const publicOrigin = options.publicOrigin ?? (process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL || '');
  const logger = options.logger ?? console;
  const store = new Store(dbPath);
  if (dbPath !== ':memory:') {
    for (const filename of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      if (existsSync(filename)) chmodSync(filename, 0o600);
    }
  }
  const events = new Set();
  const loginAttempts = new Map();
  let closed = false;

  function headers(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com https://*.chatgpt-team.site");
    if (secureCookie || req.socket.encrypted) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }

  function setSessionCookie(req, res, token, maxAge = SESSION_SECONDS) {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureCookie || req.socket.encrypted ? '; Secure' : ''}`);
  }

  function issueSession(req, res) {
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const now = Date.now();
    store.db.prepare('DELETE FROM sessions WHERE expiresAt<=?').run(now);
    store.db.prepare('INSERT INTO sessions (tokenHash,csrfToken,createdAt,expiresAt) VALUES (?,?,?,?)').run(digest(token), csrfToken, new Date(now).toISOString(), now + SESSION_SECONDS * 1000);
    setSessionCookie(req, res, token);
    const user = store.owner();
    return { user: { name: user.name, email: user.email }, csrfToken };
  }

  function authenticate(req) {
    const cookies = req.headers.cookie ?? '';
    const raw = cookies.split(';').map(value => value.trim()).find(value => value.startsWith(`${SESSION_COOKIE}=`));
    const token = raw?.slice(SESSION_COOKIE.length + 1);
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) validate.fail('يرجى تسجيل الدخول للوصول إلى بياناتك.', 401, 'UNAUTHORIZED');
    const session = store.db.prepare('SELECT * FROM sessions WHERE tokenHash=? AND expiresAt>?').get(digest(token), Date.now());
    if (!session) validate.fail('انتهت الجلسة. يرجى تسجيل الدخول مجدداً.', 401, 'UNAUTHORIZED');
    return session;
  }

  function checkOrigin(req) {
    if (!req.headers.origin) return;
    let origin;
    try { origin = new URL(req.headers.origin); }
    catch { validate.fail('مصدر الطلب غير صالح.', 403, 'INVALID_ORIGIN'); }
    if (publicOrigin) {
      if (origin.origin !== new URL(publicOrigin).origin) validate.fail('مصدر الطلب غير مسموح.', 403, 'INVALID_ORIGIN');
    } else if (origin.host !== req.headers.host) {
      validate.fail('مصدر الطلب غير مسموح.', 403, 'INVALID_ORIGIN');
    }
  }

  function requireCsrf(req, session) {
    checkOrigin(req);
    if (!equal(req.headers['x-csrf-token'], session.csrfToken)) validate.fail('تعذر التحقق من حماية الطلب. حدّث الصفحة ثم حاول مجدداً.', 403, 'CSRF_ERROR');
  }

  function checkRate(req, action) {
    const key = `${action}:${req.socket.remoteAddress}`;
    const now = Date.now();
    const previous = loginAttempts.get(key);
    const entry = previous && previous.resetAt > now ? previous : { count: 0, resetAt: now + 15 * 60_000 };
    if (entry.count >= 15) validate.fail('محاولات كثيرة. انتظر 15 دقيقة ثم حاول مجدداً.', 429, 'RATE_LIMITED');
    entry.count += 1;
    loginAttempts.set(key, entry);
    return key;
  }

  function broadcast() {
    const message = `event: revision\ndata: ${JSON.stringify(store.meta())}\n\n`;
    for (const item of events) {
      if (!item.res.destroyed && !item.res.writableEnded) {
        if (!item.res.write(message)) {
          item.res.end();
          events.delete(item);
        }
      } else events.delete(item);
    }
  }

  function openEvents(req, res, session) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write(`retry: 2500\nevent: revision\ndata: ${JSON.stringify(store.meta())}\n\n`);
    const item = { res, tokenHash: session.tokenHash, expiresAt: session.expiresAt };
    events.add(item);
    req.on('close', () => events.delete(item));
  }

  async function serve(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') validate.fail('الطريقة غير مسموحة.', 405, 'METHOD_NOT_ALLOWED');
    let decoded;
    try { decoded = decodeURIComponent(pathname); }
    catch { validate.fail('الرابط غير صالح.'); }
    if (decoded.includes('\0') || decoded.includes('\\')) validate.fail('الرابط غير صالح.');
    const target = resolve(publicDir, `.${decoded === '/' ? '/index.html' : decoded}`);
    if (target !== publicDir && !target.startsWith(`${publicDir}${sep}`)) validate.fail('الوصول غير مسموح.', 403, 'FORBIDDEN');
    let info;
    try { info = await stat(target); }
    catch { validate.fail('الصفحة غير موجودة.', 404, 'NOT_FOUND'); }
    if (!info.isFile() || !MIME[extname(target).toLowerCase()]) validate.fail('الملف غير موجود.', 404, 'NOT_FOUND');
    res.writeHead(200, { 'Content-Type': MIME[extname(target).toLowerCase()], 'Content-Length': info.size });
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = createReadStream(target);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }

  async function handler(req, res) {
    headers(req, res);
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      if (!path.startsWith('/api/')) return await serve(req, res, path);
      if (req.method === 'GET' && path === '/api/status') {
        return json(res, 200, { initialized: store.initialized(), requiresSetupToken: Boolean(setupToken) });
      }
      if (req.method === 'POST' && path === '/api/setup') {
        checkOrigin(req);
        checkRate(req, 'setup');
        if (store.initialized()) validate.fail('تم إعداد الحساب بالفعل. استخدم تسجيل الدخول.', 409, 'ALREADY_INITIALIZED');
        const input = await readJson(req);
        if (setupToken && !equal(input.setupToken, setupToken)) validate.fail('رمز إعداد الحساب غير صحيح.', 403, 'INVALID_SETUP_TOKEN');
        const { email, password } = credentials(input, { setup: true });
        const name = validate.text(input.name, 'اسم صاحب الحساب', { max: 120 });
        const settings = validate.settings({ capital: input.capital ?? 0, currency: input.currency ?? 'AED' });
        const passwordHash = await hashPassword(password);
        store.initialize({ name, email, passwordHash, settings });
        return json(res, 201, issueSession(req, res));
      }
      if (req.method === 'POST' && path === '/api/login') {
        checkOrigin(req);
        const rateKey = checkRate(req, 'login');
        const input = await readJson(req);
        const { email, password } = credentials(input);
        const user = store.owner();
        const validPassword = await verifyPassword(password, user?.passwordHash ?? 'scrypt$32768$8$1$00000000000000000000000000000000$' + '0'.repeat(128));
        if (!user || user.email !== email || !validPassword) validate.fail('البريد الإلكتروني أو كلمة المرور غير صحيحة.', 401, 'INVALID_CREDENTIALS');
        loginAttempts.delete(rateKey);
        return json(res, 200, issueSession(req, res));
      }
      const session = authenticate(req);
      if (req.method === 'GET' && path === '/api/me') {
        const user = store.owner();
        return json(res, 200, { user: { name: user.name, email: user.email }, csrfToken: session.csrfToken });
      }
      if (req.method === 'GET' && path === '/api/state') return json(res, 200, store.state());
      if (req.method === 'GET' && path === '/api/events') return openEvents(req, res, session);
      if (req.method === 'GET' && path === '/api/backup') {
        return json(res, 200, store.backup(), { 'Content-Disposition': `attachment; filename="irth-backup-${validate.today()}.json"` });
      }
      if (!['POST', 'PUT', 'DELETE'].includes(req.method)) validate.fail('المسار غير موجود.', 404, 'NOT_FOUND');
      requireCsrf(req, session);
      if (req.method === 'POST' && path === '/api/logout') {
        store.db.prepare('DELETE FROM sessions WHERE tokenHash=?').run(session.tokenHash);
        for (const item of events) {
          if (item.tokenHash === session.tokenHash) { item.res.end(); events.delete(item); }
        }
        setSessionCookie(req, res, '', 0);
        return json(res, 200, { success: true });
      }
      const input = await readJson(req, path === '/api/restore' ? 25 * 1024 * 1024 : 1_048_576);
      const request = idempotencyRequest(req, path, input);
      if (req.method === 'POST' && path === '/api/restore') {
        const key = checkRate(req, 'restore');
        if (!await verifyPassword(input.password, store.owner().passwordHash)) validate.fail('كلمة المرور غير صحيحة. لم تتغير البيانات.', 401, 'INVALID_PASSWORD');
        loginAttempts.delete(key);
        // The password check yields; revalidate this session before writing data.
        authenticate(req);
        const result = store.restore(input, request);
        if (!result.replayed) broadcast();
        return json(res, 200, store.state());
      }
      if (req.method === 'PUT' && path === '/api/settings') {
        authenticate(req);
        const result = store.updateSettings(input, request);
        if (!result.replayed) broadcast();
        return json(res, 200, store.state());
      }
      const match = /^\/api\/(products|sales|expenses|payments)(?:\/([^/]+))?$/.exec(path);
      if (!match || (req.method === 'POST' && match[2]) || (req.method !== 'POST' && !match[2]) || !TABLES.includes(match[1])) {
        validate.fail('المسار غير موجود.', 404, 'NOT_FOUND');
      }
      authenticate(req);
      const result = store.mutate(match[1], req.method, match[2], input, request);
      if (!result.replayed) broadcast();
      return json(res, 200, store.state());
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      if (error instanceof validate.AppError) {
        const data = { error: error.message, code: error.code };
        if (error.status === 409 && store.initialized()) data.revision = store.meta().revision;
        return json(res, error.status, data, error.status === 429 ? { 'Retry-After': '900' } : {});
      }
      logger.error?.('[irth] Request failed:', error?.stack ?? error);
      return json(res, 500, { error: 'تعذر تأكيد نتيجة العملية. أعد المحاولة للتحقق من حفظها.', code: 'INTERNAL_ERROR' });
    }
  }

  const server = http.createServer(handler);
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const item of events) {
      if (item.expiresAt <= now || item.res.destroyed || item.res.writableEnded) {
        item.res.end();
        events.delete(item);
      } else if (!item.res.write(`: heartbeat ${now}\n\n`)) {
        item.res.end();
        events.delete(item);
      }
    }
    for (const [key, value] of loginAttempts) if (value.resetAt <= now) loginAttempts.delete(key);
  }, 25_000);
  heartbeat.unref();

  return {
    server,
    db: store.db,
    store,
    async start() {
      if (closed) throw new Error('Application is closed.');
      if (server.listening) return server.address();
      await new Promise((resolveStarted, rejectStarted) => {
        server.once('error', rejectStarted);
        server.listen(port, host, () => { server.off('error', rejectStarted); resolveStarted(); });
      });
      return server.address();
    },
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      for (const item of events) item.res.end();
      events.clear();
      if (server.listening) {
        await new Promise((resolveClosed, rejectClosed) => {
          server.close(error => error ? rejectClosed(error) : resolveClosed());
          server.closeIdleConnections();
        });
      }
      store.db.close();
    },
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const app = createApp();
  const address = await app.start();
  console.log(`إرث الطيب يعمل على http://${address.address}:${address.port}`);
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try { await app.close(); process.exitCode = 0; }
    catch (error) { console.error(error); process.exitCode = 1; }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

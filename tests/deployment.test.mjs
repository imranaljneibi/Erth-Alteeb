import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';

test('Render origin fallback, private setup token and secure cookie work together', async t => {
  const oldPublic = process.env.PUBLIC_ORIGIN;
  const oldRender = process.env.RENDER_EXTERNAL_URL;
  let app;
  try {
    process.env.PUBLIC_ORIGIN = '';
    process.env.RENDER_EXTERNAL_URL = 'https://irth-deployment-test.example';
    app = createApp({ dbPath: ':memory:', port: 0, host: '127.0.0.1', setupToken: 'fixture-only-setup-token', cookieSecure: true });
  } finally {
    if (oldPublic === undefined) delete process.env.PUBLIC_ORIGIN; else process.env.PUBLIC_ORIGIN = oldPublic;
    if (oldRender === undefined) delete process.env.RENDER_EXTERNAL_URL; else process.env.RENDER_EXTERNAL_URL = oldRender;
  }
  t.after(() => app.close());
  await app.start();
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const status = await (await fetch(base + '/api/status')).json();
  assert.equal(status.requiresSetupToken, true);
  const body = { name: 'اختبار النشر', email: 'deployment@example.test', password: 'Only-a-test-password-123', capital: 0, currency: 'AED', setupToken: 'fixture-only-setup-token' };
  async function setup(origin, value) {
    return fetch(base + '/api/setup', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  }
  const rejectedOrigin = await setup('https://other.example', body);
  assert.equal(rejectedOrigin.status, 403);
  const rejectedToken = await setup('https://irth-deployment-test.example', { ...body, setupToken: 'wrong' });
  assert.equal(rejectedToken.status, 403);
  const accepted = await setup('https://irth-deployment-test.example', body);
  assert.equal(accepted.status, 201);
  assert.match(accepted.headers.get('set-cookie'), /; Secure(?:;|$)/);
  assert.match(accepted.headers.get('set-cookie'), /HttpOnly/);
  assert.equal((await fetch(base + '/api/state')).status, 401);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { SlidingWindowLimiter, trustedProxySetting } = require('../security');

function response() {
  return { statusCode: 200, headers: {}, set(name, value) { this.headers[name] = value; }, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end() { this.ended = true; return this; } };
}

function request({ cookie = '', csrf, ip = '127.0.0.1', secure = false } = {}) {
  return { headers: { cookie }, body: {}, ip, secure, get(name) { return name.toLowerCase() === 'x-csrf-token' ? csrf : undefined; } };
}

test('trust proxy only accepts configured exact proxy addresses', () => {
  const trust = trustedProxySetting('127.0.0.1,::1');
  assert.equal(trust('127.0.0.1'), true);
  assert.equal(trust('::ffff:127.0.0.1'), true);
  assert.equal(trust('10.0.0.10'), false);
});

test('limiter is bounded and returns retry information', () => {
  let now = 0;
  const limiter = new SlidingWindowLimiter({ max: 2, windowMs: 1000, maxKeys: 2, now: () => now });
  assert.equal(limiter.consume('a').allowed, true);
  assert.equal(limiter.consume('a').allowed, true);
  const blocked = limiter.consume('a');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 1);
  limiter.consume('b');
  limiter.consume('c');
  assert.ok(limiter.entries.size <= 2);
  now = 1000;
  assert.equal(limiter.consume('a').allowed, true);
});

test('logout requires matching CSRF token and preserves Secure cookie semantics', () => {
  process.env.WHATSAPP_CONTROL_USERNAME = 'operator';
  const expected = crypto.scryptSync('strong-password', 'salt', 32, { N: 16384, r: 8, p: 1 }).toString('base64');
  process.env.WHATSAPP_CONTROL_PASSWORD_HASH = `scrypt$16384$8$1$salt$${expected}`;
  const auth = require('../auth');
  const loginReq = request({ ip: `test-${Date.now()}-${Math.random()}` });
  loginReq.body = { username: 'operator', password: 'strong-password' };
  const loginRes = response();
  auth.login(loginReq, loginRes);
  assert.equal(loginRes.statusCode, 200);
  const cookie = loginRes.headers['Set-Cookie'].split(';')[0];
  const sessionReq = request({ cookie });
  const statusRes = response();
  auth.authStatus(sessionReq, statusRes);
  assert.equal(statusRes.statusCode, 200);
  const missingCsrf = response();
  auth.requireCsrf(sessionReq, missingCsrf, () => {});
  assert.equal(missingCsrf.statusCode, 403);
  const crossSiteLogout = response();
  auth.requireCsrfOrSameOrigin(sessionReq, crossSiteLogout, () => {});
  assert.equal(crossSiteLogout.statusCode, 403);
  const sameOriginReq = request({ cookie, ip: `same-origin-${Date.now()}` });
  sameOriginReq.protocol = 'https';
  sameOriginReq.get = (name) => name.toLowerCase() === 'origin' ? 'https://control.example.test' : name.toLowerCase() === 'host' ? 'control.example.test' : undefined;
  const sameOriginRes = response();
  auth.requireCsrfOrSameOrigin(sameOriginReq, sameOriginRes, () => { sameOriginRes.allowed = true; });
  assert.equal(sameOriginRes.allowed, true);
  const validReq = request({ cookie, csrf: statusRes.body.csrf_token, secure: true });
  const validRes = response();
  validRes.req = validReq;
  auth.requireCsrf(validReq, validRes, () => auth.logout(validReq, validRes));
  assert.equal(validRes.statusCode, 204);
  assert.match(validRes.headers['Set-Cookie'], /Secure/);
});

test('login rate limit returns Retry-After after repeated failures', () => {
  process.env.WHATSAPP_CONTROL_USERNAME = 'operator';
  process.env.WHATSAPP_CONTROL_PASSWORD_HASH = 'scrypt$16384$8$1$invalid$invalid';
  const auth = require('../auth');
  const ip = `rate-limit-${Date.now()}-${Math.random()}`;
  let last;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const req = request({ ip });
    req.body = { username: 'operator', password: 'wrong' };
    last = response();
    auth.login(req, last);
    assert.equal(last.statusCode, 401);
  }
  const blockedReq = request({ ip });
  blockedReq.body = { username: 'operator', password: 'wrong' };
  const blocked = response();
  auth.login(blockedReq, blocked);
  assert.equal(blocked.statusCode, 429);
  assert.match(blocked.headers['Retry-After'], /^\d+$/);
});

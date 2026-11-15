const crypto = require('node:crypto');

const COOKIE_NAME = 'wac_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const sessions = new Map();
const loginAttempts = new Map();

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim().split('='))
    .filter(([key, value]) => key && value)
    .map(([key, value]) => [key, decodeURIComponent(value)]));
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function configured() {
  return Boolean(process.env.WHATSAPP_CONTROL_USERNAME && process.env.WHATSAPP_CONTROL_PASSWORD_HASH);
}

function verifyPassword(password, encoded) {
  const [scheme, cost, blockSize, parallelism, salt, expected] = String(encoded || '').split('$');
  if (scheme !== 'scrypt' || !cost || !blockSize || !parallelism || !salt || !expected) return false;
  try {
    const actual = crypto.scryptSync(String(password || ''), salt, Buffer.from(expected, 'base64').length, {
      N: Number(cost), r: Number(blockSize), p: Number(parallelism), maxmem: 32 * 1024 * 1024
    }).toString('base64');
    return safeEqual(actual, expected);
  } catch {
    return false;
  }
}

function createSession(username) {
  const id = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  sessions.set(id, { username, csrf, expiresAt: Date.now() + SESSION_TTL_MS });
  return { id, csrf };
}

function getSession(req) {
  const id = parseCookies(req.headers.cookie)[COOKIE_NAME];
  const session = id && sessions.get(id);
  if (!session || session.expiresAt <= Date.now()) {
    if (id) sessions.delete(id);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return { id, ...session };
}

function setSessionCookie(res, id) {
  const secure = res.req && (res.req.secure || res.req.get('x-forwarded-proto') === 'https') ? '; Secure' : '';
  res.set('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}${secure}`);
}

function clearSessionCookie(res) {
  res.set('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

function requireAuth(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'authentication_required' });
  req.auth = session;
  next();
}

function requireCsrf(req, res, next) {
  const session = req.auth || getSession(req);
  if (!session || !safeEqual(req.get('x-csrf-token'), session.csrf)) return res.status(403).json({ error: 'csrf_failed' });
  next();
}

function login(req, res) {
  if (!configured()) return res.status(503).json({ error: 'auth_not_configured' });
  const username = String(req.body.username || '');
  const key = `${req.ip || 'unknown'}:${username}`;
  const now = Date.now();
  const attempts = loginAttempts.get(key) || { count: 0, windowStartedAt: now };
  if (now - attempts.windowStartedAt >= LOGIN_WINDOW_MS) { attempts.count = 0; attempts.windowStartedAt = now; }
  if (attempts.count >= MAX_LOGIN_ATTEMPTS) return res.status(429).json({ error: 'login_rate_limited' });
  if (!safeEqual(username, process.env.WHATSAPP_CONTROL_USERNAME) || !verifyPassword(req.body.password, process.env.WHATSAPP_CONTROL_PASSWORD_HASH)) {
    attempts.count += 1;
    loginAttempts.set(key, attempts);
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  loginAttempts.delete(key);
  const session = createSession(username);
  setSessionCookie(res, session.id);
  res.json({ authenticated: true, csrf_token: session.csrf });
}

function authStatus(req, res) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ authenticated: false });
  res.json({ authenticated: true, username: session.username, csrf_token: session.csrf });
}

function logout(req, res) {
  const id = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (id) sessions.delete(id);
  clearSessionCookie(res);
  res.status(204).end();
}

module.exports = { configured, login, authStatus, logout, requireAuth, requireCsrf, getSession, setSessionCookie, clearSessionCookie };

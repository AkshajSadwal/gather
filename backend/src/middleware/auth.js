const { decode } = require('@auth/core/jwt');
const { authSecret, nodeEnv } = require('../config/env');
const { HttpError } = require('../utils/http');

// This must exactly match the session cookie name configured by Auth.js in
// frontend/auth.js. Do not accept legacy NextAuth v4 cookie names here: doing
// so can let a stale cookie from another app/session identify the wrong user.
const SESSION_COOKIE_NAME = nodeEnv === 'production'
  ? '__Secure-authjs.session-token'
  : 'authjs.session-token';

function getCookie(req, name = SESSION_COOKIE_NAME) {
  const raw = req.headers.cookie || '';
  const part = raw.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : null;
}

async function sessionUserFromCookie(cookieHeader) {
  if (!authSecret) throw new Error('AUTH_SECRET is not configured');

  // Only decode the cookie that this application actually issues. Never fall
  // back to older/alternate cookie names because that can authenticate a
  // different browser session and cause cross-account identity confusion.
  const cookies = String(cookieHeader || '').split(';').map((item) => item.trim());
  const part = cookies.find((item) => item.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!part) return null;

  try {
    const token = decodeURIComponent(part.slice(SESSION_COOKIE_NAME.length + 1));
    const payload = await decode({ token, secret: authSecret, salt: SESSION_COOKIE_NAME });
    const userId = payload?.sub;
    if (typeof userId === 'string' && userId.trim()) return { id: userId, email: payload.email, name: payload.name };
  } catch { /* Invalid, expired, or malformed session cookie. */ }
  return null;
}

async function requireAuth(req, _res, next) {
  try {
    const user = await sessionUserFromCookie(req.headers.cookie);
    if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

function requireInternal(req, _res, next) {
  const expected = process.env.INTERNAL_AUTH_SECRET;
  if (!expected || req.get('x-internal-auth') !== expected) {
    return next(new HttpError(401, 'UNAUTHENTICATED', 'Internal request authentication failed.'));
  }
  next();
}

module.exports = { requireAuth, requireInternal, sessionUserFromCookie, getCookie, SESSION_COOKIE_NAME };

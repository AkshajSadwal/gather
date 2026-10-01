const { decode } = require('@auth/core/jwt');
const { authSecret } = require('../config/env');
const { HttpError } = require('../utils/http');

const COOKIE_NAMES = ['authjs.session-token', '__Secure-authjs.session-token', 'next-auth.session-token', '__Secure-next-auth.session-token'];

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  const part = raw.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : null;
}

async function sessionUserFromCookie(cookieHeader) {
  if (!authSecret) throw new Error('AUTH_SECRET is not configured');
  const cookies = String(cookieHeader || '').split(';').map((item) => item.trim());
  for (const name of COOKIE_NAMES) {
    const part = cookies.find((item) => item.startsWith(`${name}=`));
    if (!part) continue;
    const token = decodeURIComponent(part.slice(name.length + 1));
    try {
      const payload = await decode({ token, secret: authSecret, salt: name });
      const userId = payload?.sub || payload?.id;
      if (userId) return { id: String(userId), email: payload.email, name: payload.name };
    } catch { /* Try the next supported cookie name. */ }
  }
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

module.exports = { requireAuth, requireInternal, sessionUserFromCookie, getCookie };

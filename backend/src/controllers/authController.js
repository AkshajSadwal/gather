const bcrypt = require('bcryptjs');
const { z } = require('zod');
const prisma = require('../config/prisma');
const { isAdminUsername } = require('../middleware/admin');
const { normalizeUsername, normalizeEmail, validUsername } = require('../utils/normalize');
const { HttpError, ok } = require('../utils/http');
const crypto = require('node:crypto');

const signupSchema = z.object({
  username: z.string().trim().min(3).max(30),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(72),
  displayName: z.string().trim().max(60).optional()
});

async function checkUsername(req, res) {
  const username = normalizeUsername(req.query.username);
  if (!validUsername(username)) return ok(res, { valid: false, available: false, reason: 'Use 3–30 letters, numbers, dots, or underscores.' });
  const exists = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  return ok(res, { valid: true, available: !exists });
}

async function checkEmail(req, res) {
  const email = normalizeEmail(req.query.email);
  if (!z.email().safeParse(email).success || email.length > 254) return ok(res, { valid: false, available: false, reason: 'Enter a valid email address.' });
  const exists = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  return ok(res, { valid: true, available: !exists });
}

async function signup(req, res) {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields.', parsed.error.flatten().fieldErrors);
  const { password, displayName } = parsed.data;
  if (Buffer.byteLength(password, 'utf8') > 72) throw new HttpError(400, 'INVALID_PASSWORD', 'Passwords must be 72 bytes or fewer.');
  const username = normalizeUsername(parsed.data.username);
  const email = normalizeEmail(parsed.data.email);
  if (!validUsername(username)) throw new HttpError(400, 'INVALID_USERNAME', 'Use 3–30 letters, numbers, dots, or underscores.');
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const user = await prisma.user.create({
      data: { username, email, passwordHash, profile: { create: { displayName: displayName || username } } },
      select: { id: true, username: true, email: true, image: true, profile: true }
    });
    return ok(res, { user }, 201);
  } catch (error) {
    if (error.code === 'P2002') {
      const field = error.meta?.target?.includes('email') ? 'email' : 'username';
      throw new HttpError(409, 'DUPLICATE_ACCOUNT_FIELD', `That ${field} is already registered.`, { field });
    }
    throw error;
  }
}

async function login(req, res) {
  const parsed = z.object({ identifier: z.string().trim().min(1).max(254), password: z.string().min(1).max(72) }).safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Enter your username or email and password.');
  const identifier = parsed.data.identifier.includes('@') ? normalizeEmail(parsed.data.identifier) : normalizeUsername(parsed.data.identifier);
  const user = await prisma.user.findFirst({ where: { OR: [{ email: identifier }, { username: identifier }] }, select: { id: true, username: true, email: true, image: true, passwordHash: true, profile: true } });
  const valid = user?.passwordHash && await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!valid) throw new HttpError(401, 'INVALID_CREDENTIALS', 'The username/email or password is incorrect.');
  const { passwordHash, ...safeUser } = user;
  return ok(res, { user: safeUser });
}

async function syncGoogle(req, res) {
  const email = normalizeEmail(req.body.email);
  const name = String(req.body.name || '').trim().slice(0, 60);
  const image = typeof req.body.image === 'string' ? req.body.image.slice(0, 2048) : null;
  if (!z.email().safeParse(email).success) throw new HttpError(400, 'INVALID_EMAIL', 'Google did not provide a valid email address.');
  let user = await prisma.user.findUnique({ where: { email }, select: { id: true, username: true } });
  if (!user) {
    const base = normalizeUsername(email.split('@')[0]).replace(/[^a-z0-9._]/g, '').slice(0, 24) || 'member';
    for (let attempt = 0; attempt < 5 && !user; attempt += 1) {
      const suffix = attempt === 0 ? '' : `.${crypto.randomBytes(4).toString('hex')}`;
      const username = `${base.slice(0, 30 - suffix.length)}${suffix}`;
      try {
        user = await prisma.user.create({
          data: { email, username, image, profile: { create: { displayName: name || username, avatarUrl: image } } },
          select: { id: true, username: true }
        });
      } catch (error) {
        if (error.code !== 'P2002' || error.meta?.target?.includes('email')) throw error;
      }
    }
    if (!user) throw new HttpError(409, 'ACCOUNT_SYNC_CONFLICT', 'Could not create a unique username. Please try Google sign-in again.');
  } else if (image) {
    await prisma.user.update({ where: { id: user.id }, data: { image, profile: { upsert: { create: { displayName: name || user.username, avatarUrl: image }, update: { avatarUrl: image } } } } });
  }
  return ok(res, { user });
}

async function me(req, res) {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, username: true, email: true, image: true, passwordHash: true, createdAt: true, profile: true, _count: { select: { followers: { where: { accepted: true } }, following: { where: { accepted: true } }, posts: true } } }
  });
  if (!user) throw new HttpError(401, 'SESSION_EXPIRED', 'Your account is no longer available. Please sign in again.');
  const { passwordHash, ...safeUser } = user;
  return ok(res, { user: { ...safeUser, hasPassword: Boolean(passwordHash), isAdmin: isAdminUsername(user.username) } });
}

module.exports = { checkUsername, checkEmail, signup, login, syncGoogle, me };

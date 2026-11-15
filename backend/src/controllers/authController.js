const bcrypt = require('bcryptjs');
const { z } = require('zod');
const prisma = require('../config/prisma');
const { isAdminUsername } = require('../middleware/admin');
const { normalizeUsername, normalizeEmail, validUsername } = require('../utils/normalize');
const { HttpError, ok } = require('../utils/http');
const crypto = require('node:crypto');

const signupSchema = z.object({
  username: z.string().trim().min(3).max(30),
  password: z.string().min(8).max(72),
  displayName: z.string().trim().max(60).optional()
}).strict();

async function checkUsername(req, res) {
  const username = normalizeUsername(req.query.username);
  if (!validUsername(username)) return ok(res, { valid: false, available: false, reason: 'Use 3–30 letters, numbers, dots, or underscores.' });
  const exists = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  return ok(res, { valid: true, available: !exists });
}

async function signup(req, res) {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields.', parsed.error.flatten().fieldErrors);
  const { password, displayName } = parsed.data;
  if (Buffer.byteLength(password, 'utf8') > 72) throw new HttpError(400, 'INVALID_PASSWORD', 'Passwords must be 72 bytes or fewer.');
  const username = normalizeUsername(parsed.data.username);
  if (!validUsername(username)) throw new HttpError(400, 'INVALID_USERNAME', 'Use 3–30 letters, numbers, dots, or underscores.');
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const user = await prisma.user.create({
      data: { username, passwordHash, profile: { create: { displayName: displayName || username } } },
      select: { id: true, username: true, image: true, profile: true }
    });
    return ok(res, { user }, 201);
  } catch (error) {
    if (error.code === 'P2002') {
      throw new HttpError(409, 'DUPLICATE_ACCOUNT_FIELD', 'That username is already registered.', { field: 'username' });
    }
    throw error;
  }
}

async function login(req, res) {
  const parsed = z.object({ identifier: z.string().trim().min(1).max(30), password: z.string().min(1).max(72) }).strict().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Enter your username and password.');
  const identifier = normalizeUsername(parsed.data.identifier);
  const user = validUsername(identifier) ? await prisma.user.findUnique({ where: { username: identifier }, select: { id: true, username: true, image: true, passwordHash: true, profile: true } }) : null;
  const valid = user?.passwordHash && await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!valid) throw new HttpError(401, 'INVALID_CREDENTIALS', 'The username or password is incorrect.');
  const { passwordHash, ...safeUser } = user;
  return ok(res, { user: safeUser });
}

async function syncGoogle(req, res) {
  const parsed = z.object({
    providerAccountId: z.string().min(1).max(255),
    email: z.email().max(254).optional(),
    name: z.string().max(60).optional(),
    image: z.url().max(2048).nullable().optional()
  }).strict().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Google account data is invalid.');
  const { providerAccountId } = parsed.data;
  const key = { provider_providerAccountId: { provider: 'google', providerAccountId } };
  let identity = await prisma.oAuthIdentity.findUnique({ where: key, select: { user: { select: { id: true, username: true } } } });
  if (identity) return ok(res, { user: identity.user });

  // Historical Google-only accounts have no provider subject. Email alone
  // cannot prove ownership, so pause migration for manual account linking.
  const legacy = parsed.data.email && await prisma.user.findUnique({
    where: { email: normalizeEmail(parsed.data.email) }, select: { id: true, passwordHash: true }
  });
  if (legacy && !legacy.passwordHash) throw new HttpError(409, 'LEGACY_GOOGLE_LINK_REQUIRED', 'This existing Google account needs a secure account link before sign-in.');

  const name = parsed.data.name?.trim();
  const image = parsed.data.image || null;
  let user;
  for (let attempt = 0; attempt < 5 && !user; attempt += 1) {
    const username = `member_${crypto.randomBytes(9).toString('hex')}`;
    try {
      user = await prisma.$transaction(async (tx) => tx.user.create({
        data: { username, image, profile: { create: { displayName: name || username, avatarUrl: image } },
          oauthIdentities: { create: { provider: 'google', providerAccountId } } },
        select: { id: true, username: true }
      }));
    } catch (error) {
      if (error.code !== 'P2002') throw error;
      identity = await prisma.oAuthIdentity.findUnique({ where: key, select: { user: { select: { id: true, username: true } } } });
      if (identity) user = identity.user;
    }
  }
  if (!user) throw new HttpError(409, 'ACCOUNT_SYNC_CONFLICT', 'Google sign-in could not be completed. Try again.');
  return ok(res, { user });
}

async function me(req, res) {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
      select: { id: true, username: true, image: true, passwordHash: true, createdAt: true, profile: true, personalizedRecs: true, _count: { select: { followers: { where: { accepted: true } }, following: { where: { accepted: true } }, posts: true } } }
  });
  if (!user) throw new HttpError(401, 'SESSION_EXPIRED', 'Your account is no longer available. Please sign in again.');
  const { passwordHash, ...safeUser } = user;
  return ok(res, { user: { ...safeUser, hasPassword: Boolean(passwordHash), isAdmin: isAdminUsername(user.username) } });
}

module.exports = { checkUsername, signup, login, syncGoogle, me };

const { HttpError } = require('../utils/http');
const prisma = require('../config/prisma');

function isAdminUsername(username) {
  const configured = String(process.env.ADMIN_USERNAMES || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  return Boolean(username && configured.includes(String(username).toLowerCase()));
}

function createRequireAdmin(findUserById = (id) => prisma.user.findUnique({ where: { id }, select: { username: true } })) {
  return async function requireAdmin(req, _res, next) {
    if (!req.user?.id) return next(new HttpError(403, 'FORBIDDEN', 'Administrator access is required.'));
    try {
      const account = await findUserById(req.user.id);
      if (!account || !isAdminUsername(account.username)) return next(new HttpError(403, 'FORBIDDEN', 'Administrator access is required.'));
      req.user.username = account.username;
      next();
    } catch (error) {
      next(error);
    }
  };
}

const requireAdmin = createRequireAdmin();
module.exports = { isAdminUsername, requireAdmin, createRequireAdmin };

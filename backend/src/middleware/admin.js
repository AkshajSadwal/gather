const { HttpError } = require('../utils/http');

function isAdminUsername(username) {
  const configured = String(process.env.ADMIN_USERNAMES || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  return Boolean(username && configured.includes(String(username).toLowerCase()));
}

function requireAdmin(req, _res, next) {
  if (!req.user || !isAdminUsername(req.user.username)) return next(new HttpError(403, 'FORBIDDEN', 'Administrator access is required.'));
  next();
}

module.exports = { isAdminUsername, requireAdmin };

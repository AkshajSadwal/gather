const USERNAME_RE = /^[a-z0-9._]{3,30}$/;

function normalizeUsername(value) {
  return String(value || '').trim().normalize('NFKC').toLowerCase();
}

function normalizeEmail(value) {
  return String(value || '').trim().normalize('NFKC').toLowerCase();
}

function validUsername(value) {
  return USERNAME_RE.test(value) && !value.startsWith('.') && !value.endsWith('.') && !value.includes('..');
}

module.exports = { normalizeUsername, normalizeEmail, validUsername };

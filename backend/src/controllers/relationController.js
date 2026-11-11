const { z } = require('zod');
const { HttpError, ok } = require('../utils/http');
const { listMutes, toggleMute } = require('../services/relations');

const usernameSchema = z.string().trim().min(3).max(30).regex(/^[a-zA-Z0-9._]+$/);

async function mutes(req, res) {
  return ok(res, { mutes: await listMutes(req.user.id) });
}

async function toggleMuteRoute(req, res) {
  const parsed = usernameSchema.safeParse(req.params.username);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'That username is invalid.');
  return ok(res, await toggleMute(req.user.id, parsed.data.toLowerCase()));
}

module.exports = { mutes, toggleMuteRoute };

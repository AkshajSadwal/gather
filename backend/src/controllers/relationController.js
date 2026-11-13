const { z } = require('zod');
const { HttpError, ok } = require('../utils/http');
const { listMutes, toggleMute } = require('../services/relations');
const prisma = require('../config/prisma');
const { logReelEvent } = require('../services/recoEvents');

const usernameSchema = z.string().trim().min(3).max(30).regex(/^[a-zA-Z0-9._]+$/);

async function mutes(req, res) {
  return ok(res, { mutes: await listMutes(req.user.id) });
}

async function toggleMuteRoute(req, res) {
  const parsed = usernameSchema.safeParse(req.params.username);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'That username is invalid.');
  const target = await prisma.user.findUnique({ where: { username: parsed.data.toLowerCase() }, select: { id: true } });
  const result = await toggleMute(req.user.id, parsed.data.toLowerCase());
  if (result.muted && target) logReelEvent({ userId: req.user.id, creatorId: target.id, type: 'CREATOR_MUTE' });
  return ok(res, result);
}

module.exports = { mutes, toggleMuteRoute };

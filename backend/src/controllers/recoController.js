const { z } = require('zod');
const { HttpError, ok } = require('../utils/http');
const { clientEventSchema, recordReelEvent } = require('../services/recoEvents');

const batchSchema = z.object({ events: z.array(clientEventSchema).min(1).max(50) }).strict();

async function ingestEvents(req, res) {
  const parsed = batchSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Send up to 50 valid reel events.', parsed.error.flatten().fieldErrors);
  const results = await Promise.all(parsed.data.events.map((event) => recordReelEvent(req.user.id, event, { allowClientTypes: true })));
  return ok(res, {
    accepted: results.filter((result) => result.accepted).length,
    duplicates: results.filter((result) => result.duplicate).length,
    rejected: results.filter((result) => result.rejected || result.disabled).length
  });
}

module.exports = { ingestEvents };

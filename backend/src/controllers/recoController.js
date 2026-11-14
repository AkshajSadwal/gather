const { z } = require('zod');
const { HttpError, ok } = require('../utils/http');
const { clientEventSchema, recordReelEvent } = require('../services/recoEvents');

const batchSchema = z.object({ events: z.array(clientEventSchema).min(1).max(50) }).strict();

function createRecoController(recordEvent = recordReelEvent) {
  async function ingestEvents(req, res) {
    const parsed = batchSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Send up to 50 valid reel events.', parsed.error.flatten().fieldErrors);
    const counts = { accepted: 0, duplicates: 0, rejected: 0 };
    for (const event of parsed.data.events) {
      const result = await recordEvent(req.user.id, event, { allowClientTypes: true });
      if (result.accepted) counts.accepted += 1;
      if (result.duplicate) counts.duplicates += 1;
      if (result.rejected || result.disabled) counts.rejected += 1;
    }
    return ok(res, counts);
  }

  return { ingestEvents };
}

module.exports = { ...createRecoController(), createRecoController };

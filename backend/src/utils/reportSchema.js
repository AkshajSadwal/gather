const { z } = require('zod');

const REPORT_REASONS = ['SPAM', 'HARASSMENT', 'HATE_OR_ABUSE', 'NUDITY_OR_SEXUAL', 'VIOLENCE', 'SELF_HARM', 'IMPERSONATION', 'OTHER'];

// Exactly one target: an account (by username) or a post (by id).
const reportSchema = z.object({
  username: z.string().trim().min(1).max(60).optional(),
  postId: z.string().trim().min(1).max(64).optional(),
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(1000).optional().default('')
}).refine((value) => Boolean(value.username) !== Boolean(value.postId), {
  message: 'Report either an account or a post, not both.'
});

module.exports = { reportSchema, REPORT_REASONS };

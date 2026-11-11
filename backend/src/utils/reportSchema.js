const { z } = require('zod');

const REPORT_REASONS = ['SPAM', 'HARASSMENT', 'INAPPROPRIATE', 'IMPERSONATION', 'OTHER'];

const reportSchema = z.object({
  targetType: z.enum(['POST', 'COMMENT', 'USER']),
  targetId: z.string().trim().min(1).max(64),
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(500).optional().default('')
});

module.exports = { reportSchema, REPORT_REASONS };

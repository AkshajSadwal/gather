const { sessionUserFromCookie } = require('../middleware/auth');
const { authorizeMediaReference } = require('../middleware/mediaAccess');
const { getSignedUrl } = require('../services/storage');
const { HttpError } = require('../utils/http');

async function serve(req, res) {
  const reference = String(req.query.key || '');
  if (!reference.startsWith('s3://')) throw new HttpError(400, 'MEDIA_REFERENCE_INVALID', 'The media reference is invalid.');
  let userId;
  try {
    const user = await sessionUserFromCookie(req.headers.cookie);
    userId = user?.id;
  } catch {
    userId = undefined;
  }
  const result = await authorizeMediaReference(reference, userId);
  if (!result.exists) throw new HttpError(404, 'MEDIA_NOT_FOUND', 'That media could not be found.');
  if (!result.allowed) throw new HttpError(403, 'MEDIA_PRIVATE', 'You do not have access to this media.');
  const signedUrl = await getSignedUrl(reference);
  res.redirect(302, signedUrl);
}

module.exports = { serve };

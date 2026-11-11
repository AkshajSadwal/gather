const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { requireAuth, requireInternal } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { asyncHandler } = require('../utils/http');
const auth = require('../controllers/authController');
const users = require('../controllers/userController');
const posts = require('../controllers/postController');
const messages = require('../controllers/messageController');
const stories = require('../controllers/storyController');
const reels = require('../controllers/reelController');
const notifications = require('../controllers/notificationController');
const reports = require('../controllers/reportController');
const media = require('../controllers/mediaController');
const relations = require('../controllers/relationController');
const account = require('../controllers/accountController');

const router = express.Router();
const accountOrIpKey = (req) => req.user?.id ? `user:${req.user.id}` : `ip:${ipKeyGenerator(req.ip)}`;
const rateLimitHandler = (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' } });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, keyGenerator: accountOrIpKey, handler: rateLimitHandler, standardHeaders: 'draft-8', legacyHeaders: false });
const availabilityLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, keyGenerator: accountOrIpKey, handler: rateLimitHandler, standardHeaders: 'draft-8', legacyHeaders: false });
const reportLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, keyGenerator: accountOrIpKey, handler: rateLimitHandler, standardHeaders: 'draft-8', legacyHeaders: false });
const writeLimiter = rateLimit({ windowMs: 60 * 1000, limit: 50, keyGenerator: accountOrIpKey, handler: rateLimitHandler, standardHeaders: 'draft-8', legacyHeaders: false });
const searchLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, keyGenerator: accountOrIpKey, handler: rateLimitHandler, standardHeaders: 'draft-8', legacyHeaders: false });
const readLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, keyGenerator: accountOrIpKey, handler: rateLimitHandler, standardHeaders: 'draft-8', legacyHeaders: false });
const uploadIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many uploads from this network. Try again later.' } })
});
const uploadAccountLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => req.user.id,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many uploads for this account. Try again later.' } })
});
const route = (handler) => asyncHandler(handler);
const maybeAuth = async (req, _res, next) => {
  try { const { sessionUserFromCookie } = require('../middleware/auth'); req.user = await sessionUserFromCookie(req.headers.cookie); next(); }
  catch (error) { next(error); }
};

router.get('/auth/me', requireAuth, route(auth.me));
router.post('/auth/signup', maybeAuth, authLimiter, route(auth.signup));
router.post('/auth/login', maybeAuth, authLimiter, route(auth.login));
router.post('/auth/change-password', requireAuth, authLimiter, route(account.changePassword));
router.post('/auth/google-sync', requireInternal, route(auth.syncGoogle));
router.get('/users/check-username', maybeAuth, availabilityLimiter, route(auth.checkUsername));
router.get('/users/check-email', maybeAuth, availabilityLimiter, route(auth.checkEmail));
router.get('/users/suggestions', maybeAuth, route(messages.suggestions));
router.get('/users/:username', maybeAuth, route(users.profile));
router.patch('/users/me/profile', requireAuth, writeLimiter, route(users.updateProfile));
router.delete('/users/me', requireAuth, writeLimiter, route(account.deleteAccount));
router.post('/users/me/avatar', requireAuth, uploadIpLimiter, uploadAccountLimiter, writeLimiter, upload.single('media'), route(users.updateAvatar));
router.post('/follows/:username/toggle', requireAuth, writeLimiter, route(users.follow));
router.delete('/follows/followers/:username', requireAuth, writeLimiter, route(users.removeFollower));
router.get('/blocks', requireAuth, route(users.listBlocks));
router.post('/blocks/:username/toggle', requireAuth, writeLimiter, route(users.toggleBlock));
router.get('/mutes', requireAuth, route(relations.mutes));
router.post('/mutes/:username/toggle', requireAuth, writeLimiter, route(relations.toggleMuteRoute));
router.get('/users/:username/followers', maybeAuth, route(users.listRelation));
router.get('/users/:username/following', maybeAuth, route(users.listRelation));
router.get('/follows/requests', requireAuth, route(users.followRequests));
router.patch('/follows/requests/:id', requireAuth, route(users.updateFollowRequest));
router.get('/search', maybeAuth, searchLimiter, route(users.search));
router.post('/reports', requireAuth, reportLimiter, route(reports.create));
router.get('/media', route(media.serve));

router.get('/posts/feed', requireAuth, route(posts.feed));
router.get('/posts/saved', requireAuth, route(posts.saved));
router.get('/posts/explore', maybeAuth, route(posts.explore));
router.post('/posts', requireAuth, uploadIpLimiter, uploadAccountLimiter, writeLimiter, upload.array('media', 10), route(posts.create));
router.get('/posts/:id', maybeAuth, route(posts.detail));
router.patch('/posts/:id', requireAuth, writeLimiter, route(posts.updateCaption));
router.delete('/posts/:id', requireAuth, writeLimiter, route(posts.remove));
router.post('/posts/:id/like', requireAuth, writeLimiter, route(posts.toggleLike));
router.post('/posts/:id/bookmark', requireAuth, writeLimiter, route(posts.toggleBookmark));
router.get('/posts/:id/comments', maybeAuth, route(posts.listComments));
router.post('/posts/:id/comments', requireAuth, writeLimiter, route(posts.createComment));
router.get('/comments/:commentId/replies', maybeAuth, route(posts.listReplies));
router.delete('/comments/:commentId', requireAuth, writeLimiter, route(posts.deleteComment));
router.get('/notifications', requireAuth, route(notifications.list));
router.get('/notifications/unread', requireAuth, route(notifications.unread));
router.get('/notifications/unread-count', requireAuth, route(notifications.unread));
router.post('/notifications/:id/read', requireAuth, readLimiter, route(notifications.markRead));

router.get('/messages/conversations', requireAuth, route(messages.conversations));
router.get('/messages/unread', requireAuth, route(messages.unread));
router.delete('/messages/:messageId', requireAuth, writeLimiter, route(messages.removeMessage));
router.post('/messages/conversations/:username', requireAuth, writeLimiter, route(messages.openConversation));
router.get('/messages/conversations/:id', requireAuth, route(messages.messages));
router.post('/messages/conversations/:id/read', requireAuth, route(messages.markRead));

router.get('/stories', requireAuth, route(stories.list));
router.post('/stories', requireAuth, uploadIpLimiter, uploadAccountLimiter, writeLimiter, upload.single('media'), route(stories.create));
router.post('/stories/:id/view', requireAuth, route(stories.view));
router.delete('/stories/:id', requireAuth, writeLimiter, route(stories.remove));
router.get('/stories/:id/viewers', requireAuth, route(stories.viewers));
router.get('/reels', maybeAuth, route(reels.list));
router.post('/reels', requireAuth, uploadIpLimiter, uploadAccountLimiter, writeLimiter, upload.single('media'), route(reels.create));

module.exports = router;

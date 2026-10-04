const express = require('express');
const { rateLimit } = require('express-rate-limit');
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

const router = express.Router();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });
const availabilityLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false });
const reportLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });
const writeLimiter = rateLimit({ windowMs: 60 * 1000, limit: 50, standardHeaders: 'draft-8', legacyHeaders: false });
const route = (handler) => asyncHandler(handler);
const maybeAuth = async (req, _res, next) => {
  try { const { sessionUserFromCookie } = require('../middleware/auth'); req.user = await sessionUserFromCookie(req.headers.cookie); next(); }
  catch (error) { next(error); }
};

router.get('/auth/me', requireAuth, route(auth.me));
router.post('/auth/signup', authLimiter, route(auth.signup));
router.post('/auth/login', authLimiter, route(auth.login));
router.post('/auth/google-sync', requireInternal, route(auth.syncGoogle));
router.get('/users/check-username', availabilityLimiter, route(auth.checkUsername));
router.get('/users/check-email', availabilityLimiter, route(auth.checkEmail));
router.get('/users/suggestions', maybeAuth, route(messages.suggestions));
router.get('/users/:username', maybeAuth, route(users.profile));
router.patch('/users/me/profile', requireAuth, writeLimiter, route(users.updateProfile));
router.post('/users/me/avatar', requireAuth, writeLimiter, upload.single('media'), route(users.updateAvatar));
router.post('/follows/:username/toggle', requireAuth, writeLimiter, route(users.follow));
router.delete('/follows/followers/:username', requireAuth, writeLimiter, route(users.removeFollower));
router.get('/blocks', requireAuth, route(users.listBlocks));
router.post('/blocks/:username/toggle', requireAuth, writeLimiter, route(users.toggleBlock));
router.get('/users/:username/followers', maybeAuth, route(users.listRelation));
router.get('/users/:username/following', maybeAuth, route(users.listRelation));
router.get('/follows/requests', requireAuth, route(users.followRequests));
router.patch('/follows/requests/:id', requireAuth, route(users.updateFollowRequest));
router.get('/search', route(users.search));
router.post('/reports', requireAuth, reportLimiter, route(reports.create));
router.get('/media', route(media.serve));

router.get('/posts/feed', requireAuth, route(posts.feed));
router.get('/posts/explore', maybeAuth, route(posts.explore));
router.post('/posts', requireAuth, writeLimiter, upload.array('media', 10), route(posts.create));
router.get('/posts/:id', maybeAuth, route(posts.detail));
router.delete('/posts/:id', requireAuth, route(posts.remove));
router.post('/posts/:id/like', requireAuth, writeLimiter, route(posts.toggleLike));
router.post('/posts/:id/bookmark', requireAuth, writeLimiter, route(posts.toggleBookmark));
router.get('/posts/:id/comments', maybeAuth, route(posts.listComments));
router.post('/posts/:id/comments', requireAuth, writeLimiter, route(posts.createComment));
router.delete('/comments/:commentId', requireAuth, route(posts.deleteComment));
router.get('/notifications', requireAuth, route(notifications.list));
router.get('/notifications/unread', requireAuth, route(notifications.unread));
router.post('/notifications/:id/read', requireAuth, route(notifications.markRead));

router.get('/messages/conversations', requireAuth, route(messages.conversations));
router.get('/messages/unread', requireAuth, route(messages.unread));
router.post('/messages/conversations/:username', requireAuth, writeLimiter, route(messages.openConversation));
router.get('/messages/conversations/:id', requireAuth, route(messages.messages));
router.post('/messages/conversations/:id/read', requireAuth, route(messages.markRead));

router.get('/stories', requireAuth, route(stories.list));
router.post('/stories', requireAuth, writeLimiter, upload.single('media'), route(stories.create));
router.post('/stories/:id/view', requireAuth, route(stories.view));
router.delete('/stories/:id', requireAuth, route(stories.remove));
router.get('/stories/:id/viewers', requireAuth, route(stories.viewers));
router.get('/reels', maybeAuth, route(reels.list));
router.post('/reels', requireAuth, writeLimiter, upload.single('media'), route(reels.create));

module.exports = router;

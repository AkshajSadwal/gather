const prisma = require('../config/prisma');
const { removeLocal } = require('./storage');

async function deletePostContentInTransaction(database, postId) {
  const post = await database.post.findUnique({ where: { id: postId }, select: { id: true, media: { select: { url: true } }, reel: { include: { media: { select: { url: true } } } } } });
  if (!post) return { deleted: false, mediaUrls: [] };
  const mediaUrls = [...post.media.map((item) => item.url), ...(post.reel?.media.map((item) => item.url) || [])];
  await database.post.delete({ where: { id: post.id } });
  return { deleted: true, mediaUrls };
}

async function removeMediaBestEffort(mediaUrls) {
  await Promise.all([...new Set(mediaUrls)].map((url) => removeLocal(url).catch(() => {})));
}

async function deletePostContent(postId) {
  const result = await deletePostContentInTransaction(prisma, postId);
  if (result.deleted) await removeMediaBestEffort(result.mediaUrls);
  return result.deleted;
}

module.exports = { deletePostContent, deletePostContentInTransaction, removeMediaBestEffort };

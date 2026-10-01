const path = require('node:path');
const { createRequire } = require('node:module');
const backendRequire = createRequire(path.resolve(__dirname, '../backend/package.json'));
const bcrypt = backendRequire('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const demoPassword = 'GatherDemo2026!';
const people = [
  { username: 'maya', email: 'maya@example.test', name: 'Maya Chen', bio: 'Collecting quiet mornings, good light, and new recipes.', image: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=240&h=240&fit=crop&crop=faces' },
  { username: 'noah', email: 'noah@example.test', name: 'Noah Williams', bio: 'Outdoors when I can be. Private account for this demo.', image: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=240&h=240&fit=crop&crop=faces', visibility: 'PRIVATE' },
  { username: 'amara', email: 'amara@example.test', name: 'Amara Okafor', bio: 'Color, design, and tiny corners of the world.', image: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=240&h=240&fit=crop&crop=faces' },
  { username: 'leo', email: 'leo@example.test', name: 'Leo Park', bio: 'Weekend hikes and a camera that is always running.', image: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=240&h=240&fit=crop&crop=faces' },
  { username: 'sofia', email: 'sofia@example.test', name: 'Sofia Rivera', bio: 'Making things slowly, sharing them happily.', image: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=240&h=240&fit=crop&crop=faces' }
];
const photoUrls = [
  'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?w=1200&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=1200&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=1200&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1518837695005-2083093ee35b?w=1200&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=1200&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=1200&auto=format&fit=crop'
];

async function main() {
  const passwordHash = await bcrypt.hash(demoPassword, 12);
  const users = [];
  for (const person of people) {
    const user = await prisma.user.upsert({
      where: { username: person.username },
      create: { username: person.username, email: person.email, passwordHash, image: person.image, profile: { create: { displayName: person.name, bio: person.bio, avatarUrl: person.image, visibility: person.visibility || 'PUBLIC' } } },
      update: { email: person.email, passwordHash, image: person.image, profile: { upsert: { create: { displayName: person.name, bio: person.bio, avatarUrl: person.image, visibility: person.visibility || 'PUBLIC' }, update: { displayName: person.name, bio: person.bio, avatarUrl: person.image, visibility: person.visibility || 'PUBLIC' } } } }
    });
    users.push(user);
  }
  const ids = users.map((user) => user.id);
  const userIds = Object.fromEntries(users.map((user) => [user.username, user.id]));
  const directKey = [userIds.maya, userIds.amara].sort().join(':');
  await prisma.$transaction([
    prisma.conversation.deleteMany({ where: { directKey } }),
    prisma.reel.deleteMany({ where: { authorId: { in: ids } } }),
    prisma.story.deleteMany({ where: { authorId: { in: ids } } }),
    prisma.post.deleteMany({ where: { authorId: { in: ids } } }),
    prisma.notification.deleteMany({ where: { OR: [{ recipientId: { in: ids } }, { actorId: { in: ids } }] } }),
    prisma.follow.deleteMany({ where: { OR: [{ followerId: { in: ids } }, { followedId: { in: ids } }] } })
  ]);
  await prisma.follow.createMany({ data: [
    { followerId: userIds.maya, followedId: userIds.amara }, { followerId: userIds.maya, followedId: userIds.leo },
    { followerId: userIds.amara, followedId: userIds.maya }, { followerId: userIds.leo, followedId: userIds.sofia },
    { followerId: userIds.sofia, followedId: userIds.amara }, { followerId: userIds.leo, followedId: userIds.noah, accepted: false }
  ] });

  const postSpecs = [
    ['maya', 'A slow start, a warm cup, and nowhere else to be. #morning #littlethings'],
    ['amara', 'Found a tiny flower market tucked behind the station. #color #weekend'],
    ['leo', 'The kind of view that makes you forget to check your phone. #outside #hiking'],
    ['sofia', 'Blue hour over the water. #ocean #evening'],
    ['noah', 'A trail worth waking up early for. #hiking #quiet']
  ];
  const createdPosts = [];
  for (let index = 0; index < postSpecs.length; index++) {
    const [username, caption] = postSpecs[index];
    const tags = [...new Set((caption.match(/#[\p{L}\p{N}_]+/gu) || []).map((tag) => tag.slice(1).toLowerCase()))];
    const post = await prisma.post.create({
      data: {
        authorId: userIds[username], caption,
        media: { create: [{ url: photoUrls[index], type: 'IMAGE', mimeType: 'image/jpeg', sizeBytes: 0, position: 0 }] },
        hashtags: {
          create: tags.map((tag) => ({
            hashtag: { connectOrCreate: { where: { tag }, create: { tag } } }
          }))
        }
      }
    });
    createdPosts.push(post);
  }
  await prisma.like.createMany({ data: [
    { userId: userIds.amara, postId: createdPosts[0].id }, { userId: userIds.leo, postId: createdPosts[0].id },
    { userId: userIds.maya, postId: createdPosts[1].id }, { userId: userIds.sofia, postId: createdPosts[2].id }
  ] });
  await prisma.comment.createMany({ data: [
    { userId: userIds.amara, postId: createdPosts[0].id, body: 'This looks like a lovely morning.' },
    { userId: userIds.maya, postId: createdPosts[1].id, body: 'Adding this market to my list!' }
  ] });
  await prisma.notification.createMany({ data: [
    { recipientId: userIds.maya, actorId: userIds.amara, type: 'LIKE', entityId: createdPosts[0].id },
    { recipientId: userIds.maya, actorId: userIds.leo, type: 'FOLLOW' },
    { recipientId: userIds.noah, actorId: userIds.leo, type: 'FOLLOW' }
  ] });

  const story = await prisma.story.create({ data: { authorId: userIds.maya, caption: 'The first good light of the day.', expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), media: { create: { url: photoUrls[0], type: 'IMAGE', mimeType: 'image/jpeg', sizeBytes: 0 } } } });
  await prisma.story.create({ data: { authorId: userIds.amara, caption: 'Weekend color.', expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), media: { create: { url: photoUrls[2], type: 'IMAGE', mimeType: 'image/jpeg', sizeBytes: 0 } } } });
  await prisma.storyView.create({ data: { storyId: story.id, viewerId: userIds.leo } });

  const videoUrl = 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4';
  const reelPost = await prisma.post.create({ data: { authorId: userIds.leo, caption: 'A little road trip for your afternoon. #weekend #reel', media: { create: { url: videoUrl, type: 'VIDEO', mimeType: 'video/mp4', sizeBytes: 0, position: 0 } } } });
  await prisma.reel.create({ data: { authorId: userIds.leo, postId: reelPost.id, caption: reelPost.caption, media: { create: { url: videoUrl, mimeType: 'video/mp4', sizeBytes: 0 } } } });

  const conversation = await prisma.conversation.create({ data: { directKey, participants: { create: [{ userId: userIds.maya }, { userId: userIds.amara }] } } });
  await prisma.message.createMany({ data: [
    { conversationId: conversation.id, senderId: userIds.amara, body: 'I found a little place I think you would love.' },
    { conversationId: conversation.id, senderId: userIds.maya, body: 'Send me the details when you have a second!' }
  ] });
  console.log(`Seeded ${users.length} demo accounts. Demo password for each: ${demoPassword}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());

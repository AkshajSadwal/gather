const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const read = (file) => readFileSync(path.join(__dirname, '..', file), 'utf8');

test('PostCard opens the shared media-and-comments dialog and preserves carousel state', () => {
  const postCard = read('frontend/components/PostCard.jsx');
  const dialog = read('frontend/components/PostCommentsDialog.jsx');
  const homePage = read('frontend/app/page.js');
  const css = read('frontend/app/globals.css');

  assert.match(postCard, /const openComments = \(\) => setCommentsOpen\(true\)/);
  assert.match(postCard, /<PostCommentsDialog post=\{post\} media=\{media\} mediaIndex=\{mediaIndex\} onMediaIndexChange=\{setMediaIndex\}/);
  assert.match(postCard, /max-h-\[620px\][^>]*object-contain/);
  assert.match(postCard, /aria-label="Previous media"/);
  assert.match(postCard, /aria-label="Next media"/);
  assert.match(dialog, /role="dialog" aria-modal="true"/);
  assert.match(css, /\.post-comments-dialog\s*\{[^}]*grid-template-columns:minmax\(0,1fr\) 380px/s);
  assert.match(dialog, /<CommentsPanel key=\{post\.id\} postId=\{post\.id\}/);
  assert.match(homePage, /max-w-\[560px\]/);
});

test('Reels show shared comments for the active desktop Reel and a mobile sheet', () => {
  const reels = read('frontend/components/ReelsView.jsx');
  const css = read('frontend/app/globals.css');

  assert.match(reels, /watch-comments-panel[^>]*onWheel=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(reels, /desktopCommentsEnabled && reelIndex === activeIndex && reel\.post\?\.id \? <CommentsPanel/);
  assert.match(reels, /commentReel && !desktopCommentsEnabled/);
  assert.match(reels, /if \(event\.target\?\.closest\?\.\('\[data-reel-comments\]'\)\) return/);
  assert.match(reels, /className="comments-panel--fill min-h-0 p-4"/);
  assert.match(css, /\.watch-comments-panel\s*\{[^}]*overscroll-behavior:contain/s);
  assert.match(css, /\.comments-panel--fill \.comments-list\s*\{[^}]*overscroll-behavior-y:contain/s);
});

test('shared comments retain auth, submit, pagination, replies, likes, and retry paths', () => {
  const comments = read('frontend/components/CommentsPanel.jsx');

  assert.match(comments, /api\(`\/posts\/\$\{encodeURIComponent\(postId\)\}\/comments\?/);
  assert.match(comments, /method: 'POST'.*body: JSON\.stringify\(\{ body: draft/);
  assert.match(comments, /status === 'authenticated' \? <form/);
  assert.match(comments, /\/comments\/\$\{encodeURIComponent\(parentId\)\}\/replies/);
  assert.match(comments, /\/comments\/\$\{encodeURIComponent\(item\.id\)\}\/like/);
  assert.match(comments, /loadingRef\.current/);
  assert.match(comments, /submittingRef\.current/);
  assert.match(comments, /Retry loading comments/);
});

test('comment layouts keep their lists bounded and the post modal keyboard-sized', () => {
  const css = read('frontend/app/globals.css');
  assert.match(css, /\.post-comments-aside\s*\{[^}]*grid-template-rows:auto auto minmax\(0,1fr\)/s);
  assert.match(css, /grid-template-rows:minmax\(0,40dvh\) minmax\(0,1fr\)/);
  assert.match(css, /\.comments-panel--fill \.comments-list\s*\{[^}]*min-height:0; max-height:none/s);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const read = (file) => readFileSync(path.join(__dirname, '..', file), 'utf8');

test('shared post preview selects images and lightweight videos with safe missing/error fallbacks', () => {
  const preview = read('frontend/components/PostMediaPreview.jsx');
  assert.match(preview, /media\?\.type === 'VIDEO' \? <video/);
  assert.match(preview, /: <img src=\{source\}/);
  assert.match(preview, /!source \|\| failed/);
  assert.match(preview, /onError=\{\(\) => setFailed\(true\)\}/);
  assert.match(preview, /preload="metadata"/);
  assert.match(preview, /muted playsInline/);
  assert.match(preview, /object-cover/);
  assert.match(preview, /Video post/);
});

test('Explore, hashtag, search, and profile grid previews keep tiles linked to the matching post', () => {
  for (const file of [
    'frontend/components/ExploreView.jsx',
    'frontend/app/tags/[tag]/page.js',
    'frontend/components/SearchView.jsx',
    'frontend/components/ProfileView.jsx'
  ]) {
    const source = read(file);
    assert.match(source, /href=\{`\/post\/\$\{post\.id\}`\}/, `${file} should link each tile to its post`);
    assert.match(source, /<PostMediaPreview media=\{post\.media\??\.\[0\]\}/, `${file} should render media by type`);
  }
});

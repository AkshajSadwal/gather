const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const playbackModule = import('../frontend/lib/reelPlayback.mjs');

function fakeVideo(playPromise = Promise.resolve()) {
  return {
    muted: true,
    paused: true,
    play() { this.paused = false; return playPromise; },
    pause() { this.paused = true; }
  };
}

function fakeStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); }
  };
}

test('Reels sound preference carries between reels and component sessions', async () => {
  const { createReelPlaybackController, readReelMutedPreference, writeReelMutedPreference } = await playbackModule;
  const storage = fakeStorage();
  const muted = { value: readReelMutedPreference(storage) };
  const videos = new Map();
  const controller = createReelPlaybackController({ getVideos: () => videos, getMuted: () => muted.value, setPlaying() {} });
  const reelA = fakeVideo();
  const reelB = fakeVideo();
  const reelC = fakeVideo();
  videos.set('a', reelA); videos.set('b', reelB); videos.set('c', reelC);

  assert.equal(muted.value, false);
  muted.value = false;
  writeReelMutedPreference(storage, muted.value);
  await controller.play(reelA, 'a');
  await controller.play(reelB, 'b');
  assert.equal(reelA.paused, true);
  assert.equal(reelB.muted, false);
  assert.equal(readReelMutedPreference(storage), false);

  muted.value = true;
  writeReelMutedPreference(storage, muted.value);
  await controller.play(reelC, 'c');
  assert.equal(reelB.paused, true);
  assert.equal(reelC.muted, true);
  controller.dispose();
  assert.equal(reelC.paused, true);
});

test('Story and Reel manual mute controls stay in sync and persist the sound preference', async () => {
  const { readReelMutedPreference, setVideoMuted, writeReelMutedPreference } = await playbackModule;
  const storage = fakeStorage();
  const video = fakeVideo();
  const muteStates = [];

  assert.equal(readReelMutedPreference(storage), false);
  assert.equal(setVideoMuted(video, true, (muted) => muteStates.push(muted)), true);
  writeReelMutedPreference(storage, true);
  assert.equal(readReelMutedPreference(storage), true);
  assert.equal(setVideoMuted(video, false, (muted) => muteStates.push(muted)), false);
  writeReelMutedPreference(storage, false);
  assert.equal(readReelMutedPreference(storage), false);
  assert.deepEqual(muteStates, [true, false]);
});

test('sound autoplay rejection retries muted without leaking an unhandled error', async () => {
  const { playVideoWithSoundFallback } = await playbackModule;
  const mutedChanges = [];
  const video = {
    muted: false,
    paused: true,
    attempts: 0,
    play() {
      this.attempts += 1;
      if (this.attempts === 1) return Promise.reject(new Error('autoplay blocked'));
      this.paused = false;
      return Promise.resolve();
    },
    pause() { this.paused = true; }
  };

  assert.equal(await playVideoWithSoundFallback(video, false, () => true, (muted) => mutedChanges.push(muted)), true);
  assert.equal(video.muted, true);
  assert.equal(video.attempts, 2);
  assert.deepEqual(mutedChanges, [false, true]);
});

test('stale play promises cannot reactivate an inactive reel', async () => {
  const { createReelPlaybackController } = await playbackModule;
  let resolveFirstPlay;
  const firstVideo = fakeVideo(new Promise((resolve) => { resolveFirstPlay = resolve; }));
  const secondVideo = fakeVideo();
  const videos = new Map([['first', firstVideo], ['second', secondVideo]]);
  const updates = [];
  const controller = createReelPlaybackController({
    getVideos: () => videos,
    getMuted: () => true,
    setPlaying: (id, playing) => updates.push([id, playing])
  });

  const firstRequest = controller.play(firstVideo, 'first');
  await controller.play(secondVideo, 'second');
  resolveFirstPlay();
  await firstRequest;

  assert.equal(firstVideo.paused, true);
  assert.equal(controller.isActive('second'), true);
  assert.equal(updates.some(([id, playing]) => id === 'first' && playing), false);
});

test('previous and next Reel navigation respects the list boundaries', async () => {
  const { adjacentReelIndex } = await playbackModule;
  assert.equal(adjacentReelIndex(1, -1, 3), 0);
  assert.equal(adjacentReelIndex(1, 1, 3), 2);
  assert.equal(adjacentReelIndex(0, -1, 3), null);
  assert.equal(adjacentReelIndex(2, 1, 3), null);
});

test('keyboard navigation ignores controls and wheel navigation throttles repeated events', async () => {
  const { createWheelNavigationGate, getReelNavigationDirection } = await playbackModule;
  const control = { closest: () => ({}) };
  const page = { closest: () => null };
  assert.equal(getReelNavigationDirection({ key: 'ArrowUp', target: page }), -1);
  assert.equal(getReelNavigationDirection({ key: 'ArrowDown', target: page }), 1);
  assert.equal(getReelNavigationDirection({ key: 'ArrowDown', target: control }), 0);
  assert.equal(getReelNavigationDirection({ key: 'ArrowDown', ctrlKey: true, target: page }), 0);

  const gate = createWheelNavigationGate({ threshold: 40, cooldownMs: 500, resetMs: 120 });
  assert.equal(gate(18, 1000), 0);
  assert.equal(gate(25, 1050), 1);
  assert.equal(gate(90, 1200), 0);
  assert.equal(gate(-50, 1600), -1);
});

test('Reels layout keeps the portrait frame, letterboxing, and viewport bounds', () => {
  const css = readFileSync(path.join(__dirname, '../frontend/app/globals.css'), 'utf8');
  const component = readFileSync(path.join(__dirname, '../frontend/components/ReelsView.jsx'), 'utf8');
  assert.match(css, /\.watch-page\s*\{[^}]*height:calc\(100dvh - 184px\)[^}]*overflow:hidden/s);
  assert.match(css, /@media\s*\(min-width:\s*1024px\)\s*\{\s*\.watch-page\s*\{[^}]*height:calc\(100dvh - 132px\)/s);
  assert.match(css, /\.watch-media\s*\{[^}]*aspect-ratio:9\s*\/\s*16/s);
  assert.match(component, /className="h-full w-full object-contain"/);
  assert.match(css, /\.watch-media video\s*\{[^}]*background:#090a0d;[^}]*cursor:pointer;/);
  assert.match(css, /\.watch-feed\s*\{[^}]*overscroll-behavior-y:contain/s);
  const stackStart = component.indexOf('className="watch-nav-stack');
  const previousButton = component.indexOf('aria-label="Previous Reel"', stackStart);
  const nextButton = component.indexOf('aria-label="Next Reel"', stackStart);
  const stackEnd = component.indexOf('</nav>', stackStart);
  assert.ok(stackStart >= 0 && previousButton > stackStart && nextButton > previousButton && nextButton < stackEnd);
  assert.match(component, /aria-label="Previous Reel"[^>]*onClick=\{\(\) => navigateToReel\(reelIndex - 1\)\}/);
  assert.match(component, /aria-label="Next Reel"[^>]*onClick=\{\(\) => navigateToReel\(reelIndex \+ 1\)\}/);
  assert.match(css, /\.watch-item\s*\{[^}]*grid-template-columns:minmax\(0,860px\) 40px/s);
  assert.match(css, /\.watch-nav-stack\s*\{[^}]*flex-direction:column;[^}]*gap:12px;[^}]*user-select:none/s);
  assert.match(css, /\.watch-page button:not\(:disabled\),\.watch-page a\s*\{\s*cursor:pointer;/);
  assert.match(css, /\.watch-page input,\.watch-page textarea\s*\{\s*cursor:text;\s*user-select:text;/);
  assert.match(css, /\.watch-reel-caption\s*\{\s*cursor:text;\s*user-select:text;/);
  assert.doesNotMatch(component, /contentEditable/i);
});

const MUTED_PREFERENCE_KEY = 'gather:reels:muted';

export function readReelMutedPreference(storage) {
  try {
    const saved = storage.getItem(MUTED_PREFERENCE_KEY);
    return saved == null ? false : saved === 'true';
  } catch {
    return false;
  }
}

export function writeReelMutedPreference(storage, muted) {
  try {
    storage.setItem(MUTED_PREFERENCE_KEY, String(Boolean(muted)));
  } catch {
    // Storage can be unavailable in private browsing or restricted contexts.
  }
}

export function setVideoMuted(video, muted, onMutedChange = () => {}) {
  if (!video) return Boolean(muted);
  video.muted = Boolean(muted);
  onMutedChange(video.muted);
  return video.muted;
}

export function detectVideoAudio(video) {
  const tracks = video?.audioTracks;
  return tracks && Number.isFinite(tracks.length) ? tracks.length > 0 : null;
}

export function isReelInteractiveTarget(target) {
  return Boolean(target?.closest?.('input, textarea, select, button, a[href], [contenteditable="true"], [role="textbox"], [role="slider"]'));
}

export function getReelNavigationDirection(event) {
  if (event?.altKey || event?.ctrlKey || event?.metaKey || event?.shiftKey) return 0;
  if (isReelInteractiveTarget(event?.target)) return 0;
  if (event?.key === 'ArrowUp') return -1;
  if (event?.key === 'ArrowDown') return 1;
  return 0;
}

export function adjacentReelIndex(index, direction, count) {
  const nextIndex = index + Math.sign(direction);
  return nextIndex >= 0 && nextIndex < count ? nextIndex : null;
}

export function createWheelNavigationGate({ threshold = 48, cooldownMs = 650, resetMs = 140, now = () => Date.now() } = {}) {
  let accumulated = 0;
  let lastEventAt = 0;
  let lastNavigationAt = -Infinity;
  return (deltaY, timestamp = now()) => {
    if (!Number.isFinite(deltaY) || deltaY === 0) return 0;
    if (timestamp - lastNavigationAt < cooldownMs) {
      accumulated = 0;
      lastEventAt = timestamp;
      return 0;
    }
    if (timestamp - lastEventAt > resetMs) accumulated = 0;
    accumulated += deltaY;
    lastEventAt = timestamp;
    if (Math.abs(accumulated) < threshold) return 0;
    const direction = Math.sign(accumulated);
    accumulated = 0;
    lastNavigationAt = timestamp;
    return direction;
  };
}

export async function playVideoWithSoundFallback(video, mutedPreference, isActive = () => true, onMutedChange = () => {}) {
  if (!video || !isActive()) return false;
  const attemptPlay = async () => {
    try {
      await Promise.resolve(video.play());
      return true;
    } catch {
      return false;
    }
  };

  setVideoMuted(video, mutedPreference, onMutedChange);
  let played = await attemptPlay();
  if (!isActive()) {
    video.pause();
    return false;
  }
  if (!played && !video.muted) {
    setVideoMuted(video, true, onMutedChange);
    played = await attemptPlay();
  }
  if (!isActive()) {
    video.pause();
    return false;
  }
  return played && !video.paused;
}

export function createReelPlaybackController({ getVideos, getMuted, setPlaying, setMuted = () => {} }) {
  let activeId = null;

  async function play(video, reelId) {
    if (!video) return Promise.resolve(false);
    activeId = reelId;
    getVideos().forEach((otherVideo, otherId) => {
      if (otherId !== reelId && !otherVideo.paused) {
        otherVideo.pause();
        setPlaying(otherId, false);
      }
    });
    const played = await playVideoWithSoundFallback(video, getMuted(), () => activeId === reelId, (isMuted) => {
      if (activeId === reelId) setMuted(isMuted);
    });
    if (activeId !== reelId) {
      video.pause();
      setPlaying(reelId, false);
      return false;
    }
    setPlaying(reelId, played);
    return played;
  }

  function pause(video, reelId) {
    if (activeId === reelId) activeId = null;
    if (video) video.pause();
    setPlaying(reelId, false);
  }

  function dispose() {
    activeId = null;
    getVideos().forEach((video) => video.pause());
  }

  return {
    play,
    pause,
    dispose,
    isActive: (reelId) => activeId === reelId
  };
}

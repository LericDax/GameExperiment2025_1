function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

export function createMusicPlayer({ tracks, defaultVolume = 0.6 } = {}) {
  if (!Array.isArray(tracks) || tracks.length === 0) {
    throw new Error('Cannot create a music player without any tracks.')
  }

  const audio = new Audio()
  audio.preload = 'auto'
  audio.crossOrigin = 'anonymous'
  audio.loop = false
  audio.volume = clamp(defaultVolume, 0, 1)

  const events = new EventTarget()

  let currentIndex = 0
  let hasLoadedInitialTrack = false
  let isPlaying = false

  const stateDetail = () => ({
    isPlaying,
    track: tracks[currentIndex],
    index: currentIndex,
  })

  function emitStateChange() {
    events.dispatchEvent(new CustomEvent('statechange', { detail: stateDetail() }))
  }

  function emitTrackChange() {
    events.dispatchEvent(
      new CustomEvent('trackchange', {
        detail: { track: tracks[currentIndex], index: currentIndex },
      }),
    )
  }

  function emitVolumeChange() {
    events.dispatchEvent(
      new CustomEvent('volumechange', {
        detail: { volume: audio.volume, track: tracks[currentIndex], index: currentIndex },
      }),
    )
  }

  function ensureTrackLoaded(index = currentIndex) {
    if (!hasLoadedInitialTrack || currentIndex !== index) {
      currentIndex = (index + tracks.length) % tracks.length
      const nextTrack = tracks[currentIndex]
      if (nextTrack) {
        audio.src = nextTrack.url
        hasLoadedInitialTrack = true
        emitTrackChange()
      }
    }
  }

  function play() {
    ensureTrackLoaded(currentIndex)
    const playPromise = audio.play()
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch((error) => {
        events.dispatchEvent(new CustomEvent('playerror', { detail: error }))
      })
    }
    return playPromise
  }

  function pause() {
    audio.pause()
  }

  function togglePlayback() {
    if (isPlaying) {
      pause()
    } else {
      play()
    }
  }

  function next() {
    ensureTrackLoaded(currentIndex + 1)
    if (isPlaying) {
      play()
    }
  }

  function previous() {
    ensureTrackLoaded(currentIndex - 1)
    if (isPlaying) {
      play()
    }
  }

  function setVolume(volume) {
    const normalized = clamp(volume, 0, 1)
    if (audio.volume !== normalized) {
      audio.volume = normalized
    }
  }

  function getVolume() {
    return audio.volume
  }

  function getCurrentTrack() {
    return tracks[currentIndex]
  }

  function dispose() {
    audio.pause()
    audio.removeEventListener('ended', handleEnded)
    audio.removeEventListener('play', handlePlay)
    audio.removeEventListener('pause', handlePause)
    audio.removeEventListener('volumechange', handleVolumeChange)
    audio.src = ''
  }

  function handleEnded() {
    next()
  }

  function handlePlay() {
    isPlaying = true
    emitStateChange()
  }

  function handlePause() {
    isPlaying = false
    emitStateChange()
  }

  function handleVolumeChange() {
    emitVolumeChange()
  }

  audio.addEventListener('ended', handleEnded)
  audio.addEventListener('play', handlePlay)
  audio.addEventListener('pause', handlePause)
  audio.addEventListener('volumechange', handleVolumeChange)

  // Prepare initial track metadata
  ensureTrackLoaded(currentIndex)
  emitVolumeChange()
  emitStateChange()

  return {
    events,
    play,
    pause,
    togglePlayback,
    next,
    previous,
    setVolume,
    getVolume,
    getCurrentTrack,
    dispose,
  }
}

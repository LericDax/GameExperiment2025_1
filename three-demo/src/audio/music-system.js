import { createMusicPlayer } from './music-player.js'
import { getMusicTracks } from './music-library.js'
import { createVolumeWidget } from '../ui/volume-widget.js'

function setupAutoplayFallback({ player, widget, overlay }) {
  const attemptPlayback = () => {
    player.play()?.catch(() => {
      widget.showPlaybackHint()
    })
  }

  const interactionTargets = [overlay, document]
  interactionTargets.forEach((target) => {
    target?.addEventListener('pointerdown', attemptPlayback, { once: true })
    target?.addEventListener('keydown', attemptPlayback, { once: true })
  })

  return () => {
    interactionTargets.forEach((target) => {
      target?.removeEventListener('pointerdown', attemptPlayback)
      target?.removeEventListener('keydown', attemptPlayback)
    })
  }
}

export function initializeMusicSystem({ overlay, root = document.body } = {}) {
  const tracks = getMusicTracks()
  if (!tracks.length) {
    console.info(
      'No background music tracks found. Add .mp3 or .wav files to three-demo/src/sounds/music/tracks to enable playback.',
    )
    return null
  }

  const player = createMusicPlayer({ tracks, defaultVolume: 0.55 })
  const widget = createVolumeWidget({
    container: root,
    initialVolume: player.getVolume(),
    onVolumeChange: (volume) => player.setVolume(volume),
    onTogglePlayback: () => player.togglePlayback(),
    onNextTrack: () => player.next(),
  })

  const currentTrack = player.getCurrentTrack()
  widget.setNowPlaying(currentTrack?.title ?? 'Loading track...')

  const disposeAutoplayFallback = setupAutoplayFallback({ player, widget, overlay })

  function handleTrackChange(event) {
    const { track } = event.detail ?? {}
    widget.setNowPlaying(track?.title ?? '')
  }

  function handleStateChange(event) {
    widget.setIsPlaying(Boolean(event.detail?.isPlaying))
  }

  function handleVolumeChange(event) {
    widget.setVolume(event.detail?.volume ?? player.getVolume())
  }

  function handlePlayError() {
    widget.showPlaybackHint()
  }

  player.events.addEventListener('trackchange', handleTrackChange)
  player.events.addEventListener('statechange', handleStateChange)
  player.events.addEventListener('volumechange', handleVolumeChange)
  player.events.addEventListener('playerror', handlePlayError)

  widget.setIsPlaying(false)

  return {
    player,
    widget,
    tracks,
    dispose() {
      disposeAutoplayFallback()
      player.events.removeEventListener('trackchange', handleTrackChange)
      player.events.removeEventListener('statechange', handleStateChange)
      player.events.removeEventListener('volumechange', handleVolumeChange)
      player.events.removeEventListener('playerror', handlePlayError)
      player.dispose()
      widget.dispose()
    },
  }
}

const PLAY_LABEL = 'Play music'
const PAUSE_LABEL = 'Pause music'

export function createVolumeWidget({
  container = document.body,
  initialVolume = 0.6,
  onVolumeChange,
  onTogglePlayback,
  onNextTrack,
} = {}) {
  const widget = document.createElement('section')
  widget.className = 'volume-widget'
  widget.setAttribute('role', 'group')
  widget.setAttribute('aria-label', 'Music controls')

  widget.innerHTML = `
    <div class="volume-widget-handle" aria-hidden="true">
      <span class="volume-widget-title">Music</span>
    </div>
    <div class="volume-widget-controls">
      <button type="button" class="volume-widget-toggle" aria-label="${PLAY_LABEL}" title="${PLAY_LABEL}">
        ▶
      </button>
      <input
        type="range"
        class="volume-widget-slider"
        min="0"
        max="100"
        step="1"
        value="${Math.round(initialVolume * 100)}"
        aria-label="Music volume"
      />
      <button type="button" class="volume-widget-next" aria-label="Skip to next track" title="Next track">
        ⏭
      </button>
    </div>
    <div class="volume-widget-track" aria-live="polite"></div>
    <div class="volume-widget-hint" hidden>
      Click the play button after interacting with the page to start the music.
    </div>
  `

  const toggleButton = widget.querySelector('.volume-widget-toggle')
  const nextButton = widget.querySelector('.volume-widget-next')
  const slider = widget.querySelector('.volume-widget-slider')
  const trackLabel = widget.querySelector('.volume-widget-track')
  const hint = widget.querySelector('.volume-widget-hint')
  const handle = widget.querySelector('.volume-widget-handle')

  if (!toggleButton || !nextButton || !slider || !trackLabel || !handle || !hint) {
    throw new Error('Failed to create volume widget markup.')
  }

  let isDragging = false
  let dragOffsetX = 0
  let dragOffsetY = 0

  const removeTextSelection = () => {
    document.body.classList.add('volume-widget-no-select')
  }

  const restoreTextSelection = () => {
    document.body.classList.remove('volume-widget-no-select')
  }

  const clampPosition = (value, max) => {
    return Math.min(Math.max(value, 8), Math.max(8, max))
  }

  const startDrag = (event) => {
    if (event.button !== 0) {
      return
    }
    isDragging = true
    widget.classList.add('dragging')
    widget.style.right = 'auto'
    widget.style.left = `${widget.offsetLeft}px`
    widget.style.top = `${widget.offsetTop}px`
    dragOffsetX = event.clientX - widget.offsetLeft
    dragOffsetY = event.clientY - widget.offsetTop
    removeTextSelection()
    window.addEventListener('pointermove', handleDrag)
    window.addEventListener('pointerup', endDrag)
  }

  const handleDrag = (event) => {
    if (!isDragging) {
      return
    }
    const nextLeft = clampPosition(event.clientX - dragOffsetX, window.innerWidth - widget.offsetWidth - 8)
    const nextTop = clampPosition(event.clientY - dragOffsetY, window.innerHeight - widget.offsetHeight - 8)
    widget.style.left = `${nextLeft}px`
    widget.style.top = `${nextTop}px`
  }

  const endDrag = () => {
    if (!isDragging) {
      return
    }
    isDragging = false
    widget.classList.remove('dragging')
    restoreTextSelection()
    window.removeEventListener('pointermove', handleDrag)
    window.removeEventListener('pointerup', endDrag)
  }

  handle.addEventListener('pointerdown', startDrag)

  const handleToggleClick = () => {
    hint.hidden = true
    onTogglePlayback?.()
  }

  const handleNextClick = () => {
    onNextTrack?.()
  }

  const handleSliderInput = (event) => {
    const value = Number(event.target.value)
    const normalized = Number.isFinite(value) ? value / 100 : initialVolume
    const sliderValue = Math.round(normalized * 100)
    slider.setAttribute('aria-valuenow', String(sliderValue))
    onVolumeChange?.(normalized)
  }

  toggleButton.addEventListener('click', handleToggleClick)
  nextButton.addEventListener('click', handleNextClick)
  slider.addEventListener('input', handleSliderInput)

  const api = {
    element: widget,
    dispose() {
      endDrag()
      restoreTextSelection()
      handle.removeEventListener('pointerdown', startDrag)
      toggleButton.removeEventListener('click', handleToggleClick)
      nextButton.removeEventListener('click', handleNextClick)
      slider.removeEventListener('input', handleSliderInput)
      widget.remove()
    },
    setVolume(volume) {
      const normalized = Math.min(Math.max(volume, 0), 1)
      const sliderValue = Math.round(normalized * 100)
      slider.value = String(sliderValue)
      slider.setAttribute('aria-valuenow', String(sliderValue))
    },
    setIsPlaying(playing) {
      const isPlaying = Boolean(playing)
      toggleButton.textContent = isPlaying ? '❚❚' : '▶'
      toggleButton.setAttribute('aria-label', isPlaying ? PAUSE_LABEL : PLAY_LABEL)
      toggleButton.title = isPlaying ? PAUSE_LABEL : PLAY_LABEL
      toggleButton.setAttribute('aria-pressed', String(isPlaying))
    },
    setNowPlaying(text) {
      trackLabel.textContent = text || 'Unknown track'
    },
    showPlaybackHint() {
      hint.hidden = false
    },
  }

  api.setVolume(initialVolume)
  trackLabel.textContent = ''

  container.appendChild(widget)

  return api
}

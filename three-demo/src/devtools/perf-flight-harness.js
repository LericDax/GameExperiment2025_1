const DEFAULT_SAMPLE_INTERVAL_MS = 0

function normalizeNumber(value, fallback = null) {
  if (typeof value !== 'number') {
    return fallback
  }
  if (!Number.isFinite(value)) {
    return fallback
  }
  return value
}

function extractChunkStats(chunkManager) {
  if (!chunkManager) {
    return {
      chunkCount: null,
      totalBlocks: null,
      solidBlocks: null,
      softBlocks: null,
      waterColumns: null,
    }
  }

  let chunkCount = null
  let totalBlocks = null
  if (typeof chunkManager.debugSnapshot === 'function') {
    try {
      const snapshot = chunkManager.debugSnapshot()
      if (snapshot && typeof snapshot === 'object') {
        if (Number.isFinite(snapshot.chunkCount)) {
          chunkCount = snapshot.chunkCount
        }
        if (Number.isFinite(snapshot.totalBlocks)) {
          totalBlocks = snapshot.totalBlocks
        }
      }
    } catch (error) {
      console.warn('perf flight: failed to read chunk snapshot.', error)
    }
  }

  const solidBlocks = chunkManager.solidBlocks
    ? chunkManager.solidBlocks.size
    : null
  const softBlocks = chunkManager.softBlocks
    ? chunkManager.softBlocks.size
    : null
  const waterColumns = chunkManager.waterColumns
    ? chunkManager.waterColumns.size
    : null

  return { chunkCount, totalBlocks, solidBlocks, softBlocks, waterColumns }
}

function computeAggregate(frames, key) {
  const values = []
  for (const frame of frames) {
    const value = frame[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      values.push(value)
    }
  }
  if (values.length === 0) {
    return { average: null, min: null, max: null }
  }
  let min = values[0]
  let max = values[0]
  let sum = 0
  for (const value of values) {
    if (value < min) {
      min = value
    }
    if (value > max) {
      max = value
    }
    sum += value
  }
  return {
    average: sum / values.length,
    min,
    max,
  }
}

function createOverlayElement() {
  const element = document.createElement('pre')
  element.style.position = 'fixed'
  element.style.top = '12px'
  element.style.right = '12px'
  element.style.padding = '12px 16px'
  element.style.background = 'rgba(8, 8, 16, 0.8)'
  element.style.color = '#ffffff'
  element.style.fontFamily = 'monospace'
  element.style.fontSize = '13px'
  element.style.lineHeight = '1.35'
  element.style.zIndex = '9999'
  element.style.maxWidth = '320px'
  element.style.pointerEvents = 'none'
  element.style.whiteSpace = 'pre-wrap'
  element.textContent = 'Perf flight initializing...'
  document.body.appendChild(element)
  return element
}

function updateOverlay(element, data) {
  if (!element) {
    return
  }
  const lines = []
  lines.push(
    `perf flight: ${data.elapsedSeconds.toFixed(1)}s / ${data.durationSeconds.toFixed(1)}s`,
  )
  lines.push(`fps (avg): ${data.fpsAverage.toFixed(2)}`)
  lines.push(`fps (last): ${data.lastFps.toFixed(2)}`)
  if (typeof data.renderCalls === 'number') {
    lines.push(`render calls: ${data.renderCalls}`)
  }
  if (typeof data.triangles === 'number') {
    lines.push(`triangles: ${data.triangles}`)
  }
  if (typeof data.chunkCount === 'number') {
    lines.push(`chunks: ${data.chunkCount}`)
  }
  if (typeof data.totalBlocks === 'number') {
    lines.push(`total blocks: ${data.totalBlocks}`)
  }
  element.textContent = lines.join('\n')
}

function buildSummary(samples, metadata) {
  const metrics = {
    delta: computeAggregate(samples, 'delta'),
    fps: computeAggregate(samples, 'fps'),
    renderCalls: computeAggregate(samples, 'renderCalls'),
    triangles: computeAggregate(samples, 'triangles'),
    chunkCount: computeAggregate(samples, 'chunkCount'),
    totalBlocks: computeAggregate(samples, 'totalBlocks'),
    solidBlocks: computeAggregate(samples, 'solidBlocks'),
    softBlocks: computeAggregate(samples, 'softBlocks'),
    waterColumns: computeAggregate(samples, 'waterColumns'),
  }

  return {
    durationMs: metadata.durationMs,
    startedAt: new Date(metadata.startedAt).toISOString(),
    frameCount: samples.length,
    metrics,
    series: samples,
  }
}

export function runPerfFlight({
  playerControls,
  registerDiagnosticOverlay,
  renderer,
  chunkManager,
  durationMs = 30000,
  sampleIntervalMs,
} = {}) {
  if (!playerControls) {
    return Promise.reject(new Error('runPerfFlight requires playerControls.'))
  }
  if (typeof registerDiagnosticOverlay !== 'function') {
    return Promise.reject(new Error('runPerfFlight requires registerDiagnosticOverlay.'))
  }
  if (!renderer) {
    return Promise.reject(new Error('runPerfFlight requires renderer.'))
  }
  if (!chunkManager) {
    return Promise.reject(new Error('runPerfFlight requires chunkManager.'))
  }

  const normalizedDuration = Math.max(0, Number(durationMs) || 0)
  const normalizedInterval = Math.max(
    0,
    Number.isFinite(sampleIntervalMs) ? Number(sampleIntervalMs) : DEFAULT_SAMPLE_INTERVAL_MS,
  )

  const moveState = playerControls.moveState || {}
  const originalMoveState = {
    forward: Boolean(moveState.forward),
    backward: Boolean(moveState.backward),
    left: Boolean(moveState.left),
    right: Boolean(moveState.right),
    sprint: Boolean(moveState.sprint),
  }
  const originalFlight =
    typeof playerControls.isFlightEnabled === 'function'
      ? Boolean(playerControls.isFlightEnabled())
      : false

  let originalPosition = null
  if (typeof playerControls.getPosition === 'function') {
    const position = playerControls.getPosition()
    if (position && typeof position.x === 'number') {
      originalPosition = { x: position.x, y: position.y, z: position.z }
    }
  }

  if (typeof playerControls.setFlightEnabled === 'function') {
    playerControls.setFlightEnabled(true)
  }
  if (typeof playerControls.setPosition === 'function' && originalPosition) {
    try {
      playerControls.setPosition({
        x: originalPosition.x,
        y: originalPosition.y + 10,
        z: originalPosition.z,
      })
    } catch (error) {
      console.warn('perf flight: unable to adjust player height.', error)
    }
  }

  moveState.forward = true
  moveState.backward = false
  moveState.left = false
  moveState.right = false
  moveState.sprint = false

  const frames = []
  const startTime = performance.now()
  const endTime = startTime + normalizedDuration
  let lastSampleTime = -Infinity
  const overlayElement = createOverlayElement()

  let cleanupOverlay = null
  let finished = false

  const restoreState = () => {
    moveState.forward = originalMoveState.forward
    moveState.backward = originalMoveState.backward
    moveState.left = originalMoveState.left
    moveState.right = originalMoveState.right
    moveState.sprint = originalMoveState.sprint

    if (typeof playerControls.setFlightEnabled === 'function') {
      playerControls.setFlightEnabled(originalFlight)
    }

    if (originalPosition && typeof playerControls.setPosition === 'function') {
      try {
        playerControls.setPosition(originalPosition)
      } catch (error) {
        console.warn('perf flight: unable to restore original position.', error)
      }
    }
  }

  const disposeOverlayElement = () => {
    if (overlayElement?.parentNode) {
      overlayElement.parentNode.removeChild(overlayElement)
    }
  }

  const finish = (resolve, reject, error = null) => {
    if (finished) {
      return
    }
    finished = true

    if (cleanupOverlay) {
      try {
        cleanupOverlay()
      } catch (cleanupError) {
        console.warn('perf flight: failed to dispose overlay callback.', cleanupError)
      }
      cleanupOverlay = null
    }

    disposeOverlayElement()
    restoreState()

    if (error) {
      reject(error)
      return
    }

    const summary = buildSummary(frames, {
      durationMs: normalizedDuration,
      startedAt: startTime,
    })
    resolve(summary)
  }

  return new Promise((resolve, reject) => {
    try {
      cleanupOverlay = registerDiagnosticOverlay(({ delta }) => {
        const now = performance.now()

        if (normalizedInterval > 0 && now - lastSampleTime < normalizedInterval) {
          if (now >= endTime) {
            finish(resolve, reject)
          }
          return
        }

        lastSampleTime = now

        const elapsedMs = now - startTime
        const fps = delta > 0 ? 1 / delta : 0
        const renderInfo = renderer.info?.render || {}
        const chunkStats = extractChunkStats(chunkManager)

        const frameRecord = {
          timestamp: elapsedMs,
          delta,
          fps,
          renderCalls: normalizeNumber(renderInfo.calls),
          triangles: normalizeNumber(renderInfo.triangles),
          chunkCount: normalizeNumber(chunkStats.chunkCount),
          totalBlocks: normalizeNumber(chunkStats.totalBlocks),
          solidBlocks: normalizeNumber(chunkStats.solidBlocks),
          softBlocks: normalizeNumber(chunkStats.softBlocks),
          waterColumns: normalizeNumber(chunkStats.waterColumns),
        }
        frames.push(frameRecord)

        const aggregateFps = computeAggregate(frames, 'fps')

        updateOverlay(overlayElement, {
          elapsedSeconds: elapsedMs / 1000,
          durationSeconds: normalizedDuration / 1000,
          fpsAverage: aggregateFps.average || 0,
          lastFps: fps || 0,
          renderCalls: frameRecord.renderCalls,
          triangles: frameRecord.triangles,
          chunkCount: frameRecord.chunkCount,
          totalBlocks: frameRecord.totalBlocks,
        })

        moveState.forward = true
        moveState.backward = false
        moveState.left = false
        moveState.right = false

        if (now >= endTime) {
          finish(resolve, reject)
        }
      })
    } catch (error) {
      finish(resolve, reject, error)
      return
    }

    if (normalizedDuration === 0) {
      finish(resolve, reject)
      return
    }
  })
}

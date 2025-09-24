import * as THREE from 'three'
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js'

import { createBlockMaterials } from './rendering/textures.js'
import {
  initializeWorldGeneration,
  worldConfig,
  terrainHeight,
} from './world/generation.js'
import { createChunkManager } from './world/chunk-manager.js'
import { createPlayerControls } from './player/controls.js'
import { createCommandConsole } from './ui/command-console.js'
import { registerDeveloperCommands } from './player/dev-commands.js'
import { initializeMusicSystem } from './audio/music-system.js'
import {
  initializeFluidRegistry,
  getFluidFallbackStates,
  getFluidMaterial,
  updateFluids,
} from './world/fluids/fluid-registry.js'
import { runHydraVisibilityProbe } from './world/fluids/hydra-visibility-probe.js'

const overlay = document.getElementById('overlay')
const overlayStatus = overlay?.querySelector('#overlay-status')

function setOverlayStatus(message, { isError = false, revealOverlay = true } = {}) {
  if (!overlay || !overlayStatus) {
    return
  }
  overlayStatus.textContent = message
  overlayStatus.classList.toggle('visible', Boolean(message))
  overlayStatus.classList.toggle('error', Boolean(message) && isError)
  if (!message) {
    overlay.classList.add('hidden')
    overlay.setAttribute('aria-hidden', 'true')
    return
  }
  if (revealOverlay) {
    overlay.classList.remove('hidden')
    overlay.removeAttribute('aria-hidden')
  }
}

initializeWorldGeneration({ THREE })
initializeFluidRegistry({ THREE })

const scene = new THREE.Scene()
scene.background = new THREE.Color(0xa9d6ff)
scene.fog = new THREE.Fog(0xa9d6ff, 20, 140)

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  500,
)
camera.position.set(0, 25, 30)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.1
document.body.appendChild(renderer.domElement)

const clock = new THREE.Clock()
const diagnosticOverlayCallbacks = new Set()
let fluidWarningOverlayDisposer = null

function registerDiagnosticOverlay(callback) {
  if (typeof callback !== 'function') {
    throw new Error('registerDiagnosticOverlay expects a callback function')
  }
  diagnosticOverlayCallbacks.add(callback)
  return () => {
    diagnosticOverlayCallbacks.delete(callback)
  }
}

const hud = document.createElement('div')
hud.id = 'hud'
hud.innerHTML = `
  <div class="hud-bar">
    <span class="hud-label">Health</span>
    <div class="hud-track" aria-hidden="true">
      <div class="hud-fill" id="hud-health-fill"></div>
    </div>
    <span class="hud-value" id="hud-health-value">100</span>
  </div>
  <div class="hud-bar">
    <span class="hud-label">Oxygen</span>
    <div class="hud-track" aria-hidden="true">
      <div class="hud-fill" id="hud-oxygen-fill"></div>
    </div>
    <span class="hud-value" id="hud-oxygen-value">12</span>
  </div>
  <div id="hud-status" role="status" aria-live="polite"></div>
`
document.body.appendChild(hud)

const fluidWarningBanner = document.createElement('div')
fluidWarningBanner.id = 'fluid-warning-banner'
fluidWarningBanner.className = 'fluid-warning-banner'
fluidWarningBanner.setAttribute('role', 'status')
fluidWarningBanner.setAttribute('aria-live', 'polite')
document.body.appendChild(fluidWarningBanner)

const musicSystem = initializeMusicSystem({ overlay, root: document.body })

const healthFill = hud.querySelector('#hud-health-fill')
const healthValue = hud.querySelector('#hud-health-value')
const oxygenFill = hud.querySelector('#hud-oxygen-fill')
const oxygenValue = hud.querySelector('#hud-oxygen-value')
const statusElement = hud.querySelector('#hud-status')
let lastHudState = null
let hudStatusOverride = null
let hudStatusOverrideIsError = false
let hydraFallbackNoticeTimeout = null

function renderHudStatus(message, isError = false) {
  if (!statusElement) {
    return
  }
  statusElement.textContent = message
  statusElement.classList.toggle('visible', Boolean(message))
  statusElement.classList.toggle('error', Boolean(message) && isError)
}

function setHudStatusOverride(message, { isError = false } = {}) {
  hudStatusOverride = message ?? null
  hudStatusOverrideIsError = Boolean(message) && isError
  if (hudStatusOverride !== null) {
    renderHudStatus(hudStatusOverride, hudStatusOverrideIsError)
  } else if (lastHudState) {
    renderHudStatus(lastHudState.statusMessage ?? '', false)
  } else {
    renderHudStatus('', false)
  }
}

function updateHud(state) {
  lastHudState = state
  const healthPercent = THREE.MathUtils.clamp(state.health / 100, 0, 1)
  healthFill.style.width = `${healthPercent * 100}%`
  healthValue.textContent = `${Math.round(state.health)}`

  const oxygenPercent = THREE.MathUtils.clamp(state.oxygen / state.maxOxygen, 0, 1)
  oxygenFill.style.width = `${oxygenPercent * 100}%`
  oxygenValue.textContent = `${state.oxygen.toFixed(1)}`

  const statusMessage =
    hudStatusOverride !== null ? hudStatusOverride : state.statusMessage ?? ''
  const statusIsError = hudStatusOverride !== null ? hudStatusOverrideIsError : false
  renderHudStatus(statusMessage, statusIsError)
  hud.classList.toggle('in-water', state.isInWater)
}

let blockMaterials
let chunkManager
let playerControls
let initializationError = null

try {
  blockMaterials = createBlockMaterials({ THREE })

  chunkManager = createChunkManager({
    scene,
    blockMaterials,
    viewDistance: 2,
  })

  playerControls = createPlayerControls({
    THREE,
    PointerLockControls,
    scene,
    camera,
    renderer,
    overlay,
    worldConfig,
    terrainHeight,
    solidBlocks: chunkManager.solidBlocks,
    softBlocks: chunkManager.softBlocks,
    waterColumns: chunkManager.waterColumns,
    chunkManager,
    damageMaterials: blockMaterials.damageStages,
    onStateChange: updateHud,
  })

  chunkManager.update(playerControls.getPosition())
  updateHud(playerControls.getState())

  getFluidMaterial('water')
  const hydraProbeResult = runHydraVisibilityProbe({
    THREE,
    renderer,
    onFallback: ({ reason }) => {
      if (hydraFallbackNoticeTimeout) {
        clearTimeout(hydraFallbackNoticeTimeout)
      }
      setHudStatusOverride(reason ?? 'Hydra water fallback active')
      hydraFallbackNoticeTimeout = setTimeout(() => {
        setHudStatusOverride(null)
        hydraFallbackNoticeTimeout = null
      }, 6000)
      updateFluidWarningBanner()
    },
  })
  if (import.meta.env.DEV) {
    console.info('[hydra] visibility probe result', hydraProbeResult)
  }
  if (hydraProbeResult?.ok) {
    updateFluidWarningBanner()
  }

  const updateFluidWarningBanner = () => {
    if (!fluidWarningBanner) {
      return
    }
    const warnings = chunkManager.getFluidVisibilityWarnings?.() ?? []
    const fallbackStates = getFluidFallbackStates()
    if (!warnings.length && !fallbackStates.length) {
      fluidWarningBanner.textContent = ''
      fluidWarningBanner.classList.remove('visible')
      return
    }
    const entries = []
    const warningEntries = warnings
      .slice(0, 3)
      .map((warning) => `${warning.fluidType}×${warning.columnCount} @ ${warning.chunkKey}`)
    entries.push(...warningEntries)
    if (warnings.length > 3) {
      entries.push(`+${warnings.length - 3} more chunk issue(s)`)
    }
    const fallbackSummaries = fallbackStates.slice(0, 2).map((state) => {
      const reason = state.reason ?? 'fallback active'
      const trimmedReason = reason.length > 70 ? `${reason.slice(0, 67)}…` : reason
      const metrics = state.metrics ?? {}
      const metricParts = []
      if (typeof metrics.brightness === 'number') {
        metricParts.push(`b=${metrics.brightness.toFixed(2)}`)
      }
      if (typeof metrics.alpha === 'number') {
        metricParts.push(`a=${metrics.alpha.toFixed(2)}`)
      }
      const metricSuffix = metricParts.length ? ` (${metricParts.join(', ')})` : ''
      return `${state.type} fallback: ${trimmedReason}${metricSuffix}`
    })
    entries.push(...fallbackSummaries)
    if (fallbackStates.length > 2) {
      entries.push(`+${fallbackStates.length - 2} more fallback notice(s)`)
    }
    fluidWarningBanner.textContent = `Fluid visibility notice: ${entries.join(' • ')}`
    fluidWarningBanner.classList.add('visible')
  }

  getFluidMaterial('water')
  const hydraProbeResult = runHydraVisibilityProbe({
    THREE,
    renderer,
    onFallback: ({ reason }) => {
      if (hydraFallbackNoticeTimeout) {
        clearTimeout(hydraFallbackNoticeTimeout)
      }
      setHudStatusOverride(reason ?? 'Hydra water fallback active')
      hydraFallbackNoticeTimeout = setTimeout(() => {
        setHudStatusOverride(null)
        hydraFallbackNoticeTimeout = null
      }, 6000)
      updateFluidWarningBanner()
    },
  })
  if (import.meta.env.DEV) {
    console.info('[hydra] visibility probe result', hydraProbeResult)
  }
  if (hydraProbeResult?.ok) {
    updateFluidWarningBanner()
  }

  updateFluidWarningBanner()
  fluidWarningOverlayDisposer = registerDiagnosticOverlay(() => {
    updateFluidWarningBanner()
  })

  if (import.meta.env.DEV) {
    const debugNamespace = (window.__VOXEL_DEBUG__ = window.__VOXEL_DEBUG__ || {})
    debugNamespace.chunkSnapshot = () => chunkManager.debugSnapshot?.()
    debugNamespace.player = {
      controls: playerControls,
      setPosition: (position) => playerControls.setPosition(position),
      setYawPitch: (yaw, pitch) => playerControls.setYawPitch(yaw, pitch),
      getYawPitch: () => playerControls.getYawPitch(),
    }
    debugNamespace.registerDiagnosticOverlay = registerDiagnosticOverlay
  }

  const commandConsole = createCommandConsole({
    onToggle: (isOpen) => {
      if (playerControls) {
        playerControls.setInputEnabled(!isOpen)
        if (isOpen && playerControls.controls?.isLocked) {
          try {
            playerControls.controls.unlock()
          } catch (error) {
            console.warn('Failed to release pointer lock for console toggle.', error)
          }
        }
      }
      if (!isOpen) {
        renderer.domElement.focus?.()
      }
    },
  })

  registerDeveloperCommands({
    commandConsole,
    playerControls,
    chunkManager,
    scene,
    THREE,
    registerDiagnosticOverlay,
  })

  commandConsole.log(
    'Developer console ready. Press ` to open and Esc to close. Type /help for commands.',
  )

} catch (error) {
  initializationError = error instanceof Error ? error : new Error(String(error))
  console.error('Failed to initialize world:', initializationError)
  const message =
    'Failed to initialize the world. Check the console for more details and verify texture assets.'
  setOverlayStatus(message, { isError: true, revealOverlay: true })
  setHudStatusOverride(message, { isError: true })
}

const ambientLight = new THREE.AmbientLight(0xffffff, 0.5)
scene.add(ambientLight)

const hemiLight = new THREE.HemisphereLight(0xbcdfff, 0x5a4833, 0.45)
scene.add(hemiLight)

const sun = new THREE.DirectionalLight(0xffffff, 1.1)
sun.position.set(20, 50, 20)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.near = 0.5
sun.shadow.camera.far = 200
scene.add(sun)

if (!initializationError) {
  function animate() {
    requestAnimationFrame(animate)
    const delta = Math.min(clock.getDelta(), 0.05)
    const elapsedTime = clock.elapsedTime

    chunkManager.update(playerControls.getPosition())
    playerControls.update(delta)
    updateFluids(delta)

    if (diagnosticOverlayCallbacks.size > 0) {
      const callbacks = Array.from(diagnosticOverlayCallbacks)
      callbacks.forEach((callback) => {
        try {
          callback({
            delta,
            elapsedTime,
            playerControls,
            scene,
            camera,
          })
        } catch (error) {
          console.error('Diagnostic overlay callback failed:', error)
        }
      })
    }

    renderer.render(scene, camera)
  }

  animate()

  window.addEventListener('beforeunload', () => {
    playerControls.dispose()
    chunkManager.dispose()
    musicSystem?.dispose()
    fluidWarningOverlayDisposer?.()
    fluidWarningOverlayDisposer = null
  })
}

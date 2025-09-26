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
  updateFluids,
} from './world/fluids/fluid-registry.js'

const overlay = document.getElementById('overlay')
const viewport = document.getElementById('viewport')
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
  Math.max(window.innerWidth, 1) / Math.max(window.innerHeight, 1),
  0.1,
  500,
)

camera.position.set(0, 25, 30)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.1

;(viewport ?? document.body).appendChild(renderer.domElement)

const MAX_PIXEL_RATIO = 2

function resizeToViewport() {
  const width = Math.max(window.innerWidth, 1)
  const height = Math.max(window.innerHeight, 1)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO))
  renderer.setSize(width, height)
}

resizeToViewport()
window.addEventListener('resize', resizeToViewport)

const MAX_PIXEL_RATIO = 2

function resizeToViewport() {
  const width = Math.max(window.innerWidth, 1)
  const height = Math.max(window.innerHeight, 1)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO))
  renderer.setSize(width, height)
}

resizeToViewport()
window.addEventListener('resize', resizeToViewport)


const MAX_PIXEL_RATIO = 2

function resizeToWindow() {
  const width = Math.max(window.innerWidth, 1)
  const height = Math.max(window.innerHeight, 1)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO))
  renderer.setSize(width, height)
}

resizeToWindow()
window.addEventListener('resize', resizeToWindow)

const clock = new THREE.Clock()
const diagnosticOverlayCallbacks = new Set()

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

const musicSystem = initializeMusicSystem({ overlay, root: document.body })

const healthFill = hud.querySelector('#hud-health-fill')
const healthValue = hud.querySelector('#hud-health-value')
const oxygenFill = hud.querySelector('#hud-oxygen-fill')
const oxygenValue = hud.querySelector('#hud-oxygen-value')
const statusElement = hud.querySelector('#hud-status')
let lastHudState = null
let hudStatusOverride = null
let hudStatusOverrideIsError = false

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

  if (import.meta.env.DEV) {
    const debugNamespace = (window.__VOXEL_DEBUG__ = window.__VOXEL_DEBUG__ || {})
    debugNamespace.chunkSnapshot = () => chunkManager.debugSnapshot?.()
    debugNamespace.scene = scene
    debugNamespace.renderer = renderer
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

    window.removeEventListener('resize', resizeToViewport)

    playerControls.dispose()
    chunkManager.dispose()
    musicSystem?.dispose()
  })
}

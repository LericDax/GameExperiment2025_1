import * as THREE from 'three'
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js'

import { FLAGS } from './app/feature-flags.ts'
import { createWorldService } from './app/services/world-service.ts'
import { createWorkerBroker } from './app/broker.ts'
import { createPersistenceService } from './app/services/persistence-service.ts'
import { budgetRegistry, CPU_POOL, GPU_POOL } from './app/budgets'
import { createBlockMaterials } from './rendering/textures.js'
import {
  applyWorldOptions,
  initializeWorldGeneration,
  terrainHeight,
  getWorldOptions,
  sampleBiomeAt,
} from './world/generation.js'
import {
  createChunkManager,
  ChunkManagerEvents,
} from './world/chunk-manager.js'
import { createPlayerControls } from './player/controls.js'
import { createCommandConsole } from './ui/command-console.js'
import { registerDeveloperCommands } from './player/dev-commands.js'
import { initializeMusicSystem } from './audio/music-system.js'
import {
  initializeFluidRegistry,
  updateFluids,
  registerFluidSurfaceLifecycle,
} from './world/fluids/fluid-registry.js'
import {
  createParticleSystem,
  computeFluidSurfaceAnchor,
} from './rendering/particle-system.js'
import { createWaterSurfaceMistEmitter } from './rendering/particles/water-effects.js'
import { createAuroraRibbonEmitter } from './rendering/particles/aurora-effects.js'
import { createLumenBloomMotesEmitter } from './rendering/particles/lumen-bloom-effects.js'
import { createWeatherManager } from './world/weather/weather-manager.js'
import { createEntityManager, registerBuiltinEntities } from './entities/index.js'
import {
  applySkybox,
  FALLBACK_SKYBOX_ID,
  getSkyboxSceneSettings,
  resolveSkyboxRequest,
} from './rendering/skyboxes/skybox-manager.js'
import {
  computeChunkFogRange,
  easeFogTowardRange,
  computeChunkCameraFarDistance,
} from './rendering/fog-utils.js'

const FOG_EASING_STRENGTH = 3.5
const CAMERA_FAR_EASING_STRENGTH = 3.5
const RENDER_READY_MARKER = '[render-ready] FIRST_CHUNK_MESHED'

function applyFogSettingsToScene(targetScene, fogSettings) {
  if (!targetScene || !fogSettings) {
    return
  }
  const { fogColor, fogNear, fogFar } = fogSettings
  if (!targetScene.fog) {
    targetScene.fog = new THREE.Fog(fogColor, fogNear, fogFar)
    return
  }
  targetScene.fog.color.set(fogColor)
  targetScene.fog.near = fogNear
  targetScene.fog.far = fogFar
}

function createUnderwaterOverlay() {
  const existing = document.getElementById('underwater-overlay')
  if (existing) {
    return { element: existing, dispose: () => {} }
  }

  const element = document.createElement('div')
  element.id = 'underwater-overlay'
  element.setAttribute('aria-hidden', 'true')

  const desiredBubbleCount = Number.parseInt(
    document.body.dataset.underwaterBubbleCount ?? '',
    10,
  )
  const bubbleCount = Number.isFinite(desiredBubbleCount)
    ? Math.max(0, Math.round(desiredBubbleCount))
    : 6

  for (let i = 0; i < bubbleCount; i += 1) {
    const bubble = document.createElement('span')
    bubble.className = 'bubble'
    bubble.style.setProperty('--bubble-left', `${Math.random() * 100}%`)
    bubble.style.setProperty('--bubble-delay', `${Math.random() * -6}s`)
    bubble.style.setProperty('--bubble-duration', `${12 + Math.random() * 6}s`)
    bubble.style.setProperty('--bubble-scale', `${0.6 + Math.random() * 0.9}`)
    element.appendChild(bubble)
  }

  document.body.appendChild(element)
  return {
    element,
    dispose: () => {
      element.remove()
    },
  }
}

function bootLegacyRuntime() {
  const overlay = document.getElementById('overlay')
  const overlayStatus = overlay?.querySelector('#overlay-status')
  const underwaterOverlayHandle = createUnderwaterOverlay()
  const underwaterOverlay = underwaterOverlayHandle.element

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

  setOverlayStatus('Generating world terrain…')

  // Rely on the descriptor defaults so the world boots with lighter 48³ chunks.
  applyWorldOptions({})
  initializeWorldGeneration({ THREE })
  initializeFluidRegistry({ THREE })

  const worldConfig = getWorldOptions()

  const skyboxRequest = resolveSkyboxRequest({ worldOptions: worldConfig })
  const initialSkyboxSettings = getSkyboxSceneSettings(skyboxRequest.id)

  const scene = new THREE.Scene()
  applyFogSettingsToScene(scene, initialSkyboxSettings)

  const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    500,
  )
  camera.position.set(0, 25, 30)

  const getTargetPixelRatio = () => Math.min(window.devicePixelRatio ?? 1, 1.5)

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(getTargetPixelRatio())
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.1
  document.body.appendChild(renderer.domElement)

  async function configureInitialSkybox(request) {
    if (!request) {
      return null
    }

    const attemptApply = async (targetId) => {
      const result = await applySkybox({
        THREE,
        renderer,
        scene,
        id: targetId,
        seed: request.seed,
      })
      if (result?.sceneSettings) {
        applyFogSettingsToScene(scene, result.sceneSettings)
      }
      if (result && result.id !== result.requestedId) {
        console.info(
          `[rendering] Skybox '${result.requestedId}' unavailable, using '${result.id}' instead.`,
        )
      }
      return result
    }

    try {
      return await attemptApply(request.id)
    } catch (error) {
      console.error(`[rendering] Failed to load skybox "${request.id}".`, error)
      if (request.id !== FALLBACK_SKYBOX_ID) {
        console.warn(
          `[rendering] Falling back to '${FALLBACK_SKYBOX_ID}' skybox after load failure.`,
        )
        try {
          return await attemptApply(FALLBACK_SKYBOX_ID)
        } catch (fallbackError) {
          console.error(
            `[rendering] Failed to load fallback skybox '${FALLBACK_SKYBOX_ID}'.`,
            fallbackError,
          )
        }
      }
      applyFogSettingsToScene(scene, getSkyboxSceneSettings(FALLBACK_SKYBOX_ID))
      return null
    }
  }

  configureInitialSkybox(skyboxRequest).catch((error) => {
    console.error('[rendering] Unexpected skybox configuration error.', error)
  })

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
    underwaterOverlay.classList.toggle('visible', Boolean(state.isUnderwater))
    underwaterOverlay.setAttribute(
      'aria-hidden',
      state.isUnderwater ? 'false' : 'true',
    )
  }

  let blockMaterials
  let chunkManager
  let particleSystem
  let playerControls
  let weatherManager
  let entityManager
  let initializationError = null

  try {
    blockMaterials = createBlockMaterials({ THREE })

    chunkManager = createChunkManager({
      scene,
      blockMaterials,
      viewDistance: 2,
      retainDistance: 4,
      disposalMargin: 4,
      maxPreloadPerUpdate: 1,
    })

    if (chunkManager?.events?.addEventListener) {
      const removeListener = chunkManager.events.addEventListener(
        ChunkManagerEvents.FIRST_CHUNK_MESHED,
        (event) => {
          console.info(RENDER_READY_MARKER, event?.detail ?? {})
          setOverlayStatus('')
          if (playerControls && typeof playerControls.setInputEnabled === 'function') {
            playerControls.setInputEnabled(true)
          }
          removeListener?.()
        },
      )
    }

    particleSystem = createParticleSystem({ THREE, scene })

    weatherManager = createWeatherManager({
      scene,
      particleSystem,
      registerDiagnosticOverlay,
    })

    registerFluidSurfaceLifecycle({
      onCreated: ({ type, mesh, runtime }) =>
        particleSystem.notifyFluidSurfaceCreated({ type, mesh, runtime }),
      onDisposed: ({ type, mesh, runtime }) =>
        particleSystem.notifyFluidSurfaceDisposed({ type, mesh, runtime }),
    })

    particleSystem.registerFluidSurfaceEffect('water', ({ mesh, emit }) => {
      const anchor = computeFluidSurfaceAnchor({ THREE, mesh, surfaceOffset: 0.6 })
      if (!anchor) {
        return null
      }
      const handle = emit(
        createWaterSurfaceMistEmitter({
          position: anchor,
          intensity: 1.05,
        }),
      )
      return {
        dispose: () => handle?.stop?.(),
      }
    })

    particleSystem.registerFluidSurfaceEffect(
      'lumen_bloom',
      ({ mesh, emit, metadata, cues }) => {
        const cueSource = Array.isArray(cues) && cues.length > 0
          ? cues
          : Array.isArray(metadata?.lifecycleCues)
          ? metadata.lifecycleCues
          : mesh.userData?.lifecycleCues
        if (!Array.isArray(cueSource) || !cueSource.includes('aurora_ribbon')) {
          return null
        }
        const anchor = computeFluidSurfaceAnchor({ THREE, mesh, surfaceOffset: 0.9 })
        if (!anchor) {
          return null
        }
        const geometry = mesh.geometry
        if (geometry && !geometry.boundingBox) {
          geometry.computeBoundingBox?.()
        }
        const bounds = geometry?.boundingBox ?? null
        let span = 4.6
        if (bounds) {
          span = Math.max(span, bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z)
        }
        const intensityValue = metadata?.auroraIntensity ?? mesh.userData?.auroraIntensity
        const orientationValue = metadata?.ribbonOrientation ?? mesh.userData?.ribbonOrientation
        const intensity = Number.isFinite(intensityValue) ? intensityValue : 1
        const orientation = Number.isFinite(orientationValue) ? orientationValue : 0
        const handles = []
        handles.push(
          emit(
            createAuroraRibbonEmitter({
              position: anchor,
              span,
              intensity,
              orientation,
            }),
          ),
        )
        handles.push(
          emit(
            createLumenBloomMotesEmitter({
              position: anchor,
              radius: span * 0.55,
              intensity: intensity * 0.9,
              riseHeight: Math.max(2.4, span * 0.35),
            }),
          ),
        )
        return {
          dispose: () => {
            for (const handle of handles) {
              handle?.stop?.()
            }
          },
        }
      },
    )

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
      particleSystem,
      damageMaterials: blockMaterials.damageStages,
      onStateChange: updateHud,
    })

    const shouldPauseInput =
      playerControls && typeof playerControls.setInputEnabled === 'function'
    if (shouldPauseInput) {
      playerControls.setInputEnabled(false)
    }

    if (typeof chunkManager.preloadAround === 'function') {
      chunkManager.preloadAround(playerControls.getPosition(), 4, {
        viewDistance: 2,
      })
    }

    chunkManager.setViewDistance(2)
    chunkManager.setRetentionDistance(4)

    chunkManager.update(playerControls.getPosition(), { camera })

    const initialFogRange = computeChunkFogRange({ chunkManager, worldConfig })
    if (scene.fog && initialFogRange) {
      if (Number.isFinite(initialFogRange.near)) {
        scene.fog.near = initialFogRange.near
      }
      if (Number.isFinite(initialFogRange.far)) {
        scene.fog.far = initialFogRange.far
      }
    }

    const initialCameraFar = computeChunkCameraFarDistance({
      chunkManager,
      worldConfig,
      fogRange: initialFogRange,
    })
    if (Number.isFinite(initialCameraFar)) {
      camera.far = initialCameraFar
      camera.updateProjectionMatrix?.()
    }

    updateHud(playerControls.getState())

    registerBuiltinEntities()

    entityManager = createEntityManager({
      THREE,
      scene,
      camera,
      chunkManager,
      playerControls,
      terrainHeight,
      sampleBiomeAt,
      weatherManager,
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
      debugNamespace.weather = weatherManager
      debugNamespace.entities = entityManager

      let perfFlightModulePromise = null
      const resolvePerfFlightModule = () => {
        if (!perfFlightModulePromise) {
          perfFlightModulePromise = import('./devtools/perf-flight-harness.js')
        }
        return perfFlightModulePromise
      }

      const perfFlightNamespace =
        (debugNamespace.perfFlight = debugNamespace.perfFlight || {})
      perfFlightNamespace.run = (options = {}) =>
        resolvePerfFlightModule().then(({ runPerfFlight }) =>
          runPerfFlight({
            playerControls,
            registerDiagnosticOverlay,
            renderer,
            chunkManager,
            ...options,
          }),
        )

      const perfFlightMode = new URLSearchParams(window.location.search).get(
        'perfFlight',
      )
      if (perfFlightMode === 'auto') {
        perfFlightNamespace
          .run()
          .catch((error) =>
            console.error('Perf flight harness failed to complete:', error),
          )
      }
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
      camera,
      THREE,
      registerDiagnosticOverlay,
      particleSystem,
      weatherManager,
      entityManager,
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

  let animationFrameId = null
  const cancelRenderLoop = () => {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId)
      animationFrameId = null
    }
  }

  if (!initializationError) {
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate)
      const delta = Math.min(clock.getDelta(), 0.05)
      const elapsedTime = clock.elapsedTime

      chunkManager.update(playerControls.getPosition(), { camera })
      playerControls.update(delta)
      updateFluids(delta)
      particleSystem?.update(delta)
      weatherManager?.update({
        delta,
        elapsedTime,
        playerControls,
      })
      entityManager?.update({
        delta,
        elapsedTime,
        playerControls,
        camera,
      })

      if (chunkManager) {
        const targetFogRange = computeChunkFogRange({ chunkManager, worldConfig })
        if (scene.fog && targetFogRange) {
          easeFogTowardRange({
            fog: scene.fog,
            targetRange: targetFogRange,
            delta,
            easing: FOG_EASING_STRENGTH,
          })
        }

        const targetCameraFar = computeChunkCameraFarDistance({
          chunkManager,
          worldConfig,
          fogRange: targetFogRange ?? undefined,
        })
        if (Number.isFinite(targetCameraFar)) {
          const currentFar = Number.isFinite(camera.far)
            ? camera.far
            : targetCameraFar
          const factor =
            Number.isFinite(delta) && delta > 0
              ? 1 - Math.exp(-Math.max(0, CAMERA_FAR_EASING_STRENGTH) * delta)
              : 1
          const nextFar = THREE.MathUtils.lerp(currentFar, targetCameraFar, factor)
          if (Number.isFinite(nextFar) && typeof camera.updateProjectionMatrix === 'function') {
            const difference = Math.abs(nextFar - camera.far)
            if (difference > 0.01) {
              camera.far = nextFar
              camera.updateProjectionMatrix()
            } else if (Math.abs(targetCameraFar - camera.far) > 0.001) {
              camera.far = targetCameraFar
              camera.updateProjectionMatrix()
            }
          }
        }
      }

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
  }

  const beforeUnloadHandler = () => {
    playerControls?.dispose()
    void chunkManager?.dispose()
    musicSystem?.dispose()
    particleSystem?.dispose()
    weatherManager?.dispose?.()
    entityManager?.dispose()
  }

  window.addEventListener('beforeunload', beforeUnloadHandler)

  const removeBeforeUnloadListener = () => {
    window.removeEventListener('beforeunload', beforeUnloadHandler)
  }

  const disposeHud = () => {
    hud.remove()
    underwaterOverlayHandle.dispose()
    setOverlayStatus('')
  }

  return {
    cancelRenderLoop,
    removeBeforeUnloadListener,
    disposeHud,
    dispose: () => {
      cancelRenderLoop()
      removeBeforeUnloadListener()
      disposeHud()
    },
  }
}

function bootHybridRuntime(runtimeOptions = {}) {
  console.info('[runtime] Hybrid runtime bootstrap (experimental).')

  applyWorldOptions({})
  initializeWorldGeneration({ THREE })
  initializeFluidRegistry({ THREE })

  const scene = new THREE.Scene()
  const blockMaterials = createBlockMaterials({ THREE })
  const persistenceService = createPersistenceService()
  const workerBroker = createWorkerBroker()
  const worldService = createWorldService({
    scene,
    blockMaterials,
    viewDistance: 2,
    retainDistance: 4,
    disposalMargin: 4,
    maxPreloadPerUpdate: 1,
  }, { persistenceService, workerBroker })

  const sampleKeys = {
    cpu: 'runtime:js-heap',
    gpu: 'runtime:renderer-info',
  }
  let samplingActive = true
  let sampleFrameHandle = null
  const rendererForSampling = runtimeOptions?.renderer ?? null

  const sampleMemory = () => {
    if (!samplingActive) {
      return
    }
    const timestamp =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now()
    const rendererInfo = rendererForSampling?.info?.memory ?? null
    if (rendererInfo) {
      const programsInfo = rendererForSampling.info?.programs ?? 0
      const programCount = Array.isArray(programsInfo)
        ? programsInfo.length
        : Number(programsInfo) || 0
      budgetRegistry.request(GPU_POOL, sampleKeys.gpu, 0, {
        source: 'renderer.info.memory',
        geometries: Number(rendererInfo.geometries) || 0,
        textures: Number(rendererInfo.textures) || 0,
        programs: programCount,
        timestamp,
      })
    }
    if (typeof performance !== 'undefined' && performance?.memory) {
      const { usedJSHeapSize, totalJSHeapSize, jsHeapSizeLimit } = performance.memory
      budgetRegistry.request(CPU_POOL, sampleKeys.cpu, usedJSHeapSize ?? 0, {
        source: 'performance.memory',
        totalJSHeapSize: totalJSHeapSize ?? null,
        jsHeapSizeLimit: jsHeapSizeLimit ?? null,
        timestamp,
      })
    }
    if (typeof requestAnimationFrame === 'function') {
      sampleFrameHandle = requestAnimationFrame(sampleMemory)
    }
  }

  if (
    typeof requestAnimationFrame === 'function' &&
    (rendererForSampling?.info?.memory ||
      (typeof performance !== 'undefined' && performance?.memory))
  ) {
    sampleFrameHandle = requestAnimationFrame(sampleMemory)
  }

  const stopSampling = () => {
    samplingActive = false
    if (sampleFrameHandle !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(sampleFrameHandle)
    }
    sampleFrameHandle = null
    budgetRegistry.release(CPU_POOL, sampleKeys.cpu)
    budgetRegistry.release(GPU_POOL, sampleKeys.gpu)
  }

  return {
    cancelRenderLoop: () => {},
    removeBeforeUnloadListener: () => {},
    disposeHud: () => {},
    dispose: () => {
      stopSampling()
      workerBroker.terminate()
      worldService.dispose()
    },
    worldService,
    workerBroker,
  }
}

const runtimeHandles = FLAGS.RUNTIME_V2 ? bootHybridRuntime() : bootLegacyRuntime()
void runtimeHandles

export { bootHybridRuntime, bootLegacyRuntime }

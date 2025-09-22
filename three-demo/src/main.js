import * as THREE from 'three'

import { createBlockMaterials } from '../../src/rendering/textures.js'
import { terrainHeight, worldConfig } from '../../src/world/generation.js'
import { createChunkManager } from '../../src/world/chunk-manager.js'
import { createPlayerControls } from '../../src/player/controls.js'

const overlay = document.getElementById('overlay')

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

const blockMaterials = createBlockMaterials()

const chunkManager = createChunkManager({
  scene,
  blockMaterials,
  viewDistance: 2,
})

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

const healthFill = hud.querySelector('#hud-health-fill')
const healthValue = hud.querySelector('#hud-health-value')
const oxygenFill = hud.querySelector('#hud-oxygen-fill')
const oxygenValue = hud.querySelector('#hud-oxygen-value')
const statusElement = hud.querySelector('#hud-status')

function updateHud(state) {
  const healthPercent = THREE.MathUtils.clamp(state.health / 100, 0, 1)
  healthFill.style.width = `${healthPercent * 100}%`
  healthValue.textContent = `${Math.round(state.health)}`

  const oxygenPercent = THREE.MathUtils.clamp(state.oxygen / state.maxOxygen, 0, 1)
  oxygenFill.style.width = `${oxygenPercent * 100}%`
  oxygenValue.textContent = `${state.oxygen.toFixed(1)}`

  statusElement.textContent = state.statusMessage ?? ''
  statusElement.classList.toggle('visible', Boolean(state.statusMessage))
  hud.classList.toggle('in-water', state.isInWater)
}

const playerControls = createPlayerControls({
  scene,
  camera,
  renderer,
  overlay,
  worldConfig,
  terrainHeight,
  solidBlocks: chunkManager.solidBlocks,
  waterColumns: chunkManager.waterColumns,
  onStateChange: updateHud,
})

chunkManager.update(playerControls.getPosition())
updateHud(playerControls.getState())

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

const waterMaterial = blockMaterials.water
let waveTime = 0

function animate() {
  requestAnimationFrame(animate)
  const delta = Math.min(clock.getDelta(), 0.05)

  chunkManager.update(playerControls.getPosition())
  playerControls.update(delta)

  waveTime += delta
  const waveOffset = (Math.sin(waveTime * 0.8) + 1) * 0.06
  waterMaterial.map.offset.y = waveOffset

  renderer.render(scene, camera)
}

animate()

window.addEventListener('beforeunload', () => {
  playerControls.dispose()
  chunkManager.dispose()
})

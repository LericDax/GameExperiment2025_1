# Procedural Block World – System Schematic

This annotated schematic captures the major subsystems inside the Vite-powered sandbox under `three-demo/`. Use it as a map when planning features, triaging regressions, or onboarding collaborators.

---

## 1. Boot Sequence & Runtime Loop

```
[Entry (src/main.js)]
    │  applyWorldOptions() → initializeWorldGeneration()
    │  initializeFluidRegistry() → resolve skybox + fog
    │
    ├─▶ createBlockMaterials()
    ├─▶ createChunkManager() ──┐
    ├─▶ createParticleSystem()  │  registers fluid surface hooks
    ├─▶ createWeatherManager()  │  (rain/snow/aurora emitters)
    ├─▶ createPlayerControls()  │
    ├─▶ registerBuiltinEntities() + createEntityManager()
    ├─▶ createCommandConsole() + registerDeveloperCommands()
    └─▶ initializeMusicSystem()
           │
           ▼
[Main loop]
  chunkManager.update(camera, player)
  playerControls.update(delta)
  updateFluids(delta)
  particleSystem.update(delta)
  weatherManager.update(delta, elapsed)
  entityManager.update(delta, elapsed)
  diagnostic overlays (perf flight, weather, etc.)
  renderer.render(scene, camera)
```

**Key notes**
- `src/main.js` orchestrates startup, wiring DOM overlays, audio, controls, and debug namespaces before starting the animation loop.
- Deferred resources (chunk mesh, fluids, particles) expose `dispose()` hooks that the beforeunload handler tears down.

---

## 2. World Generation & Chunk Pipeline

```
Terrain seed & world options
    │
    ▼
createTerrainEngine()  ──┐
  (TFMS operators + biome blending)
                          │
createChunkManager()  ◀───┘
  ├─ maintains view/retention radii
  ├─ schedules build tasks per chunk key
  ├─ shares solid/soft block registries with player controls
  ├─ tracks fluid columns & surface metadata
  └─ notifies FIRST_CHUNK_MESHED → bootstrap HUD/input

[Chunk build lifecycle]
  enqueue → (main thread) createChunkBuildTask()
           → worker? createChunkBuildWorker()
             ├─ buildChunkPayload()
             │    • sample terrain via terrain-engine + biome engine
             │    • populate voxel objects & fluids
             │    • serialize instanced decorations, fluid columns
             └─ transfer payload back
           → finalizeChunkMeshes() (geometry + materials)
           → pruneOccludedInstancedEntries()
           → deriveCollisionKeySetsFromMesh()
           → register fluid surfaces (for mist/aurora cues)
```

**Operational checkpoints**
- Worker path is toggled via `__ENABLE_CHUNK_WORKER__` or Vite env flags; fallback keeps meshing on the main thread when workers fail.
- Terrain sampling flows through the TFMS network described in `docs/tfms-system.md`, with biome overrides resolved per column.
- `terrain-sample-cache` tracks reused samples and exposes debug stats for perf instrumentation.

---

## 3. Rendering & Visual Effects Stack

```
createBlockMaterials() → texture atlas & damage stages
createSkyboxManager()  → procedural or HDR panoramas + fog settings
WebGLRenderer          → ACES tone mapping, soft shadows, capped DPR
Lighting rig           → ambient + hemisphere + shadow-casting directional
ParticleSystem         → GPU instanced pools (billboards, motes, mist)
  ├─ Water surface mist emitters (weather & fluid registry callbacks)
  ├─ Aurora ribbons + lumen motes
  └─ Weather rain/snow streaks & splashes
```

**Visual integration**
- Particle emitters expose `initialize/update/stop/dispose` hooks; the system manages instanced buffer growth and bounding volumes automatically.
- Fluid surfaces notify the particle system when created/disposed so VFX can anchor to water or lumen-bloom pools.
- Skybox changes (via developer console) immediately refresh fog uniforms to keep atmospheric depth coherent.

---

## 4. Fluid Simulation & Weather Control

```
initializeFluidRegistry()
  ├─ registerFluidSurfaceLifecycle(onCreated/onDisposed)
  ├─ buildFluidGeometry() + lumen ribbon geometry
  └─ updateFluids(delta)

createWeatherManager()
  ├─ Manages weather presets (rain, snow, aurora hybrids)
  ├─ Spawns precipitation & aurora emitters around player anchors
  ├─ Drives DOM raindrop/snow overlays via CSS variables
  ├─ Coordinates audio cues (wind, precipitation loops)
  ├─ Exposes developer toggles (/weather commands)
  └─ Publishes debug overlays + diagnostic callbacks
```

**Environmental coupling**
- Weather intensity feeds both particle spawn rates and overlay density, while audio controller crossfades matching loops.
- Precipitation presets can inject lifecycle cues that particle emitters interpret (e.g., aurora ribbons around lumen pools).

---

## 5. Player Controller & Entity Ecosystem

```
createPlayerControls()
  ├─ PointerLockControls wrapper
  ├─ Integrates collision against solid/soft block sets
  ├─ Tracks health, oxygen, water immersion → HUD updates
  ├─ Emits status banner messages & underwater overlay state
  └─ Exposes movement APIs for dev console + perf flight

createEntityManager()
  ├─ Loads entity registry (registerBuiltinEntities → crowned ghosts)
  ├─ Bridges AI core to presentation (animations, navigation)
  ├─ Queries chunkManager for terrain/biome sampling
  └─ Updates entities each frame (movement, behaviors, VFX hooks)
```

**Developer console hooks**
- `/goto`, `/weather`, `/vfx`, `/skybox`, and ASCII tooling live in `player/dev-commands.js`, sharing the command console’s event bus.
- Debug namespace on `window.__VOXEL_DEBUG__` exposes player pose setters, chunk snapshots, weather controls, and automated perf flights.

---

## 6. UI, Audio & Console Overlays

```
HUD (Health/Oxygen/Status)
  ├─ Toggled error overlay on boot failures
  ├─ Underwater bubble overlay seeded from <body data-*>
  └─ Status overrides for console messages & damage feedback

initializeMusicSystem()
  ├─ Scans /src/sounds/music/tracks for bundled assets
  ├─ Injects volume widget (play/pause/next, slider)
  └─ Persists mute/volume state between sessions

createCommandConsole()
  ├─ Backquote toggles overlay; releases pointer lock as needed
  ├─ `/help` surfaces registered commands + usage metadata
  └─ Accepts typed command definitions from dev-commands

Weather Overlay Controller
  ├─ Manages DOM snowfall/rainfall pools
  └─ Syncs CSS density variables with weather presets
```

---

## 7. Developer Tooling & Observability

- **Perf Flight Harness**: `devtools/perf-flight-harness.js` records renderer stats, chunk coverage, and frame timing. The debug namespace can auto-run it (`?perfFlight=auto`).
- **Terrain/TFMS Diagnostics**: `world/__tests__` houses Node-based tests for biome blending, TFMS schemata, chunk serialization, and weather scheduling.
- **Voxel Placement Debugging**: `__ENABLE_VOXEL_OBJECT_DEBUG__` flag surfaces placement logs across main thread and workers.
- **Diagnostic Overlays**: `registerDiagnosticOverlay` lets systems (perf flight, weather debug) render frame-by-frame instrumentation without polluting the main loop.

---

## 8. Content & Configuration Surfaces

- **World Options**: `WORLD_CONFIGURATION.md` documents tunable settings; `world/world-settings.js` applies overrides with defaults for chunk size, heights, TFMS seeds, etc.
- **Biomes & VO Objects**: JSON catalogs under `src/world/biomes/` and `src/world/voxel-objects/` feed the sector planner and decoration meshes.
- **Textures & Audio**: Drop-in workflows live in `src/textures/nonprocedural/` and `src/sounds/`, enabling artists to iterate without touching code.
- **Docs Folder**: Deep-dive references (TFMS operators, Kamea matrices, AI guides, terrain threading) explain the math & heuristics behind runtime modules.

---

### How to Use This Map

1. **Planning** – Identify which subsystem owns a feature (e.g., new precipitation effect touches weather manager + particle emitters + overlay controller).
2. **Risk Analysis** – Trace async boundaries (chunk worker, fluid registry callbacks) before estimating QA needs.
3. **Onboarding** – Point engineers to concrete entry files and debug tools so local runs mirror production builds.
4. **Future Docs** – Append subsections here as new modules land (e.g., crafting systems, inventory UI) to keep the schematic authoritative.


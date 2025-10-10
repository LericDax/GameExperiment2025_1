# Terrain Threading Migration Plan

## Current Main-Thread Flow
- `createChunkManager` synchronously calls `generateChunk` whenever a chunk must be ensured, which blocks the render loop while terrain is sampled and meshed.【F:three-demo/src/world/chunk-manager.js†L1006-L1045】
- `generateChunk` bootstraps the TFMS terrain engine via `ensureTerrainEngine()` and performs column sampling, slope analysis, fluid lookup, and instanced mesh preparation entirely on the main thread.【F:three-demo/src/world/generation.js†L210-L245】【F:three-demo/src/world/generation.js†L390-L479】
- Terrain sampling relies on `engine.sampleColumn(x, z)` per column; this is the dominant CPU hotspot we want to move off-thread without rewriting the entire chunk pipeline.【F:three-demo/src/world/generation.js†L408-L436】

## Target Outcome
Move only the TFMS terrain evaluation (column height, biome metadata, ancillary scalar fields) to a worker thread so the main thread receives precomputed terrain columns while retaining existing meshing, decoration, and fluid handling logic. The result should dramatically reduce frame stutters during chunk creation while minimizing code churn.

## Key Constraints & Assumptions
1. **Minimal Surface Area:** Keep existing chunk data structures intact; only swap the source of column samples and related biome metadata.
2. **Deterministic Results:** Worker-side sampling must be seeded identically to the main thread `createTerrainEngine` to avoid terrain seams.
3. **Progressive Integration:** Maintain a synchronous fallback for debug builds or unsupported browsers.
4. **Data Transfer Efficiency:** Column results must be serializable (plain objects/typed arrays) to avoid structured clone pitfalls and excessive GC pressure.

## Work Breakdown

### 1. Worker Infrastructure Baseline
- Add a dedicated `terrain-worker.js` module that can bootstrap Three.js-independent TFMS sampling with `createTerrainEngine` and respond to messages.
- Expose an initialization message (`INIT`) accepting seed, world options, and optional transferable buffers for shared lookup tables.
- Implement a `SAMPLE_COLUMNS` message that receives chunk coordinates plus the list of column offsets to evaluate, returning heights, biome ids, slope hints, and any other scalar fields `generateChunk` currently derives from `engine.sampleColumn`.
- Include structured types and TypeScript-style JSDoc for clarity even if the repo is JS-only.

### 2. Main-Thread Worker Adapter
- Create a `TerrainWorkerClient` utility (e.g., `src/world/terrain-worker-client.js`) that hides message IDs, batches requests, and resolves Promises when responses arrive.
- Handle worker lifecycle: lazy instantiate, forward initialization data from `initializeWorldGeneration`, and dispose during world resets.
- Provide `sampleColumns(chunkX, chunkZ, coordinates[])` API returning the worker payload in the same shape expected by `generateChunk`'s local helpers.

### 3. Refactor Generation Entry Points
- Update `initializeWorldGeneration` to initialize both the main-thread terrain engine (for fallback) and the worker client, ensuring they share identical seeds/options.【F:three-demo/src/world/generation.js†L226-L245】
- Gate synchronous terrain usage behind a feature flag or runtime capability check so we can toggle between worker-backed and legacy flows.
- Inject the worker client into `generateChunk` (perhaps via module-level setter or function parameter) and replace direct `engine.sampleColumn` calls with asynchronous column fetches.
- Because `generateChunk` is currently synchronous, introduce a `generateChunkAsync` path that awaits worker data before continuing; adapt `createChunkManager` to await results when preloading chunks off the main thread loop (e.g., inside `update` scheduling).

### 4. Meshing Pipeline Adaptation
- Ensure instanced mesh assembly can operate after receiving worker data by splitting `generateChunk` into "collect terrain data" and "construct Three.js objects" stages.
- Cache worker responses so repeated access within meshing (e.g., slope, water distance calculations) uses local maps without re-requesting the worker.
- Maintain compatibility with legacy synchronous mode by keeping existing helper signatures but delegating to the async pathway when the worker is enabled.

### 5. Scheduling & Budgeting
- Modify `createChunkManager`'s preload loop to request terrain data ahead of time, returning control to the render loop while awaiting worker promises.【F:three-demo/src/world/chunk-manager.js†L1006-L1045】
- Implement a simple job queue that resolves `maxPreloadPerUpdate` worker jobs per frame, emitting chunks once terrain data is ready.
- Add metrics/logging hooks (Dev build only) to measure worker turnaround and queue depth for tuning.

### 6. Testing & Diagnostics
- Provide unit-style tests or integration harnesses that verify worker and synchronous sampling produce identical heights for deterministic seeds (reuse existing `__tests__` harness if possible).
- Add a debug toggle (query param or dev UI) to switch between worker and legacy paths at runtime for regression checks.
- Document the new threading model in `docs/` including troubleshooting steps (e.g., browser worker limits).

## Follow-Up Enhancements (Post-MVP)
- Share typed arrays between worker and main thread for large batches to minimize GC churn.
- Move biome blending and decoration selection into the worker once terrain offloading proves stable.
- Investigate reusing a pool of workers if fluid simulation or entity spawning also needs parallelization.

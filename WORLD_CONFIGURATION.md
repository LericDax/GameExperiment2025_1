# World Configuration

This reference aggregates every tunable world-generation option exposed by the voxel sandbox, including the Terrain FM Synthesis (TFMS) configuration stack. Labels, descriptions, defaults, and ranges originate from `three-demo/src/world/world-option-descriptors.js`, which the runtime also uses to clamp override values. Keep the tables below synchronized with descriptor updates so TFMS, terrain, biome, and environmental parameters stay accurate during iteration.

## Mob AI Core integration

- The crowned ghost runner uses the shared AI systems documented in the [Mob AI Core Guide](three-demo/docs/mob-ai-core.md). Review that document for architecture diagrams, persona schemas, and extension workflows.
- To see the AI in action within a configured world, register builtin entities and spawn the runner via the entity manager:
  ```js
  import { registerBuiltinEntities, createEntityManager } from './entities/index.js';

  registerBuiltinEntities();
  const manager = await createEntityManager({ /* world handles */ });
  manager.spawnEntity('crowned_ghost_2', {
    position: { x: 12, y: 18, z: -6 },
    behavior: { walkSpeed: 1.05 },
  });
  ```
- Behavior modifiers such as walk speed or idle durations can be overridden through the `behavior` object passed at spawn time—this approach keeps world option descriptors focused on terrain while still letting you tune the ghost runner per world preset.

## Option Reference

### Seed
| Path | Label | Description | Type | Default | Range | Step |
| --- | --- | --- | --- | --- | --- | --- |
| `seed` | World Seed | Seed value used to deterministically generate terrain, biomes, and structures. | `seed` | `1337` | _n/a_ | _n/a_ |

### Chunk Configuration
| Path | Label | Description | Type | Default | Range | Step |
| --- | --- | --- | --- | --- | --- | --- |
| `chunk.size` | Chunk Size | Voxel width/height/depth of each generated chunk. | `number` | `48` | `1` – `512` | `1` |
| `chunkSize` | Chunk Size (alias) | Legacy top-level alias that mirrors the chunk size setting. | `number` | `48` | `1` – `512` | `1` |

### Water
| Path | Label | Description | Type | Default | Range | Step |
| --- | --- | --- | --- | --- | --- | --- |
| `water.level` | Water Level | Absolute voxel height for the ocean surface. | `number` | `9` | `-128` – `256` | `1` |
| `waterLevel` | Water Level (alias) | Legacy top-level alias that mirrors the water level setting. | `number` | `9` | `-128` – `256` | `1` |

### Environment
| Path | Label | Description | Type | Default | Range | Step |
| --- | --- | --- | --- | --- | --- | --- |
| `environment.skyboxId` | Skybox | Select which bundled skybox or procedural backdrop surrounds the world. | `enum` | `"skybox-1#invertY"` | _n/a_ | _n/a_ |

Skybox IDs are sourced from `listSkyboxes()`, which enumerates the HDR and LDR panoramas discovered by Vite and prefixes the procedural fallback. The shipped configuration targets `skybox-1#invertY`, which flips the bundled `skybox-1.jpg` to compensate for inverted latitude bands; drop your replacement equirectangular panorama into `three-demo/public/assets/skyboxes/` with that filename to override the placeholder. Other IDs—such as `procedural-default` or bundled EXR stems—remain available for experimentation.【F:three-demo/src/world/world-option-descriptors.js†L26-L64】【F:three-demo/src/rendering/skyboxes/skybox-manager.js†L14-L188】 Use the developer-console `/skybox load`, `/skybox unload`, and `/skybox rotate` helpers to validate these configuration changes at runtime or to compare bundled panoramas against the procedural fallback without rebuilding. 【F:three-demo/src/player/dev-commands.js†L1846-L2042】

### Terrain
| Path | Label | Description | Type | Default | Range | Step |
| --- | --- | --- | --- | --- | --- | --- |
| `terrain.baseHeight` | Base Height | Average terrain elevation before noise-based variation. | `number` | `10` | `0` – `512` | `1` |
| `terrain.maxHeight` | Maximum Height | Hard cap on how tall terrain columns may grow before clamping to a ceiling. | `number` | `144` | `1` – `1024` | `1` |
| `terrain.clamp.min` | Clamp Minimum | Lower clamp bound applied after noise sampling to prevent deep pits. | `number` | `-144` | `-144` – `1024` | `1` |
| `terrain.clamp.max` | Clamp Maximum | Upper clamp bound applied after noise sampling to prevent towering spikes. | `number` | `144` | `1` – `1024` | `1` |
| `terrain.primaryFrequency` | Primary Frequency | Base frequency for macro terrain variation. Lower values create large landforms. | `number` | `0.06` | `0.0001` – `1` | `0.0001` |
| `terrain.primaryAmplitude` | Primary Amplitude | Strength of the macro terrain wave. Higher values exaggerate hills and valleys. | `number` | `80` | `0` – `256` | `0.1` |
| `terrain.primaryOffset` | Primary Offset | Phase offset applied to the macro terrain noise field. | `number` | `0` | `-10000` – `10000` | `1` |
| `terrain.detailFrequency` | Detail Frequency | Frequency of secondary detail used to break up flat areas. | `number` | `0.12` | `0.0001` – `2` | `0.0001` |
| `terrain.detailAmplitude` | Detail Amplitude | Strength of the secondary detail contribution. | `number` | `30` | `0` – `128` | `0.1` |
| `terrain.detailOffset` | Detail Offset | Phase offset for the detail terrain noise. | `number` | `100` | `-10000` – `10000` | `1` |
| `terrain.ridgeFrequency` | Ridge Frequency | Frequency controlling how often sharp ridgelines occur. | `number` | `0.02` | `0.0001` – `1` | `0.0001` |
| `terrain.ridgeStrength` | Ridge Strength | Strength multiplier for ridge contributions on top of base terrain. | `number` | `24` | `0` – `64` | `0.1` |
| `terrain.ridgeOffset` | Ridge Offset | Phase offset for the ridge noise sampler. | `number` | `220` | `-10000` – `10000` | `1` |
| `terrain.climateHeightInfluence` | Climate Height Influence | How strongly biome climate data affects the perceived terrain elevation. | `number` | `1.2` | `-10` – `10` | `0.05` |
| `baseHeight` | Base Height (alias) | Legacy top-level alias mirroring the terrain base height for compatibility. | `number` | `10` | `0` – `512` | `1` |
| `maxHeight` | Max Height (alias) | Legacy top-level alias mirroring the terrain max height for compatibility. | `number` | `144` | `1` – `1024` | `1` |

The descriptor now derives these clamp values from a three-chunk vertical span: with 48-voxel chunks, the ±144 bounds wrap a base plane parked at 10 voxels, leaving ample headroom for taller formations. The macro/detail/ridge amplitudes (80/30/24) divide the resulting 134-voxel budget according to the weight ratios encoded alongside the descriptor defaults, keeping the operators balanced inside the expanded envelope.【F:three-demo/src/world/world-option-descriptors.js†L55-L83】

#### TFMS Temperaments
| Path | Label | Description | Type | Default | Range | Step |
| --- | --- | --- | --- | --- | --- | --- |
| `terrain.tfms.temperament` | Planetary Temperament | Selects which canonical Kamea matrix seeds the TFMS modulation network. | `string` | `"Saturn 3x3"` | _n/a_ | _n/a_ |
| `terrain.tfms.kamea.modulationStrength` | FM Modulation Strength | Scales the FM matrix derived from the selected temperament. | `number` | `≈0.5` (derived) | `0` – `1` | `0.01` |
| `terrain.tfms.kamea.warpStrength` | Warp Strength | Scales the primary and 90° companion warp vectors injected before noise sampling. | `number` | `≈0.38` (derived) | `0` – `1` | `0.01` |
| `terrain.tfms.kamea.phaseStrength` | Phase Strength | Scales temperament-driven phase offsets in radians. | `number` | `≈0.22` (derived) | `0` – `1` | `0.01` |
| `terrain.tfms.kamea.spectralProfile` | Spectral Profile | Chooses the FFT mask applied to the Kamea kernel (`low`, `band`, or `custom`). | `string` | `"band"` | _n/a_ | _n/a_ |
| `terrain.tfms.kamea.spectralStrength` | Spectral Strength | Scales the FFT-derived filter contribution when shaping operator output. | `number` | `≈0.5` (derived) | `0` – `1` | `0.01` |
| `terrain.tfms.kamea.erosionPreset` | Erosion Preset | Selects conductance presets for anisotropic diffusion (`gentle`, `standard`, `aggressive`). | `string` | `"standard"` | _n/a_ | _n/a_ |

Temperament patches are assembled via `make_kamea_patch`, which calls helpers such as `kamea_to_fm_matrix`, `kamea_to_warp`, `kamea_to_spectral`, and `kamea_to_phase` to project a planetary square into FM, warp, spectral, and phase domains before the TFMS network evaluates waveforms.【F:three-demo/docs/kamea-matrices.md†L43-L55】 Softmax gating blends FBM, ridged, Worley, warp, and diffusion operators using the patch’s logits so different planets emphasise distinct waveform families.

#### TFMS Operator Slots

| Path | Label | Description | Type | Default | Range | Step |
| --- | --- | --- | --- | --- | --- | --- |
| `terrain.tfms.operatorCount` | Active Operator Count | Number of TFMS operators evaluated from the preset’s ordered stack. | `number` | `6` | `1` – `6` | `1` |

Consult the [operator slot selection guide](three-demo/docs/tfms-system.md#operator-slot-selection-1-6-carriers) for recommended slot combinations and modulation caveats before trimming carriers. The terrain engine truncates the operator array and modulation matrix to this count, guaranteeing that overrides never reference missing slots.【F:three-demo/src/world/world-settings.js†L676-L716】【F:three-demo/src/world/terrain-engine.js†L232-L308】 Biome TFMS profiles rebuild their ID→index map whenever the count changes so invalid overrides are ignored automatically.【F:three-demo/src/world/biome-engine.js†L100-L188】【F:three-demo/src/world/biome-engine.js†L500-L548】

#### `terrain.fm` Attenuation Matrix

Legacy overrides refer to the modulation matrix as `terrain.fm`, exposing the attenuation fields listed below. Pair these keys with the [TFMS operator catalogue](three-demo/docs/tfms-system.md#default-operator-catalogue) for carrier context, the [operator slot selection guide](three-demo/docs/tfms-system.md#operator-slot-selection-1-6-carriers) when pruning carriers, the [schema compendium atlas](three-demo/docs/tfms-system.md#schema-atlas-overview) for schema-provided modulation adjustments, and the [biome assignment workflow](three-demo/docs/tfms-system.md#assigning-schema-compendia-to-biomes) for override merge behaviour.

| Path | Label | Description | Type | Default | Range | Step |
| --- | --- | --- | --- | --- | --- | --- |
| `terrain.tfms.modulationMatrix.diffusion-primary` | Diffusion → Primary (Amplitude) | How strongly the diffusion mask modulates the primary FBM amplitude. | `number` | `0.4` | `-4` – `4` | `0.01` |
| `terrain.tfms.modulationMatrix.diffusion-ridge` | Diffusion → Ridge (Amplitude) | Modulation gain from the diffusion mask into the ridge operator amplitude. | `number` | `0.3` | `-4` – `4` | `0.01` |
| `terrain.tfms.modulationMatrix.diffusion-banding` | Diffusion → Banding (Amplitude) | Modulation gain from the diffusion mask into the anisotropic banding amplitude. | `number` | `0.25` | `-4` – `4` | `0.01` |
| `terrain.tfms.modulationMatrix.domain-primary-x` | Domain Warp → Primary (X) | Domain warp strength routed into the primary FBM X-axis domain. | `number` | `0.7` | `-4` – `4` | `0.01` |
| `terrain.tfms.modulationMatrix.domain-primary-z` | Domain Warp → Primary (Z) | Domain warp strength routed into the primary FBM Z-axis domain. | `number` | `0.7` | `-4` – `4` | `0.01` |
| `terrain.tfms.modulationMatrix.domain-ridge-x` | Domain Warp → Ridge (X) | Domain warp gain routed into the ridge operator X-axis domain. | `number` | `0.5` | `-4` – `4` | `0.01` |
| `terrain.tfms.modulationMatrix.domain-ridge-z` | Domain Warp → Ridge (Z) | Domain warp gain routed into the ridge operator Z-axis domain. | `number` | `0.5` | `-4` – `4` | `0.01` |
| `terrain.tfms.modulationMatrix.tectonic-ridge` | Tectonic → Ridge (Amplitude) | Raw tectonic Worley value routed into the ridge operator amplitude. | `number` | `0.35` | `-4` – `4` | `0.01` |
| `terrain.tfms.modulationMatrix.tectonic-banding` | Tectonic → Banding (Frequency) | Frequency modulation routed from the tectonic Worley carrier into the banding operator. | `number` | `0.2` | `-4` – `4` | `0.01` |
| `terrain.tfms.modulationMatrix.ridge-domain` | Ridge → Domain Warp (Amplitude) | How strongly ridge output amplifies the domain warp envelope. | `number` | `0.35` | `-4` – `4` | `0.01` |
| `terrain.tfms.modulationMatrix.tectonic-diffusion` | Tectonic → Diffusion (Amplitude) | Raw tectonic Worley contribution routed into the diffusion mask amplitude. | `number` | `0.45` | `-4` – `4` | `0.01` |

### Biomes
| Path | Label | Description | Type | Default | Range | Step |
| --- | --- | --- | --- | --- | --- | --- |
| `biomes.scale` | Biome Scale | Base frequency for the temperature/moisture noise fields. Lower values produce larger biome continents. | `number` | `0.012` | `0.0005` – `0.02` | `0.0001` |
| `biomes.detailMultiplier` | Detail Multiplier | Multiplier applied to the base scale for secondary climate detail noise. | `number` | `2.15` | `0.1` – `10` | `0.01` |
| `biomes.moistureDetailMultiplier` | Moisture Detail Multiplier | Multiplier that adjusts the moisture detail scale relative to the temperature field. | `number` | `1.18` | `0.1` – `4` | `0.01` |
| `biomes.varianceMultiplier` | Variance Multiplier | Controls how strongly biome variance noise distorts the climate map. | `number` | `0.45` | `0` – `2` | `0.01` |
| `biomes.variationStrength` | Variation Strength | Strength of the random jitter applied when selecting the closest biome. | `number` | `0.18` | `0` – `1` | `0.01` |
| `biomes.uniformity` | Uniformity | Blend factor between climate-driven selection (0) and a perfectly uniform distribution across all registered biomes (1). | `number` | `0.35` | `0` – `1` | `0.01` |
| `biomes.weightExponent` | Weight Exponent | Exponent applied to per-biome climate weights before distance comparison. Lower values soften weight effects globally. | `number` | `1` | `0` – `4` | `0.01` |
| `biomes.oceanProvinceScale` | Ocean Province Scale | Base frequency for the province mask that nudges shoreline placement. Lower values form broad oceans with sparse land interruptions. | `number` | `0.0035` | `0.0001` – `0.02` | `0.0001` |
| `biomes.oceanWeightBias` | Ocean Weight Bias | Bias multiplier applied to oceanic and shoreline biome candidates after distance scoring. Positive values expand marine coverage; negative values amplify continental picks. | `number` | `0.9` | `-4` – `4` | `0.01` |

The shipping preset keeps `biomes.uniformity` at `0.35`, which restores meaningful temperature/moisture weighting while still smoothing out hard biome boundaries. Push the value toward `1` whenever you need an all-biomes testbed that ignores climate influence, or drop it closer to `0` for strongly climate-driven worlds.

The `oceanWeightBias` default of `0.9` now gently tips selection toward oceanic and shoreline biomes wherever the province mask reports low ocean coverage. Raise the bias toward `1.5–2.0` for archipelago-style layouts with dominant seas, or taper it back toward zero when you want continents to occupy more of the map. Negative values intentionally reverse the effect, aggressively carving out landmasses at the expense of marine biomes.

## Applying Overrides

World option overrides are validated and clamped against the descriptors above by the world-settings module. You can experiment with new presets in two supported ways:

1. **Adjust the defaults in `three-demo/src/world/world-settings.js`.**
   - Update the values inside `defaultWorldOptions`, `createMutableWorldOptions`, or the descriptor defaults to change the baseline configuration that loads at startup.
   - Because the module normalizes values with `normalizeWithDescriptor`, edits remain clamped to descriptor ranges, ensuring the runtime stays stable.【F:three-demo/src/world/world-settings.js†L30-L202】

2. **Apply runtime overrides.**
   - Call `applyWorldOptions(overrides)` with a partial object that mirrors the structure shown in the tables (for example, `{ terrain: { primaryAmplitude: 12 } }`). The function merges, clamps, and propagates nested values before returning the live `worldOptions` object for inspection.【F:three-demo/src/world/world-settings.js†L203-L368】
   - When bootstrapping the renderer, you can pass the same overrides into `initializeWorldGeneration({ THREE, worldOptions: overrides })`. Initialization automatically forwards the overrides to `applyWorldOptions`, rebuilds the terrain engine, and reseeds dependent systems.【F:three-demo/src/world/generation.js†L1-L83】

Whichever approach you choose, remember that descriptors define the authoritative range for every value. If an override falls outside that range, it is clamped, preventing pathological terrain or biome settings from breaking generation.

# World Configuration

This reference aggregates every tunable world-generation option exposed by the voxel sandbox. Labels, descriptions, defaults, and ranges originate from `three-demo/src/world/world-option-descriptors.js`, which the runtime also uses to clamp override values. Use these details when experimenting with terrain, biome, and environmental parameters.

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

### Terrain
| Path | Label | Description | Type | Default | Range | Step |
| --- | --- | --- | --- | --- | --- | --- |
| `terrain.baseHeight` | Base Height | Average terrain elevation before noise-based variation. | `number` | `6` | `0` – `512` | `1` |
| `terrain.maxHeight` | Maximum Height | Hard cap on how tall terrain columns may grow before clamping to a ceiling. | `number` | `20` | `1` – `1024` | `1` |
| `terrain.clamp.min` | Clamp Minimum | Lower clamp bound applied after noise sampling to prevent deep pits. | `number` | `2` | `0` – `1024` | `1` |
| `terrain.clamp.max` | Clamp Maximum | Upper clamp bound applied after noise sampling to prevent towering spikes. | `number` | `20` | `1` – `1024` | `1` |
| `terrain.primaryFrequency` | Primary Frequency | Base frequency for macro terrain variation. Lower values create large landforms. | `number` | `0.06` | `0.0001` – `1` | `0.0001` |
| `terrain.primaryAmplitude` | Primary Amplitude | Strength of the macro terrain wave. Higher values exaggerate hills and valleys. | `number` | `8` | `0` – `256` | `0.1` |
| `terrain.primaryOffset` | Primary Offset | Phase offset applied to the macro terrain noise field. | `number` | `0` | `-10000` – `10000` | `1` |
| `terrain.detailFrequency` | Detail Frequency | Frequency of secondary detail used to break up flat areas. | `number` | `0.12` | `0.0001` – `2` | `0.0001` |
| `terrain.detailAmplitude` | Detail Amplitude | Strength of the secondary detail contribution. | `number` | `3` | `0` – `128` | `0.1` |
| `terrain.detailOffset` | Detail Offset | Phase offset for the detail terrain noise. | `number` | `100` | `-10000` – `10000` | `1` |
| `terrain.ridgeFrequency` | Ridge Frequency | Frequency controlling how often sharp ridgelines occur. | `number` | `0.02` | `0.0001` – `1` | `0.0001` |
| `terrain.ridgeStrength` | Ridge Strength | Strength multiplier for ridge contributions on top of base terrain. | `number` | `2.4` | `0` – `64` | `0.1` |
| `terrain.ridgeOffset` | Ridge Offset | Phase offset for the ridge noise sampler. | `number` | `220` | `-10000` – `10000` | `1` |
| `terrain.climateHeightInfluence` | Climate Height Influence | How strongly biome climate data affects the perceived terrain elevation. | `number` | `1.2` | `-10` – `10` | `0.05` |
| `baseHeight` | Base Height (alias) | Legacy top-level alias mirroring the terrain base height for compatibility. | `number` | `6` | `0` – `512` | `1` |
| `maxHeight` | Max Height (alias) | Legacy top-level alias mirroring the terrain max height for compatibility. | `number` | `20` | `1` – `1024` | `1` |

### Biomes
| Path | Label | Description | Type | Default | Range | Step |
| --- | --- | --- | --- | --- | --- | --- |
| `biomes.scale` | Biome Scale | Base frequency for the temperature/moisture noise fields. Lower values produce larger biome continents. | `number` | `0.003` | `0.0005` – `0.02` | `0.0001` |
| `biomes.detailMultiplier` | Detail Multiplier | Multiplier applied to the base scale for secondary climate detail noise. | `number` | `2.15` | `0.1` – `10` | `0.01` |
| `biomes.moistureDetailMultiplier` | Moisture Detail Multiplier | Multiplier that adjusts the moisture detail scale relative to the temperature field. | `number` | `1.18` | `0.1` – `4` | `0.01` |
| `biomes.varianceMultiplier` | Variance Multiplier | Controls how strongly biome variance noise distorts the climate map. | `number` | `0.45` | `0` – `2` | `0.01` |
| `biomes.variationStrength` | Variation Strength | Strength of the random jitter applied when selecting the closest biome. | `number` | `0.18` | `0` – `1` | `0.01` |

## Applying Overrides

World option overrides are validated and clamped against the descriptors above by the world-settings module. You can experiment with new presets in two supported ways:

1. **Adjust the defaults in `three-demo/src/world/world-settings.js`.**
   - Update the values inside `defaultWorldOptions`, `createMutableWorldOptions`, or the descriptor defaults to change the baseline configuration that loads at startup.
   - Because the module normalizes values with `normalizeWithDescriptor`, edits remain clamped to descriptor ranges, ensuring the runtime stays stable.【F:three-demo/src/world/world-settings.js†L30-L202】

2. **Apply runtime overrides.**
   - Call `applyWorldOptions(overrides)` with a partial object that mirrors the structure shown in the tables (for example, `{ terrain: { primaryAmplitude: 12 } }`). The function merges, clamps, and propagates nested values before returning the live `worldOptions` object for inspection.【F:three-demo/src/world/world-settings.js†L203-L368】
   - When bootstrapping the renderer, you can pass the same overrides into `initializeWorldGeneration({ THREE, worldOptions: overrides })`. Initialization automatically forwards the overrides to `applyWorldOptions`, rebuilds the terrain engine, and reseeds dependent systems.【F:three-demo/src/world/generation.js†L1-L83】

Whichever approach you choose, remember that descriptors define the authoritative range for every value. If an override falls outside that range, it is clamped, preventing pathological terrain or biome settings from breaking generation.

# Terrain Frequency Modulation System (TFMS)

## How to use this guide
- Start with the runtime defaults in [`src/world/world-settings.js`](../src/world/world-settings.js) to understand which descriptors feed each TFMS parameter bundle. Inline comments in that file link back here.
- When debugging runtime behaviour, follow the control flow through [`src/world/terrain-engine.js`](../src/world/terrain-engine.js), which assembles the TFMS network, applies biome overrides, and evaluates the final elevation envelope.
- Operator implementations, modulation routing, and Kamea augmentation live in [`src/world/tfms/operators.js`](../src/world/tfms/operators.js). Reference this module when adjusting transfer functions, tectonic blenders, or adding new operator types.
- Biome-specific blending and overrides are declared in JSON under [`src/world/biomes/`](../src/world/biomes/) and normalised by [`src/world/biome-engine.js`](../src/world/biome-engine.js). Use those entries to connect per-biome notes in this guide back to the runtime pipeline.

## TFMS concept overview
The TFMS provides a modular stack of noise operators that are weighted, modulated, and optionally warped before being combined into a single elevation envelope. Default presets are derived from the world option descriptors and assembled by `createDefaultTerrainTfmsPreset`, which packages waveform seeds, operator settings, tectonic blending, and Kamea spectral controls into a reusable preset.【F:three-demo/src/world/world-settings.js†L600-L770】【F:three-demo/src/world/world-settings.js†L960-L1044】

During world initialisation, `createTerrainEngine` merges world overrides with these defaults, resolves TFMS ranges to concrete numeric values, and instantiates a TFMS network via `createTfmsNetwork`. The engine keeps the resolved terrain configuration alongside the TFMS network so biome blending and climate adjustments can sample consistent scalar baselines.【F:three-demo/src/world/terrain-engine.js†L1-L149】

At evaluation time the TFMS network iterates operators in array order. Before each operator runs, its incoming modulation entries are summed (in declaration order) to produce amplitude, frequency, phase, and domain-warp adjustments. Each operator then samples its waveform, applies the configured transfer function, and contributes a weighted value to the global envelope. Tectonic channels accumulate in parallel and are blended with the envelope using the active tectonic blender (additive by default).【F:three-demo/src/world/tfms/operators.js†L360-L462】【F:three-demo/src/world/tfms/operators.js†L536-L664】

## Default operator catalogue
The table below lists each default operator in the shipping preset, showing how it pulls from the shared terrain descriptors and what modulation ranges are baked in.

| Operator ID | Type | Weight / Bias | Transfer | Envelope sources | Notes |
| --- | --- | --- | --- | --- | --- |
| `primary-fbm` | `fbm` | `1 / 0` | `identity` | Amp: `primaryAmplitude ×1`, Freq: `primaryFrequency ×1`, Phase: `primaryOffset`, Warp: disabled | Contributes broad elevation; participates in tectonic blend with weight `0.18` and exposes base attenuation for other operators.【F:three-demo/src/world/world-settings.js†L720-L807】 |
| `ridge-noise` | `ridged` | `0.75 / 0` | `abs` | Amp: `ridgeStrength ×1`, Freq: `ridgeFrequency ×1`, Phase: `ridgeOffset`, Warp: disabled | Emphasises peaks via ridged noise; feeds domain warp and tectonic routing downstream.【F:three-demo/src/world/world-settings.js†L807-L900】【F:three-demo/src/world/world-settings.js†L1045-L1082】 |
| `anisotropic-banding` | `anisotropicSine` | `0.5 / 0` | `tanh` | Amp: `detailAmplitude ×0.75`, Freq: `detailFrequency ×1.5`, Phase: `detailOffset`, Warp: ±64 range | Adds oriented banding with mild warp capacity; modulation defaults clamped to `[-1,1]`.【F:three-demo/src/world/world-settings.js†L900-L960】 |
| `tectonic-worley` | `worley` | `0.35 / 0` | `smoothstep (0.4)` | Amp: `detailAmplitude ×0.45`, Freq: `primaryFrequency ×0.45`, Phase: fixed 0, Warp: disabled | Drives tectonic accumulation (weight `0.4`) and modulates banding frequency; seeds Worley ridges for plateaus.【F:three-demo/src/world/world-settings.js†L825-L900】【F:three-demo/src/world/world-settings.js†L1083-L1116】 |
| `domain-warp` | `domainWarp` | `0 / 0` | `identity` | Amp: `primaryAmplitude ×0.32`, Freq: `primaryFrequency ×0.65`, Phase: `primaryOffset`, Warp: disabled | Supplies domain offsets for FBM and ridged layers; zero direct weight keeps it modulation-only.【F:three-demo/src/world/world-settings.js†L1116-L1154】 |
| `diffusion-mask` | `diffusion` | `0.55 / 0` | `tanh` | Amp: `detailAmplitude ×0.35`, Freq: `detailFrequency ×1.2`, Phase: `detailOffset`, Warp: disabled | Acts as attenuation mask and FM source for core layers, smoothing small-scale noise.【F:three-demo/src/world/world-settings.js†L1154-L1203】 |

## Operator slot selection (1–6 carriers)

The TFMS preset exposes six canonical carriers in a fixed evaluation order. Designers can down-select anywhere from one to six slots via `terrain.tfms.operatorCount` to suit performance, biome variation, or stylistic targets.【F:three-demo/src/world/world-option-descriptors.js†L626-L648】【F:three-demo/src/world/world-settings.js†L676-L704】 The terrain engine truncates both the operator array and modulation matrix to the requested count so disabled slots never receive routing, and biome overrides rebuild their operator lookup map against the active slice before applying weights or modulation.【F:three-demo/src/world/terrain-engine.js†L232-L308】【F:three-demo/src/world/biome-engine.js†L100-L188】【F:three-demo/src/world/biome-engine.js†L500-L548】

```
Slot stack overview (left = earliest evaluation)
1 ▸ primary-fbm
2 ▸ primary-fbm ─ ridge-noise
3 ▸ primary-fbm ─ ridge-noise ─ anisotropic-banding
4 ▸ primary-fbm ─ ridge-noise ─ anisotropic-banding ─ tectonic-worley
5 ▸ primary-fbm ─ ridge-noise ─ anisotropic-banding ─ tectonic-worley ─ domain-warp
6 ▸ primary-fbm ─ ridge-noise ─ anisotropic-banding ─ tectonic-worley ─ domain-warp ─ diffusion-mask
```

| Active slots | Included carriers | Typical use cases | Notes |
| --- | --- | --- | --- |
| 1 | `primary-fbm` | Low-cost block-outs, fast biome prototyping. | Retains tectonic accumulation but omits explicit modulation; ideal for mobile previews. |
| 2 | `primary-fbm`, `ridge-noise` | Classic macro + ridge layering. | Keeps peaks sharp without banding or diffusion smoothing. |
| 3 | `primary-fbm`, `ridge-noise`, `anisotropic-banding` | Stylised mesas or striated cliffs. | Introduces directional striations; modulation links expand automatically. |
| 4 | `primary-fbm`, `ridge-noise`, `anisotropic-banding`, `tectonic-worley` | Mountainous worlds with tectonic plateaus. | Enables tectonic routing that boosts ridges and diffusion masks. |
| 5 | `primary-fbm`, `ridge-noise`, `anisotropic-banding`, `tectonic-worley`, `domain-warp` | Organic, winding terrain needing warped valleys. | Domain warp restores non-linear flow while keeping diffusion optional. |
| 6 | All carriers | Shipping-quality preset with full FM interplay. | Full matrix with diffusion smoothing and warp/band interplay active. |

When experimenting with fewer slots, review the [modulation matrix semantics](#modulation-matrix-semantics) to verify that removed carriers do not carry critical modulation responsibilities. Consider duplicating missing modulation through biome overrides if a truncated preset exposes gaps.

### Waveform and seed library
Each operator references a waveform bank seeded deterministically from the world seed using multiplier/offset pairs. Adjusting waveform seed templates in the preset cascades through biome overrides because the terrain engine clones them when normalising TFMS configurations.【F:three-demo/src/world/world-settings.js†L648-L714】【F:three-demo/src/world/terrain-engine.js†L164-L304】

## Modulation matrix semantics
Modulation entries route one operator’s output into another’s control parameters. Entries are evaluated in the order they appear in the preset (`entryIndex`), guaranteeing deterministic stacking even when multiple sources target the same operator.【F:three-demo/src/world/tfms/operators.js†L360-L415】 The default matrix is:

| Entry ID | Source → Target | Routing | Channel | Axis | Gain (default) | Bias |
| --- | --- | --- | --- | --- | --- | --- |
| `diffusion-mask→primary-fbm:amplitude` | `diffusion-mask → primary-fbm` | `amplitude` | `transferred` | — | `0.4` | `0` |
| `diffusion-mask→ridge-noise:amplitude` | `diffusion-mask → ridge-noise` | `amplitude` | `transferred` | — | `0.3` | `0` |
| `diffusion-mask→anisotropic-banding:amplitude` | `diffusion-mask → anisotropic-banding` | `amplitude` | `transferred` | — | `0.25` | `0` |
| `domain-warp→primary-fbm:domain-x` | `domain-warp → primary-fbm` | `domainWarp` | `domainX` | `x` | `0.7` | `0` |
| `domain-warp→primary-fbm:domain-z` | `domain-warp → primary-fbm` | `domainWarp` | `domainZ` | `z` | `0.7` | `0` |
| `domain-warp→ridge-noise:domain-x` | `domain-warp → ridge-noise` | `domainWarp` | `domainX` | `x` | `0.5` | `0` |
| `domain-warp→ridge-noise:domain-z` | `domain-warp → ridge-noise` | `domainWarp` | `domainZ` | `z` | `0.5` | `0` |
| `tectonic-worley→ridge-noise:amplitude` | `tectonic-worley → ridge-noise` | `amplitude` | `raw` | — | `0.35` | `0` |
| `tectonic-worley→anisotropic-banding:frequency` | `tectonic-worley → anisotropic-banding` | `frequency` | `raw` | — | `0.2` | `0` |
| `ridge-noise→domain-warp:amplitude` | `ridge-noise → domain-warp` | `amplitude` | `transferred` | — | `0.35` | `0` |
| `tectonic-worley→diffusion-mask:amplitude` | `tectonic-worley → diffusion-mask` | `amplitude` | `raw` | — | `0.45` | `0` |

Routing names map directly to TFMS evaluator switches, with `domainWarp` entries writing into axis-specific warp accumulators, and amplitude/frequency routings summing scalars. If a biome override introduces additional entries, they are merged onto the cloned matrix and will inherit this processing order when the override configuration is instantiated.【F:three-demo/src/world/world-settings.js†L1203-L1254】【F:three-demo/src/world/terrain-engine.js†L240-L356】

## Schema Compendium

TFMS schemata bundle named operator overrides with metadata about the climates, biome tags, and adjacency patterns they suit best. The catalogue lives in [`schemata.js`](../src/world/tfms/schemata.js) where each entry defines an `id`, human-friendly `label`, optional `biomes` hints, climate ranges, adjacency preferences, and an override payload composed of operator weight arrays, per-operator overrides, and modulation tweaks.【F:three-demo/src/world/tfms/schemata.js†L1-L168】 Because schemata share the same structure as biome overrides, they flow straight into the terrain cloning utilities without additional adapters.【F:three-demo/src/world/terrain-engine.js†L107-L203】

### Authoring and tagging schemata

When introducing a new schema, populate the `tags` array so designers can search the compendium, fill in `biomes.ids` or `biomes.tags` to nudge selection toward certain biome families, and describe acceptable climates with `{min, max, ideal}` envelopes for temperature and moisture. Adjacency metadata lets you boost or penalise rolls when neighbouring biome tags align with the schema’s strengths. Operator overrides work exactly like biome JSON overrides: list `operatorWeights` to remap slot weights, adjust individual operators (weights, bias, modulation, envelope), and patch modulation entries by `id`.【F:three-demo/src/world/tfms/schemata.js†L5-L123】

### Schema atlas overview

| Schema ID | Label | Biome focus | Climate window (`temperature`, `moisture`) | Default blend | Highlights |
| --- | --- | --- | --- | --- | --- |
| `temperate-canopy` | Temperate Canopy Weave | Temperate forests (`temperate_forest`, leafy tags) | `0.45–0.72 (ideal 0.6)`, `0.58–0.92 (ideal 0.76)` | `0.85` | Boosted diffusion mask and warp to weave layered canopy plateaus.【F:three-demo/src/world/tfms/schemata.js†L3-L54】 |
| `temperate-terraces` | Temperate Terraced Shelves | Upland temperate biomes (`temperate_forest`, `aurora_shard_expanse`) | `0.38–0.64 (ideal 0.5)`, `0.42–0.75 (ideal 0.55)` | `0.75` | Emphasises ridge terracing with restrained diffusion to keep shelves crisp.【F:three-demo/src/world/tfms/schemata.js†L55-L105】 |
| `temperate-bog` | Temperate Bog Basins | Fungal wetlands (`noctilucent_fungus_glade`) | `0.35–0.6 (ideal 0.48)`, `0.65–0.95 (ideal 0.82)` | `0.9` | Strong diffusion smoothing with anisotropic warp to form peat channels.【F:three-demo/src/world/tfms/schemata.js†L106-L168】 |

```
Biome schema selection pipeline
Biome tags & climate → Filtered schema candidates → Weighted roll → Overrides merge → TFMS clone
```

#### Temperate expansion presets

| Schema ID | Biome focus | Signature operator tweaks |
| --- | --- | --- |
| `temperate-meadow-drift` | Temperate grassland tags (`temperate`, `grassland`) | Two-operator meadow sweep trims the FBM amplitude to 92 % and softens ridge modulation for quick low-cost block-outs.【F:three-demo/src/world/tfms/schemata.js†L743-L774】 |
| `temperate-riverbraid-terraces` | Temperate riparian shelves | Six-carrier stack leans on smoothstep diffusion and ±24/16 anisotropic warp to braid terraces while tectonic Worley reshapes banding frequency.【F:three-demo/src/world/tfms/schemata.js†L777-L856】 |
| `temperate-lichen-steppe` | Temperate highlands (`temperate`, `highland`) | Sigmoid diffusion and negative anisotropic frequency carve lichen shelves while domain warp amplitude is reduced for gentler roll-off.【F:three-demo/src/world/tfms/schemata.js†L859-L938】 |
| `temperate-shadow-ravines` | Temperate canyon biomes | Deep ±32 warp on anisotropic banding with tanh diffusion and heightened domain warp gains produces high-contrast ravine cuts.【F:three-demo/src/world/tfms/schemata.js†L943-L1025】 |
| `temperate-boulder-cascade` | Temperate upland rock tags | Positive-frequency banding with warp 18/22 and smoothstep diffusion emphasises stony cascades while ridge modulation is restrained.【F:three-demo/src/world/tfms/schemata.js†L1028-L1108】 |
| `temperate-frostleaf-pass` | Temperate cold-edge corridors (`temperate_forest`, `ice_spire_tundra`) | Sigmoid diffusion, anisotropic warp 26/16, and tectonic amplitude boosts keep frosted passes sharp without overdriving ridge noise.【F:three-demo/src/world/tfms/schemata.js†L1113-L1192】 |

#### Arcane & neon terraces

| Schema ID | Biome focus | Signature operator tweaks |
| --- | --- | --- |
| `arcane-stepwells` | `pseudo_borgesian_librarium` structured mesas | High ridge weight (≈1.06) with positive-frequency banding warp 22/−22 and tanh diffusion reinforce labyrinthine stepwells.【F:three-demo/src/world/tfms/schemata.js†L600-L716】 |
| `neon-resonant-terraces` | `fading_vaporwave_dimension` dreamlike plateaus | Banding weight 0.66 with warp 28/18 and tanh diffusion pairs with ridge-driven domain amplification for luminous terrace stacks.【F:three-demo/src/world/tfms/schemata.js†L648-L742】 |

#### Tropical canopy & floodplains

| Schema ID | Biome focus | Signature operator tweaks |
| --- | --- | --- |
| `tropical-canopy-braid` | Jungle humidity tags (`tropical`, `jungle`, `humid`) | Sigmoid diffusion (weight 0.78) and warp 22/30 braid elevated canopy ribbons while domain warp amplitude climbs to 0.6.【F:three-demo/src/world/tfms/schemata.js†L1198-L1288】 |
| `tropical-karst-pillars` | Tropical upland karst | Ridge weight ≈1.02 with smoothstep tectonics and warp 30/−20 etch karst towers, balanced by tanh diffusion.【F:three-demo/src/world/tfms/schemata.js†L1289-L1376】 |
| `tropical-floodplain-fans` | Delta-rich wetlands (`tropical`, `wetland`, `delta`) | Smoothstep diffusion (0.46) and warp 18/20 fan out low-lying distributaries while domain warp amplitude expands to 0.54.【F:three-demo/src/world/tfms/schemata.js†L1377-L1436】 |
| `tropical-mangrove-waves` | Tidal mangrove coasts | Negative-frequency banding with warp 20/28 and sigmoid diffusion (0.72) sculpt tidal channels; domain warp amplitude reaches 0.64.【F:three-demo/src/world/tfms/schemata.js†L1437-L1498】 |
| `tropical-ember-archipelago` | Volcanic archipelagos (`tropical`, `coastal`, `volcanic`) | Positive-frequency banding (warp 34/−24) and strong domain warp (0.66) weave volcanic island chains while tanh diffusion keeps shoulders crisp.【F:three-demo/src/world/tfms/schemata.js†L1499-L1568】 |

#### Desert dune & mesa suite

| Schema ID | Biome focus | Signature operator tweaks |
| --- | --- | --- |
| `desert-dune-sea` | `sunset_dunes` dune fields | Banding warp 36/−24 with smoothstep diffusion and muted domain warp amplitude builds sweeping dune seas without destabilising clamps.【F:three-demo/src/world/tfms/schemata.js†L173-L238】 |
| `desert-oasis-mesas` | `sunset_dunes` mesas | Primary amplitude up to 1.26, ridge warp 12/16, and tanh diffusion punch oasis buttes while tectonic modulation stays moderate.【F:three-demo/src/world/tfms/schemata.js†L240-L308】 |
| `desert-harmattan-surge` | Arid wind-scoured flats | Two-carrier profile boosts FBM bias and ridge modulation for fast-prototyping gust fields.【F:three-demo/src/world/tfms/schemata.js†L1625-L1661】 |
| `desert-glass-pan` | Salt pans and wind polish | Banding warp 36/−18 with smoothstep diffusion and restrained domain warp craft reflective flats ringed by ridges.【F:three-demo/src/world/tfms/schemata.js†L1662-L1748】 |
| `desert-salt-spines` | Structured salt spires | Ridge weight ≈1.08 plus banding warp 32/−22 and tanh diffusion stack crystalline spines.【F:three-demo/src/world/tfms/schemata.js†L1749-L1822】 |
| `desert-crescent-ridges` | Crescent dune ribbons | Negative-frequency banding warp 28/−20 and smoothstep diffusion create scimitar ridges interlaced with warp-driven flow.【F:three-demo/src/world/tfms/schemata.js†L1823-L1896】 |
| `desert-mirage-flats` | Mirage-prone lowlands | Sigmoid diffusion (weight 0.78) with mild positive-frequency banding warps 24/18 to keep shimmering flats controllable.【F:three-demo/src/world/tfms/schemata.js†L1897-L1974】 |
| `desert-wadi-lattice` | Canyon lattices (`sunset_dunes`) | Banding warp 30/−24 with tanh diffusion and heightened domain warp (0.56) lattices branching wadis across dune scarps.【F:three-demo/src/world/tfms/schemata.js†L1975-L2050】 |

#### Savanna, steppe & prairie shelves

| Schema ID | Biome focus | Signature operator tweaks |
| --- | --- | --- |
| `savanna-rolling-shelves` | Savanna grassland tags | Lightweight two-slot preset trims amplitude and ridge gain for rolling savanna shelves.【F:three-demo/src/world/tfms/schemata.js†L2069-L2107】 |
| `savanna-basalt-knolls` | Savanna uplands | Positive-frequency banding warp 26/−12, smoothstep diffusion, and ridge modulation carve basalt knolls.【F:three-demo/src/world/tfms/schemata.js†L2108-L2184】 |
| `steppe-loess-plates` | Dry loess steppes | Single-carrier profile reduces amplitude to 0.88 for broad loess plates with minimal high-frequency detail.【F:three-demo/src/world/tfms/schemata.js†L2185-L2220】 |
| `prairie-braided-swales` | Prairie riparian fans | Sigmoid diffusion (0.38) plus warp 22/24 shape braided swales across prairie lowlands.【F:three-demo/src/world/tfms/schemata.js†L2221-L2296】 |

#### Polar & glacial formations

| Schema ID | Biome focus | Signature operator tweaks |
| --- | --- | --- |
| `glacial-aurora-spires` | `aurora_shard_expanse`, `ice_spire_tundra` | Ridge weight ≈1.12 and tectonic modulation 0.32 push crystalline spires while diffusion tanh keeps faces icy.【F:three-demo/src/world/tfms/schemata.js†L431-L512】 |
| `tundra-drumlin-fields` | `frostbound_steppe` tundra | Smoothstep diffusion and warp 18/12 elongate drumlins with modest ridge emphasis.【F:three-demo/src/world/tfms/schemata.js†L512-L598】 |
| `tundra-sastrugi-flow` | Windswept tundra mix | Negative-frequency banding warp 28/16 and smoothstep diffusion 0.34 sculpt flowing sastrugi.【F:three-demo/src/world/tfms/schemata.js†L2297-L2376】 |
| `polar-borealis-banks` | Auroral banks (`aurora_shard_expanse`) | Two-operator preset keeps amplitude near 1.08 to form gentle auroral banks that blend with reef shelves.【F:three-demo/src/world/tfms/schemata.js†L2377-L2412】 |
| `glacial-icefall-cirques` | `ice_spire_tundra` cirques | Anisotropic warp 32/−18 with tanh diffusion and tectonic modulation 0.32 chisel icefall bowls.【F:three-demo/src/world/tfms/schemata.js†L2413-L2494】 |
| `tundra-crystal-deltas` | Frozen river deltas | Sigmoid diffusion (0.44) and warp 18/26 fuse crystalline delta fans with aquatic shelves.【F:three-demo/src/world/tfms/schemata.js†L2495-L2576】 |
| `polar-fissure-shelves` | Auroral uplands | Banding warp 24/−16 with smoothstep diffusion 0.32 terraces fissured auroral shelves.【F:three-demo/src/world/tfms/schemata.js†L2577-L2658】 |
| `mountain-needle-crown` | Glacial needle peaks | Ridge weight ≈1.0 with anisotropic warp 32/−20 and tanh diffusion produce icy crown ridges.【F:three-demo/src/world/tfms/schemata.js†L4000-L4068】 |

#### Wetlands & deltas

| Schema ID | Biome focus | Signature operator tweaks |
| --- | --- | --- |
| `wetland-cypress-mire` | Temperate wetland tags | Sigmoid diffusion (0.88) with warp 16/22 thickens peat channels while domain warp stays moderate.【F:three-demo/src/world/tfms/schemata.js†L2666-L2746】 |
| `wetland-meander-fans` | River wetlands | Smoothstep diffusion 0.44 and warp 18/18 spread meander fans with balanced warp amplification.【F:three-demo/src/world/tfms/schemata.js†L2747-L2832】 |
| `wetland-peat-flumes` | Bog basins | Single-carrier preset lowers amplitude to 0.84 for flat peat flumes ready for overlay features.【F:three-demo/src/world/tfms/schemata.js†L2833-L2874】 |
| `delta-bloom-shelves` | Delta wetlands | Sigmoid diffusion (0.84) and warp 20/24 bloom layered delta shelves while domain warp hits 0.5.【F:three-demo/src/world/tfms/schemata.js†L2875-L2956】 |

#### Coastal, reef & abyssal chains

| Schema ID | Biome focus | Signature operator tweaks |
| --- | --- | --- |
| `polar-reef-atolls` | `auroral_glass_reef` reefs | Lowered primary amplitude (0.7) with tanh diffusion and warp-driven domain modulation build icy atolls.【F:three-demo/src/world/tfms/schemata.js†L386-L456】 |
| `coastal-archipelago-chain` | Coastal aquatic tags | Warp 26/20 with sigmoid diffusion and warp-weighted domain modulation link archipelago isles.【F:three-demo/src/world/tfms/schemata.js†L2949-L3034】 |
| `coastal-fjord-scars` | Frozen coastal cliffs | Negative-frequency banding warp 32/−14 and smoothstep diffusion (0.3) carve fjord scars with tectonic boosts.【F:three-demo/src/world/tfms/schemata.js†L3035-L3118】 |
| `reef-luminal-towers` | `auroral_glass_reef` luminous reefs | Positive-frequency banding warp 20/30 and sigmoid diffusion raise luminescent reef towers.【F:three-demo/src/world/tfms/schemata.js†L3119-L3202】 |
| `ocean-shelf-canyons` | Deep ocean shelves | Two-operator preset scales FBM amplitude near unity for shelf canyons without heavy modulation.【F:three-demo/src/world/tfms/schemata.js†L3203-L3232】 |
| `abyssal-vent-fields` | Abyssal volcanic vents | Banding warp 18/−28 with tanh diffusion and domain warp 0.62 sculpt thermal vent plazas.【F:three-demo/src/world/tfms/schemata.js†L3233-L3308】 |

#### Volcanic & cavern tessellations

| Schema ID | Biome focus | Signature operator tweaks |
| --- | --- | --- |
| `volcanic-caldera-rings` | `fading_vaporwave_dimension` calderas | Ridge weight ≈0.98, banding warp 30/−18, and domain warp 0.54 stack concentric caldera rings.【F:three-demo/src/world/tfms/schemata.js†L3309-L3388】 |
| `volcanic-spatter-cones` | Volcanic uplands | Negative-frequency banding warp 28/18 and smoothstep diffusion 0.3 layer spatter cones across uplifts.【F:three-demo/src/world/tfms/schemata.js†L3389-L3468】 |
| `volcanic-basalt-flows` | Lowland basalt fields | Two-operator profile biases FBM and ridge to 1.14/0.74 for sheeted basalt flows.【F:three-demo/src/world/tfms/schemata.js†L3469-L3516】 |
| `volcanic-tube-collapse` | Subterranean volcanic tubes | Banding warp 24/−20 with tanh diffusion and domain warp 0.58 describe collapsed lava tubes.【F:three-demo/src/world/tfms/schemata.js†L3517-L3604】 |
| `cavern-ember-terraces` | Subterranean volcanic caverns | Tanh diffusion, banding warp 22/−18, and domain warp 0.56 stair-step ember-lit caverns.【F:three-demo/src/world/tfms/schemata.js†L3725-L3804】 |
| `mountain-ember-ramparts` | Volcanic mountain ramparts | Ridge weight ≈0.92 and banding warp 30/−22 with smoothstep diffusion raise ember ramparts along caldera rims.【F:three-demo/src/world/tfms/schemata.js†L4069-L4140】 |

#### Fungal biomes

| Schema ID | Biome focus | Signature operator tweaks |
| --- | --- | --- |
| `fungal-noctilucent-basins` | `noctilucent_fungus_glade` basins | Sigmoid diffusion (0.86) with warp 14/−10 and strong modulation keeps luminous basins soft yet defined.【F:three-demo/src/world/tfms/schemata.js†L311-L383】 |
| `fungal-stalk-bridges` | Fungal wetland spans | Negative-frequency banding warp 18/26 and sigmoid diffusion 0.78 bridge stalk causeways through wetlands.【F:three-demo/src/world/tfms/schemata.js†L3605-L3684】 |
| `fungal-spore-cauldron` | Humid fungal cauldrons | Smoothstep diffusion 0.84 with warp 20/30 and domain warp 0.56 form spore-laden basins.【F:three-demo/src/world/tfms/schemata.js†L3685-L3764】 |

#### Highland & mountain ramparts

| Schema ID | Biome focus | Signature operator tweaks |
| --- | --- | --- |
| `temperate-boulder-cascade` | Temperate upland rockwork | See temperate table above – emphasises anisotropic warp 18/22 with smoothstep diffusion for rocky cascades.【F:three-demo/src/world/tfms/schemata.js†L1028-L1108】 |
| `highland-corrugated-massif` | Mountain uplands | Ridge weight 0.88, negative-frequency banding warp 28/−18, and smoothstep diffusion 0.32 corrugate massif ridges.【F:three-demo/src/world/tfms/schemata.js†L3805-L3884】 |
| `highland-stepwall-terraces` | Structured highland walls | Positive-frequency banding warp 26/−16 with tanh diffusion 0.34 etch terraced stepwalls.【F:three-demo/src/world/tfms/schemata.js†L3885-L3964】 |
| `mountain-ember-ramparts` | Volcanic mountain fortifications | Ridge weight 0.92, banding warp 30/−22, and domain warp 0.56 build ember ramparts (also listed under volcanic).【F:three-demo/src/world/tfms/schemata.js†L4141-L4206】 |

## Assigning schema compendia to biomes

### Declaring schemata in biome JSON

Biomes attach schemata via a `tfmsProfile.schema` field. The value may be a single schema `id` string or a weighted array of objects containing `{id, weight}` (and optional `blend` overrides). `createBiomeEngine` normalises those declarations, resolving real schema definitions during load so the runtime works with frozen metadata instead of string lookups.【F:three-demo/src/world/biome-engine.js†L520-L632】 The shipped temperate forest biome, for example, mixes the “Temperate Canopy Weave” and “Temperate Terraced Shelves” schemata with a 3:1 weight bias while keeping its familiar blend strength.【F:three-demo/src/world/biomes/temperate.json†L33-L47】

### Runtime selection and caching

During sampling the biome engine evaluates climate at the requested coordinates, scores each candidate schema against the biome’s tags and the local climate, and deterministically rolls a winner using a hashed seed. Selections are cached per coarse grid cell so adjacent chunks stay coherent even when multiple schemata share a biome.【F:three-demo/src/world/biome-engine.js†L632-L760】 The terrain engine merges the chosen schema overrides with any per-biome overrides before instantiating a TFMS network, caching the result by biome and schema identifier so envelope evaluations and tests can inspect the resolved modulation matrix and operator stack.【F:three-demo/src/world/terrain-engine.js†L116-L210】【F:three-demo/src/world/terrain-engine.js†L210-L356】

## Kamea modulation and attenuation
The preset carries base attenuation, clamp limits, and Kamea temperament controls. Base attenuation (`1` by default) uniformly scales the combined envelope before tectonic blending. Clamp limits (default `[-24, 24]`) cap TFMS contributions prior to biome and climate adjustments. Kamea options expose modulation (`≈baseAmplitude/16`), warp, phase, and spectral strengths with per-channel ranges so designers can dial spectral emphasis or erosion responses while staying within safe bounds.【F:three-demo/src/world/world-settings.js†L618-L676】【F:three-demo/src/world/world-settings.js†L1254-L1299】 Terrain normalisation keeps these ranges intact so overrides can replace values or swap the temperament string before evaluation.【F:three-demo/src/world/terrain-engine.js†L150-L223】

## Biome override workflow
When a biome JSON includes a `tfmsProfile`, `createBiomeEngine` normalises waveform/operator/matrix overrides into a compact profile and records a blend strength per biome. The terrain engine clones the base TFMS configuration, applies each override set, and spawns a dedicated TFMS network seeded with a biome-specific hash. During sampling, the base network is evaluated first; if the biome supplies overrides, its network is evaluated separately and blended into the envelope based on the biome’s local blend factor multiplied by the global TFMS `biomeBlendStrength` slider.【F:three-demo/src/world/biome-engine.js†L60-L236】【F:three-demo/src/world/terrain-engine.js†L87-L142】【F:three-demo/src/world/terrain-engine.js†L720-L828】

Override resolution is conservative: only fields explicitly provided in the biome profile mutate the clone. Envelope overrides accept absolute numbers or vector components, modulation overrides accept scalars or `{x,z}` objects, and matrix overrides can be listed per target or as nested mappings. Transfer function overrides must reference registered IDs to remain compatible with the runtime resolver.【F:three-demo/src/world/biome-engine.js†L1-L236】

## Evaluation order and envelope mixing
1. `createTerrainEngine` resolves the base TFMS configuration and instantiates the global network.
2. Optional biome override networks are created and cached alongside their blend weights.
3. For each sampled column:
   1. Evaluate the base TFMS network to obtain the raw envelope and tectonic accumulator.
   2. If the biome has overrides, evaluate its TFMS network and mix envelopes according to `biomeBlendStrength × biomeProfile.blend`.
   3. Add climate height influence and biome terrain offsets, then clamp to terrain/world limits.
4. Return the height along with climate and biome metadata for downstream placement systems.【F:three-demo/src/world/terrain-engine.js†L31-L207】

This order ensures deterministic modulation (operators only see outputs from earlier indices) and isolates biome experiments so designers can iterate without destabilising the shared base preset.

## QA heightfield snapshots (May 2025)

Targeted sampling across representative biomes confirms the expanded schema pool respects TFMS clamp envelopes and stays within
the modulation ranges documented above. The table below captures envelope statistics from a 5×5 grid per schema using the
`createTerrainEngine` harness; no clamp breaches were observed and evaluation times stayed below 0.7 ms even for the heavier reef
profile.【be0363†L1-L8】

| Schema | Biome | Envelope range | Max amplitude | Max frequency | Max warp | Samples | Eval time (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Temperate Shadow Ravines | `temperate_forest` | `0.11 – 1.76` | `10.65` | `0.29` | `1.34` | 25 | `0.59` |
| Desert Dune Sea | `sunset_dunes` | `-0.29 – 1.42` | `9.76` | `0.27` | `0.81` | 25 | `0.47` |
| Fungal Spore Cauldron | `noctilucent_fungus_glade` | `-0.32 – 1.87` | `12.12` | `0.26` | `1.37` | 25 | `0.32` |
| Glacial Aurora Spires | `aurora_shard_expanse` | `0.19 – 1.86` | `9.52` | `0.27` | `0.99` | 25 | `0.64` |
| Abyssal Vent Fields | `auroral_glass_reef` | `-0.36 – 1.40` | `10.21` | `0.25` | `1.47` | 25 | `0.19` |
| Volcanic Caldera Rings | `fading_vaporwave_dimension` | `0.14 – 1.87` | `9.82` | `0.31` | `1.22` | 25 | `0.18` |
| Arcane Stepwell Terraces | `pseudo_borgesian_librarium` | `0.00 – 2.56` | `10.09` | `0.26` | `1.78` | 25 | `0.38` |

## Step-by-step tuning workflow
1. **Audit descriptor ranges** – confirm intended adjustments are within the ranges defined in `world-option-descriptors.js` before editing defaults or authoring overrides.【F:three-demo/src/world/world-settings.js†L1-L120】
2. **Prototype in world settings** – tweak `defaultWorldOptions.terrain.tfms` to validate new operators, modulation routes, or clamp adjustments. The cloning logic ensures overrides remain serialisable.【F:three-demo/src/world/world-settings.js†L200-L396】【F:three-demo/src/world/world-settings.js†L396-L599】
3. **Validate evaluation order** – check `createTfmsNetwork` to ensure new operators appear in the correct index position and that modulation dependencies refer only to prior indices.【F:three-demo/src/world/tfms/operators.js†L360-L462】
4. **Wire biome-specific profiles** – convert successful experiments into `tfmsProfile` overrides inside the relevant biome JSON. Use the normalisation helpers to keep payloads minimal while respecting allowed fields.【F:three-demo/src/world/biome-engine.js†L60-L236】
5. **Tune blend behaviour** – adjust the global `biomeBlendStrength` (or per-biome `blend` scalar) to balance shared terrain character against local variation. Remember that climate adjustments and biome height offsets are added after TFMS blending.【F:three-demo/src/world/terrain-engine.js†L72-L142】【F:three-demo/src/world/terrain-engine.js†L129-L207】
6. **Regression test via terrain engine** – sample representative coordinates using `sampleColumn` to inspect climate influence, clamp enforcement, and final heights before committing designer-facing presets.【F:three-demo/src/world/terrain-engine.js†L143-L220】

By following this loop designers can incrementally evolve the TFMS preset, keep biome overrides focused, and maintain deterministic world generation across seeds.

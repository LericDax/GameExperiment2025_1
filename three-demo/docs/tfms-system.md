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

## Step-by-step tuning workflow
1. **Audit descriptor ranges** – confirm intended adjustments are within the ranges defined in `world-option-descriptors.js` before editing defaults or authoring overrides.【F:three-demo/src/world/world-settings.js†L1-L120】
2. **Prototype in world settings** – tweak `defaultWorldOptions.terrain.tfms` to validate new operators, modulation routes, or clamp adjustments. The cloning logic ensures overrides remain serialisable.【F:three-demo/src/world/world-settings.js†L200-L396】【F:three-demo/src/world/world-settings.js†L396-L599】
3. **Validate evaluation order** – check `createTfmsNetwork` to ensure new operators appear in the correct index position and that modulation dependencies refer only to prior indices.【F:three-demo/src/world/tfms/operators.js†L360-L462】
4. **Wire biome-specific profiles** – convert successful experiments into `tfmsProfile` overrides inside the relevant biome JSON. Use the normalisation helpers to keep payloads minimal while respecting allowed fields.【F:three-demo/src/world/biome-engine.js†L60-L236】
5. **Tune blend behaviour** – adjust the global `biomeBlendStrength` (or per-biome `blend` scalar) to balance shared terrain character against local variation. Remember that climate adjustments and biome height offsets are added after TFMS blending.【F:three-demo/src/world/terrain-engine.js†L72-L142】【F:three-demo/src/world/terrain-engine.js†L129-L207】
6. **Regression test via terrain engine** – sample representative coordinates using `sampleColumn` to inspect climate influence, clamp enforcement, and final heights before committing designer-facing presets.【F:three-demo/src/world/terrain-engine.js†L143-L220】

By following this loop designers can incrementally evolve the TFMS preset, keep biome overrides focused, and maintain deterministic world generation across seeds.

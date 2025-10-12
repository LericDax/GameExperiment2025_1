# Biome configuration quick reference

Biomes describe both climate targets and how object placement behaves in that region. Each biome's `terrain` block now supports two helpers for controlling how dense environmental objects should spawn:

- `objectDensityMultiplier` — optional global multiplier applied to every spawn category. Defaults to `1.0` if omitted.
- `objectDensityMultipliers` — optional object keyed map for fine-tuning individual categories on top of the global multiplier. Omitted entries default to `1.0`.

Supported category keys currently include:

| Key | Affects |
| --- | ------- |
| `trees` | Large plant placements such as trees. |
| `shrubs` | Smaller plants that use the `small-plants` library. |
| `flowers` | Flower objects (falls back to shrub chance if a flower chance is not specified). |
| `rocks` | Rock scatter objects. |
| `fungi` | Mushroom and fungus props. |
| `waterPlants` | Aquatic vegetation spawned underwater. |
| `structures` | Decorative structures planned for a column. |

Because both levels multiply together, you can clamp the entire biome down and then boost specific categories back up. For example:

```json
"terrain": {
  "objectDensityMultiplier": 0.6,
  "objectDensityMultipliers": {
    "flowers": 1.25
  }
}
```

The example above makes the biome 40% lighter overall while keeping flowers close to their original density.

## Palette overrides for `ignoreBiomeTint`

Some voxel libraries expose an `ignoreBiomeTint` flag so that specific blocks render without the biome palette mix. When this flag is set you may now supply a `tint` hex string for each voxel and the renderer will calculate the correct biome tint multiplier so the final shaded colour matches your request. If you omit the `tint` string, the instance keeps the neutral `[1, 1, 1]` multiplier (no extra tint), making it easy to author props that should display their base texture colours untouched.

## Terrain modulation profiles (`tfmsProfile`)

Biomes can optionally expose a `tfmsProfile` block to steer the terrain FM synthesis network toward biome-specific behaviour. Profiles are blended with the global TFMS configuration using the world's `terrain.tfms.biomeBlendStrength` value, allowing climates to morph operator behaviour smoothly instead of jumping between presets.

Supported keys include:

| Key | Type | Description |
| --- | ---- | ----------- |
| `blendStrength` | `number` (0–1, optional) | Local weight multiplier applied to the global biome blend strength. Defaults to `1`. |
| `operators` | `object` or `array` | Per-operator overrides keyed by operator `id` (or provided as an array of override objects with an `id` field). Each override can set `type`, `waveformId`, `transfer`, `transferSettings`, `weight`, `bias`, `amplitude`, `frequency`, `phase`, `domainWarp`, `settings`, `seedTemplate`, `tectonic`, and nested `envelope`/`modulation` ranges. |
| `modulationMatrix` | `object` or `array` | Partial FM matrix tweaks keyed by target operator id (and optionally source id). Entries support `gain`, `bias`, `routing`, `channel`, and `axis` updates so you can gently redirect modulation depth without rebuilding the matrix. |
| `transferFunctions` | `object` (optional) | String remaps for custom transfer function ids. |

Example:

```json
"tfmsProfile": {
  "blendStrength": 0.75,
  "operators": {
    "primary": {
      "waveformId": "ridge-primary",
      "transfer": "tanh",
      "envelope": { "amplitude": { "multiplier": 1.2 } },
      "domainWarp": { "x": 0.15, "z": -0.05 },
      "modulation": { "amplitude": 0.35 }
    }
  },
  "modulationMatrix": {
    "primary": {
      "diffusion": {
        "gain": 0.42,
        "routing": "amplitude",
        "channel": "value"
      }
    }
  }
}
```

Malformed overrides are ignored during biome registration, ensuring invalid payloads never crash climate selection or terrain sampling.

## Distribution targets

- **Ice Spire Tundra** — aim for at least 12% coverage when sampling 5 000 climate probes within a 2 048 block radius (`/biomes coverage ice_spire_tundra threshold=0.12`). The dedicated developer command reports the exact share so designers can confirm adjustments keep the biome within the intended rarity band.

## How to add a biome

Follow these high-level steps whenever introducing a new biome so the generation stack stays in sync:

1. **Author the definition.** Create a JSON file under this folder with a unique `id` and schema-compliant payload. [`../biome-engine.js`](../biome-engine.js)
2. **Confirm registry wiring.** Ensure the new file is discovered by the import glob and registered alongside existing biomes in [`../biome-engine.js`](../biome-engine.js).
3. **Provide voxel objects.** Supply prop payloads inside [`../voxel-objects/`](../voxel-objects/) so placement logic can spawn biome-specific structures, flora, and fungi.
4. **Hook up fluids and palettes.** Register any liquid or tint behaviour inside [`../fluids/fluid-registry.js`](../fluids/fluid-registry.js) (and related helpers) to keep rendering consistent.
5. **Extend validation.** Update or add tests within [`../__tests__/`](../__tests__/) to cover climate sampling and placement expectations for the biome.

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

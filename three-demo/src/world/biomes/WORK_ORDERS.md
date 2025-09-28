# Biome Expansion Work Orders

This document tracks the multi-layer deliverables for integrating the upcoming biome pairs into the simulation stack. Each layer builds on the last; do not advance a pair to the next layer until the prior one is complete and reviewed.

## Layer 0 – Biome JSON Definitions
- Create the biome definition JSONs under `three-demo/src/world/biomes/` using the following identifiers and climate focuses:
  - **Solar Chroma Steppe** — file: `solar_chroma_steppe.json`, biomeId: `solar_chroma_steppe`, climate: high insolation / semi-arid plains with radiant energy blooms.
  - **Luminous Tidebloom Marsh** — file: `luminous_tidebloom_marsh.json`, biomeId: `luminous_tidebloom_marsh`, climate: tidal wetlands with bioluminescent aquatic flora.
  - **Obsidian Mycelium Hollows** — file: `obsidian_mycelium_hollows.json`, biomeId: `obsidian_mycelium_hollows`, climate: sub-surface geothermal cavern systems.
  - **Prismarine Vent Plateau** — file: `prismarine_vent_plateau.json`, biomeId: `prismarine_vent_plateau`, climate: high-altitude hydrothermal terraces with mineral geysers.
- Goals:
  - Solar Chroma Steppe ↔ Luminous Tidebloom Marsh: bridge day/night energy cycles by sharing adaptive flora lines that react to light versus tide pulses.
  - Obsidian Mycelium Hollows ↔ Prismarine Vent Plateau: extend subterranean fungal economies into surface vents, emphasizing heat gradients and mineral reclamation.
- **Import wiring:** once the JSON files ship, extend the import block and biome registry array in `three-demo/src/world/biome-engine.js` so the new IDs can be instantiated. Cross-check the onboarding steps in `README.md` to keep the process documentation aligned with future rollouts.

## Layer 1 – Voxel Object Coverage
For each biome JSON above, provide voxel object payloads before enabling spawning. Deliverables should live under `three-demo/src/world/voxel-objects/` in their respective category folders.
- **Solar Chroma Steppe**
  - Structures: energy-harvesting pylons, mirrored caravan beacons.
  - Flora: chroma reed clusters, sunfold succulents.
  - Fungi: radiant spore fans adapted to dusk bloom.
- **Luminous Tidebloom Marsh**
  - Structures: tide-lock research pontoons, luminescent boardwalk anchors.
  - Flora: tidebloom lilies, glowgrass mats.
  - Fungi: estuary puffcaps with tidal glow cycles.
- **Obsidian Mycelium Hollows**
  - Structures: basalt spore vents, fungal archive vaults.
  - Flora: cavern vine lattices, obsidian creepers.
  - Fungi: heat-sink mycelial shelves, ember truffle clusters.
- **Prismarine Vent Plateau**
  - Structures: mineral condensing spires, vent observation rigs.
  - Flora: prismarine ferns, vapor-condensing moss.
  - Fungi: steamcap colonies, mineral sponge fungi.
- Reference `three-demo/src/world/voxel-objects/structures/frostbound_ice_spike.json` for formatting conventions, metadata blocks, and nanovoxel usage patterns when authoring the new assets.

## Layer 2 – Systems Integrations
After voxel content lands, update the runtime systems so the new biomes participate fully:
- **Palettes:** extend palette derivations in `three-demo/src/world/biome-engine.js` and supporting helpers in `three-demo/src/world/color-utils.js` so new color channels resolve.
- **Nanovoxel Accents:** register any new nanovoxel styles inside `three-demo/src/world/procedural/nanovoxel-palette.js` and ensure placement logic in `three-demo/src/world/voxel-object-prototypes.js` handles them.
- **Fluids:** wire any biome-specific liquids or tint overrides through `three-demo/src/world/fluids/fluid-registry.js` and the associated material shader in `three-demo/src/world/fluids/water-material.js`.
- **Spawn Rules:** adjust biome-aware placement in `three-demo/src/world/voxel-object-placement.js` and supporting planners in `three-demo/src/world/sector-object-planner.js` to honor the new structures/flora/fungi density targets.
- **Shader Hooks:** add biome-specific hooks or uniforms within `three-demo/src/world/terrain-engine.js` (surface shading) and `three-demo/src/world/voxel-object-decoration-mesh.js` (nanovoxel rendering) for the light-reactive and geothermal effects described above.

## Layer 3 – Validation & Sign-off
Before merging feature branches that implement the above layers:
- **Asset QA:** run targeted inspection passes to confirm voxel assets load without geometry warnings and respect naming conventions.
- **Biome Sampling Sessions:** execute curated world seeds and capture screenshots covering edge transitions between each paired biome to validate goal alignment.
- **Regression Checks:** rerun automated scene builds (`npm run build`) and any world-generation test suites under `three-demo/src/world/__tests__/` to ensure existing biomes remain stable.

# Skybox Assets

This directory is reserved for equirectangular skyboxes used by the Three.js scenes.

## Shipped default placeholder

- The renderer now targets a production panorama named `skybox-1.jpg`.
- The repository does **not** bundle the JPEG—drop the final art deliverable in this folder with that exact filename when it is ready.
- Until `skybox-1.jpg` is supplied, the engine falls back to the procedural gradient sky.

## Replacement instructions
- Add or replace `skybox-1.jpg` with your production-ready environment map when available.
- Use an equirectangular (lat-long) projection so the environment can be sampled directly by Three.js.
- Supply files in OpenEXR (`.exr`) or Radiance HDR (`.hdr`) formats for full HDR lighting range. Traditional LDR formats (e.g., `.jpg`, `.png`) are also supported but lose dynamic range.
- Keep filenames lowercase and hyphenated to avoid platform-specific casing issues.

After adding a new skybox file, restart the dev server or rebuild the project to ensure Vite picks up the updated assets.

# Skybox Assets

This directory is reserved for high-dynamic-range skyboxes used by the Three.js scenes.

## Replacement instructions
- Replace `placeholder-skybox.exr` with your production-ready environment map when available.
- Use an equirectangular (lat-long) projection so the environment can be sampled directly by Three.js.
- Supply files in OpenEXR (`.exr`) or Radiance HDR (`.hdr`) formats for full HDR lighting range. Traditional LDR formats (e.g., `.jpg`, `.png`) are also supported but lose dynamic range.
- Keep filenames lowercase and hyphenated to avoid platform-specific casing issues.

After adding a new skybox file, restart the dev server or rebuild the project to ensure Vite picks up the updated assets.

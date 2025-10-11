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

## Inverting skybox orientation

- Each discovered asset automatically exposes two IDs to the renderer: the base filename (e.g. `skybox-1`) and an explicit
  inverted variant that appends `#invertY` (e.g. `skybox-1#invertY`).
- Level designers can reference the inverted ID in world configuration or URL overrides when a panorama is authored with a
  flipped vertical axis.
- The inverted variant keeps a dedicated texture clone in memory so the normal and flipped orientations can be swapped
  without reloading the source image.

## Previewing in-game

- Launch the sandbox, press **Backquote** to open the developer console, and run `/skybox load <asset>` with the filename stem (`skybox-1`, `aurora-cove`, `procedural-default`, etc.) to swap panoramas without restarting the build. Add an optional orientation argument such as `normal`, `default`, `upright`, `invert`, `flip`, or `invertY` to flip lat-long content that was authored upside down. 【F:three-demo/src/player/dev-commands.js†L1846-L1936】【F:three-demo/src/rendering/skyboxes/skybox-manager.js†L16-L78】
- Use `/skybox rotate <degrees>` to yaw the environment while validating horizon placement or seam cleanup; values are clamped to the `-180°`–`180°` range so you can quickly test quarter-turns and fine offsets without breaking the orientation tracker. 【F:three-demo/src/player/dev-commands.js†L2006-L2036】
- When the inspection pass is complete, run `/skybox unload` (or `/skybox reset`) to restore the default configuration and zero the rotation metadata—ideal for comparing procedural fallback lighting against your authored HDRI. 【F:three-demo/src/player/dev-commands.js†L1940-L1999】

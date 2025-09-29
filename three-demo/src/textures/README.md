# Texture Assets

This directory stores texture images that are authored outside of the procedural material pipeline. Use it for hand-painted or photo-sourced art that should override the generated blocks.

## Naming
- Name files after the block ID they are meant to replace (for example, `grass.png`, `sand.png`, or `oak_log.png`).
- When providing multiple resolutions, append the pixel height (e.g., `grass@128.png`). Keep the base name consistent so the asset map can pair variants automatically.

## Format and Orientation
- Save textures as PNG files with power-of-two dimensions (32×32, 64×64, 128×128, etc.) to avoid mipmap artifacts.
- Author images so the top edge corresponds to the block's north-facing side and the pattern tiles seamlessly on all edges.
- If a texture is not tileable, note the intended usage (single-face decals, UI elements, etc.) in a README alongside the asset.

## Subdirectories
- Place source files that are generated procedurally or via scripts in other folders. This `nonprocedural/` subdirectory is reserved for textures that require manual curation.
- Use additional subfolders inside `nonprocedural/` (for example, `blocks/`, `items/`, or `ui/`) when you need to group related art while keeping the naming rules above.

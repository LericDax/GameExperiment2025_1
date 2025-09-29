# Texture Assets

This directory stores texture images that are authored outside of the procedural material pipeline. Use it for hand-painted or photo-sourced art that should override the generated blocks via `src/rendering/static-texture-loader.js`.

## Supported Formats
- The loader watches `nonprocedural/` for images with the extensions `png`, `jpg`, `jpeg`, `webp`, `avif`, and `gif` (any capitalization).
- Keep the exported files optimized for web delivery—lossless PNG or WebP for pixel art, AVIF/JPEG for photographic sources, etc.

## Naming and Resolution Variants
- Name files after the block/material ID they are meant to replace (for example, `grass.png`, `sand.png`, or `oak_log.png`).
- You may append a resolution suffix using the `@<height>` convention (e.g., `grass@128.png`). The loader picks the highest available suffix for a given base name, falling back to the unsuffixed file when present.
- Subdirectories are allowed; only the filename (minus extension and optional resolution suffix) is used to match the block ID.

## Loader Defaults and Overrides
- Imported textures are normalized to repeat on both axes, sample with nearest-neighbor filtering, and use the sRGB color space so they match the procedural materials.
- If a specific asset needs different wrapping, filtering, or color settings, update the `normalizeTexture` helper in `static-texture-loader.js` to handle that case before committing the file.

## Folder Structure
- Place curated textures inside `nonprocedural/`. Keep generated source imagery in sibling folders so the loader can focus on hand-authored art.
- Organize large sets with optional subdirectories (for example, `blocks/`, `items/`, or `ui/`). Only the filename is used for ID matching, so nesting will not affect overrides.

## Format and Orientation
- Save textures with power-of-two dimensions (32×32, 64×64, 128×128, etc.) to avoid mipmap artifacts.
- Author images so the top edge corresponds to the block's north-facing side and the pattern tiles seamlessly on all edges.
- If a texture is not tileable, note the intended usage (single-face decals, UI elements, etc.) in a README alongside the asset.

# Non-procedural Ocean Texture Overrides

Drop hand-authored textures in this folder to override the procedural materials when you need
finer coral polyps or ice fracture detail than the generators can provide.

Supported override file names:

- `abyssal_clay.(png|jpg|jpeg|webp|avif)`
- `reefstone.(png|jpg|jpeg|webp|avif)`
- `mangrove_log.(png|jpg|jpeg|webp|avif)`
- `pack_ice_sheet.(png|jpg|jpeg|webp|avif)`

The loader automatically picks the largest resolution per base name (for example `reefstone@512.png`
beats `reefstone@256.png`). Keep files in sRGB color space so they blend correctly with biome tinting.

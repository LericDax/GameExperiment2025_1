# Hydra Fluid Rendering System

This document captures the systemic architectonics of the fluid stack so future contributors can
orient themselves quickly when iterating on water behaviour.

## High-level flow

1. **`generation.js`** samples the terrain engine to determine which columns contain fluids. It
   aggregates sanitized column descriptors (position, depth, flow hints, shoreline factors) in
   maps keyed by fluid type.
2. **`fluid-geometry.js`** receives the assembled column batches and converts them into a single
   `THREE.BufferGeometry` instance per fluid type. The builder writes a rich set of vertex
   attributes (surface categorisation, flow vectors, foam strength, etc.) that the shader pipeline
   consumes.
3. **`fluid-registry.js`** owns material lifecycle. It initializes the Hydra pipeline for each
   registered fluid, spawns meshes through `createFluidSurface`, and wires runtime updates.
4. **`water-material.js`** (this module) provides the Hydra visual pipeline. It compiles the
   shaders, exposes configuration hooks, and runs empirical validations to ensure geometries remain
   compatible with the shader contract.

## Geometry contract

Hydra expects the following attributes to be present on any geometry passed through the registry:

| Attribute       | Purpose                                           |
| --------------- | ------------------------------------------------- |
| `position`      | World-space vertex positions.                     |
| `normal`        | Base mesh normals used before dynamic bending.    |
| `uv`            | Primary texture coordinates.                      |
| `color`         | Per-column tint derived from biome palettes.      |
| `surfaceType`   | Encodes waterfall faces vs. calm surfaces.        |
| `flowDirection` | XY flow vector driving advection in the shader.   |
| `flowStrength`  | Scalar speed multiplier for the flow vector.      |
| `edgeFoam`      | Highlight intensity for exposed edges.            |
| `depth`         | Column depth used to attenuate absorption.        |
| `shoreline`     | Controls shoreline-specific shading behaviour.    |

The `HydraWaterPipeline` validates these attributes periodically at runtime. Missing data triggers
warnings and allows the debug material toggle to step in without a hard crash.

## Visual pipeline responsibilities

* Maintains shader uniforms with support for palette overrides and lighting metadata.
* Normalises wave profiles so designers can author inputs without worrying about NaNs or
  non-positive values.
* Tracks elapsed time with a configurable time scale and automatically resets the accumulator to
  avoid precision drift.
* Executes empirical validations every 1.5 seconds to confirm geometries are populated and include
  the required attributes.
* Provides hooks to update lighting or palette information at runtime (e.g. for day/night cycles or
  biome-specific overrides).

These layers combine to deliver the "Hydra" water presentation while keeping the system malleable
for experimentation.


## Visibility diagnostics & fallback

- `runHydraVisibilityProbe` renders a synthetic patch through the active Hydra material during
  initialization. If the captured pixel brightness/alpha is near zero, the registry promotes a
  tinted `MeshBasicMaterial` fallback so players still perceive the fluid surface.
- Fallback activations are exposed through the fluid warning banner (`Fluid visibility notice`) and
  can be cleared programmatically via `clearFluidMaterialFallback` once Hydra renders correctly
  again.


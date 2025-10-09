# Planetary Kamea Matrices

The procedural world pipeline can now load classical planetary (Kamea) magic squares and resample them into noise operator and terrain resolutions.

## Canonical matrices

| Name | Order | Magic Constant |
| --- | --- | --- |
| Saturn 3x3 | 3 | 15 |
| Jupiter 4x4 | 4 | 34 |
| Mars 5x5 | 5 | 65 |
| Sun 6x6 | 6 | 111 |
| Venus 7x7 | 7 | 175 |
| Mercury 8x8 | 8 | 260 |
| Moon 9x9 | 9 | 369 |

Use `getCanonicalKameaMatrix(name)` to retrieve a cloned 2D array. `listCanonicalKameaNames()` exposes the supported identifiers.

## Deterministic seeds

- `createDeterministicSeed(...components)` – FNV-1a-style hashing for reproducible seeds unrelated to the existing noise sampler salts.
- `deriveKameaSeed(name, salt)` – canonical seed derivation for each planetary square.
- `createDeterministicRng(seed)` – lightweight integer hash RNG compatible with the new seeding helper.

## Encoders

The module provides encoder helpers that leave the source matrix untouched and return new matrices:

- `encodeUnit(matrix)` – min/max normalization to `[0, 1]` (degenerate matrices map to `0.5`).
- `encodeBipolar(matrix)` – normalized to `[-1, 1]` via the unit encoder.
- `encodeZScore(matrix)` – z-score normalization with zero fallback for zero-variance inputs.
- `encodePhase(matrix)` – maps unit-normalized values into `Φ = 2π · norm` radians.
- `encodeProbability(matrix)` – returns `{ rowNormalized, columnNormalized }` probability distributions.

## Resampling utilities

- `resampleMatrix(matrix, width, height, options)` – core resampler supporting `bilinear` or `bicubic` interpolation and periodic tiling.
- `projectToOperatorSpace(matrix, operatorSize, options)` – square resample for `(N_op × N_op)` operator kernels.
- `projectToTerrainSpace(matrix, width, height, options)` – arbitrary `(H × W)` resample for terrain grids.
- `createDeterministicSamplingHook(seed, { jitter, salt })` – reproducible sampling offsets for downstream procedural stages.

All resamplers default to periodic tiling so Kamea patterns wrap seamlessly when used as waveforms or terrain layers.

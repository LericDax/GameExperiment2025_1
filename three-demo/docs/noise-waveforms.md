# Noise Waveform Library

This catalog enumerates the waveform identifiers recognized by the terrain formation modulation system (TFMS). Use these labels when configuring samplers or composing higher-level operators. Waveforms implemented in code today are marked with **(available)**; the remaining entries outline planned extensions for designers.

## Core noise waveforms
- **FBM** (available) — fractal Brownian motion stack of value noise octaves. Defaults: 5 octaves, gain 0.5, lacunarity 2.
- **Turbulence** (available) — absolute-value FBM variant for turbulent ridges. Defaults mirror FBM.
- **RidgedFBM** (available via `ridge`) — inverted FBM emphasizing peaks and crests. Defaults mirror FBM with ridge sharpness 2.
- **Worley** (available) — cellular Voronoi noise driven by random feature points. Defaults: jitter 0.75, falloff 1, Euclidean distance.
- **Billow** (available) — puffed turbulence with rounded hill profiles. Defaults mirror FBM.
- **ValueNoise** (available) — base scalar lattice noise. Defaults: normalized value noise seeded per lattice.
- **GradientNoise** (available) — smooth alternative to value noise. Defaults: Perlin-style gradients derived from the seed.
- **SimplexNoise** (available) — efficient gradient noise alternative for large worlds. Defaults: 2D simplex gradients seeded deterministically.

## Analytic / trigonometric waveforms
- **AnisotropicSine** (available via `sine`) — directional sine bands ideal for dunes. Parameters: `orientation` (radians), `phaseOffset`, `harmonics`, `harmonicFalloff`, `bias`.
- **AnisotropicCosine** (available via `cosine`) — cosine counterpart with alternating ridge emphasis. Shares the sine parameters above.
- **AnisotropicSquare** (available via `square`) — thresholded band pattern suited for terraces. Adds `dutyCycle` (0–1) in addition to the sine parameters.
- **AnisotropicSawtooth** (available via `sawtooth`) — linear ramp wave useful for repeating slopes. Shares the sine parameters.
- **AnisotropicTriangle** (available via `triangle`) — symmetric ramp pattern for jagged peaks. Shares the sine parameters.
- **AnisotropicPulse** (available via `pulse`) — directional on/off mask. Supports the sine parameters plus `dutyCycle`, `highValue`, and `lowValue` to control pulse width and thresholds.

## Fractal / spectral variants
- **FractalPinkNoise** — 1/f spectral distribution for smooth coherence.
- **FractalBrownNoise** — cumulative Brownian process generating drifts.
- **FractalBlueNoise** — decorrelated spatial noise for fine detail.
- **WhiteNoise** — pure random scalar field.

## Structural / geometric
- **DomainWarp** (available via `warp`) — coordinate warp derived from another field.
- **CurlNoise** — vector field curl magnitude for fluid-like motion.
- **CellEdgeDistance** — edge distance between Worley cells.
- **TerraceQuantized** — stepped remap of elevation values.
- **VoronoiBlend** — blended F1/F2 Worley distances for island shapes.

## Diffusion / smoothing
- **IsotropicDiffusion** (available via `diffusion`) — uniform blur similar to thermal erosion.
- **AnisotropicDiffusion** — edge-preserving smoothing for ridgelines.
- **HydraulicErosion** — iterative erosion simulation field.

## Hybrid / procedural
- **BandsFBM** — sine-band FBM fusion.
- **WarpedFBM** — domain-warped fractal terrain.
- **NoiseMixWaveset** — multi-noise mixture using softmax weighting.

## Spectral / stochastic
- **GaborNoise** — sparse oriented impulse noise.
- **WaveletNoise** — tileable low-alias noise.
- **SpectralNoise** — FFT-filtered noise with custom power spectrum.
- **PoissonBlueMask** — blue-noise distributed feature mask.

## Synth-inspired waveforms
- **Wavetable** — sampled or custom waveforms read from a table.
- **FMComposite** — frequency-modulated blend of multiple fields.
- **AMComposite** — amplitude-modulated noise composition.
- **RingMod** — multiplicative combination of two sources.
- **PhaseDistortedSine** — non-linear phase modulation.
- **PulseWidthModulation** — duty-controlled anisotropic square.
- **AdditiveHarmonicStack** — sum of harmonic sinusoids.
- **SubtractiveFilterBank** — spectral filtering applied to noise.
- **GranularNoise** — localized particle impulse clusters.
- **SampleAndHold** — quantized blocky noise akin to pixelation.
- **NoiseChorus** — detuned stack of similar noise fields.
- **ResonantFilterField** — band-passed feedback terrain pattern.
- **ReverberantDecayField** — recursive delayed diffusion waves.

## Exotic / emergent
- **HyperbolicTangentField** — tanh nonlinearity shaping into sigmoids.
- **SigmoidStepField** — logistic mapping for plateaus.
- **ExponentialField** — exponential attenuation of height.
- **SDFPrimitives** — signed distance fields for primitive shapes.
- **MultifractalBlend** — multi-exponent fractal synthesis.

---

### Waveform identifier summary

| Identifier | Notes |
| --- | --- |
| `fbm` / `FBM` | FBM sampler (available) |
| `turbulence` / `Turbulence` | Turbulence absolute-value FBM (available) |
| `ridge` / `ridged` | Ridged FBM variant (available) |
| `billow` / `Billow` | Billow puffed FBM (available) |
| `worley` | Worley cellular sampler (available) |
| `valueNoise` / `ValueNoise` | Base value noise sampler (available) |
| `gradientNoise` / `GradientNoise` | Gradient noise sampler (available) |
| `simplexNoise` / `SimplexNoise` | Simplex noise sampler (available) |
| `sine` / `anisotropicSine` | Directional sine pattern (available) |
| `cosine` / `anisotropicCosine` | Directional cosine pattern (available) |
| `square` / `anisotropicSquare` | Duty-cycle controlled square wave (available) |
| `sawtooth` / `anisotropicSawtooth` | Linear ramp anisotropic sawtooth (available) |
| `triangle` / `anisotropicTriangle` | Symmetric anisotropic triangle wave (available) |
| `pulse` / `anisotropicPulse` | Configurable pulse gate waveform (available) |
| `warp` / `domainWarp` | Domain-warp vector field (available) |
| `diffusion` | Diffusion-based smoother (available) |

Future identifiers will follow the PascalCase names listed above unless otherwise noted. Designers can use this table to map configuration data to runtime waveform factories.

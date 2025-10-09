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
- **PinkNoise** (available via `pinkNoise`, alias `FractalPinkNoise`) — 1/f spectral slope balancing smooth coherence with gentle high-frequency accents. Defaults: 6 octaves, lacunarity 2.
- **BrownNoise** (available via `brownNoise`, alias `FractalBrownNoise`) — 1/f² accumulation that accentuates low-frequency drift and large-scale gradients. Defaults mirror PinkNoise with a steeper slope.
- **RedNoise** (available via `redNoise`) — alternate 1/f² realization tuned for deep, slow undulations with a distinct random phase seed. Defaults mirror PinkNoise.
- **GreenNoise** (available via `greenNoise`) — 1/f^0.5 spectrum that leans toward mid-band detail while preserving broad structure. Defaults mirror PinkNoise.
- **BlackNoise** (available via `blackNoise`) — 1/f³ falloff emphasizing tectonic-scale motion and muting rapid changes. Defaults mirror PinkNoise.
- **GreyNoise** (available via `greyNoise`) — gently tilted (≈1/f^0.2) spectrum approximating equal-loudness energy with subtle low-end weight. Defaults mirror PinkNoise.
- **VioletNoise** (available via `violetNoise`) — f² (+12 dB/octave) emphasis on the highest frequencies for sparkling surface breakup. Defaults mirror PinkNoise.
- **VelvetNoise** (available via `velvetNoise`) — sparse f^0.5 (+3 dB/octave) coloration suitable for feathery micro-structure. Defaults mirror PinkNoise.
- **BlueNoise** (available via `blueNoise`, alias `FractalBlueNoise`) — high-frequency biased spectrum ideal for crisp micro-detail without banding. Defaults mirror PinkNoise with a positive slope.
- **WhiteNoise** (available via `whiteNoise`) — zero-correlation random scalar field normalized to [-1, 1].

## Structural / geometric
- **DomainWarp** (available via `warp`) — coordinate warp derived from another field.
- **CurlNoise** (available via `curlNoise`) — divergence-free vector warp derived from simplex curl; ideal for fluid domain offsets.
- **CellEdgeDistance** (available via `cellEdgeDistance`) — scalar mask emphasizing Voronoi cell boundaries using the F2 - F1 gap.
- **TerraceQuantized** (available via `terraceQuantized`) — stepped remap that snaps a base heightfield into terraces with optional smoothing.
- **VoronoiBlend** (available via `voronoiBlend`) — blended F1/F2 Voronoi ratio suited for island silhouettes and cellular plateaus.

## Diffusion / smoothing
- **IsotropicDiffusion** (available via `diffusion` / `isotropicDiffusion`) — uniform blur similar to thermal erosion. Parameter: `smoothing` (0–1) controls blend strength.
- **AnisotropicDiffusion** (available via `anisotropicDiffusion`) — edge-aware smoothing that follows a dominant orientation. Parameters: `smoothing` (0–1), `orientation` (radians), `anisotropy` (0–1 directional weighting), and `step` (sampling distance).
- **HydraulicErosion** (available via `hydraulicErosion`) — lightweight hydraulic erosion approximation mixing slope-based erosion and deposition. Parameters: `smoothing` (0–1), `erosionRate` (0–1), `depositionRate` (0–1), and `step` (sampling distance).

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
| `pinkNoise` / `PinkNoise` | 1/f spectral falloff sampler (available) |
| `brownNoise` / `BrownNoise` | 1/f² drift-emphasized sampler (available) |
| `redNoise` / `RedNoise` | Alternate 1/f² spectral sampler (available) |
| `greenNoise` / `GreenNoise` | 1/f^0.5 mid-band leaning sampler (available) |
| `blackNoise` / `BlackNoise` | 1/f³ deep-drift sampler (available) |
| `greyNoise` / `GreyNoise` | 1/f^0.2 equal-loudness-inspired sampler (available) |
| `violetNoise` / `VioletNoise` | +12 dB/octave high-brightness sampler (available) |
| `velvetNoise` / `VelvetNoise` | +3 dB/octave airy micro-detail sampler (available) |
| `blueNoise` / `BlueNoise` | High-frequency accent sampler (available) |
| `whiteNoise` / `WhiteNoise` | Uniform random scalar field (available) |
| `warp` / `domainWarp` | Domain-warp vector field (available) |
| `curlNoise` / `CurlNoise` | Divergence-free curl vector warp (available) |
| `cellEdgeDistance` / `CellEdgeDistance` | Worley cell edge distance mask (available) |
| `terraceQuantized` / `TerraceQuantized` | Quantized terrace remapping sampler (available) |
| `voronoiBlend` / `VoronoiBlend` | F1/F2 Voronoi blend sampler (available) |
| `diffusion` / `isotropicDiffusion` | Diffusion-based smoother (available) |
| `anisotropicDiffusion` / `AnisotropicDiffusion` | Directional diffusion smoother (available) |
| `hydraulicErosion` / `HydraulicErosion` | Hydraulic erosion approximation (available) |

Future identifiers will follow the PascalCase names listed above unless otherwise noted. Designers can use this table to map configuration data to runtime waveform factories.

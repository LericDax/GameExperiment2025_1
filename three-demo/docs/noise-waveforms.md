# Noise Waveform Library

This catalog enumerates the waveform identifiers recognized by the terrain formation modulation system (TFMS). Use these labels when configuring samplers or composing higher-level operators. Waveforms implemented in code today are marked with **(available)**; the remaining entries outline planned extensions for designers. The library now includes deterministic **Kamea planetary matrices** that can be remapped into waveform operator space for hybrid workflows.

## Planetary Kamea matrices (available)

The `world/kamea.js` module exposes canonical planetary squares with deterministic seeding helpers so that systems downstream of the noise samplers can remain reproducible.

- **Canonical sources** — `Saturn 3x3`, `Jupiter 4x4`, `Mars 5x5`, `Sun 6x6`, `Venus 7x7`, `Mercury 8x8`, and `Moon 9x9`. The helper `getCanonicalKameaMatrix(name)` returns a cloned 2D array.
- **Deterministic seeds** — `deriveKameaSeed(name, salt)` and `createDeterministicSeed(...components)` provide hash-based seeds compatible with other procedural systems without reusing noise sampler salts.
- **Encoders** — `encodeUnit`, `encodeBipolar`, `encodeZScore`, `encodePhase`, and `encodeProbability` reshape a matrix into normalized ranges (`[0,1]`, `[-1,1]`, z-score, `Φ=2π·norm`, row/column probability) ready for modulation chains.
- **Resamplers** — `projectToOperatorSpace(matrix, size, options)` and `projectToTerrainSpace(matrix, width, height, options)` resample via bilinear or bicubic interpolation with periodic tiling. Pass `createDeterministicSamplingHook(seed, { jitter })` to introduce reproducible micro-jitter suitable for later operator stages.

When designing TFMS presets, treat Kamea matrices as structured macro-patterns that can be blended with noise by resampling into a compatible resolution and applying the desired encoder before mixing.

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
- **BandsFBM** (available via `bandsFbm`) — sine-band FBM fusion that multiplies fractal value noise with anisotropic sine masking.
  Parameters: `octaves`, `gain`, `lacunarity`, `bandFrequency` (stripe density), `bandStrength` (0–1 modulation depth), `bandSharpness` (>0 falloff exponent), `orientation`, `harmonics`, `harmonicFalloff`, `phaseOffset`, and `bandBias` (post-bias for the band mask).
- **WarpedFBM** (available via `warpedFbm`) — domain-warped fractal terrain that blends between unwarped and warped FBM samples.
  Parameters: `octaves`, `gain`, `lacunarity`, `warpStrength` (initial warp amplitude), `warpScale` (base warp frequency), `warpOctaves`, `warpGain`, `warpLacunarity`, and `warpMix` (0–1 blend between original and warped evaluations).
- **NoiseMixWaveset** (available via `noiseMixWaveset`) — multi-noise mixture using softmax weighting to blend heterogeneous sources.
  Parameters: `sources` (array of `{ type, config, amplitude }` entries), `mixFrequency` (weight field scale), `softmaxTemperature` (>0 controlling blend contrast), and `mixBias` (-1–1 post offset). All nested samplers derive deterministic seeds from the top-level seed.

## Spectral / stochastic
- **GaborNoise** (available) — deterministic sparse Gabor impulse field for oriented micro-structure. Defaults: 6 impulses, bandwidth 2.5, unit frequency.
- **WaveletNoise** (available) — tileable multi-resolution wavelet blend seeded for seamless tiling. Defaults: 4 octaves, 4 modes, period 32.
- **SpectralNoise** (available) — configurable power-spectrum sampler supporting custom slopes/weights and base noise types.
- **PoissonBlueMask** (available) — blue-noise-style feature selector using Poisson-prioritized impulses. Defaults: radius 2, falloff 1.5.

## Synth-inspired waveforms
- **Wavetable** (available via `wavetable`) — sampled or procedural table playback with morphing.
  Parameters: `table` (array of samples) or `tableLength` (default 64) to generate a seeded table, `morph` (0–1 base blend), `morphDepth` (0–1 modulation depth), `morphFrequency`, `frequency`, `phaseOffset`, `orientation`, `drift` (phase drift amount), and `amplitude`.
- **FMComposite** (available via `fmComposite`) — frequency-modulated blend of carrier and modulator.
  Parameters: `carrierShape` (`sine`, `triangle`, `square`, `saw`, `pulse`), `carrierFrequency`, `modulator` (type or sampler spec), `modulatorFrequency`, `modulationIndex`, `modulationDepth`, `feedback`, `orientation`, `modulatorOrientationOffset`, and `phaseOffset`.
- **AMComposite** (available via `amComposite`) — amplitude-modulated noise composition.
  Parameters: `carrierShape`, `carrierFrequency`, `modulator`, `modulatorFrequency`, `modulationDepth`, `orientation`, and `phaseOffset`.
- **RingMod** (available via `ringMod`) — multiplicative combination of two sources.
  Parameters: `carrierShape`, `carrierFrequency`, `modulator` (noise spec) or `modulatorShape`, `modulatorFrequency`, `orientation`, `modulatorOrientationOffset`, `depth`, and `phaseOffset`.
- **PhaseDistortedSine** (available via `phaseDistortedSine`) — non-linear phase modulation of a sine carrier.
  Parameters: `frequency`, `orientation`, `phaseOffset`, `distortionAmount`, `distortionBias`, `distortionFrequency`, and `modulator` (noise spec).
- **PulseWidthModulation** (available via `pulseWidthModulation`) — duty-controlled anisotropic square with modulation.
  Parameters: `frequency`, `baseDutyCycle`, `modulationDepth`, `modulatorFrequency`, `orientation`, `phaseOffset`, `bias`, and `modulator` (noise spec).
- **AdditiveHarmonicStack** (available via `additiveHarmonicStack`) — sum of harmonic sinusoids with detune.
  Parameters: `harmonics`, `harmonicFalloff`, `frequency`, `orientation`, `detune`, and `phaseOffset`.
- **SubtractiveFilterBank** (available via `subtractiveFilterBank`) — spectral filtering applied to noise.
  Parameters: `source` (noise spec), `filterBands` (array of `{ center, width, gain }`), `frequency`, `resonance`, and `orientation`.
- **GranularNoise** (available via `granularNoise`) — localized particle impulse clusters.
  Parameters: `density` (grains per cell), `grainSize`, `falloff`, `jitter`, and `randomness` (grain waveform variation).
- **SampleAndHold** (available via `sampleAndHold`) — quantized blocky noise akin to pixelation.
  Parameters: `cellSize`, `jitter`, `smoothness` (blend to neighbor), and `bias`.
- **NoiseChorus** (available via `noiseChorus`) — detuned stack of similar noise fields.
  Parameters: `baseType` (noise spec), `voices`, `detune`, `spread`, and `frequency`.
- **ResonantFilterField** (available via `resonantFilterField`) — band-passed feedback terrain pattern.
  Parameters: `source`, `resonance`, `q`, `frequency`, `bandwidth`, and `orientation`.
- **ReverberantDecayField** (available via `reverberantDecayField`) — recursive delayed diffusion waves.
  Parameters: `source`, `taps`, `decay`, `delay`, `diffusion`, `frequency`, and `orientation`.

## Exotic / emergent
- **HyperbolicTangentField** (available) — tanh remap that compresses extremes while preserving mid-band detail.
  Parameters: `source` (noise spec, default `valueNoise`), `gain` (pre-scaling before tanh), `bias` (input offset), and `mix` (0–1 blend with the unshaped source).
- **SigmoidStepField** (available) — logistic shaping that pushes the field toward plateaus around a configurable threshold.
  Parameters: `source` (noise spec), `threshold` (center of the step), `steepness` (slope), `low` / `high` (plateau levels), and `mix` (blend with the raw input).
- **ExponentialField** (available) — exponential attenuation or expansion useful for erosion masks and falloffs.
  Parameters: `source` (noise spec), `decay` (attenuation amount), `bias` (pre-normalization offset), `invert` (flip the envelope), `offset` (post adjustment), and `mix` (blend with the source).
- **SDFPrimitives** (available) — signed-distance primitive tiling (circles, squares, diamonds, crosses) with seeded jitter per cell.
  Parameters: `primitive` (`circle`, `square`, `diamond`, or `cross`), `cellSize`, `radius` (relative to the cell), `jitter` (center offset), `smoothness` (edge falloff), `rotationJitter` (random rotation for anisotropic shapes), and `invert`.
- **MultifractalBlend** (available) — power-weighted multifractal mixer that exaggerates peaks or valleys.
  Parameters: `baseType` (noise spec), `octaves`, `gain`, `lacunarity`, `exponent` (base power), `exponentSlope` (power change per octave), `offset` (post adjustment), and `mix`.

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
| `gaborNoise` / `GaborNoise` | Sparse Gabor impulse sampler (available) |
| `waveletNoise` / `WaveletNoise` | Tileable wavelet-based sampler (available) |
| `spectralNoise` / `SpectralNoise` | Configurable spectral blend sampler (available) |
| `poissonBlueMask` / `PoissonBlueMask` | Blue-noise feature mask sampler (available) |
| `warp` / `domainWarp` | Domain-warp vector field (available) |
| `curlNoise` / `CurlNoise` | Divergence-free curl vector warp (available) |
| `cellEdgeDistance` / `CellEdgeDistance` | Worley cell edge distance mask (available) |
| `terraceQuantized` / `TerraceQuantized` | Quantized terrace remapping sampler (available) |
| `voronoiBlend` / `VoronoiBlend` | F1/F2 Voronoi blend sampler (available) |
| `diffusion` / `isotropicDiffusion` | Diffusion-based smoother (available) |
| `anisotropicDiffusion` / `AnisotropicDiffusion` | Directional diffusion smoother (available) |
| `hydraulicErosion` / `HydraulicErosion` | Hydraulic erosion approximation (available) |
| `bandsFbm` / `BandsFBM` | FBM modulated by anisotropic sine bands (available) |
| `warpedFbm` / `WarpedFBM` | Domain-warped FBM blend (available) |
| `noiseMixWaveset` / `NoiseMixWaveset` | Softmax-weighted hybrid noise mixture (available) |
| `wavetable` / `Wavetable` | Morphable wavetable playback sampler (available) |
| `fmComposite` / `FMComposite` | Frequency-modulated composite sampler (available) |
| `amComposite` / `AMComposite` | Amplitude-modulated composite sampler (available) |
| `ringMod` / `RingMod` | Ring modulation sampler (available) |
| `phaseDistortedSine` / `PhaseDistortedSine` | Phase-distorted sine sampler (available) |
| `pulseWidthModulation` / `PulseWidthModulation` | PWM anisotropic square sampler (available) |
| `additiveHarmonicStack` / `AdditiveHarmonicStack` | Additive harmonic sum sampler (available) |
| `subtractiveFilterBank` / `SubtractiveFilterBank` | Subtractive filter bank sampler (available) |
| `granularNoise` / `GranularNoise` | Granular impulse cluster sampler (available) |
| `sampleAndHold` / `SampleAndHold` | Sample-and-hold quantized sampler (available) |
| `noiseChorus` / `NoiseChorus` | Detuned noise chorus sampler (available) |
| `resonantFilterField` / `ResonantFilterField` | Resonant filter terrain sampler (available) |
| `reverberantDecayField` / `ReverberantDecayField` | Reverberant decay field sampler (available) |
| `hyperbolicTangentField` / `HyperbolicTangentField` | Tanh-shaped field remap (available) |
| `sigmoidStepField` / `SigmoidStepField` | Logistic plateau remap (available) |
| `exponentialField` / `ExponentialField` | Exponential attenuation remap (available) |
| `sdfPrimitives` / `SDFPrimitives` | Primitive signed-distance tiling field (available) |
| `multifractalBlend` / `MultifractalBlend` | Power-weighted multifractal blend (available) |

Future identifiers will follow the PascalCase names listed above unless otherwise noted. Designers can use this table to map configuration data to runtime waveform factories.

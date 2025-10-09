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
- **FBM** (available) — see [FBM details](#fbm-fbm-fbm) for parameters and usage.
- **Turbulence** (available) — absolute-value FBM variant for turbulent ridges. Defaults mirror FBM.
- **RidgedFBM** (available via `ridge`) — see [Ridged FBM details](#ridged-fbm-ridge-ridged) for parameters and usage.
- **Worley** (available) — see [Worley details](#worley-worley) for parameters and usage.
- **Billow** (available) — puffed turbulence with rounded hill profiles. Defaults mirror FBM.
- **ValueNoise** (available) — base scalar lattice noise. Defaults: normalized value noise seeded per lattice.
- **GradientNoise** (available) — smooth alternative to value noise. Defaults: Perlin-style gradients derived from the seed.
- **SimplexNoise** (available) — efficient gradient noise alternative for large worlds. Defaults: 2D simplex gradients seeded deterministically.

### FBM (`fbm`, `FBM`)

Fractal Brownian motion stacks multiple value-noise octaves with diminishing amplitude to produce smooth, self-similar terrain bands. It yields a scalar height/value in the `[-1, 1]` range suitable for direct displacement or mask work.【F:three-demo/src/world/noise.js†L284-L320】

**Parameters & defaults**

- `seed` (default `1`) — base seed routed to each octave.
- `octaves` (default `5`) — number of stacked octaves, rounded down to an integer ≥1.
- `gain` (default `0.5`) — amplitude multiplier applied per octave.
- `lacunarity` (default `2`) — frequency multiplier applied per octave.

**Aliases** — `fbm`, `FBM`.

**TFMS example**

```js
import { createNoiseSampler } from '../world/noise.js';

const fbmSampler = createNoiseSampler('fbm', {
  seed: 1337,
  octaves: 6,
  gain: 0.48,
  lacunarity: 2.1,
});

const fbmNode = {
  type: 'fbm',
  config: {
    seed: 1337,
    octaves: 6,
    gain: 0.48,
    lacunarity: 2.1,
  },
};
```

**Determinism** — Unit tests assert that identical seeds reproduce the same FBM samples and that changing the seed alters the field while keeping samples clamped to `[-1, 1]`.【F:three-demo/src/world/__tests__/noise-waveforms.test.js†L21-L39】

### Ridged FBM (`ridge`, `ridged`)

Ridged FBM inverts and sharpens the FBM stack to emphasize crests and valley walls while still producing scalar output in `[-1, 1]`. Internally it evaluates a standard FBM field and remaps it with a ridge exponent.【F:three-demo/src/world/noise.js†L794-L815】

**Parameters & defaults**

- `seed` (default `1`) — used to derive an internal FBM sampler.
- `octaves` (default `5`) — forwarded to the internal FBM stack.
- `gain` (default `0.5`) — amplitude falloff per octave.
- `lacunarity` (default `2`) — frequency multiplier per octave.
- `ridgeSharpness` (default `2`) — exponent controlling how aggressively valleys are inverted.

**Aliases** — `ridge`, `ridged`, `RidgedFBM`.

**TFMS example**

```js
import { createNoiseSampler } from '../world/noise.js';

const ridgedSampler = createNoiseSampler('ridge', {
  seed: 314,
  octaves: 4,
  gain: 0.45,
  lacunarity: 1.9,
  ridgeSharpness: 2.4,
});

const ridgedNode = {
  type: 'ridge',
  config: {
    seed: 314,
    octaves: 4,
    gain: 0.45,
    lacunarity: 1.9,
    ridgeSharpness: 2.4,
  },
};
```

**Determinism** — Automated coverage mirrors the FBM guarantees, ensuring repeatable results for a given seed and ridge configuration while remaining within `[-1, 1]`.【F:three-demo/src/world/__tests__/noise-waveforms.test.js†L21-L55】

### Worley (`worley`)

Worley noise distributes jittered feature points per lattice cell and computes a falloff curve from the nearest point, producing cellular masks normalized to `[-1, 1]`. The implementation supports Euclidean and Manhattan distances via the `distance` parameter.【F:three-demo/src/world/noise.js†L816-L858】

**Parameters & defaults**

- `seed` (default `1`) — offsets the hashed jitter streams.
- `jitter` (default `0.75`) — scales how far feature points drift from cell centers (0 disables jitter).
- `falloff` (default `1`) — exponential falloff applied to the nearest-distance metric.
- `distance` (default `'euclidean'`) — toggles between Euclidean and Manhattan distance metrics.

**Aliases** — `worley`, `Worley`.

**TFMS example**

```js
import { createNoiseSampler } from '../world/noise.js';

const cellularMask = createNoiseSampler('worley', {
  seed: 9001,
  jitter: 0.6,
  falloff: 1.3,
  distance: 'manhattan',
});

const worleyNode = {
  type: 'worley',
  config: {
    seed: 9001,
    jitter: 0.6,
    falloff: 1.3,
    distance: 'manhattan',
  },
};
```

**Determinism** — Tests confirm identical seeds reproduce the same feature layout and that alternate seeds change cell placement without exceeding the expected range.【F:three-demo/src/world/__tests__/noise-waveforms.test.js†L21-L34】【F:three-demo/src/world/__tests__/noise-waveforms.test.js†L163-L165】

## Analytic / trigonometric waveforms
- **AnisotropicSine** (available via `sine`) — see [Anisotropic Sine details](#anisotropic-sine-sine-anisotropicsine) for parameters and usage.
- **AnisotropicCosine** (available via `cosine`) — cosine counterpart with alternating ridge emphasis. Shares the sine parameters above.
- **AnisotropicSquare** (available via `square`) — thresholded band pattern suited for terraces. Adds `dutyCycle` (0–1) in addition to the sine parameters.
- **AnisotropicSawtooth** (available via `sawtooth`) — linear ramp wave useful for repeating slopes. Shares the sine parameters.
- **AnisotropicTriangle** (available via `triangle`) — symmetric ramp pattern for jagged peaks. Shares the sine parameters.
- **AnisotropicPulse** (available via `pulse`) — directional on/off mask. Supports the sine parameters plus `dutyCycle`, `highValue`, and `lowValue` to control pulse width and thresholds.

### Anisotropic Sine (`sine`, `anisotropicSine`)

This directional waveform projects coordinates onto a rotated basis, layering harmonic sine products to generate dune-like bands. Outputs remain within `[-1, 1]` (after bias) and are ideal for modulation masks.【F:three-demo/src/world/noise.js†L844-L886】

**Parameters & defaults**

- `seed` (default `1`) — introduces per-harmonic phase jitter for subtle variation.
- `orientation` (default `Math.PI / 4`) — rotation (radians) of the primary bands.
- `harmonics` (default `3`) — count of harmonic layers (minimum 1).
- `phaseOffset` (default `0`) — base phase shift applied before harmonic jitter.
- `harmonicFalloff` (default `1`) — amplitude decay exponent across harmonics.
- `bias` (default `0`) — post-sum offset applied before clamping.

**Aliases** — `sine`, `anisotropicSine`, `AnisotropicSine`.

**TFMS example**

```js
import { createNoiseSampler } from '../world/noise.js';

const duneBands = createNoiseSampler('sine', {
  seed: 512,
  orientation: Math.PI / 6,
  harmonics: 5,
  harmonicFalloff: 1.15,
  phaseOffset: 0.25,
  bias: 0.05,
});

const sineNode = {
  type: 'sine',
  config: {
    seed: 512,
    orientation: Math.PI / 6,
    harmonics: 5,
    harmonicFalloff: 1.15,
    phaseOffset: 0.25,
    bias: 0.05,
  },
};
```

**Determinism** — Re-using the same seed reproduces identical band placement, while different seeds inject new phase jitter as verified by automated tests.【F:three-demo/src/world/__tests__/noise-waveforms.test.js†L21-L34】【F:three-demo/src/world/__tests__/noise-waveforms.test.js†L179-L187】

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
- **DomainWarp** (available via `warp`) — see [Domain Warp details](#domain-warp-warp-domainwarp) for parameters and usage.
- **CurlNoise** (available via `curlNoise`) — divergence-free vector warp derived from simplex curl; ideal for fluid domain offsets.
- **CellEdgeDistance** (available via `cellEdgeDistance`) — scalar mask emphasizing Voronoi cell boundaries using the F2 - F1 gap.
- **TerraceQuantized** (available via `terraceQuantized`) — stepped remap that snaps a base heightfield into terraces with optional smoothing.
- **VoronoiBlend** (available via `voronoiBlend`) — blended F1/F2 Voronoi ratio suited for island silhouettes and cellular plateaus.

### Domain Warp (`warp`, `domainWarp`)

Domain warping produces a deterministic 2D vector offset `{ x, z }`, typically combined with `projectSampleCoordinates` to distort downstream samplers. Each component is normalized to `[-1, 1]` so you can scale the warp strength externally.【F:three-demo/src/world/noise.js†L1814-L1847】

**Parameters & defaults**

- `seed` (default `1`) — drives the paired value-noise sources for the X/Z offsets.
- `strength` (default `0.5`) — starting amplitude for the first octave (affects both components).
- `scale` (default `1`) — base frequency of the warp field.
- `octaves` (default `1`) — number of stacked warp octaves.
- `gain` (default `0.5`) — amplitude multiplier per warp octave.
- `lacunarity` (default `2`) — frequency multiplier per warp octave.

**Aliases** — `warp`, `domainWarp`, `DomainWarp`.

**TFMS example**

```js
import { createNoiseSampler } from '../world/noise.js';

const warpSampler = createNoiseSampler('domainWarp', {
  seed: 4242,
  strength: 0.7,
  scale: 0.9,
  octaves: 3,
  gain: 0.55,
  lacunarity: 2.25,
});

const warpNode = {
  type: 'warp',
  config: {
    seed: 4242,
    strength: 0.7,
    scale: 0.9,
    octaves: 3,
    gain: 0.55,
    lacunarity: 2.25,
  },
};
```

**Determinism** — Tests validate that the warp returns identical vectors for repeated seeds, remains magnitude-normalized, and responds to seed changes with new offsets.【F:three-demo/src/world/__tests__/noise-waveforms.test.js†L585-L620】

## Diffusion / smoothing
- **IsotropicDiffusion** (available via `diffusion` / `isotropicDiffusion`) — see [Diffusion details](#diffusion-diffusion-isotropicdiffusion) for parameters and usage.
- **AnisotropicDiffusion** (available via `anisotropicDiffusion`) — edge-aware smoothing that follows a dominant orientation. Parameters: `smoothing` (0–1), `orientation` (radians), `anisotropy` (0–1 directional weighting), and `step` (sampling distance).
- **HydraulicErosion** (available via `hydraulicErosion`) — lightweight hydraulic erosion approximation mixing slope-based erosion and deposition. Parameters: `smoothing` (0–1), `erosionRate` (0–1), `depositionRate` (0–1), and `step` (sampling distance).

### Diffusion (`diffusion`, `isotropicDiffusion`)

Isotropic diffusion blends each lattice sample toward the average of its four axial neighbors, yielding a quick blur suitable for evening out harsh gradients. The sampler returns scalar values in `[-1, 1]` after interpolation and clamping.【F:three-demo/src/world/noise.js†L2114-L2132】

**Parameters & defaults**

- `seed` (default `1`) — initializes the underlying value-noise field.
- `smoothing` (default `0.5`) — blend factor between the original value and the neighbor average (`0` keeps the original sample, `1` fully averages).

**Aliases** — `diffusion`, `isotropicDiffusion`, `Diffusion`, `IsotropicDiffusion`.

**TFMS example**

```js
import { createNoiseSampler } from '../world/noise.js';

const diffusionSampler = createNoiseSampler('diffusion', {
  seed: 777,
  smoothing: 0.65,
});

const diffusionNode = {
  type: 'diffusion',
  config: {
    seed: 777,
    smoothing: 0.65,
  },
};
```

**Determinism** — Unit tests guarantee repeatable smoothing results for identical seeds and smoothing factors, while distinct seeds provide decorrelated starting patterns.【F:three-demo/src/world/__tests__/noise-waveforms.test.js†L21-L34】【F:three-demo/src/world/__tests__/noise-waveforms.test.js†L414-L416】

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
| [`fbm` / `FBM`](#fbm-fbm-fbm) | FBM sampler (available) |
| `turbulence` / `Turbulence` | Turbulence absolute-value FBM (available) |
| [`ridge` / `ridged`](#ridged-fbm-ridge-ridged) | Ridged FBM variant (available) |
| `billow` / `Billow` | Billow puffed FBM (available) |
| [`worley`](#worley-worley) | Worley cellular sampler (available) |
| `valueNoise` / `ValueNoise` | Base value noise sampler (available) |
| `gradientNoise` / `GradientNoise` | Gradient noise sampler (available) |
| `simplexNoise` / `SimplexNoise` | Simplex noise sampler (available) |
| [`sine` / `anisotropicSine`](#anisotropic-sine-sine-anisotropicsine) | Directional sine pattern (available) |
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
| [`warp` / `domainWarp`](#domain-warp-warp-domainwarp) | Domain-warp vector field (available) |
| `curlNoise` / `CurlNoise` | Divergence-free curl vector warp (available) |
| `cellEdgeDistance` / `CellEdgeDistance` | Worley cell edge distance mask (available) |
| `terraceQuantized` / `TerraceQuantized` | Quantized terrace remapping sampler (available) |
| `voronoiBlend` / `VoronoiBlend` | F1/F2 Voronoi blend sampler (available) |
| [`diffusion` / `isotropicDiffusion`](#diffusion-diffusion-isotropicdiffusion) | Diffusion-based smoother (available) |
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

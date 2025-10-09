import {
  getCanonicalKameaMatrix,
  deriveKameaSeed,
  encodeZScore,
  encodeBipolar,
  encodePhase,
  encodeProbability,
  encodeUnit,
  projectToOperatorSpace,
  createDeterministicRng,
} from './kamea.js';

const DEFAULT_SPECTRAL_PROFILE = 'band';
const DEFAULT_EROSION_PRESET = 'standard';
const WAVEFORM_BANK = Object.freeze(['fbm', 'ridged', 'worley', 'warp', 'diffusion']);

const EROSION_PRESETS = Object.freeze({
  gentle: { scale: 0.25, offset: 0.05 },
  standard: { scale: 0.45, offset: 0.1 },
  aggressive: { scale: 0.75, offset: 0.15 },
});

function ensureMatrix(source) {
  if (Array.isArray(source)) {
    return source;
  }
  return getCanonicalKameaMatrix(source);
}

function mean(values) {
  if (!values.length) {
    return 0;
  }
  const total = values.reduce((acc, value) => acc + value, 0);
  return total / values.length;
}

function transpose(matrix) {
  const height = matrix.length;
  const width = matrix[0]?.length ?? 0;
  const output = new Array(width);
  for (let x = 0; x < width; x += 1) {
    const column = new Array(height);
    for (let y = 0; y < height; y += 1) {
      column[y] = matrix[y]?.[x] ?? 0;
    }
    output[x] = column;
  }
  return output;
}

function dft1D(input, inverse = false) {
  const length = input.length;
  const sign = inverse ? 1 : -1;
  const output = new Array(length);
  for (let k = 0; k < length; k += 1) {
    let sumRe = 0;
    let sumIm = 0;
    for (let n = 0; n < length; n += 1) {
      const angle = (2 * Math.PI * k * n) / length;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const value = input[n];
      const re = typeof value === 'number' ? value : value.re ?? 0;
      const im = typeof value === 'number' ? 0 : value.im ?? 0;
      sumRe += re * cos - sign * im * sin;
      sumIm += re * sign * sin + im * cos;
    }
    if (inverse) {
      sumRe /= length;
      sumIm /= length;
    }
    output[k] = { re: sumRe, im: sumIm };
  }
  return output;
}

function fft2D(matrix) {
  const height = matrix.length;
  const width = matrix[0]?.length ?? 0;
  if (!height || !width) {
    return [];
  }
  const rowTransformed = new Array(height);
  for (let y = 0; y < height; y += 1) {
    const row = matrix[y] ?? [];
    rowTransformed[y] = dft1D(row.map((value) => ({ re: value, im: 0 })), false);
  }
  const spectrum = new Array(height);
  for (let y = 0; y < height; y += 1) {
    spectrum[y] = new Array(width);
  }
  for (let x = 0; x < width; x += 1) {
    const column = new Array(height);
    for (let y = 0; y < height; y += 1) {
      column[y] = rowTransformed[y][x];
    }
    const transformed = dft1D(column, false);
    for (let y = 0; y < height; y += 1) {
      spectrum[y][x] = transformed[y];
    }
  }
  return spectrum;
}

function ifft2D(spectrum) {
  const height = spectrum.length;
  const width = spectrum[0]?.length ?? 0;
  if (!height || !width) {
    return [];
  }
  const columnTransformed = new Array(height);
  for (let y = 0; y < height; y += 1) {
    const row = spectrum[y] ?? [];
    columnTransformed[y] = dft1D(row, true);
  }
  const output = new Array(height);
  for (let y = 0; y < height; y += 1) {
    output[y] = new Array(width);
  }
  for (let x = 0; x < width; x += 1) {
    const column = new Array(height);
    for (let y = 0; y < height; y += 1) {
      column[y] = columnTransformed[y][x];
    }
    const transformed = dft1D(column, true);
    for (let y = 0; y < height; y += 1) {
      output[y][x] = transformed[y].re;
    }
  }
  return output;
}

function cloneSpectrum(spectrum) {
  return spectrum.map((row) => row.map((cell) => ({ re: cell.re, im: cell.im })));
}

function enforceHermitianSymmetry(spectrum) {
  const height = spectrum.length;
  const width = spectrum[0]?.length ?? 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const symY = (height - y) % height;
      const symX = (width - x) % width;
      if (y > symY || (y === symY && x > symX)) {
        continue;
      }
      const value = spectrum[y][x];
      const conjugate = { re: value.re, im: -value.im };
      spectrum[symY][symX] = conjugate;
    }
  }
}

function applySpectralProfile(spectrum, profile, customProfile) {
  const height = spectrum.length;
  const width = spectrum[0]?.length ?? 0;
  if (!height || !width) {
    return spectrum;
  }
  const centerY = (height - 1) / 2;
  const centerX = (width - 1) / 2;
  const maxRadius = Math.hypot(centerX, centerY) || 1;
  const filtered = spectrum.map((row) => row.map((cell) => ({ re: cell.re, im: cell.im })));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cell = filtered[y][x];
      const dx = x - centerX;
      const dy = y - centerY;
      const radius = Math.hypot(dx, dy);
      let keep = 1;
      if (profile === 'low') {
        keep = radius <= maxRadius * 0.35 ? 1 : 0;
      } else if (profile === 'band') {
        const inner = maxRadius * 0.2;
        const outer = maxRadius * 0.65;
        keep = radius >= inner && radius <= outer ? 1 : 0;
      } else if (profile === 'custom' && typeof customProfile === 'function') {
        keep = customProfile(radius / maxRadius, { x, y, width, height });
        if (!Number.isFinite(keep)) {
          keep = 1;
        }
      }
      cell.re *= keep;
      cell.im *= keep;
    }
  }
  return filtered;
}

function rotate90(vector) {
  if (!vector) {
    return { x: 0, z: 0 };
  }
  return { x: -vector.z, z: vector.x };
}

function softmax(values) {
  if (!values.length) {
    return [];
  }
  const max = Math.max(...values);
  const exps = values.map((value) => Math.exp(value - max));
  const sum = exps.reduce((acc, value) => acc + value, 0) || 1;
  return exps.map((value) => value / sum);
}

export function kamea_to_fm_matrix(source, { operatorCount = 0, strength = 1 } = {}) {
  if (!operatorCount) {
    return [];
  }
  const matrix = ensureMatrix(source);
  const normalized = encodeZScore(matrix);
  const projected = projectToOperatorSpace(normalized, operatorCount, {
    interpolation: 'bicubic',
  });
  return projected.map((row) => row.map((value) => value * strength));
}

export function kamea_to_warp(source, { operatorCount = 0, strength = 1, scale = 1 } = {}) {
  if (!operatorCount) {
    return { strength, primary: [], companion: [] };
  }
  const matrix = ensureMatrix(source);
  const bipolar = encodeBipolar(matrix);
  const projected = projectToOperatorSpace(bipolar, operatorCount, {
    interpolation: 'bicubic',
  });
  const transposed = transpose(projected);
  const primary = new Array(operatorCount);
  const companion = new Array(operatorCount);
  for (let index = 0; index < operatorCount; index += 1) {
    const row = projected[index] ?? [];
    const column = transposed[index] ?? [];
    const warp = {
      x: mean(row) * strength * scale,
      z: mean(column) * strength * scale,
    };
    primary[index] = warp;
    companion[index] = rotate90(warp);
  }
  return { strength, primary, companion };
}

export function kamea_to_phase(source, { operatorCount = 0, strength = 1 } = {}) {
  if (!operatorCount) {
    return { strength, x: [], z: [] };
  }
  const matrix = ensureMatrix(source);
  const phaseMatrix = encodePhase(matrix);
  const projected = projectToOperatorSpace(phaseMatrix, operatorCount, {
    interpolation: 'bicubic',
  });
  const transposed = transpose(projected);
  const x = new Array(operatorCount);
  const z = new Array(operatorCount);
  for (let index = 0; index < operatorCount; index += 1) {
    const row = projected[index] ?? [];
    const diag = row[index % row.length] ?? row[0] ?? 0;
    const column = transposed[index] ?? [];
    x[index] = diag * strength;
    z[index] = mean(column) * strength;
  }
  return { strength, x, z };
}

export function kamea_to_spectral(
  source,
  {
    operatorCount = 0,
    profile = DEFAULT_SPECTRAL_PROFILE,
    strength = 1,
    erosionPreset = DEFAULT_EROSION_PRESET,
    fft = fft2D,
    ifft = ifft2D,
    customProfile = null,
    customConductance = null,
  } = {},
) {
  const matrix = ensureMatrix(source);
  const normalized = encodeUnit(matrix);
  const spectrum = cloneSpectrum(fft(normalized));
  const profiled = applySpectralProfile(spectrum, profile, customProfile);
  enforceHermitianSymmetry(profiled);
  const kernel = ifft(profiled);
  if (!operatorCount) {
    return {
      kernel,
      profile,
      filters: [],
      conductance: [],
    };
  }
  const projectedKernel = projectToOperatorSpace(kernel, operatorCount, {
    interpolation: 'bicubic',
  });
  const averages = projectedKernel.map((row) => mean(row));
  const filters = averages.map((value) => (signal) => signal + value * strength);
  const unitKernel = projectToOperatorSpace(encodeUnit(kernel), operatorCount, {
    interpolation: 'bicubic',
  });
  const preset = EROSION_PRESETS[erosionPreset] ?? EROSION_PRESETS.standard;
  const conductance = unitKernel.map((row, index) => {
    const base = preset.offset + mean(row) * preset.scale;
    if (typeof customConductance === 'function') {
      return customConductance(base, { index });
    }
    return base;
  });
  return {
    kernel,
    profile,
    filters,
    conductance,
  };
}

function deriveTemperamentGating(matrix, { temperament, seed }) {
  const { rowNormalized, columnNormalized } = encodeProbability(matrix);
  const rng = createDeterministicRng(seed);
  const logits = {};
  for (let index = 0; index < WAVEFORM_BANK.length; index += 1) {
    const waveform = WAVEFORM_BANK[index];
    const row = rowNormalized[index % rowNormalized.length] ?? rowNormalized[0] ?? [0];
    const column = columnNormalized[index % columnNormalized.length] ?? columnNormalized[0] ?? [0];
    const rowMean = mean(row);
    const columnMean = mean(column);
    const jitter = (rng() - 0.5) * 0.05;
    logits[waveform] = rowMean * 0.7 + columnMean * 0.3 + jitter;
  }
  const weightVector = softmax(WAVEFORM_BANK.map((waveform) => logits[waveform]));
  const weights = {};
  const biases = {};
  for (let index = 0; index < WAVEFORM_BANK.length; index += 1) {
    const waveform = WAVEFORM_BANK[index];
    weights[waveform] = weightVector[index];
    biases[waveform] = (logits[waveform] - mean(weightVector)) * 0.2 + (rng() - 0.5) * 0.05;
  }
  return {
    temperament,
    bank: WAVEFORM_BANK,
    logits,
    weights,
    biases,
  };
}

export function make_kamea_patch(
  temperament,
  {
    operatorCount = 0,
    modulationStrength = 1,
    warpStrength = modulationStrength,
    phaseStrength = modulationStrength,
    spectralProfile = DEFAULT_SPECTRAL_PROFILE,
    spectralStrength = modulationStrength * 0.5,
    erosionPreset = DEFAULT_EROSION_PRESET,
    seed = 0,
    fft = fft2D,
    ifft = ifft2D,
    customSpectralProfile = null,
    customConductance = null,
  } = {},
) {
  if (!temperament) {
    throw new Error('make_kamea_patch requires a temperament name');
  }
  const baseMatrix = ensureMatrix(temperament);
  const operatorTotal = operatorCount || baseMatrix.length;
  const derivedSeed = deriveKameaSeed(temperament, seed);
  const fmMatrix = kamea_to_fm_matrix(baseMatrix, {
    operatorCount: operatorTotal,
    strength: modulationStrength,
  });
  const warp = kamea_to_warp(baseMatrix, {
    operatorCount: operatorTotal,
    strength: warpStrength,
  });
  const phase = kamea_to_phase(baseMatrix, {
    operatorCount: operatorTotal,
    strength: phaseStrength,
  });
  const spectral = kamea_to_spectral(baseMatrix, {
    operatorCount: operatorTotal,
    profile: spectralProfile,
    strength: spectralStrength,
    erosionPreset,
    fft,
    ifft,
    customProfile: customSpectralProfile,
    customConductance,
  });
  const gating = deriveTemperamentGating(baseMatrix, {
    temperament,
    seed: derivedSeed,
  });
  return {
    temperament,
    seed: derivedSeed,
    operatorCount: operatorTotal,
    fmMatrix,
    fmStrength: modulationStrength,
    warp,
    phase,
    spectral,
    gating,
  };
}

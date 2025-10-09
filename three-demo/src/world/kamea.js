const TWO_PI = Math.PI * 2;

const KAMEA_SPECS = Object.freeze({
  'Saturn 3x3': {
    order: 3,
    rows: [
      [4, 9, 2],
      [3, 5, 7],
      [8, 1, 6],
    ],
  },
  'Jupiter 4x4': {
    order: 4,
    rows: [
      [4, 14, 15, 1],
      [9, 7, 6, 12],
      [5, 11, 10, 8],
      [16, 2, 3, 13],
    ],
  },
  'Mars 5x5': {
    order: 5,
    rows: [
      [11, 24, 7, 20, 3],
      [4, 12, 25, 8, 16],
      [17, 5, 13, 21, 9],
      [10, 18, 1, 14, 22],
      [23, 6, 19, 2, 15],
    ],
  },
  'Sun 6x6': {
    order: 6,
    rows: [
      [6, 32, 3, 34, 35, 1],
      [7, 11, 27, 28, 8, 30],
      [19, 14, 16, 15, 23, 24],
      [18, 20, 22, 21, 17, 13],
      [25, 29, 10, 9, 26, 12],
      [36, 5, 33, 4, 2, 31],
    ],
  },
  'Venus 7x7': {
    order: 7,
    rows: [
      [22, 47, 16, 41, 10, 35, 4],
      [5, 23, 48, 17, 42, 11, 29],
      [30, 6, 24, 49, 18, 36, 12],
      [13, 31, 7, 25, 43, 19, 37],
      [38, 14, 32, 1, 26, 44, 20],
      [21, 39, 8, 33, 2, 27, 45],
      [46, 15, 40, 9, 34, 3, 28],
    ],
  },
  'Mercury 8x8': {
    order: 8,
    rows: [
      [64, 2, 3, 61, 60, 6, 7, 57],
      [9, 55, 54, 12, 13, 51, 50, 16],
      [17, 47, 46, 20, 21, 43, 42, 24],
      [40, 26, 27, 37, 36, 30, 31, 33],
      [32, 34, 35, 29, 28, 38, 39, 25],
      [41, 23, 22, 44, 45, 19, 18, 48],
      [49, 15, 14, 52, 53, 11, 10, 56],
      [8, 58, 59, 5, 4, 62, 63, 1],
    ],
  },
  'Moon 9x9': {
    order: 9,
    rows: [
      [37, 78, 29, 70, 21, 62, 13, 54, 5],
      [6, 38, 79, 30, 71, 22, 63, 14, 46],
      [47, 7, 39, 80, 31, 72, 23, 55, 15],
      [16, 48, 8, 40, 81, 32, 64, 24, 56],
      [57, 17, 49, 9, 41, 73, 33, 65, 25],
      [26, 58, 18, 50, 1, 42, 74, 34, 66],
      [67, 27, 59, 10, 51, 2, 43, 75, 35],
      [36, 68, 19, 60, 11, 52, 3, 44, 76],
      [77, 28, 69, 20, 61, 12, 53, 4, 45],
    ],
  },
});

const KAMEA_NAMES = Object.freeze(Object.keys(KAMEA_SPECS));

function cloneMatrix(rows) {
  return rows.map((row) => row.slice());
}

function flattenMatrix(matrix) {
  return matrix.reduce((values, row) => values.concat(row), []);
}

function fnv1aHash(component, offset = 2166136261) {
  let hash = offset >>> 0;
  const str = String(component);
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createDeterministicSeed(...components) {
  return components.reduce((hash, component, index) => {
    return fnv1aHash(component, hash ^ ((index + 1) * 1099511627));
  }, 2166136261);
}

export function createDeterministicRng(seed) {
  let state = createDeterministicSeed(seed, 'kamea-rng');
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function deriveKameaSeed(name, salt = 0) {
  if (!KAMEA_SPECS[name]) {
    throw new Error(`Unknown Kamea matrix: ${name}`);
  }
  return createDeterministicSeed('kamea', name, salt);
}

export function listCanonicalKameaNames() {
  return KAMEA_NAMES;
}

export function getCanonicalKameaMatrix(name) {
  const spec = KAMEA_SPECS[name];
  if (!spec) {
    throw new Error(`Unknown Kamea matrix: ${name}`);
  }
  return cloneMatrix(spec.rows);
}

function computeRange(matrix) {
  const values = flattenMatrix(matrix);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value < min) {
      min = value;
    }
    if (value > max) {
      max = value;
    }
  }
  return { min, max };
}

function computeStatistics(matrix) {
  const values = flattenMatrix(matrix);
  const count = values.length;
  let sum = 0;
  for (let i = 0; i < count; i += 1) {
    sum += values[i];
  }
  const mean = sum / count;
  let variance = 0;
  for (let i = 0; i < count; i += 1) {
    const delta = values[i] - mean;
    variance += delta * delta;
  }
  variance /= count;
  return { mean, standardDeviation: Math.sqrt(variance) };
}

function mapMatrix(matrix, mapper) {
  return matrix.map((row, y) => row.map((value, x) => mapper(value, x, y)));
}

export function encodeUnit(matrix) {
  const { min, max } = computeRange(matrix);
  if (max === min) {
    return mapMatrix(matrix, () => 0.5);
  }
  const scale = 1 / (max - min);
  return mapMatrix(matrix, (value) => (value - min) * scale);
}

export function encodeBipolar(matrix) {
  const unit = encodeUnit(matrix);
  return mapMatrix(unit, (value) => value * 2 - 1);
}

export function encodeZScore(matrix) {
  const { mean, standardDeviation } = computeStatistics(matrix);
  if (standardDeviation === 0) {
    return mapMatrix(matrix, () => 0);
  }
  return mapMatrix(matrix, (value) => (value - mean) / standardDeviation);
}

export function encodePhase(matrix) {
  const unit = encodeUnit(matrix);
  return mapMatrix(unit, (value) => value * TWO_PI);
}

export function encodeProbability(matrix) {
  const height = matrix.length;
  const width = matrix[0]?.length ?? 0;
  const rowNormalized = matrix.map((row) => {
    const rowSum = row.reduce((acc, value) => acc + value, 0);
    if (rowSum === 0) {
      return row.map(() => 0);
    }
    const scale = 1 / rowSum;
    return row.map((value) => value * scale);
  });

  const columnTotals = new Array(width).fill(0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      columnTotals[x] += matrix[y][x];
    }
  }
  const columnNormalized = matrix.map((row, y) =>
    row.map((_, x) => {
      const total = columnTotals[x];
      return total === 0 ? 0 : matrix[y][x] / total;
    }),
  );

  return { rowNormalized, columnNormalized };
}

function wrapIndex(index, size) {
  const mod = index % size;
  return mod < 0 ? mod + size : mod;
}

function clampIndex(index, size) {
  if (index < 0) {
    return 0;
  }
  if (index >= size) {
    return size - 1;
  }
  return index;
}

function sampleMatrixPoint(matrix, x, y, { interpolation = 'bilinear', tile = true } = {}) {
  const height = matrix.length;
  const width = matrix[0]?.length ?? 0;
  if (height === 0 || width === 0) {
    return 0;
  }
  const getValue = (ix, iy) => {
    const sampleX = tile ? wrapIndex(ix, width) : clampIndex(ix, width);
    const sampleY = tile ? wrapIndex(iy, height) : clampIndex(iy, height);
    return matrix[sampleY][sampleX];
  };

  if (interpolation === 'bicubic') {
    const xFloor = Math.floor(x);
    const yFloor = Math.floor(y);
    const tx = x - xFloor;
    const ty = y - yFloor;
    const rowValues = new Array(4);
    for (let rowOffset = -1; rowOffset <= 2; rowOffset += 1) {
      const sampleRow = yFloor + rowOffset;
      const values = new Array(4);
      for (let colOffset = -1; colOffset <= 2; colOffset += 1) {
        values[colOffset + 1] = getValue(xFloor + colOffset, sampleRow);
      }
      rowValues[rowOffset + 1] = cubicInterpolate(values[0], values[1], values[2], values[3], tx);
    }
    return cubicInterpolate(rowValues[0], rowValues[1], rowValues[2], rowValues[3], ty);
  }

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const v00 = getValue(x0, y0);
  const v10 = getValue(x1, y0);
  const v01 = getValue(x0, y1);
  const v11 = getValue(x1, y1);
  const vx0 = v00 * (1 - tx) + v10 * tx;
  const vx1 = v01 * (1 - tx) + v11 * tx;
  return vx0 * (1 - ty) + vx1 * ty;
}

function cubicInterpolate(p0, p1, p2, p3, t) {
  const a0 = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3;
  const a1 = p0 - 2.5 * p1 + 2 * p2 - 0.5 * p3;
  const a2 = -0.5 * p0 + 0.5 * p2;
  const a3 = p1;
  return ((a0 * t + a1) * t + a2) * t + a3;
}

export function createDeterministicSamplingHook(seed, { jitter = 0, salt = 'kamea-sampling' } = {}) {
  if (jitter === 0) {
    return () => ({ dx: 0, dy: 0 });
  }
  return ({ xIndex, yIndex }) => {
    const localSeed = createDeterministicSeed(seed, salt, xIndex, yIndex);
    const rng = createDeterministicRng(localSeed);
    const range = jitter * 2;
    return {
      dx: (rng() - 0.5) * range,
      dy: (rng() - 0.5) * range,
    };
  };
}

export function resampleMatrix(matrix, width, height, {
  interpolation = 'bilinear',
  tile = true,
  samplingHook = null,
} = {}) {
  const sourceHeight = matrix.length;
  const sourceWidth = matrix[0]?.length ?? 0;
  if (!sourceHeight || !sourceWidth || width <= 0 || height <= 0) {
    return [];
  }
  const output = new Array(height);
  for (let y = 0; y < height; y += 1) {
    const row = new Array(width);
    for (let x = 0; x < width; x += 1) {
      const baseX = ((x + 0.5) / width) * sourceWidth - 0.5;
      const baseY = ((y + 0.5) / height) * sourceHeight - 0.5;
      let sampleX = baseX;
      let sampleY = baseY;
      if (samplingHook) {
        const offsets = samplingHook({ xIndex: x, yIndex: y, width, height });
        if (offsets) {
          sampleX += offsets.dx ?? 0;
          sampleY += offsets.dy ?? 0;
        }
      }
      row[x] = sampleMatrixPoint(matrix, sampleX, sampleY, { interpolation, tile });
    }
    output[y] = row;
  }
  return output;
}

export function projectToOperatorSpace(matrix, operatorSize, options = {}) {
  return resampleMatrix(matrix, operatorSize, operatorSize, options);
}

export function projectToTerrainSpace(matrix, width, height, options = {}) {
  return resampleMatrix(matrix, width, height, options);
}

export {
  KAMEA_NAMES as CANONICAL_KAMEA_NAMES,
  KAMEA_SPECS as CANONICAL_KAMEA_SPECS,
};

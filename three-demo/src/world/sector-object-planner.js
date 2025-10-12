const SECTOR_SIZE = 32;
const DEFAULT_PLANNER_SEED = 1337;
const MAX_16_BIT = 0xffff;

const sectorCache = new Map();

let plannerSeedHash = DEFAULT_PLANNER_SEED >>> 0;
let pseudoAngleScale = 157.31;
let pseudoAxisScale = 311.7;
let pseudoOffsetScale = 37.912;
let pseudoBias = 0;

function normalize16Bit(value) {
  return (value & MAX_16_BIT) / MAX_16_BIT;
}

function updatePlannerSeed(hash) {
  plannerSeedHash = hash >>> 0;
  const low = normalize16Bit(plannerSeedHash);
  const high = normalize16Bit(plannerSeedHash >>> 16);
  const mix = plannerSeedHash ^ 0x9e3779b9;
  const mixLow = normalize16Bit(mix);
  const mixHigh = normalize16Bit(mix >>> 16);
  pseudoAngleScale = 157.31 + 0.17 + low * 0.83;
  pseudoAxisScale = 311.7 + 0.21 + high * 0.91;
  pseudoOffsetScale = 37.912 + 0.11 + mixLow * 0.77;
  pseudoBias = mixHigh * Math.PI * 2 + SECTOR_SIZE * 0.73;
}

updatePlannerSeed(DEFAULT_PLANNER_SEED);

export function configureSectorObjectPlanner({ seedHash } = {}) {
  const normalizedSeed =
    typeof seedHash === 'number' && Number.isFinite(seedHash)
      ? seedHash >>> 0
      : DEFAULT_PLANNER_SEED;
  updatePlannerSeed(normalizedSeed);
  sectorCache.clear();
}

function sectorKey(sectorX, sectorZ) {
  return `${sectorX}|${sectorZ}`;
}

function pseudoRandom(sectorX, sectorZ, offset = 0) {
  const value = Math.sin(
    sectorX * pseudoAngleScale +
      sectorZ * pseudoAxisScale +
      offset * pseudoOffsetScale +
      pseudoBias,
  );
  return value - Math.floor(value);
}


function smoothRandom(x, z, scale, offset = 0) {
  const scaledX = x * scale;
  const scaledZ = z * scale;

  const x0 = Math.floor(scaledX);
  const z0 = Math.floor(scaledZ);
  const x1 = x0 + 1;
  const z1 = z0 + 1;

  const tx = scaledX - x0;
  const tz = scaledZ - z0;

  const n00 = pseudoRandom(x0, z0, offset);
  const n10 = pseudoRandom(x1, z0, offset);
  const n01 = pseudoRandom(x0, z1, offset);
  const n11 = pseudoRandom(x1, z1, offset);

  const nx0 = n00 * (1 - tx) + n10 * tx;
  const nx1 = n01 * (1 - tx) + n11 * tx;

  return nx0 * (1 - tz) + nx1 * tz;
}

function sampleDirection(x, z, scale, offset = 0) {
  const epsilon = 0.35;
  const sample = (dx, dz) => smoothRandom(x + dx, z + dz, scale, offset);
  const north = sample(0, -epsilon);
  const south = sample(0, epsilon);
  const west = sample(-epsilon, 0);
  const east = sample(epsilon, 0);
  const dx = east - west;
  const dz = south - north;
  if (dx === 0 && dz === 0) {
    return null;
  }
  return Math.atan2(dz, dx);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function resolveThemeMetrics(sectorX, sectorZ) {
  const canopy = smoothRandom(sectorX, sectorZ, 0.11, 13);
  const wetness = smoothRandom(sectorX, sectorZ, 0.07, 17);
  const stone = smoothRandom(sectorX, sectorZ, 0.16, 19);
  const meadow = smoothRandom(sectorX, sectorZ, 0.09, 23);
  const riverNoise = smoothRandom(sectorX, sectorZ, 0.045, 29);
  const riverStrength = 1 - Math.abs(riverNoise * 2 - 1);
  const oceanProvinceNoise = smoothRandom(sectorX, sectorZ, 0.035, 31);
  const salinityNoise = smoothRandom(sectorX, sectorZ, 0.06, 37);
  const currentSeedNoise = smoothRandom(sectorX, sectorZ, 0.045, 41);

  const neighbors = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (dx === 0 && dz === 0) {
        continue;
      }
      neighbors.push({
        canopy: smoothRandom(sectorX + dx, sectorZ + dz, 0.11, 13),
        wetness: smoothRandom(sectorX + dx, sectorZ + dz, 0.07, 17),
        stone: smoothRandom(sectorX + dx, sectorZ + dz, 0.16, 19),
        meadow: smoothRandom(sectorX + dx, sectorZ + dz, 0.09, 23),
        riverStrength:
          1 - Math.abs(smoothRandom(sectorX + dx, sectorZ + dz, 0.045, 29) * 2 - 1),
        oceanProvince: smoothRandom(sectorX + dx, sectorZ + dz, 0.035, 31),
        salinity: smoothRandom(sectorX + dx, sectorZ + dz, 0.06, 37),
        currentSeed: smoothRandom(sectorX + dx, sectorZ + dz, 0.045, 41),
      });
    }
  }

  const neighborAverages = neighbors.reduce(
    (acc, entry) => {
      acc.canopy += entry.canopy;
      acc.wetness += entry.wetness;
      acc.stone += entry.stone;
      acc.meadow += entry.meadow;
      acc.riverStrength += entry.riverStrength;
      acc.oceanProvince += entry.oceanProvince;
      acc.salinity += entry.salinity;
      acc.currentSeed += entry.currentSeed;
      return acc;
    },
    {
      canopy: 0,
      wetness: 0,
      stone: 0,
      meadow: 0,
      riverStrength: 0,
      oceanProvince: 0,
      salinity: 0,
      currentSeed: 0,
    },
  );

  const divisor = neighbors.length || 1;
  neighborAverages.canopy /= divisor;
  neighborAverages.wetness /= divisor;
  neighborAverages.stone /= divisor;
  neighborAverages.meadow /= divisor;
  neighborAverages.riverStrength /= divisor;
  neighborAverages.oceanProvince /= divisor;
  neighborAverages.salinity /= divisor;
  neighborAverages.currentSeed /= divisor;

  const propagatedCanopy = clamp01(canopy * 0.65 + neighborAverages.canopy * 0.35);
  const propagatedWetness = clamp01(wetness * 0.6 + neighborAverages.wetness * 0.4);
  const propagatedStone = clamp01(stone * 0.55 + neighborAverages.stone * 0.45);
  const propagatedMeadow = clamp01(meadow * 0.5 + neighborAverages.meadow * 0.5);
  const propagatedRiver = clamp01(
    riverStrength * 0.7 + neighborAverages.riverStrength * 0.3,
  );
  const propagatedOceanProvince = clamp01(
    oceanProvinceNoise * 0.68 + neighborAverages.oceanProvince * 0.32,
  );
  const propagatedSalinity = clamp01(
    salinityNoise * 0.7 + neighborAverages.salinity * 0.3,
  );
  const propagatedCurrentSeed = clamp01(
    currentSeedNoise * 0.65 + neighborAverages.currentSeed * 0.35,
  );
  const shoreline = clamp01(1 - Math.abs(propagatedOceanProvince - 0.5) * 2);
  const blendedSalinity = clamp01(
    propagatedSalinity * 0.75 + propagatedOceanProvince * 0.25,
  );
  const currentStrength = clamp01(propagatedCurrentSeed * 1.1);

  return {
    canopy: propagatedCanopy,
    wetness: propagatedWetness,
    stone: propagatedStone,
    meadow: propagatedMeadow,
    river: propagatedRiver,
    ocean: {
      province: propagatedOceanProvince,
      salinity: blendedSalinity,
      shoreline,
      current: {
        seed: propagatedCurrentSeed,
        strength: currentStrength,
      },
      raw: {
        province: oceanProvinceNoise,
        salinity: salinityNoise,
        currentSeed: currentSeedNoise,
      },
      neighborAverages: {
        province: neighborAverages.oceanProvince,
        salinity: neighborAverages.salinity,
        currentSeed: neighborAverages.currentSeed,
      },
    },
    raw: { canopy, wetness, stone, meadow, river: riverStrength },
    neighborAverages,
  };
}

function resolveThemeFromMetrics(metrics) {
  const { canopy, wetness, stone, meadow, river } = metrics;
  const ocean = metrics.ocean;

  if (ocean) {
    const province = clamp01(ocean.province ?? 0.5);
    const shoreline = clamp01(ocean.shoreline ?? 0);
    const currentStrength = clamp01(ocean.current?.strength ?? 0);
    const salinity = clamp01(ocean.salinity ?? 0.5);
    const isUnderwater = province < 0.46;
    if (isUnderwater) {
      if (currentStrength > 0.62 && salinity > 0.58 && province < 0.38) {
        return 'ocean-vent';
      }
      if (province < 0.2) {
        return 'ocean-deep';
      }
      if (shoreline > 0.55 || province > 0.32) {
        return 'ocean-shelf';
      }
      return 'ocean-deep';
    }
  }

  if (river > 0.68) {
    return wetness > 0.55 ? 'river-wetland' : 'river-meadow';
  }
  if (wetness > 0.72 && canopy < 0.55) {
    return 'wet-meadow';
  }
  if (wetness > 0.65 && canopy > 0.55) {
    return 'wet-wood';
  }
  if (stone > 0.7 && canopy < 0.55) {
    return 'rocky-field';
  }
  if (stone > 0.72 && canopy >= 0.55) {
    return 'rocky-woods';
  }
  if (canopy > 0.78) {
    return 'deep-forest';
  }
  if (canopy > 0.66) {
    return 'thick-forest';
  }
  if (canopy > 0.5) {
    return 'thin-woods';
  }
  if (meadow > 0.65 && canopy < 0.4) {
    return 'broad-meadow';
  }
  if (meadow > 0.5 && canopy < 0.45) {
    return 'open-field';
  }
  return 'mixed-glade';
}

function resolveBlendTags(theme, metrics, neighborThemes) {
  const tags = new Set();
  const canopy = metrics.canopy;
  const wetness = metrics.wetness;
  const river = metrics.river;

  const hasNeighbor = (target) => neighborThemes.includes(target);

  if (theme === 'thin-woods' && hasNeighbor('open-field')) {
    tags.add('field-edge');
  }
  if (theme === 'thick-forest' && hasNeighbor('thin-woods')) {
    tags.add('forest-thickening');
  }
  if (theme === 'open-field' && hasNeighbor('thin-woods')) {
    tags.add('woodland-approach');
  }
  if (theme.startsWith('river') && wetness > 0.6) {
    tags.add('wet-transition');
  }
  if (river > 0.5 && !theme.startsWith('river')) {
    tags.add('near-river');
  }
  if (wetness > 0.65 && canopy < 0.45) {
    tags.add('boggy');
  }
  if (metrics.stone > 0.68) {
    tags.add('stony');
  }
  if (canopy < 0.35) {
    tags.add('sparse');
  }
  if (canopy > 0.7) {
    tags.add('dense');
  }

  const ocean = metrics.ocean;
  if (ocean) {
    const province = clamp01(ocean.province ?? 0.5);
    if (province < 0.46) {
      tags.add('underwater');
      if (clamp01(ocean.shoreline ?? 0) > 0.55) {
        tags.add('shoreline');
      }
      if (province < 0.2) {
        tags.add('deep-ocean');
      }
      const currentStrength = clamp01(ocean.current?.strength ?? 0);
      if (currentStrength > 0.6) {
        tags.add('current-strong');
      } else if (currentStrength < 0.35) {
        tags.add('current-calm');
      }
      const salinity = clamp01(ocean.salinity ?? 0.5);
      if (salinity > 0.6) {
        tags.add('briny');
      } else if (salinity < 0.4) {
        tags.add('freshened');
      }
    }
  }

  return Array.from(tags);
}

function resolveSectorContext(sectorX, sectorZ) {
  const metrics = resolveThemeMetrics(sectorX, sectorZ);
  const theme = resolveThemeFromMetrics(metrics);

  const neighborThemes = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (dx === 0 && dz === 0) {
        continue;
      }
      const neighborMetrics = resolveThemeMetrics(sectorX + dx, sectorZ + dz);
      neighborThemes.push(resolveThemeFromMetrics(neighborMetrics));
    }
  }

  const blendTags = resolveBlendTags(theme, metrics, neighborThemes);

  const riverDirection = sampleDirection(sectorX, sectorZ, 0.045, 29);
  const canopyDirection = sampleDirection(sectorX, sectorZ, 0.11, 13);
  const stoneDirection = sampleDirection(sectorX, sectorZ, 0.16, 19);
  const currentDirection = sampleDirection(sectorX, sectorZ, 0.035, 43);
  if (metrics.ocean) {
    const strength = metrics.ocean.current?.strength ?? 0;
    const vector =
      typeof currentDirection === 'number'
        ? {
            x: Math.cos(currentDirection) * strength,
            z: Math.sin(currentDirection) * strength,
          }
        : { x: 0, z: 0 };
    metrics.ocean.current = {
      ...metrics.ocean.current,
      angle: currentDirection,
      vector,
    };
  }

  return {
    theme,
    metrics,
    neighborThemes,
    blendTags,
    directions: {
      river: riverDirection,
      canopy: canopyDirection,
      stone: stoneDirection,
      current: currentDirection,
    },
  };
}

function rotatePoint(point, rotationSteps) {
  const angle = (Math.PI / 2) * rotationSteps;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: point.x * cos - point.z * sin,
    z: point.x * sin + point.z * cos,
  };
}

function withinBounds(local, halfSize, margin = 2) {
  return (
    local.x >= -halfSize + margin &&
    local.x <= halfSize - margin &&
    local.z >= -halfSize + margin &&
    local.z <= halfSize - margin
  );
}

function isFarEnough(point, existing, minDistance) {
  return existing.every((entry) => {
    const dx = entry.x - point.x;
    const dz = entry.z - point.z;
    return dx * dx + dz * dz >= minDistance * minDistance;
  });
}

function scatterPoints({
  random,
  sector,
  rotation,
  occupied,
  instruction,
}) {
  const {
    count,
    radius,
    jitterRadius = radius * 0.35,
    minSpacing = 4,
    clump = 0.5,
    seed,
  } = instruction;
  const points = [];
  const attempts = Math.max(count * 8, 16);
  const halfSize = SECTOR_SIZE / 2;
  for (let attempt = 0; attempt < attempts && points.length < count; attempt++) {
    const angle = random(seed + attempt * 11) * Math.PI * 2;
    const distance = Math.pow(random(seed + attempt * 17), clump + 0.35) * radius;
    const local = rotatePoint(
      {
        x: Math.cos(angle) * distance,
        z: Math.sin(angle) * distance,
      },
      rotation,
    );
    if (!withinBounds(local, halfSize)) {
      continue;
    }
    if (!isFarEnough(local, occupied, minSpacing)) {
      continue;
    }
    if (!isFarEnough(local, points, minSpacing)) {
      continue;
    }
    const anchor = {
      x: sector.center.x + local.x,
      z: sector.center.z + local.z,
    };
    points.push({
      anchor,
      jitterRadius,
      minSpacing,
    });
  }
  return points;
}

function linePoints({
  random,
  sector,
  rotation,
  occupied,
  instruction,
}) {
  const {
    count,
    length,
    jitterRadius = Math.max(1.5, length * 0.05),
    minSpacing = Math.max(4, length / Math.max(1, count - 1) * 0.75),
    seed,
  } = instruction;
  const halfSize = SECTOR_SIZE / 2;
  const points = [];
  const spacing = count > 1 ? length / (count - 1) : 0;
  for (let index = 0; index < count; index++) {
    const offset = index * spacing - length / 2;
    const local = rotatePoint({ x: offset, z: 0 }, rotation);
    if (!withinBounds(local, halfSize)) {
      continue;
    }
    if (!isFarEnough(local, occupied, minSpacing)) {
      continue;
    }
    const jitterScale =
      jitterRadius * (0.8 + random(seed + index * 7) * 0.4);
    const anchor = {
      x: sector.center.x + local.x,
      z: sector.center.z + local.z,
    };
    points.push({
      anchor,
      jitterRadius: jitterScale,
      minSpacing,
    });
  }
  return points;
}


const weightEntries = (...pairs) => Object.fromEntries(pairs);

const scatter = (category, config) => ({
  type: 'scatter',
  category,
  ...config,
});

const line = (category, config) => ({
  type: 'line',
  category,
  ...config,
});

const schemaLibrary = [
  {
    id: 'meadow-breath',
    weight: 1.1,
    themes: weightEntries(
      ['open-field', 1.3],
      ['broad-meadow', 1.4],
      ['mixed-glade', 0.6],
    ),
    densityPreference: 'sparse',
    instructions: [
      scatter('small-plants', {

        count: 2,
        radius: 11,
        jitterRadius: 2.6,
        minSpacing: 3.5,
        seed: 13,

      }),
      scatter('flowers', {
        count: 4,
        radius: 12,
        jitterRadius: 3.1,
        minSpacing: 3,
        seed: 19,
      }),

    ],
  },
  {
    id: 'arcane-conduit',
    weight: 0.65,
    themes: weightEntries(
      ['mixed-glade', 1.1],
      ['thin-woods', 1],
      ['thick-forest', 0.7],
    ),
    tags: weightEntries(['field-edge', 0.4], ['forest-thickening', 0.3]),
    alignWith: 'canopy',
    densityPreference: 'medium',
    instructions: [
      line('structures', {
        count: 3,
        length: 14,
        jitterRadius: 1.8,
        minSpacing: 6.5,
        seed: 401,
        instances: 1,
      }),
      scatter('structures', {
        count: 1,
        radius: 6,
        jitterRadius: 1.2,
        minSpacing: 8,
        seed: 409,
        instances: 1,
      }),
      scatter('flowers', {
        count: 2,
        radius: 10,
        jitterRadius: 2.6,
        minSpacing: 3.1,
        seed: 413,
      }),
    ],
  },
  {
    id: 'frost-encampment',
    weight: 0.58,
    themes: weightEntries(
      ['river-meadow', 1.2],
      ['river-wetland', 1.1],
      ['wet-meadow', 0.9],
      ['wet-wood', 0.7],
    ),
    tags: weightEntries(['near-river', 0.6], ['wet-transition', 0.4]),
    alignWith: 'river',
    preferShore: true,
    densityPreference: 'sparse',
    instructions: [
      line('structures', {
        count: 2,
        length: 10,
        jitterRadius: 1.1,
        minSpacing: 7,
        seed: 421,
        instances: 1,
        allowUnderwater: false,
      }),
      scatter('structures', {
        count: 1,
        radius: 7,
        jitterRadius: 1.4,
        minSpacing: 7.5,
        seed: 427,
        instances: 1,
        preferShore: true,
      }),
      scatter('water-plants', {
        count: 2,
        radius: 9,
        jitterRadius: 2.4,
        minSpacing: 3,
        seed: 431,
        allowUnderwater: true,
      }),
    ],
  },
  {
    id: 'vaporwave-array',
    weight: 0.62,
    themes: weightEntries(
      ['open-field', 1.2],
      ['mixed-glade', 0.9],
      ['broad-meadow', 1],
    ),
    tags: weightEntries(['field-edge', 0.3], ['sparse', 0.4]),
    alignWith: 'stone',
    densityPreference: 'sparse',
    instructions: [
      scatter('structures', {
        count: 2,
        radius: 11,
        jitterRadius: 1.6,
        minSpacing: 9,
        seed: 439,
        instances: 1,
      }),
      line('structures', {
        count: 3,
        length: 16,
        jitterRadius: 1.3,
        minSpacing: 6,
        seed: 443,
        instances: 1,
      }),
      scatter('rocks', {
        count: 1,
        radius: 10,
        jitterRadius: 2.2,
        minSpacing: 4.2,
        seed: 449,
      }),
    ],
  },
  {
    id: 'prairie-band',

    weight: 0.95,
    themes: weightEntries(
      ['open-field', 1.2],
      ['broad-meadow', 1.2],
      ['mixed-glade', 0.6],
    ),
    densityPreference: 'sparse',
    instructions: [
      line('flowers', {
        count: 5,
        length: 18,
        jitterRadius: 2.5,
        minSpacing: 3.2,
        seed: 23,
      }),
      scatter('small-plants', {
        count: 3,
        radius: 10,
        jitterRadius: 2.2,
        minSpacing: 3.2,
        seed: 29,
      }),
    ],
  },
  {
    id: 'field-lattice',
    weight: 0.9,
    themes: weightEntries(
      ['open-field', 1.1],
      ['broad-meadow', 1.2],
      ['mixed-glade', 0.7],
    ),
    tags: weightEntries(['field-edge', 0.4], ['sparse', 0.3]),
    densityPreference: 'sparse',
    instructions: [
      scatter('small-plants', {
        count: 1,
        radius: 10,
        jitterRadius: 2.1,
        minSpacing: 4,
        seed: 31,
      }),
      scatter('flowers', {
        count: 3,
        radius: 12,
        jitterRadius: 3.1,
        minSpacing: 2.6,
        seed: 37,
      }),
      scatter('rocks', {
        count: 1,
        radius: 8,
        jitterRadius: 2.1,
        minSpacing: 4.5,
        seed: 41,
      }),
    ],
  },
  {
    id: 'veil-clearing',
    weight: 1.05,
    themes: weightEntries(
      ['mixed-glade', 1.2],
      ['thin-woods', 1.1],
      ['open-field', 0.8],
    ),
    densityPreference: 'medium',
    instructions: [
      scatter('large-plants', {
        count: 2,
        radius: 9,
        jitterRadius: 2.6,
        minSpacing: 6.5,
        seed: 43,
      }),
      scatter('small-plants', {
        count: 4,
        radius: 11,
        jitterRadius: 2.7,
        minSpacing: 3.5,
        seed: 47,
      }),

    ],
  },
  {
    id: 'sentinel-clearing',
    weight: 1.1,

    themes: weightEntries(
      ['thin-woods', 1.1],
      ['mixed-glade', 1],
      ['open-field', 0.6],
    ),
    tags: weightEntries(['field-edge', 0.5], ['dense', 0.3]),
    instructions: [
      scatter('large-plants', {
        count: 1,

        radius: 6,
        jitterRadius: 2.4,
        minSpacing: 7,
        seed: 53,

      }),
      scatter('rocks', {

        count: 2,
        radius: 9,
        jitterRadius: 2.2,
        minSpacing: 5,

        seed: 59,
      }),
      scatter('small-plants', {
        count: 3,
        radius: 10,
        jitterRadius: 2.9,
        minSpacing: 3.8,
        seed: 61,
      }),

    ],
  },
  {
    id: 'triad-grove',
    weight: 1,

    themes: weightEntries(
      ['thin-woods', 1.1],
      ['thick-forest', 0.7],
      ['mixed-glade', 0.8],
    ),
    densityPreference: 'medium',
    instructions: [
      scatter('large-plants', {

        count: 3,
        radius: 8,
        jitterRadius: 2.8,
        minSpacing: 6.5,

        clump: 1.6,
        seed: 67,
      }),
      scatter('small-plants', {

        count: 4,
        radius: 12,
        jitterRadius: 2.6,
        minSpacing: 4,

        seed: 71,
      }),
      scatter('flowers', {
        count: 2,
        radius: 10,
        jitterRadius: 2.7,
        minSpacing: 3.5,
        seed: 73,
      }),
    ],
  },
  {
    id: 'woodland-ridge',
    weight: 0.95,
    themes: weightEntries(
      ['thin-woods', 1.2],
      ['thick-forest', 0.7],
      ['mixed-glade', 1],
    ),
    tags: weightEntries(
      ['field-edge', 0.4],
      ['forest-thickening', 0.4],
      ['woodland-approach', 0.4],
    ),
    instructions: [
      line('large-plants', {
        count: 3,
        length: 16,
        jitterRadius: 2.4,
        minSpacing: 6,
        seed: 79,
      }),
      scatter('small-plants', {

        count: 5,
        radius: 12,
        jitterRadius: 2.4,
        minSpacing: 3.5,
        seed: 83,

      }),
    ],
  },
  {
    id: 'woodland-carpet',
    weight: 0.9,
    themes: weightEntries(
      ['thin-woods', 1.1],
      ['mixed-glade', 1.1],
      ['thick-forest', 0.6],
    ),
    tags: weightEntries(['woodland-approach', 0.5], ['sparse', 0.3]),
    instructions: [
      scatter('small-plants', {
        count: 5,
        radius: 13,
        jitterRadius: 2.3,
        minSpacing: 3.2,
        seed: 91,
      }),
      scatter('flowers', {
        count: 2,
        radius: 11,
        jitterRadius: 2.8,
        minSpacing: 3,
        seed: 93,
      }),
    ],
  },
  {
    id: 'forest-column',
    weight: 1,

    themes: weightEntries(
      ['thick-forest', 1.2],
      ['deep-forest', 1.3],
      ['wet-wood', 0.8],
    ),
    densityPreference: 'dense',
    instructions: [
      scatter('large-plants', {

        count: 4,
        radius: 10,
        jitterRadius: 2.4,
        minSpacing: 5.5,
        clump: 1.8,
        seed: 97,

      }),
      scatter('small-plants', {
        count: 4,
        radius: 11,
        jitterRadius: 2.2,
        minSpacing: 3.5,
        seed: 101,
      }),
      scatter('fungi', {

        count: 2,
        radius: 8,
        jitterRadius: 2,
        minSpacing: 3,
        seed: 103,

      }),
    ],
  },
  {
    id: 'understory-ring',
    weight: 0.85,

    themes: weightEntries(
      ['thick-forest', 1],
      ['deep-forest', 1.2],
      ['wet-wood', 1],
    ),
    densityPreference: 'dense',
    instructions: [
      line('large-plants', {
        count: 4,
        length: 14,
        jitterRadius: 2.2,
        minSpacing: 5.5,
        seed: 109,
      }),
      scatter('small-plants', {
        count: 5,
        radius: 12,
        jitterRadius: 2.5,
        minSpacing: 3,
        seed: 113,
      }),
      scatter('fungi', {
        count: 2,
        radius: 7,
        jitterRadius: 1.9,
        minSpacing: 2.8,
        seed: 127,
      }),
    ],
  },
  {
    id: 'shadowed-knoll',
    weight: 0.9,
    themes: weightEntries(
      ['thick-forest', 1.1],
      ['deep-forest', 1.3],
      ['wet-wood', 0.9],
    ),
    tags: weightEntries(['dense', 0.4], ['forest-thickening', 0.5]),
    densityPreference: 'dense',
    instructions: [
      scatter('large-plants', {
        count: 3,
        radius: 9,
        jitterRadius: 2.3,
        minSpacing: 5.5,
        seed: 133,
      }),
      scatter('small-plants', {
        count: 5,
        radius: 10,
        jitterRadius: 2.4,
        minSpacing: 3.4,
        seed: 137,
      }),
      scatter('fungi', {
        count: 3,
        radius: 8,
        jitterRadius: 2,
        minSpacing: 2.5,
        seed: 139,
      }),
    ],
  },
  {
    id: 'pillar-holdfast',
    weight: 0.75,
    themes: weightEntries(['deep-forest', 1.3], ['wet-wood', 1.1]),
    tags: weightEntries(['dense', 0.5]),
    densityPreference: 'dense',
    instructions: [
      scatter('large-plants', {
        count: 5,
        radius: 11,
        jitterRadius: 2.3,
        minSpacing: 5,
        clump: 2.2,
        seed: 149,
      }),
      scatter('small-plants', {
        count: 6,
        radius: 12,
        jitterRadius: 2.1,
        minSpacing: 3,
        seed: 151,
      }),
      scatter('fungi', {
        count: 4,
        radius: 9,
        jitterRadius: 2,
        minSpacing: 2.3,
        seed: 157,
      }),
    ],
  },
  {
    id: 'root-pillar',
    weight: 0.8,
    themes: weightEntries(['deep-forest', 1.4], ['wet-wood', 1]),
    tags: weightEntries(['dense', 0.6]),
    densityPreference: 'dense',
    instructions: [
      line('large-plants', {
        count: 4,
        length: 12,
        jitterRadius: 2.2,
        minSpacing: 5,
        seed: 163,
      }),
      scatter('large-plants', {
        count: 1,
        radius: 6,
        jitterRadius: 2.1,
        minSpacing: 4.5,
        seed: 167,
      }),
      scatter('small-plants', {
        count: 4,
        radius: 10,
        jitterRadius: 2.4,
        minSpacing: 3,
        seed: 173,
      }),
      scatter('fungi', {
        count: 3,
        radius: 8,
        jitterRadius: 2,
        minSpacing: 2.4,
        seed: 179,
      }),
    ],
  },
  {
    id: 'glade-radii',
    weight: 0.9,
    themes: weightEntries(
      ['mixed-glade', 1.1],
      ['thin-woods', 1],
      ['open-field', 0.7],
    ),
    tags: weightEntries(['field-edge', 0.3], ['woodland-approach', 0.3]),
    densityPreference: 'medium',
    instructions: [
      scatter('flowers', {
        count: 3,
        radius: 13,
        jitterRadius: 3,
        minSpacing: 3,
        seed: 187,
      }),
      scatter('small-plants', {
        count: 4,
        radius: 11,
        jitterRadius: 2.4,
        minSpacing: 3.3,
        seed: 189,
      }),
    ],
  },
  {
    id: 'river-braid',
    weight: 0.9,
    themes: weightEntries(
      ['river-meadow', 1.4],
      ['river-wetland', 1.2],
      ['wet-meadow', 0.8],
    ),
    tags: weightEntries(['near-river', 0.8], ['wet-transition', 0.4]),
    alignWith: 'river',
    preferShore: true,
    densityPreference: 'sparse',
    instructions: [
      line('small-plants', {
        count: 4,
        length: 18,
        jitterRadius: 2.5,
        minSpacing: 4,
        seed: 191,
      }),
      scatter('flowers', {
        count: 3,
        radius: 10,
        jitterRadius: 2.8,
        minSpacing: 3,
        seed: 197,
      }),
    ],
  },
  {
    id: 'river-point-bar',
    weight: 0.85,
    themes: weightEntries(
      ['river-meadow', 1.3],
      ['river-wetland', 1.1],
      ['wet-meadow', 0.9],
    ),
    tags: weightEntries(['near-river', 0.7], ['wet-transition', 0.3]),
    alignWith: 'river',
    preferShore: true,
    densityPreference: 'medium',
    instructions: [
      scatter('large-plants', {
        count: 2,
        radius: 9,
        jitterRadius: 2.4,
        minSpacing: 5.5,
        seed: 199,
      }),
      scatter('small-plants', {
        count: 3,
        radius: 10,
        jitterRadius: 2.5,
        minSpacing: 3.2,
        seed: 203,
      }),
      scatter('flowers', {
        count: 2,
        radius: 11,
        jitterRadius: 2.9,
        minSpacing: 3,
        seed: 211,
      }),
    ],
  },
  {
    id: 'wetland-mirror',
    weight: 0.9,
    themes: weightEntries(
      ['river-wetland', 1.4],
      ['wet-meadow', 1.2],
      ['wet-wood', 1],
    ),
    tags: weightEntries(['wet-transition', 0.6], ['boggy', 0.6]),
    allowUnderwater: true,
    preferShore: true,
    densityPreference: 'medium',
    instructions: [
      line('small-plants', {
        count: 5,
        length: 16,
        jitterRadius: 2.6,
        minSpacing: 3.2,
        seed: 223,
      }),
      scatter('flowers', {
        count: 3,
        radius: 12,
        jitterRadius: 3.3,
        minSpacing: 3,
        seed: 227,
      }),
    ],
  },
  {
    id: 'marsh-ribbon',
    weight: 0.82,
    themes: weightEntries(
      ['river-wetland', 1.3],
      ['wet-meadow', 1.1],
      ['wet-wood', 1.2],
    ),
    tags: weightEntries(['wet-transition', 0.7], ['boggy', 0.7]),
    allowUnderwater: true,
    preferShore: true,
    densityPreference: 'medium',
    instructions: [
      scatter('large-plants', {
        count: 2,
        radius: 8,
        jitterRadius: 2.2,
        minSpacing: 4.5,
        seed: 229,
      }),
      scatter('small-plants', {
        count: 4,
        radius: 11,
        jitterRadius: 2.6,
        minSpacing: 3.2,
        seed: 233,
      }),
      scatter('flowers', {
        count: 2,
        radius: 11,
        jitterRadius: 3,
        minSpacing: 3,
        seed: 241,
      }),
    ],
  },
  {
    id: 'bog-lattice',
    weight: 0.78,
    themes: weightEntries(
      ['river-wetland', 1.2],
      ['wet-wood', 1.3],
      ['wet-meadow', 1],
    ),
    tags: weightEntries(['boggy', 0.8], ['wet-transition', 0.5]),
    allowUnderwater: true,
    densityPreference: 'dense',
    instructions: [
      scatter('large-plants', {
        count: 3,
        radius: 9,
        jitterRadius: 2.2,
        minSpacing: 4.8,
        seed: 251,
      }),
      scatter('small-plants', {
        count: 5,
        radius: 10,
        jitterRadius: 2.5,
        minSpacing: 3,
        seed: 257,
      }),
      scatter('fungi', {
        count: 3,
        radius: 8,
        jitterRadius: 2,
        minSpacing: 2.6,
        seed: 263,
      }),
    ],
  },
  {
    id: 'reed-stand',
    weight: 0.85,
    themes: weightEntries(
      ['river-wetland', 1.2],
      ['wet-meadow', 1.1],
      ['wet-wood', 1],
    ),
    tags: weightEntries(['near-river', 0.6], ['wet-transition', 0.6]),
    allowUnderwater: true,
    preferShore: true,
    densityPreference: 'medium',
    instructions: [
      line('small-plants', {
        count: 6,
        length: 20,
        jitterRadius: 2.4,
        minSpacing: 3,
        seed: 271,
      }),
      scatter('flowers', {
        count: 2,
        radius: 10,
        jitterRadius: 2.7,
        minSpacing: 3,
        seed: 277,
      }),
    ],
  },
  {
    id: 'rocky-uplift',
    weight: 0.9,
    themes: weightEntries(
      ['rocky-field', 1.4],
      ['rocky-woods', 1.2],
      ['mixed-glade', 0.7],
    ),
    tags: weightEntries(['stony', 0.8], ['sparse', 0.3]),
    wetnessPreference: 'dry',
    instructions: [
      scatter('rocks', {
        count: 3,
        radius: 10,
        jitterRadius: 2.4,
        minSpacing: 4.8,
        seed: 281,
      }),
      scatter('large-plants', {
        count: 1,
        radius: 8,
        jitterRadius: 2.1,
        minSpacing: 5,
        seed: 283,
      }),
      scatter('small-plants', {
        count: 2,
        radius: 9,
        jitterRadius: 2.2,
        minSpacing: 3.6,
        seed: 289,
      }),
    ],
  },
  {
    id: 'boulder-field',
    weight: 0.8,
    themes: weightEntries(
      ['rocky-field', 1.5],
      ['rocky-woods', 1.3],
    ),
    tags: weightEntries(['stony', 1], ['sparse', 0.4]),
    wetnessPreference: 'dry',
    densityPreference: 'sparse',
    instructions: [
      scatter('rocks', {
        count: 4,
        radius: 11,
        jitterRadius: 2.5,
        minSpacing: 5,
        seed: 293,
      }),
      scatter('small-plants', {
        count: 2,
        radius: 9,
        jitterRadius: 2.1,
        minSpacing: 3.5,
        seed: 307,
      }),
    ],
  },
  {
    id: 'scree-run',
    weight: 0.85,
    themes: weightEntries(
      ['rocky-field', 1.3],
      ['rocky-woods', 1.2],
      ['thin-woods', 0.6],
    ),
    tags: weightEntries(['stony', 0.8], ['forest-thickening', 0.3]),
    wetnessPreference: 'dry',
    instructions: [
      line('rocks', {
        count: 4,
        length: 15,
        jitterRadius: 2.3,
        minSpacing: 4.5,
        seed: 311,
      }),
      scatter('small-plants', {
        count: 2,
        radius: 8,
        jitterRadius: 2,
        minSpacing: 3.2,
        seed: 313,
      }),
    ],
  },
  {
    id: 'hill-grove',
    weight: 0.92,
    themes: weightEntries(
      ['rocky-woods', 1.2],
      ['thin-woods', 1.1],
      ['thick-forest', 0.7],
    ),
    tags: weightEntries(['stony', 0.5], ['woodland-approach', 0.4]),
    wetnessPreference: 'dry',
    instructions: [
      scatter('large-plants', {
        count: 2,
        radius: 9,
        jitterRadius: 2.4,
        minSpacing: 6,
        seed: 317,
      }),
      scatter('rocks', {
        count: 2,
        radius: 10,
        jitterRadius: 2.3,
        minSpacing: 4.5,
        seed: 319,
      }),
      scatter('small-plants', {
        count: 3,
        radius: 11,
        jitterRadius: 2.4,
        minSpacing: 3.5,
        seed: 323,
      }),
    ],
  },
  {
    id: 'glade-convergence',
    weight: 0.88,
    themes: weightEntries(
      ['mixed-glade', 1.2],
      ['thin-woods', 1],
      ['open-field', 0.8],
    ),
    tags: weightEntries(['field-edge', 0.4], ['woodland-approach', 0.4]),
    densityPreference: 'medium',
    instructions: [
      line('flowers', {
        count: 4,
        length: 12,
        jitterRadius: 2.4,
        minSpacing: 3,
        seed: 331,
      }),
      scatter('small-plants', {
        count: 3,
        radius: 10,
        jitterRadius: 2.5,
        minSpacing: 3.2,
        seed: 337,
      }),
      scatter('flowers', {
        count: 2,
        radius: 9,
        jitterRadius: 2.6,
        minSpacing: 2.8,
        seed: 347,
      }),
    ],
  },
  {
    id: 'thicket-lip',
    weight: 0.86,
    themes: weightEntries(
      ['thin-woods', 1.2],
      ['thick-forest', 0.9],
      ['mixed-glade', 0.9],
    ),
    tags: weightEntries(['forest-thickening', 0.6], ['woodland-approach', 0.5]),
    densityPreference: 'medium',
    instructions: [
      scatter('large-plants', {
        count: 2,
        radius: 8,
        jitterRadius: 2.5,
        minSpacing: 6,
        seed: 353,
      }),
      scatter('small-plants', {
        count: 4,
        radius: 11,
        jitterRadius: 2.6,
        minSpacing: 3.4,
        seed: 359,
      }),
      scatter('fungi', {
        count: 2,
        radius: 7,
        jitterRadius: 2,
        minSpacing: 2.6,
        seed: 367,
      }),
    ],
  },
  {
    id: 'wet-glade',
    weight: 0.9,
    themes: weightEntries(
      ['wet-wood', 1.2],
      ['mixed-glade', 1],
      ['wet-meadow', 1],
    ),
    tags: weightEntries(['wet-transition', 0.5], ['boggy', 0.4]),
    densityPreference: 'medium',
    instructions: [
      scatter('large-plants', {
        count: 2,
        radius: 9,
        jitterRadius: 2.3,
        minSpacing: 5.5,
        seed: 373,
      }),
      scatter('small-plants', {
        count: 4,
        radius: 11,
        jitterRadius: 2.5,
        minSpacing: 3.2,
        seed: 379,
      }),
      scatter('flowers', {
        count: 2,
        radius: 10,
        jitterRadius: 2.7,
        minSpacing: 2.8,
        seed: 383,
      }),
    ],
  },
  {
    id: 'shelf-holdfast-garden',
    weight: 1,
    themes: weightEntries(['ocean-shelf', 1.6], ['ocean-vent', 0.4]),
    tags: weightEntries(
      ['shoreline', 0.7],
      ['underwater', 0.5],
      ['current-calm', 0.3],
    ),
    allowUnderwater: true,
    requireUnderwater: true,
    preferShore: true,
    preferCalmWater: true,
    densityPreference: 'medium',
    instructions: [
      scatter('water-plants', {
        count: 5,
        radius: 13,
        jitterRadius: 3.2,
        minSpacing: 2.6,
        seed: 701,
        allowUnderwater: true,
        requireUnderwater: true,
        preferShore: true,
      }),
      line('rocks', {
        count: 4,
        length: 12,
        jitterRadius: 1.7,
        minSpacing: 4.1,
        seed: 707,
        allowUnderwater: true,
        requireUnderwater: true,
      }),
      scatter('structures', {
        count: 1,
        radius: 8,
        jitterRadius: 1.6,
        minSpacing: 6,
        seed: 713,
        instances: 1,
        allowUnderwater: true,
        requireUnderwater: true,
        preferShore: true,
      }),
    ],
  },
  {
    id: 'abyssal-pillar-court',
    weight: 0.95,
    themes: weightEntries(['ocean-deep', 1.6], ['ocean-vent', 0.5]),
    tags: weightEntries(
      ['deep-ocean', 0.8],
      ['underwater', 0.5],
      ['current-calm', 0.4],
    ),
    allowUnderwater: true,
    requireUnderwater: true,
    preferCalmWater: true,
    densityPreference: 'sparse',
    instructions: [
      scatter('structures', {
        count: 2,
        radius: 9,
        jitterRadius: 2,
        minSpacing: 5.8,
        seed: 731,
        instances: 1,
        allowUnderwater: true,
        requireUnderwater: true,
      }),
      scatter('rocks', {
        count: 3,
        radius: 12,
        jitterRadius: 2.9,
        minSpacing: 4.6,
        seed: 737,
        allowUnderwater: true,
        requireUnderwater: true,
      }),
      scatter('water-plants', {
        count: 2,
        radius: 11,
        jitterRadius: 3.4,
        minSpacing: 3.9,
        seed: 743,
        allowUnderwater: true,
        requireUnderwater: true,
      }),
    ],
  },
  {
    id: 'hydrothermal-vent-garden',
    weight: 0.92,
    themes: weightEntries(['ocean-vent', 1.7], ['ocean-deep', 0.6]),
    tags: weightEntries(
      ['current-strong', 0.7],
      ['briny', 0.5],
      ['deep-ocean', 0.3],
    ),
    allowUnderwater: true,
    requireUnderwater: true,
    preferCurrents: true,
    densityPreference: 'medium',
    instructions: [
      line('structures', {
        count: 3,
        length: 9,
        jitterRadius: 1.4,
        minSpacing: 4.8,
        seed: 751,
        instances: 1,
        allowUnderwater: true,
        requireUnderwater: true,
      }),
      scatter('water-plants', {
        count: 3,
        radius: 10,
        jitterRadius: 3,
        minSpacing: 2.9,
        seed: 757,
        allowUnderwater: true,
        requireUnderwater: true,
      }),
      scatter('rocks', {
        count: 4,
        radius: 11,
        jitterRadius: 2.5,
        minSpacing: 3.7,
        seed: 761,
        allowUnderwater: true,
        requireUnderwater: true,
      }),
    ],
  },
];

function weightByDensity(schema, metrics) {
  const densityPreference = schema.densityPreference ?? 'medium';
  const canopy = metrics.canopy;
  if (densityPreference === 'dense') {
    return clamp01(0.4 + canopy * 0.9);
  }
  if (densityPreference === 'sparse') {
    return clamp01(0.7 + (0.5 - canopy) * 1.2);
  }
  return 1;
}

function weightByWetness(schema, metrics) {
  const preference = schema.wetnessPreference ?? 'any';
  const wetness = metrics.wetness;
  if (preference === 'wet') {
    return clamp01(0.3 + wetness * 1.4);
  }
  if (preference === 'dry') {
    return clamp01(0.8 + (0.5 - wetness) * 1.1);
  }
  return 1;
}

function weightByOcean(schema, metrics) {
  const oceanMetrics = metrics.ocean;
  if (!oceanMetrics) {
    return 1;
  }
  let weight = 1;
  const shoreline = clamp01(oceanMetrics.shoreline ?? 0);
  const province = clamp01(oceanMetrics.province ?? 0.5);
  const salinity = clamp01(oceanMetrics.salinity ?? 0.5);
  const currentStrength = clamp01(oceanMetrics.current?.strength ?? 0);
  if (schema.preferShore) {
    weight *= clamp01(0.4 + shoreline * 1.6);
  }
  if (schema.requireUnderwater || schema.allowUnderwater) {
    weight *= clamp01(0.3 + province * 1.4);
    weight *= clamp01(0.4 + salinity * 1.2);
  }
  if (schema.preferCurrents) {
    weight *= clamp01(0.6 + currentStrength * 1.2);
  }
  if (schema.preferCalmWater) {
    weight *= clamp01(1.1 - currentStrength * 0.6);
  }
  return weight;
}

function resolveSchemaCandidates(context) {
  const { theme, metrics, blendTags } = context;
  const candidates = [];
  schemaLibrary.forEach((schema) => {
    const baseWeight = schema.weight ?? 1;
    const themeMultiplier = schema.themes
      ? schema.themes[theme] ?? 0
      : 1;
    if (themeMultiplier <= 0) {
      return;
    }
    const densityMultiplier = weightByDensity(schema, metrics);
    const wetnessMultiplier = weightByWetness(schema, metrics);
    const oceanMultiplier = weightByOcean(schema, metrics);
    let tagBonus = 1;
    if (blendTags?.length && schema.tags) {
      const total = blendTags.reduce((sum, tag) => {
        const tagWeight = schema.tags[tag];
        return sum + (typeof tagWeight === 'number' ? tagWeight : 0);
      }, 0);
      tagBonus += total;
    }
    const finalWeight =
      baseWeight *
      themeMultiplier *
      densityMultiplier *
      wetnessMultiplier *
      oceanMultiplier *
      tagBonus;
    if (finalWeight > 0.0001) {
      candidates.push({ schema, weight: finalWeight });
    }
  });
  return candidates;
}

function selectSchema(random, context) {
  const candidates = resolveSchemaCandidates(context);
  if (!candidates.length) {
    return schemaLibrary[0];
  }
  const totalWeight = candidates.reduce((sum, entry) => sum + entry.weight, 0);
  const roll = random(5) * totalWeight;
  let accum = 0;
  for (const entry of candidates) {
    accum += entry.weight;
    if (roll <= accum) {
      return entry.schema;
    }
  }
  return candidates[candidates.length - 1].schema;

}

function buildPlacements(sectorX, sectorZ) {
  const random = (offset) => pseudoRandom(sectorX, sectorZ, offset);

  const context = resolveSectorContext(sectorX, sectorZ);
  const schema = selectSchema(random, context);
  let rotation = Math.floor(random(7) * 4) % 4;
  if (schema.alignWith) {
    const alignment = context.directions[schema.alignWith];
    if (typeof alignment === 'number') {
      rotation = Math.round((alignment / (Math.PI / 2)) % 4);
      if (rotation < 0) {
        rotation += 4;
      }
    }
  }

  const sector = {
    x: sectorX,
    z: sectorZ,
    center: {
      x: sectorX * SECTOR_SIZE + SECTOR_SIZE / 2,
      z: sectorZ * SECTOR_SIZE + SECTOR_SIZE / 2,
    },
  };
  const occupied = [];
  const placements = [];
  schema.instructions.forEach((instruction, index) => {
    const generator = instruction.type === 'line' ? linePoints : scatterPoints;
    const points = generator({
      random,
      sector,
      rotation,
      occupied,
      instruction,
    });
    points.forEach((point, localIndex) => {
      occupied.push({
        x: point.anchor.x - sector.center.x,
        z: point.anchor.z - sector.center.z,
      });
      const columnX = Math.round(point.anchor.x);
      const columnZ = Math.round(point.anchor.z);
      const placement = {
        id: `${schema.id}:${index}:${localIndex}`,
        category: instruction.category,
        column: { x: columnX, z: columnZ },
        anchor: point.anchor,
        jitterRadius: point.jitterRadius,
        allowUnderwater:
          instruction.allowUnderwater ?? schema.allowUnderwater ?? false,
        requireUnderwater:
          instruction.requireUnderwater ?? schema.requireUnderwater ?? false,
        preferShore: instruction.preferShore ?? schema.preferShore ?? false,
        instances: instruction.instances,
        randomSeed: 200 + index * 17 + localIndex * 13,
      };
      placements.push(placement);
    });
  });

  const cells = new Map();
  placements.forEach((placement) => {
    const key = `${placement.column.x}|${placement.column.z}`;
    const existing = cells.get(key);
    if (existing) {
      existing.push(placement);
    } else {
      cells.set(key, [placement]);
    }
  });

  return {
    key: sectorKey(sectorX, sectorZ),
    schemaId: schema.id,
    rotation,
    placements,
    cells,
  };
}

function ensureSector(sectorX, sectorZ) {
  const key = sectorKey(sectorX, sectorZ);
  if (!sectorCache.has(key)) {
    sectorCache.set(key, buildPlacements(sectorX, sectorZ));
  }
  return sectorCache.get(key);
}

export function getSectorPlacementsForColumn(worldX, worldZ) {
  const sectorX = Math.floor(worldX / SECTOR_SIZE);
  const sectorZ = Math.floor(worldZ / SECTOR_SIZE);
  const sector = ensureSector(sectorX, sectorZ);
  const cellKey = `${worldX}|${worldZ}`;
  const placements = sector.cells.get(cellKey) ?? [];
  return {
    sector,
    placements,
  };
}

export function markPlacementCompleted(placement) {
  if (placement) {
    placement.completed = true;
  }
}

export function sectorSize() {
  return SECTOR_SIZE;
}


const SECTOR_SIZE = 32;

function sectorKey(sectorX, sectorZ) {
  return `${sectorX}|${sectorZ}`;
}

function pseudoRandom(sectorX, sectorZ, offset = 0) {
  const value = Math.sin(
    sectorX * 157.31 +
      sectorZ * 311.7 +
      offset * 37.912 +
      SECTOR_SIZE * 0.73,
  );
  return value - Math.floor(value);
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

const schemaLibrary = [
  {
    id: 'sentinel-clearing',
    weight: 1.2,
    instructions: [
      {
        type: 'scatter',
        category: 'large-plants',
        count: 1,
        radius: 5,
        jitterRadius: 2.5,
        minSpacing: 7,
        seed: 11,
      },
      {
        type: 'scatter',
        category: 'rocks',
        count: 2,
        radius: 9,
        jitterRadius: 2.2,
        minSpacing: 5,
        seed: 23,
      },
      {
        type: 'scatter',
        category: 'small-plants',
        count: 3,
        radius: 10,
        jitterRadius: 3,
        minSpacing: 4,
        seed: 37,
      },
    ],
  },
  {
    id: 'triad-grove',
    weight: 1,
    instructions: [
      {
        type: 'scatter',
        category: 'large-plants',
        count: 3,
        radius: 8,
        jitterRadius: 2.8,
        minSpacing: 6.5,
        clump: 1.5,
        seed: 19,
      },
      {
        type: 'scatter',
        category: 'small-plants',
        count: 4,
        radius: 12,
        jitterRadius: 2.6,
        minSpacing: 4,
        seed: 29,
      },
      {
        type: 'scatter',
        category: 'flowers',
        count: 3,
        radius: 12,
        jitterRadius: 3.2,
        minSpacing: 3,
        seed: 31,
      },
    ],
  },
  {
    id: 'meadow-ring',
    weight: 0.9,
    instructions: [
      {
        type: 'line',
        category: 'large-plants',
        count: 2,
        length: 10,
        jitterRadius: 2,
        minSpacing: 6,
        seed: 17,
      },
      {
        type: 'scatter',
        category: 'flowers',
        count: 6,
        radius: 12,
        jitterRadius: 3.5,
        minSpacing: 3,
        clump: 0.3,
        seed: 43,
      },
      {
        type: 'scatter',
        category: 'small-plants',
        count: 4,
        radius: 11,
        jitterRadius: 2.5,
        minSpacing: 3.5,
        seed: 59,
      },
    ],
  },
  {
    id: 'rock-garden',
    weight: 0.8,
    instructions: [
      {
        type: 'scatter',
        category: 'rocks',
        count: 5,
        radius: 13,
        jitterRadius: 2.5,
        minSpacing: 4.5,
        clump: 0.7,
        seed: 13,
      },
      {
        type: 'scatter',
        category: 'small-plants',
        count: 2,
        radius: 8,
        jitterRadius: 2.2,
        minSpacing: 3.5,
        seed: 47,
      },
      {
        type: 'scatter',
        category: 'flowers',
        count: 2,
        radius: 10,
        jitterRadius: 2.4,
        minSpacing: 3,
        seed: 71,
      },
    ],
  },
  {
    id: 'fungi-patch',
    weight: 0.7,
    instructions: [
      {
        type: 'scatter',
        category: 'fungi',
        count: 5,
        radius: 9,
        jitterRadius: 2,
        minSpacing: 3.5,
        clump: 1.8,
        seed: 53,
      },
      {
        type: 'scatter',
        category: 'small-plants',
        count: 3,
        radius: 10,
        jitterRadius: 2,
        minSpacing: 3,
        seed: 61,
      },
    ],
  },
  {
    id: 'twin-sentinels',
    weight: 0.9,
    instructions: [
      {
        type: 'line',
        category: 'large-plants',
        count: 2,
        length: 12,
        jitterRadius: 2.4,
        minSpacing: 7,
        seed: 83,
      },
      {
        type: 'scatter',
        category: 'rocks',
        count: 3,
        radius: 9,
        jitterRadius: 2.1,
        minSpacing: 4.5,
        seed: 89,
      },
      {
        type: 'scatter',
        category: 'flowers',
        count: 3,
        radius: 11,
        jitterRadius: 3,
        minSpacing: 3.5,
        seed: 101,
      },
    ],
  },
  {
    id: 'shoreline-reed',
    weight: 0.6,
    instructions: [
      {
        type: 'line',
        category: 'large-plants',
        count: 1,
        length: 0,
        jitterRadius: 2,
        minSpacing: 6,
        seed: 109,
      },
      {
        type: 'scatter',
        category: 'water-plants',
        count: 4,
        radius: 10,
        jitterRadius: 2,
        minSpacing: 3,
        clump: 1.2,
        seed: 131,
        requireUnderwater: true,
      },
      {
        type: 'scatter',
        category: 'flowers',
        count: 2,
        radius: 9,
        jitterRadius: 2.4,
        minSpacing: 3,
        seed: 137,
        allowUnderwater: true,
      },
    ],
    preferShore: true,
  },
  {
    id: 'structure-clearing',
    weight: 0.4,
    instructions: [
      {
        type: 'scatter',
        category: 'structures',
        count: 1,
        radius: 4,
        jitterRadius: 2,
        minSpacing: 8,
        seed: 151,
      },
      {
        type: 'scatter',
        category: 'rocks',
        count: 2,
        radius: 9,
        jitterRadius: 2.3,
        minSpacing: 4,
        seed: 157,
      },
      {
        type: 'scatter',
        category: 'flowers',
        count: 2,
        radius: 11,
        jitterRadius: 3,
        minSpacing: 3,
        seed: 163,
      },
    ],
  },
];

function selectSchema(random) {
  const totalWeight = schemaLibrary.reduce((sum, schema) => sum + schema.weight, 0);
  const roll = random(5) * totalWeight;
  let accum = 0;
  for (const schema of schemaLibrary) {
    accum += schema.weight;
    if (roll <= accum) {
      return schema;
    }
  }
  return schemaLibrary[schemaLibrary.length - 1];
}

function buildPlacements(sectorX, sectorZ) {
  const random = (offset) => pseudoRandom(sectorX, sectorZ, offset);
  const schema = selectSchema(random);
  const rotation = Math.floor(random(7) * 4) % 4;
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

const sectorCache = new Map();

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


const DEFAULT_RADIUS = 12;
const DEFAULT_SLICE_THICKNESS = 3;

const GLYPH_RULES = [
  {
    glyph: '~',
    label: 'Water & fluids',
    test: ({ type, block }) =>
      block?.isWater === true || /water|fluid|ice/.test(type ?? ''),
  },
  {
    glyph: '#',
    label: 'Stone & ore',
    test: ({ type }) => /stone|rock|ore|basalt|granite|slate/.test(type ?? ''),
  },
  {
    glyph: '^',
    label: 'Vegetation & foliage',
    test: ({ type }) =>
      /grass|leaf|leaves|log|wood|tree|mushroom|flower|plant|vine|cactus|shrub/.test(
        type ?? '',
      ),
  },
  {
    glyph: '"',
    label: 'Soil, sand & sediment',
    test: ({ type }) => /dirt|soil|sand|clay|mud|gravel|silt/.test(type ?? ''),
  },
  {
    glyph: '+',
    label: 'Built structures & crafted blocks',
    test: ({ type }) => /brick|plank|metal|glass|torch|lamp|door|stairs/.test(type ?? ''),
  },
  {
    glyph: '%',
    label: 'Clouds & atmospheric blocks',
    test: ({ type }) => /cloud|mist|fog/.test(type ?? ''),
  },
  {
    glyph: 'o',
    label: 'Other solid blocks',
    test: ({ block }) => block?.isSolid === true,
  },
];

const EMPTY_SPACE = { glyph: '.', label: 'Empty space' };
const PLAYER_MARKER = { glyph: '@', label: 'Player position' };
const DEFAULT_FALLBACK = { glyph: 'o', label: 'Other solid blocks' };

function normalizeNumber(value, fallback = 0) {
  const number = Number(value);
  if (Number.isNaN(number)) {
    return fallback;
  }
  return number;
}

function resolveSlice(verticalSlice, playerY) {
  const baseY = Math.round(playerY ?? 0);
  if (!verticalSlice) {
    const half = Math.floor(DEFAULT_SLICE_THICKNESS / 2);
    return { yMin: baseY - half, yMax: baseY + half };
  }
  if (typeof verticalSlice === 'number') {
    const offset = Math.max(0, Math.round(verticalSlice));
    return { yMin: baseY - offset, yMax: baseY + offset };
  }
  const min =
    typeof verticalSlice.yMin === 'number'
      ? Math.round(verticalSlice.yMin)
      : typeof verticalSlice.min === 'number'
      ? Math.round(verticalSlice.min)
      : null;
  const max =
    typeof verticalSlice.yMax === 'number'
      ? Math.round(verticalSlice.yMax)
      : typeof verticalSlice.max === 'number'
      ? Math.round(verticalSlice.max)
      : null;
  if (min !== null || max !== null) {
    const yMin = min ?? max ?? baseY;
    const yMax = max ?? min ?? baseY;
    return {
      yMin: Math.min(yMin, yMax),
      yMax: Math.max(yMin, yMax),
    };
  }
  const thickness = normalizeNumber(verticalSlice.thickness, DEFAULT_SLICE_THICKNESS);
  const offset = normalizeNumber(verticalSlice.offset, 0);
  const half = Math.max(0, Math.floor(Math.round(thickness) / 2));
  return {
    yMin: baseY - half + offset,
    yMax: baseY + (Math.round(thickness) % 2 === 0 ? half - 1 : half) + offset,
  };
}

function buildColumnLookup(chunkSnapshot) {
  const columns = new Map();
  const chunks = Array.isArray(chunkSnapshot?.chunks) ? chunkSnapshot.chunks : [];
  chunks.forEach((chunk) => {
    const blocks = Array.isArray(chunk?.blocks) ? chunk.blocks : [];
    blocks.forEach((block) => {
      const position = block?.position;
      if (!position) {
        return;
      }
      const worldX = Math.round(position.x ?? position[0] ?? 0);
      const worldY = Math.round(position.y ?? position[1] ?? 0);
      const worldZ = Math.round(position.z ?? position[2] ?? 0);
      const key = `${worldX}|${worldZ}`;
      if (!columns.has(key)) {
        columns.set(key, []);
      }
      columns.get(key).push({ block, y: worldY });
    });
  });
  columns.forEach((entries) => entries.sort((a, b) => b.y - a.y));
  return columns;
}

function selectGlyphForBlock(block) {
  const type = String(block?.type ?? '').toLowerCase();
  const match = GLYPH_RULES.find((rule) => rule.test({ type, block }));
  return match ?? DEFAULT_FALLBACK;
}

function buildLegend(usedGlyphs) {
  const legendEntries = new Map();
  const register = (entry) => {
    if (!entry || !entry.glyph) {
      return;
    }
    if (legendEntries.has(entry.glyph)) {
      return;
    }
    legendEntries.set(entry.glyph, entry.label ?? '');
  };

  register(PLAYER_MARKER);
  GLYPH_RULES.forEach(register);
  register(DEFAULT_FALLBACK);
  register(EMPTY_SPACE);

  const lines = ['Legend:'];
  legendEntries.forEach((label, glyph) => {
    if (usedGlyphs.has(glyph) || glyph === EMPTY_SPACE.glyph) {
      lines.push(`${glyph} — ${label}`);
    }
  });
  return lines.join('\n');
}

export function renderAsciiViewport({
  chunkSnapshot,
  playerPosition,
  radius = DEFAULT_RADIUS,
  verticalSlice,
}) {
  if (!chunkSnapshot) {
    return {
      map: 'No chunk snapshot available.',
      legend: 'Legend: (none — chunk snapshot unavailable)',
    };
  }

  const centerX = Math.round(playerPosition?.x ?? 0);
  const centerZ = Math.round(playerPosition?.z ?? 0);
  const slice = resolveSlice(verticalSlice, playerPosition?.y);
  const clampedRadius = Math.max(1, Math.round(radius ?? DEFAULT_RADIUS));
  const minX = centerX - clampedRadius;
  const maxX = centerX + clampedRadius;
  const minZ = centerZ - clampedRadius;
  const maxZ = centerZ + clampedRadius;
  const columns = buildColumnLookup(chunkSnapshot);
  const usedGlyphs = new Set();
  const lines = [];

  for (let z = maxZ; z >= minZ; z -= 1) {
    let row = '';
    for (let x = minX; x <= maxX; x += 1) {
      let glyph = EMPTY_SPACE.glyph;
      const key = `${x}|${z}`;
      const column = columns.get(key);
      if (column) {
        const blockEntry = column.find(
          (entry) => entry.y >= slice.yMin && entry.y <= slice.yMax,
        );
        if (blockEntry) {
          const match = selectGlyphForBlock(blockEntry.block);
          glyph = match.glyph;
          usedGlyphs.add(match.glyph);
        }
      }
      if (x === centerX && z === centerZ) {
        glyph = PLAYER_MARKER.glyph;
        usedGlyphs.add(PLAYER_MARKER.glyph);
      }
      row += glyph;
    }
    lines.push(row);
  }

  if (!usedGlyphs.has(PLAYER_MARKER.glyph)) {
    usedGlyphs.add(PLAYER_MARKER.glyph);
  }
  usedGlyphs.add(EMPTY_SPACE.glyph);

  return {
    map: lines.join('\n'),
    legend: buildLegend(usedGlyphs),
    bounds: {
      minX,
      maxX,
      minZ,
      maxZ,
      yMin: slice.yMin,
      yMax: slice.yMax,
    },
  };
}

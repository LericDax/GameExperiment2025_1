const DEFAULT_STEP = 0.5;
const MIN_STEP = 0.05;

const DEFAULT_SMOOTHING = {
  nodeInflate: 0,
  segmentOverlap: 0,
  segmentEndPadding: 0,
  segmentSubdivisions: 1,
  embed: 0,
  featherLayers: 0,
  featherRadius: 0,
  featherSpacing: 0.25,
  featherScale: 0.15,
  featherTint: null,
  microJitter: 0,
};

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function normalizeSmoothingConfig(value, fallback = DEFAULT_SMOOTHING) {
  const base = {
    nodeInflate:
      typeof fallback?.nodeInflate === 'number'
        ? fallback.nodeInflate
        : DEFAULT_SMOOTHING.nodeInflate,
    segmentOverlap:
      typeof fallback?.segmentOverlap === 'number'
        ? fallback.segmentOverlap
        : DEFAULT_SMOOTHING.segmentOverlap,
    segmentEndPadding:
      typeof fallback?.segmentEndPadding === 'number'
        ? fallback.segmentEndPadding
        : DEFAULT_SMOOTHING.segmentEndPadding,
    segmentSubdivisions:
      typeof fallback?.segmentSubdivisions === 'number'
        ? fallback.segmentSubdivisions
        : DEFAULT_SMOOTHING.segmentSubdivisions,
    embed:
      typeof fallback?.embed === 'number'
        ? fallback.embed
        : DEFAULT_SMOOTHING.embed,
    featherLayers:
      typeof fallback?.featherLayers === 'number'
        ? fallback.featherLayers
        : DEFAULT_SMOOTHING.featherLayers,
    featherRadius:
      typeof fallback?.featherRadius === 'number'
        ? fallback.featherRadius
        : DEFAULT_SMOOTHING.featherRadius,
    featherSpacing:
      typeof fallback?.featherSpacing === 'number'
        ? fallback.featherSpacing
        : DEFAULT_SMOOTHING.featherSpacing,
    featherScale:
      typeof fallback?.featherScale === 'number'
        ? fallback.featherScale
        : DEFAULT_SMOOTHING.featherScale,
    featherTint:
      typeof fallback?.featherTint === 'string'
        ? fallback.featherTint
        : DEFAULT_SMOOTHING.featherTint,
    microJitter:
      typeof fallback?.microJitter === 'number'
        ? fallback.microJitter
        : DEFAULT_SMOOTHING.microJitter,
  };

  if (!value || typeof value !== 'object') {
    return { ...base };
  }

  const numeric = (candidate) =>
    typeof candidate === 'number' && !Number.isNaN(candidate) ? candidate : null;

  const stringValue = (candidate) =>
    typeof candidate === 'string' && candidate.length > 0 ? candidate : null;

  const nodeInflate = numeric(value.nodeInflate ?? value.nodePadding);
  if (nodeInflate !== null) {
    base.nodeInflate = Math.max(0, nodeInflate);
  }

  const segmentOverlap = numeric(
    value.segmentOverlap ?? value.overlap ?? value.segmentVisualOverlap,
  );
  if (segmentOverlap !== null) {
    base.segmentOverlap = Math.max(0, segmentOverlap);
  }

  const segmentEndPadding = numeric(
    value.segmentEndPadding ?? value.endPadding ?? value.padding ?? value.nodeBlendPadding,
  );
  if (segmentEndPadding !== null) {
    base.segmentEndPadding = Math.max(0, segmentEndPadding);
  }

  const segmentSubdivisions = numeric(
    value.segmentSubdivisions ?? value.subdivisions ?? value.segmentLerpSteps,
  );
  if (segmentSubdivisions !== null) {
    base.segmentSubdivisions = Math.max(1, Math.floor(segmentSubdivisions));
  }

  const embed = numeric(value.embed ?? value.segmentEmbed ?? value.segmentInset);
  if (embed !== null) {
    base.embed = Math.max(0, embed);
  }

  const featherLayers = numeric(
    value.featherLayers ?? value.layers ?? value.feather ?? value.featherCount,
  );
  if (featherLayers !== null) {
    base.featherLayers = Math.max(0, Math.floor(featherLayers));
  }

  const featherRadius = numeric(
    value.featherRadius ?? value.featherSpread ?? value.ribbonRadius,
  );
  if (featherRadius !== null) {
    base.featherRadius = Math.max(0, featherRadius);
  }

  const featherSpacing = numeric(
    value.featherSpacing ?? value.featherStep ?? value.ribbonSpacing,
  );
  if (featherSpacing !== null) {
    base.featherSpacing = Math.max(0, featherSpacing);
  }

  const featherScale = numeric(
    value.featherScale ?? value.featherGrowth ?? value.ribbonScale,
  );
  if (featherScale !== null) {
    base.featherScale = Math.max(0, featherScale);
  }

  const microJitter = numeric(
    value.microJitter ?? value.jitter ?? value.wobble ?? value.sparkle,
  );
  if (microJitter !== null) {
    base.microJitter = Math.max(0, microJitter);
  }

  const featherTint = stringValue(
    value.featherTint ?? value.accentTint ?? value.ribbonTint ?? value.tint,
  );
  if (featherTint !== null) {
    base.featherTint = featherTint;
  }

  return { ...base };
}

function clampStep(step) {
  if (typeof step !== 'number' || Number.isNaN(step) || step <= 0) {
    return DEFAULT_STEP;
  }
  return Math.max(MIN_STEP, step);
}

function toVector3(value, fallback = { x: 0, y: 0, z: 0 }) {
  if (Array.isArray(value)) {
    const [x = fallback.x, y = fallback.y, z = fallback.z] = value;
    return { x, y, z };
  }
  if (value && typeof value === 'object') {
    const x = typeof value.x === 'number' ? value.x : fallback.x;
    const y = typeof value.y === 'number' ? value.y : fallback.y;
    const z = typeof value.z === 'number' ? value.z : fallback.z;
    return { x, y, z };
  }
  return { ...fallback };
}

function toSize(value, fallback = { x: 1, y: 1, z: 1 }) {
  if (typeof value === 'number') {
    return { x: value, y: value, z: value };
  }
  if (Array.isArray(value)) {
    const [x = fallback.x, y = fallback.y, z = fallback.z] = value;
    return { x, y, z };
  }
  if (value && typeof value === 'object') {
    const x = typeof value.x === 'number' ? value.x : fallback.x;
    const y = typeof value.y === 'number' ? value.y : fallback.y;
    const z = typeof value.z === 'number' ? value.z : fallback.z;
    return { x, y, z };
  }
  return { ...fallback };
}

function normalizeVoxelConfig(voxel, fallback = null) {
  const source = voxel || fallback;
  if (!source || typeof source.type !== 'string') {
    return null;
  }
  return {
    type: source.type,
    tint: typeof source.tint === 'string' ? source.tint : null,
    isSolid:
      typeof source.isSolid === 'boolean' ? source.isSolid : undefined,
    destructible:
      typeof source.destructible === 'boolean'
        ? source.destructible
        : undefined,
    collisionMode:
      typeof source.collision === 'string'
        ? source.collision
        : typeof source.collisionMode === 'string'
        ? source.collisionMode
        : null,
    metadata:
      source.metadata && typeof source.metadata === 'object'
        ? { ...source.metadata }
        : null,
  };
}

function parseTint(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const hex = value.trim();
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) {
    return null;
  }
  const int = parseInt(match[1], 16);
  return {
    r: (int >> 16) & 0xff,
    g: (int >> 8) & 0xff,
    b: int & 0xff,
  };
}

function tintToHex(tint) {
  const clamp = (component) =>
    Math.max(0, Math.min(255, Math.round(component)));
  const r = clamp(tint.r).toString(16).padStart(2, '0');
  const g = clamp(tint.g).toString(16).padStart(2, '0');
  const b = clamp(tint.b).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

function lerpTint(startTint, endTint, t) {
  if (!startTint || !endTint) {
    return startTint || endTint || null;
  }
  return {
    r: lerp(startTint.r, endTint.r, t),
    g: lerp(startTint.g, endTint.g, t),
    b: lerp(startTint.b, endTint.b, t),
  };
}

function cloneVector(vector) {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function cloneSize(size) {
  return { x: size.x, y: size.y, z: size.z };
}

function addVoxel(target, usedKeys, voxel) {
  const size = voxel.size ? cloneSize(voxel.size) : { x: 1, y: 1, z: 1 };
  const position = cloneVector(voxel.position);
  const key = [
    voxel.type,
    position.x.toFixed(4),
    position.y.toFixed(4),
    position.z.toFixed(4),
    size.x.toFixed(4),
    size.y.toFixed(4),
    size.z.toFixed(4),
    voxel.tint || '',
  ].join('|');
  if (usedKeys.has(key)) {
    return;
  }
  usedKeys.add(key);
  target.push({
    type: voxel.type,
    position,
    size,
    tint: voxel.tint || null,
    isSolid: voxel.isSolid,
    destructible: voxel.destructible,
    collisionMode: voxel.collisionMode || null,
    metadata: voxel.metadata ? { ...voxel.metadata } : null,
  });
}

export function generateNodeGrowthVoxels(object, config) {
  if (!object || !config) {
    return [];
  }

  const nodes = new Map();
  const voxels = [];
  const usedKeys = new Set();

  const defaultNodeVoxel = normalizeVoxelConfig(
    config.defaultNodeVoxel,
    config.defaultVoxel,
  );

  const baseSmoothing = normalizeSmoothingConfig(
    config.smoothing ?? config.visual?.smoothing ?? null,
  );

  (config.nodes || []).forEach((node) => {
    if (!node || typeof node.id !== 'string') {
      return;
    }
    const position = toVector3(node.position);
    const nodeSmoothing = normalizeSmoothingConfig(node.smoothing, baseSmoothing);
    nodes.set(node.id, { ...node, position, smoothing: nodeSmoothing });
    const nodeVoxelConfig = normalizeVoxelConfig(node.voxel, defaultNodeVoxel);
    if (nodeVoxelConfig) {
      const size = toSize(
        node.voxel?.size ?? config.nodeSize ?? config.segmentSize ?? 1,
      );
      let metadata = nodeVoxelConfig.metadata ? { ...nodeVoxelConfig.metadata } : null;
      const nodeSmoothingActive =
        nodeSmoothing.nodeInflate > 0 ||
        nodeSmoothing.embed > 0 ||
        nodeSmoothing.featherLayers > 0 ||
        nodeSmoothing.microJitter > 0;
      if (nodeSmoothingActive) {
        const visual = { ...(metadata?.visual ?? {}) };
        visual.smoothing = {
          ...(visual.smoothing ?? {}),
          type: 'node',
          inflate: nodeSmoothing.nodeInflate,
          embed: nodeSmoothing.embed,
          featherLayers: nodeSmoothing.featherLayers,
          featherRadius: nodeSmoothing.featherRadius,
          featherSpacing: nodeSmoothing.featherSpacing,
          featherScale: nodeSmoothing.featherScale,
          featherTint: nodeSmoothing.featherTint,
          microJitter: nodeSmoothing.microJitter,
        };
        metadata = { ...(metadata ?? {}), visual };
      }
      addVoxel(voxels, usedKeys, {
        ...nodeVoxelConfig,
        position,
        size,
        metadata,
      });
    }
  });

  const defaultSegmentVoxel = normalizeVoxelConfig(
    config.segmentVoxel,
    config.defaultVoxel,
  );

  (config.segments || []).forEach((segment) => {
    if (!segment || typeof segment.from !== 'string' || typeof segment.to !== 'string') {
      return;
    }
    const fromNode = nodes.get(segment.from);
    const toNode = nodes.get(segment.to);
    if (!fromNode || !toNode) {
      return;
    }

    const start = toVector3(segment.startPosition, fromNode.position);
    const end = toVector3(segment.endPosition, toNode.position);
    const delta = {
      x: end.x - start.x,
      y: end.y - start.y,
      z: end.z - start.z,
    };
    const length = Math.hypot(delta.x, delta.y, delta.z);
    if (length === 0) {
      return;
    }

    const stepSize = clampStep(segment.step ?? config.step ?? DEFAULT_STEP);
    const segmentSmoothing = normalizeSmoothingConfig(segment.smoothing, baseSmoothing);
    const subdivisions = Math.max(1, segmentSmoothing.segmentSubdivisions);
    const steps = (segment.steps
      ? Math.max(1, Math.floor(segment.steps))
      : Math.max(1, Math.ceil(length / stepSize))) * subdivisions;
    const stepLength = length / steps;

    const startSize = toSize(
      segment.startSize ?? segment.size ?? config.segmentSize ?? 1,
    );
    const endSize = toSize(
      segment.endSize ?? segment.size ?? config.segmentSize ?? startSize,
    );

    const segmentVoxel = normalizeVoxelConfig(segment.voxel, defaultSegmentVoxel);
    if (!segmentVoxel) {
      return;
    }

    const startTint = parseTint(segment.startTint ?? segmentVoxel.tint);
    const endTint = parseTint(segment.endTint ?? segmentVoxel.tint);

    const includeStart = segment.includeStart ?? false;
    const includeEnd = segment.includeEnd ?? true;

    const direction = {
      x: delta.x / length,
      y: delta.y / length,
      z: delta.z / length,
    };
    const startPaddingValue = Math.max(
      segmentSmoothing.segmentEndPadding,
      fromNode.smoothing?.nodeInflate ?? 0,
    );
    const endPaddingValue = Math.max(
      segmentSmoothing.segmentEndPadding,
      toNode.smoothing?.nodeInflate ?? 0,
    );

    const smoothingActive =
      segmentSmoothing.segmentOverlap > 0 ||
      startPaddingValue > 0 ||
      endPaddingValue > 0 ||
      segmentSmoothing.embed > 0 ||
      segmentSmoothing.featherLayers > 0 ||
      segmentSmoothing.microJitter > 0;

    for (let i = 0; i <= steps; i += 1) {
      if (i === 0 && !includeStart) {
        continue;
      }
      if (i === steps && !includeEnd) {
        continue;
      }
      const t = steps === 0 ? 0 : i / steps;
      const position = {
        x: start.x + delta.x * t,
        y: start.y + delta.y * t,
        z: start.z + delta.z * t,
      };
      const size = {
        x: lerp(startSize.x, endSize.x, t),
        y: lerp(startSize.y, endSize.y, t),
        z: lerp(startSize.z, endSize.z, t),
      };

      let tint = segmentVoxel.tint;
      if (startTint || endTint) {
        const mixed = lerpTint(startTint, endTint, t);
        tint = mixed ? tintToHex(mixed) : tint;
      }

      let metadata = segmentVoxel.metadata ? { ...segmentVoxel.metadata } : null;
      if (smoothingActive) {
        const visual = { ...(metadata?.visual ?? {}) };
        visual.smoothing = {
          ...(visual.smoothing ?? {}),
          type: 'segment',
          overlap: segmentSmoothing.segmentOverlap,
          stepLength,
          direction: { ...direction },
          distanceFromStart: length * t,
          distanceFromEnd: length * (1 - t),
          startPadding: startPaddingValue,
          endPadding: endPaddingValue,
          embed: segmentSmoothing.embed,
          featherLayers: segmentSmoothing.featherLayers,
          featherRadius: segmentSmoothing.featherRadius,
          featherSpacing: segmentSmoothing.featherSpacing,
          featherScale: segmentSmoothing.featherScale,
          featherTint: segmentSmoothing.featherTint,
          microJitter: segmentSmoothing.microJitter,
          progress: t,
          steps,
        };
        metadata = { ...(metadata ?? {}), visual };
      }

      addVoxel(voxels, usedKeys, {
        ...segmentVoxel,
        position,
        size,
        tint,
        metadata,
      });
    }
  });

  return voxels;
}

export default generateNodeGrowthVoxels;

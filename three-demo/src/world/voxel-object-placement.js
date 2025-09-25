import {
  getWeightedVoxelObject,
  isVoxelObjectAllowedInBiome,
} from './voxel-object-library.js';
import { resolveVoxelObjectVoxels } from './voxel-object-processor.js';
import { getNanovoxelDefinition } from './procedural/nanovoxel-palette.js';
import {
  getSectorPlacementsForColumn,
  markPlacementCompleted,
} from './sector-object-planner.js';
import { ValueNoise2D } from './noise.js';

const objectDensityField = new ValueNoise2D(9103);

function ensureRandomSource(randomSource) {
  if (typeof randomSource === 'function') {
    return randomSource;
  }
  return () => Math.random();
}

function resolveScaleVector({ size }, voxelScale) {
  return {
    x: (size.x ?? 1) * voxelScale,
    y: (size.y ?? 1) * voxelScale,
    z: (size.z ?? 1) * voxelScale,
  };
}


const ZERO_OFFSET = { x: 0, y: 0, z: 0 };

function cloneScale(scale) {
  return { x: scale.x, y: scale.y, z: scale.z };
}

function cloneOffset(offset) {
  return { x: offset.x, y: offset.y, z: offset.z };
}

function seededRandom(...components) {
  let hash = 2166136261;
  components.forEach((component) => {
    const str = String(component);
    for (let i = 0; i < str.length; i += 1) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  });
  return (hash >>> 0) / 4294967296;
}

function seededRandomCentered(...components) {
  return seededRandom(...components) * 2 - 1;
}

function normalizeVector(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length === 0) {
    return null;
  }
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function crossVectors(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function scaleVector(vector, amount) {
  return { x: vector.x * amount, y: vector.y * amount, z: vector.z * amount };
}

function addVectors(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function createLocalFrame(direction, customUpHint = null) {
  const forward = normalizeVector(direction);
  if (!forward) {
    return null;
  }
  const preferredUp =
    (customUpHint && normalizeVector(customUpHint)) ||
    (Math.abs(forward.y) < 0.999 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 });
  let right = normalizeVector(crossVectors(preferredUp, forward));
  if (!right) {
    const fallback = Math.abs(forward.y) < 0.999 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 };
    right = normalizeVector(crossVectors(fallback, forward)) ?? fallback;
  }
  let up = normalizeVector(crossVectors(forward, right));
  if (!up) {
    up = preferredUp;
  }
  return { forward, right, up };
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseHexColor(hex) {
  if (typeof hex !== 'string') {
    return null;
  }
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
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

function colorToHex({ r, g, b }) {
  const clamp = (component) =>
    Math.max(0, Math.min(255, Math.round(component))).toString(16).padStart(2, '0');
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`;
}

function blendTint(baseHex, accentHex, mix) {
  const mixValue = clamp01(mix);
  const base = parseHexColor(baseHex) ?? { r: 255, g: 255, b: 255 };
  const accent = parseHexColor(accentHex) ?? { r: 255, g: 255, b: 255 };
  return colorToHex({
    r: base.r + (accent.r - base.r) * mixValue,
    g: base.g + (accent.g - base.g) * mixValue,
    b: base.b + (accent.b - base.b) * mixValue,
  });
}

const DEFAULT_FRAME = {
  forward: { x: 0, y: 1, z: 0 },
  right: { x: 1, y: 0, z: 0 },
  up: { x: 0, y: 0, z: 1 },
};

function ensureFrame(direction, upHint) {
  return createLocalFrame(direction, upHint) ?? DEFAULT_FRAME;
}

function convertLocalToWorld(frame, local, voxelScale) {
  return {
    x:
      frame.forward.x * local.forward * voxelScale +
      frame.right.x * local.right * voxelScale +
      frame.up.x * local.up * voxelScale,
    y:
      frame.forward.y * local.forward * voxelScale +
      frame.right.y * local.right * voxelScale +
      frame.up.y * local.up * voxelScale,
    z:
      frame.forward.z * local.forward * voxelScale +
      frame.right.z * local.right * voxelScale +
      frame.up.z * local.up * voxelScale,
  };
}

function resolveNanovoxelTint(definition, entry, element, baseTint) {
  const allowInherit =
    (definition.inheritTint ?? true) && entry.inheritTint !== false && element.inheritTint !== false;
  const inheritStrength = allowInherit
    ? element.inheritTintStrength ?? entry.inheritTintStrength ?? definition.inheritTintStrength ?? 0.35
    : 0;

  let tint =
    element.tint ?? entry.tint ?? definition.defaultTint ?? baseTint ?? '#ffffff';

  if (allowInherit && baseTint && inheritStrength > 0) {
    tint = blendTint(tint, baseTint, clamp01(inheritStrength));
  }

  const accentTint =
    element.accentTint ?? entry.accentTint ?? definition.accentTint ?? null;
  const accentStrength =
    element.accentStrength ?? entry.accentStrength ?? definition.accentStrength ?? 0;
  if (accentTint && accentStrength > 0) {
    tint = blendTint(tint, accentTint, clamp01(accentStrength));
  }

  return tint;
}

function computeNanovoxelPlacementsForDescriptor(
  voxel,
  basePlacement,
  object,
  descriptor,
  descriptorIndex,
) {
  if (!descriptor || !Array.isArray(descriptor.entries) || descriptor.entries.length === 0) {
    return [];
  }

  const placements = [];
  const smoothing = voxel?.metadata?.visual?.smoothing;
  const baseOffset =
    basePlacement.visualOffset === ZERO_OFFSET
      ? ZERO_OFFSET
      : cloneOffset(basePlacement.visualOffset);
  const baseTint = basePlacement.tint;
  const context = descriptor.context ?? {};

  descriptor.entries.forEach((entry, entryIndex) => {
    const definition = getNanovoxelDefinition(entry.id);
    if (!definition) {
      return;
    }

    const distribution =
      entry.distribution && entry.distribution !== 'auto'
        ? entry.distribution
        : descriptor.type === 'segment'
        ? 'line'
        : 'ring';

    if (
      descriptor.type === 'segment' &&
      (entry.minProgress > (smoothing?.progress ?? 0) ||
        entry.maxProgress < (smoothing?.progress ?? 0))
    ) {
      return;
    }

    const direction =
      descriptor.type === 'segment'
        ? smoothing?.direction ?? ZERO_OFFSET
        : entry.axis ?? context.axis ?? { x: 0, y: 1, z: 0 };
    const upHint = entry.up ?? context.up ?? null;
    const frame = ensureFrame(direction, upHint);

    const progress = smoothing?.progress ?? 0;
    let growthProgress = 1;
    if (descriptor.type === 'segment' && entry.growth > 0) {
      let factor = progress;
      if (entry.progressMode === 'end' || entry.progressMode === 'fromend') {
        factor = 1 - progress;
      } else if (entry.progressMode === 'center') {
        factor = 1 - Math.abs(progress - 0.5) * 2;
      }
      growthProgress = 1 + entry.growth * clamp01(factor);
    }

    const entryScale = {
      right: entry.scale.right * growthProgress,
      up: entry.scale.up * growthProgress,
      forward: entry.scale.forward * growthProgress,
    };

    const count = Math.max(1, entry.count);
    const arc = entry.arc;
    const radiusRight = entry.radiusRight;
    const radiusUp = entry.radiusUp;
    const jitterStrength = entry.jitter * object.voxelScale;
    const scatterRadius = entry.scatter * object.voxelScale;
    const baseSeed = [
      object.id ?? 'object',
      voxel.index ?? 0,
      descriptorIndex,
      entryIndex,
      entry.seed ?? entry.id,
    ];

    for (let copyIndex = 0; copyIndex < count; copyIndex += 1) {
      const ratio =
        distribution === 'line' && count > 1 ? copyIndex / (count - 1) : count <= 1 ? 0 : copyIndex / count;

      const local = {
        right: entry.offset.right,
        up: entry.offset.up,
        forward: entry.offset.forward,
      };

      if (distribution === 'line') {
        const angle = entry.phase + ratio * arc;
        local.forward += (ratio - 0.5) * entry.length;
        local.right += Math.cos(angle) * radiusRight;
        local.up += Math.sin(angle) * radiusUp;
      } else if (distribution === 'cluster' || distribution === 'spray') {
        const theta = seededRandom(...baseSeed, copyIndex, 'theta') * Math.PI * 2;
        const phi = seededRandom(...baseSeed, copyIndex, 'phi') * Math.PI;
        const magnitude = seededRandom(...baseSeed, copyIndex, 'mag');
        local.right += Math.cos(theta) * Math.sin(phi) * radiusRight * magnitude;
        local.up += Math.sin(theta) * Math.sin(phi) * radiusUp * magnitude;
        local.forward += Math.cos(phi) * entry.length * magnitude * 0.5;
      } else {
        const effectiveRatio = distribution === 'fan' ? ratio : copyIndex / count;
        const angle = entry.phase + effectiveRatio * arc;
        local.right += Math.cos(angle) * radiusRight;
        local.up += Math.sin(angle) * radiusUp;
        if (distribution === 'fan') {
          local.forward += (effectiveRatio - 0.5) * entry.length;
        }
      }

      const scaledLocal = {
        right: local.right * entryScale.right,
        up: local.up * entryScale.up,
        forward: local.forward * entryScale.forward,
      };

      let anchorOffset = convertLocalToWorld(frame, scaledLocal, object.voxelScale);

      if (scatterRadius > 0) {
        const theta = seededRandom(...baseSeed, copyIndex, 'scatter-theta') * Math.PI * 2;
        const phi = seededRandom(...baseSeed, copyIndex, 'scatter-phi') * Math.PI;
        const magnitude = seededRandom(...baseSeed, copyIndex, 'scatter-mag');
        const scatterOffset = {
          x: Math.cos(theta) * Math.sin(phi) * scatterRadius * magnitude,
          y: Math.sin(theta) * Math.sin(phi) * scatterRadius * magnitude,
          z: Math.cos(phi) * scatterRadius * magnitude,
        };
        anchorOffset = addVectors(anchorOffset, scatterOffset);
      }

      if (jitterStrength > 0) {
        const jitter = {
          x: seededRandomCentered(...baseSeed, copyIndex, 'jx') * jitterStrength,
          y: seededRandomCentered(...baseSeed, copyIndex, 'jy') * jitterStrength,
          z: seededRandomCentered(...baseSeed, copyIndex, 'jz') * jitterStrength,
        };
        anchorOffset = addVectors(anchorOffset, jitter);
      }

      definition.elements.forEach((element, elementIndex) => {
        const elementOffset = element.offset
          ? {
              right: element.offset.right ?? 0,
              up: element.offset.up ?? 0,
              forward: element.offset.forward ?? 0,
            }
          : { right: 0, up: 0, forward: 0 };
        const elementScaleLocal = element.scale
          ? {
              right: element.scale.right ?? 1,
              up: element.scale.up ?? 1,
              forward: element.scale.forward ?? 1,
            }
          : { right: 1, up: 1, forward: 1 };

        const elementSeed = [...baseSeed, copyIndex, elementIndex];

        const scaledElementOffset = {
          right: elementOffset.right * entryScale.right,
          up: elementOffset.up * entryScale.up,
          forward: elementOffset.forward * entryScale.forward,
        };
        let elementWorldOffset = convertLocalToWorld(
          frame,
          scaledElementOffset,
          object.voxelScale,
        );

        const elementJitterStrength = Math.max(0, element.jitter ?? 0) * object.voxelScale;
        if (elementJitterStrength > 0) {
          const elementJitter = {
            x: seededRandomCentered(...elementSeed, 'ejx') * elementJitterStrength,
            y: seededRandomCentered(...elementSeed, 'ejy') * elementJitterStrength,
            z: seededRandomCentered(...elementSeed, 'ejz') * elementJitterStrength,
          };
          elementWorldOffset = addVectors(elementWorldOffset, elementJitter);
        }

        const combinedOffset = addVectors(anchorOffset, elementWorldOffset);

        const finalOffset =
          baseOffset === ZERO_OFFSET ? combinedOffset : addVectors(baseOffset, combinedOffset);

        const scaleJitter = entry.scaleJitter;
        const jitterMultiplier = scaleJitter > 0
          ? {
              right: 1 + seededRandomCentered(...elementSeed, 'sr') * scaleJitter,
              up: 1 + seededRandomCentered(...elementSeed, 'su') * scaleJitter,
              forward: 1 + seededRandomCentered(...elementSeed, 'sf') * scaleJitter,
            }
          : { right: 1, up: 1, forward: 1 };

        const scale = {
          x: Math.max(
            0.01,
            definition.baseScale.x *
              entryScale.right *
              elementScaleLocal.right *
              jitterMultiplier.right *
              object.voxelScale,
          ),
          y: Math.max(
            0.01,
            definition.baseScale.y *
              entryScale.up *
              elementScaleLocal.up *
              jitterMultiplier.up *
              object.voxelScale,
          ),
          z: Math.max(
            0.01,
            definition.baseScale.z *
              entryScale.forward *
              elementScaleLocal.forward *
              jitterMultiplier.forward *
              object.voxelScale,
          ),
        };

        const tint = resolveNanovoxelTint(definition, entry, element, baseTint);

        const key = `${basePlacement.key}|nano-${descriptorIndex}-${entryIndex}-${copyIndex}-${elementIndex}`;

        placements.push({
          type: element.type ?? entry.type ?? definition.baseType,
          worldX: basePlacement.worldX,
          worldY: basePlacement.worldY,
          worldZ: basePlacement.worldZ,
          options: {
            scale,
            visualScale: scale,
            visualOffset: finalOffset,
            tint,
            collisionMode: 'none',
            isSolid: false,
            destructible: basePlacement.destructible,
            sourceObjectId: object.id,
            voxelIndex: voxel.index,
            metadata: basePlacement.metadata,
            key,
          },
        });
      });
    }
  });

  return placements;
}

function computeNanovoxelPlacements(voxel, basePlacement, object) {
  const descriptor = voxel?.metadata?.visual?.nanovoxels;
  if (!descriptor) {
    return [];
  }
  const descriptors = Array.isArray(descriptor) ? descriptor : [descriptor];
  const placements = [];
  descriptors.forEach((entry, index) => {
    placements.push(
      ...computeNanovoxelPlacementsForDescriptor(voxel, basePlacement, object, entry, index),
    );
  });
  return placements;
}

function computeSegmentVisualAdjustments(voxel, smoothing, scale, object) {
  const direction = smoothing.direction ?? ZERO_OFFSET;
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (length === 0) {
    return { visualScale: cloneScale(scale), visualOffset: ZERO_OFFSET };
  }

  const unit = {
    x: direction.x / length,
    y: direction.y / length,
    z: direction.z / length,
  };

  const stepLength = Math.max(0, smoothing.stepLength ?? 0) * object.voxelScale;
  const overlapRatio = Math.max(0, smoothing.overlap ?? 0);
  const extendWorld = stepLength * overlapRatio;

  const startPadding = Math.max(0, smoothing.startPadding ?? 0) * object.voxelScale;
  const endPadding = Math.max(0, smoothing.endPadding ?? 0) * object.voxelScale;
  const distanceFromStart =
    Math.max(0, smoothing.distanceFromStart ?? 0) * object.voxelScale;
  const distanceFromEnd =
    Math.max(0, smoothing.distanceFromEnd ?? 0) * object.voxelScale;

  const startAllowance = distanceFromStart + startPadding;
  const endAllowance = distanceFromEnd + endPadding;
  const startBias = Math.max(0, startPadding - distanceFromStart);
  const endBias = Math.max(0, endPadding - distanceFromEnd);
  const halfExtend = extendWorld / 2;

  const computeExtend = (allowance, bias) => {
    if (allowance <= 0 && bias <= 0 && halfExtend <= 0) {
      return 0;
    }
    const desired = halfExtend + bias;
    if (desired <= 0) {
      return 0;
    }
    return Math.min(allowance, desired);
  };

  const backExtend = computeExtend(startAllowance, startBias);
  const forwardExtend = computeExtend(endAllowance, endBias);
  const actualExtend = backExtend + forwardExtend;

  const visualScale = cloneScale(scale);
  if (actualExtend > 0) {
    visualScale.x += Math.abs(unit.x) * actualExtend;
    visualScale.y += Math.abs(unit.y) * actualExtend;
    visualScale.z += Math.abs(unit.z) * actualExtend;
  }

  let visualOffset = ZERO_OFFSET;
  const offsetAlong = (forwardExtend - backExtend) / 2;
  if (offsetAlong !== 0) {
    visualOffset = {
      x: unit.x * offsetAlong,
      y: unit.y * offsetAlong,
      z: unit.z * offsetAlong,
    };
  }

  const embed = Math.max(0, smoothing.embed ?? 0) * object.voxelScale;
  if (embed > 0) {
    const startSpan = Math.max(stepLength + startPadding, stepLength || 1);
    const endSpan = Math.max(stepLength + endPadding, stepLength || 1);
    const startInfluence = clamp01(1 - distanceFromStart / startSpan);
    const endInfluence = clamp01(1 - distanceFromEnd / endSpan);
    const embedStrength = Math.max(startInfluence, endInfluence);
    if (embedStrength > 0) {
      const shrink = embed * embedStrength;
      visualScale.x = Math.max(0.01, visualScale.x - shrink);
      visualScale.y = Math.max(0.01, visualScale.y - shrink);
      visualScale.z = Math.max(0.01, visualScale.z - shrink);
      const embedBias = endInfluence - startInfluence;
      const embedOffset = embed * embedBias * 0.5;
      if (embedOffset !== 0) {
        const offsetDelta = {
          x: unit.x * embedOffset,
          y: unit.y * embedOffset,
          z: unit.z * embedOffset,
        };
        visualOffset = visualOffset === ZERO_OFFSET ? offsetDelta : addVectors(visualOffset, offsetDelta);
      }
    }
  }

  const decorativeLayers = Math.max(0, smoothing.featherLayers ?? 0);
  if (decorativeLayers > 0) {
    const shrinkFactor = Math.max(0.55, 1 - decorativeLayers * 0.08);
    visualScale.x *= shrinkFactor;
    visualScale.y *= shrinkFactor;
    visualScale.z *= shrinkFactor;
  }

  const jitterStrength = Math.max(0, smoothing.microJitter ?? 0);
  if (jitterStrength > 0) {
    const amplitude = jitterStrength * object.voxelScale * 0.35;
    const jitter = {
      x: seededRandomCentered(object.id ?? 'object', voxel.index ?? 0, 'segment-jx') * amplitude,
      y: seededRandomCentered(object.id ?? 'object', voxel.index ?? 0, 'segment-jy') * amplitude,
      z: seededRandomCentered(object.id ?? 'object', voxel.index ?? 0, 'segment-jz') * amplitude,
    };
    visualOffset = visualOffset === ZERO_OFFSET ? jitter : addVectors(visualOffset, jitter);
  }

  return { visualScale, visualOffset };
}

function computeVisualAdjustments(voxel, scale, object) {
  const smoothing = voxel?.metadata?.visual?.smoothing;
  if (!smoothing) {
    return { visualScale: cloneScale(scale), visualOffset: ZERO_OFFSET };
  }

  if (smoothing.type === 'node') {
    const inflate = Math.max(0, smoothing.inflate ?? 0) * object.voxelScale;
    const visualScale = cloneScale(scale);
    if (inflate > 0) {
      visualScale.x += inflate;
      visualScale.y += inflate;
      visualScale.z += inflate;
    }
    const embed = Math.max(0, smoothing.embed ?? 0) * object.voxelScale;
    if (embed > 0) {
      visualScale.x = Math.max(0.01, visualScale.x - embed);
      visualScale.y = Math.max(0.01, visualScale.y - embed);
      visualScale.z = Math.max(0.01, visualScale.z - embed);
    }
    const decorativeLayers = Math.max(0, smoothing.featherLayers ?? 0);
    if (decorativeLayers > 0) {
      const shrinkFactor = Math.max(0.5, 1 - decorativeLayers * 0.12);
      visualScale.x *= shrinkFactor;
      visualScale.y *= shrinkFactor;
      visualScale.z *= shrinkFactor;
    }
    let visualOffset = ZERO_OFFSET;
    const jitterStrength = Math.max(0, smoothing.microJitter ?? 0);
    if (jitterStrength > 0) {
      const amplitude = jitterStrength * object.voxelScale * 0.35;
      const jitter = {
        x: seededRandomCentered(object.id ?? 'object', voxel.index ?? 0, 'node-jx') * amplitude,
        y: seededRandomCentered(object.id ?? 'object', voxel.index ?? 0, 'node-jy') * amplitude,
        z: seededRandomCentered(object.id ?? 'object', voxel.index ?? 0, 'node-jz') * amplitude,
      };
      visualOffset = jitter;
    }
    return { visualScale, visualOffset };
  }

  if (smoothing.type === 'segment') {
    return computeSegmentVisualAdjustments(voxel, smoothing, scale, object);
  }

  return { visualScale: cloneScale(scale), visualOffset: ZERO_OFFSET };
}


function resolveCollisionMode(voxel, object) {
  if (voxel?.collisionMode) {
    return voxel.collisionMode;
  }
  if (typeof voxel?.isSolid === 'boolean') {
    return voxel.isSolid ? 'solid' : 'none';
  }
  const objectMode = object?.collision?.mode ?? 'auto';
  if (objectMode !== 'auto') {
    return objectMode;
  }
  return object.voxelScale < 1 ? 'none' : 'solid';
}

function computeSegmentFeatherPlacements(voxel, basePlacement, object, smoothing) {
  const layerCount = Math.max(0, smoothing.featherLayers ?? 0);
  if (layerCount === 0) {
    return [];
  }
  const frame = createLocalFrame(smoothing.direction ?? ZERO_OFFSET);
  if (!frame) {
    return [];
  }

  const baseOffset =
    basePlacement.visualOffset === ZERO_OFFSET
      ? ZERO_OFFSET
      : cloneOffset(basePlacement.visualOffset);
  const spacing = Math.max(0, smoothing.featherSpacing ?? 0.2) * object.voxelScale;
  const radius = Math.max(0, smoothing.featherRadius ?? 0.25) * object.voxelScale;
  const scaleFactor = Math.max(0, smoothing.featherScale ?? 0.1);
  const jitterStrength = Math.max(0, smoothing.microJitter ?? 0) * object.voxelScale * 0.45;
  const baseTint = basePlacement.tint;
  const accentTint = smoothing.featherTint ?? baseTint;

  const placements = [];
  for (let i = 1; i <= layerCount; i += 1) {
    const layerRatio = i / (layerCount + 1);
    const alongOffset = (i - (layerCount + 1) / 2) * spacing * 0.6;
    const swirlSeed = seededRandom(object.id ?? 'object', voxel.index ?? 0, i, 'segment-layer');
    const swirlAngle = (smoothing.progress ?? 0) * Math.PI * 2 + swirlSeed * Math.PI * 2;
    const radialAmount = radius * (0.65 + 0.35 * (1 - layerRatio));
    const radialOffset = addVectors(
      scaleVector(frame.right, Math.cos(swirlAngle) * radialAmount),
      scaleVector(frame.up, Math.sin(swirlAngle) * radialAmount),
    );
    const jitter = {
      x: seededRandomCentered(object.id ?? 'object', voxel.index ?? 0, i, 'segment-layer-jx') *
        jitterStrength,
      y: seededRandomCentered(object.id ?? 'object', voxel.index ?? 0, i, 'segment-layer-jy') *
        jitterStrength,
      z: seededRandomCentered(object.id ?? 'object', voxel.index ?? 0, i, 'segment-layer-jz') *
        jitterStrength,
    };
    const offset = addVectors(
      baseOffset,
      addVectors(scaleVector(frame.forward, alongOffset), addVectors(radialOffset, jitter)),
    );

    const scaleMultiplier = 1 + scaleFactor * (1 - layerRatio * 0.75);
    const visualScale = {
      x: basePlacement.visualScale.x * scaleMultiplier,
      y: basePlacement.visualScale.y * (1 + scaleFactor * (1 - layerRatio) * 0.5),
      z: basePlacement.visualScale.z * scaleMultiplier,
    };

    const tintMix = 0.35 + layerRatio * 0.35;
    const tint = blendTint(baseTint, accentTint, tintMix);

    placements.push({
      type: voxel.type,
      worldX: basePlacement.worldX,
      worldY: basePlacement.worldY,
      worldZ: basePlacement.worldZ,
      options: {
        scale: basePlacement.scale,
        visualScale,
        visualOffset: offset,
        tint,
        collisionMode: 'none',
        isSolid: false,
        destructible: basePlacement.destructible,
        sourceObjectId: object.id,
        voxelIndex: voxel.index,
        metadata: basePlacement.metadata,
        key: `${basePlacement.key}|layer-${i}`,
      },
    });
  }

  return placements;
}

function computeNodeFeatherPlacements(voxel, basePlacement, object, smoothing) {
  const layerCount = Math.max(0, smoothing.featherLayers ?? 0);
  if (layerCount === 0) {
    return [];
  }

  const baseOffset =
    basePlacement.visualOffset === ZERO_OFFSET
      ? ZERO_OFFSET
      : cloneOffset(basePlacement.visualOffset);
  const radius = Math.max(0, smoothing.featherRadius ?? 0.35) * object.voxelScale;
  const scaleFactor = Math.max(0, smoothing.featherScale ?? 0.2);
  const jitterStrength = Math.max(0, smoothing.microJitter ?? 0) * object.voxelScale * 0.5;
  const baseTint = basePlacement.tint;
  const accentTint = smoothing.featherTint ?? baseTint;

  const placements = [];
  for (let i = 1; i <= layerCount; i += 1) {
    const layerRatio = i / (layerCount + 1);
    const angle = seededRandom(object.id ?? 'object', voxel.index ?? 0, i, 'node-layer-angle') *
      Math.PI * 2;
    const verticalSwing = seededRandomCentered(
      object.id ?? 'object',
      voxel.index ?? 0,
      i,
      'node-layer-vertical',
    );
    const radialAmount = radius * layerRatio;
    const offset = {
      x: Math.cos(angle) * radialAmount,
      y: verticalSwing * radius * 0.4,
      z: Math.sin(angle) * radialAmount,
    };
    const jitter = {
      x: seededRandomCentered(object.id ?? 'object', voxel.index ?? 0, i, 'node-layer-jx') *
        jitterStrength,
      y: seededRandomCentered(object.id ?? 'object', voxel.index ?? 0, i, 'node-layer-jy') *
        jitterStrength,
      z: seededRandomCentered(object.id ?? 'object', voxel.index ?? 0, i, 'node-layer-jz') *
        jitterStrength,
    };
    const finalOffset = addVectors(baseOffset, addVectors(offset, jitter));

    const scaleMultiplier = 1 + scaleFactor * layerRatio;
    const visualScale = {
      x: basePlacement.visualScale.x * scaleMultiplier,
      y: basePlacement.visualScale.y * (1 + scaleFactor * layerRatio * 0.65),
      z: basePlacement.visualScale.z * scaleMultiplier,
    };

    const tintMix = 0.4 + layerRatio * 0.4;
    const tint = blendTint(baseTint, accentTint, tintMix);

    placements.push({
      type: voxel.type,
      worldX: basePlacement.worldX,
      worldY: basePlacement.worldY,
      worldZ: basePlacement.worldZ,
      options: {
        scale: basePlacement.scale,
        visualScale,
        visualOffset: finalOffset,
        tint,
        collisionMode: 'none',
        isSolid: false,
        destructible: basePlacement.destructible,
        sourceObjectId: object.id,
        voxelIndex: voxel.index,
        metadata: basePlacement.metadata,
        key: `${basePlacement.key}|petal-${i}`,
      },
    });
  }

  return placements;
}

function computeDecorativePlacements(voxel, basePlacement, object) {
  const smoothing = voxel?.metadata?.visual?.smoothing;
  if (!smoothing) {
    return [];
  }
  if (smoothing.type === 'segment') {
    return computeSegmentFeatherPlacements(voxel, basePlacement, object, smoothing);
  }
  if (smoothing.type === 'node') {
    return computeNodeFeatherPlacements(voxel, basePlacement, object, smoothing);
  }
  return [];
}

export function placeVoxelObject(addBlock, object, { origin, biome } = {}) {
  if (!object || typeof addBlock !== 'function') {
    return;
  }
  const base = origin ?? { x: 0, y: 0, z: 0 };
  const groundAnchorOffset = object.attachment?.groundOffset ?? object.voxelScale;
  const anchor = {
    x: base.x,
    y: base.y - groundAnchorOffset,
    z: base.z,
  };

  const voxels = resolveVoxelObjectVoxels(object);

  voxels.forEach((voxel) => {
    const scale = resolveScaleVector(voxel, object.voxelScale);
    const { visualScale, visualOffset } = computeVisualAdjustments(
      voxel,
      scale,
      object,
    );
    const worldX = anchor.x + voxel.position.x * object.voxelScale;
    const worldY = anchor.y + voxel.position.y * object.voxelScale + scale.y / 2;
    const worldZ = anchor.z + voxel.position.z * object.voxelScale;

    const collisionMode = resolveCollisionMode(voxel, object);
    const baseKey = `${object.id}|${voxel.index}|${worldX}|${worldY}|${worldZ}`;
    const basePlacement = {
      type: voxel.type,
      worldX,
      worldY,
      worldZ,
      scale,
      visualScale,
      visualOffset,
      tint: voxel.tint,
      destructible: voxel.destructible,
      metadata: voxel.metadata,
      collisionMode,
      key: baseKey,
    };

    addBlock(voxel.type, worldX, worldY, worldZ, biome, {
      scale,
      visualScale,
      visualOffset,
      collisionMode,
      isSolid: collisionMode === 'solid',

      destructible: voxel.destructible,
      tint: voxel.tint,
      sourceObjectId: object.id,
      voxelIndex: voxel.index,
      metadata: voxel.metadata,
      key: baseKey,
    });

    const decorativePlacements = computeDecorativePlacements(voxel, basePlacement, object);
    decorativePlacements.forEach((placement) => {
      addBlock(
        placement.type,
        placement.worldX,
        placement.worldY,
        placement.worldZ,
        biome,
        placement.options,
      );
    });

    const nanovoxelPlacements = computeNanovoxelPlacements(voxel, basePlacement, object);
    nanovoxelPlacements.forEach((placement) => {
      addBlock(
        placement.type,
        placement.worldX,
        placement.worldY,
        placement.worldZ,
        biome,
        placement.options,
      );
    });
  });
}

function selectObject(category, biome, randomSource, randomOffset) {
  const randomValue = randomSource(randomOffset);
  const object = getWeightedVoxelObject(category, biome, randomValue);
  if (!object) {
    return null;
  }
  if (!isVoxelObjectAllowedInBiome(object, biome)) {
    return null;
  }
  return object;
}

export function populateColumnWithVoxelObjects({
  addBlock,
  biome,
  columnSample,
  groundHeight,
  randomSource,
  slope = 0,
  worldX,
  worldZ,
  isUnderwater = false,
  isShore = false,
  waterLevel = 0,
  distanceToWater = Infinity,
}) {
  if (!biome) {
    return;
  }
  const random = ensureRandomSource(randomSource);
  const terrain = biome.terrain ?? {};

  const climate = columnSample?.climate ?? biome?.climate ?? {};
  const columnBaseOffset = {
    x: (random(7) - 0.5) * 0.8,
    z: (random(8) - 0.5) * 0.8,
  };
  const densityNoise = objectDensityField.noise(worldX * 0.11, worldZ * 0.11);
  const densityScale = 0.28 + densityNoise * 0.32;

  const canPlaceObject = (object) => {
    if (!object) {
      return false;
    }
    const placement = object.placement ?? {};
    if (placement.minSlope !== null && slope < placement.minSlope) {
      return false;
    }
    if (placement.maxSlope !== null && slope > placement.maxSlope) {
      return false;
    }
    if (placement.requiresUnderwater && !isUnderwater) {
      return false;
    }
    if (placement.forbidUnderwater && isUnderwater) {
      return false;
    }
    if (placement.onlyOnShore && !isShore) {
      return false;
    }
    if (placement.forbidShore && isShore) {
      return false;
    }
    if (
      typeof placement.minHeight === 'number' &&
      groundHeight < placement.minHeight
    ) {
      return false;
    }
    if (
      typeof placement.maxHeight === 'number' &&
      groundHeight > placement.maxHeight
    ) {
      return false;
    }
    if (
      typeof placement.minMoisture === 'number' &&
      climate.moisture < placement.minMoisture
    ) {
      return false;
    }
    if (
      typeof placement.maxMoisture === 'number' &&
      climate.moisture > placement.maxMoisture
    ) {
      return false;
    }
    if (
      typeof placement.minTemperature === 'number' &&
      climate.temperature < placement.minTemperature
    ) {
      return false;
    }
    if (
      typeof placement.maxTemperature === 'number' &&
      climate.temperature > placement.maxTemperature
    ) {
      return false;
    }
    if (placement.requiresWaterProximity) {
      const radius =
        typeof placement.waterProximityRadius === 'number'
          ? placement.waterProximityRadius
          : 1;
      if (distanceToWater > radius) {
        return false;
      }
    }
    return true;
  };

  let plannedStructurePlacements = 0;
  const applySectorPlacements = () => {
    const { placements } = getSectorPlacementsForColumn(worldX, worldZ);
    plannedStructurePlacements = placements.reduce((count, placement) => {
      return placement.category === 'structures' ? count + 1 : count;
    }, 0);
    placements.forEach((placement) => {
      if (placement.completed) {
        return;
      }
      if (placement.requireUnderwater && !isUnderwater) {
        markPlacementCompleted(placement);
        return;
      }
      if (!placement.allowUnderwater && isUnderwater) {
        markPlacementCompleted(placement);
        return;
      }
      if (placement.preferShore && distanceToWater > 3) {
        markPlacementCompleted(placement);
        return;
      }

      const object = selectObject(
        placement.category,
        biome,
        random,
        placement.randomSeed,
      );
      if (!object) {
        markPlacementCompleted(placement);
        return;
      }
      if (!canPlaceObject(object)) {
        markPlacementCompleted(placement);
        return;
      }

      const baseX = placement.anchor?.x ?? worldX;
      const baseZ = placement.anchor?.z ?? worldZ;
      const jitterRadius =
        placement.jitterRadius !== undefined && placement.jitterRadius !== null
          ? placement.jitterRadius
          : object.voxelScale < 1
          ? 0.5
          : 0.75;

      const placed = placeObject(object, placement.randomSeed, {
        baseX,
        baseZ,
        jitterRadius,
        instances: placement.instances,
        angleSeed: 320 + placement.randomSeed,
        radiusSeed: 420 + placement.randomSeed,
      });

      if (placed) {
        markPlacementCompleted(placement);
      }
    });
  };

  const placeObject = (object, seedOffset = 0, options = {}) => {
    if (!canPlaceObject(object)) {
      return false;
    }
    const placement = object.placement ?? {};
    const instancePreference =
      typeof options.instances === 'number'
        ? options.instances
        : placement.maxInstancesPerColumn || 1;
    const instances = Math.max(1, instancePreference);
    const jitterRadius =
      options.jitterRadius !== null && options.jitterRadius !== undefined
        ? options.jitterRadius
        : placement.jitterRadius !== null && placement.jitterRadius !== undefined
        ? placement.jitterRadius
        : object.voxelScale < 1
        ? 0.85
        : 0;
    const baseX =
      typeof options.baseX === 'number' ? options.baseX : worldX + columnBaseOffset.x;
    const baseZ =
      typeof options.baseZ === 'number' ? options.baseZ : worldZ + columnBaseOffset.z;
    const angleSeedOffset = options.angleSeed ?? 120 + seedOffset * 13;
    const radiusSeedOffset = options.radiusSeed ?? 220 + seedOffset * 17;
    for (let i = 0; i < instances; i++) {
      const angle =
        options.fixedAngle !== undefined
          ? options.fixedAngle
          : random(angleSeedOffset + i) * Math.PI * 2;
      const radius =
        options.fixedRadius !== undefined
          ? options.fixedRadius
          : jitterRadius > 0
          ? random(radiusSeedOffset + i) * jitterRadius
          : 0;
      const origin = {
        x: baseX + Math.cos(angle) * radius,
        y: groundHeight + (object.attachment?.groundOffset ?? object.voxelScale),
        z: baseZ + Math.sin(angle) * radius,
      };
      placeVoxelObject(addBlock, object, { origin, biome });
    }
    return true;
  };

  applySectorPlacements();

  const attemptCategory = (
    category,
    chance,
    randomOffset,
    { allowUnderwater = false, requireUnderwater = false } = {},
  ) => {
    if (chance <= 0) {
      return false;
    }
    if (requireUnderwater && !isUnderwater) {
      return false;
    }
    if (!allowUnderwater && isUnderwater) {
      return false;
    }
    const roll = random(randomOffset);
    if (roll <= 1 - chance) {
      return false;
    }
    const object = selectObject(category, biome, random, randomOffset + 11);
    return placeObject(object, randomOffset);
  };

  const treeDensity = Math.max(0, terrain.treeDensity ?? 0) * densityScale;
  if (treeDensity > 0 && !isUnderwater) {
    const roll = random(31);
    if (roll > 1 - treeDensity) {
      const tree = selectObject('large-plants', biome, random, 41);
      placeObject(tree, 31);
    }
  }

  const shrubChance = Math.max(0, terrain.shrubChance ?? 0) * densityScale;
  if (shrubChance > 0 && !isUnderwater) {
    const roll = random(51);
    if (roll > 1 - shrubChance) {
      const shrub = selectObject('small-plants', biome, random, 61);
      placeObject(shrub, 51);
    }
  }

  const flowerChanceRaw = terrain.flowerChance ?? shrubChance * 0.65;
  const flowerChance = Math.max(0, Math.min(1, flowerChanceRaw || 0));
  if (flowerChance > 0 && !isUnderwater) {
    const roll = random(71);
    if (roll > 1 - flowerChance) {
      const flower = selectObject('flowers', biome, random, 81);
      placeObject(flower, 71);
    }
  }

  attemptCategory(
    'rocks',
    Math.max(0, terrain.rockChance ?? 0) * densityScale,
    91,
    {
      allowUnderwater: false,
    },
  );

  attemptCategory('fungi', Math.max(0, terrain.fungiChance ?? 0) * densityScale, 111, {
    allowUnderwater: false,
  });

  attemptCategory(
    'water-plants',
    Math.max(0, terrain.waterPlantChance ?? 0),
    131,
    { allowUnderwater: true, requireUnderwater: true },
  );

  const structureChanceRaw = Math.max(0, terrain.structureChance ?? 0);
  const structureChance = Math.min(1, structureChanceRaw) * densityScale;
  const adjustedStructureChance =
    plannedStructurePlacements > 0 ? structureChance * 0.1 : structureChance;
  if (adjustedStructureChance > 0) {
    attemptCategory('structures', adjustedStructureChance, 151, {
      allowUnderwater: true,
    });
  }
}


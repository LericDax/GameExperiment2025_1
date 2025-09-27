import { resolveVoxelObjectVoxels } from './voxel-object-processor.js';
import { getNanovoxelDefinition } from './procedural/nanovoxel-palette.js';

export const ZERO_OFFSET = { x: 0, y: 0, z: 0 };

export function cloneScale(scale = { x: 1, y: 1, z: 1 }) {
  return { x: scale.x, y: scale.y, z: scale.z };
}

export function cloneOffset(offset = ZERO_OFFSET) {
  if (offset === ZERO_OFFSET) {
    return ZERO_OFFSET;
  }
  return { x: offset.x, y: offset.y, z: offset.z };
}

export function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function seededRandom(...components) {
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

export function seededRandomCentered(...components) {
  return seededRandom(...components) * 2 - 1;
}

export function resolveScaleVector({ size = {} } = {}, voxelScale = 1) {
  return {
    x: (size.x ?? 1) * voxelScale,
    y: (size.y ?? 1) * voxelScale,
    z: (size.z ?? 1) * voxelScale,
  };
}

export function normalizeVector(vector = ZERO_OFFSET) {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length === 0) {
    return null;
  }
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

export function crossVectors(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function scaleVector(vector, amount) {
  return { x: vector.x * amount, y: vector.y * amount, z: vector.z * amount };
}

export function addVectors(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function createLocalFrame(direction, customUpHint = null) {
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

const DEFAULT_FRAME = {
  forward: { x: 0, y: 1, z: 0 },
  right: { x: 1, y: 0, z: 0 },
  up: { x: 0, y: 0, z: 1 },
};

export function ensureFrame(direction, upHint) {
  return createLocalFrame(direction, upHint) ?? DEFAULT_FRAME;
}

export function convertLocalToWorld(frame, local, voxelScale) {
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
  const clampComponent = (component) =>
    Math.max(0, Math.min(255, Math.round(component))).toString(16).padStart(2, '0');
  return `#${clampComponent(r)}${clampComponent(g)}${clampComponent(b)}`;
}

export function blendTint(baseHex, accentHex, mix) {
  const mixValue = clamp01(mix);
  const base = parseHexColor(baseHex) ?? { r: 255, g: 255, b: 255 };
  const accent = parseHexColor(accentHex) ?? { r: 255, g: 255, b: 255 };
  return colorToHex({
    r: base.r + (accent.r - base.r) * mixValue,
    g: base.g + (accent.g - base.g) * mixValue,
    b: base.b + (accent.b - base.b) * mixValue,
  });
}

export function resolveNanovoxelTint(definition, entry, element, baseTint) {
  const allowInherit =
    (definition.inheritTint ?? true) && entry.inheritTint !== false && element.inheritTint !== false;
  const inheritStrength = allowInherit
    ? element.inheritTintStrength ?? entry.inheritTintStrength ?? definition.inheritTintStrength ?? 0.35
    : 0;

  let tint = element.tint ?? entry.tint ?? definition.defaultTint ?? baseTint ?? '#ffffff';

  if (allowInherit && baseTint && inheritStrength > 0) {
    tint = blendTint(tint, baseTint, clamp01(inheritStrength));
  }

  const accentTint = element.accentTint ?? entry.accentTint ?? definition.accentTint ?? null;
  const accentStrength = element.accentStrength ?? entry.accentStrength ?? definition.accentStrength ?? 0;
  if (accentTint && accentStrength > 0) {
    tint = blendTint(tint, accentTint, clamp01(accentStrength));
  }

  return tint;
}

export function computeNanovoxelPlacementsForDescriptor(
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
        distribution === 'line' && count > 1
          ? copyIndex / (count - 1)
          : count <= 1
          ? 0
          : copyIndex / count;

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

export function computeNanovoxelPlacements(voxel, basePlacement, object) {
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

export function computeSegmentVisualAdjustments(voxel, smoothing, scale, object) {
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
  const distanceFromStart = Math.max(0, smoothing.distanceFromStart ?? 0) * object.voxelScale;
  const distanceFromEnd = Math.max(0, smoothing.distanceFromEnd ?? 0) * object.voxelScale;

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
        visualOffset =
          visualOffset === ZERO_OFFSET ? offsetDelta : addVectors(visualOffset, offsetDelta);
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

export function computeSegmentFeatherPlacements(voxel, basePlacement, object, smoothing) {
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
      x:
        seededRandomCentered(object.id ?? 'object', voxel.index ?? 0, i, 'segment-layer-jx') *
        jitterStrength,
      y:
        seededRandomCentered(object.id ?? 'object', voxel.index ?? 0, i, 'segment-layer-jy') *
        jitterStrength,
      z:
        seededRandomCentered(object.id ?? 'object', voxel.index ?? 0, i, 'segment-layer-jz') *
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

export function computeNodeFeatherPlacements(voxel, basePlacement, object, smoothing) {
  const layerCount = Math.max(0, smoothing.featherLayers ?? 0);
  if (layerCount === 0) {
    return [];
  }
  const radius = Math.max(0, smoothing.featherRadius ?? 0.25) * object.voxelScale;
  const scaleFactor = Math.max(0, smoothing.featherScale ?? 0.1);
  const jitterStrength = Math.max(0, smoothing.microJitter ?? 0) * object.voxelScale * 0.45;
  const baseTint = basePlacement.tint;
  const accentTint = smoothing.featherTint ?? baseTint;

  const placements = [];
  for (let i = 1; i <= layerCount; i += 1) {
    const layerRatio = i / (layerCount + 1);
    const theta =
      seededRandom(object.id ?? 'object', voxel.index ?? 0, i, 'node-layer-theta') * Math.PI * 2;
    const phi =
      seededRandom(object.id ?? 'object', voxel.index ?? 0, i, 'node-layer-phi') * Math.PI;
    const radialAmount = radius * (0.6 + 0.4 * (1 - layerRatio));
    const offset = {
      x: Math.cos(theta) * Math.sin(phi) * radialAmount,
      y: Math.sin(theta) * Math.sin(phi) * radialAmount,
      z: Math.cos(phi) * radialAmount,
    };
    if (jitterStrength > 0) {
      offset.x +=
        seededRandomCentered(object.id ?? 'object', voxel.index ?? 0, i, 'node-layer-jx') *
        jitterStrength;
      offset.y +=
        seededRandomCentered(object.id ?? 'object', voxel.index ?? 0, i, 'node-layer-jy') *
        jitterStrength;
      offset.z +=
        seededRandomCentered(object.id ?? 'object', voxel.index ?? 0, i, 'node-layer-jz') *
        jitterStrength;
    }
    const finalOffset = addVectors(basePlacement.visualOffset, offset);

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

export function computeDecorativePlacements(voxel, basePlacement, object) {
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

export function computeVisualAdjustments(voxel, scale, object) {
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

export function resolveCollisionMode(voxel, object) {
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

function clonePlacementOptions(options = {}) {
  const cloned = { ...options };
  if (options.scale) {
    cloned.scale = { ...options.scale };
  }
  if (options.visualScale) {
    cloned.visualScale = { ...options.visualScale };
  }
  if (options.visualOffset) {
    cloned.visualOffset = { ...options.visualOffset };
  }
  return cloned;
}

export function computeVoxelObjectPlacements(object) {
  if (!object) {
    return null;
  }

  const voxels = resolveVoxelObjectVoxels(object);
  if (!voxels || voxels.length === 0) {
    return null;
  }

  const blocks = [];
  const decorations = [];
  const groundOffset = object.attachment?.groundOffset ?? object.voxelScale;

  voxels.forEach((voxel) => {
    const scale = resolveScaleVector(voxel, object.voxelScale);
    const { visualScale, visualOffset } = computeVisualAdjustments(voxel, scale, object);
    const localPosition = {
      x: voxel.position.x * object.voxelScale,
      y: voxel.position.y * object.voxelScale + scale.y / 2,
      z: voxel.position.z * object.voxelScale,
    };

    const collisionMode = resolveCollisionMode(voxel, object);
    const baseKey = `${object.id ?? 'object'}|${voxel.index}`;

    const blockEntry = {
      type: voxel.type,
      position: localPosition,
      scale: cloneScale(scale),
      visualScale: cloneScale(visualScale),
      visualOffset: cloneOffset(visualOffset),
      tint: voxel.tint ?? null,
      destructible: voxel.destructible,
      metadata: voxel.metadata ?? null,
      collisionMode,
      voxelIndex: voxel.index,
      key: baseKey,
      sourceObjectId: object.id ?? null,
    };
    blocks.push(blockEntry);

    const basePlacement = {
      type: voxel.type,
      worldX: localPosition.x,
      worldY: localPosition.y,
      worldZ: localPosition.z,
      scale: cloneScale(scale),
      visualScale: cloneScale(visualScale),
      visualOffset: cloneOffset(visualOffset),
      tint: voxel.tint,
      destructible: voxel.destructible,
      metadata: voxel.metadata,
      collisionMode,
      key: baseKey,
    };

    const decorativePlacements = computeDecorativePlacements(voxel, basePlacement, object);
    decorativePlacements.forEach((placement) => {
      decorations.push({
        type: placement.type,
        position: {
          x: placement.worldX,
          y: placement.worldY,
          z: placement.worldZ,
        },
        options: clonePlacementOptions(placement.options),
      });
    });

    const nanovoxelPlacements = computeNanovoxelPlacements(voxel, basePlacement, object);
    nanovoxelPlacements.forEach((placement) => {
      decorations.push({
        type: placement.type,
        position: {
          x: placement.worldX,
          y: placement.worldY,
          z: placement.worldZ,
        },
        options: clonePlacementOptions(placement.options),
      });
    });
  });

  return {
    blocks,
    decorations,
    groundOffset,
    id: object.id ?? null,
  };
}

const prototypeCache = new Map();

export function clearVoxelObjectPrototypeCache() {
  prototypeCache.clear();
}

export function buildVoxelObjectPrototype(object) {
  if (object?.destructionMode === 'per-voxel') {
    return null;
  }
  const placements = computeVoxelObjectPlacements(object);
  if (!placements) {
    return null;
  }
  const hasContent = (placements.blocks?.length ?? 0) + (placements.decorations?.length ?? 0) > 0;
  if (!hasContent) {
    return null;
  }
  return {
    id: placements.id,
    groundOffset: placements.groundOffset,
    blocks: placements.blocks,
    decorations: placements.decorations,
  };
}

export function getVoxelObjectPrototype(object) {
  if (!object) {
    return null;
  }
  if (object.destructionMode === 'per-voxel') {
    return null;
  }
  const cacheKey = object.id;
  if (!cacheKey) {
    return buildVoxelObjectPrototype(object);
  }
  if (prototypeCache.has(cacheKey)) {
    return prototypeCache.get(cacheKey);
  }
  const prototype = buildVoxelObjectPrototype(object);
  if (prototype) {
    prototypeCache.set(cacheKey, prototype);
  }
  return prototype;
}


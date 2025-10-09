import { ValueNoise2D } from "./noise.js";
import { createBiomeEngine } from "./biome-engine.js";
import { defaultWorldOptions } from "./world-settings.js";

export function createTerrainEngine({
  THREE,
  seed = defaultWorldOptions.seedHash,
  worldConfig = {},
} = {}) {
  if (!THREE) {
    throw new Error("createTerrainEngine requires a THREE instance");
  }

  const defaults = defaultWorldOptions.terrain;
  const terrainConfig = worldConfig.terrain ?? {};

  const baseHeight = Number.isFinite(worldConfig.baseHeight)
    ? worldConfig.baseHeight
    : Number.isFinite(terrainConfig.baseHeight)
      ? terrainConfig.baseHeight
      : defaults.baseHeight;

  const maxHeight = Number.isFinite(worldConfig.maxHeight)
    ? worldConfig.maxHeight
    : Number.isFinite(terrainConfig.maxHeight)
      ? terrainConfig.maxHeight
      : defaults.maxHeight;

  const clampMin = Number.isFinite(terrainConfig?.clamp?.min)
    ? terrainConfig.clamp.min
    : defaults.clamp?.min;
  const clampMax = Number.isFinite(terrainConfig?.clamp?.max)
    ? terrainConfig.clamp.max
    : defaults.clamp?.max;

  const config = {
    baseHeight,
    maxHeight,
    primaryFrequency: Number.isFinite(terrainConfig.primaryFrequency)
      ? terrainConfig.primaryFrequency
      : defaults.primaryFrequency,
    primaryAmplitude: Number.isFinite(terrainConfig.primaryAmplitude)
      ? terrainConfig.primaryAmplitude
      : defaults.primaryAmplitude,
    primaryOffset: Number.isFinite(terrainConfig.primaryOffset)
      ? terrainConfig.primaryOffset
      : defaults.primaryOffset,
    detailFrequency: Number.isFinite(terrainConfig.detailFrequency)
      ? terrainConfig.detailFrequency
      : defaults.detailFrequency,
    detailAmplitude: Number.isFinite(terrainConfig.detailAmplitude)
      ? terrainConfig.detailAmplitude
      : defaults.detailAmplitude,
    detailOffset: Number.isFinite(terrainConfig.detailOffset)
      ? terrainConfig.detailOffset
      : defaults.detailOffset,
    ridgeFrequency: Number.isFinite(terrainConfig.ridgeFrequency)
      ? terrainConfig.ridgeFrequency
      : defaults.ridgeFrequency,
    ridgeStrength: Number.isFinite(terrainConfig.ridgeStrength)
      ? terrainConfig.ridgeStrength
      : defaults.ridgeStrength,
    ridgeOffset: Number.isFinite(terrainConfig.ridgeOffset)
      ? terrainConfig.ridgeOffset
      : defaults.ridgeOffset,
    climateHeightInfluence: Number.isFinite(
      terrainConfig.climateHeightInfluence,
    )
      ? terrainConfig.climateHeightInfluence
      : defaults.climateHeightInfluence,
    clampMin,
    clampMax,
  };

  if (Number.isFinite(config.clampMin) && Number.isFinite(config.clampMax)) {
    if (config.clampMin > config.clampMax) {
      const midpoint = (config.clampMin + config.clampMax) / 2;
      config.clampMin = midpoint;
      config.clampMax = midpoint;
    }
  }

  const fmDefaults = defaults.fm ?? {};
  const fmOverrides = isObject(terrainConfig.fm) ? terrainConfig.fm : {};

  const fmConfig = {
    base: getNumber(fmOverrides.base, fmDefaults.base, 1),
    min: getNumber(fmOverrides.min, fmDefaults.min, 0.25),
    max: getNumber(fmOverrides.max, fmDefaults.max, 2),
    slopeWeight: getNumber(fmOverrides.slopeWeight, fmDefaults.slopeWeight, 0),
    altitudeWeight: getNumber(
      fmOverrides.altitudeWeight,
      fmDefaults.altitudeWeight,
      0,
    ),
    biomeBlendStrength: clamp01(
      getNumber(
        fmOverrides.biomeBlendStrength,
        fmDefaults.biomeBlendStrength,
        0.5,
      ),
    ),
  };

  if (Number.isFinite(fmConfig.min) && Number.isFinite(fmConfig.max)) {
    if (fmConfig.min > fmConfig.max) {
      const midpoint = (fmConfig.min + fmConfig.max) / 2;
      fmConfig.min = midpoint;
      fmConfig.max = midpoint;
    }
  }

  const operatorDefaults = Array.isArray(fmDefaults.operators)
    ? fmDefaults.operators
    : [];
  const operatorOverrides = Array.isArray(fmOverrides.operators)
    ? fmOverrides.operators
    : null;
  const operatorCount = Math.max(
    6,
    operatorDefaults.length,
    operatorOverrides?.length ?? 0,
  );

  const fmOperators = new Array(operatorCount).fill(null).map((_, index) => {
    const fallback =
      operatorDefaults[index] ??
      (operatorDefaults.length > 0
        ? operatorDefaults[operatorDefaults.length - 1]
        : null);
    const override = isObject(operatorOverrides?.[index])
      ? operatorOverrides[index]
      : null;

    const id =
      typeof override?.id === "string"
        ? override.id
        : typeof fallback?.id === "string"
          ? fallback.id
          : `op${index + 1}`;
    const ratio = getNumber(override?.ratio, fallback?.ratio, 1);
    const detuneX = getNumber(override?.detuneX, fallback?.detuneX, 0);
    const detuneZ = getNumber(override?.detuneZ, fallback?.detuneZ, 0);
    const amplitude = getNumber(override?.amplitude, fallback?.amplitude, 0);
    const bias = getNumber(override?.bias, fallback?.bias, 0);
    const bus = getNumber(override?.bus, fallback?.bus, 0);
    const slope = getNumber(override?.slope, fallback?.slope, 0);
    const altitude = getNumber(override?.altitude, fallback?.altitude, 0);
    const modulationDepth = getNumber(
      override?.modulationDepth,
      fallback?.modulationDepth,
      1,
    );

    const fallbackTargets = Array.isArray(fallback?.targets)
      ? fallback.targets
      : [];
    const targetsSource = Array.isArray(override?.targets)
      ? override.targets
      : fallbackTargets;

    const targets = targetsSource
      .map((target, targetIndex) => {
        if (!isObject(target)) {
          return null;
        }
        const fallbackTarget = fallbackTargets[targetIndex] ?? null;
        const targetIndexValue = getNumber(
          target.index,
          fallbackTarget?.index,
          null,
        );
        if (!Number.isFinite(targetIndexValue)) {
          return null;
        }
        const normalizedIndex = Math.max(
          0,
          Math.min(operatorCount - 1, Math.floor(targetIndexValue)),
        );
        if (normalizedIndex === index) {
          return null;
        }
        const depthValue = getNumber(target.depth, fallbackTarget?.depth, 0);
        const modeValue =
          target.mode === "amplitude"
            ? "amplitude"
            : fallbackTarget?.mode === "amplitude"
              ? "amplitude"
              : "frequency";
        return {
          index: normalizedIndex,
          depth: depthValue * modulationDepth,
          mode: modeValue,
        };
      })
      .filter(Boolean);

    return {
      id,
      ratio,
      detuneX,
      detuneZ,
      amplitude,
      bias,
      bus,
      slope,
      altitude,
      modulationDepth,
      targets,
      incoming: [],
      noise: new ValueNoise2D(seed * 7.91 + index * 53.17 + 137),
      baseFrequency: 0,
    };
  });

  fmOperators.forEach((operator, index) => {
    const absoluteRatio = Math.max(0.0001, Math.abs(operator.ratio));
    operator.baseFrequency = Math.max(
      0.0001,
      config.primaryFrequency * absoluteRatio,
    );
    operator.incoming.length = 0;
    operator.targets.forEach((target) => {
      if (target.index > index && target.index < fmOperators.length) {
        fmOperators[target.index].incoming.push({
          index,
          depth: target.depth,
          mode: target.mode,
        });
      }
    });
  });

  const fmOutputBuffer = new Float32Array(fmOperators.length);

  const elevationNoise = new ValueNoise2D(seed * 1.11 + 67);
  const detailNoise = new ValueNoise2D(seed * 1.59 + 139);
  const ridgeNoise = new ValueNoise2D(seed * 2.03 + 211);

  const biomeEngine = createBiomeEngine({
    THREE,
    seed: seed * 1.37 + 19,
    biomeOptions: worldConfig.biomes,
  });

  const slopeSampleDistance = 0.75;
  const slopeNormalization = Math.max(1, config.maxHeight - config.baseHeight);
  const altitudeNormalization = Math.max(
    1,
    config.maxHeight - config.baseHeight,
  );

  function computeBaseElevation(x, z) {
    const n1 = elevationNoise.noise(
      x * config.primaryFrequency + config.primaryOffset,
      z * config.primaryFrequency + config.primaryOffset,
    );
    const n2 = detailNoise.noise(
      x * config.detailFrequency + config.detailOffset,
      z * config.detailFrequency + config.detailOffset,
    );
    const ridges = ridgeNoise.noise(
      x * config.ridgeFrequency + config.ridgeOffset,
      z * config.ridgeFrequency + config.ridgeOffset,
    );
    const ridgeInfluence = (ridges - 0.5) * config.ridgeStrength;
    return (
      config.baseHeight +
      n1 * config.primaryAmplitude +
      n2 * config.detailAmplitude +
      ridgeInfluence
    );
  }

  function estimateSlope(x, z) {
    const hX1 = computeBaseElevation(x + slopeSampleDistance, z);
    const hX2 = computeBaseElevation(x - slopeSampleDistance, z);
    const hZ1 = computeBaseElevation(x, z + slopeSampleDistance);
    const hZ2 = computeBaseElevation(x, z - slopeSampleDistance);
    const dx = hX1 - hX2;
    const dz = hZ1 - hZ2;
    const gradient = Math.sqrt(dx * dx + dz * dz);
    return clamp01(gradient / slopeNormalization);
  }

  function normalizeAltitude(height) {
    return clamp01((height - config.baseHeight) / altitudeNormalization);
  }

  function evaluateFmAttenuation(x, z, slope, altitude, biomeProfile = null) {
    if (fmOperators.length === 0) {
      return clampValue(fmConfig.base, fmConfig.min, fmConfig.max);
    }

    fmOutputBuffer.fill(0);

    const profile = isObject(biomeProfile) ? biomeProfile : null;
    const blendStrength = clamp01(
      Number.isFinite(profile?.blendStrength)
        ? profile.blendStrength
        : fmConfig.biomeBlendStrength,
    );
    const biomeWeights = Array.isArray(profile?.operatorWeights)
      ? profile.operatorWeights
      : null;
    const slopeWeight = Number.isFinite(profile?.slopeWeight)
      ? profile.slopeWeight
      : fmConfig.slopeWeight;
    const altitudeWeight = Number.isFinite(profile?.altitudeWeight)
      ? profile.altitudeWeight
      : fmConfig.altitudeWeight;
    const baseShift = Number.isFinite(profile?.baseShift)
      ? profile.baseShift
      : 0;
    const minAttenuation = Number.isFinite(profile?.min)
      ? profile.min
      : fmConfig.min;
    const maxAttenuation = Number.isFinite(profile?.max)
      ? profile.max
      : fmConfig.max;

    let busSum = 0;

    for (let index = 0; index < fmOperators.length; index += 1) {
      const operator = fmOperators[index];
      const operatorWeight = computeOperatorWeight(
        index,
        biomeWeights,
        blendStrength,
      );
      let frequency = Math.max(0.0001, operator.baseFrequency);
      let amplitude = operator.amplitude * operatorWeight;
      const bias = operator.bias;
      const incoming = operator.incoming;

      for (
        let incomingIndex = 0;
        incomingIndex < incoming.length;
        incomingIndex += 1
      ) {
        const link = incoming[incomingIndex];
        const modValue = fmOutputBuffer[link.index];
        const scaledDepth = link.depth * operatorWeight;
        if (link.mode === "amplitude") {
          amplitude += modValue * scaledDepth;
        } else {
          frequency += modValue * scaledDepth;
        }
      }

      frequency = Math.max(0.0001, frequency);

      const slopeEnvelope = 1 + slope * operator.slope;
      const altitudeEnvelope = 1 + altitude * operator.altitude;
      const operatorEnvelope = slopeEnvelope * altitudeEnvelope;

      const noiseSample =
        operator.noise.noise(
          x * frequency + operator.detuneX,
          z * frequency + operator.detuneZ,
        ) *
          2 -
        1;

      const output = (noiseSample + bias) * amplitude * operatorEnvelope;
      fmOutputBuffer[index] = output;
      busSum += output * operator.bus * operatorWeight;
    }

    const slopeEnvelope = 1 + slope * slopeWeight;
    const altitudeEnvelope = 1 + altitude * altitudeWeight;
    const combinedEnvelope = slopeEnvelope * altitudeEnvelope;

    const attenuation = fmConfig.base + baseShift + busSum * combinedEnvelope;
    return clampValue(attenuation, minAttenuation, maxAttenuation);
  }

  function computeAttenuatedHeight(x, z, biomeSample) {
    const baseElevation = computeBaseElevation(x, z);
    const slope = estimateSlope(x, z);
    const altitude = normalizeAltitude(baseElevation);
    const biomeProfile = biomeSample?.biome?.terrain?.fmProfile ?? null;
    const attenuation = evaluateFmAttenuation(
      x,
      z,
      slope,
      altitude,
      biomeProfile,
    );
    const attenuated = baseElevation * attenuation;
    return clampValue(attenuated, config.clampMin, config.clampMax);
  }

  function sampleColumn(x, z) {
    const biomeSample = biomeEngine.getBiomeAt(x, z);
    let height = computeAttenuatedHeight(x, z, biomeSample);
    const climateAdjustment =
      (biomeSample.climate.moisture - 0.5) * config.climateHeightInfluence;
    height += climateAdjustment + (biomeSample.biome.terrain.heightOffset ?? 0);
    height = clampValue(height, config.clampMin, config.clampMax);
    height = Math.min(height, config.maxHeight);
    return {
      ...biomeSample,
      height,
    };
  }

  return {
    sampleColumn,
    getBiomeAt: (x, z) => biomeEngine.getBiomeAt(x, z),
    getBlockColor: (biome, type) => biomeEngine.getBlockColor(biome, type),
    getDefaultBlockColor: () => biomeEngine.getDefaultBlockColor(),
    biomeEngine,
    dispose() {
      biomeEngine.dispose?.();
    },
  };
}

function isObject(value) {
  return value !== null && typeof value === "object";
}

function getNumber(value, fallback, defaultValue) {
  if (Number.isFinite(value)) {
    return value;
  }
  if (Number.isFinite(fallback)) {
    return fallback;
  }
  return defaultValue;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function clampValue(value, min, max) {
  let result = value;
  if (Number.isFinite(min)) {
    result = Math.max(min, result);
  }
  if (Number.isFinite(max)) {
    result = Math.min(max, result);
  }
  return result;
}

function computeOperatorWeight(index, weights, blendStrength) {
  if (!weights || weights.length === 0) {
    return 1;
  }

  const target = Number.isFinite(weights[index]) ? weights[index] : 1;
  return 1 - blendStrength + blendStrength * target;
}

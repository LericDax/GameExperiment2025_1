import { renderAsciiViewport } from '../devtools/ascii-viewport.js';
import { createHeadlessScanner } from '../devtools/headless-scanner.js';
import {
  sampleBiomeAt,
  terrainHeight,
  getWorldOptions,
  getRegisteredBiomes,
  sampleBiomeCoverage,
} from '../world/generation.js';

const worldConfig = getWorldOptions();

export function registerDeveloperCommands({
  commandConsole,
  playerControls,
  chunkManager,
  scene,
  THREE,
  registerDiagnosticOverlay,
  particleSystem = null,
  weatherManager = null,
}) {
  if (!commandConsole) {
    throw new Error('registerDeveloperCommands requires a commandConsole instance.');
  }
  if (!playerControls) {
    throw new Error('registerDeveloperCommands requires playerControls.');
  }
  if (!chunkManager) {
    throw new Error('registerDeveloperCommands requires a chunkManager instance.');
  }
  if (!scene) {
    throw new Error('registerDeveloperCommands requires the active scene.');
  }
  if (!THREE) {
    throw new Error('registerDeveloperCommands requires the THREE module.');
  }

  const { registerCommand } = commandConsole;

  const asciiState = {
    options: {
      radius: 16,
      lowerOffset: -1,
      upperOffset: 1,
    },
    watch: {
      mode: 'off',
      defaultMode: 'interval',
      intervalMs: 1000,
      activeIntervalMs: 1000,
      rafId: null,
      intervalId: null,
    },
    lastErrorMessage: null,
  };

  const headlessScanner = createHeadlessScanner({ THREE, scene, chunkManager });
  const scanEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const scanDirection = new THREE.Vector3(0, 0, -1);
  const scanOrigin = new THREE.Vector3();
  const DEFAULT_SCAN_DISTANCE = 12;
  const scanWatchState = {
    disposer: null,
    options: null,
    lastKey: null,
  };

  const vfxOverlayState = {
    disposer: null,
    helpers: new Map(),
    group: null,
    element: null,
  };

  const weatherControlState = {
    suppressed: false,
    lastManualWeatherId: null,
    lastSuppressedWeatherId: null,
  };

  const biomeTeleportOffsets = [
    { dx: 0, dz: 0 },
    { dx: 1, dz: 0 },
    { dx: -1, dz: 0 },
    { dx: 0, dz: 1 },
    { dx: 0, dz: -1 },
    { dx: 1, dz: 1 },
    { dx: 1, dz: -1 },
    { dx: -1, dz: 1 },
    { dx: -1, dz: -1 },
  ];

  const biomeAltitudeOffsets = [2.25, 5.25];

  function normalizeBiomeKey(value) {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[\s_-]+/g, '_');
  }

  function resolveWaterLevel() {
    if (Number.isFinite(worldConfig?.waterLevel)) {
      return worldConfig.waterLevel;
    }
    if (worldConfig?.water && Number.isFinite(worldConfig.water.level)) {
      return worldConfig.water.level;
    }
    return 0;
  }

  const normalizeWeatherKey = (value) => normalizeBiomeKey(value);

  const describeWeather = (weather) => {
    if (!weather) {
      return 'Unknown weather preset';
    }
    const label = weather.label ?? weather.id ?? 'Unknown weather preset';
    const intensity = Number.isFinite(weather.intensity)
      ? weather.intensity.toFixed(2)
      : 'n/a';
    return `${label} [${weather.id}] (intensity ${intensity})`;
  };

  const applyWeatherPreset = (weatherId) => {
    if (!weatherManager || typeof weatherManager.setWeather !== 'function') {
      return null;
    }
    if (!weatherId) {
      return weatherManager.getCurrentWeather?.() ?? null;
    }
    const next = weatherManager.setWeather(weatherId);
    if (!next || next.id !== weatherId) {
      return null;
    }
    return next;
  };

  function attemptTeleportToBiomeColumn(baseX, baseZ) {
    const waterLevel = resolveWaterLevel();
    for (const offset of biomeTeleportOffsets) {
      const columnX = baseX + offset.dx;
      const columnZ = baseZ + offset.dz;
      const surfaceHeight = terrainHeight(columnX, columnZ);
      if (!Number.isFinite(surfaceHeight)) {
        continue;
      }
      const baseHeight = Math.max(surfaceHeight, waterLevel);
      for (const altitude of biomeAltitudeOffsets) {
        const target = {
          x: columnX + 0.5,
          y: baseHeight + altitude,
          z: columnZ + 0.5,
        };
        const moved = playerControls.setPosition(target);
        if (moved) {
          const position = playerControls.getPosition();
          return { position, column: { x: columnX, z: columnZ } };
        }
      }
    }
    return null;
  }

  const getTimestamp = () =>
    typeof performance !== 'undefined' && performance.now
      ? performance.now()
      : Date.now();

  const yieldToEventLoop = () =>
    new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

  async function findNearestBiomeColumn({
    biomeId,
    originX = 0,
    originZ = 0,
    maxRadius: requestedMaxRadius = null,
    samplesPerYield = 4096,
    timeBudgetMs = 10,
    onRingComplete = null,
    onYield = null,
    onLimitReached = null,
  }) {
    if (!biomeId) {
      return null;
    }
    const targetId = String(biomeId);
    const chunkSize = Number.isFinite(worldConfig?.chunkSize)
      ? worldConfig.chunkSize
      : Number.isFinite(worldConfig?.chunk?.size)
      ? worldConfig.chunk.size
      : 32;
    const step = Math.max(2, Math.round(chunkSize / 4));
    const halfStep = Math.floor(step / 2);
    const localOffsets =
      step > 1
        ? Array.from({ length: step }, (_, index) => index - halfStep)
        : [0];
    const defaultMaxRadius = Math.max(chunkSize * 24, 1024);
    const resolvedMaxRadius = Number.isFinite(requestedMaxRadius)
      ? Math.max(step, Math.round(requestedMaxRadius))
      : defaultMaxRadius;
    const ringCount = Math.max(1, Math.ceil(resolvedMaxRadius / step));
    const maxRadius = ringCount * step;
    const visited = new Set();
    const originXFloat = Number.isFinite(originX) ? originX : 0;
    const originZFloat = Number.isFinite(originZ) ? originZ : 0;
    const originXInt = Math.round(originXFloat);
    const originZInt = Math.round(originZFloat);
    let best = null;
    const yieldBudget = {
      samples: Math.max(1, Math.round(samplesPerYield || 0)),
      timeMs: Math.max(0, Number(timeBudgetMs) || 0),
    };
    let totalSamples = 0;
    let sliceSamples = 0;
    let lastYieldTimestamp = getTimestamp();
    let yieldCount = 0;

    const notifyRing = (payload) => {
      if (typeof onRingComplete === 'function') {
        try {
          onRingComplete(payload);
        } catch (error) {
          console.error('Biome search ring callback failed:', error);
        }
      }
    };

    const notifyYield = (payload) => {
      if (typeof onYield === 'function') {
        try {
          onYield(payload);
        } catch (error) {
          console.error('Biome search yield callback failed:', error);
        }
      }
    };

    const notifyLimit = (payload) => {
      if (typeof onLimitReached === 'function') {
        try {
          onLimitReached(payload);
        } catch (error) {
          console.error('Biome search limit callback failed:', error);
        }
      }
    };

    const shouldYield = () => {
      if (yieldBudget.samples && sliceSamples >= yieldBudget.samples) {
        return true;
      }
      if (yieldBudget.timeMs > 0) {
        const elapsed = getTimestamp() - lastYieldTimestamp;
        if (elapsed >= yieldBudget.timeMs) {
          return true;
        }
      }
      return false;
    };

    for (let radius = 0; radius <= maxRadius; radius += step) {
      for (let dx = -radius; dx <= radius; dx += step) {
        for (let dz = -radius; dz <= radius; dz += step) {
          const centerX = originXFloat + dx;
          const centerZ = originZFloat + dz;
          for (let oxIndex = 0; oxIndex < localOffsets.length; oxIndex += 1) {
            const ox = localOffsets[oxIndex];
            for (
              let ozIndex = 0;
              ozIndex < localOffsets.length;
              ozIndex += 1
            ) {
              const oz = localOffsets[ozIndex];
              const candidateX = centerX + ox;
              const candidateZ = centerZ + oz;
              const sampleX = Math.round(candidateX);
              const sampleZ = Math.round(candidateZ);
              const chebyshev = Math.max(
                Math.abs(sampleX - originXInt),
                Math.abs(sampleZ - originZInt),
              );
              if (chebyshev > radius) {
                continue;
              }
              const key = `${sampleX}|${sampleZ}`;
              if (visited.has(key)) {
                continue;
              }
              visited.add(key);
              totalSamples += 1;
              sliceSamples += 1;
              const sample = sampleBiomeAt(sampleX, sampleZ);
              if (
                sample &&
                sample.biome &&
                String(sample.biome.id) === targetId
              ) {
                const dxSample = sampleX - originXFloat;
                const dzSample = sampleZ - originZFloat;
                const distanceSq = dxSample * dxSample + dzSample * dzSample;
                const taxicab = Math.max(
                  Math.abs(sampleX - originXInt),
                  Math.abs(sampleZ - originZInt),
                );
                if (!best || distanceSq < best.distanceSq) {
                  best = {
                    x: sampleX,
                    z: sampleZ,
                    biome: sample.biome,
                    distanceSq,
                    taxicab,
                  };
                }
              }

              if (shouldYield()) {
                yieldCount += 1;
                notifyYield({
                  radius,
                  maxRadius,
                  totalSamples,
                  yieldCount,
                });
                await yieldToEventLoop();
                sliceSamples = 0;
                lastYieldTimestamp = getTimestamp();
              }
            }
          }
        }
      }

      notifyRing({
        radius,
        maxRadius,
        ringCount,
        totalSamples,
        best,
      });

      if (best && best.taxicab <= radius) {
        return {
          ...best,
          totalSamples,
          ringsVisited: Math.floor(radius / step) + 1,
          yields: yieldCount,
        };
      }
    }

    notifyLimit({
      maxRadius,
      totalSamples,
      yieldCount,
      best,
    });

    if (best) {
      return {
        ...best,
        totalSamples,
        ringsVisited: ringCount + 1,
        yields: yieldCount,
      };
    }

    return null;
  }

  const getDebugSnapshot = () => window.__VOXEL_DEBUG__?.chunkSnapshot;

  const cloneAsciiOptions = (source = asciiState.options) => ({
    radius: Math.max(1, Math.round(source.radius ?? 16)),
    lowerOffset: Math.round(source.lowerOffset ?? -1),
    upperOffset: Math.round(source.upperOffset ?? 1),
  });

  const normalizeOffsets = (options) => {
    if (options.lowerOffset > options.upperOffset) {
      const temp = options.lowerOffset;
      options.lowerOffset = options.upperOffset;
      options.upperOffset = temp;
    }
  };

  const applyAsciiTokens = (tokens, options, { allowInterval = false } = {}) => {
    const updates = [];
    let nextWatchMode = null;
    let nextIntervalMs = null;

    tokens.forEach((token) => {
      const trimmed = token.trim();
      if (!trimmed) {
        return;
      }

      if (allowInterval && ['frame', 'raf'].includes(trimmed.toLowerCase())) {
        nextWatchMode = 'frame';
        updates.push('default watch mode=frame');
        return;
      }

      if (!trimmed.includes('=')) {
        if (allowInterval) {
          const numeric = Number(trimmed);
          if (!Number.isNaN(numeric)) {
            nextWatchMode = 'interval';
            nextIntervalMs = Math.max(16, Math.round(numeric));
            updates.push(`default interval=${nextIntervalMs}ms`);
            return;
          }
        }
        throw new Error(
          'Expected key=value pairs (e.g. radius=16) or interval modifiers when allowed.',
        );
      }

      const [rawKey, rawValue] = trimmed.split('=');
      const key = rawKey.trim().toLowerCase();
      const value = rawValue.trim();
      if (!value) {
        throw new Error(`Missing value for option "${key}".`);
      }

      if (key === 'radius') {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error('Radius must be a positive number.');
        }
        options.radius = Math.max(1, Math.round(parsed));
        updates.push(`radius=${options.radius}`);
        return;
      }

      if (key === 'lower') {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
          throw new Error('Lower offset must be a number.');
        }
        options.lowerOffset = Math.round(parsed);
        updates.push(`lowerOffset=${options.lowerOffset}`);
        return;
      }

      if (key === 'upper') {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
          throw new Error('Upper offset must be a number.');
        }
        options.upperOffset = Math.round(parsed);
        updates.push(`upperOffset=${options.upperOffset}`);
        return;
      }

      if (key === 'offset') {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
          throw new Error('Offset must be numeric.');
        }
        const offset = Math.round(parsed);
        options.lowerOffset += offset;
        options.upperOffset += offset;
        updates.push(`offset=${offset}`);
        return;
      }

      if (key === 'thickness') {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error('Thickness must be a positive number.');
        }
        const layers = Math.max(1, Math.round(parsed));
        const half = Math.floor(layers / 2);
        options.lowerOffset = -half;
        options.upperOffset = layers % 2 === 0 ? half - 1 : half;
        updates.push(`thickness=${layers}`);
        return;
      }

      if (allowInterval && key === 'interval') {
        const normalized = value.toLowerCase();
        if (['frame', 'raf'].includes(normalized)) {
          nextWatchMode = 'frame';
          updates.push('default watch mode=frame');
          return;
        }
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error('Interval must be a positive number of milliseconds.');
        }
        nextWatchMode = 'interval';
        nextIntervalMs = Math.max(16, Math.round(parsed));
        updates.push(`default interval=${nextIntervalMs}ms`);
        return;
      }

      throw new Error(`Unknown ASCII option "${key}".`);
    });

    normalizeOffsets(options);

    return {
      updates,
      nextWatchMode,
      nextIntervalMs,
    };
  };

  const buildAsciiView = ({ optionsOverride } = {}) => {
    const snapshotGetter = getDebugSnapshot();
    if (typeof snapshotGetter !== 'function') {
      return { error: 'Chunk snapshot debug hook is not available yet.' };
    }
    const snapshot = snapshotGetter();
    if (!snapshot || !Array.isArray(snapshot.chunks)) {
      return { error: 'No chunk data has been captured yet.' };
    }
    const playerPosition = playerControls.getPosition();
    const options = optionsOverride ? { ...optionsOverride } : cloneAsciiOptions();
    normalizeOffsets(options);
    const baseY = Math.round(playerPosition?.y ?? 0);
    const yMin = baseY + options.lowerOffset;
    const yMax = baseY + options.upperOffset;
    const view = renderAsciiViewport({
      chunkSnapshot: snapshot,
      playerPosition,
      radius: options.radius,
      verticalSlice: { yMin: Math.min(yMin, yMax), yMax: Math.max(yMin, yMax) },
    });

    const header = `ASCII viewport — radius ${options.radius}, y ${Math.min(
      yMin,
      yMax,
    )}..${Math.max(yMin, yMax)}`;

    return {
      header,
      map: view.map,
      legend: view.legend,
    };
  };

  const outputAsciiView = (view, { showHeader = true } = {}) => {
    if (!view) {
      return false;
    }
    if (view.error) {
      if (asciiState.lastErrorMessage !== view.error) {
        asciiState.lastErrorMessage = view.error;
        commandConsole.log(`[ASCII] ${view.error}`);
      }
      return false;
    }

    asciiState.lastErrorMessage = null;
    if (showHeader && view.header) {
      commandConsole.log(view.header);
    }
    if (view.map) {
      commandConsole.log(view.map);
    }
    if (view.legend) {
      commandConsole.log(view.legend);
    }
    return true;
  };

  const stopAsciiWatch = ({ silent = false } = {}) => {
    if (asciiState.watch.rafId !== null) {
      window.cancelAnimationFrame(asciiState.watch.rafId);
      asciiState.watch.rafId = null;
    }
    if (asciiState.watch.intervalId !== null) {
      window.clearInterval(asciiState.watch.intervalId);
      asciiState.watch.intervalId = null;
    }
    asciiState.watch.mode = 'off';
    asciiState.watch.activeIntervalMs = asciiState.watch.intervalMs;
    if (!silent) {
      commandConsole.log('ASCII watch disabled.');
    }
  };

  const startAsciiWatch = ({ mode, intervalMs }) => {
    stopAsciiWatch({ silent: true });
    const renderOnce = (showHeader = false) => {
      const view = buildAsciiView();
      outputAsciiView(view, { showHeader });
    };

    if (mode === 'frame') {
      const frameLoop = () => {
        renderOnce(false);
        asciiState.watch.rafId = window.requestAnimationFrame(frameLoop);
      };
      asciiState.watch.mode = 'frame';
      asciiState.watch.activeIntervalMs = null;
      renderOnce(true);
      asciiState.watch.rafId = window.requestAnimationFrame(frameLoop);
      commandConsole.log('ASCII watch enabled (per frame).');
      return;
    }

    const effectiveInterval = Math.max(
      16,
      Math.round(intervalMs ?? asciiState.watch.intervalMs),
    );
    const intervalLoop = () => {
      renderOnce(false);
    };
    asciiState.watch.intervalId = window.setInterval(intervalLoop, effectiveInterval);
    asciiState.watch.mode = 'interval';
    asciiState.watch.activeIntervalMs = effectiveInterval;
    asciiState.watch.intervalMs = effectiveInterval;
    renderOnce(true);
    commandConsole.log(`ASCII watch enabled (every ${effectiveInterval} ms).`);
  };

  const parseDistance = (value) => {
    if (value === undefined) {
      return undefined;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      throw new Error('Distance must be a finite number.');
    }
    if (numeric <= 0) {
      throw new Error('Distance must be greater than zero.');
    }
    return numeric;
  };

  const parseCoordinate = (value, label) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      throw new Error(`${label} must be a finite number.`);
    }
    return numeric;
  };

  const parseAngle = (value, label) => {
    if (value === undefined) {
      return undefined;
    }
    const raw = String(value).trim();
    if (!raw) {
      throw new Error(`${label} must be a valid number.`);
    }
    const normalized = raw.toLowerCase();
    let unit = 'deg';
    let numericText = normalized;
    if (normalized.endsWith('rad')) {
      unit = 'rad';
      numericText = normalized.slice(0, -3);
    } else if (normalized.endsWith('deg')) {
      unit = 'deg';
      numericText = normalized.slice(0, -3);
    } else if (normalized.endsWith('°')) {
      unit = 'deg';
      numericText = normalized.slice(0, -1);
    }
    const numeric = Number(numericText);
    if (!Number.isFinite(numeric)) {
      throw new Error(`${label} must be numeric (optionally suffixed with deg or rad).`);
    }
    return unit === 'rad' ? numeric : THREE.MathUtils.degToRad(numeric);
  };

  const normalizeScanOptions = ({ distance, yaw, pitch } = {}) => {
    const orientation = playerControls.getYawPitch();
    const normalizedDistance = Number.isFinite(distance)
      ? Math.max(0.01, distance)
      : DEFAULT_SCAN_DISTANCE;
    const yawProvided = Number.isFinite(yaw);
    const pitchProvided = Number.isFinite(pitch);
    return {
      distance: normalizedDistance,
      yaw: yawProvided ? yaw : orientation.yaw,
      pitch: pitchProvided ? pitch : orientation.pitch,
      followYaw: !yawProvided,
      followPitch: !pitchProvided,
    };
  };

  const performScan = (options, { collectAll = false } = {}) => {
    const originVector = playerControls.getPosition();
    scanOrigin.copy(originVector);
    const orientation = playerControls.getYawPitch();
    const yaw = options.followYaw ? orientation.yaw : options.yaw;
    const pitch = options.followPitch ? orientation.pitch : options.pitch;
    scanEuler.set(pitch, yaw, 0, 'YXZ');
    scanDirection.set(0, 0, -1);
    scanDirection.applyEuler(scanEuler);
    return headlessScanner.cast({
      origin: scanOrigin,
      direction: scanDirection,
      maxDistance: options.distance,
      collectAll,
    });
  };

  const buildHitSummary = (hit) => {
    if (!hit) {
      return {
        key: 'no-hit',
        headline: null,
        detail: null,
        visible: false,
      };
    }
    const { block, distance, diagnostics, point } = hit;
    const position = block.position ?? { x: 0, y: 0, z: 0 };
    const pointData = point ?? { x: position.x, y: position.y, z: position.z };
    const blockKey = block.key ?? block.coordinateKey ?? 'n/a';
    const typeLabel = block.type ?? 'unknown';
    const headline = `block=${typeLabel} key=${blockKey} position=(${position.x.toFixed(
      2,
    )}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}) distance=${distance.toFixed(2)} point=(${pointData.x.toFixed(
      2,
    )}, ${pointData.y.toFixed(2)}, ${pointData.z.toFixed(2)})`;
    const detail = `flags: meshVisible=${diagnostics.meshVisible}, materialVisible=${diagnostics.materialVisible}, instanceInRange=${diagnostics.instanceInRange}, chunkVisible=${diagnostics.chunkVisible}, chunkKey=${diagnostics.chunkKey ??
      'n/a'}, instance=${diagnostics.instanceId ?? 'n/a'}/${
      diagnostics.meshCount ?? 'n/a'
    }`;
    const summaryKey = JSON.stringify({
      block: blockKey,
      position: {
        x: Number(position.x.toFixed(3)),
        y: Number(position.y.toFixed(3)),
        z: Number(position.z.toFixed(3)),
      },
      distance: Number(distance.toFixed(3)),
      meshVisible: diagnostics.meshVisible,
      materialVisible: diagnostics.materialVisible,
      instanceInRange: diagnostics.instanceInRange,
      chunkVisible: diagnostics.chunkVisible,
    });
    const allVisible =
      diagnostics.meshVisible &&
      diagnostics.materialVisible &&
      diagnostics.instanceInRange &&
      diagnostics.chunkVisible;
    return {
      key: summaryKey,
      headline,
      detail,
      visible: allVisible,
    };
  };

  const logScanResult = (result, { label = 'scan' } = {}) => {
    if (!result) {
      commandConsole.log(`[${label}] Unable to perform scan.`);
      return null;
    }
    const summary = buildHitSummary(result.hit);
    if (!result.hit) {
      commandConsole.log(
        `[${label}] No blocks detected within ${result.maxDistance.toFixed(2)} units.`,
      );
      return summary;
    }
    commandConsole.log(`[${label}] ${summary.headline}`);
    if (summary.detail) {
      commandConsole.log(`[${label}] ${summary.detail}`);
    }
    return summary;
  };

  const stopScanWatch = ({ silent = false } = {}) => {
    if (scanWatchState.disposer) {
      const dispose = scanWatchState.disposer;
      scanWatchState.disposer = null;
      try {
        dispose();
      } catch (error) {
        console.error('Failed to dispose scan watch callback:', error);
      }
    }
    scanWatchState.options = null;
    scanWatchState.lastKey = null;
    if (!silent) {
      commandConsole.log('Scan watch disabled.');
    }
  };

  const startScanWatch = (options) => {
    if (typeof registerDiagnosticOverlay !== 'function') {
      commandConsole.log('Diagnostic overlay loop is unavailable; cannot start scan watch.');
      return;
    }
    const normalized = normalizeScanOptions(options);
    stopScanWatch({ silent: true });
    const initialResult = performScan(normalized);
    const initialSummary = logScanResult(initialResult, { label: 'scan watch' });
    if (!initialResult.hit) {
      commandConsole.log('[scan watch] Nothing intersected — watch not started.');
      return;
    }
    if (!initialSummary?.visible) {
      commandConsole.log('[scan watch] Target is already invisible; watch not started.');
      return;
    }
    scanWatchState.options = normalized;
    scanWatchState.lastKey = initialSummary.key;
    scanWatchState.disposer = registerDiagnosticOverlay(() => {
      if (!scanWatchState.options) {
        return;
      }
      const result = performScan(scanWatchState.options);
      const summary = buildHitSummary(result.hit);
      if (!summary) {
        return;
      }
      if (summary.key !== scanWatchState.lastKey) {
        scanWatchState.lastKey = summary.key;
        if (!result.hit) {
          commandConsole.log('[scan watch] Target lost.');
        } else {
          commandConsole.log(`[scan watch] ${summary.headline}`);
          if (summary.detail) {
            commandConsole.log(`[scan watch] ${summary.detail}`);
          }
        }
      }
      if (!result.hit || !summary.visible) {
        commandConsole.log('[scan watch] Stopping watch — visibility criteria failed.');
        stopScanWatch({ silent: true });
      }
    });
    commandConsole.log('Scan watch enabled. Use /scan watch stop to disable.');
  };

  const scanColumn = (x, z) => {
    const playerY = playerControls.getPosition().y;
    const startY = Math.max(worldConfig.maxHeight + 32, playerY + 16);
    scanOrigin.set(x, startY, z);
    scanDirection.set(0, -1, 0);
    const maxDistance = startY + worldConfig.maxHeight + 64;
    return headlessScanner.cast({
      origin: scanOrigin,
      direction: scanDirection,
      maxDistance,
      collectAll: true,
    });
  };

  const disposeVfxOverlayHelpers = () => {
    if (vfxOverlayState.group) {
      vfxOverlayState.helpers.forEach((entry) => {
        entry.helper.geometry?.dispose?.();
        entry.helper.material?.dispose?.();
      });
      scene.remove(vfxOverlayState.group);
      vfxOverlayState.group = null;
    }
    vfxOverlayState.helpers.clear();
  };

  const disableVfxOverlay = ({ silent = false } = {}) => {
    if (vfxOverlayState.disposer) {
      try {
        vfxOverlayState.disposer();
      } catch (error) {
        console.error('Failed to dispose VFX overlay callback:', error);
      }
      vfxOverlayState.disposer = null;
    }
    disposeVfxOverlayHelpers();
    if (vfxOverlayState.element) {
      vfxOverlayState.element.remove();
      vfxOverlayState.element = null;
    }
    if (!silent) {
      commandConsole.log('VFX overlay disabled.');
    }
  };

  const enableVfxOverlay = () => {
    if (!particleSystem?.getDebugInfo) {
      commandConsole.log('Particle system debugging is unavailable.');
      return;
    }
    if (typeof registerDiagnosticOverlay !== 'function') {
      commandConsole.log('Diagnostic overlay loop is unavailable; cannot enable VFX overlay.');
      return;
    }
    if (vfxOverlayState.disposer) {
      commandConsole.log('VFX overlay is already enabled.');
      return;
    }

    const element = document.createElement('div');
    element.className = 'vfx-debug-overlay';
    element.textContent = 'VFX overlay active…';
    document.body.appendChild(element);
    vfxOverlayState.element = element;

    const group = new THREE.Group();
    group.name = 'VfxDebugOverlay';
    scene.add(group);
    vfxOverlayState.group = group;
    vfxOverlayState.helpers = new Map();

    const syncHelpers = (surfaces = []) => {
      const seen = new Set();
      surfaces.forEach((surface) => {
        const { mesh, type, attachmentCount } = surface;
        if (!mesh?.isObject3D) {
          return;
        }
        let entry = vfxOverlayState.helpers.get(mesh);
        if (!entry) {
          const box = new THREE.Box3().setFromObject(mesh);
          const helper = new THREE.Box3Helper(
            box,
            attachmentCount > 0 ? 0x4aa3ff : 0xffa64d,
          );
          helper.name = `VfxSurfaceHelper(${type ?? 'unknown'})`;
          group.add(helper);
          entry = { helper, box };
          vfxOverlayState.helpers.set(mesh, entry);
        } else {
          entry.box.setFromObject(mesh);
          entry.helper.material?.color?.set(
            attachmentCount > 0 ? 0x4aa3ff : 0xffa64d,
          );
        }
        seen.add(mesh);
      });
      vfxOverlayState.helpers.forEach((entry, mesh) => {
        if (seen.has(mesh)) {
          return;
        }
        group.remove(entry.helper);
        entry.helper.geometry?.dispose?.();
        entry.helper.material?.dispose?.();
        vfxOverlayState.helpers.delete(mesh);
      });
    };

    const updateOverlay = () => {
      if (!vfxOverlayState.element) {
        return;
      }
      const info = particleSystem.getDebugInfo?.();
      if (!info) {
        vfxOverlayState.element.textContent = 'No VFX data available.';
        return;
      }
      const lines = [
        `Emitters: ${info.emitterCount}`,
        `Active Particles: ${info.totalActiveParticles}`,
      ];
      const emitterSummaries = info.emitters.slice(0, 6);
      emitterSummaries.forEach((emitter, index) => {
        const flag = emitter.pendingRemoval ? ' *' : '';
        lines.push(`  #${index + 1} ${emitter.label} — ${emitter.activeParticles}${flag}`);
      });
      if (info.emitters.length > emitterSummaries.length) {
        lines.push(`  (+${info.emitters.length - emitterSummaries.length} more…)`);
      }
      lines.push('', `Fluid surfaces: ${info.fluidSurfaces.length}`);
      vfxOverlayState.element.textContent = lines.join('\n');
      syncHelpers(info.fluidSurfaces);
    };

    vfxOverlayState.disposer = registerDiagnosticOverlay(() => {
      updateOverlay();
    });
    updateOverlay();
    commandConsole.log('VFX overlay enabled. Use /vfx overlay off to disable.');
  };

  registerCommand({
    name: 'look',
    description:
      'Set the camera yaw and pitch (degrees by default; append rad for radians).',
    usage: '/look <yaw> <pitch>',
    handler: ({ args }) => {
      if (args.length < 2) {
        throw new Error('Usage: /look <yaw> <pitch>.');
      }
      const yaw = parseAngle(args[0], 'Yaw');
      const pitch = parseAngle(args[1], 'Pitch');
      const orientation = playerControls.setYawPitch(yaw, pitch);
      const yawDegrees = THREE.MathUtils.radToDeg(orientation.yaw);
      const pitchDegrees = THREE.MathUtils.radToDeg(orientation.pitch);
      commandConsole.log(
        `Orientation updated — yaw=${yawDegrees.toFixed(2)}°, pitch=${pitchDegrees.toFixed(2)}°`,
      );
    },
  });

  registerCommand({
    name: 'goto',
    description:
      'Teleport the player to specific coordinates or the nearest instance of a biome.',
    usage:
      '/goto <x> <y> <z> | /goto biome [biomeId|label] [radius=<maxDistance>]',
    handler: async ({ args }) => {
      if (args.length === 0) {
        throw new Error('Usage: /goto <x> <y> <z> | /goto biome [biomeId|label].');
      }

      if (args[0].toLowerCase() === 'biome') {
        const tokens = args.slice(1);
        let availableBiomes;
        try {
          availableBiomes = getRegisteredBiomes();
        } catch (error) {
          console.error('Failed to access biome registry:', error);
          throw new Error('Biome data is not available yet. Try again after the world loads.');
        }
        if (tokens.length === 0) {
          if (!availableBiomes || availableBiomes.length === 0) {
            commandConsole.log('No biomes are currently registered.', 'warn');
            return;
          }
          commandConsole.log('Available biomes:');
          availableBiomes.forEach((biome) => {
            const tagSuffix = biome.tags.length > 0 ? ` [${biome.tags.join(', ')}]` : '';
            commandConsole.log(`- ${biome.id} — ${biome.label}${tagSuffix}`);
          });
          return;
        }

        const optionTokens = [];
        const queryTokens = [];
        tokens.forEach((token) => {
          if (token.includes('=')) {
            optionTokens.push(token);
          } else {
            queryTokens.push(token);
          }
        });

        const rawQuery = queryTokens.join(' ').trim();
        if (!rawQuery) {
          throw new Error('Specify a biome identifier or label before adding options.');
        }
        const normalizedQuery = normalizeBiomeKey(rawQuery);
        const targetBiome = availableBiomes.find((biome) => {
          const idKey = normalizeBiomeKey(biome.id);
          const labelKey = normalizeBiomeKey(biome.label);
          return idKey === normalizedQuery || labelKey === normalizedQuery;
        });

        if (!targetBiome) {
          commandConsole.log(
            `Unknown biome "${rawQuery}". Use /goto biome to list valid biome identifiers.`,
            'warn',
          );
          throw new Error('Biome not found.');
        }

        let maxRadiusOverride = null;
        optionTokens.forEach((token) => {
          const [rawKey, rawValue] = token.split('=');
          const key = rawKey.trim().toLowerCase();
          const value = rawValue?.trim();
          if (!value) {
            throw new Error(`Missing value for option "${key || token}".`);
          }
          if (key === 'radius' || key === 'maxradius') {
            const parsed = Number(value);
            if (!Number.isFinite(parsed) || parsed <= 0) {
              throw new Error('Search radius must be a positive number.');
            }
            maxRadiusOverride = parsed;
            return;
          }
          throw new Error(`Unknown biome search option "${key}".`);
        });

        const origin = playerControls.getPosition();
        let searchResult;
        let hasLoggedYield = false;
        try {
          commandConsole.log(
            `Searching for nearest ${targetBiome.label ?? targetBiome.id} biome column...`,
          );
          searchResult = await findNearestBiomeColumn({
            biomeId: targetBiome.id,
            originX: origin?.x ?? 0,
            originZ: origin?.z ?? 0,
            maxRadius: maxRadiusOverride,
            onYield: ({ radius, maxRadius, totalSamples, yieldCount }) => {
              if (!hasLoggedYield) {
                hasLoggedYield = true;
                commandConsole.log(
                  'Biome search is taking longer than usual — continuing scan without freezing the game.',
                  'warn',
                );
              }
              if (yieldCount % 5 === 0) {
                const percent = maxRadius > 0 ? (radius / maxRadius) * 100 : 0;
                commandConsole.log(
                  `  Progress: radius ${Math.round(radius)} / ${maxRadius} (~${percent.toFixed(
                    1,
                  )}%); samples evaluated: ${totalSamples}.`,
                );
              }
            },
            onLimitReached: ({ maxRadius }) => {
              commandConsole.log(
                `Reached search radius limit (${maxRadius}). Consider providing a larger radius=... option if needed.`,
                'warn',
              );
            },
          });
        } catch (error) {
          console.error('Biome search failed:', error);
          throw new Error('Biome search failed — ensure world generation is initialized.');
        }

        if (!searchResult) {
          throw new Error(
            `Unable to locate biome "${targetBiome.id}" within the search radius.`,
          );
        }

        const landing = attemptTeleportToBiomeColumn(searchResult.x, searchResult.z);
        if (!landing) {
          throw new Error('Unable to find a safe landing spot near the target biome.');
        }

        const distance = Number.isFinite(searchResult.distanceSq)
          ? Math.sqrt(searchResult.distanceSq)
          : Math.hypot(
              (landing.position?.x ?? 0) - (origin?.x ?? 0),
              (landing.position?.z ?? 0) - (origin?.z ?? 0),
            );

        commandConsole.log(
          `Nearest ${targetBiome.label ?? targetBiome.id} biome column at (${searchResult.x}, ${searchResult.z}) ≈${distance.toFixed(1)}m away.`,
        );
        commandConsole.log(
          `Position set to X=${landing.position.x.toFixed(2)} Y=${landing.position.y.toFixed(2)} Z=${landing.position.z.toFixed(2)}.`,
        );
        return;
      }

      if (args.length < 3) {
        throw new Error('Usage: /goto <x> <y> <z> | /goto biome [biomeId|label].');
      }
      const x = parseCoordinate(args[0], 'X coordinate');
      const y = parseCoordinate(args[1], 'Y coordinate');
      const z = parseCoordinate(args[2], 'Z coordinate');
      const moved = playerControls.setPosition({ x, y, z });
      if (!moved) {
        throw new Error('Unable to move to target position — location is obstructed.');
      }
      const position = playerControls.getPosition();
      commandConsole.log(
        `Position set to X=${position.x.toFixed(2)} Y=${position.y.toFixed(2)} Z=${position.z.toFixed(2)}.`,
      );
    },
  });

  registerCommand({
    name: 'biomes',
    description: 'Biome diagnostics including coverage sampling benchmarks.',
    usage:
      '/biomes coverage [biomeId|label] [samples=<count>] [radius=<distance>] [threshold=<0-1>] [center=<x>,<z>]',
    handler: ({ args, warn }) => {
      if (args.length === 0) {
        throw new Error(
          'Usage: /biomes coverage [biomeId|label] [samples=<count>] [radius=<distance>] [threshold=<0-1>] [center=<x>,<z>].',
        );
      }

      const mode = args[0].toLowerCase();
      if (mode !== 'coverage') {
        throw new Error(
          'Usage: /biomes coverage [biomeId|label] [samples=<count>] [radius=<distance>] [threshold=<0-1>] [center=<x>,<z>].',
        );
      }

      const tokens = args.slice(1);
      const optionTokens = [];
      const queryTokens = [];
      tokens.forEach((token) => {
        if (!token) {
          return;
        }
        if (token.includes('=')) {
          optionTokens.push(token);
        } else {
          queryTokens.push(token);
        }
      });

      const defaultBiomeId = 'ice_spire_tundra';
      const rawQuery = queryTokens.length > 0 ? queryTokens.join(' ').trim() : defaultBiomeId;
      const normalizedQuery = normalizeBiomeKey(rawQuery);

      let availableBiomes = [];
      try {
        availableBiomes = getRegisteredBiomes();
      } catch (error) {
        console.warn('Biome registry unavailable during coverage sampling:', error);
      }

      const resolvedBiome = availableBiomes.find((biome) => {
        const idKey = normalizeBiomeKey(biome.id);
        const labelKey = normalizeBiomeKey(biome.label);
        return idKey === normalizedQuery || labelKey === normalizedQuery;
      });

      const targetBiomeId = resolvedBiome?.id ?? rawQuery ?? defaultBiomeId;
      const targetBiomeLabel = resolvedBiome?.label ?? targetBiomeId;

      let sampleCount = 5000;
      let radius = 2048;
      let threshold = 0.12;
      let centerX = 0;
      let centerZ = 0;

      optionTokens.forEach((token) => {
        const [rawKey, rawValue] = token.split('=');
        const key = rawKey.trim().toLowerCase();
        const value = rawValue?.trim();
        if (!value) {
          throw new Error(`Missing value for option "${key || token}".`);
        }
        if (key === 'samples' || key === 'count') {
          const parsed = Number(value);
          if (!Number.isFinite(parsed) || parsed <= 0) {
            throw new Error('Sample count must be a positive number.');
          }
          sampleCount = Math.max(1, Math.round(parsed));
          return;
        }
        if (key === 'radius') {
          const parsed = Number(value);
          if (!Number.isFinite(parsed) || parsed <= 0) {
            throw new Error('Radius must be a positive number.');
          }
          radius = parsed;
          return;
        }
        if (key === 'threshold' || key === 'min') {
          const parsed = Number(value);
          if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
            throw new Error('Threshold must be within the range [0, 1].');
          }
          threshold = parsed;
          return;
        }
        if (key === 'center') {
          const [cx, cz] = value.split(',');
          const parsedX = Number(cx);
          const parsedZ = Number(cz);
          if (!Number.isFinite(parsedX) || !Number.isFinite(parsedZ)) {
            throw new Error('Center must be formatted as center=<x>,<z>.');
          }
          centerX = parsedX;
          centerZ = parsedZ;
          return;
        }
        throw new Error(`Unknown biome coverage option "${key}".`);
      });

      let result;
      try {
        result = sampleBiomeCoverage({
          biomeId: targetBiomeId,
          sampleCount,
          radius,
          centerX,
          centerZ,
        });
      } catch (error) {
        console.error('Biome coverage sampling failed:', error);
        throw new Error('Biome coverage sampling is unavailable until the world is initialized.');
      }

      if (!result || result.samples === 0) {
        throw new Error('Biome coverage sampling returned no valid results.');
      }

      const coveragePercent = (result.coverage * 100).toFixed(2);
      const thresholdPercent = (threshold * 100).toFixed(2);
      const meetsThreshold = result.coverage >= threshold;

      commandConsole.log(
        `[biomes coverage] Sampled ${result.samples}/${result.requestedSamples} columns within radius ${result.radius.toFixed(
          1,
        )} around (${result.center.x.toFixed(1)}, ${result.center.z.toFixed(1)}).`,
      );

      const topCounts = result.counts.slice(0, 6);
      topCounts.forEach((entry) => {
        commandConsole.log(
          `[biomes coverage] ${entry.id}: ${(entry.share * 100).toFixed(2)}% (${entry.count} samples)`,
        );
      });
      if (result.counts.length > topCounts.length) {
        commandConsole.log(
          `[biomes coverage] (+${result.counts.length - topCounts.length} additional biomes in sample set)`,
        );
      }

      const verdictLine = `${targetBiomeLabel} coverage ${coveragePercent}% (${result.matches}/${result.samples}) vs threshold ${thresholdPercent}%`;
      if (meetsThreshold) {
        commandConsole.log(`[biomes coverage] ${verdictLine} — PASS`);
      } else {
        warn(`[biomes coverage] ${verdictLine} — FAIL`);
      }
    },
  });

  registerCommand({
    name: 'scan',
    description:
      'Cast a diagnostic ray and report the hit block with render visibility checks.',
    usage:
      '/scan [distance] [yaw] [pitch] | /scan column <x> <z> | /scan watch [stop|distance [yaw] [pitch]]',
    handler: ({ args }) => {
      if (args.length > 0) {
        const mode = args[0].toLowerCase();
        if (mode === 'column') {
          if (args.length < 3) {
            throw new Error('Usage: /scan column <x> <z>.');
          }
          const x = parseCoordinate(args[1], 'Column X coordinate');
          const z = parseCoordinate(args[2], 'Column Z coordinate');
          const result = scanColumn(x, z);
          if (!result || result.hits.length === 0) {
            commandConsole.log(
              `[scan column] No blocks detected at column (${x.toFixed(2)}, ${z.toFixed(2)}).`,
            );
            return;
          }
          commandConsole.log(
            `[scan column] ${result.hits.length} block(s) detected at column (${x.toFixed(2)}, ${z.toFixed(2)}).`,
          );
          result.hits.forEach((hit, index) => {
            const summary = buildHitSummary(hit);
            commandConsole.log(`[scan column] #${index + 1}: ${summary.headline}`);
            if (summary.detail) {
              commandConsole.log(`  ${summary.detail}`);
            }
          });
          return;
        }
        if (mode === 'watch') {
          if (args.length > 1 && args[1].toLowerCase() === 'stop') {
            if (!scanWatchState.disposer) {
              commandConsole.log('Scan watch is not currently active.');
              return;
            }
            stopScanWatch();
            return;
          }
          const distance = args.length > 1 ? parseDistance(args[1]) : undefined;
          const yaw = args.length > 2 ? parseAngle(args[2], 'Yaw') : undefined;
          const pitch = args.length > 3 ? parseAngle(args[3], 'Pitch') : undefined;
          startScanWatch({ distance, yaw, pitch });
          return;
        }
      }

      if (args.length > 3) {
        throw new Error('Usage: /scan [distance] [yaw] [pitch].');
      }
      const distance = args.length > 0 ? parseDistance(args[0]) : undefined;
      const yaw = args.length > 1 ? parseAngle(args[1], 'Yaw') : undefined;
      const pitch = args.length > 2 ? parseAngle(args[2], 'Pitch') : undefined;
      const options = normalizeScanOptions({ distance, yaw, pitch });
      const result = performScan(options);
      logScanResult(result, { label: 'scan' });
    },
  });

  registerCommand({
    name: 'vfx',
    description: 'Inspect and control particle visual effects.',
    usage: '/vfx overlay [on|off|toggle] | /vfx list',
    handler: ({ args, toggle }) => {
      if (!particleSystem) {
        commandConsole.log('Particle system is not available.');
        return;
      }
      if (args.length === 0) {
        throw new Error('Usage: /vfx overlay [on|off|toggle] | /vfx list.');
      }
      const mode = args[0].toLowerCase();
      if (mode === 'overlay') {
        const desired = toggle(args[1], Boolean(vfxOverlayState.disposer));
        if (desired) {
          enableVfxOverlay();
        } else {
          disableVfxOverlay();
        }
        return;
      }
      if (mode === 'list') {
        const info = particleSystem.getDebugInfo?.();
        if (!info) {
          commandConsole.log('Particle system did not provide debug info.');
          return;
        }
        commandConsole.log(`Emitters (${info.emitterCount} total):`);
        info.emitters.forEach((emitter, index) => {
          const status = emitter.pendingRemoval ? ' (pending removal)' : '';
          commandConsole.log(
            `  #${index + 1} ${emitter.label} — particles=${emitter.activeParticles}${status}`,
          );
        });
        commandConsole.log(`Fluid surfaces tracked: ${info.fluidSurfaces.length}`);
        info.fluidSurfaces.forEach((surface, index) => {
          commandConsole.log(
            `  #${index + 1} type=${surface.type} attachments=${surface.attachmentCount}`,
          );
        });
        return;
      }
      throw new Error('Usage: /vfx overlay [on|off|toggle] | /vfx list.');
    },
  });

  const weatherCommandUsage = '/weather [on|off|status|help|weatherId]';

  registerCommand({
    name: 'weather',
    description: 'Inspect and override the active weather preset.',
    usage: weatherCommandUsage,
    handler: ({ args, success, warn, info }) => {
      if (!weatherManager || typeof weatherManager.setWeather !== 'function') {
        warn('Weather manager is not available yet.');
        return;
      }

      const getRegisteredWeatherPresets = () => {
        if (typeof weatherManager.listWeatherPresets !== 'function') {
          warn('[weather] Weather preset registry accessor is unavailable; cannot enumerate presets.');
          return null;
        }
        try {
          const presets = weatherManager.listWeatherPresets();
          const array = Array.isArray(presets) ? presets : Array.from(presets ?? []);
          return array
            .map((preset) => (preset && typeof preset === 'object' ? { ...preset } : null))
            .filter(Boolean);
        } catch (error) {
          console.warn('Failed to enumerate weather presets:', error);
          warn('[weather] Unable to enumerate weather presets due to an internal error.');
          return null;
        }
      };

      const logWeatherPresetSummary = ({ prefix = '[weather]' } = {}) => {
        const presets = getRegisteredWeatherPresets();
        if (!presets) {
          info(`${prefix} Weather preset list unavailable.`);
          return presets;
        }
        if (presets.length === 0) {
          info(`${prefix} No weather presets are registered.`);
          return presets;
        }
        info(`${prefix} Available presets:`);
        presets.forEach((preset) => {
          const label = preset.label ?? preset.id;
          const intensity = Number.isFinite(preset.intensity)
            ? preset.intensity.toFixed(2)
            : 'n/a';
          info(`${prefix}  - ${preset.id} — ${label} (intensity ${intensity})`);
        });
        return presets;
      };

      const logVerboseWeatherPresetSummary = () => {
        const presets = getRegisteredWeatherPresets();
        if (!presets) {
          info('[weather help] Weather preset list unavailable.');
          return;
        }
        if (presets.length === 0) {
          info('[weather help] No weather presets are registered.');
          return;
        }
        info('[weather help] Preset catalogue:');
        info('[weather help]   id | label | category | description');
        presets.forEach((preset) => {
          const label = preset.label ?? 'Unnamed';
          const category = preset.category ?? 'uncategorised';
          const description = preset.description ?? '—';
          info(`[weather help]   ${preset.id} | ${label} | ${category} | ${description}`);
        });
      };

      if (args.length === 0) {
        logWeatherPresetSummary();
        return;
      }

      const subcommand = String(args[0] ?? '').toLowerCase();

      if (subcommand === 'help') {
        info(`[weather] Usage: ${weatherCommandUsage}.`);
        logVerboseWeatherPresetSummary();
        return;
      }

      if (subcommand === 'status') {
        const active = weatherManager.getCurrentWeather?.();
        if (!active) {
          info('[weather status] No active weather preset.');
        } else {
          info(`[weather status] Active — ${describeWeather(active)}.`);
        }
        info(
          `[weather status] Overrides ${weatherControlState.suppressed ? 'OFF (forced clear skies)' : 'ON'}.`,
        );
        const duration = active?.duration ?? null;
        if (duration) {
          const durationParts = [];
          if (Number.isFinite(duration.remaining)) {
            durationParts.push(`remaining ${duration.remaining.toFixed(1)}s`);
          }
          if (Number.isFinite(duration.min) || Number.isFinite(duration.max)) {
            const minText = Number.isFinite(duration.min)
              ? duration.min.toFixed(1)
              : '?';
            const maxText = Number.isFinite(duration.max)
              ? duration.max.toFixed(1)
              : '?';
            durationParts.push(`window ${minText}–${maxText}s`);
          }
          const summary = durationParts.length > 0 ? durationParts.join(', ') : 'metadata unavailable';
          info(`[weather status] Duration — ${summary}.`);
        } else {
          info('[weather status] Duration metadata unavailable.');
        }

        const position = playerControls?.getPosition?.();
        if (position) {
          const biomeSample = sampleBiomeAt(Math.round(position.x), Math.round(position.z));
          const biome = biomeSample?.biome ?? null;
          if (biome) {
            const candidates = Array.isArray(biome.weather?.candidates)
              ? biome.weather.candidates
              : [];
            const rotationIds =
              candidates.length > 0
                ? candidates.map((candidate) => candidate.id)
                : ['clear_skies'];
            info(
              `[weather status] Biome — ${
                biome.label ?? biome.id ?? 'Unknown biome'
              } (${rotationIds.join(', ')}).`,
            );
            if (active?.id && !rotationIds.includes(active.id)) {
              warn(
                `[weather status] Active preset ${active.id} is not part of the current biome rotation.`,
              );
            }
          } else {
            info('[weather status] Unable to resolve biome at current position.');
          }
        } else {
          info('[weather status] Player position unavailable; cannot sample biome.');
        }
        logWeatherPresetSummary({ prefix: '[weather status]' });
        return;
      }

      if (subcommand === 'off') {
        if (weatherControlState.suppressed) {
          info('[weather] Weather overrides already disabled.');
          return;
        }
        const current = weatherManager.getCurrentWeather?.();
        weatherControlState.lastSuppressedWeatherId =
          current && current.id !== 'clear_skies' ? current.id : weatherControlState.lastSuppressedWeatherId;
        const applied = applyWeatherPreset('clear_skies');
        if (!applied) {
          warn('Unable to enforce clear skies; preset "clear_skies" is not registered.');
          throw new Error('Failed to disable weather overrides.');
        }
        weatherControlState.suppressed = true;
        success('[weather] Weather overrides disabled — clear skies enforced.');
        logWeatherPresetSummary();
        return;
      }

      if (subcommand === 'on') {
        if (!weatherControlState.suppressed) {
          const active = weatherManager.getCurrentWeather?.();
          info(`[weather] Weather overrides already enabled — ${describeWeather(active)}.`);
          return;
        }
        const candidateIds = [
          weatherControlState.lastManualWeatherId,
          weatherControlState.lastSuppressedWeatherId,
          'clear_skies',
        ].filter(Boolean);
        let restored = null;
        for (const candidate of candidateIds) {
          restored = applyWeatherPreset(candidate);
          if (restored) {
            break;
          }
        }
        weatherControlState.suppressed = false;
        if (!restored) {
          warn('No valid weather preset could be restored.');
          throw new Error('Failed to enable weather overrides.');
        }
        success(`[weather] Weather overrides enabled — ${describeWeather(restored)}.`);
        logWeatherPresetSummary();
        return;
      }

      const targetId = normalizeWeatherKey(args.join(' '));
      if (!targetId) {
        throw new Error('Specify a weather preset identifier.');
      }
      const applied = applyWeatherPreset(targetId);
      if (!applied) {
        warn(`Weather preset "${targetId}" is not registered.`);
        throw new Error('Weather preset not found.');
      }
      weatherControlState.lastManualWeatherId = applied.id;
      weatherControlState.suppressed = false;
      success(`[weather] Weather set to ${describeWeather(applied)}.`);
      logWeatherPresetSummary();
    },
  });

  registerCommand({
    name: 'godmode',
    description: 'Toggle invulnerability to damage.',
    usage: '/godmode [on|off|1|0|toggle]',
    handler: ({ args, toggle, success }) => {
      const next = toggle(args[0], playerControls.isGodModeEnabled());
      playerControls.setGodModeEnabled(next);
      success(`God mode ${next ? 'enabled' : 'disabled'}.`);
    },
  });

  registerCommand({
    name: 'fly',
    description: 'Toggle free-flight movement mode.',
    usage: '/fly [on|off|1|0|toggle]',
    handler: ({ args, toggle, success }) => {
      const next = toggle(args[0], playerControls.isFlightEnabled());
      playerControls.setFlightEnabled(next);
      success(`Flight mode ${next ? 'enabled' : 'disabled'}.`);
    },
  });

  registerCommand({
    name: 'unstuck',
    description: 'Attempt to move the player to the nearest safe location.',
    usage: '/unstuck',
    handler: ({ success, warn }) => {
      const resolved = playerControls.unstuck();
      if (resolved) {
        success('Attempted to move you to a nearby safe spot.');
      } else {
        warn('Unable to find a safe location. Try enabling flight or reloading.');
      }
    },
  });

  registerCommand({
    name: 'heal',
    description: 'Restore health to a specific value (defaults to full).',
    usage: '/heal [amount]',
    handler: ({ args, success }) => {
      const target = args.length > 0 ? args[0] : 100;
      const value = playerControls.setHealth(target);
      success(`Health set to ${Math.round(value)}.`);
    },
  });

  registerCommand({
    name: 'oxygen',
    description: 'Set the current oxygen level.',
    usage: '/oxygen [amount]',
    handler: ({ args, success }) => {
      const target =
        args.length > 0 ? args[0] : playerControls.getMaxOxygen();
      const value = playerControls.setOxygen(target);
      success(`Oxygen set to ${value.toFixed(1)}.`);
    },
  });

  registerCommand({
    name: 'whereami',
    description: 'Print the current player coordinates.',
    usage: '/whereami',
    handler: ({ success }) => {
      const position = playerControls.getPosition();
      const biomeSample = sampleBiomeAt(Math.round(position.x), Math.round(position.z));
      const biomeLabel = biomeSample?.biome?.label ?? 'Unknown biome';
      const biomeId = biomeSample?.biome?.id;
      const biomeDescription = biomeId ? `${biomeLabel} [${biomeId}]` : biomeLabel;
      success(
        `Position — X: ${position.x.toFixed(2)}, Y: ${position.y.toFixed(
          2,
        )}, Z: ${position.z.toFixed(2)} | Biome: ${biomeDescription}`,
      );
    },
  });

  registerCommand({
    name: 'status',
    description: 'Set or clear the HUD status message.',
    usage: '/status [message]',
    handler: ({ args, success }) => {
      if (args.length === 0) {
        playerControls.clearStatusMessage();
        success('Cleared status message.');
        return;
      }
      const message = args.join(' ');
      playerControls.setStatusMessage(message, 5);
      success('Updated status message.');
    },
  });

  registerCommand({
    name: 'asciimap',
    description: 'Render a top-down ASCII map around the player.',
    usage: '/asciimap [radius=<n>] [lower=<n>] [upper=<n>] [thickness=<n>] [offset=<n>]',
    handler: ({ args }) => {
      const optionsOverride = cloneAsciiOptions();
      if (args.length > 0) {
        applyAsciiTokens(args, optionsOverride, { allowInterval: false });
      }
      const view = buildAsciiView({ optionsOverride });
      if (!outputAsciiView(view)) {
        return;
      }
      commandConsole.log('ASCII map render complete.');
    },
  });

  registerCommand({
    name: 'asciioptions',
    description: 'Configure ASCII map radius and vertical slice.',
    usage:
      '/asciioptions [radius=<n>] [lower=<n>] [upper=<n>] [thickness=<n>] [offset=<n>] [interval=<ms|frame>]',
    handler: ({ args, info }) => {
      if (args.length === 0) {
        info(
          `Radius=${asciiState.options.radius}, vertical offsets=${asciiState.options.lowerOffset}..${asciiState.options.upperOffset}, default watch=${
            asciiState.watch.defaultMode === 'frame'
              ? 'per frame'
              : `${asciiState.watch.intervalMs} ms`
          }`,
        );
        info(
          'Provide key=value pairs (e.g. radius=20, thickness=5, interval=500) to update these defaults.',
        );
        return;
      }

      const nextOptions = cloneAsciiOptions();
      const { updates, nextWatchMode, nextIntervalMs } = applyAsciiTokens(args, nextOptions, {
        allowInterval: true,
      });
      asciiState.options = nextOptions;
      if (nextWatchMode) {
        asciiState.watch.defaultMode = nextWatchMode;
      }
      if (typeof nextIntervalMs === 'number') {
        asciiState.watch.intervalMs = nextIntervalMs;
        asciiState.watch.activeIntervalMs = nextIntervalMs;
      }
      if (updates.length === 0) {
        info('No ASCII options changed.');
      } else {
        updates.forEach((entry) => commandConsole.log(`Updated ${entry}.`));
      }
      const summary =
        asciiState.watch.defaultMode === 'frame'
          ? 'per frame'
          : `${asciiState.watch.intervalMs} ms`;
      commandConsole.log(
        `Current ASCII settings — radius=${asciiState.options.radius}, offsets=${asciiState.options.lowerOffset}..${asciiState.options.upperOffset}, default watch cadence=${summary}.`,
      );
    },
  });

  registerCommand({
    name: 'asciiwatch',
    description: 'Continuously refresh the ASCII map.',
    usage: '/asciiwatch [on [frame|ms]]|off',
    handler: ({ args, info }) => {
      if (args.length === 0) {
        if (asciiState.watch.mode === 'off') {
          info('ASCII watch is currently disabled.');
        } else if (asciiState.watch.mode === 'frame') {
          info('ASCII watch is running every frame.');
        } else {
          info(
            `ASCII watch is running every ${asciiState.watch.activeIntervalMs ?? asciiState.watch.intervalMs} ms.`,
          );
        }
        info('Use /asciiwatch on [frame|ms] or /asciiwatch off.');
        return;
      }

      const primary = args[0].toLowerCase();
      if (primary === 'off') {
        if (asciiState.watch.mode === 'off') {
          info('ASCII watch is already disabled.');
          return;
        }
        stopAsciiWatch();
        return;
      }

      if (primary !== 'on') {
        throw new Error('Expected "on" or "off" for /asciiwatch.');
      }

      let mode = asciiState.watch.defaultMode;
      let intervalMs = asciiState.watch.intervalMs;

      if (args.length > 1) {
        const modifier = args[1].toLowerCase();
        if (modifier === 'frame' || modifier === 'raf') {
          mode = 'frame';
        } else {
          const parsed = Number(modifier);
          if (Number.isFinite(parsed) && parsed > 0) {
            mode = 'interval';
            intervalMs = Math.max(16, Math.round(parsed));
          } else {
            throw new Error('Provide "frame" or a positive number of milliseconds.');
          }
        }
      }

      if (mode === 'frame') {
        startAsciiWatch({ mode: 'frame' });
      } else {
        startAsciiWatch({ mode: 'interval', intervalMs });
      }
    },
  });
}

import { renderAsciiViewport } from '../devtools/ascii-viewport.js';
import { createHeadlessScanner } from '../devtools/headless-scanner.js';
import { sampleBiomeAt, terrainHeight, worldConfig } from '../world/generation.js';
import {
  FLUID_RENDER_MODES,
  getFluidRenderMode,
  setFluidRenderMode,
} from '../world/fluids/fluid-render-mode.js';

export function registerDeveloperCommands({
  commandConsole,
  playerControls,
  chunkManager,
  scene,
  THREE,
  registerDiagnosticOverlay,
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
    lastView: null,
  };

  const asciiListeners = new Set();

  const notifyAsciiListeners = (event) => {
    asciiListeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        console.error('ASCII map listener failed:', error);
      }
    });
  };

  const addAsciiListener = (listener) => {
    if (typeof listener !== 'function') {
      throw new Error('ASCII listener must be a function.');
    }
    asciiListeners.add(listener);
    return () => {
      asciiListeners.delete(listener);
    };
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
      asciiState.lastView = view;
      notifyAsciiListeners({ type: 'error', view });
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
    asciiState.lastView = view;
    notifyAsciiListeners({ type: 'render', view });
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
    notifyAsciiListeners({
      type: 'status',
      status: 'stopped',
      mode: 'off',
      intervalMs: asciiState.watch.intervalMs,
    });
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
      notifyAsciiListeners({
        type: 'status',
        status: 'started',
        mode: 'frame',
        intervalMs: null,
      });
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
    notifyAsciiListeners({
      type: 'status',
      status: 'started',
      mode: 'interval',
      intervalMs: effectiveInterval,
    });
  };

  const resolveAsciiOptions = (overrides) => {
    if (!overrides) {
      return cloneAsciiOptions();
    }
    const merged = { ...asciiState.options, ...overrides };
    return cloneAsciiOptions(merged);
  };

  const formatAsciiView = (view) => {
    if (!view) {
      return '';
    }
    if (view.error) {
      return `[ASCII] ${view.error}`;
    }
    return [view.header, view.map, view.legend].filter(Boolean).join('\n');
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

  const teleportEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const teleportYawEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const teleportForwardBasis = new THREE.Vector3(0, 0, -1);
  const teleportRightBasis = new THREE.Vector3(1, 0, 0);
  const teleportForward = new THREE.Vector3();
  const teleportRight = new THREE.Vector3();
  const teleportOffset = new THREE.Vector3();
  const teleportUp = new THREE.Vector3(0, 1, 0);

  const RELATIVE_DIRECTION_ALIASES = new Map([
    ['forward', 'forward'],
    ['forwards', 'forward'],
    ['fwd', 'forward'],
    ['back', 'backward'],
    ['backward', 'backward'],
    ['backwards', 'backward'],
    ['reverse', 'backward'],
    ['backtrack', 'backward'],
    ['right', 'right'],
    ['straferight', 'right'],
    ['left', 'left'],
    ['strafeleft', 'left'],
    ['up', 'up'],
    ['ascend', 'up'],
    ['rise', 'up'],
    ['down', 'down'],
    ['descend', 'down'],
    ['drop', 'down'],
  ]);

  const normalizeRelativeToken = (token) => {
    if (!token) {
      throw new Error('Expected at least one relative step.');
    }
    const trimmed = token.trim();
    if (!trimmed) {
      throw new Error('Relative steps must not be empty.');
    }
    const match = /^([a-z]+)(?:\(([^)]+)\))?$/i.exec(trimmed);
    if (!match) {
      throw new Error(
        `Unrecognized relative step "${token}". Use syntax like forward(3) or up(2).`,
      );
    }
    const directionKey = match[1].toLowerCase();
    const normalizedDirection = RELATIVE_DIRECTION_ALIASES.get(directionKey);
    if (!normalizedDirection) {
      throw new Error(
        `Unknown direction "${directionKey}". Expected forward/backward/left/right/up/down.`,
      );
    }
    const distanceText = match[2];
    const distance = distanceText === undefined || distanceText === '' ? 1 : Number(distanceText);
    if (!Number.isFinite(distance)) {
      throw new Error(`Step distance for "${directionKey}" must be a finite number.`);
    }
    return { direction: normalizedDirection, distance };
  };

  const computeRelativeOffset = (tokens) => {
    if (!Array.isArray(tokens) || tokens.length === 0) {
      throw new Error('Provide at least one relative step to teleport.');
    }
    const orientation = playerControls.getYawPitch();
    teleportEuler.set(orientation.pitch, orientation.yaw, 0, 'YXZ');
    teleportYawEuler.set(0, orientation.yaw, 0, 'YXZ');
    teleportForward.copy(teleportForwardBasis).applyEuler(teleportEuler).normalize();
    teleportRight.copy(teleportRightBasis).applyEuler(teleportYawEuler).normalize();
    if (!Number.isFinite(teleportRight.lengthSq()) || teleportRight.lengthSq() === 0) {
      teleportRight.set(1, 0, 0);
    }
    teleportOffset.set(0, 0, 0);

    tokens.forEach((token) => {
      const { direction, distance } = normalizeRelativeToken(token);
      switch (direction) {
        case 'forward':
          teleportOffset.addScaledVector(teleportForward, distance);
          break;
        case 'backward':
          teleportOffset.addScaledVector(teleportForward, -distance);
          break;
        case 'right':
          teleportOffset.addScaledVector(teleportRight, distance);
          break;
        case 'left':
          teleportOffset.addScaledVector(teleportRight, -distance);
          break;
        case 'up':
          teleportOffset.addScaledVector(teleportUp, distance);
          break;
        case 'down':
          teleportOffset.addScaledVector(teleportUp, -distance);
          break;
        default:
          throw new Error(`Unsupported direction "${direction}".`);
      }
    });

    return teleportOffset.clone();
  };

  const computeHorizontalDistanceSq = (x, z, origin) => {
    const reference = origin ?? playerControls.getPosition();
    const dx = x - reference.x;
    const dz = z - reference.z;
    return dx * dx + dz * dz;
  };

  const findSurfaceHeightAt = (x, z) => {
    const blockSet = chunkManager?.solidBlocks;
    if (!blockSet || typeof blockSet.has !== 'function') {
      return null;
    }
    const columnX = Math.round(x);
    const columnZ = Math.round(z);
    const searchTop = worldConfig.maxHeight + 64;
    for (let y = searchTop; y >= -64; y -= 1) {
      if (blockSet.has(`${columnX}|${y}|${columnZ}`)) {
        return y + 0.5;
      }
    }
    return null;
  };

  const estimateEyeHeight = () => {
    const current = playerControls.getPosition();
    const surface = findSurfaceHeightAt(current.x, current.z);
    if (surface !== null) {
      const offset = current.y - surface;
      if (Number.isFinite(offset) && offset > 0.5 && offset < 3.5) {
        return offset;
      }
    }
    return 1.7;
  };

  const resolveFluidColumns = (chunk) => {
    if (!chunk) {
      return null;
    }
    if (chunk.fluidColumns instanceof Map) {
      return chunk.fluidColumns;
    }
    if (chunk.fluidColumnsByType instanceof Map) {
      return chunk.fluidColumnsByType;
    }
    return null;
  };

  const resolveBiomeEntries = (chunk) => {
    if (!chunk) {
      return [];
    }
    if (Array.isArray(chunk.biomes)) {
      return chunk.biomes;
    }
    if (Array.isArray(chunk.group?.userData?.biomes)) {
      return chunk.group.userData.biomes;
    }
    return [];
  };

  const movePlayerTo = (targetPosition, { announce, label } = {}) => {
    const moved = playerControls.setPosition(targetPosition);
    if (!moved) {
      throw new Error('Unable to move to target position — location is obstructed.');
    }
    const position = playerControls.getPosition();
    const summary = `X=${position.x.toFixed(2)} Y=${position.y.toFixed(2)} Z=${position.z.toFixed(2)}`;
    if (announce) {
      commandConsole.log(announce);
    }
    if (label) {
      commandConsole.log(label);
    }
    commandConsole.log(`Teleport complete — ${summary}.`);
    return position;
  };

  const getLoadedChunks = () => {
    if (typeof chunkManager.getLoadedChunks === 'function') {
      return chunkManager.getLoadedChunks();
    }
    const snapshot = chunkManager.debugSnapshot?.();
    if (snapshot?.chunks) {
      return snapshot.chunks.map((entry) => entry.chunk).filter(Boolean);
    }
    return [];
  };

  const computeStandingPosition = ({ x, z, surfaceHint = null, offset = 0.25 }) => {
    let surface = Number.isFinite(surfaceHint) ? surfaceHint : null;
    if (surface === null) {
      surface = findSurfaceHeightAt(x, z);
    }
    if (surface === null && typeof terrainHeight === 'function') {
      try {
        const terrain = terrainHeight(Math.round(x), Math.round(z));
        if (Number.isFinite(terrain)) {
          surface = terrain + 0.5;
        }
      } catch (error) {
        // Ignore terrain sampling failures and fall back to base height.
      }
    }
    if (surface === null) {
      surface = worldConfig.baseHeight + 0.5;
    }
    const headOffset = estimateEyeHeight() + offset;
    return new THREE.Vector3(x, surface + headOffset, z);
  };

  const requireLoadedChunks = () => {
    const chunks = getLoadedChunks();
    if (!chunks || chunks.length === 0) {
      throw new Error(
        'No chunks are currently loaded. Move around the world to stream in terrain before teleporting.',
      );
    }
    return chunks;
  };

  const handleRelativeTeleport = (tokens) => {
    const offset = computeRelativeOffset(tokens);
    if (offset.lengthSq() === 0) {
      throw new Error('Relative steps cancelled each other out — no movement requested.');
    }
    const origin = playerControls.getPosition();
    const target = origin.clone().add(offset);
    const announce = `Teleporting by offset ΔX=${offset.x.toFixed(2)} ΔY=${offset.y.toFixed(2)} ΔZ=${offset.z.toFixed(2)}.`;
    movePlayerTo(target, { announce });
  };

  const handleTeleportBiome = (args) => {
    if (!args.length) {
      throw new Error('Usage: /teleport biome <id|name>.');
    }
    const queryRaw = args.join(' ').trim();
    if (!queryRaw) {
      throw new Error('Provide a biome id or name to search for.');
    }
    const query = queryRaw.toLowerCase();
    const chunks = requireLoadedChunks();
    const origin = playerControls.getPosition();
    let best = null;
    chunks.forEach((chunk) => {
      const biomes = resolveBiomeEntries(chunk);
      if (!Array.isArray(biomes) || biomes.length === 0) {
        return;
      }
      const match = biomes.find((entry) => {
        if (!entry) {
          return false;
        }
        const id = typeof entry.id === 'string' ? entry.id.toLowerCase() : '';
        const label = typeof entry.label === 'string' ? entry.label.toLowerCase() : '';
        return id === query || label === query;
      });
      if (!match) {
        return;
      }
      const x = chunk.chunkX * worldConfig.chunkSize;
      const z = chunk.chunkZ * worldConfig.chunkSize;
      const distanceSq = computeHorizontalDistanceSq(x, z, origin);
      if (!best || distanceSq < best.distanceSq) {
        best = { chunk, match, x, z, distanceSq };
      }
    });
    if (!best) {
      throw new Error(`No loaded chunk matches biome "${queryRaw}".`);
    }
    const target = computeStandingPosition({ x: best.x, z: best.z });
    const biomeLabel = best.match.label ?? best.match.id ?? 'Unknown biome';
    const biomeId = best.match.id ? ` [${best.match.id}]` : '';
    const distance = Math.sqrt(best.distanceSq);
    const announce = `Teleporting to biome ${biomeLabel}${biomeId} at chunk (${best.chunk.chunkX}, ${best.chunk.chunkZ}).`;
    const weightPercent =
      typeof best.match.weight === 'number' ? `${(best.match.weight * 100).toFixed(1)}%` : null;
    const labelParts = [`Horizontal distance ≈${distance.toFixed(1)}m`];
    if (weightPercent) {
      labelParts.push(`Chunk weight ${weightPercent}`);
    }
    movePlayerTo(target, { announce, label: labelParts.join(' | ') });
  };

  const handleTeleportFluid = (args) => {
    if (!args.length) {
      throw new Error('Usage: /teleport fluid <type>.');
    }
    const query = args[0].toLowerCase();
    const chunks = requireLoadedChunks();
    const origin = playerControls.getPosition();
    let best = null;
    chunks.forEach((chunk) => {
      const columnsByType = resolveFluidColumns(chunk);
      if (!columnsByType) {
        return;
      }
      const columns = columnsByType.get(query);
      if (!(columns instanceof Map)) {
        return;
      }
      columns.forEach((column) => {
        if (!column) {
          return;
        }
        const columnX = column.x ?? column.worldX ?? column.position?.x ?? 0;
        const columnZ = column.z ?? column.worldZ ?? column.position?.z ?? 0;
        const distanceSq = computeHorizontalDistanceSq(columnX, columnZ, origin);
        const surface =
          typeof column.surfaceY === 'number'
            ? column.surfaceY
            : typeof column.maxY === 'number'
            ? column.maxY
            : null;
        if (!best || distanceSq < best.distanceSq) {
          best = { chunk, column, x: columnX, z: columnZ, surface, distanceSq };
        }
      });
    });
    if (!best) {
      throw new Error(`No loaded fluid columns of type "${query}" were found.`);
    }
    const depth = typeof best.column.depth === 'number' ? best.column.depth : null;
    const offset = depth !== null ? Math.max(0.35, Math.min(1, depth * 0.5)) : 0.35;
    const target = computeStandingPosition({
      x: best.x,
      z: best.z,
      surfaceHint: best.surface,
      offset,
    });
    const announce = `Teleporting to ${query} column at (${Math.round(best.x)}, ${Math.round(best.z)}) in chunk (${best.chunk.chunkX}, ${best.chunk.chunkZ}).`;
    const distance = Math.sqrt(best.distanceSq);
    const labelParts = [`Horizontal distance ≈${distance.toFixed(1)}m`];
    if (Number.isFinite(best.surface)) {
      labelParts.push(`Surface Y≈${best.surface.toFixed(2)}`);
    }
    if (depth !== null) {
      labelParts.push(`Depth≈${depth.toFixed(2)}`);
    }
    movePlayerTo(target, { announce, label: labelParts.join(' | ') });
  };

  const handleTeleportObject = (args) => {
    if (!args.length) {
      throw new Error('Usage: /teleport object <id>.');
    }
    const queryRaw = args[0];
    const query = queryRaw.toLowerCase();
    const chunks = requireLoadedChunks();
    const origin = playerControls.getPosition();
    let best = null;
    chunks.forEach((chunk) => {
      if (!chunk?.typeData || typeof chunk.typeData.forEach !== 'function') {
        return;
      }
      const matches = [];
      chunk.typeData.forEach((typeData) => {
        const entries = typeData?.entries ?? [];
        entries.forEach((entry) => {
          if (!entry?.sourceObjectId) {
            return;
          }
          if (entry.sourceObjectId.toLowerCase() !== query) {
            return;
          }
          matches.push(entry);
        });
      });
      if (matches.length === 0) {
        return;
      }
      let minX = Infinity;
      let minY = Infinity;
      let minZ = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let maxZ = -Infinity;
      matches.forEach((entry) => {
        const pos = entry.position;
        if (!pos) {
          return;
        }
        minX = Math.min(minX, pos.x);
        minY = Math.min(minY, pos.y);
        minZ = Math.min(minZ, pos.z);
        maxX = Math.max(maxX, pos.x);
        maxY = Math.max(maxY, pos.y);
        maxZ = Math.max(maxZ, pos.z);
      });
      if (!Number.isFinite(minX) || !Number.isFinite(minZ)) {
        return;
      }
      const centerX = (minX + maxX) / 2;
      const centerZ = (minZ + maxZ) / 2;
      const distanceSq = computeHorizontalDistanceSq(centerX, centerZ, origin);
      if (!best || distanceSq < best.distanceSq) {
        best = {
          chunk,
          entries: matches,
          bounds: { minX, minY, minZ, maxX, maxY, maxZ },
          x: centerX,
          z: centerZ,
          distanceSq,
        };
      }
    });
    if (!best) {
      throw new Error(`No voxel object with id "${queryRaw}" is present in loaded chunks.`);
    }
    const surfaceHint = Number.isFinite(best.bounds?.maxY)
      ? best.bounds.maxY + 0.5
      : null;
    const target = computeStandingPosition({
      x: best.x,
      z: best.z,
      surfaceHint,
      offset: 0.6,
    });
    const announce = `Teleporting near voxel object ${queryRaw} (${best.entries.length} voxels) in chunk (${best.chunk.chunkX}, ${best.chunk.chunkZ}).`;
    const distance = Math.sqrt(best.distanceSq);
    const labelParts = [`Horizontal distance ≈${distance.toFixed(1)}m`];
    if (
      Number.isFinite(best.bounds?.minY) &&
      Number.isFinite(best.bounds?.maxY) &&
      best.bounds.maxY >= best.bounds.minY
    ) {
      labelParts.push(
        `Height span ≈${(best.bounds.maxY - best.bounds.minY).toFixed(2)}`,
      );
    }
    movePlayerTo(target, { announce, label: labelParts.join(' | ') });
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
    name: 'teleport',
    description:
      'Teleport relative to your view or jump to nearby biomes, fluids, and voxel objects.',
    usage:
      '/teleport <direction(step)> [...] | /teleport biome <id|name> | /teleport fluid <type> | /teleport object <id>',
    handler: ({ args }) => {
      if (!args.length) {
        throw new Error(
          'Usage: /teleport <direction(step)> [...] | /teleport biome <id|name> | /teleport fluid <type> | /teleport object <id>.',
        );
      }
      const mode = args[0].toLowerCase();
      if (mode === 'biome') {
        handleTeleportBiome(args.slice(1));
        return;
      }
      if (mode === 'fluid') {
        handleTeleportFluid(args.slice(1));
        return;
      }
      if (mode === 'object') {
        handleTeleportObject(args.slice(1));
        return;
      }
      handleRelativeTeleport(args);
    },
  });

  registerCommand({
    name: 'goto',
    description: 'Teleport the player to the specified world coordinates.',
    usage: '/goto <x> <y> <z>',
    handler: ({ args }) => {
      if (args.length < 3) {
        throw new Error('Usage: /goto <x> <y> <z>.');
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
    name: 'fluidrender',
    description: 'Switch between Hydra fluid surfaces and block-based fallback rendering.',
    usage: '/fluidrender [hydra|blocks]',
    handler: ({ args }) => {
      if (!chunkManager?.refreshChunks) {
        commandConsole.log(
          'Chunk manager does not support runtime fluid renderer changes in this build.',
        );
        return;
      }
      if (args.length === 0) {
        commandConsole.log(
          `Fluid renderer is currently set to "${getFluidRenderMode()}". Use /fluidrender hydra or /fluidrender blocks to switch.`,
        );
        return;
      }
      const mode = args[0].toLowerCase();
      if (!Object.values(FLUID_RENDER_MODES).includes(mode)) {
        throw new Error('Usage: /fluidrender [hydra|blocks].');
      }
      const previous = getFluidRenderMode();
      const next = setFluidRenderMode(mode);
      if (previous === next) {
        commandConsole.log(`Fluid renderer already set to "${next}".`);
        return;
      }
      commandConsole.log(
        `Fluid renderer switched to "${next}". Reloading visible chunks to apply the change...`,
      );
      chunkManager.refreshChunks();
      const position = playerControls.getPosition();
      chunkManager.update(position);
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

  if (import.meta.env?.DEV && typeof window !== 'undefined') {
    const debugNamespace = (window.__VOXEL_DEBUG__ = window.__VOXEL_DEBUG__ || {});

    const asciiDebug = {
      getView: (overrides) =>
        buildAsciiView({
          optionsOverride: overrides ? resolveAsciiOptions(overrides) : undefined,
        }),
      render: (overrides) => {
        const view = asciiDebug.getView(overrides);
        outputAsciiView(view);
        return view;
      },
      on: (listener) => addAsciiListener(listener),
      off: (listener) => {
        asciiListeners.delete(listener);
      },
      stop: () => stopAsciiWatch(),
      startFrame: () => startAsciiWatch({ mode: 'frame' }),
      startInterval: (ms) => {
        if (typeof ms === 'number') {
          startAsciiWatch({ mode: 'interval', intervalMs: Math.max(16, Math.round(ms)) });
        } else {
          startAsciiWatch({ mode: 'interval', intervalMs: asciiState.watch.intervalMs });
        }
      },
      status: () => ({
        mode: asciiState.watch.mode,
        intervalMs:
          asciiState.watch.mode === 'frame'
            ? null
            : asciiState.watch.activeIntervalMs ?? asciiState.watch.intervalMs,
      }),
      options: () => ({ ...cloneAsciiOptions() }),
      setOptions: (overrides = {}) => {
        asciiState.options = resolveAsciiOptions(overrides);
        return { ...asciiState.options };
      },
      lastView: () => asciiState.lastView,
      format: (view) => formatAsciiView(view ?? asciiState.lastView),
    };

    debugNamespace.ascii = Object.assign(debugNamespace.ascii ?? {}, asciiDebug);

    debugNamespace.commandConsole = Object.assign(debugNamespace.commandConsole ?? {}, {
      execute: (input) => {
        if (!input || typeof input !== 'string') {
          throw new Error('commandConsole.execute expects a string.');
        }
        const normalized = input.trim().startsWith('/') ? input : `/${input}`;
        commandConsole.executeCommand(normalized);
      },
      list: () =>
        commandConsole
          .listCommands()
          .map(({ name, description, usage }) => ({ name, description, usage })),
      getEntries: () => commandConsole.getEntries(),
      onLog: (listener) => commandConsole.addLogListener(listener),
    });
  }
}

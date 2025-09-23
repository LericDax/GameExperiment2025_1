import { renderAsciiViewport } from '../devtools/ascii-viewport.js';
import { sampleBiomeAt } from '../world/generation.js';

export function registerDeveloperCommands({
  commandConsole,
  playerControls,
}) {
  if (!commandConsole) {
    throw new Error('registerDeveloperCommands requires a commandConsole instance.');
  }
  if (!playerControls) {
    throw new Error('registerDeveloperCommands requires playerControls.');
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

  const getDebugSnapshot = () => window.__VOXEL_DEBUG__?.chunkSnapshot?.();

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

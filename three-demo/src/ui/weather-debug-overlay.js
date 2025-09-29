const OVERLAY_ID = 'weather-debug-overlay';

function ensureOverlayElement() {
  if (typeof document === 'undefined') {
    return null;
  }
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) {
    existing.classList.add('visible');
    existing.removeAttribute('aria-hidden');
    return existing;
  }

  const element = document.createElement('div');
  element.id = OVERLAY_ID;
  element.className = 'weather-debug-overlay';
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  element.innerHTML = `
    <header class="weather-debug-overlay__header">Weather Diagnostics</header>
    <div class="weather-debug-overlay__body">
      <div class="weather-debug-overlay__line" data-field="preset">Preset: —</div>
      <div class="weather-debug-overlay__line" data-field="suppression">Suppression: —</div>
      <div class="weather-debug-overlay__line" data-field="emitters">Emitters: —</div>
      <div class="weather-debug-overlay__line" data-field="anchor">Last anchor update: —</div>
      <div class="weather-debug-overlay__line" data-field="failures">Failures: —</div>
      <div class="weather-debug-overlay__line" data-field="debug">Debug sample: —</div>
    </div>
  `;
  document.body.appendChild(element);
  return element;
}

function formatTime(value) {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }
  return `${value.toFixed(2)}s`;
}

function describePreset(weatherState) {
  if (!weatherState) {
    return 'Preset: unavailable';
  }
  const label = weatherState.label ?? weatherState.id ?? 'Unknown';
  const idSuffix = weatherState.id ? ` [${weatherState.id}]` : '';
  const intensity = Number.isFinite(weatherState.intensity)
    ? ` — intensity ${weatherState.intensity.toFixed(2)}`
    : '';
  return `Preset: ${label}${idSuffix}${intensity}`;
}

function describeSuppression(weatherState) {
  const suppressed = Boolean(weatherState?.overridesSuppressed);
  const suppressionState = suppressed ? 'ACTIVE (overrides paused)' : 'INACTIVE';
  return `Suppression: ${suppressionState}`;
}

function describeEmitters(weatherState, stats) {
  if (!stats) {
    const fallbackCount = weatherState?.activeEmitterCount ?? 0;
    return `Emitters: ${fallbackCount} weather (no particle stats available)`;
  }
  const weatherCount = stats.weatherCount ?? weatherState?.activeEmitterCount ?? 0;
  const totalEmittersText = Number.isFinite(stats.totalEmitters)
    ? `${weatherCount}/${stats.totalEmitters} weather/total`
    : `${weatherCount} weather`;
  const particles = Number.isFinite(stats.weatherParticles)
    ? `, particles=${stats.weatherParticles}`
    : stats.weatherParticles === 0
    ? ', particles=0'
    : ', particles=n/a';
  const summaryLines = [`Emitters: ${totalEmittersText}${particles}`];
  if (Array.isArray(stats.emitters) && stats.emitters.length > 0) {
    stats.emitters.forEach((emitter, index) => {
      summaryLines.push(
        `  #${index + 1} ${emitter.label} — particles=${emitter.particles}${emitter.status}`,
      );
    });
    if (stats.extraCount > 0) {
      summaryLines.push(`  (+${stats.extraCount} more weather emitters hidden)`);
    }
  }
  return summaryLines.join('\n');
}

function describeAnchor(weatherState) {
  if (!weatherState) {
    return 'Last anchor update: n/a';
  }
  const timestamp = formatTime(weatherState.lastAnchorUpdate);
  const lastSpawn = weatherState.lastPrecipitationSpawn
    ? `${weatherState.lastPrecipitationSpawn.type} @ ${formatTime(
        weatherState.lastPrecipitationSpawn.elapsedTime,
      )}`
    : null;
  return lastSpawn
    ? `Last anchor update: ${timestamp} (spawned ${lastSpawn})`
    : `Last anchor update: ${timestamp}`;
}

function describeFailures(weatherState) {
  if (!weatherState) {
    return 'Failures: n/a';
  }
  const failures = Number.isFinite(weatherState.failedPrecipitationSpawns)
    ? weatherState.failedPrecipitationSpawns
    : 0;
  if (failures <= 0) {
    return 'Failures: none';
  }
  const recent = weatherState.lastPrecipitationFailure ?? null;
  if (!recent) {
    return `Failures: ${failures}`;
  }
  const type = recent.type ?? 'unknown';
  return `Failures: ${failures} (last ${type} @ ${formatTime(recent.elapsedTime)})`;
}

function describeDebugSample(weatherState, stats) {
  const sampledAt = Number.isFinite(weatherState?.lastDebugSample)
    ? formatTime(weatherState.lastDebugSample)
    : 'n/a';
  const overlayAt = Number.isFinite(weatherState?.lastOverlayUpdate)
    ? formatTime(weatherState.lastOverlayUpdate)
    : 'n/a';
  const particles = Number.isFinite(stats?.weatherParticles)
    ? stats.weatherParticles
    : weatherState?.totalActiveParticles;
  const particleLine = Number.isFinite(particles) ? `particles=${particles}` : 'particles=n/a';
  return `Debug sample: overlay=${overlayAt}, stats=${sampledAt}, ${particleLine}`;
}

export function createWeatherDebugOverlay() {
  const element = ensureOverlayElement();
  if (!element) {
    return {
      update() {},
      dispose() {},
    };
  }

  const fields = element.querySelectorAll('[data-field]');
  const fieldMap = new Map();
  fields.forEach((field) => {
    const key = field.getAttribute('data-field');
    if (key) {
      fieldMap.set(key, field);
    }
  });

  const updateField = (key, value) => {
    const target = fieldMap.get(key);
    if (target) {
      target.textContent = value;
    }
  };

  return {
    update({ weatherState = null, stats = null } = {}) {
      updateField('preset', describePreset(weatherState));
      updateField('suppression', describeSuppression(weatherState));
      updateField('emitters', describeEmitters(weatherState, stats));
      updateField('anchor', describeAnchor(weatherState));
      updateField('failures', describeFailures(weatherState));
      updateField('debug', describeDebugSample(weatherState, stats));
    },
    dispose() {
      fieldMap.clear();
      if (element.parentElement) {
        element.parentElement.removeChild(element);
      }
    },
  };
}

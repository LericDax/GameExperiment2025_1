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
      <div class="weather-debug-overlay__line" data-field="precipitation">Precipitation: —</div>
      <div class="weather-debug-overlay__line" data-field="anchor">Last anchor update: —</div>
      <div class="weather-debug-overlay__line" data-field="failures">Failures: —</div>
      <div class="weather-debug-overlay__line" data-field="harness">Harness: —</div>
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
  const recoveries = Number.isFinite(weatherState.precipitationRecoveryAttempts)
    ? weatherState.precipitationRecoveryAttempts
    : 0;
  if (failures <= 0) {
    return recoveries > 0
      ? `Failures: none (recoveries=${recoveries})`
      : 'Failures: none';
  }
  const recent = weatherState.lastPrecipitationFailure ?? null;
  if (!recent) {
    return recoveries > 0
      ? `Failures: ${failures} (recoveries=${recoveries})`
      : `Failures: ${failures}`;
  }
  const type = recent.type ?? 'unknown';
  const reason = recent.reason ? `, reason=${recent.reason}` : '';
  const recoveriesText = recoveries > 0 ? `, recoveries=${recoveries}` : '';
  return `Failures: ${failures} (last ${type} @ ${formatTime(recent.elapsedTime)}${reason}${recoveriesText})`;
}

function describePrecipitation(weatherState) {
  const emitters = Array.isArray(weatherState?.precipitationEmitters)
    ? weatherState.precipitationEmitters
    : [];
  const totalParticles = Number.isFinite(weatherState?.precipitationActiveParticles)
    ? weatherState.precipitationActiveParticles
    : null;
  const recoveries = Number.isFinite(weatherState?.precipitationRecoveryAttempts)
    ? weatherState.precipitationRecoveryAttempts
    : 0;
  if (emitters.length === 0) {
    const baseSummary = totalParticles === 0 || totalParticles === null
      ? 'Precipitation: none active'
      : `Precipitation: none active (particles=${totalParticles})`;
    const failure = weatherState?.lastPrecipitationFailure ?? null;
    if (failure) {
      const reason = failure.reason ? `, reason=${failure.reason}` : '';
      return `${baseSummary}. Last failure ${failure.type ?? 'unknown'} @ ${formatTime(
        failure.elapsedTime,
      )}${reason}.`;
    }
    return recoveries > 0
      ? `${baseSummary} (recoveries=${recoveries}).`
      : `${baseSummary}.`;
  }
  const summaryParts = [`Precipitation: ${emitters.length} active`];
  if (Number.isFinite(totalParticles)) {
    summaryParts.push(`particles=${totalParticles}`);
  }
  if (recoveries > 0) {
    summaryParts.push(`recoveries=${recoveries}`);
  }
  const lines = [`${summaryParts.join(', ')}.`];
  emitters.forEach((emitter, index) => {
    const label = emitter.label ?? `Emitter #${index + 1}`;
    const type = emitter.type ?? 'precipitation';
    const particles = Number.isFinite(emitter.particles)
      ? emitter.particles
      : emitter.particles === 0
      ? 0
      : 'n/a';
    const attempts = Number.isFinite(emitter.attempts) ? emitter.attempts : '?';
    const maxAttempts = Number.isFinite(emitter.maxAttempts) ? emitter.maxAttempts : '?';
    const status = emitter.status ?? 'unknown';
    const retryText = Number.isFinite(emitter.nextRetryIn)
      ? `, retry in ${formatTime(emitter.nextRetryIn)}`
      : '';
    const spawnedText = Number.isFinite(emitter.spawnedAt)
      ? `, spawned @ ${formatTime(emitter.spawnedAt)}`
      : '';
    lines.push(
      `  #${index + 1} ${label} (${type}) — particles=${particles}, attempt ${attempts}/${maxAttempts}, status=${status}${retryText}${spawnedText}.`,
    );
  });
  const failure = weatherState?.lastPrecipitationFailure ?? null;
  if (failure) {
    const reason = failure.reason ? `, reason=${failure.reason}` : '';
    lines.push(
      `  Last failure: ${failure.type ?? 'unknown'} @ ${formatTime(failure.elapsedTime)}${reason}.`,
    );
  }
  return lines.join('\n');
}

function describeHarness(weatherState) {
  const harness = weatherState?.rotationHarness ?? null;
  if (!harness || !harness.active) {
    return 'Harness: inactive';
  }
  const label = harness.label || (harness.biomeId ? `Biome ${harness.biomeId}` : 'Rotation');
  const size = Number.isFinite(harness.size) ? harness.size : 0;
  const index = Number.isFinite(harness.index) ? harness.index + 1 : '?';
  const countText = size > 0 ? `${index}/${size}` : `${index}`;
  const nextId = harness.nextWeatherId ?? 'n/a';
  const remaining = Number.isFinite(harness.remaining) ? formatTime(harness.remaining) : 'n/a';
  const cycles = Number.isFinite(harness.cycleCount) ? harness.cycleCount : 0;
  return `Harness: ${label} — preset ${countText}, next ${nextId} in ${remaining} (cycles=${cycles}).`;
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
  const precipitationParticles = Number.isFinite(weatherState?.precipitationActiveParticles)
    ? weatherState.precipitationActiveParticles
    : Number.isFinite(stats?.precipitation?.totalParticles)
    ? stats.precipitation.totalParticles
    : null;
  const precipitationLine = Number.isFinite(precipitationParticles)
    ? `, precipitationParticles=${precipitationParticles}`
    : '';
  return `Debug sample: overlay=${overlayAt}, stats=${sampledAt}, ${particleLine}${precipitationLine}`;
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
      updateField('precipitation', describePrecipitation(weatherState));
      updateField('anchor', describeAnchor(weatherState));
      updateField('failures', describeFailures(weatherState));
      updateField('harness', describeHarness(weatherState));
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

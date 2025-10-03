import { EventEmitter } from 'node:events';

const EMPTY_CONFIG = Object.freeze({ states: {}, abilities: {} });

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const CLONE = (value) => {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => CLONE(entry));
  }
  if (isObject(value)) {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = CLONE(entry);
    }
    return result;
  }
  return value;
};

const pick = (source, keys) => {
  if (!source || typeof source !== 'object') {
    return {};
  }
  const result = {};
  for (const key of keys) {
    if (key in source) {
      result[key] = CLONE(source[key]);
    }
  }
  return result;
};

export const DEFAULT_PRESENTATION_MAPPING = Object.freeze({
  states: Object.freeze({
    idle: Object.freeze({
      animation: Object.freeze({
        directional: Object.freeze({
          default: 'idle',
          forward: 'idle',
          left: 'idle-turn-left',
          right: 'idle-turn-right',
        }),
        fadeDuration: 0.35,
      }),
      sounds: Object.freeze([{ id: 'entity_idle_loop', options: { channel: 'foley', loop: true } }]),
      particles: Object.freeze([]),
    }),
    wander: Object.freeze({
      animation: Object.freeze({
        directional: Object.freeze({
          default: 'wander',
          forward: 'wander',
          left: 'wander-strafe-left',
          right: 'wander-strafe-right',
        }),
        fadeDuration: 0.25,
      }),
      sounds: Object.freeze([{ id: 'entity_walk', options: { channel: 'movement', loop: true } }]),
      particles: Object.freeze([]),
    }),
    chase: Object.freeze({
      animation: Object.freeze({
        directional: Object.freeze({
          default: 'chase',
          forward: 'chase',
          left: 'chase-strafe-left',
          right: 'chase-strafe-right',
        }),
        fadeDuration: 0.15,
      }),
      sounds: Object.freeze([{ id: 'entity_chase', options: { channel: 'foley', loop: true } }]),
      particles: Object.freeze([]),
    }),
  }),
  abilities: Object.freeze({
    howl: Object.freeze({
      animation: Object.freeze({ variant: 'howl', loopMode: 'LoopOnce', fadeDuration: 0 }),
      sounds: Object.freeze([{ id: 'entity_howl', options: { channel: 'voice' } }]),
      particles: Object.freeze([{ id: 'howl_burst', options: { count: 36 } }]),
    }),
  }),
});

const normalizeCueList = (value) => {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeCue(entry))
      .filter((entry) => entry && typeof entry.id === 'string' && entry.id.length > 0);
  }
  const single = normalizeCue(value);
  return single ? [single] : [];
};

const normalizeCue = (value) => {
  if (!value) {
    return null;
  }
  if (typeof value === 'string') {
    return { id: value, options: {} };
  }
  if (isObject(value)) {
    if (typeof value.id !== 'string' || value.id.length === 0) {
      return null;
    }
    return { id: value.id, options: isObject(value.options) ? { ...value.options } : {} };
  }
  return null;
};

const clonePresentationEntry = (entry) => {
  if (!isObject(entry)) {
    return {};
  }
  const result = {};
  if ('animation' in entry) {
    result.animation = isObject(entry.animation) || typeof entry.animation === 'string'
      ? CLONE(entry.animation)
      : entry.animation;
  }
  if ('stopAnimation' in entry) {
    result.stopAnimation = isObject(entry.stopAnimation)
      ? { ...entry.stopAnimation }
      : Boolean(entry.stopAnimation);
  }
  if ('sounds' in entry) {
    result.sounds = normalizeCueList(entry.sounds);
  }
  if ('particles' in entry) {
    result.particles = normalizeCueList(entry.particles);
  }
  if ('enter' in entry) {
    result.enter = clonePresentationEntry(entry.enter);
  }
  if ('exit' in entry) {
    result.exit = clonePresentationEntry(entry.exit);
  }
  return result;
};

export const mergePresentationConfigs = (...configs) => {
  const merged = { states: {}, abilities: {} };
  for (const config of configs) {
    if (!config || typeof config !== 'object') {
      continue;
    }
    if (config.states && typeof config.states === 'object') {
      for (const [key, value] of Object.entries(config.states)) {
        if (!merged.states[key]) {
          merged.states[key] = clonePresentationEntry(value);
        } else {
          merged.states[key] = mergeEntry(merged.states[key], value);
        }
      }
    }
    if (config.abilities && typeof config.abilities === 'object') {
      for (const [key, value] of Object.entries(config.abilities)) {
        if (!merged.abilities[key]) {
          merged.abilities[key] = clonePresentationEntry(value);
        } else {
          merged.abilities[key] = mergeEntry(merged.abilities[key], value);
        }
      }
    }
  }
  return merged;
};

const mergeEntry = (base, override) => {
  if (!isObject(override)) {
    return base;
  }
  const result = { ...base };
  if ('animation' in override) {
    result.animation = isObject(override.animation) || typeof override.animation === 'string'
      ? CLONE(override.animation)
      : override.animation;
  }
  if ('stopAnimation' in override) {
    result.stopAnimation = isObject(override.stopAnimation)
      ? { ...override.stopAnimation }
      : Boolean(override.stopAnimation);
  }
  if ('sounds' in override) {
    result.sounds = normalizeCueList(override.sounds);
  }
  if ('particles' in override) {
    result.particles = normalizeCueList(override.particles);
  }
  if ('enter' in override) {
    result.enter = mergeEntry(result.enter ?? {}, override.enter);
  }
  if ('exit' in override) {
    result.exit = mergeEntry(result.exit ?? {}, override.exit);
  }
  return result;
};

const DIRECTION_DEFAULTS = Object.freeze({
  yawDeadzone: 0.2,
  axisEpsilon: 0.1,
});

const toLowerKey = (value) => (typeof value === 'string' ? value.toLowerCase() : value);

export class AIPresentationAdapter {
  constructor(options = {}) {
    const {
      ai = null,
      animationController = null,
      audioEmitters = [],
      particleEmitters = [],
      config = EMPTY_CONFIG,
      personaConfig = null,
      traitConfigs = [],
      directionThresholds = {},
    } = options;

    this.ai = ai instanceof EventEmitter ? ai : ai?.events ?? ai;
    this.animationController = animationController ?? null;
    this.audioEmitters = Array.isArray(audioEmitters) ? [...audioEmitters] : [audioEmitters].filter(Boolean);
    this.particleEmitters = Array.isArray(particleEmitters)
      ? [...particleEmitters]
      : [particleEmitters].filter(Boolean);
    this.directionThresholds = {
      yawDeadzone: Number.isFinite(directionThresholds.yawDeadzone)
        ? directionThresholds.yawDeadzone
        : DIRECTION_DEFAULTS.yawDeadzone,
      axisEpsilon: Number.isFinite(directionThresholds.axisEpsilon)
        ? directionThresholds.axisEpsilon
        : DIRECTION_DEFAULTS.axisEpsilon,
    };

    this.baseConfig = mergePresentationConfigs(DEFAULT_PRESENTATION_MAPPING, config ?? {});
    this.personaConfig = personaConfig ? mergePresentationConfigs(personaConfig) : { states: {}, abilities: {} };
    this.traitConfigs = Array.isArray(traitConfigs)
      ? traitConfigs.map((entry) => mergePresentationConfigs(entry))
      : [];

    this.config = this.#composeActiveConfig();

    this.listeners = [];
    if (this.ai?.on) {
      this.#bindEvents();
    }
  }

  setPersonaConfig(config) {
    this.personaConfig = config ? mergePresentationConfigs(config) : { states: {}, abilities: {} };
    this.config = this.#composeActiveConfig();
  }

  setTraitConfigs(configs = []) {
    if (!Array.isArray(configs)) {
      this.traitConfigs = [];
    } else {
      this.traitConfigs = configs.map((entry) => mergePresentationConfigs(entry));
    }
    this.config = this.#composeActiveConfig();
  }

  updateBaseConfig(config = {}) {
    this.baseConfig = mergePresentationConfigs(DEFAULT_PRESENTATION_MAPPING, config ?? {});
    this.config = this.#composeActiveConfig();
  }

  dispose() {
    if (this.ai?.off && this.listeners.length > 0) {
      for (const { event, handler } of this.listeners) {
        this.ai.off(event, handler);
      }
    }
    this.listeners.length = 0;
  }

  #composeActiveConfig() {
    return mergePresentationConfigs(
      this.baseConfig,
      this.personaConfig,
      ...this.traitConfigs,
    );
  }

  #bindEvents() {
    const register = (event, handler) => {
      const bound = handler.bind(this);
      this.listeners.push({ event, handler: bound });
      this.ai.on(event, bound);
    };

    register('behavior:stateEnter', this.#onStateEnter);
    register('behavior:stateExit', this.#onStateExit);
    register('ability:used', this.#onAbilityUsed);
    register('ability:spent', this.#onAbilityUsed);
  }

  #onStateEnter(payload = {}) {
    const entry = this.#resolveStateEntry(payload);
    const config = entry?.enter ?? entry;
    if (!config) {
      return;
    }
    this.#applyPresentation(config, payload, { event: 'stateEnter', state: payload.state ?? payload.stateId });
  }

  #onStateExit(payload = {}) {
    const entry = this.#resolveStateEntry(payload);
    if (!entry) {
      return;
    }
    const exitConfig = entry.exit ?? entry.onExit ?? null;
    if (exitConfig) {
      this.#applyPresentation(exitConfig, payload, {
        event: 'stateExit',
        state: payload.state ?? payload.stateId,
      });
      return;
    }
    if (entry?.stopAnimation) {
      this.#applyPresentation({ stopAnimation: entry.stopAnimation }, payload, {
        event: 'stateExit',
        state: payload.state ?? payload.stateId,
      });
    }
  }

  #onAbilityUsed(payload = {}) {
    const abilityName = this.#extractAbilityName(payload);
    if (!abilityName) {
      return;
    }
    const entry = this.#resolveAbilityEntry(abilityName);
    if (!entry) {
      return;
    }
    this.#applyPresentation(entry, payload, { event: 'ability', ability: abilityName });
  }

  #resolveStateEntry(payload = {}) {
    const stateId = payload.state ?? payload.stateId ?? payload.id ?? null;
    const behaviorId = payload.behavior ?? payload.loop ?? payload.layer ?? payload.behaviorId ?? null;
    const keys = [];
    if (behaviorId && stateId) {
      keys.push(`${behaviorId}:${stateId}`);
      keys.push(`${behaviorId}`);
    }
    if (stateId) {
      keys.push(stateId);
    }
    keys.push('default');
    for (const key of keys) {
      if (key && this.config.states[key]) {
        return this.config.states[key];
      }
    }
    return null;
  }

  #resolveAbilityEntry(name) {
    const keys = [name, toLowerKey(name)];
    for (const key of keys) {
      if (key && this.config.abilities[key]) {
        return this.config.abilities[key];
      }
    }
    return null;
  }

  #applyPresentation(entry = {}, payload, meta) {
    const normalized = this.#normalizePhaseEntry(entry, payload);
    if (normalized.stopAnimation) {
      this.animationController?.stop?.(
        isObject(normalized.stopAnimation) ? { ...normalized.stopAnimation } : {},
      );
    }
    if (normalized.animation) {
      const descriptor = this.#resolveAnimationDescriptor(normalized.animation, payload);
      if (descriptor?.variant) {
        const options = pick(descriptor, ['fadeDuration', 'loopMode', 'clampWhenFinished', 'fallbackToDefault']);
        this.animationController?.playVariant?.(descriptor.variant, options);
      }
    }
    if (normalized.sounds?.length) {
      this.#emitCues(this.audioEmitters, normalized.sounds, payload, meta);
    }
    if (normalized.particles?.length) {
      this.#emitCues(this.particleEmitters, normalized.particles, payload, meta);
    }
  }

  #normalizePhaseEntry(entry, payload) {
    if (!entry || typeof entry !== 'object') {
      return {};
    }
    const result = { ...entry };
    if (entry.enter || entry.exit) {
      return this.#normalizePhaseEntry(entry.enter ?? entry, payload);
    }
    if ('sounds' in entry) {
      result.sounds = normalizeCueList(entry.sounds);
    }
    if ('particles' in entry) {
      result.particles = normalizeCueList(entry.particles);
    }
    if ('animation' in entry && isObject(entry.animation)) {
      result.animation = { ...entry.animation };
    }
    if ('stopAnimation' in entry && isObject(entry.stopAnimation)) {
      result.stopAnimation = { ...entry.stopAnimation };
    }
    return result;
  }

  #emitCues(targets, cues, payload, meta) {
    if (!targets || targets.length === 0) {
      return;
    }
    for (const cue of cues) {
      for (const target of targets) {
        if (typeof target === 'function') {
          target({ id: cue.id, options: cue.options ?? {}, payload, meta });
        } else if (target && typeof target.emit === 'function') {
          target.emit('cue', { id: cue.id, options: cue.options ?? {}, payload, meta });
        } else if (target && typeof target.play === 'function') {
          target.play(cue.id, cue.options ?? {}, payload, meta);
        }
      }
    }
  }

  #resolveAnimationDescriptor(animation, payload) {
    if (!animation) {
      return null;
    }
    if (typeof animation === 'string') {
      return { variant: animation };
    }
    const descriptor = { ...animation };
    if (!descriptor.variant) {
      descriptor.variant = this.#resolveDirectionalVariant(descriptor, payload);
    }
    if (!descriptor.variant && typeof descriptor.default === 'string') {
      descriptor.variant = descriptor.default;
    }
    return descriptor.variant ? descriptor : null;
  }

  #resolveDirectionalVariant(descriptor, payload) {
    const directional = descriptor.directional ?? descriptor.variants ?? descriptor.variantMap;
    if (!isObject(directional)) {
      return descriptor.variantId ?? descriptor.id ?? null;
    }
    const direction = this.#resolveDirection(payload, descriptor);
    const normalized = toLowerKey(direction ?? 'default');
    return (
      directional[normalized] ??
      directional[direction] ??
      directional.default ??
      directional.forward ??
      descriptor.variantId ??
      descriptor.variant ??
      descriptor.id ??
      null
    );
  }

  #resolveDirection(payload = {}, descriptor = {}) {
    const explicit = this.#extractExplicitDirection(payload);
    if (explicit) {
      return explicit;
    }
    const yawOffset = this.#extractYawOffset(payload, descriptor);
    if (Number.isFinite(yawOffset)) {
      const abs = Math.abs(yawOffset);
      if (abs <= this.directionThresholds.yawDeadzone) {
        return 'forward';
      }
      if (yawOffset > 0) {
        return 'right';
      }
      if (yawOffset < 0) {
        return 'left';
      }
    }
    const vector = this.#extractMovementVector(payload);
    if (vector) {
      const { x = 0, z = 0 } = vector;
      const absX = Math.abs(x);
      const absZ = Math.abs(z);
      if (absX <= this.directionThresholds.axisEpsilon && absZ <= this.directionThresholds.axisEpsilon) {
        return 'default';
      }
      if (absX > absZ) {
        return x >= 0 ? 'right' : 'left';
      }
      if (absZ > 0) {
        if (z > 0) {
          return 'forward';
        }
        if (z < 0) {
          return 'back';
        }
      }
    }
    return 'default';
  }

  #extractExplicitDirection(payload) {
    const candidates = [
      payload.direction,
      payload.intent?.direction,
      payload.intent?.movementDirection,
      payload.intent?.movement?.direction,
      payload.intent?.movement?.cardinal,
      payload.intents?.movement?.direction,
      payload.intents?.movementDirection,
      payload.movement?.direction,
      payload.cardinal,
    ];
    for (const value of candidates) {
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
    return null;
  }

  #extractYawOffset(payload, descriptor = {}) {
    const candidates = [
      payload.intent?.visualYawOffset,
      payload.intent?.yawOffset,
      payload.visualYawOffset,
      payload.yawOffset,
      payload.intents?.movement?.visualYawOffset,
      payload.movement?.visualYawOffset,
      descriptor.visualYawOffset,
    ];
    for (const value of candidates) {
      if (Number.isFinite(value)) {
        return value;
      }
    }
    return null;
  }

  #extractMovementVector(payload = {}) {
    const candidates = [
      payload.intent?.movement?.vector,
      payload.intents?.movement?.vector,
      payload.movement?.vector,
      payload.intent?.vector,
      payload.vector,
    ];
    for (const vector of candidates) {
      if (vector && typeof vector === 'object') {
        const { x = 0, z = 0 } = vector;
        if (Number.isFinite(x) || Number.isFinite(z)) {
          return { x: Number(x) || 0, z: Number(z) || 0 };
        }
      }
    }
    return null;
  }

  #extractAbilityName(payload = {}) {
    const candidates = [
      payload.ability?.name,
      payload.ability?.id,
      payload.name,
      payload.id,
      payload.abilityName,
    ];
    for (const value of candidates) {
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
    return null;
  }
}

export default AIPresentationAdapter;

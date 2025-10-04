import { validateBehaviorSet } from '../behavior-schema.js';
import { spectralRunnerPersona } from './spectral-runner.js';

const BUILT_IN_PERSONAS = [spectralRunnerPersona];

const deepClone = (value) => {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
};

const normalizeTraitList = (traits = []) => {
  if (!Array.isArray(traits)) {
    throw new Error('Persona traits must be provided as an array.');
  }

  return traits.map((entry) => {
    if (typeof entry === 'string') {
      return { name: entry, options: {} };
    }
    if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string') {
      throw new Error('Trait entries must specify a "name".');
    }
    return {
      name: entry.name,
      options: entry.options && typeof entry.options === 'object' ? { ...entry.options } : {},
    };
  });
};

const normalizeSensors = (sensors = {}) => {
  if (sensors === null) {
    return { presets: [] };
  }
  if (typeof sensors !== 'object') {
    throw new Error('Persona sensors must be described with an object.');
  }
  const presets = Array.isArray(sensors.presets) ? [...new Set(sensors.presets.map(String))] : [];
  const { presets: _omitted, ...rest } = sensors;
  return {
    presets,
    ...rest,
  };
};

const normalizeResourceDefinition = (config) => {
  if (config === null || config === undefined) {
    return null;
  }
  if (typeof config === 'number') {
    if (config < 0) {
      throw new Error('Resource caps cannot be negative.');
    }
    return {
      max: config,
      initial: config,
      regen: 0,
    };
  }
  if (typeof config !== 'object') {
    throw new Error('Resource configuration must be numeric or an object.');
  }
  const max = config.max !== undefined ? Number(config.max) : undefined;
  const initial = config.initial ?? config.current ?? max ?? 0;
  const regen = config.regen !== undefined ? Number(config.regen) : 0;
  if (max !== undefined && (!Number.isFinite(max) || max < 0)) {
    throw new Error('Resource max must be a non-negative finite number when provided.');
  }
  if (!Number.isFinite(initial) || initial < 0) {
    throw new Error('Resource initial value must be a non-negative finite number.');
  }
  if (!Number.isFinite(regen)) {
    throw new Error('Resource regeneration rate must be finite.');
  }
  const cappedInitial = max !== undefined ? Math.min(initial, max) : initial;
  return {
    max: max ?? cappedInitial,
    initial: cappedInitial,
    regen,
  };
};

const normalizeResourcePatch = (config) => {
  if (config === null || config === undefined) {
    return {};
  }
  if (typeof config === 'number') {
    if (config < 0) {
      throw new Error('Resource caps cannot be negative.');
    }
    return { max: config };
  }
  if (typeof config !== 'object') {
    throw new Error('Resource configuration must be numeric or an object.');
  }
  const patch = {};
  if (config.max !== undefined) {
    const max = Number(config.max);
    if (!Number.isFinite(max) || max < 0) {
      throw new Error('Resource max must be a non-negative finite number when provided.');
    }
    patch.max = max;
  }
  if (config.initial !== undefined || config.current !== undefined) {
    const initial = Number(config.initial ?? config.current);
    if (!Number.isFinite(initial) || initial < 0) {
      throw new Error('Resource initial value must be a non-negative finite number.');
    }
    patch.initial = initial;
  }
  if (config.regen !== undefined) {
    const regen = Number(config.regen);
    if (!Number.isFinite(regen)) {
      throw new Error('Resource regeneration rate must be finite.');
    }
    patch.regen = regen;
  }
  return patch;
};

const normalizeResources = (resources = {}, { partial = false } = {}) => {
  if (resources === null) {
    return {};
  }
  if (typeof resources !== 'object') {
    throw new Error('Persona resources must be described with an object.');
  }
  const normalized = {};
  for (const [name, config] of Object.entries(resources)) {
    const entry = partial ? normalizeResourcePatch(config) : normalizeResourceDefinition(config);
    if (entry) {
      normalized[name] = entry;
    }
  }
  return normalized;
};

const mergeTraitLists = (base = [], overrides = []) => {
  const merged = new Map();
  for (const trait of base) {
    merged.set(trait.name, {
      name: trait.name,
      options: { ...trait.options },
    });
  }
  for (const trait of overrides) {
    const existing = merged.get(trait.name) ?? { name: trait.name, options: {} };
    merged.set(trait.name, {
      name: trait.name,
      options: { ...existing.options, ...trait.options },
    });
  }
  return Array.from(merged.values());
};

const mergeSensors = (base = {}, overrides = {}) => {
  const basePresets = new Set(base.presets ?? []);
  for (const preset of overrides.presets ?? []) {
    basePresets.add(preset);
  }
  const { presets: _base, ...baseRest } = base;
  const { presets: _override, ...overrideRest } = overrides;
  return {
    ...baseRest,
    ...overrideRest,
    presets: [...basePresets],
  };
};

const mergeResources = (base = {}, overrides = {}) => {
  const merged = {};
  for (const [name, config] of Object.entries(base)) {
    merged[name] = { ...config };
  }
  for (const [name, config] of Object.entries(overrides)) {
    if (!config || Object.keys(config).length === 0) {
      continue;
    }
    const target = merged[name] ?? { max: 0, initial: 0, regen: 0 };
    const next = { ...target };
    if (config.max !== undefined) {
      next.max = config.max;
    }
    if (config.initial !== undefined) {
      next.initial = config.initial;
    }
    if (config.regen !== undefined) {
      next.regen = config.regen;
    }
    if (next.max !== undefined && next.initial !== undefined && next.max < next.initial) {
      next.initial = next.max;
    }
    merged[name] = next;
  }
  return merged;
};

const mergeBehaviors = (base = [], overrides = []) => {
  const merged = new Map();
  for (const behavior of base) {
    merged.set(behavior.name, deepClone(behavior));
  }
  for (const behavior of overrides) {
    merged.set(behavior.name, deepClone(behavior));
  }
  return Array.from(merged.values());
};

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const mergeMetadata = (base = {}, overrides = {}) => {
  const result = isPlainObject(base) ? { ...base } : {};
  if (!isPlainObject(overrides)) {
    return result;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = mergeMetadata(result[key], value);
    } else if (Array.isArray(value)) {
      result[key] = value.slice();
    } else {
      result[key] = value;
    }
  }
  return result;
};

const normalizePersona = (persona) => {
  if (!persona || typeof persona !== 'object') {
    throw new Error('Persona definition must be an object.');
  }
  if (!persona.name || typeof persona.name !== 'string') {
    throw new Error('Persona definition requires a "name".');
  }

  const traits = persona.traits ? normalizeTraitList(persona.traits) : [];
  const sensors = normalizeSensors(persona.sensors ?? {});
  const resources = normalizeResources(persona.resources ?? {});
  const behaviors = persona.behaviors ? validateBehaviorSet(persona.behaviors) : [];

  return {
    name: persona.name,
    label: persona.label ?? persona.name,
    description: persona.description ?? '',
    traits,
    sensors,
    resources,
    behaviors,
    metadata: persona.metadata && typeof persona.metadata === 'object' ? { ...persona.metadata } : {},
  };
};

const normalizePersonaOverrides = (overrides = {}) => {
  const normalized = {};
  if (overrides.name) {
    normalized.name = overrides.name;
  }
  if (overrides.label !== undefined) {
    normalized.label = overrides.label;
  }
  if (overrides.description !== undefined) {
    normalized.description = overrides.description;
  }
  if (overrides.metadata !== undefined) {
    normalized.metadata =
      overrides.metadata && typeof overrides.metadata === 'object'
        ? { ...overrides.metadata }
        : {};
  }
  if (overrides.traits !== undefined) {
    normalized.traits = normalizeTraitList(overrides.traits);
  }
  if (overrides.sensors !== undefined) {
    normalized.sensors = normalizeSensors(overrides.sensors);
  }
  if (overrides.resources !== undefined) {
    normalized.resources = normalizeResources(overrides.resources, { partial: true });
  }
  if (overrides.behaviors !== undefined) {
    normalized.behaviors = validateBehaviorSet(overrides.behaviors);
  }
  return normalized;
};

const mergePersona = (base, overrides = {}) => {
  const normalizedOverrides = normalizePersonaOverrides(overrides);
  const traits = mergeTraitLists(base.traits, normalizedOverrides.traits ?? []);
  const sensors = mergeSensors(base.sensors, normalizedOverrides.sensors ?? {});
  const resources = mergeResources(base.resources, normalizedOverrides.resources ?? {});
  const behaviors = mergeBehaviors(base.behaviors, normalizedOverrides.behaviors ?? []);

  const metadata =
    normalizedOverrides.metadata !== undefined
      ? mergeMetadata(base.metadata ?? {}, normalizedOverrides.metadata ?? {})
      : { ...base.metadata };

  return {
    name: normalizedOverrides.name ?? base.name,
    label: normalizedOverrides.label ?? base.label,
    description: normalizedOverrides.description ?? base.description,
    metadata,
    traits,
    sensors,
    resources,
    behaviors,
  };
};

export class PersonaRegistry {
  constructor(initialPersonas = BUILT_IN_PERSONAS) {
    this.personas = new Map();
    initialPersonas.forEach((persona) => this.register(persona));
  }

  register(persona) {
    const normalized = normalizePersona(persona);
    this.personas.set(normalized.name, normalized);
    return normalized;
  }

  has(name) {
    return this.personas.has(name);
  }

  get(name) {
    return this.personas.get(name);
  }

  list() {
    return Array.from(this.personas.values(), (persona) => deepClone(persona));
  }

  create(reference, overrides = {}) {
    if (typeof reference === 'string') {
      const base = this.get(reference);
      if (!base) {
        throw new Error(`Unknown persona "${reference}".`);
      }
      return mergePersona(deepClone(base), overrides);
    }

    if (reference && typeof reference === 'object') {
      if (reference.name && this.has(reference.name)) {
        return mergePersona(deepClone(this.get(reference.name)), { ...reference, ...overrides });
      }
      return normalizePersona({ ...reference, ...overrides });
    }

    throw new Error('Persona reference must be a string name or object definition.');
  }
}

export const defaultPersonas = BUILT_IN_PERSONAS.map((persona) => normalizePersona(persona));

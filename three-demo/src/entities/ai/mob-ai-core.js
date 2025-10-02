import { EventEmitter } from 'node:events';
import { BehaviorRegistry } from './behavior-nodes.js';
import { PersonaRegistry } from './personas/persona-registry.js';
import { defaultTraits } from './traits/index.js';
import { AmbientTaskScheduler } from './environment/ambient-task-scheduler.js';

const deepClone = (value) => {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
};

const normalizeTraitDefinition = (name, trait) => {
  const definition =
    trait && typeof trait === 'object'
      ? trait
      : {
          name,
          apply: typeof trait === 'function' ? trait : undefined,
        };
  if (!definition.name) {
    definition.name = name;
  }
  if (!definition.name || typeof definition.name !== 'string') {
    throw new Error('Trait definitions require a name.');
  }
  if (typeof definition.apply !== 'function') {
    throw new Error(`Trait "${definition.name}" must define an apply(core, options) function.`);
  }
  return {
    ...definition,
  };
};

const createResourceState = (resources = {}) => {
  const state = {};
  for (const [name, config] of Object.entries(resources)) {
    const hasMax = config.max !== undefined && config.max !== null;
    const rawMax = hasMax ? Number(config.max) : Number(config.initial ?? 0);
    const rawInitial = Number(config.initial ?? config.max ?? rawMax ?? 0);
    const max = Number.isFinite(rawMax) && rawMax >= 0 ? rawMax : 0;
    const initial = Number.isFinite(rawInitial) && rawInitial >= 0 ? rawInitial : 0;
    const regen = Number(config.regen ?? 0);
    const current = hasMax ? Math.min(initial, max) : initial;
    const maxValue = hasMax ? max : Math.max(max, initial);
    state[name] = {
      max: maxValue,
      current: current,
      regen: Number.isFinite(regen) ? regen : 0,
    };
  }
  return state;
};

const mergeSensorPresets = (current = {}, personaSensors = {}) => {
  const existingPresets = new Set(current.presets ?? []);
  for (const preset of personaSensors.presets ?? []) {
    existingPresets.add(preset);
  }
  const { presets: _current, ...currentRest } = current;
  const { presets: _persona, ...personaRest } = personaSensors;
  return {
    ...currentRest,
    ...personaRest,
    presets: [...existingPresets],
  };
};

class BehaviorScheduler {
  constructor() {
    this.layers = [];
    this.initialized = false;
    this._order = 0;
  }

  addLayer({ name, node, priority = 0 }) {
    if (!name) {
      throw new Error('Behavior layers require a name.');
    }
    if (!node) {
      throw new Error(`Behavior layer "${name}" is missing its node.`);
    }
    if (this.layers.some((layer) => layer.name === name)) {
      throw new Error(`Behavior layer "${name}" is already registered.`);
    }

    const entry = {
      name,
      node,
      priority,
      order: this._order++,
    };
    this.layers.push(entry);
    this.layers.sort((a, b) => {
      if (b.priority === a.priority) {
        return a.order - b.order;
      }
      return b.priority - a.priority;
    });
  }

  removeLayer(name) {
    const index = this.layers.findIndex((layer) => layer.name === name);
    if (index === -1) {
      return null;
    }
    const [removed] = this.layers.splice(index, 1);
    return removed;
  }

  initialize(context) {
    if (this.initialized) {
      return;
    }
    for (const layer of this.layers) {
      layer.node.initialize?.(context, layer);
    }
    this.initialized = true;
  }

  attachToEntity(entity, context) {
    for (const layer of this.layers) {
      layer.node.attachToEntity?.(entity, context, layer);
    }
  }

  tick(delta, context) {
    for (const layer of this.layers) {
      try {
        layer.node.update?.(delta, context, layer);
      } catch (error) {
        throw new Error(`Error in behavior layer "${layer.name}": ${error?.message ?? error}` , {
          cause: error,
        });
      }
    }
  }
}

export class MobAICore {
  constructor(options = {}) {
    const {
      random = Math.random,
      chunkManager = null,
      audioManager = null,
      behaviorRegistry = new BehaviorRegistry(),
      personaRegistry = new PersonaRegistry(),
      traitDefinitions = defaultTraits,
      ambientScheduler = null,
      events,
    } = options;

    this.dependencies = {
      random,
      chunkManager,
      audioManager,
    };

    this.scheduler = new BehaviorScheduler();
    this.ambientScheduler =
      ambientScheduler instanceof AmbientTaskScheduler
        ? ambientScheduler
        : new AmbientTaskScheduler({ random });
    this.behaviorRegistry = behaviorRegistry;
    this.personaRegistry = personaRegistry;
    this.traits = new Map();
    this.activeTraitHandles = new Map();
    this.context = null;
    this.currentPersona = null;
    this.initialized = false;
    this.events = events ?? new EventEmitter();

    traitDefinitions.forEach((trait) => {
      const definition = normalizeTraitDefinition(trait.name ?? trait, trait);
      if (!this.traits.has(definition.name)) {
        this.registerTrait(definition.name, definition);
      }
    });
  }

  registerPersona(name, definition) {
    if (typeof name === 'object') {
      return this.personaRegistry.register(name);
    }
    if (!name) {
      throw new Error('Persona name is required.');
    }
    return this.personaRegistry.register({ ...definition, name });
  }

  usePersona(reference, overrides = {}) {
    const persona = this.personaRegistry.create(reference, overrides);
    const previousPersona = this.currentPersona;
    this.currentPersona = persona;
    this._applyPersona(persona, { resetResources: true });
    this.emit('persona:applied', persona, { previous: previousPersona });
    return persona;
  }

  registerTrait(name, trait) {
    const definition = normalizeTraitDefinition(name, trait);
    this.traits.set(definition.name, definition);
    this._updateTraitContext();
    this.emit('trait:registered', definition);
    return this;
  }

  removeTrait(name) {
    if (this.activeTraitHandles.has(name)) {
      const handle = this.activeTraitHandles.get(name);
      handle?.dispose?.();
      this.activeTraitHandles.delete(name);
    }
    this.traits.delete(name);
    this._updateTraitContext();
    return this;
  }

  _disposeActiveTraits() {
    for (const handle of this.activeTraitHandles.values()) {
      handle?.dispose?.();
    }
    this.activeTraitHandles.clear();
  }

  _activateTrait(traitEntry) {
    const name = typeof traitEntry === 'string' ? traitEntry : traitEntry?.name;
    if (!name) {
      throw new Error('Trait entry must include a name.');
    }
    const definition = this.traits.get(name);
    if (!definition) {
      throw new Error(`Persona requested unknown trait "${name}".`);
    }
    const options =
      typeof traitEntry === 'object' && traitEntry !== null
        ? deepClone(traitEntry.options ?? {})
        : {};
    const handle = definition.apply(this, options, this.currentPersona) ?? null;
    this.activeTraitHandles.set(name, handle);
  }

  _applyPersona(persona, { resetResources = false } = {}) {
    if (!persona) {
      return;
    }
    this._disposeActiveTraits();
    persona.traits?.forEach((trait) => this._activateTrait(trait));
    this._updateTraitContext();
    this._syncPersonaContext(persona, { resetResources });
    this._installPersonaBehaviors(persona);
  }

  _syncPersonaContext(persona, { resetResources = false } = {}) {
    if (!this.context) {
      return;
    }
    this.context.persona = persona;
    this.context.flags ??= {};
    this.context.behaviorDescriptors = persona.behaviors
      ? persona.behaviors.map((behavior) => deepClone(behavior))
      : [];

    if (!this.context.resources || resetResources) {
      this.context.resources = createResourceState(persona.resources ?? {});
    } else {
      const personaResources = createResourceState(persona.resources ?? {});
      this.context.resources ??= {};
      for (const [name, config] of Object.entries(personaResources)) {
        const existing = this.context.resources[name] ?? { current: config.current };
        const current = resetResources ? config.current : Math.min(existing.current ?? config.current, config.max);
        this.context.resources[name] = {
          max: config.max,
          regen: config.regen,
          current,
        };
      }
    }

    this.context.sensors = mergeSensorPresets(this.context.sensors ?? {}, persona.sensors ?? {});
  }

  _installPersonaBehaviors(persona) {
    if (!persona.behaviors || persona.behaviors.length === 0) {
      return;
    }
    for (const descriptor of persona.behaviors) {
      const layerName = descriptor.name ?? descriptor.loop;
      if (!layerName) {
        continue;
      }
      const existing = this.scheduler.layers.find((layer) => layer.name === layerName);
      if (existing) {
        const removed = this.scheduler.removeLayer(layerName);
        removed?.node?.dispose?.();
      }
      const options = {
        ...(descriptor.options ?? {}),
        metadata: {
          ...(descriptor.metadata ?? {}),
          persona: persona.name,
          duration: descriptor.duration ?? null,
          triggers: descriptor.triggers ?? [],
          tags: descriptor.tags ?? [],
        },
      };
      const loop = this.behaviorRegistry.createLoop(descriptor.loop, options, this.dependencies);
      this.addBehaviorLayer({ name: layerName, node: loop, priority: descriptor.priority ?? 0 });
    }
  }

  _updateTraitContext() {
    if (!this.context) {
      return;
    }
    this.context.traits = this.traits;
    this.context.activeTraits = new Set(this.activeTraitHandles.keys());
  }

  addBehaviorLayer({ name, node, priority = 0 }) {
    this.scheduler.addLayer({ name, node, priority });
    if (this.initialized && this.context) {
      node.initialize?.(this.context, { name, priority });
      if (this.context.entity) {
        node.attachToEntity?.(this.context.entity, this.context, { name, priority });
      }
    }
    return node;
  }

  useBehaviorLoop(loopName, options = {}) {
    const loop = this.behaviorRegistry.createLoop(loopName, options, this.dependencies);
    this.addBehaviorLayer({ name: loop.name, node: loop, priority: options.priority ?? 0 });
    return loop;
  }

  initialize(initialContext = {}) {
    if (this.initialized) {
      Object.assign(this.context, initialContext);
      this.context.dependencies = this.dependencies;
      this.context.flags ??= {};
      this.context.memory ??= new Map();
      this.context.ambientScheduler = this.ambientScheduler;
      this.context.ambient ??= {};
      this.context.ambient.scheduler = this.ambientScheduler;
      this._updateTraitContext();
      if (this.currentPersona) {
        this._syncPersonaContext(this.currentPersona);
      }
      this.ambientScheduler.tick(0, this.context);
      return this.context;
    }

    this.context = {
      time: 0,
      delta: 0,
      entity: null,
      memory: new Map(),
      flags: {},
      ...initialContext,
      dependencies: this.dependencies,
    };
    this._updateTraitContext();
    this.context.ambientScheduler = this.ambientScheduler;
    this.context.ambient ??= {};
    this.context.ambient.scheduler = this.ambientScheduler;
    if (this.currentPersona) {
      this._syncPersonaContext(this.currentPersona, { resetResources: true });
    }
    this.scheduler.initialize(this.context);
    this.ambientScheduler.tick(0, this.context);
    this.initialized = true;
    return this.context;
  }

  attachToEntity(entity) {
    if (!this.initialized) {
      this.initialize();
    }
    this.context.entity = entity;
    this.scheduler.attachToEntity(entity, this.context);
    return entity;
  }

  update(delta, contextUpdates = {}) {
    if (!this.initialized) {
      throw new Error('MobAICore must be initialized before update.');
    }

    Object.assign(this.context, contextUpdates);
    this.context.delta = delta;
    this.context.time += delta;
    this.emit('beforeUpdate', this.context);
    this.ambientScheduler.tick(delta, this.context);
    this.scheduler.tick(delta, this.context);
    this.emit('afterUpdate', this.context);
  }

  on(eventName, listener) {
    this.events.on(eventName, listener);
    return this;
  }

  once(eventName, listener) {
    this.events.once(eventName, listener);
    return this;
  }

  off(eventName, listener) {
    this.events.off(eventName, listener);
    return this;
  }

  emit(eventName, ...args) {
    this.events.emit(eventName, ...args);
    return this;
  }
}

export default MobAICore;

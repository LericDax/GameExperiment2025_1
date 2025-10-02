import { EventEmitter } from 'node:events';
import { BehaviorRegistry } from './behavior-nodes.js';

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
      events,
    } = options;

    this.dependencies = {
      random,
      chunkManager,
      audioManager,
    };

    this.scheduler = new BehaviorScheduler();
    this.behaviorRegistry = behaviorRegistry;
    this.personas = new Map();
    this.traits = new Map();
    this.context = null;
    this.currentPersona = null;
    this.initialized = false;
    this.events = events ?? new EventEmitter();
  }

  registerPersona(name, definition) {
    if (!name) {
      throw new Error('Persona name is required.');
    }
    this.personas.set(name, { ...definition });
    return this;
  }

  usePersona(name) {
    const persona = typeof name === 'string' ? this.personas.get(name) : name;
    if (!persona) {
      throw new Error(`Unknown persona "${name}".`);
    }
    this.currentPersona = persona;
    if (this.context) {
      this.context.persona = persona;
    }
    return persona;
  }

  registerTrait(name, trait) {
    if (!name) {
      throw new Error('Trait name is required.');
    }
    this.traits.set(name, trait);
    if (this.context) {
      this.context.traits = this.traits;
    }
    return this;
  }

  removeTrait(name) {
    this.traits.delete(name);
    if (this.context) {
      this.context.traits = this.traits;
    }
    return this;
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
      this.context = {
        ...this.context,
        ...initialContext,
      };
      this.context.dependencies = this.dependencies;
      this.context.traits = this.traits;
      if (this.currentPersona) {
        this.context.persona = this.currentPersona;
      }
      return this.context;
    }

    this.context = {
      time: 0,
      delta: 0,
      entity: null,
      memory: new Map(),
      ...initialContext,
      dependencies: this.dependencies,
      traits: this.traits,
      persona: this.currentPersona,
    };
    this.scheduler.initialize(this.context);
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
    this.scheduler.tick(delta, this.context);
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

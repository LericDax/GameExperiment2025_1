import {
  getTerrainHeight,
  getLightLevel,
  findNearbyEntities,
  findResourceNodes,
} from './environment-query.js';

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const resolveVector = (input) => {
  if (!input) {
    return { x: 0, y: 0, z: 0 };
  }
  if (input.isVector3) {
    return { x: toNumber(input.x), y: toNumber(input.y), z: toNumber(input.z) };
  }
  if (Array.isArray(input)) {
    const [x = 0, y = 0, z = 0] = input;
    return { x: toNumber(x), y: toNumber(y), z: toNumber(z) };
  }
  if (typeof input === 'object') {
    if ('x' in input || 'z' in input || 'y' in input) {
      return {
        x: toNumber(input.x),
        y: toNumber(input.y),
        z: toNumber(input.z),
      };
    }
    if (input.position) {
      return resolveVector(input.position);
    }
    if (input.entity?.position) {
      return resolveVector(input.entity.position);
    }
    if (input.entity?.root?.position) {
      return resolveVector(input.entity.root.position);
    }
    if (input.root?.position) {
      return resolveVector(input.root.position);
    }
  }
  return { x: 0, y: 0, z: 0 };
};

const resolveContextPosition = (context, fallback = null) => {
  if (!context) {
    return fallback ?? { x: 0, y: 0, z: 0 };
  }
  if (context.entity?.root?.position) {
    return resolveVector(context.entity.root.position);
  }
  if (context.entity?.position) {
    return resolveVector(context.entity.position);
  }
  if (context.position) {
    return resolveVector(context.position);
  }
  if (context.environment?.position) {
    return resolveVector(context.environment.position);
  }
  return fallback ?? { x: 0, y: 0, z: 0 };
};

const clampNumber = (value, min, max) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }
  return Math.min(max, Math.max(min, numeric));
};

const DEFAULT_TASKS = ['wander', 'explore', 'socialize'];

const ensureFilterArray = (filters) => {
  if (!filters) {
    return [];
  }
  if (Array.isArray(filters)) {
    return filters.filter((filter) => typeof filter === 'function');
  }
  if (typeof filters === 'function') {
    return [filters];
  }
  return [];
};

const ensureTagSet = (value) => {
  if (!value) {
    return new Set();
  }
  if (value instanceof Set) {
    return new Set(value);
  }
  if (Array.isArray(value)) {
    return new Set(value.filter((item) => typeof item === 'string').map((item) => item));
  }
  if (typeof value === 'string') {
    return new Set([value]);
  }
  return new Set();
};

const normalizeDefinition = (definition = {}) => {
  if (!definition.name || typeof definition.name !== 'string') {
    throw new Error('Ambient tasks require a string name.');
  }
  const cooldown = Number.isFinite(definition.cooldown)
    ? Math.max(0, Number(definition.cooldown))
    : 8;
  const failureCooldown = Number.isFinite(definition.failureCooldown)
    ? Math.max(0.5, Number(definition.failureCooldown))
    : Math.max(2, cooldown * 0.6);
  return {
    name: definition.name,
    label: definition.label ?? definition.name,
    priority: Number.isFinite(definition.priority) ? Number(definition.priority) : 0,
    weight: Number.isFinite(definition.weight) ? Math.max(0, Number(definition.weight)) : 1,
    cooldown,
    failureCooldown,
    maxFailures: Number.isFinite(definition.maxFailures)
      ? Math.max(1, Math.floor(definition.maxFailures))
      : 3,
    failureBackoffMultiplier: Number.isFinite(definition.failureBackoffMultiplier)
      ? Math.max(1, Number(definition.failureBackoffMultiplier))
      : 1,
    filters: ensureFilterArray(definition.filters),
    execute: typeof definition.execute === 'function' ? definition.execute : () => ({ success: true }),
    onFailure: typeof definition.onFailure === 'function' ? definition.onFailure : null,
    onSuccess: typeof definition.onSuccess === 'function' ? definition.onSuccess : null,
    metadata: definition.metadata ?? null,
    tags: Array.from(ensureTagSet(definition.tags)),
  };
};

const toNameSet = (value) => {
  if (!value) {
    return null;
  }
  if (value instanceof Set) {
    return value.size > 0 ? new Set(value) : null;
  }
  if (Array.isArray(value)) {
    const set = new Set(value.map((entry) => `${entry}`));
    return set.size > 0 ? set : null;
  }
  if (typeof value === 'string') {
    return new Set([value]);
  }
  return null;
};

const randomInRange = (rng, min, max) => {
  const t = rng();
  return min + (max - min) * t;
};

const chooseRandom = (rng, list) => {
  if (!Array.isArray(list) || list.length === 0) {
    return null;
  }
  const index = Math.floor(rng() * list.length);
  return list[clampNumber(index, 0, list.length - 1)];
};

const createWanderInstruction = (context, scheduler) => {
  const origin = resolveContextPosition(context);
  const radius = randomInRange(scheduler.random, 4, 10);
  const angle = scheduler.random() * Math.PI * 2;
  const target = {
    x: origin.x + Math.cos(angle) * radius,
    z: origin.z + Math.sin(angle) * radius,
    y: origin.y,
  };
  const terrainHeight = getTerrainHeight(context, target);
  if (Number.isFinite(terrainHeight)) {
    target.y = terrainHeight;
  }
  return {
    success: true,
    type: 'movement',
    style: 'wander',
    target,
  };
};

const createExploreInstruction = (context, scheduler) => {
  const origin = resolveContextPosition(context);
  const resourceNodes = findResourceNodes(context, origin, { radius: 80, limit: 4 });
  const pointsOfInterest = Array.isArray(context?.environment?.pointsOfInterest)
    ? context.environment.pointsOfInterest.map((entry) => resolveVector(entry))
    : [];
  let target = null;
  let intent = 'survey';
  if (resourceNodes.length > 0) {
    const chosen = resourceNodes[0];
    target = { ...chosen.position };
    intent = 'resource';
  } else if (pointsOfInterest.length > 0) {
    target = { ...chooseRandom(scheduler.random, pointsOfInterest) };
    intent = 'poi';
  } else {
    const radius = randomInRange(scheduler.random, 12, 24);
    const angle = scheduler.random() * Math.PI * 2;
    target = {
      x: origin.x + Math.cos(angle) * radius,
      z: origin.z + Math.sin(angle) * radius,
      y: origin.y,
    };
  }
  const terrainHeight = getTerrainHeight(context, target);
  if (Number.isFinite(terrainHeight)) {
    target.y = terrainHeight;
  }
  return {
    success: true,
    type: 'movement',
    style: 'explore',
    intent,
    target,
  };
};

const createSocializeInstruction = (context, scheduler) => {
  const origin = resolveContextPosition(context);
  const allies = findNearbyEntities(context, origin, {
    radius: 24,
    limit: 4,
    filter: (entity) => {
      const id = entity?.id ?? entity?.entity?.id;
      if (context?.entity?.id && id === context.entity.id) {
        return false;
      }
      if (entity?.entity?.faction && context?.entity?.faction) {
        return entity.entity.faction === context.entity.faction;
      }
      if (entity?.faction && context?.entity?.faction) {
        return entity.faction === context.entity.faction;
      }
      return true;
    },
  });
  const partner = allies[0]?.entity ?? allies[0] ?? null;
  if (!partner) {
    return { success: false, reason: 'no-partner' };
  }
  return {
    success: true,
    type: 'social',
    style: 'chat',
    partner,
    message: chooseRandom(scheduler.random, [
      'shares a rumor about hidden ruins',
      'recounts the last hunt',
      'hums a spectral melody',
    ]),
  };
};

class TaskRecord {
  constructor(definition) {
    this.definition = definition;
    this.state = {
      lastRun: -Infinity,
      cooldownUntil: 0,
      failures: 0,
      pendingHandle: null,
      pendingContext: null,
    };
    this.stats = {
      runs: 0,
      failures: 0,
    };
  }
}

export class AmbientTaskScheduler {
  constructor(options = {}) {
    const { random = Math.random, tasks = [] } = options;
    this.random = typeof random === 'function' ? random : Math.random;
    this.time = 0;
    this.tasks = new Map();
    this.queue = [];
    this._queueDirty = false;
    this._handleId = 1;
    DEFAULT_TASKS.forEach((name) => {
      if (!options.skipDefaults) {
        this._registerDefaultTask(name);
      }
    });
    tasks.forEach((task) => this.registerTask(task));
  }

  _registerDefaultTask(name) {
    if (this.tasks.has(name)) {
      return;
    }
    switch (name) {
      case 'wander': {
        this.registerTask({
          name: 'wander',
          label: 'Ambient Wander',
          priority: 1,
          cooldown: 6,
          failureCooldown: 3,
          tags: ['movement', 'ambient'],
          filters: [
            (context) => (context?.flags?.allowWander ?? true) !== false,
            (context) => (context?.percepts?.threatLevel ?? 'low') === 'low',
          ],
          execute: (context) => createWanderInstruction(context, this),
        });
        break;
      }
      case 'explore': {
        this.registerTask({
          name: 'explore',
          label: 'Ambient Exploration',
          priority: 3,
          cooldown: 12,
          failureCooldown: 6,
          tags: ['movement', 'exploration'],
          filters: [
            (context) => (context?.percepts?.threatLevel ?? 'low') === 'low',
            (context) => {
              const light = getLightLevel(context);
              if (light < 0.65) {
                return { allow: true, priority: 3.5 };
              }
              const points = Array.isArray(context?.environment?.pointsOfInterest)
                ? context.environment.pointsOfInterest.length
                : 0;
              const nodes = findResourceNodes(context, resolveContextPosition(context), {
                radius: 64,
                limit: 1,
              });
              if (points > 0 || nodes.length > 0) {
                return { allow: true, priority: 3 };
              }
              return false;
            },
          ],
          execute: (context) => createExploreInstruction(context, this),
        });
        break;
      }
      case 'socialize': {
        this.registerTask({
          name: 'socialize',
          label: 'Ambient Socialize',
          priority: 2,
          cooldown: 15,
          failureCooldown: 8,
          tags: ['social', 'ambient'],
          filters: [
            (context) =>
              findNearbyEntities(context, resolveContextPosition(context), {
                radius: 20,
                limit: 1,
                filter: (entity) => {
                  const id = entity?.id ?? entity?.entity?.id;
                  if (context?.entity?.id && id === context.entity.id) {
                    return false;
                  }
                  if (entity?.entity?.faction && context?.entity?.faction) {
                    return entity.entity.faction === context.entity.faction;
                  }
                  if (entity?.faction && context?.entity?.faction) {
                    return entity.faction === context.entity.faction;
                  }
                  return true;
                },
              }).length > 0,
          ],
          execute: (context) => createSocializeInstruction(context, this),
        });
        break;
      }
      default:
        break;
    }
  }

  registerTask(definition) {
    const normalized = normalizeDefinition(definition);
    const record = new TaskRecord(normalized);
    this.tasks.set(normalized.name, record);
    return record;
  }

  tick(delta = 0, context = {}) {
    const numericDelta = Number(delta);
    if (Number.isFinite(numericDelta)) {
      this.time += numericDelta;
    }
    this._enqueueEligibleTasks(context);
  }

  _enqueueEligibleTasks(context) {
    for (const [name, record] of this.tasks.entries()) {
      if (record.state.pendingHandle) {
        continue;
      }
      if (this._isQueued(name)) {
        continue;
      }
      if (this.time < record.state.cooldownUntil) {
        continue;
      }
      const filters = this._evaluateFilters(record.definition, context);
      if (!filters.allow) {
        continue;
      }
      this._enqueueRecord(record, filters.priority, filters.weight);
    }
  }

  _isQueued(name) {
    return this.queue.some((entry) => entry.name === name);
  }

  _evaluateFilters(definition, context) {
    let priority = definition.priority;
    let weight = definition.weight;
    for (const filter of definition.filters) {
      let result = null;
      try {
        result = filter(context, { scheduler: this, definition });
      } catch (error) {
        console.warn(`Ambient task filter failed for "${definition.name}":`, error);
        return { allow: false, priority, weight };
      }
      if (result === false) {
        return { allow: false, priority, weight };
      }
      if (typeof result === 'object' && result !== null) {
        if ('allow' in result && result.allow === false) {
          return { allow: false, priority, weight };
        }
        if (Number.isFinite(result.priority)) {
          priority = Number(result.priority);
        }
        if (Number.isFinite(result.weight)) {
          weight = Math.max(0, Number(result.weight));
        }
      }
    }
    return { allow: true, priority, weight };
  }

  _enqueueRecord(record, priorityOverride, weightOverride) {
    const priority = Number.isFinite(priorityOverride)
      ? Number(priorityOverride)
      : record.definition.priority;
    const weight = Number.isFinite(weightOverride)
      ? Math.max(0, Number(weightOverride))
      : record.definition.weight;
    const bias = this.random() * (weight > 0 ? weight : 1);
    this.queue.push({
      name: record.definition.name,
      priority,
      weight,
      bias,
      enqueuedAt: this.time,
    });
    this._queueDirty = true;
  }

  _sortQueue() {
    if (!this._queueDirty) {
      return;
    }
    this.queue.sort((a, b) => {
      if (b.priority === a.priority) {
        if (b.bias === a.bias) {
          return a.enqueuedAt - b.enqueuedAt;
        }
        return b.bias - a.bias;
      }
      return b.priority - a.priority;
    });
    this._queueDirty = false;
  }

  requestTask(context = {}, options = {}) {
    this._enqueueEligibleTasks(context);
    this._sortQueue();

    if (this.queue.length === 0) {
      return null;
    }

    const include = toNameSet(options.include);
    const exclude = toNameSet(options.exclude);
    const tags = toNameSet(options.tags);
    const predicate = typeof options.predicate === 'function' ? options.predicate : null;

    let candidateIndex = -1;
    for (let i = 0; i < this.queue.length; i += 1) {
      const entry = this.queue[i];
      const record = this.tasks.get(entry.name);
      if (!record) {
        continue;
      }
      if (include && !include.has(entry.name)) {
        continue;
      }
      if (exclude && exclude.has(entry.name)) {
        continue;
      }
      if (tags) {
        const taskTags = record.definition.tags;
        if (!taskTags.some((tag) => tags.has(tag))) {
          continue;
        }
      }
      if (predicate && predicate(record.definition, { context, scheduler: this }) === false) {
        continue;
      }
      candidateIndex = i;
      break;
    }

    if (candidateIndex === -1) {
      return null;
    }

    const [entry] = this.queue.splice(candidateIndex, 1);
    const record = this.tasks.get(entry.name);
    if (!record) {
      return null;
    }

    const handleId = this._handleId++;
    record.state.pendingHandle = { id: handleId, priority: entry.priority };
    record.state.pendingContext = context;

    return {
      name: record.definition.name,
      priority: entry.priority,
      metadata: record.definition.metadata,
      execute: (runContext = context) => record.definition.execute(runContext, this),
      succeed: (result = null) =>
        this._completeTask(record, handleId, { success: true, result }),
      fail: (reason = null, optionsOverride = {}) =>
        this._completeTask(record, handleId, {
          success: false,
          reason,
          failureCooldown: optionsOverride.failureCooldown,
        }),
      complete: (options = {}) => this._completeTask(record, handleId, options),
      cancel: (cancelOptions = {}) => this._cancelPending(record, handleId, cancelOptions),
    };
  }

  _completeTask(record, handleId, options = {}) {
    if (!record.state.pendingHandle || record.state.pendingHandle.id !== handleId) {
      return null;
    }
    const success = options.success !== false;
    const now = this.time;
    record.state.lastRun = now;
    const cooldownOverride = Number.isFinite(options.cooldown)
      ? Math.max(0, Number(options.cooldown))
      : null;
    const failureCooldownOverride = Number.isFinite(options.failureCooldown)
      ? Math.max(0, Number(options.failureCooldown))
      : null;

    if (success) {
      record.state.failures = 0;
      record.stats.runs += 1;
      record.state.cooldownUntil = now + (cooldownOverride ?? record.definition.cooldown);
      if (record.definition.onSuccess) {
        record.definition.onSuccess({
          scheduler: this,
          context: record.state.pendingContext,
          result: options.result ?? null,
        });
      }
    } else {
      record.state.failures += 1;
      record.stats.failures += 1;
      const failureCount = Math.min(record.state.failures, record.definition.maxFailures);
      const multiplier =
        record.definition.failureBackoffMultiplier + (failureCount - 1) * 0.25;
      const delay =
        (failureCooldownOverride ?? record.definition.failureCooldown) * Math.max(1, multiplier);
      record.state.cooldownUntil = now + delay;
      if (record.definition.onFailure) {
        record.definition.onFailure({
          scheduler: this,
          context: record.state.pendingContext,
          reason: options.reason ?? null,
          failures: record.state.failures,
        });
      }
    }

    record.state.pendingHandle = null;
    record.state.pendingContext = null;

    if (options.requeue === true) {
      this._enqueueRecord(record, options.priority, options.weight);
    }
    return success;
  }

  _cancelPending(record, handleId, options = {}) {
    if (!record.state.pendingHandle || record.state.pendingHandle.id !== handleId) {
      return false;
    }
    record.state.pendingHandle = null;
    const requeue = options.requeue !== false;
    if (requeue) {
      this._enqueueRecord(record, options.priority, options.weight);
    }
    record.state.pendingContext = null;
    return true;
  }

  getTaskState(name) {
    const record = this.tasks.get(name);
    if (!record) {
      return null;
    }
    return {
      name: record.definition.name,
      priority: record.definition.priority,
      weight: record.definition.weight,
      cooldown: record.definition.cooldown,
      failureCooldown: record.definition.failureCooldown,
      lastRun: record.state.lastRun,
      cooldownUntil: record.state.cooldownUntil,
      failures: record.state.failures,
      pending: Boolean(record.state.pendingHandle),
      stats: { ...record.stats },
    };
  }

  clearQueue() {
    this.queue.length = 0;
  }
}

export default AmbientTaskScheduler;

const TRIGGER_TYPES = new Set(['percept', 'time', 'flag', 'resource', 'manual']);

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const toNumber = (value, fallback = 0) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected numeric value but received ${value}.`);
  }
  return parsed;
};

const normalizeDuration = (duration) => {
  if (duration === undefined || duration === null) {
    return null;
  }

  if (typeof duration === 'number') {
    if (duration < 0) {
      throw new Error('Behavior duration cannot be negative.');
    }
    return {
      min: duration,
      max: duration,
      unit: 'seconds',
    };
  }

  if (typeof duration !== 'object') {
    throw new Error('Behavior duration must be a number or an object.');
  }

  const min = toNumber(duration.min ?? duration.max ?? 0, 0);
  const max = toNumber(duration.max ?? duration.min ?? min, min);

  if (min < 0 || max < 0) {
    throw new Error('Behavior duration cannot include negative bounds.');
  }
  if (max < min) {
    throw new Error('Behavior duration max must be greater than or equal to min.');
  }

  return {
    min,
    max,
    unit: duration.unit ?? 'seconds',
  };
};

const normalizeTrigger = (trigger) => {
  if (!trigger || typeof trigger !== 'object') {
    throw new Error('Behavior triggers must be objects.');
  }

  const type = trigger.type;
  if (!type || typeof type !== 'string') {
    throw new Error('Behavior trigger missing its type.');
  }
  if (!TRIGGER_TYPES.has(type)) {
    throw new Error(`Unsupported behavior trigger type "${type}".`);
  }

  switch (type) {
    case 'percept': {
      const key = trigger.key;
      if (!key || typeof key !== 'string') {
        throw new Error('Percept triggers require a "key" field.');
      }
      return {
        type,
        key,
        equals: trigger.equals,
        exists: trigger.exists ?? trigger.equals === undefined,
      };
    }
    case 'time': {
      const after = toNumber(trigger.after ?? trigger.delay ?? 0, 0);
      if (after < 0) {
        throw new Error('Time trigger delays must be zero or positive.');
      }
      return {
        type,
        after,
      };
    }
    case 'flag': {
      const name = trigger.name ?? trigger.flag;
      if (!name || typeof name !== 'string') {
        throw new Error('Flag triggers require a "name" field.');
      }
      return {
        type,
        name,
        state: trigger.state ?? true,
      };
    }
    case 'resource': {
      const resource = trigger.resource;
      if (!resource || typeof resource !== 'string') {
        throw new Error('Resource triggers require a "resource" field.');
      }
      const threshold = toNumber(trigger.threshold ?? trigger.below ?? trigger.above ?? 0, 0);
      const comparator = trigger.comparator ?? (trigger.below !== undefined ? 'below' : 'above');
      if (!['below', 'above'].includes(comparator)) {
        throw new Error('Resource trigger comparator must be "below" or "above".');
      }
      return {
        type,
        resource,
        threshold,
        comparator,
      };
    }
    case 'manual': {
      return {
        type,
        event: trigger.event ?? null,
      };
    }
    default: {
      throw new Error(`Unhandled trigger type "${type}".`);
    }
  }
};

const normalizeTriggers = (triggers) => {
  if (triggers === undefined || triggers === null) {
    return [];
  }
  if (!Array.isArray(triggers)) {
    throw new Error('Behavior triggers must be provided as an array.');
  }
  return triggers.map((trigger) => normalizeTrigger(trigger));
};

const normalizePriority = (priority) => {
  if (priority === undefined || priority === null) {
    return 0;
  }
  const value = Number(priority);
  if (!Number.isFinite(value)) {
    throw new Error('Behavior priority must be numeric.');
  }
  return clamp(value, -Infinity, Infinity);
};

const normalizeBehaviorDescriptor = (descriptor) => {
  if (!descriptor || typeof descriptor !== 'object') {
    throw new Error('Behavior descriptor must be an object.');
  }

  const loop = descriptor.loop;
  if (!loop || typeof loop !== 'string') {
    throw new Error('Behavior descriptor requires a "loop" field.');
  }

  const name = descriptor.name ?? descriptor.id ?? loop;
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error('Behavior descriptor requires a valid "name".');
  }

  const priority = normalizePriority(descriptor.priority);
  const duration = normalizeDuration(descriptor.duration ?? descriptor.timebox);
  const triggers = normalizeTriggers(descriptor.triggers);

  const options = descriptor.options && typeof descriptor.options === 'object' ? descriptor.options : {};
  const metadata = descriptor.metadata && typeof descriptor.metadata === 'object' ? descriptor.metadata : {};

  return {
    name,
    loop,
    priority,
    duration,
    triggers,
    options,
    metadata,
    tags: Array.isArray(descriptor.tags) ? [...new Set(descriptor.tags.map(String))] : [],
  };
};

export const validateBehaviorDescriptor = (descriptor) => normalizeBehaviorDescriptor(descriptor);

export const validateBehaviorSet = (descriptors = []) => {
  if (!Array.isArray(descriptors)) {
    throw new Error('Behavior set must be an array of descriptors.');
  }
  return descriptors.map((descriptor) => validateBehaviorDescriptor(descriptor));
};

export { TRIGGER_TYPES };
export default validateBehaviorDescriptor;

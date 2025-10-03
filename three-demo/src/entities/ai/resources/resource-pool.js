import { EventEmitter } from '../../../utils/event-emitter.js';

const clamp = (value, min, max = Number.POSITIVE_INFINITY) => {
  if (Number.isFinite(max)) {
    return Math.min(Math.max(value, min), max);
  }
  return Math.max(value, min);
};

const isFiniteNumber = (value) => Number.isFinite(value);

const normalizeResourceConfig = (name, config = {}) => {
  if (typeof config === 'number') {
    if (!Number.isFinite(config) || config < 0) {
      throw new Error(`Resource "${name}" numeric configuration must be a non-negative finite number.`);
    }
    return {
      name,
      max: config,
      current: config,
      regen: 0,
      metadata: undefined,
    };
  }

  const { max, current, initial, regen, metadata } = config;

  const hasExplicitMax = max !== undefined && max !== null;
  const normalizedMax = hasExplicitMax ? Number(max) : undefined;
  if (hasExplicitMax && (!Number.isFinite(normalizedMax) || normalizedMax < 0)) {
    throw new Error(`Resource "${name}" max must be a non-negative finite number when provided.`);
  }

  const sourceInitial = current ?? initial ?? normalizedMax ?? 0;
  const normalizedInitial = Number(sourceInitial);
  if (!Number.isFinite(normalizedInitial) || normalizedInitial < 0) {
    throw new Error(`Resource "${name}" initial value must be a non-negative finite number.`);
  }

  const normalizedRegen = Number(regen ?? 0);
  if (!Number.isFinite(normalizedRegen)) {
    throw new Error(`Resource "${name}" regeneration rate must be a finite number.`);
  }

  const entryMax = hasExplicitMax ? normalizedMax : undefined;
  const entryCurrent = hasExplicitMax
    ? clamp(normalizedInitial, 0, entryMax)
    : Math.max(normalizedInitial, 0);

  return {
    name,
    max: entryMax,
    current: entryCurrent,
    regen: normalizedRegen,
    metadata,
  };
};

/**
 * Tracks consumable and regenerating resources for AI personas while broadcasting
 * change events so behaviors and traits can respond to depletion or restoration.
 */
export class ResourcePool {
  /**
   * @param {Record<string, number|Object>} [definitions] - Initial resource descriptors keyed by name.
   * @param {{ events?: EventEmitter }} [options] - Optional shared event emitter.
   */
  constructor(definitions = {}, { events } = {}) {
    this.resources = new Map();
    this.events = events ?? new EventEmitter();

    for (const [name, config] of Object.entries(definitions)) {
      this.defineResource(name, config);
    }
  }

  /**
   * Normalizes and stores a resource entry, emitting create/update events as needed.
   * @param {string} name - Resource identifier.
   * @param {number|Object} [config] - Max/current/regen metadata or shorthand numeric max.
   * @returns {{ name: string, max?: number, current: number, regen: number, metadata: any }}
   */
  defineResource(name, config = {}) {
    if (!name || typeof name !== 'string') {
      throw new Error('Resource names must be non-empty strings.');
    }

    const normalized = normalizeResourceConfig(name, config);
    const previous = this.resources.get(name);
    const entry = {
      name,
      max: normalized.max,
      current: normalized.current,
      regen: normalized.regen,
      metadata: normalized.metadata,
    };
    this.resources.set(name, entry);

    if (previous) {
      this.events.emit('resource:updated', entry, { previous });
    } else {
      this.events.emit('resource:created', entry);
    }

    return entry;
  }

  /**
   * Checks whether the pool contains a resource with the provided name.
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    return this.resources.has(name);
  }

  /**
   * Retrieves the raw resource entry, or `null` when the entry is missing.
   * @param {string} name
   * @returns {{ name: string, max?: number, current: number, regen: number, metadata: any }|null}
   */
  get(name) {
    return this.resources.get(name) ?? null;
  }

  /**
   * Convenience wrapper that returns only the current value.
   * @param {string} name
   * @returns {number|null}
   */
  getCurrent(name) {
    return this.get(name)?.current ?? null;
  }

  /**
   * Advances regeneration for every resource that defines a non-zero `regen` rate.
   * @param {number} deltaSeconds - Simulation delta in seconds.
   * @param {{ reason?: string, context?: any }} [options] - Metadata broadcast with change events.
   */
  tick(deltaSeconds, { reason = 'regen', context } = {}) {
    if (!isFiniteNumber(deltaSeconds) || deltaSeconds <= 0) {
      return;
    }

    for (const entry of this.resources.values()) {
      if (!entry || entry.regen === 0) {
        continue;
      }
      if (entry.max !== undefined && entry.current >= entry.max && entry.regen > 0) {
        continue;
      }
      const previous = entry.current;
      const delta = entry.regen * deltaSeconds;
      const next = entry.max !== undefined ? clamp(previous + delta, 0, entry.max) : Math.max(previous + delta, 0);
      if (next === previous) {
        continue;
      }
      entry.current = next;
      this.events.emit('resource:changed', entry, {
        previous,
        delta: next - previous,
        reason,
        context,
      });
    }
  }

  /**
   * Attempts to spend a resource amount, optionally allowing partial spends.
   * @param {string} name - Resource identifier.
   * @param {number} amount - Amount to consume.
   * @param {{ allowPartial?: boolean, reason?: string, context?: any }} [options]
   * @returns {number} Quantity successfully consumed.
   */
  consume(name, amount, { allowPartial = false, reason = 'consume', context } = {}) {
    const entry = this.get(name);
    if (!entry) {
      throw new Error(`Resource "${name}" is not defined.`);
    }
    const normalizedAmount = Number(amount);
    if (!isFiniteNumber(normalizedAmount) || normalizedAmount <= 0) {
      throw new Error('Resource consumption amount must be a positive, finite number.');
    }

    const available = entry.current;
    if (!allowPartial && available < normalizedAmount) {
      return 0;
    }

    const spent = allowPartial ? Math.min(available, normalizedAmount) : normalizedAmount;
    if (spent === 0) {
      return 0;
    }

    const previous = entry.current;
    entry.current = Math.max(entry.current - spent, 0);
    this.events.emit('resource:changed', entry, {
      previous,
      delta: entry.current - previous,
      reason,
      context,
    });

    if (entry.current === 0 && previous > 0) {
      this.events.emit('resource:depleted', entry, { spent, reason, context });
    }

    return spent;
  }

  /**
   * Restores a resource by the provided amount, clamped by its max (if defined).
   * @param {string} name - Resource identifier.
   * @param {number} amount - Amount to restore.
   * @param {{ reason?: string, context?: any }} [options]
   * @returns {number} Net change applied to the resource.
   */
  restore(name, amount, { reason = 'restore', context } = {}) {
    const entry = this.get(name);
    if (!entry) {
      throw new Error(`Resource "${name}" is not defined.`);
    }

    const normalizedAmount = Number(amount);
    if (!isFiniteNumber(normalizedAmount) || normalizedAmount <= 0) {
      throw new Error('Resource restoration amount must be a positive, finite number.');
    }

    const previous = entry.current;
    const max = entry.max;
    const next = max !== undefined ? clamp(previous + normalizedAmount, 0, max) : Math.max(previous + normalizedAmount, 0);
    if (next === previous) {
      return 0;
    }

    entry.current = next;
    this.events.emit('resource:changed', entry, {
      previous,
      delta: entry.current - previous,
      reason,
      context,
    });

    return entry.current - previous;
  }

  /**
   * Assigns an explicit value to the resource, respecting its configured max/min bounds.
   * @param {string} name - Resource identifier.
   * @param {number} value - Target current value.
   * @param {{ reason?: string, context?: any }} [options]
   * @returns {number} The previous resource value.
   */
  setCurrent(name, value, { reason = 'set', context } = {}) {
    const entry = this.get(name);
    if (!entry) {
      throw new Error(`Resource "${name}" is not defined.`);
    }
    const normalizedValue = Number(value);
    if (!isFiniteNumber(normalizedValue) || normalizedValue < 0) {
      throw new Error('Resource value must be a non-negative finite number.');
    }

    const previous = entry.current;
    const next = entry.max !== undefined ? clamp(normalizedValue, 0, entry.max) : normalizedValue;
    if (next === previous) {
      return entry.current;
    }

    entry.current = next;
    this.events.emit('resource:changed', entry, {
      previous,
      delta: entry.current - previous,
      reason,
      context,
    });

    if (entry.current === 0 && previous > 0) {
      this.events.emit('resource:depleted', entry, { reason, context });
    }

    return entry.current;
  }

  remove(name) {
    const entry = this.get(name);
    if (!entry) {
      return false;
    }
    this.resources.delete(name);
    this.events.emit('resource:removed', entry);
    return true;
  }

  snapshot() {
    const result = {};
    for (const [name, entry] of this.resources.entries()) {
      result[name] = {
        max: entry.max,
        current: entry.current,
        regen: entry.regen,
        metadata: entry.metadata,
      };
    }
    return result;
  }
}

export default ResourcePool;

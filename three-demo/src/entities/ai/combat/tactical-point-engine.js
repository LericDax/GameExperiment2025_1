import { EventEmitter } from 'node:events';

const isFiniteNumber = (value) => Number.isFinite(value);

const clamp = (value, min, max = Infinity) => {
  if (max === Infinity) {
    return Math.max(value, min);
  }
  return Math.min(Math.max(value, min), max);
};

const normalizeAccrualRule = (rule) => {
  if (!rule || typeof rule !== 'object') {
    throw new Error('Accrual rules must be objects.');
  }
  const id = rule.id ?? `rule-${Math.random().toString(36).slice(2)}`;
  const rate = Number(rule.rate ?? rule.amountPerSecond ?? 0);
  if (!Number.isFinite(rate)) {
    throw new Error('Accrual rule rate must be a finite number.');
  }
  const limit = rule.limit ?? rule.cap ?? Infinity;
  const normalizedLimit = limit === Infinity ? Infinity : Number(limit);
  if (normalizedLimit !== Infinity && (!Number.isFinite(normalizedLimit) || normalizedLimit < 0)) {
    throw new Error('Accrual rule limit must be a non-negative finite number or Infinity.');
  }
  return {
    id,
    rate,
    limit: normalizedLimit,
    condition: typeof rule.condition === 'function' ? rule.condition : null,
    payload: rule,
  };
};

const normalizeAbilityConfig = (name, config) => {
  const definition = typeof config === 'number' ? { cost: config } : config ?? {};
  const cost = Number(definition.cost ?? definition.points ?? 0);
  if (!isFiniteNumber(cost) || cost < 0) {
    throw new Error(`Ability "${name}" cost must be a non-negative finite number.`);
  }
  return {
    name,
    cost,
    min: Number.isFinite(definition.min) ? Math.max(0, Number(definition.min)) : cost,
    onSpend: typeof definition.onSpend === 'function' ? definition.onSpend : undefined,
    metadata: definition.metadata,
  };
};

export class TacticalPointEngine {
  constructor(options = {}) {
    const {
      maxPoints = Infinity,
      initialPoints = 0,
      accrualRules = [],
      events,
    } = options;

    const normalizedMax = maxPoints === Infinity ? Infinity : Number(maxPoints);
    if (normalizedMax !== Infinity && (!Number.isFinite(normalizedMax) || normalizedMax < 0)) {
      throw new Error('Tactical point maximum must be a non-negative finite number or Infinity.');
    }

    const initial = Number(initialPoints);
    if (!isFiniteNumber(initial) || initial < 0) {
      throw new Error('Initial tactical points must be a non-negative finite number.');
    }

    this.maxPoints = normalizedMax;
    this.points = clamp(initial, 0, this.maxPoints);
    this.events = events ?? new EventEmitter();
    this.accrualRules = new Map();
    this.abilities = new Map();
    this.triggers = new Map();

    accrualRules.forEach((rule) => {
      const normalized = normalizeAccrualRule(rule);
      this.accrualRules.set(normalized.id, normalized);
    });
  }

  addAccrualRule(rule) {
    const normalized = normalizeAccrualRule(rule);
    this.accrualRules.set(normalized.id, normalized);
    this.events.emit('accrual:added', normalized);
    return normalized.id;
  }

  removeAccrualRule(id) {
    if (!this.accrualRules.has(id)) {
      return false;
    }
    const rule = this.accrualRules.get(id);
    this.accrualRules.delete(id);
    this.events.emit('accrual:removed', rule);
    return true;
  }

  registerAbility(name, config) {
    if (!name || typeof name !== 'string') {
      throw new Error('Ability names must be non-empty strings.');
    }
    const definition = normalizeAbilityConfig(name, config);
    this.abilities.set(name, definition);
    this.events.emit('ability:registered', definition);
    return definition;
  }

  unregisterAbility(name) {
    if (!this.abilities.has(name)) {
      return false;
    }
    const ability = this.abilities.get(name);
    this.abilities.delete(name);
    this.events.emit('ability:unregistered', ability);
    return true;
  }

  canUseAbility(name) {
    const ability = this.abilities.get(name);
    if (!ability) {
      throw new Error(`Ability "${name}" is not registered.`);
    }
    return this.points >= ability.cost && this.points >= ability.min;
  }

  spendForAbility(name, { context } = {}) {
    const ability = this.abilities.get(name);
    if (!ability) {
      throw new Error(`Ability "${name}" is not registered.`);
    }
    if (!this.canUseAbility(name)) {
      return false;
    }
    const previous = this.points;
    this.points = clamp(this.points - ability.cost, 0, this.maxPoints);
    ability.onSpend?.({ ability, engine: this, context });
    this.events.emit('ability:spent', { ability, cost: ability.cost, previous, current: this.points, context });
    this.events.emit('points:changed', { previous, current: this.points, reason: 'ability', context });
    this._evaluateTriggers(previous, context);
    return true;
  }

  addPoints(amount, { reason = 'gain', context } = {}) {
    const normalized = Number(amount);
    if (!isFiniteNumber(normalized)) {
      throw new Error('Point adjustments must be finite numbers.');
    }
    if (normalized === 0) {
      return this.points;
    }
    const previous = this.points;
    this.points = clamp(this.points + normalized, 0, this.maxPoints);
    this.events.emit('points:changed', { previous, current: this.points, reason, context, delta: this.points - previous });
    this._evaluateTriggers(previous, context);
    return this.points;
  }

  setPoints(value, { reason = 'set', context } = {}) {
    const normalized = Number(value);
    if (!isFiniteNumber(normalized) || normalized < 0) {
      throw new Error('Tactical points must be a non-negative finite number.');
    }
    const previous = this.points;
    this.points = clamp(normalized, 0, this.maxPoints);
    this.events.emit('points:changed', { previous, current: this.points, reason, context, delta: this.points - previous });
    this._evaluateTriggers(previous, context);
    return this.points;
  }

  update(deltaSeconds, { context } = {}) {
    if (!isFiniteNumber(deltaSeconds) || deltaSeconds <= 0) {
      return this.points;
    }
    let totalDelta = 0;
    for (const rule of this.accrualRules.values()) {
      if (rule.condition && !rule.condition({ engine: this, context, delta: deltaSeconds, rule })) {
        continue;
      }
      const proposed = rule.rate * deltaSeconds;
      if (proposed === 0) {
        continue;
      }
      if (rule.rate > 0 && this.points >= rule.limit && rule.limit !== Infinity) {
        continue;
      }
      totalDelta += proposed;
    }
    if (totalDelta !== 0) {
      this.addPoints(totalDelta, { reason: 'accrual', context });
    }
    return this.points;
  }

  addTrigger(name, condition, { once = false, callback } = {}) {
    if (!name || typeof name !== 'string') {
      throw new Error('Trigger names must be non-empty strings.');
    }
    if (typeof condition !== 'function') {
      throw new Error('Trigger conditions must be functions.');
    }
    this.triggers.set(name, { name, condition, once, callback, fired: false });
    return name;
  }

  removeTrigger(name) {
    return this.triggers.delete(name);
  }

  _evaluateTriggers(previous, context) {
    for (const trigger of this.triggers.values()) {
      if (trigger.once && trigger.fired) {
        continue;
      }
      const shouldFire = trigger.condition({
        current: this.points,
        previous,
        context,
        engine: this,
      });
      if (!shouldFire) {
        continue;
      }
      trigger.fired = true;
      trigger.callback?.({ engine: this, current: this.points, previous, context });
      this.events.emit(`trigger:${trigger.name}`, {
        name: trigger.name,
        current: this.points,
        previous,
        context,
      });
    }
  }
}

export default TacticalPointEngine;

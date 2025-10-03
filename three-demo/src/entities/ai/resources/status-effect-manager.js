import { EventEmitter } from '../../../utils/event-emitter.js';

const STACKING_BEHAVIORS = new Set(['refresh', 'replace', 'stack', 'ignore']);

const normalizeEffectConfig = (effect) => {
  if (!effect || typeof effect !== 'object') {
    throw new Error('Status effects must be provided as objects.');
  }

  const id = effect.id ?? effect.name;
  if (!id || typeof id !== 'string') {
    throw new Error('Status effects require a string "id" or "name".');
  }

  const rawDuration = effect.duration ?? effect.time ?? 0;
  const duration = rawDuration === Infinity ? Infinity : Number(rawDuration);
  if (duration !== Infinity && (!Number.isFinite(duration) || duration < 0)) {
    throw new Error(`Status effect "${id}" duration must be a non-negative finite number or Infinity.`);
  }

  const stacking = effect.stacking ?? effect.stackingBehavior ?? 'refresh';
  if (!STACKING_BEHAVIORS.has(stacking)) {
    throw new Error(
      `Status effect "${id}" has unsupported stacking behavior "${stacking}". Supported behaviors: ${[...STACKING_BEHAVIORS].join(', ')}.`,
    );
  }

  const stacks = Number(effect.stacks ?? effect.stackCount ?? 1);
  if (!Number.isFinite(stacks) || stacks <= 0) {
    throw new Error(`Status effect "${id}" stack count must be a positive finite number.`);
  }

  const maxStacksRaw = effect.maxStacks ?? effect.stackLimit ?? Infinity;
  const maxStacks = maxStacksRaw === Infinity ? Infinity : Number(maxStacksRaw);
  if (maxStacks !== Infinity && (!Number.isFinite(maxStacks) || maxStacks <= 0)) {
    throw new Error(`Status effect "${id}" max stacks must be a positive finite number or Infinity.`);
  }

  return {
    id,
    label: effect.label ?? effect.title ?? id,
    duration,
    remaining: duration,
    stacking,
    stacks,
    maxStacks,
    refreshOnStack: effect.refreshOnStack ?? true,
    data: effect.data ?? {},
    source: effect.source,
    onApply: typeof effect.onApply === 'function' ? effect.onApply : undefined,
    onExpire: typeof effect.onExpire === 'function' ? effect.onExpire : undefined,
    onStack: typeof effect.onStack === 'function' ? effect.onStack : undefined,
    onUpdate: typeof effect.onUpdate === 'function' ? effect.onUpdate : undefined,
  };
};

export class StatusEffectManager {
  constructor({ events } = {}) {
    this.events = events ?? new EventEmitter();
    this.effects = new Map();
  }

  apply(effectConfig, { context } = {}) {
    const effect = normalizeEffectConfig(effectConfig);
    const existing = this.effects.get(effect.id);

    if (!existing) {
      this.effects.set(effect.id, effect);
      effect.onApply?.(effect, { context, manager: this });
      this.events.emit('effect:applied', effect, { context });
      return effect;
    }

    switch (effect.stacking) {
      case 'ignore':
        return existing;
      case 'replace': {
        this._expireEffect(existing, { reason: 'replaced', context, replacement: effect });
        this.effects.set(effect.id, effect);
        effect.onApply?.(effect, { context, manager: this });
        this.events.emit('effect:applied', effect, { context, replaced: existing });
        return effect;
      }
      case 'refresh': {
        existing.remaining = effect.duration;
        existing.data = { ...existing.data, ...effect.data };
        existing.source = effect.source ?? existing.source;
        existing.onUpdate = effect.onUpdate ?? existing.onUpdate;
        existing.onExpire = effect.onExpire ?? existing.onExpire;
        existing.onApply = effect.onApply ?? existing.onApply;
        existing.onStack = effect.onStack ?? existing.onStack;
        this.events.emit('effect:refreshed', existing, { context });
        return existing;
      }
      case 'stack': {
        const previousStacks = existing.stacks;
        const total = Math.min(existing.stacks + effect.stacks, existing.maxStacks);
        existing.stacks = total;
        if (effect.refreshOnStack !== false && effect.duration !== Infinity) {
          existing.remaining = effect.duration;
        }
        existing.data = { ...existing.data, ...effect.data };
        existing.source = effect.source ?? existing.source;
        if (total !== previousStacks) {
          existing.onStack?.(existing, { previous: previousStacks, context, manager: this });
          this.events.emit('effect:stacked', existing, { previous: previousStacks, context });
        } else {
          this.events.emit('effect:stacked', existing, { previous: previousStacks, context, capped: true });
        }
        return existing;
      }
      default:
        return existing;
    }
  }

  has(id) {
    return this.effects.has(id);
  }

  get(id) {
    return this.effects.get(id) ?? null;
  }

  remove(id, { reason = 'removed', context } = {}) {
    const effect = this.effects.get(id);
    if (!effect) {
      return false;
    }
    this._expireEffect(effect, { reason, context });
    return true;
  }

  update(deltaSeconds, { context } = {}) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
      return [];
    }

    const expired = [];
    for (const effect of [...this.effects.values()]) {
      if (effect.duration === Infinity) {
        effect.onUpdate?.(effect, { delta: deltaSeconds, context, manager: this });
        continue;
      }
      effect.remaining = Math.max(effect.remaining - deltaSeconds, 0);
      effect.onUpdate?.(effect, { delta: deltaSeconds, context, manager: this });
      if (effect.remaining === 0) {
        expired.push(effect.id);
        this._expireEffect(effect, { reason: 'expired', context });
      }
    }
    return expired;
  }

  clear({ reason = 'cleared', context } = {}) {
    for (const effect of [...this.effects.values()]) {
      this._expireEffect(effect, { reason, context });
    }
  }

  list() {
    return [...this.effects.values()].map((effect) => ({
      id: effect.id,
      label: effect.label,
      duration: effect.duration,
      remaining: effect.remaining,
      stacks: effect.stacks,
      maxStacks: effect.maxStacks,
      data: effect.data,
      source: effect.source,
    }));
  }

  _expireEffect(effect, { reason, context, replacement } = {}) {
    if (!this.effects.has(effect.id)) {
      return;
    }
    this.effects.delete(effect.id);
    effect.onExpire?.(effect, { reason, context, manager: this, replacement });
    this.events.emit('effect:expired', effect, { reason, context, replacement });
  }
}

export default StatusEffectManager;

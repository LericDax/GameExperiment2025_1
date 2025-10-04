import { BehaviorNode } from '../behavior-nodes.js';
import { createAmbientBehaviorSuite } from './ambient-behaviors.js';

const DEFAULT_BEHAVIOR_ORDER = ['seekSunlight', 'gatherResources', 'idleChatter'];
const MAX_INTENT_HISTORY = 8;

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const cloneValue = (value) => {
  if (!isPlainObject(value)) {
    if (Array.isArray(value)) {
      return value.map((entry) => cloneValue(entry));
    }
    return value;
  }
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = cloneValue(entry);
  }
  return result;
};

const normalizeBehaviorEntry = (entry) => {
  if (entry === false) {
    return { enabled: false, options: null };
  }
  if (entry === true || entry === undefined) {
    return { enabled: true, options: {} };
  }
  if (!isPlainObject(entry)) {
    return { enabled: entry !== false, options: {} };
  }
  const { enabled, options, ...rest } = entry;
  if (enabled === false) {
    return { enabled: false, options: null };
  }
  if (options && isPlainObject(options)) {
    return { enabled: true, options: cloneValue(options) };
  }
  return { enabled: enabled !== false, options: cloneValue(rest) };
};

const trimIntentHistory = (list) => {
  if (!Array.isArray(list)) {
    return [];
  }
  if (list.length <= MAX_INTENT_HISTORY) {
    return list;
  }
  return list.slice(list.length - MAX_INTENT_HISTORY);
};

export class AmbientBehaviorLayer extends BehaviorNode {
  constructor(options = {}) {
    super(options.name ?? 'ambient-behaviors');
    this.scheduler = options.scheduler ?? null;
    this.behaviorConfig = isPlainObject(options.behaviors) ? cloneValue(options.behaviors) : {};
    this.taskRequestOptions = isPlainObject(options.taskRequest)
      ? { ...options.taskRequest }
      : null;
    this.behaviorOrder = Array.isArray(options.order)
      ? options.order.filter((name) => typeof name === 'string')
      : null;
    this.behaviorSuite = null;
    this.enabledBehaviors = [];
    this.context = null;
  }

  configure(options = {}) {
    if (Object.prototype.hasOwnProperty.call(options, 'scheduler')) {
      this.scheduler = options.scheduler ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(options, 'behaviors')) {
      this.behaviorConfig = isPlainObject(options.behaviors) ? cloneValue(options.behaviors) : {};
      this.behaviorSuite = null;
      this.enabledBehaviors = [];
    }
    if (Object.prototype.hasOwnProperty.call(options, 'taskRequest')) {
      this.taskRequestOptions = isPlainObject(options.taskRequest)
        ? { ...options.taskRequest }
        : null;
    }
    if (Object.prototype.hasOwnProperty.call(options, 'order')) {
      this.behaviorOrder = Array.isArray(options.order)
        ? options.order.filter((name) => typeof name === 'string')
        : null;
    }
    if (this.context) {
      this._initializeSuite(this.context, { force: true });
    }
  }

  initialize(context) {
    this.context = context;
    this._initializeSuite(context, { force: true });
  }

  attachToEntity(entity, context) {
    this.context = context;
    this._initializeSuite(context);
    for (const name of this.enabledBehaviors) {
      this.behaviorSuite?.[name]?.attachToEntity?.(entity, context);
    }
  }

  update(delta, context) {
    this.context = context;
    this._initializeSuite(context);
    this._executeAmbientTask(context);
    this._updateBehaviors(delta, context);
  }

  dispose() {
    if (this.behaviorSuite) {
      for (const name of this.enabledBehaviors) {
        this.behaviorSuite[name]?.dispose?.();
      }
    }
    this.behaviorSuite = null;
    this.enabledBehaviors = [];
    this.context = null;
  }

  _resolveScheduler(context) {
    if (this.scheduler) {
      return this.scheduler;
    }
    return context?.ambient?.scheduler ?? context?.ambientScheduler ?? null;
  }

  _initializeSuite(context, { force = false } = {}) {
    const scheduler = this._resolveScheduler(context);
    if (!scheduler) {
      return;
    }
    if (!force && this.behaviorSuite) {
      return;
    }
    this.scheduler = scheduler;
    const { suite, enabled } = this._createBehaviorSuite(scheduler);
    this.behaviorSuite = suite;
    this.enabledBehaviors = enabled;
    for (const name of this.enabledBehaviors) {
      this.behaviorSuite[name]?.initialize?.(context);
    }
  }

  _createBehaviorSuite(scheduler) {
    const desiredOrder =
      this.behaviorOrder && this.behaviorOrder.length > 0
        ? [...new Set(this.behaviorOrder)]
        : [...DEFAULT_BEHAVIOR_ORDER];
    const config = isPlainObject(this.behaviorConfig) ? this.behaviorConfig : {};
    const optionMap = {};
    const enabled = [];
    const names = new Set([...desiredOrder, ...Object.keys(config)]);
    for (const name of names) {
      const normalized = normalizeBehaviorEntry(config[name]);
      if (!normalized.enabled) {
        continue;
      }
      if (normalized.options) {
        optionMap[name] = normalized.options;
      }
      enabled.push(name);
    }
    const suite = createAmbientBehaviorSuite(scheduler, optionMap);
    const filtered = enabled.filter((name) => suite[name]);
    return { suite, enabled: filtered };
  }

  _updateBehaviors(delta, context) {
    if (!this.behaviorSuite) {
      return;
    }
    for (const name of this.enabledBehaviors) {
      this.behaviorSuite[name]?.update?.(delta, context);
    }
  }

  _executeAmbientTask(context) {
    const scheduler = this._resolveScheduler(context);
    if (!scheduler) {
      return;
    }
    const requestOptions = this.taskRequestOptions ? { ...this.taskRequestOptions } : {};
    const handle = scheduler.requestTask(context, requestOptions);
    if (!handle) {
      return;
    }
    const result = handle.execute?.(context) ?? null;
    if (!result || result.success === false) {
      handle.fail(result?.reason ?? 'failed');
      return;
    }
    handle.succeed(result);
    const intent = this._mapInstructionToIntent(result, handle);
    if (intent) {
      this._recordIntent(context, intent, { task: handle.name, result: cloneValue(result) });
    }
  }

  _mapInstructionToIntent(result, handle) {
    if (!result) {
      return null;
    }
    const task = handle?.name ?? result.task ?? null;
    const target = result.target ? cloneValue(result.target) : null;
    if (result.type === 'movement') {
      if (result.style === 'explore') {
        if (result.intent === 'resource') {
          return { type: 'gather-resource', target, task };
        }
        if (result.intent === 'poi') {
          return { type: 'inspect-poi', target, task };
        }
        return { type: 'explore-area', target, task };
      }
      if (result.style === 'wander') {
        return { type: 'wander', target, task };
      }
      return { type: 'move-to', target, style: result.style ?? 'movement', task };
    }
    if (result.type === 'social') {
      if (result.style === 'chat') {
        return {
          type: 'socialize',
          partner: result.partner ? cloneValue(result.partner) : null,
          message: result.message ?? null,
          task,
        };
      }
      return { type: 'social', payload: cloneValue(result), task };
    }
    if (typeof result.intent === 'string') {
      return { type: result.intent, payload: cloneValue(result), task };
    }
    return { type: 'ambient-task', payload: cloneValue(result), task };
  }

  _recordIntent(context, intent, meta = {}) {
    if (!context || !intent) {
      return;
    }
    const record = { ...intent };
    context.intents ??= {};
    const existing = Array.isArray(context.intents.ambient) ? context.intents.ambient : [];
    const next = trimIntentHistory([...existing, record]);
    context.intents.ambient = next;
    context.ambient ??= {};
    context.ambient.lastIntent = record;
    context.ambient.intents = next;

    const eventPayload = { ...meta, intent: record };
    if (typeof context.emit === 'function') {
      context.emit('ambient:intent', record, { ...eventPayload, context });
    } else if (context.ai?.events?.emit) {
      context.ai.events.emit('ambient:intent', record, { ...eventPayload, context });
    }
  }
}

export default AmbientBehaviorLayer;

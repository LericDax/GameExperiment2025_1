import { EventEmitter } from '../../../utils/event-emitter.js';

/**
 * Base class for AI perception sensors. Subclasses emit structured stimuli by
 * implementing `sampleWorld`, while the base class handles cadence, wiring, and
 * metadata enrichment.
 */
export class MobSensor {
  /**
   * @param {{
   *   id?: string,
   *   type?: string,
   *   label?: string,
   *   interval?: number,
   *   enabled?: boolean
   * }} [options]
   */
  constructor(options = {}) {
    const {
      id = null,
      type = 'generic',
      label = type,
      interval = 0,
      enabled = true,
    } = options;

    this.id = id ?? `${type}-${Math.random().toString(36).slice(2, 8)}`;
    this.type = type;
    this.label = label;
    this.interval = Math.max(0, interval);
    this.enabled = enabled;

    this.entity = null;
    this.world = null;
    this.onEmit = null;

    this._emitter = new EventEmitter();
    this._configured = false;
    this._lastSampleTime = -Infinity;
  }

  on(eventName, listener) {
    this._emitter.on(eventName, listener);
    return this;
  }

  off(eventName, listener) {
    this._emitter.off(eventName, listener);
    return this;
  }

  emit(eventName, ...args) {
    this._emitter.emit(eventName, ...args);
  }

  /**
   * Configures runtime references the sensor requires to function.
   * @param {{ entity?: any, world?: any, onEmit?: Function }} [configuration]
   * @returns {MobSensor}
   */
  configure(configuration = {}) {
    const { entity, world, onEmit } = configuration;
    let reconfigured = false;
    if (entity !== undefined && entity !== this.entity) {
      this.entity = entity;
      reconfigured = true;
    }
    if (world !== undefined && world !== this.world) {
      this.world = world;
      reconfigured = true;
    }
    if (onEmit !== undefined) {
      this.onEmit = onEmit;
    }
    if (reconfigured || !this._configured) {
      this.onConfigure?.({ entity: this.entity, world: this.world });
      this._configured = true;
    }
    return this;
  }

  /**
   * Toggles whether the sensor should emit stimuli during updates.
   * @param {boolean} enabled
   * @returns {MobSensor}
   */
  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    return this;
  }

  /**
   * Determines if the sensor should sample based on its interval and enabled state.
   * @param {number} time - Current simulation timestamp.
   * @returns {boolean}
   */
  shouldSample(time) {
    if (!this.enabled) {
      return false;
    }
    if (this.interval <= 0) {
      return true;
    }
    return time - this._lastSampleTime >= this.interval;
  }

  /**
   * Runs the sampling pipeline and emits any detected stimuli.
   * @param {{ time?: number, delta?: number, world?: any, entity?: any }} [context]
   * @returns {Array<Object>} Stimuli emitted during the update.
   */
  update(context = {}) {
    const { time = 0, delta = 0, world = this.world } = context;
    if (!this.shouldSample(time)) {
      return [];
    }
    const stimuli = this.sampleWorld({
      time,
      delta,
      world,
      entity: this.entity,
    });
    this._lastSampleTime = time;
    return this.emitStimuli(stimuli, { time, delta, world });
  }

  /**
   * Subclasses must implement this to return a stimulus or array of stimuli.
   * @abstract
   */
  sampleWorld() {
    throw new Error(
      `${this.constructor.name} must implement sampleWorld(context)`,
    );
  }

  /**
   * Normalizes raw stimuli and forwards them to listeners.
   * @param {Object|Array<Object>} stimuli
   * @param {{ time?: number, delta?: number, world?: any }} [meta]
   * @returns {Array<Object>} Enriched stimuli payloads.
   */
  emitStimuli(stimuli, meta = {}) {
    if (!stimuli) {
      return [];
    }
    const batch = Array.isArray(stimuli) ? stimuli : [stimuli];
    if (batch.length === 0) {
      return [];
    }
    const enriched = batch.map((stimulus) => {
      const result = { ...stimulus };
      if (!('timestamp' in result) && meta.time !== undefined) {
        result.timestamp = meta.time;
      }
      result.sensorId = this.id;
      result.sensorType = this.type;
      return result;
    });

    for (const stimulus of enriched) {
      this.onEmit?.(stimulus, meta);
      this.emit('stimulus', stimulus, meta);
    }

    if (enriched.length > 0) {
      this.emit('stimuli', enriched, meta);
    }

    return enriched;
  }
}

export default MobSensor;

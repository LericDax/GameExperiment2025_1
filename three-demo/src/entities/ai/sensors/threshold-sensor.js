import { MobSensor } from './mob-sensor.js';

/**
 * Emits a stimulus when a sampled scalar crosses a configured threshold.
 */
export class ThresholdSensor extends MobSensor {
  /**
   * @param {{
   *   id?: string,
   *   interval?: number,
   *   threshold?: number,
   *   onlyOnCrossing?: boolean,
   *   label?: string,
   *   getValue?: Function,
   *   comparator?: Function,
   *   intensityMapper?: Function
   * }} [options]
   */
  constructor(options = {}) {
    const {
      id = 'threshold',
      interval = options.interval ?? 0,
      threshold = options.threshold ?? 0,
      onlyOnCrossing = options.onlyOnCrossing ?? true,
    } = options;
    super({ id, type: 'threshold', label: options.label ?? 'Threshold', interval });

    this.threshold = threshold;
    this.onlyOnCrossing = onlyOnCrossing;

    this.getValue = options.getValue ?? (() => 0);
    this.comparator =
      options.comparator ?? ((value, limit) => value >= limit);
    this.intensityMapper =
      options.intensityMapper ??
      (({ value, threshold: limit }) => Math.max(0, value - limit));

    this._lastValue = null;
    this._above = false;
  }

  /**
   * @param {{ world: any, entity: any, time: number, delta: number }} context
   * @returns {Array<Object>} Stimuli produced when the threshold condition is met.
   */
  sampleWorld(context) {
    const { world, entity, time, delta } = context;
    const previousValue = this._lastValue;
    const value = this.getValue({
      world,
      entity,
      time,
      delta,
      previous: previousValue,
    });
    this._lastValue = value;
    const meets = this.comparator(value, this.threshold, {
      world,
      entity,
      time,
      delta,
      previous: previousValue,
    });

    let emit = meets;
    if (this.onlyOnCrossing) {
      emit = meets && !this._above;
    }

    this._above = meets;

    if (!emit) {
      if (!meets) {
        this._above = false;
      }
      return [];
    }

    const intensity = this.intensityMapper({
      value,
      threshold: this.threshold,
      world,
      entity,
      time,
      delta,
      previous: previousValue,
    });

    const direction =
      previousValue === null || value >= previousValue ? 'rising' : 'falling';

    return [
      {
        value,
        threshold: this.threshold,
        intensity,
        direction,
      },
    ];
  }
}

export default ThresholdSensor;

import { EventEmitter } from '../../../utils/event-emitter.js';
import { MobSensor } from './mob-sensor.js';

/**
 * Maintains a collection of sensors for a single entity and proxies emitted
 * stimuli to both local listeners and the owning AI core.
 */
export class SensorSuite extends EventEmitter {
  /**
   * @param {{ sensors?: MobSensor[], entity?: any, world?: any, aiCore?: any, time?: number }} [options]
   */
  constructor(options = {}) {
    super();
    const { sensors = [], time = 0 } = options;

    this.time = time;
    this.entity = options.entity ?? null;
    this.world = options.world ?? null;
    this.aiCore = options.aiCore ?? null;

    this.sensors = new Map();
    sensors.forEach((sensor) => this.addSensor(sensor));
  }

  /**
   * Registers a sensor instance and configures it if the suite is already bound.
   * @param {MobSensor} sensor
   * @returns {MobSensor}
   */
  addSensor(sensor) {
    if (!(sensor instanceof MobSensor)) {
      throw new Error('SensorSuite expects sensors to extend MobSensor.');
    }
    if (this.sensors.has(sensor.id)) {
      throw new Error(`Sensor with id "${sensor.id}" is already registered.`);
    }
    this.sensors.set(sensor.id, sensor);
    if (this.entity || this.world) {
      sensor.configure({ entity: this.entity, world: this.world });
    }
    return sensor;
  }

  /**
   * Removes a sensor by id.
   * @param {string} id
   * @returns {MobSensor|null}
   */
  removeSensor(id) {
    const sensor = this.sensors.get(id);
    if (sensor) {
      this.sensors.delete(id);
    }
    return sensor;
  }

  /**
   * Updates the shared entity/world references used by every sensor in the suite.
   * @param {{ entity?: any, world?: any, aiCore?: any }} [configuration]
   * @returns {SensorSuite}
   */
  configure(configuration = {}) {
    const { entity, world, aiCore } = configuration;
    if (entity !== undefined) {
      this.entity = entity;
    }
    if (world !== undefined) {
      this.world = world;
    }
    if (aiCore !== undefined) {
      this.aiCore = aiCore;
    }

    for (const sensor of this.sensors.values()) {
      sensor.configure({ entity: this.entity, world: this.world });
    }

    return this;
  }

  /**
   * Advances all registered sensors and emits aggregated stimuli.
   * @param {number} [delta=0]
   * @param {{ entity?: any, world?: any, aiCore?: any }} [overrides]
   * @returns {Array<Object>} Stimuli gathered during the update.
   */
  update(delta = 0, overrides = {}) {
    if (overrides.entity !== undefined) {
      this.entity = overrides.entity;
    }
    if (overrides.world !== undefined) {
      this.world = overrides.world;
    }
    if (overrides.aiCore !== undefined) {
      this.aiCore = overrides.aiCore;
    }

    this.time += delta;
    const aggregated = [];
    const meta = {
      time: this.time,
      delta,
      entity: this.entity,
      world: this.world,
    };

    const onEmit = (stimulus) => {
      aggregated.push(stimulus);
    };

    for (const sensor of this.sensors.values()) {
      sensor.configure({
        entity: this.entity,
        world: this.world,
        onEmit,
      });
      sensor.update({
        time: this.time,
        delta,
        world: this.world,
      });
    }

    if (aggregated.length > 0) {
      this.emit('stimuli', aggregated, meta);
      for (const stimulus of aggregated) {
        this.emit('stimulus', stimulus, meta);
      }

      if (this.aiCore?.emit) {
        this.aiCore.emit('sensor:stimuli', aggregated, meta);
        for (const stimulus of aggregated) {
          this.aiCore.emit('sensor:stimulus', stimulus, meta);
        }
      }
    }

    return aggregated;
  }
}

export default SensorSuite;

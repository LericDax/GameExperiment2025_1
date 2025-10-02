import { EventEmitter } from 'node:events';
import { MobSensor } from './mob-sensor.js';

export class SensorSuite extends EventEmitter {
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

  removeSensor(id) {
    const sensor = this.sensors.get(id);
    if (sensor) {
      this.sensors.delete(id);
    }
    return sensor;
  }

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

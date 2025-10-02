import { Vector3 } from 'three';
import { MobSensor } from './mob-sensor.js';

const tmpOrigin = new Vector3();
const tmpOffset = new Vector3();

const cloneVector3 = (value) => {
  if (!value) {
    return new Vector3();
  }
  if (value.isVector3) {
    return value.clone();
  }
  return new Vector3(value.x ?? 0, value.y ?? 0, value.z ?? 0);
};

export class RingProximitySensor extends MobSensor {
  constructor(options = {}) {
    const {
      id = 'ring-proximity',
      interval = options.interval ?? 0,
      innerRadius = options.innerRadius ?? 0,
      outerRadius = options.outerRadius ?? 5,
    } = options;
    super({ id, type: 'proximity', label: options.label ?? 'Proximity', interval });

    if (outerRadius <= 0) {
      throw new Error('RingProximitySensor requires a positive outerRadius.');
    }
    if (innerRadius < 0) {
      throw new Error('RingProximitySensor innerRadius cannot be negative.');
    }
    if (innerRadius > outerRadius) {
      throw new Error('RingProximitySensor innerRadius must be <= outerRadius.');
    }

    this.innerRadius = innerRadius;
    this.outerRadius = outerRadius;

    this.queryTargets = options.queryTargets ?? (() => []);
    this.getOrigin = options.getOrigin ?? ((entity) => entity?.position);
    this.getTargetPosition =
      options.getTargetPosition ?? ((target) => target?.position);
    this.filterTarget = options.filterTarget ?? null;
    this.decay =
      options.decay ??
      (({ distance, innerRadius, outerRadius }) => {
        if (outerRadius === innerRadius) {
          return 1;
        }
        const normalized = (distance - innerRadius) / (outerRadius - innerRadius);
        return Math.max(0, 1 - normalized);
      });
  }

  sampleWorld(context) {
    const { world, entity, time, delta } = context;
    if (!entity) {
      return [];
    }

    const originSource = this.getOrigin(entity);
    if (!originSource) {
      return [];
    }

    tmpOrigin.copy(cloneVector3(originSource));
    const contextInfo = { world, entity, time, delta };
    const candidates = this.queryTargets(contextInfo) ?? [];
    const detections = [];

    for (const target of candidates) {
      if (this.filterTarget && !this.filterTarget(target, contextInfo)) {
        continue;
      }
      const positionSource = this.getTargetPosition(target, contextInfo);
      if (!positionSource) {
        continue;
      }
      const targetPosition = cloneVector3(positionSource);
      tmpOffset.copy(targetPosition).sub(tmpOrigin);
      const distance = tmpOffset.length();
      if (distance < this.innerRadius || distance > this.outerRadius) {
        continue;
      }

      const intensity = this.decay({
        distance,
        innerRadius: this.innerRadius,
        outerRadius: this.outerRadius,
        target,
        entity,
        world,
        time,
        delta,
      });

      detections.push({
        target,
        position: targetPosition.clone(),
        distance,
        intensity,
      });
    }

    return detections;
  }
}

export default RingProximitySensor;

import { Vector3 } from 'three';
import { MobSensor } from './mob-sensor.js';

const tmpDirection = new Vector3();
const tmpForward = new Vector3();
const tmpOrigin = new Vector3();

const cloneVector3 = (value) => {
  if (!value) {
    return new Vector3();
  }
  if (value.isVector3) {
    return value.clone();
  }
  return new Vector3(value.x ?? 0, value.y ?? 0, value.z ?? 0);
};

export class ConeVisionSensor extends MobSensor {
  constructor(options = {}) {
    const {
      id = 'cone-vision',
      interval = options.interval ?? 0,
      range = options.range ?? 10,
      angle = options.angle ?? Math.PI / 3,
    } = options;
    super({ id, type: 'vision', label: options.label ?? 'Vision', interval });

    this.range = range;
    this.angle = angle;

    this.queryTargets = options.queryTargets ?? (() => []);
    this.getOrigin = options.getOrigin ?? ((entity) => entity?.position);
    this.getForward =
      options.getForward ?? ((entity) => entity?.forward ?? { x: 0, y: 0, z: 1 });
    this.getTargetPosition =
      options.getTargetPosition ?? ((target) => target?.position);
    this.filterTarget = options.filterTarget ?? null;
    this.isOccluded = options.isOccluded ?? null;
    this.decay =
      options.decay ??
      (({ distance, range }) => Math.max(0, 1 - distance / Math.max(range, 1)));
  }

  sampleWorld(context) {
    const { world, entity, time, delta } = context;
    if (!entity || !this.range || this.range <= 0) {
      return [];
    }

    const originSource = this.getOrigin(entity);
    const forwardSource = this.getForward(entity);
    if (!originSource || !forwardSource) {
      return [];
    }

    tmpOrigin.copy(cloneVector3(originSource));
    tmpForward.copy(cloneVector3(forwardSource));
    if (tmpForward.lengthSq() === 0) {
      tmpForward.set(0, 0, 1);
    }
    tmpForward.normalize();

    const halfAngle = Math.max(0, this.angle) / 2;
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
      tmpDirection.copy(targetPosition).sub(tmpOrigin);
      const distance = tmpDirection.length();
      if (distance === 0) {
        continue;
      }
      if (distance > this.range) {
        continue;
      }
      tmpDirection.divideScalar(distance);
      const angleToTarget = tmpForward.angleTo(tmpDirection);
      if (angleToTarget > halfAngle) {
        continue;
      }
      if (
        this.isOccluded &&
        this.isOccluded({
          target,
          origin: tmpOrigin,
          targetPosition,
          direction: tmpDirection,
          distance,
          world,
          entity,
          time,
          delta,
        })
      ) {
        continue;
      }

      const intensity = this.decay({
        distance,
        range: this.range,
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
        angle: angleToTarget,
        direction: tmpDirection.clone(),
      });
    }

    return detections;
  }
}

export default ConeVisionSensor;

import { CrownedGhostEntity } from './crowned-ghost.js';

const WALK_STATE = 'walk';
const IDLE_STATE = 'idle';

export class CrownedGhostRunnerEntity extends CrownedGhostEntity {
  constructor(params = {}) {
    super(params);

    const behavior = params.behavior ?? params.options?.behavior ?? {};
    this.random = typeof params.random === 'function' ? params.random : Math.random;

    this.walkDurationRange =
      Array.isArray(behavior.walkDurationRange) && behavior.walkDurationRange.length >= 1
        ? behavior.walkDurationRange
        : [3.5, 6];
    this.idleDurationRange =
      Array.isArray(behavior.idleDurationRange) && behavior.idleDurationRange.length >= 1
        ? behavior.idleDurationRange
        : [2, 4];

    this.walkSpeed = Number.isFinite(behavior.walkSpeed) ? behavior.walkSpeed : 0.9;
    this.idleYawAmount = Number.isFinite(behavior.idleYawAmount)
      ? behavior.idleYawAmount
      : 0.35;
    this.idleYawSpeed = Number.isFinite(behavior.idleYawSpeed) ? behavior.idleYawSpeed : 0.7;
    this.walkHeadingJitter = Number.isFinite(behavior.walkHeadingJitter)
      ? behavior.walkHeadingJitter
      : Math.PI / 2;
    this.collisionIdleDuration = Number.isFinite(behavior.collisionIdleDuration)
      ? Math.max(0.15, behavior.collisionIdleDuration)
      : Math.max(0.6, this.idleDurationRange[0] ?? 0.6);

    this.behaviorState = IDLE_STATE;
    this.behaviorTime = 0;
    this.behaviorDuration = this.chooseIdleDuration();
    this.heading = new this.THREE.Vector3(0, 0, 1);
    this.headingAngle = 0;
    this.previousHeadingAngle = 0;

    this.idleBaseYaw = 0;
    this.idleYawPhase = this.random() * Math.PI * 2;

    this._scratchPreviousPosition = new this.THREE.Vector3();
  }

  onSpawn(spawnContext, options = {}) {
    super.onSpawn(spawnContext, options);
    this.enterIdleState({});
  }

  enterIdleState({ duration } = {}) {
    this.behaviorState = IDLE_STATE;
    this.behaviorTime = 0;
    this.behaviorDuration = Number.isFinite(duration)
      ? Math.max(0.1, duration)
      : this.chooseIdleDuration();
    this.idleBaseYaw = this.normalizeAngle(this.root.rotation.y || this.headingAngle || 0);
    this.idleYawPhase = this.random() * Math.PI * 2;
    this.playAnimationVariant('idle', { loopMode: this.THREE.LoopRepeat });
  }

  enterWalkState({ duration, headingAngle } = {}) {
    this.behaviorState = WALK_STATE;
    this.behaviorTime = 0;
    const nextDuration = Number.isFinite(duration)
      ? Math.max(0.1, duration)
      : this.chooseWalkDuration();
    this.behaviorDuration = nextDuration;

    const candidateHeading =
      typeof headingAngle === 'number' ? headingAngle : this.chooseNextHeadingAngle();
    this.setHeadingAngle(candidateHeading);
    this.playAnimationVariant('runner', { loopMode: this.THREE.LoopRepeat });
  }

  chooseWalkDuration() {
    return this.sampleRange(this.walkDurationRange, 4.5);
  }

  chooseIdleDuration() {
    return this.sampleRange(this.idleDurationRange, 2.6);
  }

  chooseNextHeadingAngle() {
    const jitterRange = Math.max(0, this.walkHeadingJitter || 0);
    let attempts = 4;
    let candidate = this.root.rotation.y || this.headingAngle || 0;
    if (jitterRange === 0) {
      return candidate;
    }
    do {
      const offset = (this.random() * 2 - 1) * jitterRange;
      candidate = (this.root.rotation.y || this.headingAngle || 0) + offset;
      attempts -= 1;
    } while (attempts > 0 && Math.abs(this.angleDifference(candidate, this.headingAngle)) < 0.3);
    return candidate;
  }

  sampleRange(range, fallback) {
    if (!Array.isArray(range) || range.length === 0) {
      return Math.max(0.1, fallback);
    }
    const [minRaw, maxRaw = minRaw] = range;
    const min = Number.isFinite(minRaw) ? minRaw : fallback;
    const max = Number.isFinite(maxRaw) ? maxRaw : min;
    if (max <= min) {
      return Math.max(0.1, min);
    }
    const t = this.random();
    return min + (max - min) * t;
  }

  setHeadingAngle(angle) {
    const normalized = this.normalizeAngle(angle);
    this.previousHeadingAngle = this.headingAngle;
    this.headingAngle = normalized;
    this.heading.set(Math.sin(normalized), 0, Math.cos(normalized)).normalize();
    this.root.rotation.y = normalized;
    this.markBoundsDirty();
  }

  normalizeAngle(angle) {
    if (!Number.isFinite(angle)) {
      return 0;
    }
    let result = angle % (Math.PI * 2);
    if (result <= -Math.PI) {
      result += Math.PI * 2;
    } else if (result > Math.PI) {
      result -= Math.PI * 2;
    }
    return result;
  }

  angleDifference(a, b) {
    const diff = this.normalizeAngle(a) - this.normalizeAngle(b);
    return this.normalizeAngle(diff);
  }

  update({ delta = 0, elapsedTime = 0 } = {}) {
    if (!this.visualRoot) {
      return;
    }

    const hoverValue = Math.sin(elapsedTime * this.hoverSpeed + this.hoverPhase);
    this.visualRoot.position.y = this.baseHoverOffset + hoverValue * this.hoverAmplitude;

    const swayValue = Math.sin(elapsedTime * this.swaySpeed + this.swayPhase);
    this.visualRoot.position.x = swayValue * this.swayAmplitude;

    if (!Number.isFinite(delta) || delta <= 0) {
      return;
    }

    this.behaviorTime += delta;
    if (this.behaviorState === WALK_STATE) {
      this.updateWalkState(delta);
    } else {
      this.updateIdleState(delta, elapsedTime);
    }

    if (this.behaviorTime >= this.behaviorDuration) {
      if (this.behaviorState === WALK_STATE) {
        this.enterIdleState({});
      } else {
        this.enterWalkState({});
      }
    }
  }

  updateWalkState(delta) {
    const step = Math.max(0, delta) * this.walkSpeed;
    if (step <= 0) {
      return;
    }
    this._scratchPreviousPosition.copy(this.root.position);
    this.root.position.addScaledVector(this.heading, step);
    this.root.rotation.y = this.headingAngle;
    this.markBoundsDirty();

    const samples = this.gatherCollisionSamples();
    const blocked = Array.isArray(samples)
      ? samples.some((sample) => sample?.isSolid && (sample.label === 'forward' || sample.label === 'center'))
      : false;
    if (blocked) {
      this.root.position.copy(this._scratchPreviousPosition);
      this.markBoundsDirty();
      this.enterIdleState({ duration: this.collisionIdleDuration });
    }
  }

  updateIdleState(delta, elapsedTime) {
    const yawOffset = Math.sin(elapsedTime * this.idleYawSpeed + this.idleYawPhase) * this.idleYawAmount;
    const targetYaw = this.normalizeAngle(this.idleBaseYaw + yawOffset);
    this.root.rotation.y = targetYaw;
    this.headingAngle = targetYaw;
  }

  dispose() {
    this.behaviorState = IDLE_STATE;
    super.dispose();
  }
}


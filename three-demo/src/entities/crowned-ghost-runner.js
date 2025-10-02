import { CrownedGhostEntity } from './crowned-ghost.js';

const RUNNER_MODEL_CONFIG = {
  baseUrl: new URL(
    '../models/entity_ghost_guy_1/entity_ghost_guy_1_runner.glb',
    import.meta.url,
  ).href,
  animationMap: {
    runner: {
      NlaTrack: 'runner',
      '*': 'runner',
    },
  },
};

const WALK_STATE = 'walk';
const IDLE_STATE = 'idle';
const TURN_STATE = 'turn';

export class CrownedGhostRunnerEntity extends CrownedGhostEntity {
  constructor(params = {}) {
    const modelConfig = params?.modelConfig ?? RUNNER_MODEL_CONFIG;
    super({ ...params, modelConfig });

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
    this.walkAcceleration = Number.isFinite(behavior.walkAcceleration)
      ? Math.max(0.1, behavior.walkAcceleration)
      : 2.4;
    this.walkDeceleration = Number.isFinite(behavior.walkDeceleration)
      ? Math.max(0.1, behavior.walkDeceleration)
      : 3.2;
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
    this.turnInPlaceDuration = Number.isFinite(behavior.turnInPlaceDuration)
      ? Math.max(0.1, behavior.turnInPlaceDuration)
      : 1.25;
    this.turnAlignmentThreshold = Number.isFinite(behavior.turnAlignmentThreshold)
      ? Math.max(0.01, behavior.turnAlignmentThreshold)
      : 0.12;
    this.turnResumeClearance = Number.isFinite(behavior.turnResumeClearance)
      ? this.THREE.MathUtils.clamp(behavior.turnResumeClearance, 0.1, 1)
      : 0.65;
    this.blockedHeadingMemoryDuration = Number.isFinite(behavior.blockedHeadingMemoryDuration)
      ? Math.max(0.1, behavior.blockedHeadingMemoryDuration)
      : 4;
    this.blockedHeadingAvoidanceAngle = Number.isFinite(behavior.blockedHeadingAvoidanceAngle)
      ? Math.max(0.01, behavior.blockedHeadingAvoidanceAngle)
      : Math.PI / 2.5;
    this.headingClearanceThreshold = Number.isFinite(behavior.headingClearanceThreshold)
      ? this.THREE.MathUtils.clamp(behavior.headingClearanceThreshold, 0, 1)
      : 0.55;
    this.runnerAnimationSpeedScale = Number.isFinite(behavior.runnerAnimationSpeedScale)
      ? Math.max(0.01, behavior.runnerAnimationSpeedScale)
      : 1;
    this.runnerAnimationSpeedFloor = Number.isFinite(behavior.runnerAnimationSpeedFloor)
      ? Math.max(0.01, behavior.runnerAnimationSpeedFloor)
      : 0.35;
    this.runnerAnimationSpeedCeil = Number.isFinite(behavior.runnerAnimationSpeedCeil)
      ? Math.max(this.runnerAnimationSpeedFloor, behavior.runnerAnimationSpeedCeil)
      : 1.2;

    this.behaviorState = IDLE_STATE;
    this.behaviorTime = 0;
    this.behaviorDuration = this.chooseIdleDuration();
    this.heading = new this.THREE.Vector3(0, 0, 1);
    this.headingAngle = 0;
    this.targetHeadingAngle = 0;
    this.previousHeadingAngle = 0;
    this.headingTurnSpeed = Number.isFinite(behavior.headingTurnSpeed)
      ? behavior.headingTurnSpeed
      : 6;

    this.visualYawOffset = 0;

    this.idleBaseYaw = 0;
    this.idleYawPhase = this.random() * Math.PI * 2;

    this._scratchPreviousPosition = new this.THREE.Vector3();
    this.pendingRunnerAnimation = false;
    this.currentMoveSpeed = 0;
    this.recentBlockedHeadings = [];
    this.headingProbeDistances = [
      Math.max(0.2, this.collisionRadius * 0.75),
      Math.max(0.35, this.collisionRadius * 1.45),
      Math.max(0.5, this.collisionRadius * 2.15),
    ];
    this.headingProbeHeights = [
      -Math.max(0.1, this.collisionHalfHeight),
      -Math.max(0.1, this.collisionHalfHeight * 0.35),
    ];
    this._scratchHeadingDirection = new this.THREE.Vector3();
    this._scratchHeadingSample = new this.THREE.Vector3();
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
    this.targetHeadingAngle = this.headingAngle;
    this.idleBaseYaw = this.normalizeAngle(this.headingAngle || this.targetHeadingAngle || 0);
    this.idleYawPhase = this.random() * Math.PI * 2;
    this.playAnimationVariant('idle', { loopMode: this.THREE.LoopRepeat });
    this.visualYawOffset = 0;
    this.applyVisualYaw();
    this.pendingRunnerAnimation = false;
    this.updateRunnerAnimationSpeed();
  }

  enterWalkState({ duration, headingAngle } = {}) {
    this.behaviorState = WALK_STATE;
    this.behaviorTime = 0;
    const nextDuration = Number.isFinite(duration)
      ? Math.max(0.1, duration)
      : this.chooseWalkDuration();
    this.behaviorDuration = nextDuration;

    let candidateHeading =
      typeof headingAngle === 'number' ? headingAngle : this.chooseNextHeadingAngle();
    let attempts = 3;
    while (attempts > 0 && !this.isHeadingMostlyClear(candidateHeading)) {
      this.rememberBlockedHeading(candidateHeading);
      candidateHeading = this.chooseNextHeadingAngle();
      attempts -= 1;
    }
    this.setHeadingAngle(candidateHeading);
    this.visualYawOffset = 0;
    this.applyVisualYaw();
    const runnerAction = this.playAnimationVariant('runner', {
      loopMode: this.THREE.LoopRepeat,
      fallbackToDefault: false,
    });
    if (runnerAction) {
      this.pendingRunnerAnimation = false;
      this.updateRunnerAnimationSpeed();
      return;
    }

    const variantsLoaded = this.areAnimationVariantsLoaded();
    const runnerClipAvailable = this.variantClipMap instanceof Map && this.variantClipMap.has('runner');

    if (variantsLoaded && !runnerClipAvailable) {
      console.assert(
        false,
        'CrownedGhostRunnerEntity: Missing "runner" animation variant after assets finished loading.',
      );
      this.pendingRunnerAnimation = false;
      this.playAnimationVariant('idle', { loopMode: this.THREE.LoopRepeat });
      return;
    }

    this.pendingRunnerAnimation = true;
    this.updateRunnerAnimationSpeed();
  }

  enterTurnState({ headingAngle, duration } = {}) {
    this.behaviorState = TURN_STATE;
    this.behaviorTime = 0;
    this.behaviorDuration = Number.isFinite(duration)
      ? Math.max(0.1, duration)
      : this.turnInPlaceDuration;
    if (typeof headingAngle === 'number') {
      this.setHeadingAngle(headingAngle);
    }
    this.playAnimationVariant('idle', { loopMode: this.THREE.LoopRepeat });
    this.visualYawOffset = 0;
    this.applyVisualYaw();
    this.pendingRunnerAnimation = false;
    this.updateRunnerAnimationSpeed();
  }

  chooseWalkDuration() {
    return this.sampleRange(this.walkDurationRange, 4.5);
  }

  chooseIdleDuration() {
    return this.sampleRange(this.idleDurationRange, 2.6);
  }

  chooseNextHeadingAngle() {
    const jitterRange = Math.max(0, this.walkHeadingJitter || 0);
    const base = this.targetHeadingAngle || this.headingAngle || 0;
    const sampleCount = jitterRange > 0 ? 6 : 1;
    let bestCandidate = base;
    let bestScore = -Infinity;
    for (let index = 0; index < sampleCount; index += 1) {
      let candidate = base;
      if (index > 0 && jitterRange > 0) {
        const offset = (this.random() * 2 - 1) * jitterRange;
        candidate = base + offset;
      }
      const score = this.evaluateHeadingCandidate(candidate);
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }
    return bestCandidate;
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
    if (Number.isFinite(this.headingAngle)) {
      this.previousHeadingAngle = this.headingAngle;
    }
    const normalized = this.normalizeAngle(angle);
    this.targetHeadingAngle = normalized;
  }

  blendHeadingAngle(delta) {
    const current = Number.isFinite(this.headingAngle) ? this.headingAngle : 0;
    const target = Number.isFinite(this.targetHeadingAngle)
      ? this.targetHeadingAngle
      : current;
    const hasSmoothing =
      Number.isFinite(delta) &&
      delta > 0 &&
      Number.isFinite(this.headingTurnSpeed) &&
      this.headingTurnSpeed > 0;
    let next = current;
    if (hasSmoothing) {
      const tRaw = 1 - Math.exp(-delta * this.headingTurnSpeed);
      const t = this.THREE.MathUtils.clamp(Number.isFinite(tRaw) ? tRaw : 1, 0, 1);
      next = this.lerpAngles(current, target, t);
    } else if (Number.isFinite(delta) && delta > 0) {
      next = target;
    }

    const normalized = this.normalizeAngle(next);
    const changed = normalized !== this.headingAngle;
    this.headingAngle = normalized;
    this.heading.set(Math.sin(normalized), 0, Math.cos(normalized)).normalize();
    this.root.rotation.y = normalized;
    if (changed) {
      this.markBoundsDirty();
    }
    return this.headingAngle;
  }

  applyVisualYaw() {
    if (!this.visualRoot) {
      return;
    }
    const offset = Number.isFinite(this.visualYawOffset) ? this.visualYawOffset : 0;
    this.visualRoot.rotation.y = this.normalizeAngle(this.headingAngle + offset);
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

  lerpAngles(a, b, t) {
    const math = this.THREE?.MathUtils ?? null;
    if (math && typeof math.lerpAngles === 'function') {
      return math.lerpAngles(a, b, t);
    }
    const clampedT = math ? math.clamp(Number.isFinite(t) ? t : 0, 0, 1) : 0;
    const start = this.normalizeAngle(a);
    const end = this.normalizeAngle(b);
    const diff = this.normalizeAngle(end - start);
    return this.normalizeAngle(start + diff * clampedT);
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

    this.decayBlockedHeadings(delta);
    this.behaviorTime += delta;
    if (this.behaviorState === WALK_STATE) {
      this.updateWalkState(delta);
    } else if (this.behaviorState === TURN_STATE) {
      this.updateTurnState(delta);
    } else {
      this.updateIdleState(delta, elapsedTime);
    }

    if (this.behaviorTime >= this.behaviorDuration) {
      if (this.behaviorState === WALK_STATE) {
        this.enterIdleState({});
      } else if (this.behaviorState === IDLE_STATE) {
        this.enterWalkState({});
      } else {
        this.enterIdleState({ duration: this.collisionIdleDuration });
      }
      return;
    }

    if (this.behaviorState === WALK_STATE) {
      this.retryRunnerAnimation();
    }
  }

  updateWalkState(delta) {
    this.blendHeadingAngle(delta);
    this.visualYawOffset = 0;
    this.applyVisualYaw();

    this.currentMoveSpeed = this.approachSpeed(
      this.currentMoveSpeed,
      Math.max(0, this.walkSpeed),
      this.walkAcceleration,
      delta,
    );
    const step = Math.max(0, delta) * Math.max(0, this.currentMoveSpeed);
    this.updateRunnerAnimationSpeed();
    if (step <= 0) {
      return;
    }
    this._scratchPreviousPosition.copy(this.root.position);
    this.root.position.addScaledVector(this.heading, step);
    this.markBoundsDirty();

    const samples = this.gatherCollisionSamples();
    const blocked = Array.isArray(samples)
      ? samples.some((sample) => sample?.isSolid && (sample.label === 'forward' || sample.label === 'center'))
      : false;
    if (blocked) {
      this.root.position.copy(this._scratchPreviousPosition);
      this.markBoundsDirty();
      this.rememberBlockedHeading(this.headingAngle);
      const nextHeading = this.chooseNextHeadingAngle();
      this.currentMoveSpeed = 0;
      this.enterTurnState({ headingAngle: nextHeading });
    }
  }

  updateIdleState(delta, elapsedTime) {
    this.currentMoveSpeed = this.approachSpeed(
      this.currentMoveSpeed,
      0,
      this.walkDeceleration,
      delta,
    );
    this.updateRunnerAnimationSpeed();
    const headingAngle = this.blendHeadingAngle(delta);
    const baseYaw = Number.isFinite(this.idleBaseYaw) ? this.idleBaseYaw : headingAngle;
    const yawOffset = Math.sin(elapsedTime * this.idleYawSpeed + this.idleYawPhase) * this.idleYawAmount;
    const targetVisualYaw = this.normalizeAngle(baseYaw + yawOffset);
    this.visualYawOffset = this.angleDifference(targetVisualYaw, headingAngle);
    this.applyVisualYaw();
  }

  updateTurnState(delta) {
    this.currentMoveSpeed = this.approachSpeed(
      this.currentMoveSpeed,
      0,
      this.walkDeceleration,
      delta,
    );
    this.updateRunnerAnimationSpeed();
    const headingAngle = this.blendHeadingAngle(delta);
    this.visualYawOffset = 0;
    this.applyVisualYaw();

    const aligned =
      Math.abs(this.angleDifference(headingAngle, this.targetHeadingAngle ?? headingAngle)) <=
      this.turnAlignmentThreshold;
    if (!aligned) {
      return;
    }

    const clearance = this.estimateHeadingClearance(this.targetHeadingAngle ?? headingAngle);
    if (clearance >= this.turnResumeClearance) {
      this.enterWalkState({ headingAngle: this.targetHeadingAngle ?? headingAngle });
    }
  }

  buildVariantClipMapFromInstance(instance) {
    this.variantAliasMap = new Map();
    const variantMap = new Map();
    if (!instance) {
      return variantMap;
    }

    const baseAnimations = this.preprocessInstanceAnimations(instance, ['runner']);

    if (baseAnimations.length === 0) {
      return variantMap;
    }

    const nameOf = (clip) => (typeof clip?.name === 'string' ? clip.name.toLowerCase() : '');

    const idleCandidates = baseAnimations.filter((clip) => {
      const name = nameOf(clip);
      return name.includes('idle') || name.includes('hover') || name.includes('float');
    });

    const idleClip =
      this.selectClipByName(idleCandidates, [
        'idle',
        'hover',
        'ghost_guy_runner_idle',
        'ghost_guy_idle',
        'hover_idle',
        'idle_hover',
        'float',
      ]) ?? this.selectClipByName(baseAnimations, ['idle', 'hover', 'float']);

    const runnerCandidates = baseAnimations.filter((clip) => {
      const name = nameOf(clip);
      if (!name) {
        return false;
      }
      if (name.includes('idle') || name.includes('hover') || name.includes('float')) {
        return false;
      }
      return name.includes('runner') || name.includes('run') || name.includes('move');
    });

    const renamedRunnerClip = baseAnimations.find((clip) => nameOf(clip) === 'runner');

    const runnerClip =
      renamedRunnerClip ??
      this.selectClipByName(runnerCandidates, [
        'runner',
        'run',
        'ghost_guy_runner',
        'ghost_guy_run',
        'move',
        'loop',
      ]) ??
      this.selectClipByName(
        baseAnimations.filter((clip) => {
          const name = nameOf(clip);
          return name && !name.includes('idle') && !name.includes('hover');
        }),
        ['runner', 'run', 'move'],
      );

    const {
      idleClip: resolvedIdle,
      runnerClip: resolvedRunner,
      idleFromRunner,
      idleFromFallback,
      runnerFromIdle,
      runnerFromFallback,
    } = this.ensureIdleAndRunnerVariants(variantMap, { idleClip, runnerClip }, baseAnimations);

    if (idleFromRunner) {
      console.warn(
        'CrownedGhostRunnerEntity: Missing dedicated idle clip in runner asset; aliasing to runner.',
      );
    } else if (idleFromFallback) {
      console.warn(
        'CrownedGhostRunnerEntity: Missing idle clip in runner asset; falling back to first available clip.',
      );
    }

    if (runnerFromIdle) {
      console.warn(
        'CrownedGhostRunnerEntity: Missing dedicated runner clip in runner asset; aliasing to idle.',
      );
    } else if (runnerFromFallback && !idleFromRunner && !runnerFromIdle) {
      console.warn(
        'CrownedGhostRunnerEntity: Missing runner clip in runner asset; falling back to first available clip.',
      );
    }

    if (!resolvedIdle && !resolvedRunner) {
      console.warn('CrownedGhostRunnerEntity: Runner asset does not provide usable animation clips.');
    }

    return variantMap;
  }

  updateAnimationVariantsFromAsset() {
    super.updateAnimationVariantsFromAsset();
    this.retryRunnerAnimation();
  }

  retryRunnerAnimation() {
    if (!this.pendingRunnerAnimation || this.behaviorState !== WALK_STATE) {
      return;
    }

    if (this.animationController?.activeVariantId === 'runner') {
      this.pendingRunnerAnimation = false;
      return;
    }

    if (!this.areAnimationVariantsLoaded()) {
      return;
    }

    const hasRunnerClip = this.variantClipMap instanceof Map && this.variantClipMap.has('runner');
    if (!hasRunnerClip) {
      console.assert(
        false,
        'CrownedGhostRunnerEntity: Runner animation clips are missing from the loaded variant set.',
      );
      this.pendingRunnerAnimation = false;
      this.playAnimationVariant('idle', { loopMode: this.THREE.LoopRepeat });
      return;
    }

    const action = this.playAnimationVariant('runner', {
      loopMode: this.THREE.LoopRepeat,
      fallbackToDefault: false,
    });
    if (action) {
      this.pendingRunnerAnimation = false;
      this.updateRunnerAnimationSpeed();
    }
  }

  dispose() {
    this.behaviorState = IDLE_STATE;
    this.pendingRunnerAnimation = false;
    super.dispose();
  }

  approachSpeed(current, target, rate, delta) {
    if (!Number.isFinite(delta) || delta <= 0) {
      return Math.max(0, current || 0);
    }
    if (!Number.isFinite(current)) {
      current = 0;
    }
    if (!Number.isFinite(target)) {
      target = 0;
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      return Math.max(0, target);
    }
    const difference = target - current;
    if (Math.abs(difference) < 1e-4) {
      return Math.max(0, target);
    }
    const step = rate * delta;
    if (difference > 0) {
      return Math.min(target, current + step);
    }
    return Math.max(target, current - step);
  }

  decayBlockedHeadings(delta) {
    if (!Array.isArray(this.recentBlockedHeadings) || this.recentBlockedHeadings.length === 0) {
      return;
    }
    if (!Number.isFinite(delta) || delta <= 0) {
      return;
    }
    const next = [];
    for (const entry of this.recentBlockedHeadings) {
      if (!entry) {
        continue;
      }
      const ttl = Number.isFinite(entry.ttl) ? entry.ttl - delta : 0;
      if (ttl > 0) {
        next.push({ angle: entry.angle, ttl });
      }
    }
    this.recentBlockedHeadings = next;
  }

  rememberBlockedHeading(angle) {
    if (!Number.isFinite(angle)) {
      return;
    }
    const normalized = this.normalizeAngle(angle);
    const ttl = this.blockedHeadingMemoryDuration;
    if (!Number.isFinite(ttl) || ttl <= 0) {
      return;
    }
    const existing = Array.isArray(this.recentBlockedHeadings)
      ? this.recentBlockedHeadings.filter((entry) => entry)
      : [];
    existing.push({ angle: normalized, ttl });
    while (existing.length > 8) {
      existing.shift();
    }
    this.recentBlockedHeadings = existing;
  }

  evaluateHeadingCandidate(angle) {
    const normalized = this.normalizeAngle(angle);
    let score = 0;
    const target = Number.isFinite(this.targetHeadingAngle) ? this.targetHeadingAngle : normalized;
    const toTarget = Math.abs(this.angleDifference(normalized, target));
    const toCurrent = Math.abs(this.angleDifference(normalized, this.headingAngle ?? target));
    const toPrevious = Math.abs(
      this.angleDifference(normalized, this.previousHeadingAngle ?? this.headingAngle ?? target),
    );
    score -= toTarget * 0.15;
    score -= toCurrent * 0.05;
    score -= toPrevious * 0.3;
    if (toPrevious < 0.05) {
      score -= 0.25;
    }

    if (Array.isArray(this.recentBlockedHeadings)) {
      for (const entry of this.recentBlockedHeadings) {
        if (!entry) {
          continue;
        }
        const diff = Math.abs(this.angleDifference(normalized, entry.angle));
        if (diff > this.blockedHeadingAvoidanceAngle) {
          continue;
        }
        const weight = this.THREE.MathUtils.clamp(
          Number.isFinite(entry.ttl) && this.blockedHeadingMemoryDuration > 0
            ? entry.ttl / this.blockedHeadingMemoryDuration
            : 0,
          0,
          1,
        );
        const penalty = (1 - diff / this.blockedHeadingAvoidanceAngle) * weight;
        score -= penalty * 2.5;
      }
    }

    const clearance = this.estimateHeadingClearance(normalized);
    score += clearance * 2.4;

    score += (this.random() - 0.5) * 0.1;

    return score;
  }

  estimateHeadingClearance(angle) {
    if (!this.chunkManager?.solidBlocks) {
      return 1;
    }
    const direction = this._scratchHeadingDirection
      .set(Math.sin(angle), 0, Math.cos(angle))
      .normalize();
    const base = this.root.position;
    const distances = Array.isArray(this.headingProbeDistances)
      ? this.headingProbeDistances
      : [];
    const heights = Array.isArray(this.headingProbeHeights) ? this.headingProbeHeights : [];
    if (distances.length === 0 || heights.length === 0) {
      return 1;
    }

    let clear = 0;
    let total = 0;
    for (const dist of distances) {
      if (!Number.isFinite(dist) || dist <= 0) {
        continue;
      }
      for (const heightOffset of heights) {
        if (!Number.isFinite(heightOffset)) {
          continue;
        }
        this._scratchHeadingSample.copy(base);
        this._scratchHeadingSample.addScaledVector(direction, dist);
        this._scratchHeadingSample.y += heightOffset;
        total += 1;
        if (!this.isSolidAtWorld(this._scratchHeadingSample)) {
          clear += 1;
        }
      }
    }
    if (total === 0) {
      return 1;
    }
    return clear / total;
  }

  isHeadingMostlyClear(angle) {
    const clearance = this.estimateHeadingClearance(angle);
    return clearance >= this.headingClearanceThreshold;
  }

  updateRunnerAnimationSpeed() {
    if (!this.animationController) {
      return;
    }
    if (this.animationController.activeVariantId === 'runner') {
      const normalized = this.walkSpeed > 0 ? this.currentMoveSpeed / this.walkSpeed : 0;
      const scaled = Number.isFinite(normalized) ? normalized * this.runnerAnimationSpeedScale : 0;
      const clamped = this.THREE.MathUtils.clamp(
        scaled,
        this.runnerAnimationSpeedFloor,
        this.runnerAnimationSpeedCeil,
      );
      this.animationController.setSpeed(Math.max(this.runnerAnimationSpeedFloor, clamped));
      return;
    }
    if (Math.abs((this.animationController.speed ?? 1) - 1) > 1e-3) {
      this.animationController.setSpeed(1);
    }
  }
}


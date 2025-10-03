import { CrownedGhostEntity } from './crowned-ghost.js';
import { MobAICore } from './ai/mob-ai-core.js';
import { AIPresentationAdapter } from './ai/presentation/presentation-adapter.js';

const RUNNER_MODEL_CONFIG = {
  baseUrl: new URL(
    '../models/entity_ghost_guy_1/entity_ghost_guy_1_runner.glb',
    import.meta.url,
  ).href,
  animationMap: {
    runner: {
      Ghost_Guy_Runner_Idle: 'idle',
      Ghost_Guy_Runner: 'runner',
      NlaTrack: 'runner',
    },
  },
};

const WALK_STATE = 'walk';
const IDLE_STATE = 'idle';
const TURN_STATE = 'turn';
const PRESENTATION_BEHAVIOR_ID = 'crowned-ghost-runner';

const BASE_PRESENTATION_CONFIG = {
  states: {
    idle: { animation: { variant: 'idle', fadeDuration: 0.35 } },
    walk: { animation: { variant: 'runner', fadeDuration: 0.2 } },
    turn: { animation: { variant: 'idle', fadeDuration: 0.2 } },
  },
};

export class CrownedGhostRunnerEntity extends CrownedGhostEntity {
  constructor(params = {}) {
    const modelConfig = params?.modelConfig ?? RUNNER_MODEL_CONFIG;
    super({ ...params, modelConfig });

    const behavior = params.behavior ?? params.options?.behavior ?? {};
    const randomFn = typeof params.random === 'function' ? params.random : Math.random;

    this.aiCore = new MobAICore({
      random: randomFn,
      chunkManager: this.chunkManager ?? null,
      audioManager: params.audioManager ?? params.options?.audioManager ?? null,
    });

    const personaOverrides = {};
    if (behavior && typeof behavior === 'object' && Object.keys(behavior).length > 0) {
      personaOverrides.metadata = {
        ...(personaOverrides.metadata ?? {}),
        movement: { ...behavior },
      };
    }

    this.persona = this.aiCore.usePersona('spectral-runner', personaOverrides);
    this.random = this.aiCore.dependencies.random;

    const movementDefaults = this.persona?.metadata?.movement ?? {};
    const movement = { ...movementDefaults, ...behavior };

    this.walkDurationRange =
      Array.isArray(movement.walkDurationRange) && movement.walkDurationRange.length >= 1
        ? movement.walkDurationRange
        : movementDefaults.walkDurationRange ?? [3.5, 6];
    this.idleDurationRange =
      Array.isArray(movement.idleDurationRange) && movement.idleDurationRange.length >= 1
        ? movement.idleDurationRange
        : movementDefaults.idleDurationRange ?? [2, 4];

    this.walkSpeed = Number.isFinite(movement.walkSpeed) ? movement.walkSpeed : 0.9;
    this.walkAcceleration = Number.isFinite(movement.walkAcceleration)
      ? Math.max(0.1, movement.walkAcceleration)
      : 2.4;
    this.walkDeceleration = Number.isFinite(movement.walkDeceleration)
      ? Math.max(0.1, movement.walkDeceleration)
      : 3.2;
    this.idleYawAmount = Number.isFinite(movement.idleYawAmount) ? movement.idleYawAmount : 0.35;
    this.idleYawSpeed = Number.isFinite(movement.idleYawSpeed) ? movement.idleYawSpeed : 0.7;
    this.walkHeadingJitter = Number.isFinite(movement.walkHeadingJitter)
      ? movement.walkHeadingJitter
      : Math.PI / 2;
    this.collisionIdleDuration = Number.isFinite(movement.collisionIdleDuration)
      ? Math.max(0.15, movement.collisionIdleDuration)
      : Math.max(0.6, this.idleDurationRange[0] ?? 0.6);
    this.turnInPlaceDuration = Number.isFinite(movement.turnInPlaceDuration)
      ? Math.max(0.1, movement.turnInPlaceDuration)
      : 1.25;
    this.turnAlignmentThreshold = Number.isFinite(movement.turnAlignmentThreshold)
      ? Math.max(0.01, movement.turnAlignmentThreshold)
      : 0.12;
    this.turnResumeClearance = Number.isFinite(movement.turnResumeClearance)
      ? this.THREE.MathUtils.clamp(movement.turnResumeClearance, 0.1, 1)
      : 0.65;
    this.blockedHeadingMemoryDuration = Number.isFinite(movement.blockedHeadingMemoryDuration)
      ? Math.max(0.1, movement.blockedHeadingMemoryDuration)
      : 4;
    this.blockedHeadingAvoidanceAngle = Number.isFinite(movement.blockedHeadingAvoidanceAngle)
      ? Math.max(0.01, movement.blockedHeadingAvoidanceAngle)
      : Math.PI / 2.5;
    this.headingClearanceThreshold = Number.isFinite(movement.headingClearanceThreshold)
      ? this.THREE.MathUtils.clamp(movement.headingClearanceThreshold, 0, 1)
      : 0.55;
    this.runnerAnimationSpeedScale = Number.isFinite(movement.runnerAnimationSpeedScale)
      ? Math.max(0.01, movement.runnerAnimationSpeedScale)
      : 1;
    this.runnerAnimationSpeedFloor = Number.isFinite(movement.runnerAnimationSpeedFloor)
      ? Math.max(0.01, movement.runnerAnimationSpeedFloor)
      : 0.35;
    this.runnerAnimationSpeedCeil = Number.isFinite(movement.runnerAnimationSpeedCeil)
      ? Math.max(this.runnerAnimationSpeedFloor, movement.runnerAnimationSpeedCeil)
      : 1.2;

    this.heading = new this.THREE.Vector3(0, 0, 1);
    this.headingAngle = 0;
    this.targetHeadingAngle = 0;
    this.previousHeadingAngle = 0;
    this.headingTurnSpeed = Number.isFinite(movement.headingTurnSpeed)
      ? movement.headingTurnSpeed
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

    this.behaviorTimer = {
      state: IDLE_STATE,
      start: 0,
      duration: this.chooseIdleDuration(),
    };
    this.currentMovementState = IDLE_STATE;
    this.pendingIdleAfterTurn = false;
    this.presentationAdapter = null;
    this.presentationController = {
      playVariant: (variant, options) => this._playPresentationVariant(variant, options),
      stop: (options) => this.animationController?.stop?.(options),
    };

    this.behaviorLoop = this.aiCore.useBehaviorLoop('idle', {
      random: this.random,
      wanderChance: 0,
      idleChance: 0,
      canSeeTarget: () => false,
      lostTarget: () => true,
      shouldWander: (context) => this.shouldEnterWalk(context),
      shouldIdle: (context) => this.shouldEnterIdle(context),
      onStateChange: ({ state, previousState, context }) =>
        this.onBehaviorLoopStateChange(state, previousState, context),
      onEnterIdle: (context) => this.onBehaviorLoopEnterIdle(context),
      onUpdateIdle: (delta, context) => this.onBehaviorLoopUpdateIdle(delta, context),
      onEnterWander: (context) => this.onBehaviorLoopEnterWander(context),
      onUpdateWander: (delta, context) => this.onBehaviorLoopUpdateWander(delta, context),
      onEnterChase: (context) => this.onBehaviorLoopEnterWander(context),
      onUpdateChase: (delta, context) => this.onBehaviorLoopUpdateWander(delta, context),
    });
  }

  onSpawn(spawnContext, options = {}) {
    super.onSpawn(spawnContext, options);
    this.aiCore.dependencies.chunkManager = this.chunkManager ?? null;
    const initialContext = {
      entity: this,
      world: this.getWorldContext(),
      sensors: this.getSensorContext(),
      elapsedTime: Number.isFinite(options?.elapsedTime) ? options.elapsedTime : 0,
    };
    this.aiCore.initialize(initialContext);
    this.aiCore.attachToEntity(this);
    this.ensurePresentationAdapter();
  }

  getWorldContext() {
    return {
      chunkManager: this.chunkManager ?? null,
      terrainHeight: this.terrainHeight ?? null,
      scene: this.scene ?? null,
    };
  }

  getSensorContext() {
    return {
      chunkManager: this.chunkManager ?? null,
      terrainHeight: this.terrainHeight ?? null,
    };
  }

  ensurePresentationAdapter() {
    if (this.presentationAdapter) {
      this.presentationAdapter.animationController = this.presentationController;
      this.presentationAdapter.updateBaseConfig(BASE_PRESENTATION_CONFIG);
      this.presentationAdapter.setPersonaConfig(this.persona?.metadata?.presentation ?? {});
      if (this.currentMovementState) {
        this.emitMovementState(this.currentMovementState, this.getCurrentMovementIntent());
      }
      return this.presentationAdapter;
    }

    this.presentationAdapter = new AIPresentationAdapter({
      ai: this.aiCore,
      animationController: this.presentationController,
      config: BASE_PRESENTATION_CONFIG,
      personaConfig: this.persona?.metadata?.presentation ?? {},
    });
    if (this.currentMovementState) {
      this.emitMovementState(this.currentMovementState, this.getCurrentMovementIntent());
    }
    return this.presentationAdapter;
  }

  _playPresentationVariant(variant, options = {}) {
    const action = this.playAnimationVariant(variant, options);
    if (variant === 'runner') {
      this.pendingRunnerAnimation = !action;
      this.updateRunnerAnimationSpeed();
    } else if (variant === 'idle') {
      this.pendingRunnerAnimation = false;
      this.updateRunnerAnimationSpeed();
    }
    return action;
  }

  emitMovementState(nextState, intent = {}) {
    const previousState = this.currentMovementState;
    if (previousState && previousState !== nextState) {
      this.aiCore.emit('behavior:stateExit', {
        behavior: PRESENTATION_BEHAVIOR_ID,
        state: previousState,
      });
    }
    if (nextState) {
      const payload = Object.keys(intent).length > 0 ? intent : this.getCurrentMovementIntent();
      this.aiCore.emit('behavior:stateEnter', {
        behavior: PRESENTATION_BEHAVIOR_ID,
        state: nextState,
        intent: payload,
      });
    }
    this.currentMovementState = nextState;
  }

  getCurrentMovementIntent() {
    if (this.currentMovementState === WALK_STATE) {
      return { movement: { vector: this.heading.clone() } };
    }
    if (this.currentMovementState === TURN_STATE) {
      return { movement: { vector: this.heading.clone(), visualYawOffset: this.visualYawOffset } };
    }
    return { visualYawOffset: this.visualYawOffset };
  }

  onBehaviorLoopStateChange(state, previousState, context) {
    void state;
    void previousState;
    void context;
  }

  onBehaviorLoopEnterIdle(context) {
    this.enterIdleState({ context });
  }

  onBehaviorLoopUpdateIdle(delta, context) {
    const elapsed = Number.isFinite(context?.elapsedTime) ? context.elapsedTime : context?.time ?? 0;
    this.updateIdleState(delta, elapsed, context);
  }

  onBehaviorLoopEnterWander(context) {
    this.enterWalkState({ context });
  }

  onBehaviorLoopUpdateWander(delta, context) {
    if (this.currentMovementState === TURN_STATE) {
      this.updateTurnState(delta, context);
      return;
    }
    this.updateWalkState(delta, context);
  }

  enterIdleState({ duration, context } = {}) {
    const resolvedDuration = Number.isFinite(duration)
      ? Math.max(0.1, duration)
      : this.chooseIdleDuration();
    const startTime = Number.isFinite(context?.time) ? context.time : this.behaviorTimer.start ?? 0;
    this.behaviorTimer = {
      state: IDLE_STATE,
      start: startTime,
      duration: resolvedDuration,
    };
    this.pendingIdleAfterTurn = false;
    this.targetHeadingAngle = this.headingAngle;
    this.idleBaseYaw = this.normalizeAngle(this.headingAngle || this.targetHeadingAngle || 0);
    this.idleYawPhase = this.random() * Math.PI * 2;
    this.visualYawOffset = 0;
    this.applyVisualYaw();
    this.pendingRunnerAnimation = false;
    this.emitMovementState(IDLE_STATE, {
      visualYawOffset: this.visualYawOffset,
    });
    this.updateRunnerAnimationSpeed();
  }

  enterWalkState({ duration, headingAngle, context } = {}) {
    const resolvedDuration = Number.isFinite(duration)
      ? Math.max(0.1, duration)
      : this.chooseWalkDuration();
    const startTime = Number.isFinite(context?.time) ? context.time : this.behaviorTimer.start ?? 0;
    this.behaviorTimer = {
      state: WALK_STATE,
      start: startTime,
      duration: resolvedDuration,
    };
    this.pendingIdleAfterTurn = false;

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
    this.emitMovementState(WALK_STATE, {
      movement: { vector: this.heading.clone() },
    });
    const runnerAction = this._playPresentationVariant('runner', {
      loopMode: this.THREE.LoopRepeat,
      fallbackToDefault: false,
    });
    if (!runnerAction) {
      const variantsLoaded = this.areAnimationVariantsLoaded();
      const runnerClipAvailable =
        this.variantClipMap instanceof Map && this.variantClipMap.has('runner');

      if (variantsLoaded && !runnerClipAvailable) {
        console.assert(
          false,
          'CrownedGhostRunnerEntity: Missing "runner" animation variant after assets finished loading.',
        );
        this.pendingRunnerAnimation = false;
        this._playPresentationVariant('idle', { loopMode: this.THREE.LoopRepeat });
      } else {
        this.pendingRunnerAnimation = true;
      }
    }
    this.updateRunnerAnimationSpeed();
  }

  enterTurnState({ headingAngle, duration, context } = {}) {
    const resolvedDuration = Number.isFinite(duration)
      ? Math.max(0.1, duration)
      : this.turnInPlaceDuration;
    const startTime = Number.isFinite(context?.time) ? context.time : this.behaviorTimer.start ?? 0;
    this.behaviorTimer = {
      state: TURN_STATE,
      start: startTime,
      duration: resolvedDuration,
    };
    this.pendingIdleAfterTurn = false;
    if (typeof headingAngle === 'number') {
      this.setHeadingAngle(headingAngle);
    }
    this.visualYawOffset = 0;
    this.applyVisualYaw();
    this.pendingRunnerAnimation = false;
    this.emitMovementState(TURN_STATE, {
      movement: { vector: this.heading.clone(), visualYawOffset: this.visualYawOffset },
    });
    this._playPresentationVariant('idle', { loopMode: this.THREE.LoopRepeat });
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

    this.aiCore.update(delta, {
      entity: this,
      world: this.getWorldContext(),
      sensors: this.getSensorContext(),
      elapsedTime,
    });

    if (this.currentMovementState === WALK_STATE && this.pendingRunnerAnimation) {
      this.retryRunnerAnimation();
    }
  }

  updateWalkState(delta, context) {
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
      this.enterTurnState({ headingAngle: nextHeading, context });
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

  updateTurnState(delta, context) {
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
      this.enterWalkState({ headingAngle: this.targetHeadingAngle ?? headingAngle, context });
      return;
    }

    const time = Number.isFinite(context?.time) ? context.time : 0;
    const startTime = this.behaviorTimer.start ?? time;
    const duration = this.behaviorTimer.duration ?? this.turnInPlaceDuration;
    const elapsed = time - startTime;
    if (elapsed >= duration) {
      this.pendingIdleAfterTurn = true;
      this.behaviorTimer = {
        state: TURN_STATE,
        start: time,
        duration: this.collisionIdleDuration,
      };
    }
  }

  shouldEnterWalk(context) {
    if (!context || this.currentMovementState !== IDLE_STATE) {
      return false;
    }
    const time = Number.isFinite(context.time) ? context.time : 0;
    const startTime = this.behaviorTimer.start ?? time;
    const duration = this.behaviorTimer.duration ?? 0;
    return time - startTime >= duration;
  }

  shouldEnterIdle(context) {
    if (!context) {
      return false;
    }
    const time = Number.isFinite(context.time) ? context.time : 0;
    if (this.currentMovementState === WALK_STATE) {
      const startTime = this.behaviorTimer.start ?? time;
      const duration = this.behaviorTimer.duration ?? 0;
      return time - startTime >= duration;
    }
    if (this.currentMovementState === TURN_STATE) {
      return this.pendingIdleAfterTurn;
    }
    return false;
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
    if (!this.pendingRunnerAnimation || this.currentMovementState !== WALK_STATE) {
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
      this._playPresentationVariant('idle', { loopMode: this.THREE.LoopRepeat });
      return;
    }

    const action = this._playPresentationVariant('runner', {
      loopMode: this.THREE.LoopRepeat,
      fallbackToDefault: false,
    });
    if (action) {
      this.pendingRunnerAnimation = false;
      this.updateRunnerAnimationSpeed();
    }
  }

  dispose() {
    this.pendingRunnerAnimation = false;
    this.presentationAdapter?.dispose?.();
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

    const activeVariant = this.animationController.activeVariantId;
    const runnerAlias =
      this.variantAliasMap instanceof Map ? this.variantAliasMap.get('runner') ?? null : null;

    const shouldTreatAliasAsRunner =
      typeof runnerAlias === 'string' &&
      runnerAlias.length > 0 &&
      activeVariant === runnerAlias &&
      (this.currentMovementState === WALK_STATE || this.pendingRunnerAnimation);

    if (activeVariant === 'runner' || shouldTreatAliasAsRunner) {
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


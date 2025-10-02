const noop = () => {};

export class BehaviorNode {
  constructor(name = 'behavior-node') {
    this.name = name;
  }

  initialize(context) {
    void context;
  }

  attachToEntity(entity, context) {
    void entity;
    void context;
  }

  update(delta, context) {
    void delta;
    void context;
  }
}

export class ActionNode extends BehaviorNode {
  constructor(name, { onInitialize = noop, onAttach = noop, onUpdate = noop } = {}) {
    super(name);
    this._onInitialize = onInitialize;
    this._onAttach = onAttach;
    this._onUpdate = onUpdate;
  }

  initialize(context) {
    this._onInitialize(context);
  }

  attachToEntity(entity, context) {
    this._onAttach(entity, context);
  }

  update(delta, context) {
    return this._onUpdate(delta, context);
  }
}

export class BehaviorLoop extends BehaviorNode {
  constructor(name, definition, options = {}) {
    super(name);
    this.definition = definition;
    this.currentState = options.initialState ?? definition.initialState;
    this._onStateChange = options.onStateChange ?? noop;
  }

  initialize(context) {
    this.context = context;
    if (!this.currentState) {
      throw new Error(`Behavior loop "${this.name}" has no initial state.`);
    }
    this._enterState(this.currentState, context, true);
  }

  attachToEntity(entity, context) {
    if (this.definition.onAttach) {
      this.definition.onAttach(entity, context, this);
    }
  }

  update(delta, context) {
    const stateDefinition = this._getStateDefinition(this.currentState);
    if (!stateDefinition) {
      throw new Error(`Behavior loop "${this.name}" is missing definition for state "${this.currentState}".`);
    }

    if (stateDefinition.onUpdate) {
      stateDefinition.onUpdate(delta, context, this);
    }

    const transitions = stateDefinition.transitions ?? [];
    for (const transition of transitions) {
      if (transition.condition?.(context, this)) {
        this._enterState(transition.target, context);
        break;
      }
    }
  }

  _getStateDefinition(state) {
    return this.definition.states?.[state];
  }

  _enterState(nextState, context, initializing = false) {
    const stateDefinition = this._getStateDefinition(nextState);
    if (!stateDefinition) {
      throw new Error(`Behavior loop "${this.name}" cannot transition to undefined state "${nextState}".`);
    }

    const previousState = this.currentState;
    if (!initializing && previousState && previousState !== nextState) {
      const previousDefinition = this._getStateDefinition(previousState);
      previousDefinition?.onExit?.(context, this);
    }

    this.currentState = nextState;
    context.behaviorState ??= {};
    context.behaviorState[this.name] = nextState;
    this._onStateChange({
      state: nextState,
      previousState,
      context,
      loop: this,
    });

    const stateSpecificEnter = stateDefinition.onEnter ?? noop;
    stateSpecificEnter(context, this);
  }
}

export class BehaviorRegistry {
  constructor() {
    this._loops = new Map();
    this._installDefaultLoops();
  }

  registerLoop(name, factory) {
    if (this._loops.has(name)) {
      throw new Error(`Behavior loop "${name}" is already registered.`);
    }
    this._loops.set(name, factory);
  }

  createLoop(name, options = {}, dependencies = {}) {
    const factory = this._loops.get(name);
    if (!factory) {
      throw new Error(`Behavior loop "${name}" is not registered.`);
    }
    return factory(options, dependencies);
  }

  _installDefaultLoops() {
    const createLoop = (initialState) => (options = {}, dependencies = {}) => {
      const {
        wanderChance = 0.05,
        idleChance = 0.15,
        onEnterIdle = noop,
        onEnterWander = noop,
        onEnterChase = noop,
        onUpdateIdle = noop,
        onUpdateWander = noop,
        onUpdateChase = noop,
        onExitChase = noop,
        shouldWander,
        shouldIdle,
        canSeeTarget,
        lostTarget,
        onStateChange,
      } = options;

      const rng = options.random ?? dependencies.random ?? Math.random;

      const resolve = (value, fallback) => {
        if (typeof value === 'function') {
          return value;
        }
        return fallback;
      };

      const pickWander = resolve(
        shouldWander,
        (context) => (context.flags?.wander ?? false) || rng() < wanderChance,
      );
      const pickIdle = resolve(
        shouldIdle,
        (context) => (context.flags?.idle ?? false) || rng() < idleChance,
      );
      const seeTarget = resolve(
        canSeeTarget,
        (context) => Boolean(context.percepts?.targetVisible),
      );
      const targetLost = resolve(
        lostTarget,
        (context) => !context.percepts?.targetVisible,
      );

      return new BehaviorLoop(`mob-${initialState}`, {
        initialState,
        states: {
          idle: {
            onEnter: onEnterIdle,
            onUpdate: (delta, context, loop) => {
              context.ticks ??= {};
              context.ticks.idle = (context.ticks.idle ?? 0) + 1;
              onUpdateIdle(delta, context, loop);
            },
            transitions: [
              {
                target: 'chase',
                condition: (context) => seeTarget(context),
              },
              {
                target: 'wander',
                condition: (context) => pickWander(context),
              },
            ],
          },
          wander: {
            onEnter: onEnterWander,
            onUpdate: (delta, context, loop) => {
              context.ticks ??= {};
              context.ticks.wander = (context.ticks.wander ?? 0) + 1;
              onUpdateWander(delta, context, loop);
            },
            transitions: [
              {
                target: 'chase',
                condition: (context) => seeTarget(context),
              },
              {
                target: 'idle',
                condition: (context) => pickIdle(context),
              },
            ],
          },
          chase: {
            onEnter: onEnterChase,
            onUpdate: (delta, context, loop) => {
              context.ticks ??= {};
              context.ticks.chase = (context.ticks.chase ?? 0) + 1;
              onUpdateChase(delta, context, loop);
            },
            onExit: onExitChase,
            transitions: [
              {
                target: 'idle',
                condition: (context) => targetLost(context),
              },
            ],
          },
        },
      }, {
        initialState,
        onStateChange,
      });
    };

    this.registerLoop('idle', createLoop('idle'));
    this.registerLoop('wander', createLoop('wander'));
    this.registerLoop('chase', createLoop('chase'));
  }
}

export function createBehaviorRegistry() {
  return new BehaviorRegistry();
}

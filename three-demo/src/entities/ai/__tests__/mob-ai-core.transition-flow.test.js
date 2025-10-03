import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MobAICore } from '../mob-ai-core.js';
import { BehaviorRegistry } from '../behavior-nodes.js';
import { spectralRunnerPersona } from '../personas/spectral-runner.js';
import { SensorSuite } from '../sensors/sensor-suite.js';
import { MobSensor } from '../sensors/mob-sensor.js';
import { TacticalPointEngine } from '../combat/tactical-point-engine.js';

class QueueSensor extends MobSensor {
  constructor({ id, type = id, interval = 0, queue = [] } = {}) {
    super({ id, type, interval });
    this._queue = Array.isArray(queue) ? [...queue] : [queue];
  }

  enqueue(stimulus) {
    this._queue.push(stimulus);
  }

  sampleWorld() {
    if (this._queue.length === 0) {
      return null;
    }
    return this._queue.shift();
  }
}

describe('MobAICore transition flow', () => {
  let core;

  beforeEach(() => {
    core = new MobAICore({
      random: () => 0,
      behaviorRegistry: new BehaviorRegistry(),
    });
    core.registerPersona(spectralRunnerPersona);
    core.usePersona('spectral-runner');
  });

  it('applies the spectral runner persona and records loop transitions', () => {
    const transitions = [];
    core.useBehaviorLoop('idle', {
      priority: 5,
      onStateChange: ({ state, previousState, loop }) => {
        if (previousState && previousState !== state) {
          core.emit('behavior:stateExit', {
            behavior: loop.name,
            state: previousState,
            nextState: state,
          });
        }
        core.emit('behavior:stateEnter', {
          behavior: loop.name,
          state,
          previousState,
        });
        transitions.push({ state, previousState });
      },
      shouldWander: (context) => Boolean(context.flags?.wander),
      canSeeTarget: (context) => Boolean(context.percepts?.targetVisible),
      lostTarget: (context) => !context.percepts?.targetVisible,
    });

    const context = core.initialize({
      flags: { wander: false },
      percepts: { targetVisible: false },
      environment: { lightLevel: 0.6 },
    });
    core.attachToEntity({ id: 'entity-transition-test' });

    assert.strictEqual(core.currentPersona.name, 'spectral-runner');
    assert.strictEqual(context.resources.stamina.max, 120);
    assert.strictEqual(context.resources.ectoplasm.current, 60);
    assert.deepStrictEqual(
      transitions.map((entry) => entry.state),
      ['idle'],
    );

    core.update(1, { flags: { wander: true }, percepts: { targetVisible: false } });
    core.update(1, { flags: { wander: true }, percepts: { targetVisible: true } });
    core.update(1, { flags: { wander: false }, percepts: { targetVisible: false } });

    assert.deepStrictEqual(
      transitions.map((entry) => entry.state),
      ['idle', 'wander', 'chase', 'idle'],
    );
    assert.strictEqual(context.behaviorState['mob-idle'], 'idle');
  });

  it('merges persona sensor presets and forwards fused stimuli', () => {
    const context = core.initialize({
      flags: {},
      percepts: {},
    });
    core.attachToEntity({ id: 'entity-sensor-test' });

    assert.ok(Array.isArray(context.sensors.presets));
    assert.ok(context.sensors.presets.includes('spectral-vision'));
    assert.ok(context.sensors.presets.includes('echo-location'));

    const stimuliEvents = [];
    core.events.on('sensor:stimuli', (stimuli, meta) => {
      stimuliEvents.push({ stimuli, meta });
    });

    const vision = new QueueSensor({
      id: 'vision',
      type: 'vision',
      queue: [{ type: 'target', id: 'hero', confidence: 0.9 }],
    });
    const hearing = new QueueSensor({
      id: 'hearing',
      type: 'hearing',
      queue: [{ type: 'sound', id: 'footstep', volume: 0.6 }],
    });

    const suite = new SensorSuite({
      sensors: [vision, hearing],
      aiCore: core,
      entity: { id: 'entity-sensor-test' },
      world: { threats: [] },
    });

    const aggregated = suite.update(0.5, {
      world: { threats: ['hero'] },
      aiCore: core,
    });

    assert.strictEqual(aggregated.length, 2);
    assert.strictEqual(aggregated[0].sensorId, 'vision');
    assert.strictEqual(aggregated[1].sensorId, 'hearing');
    assert.strictEqual(stimuliEvents.length, 1);
    assert.strictEqual(stimuliEvents[0].stimuli.length, 2);
    assert.strictEqual(stimuliEvents[0].meta.entity.id, 'entity-sensor-test');
  });

  it('relays tactical point ability usage through shared events', () => {
    core.initialize();
    core.attachToEntity({ id: 'entity-tactical-test' });

    const abilityEvents = [];
    core.events.on('ability:spent', (payload) => abilityEvents.push(payload));

    const engine = new TacticalPointEngine({
      initialPoints: 10,
      events: core.events,
    });
    engine.registerAbility('howl', { cost: 4 });

    assert.strictEqual(engine.points, 10);
    assert.strictEqual(engine.spendForAbility('howl', { context: { entityId: 'entity-tactical-test' } }), true);
    assert.strictEqual(engine.points, 6);
    assert.strictEqual(abilityEvents.length, 1);
    assert.strictEqual(abilityEvents[0].ability.name, 'howl');
    assert.strictEqual(abilityEvents[0].context.entityId, 'entity-tactical-test');
  });
});

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MobAICore } from '../mob-ai-core.js';
import { ActionNode } from '../behavior-nodes.js';

const createAmbientContext = () => ({
  time: 0,
  flags: { allowWander: false },
  entity: {
    id: 'ghost-alpha',
    faction: 'covenant',
    position: { x: 0, y: 10, z: 0 },
  },
  environment: {
    lightLevel: 0.35,
    pointsOfInterest: [{ x: 12, y: 9, z: -6 }],
    resourceNodes: [],
    nearbyEntities: [],
  },
  percepts: {
    threatLevel: 'low',
    nearbyEntities: [],
  },
  terrainHeight: () => 10,
  memory: new Map(),
});

const createLoggingNode = (name, logs) =>
  new ActionNode(name, {
    onInitialize: () => logs.push(`${name}:initialize`),
    onAttach: () => logs.push(`${name}:attach`),
    onUpdate: () => logs.push(`${name}:update`),
  });

describe('MobAICore', () => {
  let logs;
  let core;

  beforeEach(() => {
    logs = [];
    core = new MobAICore({
      random: () => 0,
    });
  });

  it('updates behavior layers according to priority order', () => {
    const lowPriority = createLoggingNode('low', logs);
    const highPriority = createLoggingNode('high', logs);

    core.addBehaviorLayer({ name: 'low', node: lowPriority, priority: 0 });
    core.addBehaviorLayer({ name: 'high', node: highPriority, priority: 10 });

    core.initialize({ logs });
    core.attachToEntity({ id: 'entity-1' });
    core.update(16);

    assert.deepStrictEqual(logs, [
      'high:initialize',
      'low:initialize',
      'high:attach',
      'low:attach',
      'high:update',
      'low:update',
    ]);
  });

  it('evaluates loop transitions using registry definitions', () => {
    const sequence = [];
    const loop = core.useBehaviorLoop('idle', {
      priority: 5,
      shouldWander: (context) => context.flags?.wander ?? false,
      canSeeTarget: (context) => context.percepts?.targetVisible ?? false,
      lostTarget: (context) => !context.percepts?.targetVisible,
      onEnterIdle: (context) => sequence.push(`enter:${context.behaviorState['mob-idle']}`),
      onEnterWander: (context) => sequence.push(`enter:${context.behaviorState['mob-idle']}`),
      onEnterChase: (context) => sequence.push(`enter:${context.behaviorState['mob-idle']}`),
      onStateChange: ({ state }) => sequence.push(`state:${state}`),
    });

    core.initialize({ flags: { wander: false }, percepts: { targetVisible: false } });
    core.attachToEntity({ id: 'entity-2' });

    core.update(1);
    assert.strictEqual(loop.currentState, 'idle');

    core.update(1, { flags: { wander: true }, percepts: { targetVisible: false } });
    assert.strictEqual(loop.currentState, 'wander');

    core.update(1, { flags: { wander: true }, percepts: { targetVisible: true } });
    assert.strictEqual(loop.currentState, 'chase');

    core.update(1, { flags: { wander: false }, percepts: { targetVisible: false } });
    assert.strictEqual(loop.currentState, 'idle');

    assert.deepStrictEqual(sequence, [
      'state:idle',
      'enter:idle',
      'state:wander',
      'enter:wander',
      'state:chase',
      'enter:chase',
      'state:idle',
      'enter:idle',
    ]);
  });

  it('wraps behavior layer errors with layer metadata', () => {
    const errorNode = new ActionNode('broken', {
      onUpdate: () => {
        throw new Error('boom');
      },
    });

    core.addBehaviorLayer({ name: 'broken', node: errorNode, priority: 0 });
    core.initialize();
    core.attachToEntity({ id: 'entity-3' });

    assert.throws(
      () => {
        core.update(16);
      },
      (error) => {
        assert.match(error.message, /broken/);
        assert.ok(error.cause instanceof Error, 'expected original error to be exposed as cause');
        assert.strictEqual(error.cause.message, 'boom');
        return true;
      },
    );
  });

  it('loads registered personas and merges runtime overrides', () => {
    const persona = core.usePersona('spectral-runner', {
      resources: { stamina: { max: 150 } },
      traits: [{ name: 'nocturnal', options: { lightThreshold: 0.6 } }],
      behaviors: [
        {
          name: 'spectral-chase',
          loop: 'chase',
          priority: 10,
          duration: { min: 2, max: 4 },
        },
        {
          name: 'custom-wander',
          loop: 'wander',
          priority: 2,
          triggers: [{ type: 'flag', name: 'nocturnalActive', state: true }],
        },
      ],
    });

    assert.strictEqual(persona.name, 'spectral-runner');
    assert.strictEqual(persona.resources.stamina.max, 150);
    assert.strictEqual(persona.behaviors.find((behavior) => behavior.name === 'spectral-chase').priority, 10);

    core.initialize({ environment: { lightLevel: 0.3 }, percepts: { allyCount: 0 } });
    core.attachToEntity({ id: 'entity-4' });

    core.update(1, {
      environment: { lightLevel: 0.2 },
      percepts: { allyCount: 3, targetVisible: true },
    });

    assert.ok(core.context.activeTraits.has('nocturnal'));
    assert.ok(core.context.activeTraits.has('packHunter'));
    assert.strictEqual(core.context.resources.stamina.max, 150);
    assert.ok(core.context.flags.nocturnalActive);
    assert.ok(core.context.flags.packReady);

    const layerNames = core.scheduler.layers.map((layer) => layer.name);
    assert.ok(layerNames.includes('spectral-chase'));
    assert.ok(layerNames.includes('custom-wander'));

    const chaseLayer = core.scheduler.layers.find((layer) => layer.name === 'spectral-chase');
    assert.strictEqual(chaseLayer.priority, 10);
  });

  it('installs ambient behavior layer and emits intents from scheduler tasks', () => {
    core.usePersona('spectral-runner');
    const initialContext = createAmbientContext();
    const intentEvents = [];
    core.on('ambient:intent', (intent, meta) =>
      intentEvents.push({ intent, time: meta?.context?.time ?? core.context.time }),
    );

    core.initialize(initialContext);
    core.attachToEntity({ id: 'entity-ambient' });

    const scheduler = core.ambientScheduler;
    const originalRequestTask = scheduler.requestTask.bind(scheduler);
    let requestCount = 0;
    scheduler.requestTask = (...args) => {
      requestCount += 1;
      return originalRequestTask(...args);
    };

    const ambientLayerEntry = core.scheduler.layers.find((layer) => layer.name === 'ambient-behaviors');
    assert.ok(ambientLayerEntry, 'expected ambient behavior layer to be registered');

    const environment = { ...initialContext.environment };
    const percepts = { ...initialContext.percepts };
    const flags = { ...initialContext.flags };

    const steps = [1, 1, 1, 12, 1];
    for (const step of steps) {
      core.update(step, { environment, percepts, flags });
    }

    assert.ok(requestCount >= steps.length, 'expected ambient layer to request scheduler tasks');

    const inspectEvents = intentEvents.filter((event) => event.intent.type === 'inspect-poi');
    const recordedTypes = intentEvents.map((event) => event.intent.type);
    assert.ok(
      inspectEvents.length >= 1,
      `expected at least one inspect intent to fire when POIs exist (saw: ${recordedTypes.join(', ')})`,
    );
    assert.ok(inspectEvents[0].intent.target, 'inspect intent should include a target payload');

    assert.ok(
      inspectEvents.length >= 2,
      'expected a follow-up inspect intent once scheduler cooldown elapsed',
    );
    const inspectTimes = inspectEvents.map((event) => event.time);
    const cooldownDelta = inspectTimes.at(-1) - inspectTimes[0];
    assert.ok(
      cooldownDelta >= 12,
      `expected inspect intents to respect scheduler cooldown, got delta=${cooldownDelta} (times: ${inspectTimes.join(', ')})`,
    );

    scheduler.requestTask = originalRequestTask;
  });

  it('honors persona ambient overrides for behavior selection', () => {
    core.usePersona('spectral-runner', { ambient: { behaviors: { gatherResources: false } } });
    core.initialize({ environment: { pointsOfInterest: [] } });

    const ambientLayerEntry = core.scheduler.layers.find((layer) => layer.name === 'ambient-behaviors');
    assert.ok(ambientLayerEntry, 'ambient layer should be installed');
    const enabled = ambientLayerEntry.node.enabledBehaviors;
    assert.ok(enabled.includes('seekSunlight'));
    assert.ok(!enabled.includes('gatherResources'), 'gatherResources should be disabled via override');
  });
});

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { AmbientTaskScheduler } from '../environment/ambient-task-scheduler.js';
import {
  createSeekSunlightBehavior,
  createGatherResourcesBehavior,
  createIdleChatterBehavior,
} from '../environment/ambient-behaviors.js';

const createStepRng = (values) => {
  let index = 0;
  const pool = values.length > 0 ? values : [0.5];
  return () => {
    const value = pool[index % pool.length];
    index += 1;
    return value;
  };
};

const createContext = () => ({
  time: 0,
  flags: { allowWander: true },
  entity: {
    id: 'ghost-alpha',
    faction: 'covenant',
    position: { x: 0, y: 12, z: 0 },
  },
  environment: {
    lightLevel: 0.3,
    pointsOfInterest: [{ x: 22, y: 11, z: -6 }],
    resourceNodes: [
      { id: 'ecto-1', type: 'ectoplasm', amount: 3, position: { x: 12, y: 10, z: -4 } },
    ],
    nearbyEntities: [
      { id: 'ghost-beta', faction: 'covenant', position: { x: 3, y: 12, z: 4 } },
    ],
  },
  percepts: {
    threatLevel: 'low',
    nearbyEntities: [
      { id: 'ghost-beta', faction: 'covenant', position: { x: 3, y: 12, z: 4 } },
    ],
  },
  terrainHeight: (x, z) => 10 + Math.sin((x + z) * 0.2),
  timeOfDay: { normalized: 0.2 },
  memory: new Map(),
});

describe('AmbientTaskScheduler', () => {
  let scheduler;
  let context;

  beforeEach(() => {
    scheduler = new AmbientTaskScheduler({ random: createStepRng([0.1, 0.6, 0.8]) });
    context = createContext();
  });

  it('prioritizes ambient tasks with cooldown-aware scheduling', () => {
    scheduler.tick(0, context);

    const first = scheduler.requestTask(context);
    assert.ok(first, 'expected an ambient task to be scheduled');
    assert.strictEqual(first.name, 'explore');
    const firstResult = first.execute(context);
    assert.strictEqual(firstResult.style, 'explore');
    first.succeed(firstResult);

    const second = scheduler.requestTask(context);
    assert.ok(second, 'expected a follow-up ambient task');
    assert.strictEqual(second.name, 'socialize');
    const secondResult = second.execute(context);
    assert.strictEqual(secondResult.style, 'chat');
    second.succeed(secondResult);

    const third = scheduler.requestTask(context);
    assert.ok(third, 'expected wander task after socializing');
    assert.strictEqual(third.name, 'wander');
    const thirdResult = third.execute(context);
    assert.strictEqual(thirdResult.style, 'wander');
    third.succeed(thirdResult);

    const state = scheduler.getTaskState('explore');
    assert.ok(state.cooldownUntil > scheduler.time, 'explore should be on cooldown after execution');
  });

  it('recovers from failures and requeues high priority tasks after cooldown', () => {
    scheduler.tick(0, context);

    const exploreHandle = scheduler.requestTask(context, { include: ['explore'] });
    assert.ok(exploreHandle, 'expected explore task to be available initially');
    exploreHandle.execute(context);
    exploreHandle.fail('blocked path');

    const failedState = scheduler.getTaskState('explore');
    assert.strictEqual(failedState.failures, 1);
    assert.ok(failedState.cooldownUntil > scheduler.time, 'failure should apply cooldown');

    const fallback = scheduler.requestTask(context);
    assert.ok(fallback, 'expected fallback task while explore cools down');
    assert.notStrictEqual(fallback.name, 'explore');
    fallback.succeed(fallback.execute(context));

    scheduler.tick(6, context);
    const retried = scheduler.requestTask(context, { include: ['explore'] });
    assert.ok(retried, 'explore should reschedule after failure cooldown elapses');
  });

  it('drives ambient behaviors via scheduler hooks', () => {
    scheduler.tick(0, context);

    const seekSunlight = createSeekSunlightBehavior(scheduler, { lightThreshold: 0.8 });
    const gatherResources = createGatherResourcesBehavior(scheduler, { radius: 32 });
    const idleChatter = createIdleChatterBehavior(scheduler, { radius: 12 });

    seekSunlight.initialize?.(context);
    gatherResources.initialize?.(context);
    idleChatter.initialize?.(context);

    const sunlightResult = seekSunlight.update(1, context);
    assert.strictEqual(sunlightResult.status, 'seeking');
    assert.strictEqual(context.memory.get('ambient:lastSeekSunlightResult').success, true);

    const gatherResult = gatherResources.update(1, context);
    assert.strictEqual(gatherResult.status, 'gathering');
    const recordedGather = context.memory.get('ambient:lastGatherResult');
    assert.strictEqual(recordedGather.status, 'gathering');

    const chatterResult = idleChatter.update(1, context);
    assert.strictEqual(chatterResult.status, 'chatting');
    const recordedChatter = context.memory.get('ambient:lastChatterResult');
    assert.strictEqual(recordedChatter.status, 'chatting');
  });
});

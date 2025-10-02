import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MobAICore } from '../mob-ai-core.js';
import { ActionNode } from '../behavior-nodes.js';

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
});

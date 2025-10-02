import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateBehaviorDescriptor, TRIGGER_TYPES } from '../behavior-schema.js';

describe('behavior-schema', () => {
  it('normalizes durations, priorities, and triggers', () => {
    const descriptor = validateBehaviorDescriptor({
      name: 'test-loop',
      loop: 'idle',
      priority: '5',
      duration: { min: 1, max: 3, unit: 'seconds' },
      triggers: [
        { type: 'time', after: '2' },
        { type: 'flag', name: 'canBuild' },
        { type: 'resource', resource: 'stamina', below: 20 },
      ],
      options: { wanderChance: 0.5 },
    });

    assert.strictEqual(descriptor.name, 'test-loop');
    assert.strictEqual(descriptor.loop, 'idle');
    assert.strictEqual(descriptor.priority, 5);
    assert.deepStrictEqual(descriptor.duration, { min: 1, max: 3, unit: 'seconds' });
    assert.strictEqual(descriptor.triggers.length, 3);
    assert.ok(Array.from(TRIGGER_TYPES).includes('time'));
  });

  it('throws when trigger type is unsupported', () => {
    assert.throws(() => {
      validateBehaviorDescriptor({
        name: 'bad-loop',
        loop: 'idle',
        triggers: [{ type: 'unknown' }],
      });
    });
  });
});

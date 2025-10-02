import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StatusEffectManager } from '../resources/status-effect-manager.js';

describe('StatusEffectManager', () => {
  it('expires timed effects and fires callbacks', () => {
    const manager = new StatusEffectManager();
    let expiredCount = 0;
    manager.events.on('effect:expired', (effect, detail) => {
      if (effect.id === 'burn') {
        expiredCount += 1;
        assert.strictEqual(detail.reason, 'expired');
      }
    });

    let applied = false;
    manager.apply({
      id: 'burn',
      duration: 3,
      onApply: () => {
        applied = true;
      },
    });
    assert.ok(manager.has('burn'));
    assert.ok(applied);

    manager.update(1);
    manager.update(1);
    assert.ok(manager.has('burn'));
    const expired = manager.update(1);
    assert.deepStrictEqual(expired, ['burn']);
    assert.strictEqual(manager.has('burn'), false);
    assert.strictEqual(expiredCount, 1);
  });

  it('stacks effects respecting caps and refresh rules', () => {
    const manager = new StatusEffectManager();
    let stackEvents = 0;
    manager.events.on('effect:stacked', () => {
      stackEvents += 1;
    });

    manager.apply({ id: 'fury', duration: 5, stacking: 'stack', maxStacks: 2 });
    const afterFirst = manager.get('fury');
    assert.strictEqual(afterFirst.stacks, 1);
    assert.strictEqual(afterFirst.remaining, 5);

    manager.update(2);
    manager.apply({ id: 'fury', duration: 5, stacking: 'stack', maxStacks: 2 });
    const afterSecond = manager.get('fury');
    assert.strictEqual(afterSecond.stacks, 2);
    assert.ok(afterSecond.remaining <= 5 && afterSecond.remaining > 0);
    assert.ok(stackEvents >= 1);
  });
});

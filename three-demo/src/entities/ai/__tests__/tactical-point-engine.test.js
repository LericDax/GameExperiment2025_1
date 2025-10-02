import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TacticalPointEngine } from '../combat/tactical-point-engine.js';

describe('TacticalPointEngine', () => {
  it('validates ability costs and spending', () => {
    const engine = new TacticalPointEngine({ maxPoints: 20, initialPoints: 10 });
    engine.registerAbility('dash', { cost: 8 });
    engine.registerAbility('blink', { cost: 5 });

    assert.ok(engine.canUseAbility('dash'));
    let spentEvent = null;
    engine.events.on('ability:spent', (payload) => {
      spentEvent = payload;
    });

    assert.strictEqual(engine.spendForAbility('dash'), true);
    assert.strictEqual(engine.points, 2);
    assert.ok(spentEvent);
    assert.strictEqual(spentEvent.ability.name, 'dash');

    assert.strictEqual(engine.spendForAbility('dash'), false);
    assert.strictEqual(engine.points, 2);

    assert.throws(() => engine.registerAbility('bad', { cost: -1 }));
  });

  it('accrues points over time and triggers behaviors', () => {
    const engine = new TacticalPointEngine({
      maxPoints: 30,
      initialPoints: 2,
      accrualRules: [{ id: 'passive', rate: 2 }],
    });
    engine.registerAbility('strike', 6);

    let triggered = 0;
    engine.addTrigger(
      'threshold-10',
      ({ current, previous }) => previous < 10 && current >= 10,
      {
        once: true,
        callback: () => {
          triggered += 1;
        },
      },
    );
    engine.events.on('trigger:threshold-10', () => {
      triggered += 1;
    });

    engine.update(4); // +8 points -> 10 total
    assert.strictEqual(engine.points, 10);
    assert.ok(triggered >= 1);
    assert.ok(engine.canUseAbility('strike'));

    const spent = engine.spendForAbility('strike');
    assert.ok(spent);
    assert.strictEqual(engine.points, 4);
  });
});

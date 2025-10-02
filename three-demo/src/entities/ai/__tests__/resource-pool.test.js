import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ResourcePool } from '../resources/resource-pool.js';

describe('ResourcePool', () => {
  it('regenerates resources and enforces caps', () => {
    const pool = new ResourcePool({
      stamina: { max: 10, current: 4, regen: 5 },
    });

    pool.tick(1);
    assert.strictEqual(pool.getCurrent('stamina'), 9);
    pool.tick(1);
    assert.strictEqual(pool.getCurrent('stamina'), 10);

    // Should not exceed cap even if regen would push beyond max.
    pool.tick(10);
    assert.strictEqual(pool.getCurrent('stamina'), 10);
  });

  it('supports consumption, partial spending, and depletion events', () => {
    const pool = new ResourcePool({ mana: { max: 12, current: 12, regen: 0 } });
    let depleted = 0;
    let changeEvents = 0;
    pool.events.on('resource:depleted', (entry) => {
      if (entry.name === 'mana') {
        depleted += 1;
      }
    });
    pool.events.on('resource:changed', (entry) => {
      if (entry.name === 'mana') {
        changeEvents += 1;
      }
    });

    const firstSpend = pool.consume('mana', 3);
    assert.strictEqual(firstSpend, 3);
    assert.strictEqual(pool.getCurrent('mana'), 9);

    const secondSpend = pool.consume('mana', 20, { allowPartial: true });
    assert.strictEqual(secondSpend, 9);
    assert.strictEqual(pool.getCurrent('mana'), 0);
    assert.strictEqual(depleted, 1);
    assert.ok(changeEvents >= 2);
  });
});

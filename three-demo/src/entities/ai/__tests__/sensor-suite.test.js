import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { MobAICore } from '../mob-ai-core.js';
import { SensorSuite } from '../sensors/sensor-suite.js';
import { ConeVisionSensor } from '../sensors/cone-vision-sensor.js';
import { RingProximitySensor } from '../sensors/ring-proximity-sensor.js';
import { ThresholdSensor } from '../sensors/threshold-sensor.js';

describe('SensorSuite', () => {
  let entity;
  let world;
  let ai;

  beforeEach(() => {
    entity = {
      position: new Vector3(0, 0, 0),
      forward: new Vector3(0, 0, 1),
    };
    world = {
      targets: [],
    };
    ai = new MobAICore();
  });

  it('detects entities within a vision cone and forwards stimuli to the AI core', () => {
    world.targets = [
      { id: 'ahead', position: new Vector3(0, 0, 5) },
      { id: 'side', position: new Vector3(5, 0, 0) },
    ];

    const stimuliEvents = [];
    ai.on('sensor:stimuli', (stimuli) => stimuliEvents.push(stimuli));

    const suite = new SensorSuite({
      sensors: [
        new ConeVisionSensor({
          range: 8,
          angle: Math.PI / 2,
          queryTargets: () => world.targets,
        }),
      ],
    });

    suite.configure({ entity, world, aiCore: ai });

    const stimuli = suite.update(16);

    assert.strictEqual(stimuli.length, 1);
    assert.strictEqual(stimuli[0].target.id, 'ahead');
    assert.strictEqual(stimuliEvents.length, 1);
    assert.strictEqual(stimuliEvents[0][0].target.id, 'ahead');
    assert.ok(stimuli[0].distance <= 8);
    assert.ok(stimuli[0].angle <= Math.PI / 4);
  });

  it('applies decay and blocking rules for cone vision detection', () => {
    world.targets = [
      { id: 'visible', position: new Vector3(0, 0, 4) },
      { id: 'blocked', position: new Vector3(0, 0, 6) },
    ];

    const sensor = new ConeVisionSensor({
      range: 10,
      angle: Math.PI,
      queryTargets: () => world.targets,
      decay: ({ distance, range }) => Number((1 - distance / range).toFixed(3)),
      isOccluded: ({ target }) => target.id === 'blocked',
    });

    const suite = new SensorSuite({ sensors: [sensor] });
    suite.configure({ entity, world, aiCore: ai });

    const stimuli = suite.update(33);

    assert.strictEqual(stimuli.length, 1);
    assert.strictEqual(stimuli[0].target.id, 'visible');
    assert.strictEqual(stimuli[0].intensity, Number((1 - 4 / 10).toFixed(3)));
  });

  it('throttles sensor sampling according to interval', () => {
    world.targets = [{ id: 'ahead', position: new Vector3(0, 0, 4) }];
    const sensor = new ConeVisionSensor({
      range: 6,
      interval: 100,
      angle: Math.PI / 2,
      queryTargets: () => world.targets,
    });
    const suite = new SensorSuite({ sensors: [sensor] });
    suite.configure({ entity, world, aiCore: ai });

    const first = suite.update(16);
    const second = suite.update(16);
    const third = suite.update(84);

    assert.strictEqual(first.length, 1, 'first sample should detect target');
    assert.strictEqual(second.length, 0, 'interval should block second sample');
    assert.strictEqual(third.length, 1, 'third sample occurs after interval');
  });

  it('computes ring proximity intensity using custom decay', () => {
    world.targets = [
      { id: 'inner', position: new Vector3(0, 0, 3) },
      { id: 'outer', position: new Vector3(0, 0, 5) },
      { id: 'far', position: new Vector3(0, 0, 8) },
    ];

    const sensor = new RingProximitySensor({
      innerRadius: 2,
      outerRadius: 6,
      queryTargets: () => world.targets,
    });

    const suite = new SensorSuite({ sensors: [sensor] });
    suite.configure({ entity, world });

    const stimuli = suite.update(20);

    assert.strictEqual(stimuli.length, 2);
    const intensities = Object.fromEntries(
      stimuli.map((stimulus) => [stimulus.target.id, Number(stimulus.intensity.toFixed(2))]),
    );

    assert.deepStrictEqual(intensities, {
      inner: Number((1 - (3 - 2) / 4).toFixed(2)),
      outer: Number((1 - (5 - 2) / 4).toFixed(2)),
    });
  });

  it('fires threshold events only when crossing the threshold', () => {
    const timeline = [0.2, 0.7, 0.9, 0.3, 0.8];
    let index = 0;
    const sensor = new ThresholdSensor({
      threshold: 0.6,
      interval: 10,
      getValue: () => timeline[index],
      intensityMapper: ({ value, threshold }) => Number((value - threshold).toFixed(2)),
    });

    const suite = new SensorSuite({ sensors: [sensor] });
    suite.configure({ entity, world, aiCore: ai });

    const emissions = [];
    ai.on('sensor:stimulus', (stimulus) => emissions.push(stimulus));

    const step = (delta) => {
      const result = suite.update(delta);
      index = Math.min(index + 1, timeline.length - 1);
      return result;
    };

    const first = step(16);
    const second = step(16);
    const third = step(16);
    const fourth = step(16);
    const fifth = step(16);

    assert.strictEqual(first.length, 0, 'below threshold does not emit');
    assert.strictEqual(second.length, 1, 'crossing threshold emits once');
    assert.strictEqual(second[0].intensity, Number((0.7 - 0.6).toFixed(2)));
    assert.strictEqual(third.length, 0, 'remaining above threshold does not re-emit');
    assert.strictEqual(fourth.length, 0, 'dropping below resets state without emission');
    assert.strictEqual(fifth.length, 1, 'rising again triggers emission');
    assert.strictEqual(emissions.length, 2, 'AI core receives individual stimulus events');
  });
});

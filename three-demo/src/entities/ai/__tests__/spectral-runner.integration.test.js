import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MobAICore } from '../mob-ai-core.js';
import { BehaviorRegistry } from '../behavior-nodes.js';
import { spectralRunnerPersona } from '../personas/spectral-runner.js';
import { AIPresentationAdapter } from '../presentation/presentation-adapter.js';
import { TacticalPointEngine } from '../combat/tactical-point-engine.js';

describe('Spectral Runner integration', () => {
  it('emits animation intents across a chase sequence', () => {
    const core = new MobAICore({
      random: () => 0,
      behaviorRegistry: new BehaviorRegistry(),
    });
    core.registerPersona(spectralRunnerPersona);
    core.usePersona('spectral-runner');

    const animationCalls = [];
    const animationController = {
      playVariant(variant, options = {}) {
        animationCalls.push({ variant, options });
      },
      stop() {},
    };

    const adapter = new AIPresentationAdapter({
      ai: core.events,
      animationController,
      personaConfig: spectralRunnerPersona.metadata.presentation,
    });

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
        transitions.push(state);
      },
      shouldWander: (context) => Boolean(context.flags?.wander),
      canSeeTarget: (context) => Boolean(context.percepts?.targetVisible),
      lostTarget: (context) => !context.percepts?.targetVisible,
    });

    core.initialize({
      flags: { wander: false },
      percepts: { targetVisible: false },
      environment: { lightLevel: 0.55 },
    });
    core.attachToEntity({ id: 'spectral-runner-entity' });

    assert.deepStrictEqual(transitions, ['idle']);
    assert.strictEqual(animationCalls.length, 1);
    assert.strictEqual(animationCalls[0].variant, 'idle');
    assert.strictEqual(animationCalls[0].options.fadeDuration, 0.35);

    core.update(1, { flags: { wander: true }, percepts: { targetVisible: false } });
    core.update(1, { flags: { wander: true }, percepts: { targetVisible: true } });
    core.update(1, { flags: { wander: false }, percepts: { targetVisible: false } });

    assert.deepStrictEqual(transitions, ['idle', 'wander', 'chase', 'idle']);
    assert.deepStrictEqual(
      animationCalls.map((entry) => entry.variant),
      ['idle', 'runner', 'runner', 'idle'],
    );
    assert.deepStrictEqual(
      animationCalls.slice(0, 4).map((entry) => Number(entry.options.fadeDuration.toFixed(2))),
      [0.35, 0.2, 0.15, 0.35],
    );

    const engine = new TacticalPointEngine({
      initialPoints: 10,
      events: core.events,
    });
    engine.registerAbility('howl', { cost: 4 });

    assert.strictEqual(engine.spendForAbility('howl', { context: { entityId: 'spectral-runner-entity' } }), true);
    const lastCall = animationCalls.at(-1);
    assert.strictEqual(lastCall.variant, 'howl');
    assert.strictEqual(lastCall.options.fadeDuration, 0);

    adapter.dispose();
  });
});

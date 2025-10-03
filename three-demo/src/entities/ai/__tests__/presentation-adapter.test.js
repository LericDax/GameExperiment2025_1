import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from '../../../utils/event-emitter.js';
import {
  AIPresentationAdapter,
  DEFAULT_PRESENTATION_MAPPING,
  mergePresentationConfigs,
} from '../presentation/presentation-adapter.js';

const createAnimationControllerMock = () => {
  const calls = [];
  const stops = [];
  const controller = {
    playVariant(variant, options = {}) {
      calls.push({ variant, options });
      return { variant, options };
    },
    stop(options = {}) {
      stops.push(options);
    },
  };
  Object.defineProperties(controller, {
    playVariantCalls: { value: calls, enumerable: true },
    stopCalls: { value: stops, enumerable: true },
  });
  return controller;
};

const createEmitterSpy = () => {
  const cues = [];
  const fn = ({ id, options, payload, meta }) => {
    cues.push({ id, options, payload, meta });
  };
  Object.defineProperty(fn, 'calls', { value: cues, enumerable: true });
  return fn;
};

test('state enter events trigger directional animations and sound cues', () => {
  const events = new EventEmitter();
  const animation = createAnimationControllerMock();
  const audio = createEmitterSpy();

  new AIPresentationAdapter({
    ai: events,
    animationController: animation,
    audioEmitters: [audio],
    config: {
      states: {
        'mob-idle:idle': {
          animation: {
            directional: {
              default: 'idle',
              forward: 'idle-forward',
              left: 'idle-left',
              right: 'idle-right',
            },
            fadeDuration: 0.5,
          },
          sounds: [{ id: 'idle-enter', options: { volume: 0.6 } }],
        },
      },
    },
  });

  events.emit('behavior:stateEnter', {
    behavior: 'mob-idle',
    state: 'idle',
    intent: { visualYawOffset: 0.45 },
  });

  assert.equal(animation.playVariantCalls.length, 1);
  assert.deepEqual(animation.playVariantCalls[0], {
    variant: 'idle-right',
    options: { fadeDuration: 0.5 },
  });

  assert.equal(audio.calls.length, 1);
  assert.equal(audio.calls[0].id, 'idle-enter');
  assert.equal(audio.calls[0].meta.event, 'stateEnter');
});

test('persona and trait overrides merge into active config', () => {
  const events = new EventEmitter();
  const animation = createAnimationControllerMock();
  const audio = createEmitterSpy();

  const adapter = new AIPresentationAdapter({
    ai: events,
    animationController: animation,
    audioEmitters: [audio],
    config: {
      states: {
        idle: { animation: 'base-idle', sounds: ['base-sound'] },
      },
    },
  });

  adapter.setPersonaConfig({
    states: {
      idle: { animation: 'persona-idle' },
    },
  });

  adapter.setTraitConfigs([
    {
      states: {
        idle: { sounds: [{ id: 'trait-sound', options: { channel: 'voice' } }] },
      },
    },
  ]);

  events.emit('behavior:stateEnter', { state: 'idle' });

  assert.equal(animation.playVariantCalls.length, 1);
  assert.equal(animation.playVariantCalls[0].variant, 'persona-idle');
  assert.equal(audio.calls.length, 1);
  assert.equal(audio.calls[0].id, 'trait-sound');
});

test('ability events trigger mapped animation and particle cues', () => {
  const events = new EventEmitter();
  const animation = createAnimationControllerMock();
  const particles = createEmitterSpy();

  new AIPresentationAdapter({
    ai: events,
    animationController: animation,
    particleEmitters: [particles],
    config: {
      abilities: {
        howl: {
          animation: { variant: 'howl', loopMode: 'LoopOnce', fadeDuration: 0 },
          particles: [{ id: 'howl-burst', options: { count: 12 } }],
        },
      },
    },
  });

  events.emit('ability:used', { ability: { name: 'howl' } });

  assert.equal(animation.playVariantCalls.length, 1);
  assert.deepEqual(animation.playVariantCalls[0], {
    variant: 'howl',
    options: { fadeDuration: 0, loopMode: 'LoopOnce' },
  });

  assert.equal(particles.calls.length, 1);
  assert.equal(particles.calls[0].id, 'howl-burst');
  assert.equal(particles.calls[0].meta.ability, 'howl');
});

test('state exit can stop animations with configured fade', () => {
  const events = new EventEmitter();
  const animation = createAnimationControllerMock();

  new AIPresentationAdapter({
    ai: events,
    animationController: animation,
    config: {
      states: {
        idle: {
          animation: 'idle',
          exit: { stopAnimation: { fadeDuration: 0.2 } },
        },
      },
    },
  });

  events.emit('behavior:stateExit', { state: 'idle' });

  assert.equal(animation.stopCalls.length, 1);
  assert.deepEqual(animation.stopCalls[0], { fadeDuration: 0.2 });
});

test('mergePresentationConfigs overlays entries deeply', () => {
  const merged = mergePresentationConfigs(
    DEFAULT_PRESENTATION_MAPPING,
    {
      states: {
        idle: { animation: 'custom-idle' },
        roar: { animation: 'roar' },
      },
      abilities: {
        howl: { sounds: [{ id: 'custom-howl' }] },
        blink: { animation: 'blink' },
      },
    },
  );

  assert.equal(merged.states.idle.animation, 'custom-idle');
  assert.ok(Array.isArray(merged.states.roar.sounds) === false);
  assert.equal(merged.abilities.howl.sounds[0].id, 'custom-howl');
  assert.equal(merged.abilities.blink.animation, 'blink');
});

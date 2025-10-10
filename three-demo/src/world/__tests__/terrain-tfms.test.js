import assert from 'node:assert/strict';
import test from 'node:test';

import { createTfmsNetwork as createDefaultTfmsNetwork } from '../tfms/operators.js';

if (!globalThis.__THREE_DEMO_BIOME_DEFINITIONS__) {
  const biomeStubs = [
    {
      id: 'mesa-resonance',
      label: 'Mesa Resonance',
      climate: { temperature: 0.72, moisture: 0.18, weight: 1 },
      terrain: { heightOffset: 0 },
    },
    {
      id: 'glacial-harmonic',
      label: 'Glacial Harmonic',
      climate: { temperature: 0.08, moisture: 0.82, weight: 1 },
      terrain: { heightOffset: 0 },
    },
    {
      id: 'fungal-chromatic',
      label: 'Fungal Chromatic',
      climate: { temperature: 0.61, moisture: 0.74, weight: 1 },
      terrain: { heightOffset: 0 },
    },
  ];
  globalThis.__THREE_DEMO_BIOME_DEFINITIONS__ = Object.fromEntries(
    biomeStubs.map((definition, index) => [
      `./biomes/stub-${index}.json`,
      { default: definition },
    ]),
  );
}

const { createTerrainEngine } = await import('../terrain-engine.js');

const networkCalls = [];
const trackingTfmsFactory = (options) => {
  const capturedOptions = structuredClone(options);
  const network = createDefaultTfmsNetwork(options);
  networkCalls.push({ options: capturedOptions, network });
  return network;
};

class StubColor {
  constructor(r = 1, g = 1, b = 1) {
    if (typeof r === 'string') {
      const hex = r.startsWith('#') ? r.slice(1) : r;
      const int = Number.parseInt(hex, 16);
      this.r = ((int >> 16) & 0xff) / 255;
      this.g = ((int >> 8) & 0xff) / 255;
      this.b = (int & 0xff) / 255;
    } else if (typeof r === 'number' && g === undefined && b === undefined) {
      this.r = ((r >> 16) & 0xff) / 255;
      this.g = ((r >> 8) & 0xff) / 255;
      this.b = (r & 0xff) / 255;
    } else {
      this.r = r ?? 1;
      this.g = g ?? 1;
      this.b = b ?? 1;
    }
  }
}

const THREE = { Color: StubColor };

const baseTerrainCore = {
  baseHeight: 0,
  maxHeight: 48,
  primaryFrequency: 0.015,
  primaryAmplitude: 12,
  primaryOffset: 0,
  detailFrequency: 0.02,
  detailAmplitude: 6,
  detailOffset: 0,
  ridgeFrequency: 0.01,
  ridgeStrength: 0,
  ridgeOffset: 0,
  climateHeightInfluence: 0,
};

const baseTfmsPreset = {
  baseAttenuation: 0,
  biomeBlendStrength: 0,
  clamp: { min: -64, max: 64 },
  waveforms: [
    {
      id: 'carrier',
      type: 'sine',
      seedTemplate: { value: 1013 },
      settings: { octaves: 1 },
    },
    {
      id: 'modulator',
      type: 'sine',
      seedTemplate: { value: 1723 },
      settings: { octaves: 1 },
    },
  ],
  operators: [
    {
      id: 'carrier',
      waveformId: 'carrier',
      type: 'sine',
      seedTemplate: { value: 1013 },
      weight: 1,
      bias: 0,
      transfer: 'identity',
      envelope: {
        amplitude: { value: 9.5, min: -128, max: 128 },
        frequency: { value: 0.0225, min: 0.0001, max: 1 },
        phase: {
          x: { value: 0, min: -Math.PI, max: Math.PI },
          z: { value: 0, min: -Math.PI, max: Math.PI },
        },
        warp: {
          x: { value: 0, min: -1, max: 1 },
          z: { value: 0, min: -1, max: 1 },
        },
      },
      modulation: {
        amplitude: { value: 0, min: -1, max: 1 },
        frequency: { value: 0, min: -1, max: 1 },
        phase: {
          x: { value: 0, min: -Math.PI, max: Math.PI },
          z: { value: 0, min: -Math.PI, max: Math.PI },
        },
        warp: {
          x: { value: 0, min: -1, max: 1 },
          z: { value: 0, min: -1, max: 1 },
        },
      },
    },
    {
      id: 'modulator',
      waveformId: 'modulator',
      type: 'sine',
      seedTemplate: { value: 1723 },
      weight: 0.55,
      bias: 0,
      transfer: 'identity',
      envelope: {
        amplitude: { value: 3.2, min: -128, max: 128 },
        frequency: { value: 0.0475, min: 0.0001, max: 1 },
        phase: {
          x: { value: 0.35, min: -Math.PI, max: Math.PI },
          z: { value: -0.27, min: -Math.PI, max: Math.PI },
        },
        warp: {
          x: { value: 0, min: -1, max: 1 },
          z: { value: 0, min: -1, max: 1 },
        },
      },
      modulation: {
        amplitude: { value: 0, min: -1, max: 1 },
        frequency: { value: 0, min: -1, max: 1 },
        phase: {
          x: { value: 0, min: -Math.PI, max: Math.PI },
          z: { value: 0, min: -Math.PI, max: Math.PI },
        },
        warp: {
          x: { value: 0, min: -1, max: 1 },
          z: { value: 0, min: -1, max: 1 },
        },
      },
    },
  ],
  modulationMatrix: [
    {
      id: 'mod-to-carrier',
      sourceId: 'modulator',
      targetId: 'carrier',
      routing: 'amplitude',
      channel: 'value',
      gain: 0.42,
      bias: 0,
    },
  ],
  transferFunctions: {},
};

const biomePresets = {
  'mesa-resonance': (tfms) => {
    const modulator = tfms.operators.find((op) => op.id === 'modulator');
    if (modulator) {
      modulator.type = 'triangle';
      modulator.envelope = {
        ...modulator.envelope,
        amplitude: { value: 4.15, min: -128, max: 128 },
        frequency: { value: 0.052, min: 0.0001, max: 1 },
      };
    }
    const matrix = tfms.modulationMatrix.find(
      (entry) => entry.id === 'mod-to-carrier',
    );
    if (matrix) {
      matrix.gain = 0.28;
    }
  },
  'glacial-harmonic': (tfms) => {
    const carrier = tfms.operators.find((op) => op.id === 'carrier');
    if (carrier) {
      carrier.modulation = {
        ...carrier.modulation,
        amplitude: { value: 0.35, min: -1, max: 1 },
      };
    }
    const matrix = tfms.modulationMatrix.find(
      (entry) => entry.id === 'mod-to-carrier',
    );
    if (matrix) {
      matrix.gain = 0.78;
    }
  },
  'fungal-chromatic': (tfms) => {
    const carrier = tfms.operators.find((op) => op.id === 'carrier');
    if (carrier) {
      carrier.transfer = 'tanh';
      carrier.envelope = {
        ...carrier.envelope,
        amplitude: { value: 8.25, min: -128, max: 128 },
      };
    }
    const matrix = tfms.modulationMatrix.find(
      (entry) => entry.id === 'mod-to-carrier',
    );
    if (matrix) {
      matrix.gain = 0.51;
    }
  },
};

const presetSamples = {
  'mesa-resonance': [
    { x: 4, z: -12 },
    { x: 28, z: -20 },
  ],
  'glacial-harmonic': [
    { x: -56, z: -8 },
    { x: -84, z: 24 },
  ],
  'fungal-chromatic': [
    { x: 12, z: 48 },
    { x: 24, z: 68 },
  ],
};

function buildWorldConfig(modifier = () => {}) {
  const tfms = structuredClone(baseTfmsPreset);
  modifier(tfms);
  return {
    baseHeight: baseTerrainCore.baseHeight,
    maxHeight: baseTerrainCore.maxHeight,
    terrain: {
      ...baseTerrainCore,
      tfms,
    },
  };
}

function formatNumber(value) {
  return Number.parseFloat(value.toFixed(6));
}

test('terrain TFMS presets produce deterministic biome snapshots', () => {
  const snapshots = {};
  const matrixSnapshots = {};

  networkCalls.length = 0;

  Object.entries(biomePresets).forEach(([biomeId, modifier]) => {
    const engine = createTerrainEngine({
      THREE,
      seed: 1337,
      worldConfig: buildWorldConfig(modifier),
      tfmsFactory: trackingTfmsFactory,
    });

    const call = networkCalls.at(-1);
    assert(call, `expected captured network for ${biomeId}`);

    const network = call.network;
    const envelopes = [];
    const operatorValues = [];
    presetSamples[biomeId].forEach(({ x, z }) => {
      const evaluation = network.evaluate({
        x,
        z,
        context: { terrain: baseTerrainCore },
      });
      envelopes.push(formatNumber(evaluation.envelope));
      operatorValues.push(
        evaluation.operators.map((operator) => formatNumber(operator.transferred)),
      );
    });

    snapshots[biomeId] = {
      envelope: envelopes,
      operators: operatorValues,
    };
    matrixSnapshots[biomeId] = call.options.modulationMatrix.map((entry) => ({
      id: entry.id,
      gain: formatNumber(entry.gain),
      sourceId: entry.sourceId,
      targetId: entry.targetId,
    }));

    engine.dispose();
  });

  assert.deepEqual(snapshots, {
    'mesa-resonance': {
      envelope: [-0.762288, -0.034089],
      operators: [
        [-4.2008, 0.110124],
        [-0.173346, -0.668375],
      ],
    },
    'glacial-harmonic': {
      envelope: [0.546529, 0.017913],
      operators: [
        [2.27518, 0.097634],
        [-0.586644, 0.550408],
      ],
    },
    'fungal-chromatic': {
      envelope: [-0.055632, -0.185031],
      operators: [
        [-0.998131, 0.637636],
        [-0.452622, -1.517079],
      ],
    },
  });

  assert.deepEqual(matrixSnapshots, {
    'mesa-resonance': [
      {
        id: 'mod-to-carrier',
        gain: 0.28,
        sourceId: 'modulator',
        targetId: 'carrier',
      },
    ],
    'glacial-harmonic': [
      {
        id: 'mod-to-carrier',
        gain: 0.78,
        sourceId: 'modulator',
        targetId: 'carrier',
      },
    ],
    'fungal-chromatic': [
      {
        id: 'mod-to-carrier',
        gain: 0.51,
        sourceId: 'modulator',
        targetId: 'carrier',
      },
    ],
  });
});

test('biome TFMS overrides adjust attenuation envelopes along archetype coordinates', () => {
  networkCalls.length = 0;

  const baseEngine = createTerrainEngine({
    THREE,
    seed: 1337,
    worldConfig: buildWorldConfig(),
    tfmsFactory: trackingTfmsFactory,
  });
  const baseCall = networkCalls.at(-1);
  assert(baseCall, 'expected base network capture');

  Object.entries(biomePresets).forEach(([biomeId, modifier]) => {
    const engine = createTerrainEngine({
      THREE,
      seed: 1337,
      worldConfig: buildWorldConfig(modifier),
      tfmsFactory: trackingTfmsFactory,
    });
    const overrideCall = networkCalls.at(-1);
    assert(overrideCall, `expected override network capture for ${biomeId}`);

    const coord = presetSamples[biomeId][1];
    const baseEnvelope = baseCall.network.evaluate({
      ...coord,
      context: { terrain: baseTerrainCore },
    }).envelope;
    const overrideEnvelope = overrideCall.network.evaluate({
      ...coord,
      context: { terrain: baseTerrainCore },
    }).envelope;

    switch (biomeId) {
      case 'mesa-resonance':
        assert.ok(
          Math.abs(overrideEnvelope) < Math.abs(baseEnvelope),
          'mesa waveform retune should soften the envelope',
        );
        break;
      case 'glacial-harmonic':
        assert.ok(
          overrideEnvelope > baseEnvelope,
          'glacial modulation depth should elevate the envelope',
        );
        break;
      case 'fungal-chromatic':
        assert.ok(
          Math.abs(overrideEnvelope) < Math.abs(baseEnvelope),
          'fungal transfer compression should reduce magnitude',
        );
        break;
      default:
        assert.fail(`unexpected biome id ${biomeId}`);
    }

    engine.dispose();
  });

  baseEngine.dispose();
});

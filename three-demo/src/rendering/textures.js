import { TextureEngine } from './texture-engine.js';
import { createBiomeTintMaterial } from './biome-tint-material.js';

export function createBlockMaterials({ THREE, seed = 1337 } = {}) {
  if (!THREE) {
    throw new Error('createBlockMaterials requires a THREE instance');
  }
  const engine = new TextureEngine({ THREE, seed });

  const textures = {
    grass: engine.createTexture('grass', {
      size: 128,
      generator: ({ noise, worley, bands, color, mix, darken, lighten }) => {
        const base = color('#4a9c47');
        const dark = darken(base, 0.45);
        const highlight = lighten(color('#6fd25f'), 0.2);

        const clumps = worley({ scale: 5.5, jitter: 0.75, variant: 'clumps' });
        const detail = noise({ scale: 12, octaves: 4, persistence: 0.55, variant: 'detail' });
        const blades = bands({
          frequency: 14,
          angle: 12,
          thickness: 1.9,
          turbulence: 0.25,
          variant: 'blades',
        });

        let colorMix = mix(base, dark, clumps * 0.5 + detail * 0.35);
        colorMix = mix(colorMix, highlight, blades * 0.55);

        return { ...colorMix, a: 1 };
      },
    }),
    dirt: engine.createTexture('dirt', {
      size: 128,
      generator: ({ noise, ridge, worley, color, mix, darken, lighten }) => {
        const base = color('#6b4a2f');
        const damp = darken(base, 0.4);
        const highlight = lighten(base, 0.25);

        const coarse = noise({ scale: 7, octaves: 4, persistence: 0.55, variant: 'coarse' });
        const cracks = ridge({
          scale: 11,
          octaves: 3,
          persistence: 0.5,
          sharpness: 2.2,
          variant: 'cracks',
        });
        const pebbles = 1 - worley({
          scale: 8,
          jitter: 0.9,
          distancePower: 1.5,
          variant: 'pebbles',
        });

        let shade = mix(base, damp, coarse * 0.6);
        shade = mix(shade, highlight, Math.pow(cracks, 2.2) * 0.35);
        shade = mix(shade, highlight, Math.pow(pebbles, 1.5) * 0.25);

        return { ...shade, a: 1 };
      },
    }),
    stone: engine.createTexture('stone', {
      size: 128,
      generator: ({ noise, ridge, worley, color, mix, darken, lighten }) => {
        const base = color('#8c8c8c');
        const shadow = darken(base, 0.4);
        const highlight = lighten(color('#d7d7db'), 0.1);

        const striations = ridge({
          scale: 9,
          octaves: 4,
          persistence: 0.55,
          sharpness: 1.4,
          variant: 'striations',
        });
        const veins = 1 - worley({
          scale: 10,
          jitter: 0.7,
          distancePower: 1.2,
          variant: 'veins',
        });
        const micro = noise({ scale: 20, octaves: 2, persistence: 0.6, variant: 'micro' });

        let shade = mix(base, shadow, striations * 0.7 + micro * 0.2);
        shade = mix(shade, highlight, Math.pow(veins, 2.5) * 0.45);

        return { ...shade, a: 1 };
      },
    }),
    sand: engine.createTexture('sand', {
      size: 128,
      generator: ({ noise, bands, color, mix, darken, lighten }) => {
        const base = color('#d7c27a');
        const shadow = darken(base, 0.35);
        const highlight = lighten(color('#f0e4a0'), 0.25);

        const ripples = bands({
          frequency: 6,
          angle: 8,
          thickness: 2.8,
          turbulence: 0.35,
          variant: 'ripples',
        });
        const grains = noise({ scale: 18, octaves: 2, persistence: 0.65, variant: 'grains' });

        let shade = mix(base, shadow, grains * 0.45);
        shade = mix(shade, highlight, Math.pow(ripples, 1.6) * 0.5);

        return { ...shade, a: 1 };
      },
    }),
    water: engine.createTexture('water', {
      size: 128,
      generator: ({ noise, bands, color, mix, lighten, darken }) => {
        const base = color('#1f4d8f');
        const depth = darken(base, 0.35);
        const caustic = lighten(color('#4fa4ff'), 0.1);

        const flow = noise({
          scale: 7,
          octaves: 5,
          persistence: 0.6,
          variant: 'flow',
        });
        const sparkle = Math.pow(
          noise({ scale: 22, octaves: 2, persistence: 0.7, variant: 'sparkle' }),
          2.2
        );
        const streaks = bands({
          frequency: 4,
          angle: -12,
          thickness: 2.1,
          turbulence: 0.45,
          variant: 'streaks',
        });

        let shade = mix(base, depth, flow * 0.55);
        shade = mix(shade, caustic, sparkle * 0.65 + streaks * 0.25);

        return { ...shade, a: 0.9 };
      },
    }),
    leaf: engine.createTexture('leaf', {
      size: 128,
      generator: ({ noise, bands, color, mix, darken, lighten, u, v }) => {
        const base = color('#3f7c35');
        const highlight = lighten(color('#79c35a'), 0.15);
        const shadow = darken(base, 0.45);

        const surface = noise({ scale: 10, octaves: 3, persistence: 0.6, variant: 'surface' });
        const veinsPrimary = 1 - Math.min(Math.abs(u - 0.5) * 4, 1);
        const veinsSecondary = bands({
          frequency: 9,
          angle: 65,
          thickness: 2.6,
          turbulence: 0.3,
          variant: 'veinsA',
        });
        const veinsSecondaryAlt = bands({
          frequency: 9,
          angle: -65,
          thickness: 2.6,
          turbulence: 0.3,
          variant: 'veinsB',
        });

        let shade = mix(base, shadow, surface * 0.55);
        shade = mix(shade, highlight, Math.pow(veinsPrimary, 1.4) * 0.6);
        const branchVeins = Math.max(veinsSecondary, veinsSecondaryAlt);
        shade = mix(shade, highlight, Math.pow(branchVeins, 2) * 0.35);

        return { ...shade, a: 1 };
      },
    }),
    log: engine.createTexture('log', {
      size: 128,
      generator: ({ noise, bands, rings, color, mix, darken, lighten, u }) => {
        const base = color('#725032');
        const highlight = lighten(color('#b0845a'), 0.2);
        const barkShadow = darken(base, 0.5);

        const barkNoise = noise({ scale: 8, octaves: 4, persistence: 0.55, variant: 'bark' });
        const verticalRidges = bands({
          frequency: 11,
          angle: 90,
          thickness: 2.3,
          turbulence: 0.4,
          variant: 'ridges',
        });
        const growth = rings({ frequency: 10, sharpness: 2.4, variant: 'growth' });
        const heartwood = Math.exp(-Math.pow((u - 0.5) * 4, 2));

        let shade = mix(base, barkShadow, barkNoise * 0.6 + verticalRidges * 0.2);
        shade = mix(shade, highlight, Math.pow(growth, 1.8) * 0.6);
        shade = mix(shade, highlight, heartwood * 0.2);

        return { ...shade, a: 1 };
      },
    }),
    cryoshard_glass: engine.createTexture('cryoshard_glass', {
      size: 128,
      generator: ({ noise, worley, bands, color, mix, lighten, darken }) => {
        const base = color('#6fd0ff');
        const icyShadow = darken(base, 0.45);
        const highlight = lighten(color('#c6f4ff'), 0.15);

        const shardCells = worley({
          scale: 9.5,
          jitter: 0.9,
          distancePower: 1.6,
          variant: 'cryoshard:cells',
        });
        const fracture = 1 - worley({
          scale: 12,
          jitter: 0.4,
          distancePower: 1.3,
          variant: 'cryoshard:fracture',
        });
        const frost = bands({
          frequency: 7,
          angle: 28,
          thickness: 2.4,
          turbulence: 0.35,
          variant: 'cryoshard:frost',
        });
        const mist = noise({
          scale: 18,
          octaves: 3,
          persistence: 0.58,
          variant: 'cryoshard:mist',
        });

        let shade = mix(base, icyShadow, shardCells * 0.5 + mist * 0.25);
        shade = mix(shade, highlight, Math.pow(fracture, 1.8) * 0.5);
        shade = mix(shade, highlight, Math.pow(frost, 1.6) * 0.35);

        return { ...shade, a: 0.55 };
      },
    }),
    frostbloom_moss: engine.createTexture('frostbloom_moss', {
      size: 128,
      generator: ({ noise, worley, color, mix, darken, lighten }) => {
        const base = color('#5bc1a4');
        const chill = lighten(color('#a0f7ff'), 0.12);
        const shadow = darken(base, 0.5);

        const tuft = worley({
          scale: 6.5,
          jitter: 0.75,
          variant: 'frostbloom:tuft',
        });
        const frost = noise({
          scale: 16,
          octaves: 3,
          persistence: 0.6,
          variant: 'frostbloom:frost',
        });
        const bloom = noise({
          scale: 9,
          octaves: 2,
          persistence: 0.55,
          variant: 'frostbloom:bloom',
        });

        let shade = mix(base, shadow, tuft * 0.5 + frost * 0.25);
        shade = mix(shade, chill, Math.pow(bloom, 2) * 0.45);

        return { ...shade, a: 1 };
      },
    }),
    snow: engine.createTexture('snow', {
      size: 128,
      generator: ({ bands, noise, worley, color, mix, lighten }) => {
        const base = color('#f4f9ff');
        const shadow = color('#d9e4ff');
        const highlight = lighten(color('#ffffff'), 0.02);

        const drifts = bands({
          frequency: 3.6,
          angle: 21,
          thickness: 5,
          turbulence: 0.45,
          variant: 'snow:drifts',
        });
        const powder = noise({
          scale: 18,
          octaves: 3,
          persistence: 0.6,
          variant: 'snow:powder',
        });
        const crystals = worley({
          scale: 11,
          jitter: 0.75,
          distancePower: 2,
          variant: 'snow:crystal',
        });

        const driftMask = Math.pow(drifts, 1.4);
        let shade = mix(base, shadow, driftMask * 0.55 + powder * 0.25);
        shade = mix(shade, highlight, Math.pow(1 - crystals, 2.2) * 0.5);
        shade = mix(shade, highlight, Math.pow(powder, 1.6) * 0.25);

        return { ...shade, a: 1 };
      },
    }),
    chromatic_sod: engine.createTexture('chromatic_sod', {
      size: 128,
      generator: ({ noise, bands, color, mix, darken, lighten }) => {
        const base = color('#4e8c6f');
        const accent = color('#8cf294');
        const magenta = color('#dc6dff');
        const shadow = darken(base, 0.4);

        const grain = noise({
          scale: 11,
          octaves: 4,
          persistence: 0.6,
          variant: 'chromatic:grain',
        });
        const spectrum = bands({
          frequency: 5,
          angle: 18,
          thickness: 2.8,
          turbulence: 0.45,
          variant: 'chromatic:spectrum',
        });

        let shade = mix(base, shadow, grain * 0.55);
        shade = mix(shade, accent, Math.pow(spectrum, 1.5) * 0.4);
        shade = mix(shade, magenta, Math.pow(1 - spectrum, 2) * 0.25);

        return { ...shade, a: 1 };
      },
    }),
    spectra_petal: engine.createTexture('spectra_petal', {
      size: 128,
      generator: ({ noise, bands, color, mix, lighten }) => {
        const base = color('#ff82d9');
        const iridescent = lighten(color('#fff2ff'), 0.1);
        const glow = color('#ffef9c');

        const striation = bands({
          frequency: 12,
          angle: 33,
          thickness: 2.4,
          turbulence: 0.3,
          variant: 'spectra:striation',
        });
        const sparkle = noise({
          scale: 22,
          octaves: 2,
          persistence: 0.6,
          variant: 'spectra:sparkle',
        });

        let shade = mix(base, iridescent, Math.pow(striation, 1.8) * 0.45);
        shade = mix(shade, glow, Math.pow(sparkle, 2.4) * 0.35);

        return { ...shade, a: 1 };
      },
    }),
    selenite_regolith: engine.createTexture('selenite_regolith', {
      size: 128,
      generator: ({ noise, worley, color, mix, darken, lighten }) => {
        const base = color('#d7dbe6');
        const highlight = lighten(color('#f6f9ff'), 0.12);
        const shadow = darken(base, 0.35);

        const fracture = 1 - worley({
          scale: 8.5,
          jitter: 0.6,
          distancePower: 1.1,
          variant: 'selenite:fracture',
        });
        const dust = noise({
          scale: 14,
          octaves: 3,
          persistence: 0.62,
          variant: 'selenite:dust',
        });

        let shade = mix(base, shadow, dust * 0.45);
        shade = mix(shade, highlight, Math.pow(fracture, 2) * 0.35);

        return { ...shade, a: 1 };
      },
    }),
    umbra_silt: engine.createTexture('umbra_silt', {
      size: 128,
      generator: ({ noise, bands, color, mix, darken }) => {
        const base = color('#2a1f2b');
        const shadow = darken(base, 0.5);
        const cool = color('#3f2e4d');

        const flow = bands({
          frequency: 6,
          angle: -22,
          thickness: 3.2,
          turbulence: 0.5,
          variant: 'umbra:flow',
        });
        const grit = noise({
          scale: 15,
          octaves: 3,
          persistence: 0.58,
          variant: 'umbra:grit',
        });

        let shade = mix(base, shadow, grit * 0.6);
        shade = mix(shade, cool, Math.pow(flow, 1.5) * 0.4);

        return { ...shade, a: 1 };
      },
    }),
    hematite_dust: engine.createTexture('hematite_dust', {
      size: 128,
      generator: ({ noise, worley, color, mix, darken, lighten }) => {
        const base = color('#a13b2e');
        const highlight = lighten(color('#d66f58'), 0.2);
        const shadow = darken(base, 0.45);

        const plates = worley({
          scale: 7,
          jitter: 0.8,
          distancePower: 1.6,
          variant: 'hematite:plates',
        });
        const dust = noise({
          scale: 18,
          octaves: 2,
          persistence: 0.55,
          variant: 'hematite:dust',
        });

        let shade = mix(base, shadow, plates * 0.5 + dust * 0.35);
        shade = mix(shade, highlight, Math.pow(1 - plates, 2.2) * 0.4);

        return { ...shade, a: 1 };
      },
    }),
    ferroglass_plate: engine.createTexture('ferroglass_plate', {
      size: 128,
      generator: ({ noise, worley, bands, color, mix, darken, lighten }) => {
        const base = color('#536079');
        const metal = lighten(color('#93a7c7'), 0.05);
        const patina = color('#2f3f56');

        const pane = worley({
          scale: 5.2,
          jitter: 0.65,
          distancePower: 1.3,
          variant: 'ferroglass:pane',
        });
        const scratches = bands({
          frequency: 13,
          angle: 8,
          thickness: 1.7,
          turbulence: 0.5,
          variant: 'ferroglass:scratch',
        });
        const shimmer = noise({
          scale: 20,
          octaves: 2,
          persistence: 0.65,
          variant: 'ferroglass:shimmer',
        });

        let shade = mix(base, patina, pane * 0.55);
        shade = mix(shade, metal, Math.pow(shimmer, 2.1) * 0.4);
        shade = mix(shade, metal, Math.pow(scratches, 1.4) * 0.35);

        return { ...shade, a: 0.88 };
      },
    }),
    nocturne_bark: engine.createTexture('nocturne_bark', {
      size: 128,
      generator: ({ noise, bands, rings, color, mix, darken, lighten }) => {
        const base = color('#1d141f');
        const glow = lighten(color('#5b3a6f'), 0.18);
        const shadow = darken(base, 0.55);

        const ridges = bands({
          frequency: 10,
          angle: 90,
          thickness: 2.1,
          turbulence: 0.45,
          variant: 'nocturne:ridges',
        });
        const veins = rings({
          frequency: 12,
          sharpness: 2.6,
          variant: 'nocturne:veins',
        });
        const mote = noise({
          scale: 14,
          octaves: 3,
          persistence: 0.57,
          variant: 'nocturne:mote',
        });

        let shade = mix(base, shadow, ridges * 0.6 + mote * 0.2);
        shade = mix(shade, glow, Math.pow(veins, 1.8) * 0.35);

        return { ...shade, a: 1 };
      },
    }),
    cathedral_marble: engine.createTexture('cathedral_marble', {
      size: 128,
      generator: ({ noise, bands, worley, color, mix, darken, lighten }) => {
        const base = color('#f6f1ec');
        const vein = color('#c9c3bd');
        const gold = lighten(color('#f7d79b'), 0.05);

        const marbling = bands({
          frequency: 6.5,
          angle: 28,
          thickness: 3.5,
          turbulence: 0.65,
          variant: 'marble:bands',
        });
        const inclusions = worley({
          scale: 9,
          jitter: 0.6,
          distancePower: 1.2,
          variant: 'marble:inclusions',
        });
        const sparkle = noise({
          scale: 22,
          octaves: 2,
          persistence: 0.6,
          variant: 'marble:sparkle',
        });

        let shade = mix(base, vein, marbling * 0.45);
        shade = mix(shade, gold, Math.pow(sparkle, 2.5) * 0.3);
        shade = mix(shade, vein, Math.pow(inclusions, 1.8) * 0.2);

        return { ...shade, a: 1 };
      },
    }),
    monolith_alloy: engine.createTexture('monolith_alloy', {
      size: 128,
      generator: ({ noise, bands, color, mix, darken, lighten }) => {
        const base = color('#1e222c');
        const sheen = lighten(color('#4a566e'), 0.12);
        const patina = color('#272e39');

        const plate = bands({
          frequency: 4.5,
          angle: 12,
          thickness: 5.5,
          turbulence: 0.35,
          variant: 'monolith:plate',
        });
        const scratches = noise({
          scale: 21,
          octaves: 2,
          persistence: 0.62,
          variant: 'monolith:scratch',
        });

        let shade = mix(base, patina, plate * 0.5);
        shade = mix(shade, sheen, Math.pow(scratches, 1.9) * 0.45);

        return { ...shade, a: 1 };
      },
    }),
    resonant_sand: engine.createTexture('resonant_sand', {
      size: 128,
      generator: ({ noise, bands, color, mix, darken, lighten }) => {
        const base = color('#e4d399');
        const glow = lighten(color('#fff5c7'), 0.15);
        const shadow = darken(base, 0.35);

        const ripple = bands({
          frequency: 5.2,
          angle: -14,
          thickness: 2.7,
          turbulence: 0.42,
          variant: 'resonant:ripple',
        });
        const grain = noise({
          scale: 19,
          octaves: 2,
          persistence: 0.65,
          variant: 'resonant:grain',
        });

        let shade = mix(base, shadow, grain * 0.55);
        shade = mix(shade, glow, Math.pow(ripple, 1.4) * 0.48);

        return { ...shade, a: 1 };
      },
    }),
    macrovirus_chitin: engine.createTexture('macrovirus_chitin', {
      size: 128,
      generator: ({ noise, bands, color, mix, darken, lighten }) => {
        const base = color('#83423a');
        const core = lighten(color('#d37b62'), 0.08);
        const shadow = darken(base, 0.45);

        const plating = bands({
          frequency: 8.5,
          angle: 18,
          thickness: 3,
          turbulence: 0.5,
          variant: 'macrovirus:plating',
        });
        const pores = noise({
          scale: 17,
          octaves: 3,
          persistence: 0.6,
          variant: 'macrovirus:pores',
        });

        let shade = mix(base, shadow, plating * 0.55 + pores * 0.25);
        shade = mix(shade, core, Math.pow(plating, 1.7) * 0.4);

        return { ...shade, a: 1 };
      },
    }),
    nanite_moss: engine.createTexture('nanite_moss', {
      size: 128,
      generator: ({ noise, worley, color, mix, lighten, darken }) => {
        const base = color('#4ca08f');
        const circuits = lighten(color('#8fffd5'), 0.05);
        const shadow = darken(base, 0.4);

        const grid = worley({
          scale: 10.5,
          jitter: 0.8,
          distancePower: 1.8,
          variant: 'nanite:grid',
        });
        const signal = noise({
          scale: 23,
          octaves: 2,
          persistence: 0.65,
          variant: 'nanite:signal',
        });

        let shade = mix(base, shadow, grid * 0.55);
        shade = mix(shade, circuits, Math.pow(signal, 2.4) * 0.4);

        return { ...shade, a: 1 };
      },
    }),
    ossified_soil: engine.createTexture('ossified_soil', {
      size: 128,
      generator: ({ noise, worley, color, mix, darken, lighten }) => {
        const base = color('#d8b296');
        const marrow = lighten(color('#f5e3ce'), 0.08);
        const shadow = darken(base, 0.4);

        const fossil = worley({
          scale: 6.8,
          jitter: 0.7,
          distancePower: 1.5,
          variant: 'ossified:fossil',
        });
        const pores = noise({
          scale: 13,
          octaves: 3,
          persistence: 0.6,
          variant: 'ossified:pores',
        });

        let shade = mix(base, shadow, fossil * 0.6 + pores * 0.25);
        shade = mix(shade, marrow, Math.pow(1 - fossil, 1.8) * 0.35);

        return { ...shade, a: 1 };
      },
    }),
    amber_spine: engine.createTexture('amber_spine', {
      size: 128,
      generator: ({ noise, bands, color, mix, lighten, darken }) => {
        const base = color('#d38832');
        const glow = lighten(color('#ffd08a'), 0.2);
        const shadow = darken(base, 0.55);

        const striation = bands({
          frequency: 9,
          angle: 34,
          thickness: 1.8,
          turbulence: 0.35,
          variant: 'amber:striation',
        });
        const bubbles = noise({
          scale: 16,
          octaves: 3,
          persistence: 0.58,
          variant: 'amber:bubbles',
        });

        let shade = mix(base, shadow, striation * 0.35);
        shade = mix(shade, glow, Math.pow(bubbles, 2.1) * 0.5);

        return { ...shade, a: 0.78 };
      },
    }),
    chromic_mire: engine.createTexture('chromic_mire', {
      size: 128,
      generator: ({ noise, bands, color, mix, lighten, darken }) => {
        const base = color('#5c3145');
        const sheen = lighten(color('#a75e7a'), 0.12);
        const shadow = darken(base, 0.5);

        const swirl = bands({
          frequency: 4.8,
          angle: -26,
          thickness: 4.5,
          turbulence: 0.55,
          variant: 'chromic:swirl',
        });
        const bubbles = noise({
          scale: 14,
          octaves: 3,
          persistence: 0.62,
          variant: 'chromic:bubble',
        });

        let shade = mix(base, shadow, swirl * 0.45 + bubbles * 0.35);
        shade = mix(shade, sheen, Math.pow(swirl, 1.6) * 0.4);

        return { ...shade, a: 0.82 };
      },
    }),
    neon_bark: engine.createTexture('neon_bark', {
      size: 128,
      generator: ({ noise, bands, rings, color, mix, lighten, darken }) => {
        const base = color('#14293f');
        const glow = lighten(color('#37d8ff'), 0.18);
        const ember = color('#ff6be4');
        const shadow = darken(base, 0.45);

        const ridges = bands({
          frequency: 11,
          angle: 90,
          thickness: 1.9,
          turbulence: 0.4,
          variant: 'neon:ridges',
        });
        const conduits = rings({
          frequency: 8,
          sharpness: 2.1,
          variant: 'neon:conduits',
        });
        const sparks = noise({
          scale: 19,
          octaves: 2,
          persistence: 0.65,
          variant: 'neon:sparks',
        });

        let shade = mix(base, shadow, ridges * 0.6);
        shade = mix(shade, glow, Math.pow(conduits, 1.7) * 0.45);
        shade = mix(shade, ember, Math.pow(sparks, 2.2) * 0.3);

        return { ...shade, a: 1 };
      },
    }),
    cloud: engine.createTexture('cloud', {
      size: 128,
      generator: ({ noise, worley, color, mix, lighten, darken }) => {
        const base = color('#f7f8fb');
        const highlight = lighten(color('#ffffff'), 0.05);
        const shadow = darken(color('#d9e5ff'), 0.15);

        const puff = worley({ scale: 3.6, jitter: 0.85, variant: 'puff' });
        const softness = noise({ scale: 5, octaves: 2, persistence: 0.7, variant: 'softness' });
        const outline = Math.pow(1 - puff, 2.2);

        let shade = mix(base, shadow, outline * 0.5 + (1 - softness) * 0.2);
        shade = mix(shade, highlight, Math.pow(puff, 1.6) * 0.8);

        const alpha = THREE.MathUtils.clamp(Math.pow(puff, 1.4) * 0.95, 0.1, 1);
        return { ...shade, a: alpha };
      },
    }),
  };

  const damageStageCount = 6;
  const damageTextures = Array.from({ length: damageStageCount }, (_, stage) => {
    const intensity = (stage + 1) / damageStageCount;
    return engine.createTexture(`damage_stage_${stage}`, {
      size: 128,
      wrap: THREE.ClampToEdgeWrapping,
      generator: ({ worley, noise, rings }) => {
        const fracture = 1 - worley({
          scale: 7.5 + stage * 0.8,
          jitter: 0.72,
          distancePower: 1.4,
          variant: `damage:${stage}:fracture`,
        });
        const radialStress = rings({
          frequency: 6 + stage * 0.25,
          sharpness: 2.2,
          offset: stage * 0.03,
          variant: `damage:${stage}:rings`,
        });
        const scratches = noise({
          scale: 18,
          octaves: 3,
          persistence: 0.58,
          variant: `damage:${stage}:scratch`,
        });

        const crackMask = Math.pow(fracture, 3.1);
        const stressMask = Math.pow(radialStress, 1.9);
        const microMask = Math.pow(scratches, 1.5);
        const combined = Math.min(
          1,
          crackMask * 0.7 + stressMask * 0.45 + microMask * 0.25,
        );
        const alpha = Math.pow(combined, 0.9) * Math.pow(intensity, 1.1);
        const value = 0.65 + intensity * 0.3;
        return { r: value, g: value, b: value, a: Math.min(1, alpha) };
      },
    });
  });

  const damageStages = damageTextures.map((texture) => {
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    material.toneMapped = false;
    return material;
  });

  const createStandardBlockMaterial = (
    texture,
    overrides = {},
    { tintStrength = 1, name } = {},
  ) =>
    createBiomeTintMaterial({
      THREE,
      texture,
      tintStrength,
      name,
      materialOptions: {
        flatShading: true,
        roughness: 0.85,
        metalness: 0,
        ...overrides,
      },
    });

  return {
    grass: createStandardBlockMaterial(textures.grass, { roughness: 0.9 }, {
      name: 'GrassBiomeMaterial',
    }),
    dirt: createStandardBlockMaterial(textures.dirt, { roughness: 0.92 }, {
      name: 'DirtBiomeMaterial',
    }),
    stone: createStandardBlockMaterial(textures.stone, { roughness: 0.75 }, {
      name: 'StoneBiomeMaterial',
    }),
    sand: createStandardBlockMaterial(textures.sand, { roughness: 0.8 }, {
      name: 'SandBiomeMaterial',
    }),
    water: createStandardBlockMaterial(
      textures.water,
      {
        flatShading: false,
        transparent: true,
        opacity: 0.78,
        roughness: 0.35,
        metalness: 0.02,
        depthWrite: false,
      },
      {
        tintStrength: 0.65,
        name: 'WaterBiomeMaterial',
      },
    ),
    leaf: createStandardBlockMaterial(textures.leaf, { roughness: 0.65 }, {
      tintStrength: 0.85,
      name: 'LeafBiomeMaterial',
    }),
    log: createStandardBlockMaterial(textures.log, { roughness: 0.7 }, {
      tintStrength: 0.75,
      name: 'LogBiomeMaterial',
    }),
    cloud: createStandardBlockMaterial(
      textures.cloud,
      {
        flatShading: false,
        transparent: true,
        opacity: 0.9,
        roughness: 0.6,
        metalness: 0,
        depthWrite: false,
      },
      {
        tintStrength: 0.4,
        name: 'CloudBiomeMaterial',
      },
    ),
    cryoshard_glass: createStandardBlockMaterial(
      textures.cryoshard_glass,
      {
        flatShading: false,
        transparent: true,
        opacity: 0.6,
        roughness: 0.22,
        metalness: 0.08,
        envMapIntensity: 0.8,
        depthWrite: false,
      },
      {
        tintStrength: 0.35,
        name: 'CryoshardGlassMaterial',
      },
    ),
    frostbloom_moss: createStandardBlockMaterial(
      textures.frostbloom_moss,
      { roughness: 0.72 },
      {
        tintStrength: 0.9,
        name: 'FrostbloomMossMaterial',
      },
    ),
    snow: createStandardBlockMaterial(
      textures.snow,
      { roughness: 0.92, metalness: 0.02 },
      {
        tintStrength: 0.7,
        name: 'SnowBiomeMaterial',
      },
    ),
    chromatic_sod: createStandardBlockMaterial(
      textures.chromatic_sod,
      { roughness: 0.78 },
      {
        tintStrength: 0.95,
        name: 'ChromaticSodMaterial',
      },
    ),
    spectra_petal: createStandardBlockMaterial(
      textures.spectra_petal,
      { roughness: 0.68 },
      {
        tintStrength: 0.85,
        name: 'SpectraPetalMaterial',
      },
    ),
    selenite_regolith: createStandardBlockMaterial(
      textures.selenite_regolith,
      { roughness: 0.82 },
      {
        tintStrength: 0.6,
        name: 'SeleniteRegolithMaterial',
      },
    ),
    umbra_silt: createStandardBlockMaterial(
      textures.umbra_silt,
      { roughness: 0.76 },
      {
        tintStrength: 0.55,
        name: 'UmbraSiltMaterial',
      },
    ),
    hematite_dust: createStandardBlockMaterial(
      textures.hematite_dust,
      { roughness: 0.74 },
      {
        tintStrength: 0.7,
        name: 'HematiteDustMaterial',
      },
    ),
    ferroglass_plate: createStandardBlockMaterial(
      textures.ferroglass_plate,
      {
        flatShading: false,
        transparent: true,
        opacity: 0.9,
        roughness: 0.32,
        metalness: 0.45,
      },
      {
        tintStrength: 0.4,
        name: 'FerroglassPlateMaterial',
      },
    ),
    nocturne_bark: createStandardBlockMaterial(
      textures.nocturne_bark,
      { roughness: 0.8 },
      {
        tintStrength: 0.75,
        name: 'NocturneBarkMaterial',
      },
    ),
    cathedral_marble: createStandardBlockMaterial(
      textures.cathedral_marble,
      {
        flatShading: false,
        roughness: 0.4,
        metalness: 0.05,
      },
      {
        tintStrength: 0.5,
        name: 'CathedralMarbleMaterial',
      },
    ),
    monolith_alloy: createStandardBlockMaterial(
      textures.monolith_alloy,
      {
        flatShading: false,
        roughness: 0.28,
        metalness: 0.6,
        envMapIntensity: 0.9,
      },
      {
        tintStrength: 0.45,
        name: 'MonolithAlloyMaterial',
      },
    ),
    resonant_sand: createStandardBlockMaterial(
      textures.resonant_sand,
      { roughness: 0.7 },
      {
        tintStrength: 0.65,
        name: 'ResonantSandMaterial',
      },
    ),
    macrovirus_chitin: createStandardBlockMaterial(
      textures.macrovirus_chitin,
      { roughness: 0.66 },
      {
        tintStrength: 0.8,
        name: 'MacrovirusChitinMaterial',
      },
    ),
    nanite_moss: createStandardBlockMaterial(
      textures.nanite_moss,
      { roughness: 0.62 },
      {
        tintStrength: 0.9,
        name: 'NaniteMossMaterial',
      },
    ),
    ossified_soil: createStandardBlockMaterial(
      textures.ossified_soil,
      { roughness: 0.78 },
      {
        tintStrength: 0.6,
        name: 'OssifiedSoilMaterial',
      },
    ),
    amber_spine: createStandardBlockMaterial(
      textures.amber_spine,
      {
        flatShading: false,
        transparent: true,
        opacity: 0.82,
        roughness: 0.38,
        metalness: 0.1,
        depthWrite: false,
      },
      {
        tintStrength: 0.5,
        name: 'AmberSpineMaterial',
      },
    ),
    chromic_mire: createStandardBlockMaterial(
      textures.chromic_mire,
      {
        flatShading: false,
        transparent: true,
        opacity: 0.88,
        roughness: 0.55,
        metalness: 0.12,
      },
      {
        tintStrength: 0.7,
        name: 'ChromicMireMaterial',
      },
    ),
    neon_bark: createStandardBlockMaterial(
      textures.neon_bark,
      { roughness: 0.58 },
      {
        tintStrength: 0.85,
        name: 'NeonBarkMaterial',
      },
    ),
    damageStages,
  };
}

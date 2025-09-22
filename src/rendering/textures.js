import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { TextureEngine } from './texture-engine.js';

export function createBlockMaterials({ seed = 1337 } = {}) {
  const engine = new TextureEngine(seed);

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

  return {
    grass: new THREE.MeshStandardMaterial({ map: textures.grass }),
    dirt: new THREE.MeshStandardMaterial({ map: textures.dirt }),
    stone: new THREE.MeshStandardMaterial({ map: textures.stone }),
    sand: new THREE.MeshStandardMaterial({ map: textures.sand }),
    water: new THREE.MeshStandardMaterial({
      map: textures.water,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    }),
    leaf: new THREE.MeshStandardMaterial({ map: textures.leaf }),
    log: new THREE.MeshStandardMaterial({ map: textures.log }),
    cloud: new THREE.MeshStandardMaterial({
      map: textures.cloud,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    }),
  };
}

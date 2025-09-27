import test from 'node:test';
import assert from 'node:assert/strict';
import { Color } from 'three';

import { resolveBiomeTintMultiplier } from '../color-utils.js';

function createPaletteEntries(type, neutralHex, paletteHex) {
  const neutral = new Color(neutralHex);
  const paletteColor = new Color(paletteHex);
  const ratio = new Color(
    paletteColor.r / Math.max(neutral.r, Number.EPSILON),
    paletteColor.g / Math.max(neutral.g, Number.EPSILON),
    paletteColor.b / Math.max(neutral.b, Number.EPSILON),
  );
  return {
    palette: { [type]: paletteHex },
    paletteColors: { [type]: ratio },
  };
}

test('resolveBiomeTintMultiplier matches sakura leaf expectation', () => {
  const type = 'leaf';
  const strength = 0.85;
  const desiredHex = '#ffc8e4';
  const neutralHex = '#3f7c35';
  const paletteHex = '#66b756';
  const { palette, paletteColors } = createPaletteEntries(
    type,
    neutralHex,
    paletteHex,
  );
  const blockMaterial = {
    userData: {
      biomeTintUniforms: {
        biomeTintStrength: { value: strength },
      },
    },
  };

  const multiplier = resolveBiomeTintMultiplier({
    desiredHex,
    type,
    palette,
    paletteColors,
    blockMaterial,
  });

  assert.ok(multiplier, 'expected a multiplier colour to be returned');

  const neutralColor = new Color(neutralHex);
  const tintedColor = neutralColor.clone().multiply(multiplier);
  const finalColor = new Color(
    neutralColor.r * (1 - strength) + tintedColor.r * strength,
    neutralColor.g * (1 - strength) + tintedColor.g * strength,
    neutralColor.b * (1 - strength) + tintedColor.b * strength,
  );
  const desiredColor = new Color(desiredHex);

  const tolerance = 1e-4;
  assert.ok(
    Math.abs(finalColor.r - desiredColor.r) < tolerance,
    `expected red channel ${desiredColor.r}, received ${finalColor.r}`,
  );
  assert.ok(
    Math.abs(finalColor.g - desiredColor.g) < tolerance,
    `expected green channel ${desiredColor.g}, received ${finalColor.g}`,
  );
  assert.ok(
    Math.abs(finalColor.b - desiredColor.b) < tolerance,
    `expected blue channel ${desiredColor.b}, received ${finalColor.b}`,
  );
});

test('resolveBiomeTintMultiplier defaults to white when strength is zero', () => {
  const type = 'grass';
  const blockMaterial = {
    userData: {
      biomeTintUniforms: {
        biomeTintStrength: { value: 0 },
      },
    },
  };

  const multiplier = resolveBiomeTintMultiplier({
    desiredHex: '#abcdef',
    type,
    palette: {},
    paletteColors: {},
    blockMaterial,
  });

  assert.equal(multiplier.r, 1);
  assert.equal(multiplier.g, 1);
  assert.equal(multiplier.b, 1);
});

import { Color } from 'three';

const DEFAULT_TINT_MULTIPLIER = new Color(1, 1, 1);
const EPSILON = 1e-6;

function isColor(value) {
  return Boolean(value && typeof value === 'object' && value.isColor === true);
}

function computeMultiplierComponent(desired, base, strength) {
  const safeBase = Math.max(base, EPSILON);
  const numerator = desired / safeBase - (1 - strength);
  const result = numerator / strength;
  if (!Number.isFinite(result)) {
    return 1;
  }
  return Math.max(0, result);
}

function deriveNeutralBaseColor(type, palette, paletteColors) {
  const paletteHex = palette?.[type];
  const paletteTint = paletteColors?.[type];

  if (typeof paletteHex === 'string' && isColor(paletteTint)) {
    try {
      const tintedColor = new Color(paletteHex);
      return new Color(
        paletteTint.r === 0 ? tintedColor.r : tintedColor.r / Math.max(paletteTint.r, EPSILON),
        paletteTint.g === 0 ? tintedColor.g : tintedColor.g / Math.max(paletteTint.g, EPSILON),
        paletteTint.b === 0 ? tintedColor.b : tintedColor.b / Math.max(paletteTint.b, EPSILON),
      );
    } catch (error) {
      console.warn(
        'Failed to derive neutral base colour for palette entry',
        type,
        paletteHex,
        error,
      );
    }
  }

  return DEFAULT_TINT_MULTIPLIER.clone();
}

export function resolveBiomeTintMultiplier({
  desiredHex,
  type,
  palette,
  paletteColors,
  blockMaterial,
}) {
  if (typeof desiredHex !== 'string') {
    return null;
  }

  let desiredColor;
  try {
    desiredColor = new Color(desiredHex);
  } catch (error) {
    console.warn('Invalid desired biome tint override provided:', desiredHex, error);
    return null;
  }

  const strength =
    blockMaterial?.userData?.biomeTintUniforms?.biomeTintStrength?.value ?? 1;

  if (!Number.isFinite(strength) || strength <= 0) {
    return DEFAULT_TINT_MULTIPLIER.clone();
  }

  const baseColor = deriveNeutralBaseColor(type, palette, paletteColors);

  const multiplier = new Color(
    computeMultiplierComponent(desiredColor.r, baseColor.r, strength),
    computeMultiplierComponent(desiredColor.g, baseColor.g, strength),
    computeMultiplierComponent(desiredColor.b, baseColor.b, strength),
  );

  return multiplier;
}

export { DEFAULT_TINT_MULTIPLIER };

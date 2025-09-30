export const weatherRainAdvancedFragmentShader = /* glsl */ `
precision mediump float;

uniform float uWindTilt;
uniform float uStreakNoise;
uniform float uHighlightWidth;
uniform float uRippleScale;
uniform float uDropDensity;
uniform float uTimerBias;
uniform float uTime;

varying vec4 vColor;
varying vec2 vLocalUv;
varying float vNormalizedAge;

const vec3 HASH_SCALE3 = vec3(0.1031, 0.1030, 0.0973);

vec3 hash33(vec3 p3) {
  p3 = fract(p3 * HASH_SCALE3);
  p3 += dot(p3, p3.yxz + 19.19);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

float bias(float s, float b) {
  float safeBias = max(b, 0.0001);
  return s / ((((1.0 / safeBias) - 2.0) * (1.0 - s)) + 1.0);
}

float vorRain(vec3 p, float seed, float dropDensity, float timerBias) {
  float rippleScale = max(uRippleScale, 0.0001);
  vec3 sample = vec3(p.x, p.z, p.y);
  sample /= rippleScale;
  vec3 uv2 = sample;
  vec3 cell = floor(sample);
  float density = clamp(dropDensity, 0.0, 2.5);
  float speed = mix(0.55, 1.45, clamp(density * 0.4, 0.0, 1.0));
  float timeValue = uTime * speed + timerBias * 2.1 + seed * 0.17;
  float accum = 0.0;

  for (int j = -1; j <= 1; ++j) {
    for (int k = -1; k <= 1; ++k) {
      vec3 offset = vec3(float(j), float(k), 0.0);
      vec3 s1 = hash33(cell + offset + vec3(127.43 + seed));
      vec2 timerState = floor(vec2(s1.x) + timeValue);
      vec2 dropHash = hash33(
        cell + offset + vec3(timerState.x, timerState.y, seed)
      ).xz;
      s1 = fract(s1 + timeValue);

      float opacity = bias(1.0 - s1.x, 0.21 + clamp(timerBias, -0.5, 1.5) * 0.35);
      float fade = bias(s1.x, 0.62);
      float size = mix(4.0, 1.0, fade);
      float size2 = mix(0.005, 2.0, fade);

      vec2 rippleDelta = (cell.xy + dropHash) - (uv2.xy - offset.xy);
      float ripple = length(rippleDelta) * size;
      ripple = 1.0 - ripple;
      ripple *= size2;
      ripple = clamp(ripple, 0.0, 1.2);
      ripple = mix(ripple * ripple, ripple, 0.5);
      ripple = smoothstep(0.0, 1.0, ripple);
      ripple *= opacity;

      accum = 1.0 - ((1.0 - accum) * (1.0 - ripple));
    }
  }

  return accum * 0.1;
}

float dfRipples(vec3 p, float dropDensity, float timerBias) {
  float layers = clamp(dropDensity * 3.0, 1.0, 4.0);
  float total = 0.0;

  for (int i = 0; i < 4; ++i) {
    float active = step(float(i), layers - 0.001);
    total += vorRain(p, float(i) + 1.0, dropDensity, timerBias) * active;
  }

  return (p.y + 1.0) - total;
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

float streakNoise(vec2 uv, float travel) {
  vec2 cell = floor(vec2(uv.x * 18.0, uv.y * 42.0 + travel));
  float base = hash(cell + travel);
  float head = fract(uv.y * 18.0 + base * 6.0 + travel * 0.5);
  float sparkle = smoothstep(0.65, 0.1, head);
  return mix(base, sparkle, 0.75);
}

float streakMask(float offset, float highlightWidth) {
  float core = smoothstep(0.85, 0.0, abs(offset));
  float highlight = exp(-pow(offset / max(highlightWidth, 0.02), 2.0));
  return clamp(core + highlight * 1.4, 0.0, 1.6);
}

void main() {
  if (vColor.a <= 0.0001) {
    discard;
  }

  vec2 uv = vLocalUv;
  float tilt = uWindTilt;
  float slantedX = (uv.x - 0.5) + tilt * (1.0 - uv.y);
  float highlightWidth = max(uHighlightWidth, 0.025);
  float travel = vNormalizedAge * 12.0;
  float noiseSample = streakNoise(uv, travel + uStreakNoise * 4.0);

  float streak = streakMask(slantedX, highlightWidth);
  float taper = smoothstep(1.0, 0.25, uv.y);
  float shimmer = smoothstep(0.15, 0.95, noiseSample + streak * uStreakNoise);
  float body = clamp(streak * (0.6 + noiseSample * 0.5), 0.0, 1.2);

  vec3 ripplePoint = vec3(uv.x * 2.0 - 1.0, uTimerBias, uv.y * 2.0 - 1.0);
  float rippleHeight = dfRipples(ripplePoint, uDropDensity, uTimerBias);
  float rippleStrength = clamp(1.0 - rippleHeight * 4.0, 0.0, 1.0);
  float rippleHighlight = smoothstep(0.1, 0.85, rippleStrength);

  float brightness = clamp(body * 0.9 + shimmer * 0.75 + rippleHighlight * 0.6, 0.0, 1.95);
  vec3 color = vColor.rgb * (0.6 + brightness);
  float alpha = vColor.a * clamp(body * 0.85 + shimmer * 0.45, 0.0, 1.0) * taper;
  alpha *= mix(0.85, 1.25, rippleHighlight);

  gl_FragColor = vec4(color, alpha);
}
`;

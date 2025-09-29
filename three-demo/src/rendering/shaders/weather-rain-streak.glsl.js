export const weatherRainStreakFragmentShader = /* glsl */ `
precision mediump float;

uniform float uWindTilt;
uniform float uStreakNoise;
uniform float uHighlightWidth;

varying vec4 vColor;
varying vec2 vLocalUv;
varying float vNormalizedAge;

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

  float brightness = clamp(body * 0.9 + shimmer * 0.75, 0.0, 1.75);
  vec3 color = vColor.rgb * (0.6 + brightness);
  float alpha = vColor.a * clamp(body * 0.85 + shimmer * 0.45, 0.0, 1.0) * taper;

  gl_FragColor = vec4(color, alpha);
}
`;

export const gpuParticleVertexShader = /* glsl */ `
precision mediump float;

attribute vec3 position;

attribute vec3 aOrigin;
attribute vec3 aVelocity;
attribute vec4 aColor;
attribute vec2 aSize;
attribute vec2 aLifetime;

uniform float uTime;
uniform vec3 uGravity;
uniform float uDrag;
uniform vec2 uFadeInOut;

uniform vec4 uColorStops[8];
uniform int uColorStopCount;

uniform vec2 uSizeStops[8];
uniform int uSizeStopCount;

varying vec4 vColor;
varying vec2 vLocalUv;
varying float vNormalizedAge;

vec3 integrateMotion(vec3 origin, vec3 velocity, vec3 gravity, float drag, float age) {
  vec3 displacement;
  if (drag <= 0.00001) {
    displacement = velocity * age;
  } else {
    float dragFactor = exp(-drag * age);
    displacement = velocity * (1.0 - dragFactor) / drag;
  }
  vec3 gravityTerm = 0.5 * gravity * age * age;
  return origin + displacement + gravityTerm;
}

vec3 sampleColorRamp(float t) {
  if (uColorStopCount == 0) {
    return vec3(1.0);
  }
  vec4 previous = uColorStops[0];
  for (int i = 1; i < 8; i++) {
    if (i >= uColorStopCount) {
      break;
    }
    vec4 next = uColorStops[i];
    if (t <= next.w) {
      float span = max(next.w - previous.w, 0.0001);
      float f = clamp((t - previous.w) / span, 0.0, 1.0);
      return mix(previous.rgb, next.rgb, f);
    }
    previous = next;
  }
  return uColorStops[uColorStopCount - 1].rgb;
}

float sampleSizeCurve(float t) {
  if (uSizeStopCount == 0) {
    return 1.0;
  }
  vec2 previous = uSizeStops[0];
  for (int i = 1; i < 8; i++) {
    if (i >= uSizeStopCount) {
      break;
    }
    vec2 next = uSizeStops[i];
    if (t <= next.x) {
      float span = max(next.x - previous.x, 0.0001);
      float f = clamp((t - previous.x) / span, 0.0, 1.0);
      return mix(previous.y, next.y, f);
    }
    previous = next;
  }
  return uSizeStops[uSizeStopCount - 1].y;
}

void main() {
  float spawnTime = aLifetime.x;
  float lifetime = max(aLifetime.y, 0.0001);
  float age = max(uTime - spawnTime, 0.0);
  float normalizedAge = clamp(age / lifetime, 0.0, 1.0);
  vNormalizedAge = normalizedAge;

  vec3 center = integrateMotion(aOrigin, aVelocity, uGravity, uDrag, age);

  float sizeScale = sampleSizeCurve(normalizedAge);
  float particleWidth = aSize.x * sizeScale;
  float particleHeight = aSize.y * sizeScale;

  float fadeIn = smoothstep(0.0, max(uFadeInOut.x, 0.0001), normalizedAge);
  float fadeOut = 1.0 - smoothstep(1.0 - max(uFadeInOut.y, 0.0001), 1.0, normalizedAge);
  float alpha = aColor.a * fadeIn * fadeOut;

  vec3 rampColor = sampleColorRamp(normalizedAge);
  vColor = vec4(rampColor * aColor.rgb, alpha);
  vLocalUv = position.xy + 0.5;

  vec3 billboardRight = normalize(vec3(modelViewMatrix[0][0], modelViewMatrix[1][0], modelViewMatrix[2][0]));
  vec3 billboardUp = normalize(vec3(modelViewMatrix[0][1], modelViewMatrix[1][1], modelViewMatrix[2][1]));

  vec3 offset = billboardRight * position.x * particleWidth + billboardUp * position.y * particleHeight;

  vec4 mvCenter = modelViewMatrix * vec4(center, 1.0);
  vec3 mvPosition = mvCenter.xyz + offset;

  gl_Position = projectionMatrix * vec4(mvPosition, 1.0);
}
`;

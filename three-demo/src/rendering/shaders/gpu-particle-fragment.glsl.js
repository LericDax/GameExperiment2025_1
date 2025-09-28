export const gpuParticleFragmentShader = /* glsl */ `
precision mediump float;

varying vec4 vColor;

void main() {
  if (vColor.a <= 0.0001) {
    discard;
  }
  gl_FragColor = vColor;
}
`;

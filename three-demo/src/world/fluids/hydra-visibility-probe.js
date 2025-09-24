import {
  clearFluidMaterialFallback,
  forceFluidMaterialFallback,
  getFluidMaterial,
  isFluidFallbackActive,
} from './fluid-registry.js';

function buildProbeGeometry(THREE) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array([
    -0.5,
    0,
    -0.5,
    0.5,
    0,
    -0.5,
    0.5,
    0,
    0.5,
    -0.5,
    0,
    -0.5,
    0.5,
    0,
    0.5,
    -0.5,
    0,
    0.5,
  ]);
  const normals = new Float32Array(new Array(6).fill([0, 1, 0]).flat());
  const uvs = new Float32Array([
    0,
    0,
    1,
    0,
    1,
    1,
    0,
    0,
    1,
    1,
    0,
    1,
  ]);
  const colors = new Float32Array(new Array(6).fill([0.24, 0.52, 0.82]).flat());
  const surfaceTypes = new Float32Array(new Array(6).fill(0));
  const flowDirections = new Float32Array(new Array(6).fill([0.6, 0.2]).flat());
  const flowStrengths = new Float32Array(new Array(6).fill(0.35));
  const edgeFoam = new Float32Array(new Array(6).fill(0.2));
  const depths = new Float32Array(new Array(6).fill(4.5));
  const shorelines = new Float32Array(new Array(6).fill(0.15));

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('surfaceType', new THREE.Float32BufferAttribute(surfaceTypes, 1));
  geometry.setAttribute('flowDirection', new THREE.Float32BufferAttribute(flowDirections, 2));
  geometry.setAttribute('flowStrength', new THREE.Float32BufferAttribute(flowStrengths, 1));
  geometry.setAttribute('edgeFoam', new THREE.Float32BufferAttribute(edgeFoam, 1));
  geometry.setAttribute('depth', new THREE.Float32BufferAttribute(depths, 1));
  geometry.setAttribute('shoreline', new THREE.Float32BufferAttribute(shorelines, 1));
  return geometry;
}

function summarizeMetrics({ brightness, alpha }) {
  const parts = [];
  if (typeof brightness === 'number') {
    parts.push(`brightness=${brightness.toFixed(3)}`);
  }
  if (typeof alpha === 'number') {
    parts.push(`alpha=${alpha.toFixed(3)}`);
  }
  return parts.join(', ');
}

export function runHydraVisibilityProbe({ THREE, renderer, onFallback } = {}) {
  if (!THREE || !renderer) {
    return { ok: false, skipped: true, reason: 'missing-three-or-renderer' };
  }
  if (typeof renderer.readRenderTargetPixels !== 'function') {
    return { ok: false, skipped: true, reason: 'no-read-render-target' };
  }
  if (isFluidFallbackActive('water')) {
    return { ok: false, skipped: true, reason: 'fallback-already-active' };
  }

  let baseMaterial;
  try {
    baseMaterial = getFluidMaterial('water');
  } catch (error) {
    const state = forceFluidMaterialFallback('water', {
      reason: 'Hydra material unavailable during probe',
      metrics: { error: error?.message ?? 'unknown' },
    });
    onFallback?.({ reason: state.reason, metrics: state.metrics });
    return { ok: false, error };
  }

  const probeMaterial = baseMaterial.clone();
  if (probeMaterial.uniforms?.uTime && typeof probeMaterial.uniforms.uTime.value === 'number') {
    probeMaterial.uniforms.uTime.value += 1.7;
    probeMaterial.uniformsNeedUpdate = true;
  }

  const geometry = buildProbeGeometry(THREE);
  const mesh = new THREE.Mesh(geometry, probeMaterial);
  const scene = new THREE.Scene();
  scene.add(mesh);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
  camera.position.set(0.2, 0.65, 1.2);
  camera.lookAt(new THREE.Vector3(0, 0, 0));

  const size = 32;
  const renderTarget = new THREE.WebGLRenderTarget(size, size, {
    depthBuffer: false,
    stencilBuffer: false,
  });

  const prevAutoClear = renderer.autoClear;
  const prevRenderTarget = renderer.getRenderTarget();
  const prevClearColor = renderer.getClearColor(new THREE.Color());
  const prevClearAlpha = renderer.getClearAlpha();

  renderer.autoClear = true;
  renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(renderTarget);

  let probeError = null;
  try {
    renderer.render(scene, camera);
  } catch (error) {
    probeError = error;
  }

  const pixel = new Uint8Array(4);
  if (!probeError) {
    try {
      renderer.readRenderTargetPixels(renderTarget, size / 2, size / 2, 1, 1, pixel);
    } catch (error) {
      probeError = error;
    }
  }

  renderer.setRenderTarget(prevRenderTarget);
  renderer.setClearColor(prevClearColor, prevClearAlpha);
  renderer.autoClear = prevAutoClear;

  renderTarget.dispose();
  geometry.dispose();
  probeMaterial.dispose();
  scene.remove(mesh);

  if (probeError) {
    const state = forceFluidMaterialFallback('water', {
      reason: 'Hydra probe failed to render',
      metrics: { error: probeError?.message ?? 'unknown' },
    });
    onFallback?.({ reason: state.reason, metrics: state.metrics });
    return { ok: false, error: probeError };
  }

  const brightness = (pixel[0] + pixel[1] + pixel[2]) / (3 * 255);
  const alpha = pixel[3] / 255;

  if (alpha < 0.05 || brightness < 0.05) {
    const metrics = { brightness, alpha };
    const state = forceFluidMaterialFallback('water', {
      reason: `Hydra probe detected near-zero output (${summarizeMetrics(metrics)})`,
      metrics,
    });
    onFallback?.({ reason: state.reason, metrics: state.metrics });
    return { ok: false, metrics };
  }

  clearFluidMaterialFallback('water');
  return { ok: true, metrics: { brightness, alpha } };
}

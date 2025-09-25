import { createMeshMorpher } from '../../rendering/mesh-morpher.js';
import { SURFACE_ROLES } from './fluid-geometry.js';

const WAVE_SETTINGS = {
  mainAmplitude: 0.18,
  baseFrequency: 0.45,
  baseSpeed: 0.9,
  crossFrequency: 0.16,
  crossSpeed: 1.35,
  flowFrequency: 0.52,
  flowSpeed: 1.4,
  rippleAmplitude: 0.05,
  rippleFrequency: 1.3,
  rippleSpeed: 1.65,
  rippleSkew: 0.78,
  rippleDrift: 1.12,
  detailAmplitude: 0.035,
  detailFrequency: 2.1,
  detailSpeed: 1.05,
};

const EDGE_TINT_SETTINGS = {
  saturationBoost: 0.22,
  minOpacity: 0.9,
};

const getWavePadding = () => {
  const { mainAmplitude, rippleAmplitude, detailAmplitude } = WAVE_SETTINGS;
  return (mainAmplitude + rippleAmplitude + detailAmplitude) * 1.2;
};

function sampleWave({ x, z, time, flowX, flowZ, flowStrength }) {
  const {
    mainAmplitude,
    baseFrequency,
    baseSpeed,
    crossFrequency,
    crossSpeed,
    flowFrequency,
    flowSpeed,
    rippleAmplitude,
    rippleFrequency,
    rippleSpeed,
    rippleSkew,
    rippleDrift,
    detailAmplitude,
    detailFrequency,
    detailSpeed,
  } = WAVE_SETTINGS;

  const primaryPhase = x * baseFrequency + time * baseSpeed;
  const secondaryPhase = z * (baseFrequency * 0.85) + time * (baseSpeed * 0.92);
  const crossPhase = (x + z) * crossFrequency + time * crossSpeed;

  let value = 0;
  let derivativeX = 0;
  let derivativeZ = 0;

  value += mainAmplitude * 0.6 * Math.sin(primaryPhase);
  derivativeX += mainAmplitude * 0.6 * Math.cos(primaryPhase) * baseFrequency;

  value += mainAmplitude * 0.4 * Math.cos(secondaryPhase);
  derivativeZ +=
    mainAmplitude * -0.4 * Math.sin(secondaryPhase) * (baseFrequency * 0.85);

  value += mainAmplitude * 0.35 * Math.sin(crossPhase);
  const crossDerivative = Math.cos(crossPhase) * crossFrequency * 0.35 * mainAmplitude;
  derivativeX += crossDerivative;
  derivativeZ += crossDerivative;

  if (flowStrength > 0.001) {
    const flowPhase = (flowX * x + flowZ * z) * flowFrequency + time * flowSpeed;
    const flowAmplitude = mainAmplitude * flowStrength * 0.5;
    value += flowAmplitude * Math.sin(flowPhase);
    const flowDerivative = Math.cos(flowPhase) * flowFrequency * flowAmplitude;
    derivativeX += flowDerivative * flowX;
    derivativeZ += flowDerivative * flowZ;
  }

  if (rippleAmplitude > 0) {
    const ripplePhaseX = x * rippleFrequency + time * rippleSpeed;
    const ripplePhaseZ = z * (rippleFrequency * rippleSkew) + time * (rippleSpeed * rippleDrift);
    const rippleValue = Math.sin(ripplePhaseX) * Math.cos(ripplePhaseZ);
    value += rippleAmplitude * rippleValue;

    derivativeX += rippleAmplitude * Math.cos(ripplePhaseX) * rippleFrequency * Math.cos(ripplePhaseZ);
    derivativeZ +=
      rippleAmplitude * Math.sin(ripplePhaseX) * -Math.sin(ripplePhaseZ) * (rippleFrequency * rippleSkew);
  }

  if (detailAmplitude > 0) {
    const detailPhase = (x - z) * detailFrequency + time * detailSpeed;
    const detailCos = Math.cos(detailPhase);
    value += detailAmplitude * Math.sin(detailPhase);
    derivativeX += detailAmplitude * detailCos * detailFrequency;
    derivativeZ += detailAmplitude * detailCos * -detailFrequency;
  }

  return {
    value,
    derivativeX,
    derivativeZ,
  };
}

export function createHydraWaterMaterial({ THREE }) {
  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#1f5fbf'),
    roughness: 0.38,
    metalness: 0.06,
    transmission: 0,
    thickness: 0,
    attenuationDistance: 0,
    transparent: true,
    opacity: 0.78,
    ior: 1.333,
    reflectivity: 0.2,
    clearcoat: 0.12,
    clearcoatRoughness: 0.68,
    envMapIntensity: 0.5,
    vertexColors: true,
  });

  material.side = THREE.DoubleSide;
  material.depthWrite = false;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.edgeSaturationBoost = { value: EDGE_TINT_SETTINGS.saturationBoost };
    shader.uniforms.edgeMinOpacity = { value: EDGE_TINT_SETTINGS.minOpacity };

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>\nattribute float surfaceType;\nvarying float vSurfaceType;`,
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\nvSurfaceType = surfaceType;`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>\nvarying float vSurfaceType;\nuniform float edgeSaturationBoost;\nuniform float edgeMinOpacity;`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>\nfloat edgeMask = smoothstep(0.5, 1.5, vSurfaceType);\nfloat tintMultiplier = 1.0 + edgeSaturationBoost * edgeMask;\ndiffuseColor.rgb = min(diffuseColor.rgb * tintMultiplier, vec3(1.0));\ndiffuseColor.a = mix(diffuseColor.a, max(diffuseColor.a, edgeMinOpacity), edgeMask);`,
    );
  };

  material.customProgramCacheKey = () =>
    `hydra-water-edge-tint-${EDGE_TINT_SETTINGS.saturationBoost}-${EDGE_TINT_SETTINGS.minOpacity}`;

  const morpher = createMeshMorpher({ THREE });
  const cleanupHandlers = new Map();
  let elapsedTime = 0;

  const ensureSurfaceBounds = (mesh) => {
    const geometry = mesh.geometry;
    if (!geometry) {
      return;
    }
    if (!geometry.boundingBox) {
      geometry.computeBoundingBox();
    }
    if (!geometry.boundingSphere) {
      geometry.computeBoundingSphere();
    }
    if (geometry.boundingBox) {
      const padding = getWavePadding();
      geometry.boundingBox.max.y += padding;
      geometry.boundingBox.min.y -= padding;
    }
    if (geometry.boundingSphere) {
      geometry.boundingSphere.radius += getWavePadding();
    }
  };

  const registerSurface = (mesh) => {
    if (morpher.hasMesh(mesh)) {
      return;
    }

    morpher.registerMesh(mesh, { attributes: ['position', 'normal'] });

    const effect = ({ mesh: effectMesh, attributes, elapsedTime: time }) => {
      const positionData = attributes.find((entry) => entry.name === 'position');
      const normalData = attributes.find((entry) => entry.name === 'normal');
      if (!positionData || !normalData) {
        return;
      }

      const positionAttribute = positionData.attribute;
      const normalAttribute = normalData.attribute;
      const basePositions = positionData.base;
      const baseNormals = normalData.base;
      const flowDir = effectMesh.geometry.getAttribute('flowDirection');
      const flowStrength = effectMesh.geometry.getAttribute('flowStrength');
      const surfaceRole = effectMesh.geometry.getAttribute('surfaceRole');

      const vertexCount = positionAttribute.count;
      for (let index = 0; index < vertexCount; index += 1) {
        const baseOffset = index * 3;
        const baseNormalY = baseNormals[baseOffset + 1];

        const x = basePositions[baseOffset];
        const y = basePositions[baseOffset + 1];
        const z = basePositions[baseOffset + 2];

        const flowX = flowDir ? flowDir.array[index * 2] : 0;
        const flowZ = flowDir ? flowDir.array[index * 2 + 1] : 0;
        const flowAmount = flowStrength ? flowStrength.array[index] : 0;

        const { value, derivativeX, derivativeZ } = sampleWave({
          x,
          z,
          time,
          flowX,
          flowZ,
          flowStrength: flowAmount,
        });

        const role = surfaceRole
          ? surfaceRole.array[index]
          : baseNormalY >= 0.5
            ? SURFACE_ROLES.SURFACE
            : SURFACE_ROLES.EDGE_BOTTOM;

        if (role === SURFACE_ROLES.EDGE_BOTTOM) {
          continue;
        }

        positionAttribute.array[baseOffset + 1] = y + value;

        if (role === SURFACE_ROLES.SURFACE) {
          const normalX = -derivativeX;
          const normalY = 1;
          const normalZ = -derivativeZ;
          const normalization = 1 / Math.hypot(normalX, normalY, normalZ);
          normalAttribute.array[baseOffset] = normalX * normalization;
          normalAttribute.array[baseOffset + 1] = normalY * normalization;
          normalAttribute.array[baseOffset + 2] = normalZ * normalization;
        } else {
          normalAttribute.array[baseOffset] = baseNormals[baseOffset];
          normalAttribute.array[baseOffset + 1] = baseNormals[baseOffset + 1];
          normalAttribute.array[baseOffset + 2] = baseNormals[baseOffset + 2];
        }
      }
    };

    const removeEffect = morpher.addEffect(mesh, (context) => {
      effect({ ...context, elapsedTime });
    });

    cleanupHandlers.set(mesh, () => {
      removeEffect();
      morpher.unregisterMesh(mesh);
    });

    ensureSurfaceBounds(mesh);
  };

  const disposeSurface = (mesh) => {
    const cleanup = cleanupHandlers.get(mesh);
    if (cleanup) {
      cleanup();
      cleanupHandlers.delete(mesh);
    }
  };

  material.userData.hydraWaterVersion = 'layered-wave-undulation-v1';

  return {
    material,
    update: (delta) => {
      elapsedTime += delta;
      morpher.update(delta, { elapsedTime });
    },
    onSurfaceCreated: registerSurface,
    onSurfaceDisposed: disposeSurface,
  };
}

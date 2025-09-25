import { createMeshMorpher } from '../../rendering/mesh-morpher.js';

import { SURFACE_ROLES } from './fluid-geometry.js';


const WAVE_SETTINGS = {
  amplitude: 0.18,
  baseFrequency: 0.45,
  baseSpeed: 0.9,
  crossFrequency: 0.16,
  crossSpeed: 1.35,
  flowFrequency: 0.52,
  flowSpeed: 1.4,
};

function sampleWave({ x, z, time, flowX, flowZ, flowStrength }) {
  const {
    amplitude,
    baseFrequency,
    baseSpeed,
    crossFrequency,
    crossSpeed,
    flowFrequency,
    flowSpeed,
  } = WAVE_SETTINGS;

  const primaryPhase = x * baseFrequency + time * baseSpeed;
  const secondaryPhase = z * (baseFrequency * 0.85) + time * (baseSpeed * 0.92);
  const crossPhase = (x + z) * crossFrequency + time * crossSpeed;

  let value = 0;
  let derivativeX = 0;
  let derivativeZ = 0;

  value += 0.6 * Math.sin(primaryPhase);
  derivativeX += 0.6 * Math.cos(primaryPhase) * baseFrequency;

  value += 0.4 * Math.cos(secondaryPhase);
  derivativeZ += -0.4 * Math.sin(secondaryPhase) * (baseFrequency * 0.85);

  value += 0.35 * Math.sin(crossPhase);
  const crossDerivative = Math.cos(crossPhase) * crossFrequency * 0.35;
  derivativeX += crossDerivative;
  derivativeZ += crossDerivative;

  if (flowStrength > 0.001) {
    const flowPhase = (flowX * x + flowZ * z) * flowFrequency + time * flowSpeed;
    value += flowStrength * 0.5 * Math.sin(flowPhase);
    const flowDerivative = Math.cos(flowPhase) * flowFrequency * 0.5 * flowStrength;
    derivativeX += flowDerivative * flowX;
    derivativeZ += flowDerivative * flowZ;
  }

  return {
    value: value * amplitude,
    derivativeX: derivativeX * amplitude,
    derivativeZ: derivativeZ * amplitude,
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
      const padding = WAVE_SETTINGS.amplitude * 1.2;
      geometry.boundingBox.max.y += padding;
      geometry.boundingBox.min.y -= padding;
    }
    if (geometry.boundingSphere) {
      geometry.boundingSphere.radius += WAVE_SETTINGS.amplitude * 1.2;
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

  material.userData.hydraWaterVersion = 'simple-blue-waves-v1';

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

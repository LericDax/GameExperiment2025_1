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


  material.userData.hydraWaterVersion = 'simple-blue-v1';


  return { material, update: null };
}

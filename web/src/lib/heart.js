// The 3D heart: the classic parametric heart curve, extruded with a deep,
// many-segment bevel so it comes out soft and puffy, like a glossy 3D icon.
import * as THREE from 'three';

let cached = null;

export function heartGeometry() {
  if (cached) return cached;
  const pts = [];
  const N = 160;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push(new THREE.Vector2(x, y));
  }
  const shape = new THREE.Shape(pts);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 3.2,
    bevelEnabled: true,
    bevelThickness: 4.2,
    bevelSize: 3.1,
    bevelSegments: 18,
    curveSegments: 4,
  });
  geo.center();
  geo.scale(1 / 17, 1 / 17, 1 / 17);       // about 2 units wide
  geo.computeVertexNormals();
  cached = geo;
  return geo;
}

export { lubDub } from './heartPath.js';

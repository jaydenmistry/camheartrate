// The wall of hearts in 3D: one glossy heart per connected camera, drawn as a
// single instanced mesh. Each beats (lub-dub) at the rate its camera measures,
// from a random phase, so the room is out of step as real hearts are; grey
// while still measuring. Hearts grow in where they join, shrink away where
// they leave, and glide to their new places when the grid reflows.
// The camera is orthographic with 1 unit = 1 CSS pixel, so the HTML labels
// (positioned by the same layout) line up underneath.
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { heartGeometry, lubDub } from '../lib/heart.js';
import { prefersReducedMotion } from '../lib/theme.js';

const MAX = 512;
const RED = new THREE.Color('#ff1d4e');
const GREY_LIGHT = new THREE.Color('#c9c9d2');
const GREY_DARK = new THREE.Color('#4a4a55');
const PINK = new THREE.Color('#ff6b8b');
const damp = THREE.MathUtils.damp;

function Hearts({ items, layout, dark, reduce }) {
  const mesh = useRef();
  const geo = useMemo(heartGeometry, []);
  const live = useRef(new Map());          // id -> per-heart animation state
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const tmp = useMemo(() => new THREE.Color(), []);

  // Instance colours must exist before the first draw, or the material ignores them.
  useLayoutEffect(() => {
    for (let i = 0; i < MAX; i++) mesh.current.setColorAt(i, RED);
    mesh.current.count = 0;
  }, []);

  useFrame((state, dt) => {
    const m = live.current, t = state.clock.elapsedTime;
    const seen = new Set();
    items.forEach((it, i) => {
      seen.add(it.id);
      const [tx, ty] = layout.at(i);
      let h = m.get(it.id);
      if (!h) {
        h = { phase: Math.random(), x: tx, y: ty, a: 0, col: new THREE.Color(it.bpm === null ? GREY_LIGHT : RED), wob: Math.random() * 6 };
        m.set(it.id, h);
      }
      h.tx = tx; h.ty = ty; h.bpm = it.bpm; h.leaving = false;
    });
    for (const [id, h] of m) if (!seen.has(id)) h.leaving = true;

    let n = 0;
    const grey = dark ? GREY_DARK : GREY_LIGHT;
    for (const [id, h] of m) {
      h.a = damp(h.a, h.leaving ? 0 : 1, h.leaving ? 10 : 7, dt);
      if (h.leaving && h.a < 0.02) { m.delete(id); continue; }
      if (n >= MAX) break;
      h.x = damp(h.x, h.tx, 6, dt);
      h.y = damp(h.y, h.ty, 6, dt);
      let b = 0;
      if (h.bpm !== null && h.bpm !== undefined) { h.phase = (h.phase + dt * h.bpm / 60) % 1; b = lubDub(h.phase); }
      // Reduced motion: the same rhythm as a brightening, with nothing moving.
      const beat = reduce ? 1 : 0.86 + 0.2 * b;
      dummy.position.set(h.x, h.y, 0);
      dummy.rotation.set(0.12, reduce ? 0 : Math.sin(t * 0.6 + h.wob) * 0.38, 0);
      dummy.scale.setScalar(layout.size * 0.42 * h.a * beat);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(n, dummy.matrix);
      h.col.lerp(h.bpm === null || h.bpm === undefined ? grey : RED, 1 - Math.exp(-dt * 4));
      tmp.copy(h.col);
      if (reduce && h.bpm != null) tmp.multiplyScalar(0.7 + 0.45 * b);
      else if (b) tmp.lerp(PINK, b * 0.25);
      mesh.current.setColorAt(n, tmp);
      n++;
    }
    mesh.current.count = n;
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[geo, undefined, MAX]} frustumCulled={false}>
      <meshPhysicalMaterial color="#ffffff" roughness={0.22} metalness={0.02} clearcoat={1} clearcoatRoughness={0.06}
                            sheen={0.7} sheenRoughness={0.35} sheenColor="#ffc2d0" />
    </instancedMesh>
  );
}

export default function HeartWall3D({ items, layout, theme }) {
  const dark = theme === 'dark';
  const reduce = prefersReducedMotion();
  return (
    <Canvas className="wall-canvas" orthographic dpr={[1, 2]}
            camera={{ position: [0, 0, 400], zoom: 1, near: 1, far: 2000 }}
            gl={{ antialias: true, alpha: true }} aria-hidden="true">
      <ambientLight intensity={dark ? 0.35 : 0.6} />
      <directionalLight position={[200, 300, 400]} intensity={1.8} />
      <pointLight position={[-300, -200, 200]} color="#ff2d55" intensity={dark ? 3 : 1} decay={0} />
      <Environment resolution={128} frames={1}>
        <group rotation={[-Math.PI / 3, 0, 1]}>
          <Lightformer form="circle" intensity={4} rotation-x={Math.PI / 2} position={[0, 5, -9]} scale={2} />
          <Lightformer form="circle" intensity={2} rotation-y={Math.PI / 2} position={[-5, 1, -1]} scale={2} />
          <Lightformer form="circle" intensity={2} rotation-y={-Math.PI / 2} position={[10, 1, 0]} scale={8} />
          <Lightformer form="ring" color="#ff4d7a" intensity={5} onUpdate={(self) => self.lookAt(0, 0, 0)}
                       position={[10, 10, 0]} scale={10} />
        </group>
      </Environment>
      <Hearts items={items} layout={layout} dark={dark} reduce={reduce} />
    </Canvas>
  );
}

// The 3D heart (React Three Fiber). It beats at the measured rate (lub-dub),
// with a ring of light leaving it on every beat, and leans towards the pointer.
// It reads the beat straight from the controller every frame, so React never
// re-renders for it. The beat stops whenever the controller says nothing on
// screen may beat (screen light on, magnifier, pulse check, reduced motion);
// then it only drifts slowly, well below any heart rate.
import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Float, Lightformer, PerformanceMonitor, Sparkles } from '@react-three/drei';
import { heartGeometry, lubDub } from '../lib/heart.js';
import { prefersReducedMotion } from '../lib/theme.js';
import { pulse } from './controller.js';

// The pointer across the whole window, -1..1.
const pointer = { x: 0, y: 0 };
if (typeof window !== 'undefined') {
  window.addEventListener('pointermove', (e) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });
}

// A soft round glow, drawn once into a texture: a cheap bloom.
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const LIVE = new THREE.Color('#ff1d4e');
const IDLE_DARK = new THREE.Color('#6b2a3b');
const IDLE_LIGHT = new THREE.Color('#f1a7b9');
const damp = THREE.MathUtils.damp;

function Heart({ dark, reduce }) {
  const group = useRef(), body = useRef(), mat = useRef(), ring = useRef(), ringMat = useRef(), glowMat = useRef();
  const geo = useMemo(heartGeometry, []);
  const glow = useMemo(glowTexture, []);
  const viewport = useThree((s) => s.viewport);
  const wide = viewport.aspect > 1.05;
  const x = wide ? viewport.width * 0.21 : 0;
  const y = wide ? 0.05 : 0.3;
  const size = Math.min(0.9, (viewport.height / 3.9) * (wide ? 1 : 0.86));

  useFrame((state, dt) => {
    const k = pulse.active ? lubDub(pulse.phase) : 0;
    const t = state.clock.elapsedTime;
    body.current.scale.setScalar(1 + 0.085 * k);
    const target = pulse.live ? LIVE : dark ? IDLE_DARK : IDLE_LIGHT;
    mat.current.color.lerp(target, 1 - Math.exp(-dt * 3));
    mat.current.emissiveIntensity = damp(mat.current.emissiveIntensity, (dark ? 0.18 : 0.04) + k * (dark ? 1.6 : 0.25), 18, dt);
    if (!reduce) {
      group.current.rotation.y = damp(group.current.rotation.y, pointer.x * 0.45 + Math.sin(t * 0.35) * 0.22, 3, dt);
      group.current.rotation.x = damp(group.current.rotation.x, pointer.y * 0.28, 3, dt);
    }
    // The ring of light: leaves the heart on each beat and fades as it grows.
    const p = pulse.active ? pulse.phase : 1;
    ring.current.scale.setScalar(1 + p * 1.5);
    ringMat.current.opacity = pulse.active ? (1 - p) ** 2.2 * (dark ? 0.75 : 0.45) : 0;
    glowMat.current.opacity = damp(glowMat.current.opacity, (pulse.live ? (dark ? 0.32 : 0.12) : 0.06) + k * (dark ? 0.55 : 0.12), 14, dt);
  });

  return (
    <group position={[x, y, 0]} scale={size}>
      <sprite scale={[5.2, 5.2, 1]} position={[0, 0, -1.2]}>
        <spriteMaterial ref={glowMat} map={glow} color="#ff2d55" transparent opacity={0}
                        depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
      <mesh ref={ring} position={[0, 0, -0.4]}>
        <ringGeometry args={[1.32, 1.36, 128]} />
        <meshBasicMaterial ref={ringMat} color="#ff4d76" transparent opacity={0} depthWrite={false}
                           blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <group ref={group}>
        <Float enabled={!reduce} speed={1.1} rotationIntensity={0.18} floatIntensity={0.45} floatingRange={[-0.06, 0.06]}>
          <mesh ref={body} geometry={geo}>
            <meshPhysicalMaterial ref={mat} color={pulse.live ? LIVE : dark ? IDLE_DARK : IDLE_LIGHT} roughness={0.2} metalness={0.02}
                                  clearcoat={1} clearcoatRoughness={0.05} sheen={0.8} sheenRoughness={0.35}
                                  sheenColor="#ffc2d0" emissive="#ff0a3c" emissiveIntensity={0.1}
                                  iridescence={0.18} iridescenceIOR={1.3} />
          </mesh>
        </Float>
      </group>
    </group>
  );
}

function Lights({ dark }) {
  return (
    <>
      <ambientLight intensity={dark ? 0.25 : 0.55} />
      <directionalLight position={[3, 4, 5]} intensity={dark ? 1.4 : 1.8} />
      <pointLight position={[-3, -1.5, 2.5]} color="#ff2d55" intensity={dark ? 18 : 6} distance={12} />
      <pointLight position={[3, -2, 1]} color="#7c5cff" intensity={dark ? 10 : 2} distance={10} />
      {/* Studio reflections from light panels, rendered once: no image is downloaded. */}
      <Environment resolution={256} frames={1}>
        <group rotation={[-Math.PI / 3, 0, 1]}>
          <Lightformer form="circle" intensity={4} rotation-x={Math.PI / 2} position={[0, 5, -9]} scale={2} />
          <Lightformer form="circle" intensity={2} rotation-y={Math.PI / 2} position={[-5, 1, -1]} scale={2} />
          <Lightformer form="circle" intensity={2} rotation-y={Math.PI / 2} position={[-5, -1, -1]} scale={2} />
          <Lightformer form="circle" intensity={2} rotation-y={-Math.PI / 2} position={[10, 1, 0]} scale={8} />
          <Lightformer form="ring" color="#ff4d7a" intensity={6} onUpdate={(self) => self.lookAt(0, 0, 0)}
                       position={[10, 10, 0]} scale={10} />
        </group>
      </Environment>
    </>
  );
}

export default function HeartScene({ theme, light }) {
  const dark = theme === 'dark';
  const reduce = prefersReducedMotion();
  const [dpr, setDpr] = useState(1.75);
  const [lean, setLean] = useState(false);
  return (
    <Canvas className="hero-canvas" dpr={[1, dpr]} camera={{ position: [0, 0, 6], fov: 32 }}
            gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
            aria-hidden="true">
      {/* Drop resolution and the particles on a struggling machine: the camera's tracking needs the time. */}
      <PerformanceMonitor onDecline={() => { setDpr(1); setLean(true); }} />
      <Lights dark={dark} />
      <Heart dark={dark} reduce={reduce} />
      {dark && !light && !reduce && !lean && (
        <Sparkles count={46} scale={[6, 3.6, 2.5]} position={[0.8, 0.2, -0.5]} size={2.4} speed={0.22}
                  opacity={0.55} color="#ff7d98" noise={0.6} />
      )}
    </Canvas>
  );
}

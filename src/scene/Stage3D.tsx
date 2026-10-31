import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import type { ActionUnit, MoveKind, RoomView, Side } from '../../shared/whisper';
import { AGENT_NAMES, other } from '../../shared/whisper';
import type { TableState } from '../../shared/stage';
import { createAmbience, type AmbienceCue } from './ambience';
import { cardTexture, clockTexture, contractTexture, dispose, fogTexture, nameTexture, plaqueTexture, rainTexture, tagTexture } from './textures';

const TABLE_Y = .78;
const SEAT_Z: Record<Side, number> = { a: -1.75, b: 1.75 };
const SUIT: Record<Side, string> = { a: '#4f6579', b: '#7a5e47' };
const ACCENT: Record<Side, string> = { a: '#91B7CF', b: '#D3A284' };
const SKIN = '#c8a38b';
const HAIR = '#171c24';

/** Public scenario palettes. Nothing here comes from private room state. */
const SCENES: Record<string, { floor: string; wall: string; far: string; fog: [string, number, number]; cold: string; warm: string }> = {
  'last-battery': { floor: '#070d14', wall: '#0b121b', far: '#0a1119', fog: ['#0a1119', 6.4, 18], cold: '#7fb6dc', warm: '#ff8f4a' },
  'last-ferry': { floor: '#111820', wall: '#16232b', far: '#142028', fog: ['#1a252b', 3.6, 14.5], cold: '#8fa6ad', warm: '#ffb15c' },
  'silent-archive': { floor: '#0f0d0b', wall: '#15110e', far: '#14100d', fog: ['#14100d', 7.2, 19], cold: '#6c88a4', warm: '#e6b06a' },
};
const sceneTone = (id: string) => SCENES[id] ?? SCENES['last-battery'];

type Mood = {
  ambient: string; ambientLevel: number; direction: string; directionLevel: number; directionY: number;
  opponent: string; opponentLevel: number; own: string; ownLevel: number;
  spot: string; spotLevel: number; spotAngle: number; table: string; tableLevel: number; exposure: number;
};
/** Three-act atmosphere: probe is cold and wide, exchange warm and tight, decision hard and close. */
const MOODS: Record<number, Mood> = {
  1: { ambient: '#6f8ba2', ambientLevel: .38, direction: '#a0b9cb', directionLevel: .55, directionY: 3.1, opponent: '#c3d9e8', opponentLevel: 10, own: '#6da9c8', ownLevel: 9, spot: '#b9d2e6', spotLevel: 20, spotAngle: .74, table: '#c0d2e0', tableLevel: .7, exposure: 1.12 },
  2: { ambient: '#8f8a85', ambientLevel: .44, direction: '#cdb6a3', directionLevel: .58, directionY: 4.1, opponent: '#ffcb98', opponentLevel: 17, own: '#6da9c8', ownLevel: 10, spot: '#ffc18a', spotLevel: 30, spotAngle: .52, table: '#e2b184', tableLevel: 1.2, exposure: 1.22 },
  3: { ambient: '#525c68', ambientLevel: .3, direction: '#d8b898', directionLevel: .52, directionY: 4.7, opponent: '#ffd3a1', opponentLevel: 24, own: '#457e99', ownLevel: 5.5, spot: '#ffd0a0', spotLevel: 38, spotAngle: .44, table: '#efb77f', tableLevel: 1.35, exposure: 1.3 },
};
const moodFor = (act: number) => MOODS[Math.max(1, Math.min(3, act))] ?? MOODS[1];

function dampValue(current: number, target: number, lambda: number, delta: number, instant: boolean) {
  return instant ? target : THREE.MathUtils.damp(current, target, lambda, delta);
}
function dampColor(current: THREE.Color, goal: THREE.Color, lambda: number, delta: number, instant: boolean) {
  if (instant) current.copy(goal); else current.lerp(goal, 1 - Math.exp(-lambda * delta));
}

/** 0 → 1 closing progress. Deal never dims; a failed deal extinguishes in sequence. */
function useEndingProgress(finished: boolean, deal: boolean, instant: boolean) {
  const progress = useRef(0), start = useRef<number | null>(null);
  useFrame(({ clock }) => {
    if (!finished || deal) { progress.current = 0; return; }
    if (instant) { progress.current = 1; return; }
    if (start.current === null) start.current = clock.elapsedTime;
    progress.current = THREE.MathUtils.clamp((clock.elapsedTime - start.current - .25) / 2.6, 0, 1);
  });
  return progress;
}

interface Pose { position: THREE.Vector3; target: THREE.Vector3 }
function cameraPose(you: Side): Pose {
  // Full-screen seat view: opponent upper middle, table below, own hands at the lower edge.
  return you === 'a'
    ? { position: new THREE.Vector3(.45, 1.34, -1.38), target: new THREE.Vector3(0, 1.08, 1.5) }
    : { position: new THREE.Vector3(-.45, 1.34, 1.38), target: new THREE.Vector3(0, 1.08, -1.5) };
}

/** Vertical FOV around 50° at 16:9 and 47° on ultrawide screens. */
function FrameCamera() {
  const { camera, size } = useThree();
  useEffect(() => {
    const perspective = camera as THREE.PerspectiveCamera;
    const aspect = size.width / Math.max(1, size.height);
    const fov = aspect >= 2.1 ? 47 : 50;
    if (perspective.fov !== fov) { perspective.fov = fov; perspective.updateProjectionMatrix(); }
  }, [camera, size.width, size.height]);
  return null;
}

function useCardTexture(key: string, make: () => THREE.CanvasTexture) {
  const texture = useMemo(make, [key]);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

function Billboard({ position, children, lift = 0 }: { position: [number, number, number]; children: ReactNode; lift?: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ camera, clock }) => {
    const group = ref.current;
    if (!group) return;
    group.quaternion.copy(camera.quaternion);
    group.position.y = position[1] + (lift ? Math.sin(clock.elapsedTime * 1.3 + position[0] * 2.1) * lift : 0);
  });
  return <group ref={ref} position={position}>{children}</group>;
}

function Card({ texture, position, width, height, accent, active, lift = .004 }: { texture: THREE.Texture; position: [number, number, number]; width: number; height: number; accent: string; active?: boolean; lift?: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ camera, clock }, delta) => {
    const group = ref.current;
    if (!group) return;
    group.quaternion.copy(camera.quaternion);
    group.position.y = position[1] + Math.sin(clock.elapsedTime * 1.3 + position[0] * 2.1) * lift;
    const scale = THREE.MathUtils.damp(group.scale.x, active ? 1.075 : 1, 8, delta);
    group.scale.setScalar(scale);
  });
  return <group ref={ref} position={position}>
    <mesh>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} transparent toneMapped={false} depthWrite={false} />
    </mesh>
    <mesh position-z={-.004}>
      <planeGeometry args={[width + .028, height + .028]} />
      <meshBasicMaterial color={accent} transparent opacity={.1} depthWrite={false} />
    </mesh>
  </group>;
}

function Room({ title, object, scenarioId }: { title: string; object: string; scenarioId: string }) {
  const titleTexture = useCardTexture(`room:${title}:${object}`, () => plaqueTexture(`${title} · ${object}`, '#D3A284'));
  const tone = sceneTone(scenarioId);
  return <group>
    <mesh rotation-x={-Math.PI / 2} receiveShadow position={[0, 0, 0]}>
      <planeGeometry args={[18, 18]} />
      <meshStandardMaterial color={tone.floor} roughness={.92} metalness={.04} />
    </mesh>
    <mesh rotation-x={-Math.PI / 2} position={[0, .012, 0]}>
      <circleGeometry args={[2.9, 64]} />
      <meshStandardMaterial color="#111924" roughness={.95} />
    </mesh>
    <mesh rotation-x={-Math.PI / 2} position={[0, .018, 0]}>
      <ringGeometry args={[2.74, 2.82, 64]} />
      <meshBasicMaterial color="#8f6f56" transparent opacity={.4} />
    </mesh>
    <mesh position={[0, 2.6, 5.6]}>
      <planeGeometry args={[18, 5.2]} />
      <meshStandardMaterial color={tone.wall} roughness={.88} />
    </mesh>
    <mesh position={[0, 2.6, -5.6]} rotation-y={Math.PI}>
      <planeGeometry args={[18, 5.2]} />
      <meshStandardMaterial color={tone.wall} roughness={.9} />
    </mesh>
    <mesh position={[5.6, 2.6, 0]} rotation-y={-Math.PI / 2}>
      <planeGeometry args={[18, 5.2]} />
      <meshStandardMaterial color={tone.far} roughness={.9} />
    </mesh>
    <mesh position={[-5.6, 2.6, 0]} rotation-y={Math.PI / 2}>
      <planeGeometry args={[18, 5.2]} />
      <meshStandardMaterial color={tone.far} roughness={.9} />
    </mesh>
    <mesh position={[0, 5.2, 0]} rotation-x={Math.PI / 2}>
      <planeGeometry args={[18, 18]} />
      <meshStandardMaterial color="#080d13" roughness={.95} />
    </mesh>
    {[-3.6, -1.8, 1.8, 3.6].map(x => <mesh key={x} position={[x, 2.3, 5.55]}>
      <boxGeometry args={[.05, 2.4, .03]} />
      <meshBasicMaterial color="#283748" transparent opacity={.6} />
    </mesh>)}
    {[-1, 1].map(sign => <group key={sign} position={[0, 1.58, sign * 2.65]} rotation-y={sign > 0 ? Math.PI : 0}>
      <mesh><circleGeometry args={[1.16, 48]} /><meshStandardMaterial color="#0b141e" roughness={.92} /></mesh>
      <mesh position-z={.015}><ringGeometry args={[1.03, 1.07, 48]} /><meshBasicMaterial color="#c49a74" transparent opacity={.5} /></mesh>
      {[-.58, -.3, .3, .58].map(x => <mesh key={x} position={[x, 0, .03]}><boxGeometry args={[.014, 2.05, .008]} /><meshBasicMaterial color="#31465a" transparent opacity={.38} /></mesh>)}
    </group>)}
    <Billboard position={[0, 2.85, 5.35]}>
      <mesh><planeGeometry args={[2.1, .525]} /><meshBasicMaterial map={titleTexture} transparent toneMapped={false} depthWrite={false} /></mesh>
    </Billboard>
  </group>;
}

function Table() {
  return <group>
    <mesh position={[0, TABLE_Y, 0]} castShadow receiveShadow>
      <boxGeometry args={[1.95, .09, 2.8]} />
      <meshStandardMaterial color="#222d3b" roughness={.38} metalness={.3} />
    </mesh>
    <mesh position={[0, TABLE_Y - .34, 0]}>
      <boxGeometry args={[1.62, .62, 2.42]} />
      <meshStandardMaterial color="#141c26" roughness={.7} metalness={.15} />
    </mesh>
    {[-.96, .96].map(x => <mesh key={`x${x}`} position={[x, TABLE_Y + .045, 0]}>
      <boxGeometry args={[.022, .01, 2.8]} />
      <meshBasicMaterial color="#c39a73" />
    </mesh>)}
    {[-1.39, 1.39].map(z => <mesh key={`z${z}`} position={[0, TABLE_Y + .045, z]}>
      <boxGeometry args={[1.95, .01, .022]} />
      <meshBasicMaterial color="#c39a73" />
    </mesh>)}
  </group>;
}

function Chair({ side }: { side: Side }) {
  return <group>
    <mesh position={[0, .46, 0]} castShadow><boxGeometry args={[.52, .08, .52]} /><meshStandardMaterial color="#161d27" roughness={.7} /></mesh>
    <mesh position={[0, .8, -.27]} castShadow><boxGeometry args={[.52, .72, .06]} /><meshStandardMaterial color="#161d27" roughness={.7} /></mesh>
    {[-.2, .2].map(x => <mesh key={x} position={[x, .22, -.22]}><boxGeometry args={[.05, .44, .05]} /><meshStandardMaterial color="#202a36" metalness={.4} roughness={.4} /></mesh>)}
    <mesh position={[0, .46, .22]}><boxGeometry args={[.46, .05, .08]} /><meshStandardMaterial color={ACCENT[side]} emissive={ACCENT[side]} emissiveIntensity={.15} /></mesh>
  </group>;
}

type Reaction = 'idle' | 'forward' | 'away' | 'lean' | 'nod' | 'withdraw' | 'back';

/** Public reaction only. It never inspects private state or tries to expose a lie. */
function reactionFor(unit: ActionUnit | undefined, opponent: Side): Reaction {
  if (!unit) return 'idle';
  if (unit.breaches.length) return unit.side === opponent ? 'withdraw' : 'away';
  if (unit.challenge?.upheld) return 'forward';
  if (unit.challenge) return 'away';
  if (unit.agreement || unit.kind === 'accept' && unit.result === 'success') return 'nod';
  if (unit.kind === 'verify' || unit.evidence) return 'lean';
  if (unit.kind === 'wait') return 'back';
  return 'idle';
}

function OpponentAgent({ side, acting, step, speaking, reduced, unit }: { side: Side; acting: boolean; step: number; speaking: boolean; reduced: boolean; unit?: ActionUnit }) {
  const group = useRef<THREE.Group>(null), body = useRef<THREE.Group>(null), head = useRef<THREE.Group>(null);
  const arm = useRef<THREE.Group>(null), leftArm = useRef<THREE.Group>(null), eyes = useRef<THREE.Group>(null), mouth = useRef<THREE.Mesh>(null);
  const lastReaction = useRef(''), nodStart = useRef(-99);
  const reaction = reactionFor(unit, side);
  useFrame(({ clock }, delta) => {
    const time = clock.elapsedTime;
    if (lastReaction.current !== `${unit?.id ?? ''}:${reaction}`) {
      lastReaction.current = `${unit?.id ?? ''}:${reaction}`;
      if (reaction === 'nod') nodStart.current = time;
    }
    if (group.current && !reduced) group.current.position.y = Math.sin(time * 1.05 + (side === 'a' ? 0 : 1.7)) * .003;
    const pose = {
      idle: { lean: 0, tilt: 0, headY: .02, headX: 0, armX: -.92, armZ: -.18, leftX: -.92, leftZ: .18 },
      forward: { lean: .07, tilt: .135, headY: .02, headX: -.06, armX: -1.5, armZ: -.42, leftX: -1.5, leftZ: .42 },
      away: { lean: -.07, tilt: -.1, headY: -.2, headX: .02, armX: -.85, armZ: -.12, leftX: -.85, leftZ: .12 },
      lean: { lean: .05, tilt: .08, headY: .03, headX: -.1, armX: -1.05, armZ: -.24, leftX: -1.05, leftZ: .24 },
      nod: { lean: .012, tilt: .02, headY: .04, headX: 0, armX: -.88, armZ: -.16, leftX: -.88, leftZ: .16 },
      withdraw: { lean: -.13, tilt: -.18, headY: -.08, headX: .04, armX: -.62, armZ: -.1, leftX: -.62, leftZ: .1 },
      back: { lean: -.11, tilt: -.14, headY: .05, headX: .05, armX: -.8, armZ: -.12, leftX: -.8, leftZ: .12 },
    }[reaction];
    const gesture = acting && step >= 1 && reaction === 'idle';
    if (body.current) {
      body.current.position.z = dampValue(body.current.position.z, pose.lean, 3.2, delta, reduced);
      body.current.rotation.x = dampValue(body.current.rotation.x, pose.tilt, 3.2, delta, reduced);
      body.current.position.y = reduced ? 0 : Math.sin(time * 2.1 + (side === 'a' ? 0 : 1.7)) * .0025;
    }
    if (head.current) {
      const nod = reaction === 'nod' && time - nodStart.current < 1.05 ? Math.sin((time - nodStart.current) * Math.PI * 2.5) * .06 : 0;
      const gaze = reduced ? 0 : Math.sin(time * .27 + (side === 'a' ? 0 : 2.3)) * .045;
      head.current.rotation.y = dampValue(head.current.rotation.y, (speaking ? .12 : pose.headY) + gaze, reduced ? 99 : 4, delta, reduced);
      head.current.rotation.x = dampValue(head.current.rotation.x, pose.headX + nod, reduced ? 99 : 5, delta, reduced);
    }
    if (arm.current) {
      arm.current.rotation.x = dampValue(arm.current.rotation.x, gesture ? -1.18 : pose.armX, 6, delta, reduced);
      arm.current.rotation.z = dampValue(arm.current.rotation.z, gesture ? -.34 : pose.armZ, 6, delta, reduced);
    }
    if (leftArm.current) {
      leftArm.current.rotation.x = dampValue(leftArm.current.rotation.x, pose.leftX, 6, delta, reduced);
      leftArm.current.rotation.z = dampValue(leftArm.current.rotation.z, pose.leftZ, 6, delta, reduced);
    }
    if (eyes.current) {
      const period = 4.2 + Math.sin(time * .37) * 1.2;
      const blink = !reduced && (time % period) < .13;
      eyes.current.scale.y = reduced ? 1 : THREE.MathUtils.damp(eyes.current.scale.y, blink ? .07 : 1, 18, delta);
    }
    if (mouth.current) mouth.current.scale.x = speaking ? 1.45 + Math.sin(time * 13) * .25 : 1;
  });
  return <group position={[0, 0, SEAT_Z[side]]} rotation-y={side === 'b' ? Math.PI : 0}>
    <Chair side={side} />
    <group ref={body}>
      <mesh position={[0, .98, 0]} castShadow>
        <capsuleGeometry args={[.22, .46, 6, 12]} />
        <meshStandardMaterial color={SUIT[side]} roughness={.75} flatShading />
      </mesh>
      <mesh position={[0, 1.2, .01]} castShadow>
        <boxGeometry args={[.56, .13, .3]} />
        <meshStandardMaterial color={SUIT[side]} roughness={.7} flatShading />
      </mesh>
      <mesh position={[0, 1.22, .17]}>
        <boxGeometry args={[.2, .18, .02]} />
        <meshStandardMaterial color="#d9d3c4" roughness={.9} />
      </mesh>
      <mesh position={[0, 1.27, .185]}>
        <boxGeometry args={[.05, .16, .02]} />
        <meshStandardMaterial color={ACCENT[side]} emissive={ACCENT[side]} emissiveIntensity={.4} />
      </mesh>
      <group ref={head} position={[0, 1.43, .02]}>
        <mesh castShadow><sphereGeometry args={[.16, 20, 16]} /><meshStandardMaterial color={SKIN} roughness={.8} flatShading /></mesh>
        <mesh position={[0, .06, -.03]} scale={[1.05, .7, 1.02]}><sphereGeometry args={[.165, 16, 12]} /><meshStandardMaterial color={HAIR} roughness={.9} flatShading /></mesh>
        <group ref={eyes}>
          {[-.055, .055].map(x => <mesh key={x} position={[x, .015, .148]}><sphereGeometry args={[.018, 8, 8]} /><meshStandardMaterial color="#222a33" /></mesh>)}
        </group>
        <mesh position={[0, -.055, .16]}><coneGeometry args={[.016, .045, 8]} /><meshStandardMaterial color="#b58f78" /></mesh>
        <mesh ref={mouth} position={[0, -.075, .158]}><boxGeometry args={[.05, .012, .01]} /><meshStandardMaterial color="#6d4b45" /></mesh>
        {side === 'b' && <mesh position={[0, .04, -.16]}><sphereGeometry args={[.09, 12, 10]} /><meshStandardMaterial color={HAIR} roughness={.9} flatShading /></mesh>}
      </group>
      <group ref={arm} position={[.29, 1.16, .02]} rotation={[-.92, 0, -.18]}>
        <mesh position={[0, -.22, 0]} castShadow><capsuleGeometry args={[.055, .36, 4, 8]} /><meshStandardMaterial color={SUIT[side]} roughness={.75} /></mesh>
        <mesh position={[0, -.46, 0]}><sphereGeometry args={[.055, 10, 8]} /><meshStandardMaterial color={SKIN} roughness={.85} /></mesh>
      </group>
      <group ref={leftArm} position={[-.29, 1.16, .02]} rotation={[-.92, 0, .18]}>
        <mesh position={[0, -.22, 0]} castShadow><capsuleGeometry args={[.055, .36, 4, 8]} /><meshStandardMaterial color={SUIT[side]} roughness={.75} /></mesh>
        <mesh position={[0, -.46, 0]}><sphereGeometry args={[.055, 10, 8]} /><meshStandardMaterial color={SKIN} roughness={.85} /></mesh>
      </group>
    </group>
  </group>;
}

function Nameplate({ side, name, role, highlight, reduced }: { side: Side; name: string; role: string; highlight: boolean; reduced: boolean }) {
  const texture = useCardTexture(`name:${side}:${name}:${role}`, () => nameTexture(name, role, side));
  const glow = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((_, delta) => {
    if (glow.current) glow.current.opacity = dampValue(glow.current.opacity, highlight ? .38 : 0, 3, delta, reduced);
  });
  return <Billboard position={[0, 1.92, SEAT_Z[side] + (side === 'b' ? -.34 : .34)]}>
    <mesh position-z={-.006}><planeGeometry args={[1.1, .34]} /><meshBasicMaterial ref={glow} color="#ffd6a6" transparent opacity={0} toneMapped={false} depthWrite={false} /></mesh>
    <mesh><planeGeometry args={[1.0, .28]} /><meshBasicMaterial map={texture} transparent toneMapped={false} depthWrite={false} /></mesh>
  </Billboard>;
}

function OwnDesk({ side, highlight, reduced }: { side: Side; highlight: boolean; reduced: boolean }) {
  const z = side === 'a' ? -.52 : .52, x = side === 'a' ? .45 : -.45, y = .8;
  const offsets = [-.5, .5];
  const glow = useRef<THREE.PointLight>(null);
  useFrame((_, delta) => {
    if (glow.current) glow.current.intensity = dampValue(glow.current.intensity, highlight ? 2.2 : 0, 3, delta, reduced);
  });
  return <group>
    {offsets.map((offset, index) => <group key={offset} position={[x + offset, y, z]} rotation={[-.42, 0, index ? -.12 : .1]}>
      <mesh><capsuleGeometry args={[.052, .34, 4, 8]} /><meshStandardMaterial color={SUIT[side]} roughness={.8} /></mesh>
      <mesh position={[0, -.22, .02]}><sphereGeometry args={[.055, 10, 8]} /><meshStandardMaterial color={SKIN} roughness={.85} /></mesh>
    </group>)}
    <mesh position={[x + .58, .86, z - .12]}>
      <cylinderGeometry args={[.055, .045, .14, 16]} />
      <meshStandardMaterial color="#314152" roughness={.25} metalness={.2} transparent opacity={.7} />
    </mesh>
    <mesh position={[x - .58, .815, z - .14]} rotation-x={-.06}>
      <boxGeometry args={[.26, .012, .16]} />
      <meshStandardMaterial color="#d7c7ae" roughness={.9} />
    </mesh>
    <mesh position={[x - .58, .824, z - .14]} rotation-x={-.06}>
      <boxGeometry args={[.2, .004, .1]} />
      <meshBasicMaterial color={ACCENT[side]} transparent opacity={highlight ? .78 : .5} />
    </mesh>
    <pointLight ref={glow} position={[x, .9, z + .1]} color="#ffd0a0" intensity={0} distance={1.6} decay={2} />
  </group>;
}

function OfferCard({ side, price, accepted, sealed, forward, active }: { side: Side; price: number; accepted: boolean; sealed: boolean; forward: number; active: boolean }) {
  const accent = ACCENT[side];
  const texture = useCardTexture(`offer:${side}:${price}:${accepted}:${sealed}`, () => cardTexture({
    title: `${AGENT_NAMES[side]}的报价`,
    value: `${price} 枚`, accent, seal: sealed ? '封签' : undefined,
    detail: accepted ? '双方已接受 · 协议独立保留' : sealed ? '待对方接受 · 价格承诺已封签' : '待对方接受',
  }));
  return <Card texture={texture} position={[-1.12 * forward, 1.1, 1.15 * forward]} width={.7} height={.4375} accent={accent} active={active} />;
}

function AgreementCard({ price, pending, forward, active }: { price: number; pending: boolean; forward: number; active: boolean }) {
  const texture = useCardTexture(`agreement:${price}:${pending}`, () => cardTexture({
    title: pending ? '有效协议 · 待执行' : '有效协议 · 独立保留', value: `${price} 枚`, accent: '#D3A284',
    detail: pending ? '合同已封存 · 物件尚未交付' : '第三幕结束执行',
    seal: pending ? '待执行' : undefined,
  }));
  return <Card texture={texture} position={[1.16 * forward, 1.1, 1.15 * forward]} width={.6} height={.375} accent="#D3A284" active={active} />;
}

function MaterialCard({ title, text, side, position, width = .5, height = .3125, active }: { title: string; text: string; side?: Side; position: [number, number, number]; width?: number; height?: number; active: boolean }) {
  const accent = side ? ACCENT[side] : '#D3A284';
  const texture = useCardTexture(`material:${title}:${text}:${accent}`, () => cardTexture({ title, detail: text, accent, muted: !text }));
  return <Card texture={texture} position={position} width={width} height={height} accent={accent} active={active} />;
}

/* ---------- 桌面交易：常驻 12 枚报价刻度、小托盘物件与交易手 ---------- */

/** Public scenario holder. All three current scenarios have 甲方 holding the lot. */
const LOT_SIDE: Side = 'a';
const CHIP_COUNT = 12;
const SURFACE = TABLE_Y + .045;
const LOT_NAMES: Record<string, string> = { 'last-battery': '备用电池', 'last-ferry': '货位', 'silent-archive': '档案盒' };
const TRAY_POS = { x: -.56, z: .52 };
const LOT_POS = { x: .56, z: .52 };
const QUOTE_Z = .64;
const HAND_SKIN: Record<Side, string> = { a: '#b89174', b: '#a87f63' };

type TradePhase = 'idle' | 'place' | 'withdraw' | 'handoff' | 'return';
type HandMode = 'push' | 'sweep' | 'attempt' | 'handoff';
interface TradeMotion {
  phase: TradePhase; token: number; handSide: Side | null; secondSide: Side | null;
  mode: HandMode; collect: boolean; duration: number;
}
const IDLE_MOTION: TradeMotion = { phase: 'idle', token: 0, handSide: null, secondSide: null, mode: 'push', collect: false, duration: 0 };

const traySlot = (index: number) => ({ x: (index % 6 - 2.5) * .058, z: index < 6 ? -.034 : .034 });
const quoteSlot = (index: number, count: number) => {
  const stacks = Math.max(1, Math.ceil(count / 4));
  return { x: (Math.floor(index / 4) - (stacks - 1) / 2) * .066, y: (index % 4) * .0115 };
};

interface TradeLayout {
  forward: number; tray: [number, number, number]; lotHome: [number, number, number]; quote: [number, number, number];
  chipsHandoff: [number, number, number]; lotHandoff: [number, number, number];
}
/** Each seat sees the same table from its own end; the trade lane mirrors with the camera. */
function tradeLayout(you: Side): TradeLayout {
  const forward = you === 'a' ? 1 : -1;
  const sellerIsSelf = you === LOT_SIDE, buyerIsSelf = you !== LOT_SIDE;
  return {
    forward,
    tray: [TRAY_POS.x * forward, SURFACE, TRAY_POS.z * forward],
    lotHome: [LOT_POS.x * forward, SURFACE, LOT_POS.z * forward],
    quote: [0, SURFACE, QUOTE_Z * forward],
    chipsHandoff: [-.3 * forward, SURFACE, (sellerIsSelf ? .32 : .88) * forward],
    lotHandoff: [LOT_POS.x * forward, SURFACE, (buyerIsSelf ? .36 : .88) * forward],
  };
}

/** Drives the public trade beat: place, withdraw, handoff or return. Never reads private state. */
function useTradeDirector({ table, active, step, review, reduced, finished, deal }: {
  table: TableState; active?: ActionUnit; step: number; review: string | null; reduced: boolean; finished: boolean; deal: boolean;
}) {
  const [motion, setMotion] = useState<TradeMotion>(IDLE_MOTION);
  const sequence = useRef(0), timers = useRef<number[]>([]), invalidSeen = useRef('');
  const offerKey = table.offer ? `${table.offer.id}:${table.offer.side}:${table.offer.price}` : 'none';
  const lastOfferKey = useRef(offerKey);
  const previousOffer = useRef<{ side: Side; price: number } | null>(table.offer ? { side: table.offer.side, price: table.offer.price } : null);
  const finishKey = finished ? (deal ? 'deal' : 'fail') : 'none';
  const lastFinishKey = useRef(finishKey);
  const clearTimers = () => { for (const timer of timers.current) window.clearTimeout(timer); timers.current = []; };
  const run = (chunks: { phase: TradePhase; handSide: Side | null; secondSide?: Side | null; mode: HandMode; collect: boolean; duration: number }[]) => {
    clearTimers();
    sequence.current += 1;
    const token = sequence.current;
    let delay = 0;
    for (const chunk of chunks) {
      timers.current.push(window.setTimeout(() => setMotion({ ...chunk, secondSide: chunk.secondSide ?? null, token }), delay));
      delay += chunk.duration;
    }
    timers.current.push(window.setTimeout(() => setMotion(IDLE_MOTION), delay));
  };
  useEffect(() => () => clearTimers(), []);
  useEffect(() => {
    if (lastOfferKey.current === offerKey) return;
    lastOfferKey.current = offerKey;
    const previous = previousOffer.current;
    previousOffer.current = table.offer ? { side: table.offer.side, price: table.offer.price } : null;
    const next = previousOffer.current;
    if (!next || review || reduced) return;
    if (previous) {
      run([
        { phase: 'withdraw', handSide: previous.side, mode: 'sweep', collect: true, duration: 250 },
        { phase: 'place', handSide: next.side, mode: 'push', collect: false, duration: 360 },
      ]);
    } else {
      run([{ phase: 'place', handSide: next.side, mode: 'push', collect: false, duration: 520 }]);
    }
  }, [offerKey, review, reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (lastFinishKey.current === finishKey) return;
    lastFinishKey.current = finishKey;
    if (review || reduced || finishKey === 'none') return;
    if (finishKey === 'deal') run([{ phase: 'handoff', handSide: 'b', secondSide: 'a', mode: 'handoff', collect: false, duration: 850 }]);
    else run([{ phase: 'return', handSide: null, mode: 'sweep', collect: true, duration: 600 }]);
  }, [finishKey, review, reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!active || step < 2 || review || reduced || active.valid || active.kind !== 'offer') return;
    if (invalidSeen.current === active.id) return;
    invalidSeen.current = active.id;
    run([{ phase: 'withdraw', handSide: active.side, mode: 'attempt', collect: false, duration: 460 }]);
  }, [active?.id, active?.kind, active?.valid, active?.side, step, review, reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  return motion;
}

function PaperTag({ text, accent, position, width, height, muted = false }: {
  text: string; accent: string; position: [number, number, number]; width: number; height: number; muted?: boolean;
}) {
  const texture = useCardTexture(`tag:${text}:${accent}:${muted}`, () => tagTexture(text, accent, muted));
  return <Billboard position={position}>
    <mesh><planeGeometry args={[width, height]} /><meshBasicMaterial map={texture} transparent toneMapped={false} depthWrite={false} /></mesh>
  </Billboard>;
}

function ChipTray({ layout }: { layout: TradeLayout }) {
  return <group position={layout.tray}>
    <mesh position-y={.006} receiveShadow><boxGeometry args={[.42, .012, .23]} /><meshStandardMaterial color="#2b241c" roughness={.72} metalness={.16} /></mesh>
    <mesh position-y={.0132}><boxGeometry args={[.39, .003, .2]} /><meshStandardMaterial color="#101922" roughness={.96} /></mesh>
    {[-.207, .207].map(x => <mesh key={`x${x}`} position={[x, .0133, 0]}><boxGeometry args={[.007, .004, .212]} /><meshStandardMaterial color="#b08b4d" metalness={.5} roughness={.42} /></mesh>)}
    {[-.112, .112].map(z => <mesh key={`z${z}`} position={[0, .0133, z]}><boxGeometry args={[.41, .004, .007]} /><meshStandardMaterial color="#b08b4d" metalness={.5} roughness={.42} /></mesh>)}
    {Array.from({ length: CHIP_COUNT }, (_, index) => {
      const slot = traySlot(index);
      return <mesh key={index} position={[slot.x, .0137, slot.z]} rotation-x={-Math.PI / 2}><circleGeometry args={[.03, 16]} /><meshBasicMaterial color="#070d13" transparent opacity={.62} /></mesh>;
    })}
  </group>;
}

function QuoteSpot({ layout }: { layout: TradeLayout }) {
  return <group position={layout.quote}>
    <mesh position-y={.004} receiveShadow><boxGeometry args={[.3, .008, .18]} /><meshStandardMaterial color="#18222d" roughness={.5} metalness={.25} /></mesh>
    <mesh position-y={.0086}><boxGeometry args={[.26, .003, .14]} /><meshStandardMaterial color="#0c141c" roughness={.95} /></mesh>
    {[-.132, .132].map(x => <mesh key={x} position={[x, .0091, 0]}><boxGeometry args={[.006, .003, .15]} /><meshStandardMaterial color="#b08b4d" metalness={.5} roughness={.42} /></mesh>)}
  </group>;
}

function TradeChip({ target, accent, lit, instant, reduced }: {
  target: [number, number, number]; accent: string; lit: boolean; instant: boolean; reduced: boolean;
}) {
  const group = useRef<THREE.Group>(null), primed = useRef(false);
  useFrame((_, delta) => {
    const chip = group.current;
    if (!chip) return;
    if (!primed.current) { chip.position.set(...target); primed.current = true; return; }
    chip.position.x = dampValue(chip.position.x, target[0], 11, delta, instant || reduced);
    chip.position.z = dampValue(chip.position.z, target[2], 11, delta, instant || reduced);
    chip.position.y = dampValue(chip.position.y, target[1], 9, delta, instant || reduced);
  });
  return <group ref={group} position={target}>
    <mesh castShadow><cylinderGeometry args={[.032, .032, .011, 20]} /><meshStandardMaterial color={lit ? '#e2cfaa' : '#cabd9f'} metalness={.5} roughness={.42} /></mesh>
    <mesh position-y={.0061}><torusGeometry args={[.0275, .0036, 6, 18]} /><meshBasicMaterial color={accent} transparent opacity={lit ? .95 : .3} /></mesh>
  </group>;
}

function Chips({ count, spot, accent, layout, instant, reduced }: {
  count: number; spot: 'tray' | 'quote' | 'seller'; accent: string; layout: TradeLayout; instant: boolean; reduced: boolean;
}) {
  const out = spot === 'tray' ? 0 : count;
  return <group>
    {Array.from({ length: CHIP_COUNT }, (_, index) => {
      const slot = traySlot(index);
      let target: [number, number, number] = [layout.tray[0] + slot.x, SURFACE + .0185, layout.tray[2] + slot.z];
      if (index < out) {
        const quote = quoteSlot(index, out);
        const base = spot === 'quote' ? layout.quote : layout.chipsHandoff;
        target = [base[0] + quote.x, SURFACE + .0135 + quote.y, base[2]];
      }
      return <TradeChip key={index} target={target} accent={index < out ? accent : '#8f7a62'} lit={index < out} instant={instant} reduced={reduced} />;
    })}
  </group>;
}

function BatteryModel() {
  return <group>
    <mesh position-y={.064} castShadow><cylinderGeometry args={[.034, .034, .1, 18]} /><meshStandardMaterial color="#263744" metalness={.45} roughness={.36} /></mesh>
    <mesh position-y={.083}><cylinderGeometry args={[.0355, .0355, .015, 18]} /><meshStandardMaterial color="#d77d6f" roughness={.55} /></mesh>
    <mesh position-y={.122}><cylinderGeometry args={[.015, .015, .018, 12]} /><meshStandardMaterial color="#d3a284" metalness={.7} roughness={.25} /></mesh>
    <mesh position={[0, .102, .034]}><sphereGeometry args={[.0045, 8, 8]} /><meshBasicMaterial color="#9fe0b4" /></mesh>
    <mesh position={[0, .036, .0342]}><torusGeometry args={[.018, .0025, 6, 14]} /><meshBasicMaterial color="#d3a284" /></mesh>
  </group>;
}

function CargoModel() {
  return <group>
    <mesh position-y={.049} castShadow><boxGeometry args={[.12, .07, .09]} /><meshStandardMaterial color="#5b4432" roughness={.8} /></mesh>
    <mesh position-y={.088}><boxGeometry args={[.126, .008, .096]} /><meshStandardMaterial color="#8a6a4a" roughness={.7} /></mesh>
    <mesh position={[0, .049, .046]}><planeGeometry args={[.07, .04]} /><meshStandardMaterial color="#d7c7ae" roughness={.9} /></mesh>
    <mesh position={[0, .092, 0]}><boxGeometry args={[.032, .004, .098]} /><meshBasicMaterial color="#d3a284" /></mesh>
  </group>;
}

function ArchiveBoxModel() {
  return <group>
    <mesh position-y={.0515} castShadow><boxGeometry args={[.13, .075, .1]} /><meshStandardMaterial color="#3b3328" roughness={.8} /></mesh>
    <mesh position-y={.093}><boxGeometry args={[.136, .008, .106]} /><meshStandardMaterial color="#6f5b44" roughness={.7} /></mesh>
    <mesh position={[0, .048, .051]}><planeGeometry args={[.08, .045]} /><meshStandardMaterial color="#d7c7ae" roughness={.9} /></mesh>
    <mesh position={[.032, .062, .0525]}><torusGeometry args={[.016, .004, 8, 14]} /><meshBasicMaterial color="#b34d45" /></mesh>
  </group>;
}

function LotTray({ scenarioId, spot, layout, instant, reduced }: {
  scenarioId: string; spot: 'home' | 'handoff'; layout: TradeLayout; instant: boolean; reduced: boolean;
}) {
  const target = spot === 'handoff' ? layout.lotHandoff : layout.lotHome;
  const group = useRef<THREE.Group>(null), primed = useRef(false);
  const object = LOT_NAMES[scenarioId] ?? '备用电池';
  const tag = spot === 'handoff' ? `${object} · 已交付` : object;
  useFrame((_, delta) => {
    const tray = group.current;
    if (!tray) return;
    if (!primed.current) { tray.position.set(target[0], SURFACE, target[2]); primed.current = true; return; }
    tray.position.x = dampValue(tray.position.x, target[0], 7, delta, instant || reduced);
    tray.position.z = dampValue(tray.position.z, target[2], 7, delta, instant || reduced);
  });
  return <group ref={group} position={[target[0], SURFACE, target[2]]}>
    <mesh position-y={.006} receiveShadow><boxGeometry args={[.23, .012, .17]} /><meshStandardMaterial color="#c9bda4" roughness={.62} metalness={.06} /></mesh>
    <mesh position-y={.0132}><boxGeometry args={[.195, .003, .135]} /><meshStandardMaterial color="#e2d7c1" roughness={.85} /></mesh>
    {[-.107, .107].map(x => <mesh key={x} position={[x, .0131, 0]}><boxGeometry args={[.005, .003, .16]} /><meshStandardMaterial color="#9b7c4c" metalness={.4} roughness={.5} /></mesh>)}
    {scenarioId === 'last-ferry' ? <CargoModel /> : scenarioId === 'silent-archive' ? <ArchiveBoxModel /> : <BatteryModel />}
    <PaperTag text={tag} accent="#8f7a62" position={[0, .145, -.07]} width={.29} height={.065} />
  </group>;
}

function HandShape({ side }: { side: Side }) {
  return <group rotation-y={side === 'a' ? 0 : Math.PI}>
    <mesh position={[0, 0, -.31]} rotation-x={Math.PI / 2}><cylinderGeometry args={[.05, .056, .13, 12]} /><meshStandardMaterial color={SUIT[side]} roughness={.82} /></mesh>
    <mesh position={[0, 0, -.24]} rotation-x={Math.PI / 2}><cylinderGeometry args={[.048, .048, .022, 12]} /><meshStandardMaterial color={ACCENT[side]} emissive={ACCENT[side]} emissiveIntensity={.22} roughness={.6} /></mesh>
    <mesh position={[0, 0, -.125]} rotation-x={Math.PI / 2}><capsuleGeometry args={[.035, .155, 4, 10]} /><meshStandardMaterial color={HAND_SKIN[side]} roughness={.84} /></mesh>
    <mesh position={[0, 0, .035]}><boxGeometry args={[.126, .038, .108]} /><meshStandardMaterial color={HAND_SKIN[side]} roughness={.82} /></mesh>
    {[-.048, -.016, .016, .048].map(x => <mesh key={x} position={[x, 0, .128]} rotation-x={Math.PI / 2 - .12}><capsuleGeometry args={[.0145, .044, 4, 8]} /><meshStandardMaterial color={HAND_SKIN[side]} roughness={.84} /></mesh>)}
  </group>;
}

function TradeHand({ side, motion, target, nudge, instant }: {
  side: Side; motion: TradeMotion; target: [number, number, number]; nudge?: [number, number] | null; instant: boolean;
}) {
  const group = useRef<THREE.Group>(null), started = useRef(-1), keyed = useRef('');
  const from = useMemo(() => new THREE.Vector3(target[0], SURFACE + .06, SEAT_Z[side] * .62), [target, side]);
  const to = useMemo(() => new THREE.Vector3(target[0], SURFACE + .052, target[2]), [target]);
  const nudgePoint = useMemo(() => nudge ? new THREE.Vector3(nudge[0], SURFACE + .05, nudge[1]) : null, [nudge]);
  useFrame(({ clock }) => {
    const hand = group.current;
    if (!hand) return;
    const key = String(motion.token);
    if (keyed.current !== key) { keyed.current = key; started.current = clock.elapsedTime; }
    const duration = Math.max(.001, motion.duration / 1000);
    const t = THREE.MathUtils.clamp((clock.elapsedTime - started.current) / duration, 0, 1);
    const enter = t < .3 ? 1 - Math.pow(1 - t / .3, 3) : 1;
    const leave = t > .78 ? (t - .78) / .22 : 0;
    hand.position.lerpVectors(from, to, enter * (1 - leave));
    if (nudgePoint) {
      const reach = t > .4 && t < .58 ? Math.sin(((t - .4) / .18) * Math.PI) * .5 : 0;
      if (reach > 0) hand.position.lerp(nudgePoint, reach);
      hand.position.y -= reach * .006;
    }
  });
  return <group ref={group} position={from} visible={!instant}>
    <HandShape side={side} />
  </group>;
}

function TradeHands({ motion, layout, reduced, instant }: { motion: TradeMotion; layout: TradeLayout; reduced: boolean; instant: boolean }) {
  if (reduced || instant || motion.phase === 'idle' || !motion.handSide) return null;
  const approach = (side: Side, target: [number, number, number]): [number, number, number] => [target[0], target[1], target[2] + (side === 'a' ? -.085 : .085)];
  const hands: { side: Side; target: [number, number, number]; nudge?: [number, number] | null }[] = [];
  if (motion.mode === 'handoff') {
    hands.push({ side: 'b', target: approach('b', layout.chipsHandoff) }, { side: 'a', target: approach('a', layout.lotHandoff) });
  } else if (motion.phase === 'withdraw' && motion.collect) {
    hands.push({ side: motion.handSide, target: approach(motion.handSide, layout.tray) });
  } else {
    const nudge: [number, number] | null = motion.handSide === LOT_SIDE ? [layout.lotHome[0], layout.lotHome[2]] : null;
    hands.push({ side: motion.handSide, target: approach(motion.handSide, layout.quote), nudge });
  }
  return <group>
    {hands.map(hand => <TradeHand key={`${hand.side}:${motion.phase}:${motion.token}`} side={hand.side} motion={motion} target={hand.target} nudge={hand.nudge} instant={instant} />)}
  </group>;
}

function TradeObjects({ table, motion, scenarioId, you, reduced, instant, finished, deal, dealPrice }: {
  table: TableState; motion: TradeMotion; scenarioId: string; you: Side; reduced: boolean; instant: boolean;
  finished: boolean; deal: boolean; dealPrice: number | null;
}) {
  const layout = useMemo(() => tradeLayout(you), [you]);
  const standing = table.offer;
  const accepted = !!standing && table.agreement?.offerId === standing.id;
  const settledPrice = finished && deal ? (dealPrice ?? table.agreement?.price ?? standing?.price ?? 0) : (standing?.price ?? table.agreement?.price ?? 0);
  const accent = finished && deal || accepted ? '#D3A284' : standing ? ACCENT[standing.side] : '#8f7a62';
  let spot: 'tray' | 'quote' | 'seller' = finished ? (deal ? 'seller' : 'tray') : settledPrice > 0 ? 'quote' : 'tray';
  if (!finished && motion.phase === 'place') spot = 'quote';
  else if (!finished && motion.phase === 'withdraw' && motion.collect) spot = 'tray';
  else if (finished && motion.phase === 'handoff') spot = 'seller';
  const quoteLabel = !finished && spot !== 'tray' && settledPrice > 0 ? `${accepted ? '协议' : '报价'} ${settledPrice} 枚` : null;
  const lotSpot = finished && deal ? 'handoff' : 'home';
  return <group>
    <ChipTray layout={layout} />
    <QuoteSpot layout={layout} />
    <Chips count={settledPrice} spot={spot} accent={accent} layout={layout} instant={instant} reduced={reduced} />
    <LotTray scenarioId={scenarioId} spot={lotSpot} layout={layout} instant={instant} reduced={reduced} />
    <PaperTag text="桌面筹码" accent="#8f7a62" position={[layout.tray[0], SURFACE + .135, layout.tray[2]]} width={.31} height={.078} />
    {quoteLabel && <PaperTag text={quoteLabel} accent={accent} position={[layout.quote[0], SURFACE + .15, layout.quote[2]]} width={.33} height={.083} />}
    <TradeHands motion={motion} layout={layout} reduced={reduced} instant={instant} />
  </group>;
}

function TableObjects({ table, active, step, forward, finished }: { table: TableState; active?: ActionUnit; step: number; forward: number; finished: boolean }) {
  const latestClaim = table.claims.at(-1), latestEvidence = table.evidence.at(-1);
  const promiseSeal = table.promises.some(promise => !!table.offer && promise.conditionId === table.offer.id && !promise.broken);
  const challenge = table.challenges.at(-1);
  const pulse = step >= 2;
  return <group>
    {table.offer
      ? <OfferCard side={table.offer.side} price={table.offer.price} accepted={table.agreement?.offerId === table.offer.id} sealed={promiseSeal} forward={forward} active={!!active && pulse && active.offer?.id === table.offer.id} />
      : <PaperTag text="等待第一份报价" accent="#708294" muted position={[-1.12 * forward, 1.1, 1.15 * forward]} width={.42} height={.1} />}
    {table.agreement
      ? <AgreementCard price={table.agreement.price} pending={!finished} forward={forward} active={!!active && pulse && !!active.agreement} />
      : <PaperTag text="协议尚未合意" accent="#8f7a62" muted position={[1.16 * forward, 1.1, 1.15 * forward]} width={.4} height={.095} />}
    {latestClaim && <MaterialCard title={`${AGENT_NAMES[latestClaim.side]} · 公开声明`} text={latestClaim.text} side={latestClaim.side} position={[-1.14 * forward, 1.53, 1.15 * forward]} width={.56} height={.35} active={!!active && pulse && !!active.claim} />}
    {latestEvidence && <MaterialCard title="已翻开 · 查验凭证" text={latestEvidence.text} position={[1.18 * forward, 1.53, 1.15 * forward]} width={.56} height={.35} active={!!active && pulse && !!active.evidence} />}
    {challenge && <mesh position={[0, .95, .92 * forward]}><boxGeometry args={[1.95, .018, .018]} /><meshBasicMaterial color="#d77d6f" transparent opacity={.8} /></mesh>}
  </group>;
}

function WatermarkSeal({ active }: { active: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.z = clock.elapsedTime * (active ? .4 : .12);
  });
  return <mesh ref={ref} position={[0, TABLE_Y + .225, 0]} rotation-x={Math.PI / 2}>
    <torusGeometry args={[.18, .008, 8, 32]} />
    <meshBasicMaterial color="#D3A284" transparent opacity={active ? .8 : .35} />
  </mesh>;
}

function Dust({ reduced }: { reduced: boolean }) {
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const values = new Float32Array(120 * 3);
    let seed = 17;
    const next = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 120; i++) {
      values[i * 3] = (next() - .5) * 9;
      values[i * 3 + 1] = next() * 4.2;
      values[i * 3 + 2] = (next() - .5) * 9;
    }
    return values;
  }, []);
  useFrame((_, delta) => { if (!reduced && ref.current) ref.current.rotation.y += delta * .006; });
  return <points ref={ref}>
    <bufferGeometry>
      <bufferAttribute attach="attributes-position" args={[positions, 3]} />
    </bufferGeometry>
    <pointsMaterial size={.018} color="#9db8cc" transparent opacity={.32} depthWrite={false} sizeAttenuation />
  </points>;
}

type ProgressRef = { current: number };
function cutFactor(progress: ProgressRef, finished: boolean, deal: boolean, delay: number) {
  if (!finished || deal) return 1;
  return 1 - THREE.MathUtils.clamp((progress.current * 2.7 - delay) / .45, 0, 1);
}

function StormWindow({ forward, act, reduced, finished, deal, progress }: { forward: number; act: number; reduced: boolean; finished: boolean; deal: boolean; progress: ProgressRef }) {
  const texture = useCardTexture(`rain:${forward}`, () => rainTexture());
  const pane = useRef<THREE.MeshBasicMaterial>(null), cold = useRef<THREE.PointLight>(null);
  useFrame(({ clock }, delta) => {
    const cut = cutFactor(progress, finished, deal, .8);
    texture.offset.y = (clock.elapsedTime * (.08 + act * .05)) % 1;
    if (pane.current) pane.current.opacity = dampValue(pane.current.opacity, (.32 + act * .08) * cut, 2.4, delta, reduced);
    if (cold.current) cold.current.intensity = dampValue(cold.current.intensity, (2.2 + act * .7) * cut, 2.4, delta, reduced);
  });
  return <group position={[0, 0, 5.45 * forward]} rotation-y={forward > 0 ? Math.PI : 0}>
    <mesh position={[0, 2.2, -.015]}>
      <planeGeometry args={[4.75, 2.55]} />
      <meshStandardMaterial color="#111820" roughness={.85} transparent opacity={.55} />
    </mesh>
    <mesh position={[0, 2.2, .015]}>
      <planeGeometry args={[4.6, 2.4]} />
      <meshBasicMaterial ref={pane} map={texture} transparent opacity={.4} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </mesh>
    {[-2.36, 2.36].map(x => <mesh key={`s${x}`} position={[x, 2.2, .1]}><boxGeometry args={[.1, 2.55, .12]} /><meshStandardMaterial color="#1a232e" roughness={.6} metalness={.35} /></mesh>)}
    {[-1.18, 1.18].map(y => <mesh key={`h${y}`} position={[0, 2.2 + y, .1]}><boxGeometry args={[4.75, .1, .12]} /><meshStandardMaterial color="#1a232e" roughness={.6} metalness={.35} /></mesh>)}
    {[-1.55, 0, 1.55].map(x => <mesh key={`m${x}`} position={[x, 2.2, .1]}><boxGeometry args={[.045, 2.35, .08]} /><meshStandardMaterial color="#26313d" roughness={.55} metalness={.3} /></mesh>)}
    <mesh position={[0, 2.2, .12]}>
      <planeGeometry args={[4.5, 2.3]} />
      <meshBasicMaterial color="#5d92bd" transparent opacity={.035} depthWrite={false} />
    </mesh>
    <pointLight ref={cold} position={[.4, 2.1, .8]} color="#7fb6dc" intensity={3} distance={7} decay={2} />
  </group>;
}

function EmergencyLamp({ position, act, reduced, finished, deal, progress }: { position: [number, number, number]; act: number; reduced: boolean; finished: boolean; deal: boolean; progress: ProgressRef }) {
  const light = useRef<THREE.PointLight>(null), lamp = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }, delta) => {
    const cut = cutFactor(progress, finished, deal, .45);
    const pulse = act >= 3 && !reduced ? .4 + Math.sin(clock.elapsedTime * 3.4) * .12 : .55;
    if (light.current) light.current.intensity = dampValue(light.current.intensity, (2.1 + act * .8) * cut, 2.4, delta, reduced);
    if (lamp.current) lamp.current.emissiveIntensity = dampValue(lamp.current.emissiveIntensity, pulse * cut, 2.4, delta, reduced);
  });
  return <group position={position}>
    <mesh position={[0, .95, 0]}><boxGeometry args={[.08, 1.9, .08]} /><meshStandardMaterial color="#1c242d" roughness={.5} metalness={.4} /></mesh>
    <mesh position={[0, .06, 0]}><boxGeometry args={[.36, .06, .36]} /><meshStandardMaterial color="#161d25" roughness={.7} /></mesh>
    <mesh position={[0, 1.96, .05]}>
      <boxGeometry args={[.3, .18, .22]} />
      <meshStandardMaterial ref={lamp} color="#ff8f4a" emissive="#ff8f4a" emissiveIntensity={.55} roughness={.4} />
    </mesh>
    <mesh position={[0, 1.84, .16]} rotation-x={-.55}>
      <coneGeometry args={[.26, .2, 12, 1, true]} />
      <meshStandardMaterial color="#3a2a1d" roughness={.6} metalness={.25} side={THREE.DoubleSide} />
    </mesh>
    <mesh position={[0, 1.74, .3]} rotation-x={-Math.PI / 2}>
      <circleGeometry args={[.2, 16]} />
      <meshBasicMaterial color="#ff9d5c" transparent opacity={.16} depthWrite={false} />
    </mesh>
    <pointLight ref={light} position={[0, 1.82, .5]} color="#ff8f4a" intensity={2.2} distance={5.5} decay={2} />
  </group>;
}

function Puddle({ position, scale, finished, deal, progress }: { position: [number, number, number]; scale: [number, number]; finished: boolean; deal: boolean; progress: ProgressRef }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((_, delta) => {
    if (mat.current) mat.current.opacity = dampValue(mat.current.opacity, cutFactor(progress, finished, deal, 1.6) * .55, 2, delta, false);
  });
  return <group position={[position[0], .024, position[2]]}>
    <mesh rotation-x={-Math.PI / 2} scale={[scale[0], scale[1], 1]}>
      <circleGeometry args={[1, 40]} />
      <meshStandardMaterial ref={mat} color="#102330" emissive="#213a4e" emissiveIntensity={.55} roughness={.12} metalness={.62} transparent opacity={.55} />
    </mesh>
    <mesh rotation-x={-Math.PI / 2} position-y={.004} scale={[scale[0], scale[1], 1]}>
      <ringGeometry args={[.92, 1.02, 40]} />
      <meshBasicMaterial color="#4f86ac" transparent opacity={.18} depthWrite={false} />
    </mesh>
  </group>;
}

function BatteryCrate({ position, act, reduced }: { position: [number, number, number]; act: number; reduced: boolean }) {
  const led = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (led.current) led.current.emissiveIntensity = reduced ? .8 : .55 + Math.sin(clock.elapsedTime * 2.4 + act) * .25;
  });
  return <group position={position} rotation-y={-.18}>
    <mesh position={[0, .32, 0]} castShadow><boxGeometry args={[.86, .64, .6]} /><meshStandardMaterial color="#24313d" roughness={.55} metalness={.35} /></mesh>
    <mesh position={[0, .68, 0]}><boxGeometry args={[.76, .08, .52]} /><meshStandardMaterial color="#1a2530" roughness={.5} metalness={.3} /></mesh>
    {[-.28, -.14, 0, .14, .28].map(x => <mesh key={x} position={[x, .38, .31]}><boxGeometry args={[.07, .18, .02]} /><meshStandardMaterial color="#151b22" roughness={.7} /></mesh>)}
    <mesh position={[.3, .55, .31]}><boxGeometry args={[.05, .05, .02]} /><meshStandardMaterial ref={led} color="#ff9d5c" emissive="#ff8f4a" emissiveIntensity={.6} /></mesh>
    <mesh position={[.3, .55, .35]}><pointLight color="#ff9d5c" intensity={.6} distance={1.1} decay={2} /></mesh>
    <mesh position={[.16, .45, .31]}><boxGeometry args={[.05, .05, .02]} /><meshStandardMaterial color="#7fb6dc" emissive="#5f9ec9" emissiveIntensity={.4} /></mesh>
    <mesh position={[0, .3, .34]} rotation-z={.02}><planeGeometry args={[.4, .12]} /><meshBasicMaterial color="#9db3c4" transparent opacity={.25} depthWrite={false} /></mesh>
    <mesh position={[0, .76, .2]}><boxGeometry args={[.62, .025, .3]} /><meshBasicMaterial color="#6f9ec4" transparent opacity={.18} depthWrite={false} /></mesh>
    <pointLight position={[0, 1.1, .5]} color="#6f9ec4" intensity={.5} distance={1.6} decay={2} />
  </group>;
}

function SetBattery({ forward, act, reduced, finished, deal, progress }: { forward: number; act: number; reduced: boolean; finished: boolean; deal: boolean; progress: ProgressRef }) {
  return <group>
    <StormWindow forward={forward} act={act} reduced={reduced} finished={finished} deal={deal} progress={progress} />
    <EmergencyLamp position={[-2.35 * forward, 0, 2.55 * forward]} act={act} reduced={reduced} finished={finished} deal={deal} progress={progress} />
    <BatteryCrate position={[2.05 * forward, 0, 2.6 * forward]} act={act} reduced={reduced} />
    <Puddle position={[-1.75 * forward, 0, 3.15 * forward]} scale={[1, .55]} finished={finished} deal={deal} progress={progress} />
    <Puddle position={[1.35 * forward, 0, 1.55 * forward]} scale={[.55, .4]} finished={finished} deal={deal} progress={progress} />
    <pointLight position={[1.35 * forward, .35, 1.55 * forward]} color="#5f9ec9" intensity={.9} distance={2.2} decay={2} />
  </group>;
}

function FogBank({ forward, act, reduced, finished, deal, progress }: { forward: number; act: number; reduced: boolean; finished: boolean; deal: boolean; progress: ProgressRef }) {
  const texture = useCardTexture(`fog:${forward}`, () => fogTexture());
  const materials = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  useFrame(({ clock }, delta) => {
    const cut = cutFactor(progress, finished, deal, .9);
    texture.offset.x = (clock.elapsedTime * .006) % 1;
    const opacity = (.062 + act * .016) * cut;
    materials.current.forEach((material, index) => { if (material) material.opacity = dampValue(material.opacity, opacity * (index ? .65 : 1), 2, delta, reduced); });
  });
  return <group position={[0, 0, 4.35 * forward]} rotation-y={forward > 0 ? Math.PI : 0}>
    {[[0, 1.6, .7], [-1.7, 2.15, .45], [1.8, 1.15, .3]].map(([x, y, z], index) => <mesh key={index} position={[x, y, z]}>
      <planeGeometry args={[6.8, 2.9]} />
      <meshBasicMaterial ref={value => { materials.current[index] = value; }} map={texture} transparent opacity={.06} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </mesh>)}
  </group>;
}

function ShipBell({ position, act, reduced }: { position: [number, number, number]; act: number; reduced: boolean }) {
  const bell = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (bell.current && !reduced) bell.current.rotation.z = Math.sin(clock.elapsedTime * .65 + act) * (.035 + act * .012);
  });
  return <group position={position}>
    {[-.4, .4].map(x => <mesh key={x} position={[x, .82, 0]}><boxGeometry args={[.1, 1.64, .1]} /><meshStandardMaterial color="#3a3228" roughness={.72} /></mesh>)}
    <mesh position={[0, 1.64, 0]}><boxGeometry args={[.94, .12, .14]} /><meshStandardMaterial color="#3a3228" roughness={.72} /></mesh>
    <group ref={bell} position={[0, 1.5, 0]}>
      <mesh position={[0, -.45, 0]}><cylinderGeometry args={[.16, .3, .42, 18, 1, true]} /><meshStandardMaterial color="#b08b4d" metalness={.55} roughness={.35} side={THREE.DoubleSide} /></mesh>
      <mesh position={[0, -.26, 0]}><cylinderGeometry args={[.27, .16, .06, 18]} /><meshStandardMaterial color="#c29b57" metalness={.5} roughness={.32} /></mesh>
      <mesh position={[0, -.7, 0]}><sphereGeometry args={[.06, 10, 8]} /><meshStandardMaterial color="#6b562f" metalness={.4} roughness={.5} /></mesh>
      <mesh position={[0, -.12, 0]}><cylinderGeometry args={[.018, .018, .16, 8]} /><meshStandardMaterial color="#3c3226" roughness={.7} /></mesh>
    </group>
    <pointLight position={[0, 1.3, .5]} color="#ffb15c" intensity={1.7} distance={3} decay={2} />
  </group>;
}

function TideClock({ position, act, reduced, finished, deal, progress }: { position: [number, number, number]; act: number; reduced: boolean; finished: boolean; deal: boolean; progress: ProgressRef }) {
  const dialTexture = useCardTexture('tide-clock', () => clockTexture('潮汐'));
  const minute = useRef<THREE.Group>(null), hour = useRef<THREE.Group>(null), rim = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }, delta) => {
    const cut = cutFactor(progress, finished, deal, 1.3);
    const drift = act >= 3 && !reduced ? clock.elapsedTime * .05 : 0;
    if (minute.current) minute.current.rotation.z = dampValue(minute.current.rotation.z, -(.3 + act * .9 + drift), 2, delta, reduced);
    if (hour.current) hour.current.rotation.z = dampValue(hour.current.rotation.z, -(.1 + act * .5), 2, delta, reduced);
    if (rim.current) rim.current.emissiveIntensity = dampValue(rim.current.emissiveIntensity, (.4 + act * .1) * cut, 2, delta, reduced);
  });
  return <group>
    <mesh position={[position[0], .9, position[2]]}><cylinderGeometry args={[.045, .06, 1.8, 10]} /><meshStandardMaterial color="#2a241d" roughness={.7} /></mesh>
    <mesh position={[position[0], .04, position[2]]}><cylinderGeometry args={[.3, .36, .08, 16]} /><meshStandardMaterial color="#231f18" roughness={.7} /></mesh>
    <Billboard position={position}>
      <mesh><circleGeometry args={[.42, 40]} /><meshBasicMaterial map={dialTexture} toneMapped={false} transparent /></mesh>
      <mesh position-z={-.012}><ringGeometry args={[.41, .45, 40]} /><meshStandardMaterial ref={rim} color="#a97f4d" emissive="#c28d54" emissiveIntensity={.4} metalness={.4} roughness={.4} /></mesh>
      <group ref={hour} position-z={.028}><mesh position={[0, .09, 0]}><boxGeometry args={[.03, .18, .012]} /><meshBasicMaterial color="#3a2f22" /></mesh></group>
      <group ref={minute} position-z={.036}><mesh position={[0, .14, 0]}><boxGeometry args={[.018, .28, .01]} /><meshBasicMaterial color="#5b4730" /></mesh></group>
      <mesh position-z={.03}><circleGeometry args={[.025, 12]} /><meshBasicMaterial color="#c49a74" /></mesh>
    </Billboard>
  </group>;
}

function SodiumLamp({ position, act, reduced, finished, deal, progress }: { position: [number, number, number]; act: number; reduced: boolean; finished: boolean; deal: boolean; progress: ProgressRef }) {
  const light = useRef<THREE.PointLight>(null), glow = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }, delta) => {
    const cut = cutFactor(progress, finished, deal, .6);
    const flicker = act >= 3 && !reduced ? 1 + Math.sin(clock.elapsedTime * 5.3) * .08 : 1;
    if (light.current) light.current.intensity = dampValue(light.current.intensity, (2.4 + act * .5) * cut * flicker, 2.4, delta, reduced);
    if (glow.current) glow.current.emissiveIntensity = dampValue(glow.current.emissiveIntensity, .65 * cut, 2.4, delta, reduced);
  });
  return <group position={position}>
    <mesh position={[0, 1.1, 0]}><cylinderGeometry args={[.05, .07, 2.2, 10]} /><meshStandardMaterial color="#27241e" roughness={.6} metalness={.3} /></mesh>
    <mesh position={[0, .05, 0]}><cylinderGeometry args={[.24, .3, .08, 12]} /><meshStandardMaterial color="#211e19" roughness={.8} /></mesh>
    <mesh position={[0, 2.22, 0]}>
      <cylinderGeometry args={[.2, .13, .24, 12, 1, true]} />
      <meshStandardMaterial ref={glow} color="#ffb15c" emissive="#ffb15c" emissiveIntensity={.65} roughness={.4} side={THREE.DoubleSide} />
    </mesh>
    <mesh position={[0, 2.32, 0]}><sphereGeometry args={[.09, 10, 8]} /><meshStandardMaterial color="#ffd39b" emissive="#ffb15c" emissiveIntensity={.9} /></mesh>
    <pointLight ref={light} position={[0, 2.05, .25]} color="#ffb15c" intensity={2.4} distance={6} decay={2} />
  </group>;
}

function CargoStack({ position, act, reduced }: { position: [number, number, number]; act: number; reduced: boolean }) {
  const rock = useRef<THREE.Group>(null);
  useFrame(({ clock }) => { if (rock.current && !reduced) rock.current.rotation.y = Math.sin(clock.elapsedTime * .18 + act) * .008; });
  return <group position={position} ref={rock}>
    <mesh position={[0, .3, 0]} castShadow><boxGeometry args={[.9, .6, .7]} /><meshStandardMaterial color="#4b4236" roughness={.86} /></mesh>
    <mesh position={[.28, .62, -.1]} rotation-y={.24} castShadow><boxGeometry args={[.62, .44, .55]} /><meshStandardMaterial color="#3f3a31" roughness={.9} /></mesh>
    {[-.3, 0, .3].map(x => <mesh key={x} position={[x, .3, .355]}><boxGeometry args={[.07, .56, .02]} /><meshStandardMaterial color="#6b5c48" roughness={.8} /></mesh>)}
    <mesh position={[0, .55, .36]}><boxGeometry args={[.3, .12, .01]} /><meshBasicMaterial color="#c29b57" transparent opacity={.5} /></mesh>
    <mesh position={[0, .07, 0]}><boxGeometry args={[1.0, .06, .8]} /><meshStandardMaterial color="#2a251f" roughness={.9} /></mesh>
  </group>;
}

function SetFerry({ forward, act, reduced, finished, deal, progress }: { forward: number; act: number; reduced: boolean; finished: boolean; deal: boolean; progress: ProgressRef }) {
  return <group>
    <FogBank forward={forward} act={act} reduced={reduced} finished={finished} deal={deal} progress={progress} />
    <ShipBell position={[2.35 * forward, 0, 2.15 * forward]} act={act} reduced={reduced} />
    <TideClock position={[-2.5 * forward, 1.45, 2.55 * forward]} act={act} reduced={reduced} finished={finished} deal={deal} progress={progress} />
    <CargoStack position={[2.65 * forward, 0, 1.45 * forward]} act={act} reduced={reduced} />
    <CargoStack position={[-2.1 * forward, 0, 3.1 * forward]} act={act} reduced={reduced} />
    <SodiumLamp position={[-2.35 * forward, 0, 2.35 * forward]} act={act} reduced={reduced} finished={finished} deal={deal} progress={progress} />
  </group>;
}

function ArchiveShelf({ position, finished, deal, progress }: { position: [number, number, number]; finished: boolean; deal: boolean; progress: ProgressRef }) {
  const lamp = useRef<THREE.PointLight>(null);
  useFrame((_, delta) => {
    if (lamp.current) lamp.current.intensity = dampValue(lamp.current.intensity, 1.1 * cutFactor(progress, finished, deal, 1.1), 2, delta, false);
  });
  return <group position={position} rotation-y={position[0] > 0 ? -.32 : .32}>
    {[-.78, .78].map(x => <mesh key={x} position={[x, 1.35, 0]}><boxGeometry args={[.08, 2.7, .42]} /><meshStandardMaterial color="#241d15" roughness={.85} /></mesh>)}
    {[.12, .92, 1.72, 2.52].map(y => <mesh key={y} position={[0, y, 0]}><boxGeometry args={[1.62, .06, .42]} /><meshStandardMaterial color="#2d241a" roughness={.88} /></mesh>)}
    {[.42, 1.22, 2.02].map((y, row) => [0, 1, 2, 3].map(column => <mesh key={`${row}-${column}`} position={[-.58 + column * .38, y + .17, .02]} rotation-y={column % 2 ? .05 : -.04}>
      <boxGeometry args={[.3, .34, .26]} />
      <meshStandardMaterial color={row === 1 ? '#6b5a42' : '#574832'} roughness={.92} />
      <mesh position={[0, 0, .135]}><boxGeometry args={[.16, .05, .01]} /><meshBasicMaterial color="#c8b18c" transparent opacity={.6} /></mesh>
    </mesh>))}
    <mesh position={[0, 2.74, .02]}><boxGeometry args={[1.7, .04, .46]} /><meshStandardMaterial color="#1c1711" roughness={.9} /></mesh>
    <pointLight ref={lamp} position={[0, 2.2, .5]} color="#e6b06a" intensity={1.1} distance={3.4} decay={2} />
  </group>;
}

function DeskLamp({ position, act, reduced, finished, deal, progress }: { position: [number, number, number]; act: number; reduced: boolean; finished: boolean; deal: boolean; progress: ProgressRef }) {
  const light = useRef<THREE.PointLight>(null), shade = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }, delta) => {
    const cut = cutFactor(progress, finished, deal, .55);
    const flicker = act >= 3 && !reduced ? .9 + Math.sin(clock.elapsedTime * 7.2) * .06 + Math.sin(clock.elapsedTime * 2.1) * .04 : 1;
    if (light.current) light.current.intensity = dampValue(light.current.intensity, (2.3 + act * .35) * cut * flicker, 2.2, delta, reduced);
    if (shade.current) shade.current.emissiveIntensity = dampValue(shade.current.emissiveIntensity, .45 * cut, 2.2, delta, reduced);
  });
  return <group position={position}>
    <mesh position={[0, .36, 0]}><boxGeometry args={[.7, .72, .52]} /><meshStandardMaterial color="#3a2d1f" roughness={.8} /></mesh>
    <mesh position={[0, .74, 0]}><boxGeometry args={[.76, .04, .58]} /><meshStandardMaterial color="#4a3825" roughness={.7} /></mesh>
    <mesh position={[0, .96, 0]}><cylinderGeometry args={[.025, .035, .42, 8]} /><meshStandardMaterial color="#4e3d28" metalness={.35} roughness={.45} /></mesh>
    <mesh position={[0, 1.22, 0]} rotation-z={.22}>
      <cylinderGeometry args={[.1, .2, .2, 14, 1, true]} />
      <meshStandardMaterial ref={shade} color="#c99a5f" emissive="#e6b06a" emissiveIntensity={.45} roughness={.5} side={THREE.DoubleSide} />
    </mesh>
    <pointLight ref={light} position={[0, 1.12, .15]} color="#e6b06a" intensity={2.3} distance={4.2} decay={2} />
  </group>;
}

function SealedBags({ position, finished, deal, progress }: { position: [number, number, number]; finished: boolean; deal: boolean; progress: ProgressRef }) {
  const seal = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((_, delta) => {
    if (seal.current) seal.current.opacity = dampValue(seal.current.opacity, .75 * cutFactor(progress, finished, deal, 1.5), 2, delta, false);
  });
  return <group position={position}>
    <mesh position={[0, .28, 0]}><boxGeometry args={[.78, .56, .5]} /><meshStandardMaterial color="#2c2419" roughness={.82} /></mesh>
    <mesh position={[0, .58, 0]}><boxGeometry args={[.84, .04, .56]} /><meshStandardMaterial color="#3a2f20" roughness={.7} /></mesh>
    {[[-.16, .66, -.1, .16], [.16, .66, .02, -.12]].map(([x, y, z, rot], index) => <group key={index} position={[x, y, z]} rotation-y={rot}>
      <mesh rotation-x={-.06}><boxGeometry args={[.42, .07, .3]} /><meshStandardMaterial color="#d8c9ad" roughness={.94} /></mesh>
      <mesh position={[0, .04, 0]}><boxGeometry args={[.12, .012, .09]} /><meshBasicMaterial ref={index === 0 ? seal : undefined} color="#b33a2f" transparent opacity={.75} /></mesh>
    </group>)}
    <mesh position={[0, .74, -.12]} rotation-z={-.1}><boxGeometry args={[.34, .02, .2]} /><meshBasicMaterial color="#8c7a5c" transparent opacity={.35} /></mesh>
  </group>;
}

function ArchiveMotes({ reduced }: { reduced: boolean }) {
  const positions = useMemo(() => {
    const values = new Float32Array(60 * 3);
    let seed = 29;
    const next = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 60; i++) {
      values[i * 3] = (next() - .5) * 3.2;
      values[i * 3 + 1] = .6 + next() * 2.4;
      values[i * 3 + 2] = (next() - .5) * 2.4;
    }
    return values;
  }, []);
  const ref = useRef<THREE.Points>(null);
  useFrame(({ clock }) => { if (ref.current && !reduced) ref.current.rotation.y = Math.sin(clock.elapsedTime * .05) * .06; });
  return <points ref={ref} position={[0, 0, 0]}>
    <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry>
    <pointsMaterial size={.014} color="#d8b184" transparent opacity={.22} depthWrite={false} sizeAttenuation />
  </points>;
}

function SetArchive({ forward, act, reduced, finished, deal, progress }: { forward: number; act: number; reduced: boolean; finished: boolean; deal: boolean; progress: ProgressRef }) {
  return <group>
    <ArchiveShelf position={[-2.7 * forward, 0, 3.2 * forward]} finished={finished} deal={deal} progress={progress} />
    <ArchiveShelf position={[2.2 * forward, 0, 2.35 * forward]} finished={finished} deal={deal} progress={progress} />
    <DeskLamp position={[2.55 * forward, 0, 2.55 * forward]} act={act} reduced={reduced} finished={finished} deal={deal} progress={progress} />
    <SealedBags position={[-2.55 * forward, 0, 2.15 * forward]} finished={finished} deal={deal} progress={progress} />
    <ArchiveMotes reduced={reduced} />
  </group>;
}

function SetDressing({ scenarioId, forward, act, reduced, finished, deal, instant }: { scenarioId: string; forward: number; act: number; reduced: boolean; finished: boolean; deal: boolean; instant: boolean }) {
  const progress = useEndingProgress(finished, deal, instant);
  const shared = { forward, act, reduced, finished, deal, progress };
  if (scenarioId === 'last-ferry') return <SetFerry {...shared} />;
  if (scenarioId === 'silent-archive') return <SetArchive {...shared} />;
  return <SetBattery {...shared} />;
}

function EndingCeremony({ forward, deal, price, reduced, instant }: { forward: number; deal: boolean; price: number | null; reduced: boolean; instant: boolean }) {
  const paperTexture = useCardTexture(`contract:${price ?? 0}:final`, () => {
    const texture = contractTexture(price ?? 0);
    texture.center.set(.5, .5); texture.rotation = Math.PI;
    return texture;
  });
  const paper = useRef<THREE.Group>(null), seal = useRef<THREE.Group>(null), warm = useRef<THREE.PointLight>(null);
  const sheets = useRef<(THREE.Mesh | null)[]>([]);
  const progress = useEndingProgress(true, deal, instant);
  const start = useRef<number | null>(null);
  const sheetStarts = useMemo(() => [[-1.05, 1.06], [.92, .72], [-.72, -.94], [.78, -.62]], []);
  useFrame(({ clock }, delta) => {
    const elapsed = start.current === null ? (start.current = clock.elapsedTime) : clock.elapsedTime - start.current;
    if (deal) {
      const t = instant ? 1 : THREE.MathUtils.clamp(elapsed / 1.45, 0, 1);
      const ease = t * t * (3 - 2 * t);
      if (paper.current) {
        paper.current.position.z = (-1.05 + 2.05 * ease) * forward;
        paper.current.position.y = SURFACE + .004 + (instant ? 0 : Math.sin(ease * Math.PI) * .14);
      }
      if (seal.current) {
        if (instant) seal.current.scale.setScalar(1);
        else {
          const stamp = THREE.MathUtils.clamp((elapsed - .5) / .35, 0, 1);
          seal.current.scale.setScalar(THREE.MathUtils.damp(seal.current.scale.x, stamp, 12, delta));
          seal.current.position.y = SURFACE + .026 - (1 - stamp) * .3;
        }
      }
      if (warm.current) warm.current.intensity = dampValue(warm.current.intensity, instant ? 3.4 : elapsed < 1.1 ? 6.5 : 3.4, 3, delta, reduced);
      return;
    }
    const g = instant ? 1 : THREE.MathUtils.clamp((progress.current * 2.6 - .95) / 1.35, 0, 1);
    sheets.current.forEach((sheet, index) => {
      if (!sheet) return;
      const [fromX, fromZ] = sheetStarts[index];
      sheet.position.x = fromX * forward * (1 - g);
      sheet.position.z = fromZ * forward * (1 - g) - index * .004 * forward;
      sheet.position.y = TABLE_Y + .018 + index * .003 + (instant ? 0 : Math.sin(g * Math.PI) * .08 * (1 - g));
      sheet.rotation.z = (1 - g) * (index % 2 ? .18 : -.14);
    });
    if (warm.current) warm.current.intensity = dampValue(warm.current.intensity, 0, 2, delta, reduced);
  });
  return <group>
    {deal && price !== null ? <>
      <group ref={paper} position={[0, SURFACE + .004, -1.05 * forward]} rotation-x={-Math.PI / 2}>
        <mesh><planeGeometry args={[.62, .3875]} /><meshBasicMaterial map={paperTexture} toneMapped={false} /></mesh>
        <mesh position-z={-.004}><planeGeometry args={[.68, .45]} /><meshBasicMaterial color="#d3a284" transparent opacity={.12} depthWrite={false} /></mesh>
      </group>
      <group ref={seal} position={[-.12 * forward, SURFACE + .026, .9 * forward]} scale={0}>
        <mesh><cylinderGeometry args={[.06, .064, .016, 20]} /><meshStandardMaterial color="#c58b3b" emissive="#d9a24f" emissiveIntensity={.55} metalness={.55} roughness={.36} /></mesh>
        <mesh position-y={.011}><torusGeometry args={[.038, .006, 8, 24]} /><meshBasicMaterial color="#8e5c24" /></mesh>
      </group>
    </> : <>
      {sheetStarts.map(([x, z], index) => <mesh
        key={index}
        ref={value => { sheets.current[index] = value; }}
        position={[x * forward, TABLE_Y + .02, z * forward]}
        rotation-x={-Math.PI / 2}
      >
        <planeGeometry args={[.46, .32]} />
        <meshStandardMaterial color={index % 2 ? '#d6c8ae' : '#cabda4'} roughness={.94} side={THREE.DoubleSide} transparent opacity={.72} />
      </mesh>)}
    </>}
    <pointLight ref={warm} position={[0, 1.45, .25 * forward]} color="#ffd3a1" intensity={0} distance={4.2} decay={2} />
  </group>;
}

function Lights({ opponentZ, act, scenarioId, opponentSpeaking, ownSpeaking, finished, deal, reduced, instant }: {
  opponentZ: number; act: number; scenarioId: string; opponentSpeaking: boolean; ownSpeaking: boolean;
  finished: boolean; deal: boolean; reduced: boolean; instant: boolean;
}) {
  const ambient = useRef<THREE.AmbientLight>(null), direction = useRef<THREE.DirectionalLight>(null);
  const opponent = useRef<THREE.PointLight>(null), own = useRef<THREE.PointLight>(null), spot = useRef<THREE.SpotLight>(null);
  const fill = useRef<THREE.PointLight>(null), fillWide = useRef<THREE.PointLight>(null);
  const table = useRef<THREE.PointLight>(null), overhead = useRef<THREE.PointLight>(null);
  const sconceA = useRef<THREE.PointLight>(null), sconceB = useRef<THREE.PointLight>(null);
  const progress = useEndingProgress(finished, deal, instant);
  const mood = moodFor(act);
  const colors = useMemo(() => {
    const tone = sceneTone(scenarioId);
    const blend = (base: string, accent: string, weight: number) => new THREE.Color(base).lerp(new THREE.Color(accent), weight);
    return {
      ambient: blend(mood.ambient, tone.cold, act === 1 ? .22 : .08),
      direction: blend(mood.direction, tone.cold, act === 1 ? .3 : .1),
      opponent: act === 1 ? blend(mood.opponent, tone.cold, .45) : act === 3 ? new THREE.Color(tone.warm).lerp(new THREE.Color(mood.opponent), .42) : new THREE.Color(mood.opponent),
      own: blend(mood.own, tone.cold, .25),
      spot: act === 1 ? blend(mood.spot, tone.cold, .4) : blend(mood.spot, tone.warm, act === 3 ? .32 : .12),
      table: new THREE.Color(tone.warm),
    };
  }, [act, scenarioId]);
  useFrame(({ gl }, delta) => {
    const p = progress.current;
    const cut = (delay: number) => finished && !deal ? 1 - THREE.MathUtils.clamp((p * 2.7 - delay) / .45, 0, 1) : 1;
    if (ambient.current) {
      dampColor(ambient.current.color, colors.ambient, 2.8, delta, instant);
      ambient.current.intensity = dampValue(ambient.current.intensity, (finished && !deal ? .06 : mood.ambientLevel) * cut(1.9), 2.8, delta, instant);
    }
    if (direction.current) {
      dampColor(direction.current.color, colors.direction, 2.8, delta, instant);
      direction.current.intensity = dampValue(direction.current.intensity, mood.directionLevel * cut(1.2), 2.8, delta, instant);
      direction.current.position.y = dampValue(direction.current.position.y, mood.directionY, 2.8, delta, instant);
    }
    if (opponent.current) {
      dampColor(opponent.current.color, colors.opponent, 2.8, delta, instant);
      opponent.current.intensity = dampValue(opponent.current.intensity, mood.opponentLevel * (opponentSpeaking ? 1.3 : 1) * cut(.5), 2.8, delta, instant);
    }
    if (own.current) {
      dampColor(own.current.color, colors.own, 2.8, delta, instant);
      own.current.intensity = dampValue(own.current.intensity, mood.ownLevel * (ownSpeaking ? 1.25 : 1) * cut(1.35), 2.8, delta, instant);
    }
    if (spot.current) {
      dampColor(spot.current.color, colors.spot, 2.8, delta, instant);
      spot.current.intensity = dampValue(spot.current.intensity, mood.spotLevel * cut(.7), 2.8, delta, instant);
      spot.current.angle = dampValue(spot.current.angle, mood.spotAngle, 2.8, delta, instant);
    }
    if (fill.current) fill.current.intensity = dampValue(fill.current.intensity, 3.2 * cut(.35), 2.8, delta, instant);
    if (fillWide.current) fillWide.current.intensity = dampValue(fillWide.current.intensity, 2.4 * cut(.55), 2.8, delta, instant);
    if (table.current) {
      dampColor(table.current.color, colors.table, 2.8, delta, instant);
      table.current.intensity = dampValue(table.current.intensity, mood.tableLevel * cut(1.7), 2.8, delta, instant);
    }
    if (overhead.current) overhead.current.intensity = dampValue(overhead.current.intensity, 5.2 * cut(.9), 2.8, delta, instant);
    if (sconceA.current) sconceA.current.intensity = dampValue(sconceA.current.intensity, 1.5 * cut(1.05), 2.8, delta, instant);
    if (sconceB.current) sconceB.current.intensity = dampValue(sconceB.current.intensity, 1.35 * cut(1.45), 2.8, delta, instant);
    const exposure = finished && !deal ? .82 : mood.exposure + (finished && deal ? .04 : 0);
    gl.toneMappingExposure = dampValue(gl.toneMappingExposure, exposure, 2.2, delta, instant);
  });
  return <group>
    <ambientLight ref={ambient} intensity={mood.ambientLevel} color={mood.ambient} />
    <directionalLight ref={direction} position={[2.5, mood.directionY, 3]} intensity={mood.directionLevel} color={mood.direction} />
    <pointLight ref={opponent} position={[0, 2.45, opponentZ]} color={colors.opponent.getStyle()} intensity={mood.opponentLevel} distance={7} decay={2} />
    <pointLight ref={own} position={[0, 2.35, -opponentZ]} color={mood.own} intensity={mood.ownLevel} distance={7} decay={2} />
    <spotLight ref={spot} position={[0, 3.6, opponentZ * .55]} angle={mood.spotAngle} penumbra={.82} intensity={mood.spotLevel} distance={10} color={mood.spot} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
    <pointLight ref={fill} position={[0, 1.62, opponentZ - .62]} color={sceneTone(scenarioId).warm} intensity={3.2} distance={2.6} decay={2} />
    <pointLight ref={fillWide} position={[0, 1.85, opponentZ + 1.1]} color={sceneTone(scenarioId).warm} intensity={2.4} distance={3.2} decay={2} />
    <pointLight ref={table} position={[0, TABLE_Y + .2, 0]} color={colors.table.getStyle()} intensity={mood.tableLevel} distance={1.4} decay={2} />
    <pointLight ref={overhead} position={[0, 2.15, .1]} color="#b9cddd" intensity={5.2} distance={5.2} decay={2} />
    <pointLight ref={sconceA} position={[0, 1.1, 2.3]} color={sceneTone(scenarioId).warm} intensity={1.5} distance={2.2} decay={2} />
    <pointLight ref={sconceB} position={[0, 1.1, -2.3]} color={sceneTone(scenarioId).warm} intensity={1.35} distance={2.2} decay={2} />
  </group>;
}

function CameraRig({ you, reduced }: { you: Side; reduced: boolean }) {
  const { gl } = useThree();
  const pose = useMemo(() => cameraPose(you), [you]);
  const drag = useRef({ active: false, lastX: 0, lastY: 0, yaw: 0, pitch: 0, release: false });
  useEffect(() => {
    const element = gl.domElement;
    const down = (event: PointerEvent) => { drag.current.active = true; drag.current.lastX = event.clientX; drag.current.lastY = event.clientY; element.setPointerCapture?.(event.pointerId); };
    const move = (event: PointerEvent) => {
      if (!drag.current.active) return;
      drag.current.yaw = THREE.MathUtils.clamp(drag.current.yaw + (event.clientX - drag.current.lastX) * .0018, -.24, .24);
      drag.current.pitch = THREE.MathUtils.clamp(drag.current.pitch + (event.clientY - drag.current.lastY) * .0014, -.1, .1);
      drag.current.lastX = event.clientX; drag.current.lastY = event.clientY;
    };
    const up = (event: PointerEvent) => { drag.current.active = false; element.releasePointerCapture?.(event.pointerId); };
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', up);
    return () => {
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', up);
    };
  }, [gl]);
  useFrame(({ clock, camera: activeCamera }, delta) => {
    const time = clock.elapsedTime;
    const position = pose.position;
    activeCamera.position.copy(position);
    if (!reduced) activeCamera.position.y += Math.sin(time * .9) * .004;
    if (!drag.current.active) {
      drag.current.yaw = THREE.MathUtils.damp(drag.current.yaw, 0, 2.6, delta);
      drag.current.pitch = THREE.MathUtils.damp(drag.current.pitch, 0, 2.6, delta);
    }
    const target = pose.target.clone();
    target.x += Math.sin(drag.current.yaw) * 2.9;
    target.y += Math.sin(drag.current.pitch) * 2.1 + (reduced ? 0 : Math.sin(time * .7) * .004);
    activeCamera.lookAt(target);
  });
  return null;
}

export interface Stage3DProps {
  room: RoomView;
  table: TableState;
  active?: ActionUnit;
  selected?: ActionUnit;
  step: number;
  review: string | null;
  speaking: Side | null;
  reduced: boolean;
  ambienceEnabled: boolean;
}

function cueFor(unit: ActionUnit): AmbienceCue {
  if (unit.breaches.length) return 'breach';
  if (unit.challenge) return 'challenge';
  if (unit.kind === 'verify' || unit.evidence) return 'page';
  if (unit.kind === 'accept' || unit.agreement) return 'stamp';
  if (unit.kind === 'offer' || unit.offer) return 'chip';
  return 'paper';
}

export default function Stage3D({ room, table, active, selected, step, review, speaking, reduced, ambienceEnabled }: Stage3DProps) {
  const opponent = other(room.you);
  const unit = review ? selected : active;
  const live = review ? undefined : active;
  const acting = !!unit && unit.side === opponent && step >= 1;
  const pose = cameraPose(room.you);
  const opponentName = AGENT_NAMES[opponent];
  const opponentRole = room.scenario.roles[opponent];
  const opponentSpeaking = speaking === opponent;
  const ownSpeaking = speaking === room.you;
  const tone = sceneTone(room.scenario.id);
  const finished = room.status === 'finished';
  const deal = finished && room.outcome?.price != null;
  const forward = room.you === 'a' ? 1 : -1;
  const ceremonyKey = `whisper-ceremony:${room.code}:${deal ? 'deal' : 'fail'}`;
  const played = useMemo(() => { try { return sessionStorage.getItem(ceremonyKey) === '1'; } catch { return false; } }, [ceremonyKey]);
  useEffect(() => { if (finished) { try { sessionStorage.setItem(ceremonyKey, '1'); } catch { /* ceremony memory is optional */ } } }, [finished, ceremonyKey]);
  const instantCeremony = reduced || played;
  const motion = useTradeDirector({ table, active: live, step, review, reduced, finished, deal });
  const instantTrade = reduced || !!review;
  const ambience = useRef<ReturnType<typeof createAmbience> | null>(null);
  const cuePlayed = useRef('');
  const endedCue = useRef(false);
  const lastAct = useRef(room.act);
  useEffect(() => {
    const controller = createAmbience(ambienceEnabled && !finished);
    ambience.current = controller;
    return () => { controller.dispose(); ambience.current = null; };
  }, [room.scenario.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!finished || endedCue.current) return;
    endedCue.current = true;
    ambience.current?.trigger(deal ? 'deal' : 'lightsOut');
    ambience.current?.end();
  }, [finished, deal]);
  useEffect(() => { ambience.current?.setEnabled(ambienceEnabled && !finished); }, [ambienceEnabled, finished]);
  useEffect(() => { ambience.current?.setDucked(!!speaking); }, [speaking]);
  useEffect(() => {
    if (lastAct.current === room.act) return;
    lastAct.current = room.act;
    if (room.status === 'playing') ambience.current?.trigger('act');
  }, [room.act, room.status]);
  useEffect(() => {
    if (!live || step < 2) return;
    const key = `${live.id}:change`;
    if (cuePlayed.current === key) return;
    cuePlayed.current = key;
    ambience.current?.trigger(cueFor(live));
  }, [live?.id, step]);
  return <div className="stage-3d is-full" role="img" aria-label={`${room.scenario.title} 3D 第一视角谈判桌`} data-scene={room.scenario.id} data-act={room.act} data-ceremony={finished ? deal ? 'deal' : 'fail' : 'none'} data-chips="12" data-lot={room.scenario.id} data-offer={table.offer ? `${table.offer.side}:${table.offer.price}` : 'none'} data-agreement={table.agreement ? String(table.agreement.price) : 'none'} data-trade={motion.phase}>
    <Canvas
      shadows
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      camera={{ fov: 50, near: .05, far: 40, position: [pose.position.x, pose.position.y, pose.position.z] }}
      onCreated={({ camera, gl }) => { gl.toneMappingExposure = moodFor(room.act).exposure; camera.lookAt(pose.target); }}
    >
      <color attach="background" args={[tone.far]} />
      <fog attach="fog" args={tone.fog} />
      <Room title={room.scenario.title} object={room.scenario.object} scenarioId={room.scenario.id} />
      <Table />
      <SetDressing scenarioId={room.scenario.id} forward={forward} act={room.act} reduced={reduced} finished={finished} deal={deal} instant={instantCeremony} />
      <WatermarkSeal active={step >= 2 && !!active} />
      <OpponentAgent side={opponent} acting={acting} step={step} speaking={opponentSpeaking} reduced={reduced} unit={finished ? undefined : step >= 1 ? unit : undefined} />
      <Nameplate side={opponent} name={opponentName} role={opponentRole} highlight={finished && deal} reduced={reduced} />
      <OwnDesk side={room.you} highlight={finished && deal} reduced={reduced} />
      <TableObjects table={table} active={unit} step={step} forward={forward} finished={finished} />
      <TradeObjects table={table} motion={motion} scenarioId={room.scenario.id} you={room.you} reduced={reduced} instant={instantTrade} finished={finished} deal={deal} dealPrice={room.outcome?.price ?? null} />
      <Dust reduced={reduced} />
      {finished && <EndingCeremony forward={forward} deal={deal} price={room.outcome?.price ?? null} reduced={reduced} instant={instantCeremony} />}
      <Lights opponentZ={SEAT_Z[opponent]} act={room.act} scenarioId={room.scenario.id} opponentSpeaking={opponentSpeaking} ownSpeaking={ownSpeaking} finished={finished} deal={deal} reduced={reduced} instant={instantCeremony} />
      <CameraRig you={room.you} reduced={reduced} />
      <FrameCamera />
    </Canvas>
    <span className="stage-3d-badge">3D · {room.you === 'a' ? '甲' : '乙'}方席位</span>
    <span className="stage-3d-hint">拖动画面可略微转头</span>
  </div>;
}

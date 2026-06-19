import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, OrbitControls, PerspectiveCamera } from '@react-three/drei';
import useImage from 'use-image';
import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  LinearFilter,
  Matrix4,
  MeshStandardMaterial,
  PerspectiveCamera as ThreePerspectiveCamera,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type { InstancedMesh } from 'three';

import type { LoadedPhoto } from '../photoIngest';
import { computeLegoFaceTextureSize, renderLegoFaceCanvas } from '../lego/faceRender';
import {
  STUD_HEIGHT_CELLS,
  STUD_RADIUS_CELLS,
  brickTransform,
  facePlaneTransform,
  panelDimensions,
  panelScale,
  studPositions,
} from '../lego/preview3d';
import type { Face, LegoSet } from '../lego/types';

type Props = {
  set: LegoSet;
  face: Face;
  frontPhoto: LoadedPhoto | null;
  backPhoto: LoadedPhoto | null;
  background: string;
  transparentBg: boolean;
  closeUp: boolean;
  closeUpTightness: number;
  brickColor?: string;
  previewSrc?: string | null;
};

export function LegoPreview3D({
  set,
  face,
  frontPhoto,
  backPhoto,
  background,
  transparentBg,
  closeUp,
  closeUpTightness,
  brickColor = '#f4f1ea',
  previewSrc,
}: Props) {
  const webglAvailable = useMemo(() => canUseWebGL(), []);
  if (!webglAvailable) return <Lego3DFallback previewSrc={previewSrc} />;

  return (
    <div className="cm-lego-3d-shell">
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        shadows
        resize={{ scroll: false, debounce: { scroll: 50, resize: 0 } }}
        style={{ display: 'block', width: '100%', height: '100%' }}
        gl={{ antialias: true, alpha: true }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
        }}
      >
        <CanvasResizer />
        <PerspectiveCamera makeDefault fov={34} position={[2, 2.5, 14]} near={0.1} far={80} />
        <CameraRig face={face} />
        <ambientLight intensity={0.72} />
        <hemisphereLight intensity={0.9} color="#ffffff" groundColor="#7d756d" />
        <directionalLight position={[5, 6, 7]} intensity={1.4} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
        <LegoPanel3D
          set={set}
          frontPhoto={frontPhoto}
          backPhoto={backPhoto}
          background={background}
          transparentBg={transparentBg}
          closeUp={closeUp}
          closeUpTightness={closeUpTightness}
          brickColor={brickColor}
        />
        <ContactShadows position={[0, -5.2, 0]} scale={12} blur={2.4} opacity={0.22} far={6} />
      </Canvas>
    </div>
  );
}

function CanvasResizer() {
  const { camera, gl, invalidate, setSize } = useThree();

  useLayoutEffect(() => {
    const parent = gl.domElement.parentElement;
    if (!parent) return undefined;

    const resize = () => {
      const rect = parent.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      setSize(rect.width, rect.height);
      gl.setSize(rect.width, rect.height, false);
      if (camera instanceof ThreePerspectiveCamera) {
        camera.aspect = rect.width / rect.height;
        camera.updateProjectionMatrix();
      }
      invalidate();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [camera, gl, invalidate, setSize]);

  return null;
}

function LegoPanel3D({
  set,
  frontPhoto,
  backPhoto,
  background,
  transparentBg,
  closeUp,
  closeUpTightness,
  brickColor,
}: {
  set: LegoSet;
  frontPhoto: LoadedPhoto | null;
  backPhoto: LoadedPhoto | null;
  background: string;
  transparentBg: boolean;
  closeUp: boolean;
  closeUpTightness: number;
  brickColor: string;
}) {
  const scale = panelScale(set);
  return (
    <group scale={[scale, scale, scale]} rotation={[-0.08, -0.08, 0]}>
      <BrickBodies set={set} brickColor={brickColor} />
      <Studs set={set} brickColor={brickColor} />
      <FacePlane
        set={set}
        face="front"
        photo={frontPhoto}
        background={background}
        transparentBg={transparentBg}
        closeUp={closeUp}
        closeUpTightness={closeUpTightness}
      />
      <FacePlane
        set={set}
        face="back"
        photo={backPhoto}
        background={background}
        transparentBg={transparentBg}
        closeUp={closeUp}
        closeUpTightness={closeUpTightness}
      />
    </group>
  );
}

function BrickBodies({ set, brickColor }: { set: LegoSet; brickColor: string }) {
  const meshRef = useRef<InstancedMesh>(null);
  const geometry = useMemo(() => new BoxGeometry(1, 1, 1), []);
  const material = useMemo(
    () => new MeshStandardMaterial({ color: brickColor, roughness: 0.72, metalness: 0.02 }),
    [brickColor]
  );

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const matrix = new Matrix4();
    const quaternion = new Quaternion();
    for (let index = 0; index < set.bricks.length; index++) {
      const transform = brickTransform(set.bricks[index], set.cols, set.rows);
      matrix.compose(
        new Vector3(...transform.position),
        quaternion,
        new Vector3(...transform.scale)
      );
      mesh.setMatrixAt(index, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [set]);

  return (
    <instancedMesh ref={meshRef} args={[geometry, material, set.bricks.length]} castShadow receiveShadow />
  );
}

function Studs({ set, brickColor }: { set: LegoSet; brickColor: string }) {
  const studs = useMemo(() => studPositions(set), [set]);
  const meshRef = useRef<InstancedMesh>(null);
  const geometry = useMemo(() => new CylinderGeometry(STUD_RADIUS_CELLS, STUD_RADIUS_CELLS, STUD_HEIGHT_CELLS, 20), []);
  const material = useMemo(
    () => new MeshStandardMaterial({ color: brickColor, roughness: 0.66, metalness: 0.01, transparent: true, opacity: 0.72 }),
    [brickColor]
  );

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const matrix = new Matrix4();
    const quaternion = new Quaternion();
    const scale = new Vector3(1, 1, 1);
    for (let index = 0; index < studs.length; index++) {
      matrix.compose(new Vector3(...studs[index].position), quaternion, scale);
      mesh.setMatrixAt(index, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [studs]);

  return <instancedMesh ref={meshRef} args={[geometry, material, studs.length]} castShadow receiveShadow />;
}

function FacePlane({
  set,
  face,
  photo,
  background,
  transparentBg,
  closeUp,
  closeUpTightness,
}: {
  set: LegoSet;
  face: Face;
  photo: LoadedPhoto | null;
  background: string;
  transparentBg: boolean;
  closeUp: boolean;
  closeUpTightness: number;
}) {
  const [image] = useImage(photo?.src ?? '');
  const textureSize = useMemo(() => computeLegoFaceTextureSize(set), [set]);
  const texture = useMemo(() => {
    const canvas = renderLegoFaceCanvas({
      set,
      photo,
      image,
      framing: photo?.manualFrame ?? null,
      pxW: textureSize.width,
      pxH: textureSize.height,
      background,
      transparentBg,
      closeUp,
      closeUpTightness,
      seams: { show: false, color: '#050505', width: 1 },
    });
    const next = new CanvasTexture(canvas);
    next.colorSpace = SRGBColorSpace;
    next.minFilter = LinearFilter;
    next.magFilter = LinearFilter;
    next.needsUpdate = true;
    return next;
  }, [background, closeUp, closeUpTightness, image, photo, set, textureSize.height, textureSize.width, transparentBg]);

  useEffect(() => () => texture.dispose(), [texture]);

  const transform = facePlaneTransform(face);
  const size = panelDimensions(set);
  return (
    <mesh position={transform.position} rotation={transform.rotation}>
      <planeGeometry args={[size.width, size.height]} />
      <meshBasicMaterial map={texture} transparent toneMapped={false} />
    </mesh>
  );
}

function CameraRig({ face }: { face: Face }) {
  const { camera, invalidate } = useThree();
  const controlsRef = useRef<any>(null);
  const animationRef = useRef<{ from: Vector3; to: Vector3; startedAt: number } | null>(null);
  const distance = 14;
  const heightOffset = 2.5;
  const sideOffset = 2;

  useEffect(() => {
    const target = new Vector3(face === 'front' ? sideOffset : -sideOffset, heightOffset, face === 'front' ? distance : -distance);
    animationRef.current = {
      from: camera.position.clone(),
      to: target,
      startedAt: performance.now(),
    };
    invalidate();
  }, [camera, distance, face, heightOffset, invalidate, sideOffset]);

  useFrame(() => {
    const animation = animationRef.current;
    if (!animation) return;
    const elapsed = performance.now() - animation.startedAt;
    const t = Math.min(1, elapsed / 520);
    const eased = 1 - Math.pow(1 - t, 3);
    camera.position.lerpVectors(animation.from, animation.to, eased);
    camera.lookAt(0, 0, 0);
    controlsRef.current?.update();
    if (t < 1) invalidate();
    else animationRef.current = null;
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      minDistance={8}
      maxDistance={24}
      minPolarAngle={0.22}
      maxPolarAngle={Math.PI - 0.22}
      onChange={() => invalidate()}
    />
  );
}

function Lego3DFallback({ previewSrc }: { previewSrc?: string | null }) {
  return (
    <div className="cm-lego-3d-fallback">
      {previewSrc ? <img src={previewSrc} alt="" /> : <span>3D preview unavailable</span>}
      <small>WebGL is not available in this browser view.</small>
    </div>
  );
}

function canUseWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

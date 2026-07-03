// 3D Three.js 기반 전신 skeleton 렌더러.
//
// 박스(실린더)로 뼈대를 구성하고 관절별 Group 회전으로 자세를 표현.
// 마우스 드래그로 시점 회전 지원.
// ES 모듈로 작성 — index.html 의 import map 을 통해 three 로드.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const BONE_COLOR = 0x0f766e;
const BONE_COLOR_LIGHT = 0x5eead4;
const JOINT_COLOR = 0x0d9488;
const HEAD_COLOR = 0x134e4a;

const DEG = Math.PI / 180;

// 3D skeleton 인스턴스 관리 (단일 캔버스 재사용)
let scene, camera, renderer, controls;
let skeletonRoot; // 전체 skeleton의 최상위 Group
let resizeObserver;

// 뼈를 만드는 헬퍼: (길이, 두께, 색상) → mesh. 원점이 한쪽 끝(부모 관절).
function makeBone(length, thickness = 0.35, color = BONE_COLOR) {
  const geo = new THREE.CylinderGeometry(thickness, thickness, length, 12);
  // 실린더의 중심이 아닌 한쪽 끝이 원점이 되도록 geometry 이동
  geo.translate(0, -length / 2, 0);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1 });
  const mesh = new THREE.Mesh(geo, mat);
  return mesh;
}

// 관절 구 (시각적 강조)
function makeJoint(r = 0.22) {
  const geo = new THREE.SphereGeometry(r, 16, 12);
  const mat = new THREE.MeshStandardMaterial({ color: JOINT_COLOR, roughness: 0.5 });
  return new THREE.Mesh(geo, mat);
}

// 전체 skeleton 계층 구조 생성 (최초 1회).
// 반환된 Group의 자식들을 관절 참조로 보관해 각도를 업데이트한다.
function buildSkeleton() {
  const root = new THREE.Group();

  // === 몸통 계층 ===
  // hips (골반) — 최상위
  const hips = new THREE.Group();
  hips.position.set(0, 0, 0);
  root.add(hips);

  // 골반 바
  const pelvis = makeBone(0.9, 0.18, BONE_COLOR);
  pelvis.rotation.z = Math.PI / 2;
  hips.add(pelvis);

  // spine → trunk → chest (몸통)
  const spine = new THREE.Group();
  spine.position.set(0, 0.0, 0);
  hips.add(spine);
  const trunkBone = makeBone(1.4, 0.45, BONE_COLOR);
  spine.add(trunkBone);
  // trunk 굴곡은 spine 그룹의 X축 회전으로 표현 (전방 굴곡 = +X)

  // chest (어깨 높이)
  const chest = new THREE.Group();
  chest.position.set(0, 1.4, 0);
  spine.add(chest);

  // 어깨 바
  const shoulderBar = makeBone(1.5, 0.16, BONE_COLOR_LIGHT);
  shoulderBar.rotation.z = Math.PI / 2;
  chest.add(shoulderBar);

  // === 목 & 머리 ===
  const neck = new THREE.Group();
  neck.position.set(0, 0.1, 0);
  chest.add(neck);
  const neckBone = makeBone(0.45, 0.14, BONE_COLOR);
  neck.add(neckBone);
  // 목 굴곡은 neck 그룹의 X축 회전

  const head = new THREE.Group();
  head.position.set(0, 0.45, 0);
  neck.add(head);
  const headMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 24, 18),
    new THREE.MeshStandardMaterial({ color: HEAD_COLOR, roughness: 0.5 })
  );
  headMesh.position.set(0, 0.25, 0);
  head.add(headMesh);

  // === 왼쪽 팔 ===
  const shoulderL = new THREE.Group();
  shoulderL.position.set(-0.78, 0, 0);
  chest.add(shoulderL);
  const upperArmL = makeBone(0.95, 0.16, BONE_COLOR);
  shoulderL.add(upperArmL);
  // 어깨 회전: X축(flexion/들어올림), Z축(abduction/옆으로 벌림)

  const elbowL = new THREE.Group();
  elbowL.position.set(0, -0.95, 0);
  shoulderL.add(elbowL);
  const foreArmL = makeBone(0.85, 0.14, BONE_COLOR_LIGHT);
  elbowL.add(foreArmL);

  const wristL = new THREE.Group();
  wristL.position.set(0, -0.85, 0);
  elbowL.add(wristL);
  const handL = makeBone(0.35, 0.12, 0x14b8a6);
  wristL.add(handL);

  // === 오른쪽 팔 (대칭) ===
  const shoulderR = new THREE.Group();
  shoulderR.position.set(0.78, 0, 0);
  chest.add(shoulderR);
  const upperArmR = makeBone(0.95, 0.16, BONE_COLOR);
  shoulderR.add(upperArmR);

  const elbowR = new THREE.Group();
  elbowR.position.set(0, -0.95, 0);
  shoulderR.add(elbowR);
  const foreArmR = makeBone(0.85, 0.14, BONE_COLOR_LIGHT);
  elbowR.add(foreArmR);

  const wristR = new THREE.Group();
  wristR.position.set(0, -0.85, 0);
  elbowR.add(wristR);
  const handR = makeBone(0.35, 0.12, 0x14b8a6);
  wristR.add(handR);

  // === 왼쪽 다리 ===
  const hipL = new THREE.Group();
  hipL.position.set(-0.35, 0, 0);
  hips.add(hipL);
  const thighL = makeBone(1.1, 0.2, BONE_COLOR);
  hipL.add(thighL);

  const kneeL = new THREE.Group();
  kneeL.position.set(0, -1.1, 0);
  hipL.add(kneeL);
  const shinL = makeBone(1.05, 0.17, BONE_COLOR_LIGHT);
  kneeL.add(shinL);

  const ankleL = new THREE.Group();
  ankleL.position.set(0, -1.05, 0);
  kneeL.add(ankleL);
  const footL = makeBone(0.4, 0.12, 0x14b8a6);
  footL.rotation.x = Math.PI / 2;
  ankleL.add(footL);

  // === 오른쪽 다리 (대칭) ===
  const hipR = new THREE.Group();
  hipR.position.set(0.35, 0, 0);
  hips.add(hipR);
  const thighR = makeBone(1.1, 0.2, BONE_COLOR);
  hipR.add(thighR);

  const kneeR = new THREE.Group();
  kneeR.position.set(0, -1.1, 0);
  hipR.add(kneeR);
  const shinR = makeBone(1.05, 0.17, BONE_COLOR_LIGHT);
  kneeR.add(shinR);

  const ankleR = new THREE.Group();
  ankleR.position.set(0, -1.05, 0);
  kneeR.add(ankleR);
  const footR = makeBone(0.4, 0.12, 0x14b8a6);
  footR.rotation.x = Math.PI / 2;
  ankleR.add(footR);

  // 관절 강조 구 추가
  for (const g of [chest, shoulderL, shoulderR, elbowL, elbowR, hipL, hipR, kneeL, kneeR]) {
    g.add(makeJoint(0.18));
  }

  // 관절 참조 반환
  return {
    root,
    hips,
    spine,
    neck,
    head,
    shoulderL,
    shoulderR,
    elbowL,
    elbowR,
    wristL,
    wristR,
    hipL,
    hipR,
    kneeL,
    kneeR,
    ankleL,
    ankleR,
  };
}

// 초기화 (최초 1회).
function init3D(container) {
  const w = container.clientWidth || 320;
  const h = 340;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf8fafc);

  camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 100);
  camera.position.set(0, -0.5, 7);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  // 조명
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(3, 5, 4);
  scene.add(dir);
  const dir2 = new THREE.DirectionalLight(0xffffff, 0.3);
  dir2.position.set(-3, 2, -2);
  scene.add(dir2);

  // 바닥면 (그리드)
  const grid = new THREE.GridHelper(6, 12, 0xcbd5e1, 0xe2e8f0);
  grid.position.y = -2.4;
  scene.add(grid);

  // skeleton 생성
  const refs = buildSkeleton();
  skeletonRoot = refs.root;
  skeletonRoot.position.y = 1.0; // 바닥 위로 올림
  scene.add(skeletonRoot);

  // OrbitControls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.minDistance = 4;
  controls.maxDistance = 12;
  controls.target.set(0, 0, 0);

  // 리사이즈 대응
  resizeObserver = new ResizeObserver(() => {
    const nw = container.clientWidth || 320;
    const nh = 340;
    camera.aspect = nw / nh;
    camera.updateProjectionMatrix();
    renderer.setSize(nw, nh);
  });
  resizeObserver.observe(container);

  // 참조 보관 (refs를 클로저로)
  skeletonRefs = refs;

  animate();
}

let skeletonRefs = null;

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

// pose(관절 파라미터) 적용.
function applyPose(pose) {
  if (!skeletonRefs) return;
  const r = skeletonRefs;

  // 몸통 굴곡 (앞으로 기울임 = +X 회전). 양수 각도 = 전방 굴곡.
  r.spine.rotation.x = pose.trunk * DEG;
  // 몸통 비틀림/측면
  r.spine.rotation.y = pose.flags.trunkTwist ? 0.5 : 0;
  r.spine.rotation.z = pose.flags.trunkLateral ? 0.3 : 0;

  // 목 굴곡
  r.neck.rotation.x = pose.neck * DEG * 0.7;
  r.neck.rotation.y = pose.flags.neckTwist ? 0.5 : 0;
  r.neck.rotation.z = pose.flags.neckLateral ? 0.3 : 0;

  // 어깨 (상완 들어올림). 상완의 기본 방향은 -Y(아래쪽).
  // 앞으로 들어올림(flexion) = -X 회전, 옆으로 벌림(abduction) = Z 회전.
  r.shoulderL.rotation.set(0, 0, 0);
  r.shoulderR.rotation.set(0, 0, 0);
  r.shoulderL.rotation.x = -pose.shoulderL * DEG; // -X = 앞쪽 들어올림
  r.shoulderR.rotation.x = -pose.shoulderR * DEG;
  if (pose.flags.abduct) {
    r.shoulderL.rotation.z = pose.shoulderL * DEG * 0.7;
    r.shoulderR.rotation.z = -pose.shoulderR * DEG * 0.7;
  }

  // 팔꿈치 굴곡 (전완이 접힘)
  r.elbowL.rotation.x = -pose.elbowL * DEG;
  r.elbowR.rotation.x = -pose.elbowR * DEG;

  // 손목 굴곡
  r.wristL.rotation.x = -pose.wristL * DEG;
  r.wristR.rotation.x = -pose.wristR * DEG;
  if (pose.flags.wristDeviate) {
    r.wristL.rotation.z = 0.4;
    r.wristR.rotation.z = -0.4;
  }

  // 무릎 굴곡
  r.kneeL.rotation.x = pose.kneeL * DEG;
  r.kneeR.rotation.x = pose.kneeR * DEG;

  // posture 조정
  if (pose.posture === "sitting") {
    r.hipL.rotation.x = -Math.PI / 2 * 0.85;
    r.hipR.rotation.x = -Math.PI / 2 * 0.85;
    r.kneeL.rotation.x = Math.PI / 2 * 0.85;
    r.kneeR.rotation.x = Math.PI / 2 * 0.85;
  } else if (pose.posture === "squat") {
    r.hipL.rotation.x = -1.0;
    r.hipR.rotation.x = -1.0;
    r.kneeL.rotation.x = 1.6;
    r.kneeR.rotation.x = 1.6;
    skeletonRoot.position.y = 0.3;
  } else if (pose.posture === "kneel") {
    r.hipL.rotation.x = -1.4;
    r.hipR.rotation.x = -1.4;
    r.kneeL.rotation.x = 2.4;
    r.kneeR.rotation.x = 2.4;
    skeletonRoot.position.y = -0.3;
  } else if (pose.posture === "lunge") {
    r.hipL.rotation.x = -0.8;
    r.hipR.rotation.x = -0.3;
    r.kneeL.rotation.x = 1.4;
    r.kneeR.rotation.x = 0.5;
    skeletonRoot.position.y = 0.6;
  } else if (pose.posture === "standing_unstable") {
    r.hipR.rotation.x = -0.2;
    r.kneeR.rotation.x = 0.5;
    skeletonRoot.position.y = 1.0;
  } else {
    skeletonRoot.position.y = 1.0;
  }

  // shrug (어깨 올림) — chest 그룹을 약간 위로
  if (pose.flags.shrug) {
    r.chest?.position.setY?.(1.5);
  }
}

// 외부 진입점: 컨테이너에 3D skeleton 렌더링.
function render3D(container, pose) {
  if (!renderer) {
    init3D(container);
  }
  applyPose(pose);
}

// 3D 해제 (토글로 2D로 전환 시 리소스 정리)
function dispose3D() {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (renderer) {
    renderer.dispose();
    if (renderer.domElement.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
    renderer = null;
    scene = null;
    camera = null;
    controls = null;
    skeletonRefs = null;
  }
}

// 전역 노출 (하위 호환)
window.Skeleton3D = { render: render3D, dispose: dispose3D };

// ES 모듈 export (main.js 모듈화 대응)
export { render3D as render, dispose3D as dispose };

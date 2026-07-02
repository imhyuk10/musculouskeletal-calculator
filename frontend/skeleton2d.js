// 2D SVG 기반 전신 skeleton 렌더러.
//
// 관절 각도를 적용해 전신 skeleton을 SVG로 그린다.
// 정면 뷰를 기본으로 하되, 각도(굴곡)는 측면 투영 효과로 표현.
//   - shoulder 각도: 팔을 앞으로 들면 아래로 내려오는 것처럼 표현 (flexion)
//   - trunk/neck 굴곡: 상체를 앞으로 기울임
//   - 비틀림/측면 플래그: 좌우 비대칭으로 표현

const BONE_COLOR = "#0f766e";
const BONE_COLOR_LIGHT = "#5eead4";
const JOINT_COLOR = "#0d9488";
const HEAD_COLOR = "#134e4a";

// 골격 길이 비율 (viewBox 200x320 기준)
const L = {
  headR: 16,
  neckLen: 22,
  trunkLen: 70,
  shoulderWidth: 50,
  hipWidth: 36,
  upperArm: 48,
  foreArm: 42,
  hand: 16,
  thigh: 60,
  shin: 56,
  foot: 20,
};

const DEG = Math.PI / 180;

// 2D 벡터: (x,y)에서 각도 angle(라디안) 방향으로 length 만큼 이동한 점.
// angle 정의: 0=아래쪽(+y), 시계방향 양수. flexion(앞굴곡)은 +x 방향.
function polar(x, y, angle, len) {
  return [x + Math.sin(angle) * len, y + Math.cos(angle) * len];
}

// skeleton 렌더링. container: SVG를 채울 div, pose: skeleton.js의 관절 파라미터.
function render2D(container, pose) {
  const W = 200, H = 320;
  const cx = W / 2;

  // posture에 따른 기본 자세 조정
  let baseY = 60; // 머리 상단 y
  let hipDrop = 0; // 골반 위치 보정
  if (pose.posture === "sitting" || pose.posture === "kneel") {
    hipDrop = -50; // 골반을 위로 (앉음/무릎꿇음)
  } else if (pose.posture === "squat") {
    hipDrop = -35;
  } else if (pose.posture === "lunge") {
    hipDrop = -15;
  }

  // --- 머리 & 목 ---
  const headCy = baseY + L.headR;
  const headCx = cx + pose.flags.neckLateral ? 8 : 0;
  // 목 굴곡: 머리를 앞으로 기울임. neck 각도 양수=앞굴곡.
  const neckBaseX = cx;
  const neckBaseY = headCy + L.headR;
  const neckAngle = pose.neck * DEG;
  const neckEnd = polar(neckBaseX, neckBaseY, neckAngle, L.neckLen);

  // --- 몸통 ---
  const trunkAngle = pose.trunk * DEG;
  // trunkTwist/TrunkLateral 은 시각적 비대칭으로 표현
  const trunkTilt = pose.flags.trunkLateral ? 0.12 : pose.flags.trunkTwist ? 0.06 : 0;
  const trunkEnd = polar(
    neckEnd[0] + trunkTilt * 10,
    neckEnd[1],
    trunkAngle + trunkTilt,
    L.trunkLen
  );

  // --- 어깨 ---
  const shoulderY = neckEnd[1] + (trunkEnd[1] - neckEnd[1]) * 0.15;
  const shoulderAngle = Math.atan2(trunkEnd[0] - neckEnd[0], trunkEnd[1] - neckEnd[1]);
  // 어깨는 몸통에 수직
  const shL = [
    neckEnd[0] - Math.cos(shoulderAngle) * L.shoulderWidth * 0.5,
    neckEnd[1] + Math.sin(shoulderAngle) * L.shoulderWidth * 0.5,
  ];
  const shR = [
    neckEnd[0] + Math.cos(shoulderAngle) * L.shoulderWidth * 0.5,
    neckEnd[1] - Math.sin(shoulderAngle) * L.shoulderWidth * 0.5,
  ];
  const shoulderYpos = shoulderY;

  // --- 팔 (상완 + 전완 + 손) ---
  // shoulder 각도: 0=옆에 늘어뜨림, 양수=앞으로 들어올림(flexion)
  // abduct 플래그: 팔을 옆으로 벌림 (정면 뷰에서 좌우 벌림)
  function buildArm(shoulderPt, shoulderDeg, elbowDeg, wristDeg, side) {
    // side: -1=왼쪽, +1=오른쪽
    let armAngle;
    if (pose.flags.abduct) {
      // 외전: 정면에서 옆으로 벌림 (x축 방향)
      armAngle = side * (Math.PI / 2) * (0.3 + shoulderDeg / 180);
    } else {
      // flexion: 앞쪽(측면 투영 → 아래/위로 표현)
      // shoulderDeg=0 → 팔이 아래로, =90 → 수평, =100 → 약간 위
      armAngle = shoulderDeg * DEG;
    }
    const elbow = polar(shoulderPt[0], shoulderPt[1], armAngle, L.upperArm);
    // 팔꿈치 굴곡: 전완이 상완 방향에서 꺾임
    const forearmAngle = armAngle - elbowDeg * DEG * side * 0; // 단순화: 같은 방향에서 굴곡
    // 팔꿈치 각도: 전완이 위로 접히도록 (flexion)
    const fa = armAngle - (elbowDeg * DEG);
    const wrist = polar(elbow[0], elbow[1], fa, L.foreArm);
    // 손목 굴곡
    const handAngle = fa + wristDeg * DEG * 0.5;
    const hand = polar(wrist[0], wrist[1], handAngle, L.hand);
    return { shoulder: shoulderPt, elbow, wrist, hand };
  }

  // shrug 시 어깨를 약간 올림
  const shrugOffset = pose.flags.shrug ? -4 : 0;
  const armL = buildArm(
    [shL[0], shL[1] + shrugOffset],
    pose.shoulderL,
    pose.elbowL,
    pose.wristL,
    -1
  );
  const armR = buildArm(
    [shR[0], shR[1] + shrugOffset],
    pose.shoulderR,
    pose.elbowR,
    pose.wristR,
    1
  );

  // --- 골반 & 다리 ---
  const hipL = [
    trunkEnd[0] - Math.cos(shoulderAngle) * L.hipWidth * 0.5,
    trunkEnd[1] + Math.sin(shoulderAngle) * L.hipWidth * 0.5 + hipDrop,
  ];
  const hipR = [
    trunkEnd[0] + Math.cos(shoulderAngle) * L.hipWidth * 0.5,
    trunkEnd[1] - Math.sin(shoulderAngle) * L.hipWidth * 0.5 + hipDrop,
  ];

  function buildLeg(hipPt, kneeDeg, posture, side) {
    // 기본: 다리는 아래로. posture에 따라 무릎 굴곡
    let legAngle = 0;
    if (posture === "squat") legAngle = kneeDeg * DEG * 0.5;
    else if (posture === "lunge") legAngle = side * kneeDeg * DEG * 0.3;
    else if (posture === "sitting") legAngle = Math.PI / 2 * 0.9; // 허벅지가 앞으로
    else if (posture === "kneel") legAngle = Math.PI / 2; // 무릎꿇음

    const knee = polar(hipPt[0], hipPt[1], legAngle, L.thigh);
    // 종아리: squat/sitting 시 무릎에서 꺾임
    let shinAngle;
    if (posture === "squat" || posture === "sitting" || posture === "kneel") {
      shinAngle = 0; // 종아리는 아래로
    } else if (posture === "lunge") {
      shinAngle = side * kneeDeg * DEG * 0.2;
    } else {
      shinAngle = legAngle + kneeDeg * DEG * 0.3;
    }
    const ankle = polar(knee[0], knee[1], shinAngle, L.shin);
    const foot = polar(ankle[0], ankle[1], -Math.PI / 2, L.foot * 0.5);
    return { hip: hipPt, knee, ankle, foot };
  }

  // unstable 자세는 한 다리를 약간 올림
  let legKneeL = pose.kneeL;
  let legKneeR = pose.kneeR;
  if (pose.posture === "standing_unstable") {
    legKneeR = 30; // 오른쪽 무릎 살짝 굴곡 (한 발 듦)
  }

  const legL = buildLeg(hipL, legKneeL, pose.posture, -1);
  const legR = buildLeg(hipR, legKneeR, pose.posture, 1);

  // --- SVG 조립 ---
  const bones = [];
  const joints = [];

  function bone(a, b, w = 7) {
    bones.push(
      `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="${BONE_COLOR}" stroke-width="${w}" stroke-linecap="round" />`
    );
  }
  function joint(p, r = 5) {
    joints.push(
      `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${r}" fill="${JOINT_COLOR}" />`
    );
  }

  // 머리
  const headJitter = pose.flags.neckTwist ? 3 : 0;
  const headCircle = `<circle cx="${(headCx + headJitter).toFixed(1)}" cy="${headCy.toFixed(1)}" r="${L.headR}" fill="none" stroke="${HEAD_COLOR}" stroke-width="3" />`;

  // 목
  bone([neckBaseX, neckBaseY], neckEnd, 6);
  // 몸통
  bone(neckEnd, trunkEnd, 10);
  // 어깨-어깨
  bone(shL, shR, 8);
  // 팔
  bone(armL.shoulder, armL.elbow);
  bone(armL.elbow, armL.wrist, 6);
  bone(armL.wrist, armL.hand, 5);
  bone(armR.shoulder, armR.elbow);
  bone(armR.elbow, armR.wrist, 6);
  bone(armR.wrist, armR.hand, 5);
  // 골반
  bone(hipL, hipR, 8);
  // 다리
  bone(legL.hip, legL.knee, 9);
  bone(legL.knee, legL.ankle, 8);
  bone(legR.hip, legR.knee, 9);
  bone(legR.knee, legR.ankle, 8);

  // 관절 점
  joint(neckEnd, 4);
  joint(trunkEnd, 5);
  joint(armL.elbow, 4);
  joint(armL.wrist, 3);
  joint(armR.elbow, 4);
  joint(armR.wrist, 3);
  joint(legL.knee, 4);
  joint(legR.knee, 4);

  // 바닥선 (서있을 때만)
  let groundLine = "";
  if (["standing", "standing_unstable", "lunge"].includes(pose.posture)) {
    const groundY = H - 20;
    groundLine = `<line x1="20" y1="${groundY}" x2="${W - 20}" y2="${groundY}" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="4 4" />`;
  }

  const svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;max-height:340px">
    <rect x="0" y="0" width="${W}" height="${H}" fill="#f8fafc" rx="8" />
    ${groundLine}
    ${bones.join("")}
    ${joints.join("")}
    ${headCircle}
  </svg>`;

  container.innerHTML = svg;
}

window.Skeleton2D = { render: render2D };

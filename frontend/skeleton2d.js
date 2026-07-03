// 2D SVG 기반 전신 skeleton 렌더러.
//
// 관절을 위에서 아래로 순차 계산(forward kinematics)해 자세를 그린다.
// 머리 → 목 → 몸통 → 어깨/팔, 골반 → 다리 순서.
// RULA/REBA/OWAS 모두 동일한 전신 skeleton으로 표현.

const BONE = "#0f766e";
const BONE_LIGHT = "#5eead4";
const JOINT = "#0d9488";
const HEAD = "#134e4a";

// 골격 길이 (viewBox 220x340 기준)
const L = {
  headR: 15,
  neckLen: 20,
  trunkLen: 68,
  shoulderW: 48,
  hipWidth: 34,
  upperArm: 46,
  foreArm: 40,
  hand: 15,
  thigh: 58,
  shin: 54,
  foot: 18,
};

const D = Math.PI / 180; // 도 → 라디안

// (x, y)에서 아래쪽 방향을 기준으로 angle도(시계방향 +) 기울어진 방향으로 len 이동.
// angle=0 → straight down (+y). 양수 → 앞쪽(+x)으로 기울임.
function tip(x, y, angleDeg, len) {
  const a = angleDeg * D;
  return [x + Math.sin(a) * len, y + Math.cos(a) * len];
}

// 메인 렌더 함수. container: SVG를 채울 div, pose: skeleton.js의 관절 파라미터.
function render2D(container, pose) {
  const W = 220, H = 340;
  const cx = W / 2;

  // posture에 따른 자세 조정
  let hipLift = 0; // 골반을 올리는 양 (앉음/쪼그려앉음 등)
  if (pose.posture === "sitting") hipLift = 48;
  else if (pose.posture === "kneel") hipLift = 60;
  else if (pose.posture === "squat") hipLift = 32;
  else if (pose.posture === "lunge") hipLift = 12;

  // === 몸통 축 계산 (위에서 아래로) ===
  // 머리 중심
  const headCx = cx + (pose.flags.neckLateral ? 6 : 0);
  const headR = L.headR;
  const headCy = 40 + headR;

  // 목: 머리 아래 → neck 굴곡만큼 기울어짐
  const neckTop = [headCx, headCy + headR * 0.7];
  const neckBot = tip(neckTop[0], neckTop[1], pose.neck, L.neckLen);

  // 몸통: 목 아래 → trunk 굴곡만큼 기울어짐
  const trunkTop = neckBot;
  const trunkBot = tip(trunkTop[0], trunkTop[1], pose.trunk, L.trunkLen);

  // === 어깨 (몸통 상단부) ===
  const shY = trunkTop[1] + (trunkBot[1] - trunkTop[1]) * 0.18;
  const shL = [trunkTop[0] - L.shoulderW / 2, shY];
  const shR = [trunkTop[0] + L.shoulderW / 2, shY];

  // === 팔 (상완 + 전완 + 손) ===
  function buildArm(sh, shoulderDeg, elbowDeg, wristDeg, side) {
    // shoulderDeg: 0=아래로 늘어뜨림, 양수=앞으로 들어올림
    // abduct 플래그: 옆으로 벌림 (side: -1=왼, +1=오른)
    let shAng = shoulderDeg;
    if (pose.flags.abduct) shAng += side * 30; // 옆으로 벌림 효과 가산
    const elbow = tip(sh[0], sh[1], shAng, L.upperArm);
    // 팔꿈치 굴곡: 전완이 위로 접힘 (shoulderDeg가 클수록 전완은 몸쪽으로)
    const foreAng = shAng - elbowDeg - 90 + shoulderDeg * 0.5;
    const wrist = tip(elbow[0], elbow[1], foreAng, L.foreArm);
    const hand = tip(wrist[0], wrist[1], foreAng + wristDeg * 0.5, L.hand);
    return { elbow, wrist, hand };
  }

  const shrug = pose.flags.shrug ? -3 : 0;
  const armL = buildArm([shL[0], shL[1] + shrug], pose.shoulderL, pose.elbowL, pose.wristL, -1);
  const armR = buildArm([shR[0], shR[1] + shrug], pose.shoulderR, pose.elbowR, pose.wristR, 1);

  // === 골반 ===
  const hipCx = trunkBot[0];
  const hipY = trunkBot[1] - hipLift;
  const hipL = [hipCx - L.hipWidth / 2, hipY];
  const hipR = [hipCx + L.hipWidth / 2, hipY];

  // === 다리 ===
  function buildLeg(hip, kneeDeg, side) {
    let thighAng = 0;
    let shinAng = 0;
    if (pose.posture === "sitting") {
      thighAng = 85; // 허벅지가 앞으로 거의 수평
      shinAng = -85; // 종아리는 아래로 (의자에 앉아 발 바닥)
    } else if (pose.posture === "kneel") {
      thighAng = 75;
      shinAng = 75;
    } else if (pose.posture === "squat") {
      thighAng = 55;
      shinAng = -55;
    } else if (pose.posture === "lunge") {
      thighAng = side * 20 + 30;
      shinAng = -side * 30;
    } else if (pose.posture === "standing_unstable") {
      // 한 발 듦: 오른쪽 다리를 약간 구부림
      if (side > 0) {
        thighAng = 0;
        shinAng = 25;
      }
    }
    const knee = tip(hip[0], hip[1], thighAng, L.thigh);
    const ankle = tip(knee[0], knee[1], shinAng, L.shin);
    const foot = tip(ankle[0], ankle[1], -90, L.foot / 2);
    return { knee, ankle, foot };
  }

  const legL = buildLeg(hipL, pose.kneeL, -1);
  const legR = buildLeg(hipR, pose.kneeR, 1);

  // === SVG 조립 ===
  const parts = [];
  const dots = [];

  function bone(a, b, w) {
    parts.push(
      `<line x1="${r(a[0])}" y1="${r(a[1])}" x2="${r(b[0])}" y2="${r(b[1])}" stroke="${BONE}" stroke-width="${w}" stroke-linecap="round" />`
    );
  }
  function dot(p, rad) {
    dots.push(`<circle cx="${r(p[0])}" cy="${r(p[1])}" r="${rad}" fill="${JOINT}" />`);
  }
  function r(n) {
    return Number(n).toFixed(1);
  }

  // 몸통 축
  bone(neckTop, neckBot, 6); // 목
  bone(trunkTop, trunkBot, 10); // 몸통
  bone(shL, shR, 7); // 어깨뼈
  bone(hipL, hipR, 7); // 골반뼈

  // 팔
  bone(shL, armL.elbow, 7);
  bone(armL.elbow, armL.wrist, 6);
  bone(armL.wrist, armL.hand, 5);
  bone(shR, armR.elbow, 7);
  bone(armR.elbow, armR.wrist, 6);
  bone(armR.wrist, armR.hand, 5);

  // 다리
  bone(hipL, legL.knee, 8);
  bone(legL.knee, legL.ankle, 7);
  bone(hipR, legR.knee, 8);
  bone(legR.knee, legR.ankle, 7);

  // 관절 점
  dot(neckBot, 4);
  dot(trunkBot, 5);
  dot(armL.elbow, 4); dot(armR.elbow, 4);
  dot(armL.wrist, 3); dot(armR.wrist, 3);
  dot(legL.knee, 4); dot(legR.knee, 4);

  // 머리
  const headShift = pose.flags.neckTwist ? 3 : 0;
  const head = `<circle cx="${r(headCx + headShift)}" cy="${r(headCy)}" r="${headR}" fill="none" stroke="${HEAD}" stroke-width="3" />`;

  // 바닥선 (서있는 자세만)
  let ground = "";
  if (["standing", "standing_unstable", "lunge"].includes(pose.posture)) {
    ground = `<line x1="20" y1="${H - 18}" x2="${W - 20}" y2="${H - 18}" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="4 4" />`;
  }

  const svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;max-height:340px">
    <rect x="0" y="0" width="${W}" height="${H}" fill="#f8fafc" rx="8" />
    ${ground}
    ${parts.join("")}
    ${dots.join("")}
    ${head}
  </svg>`;

  container.innerHTML = svg;
}

window.Skeleton2D = { render: render2D };

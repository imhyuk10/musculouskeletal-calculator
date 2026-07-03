// 선택된 평가 항목 → 전신 skeleton 관절 파라미터 변환.
//
// 각 평가 도구(RULA/REBA/OWAS)의 항목을 skeleton 관절 각도와 플래그로 매핑.
// 복수 선택 시:
//   - 각도 범위 항목은 '가장 극단값(절댓값 최대)' 채택
//   - 플래그 항목(어깨들림/회전/비틀림)은 boolean 누적

// 관절 파라미터 기본값 (중립 자세, 양발 선 상태)
function defaultPose() {
  return {
    // 각도 (도 단위). 양수 = 앞쪽 굴곡/들어올림, 음수 = 뒤쪽 신전
    neck: 0, // 목 전방 굴곡
    trunk: 0, // 몸통/허리 전방 굴곡
    shoulderL: 0, // 왼쪽 어깨 (상완의 들어올림 각도, 0=옆에 늘어뜨림)
    shoulderR: 0, // 오른쪽 어깨
    elbowL: 0, // 왼쪽 팔꿈치 굴곡 (0=완전히 핌)
    elbowR: 0, // 오른쪽 팔꿈치 (180=완전히 폄) → 여기서는 각도=굴곡량
    wristL: 0, // 왼쪽 손목 굴곡
    wristR: 0, // 오른쪽 손목 굴곡
    hip: 0, // 고관절 (다리 들어올림)
    kneeL: 0, // 왼쪽 무릎 굴곡 (0=폄)
    kneeR: 0, // 오른쪽 무릎 굴곡
    // 전체 자세
    posture: "standing", // standing | sitting | squat | kneel | lunge
    // 부가 플래그 (2D에서 투영 효과로, 3D에서 실제 회전으로 표현)
    flags: {
      shrug: false, // 어깨 들어올림
      abduct: false, // 상완 외전/비틀림 (옆으로 벌림)
      wristDeviate: false, // 손목 요골/측골 편향
      trunkTwist: false, // 몸통 회전
      neckTwist: false, // 목 회전
      neckLateral: false, // 목 측면 굴곡
      trunkLateral: false, // 몸통 측면 굴곡
    },
  };
}

// 각도 후보 중 절댓값이 가장 큰 값 선택 (복수 선택 시 가장 극단 자세 반영)
function pickExtreme(current, candidate) {
  if (candidate === null || candidate === undefined) return current;
  if (Math.abs(candidate) > Math.abs(current)) return candidate;
  return current;
}

// ============================================================================
// RULA 매핑
// ============================================================================
const RULA_MAP = {
  upper_arm: {
    // 상완이 몸통 전후 20º 이내
    0: (p) => (p.shoulderL = pickExtreme(p.shoulderL, 10), p.shoulderR = pickExtreme(p.shoulderR, 10)),
    // 상완이 뒤쪽 20º+ 혹은 앞 20~45º
    1: (p) => (p.shoulderL = pickExtreme(p.shoulderL, 35), p.shoulderR = pickExtreme(p.shoulderR, 35)),
    // 앞 45~90º
    2: (p) => (p.shoulderL = pickExtreme(p.shoulderL, 70), p.shoulderR = pickExtreme(p.shoulderR, 70)),
    // 앞 90º+
    3: (p) => (p.shoulderL = pickExtreme(p.shoulderL, 100), p.shoulderR = pickExtreme(p.shoulderR, 100)),
    // 어깨 올려짐
    4: (p) => (p.flags.shrug = true),
    // 윗팔 비틀림/외전
    5: (p) => (p.flags.abduct = true),
    // 기대임/지지
    6: () => {},
  },
  lower_arm: {
    // 전완 60~100º (팔꿈치 적당히 굴곡)
    0: (p) => (p.elbowL = pickExtreme(p.elbowL, 40), p.elbowR = pickExtreme(p.elbowR, 40)),
    // 전완 0~60º 혹은 100º+ (거의 폄)
    1: (p) => (p.elbowL = pickExtreme(p.elbowL, 10), p.elbowR = pickExtreme(p.elbowR, 10)),
    // 몸통 중심 엇갈림/어깨 넓이 벌림
    2: (p) => (p.flags.abduct = true),
  },
  wrist: {
    0: () => {}, // 중립
    1: (p) => (p.wristL = pickExtreme(p.wristL, 10), p.wristR = pickExtreme(p.wristR, 10)),
    2: (p) => (p.wristL = pickExtreme(p.wristL, 25), p.wristR = pickExtreme(p.wristR, 25)),
    3: (p) => (p.flags.wristDeviate = true),
  },
  wrist_twist: {
    0: () => {}, // 적절한 범위
    1: () => {}, // 한계 직전 (시각적 구분 어려워 플래그만)
  },
  neck: {
    0: (p) => (p.neck = pickExtreme(p.neck, 5)),
    1: (p) => (p.neck = pickExtreme(p.neck, 15)),
    2: (p) => (p.neck = pickExtreme(p.neck, 35)),
    3: (p) => (p.neck = pickExtreme(p.neck, -15)),
    4: (p) => (p.flags.neckTwist = true),
    5: (p) => (p.flags.neckLateral = true),
  },
  trunk: {
    0: () => {}, // 잘 지지됨
    1: (p) => (p.trunk = pickExtreme(p.trunk, 10)),
    2: (p) => (p.trunk = pickExtreme(p.trunk, 40)),
    3: (p) => (p.trunk = pickExtreme(p.trunk, 70)),
    4: (p) => (p.flags.trunkTwist = true),
    5: (p) => (p.flags.trunkLateral = true),
  },
  legs: {
    0: () => {}, // 균형 좋음 (서있음)
    1: (p) => (p.posture = "standing_unstable"),
  },
  muscle: {},
  force: {},
};

// ============================================================================
// REBA 매핑
// ============================================================================
const REBA_MAP = {
  trunk: {
    0: () => {}, // 곧바로
    1: (p) => (p.trunk = pickExtreme(p.trunk, 10)),
    2: (p) => (p.trunk = pickExtreme(p.trunk, 40)),
    3: (p) => (p.trunk = pickExtreme(p.trunk, 70)),
    4: (p) => (p.flags.trunkTwist = true),
  },
  neck: {
    0: (p) => (p.neck = pickExtreme(p.neck, 10)),
    1: (p) => (p.neck = pickExtreme(p.neck, 25)),
    2: (p) => (p.flags.neckTwist = true),
  },
  legs: {
    0: () => {}, // 나란/걷기/앉기
    1: (p) => (p.posture = "standing_unstable"),
    2: (p) => (p.kneeL = pickExtreme(p.kneeL, 45), p.kneeR = pickExtreme(p.kneeR, 45)),
    3: (p) => (p.posture = "squat"),
  },
  force_a: {},
  upper_arm: {
    0: (p) => (p.shoulderL = pickExtreme(p.shoulderL, 10), p.shoulderR = pickExtreme(p.shoulderR, 10)),
    1: (p) => (p.shoulderL = pickExtreme(p.shoulderL, 35), p.shoulderR = pickExtreme(p.shoulderR, 35)),
    2: (p) => (p.shoulderL = pickExtreme(p.shoulderL, 70), p.shoulderR = pickExtreme(p.shoulderR, 70)),
    3: (p) => (p.shoulderL = pickExtreme(p.shoulderL, 100), p.shoulderR = pickExtreme(p.shoulderR, 100)),
    4: (p) => (p.flags.abduct = true),
    5: (p) => (p.flags.shrug = true),
    6: () => {},
  },
  lower_arm: {
    0: (p) => (p.elbowL = pickExtreme(p.elbowL, 40), p.elbowR = pickExtreme(p.elbowR, 40)),
    1: (p) => (p.elbowL = pickExtreme(p.elbowL, 10), p.elbowR = pickExtreme(p.elbowR, 10)),
  },
  wrist: {
    0: (p) => (p.wristL = pickExtreme(p.wristL, 8), p.wristR = pickExtreme(p.wristR, 8)),
    1: (p) => (p.wristL = pickExtreme(p.wristL, 25), p.wristR = pickExtreme(p.wristR, 25)),
    2: (p) => (p.flags.wristDeviate = true),
  },
  coupling: {},
  activity: {},
};

// ============================================================================
// OWAS 매핑
// ============================================================================
const OWAS_MAP = {
  back: {
    0: () => {}, // 곧바로
    1: (p) => (p.trunk = pickExtreme(p.trunk, 30)),
    2: (p) => (p.flags.trunkTwist = true),
    3: (p) => ((p.trunk = pickExtreme(p.trunk, 30)), (p.flags.trunkTwist = true)),
  },
  arms: {
    0: () => {}, // 양손 어깨 아래
    1: (p) => (p.shoulderR = pickExtreme(p.shoulderR, 100)), // 한 손 위
    2: (p) => (p.shoulderL = pickExtreme(p.shoulderL, 100), p.shoulderR = pickExtreme(p.shoulderR, 100)),
  },
  legs: {
    0: (p) => (p.posture = "sitting"),
    1: () => {}, // 두 발 펴고 선 자세
    2: (p) => (p.posture = "standing_unstable"),
    3: (p) => (p.posture = "squat"),
    4: (p) => (p.posture = "lunge"),
    5: (p) => (p.posture = "kneel"),
    6: () => {}, // 걷기 (서있는 것과 동일 표현)
  },
  force: {},
};

const TOOL_MAPS = { RULA: RULA_MAP, REBA: REBA_MAP, OWAS: OWAS_MAP };

// 선택된 항목들을 skeleton 관절 파라미터로 변환.
// selections: { upper_arm: [idx,...], ... } 형태의 선택 인덱스 맵.
function buildPose(tool, selectionsForTool) {
  const pose = defaultPose();
  const map = TOOL_MAPS[tool];
  if (!map) return pose;

  for (const [partKey, indices] of Object.entries(selectionsForTool)) {
    const partMap = map[partKey];
    if (!partMap) continue;
    for (const idx of indices) {
      const fn = partMap[idx];
      if (fn) fn(pose);
    }
  }
  return pose;
}

// 전역으로 노출 (ESM 없이 단순 스크립트 구조 유지)
window.SkeletonMapper = { buildPose, defaultPose };

// ES 모듈 export (main.js 모듈화 대응)
export { buildPose, defaultPose };

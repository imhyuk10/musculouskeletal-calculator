// 근골격계 평가 앱 프론트엔드 로직.
// Tauri 백엔드의 get_data / calculate 명령을 호출해
// 부위·항목 데이터를 렌더링하고 선택 시 실시간으로 점수를 산출한다.

// Tauri 글로벌 API에서 invoke 획득.
// tauri.conf.json 의 app.withGlobalTauri = true 로 노출된다.
const invoke = window.__TAURI__?.core?.invoke;
if (!invoke) {
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelector("#partList").innerHTML =
      `<div class="loading" style="color:#dc2626">
        Tauri API를 불러오지 못했습니다.<br>withGlobalTauri 설정을 확인하세요.
      </div>`;
  });
}

// 각 평가 도구의 부위 정의 순서와 메타데이터.
// (JSON의 parts는 HashMap이라 순서가 보장되지 않으므로 여기서 순서를 지정)
const TOOL_CONFIG = {
  RULA: {
    title: "RULA (상지 평가)",
    parts: [
      { key: "upper_arm", group: "A", label: "윗팔" },
      { key: "lower_arm", group: "A", label: "아래팔" },
      { key: "wrist", group: "A", label: "손목" },
      { key: "wrist_twist", group: "A", label: "손목비틀림" },
      { key: "neck", group: "B", label: "목" },
      { key: "trunk", group: "B", label: "몸통" },
      { key: "legs", group: "B", label: "다리" },
      { key: "muscle", group: "extra", label: "근육사용 (추가점수)" },
      { key: "force", group: "extra", label: "무게/힘 (추가점수)" },
    ],
  },
  REBA: {
    title: "REBA (전신 평가)",
    parts: [
      { key: "trunk", group: "A", label: "허리" },
      { key: "neck", group: "A", label: "목" },
      { key: "legs", group: "A", label: "다리" },
      { key: "force_a", group: "extra", label: "무게 (추가점수)" },
      { key: "upper_arm", group: "B", label: "상완" },
      { key: "lower_arm", group: "B", label: "전완" },
      { key: "wrist", group: "B", label: "손목" },
      { key: "coupling", group: "extra", label: "손잡이 (추가점수)" },
      { key: "activity", group: "extra", label: "활동 점수" },
    ],
  },
  OWAS: {
    title: "OWAS (작업 자세 분석)",
    parts: [
      { key: "back", group: "main", label: "허리" },
      { key: "arms", group: "main", label: "팔" },
      { key: "legs", group: "main", label: "다리" },
      { key: "force", group: "main", label: "무게/하중" },
    ],
  },
};

let DATA = null;       // 백엔드에서 받은 전체 평가 데이터
let currentTool = "RULA";
// 선택 상태: { RULA: { upper_arm: [idx, idx], ... }, ... }
const selections = { RULA: {}, REBA: {}, OWAS: {} };

// ---------------------------------------------------------------------------
// 초기화
// ---------------------------------------------------------------------------
async function init() {
  if (!invoke) return; // 글로벌 API 누락 시 이미 에러 메시지 표시됨
  try {
    DATA = await invoke("get_data");
  } catch (e) {
    document.querySelector("#partList").innerHTML =
      `<div class="loading" style="color:#dc2626">데이터 로드 실패: ${e}</div>`;
    return;
  }
  // 각 도구의 부위별 선택 배열 초기화
  for (const tool of Object.keys(TOOL_CONFIG)) {
    for (const p of TOOL_CONFIG[tool].parts) {
      selections[tool][p.key] = [];
    }
  }

  // 툴바 버튼 이벤트
  document.querySelector("#btnReset").addEventListener("click", resetAll);

  // 시각화 2D/3D 토글
  document.querySelectorAll(".vbtn").forEach((b) => {
    b.addEventListener("click", () => setViewerMode(b.dataset.mode));
  });

  render();
}

// ---------------------------------------------------------------------------
// 초기화
// ---------------------------------------------------------------------------
function resetAll() {
  for (const tool of Object.keys(selections)) {
    for (const part of Object.keys(selections[tool])) {
      selections[tool][part] = [];
    }
  }
  render();
}

// ---------------------------------------------------------------------------
// 렌더링
// ---------------------------------------------------------------------------
function render() {
  const cfg = TOOL_CONFIG[currentTool];
  const partsData = DATA[currentTool].parts;
  const list = document.querySelector("#partList");
  document.querySelector("#resultToolName").textContent = cfg.title;

  let html = "";
  for (const p of cfg.parts) {
    const part = partsData[p.key];
    if (!part) continue;
    const extra = p.group === "extra";
    const groupTag =
      p.group === "A"
        ? '<span class="group-tag ga">A</span>'
        : p.group === "B"
        ? '<span class="group-tag gb">B</span>'
        : "";
    html += `<div class="part-card ${extra ? "is-extra" : ""}" data-part="${p.key}">`;
    html += `<div class="part-head"><span>${p.label} ${groupTag}</span>`;
    html += `<span class="part-sum" data-sum="${p.key}">—</span></div>`;
    html += `<div class="part-items">`;
    part.items.forEach((item, idx) => {
      const checked = selections[currentTool][p.key].includes(idx) ? "checked" : "";
      const cls = checked ? "checked" : "";
      html += `<label class="option ${cls}" data-part="${p.key}" data-idx="${idx}">
        <input type="checkbox" data-part="${p.key}" data-idx="${idx}" ${checked} />
        <span class="opt-text">${item.desc}</span>
        <span class="opt-score">${fmtScore(item.score)}</span>
      </label>`;
    });
    html += `</div></div>`;
  }
  list.innerHTML = html;

  // 이벤트 연결
  list.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener("change", onChange);
  });
  recompute();
}

// ---------------------------------------------------------------------------
// 선택 변경 처리
// ---------------------------------------------------------------------------
function onChange(e) {
  const cb = e.target;
  const partKey = cb.dataset.part;
  const idx = Number(cb.dataset.idx);
  const sel = selections[currentTool][partKey];
  if (cb.checked) {
    if (!sel.includes(idx)) sel.push(idx);
    cb.closest(".option").classList.add("checked");
  } else {
    const i = sel.indexOf(idx);
    if (i >= 0) sel.splice(i, 1);
    cb.closest(".option").classList.remove("checked");
  }
  recompute();
}

// ---------------------------------------------------------------------------
// 점수 재계산
// ---------------------------------------------------------------------------
async function recompute() {
  const cfg = TOOL_CONFIG[currentTool];
  const partsData = DATA[currentTool].parts;

  // 부위별 합산 점수 표시 업데이트
  const partSums = {};
  for (const p of cfg.parts) {
    const sel = selections[currentTool][p.key];
    const items = partsData[p.key].items;
    let sum = 0;
    for (const idx of sel) sum += items[idx].score;
    partSums[p.key] = sum;
    const sumEl = document.querySelector(`[data-sum="${p.key}"]`);
    if (sumEl) sumEl.textContent = sel.length ? fmtScore(sum) : "—";
  }

  // 백엔드 호출용 입력 조립: 선택된 항목의 score 배열
  const input = {};
  for (const p of cfg.parts) {
    const sel = selections[currentTool][p.key];
    const items = partsData[p.key].items;
    input[p.key] = sel.map((idx) => items[idx].score);
  }

  let result;
  try {
    result = await invoke("calculate", { req: { tool: currentTool, input } });
  } catch (err) {
    console.error("계산 오류:", err);
    return;
  }
  renderResult(result, partSums);
  updateViewer();
}

// ---------------------------------------------------------------------------
// 자세 시각화
// ---------------------------------------------------------------------------
let viewerMode = "2D"; // "2D" | "3D"

function updateViewer() {
  const canvas = document.querySelector("#viewerCanvas");
  if (!canvas) return;
  const pose = window.SkeletonMapper.buildPose(currentTool, selections[currentTool]);

  if (viewerMode === "2D") {
    // 3D가 켜져 있었다면 해제
    if (window.Skeleton3D) window.Skeleton3D.dispose();
    window.Skeleton2D.render(canvas, pose);
  } else {
    // 3D 모드: SVG 내용 비우고 3D 렌더링
    canvas.innerHTML = "";
    if (window.Skeleton3D) {
      window.Skeleton3D.render(canvas, pose);
    } else {
      canvas.innerHTML = '<div class="loading">3D 로딩 중…</div>';
    }
  }
}

function setViewerMode(mode) {
  viewerMode = mode;
  document.querySelectorAll(".vbtn").forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === mode)
  );
  updateViewer();
}

// ---------------------------------------------------------------------------
// 결과 패널 렌더링
// ---------------------------------------------------------------------------
function renderResult(r, partSums) {
  const big = document.querySelector(".score-big");
  const valEl = big.querySelector(".score-value");
  const gradeEl = document.querySelector("#scoreGrade");
  const actionEl = document.querySelector("#actionText");
  const bd = document.querySelector("#breakdown");

  valEl.textContent = fmtScore(r.final_score);
  gradeEl.textContent = r.grade_label;
  actionEl.textContent = r.action;

  // 등급 색상 클래스 적용
  big.classList.remove("grade-1", "grade-2", "grade-3", "grade-4", "grade-5");
  big.classList.add(`grade-${r.grade}`);

  // 세부 점수 분석
  const cfg = TOOL_CONFIG[currentTool];
  let html = '<div class="breakdown-title">부위별 점수</div>';
  for (const p of cfg.parts) {
    html += `<div class="bd-row"><span class="bd-label">${p.label}</span>`;
    html += `<span class="bd-val">${fmtScore(partSums[p.key])}</span></div>`;
  }

  // 도구별 중간 점수
  if (currentTool === "RULA") {
    html += '<div class="breakdown-title" style="margin-top:10px">산출 과정</div>';
    html += bdRow("점수 A (Group A)", r.score_a);
    html += bdRow("점수 B (Group B)", r.score_b);
    html += bdRow("추가점수 (근육+무게)", r.extra);
    html += bdRow("점수 C (A+추가)", r.score_c);
    html += bdRow("점수 D (B+추가)", r.score_d);
    html += bdRow("최종 점수", r.final_score, true);
  } else if (currentTool === "REBA") {
    html += '<div class="breakdown-title" style="margin-top:10px">산출 과정</div>';
    html += bdRow("점수 A원 (허리·목·다리)", r.score_a_raw);
    html += bdRow("점수 B원 (상완·전완·손목)", r.score_b_raw);
    html += bdRow("점수 A (+무게)", r.score_a);
    html += bdRow("점수 B (+손잡이)", r.score_b);
    html += bdRow("점수 C (Table C)", r.score_c);
    html += bdRow("최종 점수 (+활동)", r.final_score, true);
  } else {
    html += '<div class="breakdown-title" style="margin-top:10px">산출 과정</div>';
    html += bdRow("작업자세 수준", r.final_score, true);
  }
  bd.innerHTML = html;
}

function bdRow(label, val, highlight = false) {
  return `<div class="bd-row ${highlight ? "highlight" : ""}">
    <span class="bd-label">${label}</span>
    <span class="bd-val">${fmtScore(val)}</span>
  </div>`;
}

function fmtScore(v) {
  if (v == null) return "—";
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

// ---------------------------------------------------------------------------
// 탭 전환
// ---------------------------------------------------------------------------
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    currentTool = tab.dataset.tool;
    render();
  });
});

init();

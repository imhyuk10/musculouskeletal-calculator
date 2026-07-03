// 근골격계 평가 앱 프론트엔드 로직.
// Tauri 백엔드의 get_data / calculate 명령을 호출해
// 부위·항목 데이터를 렌더링하고 선택 시 실시간으로 점수를 산출한다.
//
// ES 모듈로 작성 — skeleton3d.js(Three.js)를 import 해 로딩 순서를 보장한다.
// 일반 스크립트일 때는 window.Skeleton3D 가 준비되기 전에 init() 이 실행되어
// 3D 모드가 영원히 "로딩 중"에 머무는 문제가 있었다.

import { buildPose } from "./skeleton.js";
import { render as render2D } from "./skeleton2d.js";
import { render as render3D, dispose as dispose3D } from "./skeleton3d.js";

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
//
// 선택 규칙 (single / multi):
//   - single: 상호배타적인 각도/자세 옵션. 같은 부위에서 하나만 선택 (라디오).
//   - multi:  수식어/추가 특성. 각도와 함께 복수 선택 가능 (체크박스).
//     single 과 multi 가 모두 비어있지 않은 부위는 두 섹션으로 나뉘어 표시.
//     single 만 있으면 전체가 단일 선택, multi 만 있으면 전체가 복수 선택.
//
// defaultIdx: 단일 선택(single) 부위의 중립 기준 자세 인덱스.
//   앱 시작/초기화 시 이 값이 미리 선택된다.
//   사람은 항상 어떤 자세를 취하고 있으므로 빈 상태 대신 중립 자세를 기본값으로 둔다.
//   복수 선택(multi) 부위는 "해당할 때만" 켜는 성격이므로 기본값 없음.
const TOOL_CONFIG = {
  RULA: {
    title: "RULA (상지 평가)",
    parts: [
      { key: "upper_arm", group: "A", label: "윗팔", single: [0, 1, 2, 3], multi: [4, 5, 6], defaultIdx: 0 },
      { key: "lower_arm", group: "A", label: "아래팔", single: [0, 1], multi: [2], defaultIdx: 0 },
      { key: "wrist", group: "A", label: "손목", single: [0, 1, 2], multi: [3], defaultIdx: 0 },
      { key: "wrist_twist", group: "A", label: "손목비틀림", single: [0, 1], multi: [], defaultIdx: 0 },
      { key: "neck", group: "B", label: "목", single: [0, 1, 2, 3], multi: [4, 5], defaultIdx: 0 },
      { key: "trunk", group: "B", label: "몸통", single: [0, 1, 2, 3], multi: [4, 5], defaultIdx: 0 },
      { key: "legs", group: "B", label: "다리", single: [0, 1], multi: [], defaultIdx: 0 },
      { key: "muscle", group: "extra", label: "근육사용 (추가점수)", single: [], multi: [0] },
      { key: "force", group: "extra", label: "무게/힘 (추가점수)", single: [0, 1, 2, 3], multi: [], defaultIdx: 0 },
    ],
  },
  REBA: {
    title: "REBA (전신 평가)",
    parts: [
      { key: "trunk", group: "A", label: "허리", single: [0, 1, 2, 3], multi: [4], defaultIdx: 0 },
      { key: "neck", group: "A", label: "목", single: [0, 1], multi: [2], defaultIdx: 0 },
      { key: "legs", group: "A", label: "다리", single: [0, 1, 2, 3], multi: [], defaultIdx: 0 },
      { key: "force_a", group: "extra", label: "무게 (추가점수)", single: [0, 1, 2], multi: [3], defaultIdx: 0 },
      { key: "upper_arm", group: "B", label: "상완", single: [0, 1, 2, 3], multi: [4, 5, 6], defaultIdx: 0 },
      { key: "lower_arm", group: "B", label: "전완", single: [0, 1], multi: [], defaultIdx: 0 },
      { key: "wrist", group: "B", label: "손목", single: [0, 1], multi: [2], defaultIdx: 0 },
      { key: "coupling", group: "extra", label: "손잡이 (추가점수)", single: [0, 1, 2, 3], multi: [], defaultIdx: 0 },
      { key: "activity", group: "extra", label: "활동 점수", single: [], multi: [0, 1, 2] },
    ],
  },
  OWAS: {
    title: "OWAS (작업 자세 분석)",
    parts: [
      { key: "back", group: "main", label: "허리", single: [0, 1, 2, 3], multi: [], defaultIdx: 0 },
      { key: "arms", group: "main", label: "팔", single: [0, 1, 2], multi: [], defaultIdx: 0 },
      { key: "legs", group: "main", label: "다리", single: [0, 1, 2, 3, 4, 5, 6], multi: [], defaultIdx: 1 },
      { key: "force", group: "main", label: "무게/하중", single: [0, 1, 2], multi: [], defaultIdx: 0 },
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
  // 각 도구의 부위별 선택 배열 초기화 + 중립 기준 자세 적용
  applyDefaults();

  // 툴바 버튼 이벤트
  document.querySelector("#btnReset").addEventListener("click", resetAll);

  // 시각화 2D/3D 토글
  document.querySelectorAll(".vbtn").forEach((b) => {
    b.addEventListener("click", () => setViewerMode(b.dataset.mode));
  });

  render();
}

// ---------------------------------------------------------------------------
// 중립 기준 자세 적용
// ---------------------------------------------------------------------------
// 단일 선택(single) 부위에 defaultIdx 가 정의되어 있으면 그 값을 미리 선택한다.
// 사람은 항상 어떤 자세를 취하고 있으므로, 빈 상태 대신 중립 자세를 기본값으로 둔다.
// 복수 선택(multi) 부위는 "해당할 때만" 켜는 성격이므로 기본값을 두지 않는다.
function applyDefaults() {
  for (const tool of Object.keys(TOOL_CONFIG)) {
    for (const p of TOOL_CONFIG[tool].parts) {
      if (p.defaultIdx !== undefined && p.single && p.single.length) {
        selections[tool][p.key] = [p.defaultIdx];
      } else {
        selections[tool][p.key] = [];
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 초기화
// ---------------------------------------------------------------------------
function resetAll() {
  applyDefaults();
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
    const singleIdxs = p.single || [];
    const multiIdxs = p.multi || [];
    const sel = selections[currentTool][p.key];

    html += `<div class="part-card ${extra ? "is-extra" : ""}" data-part="${p.key}">`;
    html += `<div class="part-head"><span>${p.label} ${groupTag}</span>`;
    html += `<span class="part-sum" data-sum="${p.key}">—</span></div>`;
    html += `<div class="part-items">`;

    // 단일 선택 섹션 (라디오). singleIdxs 가 있으면 렌더링.
    if (singleIdxs.length) {
      html += renderItems(part, singleIdxs, sel, p.key, "radio");
    }
    // 복수 선택 섹션 (체크박스). 두 섹션이 모두 있으면 구분선.
    if (multiIdxs.length) {
      if (singleIdxs.length) html += `<div class="section-divider"></div>`;
      html += renderItems(part, multiIdxs, sel, p.key, "checkbox");
    }
    html += `</div></div>`;
  }
  list.innerHTML = html;

  // 이벤트 연결: 라디오(단일)와 체크박스(복수) 모두
  list.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach((el) => {
    el.addEventListener("change", onChange);
  });
  recompute();
}

// 항목 목록을 HTML 로 렌더링. type 은 "radio" | "checkbox".
function renderItems(part, idxs, sel, partKey, type) {
  const name = type === "radio" ? ` name="${partKey}-single"` : "";
  let html = "";
  for (const idx of idxs) {
    const item = part.items[idx];
    const isChecked = sel.includes(idx);
    const checked = isChecked ? "checked" : "";
    const cls = isChecked ? "checked" : "";
    html += `<label class="option ${cls}" data-part="${partKey}" data-idx="${idx}">
      <input type="${type}" data-part="${partKey}" data-idx="${idx}"${name} ${checked} />
      <span class="opt-text">${item.desc}</span>
      <span class="opt-score">${fmtScore(item.score)}</span>
    </label>`;
  }
  return html;
}

// ---------------------------------------------------------------------------
// 선택 변경 처리
// ---------------------------------------------------------------------------
function onChange(e) {
  const el = e.target;
  const partKey = el.dataset.part;
  const idx = Number(el.dataset.idx);
  const sel = selections[currentTool][partKey];
  const partMeta = TOOL_CONFIG[currentTool].parts.find((p) => p.key === partKey);
  const isSingle = partMeta && (partMeta.single || []).includes(idx);

  if (el.type === "radio") {
    // 단일 선택: 같은 single 그룹의 기존 선택을 모두 제거하고 새 것만 추가.
    // multi 그룹 선택은 유지.
    const multiIdxs = partMeta.multi || [];
    sel.length = 0;
    if (el.checked) sel.push(idx);
    // multi 선택 복원
    for (const m of multiIdxs) {
      const mEl = document.querySelector(
        `input[type="checkbox"][data-part="${partKey}"][data-idx="${m}"]`
      );
      if (mEl && mEl.checked && !sel.includes(m)) sel.push(m);
    }
    // 라디오 그룹의 label checked 클래스 갱신
    document
      .querySelectorAll(`label.option[data-part="${partKey}"]`)
      .forEach((lab) => {
        const labIdx = Number(lab.dataset.idx);
        const inSingle = (partMeta.single || []).includes(labIdx);
        if (inSingle) lab.classList.toggle("checked", labIdx === idx && el.checked);
      });
  } else {
    // 체크박스(복수): 토글
    if (el.checked) {
      if (!sel.includes(idx)) sel.push(idx);
      el.closest(".option").classList.add("checked");
    } else {
      const i = sel.indexOf(idx);
      if (i >= 0) sel.splice(i, 1);
      el.closest(".option").classList.remove("checked");
    }
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
  const pose = buildPose(currentTool, selections[currentTool]);

  if (viewerMode === "2D") {
    // 3D가 켜져 있었다면 해제
    dispose3D();
    render2D(canvas, pose);
  } else {
    // 3D 모드: SVG 내용 비우고 3D 렌더링
    canvas.innerHTML = "";
    render3D(canvas, pose);
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

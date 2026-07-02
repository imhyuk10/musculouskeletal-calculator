//! 근골격계 평가 계산 엔진.
//!
//! 엑셀 원본 `유해요인조사 평가지.xlsx`의 INDEX 수식 로직을 1:1로 복제.
//! 모든 lookup 테이블은 엑셀에서 추출한 값을 `assessment_data.json`에서
//! 가져오며, 단위 테스트는 엑셀에서 산출된 실제 결과값을 단정한다.
//!
//! 핵심 원리 (엑셀 `=F*G` 합산과 동일):
//!   - 각 부위의 선택된 항목 점수(score)를 모두 합산
//!   - 합이 0이면 1로 클램프 (엑셀 `IF(Σ=0,1,Σ)` 반영)
//!   - 합산값을 인덱스로 변환해 미리 정의된 교차표(lookup table)에서 조회

use serde::{Deserialize, Serialize};

/// 엑셀의 1-based INDEX 함수를 흉내낸 헬퍼.
/// `mat[row-1][col-1]`를 반환한다.
fn index(mat: &[Vec<f64>], row: usize, col: usize) -> f64 {
    mat[row - 1][col - 1]
}

/// 부위별 선택 항목 인덱스 목록의 점수를 합산.
/// 합이 0이면 1로 클램프 (엑셀 RULA 윗팔 H5의 `IF(Σ=0,1,Σ)` 반영).
fn sum_or_one(scores: &[f64]) -> f64 {
    let s: f64 = scores.iter().sum();
    if s == 0.0 {
        1.0
    } else {
        s
    }
}

/// 빈 선택(아무 항목도 고르지 않음)일 때만 1로 폴백.
/// 항목을 골랐으면 그 합산값(0 포함)을 그대로 둔다.
///
/// 엑셀은 대부분의 부위에서 클램프 없이 단순 합산(`(F*G)+...`)을 쓰지만,
/// 아무것도 선택하지 않으면 음수 인덱스로 `#REF!` 에러가 난다.
/// 본 앱은 엑셀이 지원하지 않는 "빈 선택"을 안전하게 만들기 위해
/// 빈 벡터만 1로 채운다. 1개 이상 선택된 경우 엑셀과 100% 동일.
fn sum_or_one_if_empty(scores: &[f64]) -> f64 {
    if scores.is_empty() {
        1.0
    } else {
        scores.iter().sum()
    }
}

// ============================================================================
// RULA (Rapid Upper Limb Assessment) - 상지 평가
// ============================================================================

/// RULA 계산 입력. 각 부위는 선택된 항목들의 점수 목록.
/// 직렬화하여 프론트엔드에서 JSON 으로 전달받는다.
#[derive(Debug, Clone, Deserialize)]
pub struct RulaInput {
    pub upper_arm: Vec<f64>,      // 윗팔 (Group A)
    pub lower_arm: Vec<f64>,      // 아래팔 (Group A)
    pub wrist: Vec<f64>,          // 손목 (Group A)
    pub wrist_twist: Vec<f64>,    // 손목비틀림 (Group A)
    pub neck: Vec<f64>,           // 목 (Group B)
    pub trunk: Vec<f64>,          // 몸통 (Group B)
    pub legs: Vec<f64>,           // 다리 (Group B)
    pub muscle: Vec<f64>,         // 근육사용 (추가점수)
    pub force: Vec<f64>,          // 무게/힘 (추가점수)
}

/// RULA 평가 결과.
#[derive(Debug, Clone, Serialize)]
pub struct RulaResult {
    pub upper_arm: f64,
    pub lower_arm: f64,
    pub wrist: f64,
    pub wrist_twist: f64,
    pub neck: f64,
    pub trunk: f64,
    pub legs: f64,
    pub muscle: f64,
    pub force: f64,
    pub score_a: f64,        // Group A 테이블 조회 결과
    pub score_b: f64,        // Group B 테이블 조회 결과
    pub extra: f64,          // 추가점수 = 근육 + 무게
    pub score_c: f64,        // = 점수A + 추가점수
    pub score_d: f64,        // = 점수B + 추가점수
    pub final_score: f64,    // 최종 점수 (최종 테이블 조회)
    pub grade: u8,           // 등급 (1~4)
    pub grade_label: String, // 등급 라벨
    pub action: String,      // 권장 조치사항
}

/// RULA 등급별 점수 범위 (엑셀 AQ21 수식과 동일):
///   점수 ≤2 → 1단계, ≤4 → 2단계, ≤6 → 3단계, 그외 → 4단계
fn rula_grade(final_score: f64) -> (u8, &'static str, &'static str) {
    if final_score <= 2.0 {
        (1, "1단계 (수용 가능)", "추가 조치 불필요")
    } else if final_score <= 4.0 {
        (2, "2단계 (관심 필요)", "추가 조사 필요할 수 있음")
    } else if final_score <= 6.0 {
        (3, "3단계 (조사 필요)", "추가 조사 및 개선 필요")
    } else {
        (4, "4단계 (즉각 조사)", "즉각적 작업 개선 및 위험요인 분석 요구됨")
    }
}

/// RULA 점수 계산.
///
/// 엑셀 수식 매핑:
///   - 점수A = INDEX(tableA, 3*(윗팔-1)+아래팔, 2*(손목-1)+손목비틀림)
///   - 점수B = INDEX(tableB, 목, 2*(몸통-1)+다리)
///   - 점수C = 점수A + (근육 + 무게)
///   - 점수D = 점수B + (근육 + 무게)
///   - 최종 = INDEX(tableFinal, min(점수C,8), min(점수D,7))
pub fn calculate_rula(input: &RulaInput, data: &crate::data::AssessmentData) -> RulaResult {
    // 윗팔(upper_arm)은 엑셀 H5의 IF(Σ=0,1,Σ) 클램프를 따른다.
    // 나머지 부위는 엑셀처럼 단순 합산이되, 빈 선택(아무것도 안 고름)만 1로 폴백.
    let upper_arm = sum_or_one(&input.upper_arm);
    let lower_arm = sum_or_one_if_empty(&input.lower_arm);
    let wrist = sum_or_one_if_empty(&input.wrist);
    let wrist_twist = sum_or_one_if_empty(&input.wrist_twist);
    let neck = sum_or_one_if_empty(&input.neck);
    let trunk = sum_or_one_if_empty(&input.trunk);
    let legs = sum_or_one_if_empty(&input.legs);
    // 근육/무게는 엑셀에서 클램프 없이 단순 합산 (BB8 = H36+H35).
    // 빈 선택 폴백만 적용.
    let muscle = sum_or_one_if_empty(&input.muscle);
    let force = sum_or_one_if_empty(&input.force);

    let tbl_a = &data.rula.table_a;
    let tbl_b = &data.rula.table_b;
    let tbl_final = &data.rula.table_final;

    // 점수 A: INDEX(M10:T27, 3*(H5-1)+H12, 2*(H15-1)+H19)
    let row_a = (3.0 * (upper_arm - 1.0) + lower_arm) as usize;
    let col_a = (2.0 * (wrist - 1.0) + wrist_twist) as usize;
    let score_a = index(tbl_a, row_a, col_a);

    // 점수 B: INDEX(W10:AH15, H21, 2*(H27-1)+H33)
    let row_b = neck as usize;
    let col_b = (2.0 * (trunk - 1.0) + legs) as usize;
    let score_b = index(tbl_b, row_b, col_b);

    // 추가점수 = 근육 + 무게 (엑셀 BB8 = H36+H35)
    let extra = muscle + force;
    let score_c = score_a + extra;
    let score_d = score_b + extra;

    // 최종 점수: INDEX(Z20:AF27, IF(C>=8,8,C), IF(D>=7,7,D))
    let row_f = score_c.min(8.0) as usize;
    let col_f = score_d.min(7.0) as usize;
    let final_score = index(tbl_final, row_f, col_f);

    let (grade, grade_label, action) = rula_grade(final_score);

    RulaResult {
        upper_arm,
        lower_arm,
        wrist,
        wrist_twist,
        neck,
        trunk,
        legs,
        muscle,
        force,
        score_a,
        score_b,
        extra,
        score_c,
        score_d,
        final_score,
        grade,
        grade_label: grade_label.to_string(),
        action: action.to_string(),
    }
}

// ============================================================================
// REBA (Rapid Entire Body Assessment) - 전신 평가
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
pub struct RebaInput {
    pub trunk: Vec<f64>,       // 허리 (Group A)
    pub neck: Vec<f64>,        // 목 (Group A)
    pub legs: Vec<f64>,        // 다리 (Group A)
    pub force_a: Vec<f64>,     // 무게 (Group A)
    pub upper_arm: Vec<f64>,   // 상완 (Group B)
    pub lower_arm: Vec<f64>,   // 전완 (Group B)
    pub wrist: Vec<f64>,       // 손목 (Group B)
    pub coupling: Vec<f64>,    // 손잡이 (Group B)
    pub activity: Vec<f64>,    // 활동 점수
}

#[derive(Debug, Clone, Serialize)]
pub struct RebaResult {
    pub trunk: f64,
    pub neck: f64,
    pub legs: f64,
    pub force_a: f64,
    pub upper_arm: f64,
    pub lower_arm: f64,
    pub wrist: f64,
    pub coupling: f64,
    pub activity: f64,
    pub score_a_raw: f64,   // tableA 조회 결과 (무게 가산 전)
    pub score_b_raw: f64,   // tableB 조회 결과 (손잡이 가산 전)
    pub score_a: f64,       // = score_a_raw + 무게
    pub score_b: f64,       // = score_b_raw + 손잡이
    pub score_c: f64,       // tableC 조회 결과
    pub final_score: f64,   // = score_c + 활동점수
    pub grade: u8,
    pub grade_label: String,
    pub action: String,
}

/// REBA 등급 (엑셀 AO23 수식과 동일):
///   1 → 양호, 2~3 → 위험 낮음, 4~7 → 보통, 8~10 → 높음, 11~15 → 매우 높음
fn reba_grade(final_score: f64) -> (u8, &'static str, &'static str) {
    let fs = final_score as i64;
    if fs == 1 {
        (1, "양호", "조치 불필요")
    } else if fs <= 3 {
        (2, "위험 낮음", "조치 필요할 수 있음")
    } else if fs <= 7 {
        (3, "보통의 위험", "추가 조사 및 조치 필요")
    } else if fs <= 10 {
        (4, "높은 위험", "가까운 시일 내 조사·개선 필요")
    } else {
        (5, "매우 높은 위험", "즉각적 개선 필요")
    }
}

/// REBA 점수 계산.
///
/// 엑셀 수식 매핑:
///   - 점수A원 = INDEX(tableA, 허리합, 4*(목-1)+다리)
///   - 점수B원 = INDEX(tableB, 상완합, 3*(전완-1)+손목)
///   - 점수A  = 점수A원 + 무게
///   - 점수B  = 점수B원 + 손잡이
///   - 점수C  = INDEX(tableC, 점수A, 점수B)
///   - 최종   = 점수C + 활동점수
///
/// 주의: REBA 입력 부위 중 무게(force_a)/손잡이(coupling)/활동(activity)는
/// 단순 합산(클램프 없음) — 엑셀에서도 이들 부위에는 IF(=0,1) 클램프가 없음.
pub fn calculate_reba(input: &RebaInput, data: &crate::data::AssessmentData) -> RebaResult {
    // REBA 모든 부위는 엑셀에서 단순 합산(클램프 없음).
    // 빈 선택만 1로 폴백해 인덱스 언더플로우를 방지한다.
    let trunk = sum_or_one_if_empty(&input.trunk);
    let neck = sum_or_one_if_empty(&input.neck);
    let legs = sum_or_one_if_empty(&input.legs);
    let force_a = sum_or_one_if_empty(&input.force_a);
    let upper_arm = sum_or_one_if_empty(&input.upper_arm);
    let lower_arm = sum_or_one_if_empty(&input.lower_arm);
    let wrist = sum_or_one_if_empty(&input.wrist);
    let coupling = sum_or_one_if_empty(&input.coupling);
    let activity = sum_or_one_if_empty(&input.activity);

    let tbl_a = &data.reba.table_a;
    let tbl_b = &data.reba.table_b;
    let tbl_c = &data.reba.table_c;

    // 점수A원: INDEX(L9:W13, H5, 4*(H10-1)+H13)
    //   H5=허리합, H10=목합, H13=다리합
    let row_a = trunk as usize;
    let col_a = (4.0 * (neck - 1.0) + legs) as usize;
    let score_a_raw = index(tbl_a, row_a, col_a);

    // 점수B원: INDEX(Z9:AE14, H21, 3*(H28-1)+H30)
    //   H21=상완합, H28=전완합, H30=손목합
    let row_b = upper_arm as usize;
    let col_b = (3.0 * (lower_arm - 1.0) + wrist) as usize;
    let score_b_raw = index(tbl_b, row_b, col_b);

    // 점수A = 점수A원 + 무게 ; 점수B = 점수B원 + 손잡이
    let score_a = score_a_raw + force_a;
    let score_b = score_b_raw + coupling;

    // 점수C: INDEX(M20:X31, 점수A, 점수B)
    let score_c = index(tbl_c, score_a as usize, score_b as usize);

    // 최종 = 점수C + 활동점수
    let final_score = score_c + activity;

    let (grade, grade_label, action) = reba_grade(final_score);

    RebaResult {
        trunk,
        neck,
        legs,
        force_a,
        upper_arm,
        lower_arm,
        wrist,
        coupling,
        activity,
        score_a_raw,
        score_b_raw,
        score_a,
        score_b,
        score_c,
        final_score,
        grade,
        grade_label: grade_label.to_string(),
        action: action.to_string(),
    }
}

// ============================================================================
// OWAS (Ovako Working-posture Analysing System) - 작업 자세 분석
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
pub struct OwasInput {
    pub back: Vec<f64>,    // 허리
    pub arms: Vec<f64>,    // 팔
    pub legs: Vec<f64>,    // 다리
    pub force: Vec<f64>,   // 무게/하중
}

#[derive(Debug, Clone, Serialize)]
pub struct OwasResult {
    pub back: f64,
    pub arms: f64,
    pub legs: f64,
    pub force: f64,
    pub final_score: f64,   // 작업자세 수준 (1~4)
    pub grade_label: String,
    pub action: String,
}

/// OWAS 작업자세 수준 (엑셀 N35/S27~S29 와 동일).
fn owas_grade(level: f64) -> (&'static str, &'static str) {
    match level as i64 {
        1 => ("수준 1", "근골격계에 특별한 해를 끼치지 않으며, 작업자세 조치 불필요"),
        2 => ("수준 2", "근골격계에 약간의 해를 끼치며, 가까운 시일 내 작업자세의 교정 필요"),
        3 => ("수준 3", "근골격계에 직접적인 해를 끼치며, 가능한 빨리 작업자세를 교정해야 함"),
        _ => ("수준 4", "근골격계에 매우 심각한 해를 끼치며, 즉각적인 작업자세의 교정 필요"),
    }
}

/// OWAS 점수 계산.
///
/// 엑셀 수식 매핑:
///   - 최종 = INDEX(table, 3*(허리-1)+팔, 3*(다리-1)+무게)
///
/// 주의: OWAS 부위는 단순 합산(클램프 없음). 엑셀 G5/G9/G12/G19 모두 단순 Σ(E*F).
pub fn calculate_owas(input: &OwasInput, data: &crate::data::AssessmentData) -> OwasResult {
    // OWAS 모든 부위는 엑셀에서 단순 합산(클램프 없음).
    // 빈 선택만 1로 폴백해 인덱스 언더플로우를 방지한다.
    let back = sum_or_one_if_empty(&input.back);
    let arms = sum_or_one_if_empty(&input.arms);
    let legs = sum_or_one_if_empty(&input.legs);
    let force = sum_or_one_if_empty(&input.force);

    let tbl = &data.owas.table;

    // 최종: INDEX(L8:AF19, 3*(G5-1)+G9, 3*(G12-1)+G19)
    //   G5=허리, G9=팔, G12=다리, G19=무게
    let row = (3.0 * (back - 1.0) + arms) as usize;
    let col = (3.0 * (legs - 1.0) + force) as usize;
    let final_score = index(tbl, row, col);

    let (grade_label, action) = owas_grade(final_score);

    OwasResult {
        back,
        arms,
        legs,
        force,
        final_score,
        grade_label: grade_label.to_string(),
        action: action.to_string(),
    }
}

// ============================================================================
// 단위 테스트 — 엑셀에서 산출된 실제 결과값으로 단정
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// 엑셀 원본의 실제 체크 항목(앞서 추출)을 그대로 재현한 RULA 입력.
    /// 엑셀 결과: 점수A=9, 점수B=6, 점수C=10, 점수D=7, 최종=7 (4단계)
    fn excel_rula_input() -> RulaInput {
        RulaInput {
            // 행8(4)+행9(1)+행10(1) = 6  ← 엑셀 H5=6
            upper_arm: vec![4.0, 1.0, 1.0],
            // 행13(2) = 2  ← 엑셀 H12=2
            lower_arm: vec![2.0],
            // 행16(2)+행18(1) = 3  ← 엑셀 H15=3
            wrist: vec![2.0, 1.0],
            // 행20(2) = 2  ← 엑셀 H19=2
            wrist_twist: vec![2.0],
            // 행21(1) = 1  ← 엑셀 H21=1
            neck: vec![1.0],
            // 행29(3)+행31(1)+행32(1) = 5  ← 엑셀 H27=5
            trunk: vec![3.0, 1.0, 1.0],
            // 행33(1) = 1  ← 엑셀 H33=1
            legs: vec![1.0],
            // 행35(1) = 1  ← 엑셀 H35=1
            muscle: vec![1.0],
            // 행36(0) = 0  ← 엑셀 H36=0
            force: vec![0.0],
        }
    }

    /// 엑셀 원본의 REBA 입력. 엑셀 결과: 점수A=5, 점수B=12, 점수C=9, 최종=12 (매우높음)
    fn excel_reba_input() -> RebaInput {
        RebaInput {
            // 행7(3) = 3  ← 엑셀 H5=3
            trunk: vec![3.0],
            // 행10(1) = 1  ← 엑셀 H10=1
            neck: vec![1.0],
            // 행13(1) = 1  ← 엑셀 H13=1
            legs: vec![1.0],
            // 행19(2)+행20(1) = 3  ← 엑셀 H17=3
            force_a: vec![2.0, 1.0],
            // 행24(4)+행25(1)+행26(1) = 6  ← 엑셀 H21=6
            upper_arm: vec![4.0, 1.0, 1.0],
            // 행29(2) = 2  ← 엑셀 H28=2
            lower_arm: vec![2.0],
            // 행31(2)+행32(1) = 3  ← 엑셀 H30=3
            wrist: vec![2.0, 1.0],
            // 행36(3) = 3  ← 엑셀 H33=3
            coupling: vec![3.0],
            // 행37(1)+행38(1)+행39(1) = 3  ← 엑셀 H37=3
            activity: vec![1.0, 1.0, 1.0],
        }
    }

    /// 엑셀 원본의 OWAS 입력. 엑셀 결과: 허리3, 팔1, 다리3, 무게3, 최종=2 (수준2)
    fn excel_owas_input() -> OwasInput {
        OwasInput {
            // 행7(3) = 3  ← 엑셀 G5=3
            back: vec![3.0],
            // 행9(1) = 1  ← 엑셀 G9=1
            arms: vec![1.0],
            // 행14(3) = 3  ← 엑셀 G12=3
            legs: vec![3.0],
            // 행21(3) = 3  ← 엑셀 G19=3
            force: vec![3.0],
        }
    }

    fn load_data() -> crate::data::AssessmentData {
        crate::data::load()
    }

    #[test]
    fn rula_matches_excel() {
        let data = load_data();
        let r = calculate_rula(&excel_rula_input(), &data);
        assert_eq!(r.upper_arm, 6.0, "윗팔");
        assert_eq!(r.lower_arm, 2.0, "아래팔");
        assert_eq!(r.wrist, 3.0, "손목");
        assert_eq!(r.wrist_twist, 2.0, "손목비틀림");
        assert_eq!(r.neck, 1.0, "목");
        assert_eq!(r.trunk, 5.0, "몸통");
        assert_eq!(r.legs, 1.0, "다리");
        assert_eq!(r.score_a, 9.0, "점수A");
        assert_eq!(r.score_b, 6.0, "점수B");
        assert_eq!(r.extra, 1.0, "추가점수");
        assert_eq!(r.score_c, 10.0, "점수C");
        assert_eq!(r.score_d, 7.0, "점수D");
        assert_eq!(r.final_score, 7.0, "최종 점수");
        assert_eq!(r.grade, 4, "등급");
    }

    #[test]
    fn reba_matches_excel() {
        let data = load_data();
        let r = calculate_reba(&excel_reba_input(), &data);
        assert_eq!(r.trunk, 3.0, "허리");
        assert_eq!(r.neck, 1.0, "목");
        assert_eq!(r.legs, 1.0, "다리");
        assert_eq!(r.force_a, 3.0, "무게A");
        assert_eq!(r.upper_arm, 6.0, "상완");
        assert_eq!(r.lower_arm, 2.0, "전완");
        assert_eq!(r.wrist, 3.0, "손목");
        assert_eq!(r.coupling, 3.0, "손잡이");
        assert_eq!(r.activity, 3.0, "활동");
        assert_eq!(r.score_a_raw, 2.0, "점수A원");
        assert_eq!(r.score_b_raw, 9.0, "점수B원");
        assert_eq!(r.score_a, 5.0, "점수A");
        assert_eq!(r.score_b, 12.0, "점수B");
        assert_eq!(r.score_c, 9.0, "점수C");
        assert_eq!(r.final_score, 12.0, "최종 점수");
        assert_eq!(r.grade, 5, "등급: 매우 높은 위험");
    }

    #[test]
    fn owas_matches_excel() {
        let data = load_data();
        let r = calculate_owas(&excel_owas_input(), &data);
        assert_eq!(r.back, 3.0, "허리");
        assert_eq!(r.arms, 1.0, "팔");
        assert_eq!(r.legs, 3.0, "다리");
        assert_eq!(r.force, 3.0, "무게");
        assert_eq!(r.final_score, 2.0, "작업자세 수준");
        assert!(r.grade_label.contains("수준 2"), "등급 라벨");
    }

    /// 빈 입력(아무것도 선택 안 함) → 모든 부위가 1로 폴백되어 안전하게 계산된다.
    ///
    /// 참고: 엑셀 원본은 윗팔(H5)에만 `IF(Σ=0,1,Σ)` 클램프가 있고 나머지 부위는
    /// 클램프가 없어 빈 입력 시 음수 인덱스로 #REF! 에러가 발생한다.
    /// 즉 엑셀 자체도 "아무것도 선택 안 함"을 지원하지 않는다.
    /// 본 앱은 모든 부위에 대해 빈 선택을 1로 폴백해 크래시 없이 동작한다.
    /// (이 영역은 엑셀과 다르지만, 정상 입력 범위에서는 100% 동일 결과)
    #[test]
    fn rula_empty_input_is_safe() {
        let data = load_data();
        let empty = RulaInput {
            upper_arm: vec![],
            lower_arm: vec![],
            wrist: vec![],
            wrist_twist: vec![],
            neck: vec![],
            trunk: vec![],
            legs: vec![],
            muscle: vec![],
            force: vec![],
        };
        let r = calculate_rula(&empty, &data);
        // 모든 부위 폴백 1 → 점수A=1, 점수B=1, 추가(근육1+무게1)=2
        // → C=3, D=3 → 최종 테이블[3][3] = 3
        assert_eq!(r.upper_arm, 1.0);
        assert_eq!(r.score_a, 1.0);
        assert_eq!(r.score_b, 1.0);
        assert_eq!(r.score_c, 3.0);
        assert_eq!(r.final_score, 3.0, "빈 입력 폴백 시 점수 3");
        assert!(!r.final_score.is_nan(), "결과가 유한해야 함");
    }

    #[test]
    fn owas_empty_input_is_safe() {
        let data = load_data();
        let empty = OwasInput {
            back: vec![],
            arms: vec![],
            legs: vec![],
            force: vec![],
        };
        let r = calculate_owas(&empty, &data);
        // 모든 부위 폴백 1 → table[1][1] = 1
        assert_eq!(r.final_score, 1.0, "빈 입력 폴백 시 수준 1");
        assert!(!r.final_score.is_nan(), "결과가 유한해야 함");
    }
}

//! 엑셀에서 추출한 평가 데이터(JSON)를 바이너리에 임베드하고
//! serde 구조체로 파싱해 제공한다.
//!
//! 소스 파일: `../../assessment_data.json` (엑셀에서 추출, Python 스크립트로 검증 완료)

use serde::{Deserialize, Serialize};

/// 평가 항목 하나 (설명 + 기준 점수).
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Item {
    pub desc: String,
    pub score: f64,
}

/// 부위 정보 (라벨 + 항목 목록).
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Part {
    pub label: String,
    pub items: Vec<Item>,
}

/// RULA 데이터: 3개 lookup 테이블 + 9개 부위.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RulaData {
    pub parts: std::collections::HashMap<String, Part>,
    #[serde(rename = "tableA")]
    pub table_a: Vec<Vec<f64>>,
    #[serde(rename = "tableB")]
    pub table_b: Vec<Vec<f64>>,
    #[serde(rename = "tableFinal")]
    pub table_final: Vec<Vec<f64>>,
}

/// REBA 데이터: 3개 lookup 테이블 + 9개 부위.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RebaData {
    pub parts: std::collections::HashMap<String, Part>,
    #[serde(rename = "tableA")]
    pub table_a: Vec<Vec<f64>>,
    #[serde(rename = "tableB")]
    pub table_b: Vec<Vec<f64>>,
    #[serde(rename = "tableC")]
    pub table_c: Vec<Vec<f64>>,
}

/// OWAS 데이터: 1개 lookup 테이블 + 4개 부위.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OwasData {
    pub parts: std::collections::HashMap<String, Part>,
    pub table: Vec<Vec<f64>>,
}

/// 전체 평가 데이터 (최상위).
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AssessmentData {
    #[serde(rename = "RULA")]
    pub rula: RulaData,
    #[serde(rename = "REBA")]
    pub reba: RebaData,
    #[serde(rename = "OWAS")]
    pub owas: OwasData,
}

/// 임베드된 JSON 원문.
const JSON_STR: &str = include_str!("../../assessment_data.json");

/// 임베드된 JSON을 파싱해 반환한다.
/// 컴파일 시점에 JSON 형식이 검증되므로 런타임 에러는 사실상 발생하지 않는다.
pub fn load() -> AssessmentData {
    serde_json::from_str(JSON_STR).expect("assessment_data.json 파싱 실패")
}

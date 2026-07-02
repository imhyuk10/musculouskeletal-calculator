//! 근골격계 평가 데스크톱 앱 - Tauri 백엔드 진입점.
//!
//! 두 개의 명령을 노출한다:
//!   - `get_data`: 부위/항목 데이터를 프론트엔드에 제공 (UI 렌더링용)
//!   - `calculate`: 선택 항목을 받아 점수를 계산해 반환

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod calc;
mod data;

use data::AssessmentData;
use std::sync::OnceLock;

/// 임베드된 평가 데이터를 프로세스 전역에 한 번만 파싱해 캐싱.
static DATA: OnceLock<AssessmentData> = OnceLock::new();

fn data() -> &'static AssessmentData {
    DATA.get_or_init(data::load)
}

/// 프론트엔드가 UI를 렌더링할 수 있도록 부위/항목 데이터를 반환한다.
/// lookup 테이블은 결과 노출에 불필요하므로 제외할 수 있으나,
/// 투명성을 위해 통째로 직렬화해 돌려준다(용량 작음).
#[tauri::command]
fn get_data() -> &'static AssessmentData {
    data()
}

/// 통합 계산 명령. 어떤 평가 도구인지 `tool` 필드로 구분한다.
#[derive(serde::Deserialize)]
#[serde(tag = "tool", rename_all = "UPPERCASE")]
enum CalcRequest {
    Rula { input: calc::RulaInput },
    Reba { input: calc::RebaInput },
    Owas { input: calc::OwasInput },
}

/// 계산 결과는 도구별로 다른 형태이므로 serde_json::Value로 감싸 반환한다.
#[tauri::command]
fn calculate(req: CalcRequest) -> serde_json::Value {
    let d = data();
    match req {
        CalcRequest::Rula { input } => serde_json::to_value(calc::calculate_rula(&input, d)),
        CalcRequest::Reba { input } => serde_json::to_value(calc::calculate_reba(&input, d)),
        CalcRequest::Owas { input } => serde_json::to_value(calc::calculate_owas(&input, d)),
    }
    .expect("결과 직렬화 실패")
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_data, calculate])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

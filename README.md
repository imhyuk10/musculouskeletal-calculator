# 근골격계 평가 계산기 (Musculoskeletal Assessment Calculator)

엑셀 평가지(`유해요인조사 평가지.xlsx`)의 RULA / REBA / OWAS 계산 로직을
그대로 구현한 가벼운 윈도우 데스크톱 앱. Rust + Tauri + Vanilla JS.

## 기능

- RULA (상지 평가), REBA (전신 평가), OWAS (작업 자세 분석) 점수 산출
- 체크 항목 선택 시 실시간 점수 계산
- 2D / 3D 자세 시각화 (체크한 각도에 따라 skeleton이 변함)

## 실행

```bash
npm install
npm run dev      # 개발 모드
npm run build    # 빌드 (.exe 생성)
```

# Lane 7 구현 계획: Log Viewer

## 사용할 서비스
- LogBufferService (Lane 3): 로그 스트리밍, 버퍼, 뷰포트 조회
- ScrollableBuffer (Lane 4): 스크롤 관리 (선택적 사용)

## 구현할 파일
1. src/ui/log-viewer.ts - 메인 UI
2. src/cli/logs.ts - -i 옵션 추가

## 핵심 기능
- 자동 스크롤 토글 (A 키)
- 레인 필터 전환 (Tab, 0-9)
- 새 로그 카운터 (▼ +N new)
- 위아래 자유 스크롤

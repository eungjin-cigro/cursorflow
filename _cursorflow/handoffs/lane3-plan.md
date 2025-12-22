# Lane 3 구현 계획: LogBufferService

## 핵심 해결
- 로그를 메모리 버퍼에 누적 (최대 10,000 라인 등 설정 가능)
- 뷰포트 기반 조회 (스크롤 지원 - offset, limit 적용)
- 새 로그 카운터 (자동스크롤 OFF 시 "▼ +N new" 표시 지원)
- 실시간 스트리밍 (100ms 간격 폴링 및 EventEmitter 기반 업데이트)

## 구현할 파일
src/utils/log-buffer.ts

## 메서드
- startStreaming() / stopStreaming(): 실시간 로그 폴링 시작/중지
- getEntries(viewport): 뷰포트(offset, limit) 및 필터(lane, importance, search) 기반 로그 조회
- getTotalCount(filter?): 필터링된 전체 로그 개수 반환
- getNewEntriesCount(): 마지막 확인 이후 추가된 로그 개수
- acknowledgeNewEntries(): 새 로그 확인 완료 처리 (카운터 리셋)
- getLanes(): 현재 발견된 모든 레인 목록 반환

## Lane 7 (Log Viewer)에서 사용할 API
- LogBufferService의 모든 메서드는 Lane 7에서 인터랙티브 UI를 구현할 때 백엔드 API로 활용됩니다.
- `on('update', callback)`을 통해 UI에 실시간 업데이트를 통보합니다.
- `getEntries`를 통해 현재 스크롤 위치에 맞는 로그만 효율적으로 렌더링합니다.

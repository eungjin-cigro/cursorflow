# Lane 3 완료: LogBufferService 및 LogService

## 구현된 파일

### src/utils/log-buffer.ts
- `LogBufferService` 클래스

### src/utils/log-service.ts
- `LogService` 클래스 (정적 유틸리티)

## LogBufferService API

### 생성자
```typescript
const buffer = new LogBufferService(runDir, {
  maxEntries: 10000,    // 최대 버퍼 크기
  pollInterval: 100     // 폴링 간격 ms
});
```

### 주요 메서드

#### 스트리밍 제어
```typescript
buffer.startStreaming();   // 실시간 스트리밍 시작
buffer.stopStreaming();    // 스트리밍 중지
```

#### 뷰포트 조회
```typescript
const entries = buffer.getViewport({
  offset: 0,              // 시작 위치
  limit: 50,              // 가져올 개수
  laneFilter: 'lane-1',   // 특정 레인 필터 (선택)
  importanceFilter: LogImportance.LOW,  // 중요도 필터 (선택)
  searchQuery: 'error'    // 텍스트 검색 (선택)
});
```

#### 상태 조회
```typescript
const state = buffer.getState();
// {
//   totalEntries: 150,
//   filteredCount: 42,
//   newCount: 5,
//   isStreaming: true,
//   lanes: ['lane-1', 'lane-2']
// }
```

#### 새 로그 확인
```typescript
buffer.acknowledgeNewEntries();  // 새 로그 카운터 리셋
```

### 이벤트
```typescript
buffer.on('update', (newEntries: BufferedLogEntry[]) => {
  // 새 로그 도착 시 호출
});
```

## LogService API (정적 메서드)

```typescript
// 로그 중요도 판정
LogService.getLogImportance(entry): LogImportance

// 중요도 필터 체크
LogService.meetsImportanceLevel(entry, minLevel): boolean
```

## 타입 정의 (src/utils/types.ts)

```typescript
export enum LogImportance {
  DEBUG = 'debug',
  INFO = 'info',
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}
```

## Lane 7에서 할 일

1. `LogBufferService` 인스턴스 생성
2. `startStreaming()` 호출하여 실시간 로그 수집
3. 사용자 스크롤에 따라 `getViewport()` 호출
4. 레인/중요도 필터 적용
5. 'update' 이벤트로 새 로그 감지
6. `acknowledgeNewEntries()`로 "새 로그 N개" 카운터 리셋

## 테스트

```bash
npm test -- --testPathPattern="log-buffer"
```

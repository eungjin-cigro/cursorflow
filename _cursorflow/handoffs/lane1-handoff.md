# Lane 1 완료: RunService + ProcessManager

## 구현된 파일
- `src/utils/run-service.ts`
- `src/utils/process-manager.ts`

## RunService API

### 사용법
```typescript
import { RunService } from '../utils/run-service';

const runService = new RunService(logsDir);
```

### 메서드
| 메서드 | 설명 | 사용처 |
|--------|------|--------|
| listRuns(filter?) | run 목록 조회 | runs 명령어, Run Selector |
| getRunInfo(runId) | 단일 run 상세 | runs 명령어 상세, Run Selector |
| getActiveRuns() | 실행 중인 runs | stop 명령어 |
| stopRun(runId) | run 정지 | stop 명령어, Run Selector |
| stopAllRuns() | 전체 정지 | stop 명령어 |
| getLinkedResources(runId) | 연결 리소스 | clean 명령어 |
| deleteRun(runId) | run 삭제 | clean 명령어 |

## ProcessManager API
```typescript
import { ProcessManager } from '../utils/process-manager';

ProcessManager.isProcessRunning(pid);
ProcessManager.killProcess(pid);
```

## 사용 예시

### Lane 5에서 (runs/stop/clean)
```typescript
// runs 명령어
const runs = runService.listRuns({ status: 'running' });

// stop 명령어
runService.stopRun(runId);
runService.stopAllRuns();

// clean --run 옵션
const resources = runService.getLinkedResources(runId);
runService.deleteRun(runId);
```

### Lane 8에서 (Run Selector)
```typescript
const runs = runService.listRuns();
const selected = runService.getRunInfo(runId);
runService.stopRun(selectedRun.id);
```

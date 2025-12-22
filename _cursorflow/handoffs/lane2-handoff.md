# Lane 2 완료: TaskService

## 구현된 파일
`src/utils/task-service.ts`

## API

### 사용법
```typescript
import { TaskService } from '../utils/task-service';

const taskService = new TaskService(tasksDir);
```

### 메서드
| 메서드 | 설명 | 사용처 |
|--------|------|--------|
| listTaskDirs() | 태스크 목록 | tasks 명령어, Task Browser |
| getTaskDirInfo(name) | 태스크 상세 | tasks 명령어, Task Browser |
| validateTaskDir(name) | Doctor 실행 | tasks --validate, Task Browser |
| canRun(name) | 실행 가능 여부 | Task Browser |

## 사용 예시

### Lane 6에서 (tasks 명령어)
```typescript
const tasks = taskService.listTaskDirs();
const info = taskService.getTaskDirInfo(taskName);
const report = taskService.validateTaskDir(taskName);
```

### Lane 8에서 (Task Browser)
```typescript
const tasks = taskService.listTaskDirs();
const { ok, issues } = taskService.canRun(taskName);
```

# Lane 2 구현 계획: TaskService

## 구현할 파일
src/utils/task-service.ts

## TaskService 메서드
- listTaskDirs()
- getTaskDirInfo(taskName)
- validateTaskDir(taskName)
- getValidationStatus(taskName)
- canRun(taskName)

## 타입 정의
- TaskDirInfo
- LaneFileInfo
- ValidationStatus

## 다른 레인에서 사용할 API
- Lane 6 (tasks 명령어): 전체 API
- Lane 8 (Task Browser): listTaskDirs, getTaskDirInfo, validateTaskDir

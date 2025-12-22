# Lane 1 구현 계획: RunService + ProcessManager

## 구현할 파일
1. src/utils/run-service.ts
2. src/utils/process-manager.ts

## RunService 메서드
- listRuns(filter?): `_cursorflow/logs/runs/` 디렉토리를 스캔하여 `RunInfo` 목록 반환
- getRunInfo(runId): 특정 Run의 상세 정보(상태, 레인 정보, 리소스 등) 반환
- getActiveRuns(): 상태가 'running'인 Run 목록 반환
- calculateRunStatus(runPath): 여러 레인의 `state.json`을 분석하여 전체 Run 상태(running, completed, failed, partial) 계산
- getLinkedResources(runId): Run과 연결된 Git 브랜치 및 워크트리 목록 조회
- stopRun(runId): Run에 속한 모든 레인의 프로세스(PID)를 찾아 종료
- stopAllRuns(): 모든 실행 중인 Run 정지
- deleteRun(runId, options?): Run 디렉토리 삭제 및 선택적으로 연결된 리소스(브랜치 등) 정리

## ProcessManager 메서드
- isProcessRunning(pid): PID를 통해 프로세스가 살아있는지 확인 (signal 0 사용)
- killProcess(pid, signal?): 특정 프로세스 종료 (기본 SIGTERM)
- killProcessTree(pid): (선택 사항) 프로세스 그룹이나 트리 종료 (필요 시 pkill/pgrep 활용)

## 기존 코드 재사용
- `src/utils/state.ts`: `loadState`를 사용하여 각 레인의 `state.json`에서 `status`, `pid`, `pipelineBranch` 정보를 읽어옵니다. `listLanesInRun`을 활용해 Run 하위의 레인 구조를 파악합니다.
- `src/utils/config.ts`: `getLogsDir()`를 사용하여 `_cursorflow/logs` 경로를 일관되게 참조합니다.
- `src/cli/clean.ts`: 브랜치 및 워크트리 정리 로직(`cleanBranches`, `cleanWorktrees`)을 참고하여 `deleteRun` 시 리소스 정리를 구현합니다.
- `src/utils/git.ts`: 브랜치 삭제 및 워크트리 제거를 위해 기존 `git.deleteBranch`, `git.removeWorktree`를 활용합니다.

## 다른 레인에서 사용할 API
- Lane 5 (runs/stop/clean 명령어): RunService 전체, ProcessManager
- Lane 8 (Run Selector): RunService.listRuns, getRunInfo

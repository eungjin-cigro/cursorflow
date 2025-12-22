# Lane 5 구현 계획

## 사용할 서비스 (Lane 1)
- RunService: listRuns, getRunInfo, stopRun, stopAllRuns, getLinkedResources, deleteRun
- ProcessManager: killProcess

## 구현할 파일
1. src/cli/runs.ts - 신규
2. src/cli/stop.ts - 신규
3. src/cli/clean.ts - 확장

## 각 명령어 옵션
- runs: --running, --status, --json
- stop: --lane, --force, --yes
- clean: --run, --older-than, --orphaned

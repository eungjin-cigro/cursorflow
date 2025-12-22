# Lane 5 완료: runs/stop/clean 명령어

## 구현된 파일
- src/cli/runs.ts
- src/cli/stop.ts
- src/cli/clean.ts (확장)

## 명령어 요약

### runs
```bash
cursorflow runs              # 전체 목록
cursorflow runs --running    # 실행 중만
cursorflow runs <run-id>     # 상세
```

### stop
```bash
cursorflow stop              # 전체 정지
cursorflow stop <run-id>     # 특정 run
cursorflow stop --yes        # 확인 없이
```

### clean (확장)
```bash
cursorflow clean --run <id>      # 특정 run
cursorflow clean --older-than 7  # 7일 이전
cursorflow clean --orphaned      # 고아 리소스
```

## Lane 8에서 할 일
- index.ts에 runs, stop 명령어 등록 (이미 Lane 5에서 완료됨)
- Run Selector UI에서 RunService 메서드 활용

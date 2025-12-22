# Lane 7 완료: Log Viewer

## 구현된 파일
- src/ui/log-viewer.ts
- src/cli/logs.ts (수정: -i 옵션)

## 사용법
```bash
cursorflow logs -i              # 인터랙티브 뷰어
cursorflow logs -i --run <id>   # 특정 run
```

## 키 바인딩
- ↑↓: 스크롤
- A: 자동 스크롤 토글
- Tab: 레인 필터 순환
- Q: 종료

## Lane 8에서 할 일
- Monitor에서 L 키로 Log Viewer 호출

# CursorFlow Init

## Overview
프로젝트에 CursorFlow를 초기화합니다. 설정 파일과 디렉토리 구조를 생성하고, 선택적으로 Cursor 커맨드와 예제 태스크를 설치합니다.

## Steps

1. **초기화 실행**
   ```bash
   cursorflow init
   ```

2. **옵션 선택**
   - `--example`: 예제 태스크 생성
   - `--config-only`: 설정 파일만 생성
   - `--no-commands`: Cursor 커맨드 설치 건너뛰기
   - `--force`: 기존 파일 덮어쓰기

3. **생성 확인**
   - `cursorflow.config.js` 파일 생성됨
   - `_cursorflow/tasks/` 디렉토리 생성됨
   - `_cursorflow/logs/` 디렉토리 생성됨
   - `.cursor/commands/cursorflow/` 커맨드 설치됨 (선택)

4. **설정 파일 검토**
   ```javascript
   // cursorflow.config.js
   module.exports = {
     tasksDir: '_cursorflow/tasks',
     logsDir: '_cursorflow/logs',
     baseBranch: 'main',
     // ... 기타 설정
   };
   ```

## 예제

### 기본 초기화
```bash
cursorflow init
```

### 예제 태스크 포함
```bash
cursorflow init --example
```

### 설정 파일만 생성
```bash
cursorflow init --config-only
```

### 기존 파일 덮어쓰기
```bash
cursorflow init --force
```

## Checklist
- [ ] 설정 파일이 프로젝트 루트에 생성되었는가?
- [ ] 필요한 디렉토리가 생성되었는가?
- [ ] Cursor 커맨드가 설치되었는가?
- [ ] 설정 내용이 프로젝트에 맞게 조정되었는가?

## Next Steps
1. `cursorflow.config.js` 파일을 프로젝트에 맞게 수정
2. Cursor IDE에서 `/` 입력하여 커맨드 확인
3. `cursorflow prepare MyFeature`로 태스크 생성 시작

# CursorFlow Clean

## Overview
브랜치, 워크트리, 로그 등을 정리합니다. 오래된 파일이나 실패한 실행의 잔여물을 제거합니다.

## Steps

1. **정리 타입 선택**
   
   | 타입 | 설명 |
   |------|------|
   | `branches` | Git 브랜치 정리 |
   | `worktrees` | Git worktree 정리 |
   | `logs` | 로그 파일 정리 |
   | `all` | 모두 정리 |

2. **브랜치 정리**
   ```bash
   cursorflow clean branches --pattern "feature/my-*"
   ```

3. **워크트리 정리**
   ```bash
   cursorflow clean worktrees --all
   ```

4. **로그 정리**
   ```bash
   cursorflow clean logs --older-than 30
   ```

5. **Dry run으로 확인**
   ```bash
   cursorflow clean all --dry-run
   ```

## 옵션

| 옵션 | 설명 |
|------|------|
| `--pattern <pattern>` | 패턴 매칭 (예: "feature/*") |
| `--older-than <days>` | N일 이상 된 항목만 (logs용) |
| `--dry-run` | 삭제할 항목만 표시 |
| `--force` | 확인 없이 삭제 |
| `--local-only` | 로컬만 (브랜치용) |
| `--remote-only` | 원격만 (브랜치용) |

## 예제

### 브랜치 정리

#### 패턴 매칭으로 삭제
```bash
cursorflow clean branches --pattern "feature/dashboard-*"
```

#### 모든 CursorFlow 브랜치
```bash
cursorflow clean branches --pattern "feature/*" --dry-run
```

#### 로컬 브랜치만
```bash
cursorflow clean branches --pattern "feature/*" --local-only
```

### 워크트리 정리

#### 모든 워크트리
```bash
cursorflow clean worktrees --all
```

#### 특정 패턴
```bash
cursorflow clean worktrees --pattern "*-dashboard-*"
```

### 로그 정리

#### 30일 이상 된 로그
```bash
cursorflow clean logs --older-than 30
```

#### 모든 로그
```bash
cursorflow clean logs --all --force
```

### 전체 정리

#### 모두 확인 후 삭제
```bash
cursorflow clean all --dry-run
cursorflow clean all --force
```

## 정리 결과

```
🧹 Cleaning CursorFlow Resources
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Branches to delete:
  - feature/dashboard-pipeline-abc123 (local)
  - feature/dashboard-pipeline-abc123 (remote)
  - feature/client-pipeline-def456 (local)

Worktrees to remove:
  - .cursorflow/logs/worktrees/01-dashboard-pipeline-abc123
  - .cursorflow/logs/worktrees/02-client-pipeline-def456

Logs to delete:
  - _cursorflow/logs/runs/01-dashboard-2025-12-10T10-00-00 (9 days old)

Total: 5 branches, 2 worktrees, 1 log directory

Proceed? [y/N]
```

## 주의사항

1. **백업**: 중요한 작업 중인 브랜치는 백업
2. **확인**: `--dry-run`으로 먼저 확인
3. **원격**: 원격 브랜치 삭제는 신중하게
4. **복구**: 삭제된 항목은 복구 어려움

## Checklist
- [ ] 정리할 항목을 확인했는가?
- [ ] 백업이 필요한가?
- [ ] dry-run으로 먼저 확인했는가?
- [ ] 다른 사람이 사용 중인 브랜치는 아닌가?
- [ ] 원격 저장소에서도 삭제할 것인가?

## 트러블슈팅

### 브랜치 삭제 실패
```bash
# 강제 삭제
git branch -D <branch-name>
git push origin --delete <branch-name>
```

### 워크트리 제거 실패
```bash
# 강제 제거
git worktree remove --force <worktree-path>
```

### 로그 디렉토리 권한 문제
```bash
# 권한 확인
ls -la _cursorflow/logs/
# 권한 수정
chmod -R u+w _cursorflow/logs/
```

## Next Steps
1. 정기적으로 로그 정리 (예: 월 1회)
2. CI/CD에 자동 정리 스크립트 추가
3. `.gitignore`에 로그 디렉토리 추가

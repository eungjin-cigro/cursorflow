# CursorFlow Prepare

## Overview
새 Feature에 대한 태스크 파일을 준비합니다. Feature 정보를 수집하고 레인별 JSON 파일을 생성합니다.

## 필수 참조
- 패키지 문서: `node_modules/@cursorflow/orchestrator/docs/GUIDE.md`
- 모델 목록: 터미널에서 `cursorflow models --list` 실행

## Steps

1. **Feature 정보 수집**
   
   사용자에게 다음 정보를 확인합니다:
   ```
   📋 태스크 준비 정보
   ================
   
   1. Feature 이름: [예: SchemaUpdate, AdminDashboard]
   2. 레인 개수: [예: 3]
   3. 레인별 작업 내용:
      - Lane 1: [작업 설명]
      - Lane 2: [작업 설명]
      - ...
   4. 의존성 변경 필요 여부: [Y/N]
   5. 참조할 기존 태스크 (선택): [경로 또는 N]
   ```

2. **태스크 폴더 생성**
   ```bash
   # 타임스탬프 기반 폴더명 생성 (YYMMDDHHMM - 10자리)
   TIMESTAMP=$(date +%y%m%d%H%M)
   FEATURE_NAME="<사용자 입력>"
   TASK_DIR="_cursorflow/tasks/${TIMESTAMP}_${FEATURE_NAME}"
   
   mkdir -p "$TASK_DIR"
   ```

3. **태스크 JSON 템플릿**
   
   각 레인마다 다음 구조의 JSON 파일을 생성합니다:
   ```json
   {
     "repository": "https://github.com/org/repo",
     "baseBranch": "main",
     "branchPrefix": "<feature>/<lane>-",
     "executor": "cursor-agent",
     "autoCreatePr": false,
     "allowDependencyChange": false,
     "lockfileReadOnly": true,
     "pollInterval": 60,
     
     "laneNumber": 1,
     "devPort": 3001,
     
     "enableReview": true,
     "reviewModel": "sonnet-4.5-thinking",
     "maxReviewIterations": 3,
     
     "tasks": [
       {
         "name": "plan",
         "model": "opus-4.5-thinking",
         "acceptanceCriteria": [
           "계획서 파일 생성됨"
         ],
         "prompt": "..."
       }
     ]
   }
   ```

4. **모델 선택 가이드**
   
   | 모델 | 용도 | 비고 |
   |------|------|------|
   | `sonnet-4.5` | 일반 구현, 빠른 작업 | 가장 범용적 |
   | `sonnet-4.5-thinking` | 코드 리뷰, 추론 강화 | Thinking 모델 |
   | `opus-4.5` | 복잡한 작업, 고품질 | 고급 모델 |
   | `opus-4.5-thinking` | 아키텍처 설계 | 최고급 |
   | `gpt-5.2` | 일반 작업용 | OpenAI |
   | `gpt-5.2-high` | 고급 추론 | 고성능 |

5. **생성 결과 확인**
   ```
   ✅ 태스크 준비 완료
   =================
   
   폴더: _cursorflow/tasks/<timestamp>_<feature>/
   생성된 파일:
     - 01-<lane1>.json
     - 02-<lane2>.json
     - ...
     - README.md
   
   다음 명령어로 실행:
     cursorflow run _cursorflow/tasks/<timestamp>_<feature>/
   ```

## 예제

### 단일 레인 태스크
```bash
cursorflow prepare MyFeature --lanes 1
```

### 멀티 레인 태스크
```bash
cursorflow prepare AdminDashboard --lanes 5
```

### 커스텀 템플릿 사용
```bash
cursorflow prepare MyFeature --template ./my-template.json
```

## Checklist
- [ ] Feature 이름이 명확한가?
- [ ] 레인별 작업이 정의되었는가?
- [ ] 모델 선택이 적절한가?
- [ ] 의존성 변경 필요 여부를 확인했는가?
- [ ] Acceptance Criteria가 명확한가?
- [ ] 생성된 파일들을 검토했는가?

## 주의사항
1. **모델명**: 유효한 모델만 사용 (models 명령으로 확인)
2. **경로**: 태스크는 항상 `_cursorflow/tasks/`에 생성
3. **브랜치 프리픽스**: 충돌하지 않도록 고유하게 설정
4. **devPort**: 레인마다 고유한 포트 (3001, 3002, ...)

## Next Steps
1. 생성된 JSON 파일들을 프로젝트에 맞게 수정
2. 프롬프트 내용을 상세하게 작성
3. `cursorflow run`으로 태스크 실행

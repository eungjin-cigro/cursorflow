# CursorFlow 아키텍처 및 커맨드 명세

이 문서는 CursorFlow의 작업 단위인 **Flow**, **Lane**, **Task**의 개념과 폴더 구조, 그리고 이를 다루는 커맨드 인터페이스를 정의합니다.

## 1. 핵심 개념 (Core Concepts)

### 🌊 Flow (플로우)
- **정의**: 하나의 완결된 기능을 개발하기 위한 **작업의 집합**입니다.
- **비유**: 프로젝트 하나, 혹은 큰 기능(Feature) 하나.
- **구성**: 여러 개의 **Lane**으로 구성됩니다.
- **물리적 형태**: `_cursorflow/flows/` 아래의 하나의 **디렉토리**.

### 🛣️ Lane (레인)
- **정의**: Flow 내에서 독립적인 Git Worktree를 가지고 **병렬로 실행되는 작업 줄기**입니다.
- **비유**: 팀 내의 개발자 한 명 (예: 백엔드 개발자, 프론트엔드 개발자).
- **구성**: 순차적으로 실행될 **Task**들의 리스트.
- **물리적 형태**: Flow 디렉토리 내의 **JSON 파일** (`01-backend.json`).

### 📝 Task (태스크)
- **정의**: AI 에이전트가 수행하는 **최소 작업 단위**입니다.
- **비유**: JIRA 티켓 하나, 혹은 커밋 하나.
- **구성**: 프롬프트, 모델 정보, 완료 조건.
- **물리적 형태**: Lane JSON 파일 내의 `tasks` 배열의 **아이템**.

---

## 2. 디렉토리 및 파일 구조

모든 Flow는 `_cursorflow/flows` 디렉토리에 저장됩니다.

```text
Project Root
└── _cursorflow/
    └── flows/
        └── 001_ShopFeature/        # [Flow] 디렉토리 (ID_이름)
            ├── flow.meta.json         # [Meta] Flow 메타데이터
            ├── 01-backend.json        # [Lane 1] 백엔드 작업 명세
            └── 02-frontend.json       # [Lane 2] 프론트엔드 작업 명세
```

### 📄 flow.meta.json (메타데이터 스키마)

Flow 자체에 대한 정보를 담습니다.

```json
{
  "id": "001",
  "name": "ShopFeature",
  "createdAt": "2024-12-25T10:30:00Z",
  "createdBy": "user",
  "baseBranch": "main",     // 이 Flow가 시작된 브랜치
  "status": "pending",      // pending | running | completed | failed
  "lanes": ["backend", "frontend"]
}
```

### 📄 01-backend.json (레인 스키마)

특정 Lane의 할 일(Task)을 담습니다.

```json
{
  "laneName": "backend",    // 레인 ID
  "tasks": [
    {
      "name": "implement",
      "model": "sonnet-4.5",
      "prompt": "API 구현...",
      "dependsOn": []       // 태스크 레벨 의존성
    }
  ]
}
```

---

## 3. 커맨드 인터페이스 (CLI)

복잡한 `prepare` 명령어를 **생성(new)**과 **추가(add)** 단계로 분리하여 직관성을 높입니다.

### 3.1 Flow 생성 (`new`)

Flow 폴더와 기본 Lane(빈 파일)들을 생성합니다.

```bash
# 사용법: cursorflow new <Flow이름> --lanes <레인명1,레인명2...>
cursorflow new ShopFeature --lanes "backend,frontend"
```

**동작:**
1. `_cursorflow/flows/{TIMESTAMP}_ShopFeature/` 폴더 생성
2. `flow.meta.json` 생성 (현재 브랜치 정보 저장)
3. 빈 Lane 파일 생성:
   - `01-backend.json`
   - `02-frontend.json`

### 3.2 Task 추가 (`add`)

생성된 Lane에 구체적인 작업(Task)을 부여합니다. `name`과 `prompt`는 필수, `model`은 선택입니다.

```bash
# 사용법: cursorflow add <Flow이름> <Lane이름> --task "name=...|prompt=..."

# 1. 백엔드에 할 일 추가 (기본 모델 사용)
cursorflow add ShopFeature backend \
  --task "name=plan|prompt=구현 계획 수립" \
  --task "name=implement|prompt=상품 검색 API 개발"
```

**고급 사용법: 정밀한 의존성 제어 (`--after`)**

단순히 레인 전체를 기다리는 것이 아니라, 특정 태스크가 완료된 후 실행되도록 설정할 수 있습니다.

```bash
# 2. 프론트엔드 추가: 여러 태스크를 기다림
cursorflow add ShopFeature frontend \
  --task "name=ui-impl|prompt=검색 UI 개발" \
  --after "backend:implement, db:migrate" 
```

**`--after` 옵션 형식:**
- `backend` (레인 이름만): 해당 레인의 **마지막 태스크** 완료 후 시작
- `backend:implement` (레인:태스크): 특정 태스크 완료 후 시작
- `api:test, db:setup` (콤마 구분): **여러 태스크가 모두 완료**된 후 시작

**Task 정의 형식:**
`--task` 옵션은 파이프(`|`)로 구분된 키-값 쌍을 사용합니다.
- 형식: `name=<이름>|prompt=<프롬프트>` (기본 모델 사용)
- 형식: `name=<이름>|model=<모델>|prompt=<프롬프트>` (모델 지정)

기본 모델 설정: `cursorflow config defaultModel <model-name>`

---

## 4. 시나리오 예시

**목표**: 쇼핑몰 검색 기능을 백엔드, 프론트엔드, 모바일 팀이 동시에 개발. 복잡한 의존성 존재.

```bash
# 1. Flow와 Lane 뼈대 만들기
cursorflow new SearchFeature --lanes "api,web,mobile"

# 2. API 레인: 의존성 없음, 바로 시작
cursorflow add SearchFeature api \
  --task "name=plan|prompt=API 설계" \
  --task "name=implement|prompt=ElasticSearch 기반 검색 API 구현" \
  --task "name=test|prompt=API 테스트 코드 작성"

# 3. Web 레인: API의 '구현(implement)' 단계만 끝나면 시작
cursorflow add SearchFeature web \
  --task "name=plan|prompt=UI 컴포넌트 설계" \
  --task "name=implement|prompt=검색 결과 페이지 UI 구현" \
  --after "api:implement"

# 4. Mobile 레인: API 테스트까지 모두 끝나야 시작
cursorflow add SearchFeature mobile \
  --task "name=app-impl|prompt=모바일 앱 검색 화면 구현" \
  --after "api:test"

# 5. 통합 테스트 레인 추가 (나중에): Web과 Mobile 모두 완료 후 실행
cursorflow add SearchFeature e2e \
  --task "name=verify|prompt=E2E 테스트 수행" \
  --after "web:implement, mobile:app-impl"
```

**실행 흐름 시각화:**

```text
api:    [plan] → [implement] ─→ [test]
                     │            │
web:                 └─→ [plan] ─→ [implement] ──┐
                                                 │
mobile:                           └─────────────→ [app-impl] ──┐
                                                               │
e2e:                                                           └─→ [verify]
```

```bash
# Flow 실행
cursorflow run ShopFeature

# 상태 모니터링
cursorflow monitor ShopFeature
```

---

**목표**: 쇼핑몰 검색 기능을 백엔드, 프론트엔드, 모바일 팀이 동시에 개발. 복잡한 의존성 존재.

```bash
# 1. Flow와 Lane 뼈대 만들기
cursorflow new SearchFeature --lanes "api,web,mobile"

# 2. API 레인: 의존성 없음, 바로 시작
cursorflow add SearchFeature api \
  --task "name=plan|model=o1-mini|prompt=API 설계" \
  --task "name=implement|model=sonnet-4.5|prompt=ElasticSearch 기반 검색 API 구현" \
  --task "name=test|model=sonnet-4.5|prompt=API 테스트 코드 작성"

# 3. Web 레인: API의 '구현(implement)' 단계만 끝나면 시작
cursorflow add SearchFeature web \
  --task "name=plan|model=sonnet-4.5|prompt=UI 컴포넌트 설계" \
  --task "name=implement|model=sonnet-4.5|prompt=검색 결과 페이지 UI 구현" \
  --after "api:implement"

# 4. Mobile 레인: API 테스트까지 모두 끝나야 시작
cursorflow add SearchFeature mobile \
  --task "name=app-impl|model=sonnet-4.5|prompt=모바일 앱 검색 화면 구현" \
  --after "api:test"

# 5. 통합 테스트 레인 추가 (나중에): Web과 Mobile 모두 완료 후 실행
cursorflow add SearchFeature e2e \
  --task "name=verify|model=sonnet-4.5|prompt=E2E 테스트 수행" \
  --after "web:implement, mobile:app-impl"
```

**실행 흐름 시각화:**

```text
api:    [plan] → [implement] ─→ [test]
                     │            │
web:                 └─→ [plan] ─→ [implement] ─→ [test] ──┐
                                                           │
mobile:                           └─────────────→ [plan] ─→ [implement] ─→ [test] ──┐
                                                                                    │
e2e:                                                                                └─→ [verify]
```


# cursorflow prepare

Flow 생성과 Task 추가를 위한 통합 가이드입니다.

## 워크플로우

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ 1. Flow 생성    │ ──▶ │ 2. Task 추가    │ ──▶ │ 3. 실행         │
│ (new)           │     │ (add)           │     │ (run)           │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

---

## 🎯 설계 원칙: Lane과 Task 나누기

> **핵심**: 엔지니어링 매니저가 개발자에게 업무를 할당하듯이 생각하세요.

### 1. Lane = 독립적인 개발자 1명

| 원칙 | 설명 |
|------|------|
| **한 레인 = 한 영역** | 프론트엔드 개발자에게 DB 마이그레이션을 동시에 시키지 않듯이, 레인에 서로 다른 도메인을 섞지 마세요 |
| **컨텍스트 유지** | 레인은 태스크 간 컨텍스트를 유지합니다. 도메인이 바뀌면 그 연속성이 끊깁니다 |

### 2. 언제 레인을 나눌까?

| 상황 | 레인 수 | 이유 |
|------|---------|------|
| Frontend + Backend | 2개 | 다른 파일 세트, 병렬 실행 가능 |
| DB + API + UI | 3개 | 순차 의존성, 명확한 분리 |
| 여러 마이크로서비스 | N개 | 완전히 독립된 코드베이스 |
| 리팩토링 + 새 기능 | 2개 | 리팩토링 먼저, 기능은 의존 |

### 3. 언제 한 레인에 유지할까?

| 상황 | 이유 |
|------|------|
| 같은 파일들을 순차 작업 | 컨텍스트 연속성 |
| Plan → Implement → Test | 단일 개발자 마인드셋 |
| 밀접하게 결합된 변경 | 머지 복잡성 방지 |

### 4. 좋은 프롬프트 작성법

```
❌ 나쁜 예: "기능 구현해줘"
✅ 좋은 예: "src/api/users.ts에 User 모델용 GET/POST/PUT/DELETE 엔드포인트 생성"
```

| 원칙 | 설명 |
|------|------|
| **구체적으로** | WHAT, WHERE, HOW를 명시 |
| **검증 포함** | "모든 엣지 케이스 처리 확인" 같은 검증 단계 추가 |
| **의존 시 머지 안내** | "머지 후 충돌 해결하고 통합 검증" |

### 5. 실패 대비 설계

- **verify 태스크 추가**: AI는 첫 시도에 엣지 케이스를 놓칠 수 있음
- **의존 레인엔 머지 지시**: "이전 브랜치 머지 후 통합 확인"

---

## Step 1: Flow와 Lane 생성 (`new`)

```bash
cursorflow new <FlowName> --lanes "lane1,lane2,..."
```

### 예시

```bash
# 백엔드와 프론트엔드 2개 레인 생성
cursorflow new ShopFeature --lanes "backend,frontend"

# API, Web, Mobile 3개 레인 생성
cursorflow new SearchFeature --lanes "api,web,mobile"
```

### 생성 결과

```
_cursorflow/flows/001_ShopFeature/
├── flow.meta.json       # Flow 메타데이터
├── backend.json         # Lane (빈 상태)
└── frontend.json        # Lane (빈 상태)
```

---

## Step 2: Task 추가 (`add`)

```bash
cursorflow add <FlowName> <LaneName> --task "name=...|prompt=..." [--after ...]
```

### --task 형식

```
"name=<이름>|prompt=<프롬프트>"          # 기본 모델 사용
"name=<이름>|model=<모델>|prompt=<프롬프트>"  # 모델 지정
```

| 필드 | 필수 | 설명 |
|------|------|------|
| `name` | ✅ | 태스크 이름 (영문, 숫자, -, _) |
| `prompt` | ✅ | 태스크 프롬프트/지시사항 |
| `model` | ❌ | AI 모델 (생략 시 기본 모델 사용) |

### --after 형식 (의존성)

| 형식 | 설명 |
|------|------|
| `"lane"` | 해당 레인의 **마지막 태스크** 완료 후 시작 |
| `"lane:task"` | 특정 태스크 완료 후 시작 |
| `"a:t1, b:t2"` | **여러 태스크가 모두 완료**된 후 시작 |

### 예시

```bash
# 단일 태스크 추가
cursorflow add SearchFeature api \
  --task "name=implement|prompt=검색 API 구현"

# 여러 태스크 추가
cursorflow add SearchFeature api \
  --task "name=plan|prompt=API 설계" \
  --task "name=implement|prompt=검색 API 구현" \
  --task "name=test|prompt=테스트 코드 작성"

# 의존성 설정
cursorflow add SearchFeature web \
  --task "name=ui|prompt=검색 UI 구현" \
  --after "api:implement"
```

---

## 전체 예시: 3-Lane 프로젝트

```bash
# 1. Flow 생성
cursorflow new SearchFeature --lanes "api,web,mobile"

# 2. API 레인: 의존성 없음, 바로 시작
cursorflow add SearchFeature api \
  --task "name=plan|prompt=API 설계" \
  --task "name=implement|prompt=검색 API 구현" \
  --task "name=test|prompt=API 테스트 작성"

# 3. Web 레인: API implement 완료 후 시작
cursorflow add SearchFeature web \
  --task "name=ui|prompt=검색 UI 구현" \
  --after "api:implement"

# 4. Mobile 레인: API 전체 완료 후 시작
cursorflow add SearchFeature mobile \
  --task "name=app|prompt=모바일 검색 화면 구현" \
  --after "api"

# 5. 검증 및 실행
cursorflow doctor SearchFeature
cursorflow run SearchFeature
```

### 실행 흐름

```
api:    [plan] → [implement] → [test]
                     │            │
web:                 └─→ [ui] ────┤
                                  │
mobile:                           └─→ [app]
```

---

## 기본 모델 설정

```bash
# 기본 모델 확인
cursorflow config defaultModel

# 기본 모델 변경
cursorflow config defaultModel gemini-2.5-flash

# 사용 가능한 모델 목록
cursorflow models
```

---

## 생성되는 파일 구조

### flow.meta.json

```json
{
  "id": "001",
  "name": "SearchFeature",
  "createdAt": "2024-12-26T10:30:00Z",
  "baseBranch": "main",
  "status": "pending",
  "lanes": ["api", "web", "mobile"]
}
```

### Lane 파일 (api.json)

```json
{
  "laneName": "api",
  "tasks": [
    { "name": "plan", "model": "sonnet-4.5", "prompt": "API 설계" },
    { "name": "implement", "model": "sonnet-4.5", "prompt": "검색 API 구현" },
    { "name": "test", "model": "sonnet-4.5", "prompt": "API 테스트 작성" }
  ]
}
```

### 의존성이 있는 Lane (web.json)

```json
{
  "laneName": "web",
  "tasks": [
    {
      "name": "ui",
      "model": "sonnet-4.5",
      "prompt": "검색 UI 구현",
      "dependsOn": ["api:implement"]
    }
  ]
}
```

---

## 다음 단계

- `cursorflow doctor <FlowName>` - 설정 검증
- `cursorflow run <FlowName>` - Flow 실행
- `cursorflow monitor latest` - 실행 모니터링

# cursorflow add

Lane에 Task를 추가합니다.

## 사용법

```bash
cursorflow add <FlowName> <LaneName> --task "name=...|model=...|prompt=..." [--after ...]
```

## 설명

지정된 Flow의 Lane에 Task를 추가합니다.
`--task` 옵션은 여러 번 사용하여 여러 태스크를 순차적으로 추가할 수 있습니다.

## --task 형식

```
"name=<이름>|model=<모델>|prompt=<프롬프트>"
```

### 필수 필드

| 필드 | 설명 | 예시 |
|------|------|------|
| `name` | 태스크 이름 (영문, 숫자, -, _) | `name=implement` |
| `prompt` | 태스크 프롬프트/지시사항 | `prompt=API 구현` |

### 선택 필드

| 필드 | 설명 | 예시 |
|------|------|------|
| `model` | AI 모델 (생략 시 기본 모델 사용) | `model=<your-model>` |

기본 모델 설정: `cursorflow config defaultModel <model-name>`

## --after 형식 (의존성 설정)

첫 번째 태스크가 시작되기 전에 완료되어야 할 태스크를 지정합니다.

| 형식 | 설명 |
|------|------|
| `"lane"` | 해당 레인의 **마지막 태스크** 완료 후 시작 |
| `"lane:task"` | 특정 태스크 완료 후 시작 |
| `"a:t1, b:t2"` | **여러 태스크가 모두 완료**된 후 시작 |

## 예시

### 기본 사용: 단일 태스크 추가 (기본 모델 사용)

```bash
cursorflow add SearchFeature api \
  --task "name=implement|prompt=검색 API 구현"
```

### 여러 태스크 추가

```bash
cursorflow add SearchFeature api \
  --task "name=plan|prompt=API 설계" \
  --task "name=implement|prompt=검색 API 구현" \
  --task "name=test|prompt=테스트 코드 작성"
```

### 의존성 설정: 특정 태스크 완료 후 시작

```bash
# api 레인의 implement 태스크 완료 후 시작
cursorflow add SearchFeature web \
  --task "name=ui|prompt=검색 UI 구현" \
  --after "api:implement"
```

### 의존성 설정: 레인 전체 완료 후 시작

```bash
# api 레인의 마지막 태스크 완료 후 시작
cursorflow add SearchFeature web \
  --task "name=ui|prompt=검색 UI 구현" \
  --after "api"
```

### 다중 의존성: 여러 태스크 완료 후 시작

```bash
# web과 mobile 모두 완료된 후 시작
cursorflow add SearchFeature e2e \
  --task "name=verify|prompt=E2E 테스트" \
  --after "web:ui, mobile:app"
```

## 출력 예시

```
✅ 3개 태스크 추가 완료

  📄 01-api.json

  ├── plan (<default-model>)
  ├── implement (<default-model>)
  └── test (<default-model>)

전체 태스크 목록:
  1. plan (new)
  2. implement (new)
  3. test (new)

다음 단계:
  cursorflow run SearchFeature    # Flow 실행
  cursorflow doctor SearchFeature # 설정 검증
```

## 생성되는 Lane 파일 구조

```json
{
  "laneName": "api",
  "tasks": [
    {
      "name": "plan",
      "model": "<your-model>",
      "prompt": "API 설계"
    },
    {
      "name": "implement",
      "model": "<your-model>",
      "prompt": "검색 API 구현"
    },
    {
      "name": "test",
      "model": "<your-model>",
      "prompt": "테스트 코드 작성"
    }
  ]
}
```

### 의존성이 있는 경우

```json
{
  "laneName": "web",
  "tasks": [
    {
      "name": "ui",
      "model": "<your-model>",
      "prompt": "검색 UI 구현",
      "dependsOn": ["01-api:implement"]
    }
  ]
}
```

## 관련 명령어

- [cursorflow new](cursorflow-new.md) - Flow와 Lane 생성
- [cursorflow run](cursorflow-run.md) - Flow 실행
- [cursorflow doctor](cursorflow-doctor.md) - 설정 검증


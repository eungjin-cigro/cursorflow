# cursorflow new

Flow와 Lane을 생성합니다.

## 사용법

```bash
cursorflow new <FlowName> --lanes "lane1,lane2,..."
```

## 설명

새로운 Flow 디렉토리를 생성하고, 지정된 Lane 파일들의 뼈대를 만듭니다.
각 Lane에 실제 Task를 추가하려면 `cursorflow add` 명령을 사용하세요.

## 옵션

| 옵션 | 설명 | 예시 |
|------|------|------|
| `--lanes <names>` | 콤마로 구분된 레인 이름 목록 (필수) | `--lanes "backend,frontend"` |

## 예시

### 기본 사용

```bash
# 백엔드와 프론트엔드 2개 레인 생성
cursorflow new ShopFeature --lanes "backend,frontend"
```

### 3개 레인 생성

```bash
# API, Web, Mobile 3개 레인 생성
cursorflow new SearchFeature --lanes "api,web,mobile"
```

## 생성 결과

```
_cursorflow/flows/001_ShopFeature/
├── flow.meta.json       # Flow 메타데이터
├── 01-backend.json      # Lane 1 (빈 상태)
└── 02-frontend.json     # Lane 2 (빈 상태)
```

### flow.meta.json 스키마

```json
{
  "id": "001",
  "name": "ShopFeature",
  "createdAt": "2024-12-25T10:30:00Z",
  "createdBy": "user",
  "baseBranch": "main",
  "status": "pending",
  "lanes": ["backend", "frontend"]
}
```

### Lane 파일 스키마 (빈 상태)

```json
{
  "laneName": "backend",
  "tasks": []
}
```

## 다음 단계

Flow 생성 후, 각 Lane에 Task를 추가합니다:

```bash
cursorflow add ShopFeature backend \
  --task "name=implement|prompt=API 구현"

cursorflow add ShopFeature frontend \
  --task "name=ui|prompt=UI 구현" \
  --after "backend:implement"
```

## 관련 명령어

- [cursorflow add](cursorflow-add.md) - Lane에 Task 추가
- [cursorflow run](cursorflow-run.md) - Flow 실행


# CursorFlow

> Git worktree 기반 병렬 AI 에이전트 오케스트레이션 시스템

[![npm version](https://img.shields.io/npm/v/@litmers/cursorflow-orchestrator.svg)](https://www.npmjs.com/package/@litmers/cursorflow-orchestrator)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

## 주요 기능

- 🚀 **병렬 실행**: Git worktree를 활용한 여러 레인 동시 실행
- 🔍 **자동 리뷰**: AI 기반 코드 리뷰 및 피드백 루프
- 📝 **상세 로깅**: 대화, 커밋, Git 작업 전문 기록
- 🔀 **의존성 관리**: 자동 dependency gate 및 재개
- 🎯 **레인별 포트**: 각 레인에 고유한 개발 서버 포트 할당
- 💻 **Cursor 통합**: 커스텀 커맨드로 IDE 내에서 직접 관리
- 🛠️ **설정 기반**: 프로젝트별 유연한 설정

## 빠른 시작

### 설치

```bash
# npm
npm install -g @litmers/cursorflow-orchestrator

# pnpm (권장)
pnpm add -g @litmers/cursorflow-orchestrator

# yarn
yarn global add @litmers/cursorflow-orchestrator
```

### 요구사항

- **Node.js** >= 18.0.0
- **Git** with worktree support
- **cursor-agent CLI**: `npm install -g @cursor/agent`

### 프로젝트 초기화

```bash
cd your-project
cursorflow init --example
```

이 명령은:
1. `cursorflow.config.js` 설정 파일 생성
2. `_cursorflow/tasks/` 및 `_cursorflow/logs/` 디렉토리 생성
3. Cursor IDE 커맨드 설치
4. 예제 태스크 생성 (--example 옵션 사용 시)

### 예제 실행

```bash
# 예제 태스크 실행
cursorflow run _cursorflow/tasks/example/

# 다른 터미널에서 모니터링
cursorflow monitor --watch
```

## Cursor IDE 통합

CursorFlow는 Cursor IDE 내에서 사용할 수 있는 커스텀 커맨드를 제공합니다.

### 커맨드 설치

```bash
# 초기화 시 자동 설치
cursorflow init

# 또는 수동 설치
npx cursorflow-setup
```

### 사용법

Cursor IDE 채팅에서 `/` 입력 후 다음 커맨드 사용:

- `/cursorflow-init` - 프로젝트 초기화
- `/cursorflow-prepare` - 태스크 준비
- `/cursorflow-run` - 오케스트레이션 실행
- `/cursorflow-monitor` - 실행 모니터링
- `/cursorflow-clean` - 정리 작업
- `/cursorflow-resume` - 중단된 레인 재개
- `/cursorflow-review` - 리뷰 설정 및 확인

## CLI 명령어

### 초기화
```bash
cursorflow init [options]
  --example          예제 태스크 생성
  --with-commands    Cursor 커맨드 설치 (기본: true)
  --config-only      설정 파일만 생성
```

### 태스크 준비
```bash
cursorflow prepare <feature> [options]
  --lanes <number>   레인 개수
  --template <path>  템플릿 파일 경로
```

### 실행
```bash
cursorflow run <tasks-dir> [options]
  --dry-run         실행 계획만 확인
  --executor <type>  cursor-agent | cloud
```

### 모니터링
```bash
cursorflow monitor [run-dir] [options]
  --watch           실시간 모니터링
  --interval <sec>  갱신 간격
```

### 정리
```bash
cursorflow clean <type> [options]
  branches          브랜치 정리
  worktrees         워크트리 정리
  logs              로그 정리
  all               모두 정리
```

### 재개
```bash
cursorflow resume <lane> [options]
  --clean           브랜치 정리 후 재시작
  --restart         처음부터 다시 시작
```

## 설정

### 설정 파일 (cursorflow.config.js)

```javascript
module.exports = {
  // 디렉토리 설정
  tasksDir: '_cursorflow/tasks',
  logsDir: '_cursorflow/logs',
  
  // Git 설정
  baseBranch: 'main',
  branchPrefix: 'feature/',
  
  // 실행 설정
  executor: 'cursor-agent',  // 'cursor-agent' | 'cloud'
  pollInterval: 60,
  
  // 의존성 관리
  allowDependencyChange: false,
  lockfileReadOnly: true,
  
  // 리뷰 설정
  enableReview: true,
  reviewModel: 'sonnet-4.5-thinking',
  maxReviewIterations: 3,
  
  // 레인 기본 설정
  defaultLaneConfig: {
    devPort: 3001,
    autoCreatePr: false,
  },
  
  // 로깅
  logLevel: 'info',
  verboseGit: false,
};
```

### 태스크 파일 (JSON)

```json
{
  "repository": "https://github.com/your-org/your-repo",
  "baseBranch": "main",
  "branchPrefix": "feature/my-",
  "executor": "cursor-agent",
  "laneNumber": 1,
  "devPort": 3001,
  "enableReview": true,
  "tasks": [
    {
      "name": "implement",
      "model": "sonnet-4.5",
      "acceptanceCriteria": [
        "빌드 에러 없음",
        "주요 기능 구현됨"
      ],
      "prompt": "구현 지시사항..."
    }
  ]
}
```

## 사용 예시

### 단일 기능 개발

```bash
# 1. 태스크 준비
cursorflow prepare AddUserAuth --lanes 1

# 2. 태스크 JSON 편집
# _cursorflow/tasks/2512191830_AddUserAuth/01-task.json

# 3. 실행
cursorflow run _cursorflow/tasks/2512191830_AddUserAuth/

# 4. 모니터링
cursorflow monitor --watch
```

### 멀티 도메인 병렬 개발

```bash
# 1. 태스크 준비 (5개 레인)
cursorflow prepare AdminDashboard --lanes 5

# 2. 각 레인 설정
# 01-dashboard.json, 02-clients.json, ...

# 3. 병렬 실행
cursorflow run _cursorflow/tasks/2512191830_AdminDashboard/

# 4. 실시간 모니터링
cursorflow monitor --watch --interval 5
```

## 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│                    CursorFlow CLI                       │
└──────────────────┬──────────────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
   ┌────▼────┐          ┌────▼────┐
   │ Config  │          │  Core   │
   │ System  │          │ Engine  │
   └────┬────┘          └────┬────┘
        │                    │
        │         ┌──────────┼──────────┐
        │         │          │          │
   ┌────▼────┐ ┌─▼──┐  ┌────▼────┐  ┌─▼─────┐
   │   Git   │ │Run │  │ Monitor │  │Review │
   │ Utils   │ │ner │  │         │  │       │
   └─────────┘ └─┬──┘  └─────────┘  └───────┘
                 │
        ┌────────┼────────┐
        │        │        │
   ┌────▼───┐ ┌─▼──────┐ │
   │Worktree│ │ Cursor │ │
   │        │ │ Agent  │ │
   └────────┘ └────────┘ │
                          │
                     ┌────▼────┐
                     │  Logs   │
                     │  State  │
                     └─────────┘
```

## 문서

- [📖 사용 가이드](docs/GUIDE.md) - 상세한 사용 방법
- [📋 API 레퍼런스](docs/API.md) - CLI 및 설정 API
- [🎨 커맨드 가이드](docs/COMMANDS.md) - Cursor 커맨드 사용법
- [🏗️ 아키텍처](docs/ARCHITECTURE.md) - 시스템 구조
- [🔧 트러블슈팅](docs/TROUBLESHOOTING.md) - 문제 해결
- [📦 예제 모음](examples/) - 실전 예제

## 로드맵

- [ ] v1.0: 핵심 기능 및 기본 문서
- [ ] v1.1: 향상된 리뷰 시스템
- [ ] v1.2: 클라우드 실행 개선
- [ ] v1.3: 플러그인 시스템
- [ ] v2.0: GUI 도구

## 기여하기

기여는 환영합니다! [CONTRIBUTING.md](CONTRIBUTING.md)를 참조해주세요.

### 개발 환경 설정

```bash
git clone https://github.com/eungjin-cigro/cursorflow.git
cd cursorflow
pnpm install
pnpm test
```

## 라이선스

MIT © Eugene Jin

## 지원

- 🐛 [Issue Tracker](https://github.com/eungjin-cigro/cursorflow/issues)
- 💬 [Discussions](https://github.com/eungjin-cigro/cursorflow/discussions)
- 📧 Email: eungjin.cigro@gmail.com

---

**Made with ❤️ for Cursor IDE users**

# cursor-agent CLI 사용 가이드

cursor-agent는 Cursor IDE의 AI 에이전트를 커맨드라인에서 실행할 수 있게 해주는 CLI 도구입니다.

---

## 설치 및 버전 확인

```bash
# 설치 위치 확인
$ which cursor-agent
/home/eugene/.local/bin/cursor-agent

# 버전 확인
$ cursor-agent --version
2025.12.17-996666f
```

버전 형식: `YYYY.MM.DD-<commit-hash>`

---

## 인증

### 로그인 상태 확인

```bash
$ cursor-agent status
 ✓ Logged in as eungjin@cigro.io
```

또는 `whoami` 별칭 사용:

```bash
$ cursor-agent whoami
 ✓ Logged in as eungjin@cigro.io
```

### 로그인/로그아웃

```bash
# 로그인 (브라우저 열림)
$ cursor-agent login

# 브라우저 없이 로그인
$ NO_OPEN_BROWSER=1 cursor-agent login

# 로그아웃
$ cursor-agent logout
```

---

## 기본 사용법

### Interactive 모드 (기본)

```bash
# 프롬프트와 함께 시작
$ cursor-agent "파일 목록을 보여줘"

# 프롬프트 없이 시작 (빈 에이전트)
$ cursor-agent
```

> **주의**: Interactive 모드는 터미널 UI를 사용합니다. 스크립트에서는 `--print` 옵션을 사용하세요.

### Non-Interactive 모드 (스크립트용)

```bash
# 콘솔에 결과 출력 (스크립트/자동화용)
$ cursor-agent --print "Hello, say hi"

# JSON 형식으로 출력
$ cursor-agent --print --output-format json "파일 목록 보여줘"

# 스트리밍 JSON 형식 (JSONL)
$ cursor-agent --print --output-format stream-json "코드 작성해줘"
```

---

## 채팅 세션 관리

### 새 세션 생성

```bash
$ cursor-agent create-chat
bf115bcb-2409-4a54-a6fd-c839cf507112
```

UUID 형식의 채팅 ID가 반환됩니다.

### 세션 목록 보기 (Interactive)

```bash
$ cursor-agent ls
```

**출력 (TUI):**
```
───────────────────────────────────────────────────────────────────────────
                        Sessions and Cloud Agents
───────────────────────────────────────────────────────────────────────────
  ▶   New Agent                                          Today 08:25 PM    
      New Agent                                          Today 08:21 PM    
      New Agent                                          Today 08:17 PM    
      ...

───────────────────────────────────────────────────────────────────────────
1/105 • ↑↓/jk: navigate • Enter: select • Backspace: delete • Ctrl-D/q/ESC
```

**조작:**
- `↑/↓` 또는 `j/k`: 탐색
- `Enter`: 선택
- `Backspace`: 삭제
- `q`, `ESC`, `Ctrl-D`: 종료

### 세션 재개

```bash
# 최신 세션 재개
$ cursor-agent resume

# 특정 세션 재개
$ cursor-agent --resume <chat-id>

# 스크립트에서 세션 재개
$ cursor-agent --print --resume <chat-id> "이어서 작업해줘"
```

---

## 고급 옵션

### 모델 선택

```bash
$ cursor-agent --model sonnet-4.5 "코드 리뷰해줘"
$ cursor-agent --model sonnet-4.5-thinking "복잡한 문제 분석해줘"
$ cursor-agent --model gpt-5.2 "빠른 응답 부탁해"
```

**사용 가능한 모델 목록 (2025.12 기준):**

```
composer-1, auto, 
sonnet-4.5, sonnet-4.5-thinking, 
opus-4.5, opus-4.5-thinking, opus-4.1,
gemini-3-pro, gemini-3-flash,
gpt-5.2, gpt-5.1, gpt-5.2-high, gpt-5.1-high,
gpt-5.1-codex, gpt-5.1-codex-high, gpt-5.1-codex-max, gpt-5.1-codex-max-high,
grok
```

> **참고**: 잘못된 모델명 사용 시 사용 가능한 모델 목록이 출력됩니다.

### 작업 디렉토리 지정

```bash
$ cursor-agent --workspace /path/to/project "이 프로젝트 분석해줘"
```

### 자동 승인 모드 (자동화용 권장 조합)

```bash
# 스크립트/자동화 환경에서 권장하는 플래그 조합
$ echo "프롬프트" | cursor-agent --print --output-format stream-json --force --approve-mcps

# 개별 플래그 설명:
# --print           : 콘솔 출력 (non-interactive)
# --output-format   : 출력 형식 지정
# --force           : 명령어 강제 허용 (write, bash 등)
# --approve-mcps    : MCP 서버 자동 승인 (headless 모드에서만)
```

**실제 검증된 예시:**

```bash
$ echo "Just say hello" | cursor-agent --print --output-format stream-json --force --approve-mcps
# 응답 시간: ~4285ms
# 모델: Gemini 3 Flash
```

### 브라우저 자동화

```bash
$ cursor-agent --browser "웹페이지 테스트해줘"
```

> **중요**: 웹 관련 작업이나 테스트를 실행할 때는 **반드시 `--browser` 옵션을 포함**해야 합니다. 이 옵션 없이는 브라우저 자동화 기능을 사용할 수 없습니다.

```bash
# 브라우저 테스트 예시 (필수 플래그 조합)
$ cursor-agent --print --browser --force --approve-mcps "이 웹페이지 테스트해줘"
```

---

## MCP (Model Context Protocol) 관리

### MCP 서버 목록

```bash
$ cursor-agent mcp list
No MCP servers configured (expected in .cursor/mcp.json or ~/.cursor/mcp.json)
```

### MCP 서버 인증

```bash
$ cursor-agent mcp login <server-identifier>
```

### MCP 도구 목록

```bash
$ cursor-agent mcp list-tools <server-identifier>
```

### MCP 서버 비활성화

```bash
$ cursor-agent mcp disable <server-identifier>
```

---

## 출력 형식

### text (기본) - 가장 간단한 출력

```bash
$ echo "Say only: HELLO" | cursor-agent --print --output-format text --force --approve-mcps
HELLO
```

```bash
$ echo "List 3 files in current directory" | cursor-agent --print --output-format text --force --approve-mcps
Here are 3 files from the current directory:

1. `CHANGELOG.md`
2. `package.json`
3. `README.md`
```

**특징**: 응답 텍스트만 깔끔하게 출력. 스크립트에서 결과만 필요할 때 적합.

### json - 메타데이터 포함 단일 JSON

```bash
$ echo "Say: OK" | cursor-agent --print --output-format json --force --approve-mcps
{"type":"result","subtype":"success","is_error":false,"duration_ms":3775,"duration_api_ms":3775,"result":"OK","session_id":"60b86ea9-0b17-4baa-b35a-c3efde316335","request_id":"1bb50eca-ea92-4dca-9d98-4309a23a86f9"}
```

**특징**: 최종 result만 하나의 JSON 객체로 출력. duration_ms, is_error 등 메타데이터 포함.

### stream-json (JSONL) - 실제 출력 예시

```bash
$ echo "Test prompt" | cursor-agent --print --output-format stream-json
```

각 이벤트를 JSON Lines 형식으로 스트리밍합니다. **실제 출력:**

#### 1. system (초기화)

```json
{
  "type": "system",
  "subtype": "init",
  "apiKeySource": "login",
  "cwd": "/home/user/project",
  "session_id": "44a47637-e9d7-43cb-977d-b038459a89eb",
  "model": "Gemini 3 Flash",
  "permissionMode": "default"
}
```

#### 2. user (사용자 프롬프트)

```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [{"type": "text", "text": "Test prompt"}]
  },
  "session_id": "44a47637-e9d7-43cb-977d-b038459a89eb"
}
```

#### 3. thinking (사고 과정) - 모델에 따라 출력

```json
{
  "type": "thinking",
  "subtype": "delta",
  "text": "**Responding to Input**\n\nI've received a test prompt...",
  "session_id": "44a47637-e9d7-43cb-977d-b038459a89eb",
  "timestamp_ms": 1766834964839
}
```

```json
{
  "type": "thinking",
  "subtype": "completed",
  "session_id": "44a47637-e9d7-43cb-977d-b038459a89eb",
  "timestamp_ms": 1766834969638
}
```

#### 4. assistant (응답)

```json
{
  "type": "assistant",
  "message": {
    "role": "assistant",
    "content": [{"type": "text", "text": "I've received your test prompt..."}]
  },
  "session_id": "44a47637-e9d7-43cb-977d-b038459a89eb"
}
```

#### 5. result (최종 결과)

```json
{
  "type": "result",
  "subtype": "success",
  "duration_ms": 9454,
  "duration_api_ms": 9454,
  "is_error": false,
  "result": "I've received your test prompt...",
  "session_id": "44a47637-e9d7-43cb-977d-b038459a89eb",
  "request_id": "12bb8970-895c-4568-959c-503a98fdc9dc"
}
```

### 메시지 타입 요약

| type | subtype | 설명 |
|------|---------|------|
| `system` | `init` | 세션 초기화 (모델, 권한 모드 등) |
| `user` | - | 사용자 프롬프트 |
| `thinking` | `delta` | 사고 과정 스트리밍 (여러 개가 순차적으로 출력됨) |
| `thinking` | `completed` | 사고 완료 |
| `assistant` | - | AI 응답 내용 |
| `tool_call` | `started` | 도구 호출 시작 (readToolCall, editToolCall, shellToolCall 등) |
| `tool_call` | `completed` | 도구 호출 완료 (결과 포함) |
| `result` | `success` / `error` | 최종 결과 및 메타데이터 |

### result 메시지 필드 상세

```json
{
  "type": "result",
  "subtype": "success",           // "success" 또는 "error"
  "duration_ms": 9454,            // 전체 실행 시간 (ms)
  "duration_api_ms": 9454,        // API 호출 시간 (ms)
  "is_error": false,              // 에러 여부
  "result": "응답 텍스트...",      // 최종 응답 (assistant.message.content와 동일)
  "session_id": "uuid-...",       // 세션 ID
  "request_id": "uuid-..."        // 요청 ID (디버깅용)
}
```

### tool_call 메시지 (도구 호출)

`stream-json` 모드에서 AI가 파일 읽기/쓰기, 터미널 명령 등을 실행할 때 `tool_call` 타입 메시지가 출력됩니다.

#### 기본 구조

```json
{
  "type": "tool_call",
  "subtype": "started" | "completed",
  "call_id": "toolu_bdrk_01QPJpBTGdcgAZrVa1ujzLvs",
  "tool_call": { /* 도구별 상세 정보 */ },
  "model_call_id": "f0d21e36-c978-4f5a-8285-0cd97ffe8c52-0-ymu5",
  "session_id": "a4d0c775-370b-46af-aa36-e38efcf610ee",
  "timestamp_ms": 1766835803076
}
```

#### tool_call 타입 목록

| 타입 | 설명 | 주요 필드 |
|------|------|----------|
| `readToolCall` | 파일 읽기 | `path` |
| `editToolCall` | 파일 쓰기/생성 | `path`, `streamContent` |
| `lsToolCall` | 디렉토리 목록 | `path`, `ignore` |
| `grepToolCall` | 파일 검색 | `pattern`, `path`, `type` |
| `shellToolCall` | 터미널 명령 실행 | `command`, `workingDirectory` |

---

### tool_call 실제 출력 예시

#### 1. readToolCall (파일 읽기)

**started:**
```json
{
  "type": "tool_call",
  "subtype": "started",
  "call_id": "toolu_bdrk_01QPJpBTGdcgAZrVa1ujzLvs",
  "tool_call": {
    "readToolCall": {
      "args": {
        "path": "/home/eugene/workbench/cursorflow/package.json"
      }
    }
  },
  "model_call_id": "f0d21e36-c978-4f5a-8285-0cd97ffe8c52-0-ymu5",
  "session_id": "a4d0c775-370b-46af-aa36-e38efcf610ee",
  "timestamp_ms": 1766835803076
}
```

**completed:**
```json
{
  "type": "tool_call",
  "subtype": "completed",
  "call_id": "toolu_bdrk_01QPJpBTGdcgAZrVa1ujzLvs",
  "tool_call": {
    "readToolCall": {
      "args": {
        "path": "/home/eugene/workbench/cursorflow/package.json"
      },
      "result": {
        "success": {
          "content": "{ \"name\": \"@litmers/cursorflow-orchestrator\", ... }",
          "isEmpty": false,
          "exceededLimit": false,
          "totalLines": 98,
          "fileSize": 2990,
          "path": "/home/eugene/workbench/cursorflow/package.json",
          "readRange": { "startLine": 1, "endLine": 98 }
        }
      }
    }
  },
  "timestamp_ms": 1766835803305
}
```

#### 2. editToolCall (파일 쓰기/생성)

**started:**
```json
{
  "type": "tool_call",
  "subtype": "started",
  "call_id": "toolu_bdrk_01RgkjEmzmVbT4oFwLvrUVu5",
  "tool_call": {
    "editToolCall": {
      "args": {
        "path": "/home/eugene/workbench/cursorflow/test-output.txt",
        "streamContent": "0.1.40"
      }
    }
  }
}
```

**completed:**
```json
{
  "type": "tool_call",
  "subtype": "completed",
  "call_id": "toolu_bdrk_01RgkjEmzmVbT4oFwLvrUVu5",
  "tool_call": {
    "editToolCall": {
      "args": {
        "path": "/home/eugene/workbench/cursorflow/test-output.txt",
        "streamContent": "0.1.40"
      },
      "result": {
        "success": {
          "path": "/home/eugene/workbench/cursorflow/test-output.txt",
          "linesAdded": 1,
          "linesRemoved": 1,
          "diffString": "-\n+0.1.40",
          "afterFullFileContent": "0.1.40",
          "message": "Wrote contents to /home/eugene/workbench/cursorflow/test-output.txt"
        }
      }
    }
  }
}
```

#### 3. lsToolCall (디렉토리 목록)

**started:**
```json
{
  "type": "tool_call",
  "subtype": "started",
  "call_id": "toolu_bdrk_01HSvq71bBcQ1o34jcXkbHzR",
  "tool_call": {
    "lsToolCall": {
      "args": {
        "path": "/home/eugene/workbench/cursorflow/src",
        "ignore": [],
        "toolCallId": "toolu_bdrk_01HSvq71bBcQ1o34jcXkbHzR"
      }
    }
  }
}
```

**completed:**
```json
{
  "type": "tool_call",
  "subtype": "completed",
  "call_id": "toolu_bdrk_01HSvq71bBcQ1o34jcXkbHzR",
  "tool_call": {
    "lsToolCall": {
      "result": {
        "success": {
          "directoryTreeRoot": {
            "absPath": "/home/eugene/workbench/cursorflow/src",
            "childrenDirs": [
              {
                "absPath": "/home/eugene/workbench/cursorflow/src/cli",
                "childrenFiles": [
                  { "name": "index.ts" },
                  { "name": "run.ts" }
                ]
              }
            ],
            "childrenFiles": []
          }
        }
      }
    }
  }
}
```

#### 4. grepToolCall (파일 검색)

**started:**
```json
{
  "type": "tool_call",
  "subtype": "started",
  "call_id": "toolu_bdrk_01H8vMpYi6DNXzTdmMCc4GrJ",
  "tool_call": {
    "grepToolCall": {
      "args": {
        "pattern": "(type|interface|enum)\\s+TaskStatus",
        "caseInsensitive": false,
        "type": "ts",
        "multiline": false,
        "toolCallId": "toolu_bdrk_01H8vMpYi6DNXzTdmMCc4GrJ"
      }
    }
  }
}
```

**completed (결과 있음):**
```json
{
  "type": "tool_call",
  "subtype": "completed",
  "tool_call": {
    "grepToolCall": {
      "result": {
        "success": {
          "pattern": "(type|interface|enum)\\s+TaskStatus",
          "outputMode": "content",
          "workspaceResults": {
            "/home/eugene/workbench/cursorflow": {
              "content": {
                "matches": [],
                "totalLines": 0,
                "totalMatchedLines": 0
              }
            }
          }
        }
      }
    }
  }
}
```

**completed (에러):**
```json
{
  "type": "tool_call",
  "subtype": "completed",
  "tool_call": {
    "grepToolCall": {
      "result": {
        "error": {
          "error": "rg: src/index.ts: IO error for operation on src/index.ts: No such file or directory (os error 2)\n"
        }
      }
    }
  }
}
```

#### 5. shellToolCall (터미널 명령 실행)

**started:**
```json
{
  "type": "tool_call",
  "subtype": "started",
  "call_id": "toolu_bdrk_011iqSuXW8q9bTwsZ5oN7fS1",
  "tool_call": {
    "shellToolCall": {
      "args": {
        "command": "git status",
        "workingDirectory": "",
        "timeout": 0,
        "toolCallId": "toolu_bdrk_011iqSuXW8q9bTwsZ5oN7fS1",
        "simpleCommands": ["git"],
        "hasInputRedirect": false,
        "hasOutputRedirect": false,
        "parsingResult": {
          "parsingFailed": false,
          "executableCommands": [
            {
              "name": "git",
              "args": [{ "type": "word", "value": "status" }],
              "fullText": "git status"
            }
          ],
          "hasRedirects": false,
          "hasCommandSubstitution": false
        },
        "isBackground": false,
        "skipApproval": false
      }
    }
  }
}
```

**completed:**
```json
{
  "type": "tool_call",
  "subtype": "completed",
  "call_id": "toolu_bdrk_011iqSuXW8q9bTwsZ5oN7fS1",
  "tool_call": {
    "shellToolCall": {
      "args": { "command": "git status", ... },
      "result": {
        "success": {
          "command": "git status",
          "workingDirectory": "",
          "exitCode": 0,
          "signal": "",
          "stdout": "On branch main\nYour branch is ahead of 'origin/main'...",
          "stderr": "",
          "executionTime": 286,
          "interleavedOutput": "On branch main\nYour branch is ahead of 'origin/main'..."
        },
        "isBackground": false
      }
    }
  }
}
```

---

### tool_call 파싱 (TypeScript)

```typescript
interface ToolCallMessage {
  type: 'tool_call';
  subtype: 'started' | 'completed';
  call_id: string;
  tool_call: {
    readToolCall?: ReadToolCall;
    editToolCall?: EditToolCall;
    lsToolCall?: LsToolCall;
    grepToolCall?: GrepToolCall;
    shellToolCall?: ShellToolCall;
  };
  model_call_id?: string;
  session_id: string;
  timestamp_ms?: number;
}

interface ReadToolCall {
  args: { path: string };
  result?: {
    success?: {
      content: string;
      isEmpty: boolean;
      totalLines: number;
      fileSize: number;
      path: string;
    };
    error?: { error: string };
  };
}

interface EditToolCall {
  args: { path: string; streamContent: string };
  result?: {
    success?: {
      path: string;
      linesAdded: number;
      linesRemoved: number;
      diffString: string;
      afterFullFileContent: string;
      message: string;
    };
  };
}

interface ShellToolCall {
  args: {
    command: string;
    workingDirectory: string;
    timeout: number;
  };
  result?: {
    success?: {
      command: string;
      exitCode: number;
      stdout: string;
      stderr: string;
      executionTime: number;
      interleavedOutput: string;
    };
    isBackground: boolean;
  };
}

// tool_call 처리 예시
function handleToolCall(msg: ToolCallMessage) {
  const tc = msg.tool_call;
  
  if (tc.readToolCall) {
    if (msg.subtype === 'started') {
      console.log(`📖 Reading: ${tc.readToolCall.args.path}`);
    } else if (tc.readToolCall.result?.success) {
      console.log(`✅ Read ${tc.readToolCall.result.success.totalLines} lines`);
    }
  }
  
  if (tc.editToolCall) {
    if (msg.subtype === 'started') {
      console.log(`✏️ Writing: ${tc.editToolCall.args.path}`);
    } else if (tc.editToolCall.result?.success) {
      console.log(`✅ ${tc.editToolCall.result.success.message}`);
    }
  }
  
  if (tc.shellToolCall) {
    if (msg.subtype === 'started') {
      console.log(`🖥️ Running: ${tc.shellToolCall.args.command}`);
    } else if (tc.shellToolCall.result?.success) {
      const r = tc.shellToolCall.result.success;
      console.log(`✅ Exit code: ${r.exitCode}, Time: ${r.executionTime}ms`);
    }
  }
  
  if (tc.grepToolCall) {
    if (msg.subtype === 'started') {
      console.log(`🔍 Searching: ${tc.grepToolCall.args.pattern}`);
    }
  }
  
  if (tc.lsToolCall) {
    if (msg.subtype === 'started') {
      console.log(`📁 Listing: ${tc.lsToolCall.args.path}`);
    }
  }
}
```

---

### thinking 메시지 특징

- 모델이 사고 과정을 가진 경우 (예: `*-thinking` 모델) 여러 개의 `delta`가 순차 출력
- 각 `delta`에 `timestamp_ms` 포함 (Unix timestamp)
- 마지막에 `completed` subtype으로 종료 신호

**Gemini 3 Flash (기본)** - 문장 단위 사고:
```json
{"type":"thinking","subtype":"delta","text":"**Processing a Command**\n\nI've registered the user's simple instruction...","timestamp_ms":1766835570307}
```

**Claude 4.5 Sonnet (Thinking)** - 토큰 단위 사고:
```json
{"type":"thinking","subtype":"delta","text":"The user is","timestamp_ms":1766835626277}
{"type":"thinking","subtype":"delta","text":" simply","timestamp_ms":1766835626330}
{"type":"thinking","subtype":"delta","text":" asking","timestamp_ms":1766835626335}
{"type":"thinking","subtype":"delta","text":" me to say \"TEST\".","timestamp_ms":1766835626385}
```

> **참고**: thinking 모델(`*-thinking`)은 더 세밀한 토큰 단위 스트리밍을 제공합니다.

### 부분 출력 스트리밍

```bash
$ cursor-agent --print --output-format stream-json --stream-partial-output "긴 코드 작성해줘"
```

텍스트 델타를 개별적으로 스트리밍합니다.

### 출력 형식 비교표

| 형식 | 출력 내용 | 용도 |
|------|----------|------|
| `text` | 응답 텍스트만 | 결과만 필요할 때 |
| `json` | result 메시지 (단일 JSON) | 메타데이터 필요, 간단한 파싱 |
| `stream-json` | 전체 과정 (JSONL) | 실시간 모니터링, 상세 분석 |

### 사용 사례별 권장 형식

```bash
# 단순 결과 확인
$ cursor-agent --print --output-format text "..."

# 성공/실패 판단이 필요한 스크립트
$ cursor-agent --print --output-format json "..."

# 실시간 진행 상황 모니터링 (CursorFlow)
$ cursor-agent --print --output-format stream-json "..."
```

---

## 환경 변수

| 변수 | 설명 |
|------|------|
| `CURSOR_API_KEY` | API 키 (--api-key 대신 사용) |
| `NO_OPEN_BROWSER` | 로그인 시 브라우저 열지 않음 |

---

## Shell Integration

### 설치

```bash
$ cursor-agent install-shell-integration
```

`~/.zshrc`에 shell integration을 설치합니다.

### 제거

```bash
$ cursor-agent uninstall-shell-integration
```

---

## 업데이트

```bash
$ cursor-agent update
# 또는
$ cursor-agent upgrade
```

---

## CursorFlow에서의 사용

CursorFlow 오케스트레이터는 cursor-agent를 다음과 같이 사용합니다:

### 1. 세션 생성

```bash
CHAT_ID=$(cursor-agent create-chat)
# 출력: 9abd2389-c088-4662-9880-958de1341156
```

### 2. 프롬프트 실행 (stream-json)

```bash
cursor-agent --print --output-format stream-json --resume $CHAT_ID "작업 프롬프트"
```

또는 stdin으로:

```bash
echo "작업 프롬프트" | cursor-agent --print --output-format stream-json
```

### 3. 출력 파싱 (TypeScript)

```typescript
interface StreamMessage {
  type: 'system' | 'user' | 'thinking' | 'assistant' | 'tool_call' | 'result';
  subtype?: 'init' | 'delta' | 'completed' | 'started' | 'success' | 'error';
  session_id: string;
  // system
  model?: string;
  permissionMode?: string;
  // thinking
  text?: string;
  timestamp_ms?: number;
  // assistant
  message?: { role: string; content: Array<{ type: string; text: string }> };
  // tool_call
  call_id?: string;
  tool_call?: {
    readToolCall?: { args: { path: string }; result?: any };
    editToolCall?: { args: { path: string; streamContent: string }; result?: any };
    lsToolCall?: { args: { path: string }; result?: any };
    grepToolCall?: { args: { pattern: string; path?: string }; result?: any };
    shellToolCall?: { args: { command: string }; result?: any };
  };
  model_call_id?: string;
  // result
  result?: string;
  is_error?: boolean;
  duration_ms?: number;
  request_id?: string;
}

// JSONL 파싱 예시
const lines = output.split('\n').filter(line => line.trim());
for (const line of lines) {
  const msg: StreamMessage = JSON.parse(line);
  
  switch (msg.type) {
    case 'system':
      console.log(`Session: ${msg.session_id}, Model: ${msg.model}`);
      break;
    case 'thinking':
      if (msg.subtype === 'delta') {
        process.stdout.write(msg.text || '');
      }
      break;
    case 'tool_call':
      const tc = msg.tool_call;
      if (msg.subtype === 'started') {
        if (tc?.readToolCall) console.log(`📖 Reading: ${tc.readToolCall.args.path}`);
        if (tc?.editToolCall) console.log(`✏️ Writing: ${tc.editToolCall.args.path}`);
        if (tc?.shellToolCall) console.log(`🖥️ Running: ${tc.shellToolCall.args.command}`);
        if (tc?.grepToolCall) console.log(`🔍 Searching: ${tc.grepToolCall.args.pattern}`);
        if (tc?.lsToolCall) console.log(`📁 Listing: ${tc.lsToolCall.args.path}`);
      } else if (msg.subtype === 'completed') {
        console.log(`✅ Tool call completed: ${msg.call_id}`);
      }
      break;
    case 'assistant':
      const content = msg.message?.content[0];
      if (content?.type === 'text') {
        console.log('Response:', content.text);
      }
      break;
    case 'result':
      console.log(`Done in ${msg.duration_ms}ms, Error: ${msg.is_error}`);
      break;
  }
}
```

### 4. 에러 처리

```typescript
// result 메시지에서 에러 확인
if (msg.type === 'result') {
  if (msg.is_error || msg.subtype === 'error') {
    throw new Error(`Agent error: ${msg.result}`);
  }
}
```

### 5. 모델 정보 확인

```typescript
// system 메시지에서 모델 정보 추출
if (msg.type === 'system' && msg.subtype === 'init') {
  console.log(`Using model: ${msg.model}`);
  // 출력: "Using model: Gemini 3 Flash" 또는 "Using model: Claude 4.5 Sonnet (Thinking)"
}
```

---

## Interactive vs Non-Interactive 모드 요약

| 명령어 | 모드 | 설명 |
|--------|------|------|
| `cursor-agent` | Interactive | TUI 에이전트 시작 |
| `cursor-agent "prompt"` | Interactive | 프롬프트와 함께 시작 |
| `cursor-agent ls` | Interactive | 세션 선택 TUI |
| `cursor-agent resume` | Interactive | 최신 세션 재개 |
| `cursor-agent --print "prompt"` | Non-Interactive | 콘솔 출력 |
| `cursor-agent create-chat` | Non-Interactive | 세션 ID만 출력 |
| `cursor-agent status` | Non-Interactive | 인증 상태 출력 |
| `cursor-agent mcp list` | Non-Interactive | MCP 목록 출력 |

---

## 전체 옵션 레퍼런스

```
Usage: cursor-agent [options] [command] [prompt...]

Arguments:
  prompt                       Initial prompt for the agent

Options:
  -v, --version                Output the version number
  --api-key <key>              API key for authentication
  -H, --header <header>        Add custom header (format: 'Name: Value')
  -p, --print                  Print responses to console (non-interactive)
  --output-format <format>     Output format: text | json | stream-json
  --stream-partial-output      Stream partial output as deltas
  -c, --cloud                  Start in cloud mode
  --resume [chatId]            Resume a chat session
  --model <model>              Model to use (e.g., gpt-5, sonnet-4)
  -f, --force                  Force allow commands
  --approve-mcps               Auto-approve MCP servers (headless only)
  --browser                    Enable browser automation
  --workspace <path>           Workspace directory
  -h, --help                   Display help

Commands:
  install-shell-integration    Install shell integration
  uninstall-shell-integration  Remove shell integration
  login                        Authenticate with Cursor
  logout                       Sign out
  mcp                          Manage MCP servers
  status|whoami                View authentication status
  update|upgrade               Update Cursor Agent
  create-chat                  Create new chat, return ID
  agent [prompt...]            Start the Cursor Agent
  ls                           List/select sessions (Interactive)
  resume                       Resume latest session
  help [command]               Display help
```

---

## 실제 사용 예시 (검증됨)

### 기본 실행 - 자동 승인 모드

```bash
$ echo "Just say hello in one sentence" | cursor-agent --print --output-format stream-json --force --approve-mcps
```

**실제 출력:**

```json
{"type":"system","subtype":"init","apiKeySource":"login","cwd":"/home/eugene/workbench/cursorflow","session_id":"610c015a-687c-4d50-a00b-b954bc915143","model":"Gemini 3 Flash","permissionMode":"default"}
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Just say hello in one sentence"}]},"session_id":"610c015a-687c-4d50-a00b-b954bc915143"}
{"type":"thinking","subtype":"delta","text":"**Crafting a Simple Greeting**\n\nI've distilled the request down to its essence: a single-sentence greeting. The process is straightforward; follow the directives and deliver a concise \"hello.\" No complex methodologies are needed here.\n\n\n","session_id":"610c015a-687c-4d50-a00b-b954bc915143","timestamp_ms":1766834497800}
{"type":"thinking","subtype":"completed","session_id":"610c015a-687c-4d50-a00b-b954bc915143","timestamp_ms":1766834497802}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hello! I'm here to help you with your coding tasks in the CursorFlow project."}]},"session_id":"610c015a-687c-4d50-a00b-b954bc915143"}
{"type":"result","subtype":"success","duration_ms":4285,"duration_api_ms":4285,"is_error":false,"result":"Hello! I'm here to help you with your coding tasks in the CursorFlow project.","session_id":"610c015a-687c-4d50-a00b-b954bc915143","request_id":"2860b62b-e0ac-48d3-82e6-ebf27451f093"}
```

### 세션 생성 후 --resume으로 실행

```bash
$ CHAT_ID=$(cursor-agent create-chat)
$ echo $CHAT_ID
9abd2389-c088-4662-9880-958de1341156

$ cursor-agent --print --output-format stream-json --resume $CHAT_ID "Say Hello"
```

**실제 출력:**

```json
{"type":"system","subtype":"init","apiKeySource":"login","cwd":"/home/eugene/workbench/cursorflow","session_id":"9abd2389-c088-4662-9880-958de1341156","model":"Gemini 3 Flash","permissionMode":"default"}
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Say: Hello"}]},"session_id":"9abd2389-c088-4662-9880-958de1341156"}
```

### 복잡한 프롬프트 실행

```bash
$ echo "Test prompt" | cursor-agent --print --output-format stream-json
```

**실제 출력 (사고 과정 포함):**

```json
{"type":"system","subtype":"init","apiKeySource":"login","cwd":"/home/eugene/workbench/cursorflow","session_id":"44a47637-e9d7-43cb-977d-b038459a89eb","model":"Gemini 3 Flash","permissionMode":"default"}
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Test prompt"}]},"session_id":"44a47637-e9d7-43cb-977d-b038459a89eb"}
{"type":"thinking","subtype":"delta","text":"**Responding to Input**\n\nI've received a test prompt. My initial thought is to acknowledge the input and determine its purpose. I'll ask if there's any specific assistance needed related to the `cursorflow` project, as that seems relevant.\n\n\n","session_id":"44a47637-e9d7-43cb-977d-b038459a89eb","timestamp_ms":1766834964839}
{"type":"thinking","subtype":"delta","text":"**Processing the `git status`**\n\nI've scanned the `git status` output. It's a lot! Many modified files, and some new ones. My next step will be to summarize the changes. Then, I'll need to assess the overall impact, prioritizing critical areas like CI configuration and core functionality within `src`.\n\n\n","session_id":"44a47637-e9d7-43cb-977d-b038459a89eb","timestamp_ms":1766834966968}
{"type":"thinking","subtype":"delta","text":"**Refining the Approach**\n\nI'm now prioritizing a clear, concise response. Initially, I will simply acknowledge the \"Test prompt\". I need to determine the user's ultimate goal. Then, considering the `git status`, I'll inquire about the specifics of the test. Specifically, is the test focused on prompt generation logic or something else entirely?\n\n\n","session_id":"44a47637-e9d7-43cb-977d-b038459a89eb","timestamp_ms":1766834968888}
{"type":"thinking","subtype":"delta","text":"**Evaluating User Intent**\n\nI've registered the \"Test prompt\" and am now focused on decoding the user's immediate needs. Given the volume of changes in `git status`, I'm leaning towards inquiring about the specifics of the test. However, the simplicity of the prompt makes me consider a more direct approach: a simple acknowledgement followed by a request for further instructions.\n\n\n","session_id":"44a47637-e9d7-43cb-977d-b038459a89eb","timestamp_ms":1766834969628}
{"type":"thinking","subtype":"completed","session_id":"44a47637-e9d7-43cb-977d-b038459a89eb","timestamp_ms":1766834969638}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"I've received your test prompt and I'm ready to assist you with the **CursorFlow** codebase.\n\nI see that you have quite a few changes in progress, including several new core components like `git-lifecycle-manager.ts` and `lane-state-machine.ts`, as well as a new testing structure.\n\nWould you like me to:\n1. **Analyze or debug** any of the new components you're working on?\n2. **Help with a commit** for the current changes?\n3. **Run tests** (like the new `e2e/orchestration.test.ts`) to verify your progress?\n4. **Implement a new feature** or refactor existing code?\n\nLet me know how you'd like to proceed"}]},"session_id":"44a47637-e9d7-43cb-977d-b038459a89eb"}
{"type":"result","subtype":"success","duration_ms":9454,"duration_api_ms":9454,"is_error":false,"result":"I've received your test prompt and I'm ready to assist you with the **CursorFlow** codebase.\n\nI see that you have quite a few changes in progress, including several new core components like `git-lifecycle-manager.ts` and `lane-state-machine.ts`, as well as a new testing structure.\n\nWould you like me to:\n1. **Analyze or debug** any of the new components you're working on?\n2. **Help with a commit** for the current changes?\n3. **Run tests** (like the new `e2e/orchestration.test.ts`) to verify your progress?\n4. **Implement a new feature** or refactor existing code?\n\nLet me know how you'd like to proceed","session_id":"44a47637-e9d7-43cb-977d-b038459a89eb","request_id":"12bb8970-895c-4568-959c-503a98fdc9dc"}
```

> **참고**: 
> - stdin으로 프롬프트를 전달하면 새 세션이 자동 생성됩니다.
> - `--force --approve-mcps` 플래그는 자동화 환경에서 승인 없이 실행할 때 유용합니다.

### 도구 호출 포함 예시 (파일 읽기 + 쓰기)

```bash
$ echo "Read the file package.json and tell me the name and version. Then create test-output.txt with the version." | cursor-agent --print --output-format stream-json --force --approve-mcps
```

**실제 출력 (주요 메시지만 발췌):**

```json
{"type":"system","subtype":"init","model":"Claude 4.5 Sonnet (Thinking)","session_id":"a4d0c775-..."}
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Read the file package.json..."}]}}

{"type":"tool_call","subtype":"started","call_id":"toolu_bdrk_01QPJp...","tool_call":{"readToolCall":{"args":{"path":"/home/eugene/workbench/cursorflow/package.json"}}}}
{"type":"tool_call","subtype":"completed","call_id":"toolu_bdrk_01QPJp...","tool_call":{"readToolCall":{"args":{"path":"..."},"result":{"success":{"content":"{\n  \"name\": \"@litmers/cursorflow-orchestrator\",\n  \"version\": \"0.1.40\"...","totalLines":98,"fileSize":2990}}}}}

{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Perfect! I found the information. The package name is **@litmers/cursorflow-orchestrator** and the version is **0.1.40**."}]}}

{"type":"tool_call","subtype":"started","call_id":"toolu_bdrk_01Rgkj...","tool_call":{"editToolCall":{"args":{"path":"/home/eugene/workbench/cursorflow/test-output.txt","streamContent":"0.1.40"}}}}
{"type":"tool_call","subtype":"completed","call_id":"toolu_bdrk_01Rgkj...","tool_call":{"editToolCall":{"result":{"success":{"path":"...","linesAdded":1,"linesRemoved":1,"diffString":"-\n+0.1.40","message":"Wrote contents to /home/eugene/workbench/cursorflow/test-output.txt"}}}}}

{"type":"result","subtype":"success","duration_ms":13434,"is_error":false,"result":"Done! I've read the package.json file and created the output file..."}
```

### 터미널 명령 실행 예시

```bash
$ echo "Run 'git status' and 'git log --oneline -3'" | cursor-agent --print --output-format stream-json --force --approve-mcps
```

**실제 출력 (주요 메시지만 발췌):**

```json
{"type":"tool_call","subtype":"started","call_id":"toolu_bdrk_011iq...","tool_call":{"shellToolCall":{"args":{"command":"git status","simpleCommands":["git"]}}}}
{"type":"tool_call","subtype":"completed","call_id":"toolu_bdrk_011iq...","tool_call":{"shellToolCall":{"result":{"success":{"command":"git status","exitCode":0,"stdout":"On branch main\nYour branch is ahead of 'origin/main' by 17 commits...","executionTime":286}}}}}

{"type":"tool_call","subtype":"started","call_id":"toolu_bdrk_01MyFd...","tool_call":{"shellToolCall":{"args":{"command":"git log --oneline -3"}}}}
{"type":"tool_call","subtype":"completed","call_id":"toolu_bdrk_01MyFd...","tool_call":{"shellToolCall":{"result":{"success":{"exitCode":0,"stdout":"69f15b0 refactor: improve logging...\n745de17 fix: use stream-json...","executionTime":277}}}}}

{"type":"result","subtype":"success","duration_ms":11879,"is_error":false}
```

> **팁**: AI가 여러 도구를 병렬로 호출할 수 있습니다 (위 예시에서 두 git 명령이 동시 실행).

---

## 트러블슈팅

### 출력이 없는 경우

1. **인증 확인**: `cursor-agent status`
2. **네트워크 확인**: API 서버 접근 가능 여부
3. **타임아웃**: 모델 응답 시간이 길 수 있음 (특히 thinking 모델)

### Interactive 모드에서 나가기

- `q`, `ESC`, `Ctrl-D` 중 하나 사용
- `cursor-agent ls` 실행 시 TUI가 열림 - 위 키로 종료

### 스크립트에서 사용 시

- 반드시 `--print` 플래그 사용
- `--output-format stream-json`으로 파싱 가능한 출력 획득
- 타임아웃 설정 권장: `timeout 120 cursor-agent --print ...`

### 브라우저 관련 작업 시

- **반드시 `--browser` 플래그 포함**
- 웹 테스트, 스크린샷, 페이지 조작 등 브라우저 기능 사용 시 필수

```bash
# 잘못된 사용 (브라우저 기능 사용 불가)
$ cursor-agent --print "웹페이지 테스트해줘"

# 올바른 사용
$ cursor-agent --print --browser "웹페이지 테스트해줘"
```

### 모델을 찾을 수 없는 경우

```bash
$ cursor-agent --model invalid-model "test"
Cannot use this model: invalid-model. Available models: composer-1, auto, sonnet-4.5, ...
```

잘못된 모델명 사용 시 사용 가능한 모델 목록이 자동으로 출력됩니다.

---

## 프로세스 중단 및 Resume 동작

### 프로세스 종료 시그널과 Exit Code

| 시그널 | Exit Code | 설명 |
|--------|-----------|------|
| SIGTERM (15) | 143 (128+15) | 정상적인 종료 요청. 프로세스가 graceful shutdown 가능 |
| SIGKILL (9) | 137 (128+9) | 강제 종료. 프로세스가 cleanup 없이 즉시 종료 |
| SIGINT (2) | 130 (128+2) | 인터럽트 (Ctrl+C). 사용자가 수동으로 중단 |
| timeout | 124 | timeout 명령에 의한 종료 |

### 세션 컨텍스트 유지

cursor-agent는 `--resume <chatId>` 옵션을 통해 대화 컨텍스트를 유지합니다.

**핵심 동작:**

1. **세션 ID 기반**: 각 chat 세션은 UUID 형식의 고유 ID를 가짐
2. **서버 측 저장**: 대화 히스토리는 Cursor 서버에 저장됨
3. **프로세스 독립**: 로컬 프로세스가 종료되어도 서버의 대화 기록은 유지됨
4. **Resume 가능**: 동일한 chatId로 resume하면 이전 대화 컨텍스트 복원

**⚠️ 중요한 타이밍 고려사항:**

프로세스 중단 시 메시지가 서버에 완전히 전송/처리되기 전에 종료되면 해당 메시지의 컨텍스트가 저장되지 않을 수 있습니다:

- **안전**: 에이전트가 응답을 완료한 후 다음 태스크 중에 중단
- **위험**: 프롬프트 전송 직후 (1-2초 이내) 즉시 중단

```
# 타이밍 예시
# 안전한 중단 - 첫 태스크 완료 후 두 번째 태스크 중에 중단
Step 1: "Remember CODE=123" → Agent: "OK" (완료됨, 컨텍스트 저장됨)
Step 2: "Count to 100" → 중간에 SIGTERM → Resume 시 CODE=123 기억함

# 위험한 중단 - 메시지 처리 전에 중단
Step 1: "Remember CODE=123" → SIGTERM (1초 후) → 컨텍스트 손실 가능
```

**검증된 시나리오:**

```bash
# 1. 세션 생성 및 첫 메시지
$ CHAT_ID=$(cursor-agent create-chat)
$ echo "Remember: CODE=TEST123. Say OK." | \
    cursor-agent --print --output-format text --resume "$CHAT_ID" --force --approve-mcps
OK, I'll remember CODE=TEST123.

# 2. 프로세스 중단 (SIGTERM/SIGKILL/timeout)
$ echo "Count to 100" | \
    timeout 3 cursor-agent --print --resume "$CHAT_ID" --force --approve-mcps &
$ PID=$!
$ sleep 2 && kill -TERM $PID
# Exit code: 143 (SIGTERM)

# 3. Resume 후 컨텍스트 확인
$ echo "What CODE did I tell you?" | \
    cursor-agent --print --output-format text --resume "$CHAT_ID" --force --approve-mcps
The code you told me was CODE=TEST123.
```

### 중단 후 Resume 흐름

```
1. cursor-agent --resume <chatId> 시작
   ↓
2. stdin으로 프롬프트 전달 → stdin 닫힘
   ↓
3. 외부에서 SIGTERM/SIGKILL 전송 (또는 timeout)
   ↓
4. 프로세스 종료 (exit 143/137/124)
   ↓
5. 새 cursor-agent --resume <chatId> 실행
   ↓
6. 서버가 이전 대화 기록 복원
   ↓
7. 새 프롬프트가 기존 컨텍스트에 추가됨
```

### CursorFlow 개입(Intervention) 시스템

CursorFlow는 cursor-agent의 resume 기능을 활용하여 즉각적인 개입을 구현합니다.

**기존 방식의 한계:**

```
- stdin은 프롬프트 전송 후 즉시 닫힘
- intervention.txt 파일 감시는 되지만 실시간 주입 불가
- 메시지는 다음 태스크에서만 적용됨
```

**새로운 즉각 개입 방식:**

```
1. cursorflow signal <lane> "message"
   ↓
2. pending-intervention.json 생성
   ↓
3. 현재 cursor-agent 프로세스 SIGTERM으로 중단
   ↓
4. Orchestrator가 프로세스 종료 감지 (exit 143)
   ↓
5. pending-intervention.json 읽어서 프롬프트에 주입
   ↓
6. 새 cursor-agent --resume <chatId> 실행 (개입 메시지 포함)
```

**실제 사용 예:**

```bash
# Lane 1이 실행 중일 때 즉시 개입
$ cursorflow signal lane-1 "Stop current task and focus on error handling first"

# 결과:
# - lane-1의 cursor-agent 프로세스가 SIGTERM으로 종료됨
# - 개입 메시지가 다음 프롬프트에 자동 주입됨
# - 에이전트가 새 지시에 따라 작업 계속
```

---

## 테스트 및 검증

### cursor-agent 동작 검증 테스트

**1. 기본 기능 테스트**

```bash
# 버전 확인
$ cursor-agent --version
2025.12.17-996666f

# 인증 상태 확인
$ cursor-agent status
 ✓ Logged in as user@example.com

# 세션 생성
$ cursor-agent create-chat
9abd2389-c088-4662-9880-958de1341156
```

**2. 프롬프트 실행 테스트**

```bash
# 단순 프롬프트 (텍스트 출력)
$ echo "Say: Hello" | cursor-agent --print --output-format text --force --approve-mcps
Hello

# JSON 출력 (메타데이터 포함)
$ echo "Say: OK" | cursor-agent --print --output-format json --force --approve-mcps
{"type":"result","subtype":"success","is_error":false,"duration_ms":3775,...}

# 스트리밍 출력 (실시간 모니터링)
$ echo "Read package.json" | cursor-agent --print --output-format stream-json --force --approve-mcps
{"type":"system","subtype":"init",...}
{"type":"user",...}
{"type":"tool_call","subtype":"started",...}
{"type":"tool_call","subtype":"completed",...}
{"type":"assistant",...}
{"type":"result",...}
```

**3. 세션 유지 테스트**

```bash
# 세션 생성 및 컨텍스트 저장
CHAT_ID=$(cursor-agent create-chat)
echo "Remember the number 42. Say OK." | \
  cursor-agent --print --output-format text --resume "$CHAT_ID" --force --approve-mcps
# 출력: OK, I remember 42.

# 동일 세션에서 컨텍스트 확인
echo "What number did I ask you to remember?" | \
  cursor-agent --print --output-format text --resume "$CHAT_ID" --force --approve-mcps
# 출력: 42
```

**4. 프로세스 중단 테스트**

```bash
CHAT_ID=$(cursor-agent create-chat)

# 첫 메시지
echo "Remember: SECRET=ABC123" | \
  timeout 20 cursor-agent --print --output-format text --resume "$CHAT_ID" --force --approve-mcps

# 두 번째 메시지 중간에 중단
echo "Count from 1 to 100" | \
  timeout 3 cursor-agent --print --resume "$CHAT_ID" --force --approve-mcps &
PID=$!
sleep 2
kill -TERM $PID  # Exit code: 143

# Resume 후 컨텍스트 확인
echo "What was the SECRET?" | \
  cursor-agent --print --output-format text --resume "$CHAT_ID" --force --approve-mcps
# 출력: SECRET=ABC123 (컨텍스트 유지됨)
```

**5. 도구 호출 테스트**

```bash
# 파일 읽기 (readToolCall)
echo "Read package.json and tell me the version" | \
  cursor-agent --print --output-format stream-json --force --approve-mcps
# tool_call 메시지에서 readToolCall 확인

# 명령 실행 (shellToolCall)
echo "Run 'git status'" | \
  cursor-agent --print --output-format stream-json --force --approve-mcps
# tool_call 메시지에서 shellToolCall 확인

# 파일 쓰기 (editToolCall)
echo "Create a file test.txt with content 'hello'" | \
  cursor-agent --print --output-format stream-json --force --approve-mcps
# tool_call 메시지에서 editToolCall 확인
```

### 자동화 테스트 권장 패턴

```bash
# 안전한 자동화 플래그 조합
cursor-agent --print \
  --output-format stream-json \
  --force \
  --approve-mcps \
  --resume "$CHAT_ID" \
  --workspace "/path/to/project"

# 타임아웃 포함 (권장)
timeout 120 cursor-agent --print \
  --output-format stream-json \
  --force \
  --approve-mcps \
  --resume "$CHAT_ID"

# 브라우저 테스트 시
cursor-agent --print \
  --browser \
  --force \
  --approve-mcps \
  "웹페이지 테스트해줘"
```

### 실제 검증 결과

다음은 실제 cursor-agent 테스트에서 검증된 결과입니다:

**테스트 1: 세션 컨텍스트 유지**
```bash
# 실행
$ CHAT_ID=$(cursor-agent create-chat --workspace ".")
$ echo "Say only: PONG" | timeout 20 cursor-agent --print --output-format text --resume "$CHAT_ID" --force --approve-mcps
PONG

$ echo "What did you just say? Say it again." | cursor-agent --print --output-format text --resume "$CHAT_ID" --force --approve-mcps
PONG

# 결과: ✅ 세션 컨텍스트 유지됨 - 이전 응답을 기억
```

**테스트 2: timeout 종료 및 Resume**
```bash
# timeout 3초로 중단
$ echo "Count to 50" | timeout 3 cursor-agent --print --resume "$CHAT_ID" --force --approve-mcps
# Exit code: 124

# Resume 후 확인
$ echo "What was the first word I asked you to say?" | cursor-agent --print --output-format text --resume "$CHAT_ID" --force --approve-mcps
# 결과: ✅ 이전 컨텍스트(PONG) 기억함
```

**테스트 3: SIGTERM 종료**
```bash
$ NEW_CHAT=$(cursor-agent create-chat)
$ echo "Remember: MY_SECRET=DELTA456. Say OK." | cursor-agent --print --output-format text --resume "$NEW_CHAT" --force --approve-mcps
OK.

$ (echo "List files" | cursor-agent --print --resume "$NEW_CHAT" --force --approve-mcps &
   AGENT_PID=$!; sleep 4; kill -15 $AGENT_PID)
# Exit code: 143

# 결과: ✅ SIGTERM으로 graceful termination 가능
```

**테스트 4: 빠른 중단 시 컨텍스트 손실**
```bash
$ CHAT_ID=$(cursor-agent create-chat)
$ (echo "Remember X=999" | cursor-agent --print --resume "$CHAT_ID" --force --approve-mcps &
   PID=$!; sleep 1; kill -15 $PID)  # 1초 후 즉시 중단
# Exit code: 143

$ echo "What was X?" | cursor-agent --print --output-format text --resume "$CHAT_ID" --force --approve-mcps
I don't have any record of you telling me about X...

# 결과: ⚠️ 너무 빠른 중단 시 메시지가 저장되지 않을 수 있음
```

### Exit Code 해석

| Exit Code | 의미 | 대응 |
|-----------|------|------|
| 0 | 성공 | 정상 완료 |
| 1 | 일반 오류 | 로그 확인, 재시도 |
| 124 | timeout 초과 | 타임아웃 값 증가 또는 작업 분할 |
| 130 | SIGINT (Ctrl+C) | 사용자 취소 |
| 137 | SIGKILL | 강제 종료됨 (OOM 등) |
| 143 | SIGTERM | 정상적인 종료 요청 |

### 오류 복구 전략

```typescript
// TypeScript에서 Exit Code 기반 복구
const exitCode = await runCursorAgent(chatId, prompt);

switch (exitCode) {
  case 0:
    // 성공
    break;
  case 143: // SIGTERM
  case 137: // SIGKILL
  case 124: // timeout
    // 프로세스가 중단됨 - resume으로 복구 가능
    await resumeWithIntervention(chatId, recoveryPrompt);
    break;
  case 1:
    // 일반 오류 - 재시도 또는 실패 처리
    break;
  default:
    // 알 수 없는 오류
    break;
}
```

---

## 관련 문서

- [MODULE_GUIDE.md](./MODULE_GUIDE.md) - 모듈 구조 및 아키텍처
- [TEST_ARCHITECTURE.md](./TEST_ARCHITECTURE.md) - 테스트 아키텍처
- [HOOKS_GUIDE.md](./HOOKS_GUIDE.md) - Hook 시스템 사용법

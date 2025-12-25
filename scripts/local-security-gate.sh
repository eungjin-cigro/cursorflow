#!/bin/bash

# 로컬 보안 게이트 (Local Security Gate)
# 커밋 또는 푸시 전에 보안 취약점을 미리 검사합니다.

set -e

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🔍 Starting Local Security Gate...${NC}"

# 1. 의존성 취약점 검사 (pnpm or npm audit)
echo -e "\n${BLUE}[1/4] Checking dependencies...${NC}"
if [ -f "pnpm-lock.yaml" ]; then
    echo -e "${BLUE}Using pnpm audit...${NC}"
    if pnpm audit --audit-level=high; then
        echo -e "${GREEN}✅ No high-severity dependency issues found.${NC}"
    else
        echo -e "${RED}❌ High-severity dependency issues found!${NC}"
        echo -e "${YELLOW}Please run 'pnpm audit' to resolve them.${NC}"
        exit 1
    fi
elif [ -f "yarn.lock" ]; then
    echo -e "${BLUE}Using yarn audit...${NC}"
    if yarn audit --level high; then
        echo -e "${GREEN}✅ No high-severity dependency issues found.${NC}"
    else
        echo -e "${RED}❌ High-severity dependency issues found!${NC}"
        exit 1
    fi
else
    echo -e "${BLUE}Using npm audit...${NC}"
    if npm audit --audit-level=high; then
        echo -e "${GREEN}✅ No high-severity dependency issues found.${NC}"
    else
        echo -e "${RED}❌ High-severity dependency issues found!${NC}"
        echo -e "${YELLOW}Please run 'npm audit fix' to resolve them.${NC}"
        exit 1
    fi
fi

# 2. 정적 코드 분석 (Semgrep - CodeQL 대안)
echo -e "\n${BLUE}[2/4] Running static analysis (Semgrep)...${NC}"
if command -v semgrep &> /dev/null; then
    if semgrep --config=auto --error .; then
        echo -e "${GREEN}✅ Semgrep analysis passed.${NC}"
    else
        echo -e "${RED}❌ Semgrep found potential security issues!${NC}"
        echo -e "${YELLOW}CodeQL과 유사한 보안 이슈들입니다. 위 리포트를 확인하고 수정하세요.${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}⚠️  Semgrep not installed. Skipping static analysis.${NC}"
    echo -e "Install it to catch CodeQL-like issues: pip install semgrep"
fi

# 3. 민감 정보 노출 검사 (Simple Secret Scan)
echo -e "\n${BLUE}[3/4] Checking for hardcoded secrets...${NC}"
# git에 추적되는 파일들 중 API 키나 비밀번호 패턴 검색
# .cursorignore나 .gitignore에 있는 파일은 제외
# .github, *.md, scripts/setup-security.sh 등은 제외
# 변수 선언이나 에러 메시지에 포함된 키워드는 제외하도록 필터 강화
RAW_SECRETS=$(git grep -Ei "api[_-]?key|secret|password|token|bearer|private[_-]?key" -- ":!package-lock.json" ":!*.md" ":!scripts/setup-security.sh" ":!scripts/ai-security-check.js" ":!.github/*" ":!scripts/local-security-gate.sh" | grep -v "process.env" | grep -v "example" | grep -v "\${{" | grep -vE "stderr\.includes|checkCursorApiKey|CURSOR_API_KEY|api key|API_KEY" || true)

# .secretsignore 파일이 있으면 해당 패턴을 제외
if [ -f .secretsignore ] && [ -n "$RAW_SECRETS" ]; then
    # grep -v -f를 사용하여 .secretsignore에 있는 패턴이 포함된 줄을 제외
    SECRETS_FOUND=$(echo "$RAW_SECRETS" | grep -v -f .secretsignore || true)
else
    SECRETS_FOUND="$RAW_SECRETS"
fi

if [ -z "$SECRETS_FOUND" ]; then
    echo -e "${GREEN}✅ No obvious secrets found in tracked files.${NC}"
else
    echo -e "${YELLOW}⚠️  Possible secrets found:${NC}"
    echo "$SECRETS_FOUND"
    echo -e "\n${RED}❌ Please remove secrets or move them to .env file before pushing!${NC}"
    exit 1
fi

# 4. AI 기반 코드 보안 분석 (선택적)
echo -e "\n${BLUE}[4/4] AI-based security analysis...${NC}"
if [ -z "$OPENAI_API_KEY" ]; then
    echo -e "${YELLOW}⚠️  OPENAI_API_KEY not set. Skipping AI security check.${NC}"
    echo -e "Set the environment variable to enable this step: export OPENAI_API_KEY=your-key"
else
    if node scripts/ai-security-check.js; then
        echo -e "${GREEN}✅ AI security check passed.${NC}"
    else
        echo -e "${RED}❌ AI security check failed!${NC}"
        exit 1
    fi
fi

echo -e "\n${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ All local security checks passed!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"


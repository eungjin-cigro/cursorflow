#!/bin/bash

# 보안 검사 설정 스크립트
# GitHub Secrets 설정을 위한 가이드

set -e

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   🔒 Security Scan Setup Guide       ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}\n"

# GitHub CLI 확인
if ! command -v gh &> /dev/null; then
    echo -e "${YELLOW}⚠️  GitHub CLI (gh) is not installed.${NC}"
    echo -e "Install it from: https://cli.github.com/\n"
    USE_GH_CLI=false
else
    echo -e "${GREEN}✓ GitHub CLI detected${NC}\n"
    USE_GH_CLI=true
fi

echo -e "${BLUE}Required GitHub Secrets:${NC}\n"

echo "1. NPM_TOKEN (필수 - npm 배포용)"
echo "   - Visit: https://www.npmjs.com"
echo "   - Profile → Access Tokens → Generate New Token"
echo "   - Type: Automation"
echo ""

echo "2. SNYK_TOKEN (권장 - 강화된 의존성 스캔)"
echo "   - Visit: https://snyk.io"
echo "   - Settings → General → Auth Token"
echo ""

echo "3. OPENAI_API_KEY (선택 - AI 보안 검사)"
echo "   - Visit: https://platform.openai.com/api-keys"
echo "   - Create new secret key"
echo "   - Cost: ~$0.01-0.10 per PR"
echo ""

if [ "$USE_GH_CLI" = true ]; then
    echo -e "\n${BLUE}Would you like to set up secrets now using GitHub CLI?${NC}"
    read -p "Continue? (y/N): " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        # NPM_TOKEN
        echo -e "\n${YELLOW}Setting up NPM_TOKEN...${NC}"
        read -p "Enter your NPM token (or press Enter to skip): " NPM_TOKEN
        if [ -n "$NPM_TOKEN" ]; then
            gh secret set NPM_TOKEN -b "$NPM_TOKEN"
            echo -e "${GREEN}✓ NPM_TOKEN set${NC}"
        fi
        
        # SNYK_TOKEN
        echo -e "\n${YELLOW}Setting up SNYK_TOKEN (optional)...${NC}"
        read -p "Enter your Snyk token (or press Enter to skip): " SNYK_TOKEN
        if [ -n "$SNYK_TOKEN" ]; then
            gh secret set SNYK_TOKEN -b "$SNYK_TOKEN"
            echo -e "${GREEN}✓ SNYK_TOKEN set${NC}"
        fi
        
        # OPENAI_API_KEY
        echo -e "\n${YELLOW}Setting up OPENAI_API_KEY (optional)...${NC}"
        read -p "Enter your OpenAI API key (or press Enter to skip): " OPENAI_KEY
        if [ -n "$OPENAI_KEY" ]; then
            gh secret set OPENAI_API_KEY -b "$OPENAI_KEY"
            echo -e "${GREEN}✓ OPENAI_API_KEY set${NC}"
        fi
        
        echo -e "\n${GREEN}✅ Secrets configuration complete!${NC}"
    fi
else
    echo -e "${YELLOW}Manual setup required:${NC}"
    echo "1. Go to: https://github.com/$(git remote get-url origin | sed 's/.*github.com[:/]\(.*\)\.git/\1/')/settings/secrets/actions"
    echo "2. Click 'New repository secret'"
    echo "3. Add the secrets listed above"
fi

echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Security Checks Enabled:${NC}\n"
echo "✅ NPM Audit (automatic)"
echo "✅ TruffleHog Secret Scanning (automatic)"
echo "✅ Semgrep Static Analysis (automatic)"
echo "✅ Trivy Filesystem Scan (automatic)"
echo "✅ CodeQL Analysis (automatic)"
echo "⚙️  Snyk Scan (requires SNYK_TOKEN)"

echo -e "\n${BLUE}Test security scan locally:${NC}"
echo -e "${GREEN}npm audit${NC}"
echo -e "${GREEN}npm audit --audit-level=high${NC}"

echo -e "\n${BLUE}For more information:${NC}"
echo "📖 docs/SECURITY_CHECKS.md"

echo -e "\n${GREEN}Setup complete! 🎉${NC}\n"


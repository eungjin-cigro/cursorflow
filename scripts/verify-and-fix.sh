#!/bin/bash

# 작업 후 품질 검증 및 자동 수정 스크립트
# Husky pre-push 훅과 유사하지만, 자동 수정(fix)을 시도합니다.

set -e

echo "🛠️  Starting Post-Work Verification & Fix..."

# 1. 의존성 취약점 확인 및 수정
echo -e "\n📦 Checking dependencies (npm audit)..."
if ! npm audit --audit-level=high; then
    echo "⚠️  High severity issues found. Attempting 'npm audit fix'..."
    npm audit fix
    # 다시 확인
    if ! npm audit --audit-level=high; then
         echo "❌ Vulnerabilities still exist after fix. Please check manually."
         exit 1
    fi
else
    echo "✅ Dependencies are clean."
fi

# 2. 테스트 실행
echo -e "\n🧪 Running tests..."
npm test

# 3. 보안 게이트 실행 (새로 추가한 .secretsignore 적용됨)
echo -e "\n🔒 Running Local Security Gate..."
./scripts/local-security-gate.sh

# 4. 패키지 유효성 검사
echo -e "\n📦 Validating package..."
npm run validate

echo -e "\n✅ All checks passed! Ready to push."


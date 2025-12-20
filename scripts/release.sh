#!/bin/bash

# NPM 배포 스크립트
# 사용법: ./scripts/release.sh [patch|minor|major]

set -e

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 버전 타입 확인
VERSION_TYPE=${1:-patch}

if [[ ! "$VERSION_TYPE" =~ ^(patch|minor|major|prerelease)$ ]]; then
    echo -e "${RED}Error: Invalid version type. Use: patch, minor, major, or prerelease${NC}"
    exit 1
fi

echo -e "${BLUE}=== CursorFlow Release Script ===${NC}\n"

# Git 상태 확인
echo -e "${YELLOW}Checking git status...${NC}"
if [[ -n $(git status -s) ]]; then
    echo -e "${RED}Error: Working directory is not clean. Commit or stash your changes first.${NC}"
    git status -s
    exit 1
fi
echo -e "${GREEN}✓ Working directory is clean${NC}\n"

# 현재 브랜치 확인
CURRENT_BRANCH=$(git branch --show-current)
echo -e "${YELLOW}Current branch: ${CURRENT_BRANCH}${NC}"
if [[ "$CURRENT_BRANCH" != "main" ]] && [[ "$CURRENT_BRANCH" != "master" ]]; then
    echo -e "${YELLOW}Warning: You are not on main/master branch${NC}"
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# 최신 코드 받기
echo -e "\n${YELLOW}Pulling latest changes...${NC}"
git pull origin "$CURRENT_BRANCH"
echo -e "${GREEN}✓ Up to date${NC}\n"

# 현재 버전 확인
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo -e "${BLUE}Current version: ${CURRENT_VERSION}${NC}"

# 버전 업데이트
echo -e "\n${YELLOW}Updating version ($VERSION_TYPE)...${NC}"
NEW_VERSION=$(npm version $VERSION_TYPE --no-git-tag-version)
echo -e "${GREEN}✓ New version: ${NEW_VERSION}${NC}\n"

# CHANGELOG 업데이트 확인
echo -e "${YELLOW}Have you updated CHANGELOG.md for this release?${NC}"
read -p "Press Enter to edit CHANGELOG.md, or 's' to skip: " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Ss]$ ]]; then
    ${EDITOR:-nano} CHANGELOG.md
fi

# 변경사항 커밋
echo -e "\n${YELLOW}Committing version bump...${NC}"
git add package.json CHANGELOG.md
git commit -m "chore: bump version to ${NEW_VERSION}"
echo -e "${GREEN}✓ Version bump committed${NC}\n"

# 태그 생성
TAG_NAME="v${NEW_VERSION#v}"
echo -e "${YELLOW}Creating tag: ${TAG_NAME}${NC}"
git tag -a "$TAG_NAME" -m "Release ${TAG_NAME}"
echo -e "${GREEN}✓ Tag created${NC}\n"

# 푸시 전 확인
echo -e "${BLUE}Ready to push:${NC}"
echo -e "  - Commit: chore: bump version to ${NEW_VERSION}"
echo -e "  - Tag: ${TAG_NAME}"
echo -e "  - Branch: ${CURRENT_BRANCH}"
echo

read -p "Push to GitHub and trigger deployment? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Aborted. To push manually later:${NC}"
    echo -e "  git push origin ${CURRENT_BRANCH}"
    echo -e "  git push origin ${TAG_NAME}"
    exit 0
fi

# 푸시
echo -e "\n${YELLOW}Pushing to GitHub...${NC}"
git push origin "$CURRENT_BRANCH"
git push origin "$TAG_NAME"
echo -e "${GREEN}✓ Pushed successfully${NC}\n"

# 완료 메시지
echo -e "${GREEN}=== Release Process Complete! ===${NC}\n"
echo -e "${BLUE}Next steps:${NC}"
echo -e "  1. Monitor GitHub Actions: https://github.com/eungjin-cigro/cursorflow/actions"
echo -e "  2. Check npm package: https://www.npmjs.com/package/@litmers/cursorflow-orchestrator"
echo -e "  3. Verify GitHub Release: https://github.com/eungjin-cigro/cursorflow/releases/tag/${TAG_NAME}"
echo -e "\n${GREEN}Release ${NEW_VERSION} is being deployed! 🚀${NC}"


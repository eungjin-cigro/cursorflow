# CursorFlow Review

## Overview
코드 리뷰 기능을 설정하고 리뷰 결과를 확인합니다. AI 기반 자동 리뷰로 코드 품질을 향상시킵니다.

## Steps

1. **리뷰 활성화**
   
   `cursorflow.config.js` 파일에서 설정:
   ```javascript
   module.exports = {
     enableReview: true,
     reviewModel: 'sonnet-4.5-thinking',
     maxReviewIterations: 3,
     // ...
   };
   ```

2. **Acceptance Criteria 정의**
   
   태스크 JSON 파일에 검증 기준 추가:
   ```json
   {
     "tasks": [
       {
         "name": "implement",
         "model": "sonnet-4.5",
         "acceptanceCriteria": [
           "빌드 에러 없음",
           "TypeScript 타입 에러 없음",
           "주요 기능 구현됨",
           "테스트 통과"
         ],
         "prompt": "..."
       }
     ]
   }
   ```

3. **리뷰 실행**
   
   리뷰는 태스크 완료 후 자동으로 실행됩니다.

4. **리뷰 결과 확인**
   ```bash
   # 리뷰 결과 파일 확인
   cat _cursorflow/logs/runs/<lane>/review-results.json
   ```

## 리뷰 모델

| 모델 | 특징 | 권장 용도 |
|------|------|-----------|
| `sonnet-4.5-thinking` | 추론 강화, 정확한 분석 | 일반 코드 리뷰 (권장) |
| `opus-4.5-thinking` | 최고 품질, 상세 리뷰 | 중요한 코드, 아키텍처 리뷰 |
| `sonnet-4.5` | 빠른 리뷰 | 간단한 변경사항 |

## 리뷰 프로세스

1. **태스크 완료**
   - 코드 구현 완료
   - 커밋 생성

2. **자동 리뷰 시작**
   - 리뷰 모델로 에이전트 실행
   - Acceptance Criteria 확인
   - 빌드 및 타입 검증

3. **리뷰 결과**
   - `approved`: 다음 태스크로 진행
   - `needs_changes`: 피드백 전달 → 재작업

4. **피드백 루프**
   - 수정 사항 구현
   - 재리뷰
   - 최대 반복 횟수까지 반복

## 리뷰 결과 형식

```json
{
  "status": "approved",
  "buildSuccess": true,
  "typeCheckSuccess": true,
  "issues": [
    {
      "severity": "warning",
      "description": "Consider adding error handling",
      "file": "src/utils/api.js",
      "line": 42,
      "suggestion": "Add try-catch block"
    }
  ],
  "suggestions": [
    "Add unit tests for edge cases",
    "Improve error messages"
  ],
  "summary": "Code quality is good, minor improvements suggested",
  "reviewedBy": "sonnet-4.5-thinking",
  "reviewedAt": "2025-12-19T18:30:00Z"
}
```

## 예제

### 기본 리뷰 설정
```javascript
// cursorflow.config.js
{
  enableReview: true,
  reviewModel: 'sonnet-4.5-thinking',
  maxReviewIterations: 3
}
```

### 엄격한 리뷰
```javascript
{
  enableReview: true,
  reviewModel: 'opus-4.5-thinking',
  maxReviewIterations: 5
}
```

### 빠른 리뷰
```javascript
{
  enableReview: true,
  reviewModel: 'sonnet-4.5',
  maxReviewIterations: 1
}
```

## Acceptance Criteria 작성 가이드

### 좋은 예시
```json
{
  "acceptanceCriteria": [
    "빌드 에러 없음 (pnpm build 성공)",
    "TypeScript 타입 에러 없음 (pnpm type-check)",
    "모든 기존 테스트 통과",
    "새 API 엔드포인트 3개 구현됨",
    "에러 처리 로직 포함됨",
    "로그 추가됨"
  ]
}
```

### 나쁜 예시
```json
{
  "acceptanceCriteria": [
    "잘 작동함",
    "코드가 좋음"
  ]
}
```

## 리뷰 결과 분석

### 승인된 경우
```bash
# 다음 태스크 자동 진행
# 로그에서 확인
cursorflow monitor
```

### 수정 필요 시
```bash
# 피드백이 자동으로 에이전트에 전달됨
# 재작업 후 자동 재리뷰
# 로그에서 피드백 확인
cat _cursorflow/logs/runs/<lane>/conversation.jsonl | \
  jq 'select(.role=="reviewer")'
```

### 최대 반복 도달 시
```bash
# 경고 메시지와 함께 진행
# 수동 리뷰 필요
```

## Checklist
- [ ] 리뷰가 활성화되었는가?
- [ ] 리뷰 모델이 적절한가?
- [ ] Acceptance Criteria가 명확한가?
- [ ] 최대 반복 횟수가 적절한가?
- [ ] 리뷰 결과를 확인했는가?

## 트러블슈팅

### 리뷰가 실행되지 않음
1. `enableReview: true` 확인
2. 리뷰 모델이 유효한지 확인
3. 로그에서 에러 확인

### 무한 리뷰 루프
1. `maxReviewIterations` 설정 확인
2. Acceptance Criteria가 달성 가능한지 검토
3. 태스크 프롬프트 개선

### 리뷰가 너무 엄격함
1. 리뷰 모델을 더 관대한 것으로 변경
2. Acceptance Criteria 조정
3. `maxReviewIterations` 증가

## 모범 사례

1. **명확한 기준**: Acceptance Criteria를 구체적으로 작성
2. **적절한 모델**: 작업 복잡도에 맞는 리뷰 모델 선택
3. **점진적 개선**: 첫 반복에서 모든 것을 완벽하게 하려 하지 말기
4. **피드백 활용**: 리뷰 피드백을 다음 태스크 개선에 활용

## Next Steps
1. 리뷰 결과 분석
2. 반복되는 이슈 패턴 파악
3. 태스크 프롬프트 및 Criteria 개선
4. 리뷰 모델 조정

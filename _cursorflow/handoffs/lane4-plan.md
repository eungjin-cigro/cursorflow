# Lane 4 구현 계획: UI Components

## 구현할 파일
src/ui/components.ts

## 컴포넌트
1. StatusIcons - 상태 아이콘
2. SelectableList<T> - 키보드 선택 리스트
3. CheckboxList<T> - 체크박스 리스트
4. ScrollableBuffer<T> - 스크롤 가능 버퍼
5. ProgressBar - 진행률 표시

## 다른 레인에서 사용
- Lane 7 (Log Viewer): ScrollableBuffer
- Lane 8 (Task Browser, Run Selector): SelectableList, CheckboxList

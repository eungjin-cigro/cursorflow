# Lane 4 완료: UI Components

## 구현된 파일
`src/ui/components.ts`

## 컴포넌트 사용법

### SelectableList (Lane 8)
```typescript
import { SelectableList } from '../ui/components';

const list = new SelectableList(
  items,
  (item, selected) => `${selected ? '▶' : ' '} ${item.name}`,
  15  // maxVisible
);

// 키 처리
if (key.name === 'up') list.moveUp();
if (key.name === 'down') list.moveDown();
if (key.name === 'return') {
  const selected = list.getSelected();
}

// 렌더링
const lines = list.render();
```

### CheckboxList (Lane 8 - Clean Manager)
```typescript
import { CheckboxList } from '../ui/components';

const checkList = new CheckboxList(
  items,
  (item, checked, selected) => `${selected ? '▶' : ' '} [${checked ? 'x' : ' '}] ${item.name}`
);

// 키 처리
if (key.name === 'space') checkList.toggle();
if (str === 'a') checkList.selectAll();

// 선택된 항목
const checked = checkList.getChecked();
```

### ScrollableBuffer (Lane 7 - Log Viewer)
```typescript
import { ScrollableBuffer } from '../ui/components';

const buffer = new ScrollableBuffer<LogEntry>(pageSize);
buffer.setItems(allLogEntries);

// 스크롤
buffer.scrollUp();
buffer.scrollDown();
buffer.scrollToBottom();

// 화면에 표시할 항목
const visible = buffer.getVisibleItems();
```

### 유틸리티
```typescript
import { getStatusIcon, renderProgressBar, pad, stripAnsi } from '../ui/components';

const icon = getStatusIcon('running');  // '🔄'
const progress = renderProgressBar(5, 10, 20);  // '██████████░░░░░░░░░░'
```

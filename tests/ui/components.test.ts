import { 
  SelectableList, 
  CheckboxList, 
  ScrollableBuffer, 
  renderProgressBar,
  stripAnsi,
  pad
} from '../../src/ui/components';

describe('UI Components', () => {
  describe('SelectableList', () => {
    const items = ['Item 1', 'Item 2', 'Item 3'];
    const formatter = (item: string, selected: boolean) => selected ? `> ${item}` : `  ${item}`;

    it('should initialize with first item selected', () => {
      const list = new SelectableList(items, formatter);
      expect(list.getSelectedIndex()).toBe(0);
      expect(list.getSelected()).toBe('Item 1');
    });

    it('should move selection down', () => {
      const list = new SelectableList(items, formatter);
      list.moveDown();
      expect(list.getSelectedIndex()).toBe(1);
      expect(list.getSelected()).toBe('Item 2');
    });

    it('should move selection up', () => {
      const list = new SelectableList(items, formatter);
      list.moveDown();
      list.moveUp();
      expect(list.getSelectedIndex()).toBe(0);
      expect(list.getSelected()).toBe('Item 1');
    });

    it('should not move above 0', () => {
      const list = new SelectableList(items, formatter);
      list.moveUp();
      expect(list.getSelectedIndex()).toBe(0);
    });

    it('should not move below last item', () => {
      const list = new SelectableList(items, formatter);
      list.moveDown();
      list.moveDown();
      list.moveDown();
      expect(list.getSelectedIndex()).toBe(2);
    });

    it('should render items correctly', () => {
      const list = new SelectableList(items, formatter);
      const output = list.render();
      expect(output[0]).toBe('> Item 1');
      expect(output[1]).toBe('  Item 2');
    });
  });

  describe('CheckboxList', () => {
    const items = ['Task 1', 'Task 2', 'Task 3'];
    const formatter = (item: string, selected: boolean, checked: boolean) => 
      `${selected ? '>' : ' '} [${checked ? 'x' : ' '}] ${item}`;

    it('should toggle items', () => {
      const list = new CheckboxList(items, formatter);
      list.toggle(); // Toggle Task 1
      expect(list.getChecked()).toEqual(['Task 1']);
      list.toggle(); // Toggle Task 1 again
      expect(list.getChecked()).toEqual([]);
    });

    it('should select all and deselect all', () => {
      const list = new CheckboxList(items, formatter);
      list.selectAll();
      expect(list.getChecked()).toEqual(items);
      list.deselectAll();
      expect(list.getChecked()).toEqual([]);
    });

    it('should maintain selection across moves', () => {
      const list = new CheckboxList(items, formatter);
      list.toggle(); // Check Task 1
      list.moveDown();
      list.toggle(); // Check Task 2
      expect(list.getChecked()).toEqual(['Task 1', 'Task 2']);
    });
  });

  describe('ScrollableBuffer', () => {
    it('should scroll down and up', () => {
      const buffer = new ScrollableBuffer<string>(2); // 2 lines visible
      buffer.setItems(['L1', 'L2', 'L3', 'L4', 'L5']);
      
      expect(buffer.getVisibleItems()).toEqual(['L1', 'L2']);
      
      buffer.scrollDown(1);
      expect(buffer.getVisibleItems()).toEqual(['L2', 'L3']);
      
      buffer.scrollUp(1);
      expect(buffer.getVisibleItems()).toEqual(['L1', 'L2']);
    });

    it('should scroll to top and bottom', () => {
      const buffer = new ScrollableBuffer<string>(2);
      buffer.setItems(['L1', 'L2', 'L3', 'L4', 'L5']);
      
      buffer.scrollToBottom();
      expect(buffer.getVisibleItems()).toEqual(['L4', 'L5']);
      
      buffer.scrollToTop();
      expect(buffer.getVisibleItems()).toEqual(['L1', 'L2']);
    });

    it('should provide scroll info', () => {
      const buffer = new ScrollableBuffer<string>(2);
      buffer.setItems(['L1', 'L2', 'L3', 'L4', 'L5']);
      buffer.scrollDown(1);
      
      expect(buffer.getScrollInfo()).toEqual({
        offset: 1,
        total: 5,
        pageSize: 2
      });
    });
  });

  describe('ProgressBar', () => {
    it('should render correctly at 50%', () => {
      const bar = renderProgressBar(5, 10, 10);
      expect(stripAnsi(bar)).toBe('[█████░░░░░]  50%');
    });

    it('should render correctly at 100%', () => {
      const bar = renderProgressBar(10, 10, 10);
      expect(stripAnsi(bar)).toBe('[██████████] 100%');
    });

    it('should handle zero total', () => {
      const bar = renderProgressBar(0, 0, 10);
      expect(stripAnsi(bar)).toBe('[░░░░░░░░░░]   0%');
    });

    it('should handle current exceeding total', () => {
      const bar = renderProgressBar(12, 10, 10);
      expect(stripAnsi(bar)).toBe('[██████████] 120%');
    });
  });

  describe('Utilities', () => {
    it('should strip ANSI codes', () => {
      expect(stripAnsi('\x1b[31mRed\x1b[0m')).toBe('Red');
    });

    it('should pad strings correctly', () => {
      expect(pad('Test', 10)).toBe('Test      ');
      expect(pad('Test', 10, 'right')).toBe('      Test');
      expect(pad('Test', 10, 'center')).toBe('   Test   ');
    });
  });
});

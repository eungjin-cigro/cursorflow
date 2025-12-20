import * as fs from 'fs';
import * as path from 'path';
import { listLaneFiles } from '../../src/core/orchestrator';

describe('Orchestrator Core', () => {
  const testTasksDir = path.join(__dirname, 'test-tasks');

  beforeAll(() => {
    if (!fs.existsSync(testTasksDir)) {
      fs.mkdirSync(testTasksDir, { recursive: true });
    }
    fs.writeFileSync(path.join(testTasksDir, 'lane1.json'), '{}');
    fs.writeFileSync(path.join(testTasksDir, 'lane2.json'), '{}');
    fs.writeFileSync(path.join(testTasksDir, 'not-a-lane.txt'), 'hello');
  });

  afterAll(() => {
    fs.rmSync(testTasksDir, { recursive: true, force: true });
  });

  test('listLaneFiles should only return .json files', () => {
    const lanes = listLaneFiles(testTasksDir);
    expect(lanes).toHaveLength(2);
    expect(lanes.map(l => l.name)).toContain('lane1');
    expect(lanes.map(l => l.name)).toContain('lane2');
    expect(lanes[0]?.path).toBe(path.join(testTasksDir, 'lane1.json'));
  });

  test('listLaneFiles should return empty array for non-existent dir', () => {
    const lanes = listLaneFiles(path.join(testTasksDir, 'non-existent'));
    expect(lanes).toEqual([]);
  });
});


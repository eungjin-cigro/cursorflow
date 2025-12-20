import * as fs from 'fs';
import * as path from 'path';
import { findProjectRoot, loadConfig, validateConfig } from '../../src/utils/config';

describe('Config Utilities', () => {
  const mockProjectRoot = path.join(__dirname, 'mock-project');

  beforeAll(() => {
    if (!fs.existsSync(mockProjectRoot)) {
      fs.mkdirSync(mockProjectRoot, { recursive: true });
    }
    fs.writeFileSync(
      path.join(mockProjectRoot, 'package.json'),
      JSON.stringify({ name: 'mock-project' })
    );
  });

  afterAll(() => {
    fs.rmSync(mockProjectRoot, { recursive: true, force: true });
  });

  test('findProjectRoot should find root from subdirectories', () => {
    const subDir = path.join(mockProjectRoot, 'src', 'utils');
    fs.mkdirSync(subDir, { recursive: true });
    
    const root = findProjectRoot(subDir);
    expect(root).toBe(mockProjectRoot);
  });

  test('loadConfig should return default config if no config file exists', () => {
    const config = loadConfig(mockProjectRoot);
    expect(config.tasksDir).toBe('_cursorflow/tasks');
    expect(config.projectRoot).toBe(mockProjectRoot);
  });

  test('validateConfig should validate correct config', () => {
    const config = loadConfig(mockProjectRoot);
    expect(validateConfig(config)).toBe(true);
  });

  test('validateConfig should throw for invalid executor', () => {
    const config = loadConfig(mockProjectRoot);
    (config as any).executor = 'invalid-executor';
    expect(() => validateConfig(config)).toThrow('executor must be "cursor-agent" or "cloud"');
  });
});


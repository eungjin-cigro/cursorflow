
import * as fs from 'fs';
import * as path from 'path';
import { createMockGitRepo, MockGitRepo } from '../helpers/mock-git-repo';
import { finalizeFlow } from '../../src/core/orchestrator';
import { safeJoin } from '../../src/utils/path';

describe('Flow Completion Integration', () => {
  let mockRepo: MockGitRepo;
  let repoRoot: string;
  let tasksDir: string;
  let runRoot: string;

  beforeEach(async () => {
    mockRepo = await createMockGitRepo({
      initialFiles: {
        'README.md': '# Test Flow\n',
        '.gitignore': 'cursorflow/\n'
      }
    });
    repoRoot = mockRepo.repoDir;
    
    // Setup Flow structure
    tasksDir = path.join(repoRoot, 'flows/01_test-flow');
    fs.mkdirSync(tasksDir, { recursive: true });
    
    fs.writeFileSync(path.join(tasksDir, 'flow.meta.json'), JSON.stringify({
      name: 'test-flow',
      baseBranch: 'main',
      status: 'running',
      lanes: ['lane-a', 'lane-b']
    }));

    runRoot = path.join(repoRoot, 'cursorflow/runs/run-123');
    fs.mkdirSync(runRoot, { recursive: true });
  });

  afterEach(async () => {
    await mockRepo.cleanup();
  });

  test('should integrate multiple lanes successfully', async () => {
    const { execSync } = require('child_process');

    // 1. Setup lane-a
    const laneADir = path.join(runRoot, 'lanes/lane-a');
    fs.mkdirSync(laneADir, { recursive: true });
    const branchA = 'pipeline/test-flow/lane-a';
    
    execSync(`git checkout -b ${branchA}`, { cwd: repoRoot });
    fs.writeFileSync(path.join(repoRoot, 'file-a.txt'), 'content a');
    execSync('git add file-a.txt && git commit -m "feat: lane a change"', { cwd: repoRoot });
    execSync(`git push origin ${branchA}`, { cwd: repoRoot });
    
    fs.writeFileSync(path.join(laneADir, 'state.json'), JSON.stringify({
      pipelineBranch: branchA,
      status: 'completed'
    }));

    // 2. Setup lane-b
    execSync('git checkout main', { cwd: repoRoot });
    const branchB = 'pipeline/test-flow/lane-b';
    execSync(`git checkout -b ${branchB}`, { cwd: repoRoot });
    fs.writeFileSync(path.join(repoRoot, 'file-b.txt'), 'content b');
    execSync('git add file-b.txt && git commit -m "feat: lane b change"', { cwd: repoRoot });
    execSync(`git push origin ${branchB}`, { cwd: repoRoot });

    const laneBDir = path.join(runRoot, 'lanes/lane-b');
    fs.mkdirSync(laneBDir, { recursive: true });
    fs.writeFileSync(path.join(laneBDir, 'state.json'), JSON.stringify({
      pipelineBranch: branchB,
      status: 'completed'
    }));

    // 3. Go back to main
    execSync('git checkout main', { cwd: repoRoot });

    // 4. Run finalizeFlow
    await finalizeFlow({
      tasksDir,
      runId: 'run-123',
      runRoot,
      laneRunDirs: {
        'lane-a': laneADir,
        'lane-b': laneBDir
      },
      laneWorktreeDirs: {},
      pipelineBranch: 'pipeline/test-flow',
      repoRoot,
      noCleanup: false
    });

    // 5. Verify
    const targetBranch = 'feature/test-flow-integrated';
    const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoRoot, encoding: 'utf8' }).trim();
    expect(currentBranch).toBe(targetBranch);

    expect(fs.existsSync(path.join(repoRoot, 'file-a.txt'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'file-b.txt'))).toBe(true);
    
    // Verify flow.meta.json updated
    const meta = JSON.parse(fs.readFileSync(path.join(tasksDir, 'flow.meta.json'), 'utf8'));
    expect(meta.status).toBe('completed');
    expect(meta.integratedBranch).toBe(targetBranch);
    
    // Verify lane branches deleted (local)
    const branches = execSync('git branch --list', { cwd: repoRoot, encoding: 'utf8' });
    expect(branches).not.toContain(branchA);
    expect(branches).not.toContain(branchB);
  }, 30000);

  test('should fail when there is a merge conflict', async () => {
    const { execSync } = require('child_process');

    // 1. Setup lane-a modifying README.md
    const laneADir = path.join(runRoot, 'lanes/lane-a');
    fs.mkdirSync(laneADir, { recursive: true });
    const branchA = 'pipeline/test-flow/lane-a';
    
    execSync(`git checkout -b ${branchA}`, { cwd: repoRoot });
    fs.writeFileSync(path.join(repoRoot, 'README.md'), '# Test Flow\nModified by Lane A');
    execSync('git add README.md && git commit -m "feat: lane a conflict"', { cwd: repoRoot });
    execSync(`git push origin ${branchA}`, { cwd: repoRoot });
    
    fs.writeFileSync(path.join(laneADir, 'state.json'), JSON.stringify({
      pipelineBranch: branchA,
      status: 'completed'
    }));

    // 2. Setup lane-b modifying README.md same line
    execSync('git checkout main', { cwd: repoRoot });
    const branchB = 'pipeline/test-flow/lane-b';
    execSync(`git checkout -b ${branchB}`, { cwd: repoRoot });
    fs.writeFileSync(path.join(repoRoot, 'README.md'), '# Test Flow\nModified by Lane B');
    execSync('git add README.md && git commit -m "feat: lane b conflict"', { cwd: repoRoot });
    execSync(`git push origin ${branchB}`, { cwd: repoRoot });

    const laneBDir = path.join(runRoot, 'lanes/lane-b');
    fs.mkdirSync(laneBDir, { recursive: true });
    fs.writeFileSync(path.join(laneBDir, 'state.json'), JSON.stringify({
      pipelineBranch: branchB,
      status: 'completed'
    }));

    execSync('git checkout main', { cwd: repoRoot });

    // 3. Run finalizeFlow and expect error
    // We expect the first merge (lane-a) to succeed, and the second (lane-b) to conflict with lane-a's changes
    await expect(finalizeFlow({
      tasksDir,
      runId: 'run-123',
      runRoot,
      laneRunDirs: {
        'lane-a': laneADir,
        'lane-b': laneBDir
      },
      laneWorktreeDirs: {},
      pipelineBranch: 'pipeline/test-flow',
      repoRoot,
      noCleanup: false
    })).rejects.toThrow('Merge conflict during integration');

    // 4. Verify meta updated with error
    const meta = JSON.parse(fs.readFileSync(path.join(tasksDir, 'flow.meta.json'), 'utf8'));
    expect(meta.status).toBe('failed');
    expect(meta.error).toContain('Merge conflict');
  }, 30000);
});

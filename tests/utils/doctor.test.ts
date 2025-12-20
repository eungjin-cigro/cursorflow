import * as fs from 'fs';
import * as path from 'path';

import { runDoctor } from '../../src/utils/doctor';
import * as git from '../../src/utils/git';
import * as cursorAgent from '../../src/utils/cursor-agent';

jest.mock('../../src/utils/git');
jest.mock('../../src/utils/cursor-agent');

describe('Doctor Utilities', () => {
  const mockedRunGitResult = git.runGitResult as unknown as jest.Mock;
  const mockedCheckCursorAgentInstalled = cursorAgent.checkCursorAgentInstalled as unknown as jest.Mock;
  const mockedCheckCursorAuth = cursorAgent.checkCursorAuth as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCheckCursorAgentInstalled.mockReturnValue(true);
    mockedCheckCursorAuth.mockReturnValue({ authenticated: true, message: 'ok' });
  });

  test('runDoctor should report not a git repo', () => {
    mockedRunGitResult.mockImplementation((args: string[]) => {
      if (args.join(' ') === 'rev-parse --is-inside-work-tree') {
        return { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository', success: false };
      }
      return { exitCode: 0, stdout: '', stderr: '', success: true };
    });

    const report = runDoctor({ cwd: '/tmp/not-a-repo', includeCursorAgentChecks: false });

    expect(report.ok).toBe(false);
    expect(report.issues.map(i => i.id)).toContain('git.not_repo');
  });

  test('runDoctor should report missing origin remote', () => {
    mockedRunGitResult.mockImplementation((args: string[]) => {
      const cmd = args.join(' ');
      if (cmd === 'rev-parse --is-inside-work-tree') {
        return { exitCode: 0, stdout: 'true', stderr: '', success: true };
      }
      if (cmd === 'rev-parse --show-toplevel') {
        return { exitCode: 0, stdout: '/repo', stderr: '', success: true };
      }
      if (cmd === 'rev-parse --verify HEAD') {
        return { exitCode: 0, stdout: 'abc123', stderr: '', success: true };
      }
      if (cmd === 'remote get-url origin') {
        return { exitCode: 2, stdout: '', stderr: "error: No such remote 'origin'", success: false };
      }
      if (cmd === 'worktree list') {
        return { exitCode: 0, stdout: '/repo 123 [main]', stderr: '', success: true };
      }
      // Default: success
      return { exitCode: 0, stdout: '', stderr: '', success: true };
    });

    const report = runDoctor({ cwd: '/repo', includeCursorAgentChecks: false });

    expect(report.ok).toBe(false);
    expect(report.issues.map(i => i.id)).toContain('git.no_origin');
  });

  test('runDoctor should validate tasks dir existence and lane baseBranch', () => {
    const tmp = path.join(__dirname, 'tmp-doctor');
    const tasksDir = path.join(tmp, 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(
      path.join(tasksDir, 'lane1.json'),
      JSON.stringify({ baseBranch: 'develop', tasks: [] }),
      'utf8'
    );

    mockedRunGitResult.mockImplementation((args: string[]) => {
      const cmd = args.join(' ');
      if (cmd === 'rev-parse --is-inside-work-tree') {
        return { exitCode: 0, stdout: 'true', stderr: '', success: true };
      }
      if (cmd === 'rev-parse --show-toplevel') {
        return { exitCode: 0, stdout: '/repo', stderr: '', success: true };
      }
      if (cmd === 'rev-parse --verify HEAD') {
        return { exitCode: 0, stdout: 'abc123', stderr: '', success: true };
      }
      if (cmd === 'remote get-url origin') {
        return { exitCode: 0, stdout: 'https://example.com/repo.git', stderr: '', success: true };
      }
      if (cmd === 'worktree list') {
        return { exitCode: 0, stdout: '/repo 123 [main]', stderr: '', success: true };
      }
      if (cmd.startsWith('show-ref --verify refs/heads/develop')) {
        return { exitCode: 1, stdout: '', stderr: '', success: false };
      }
      if (cmd === 'rev-parse --verify develop') {
        return { exitCode: 1, stdout: '', stderr: 'fatal: Needed a single revision', success: false };
      }
      return { exitCode: 0, stdout: '', stderr: '', success: true };
    });

    const report = runDoctor({ cwd: '/repo', tasksDir, includeCursorAgentChecks: false });

    expect(report.ok).toBe(false);
    expect(report.issues.map(i => i.id)).toContain('git.missing_base_branch.develop');

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});



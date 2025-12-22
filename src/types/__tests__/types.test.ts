import * as Types from '../index';

describe('Types Module', () => {
  describe('Exports', () => {
    it('should export CursorFlowConfig type', () => {
      const config: Types.CursorFlowConfig = {} as any;
      expect(config).toBeDefined();
    });

    it('should export LogImportance enum', () => {
      expect(Types.LogImportance).toBeDefined();
      expect(Types.LogImportance.CRITICAL).toBe('critical');
    });

    it('should export LaneConfig interface', () => {
      const lane: Types.LaneConfig = { devPort: 3000, autoCreatePr: false };
      expect(lane.devPort).toBe(3000);
    });

    it('should export RunStatus type', () => {
        const status: Types.RunStatus = 'running';
        expect(status).toBe('running');
    });
  });

  describe('Type Guards', () => {
    // Runtime type guards
    const isLogImportance = (val: any): val is Types.LogImportance => {
      return Object.values(Types.LogImportance).includes(val);
    };

    const isRunStatus = (val: any): val is Types.RunStatus => {
      const statuses: Types.RunStatus[] = ['running', 'completed', 'failed', 'partial', 'pending'];
      return statuses.includes(val);
    };

    it('should validate LogImportance values', () => {
      expect(isLogImportance('critical')).toBe(true);
      expect(isLogImportance('info')).toBe(true);
      expect(isLogImportance('invalid')).toBe(false);
    });

    it('should validate RunStatus values', () => {
      expect(isRunStatus('running')).toBe(true);
      expect(isRunStatus('completed')).toBe(true);
      expect(isRunStatus('invalid')).toBe(false);
    });
  });

  describe('Interfaces', () => {
    it('should conform to CursorFlowConfig interface', () => {
      const config: Types.CursorFlowConfig = {
        tasksDir: 'tasks',
        logsDir: 'logs',
        pofDir: 'pof',
        baseBranch: 'main',
        branchPrefix: 'cf/',
        executor: 'cursor-agent',
        pollInterval: 1000,
        allowDependencyChange: false,
        lockfileReadOnly: true,
        enableReview: true,
        reviewModel: 'gpt-4',
        maxReviewIterations: 3,
        defaultLaneConfig: { devPort: 3000, autoCreatePr: false },
        logLevel: 'info',
        verboseGit: false,
        worktreePrefix: 'cf-',
        maxConcurrentLanes: 5,
        projectRoot: '.',
        agentOutputFormat: 'stream-json'
      };
      expect(config.tasksDir).toBe('tasks');
      expect(config.executor).toBe('cursor-agent');
    });

    it('should conform to Task interface', () => {
      const task: Types.Task = {
        name: 'test-task',
        prompt: 'do something',
        acceptanceCriteria: ['done'],
        dependsOn: ['lane:prev-task'],
        timeout: 60000
      };
      expect(task.name).toBe('test-task');
      expect(task.timeout).toBe(60000);
    });

    it('should conform to LaneState interface', () => {
        const laneState: Types.LaneState = {
            label: 'lane-1',
            status: 'running',
            currentTaskIndex: 0,
            totalTasks: 5,
            worktreeDir: '/tmp/wt',
            pipelineBranch: 'feat/test',
            startTime: Date.now(),
            endTime: null,
            error: null,
            dependencyRequest: null
        };
        expect(laneState.label).toBe('lane-1');
        expect(laneState.status).toBe('running');
    });
  });

  describe('Enum Tests', () => {
    it('should have correct LogImportance mapping', () => {
      expect(Types.LogImportance.CRITICAL).toBe('critical');
      expect(Types.LogImportance['CRITICAL']).toBe('critical');
    });

    it('should support reverse mapping (if applicable)', () => {
      const criticalKey = Object.keys(Types.LogImportance).find(key => Types.LogImportance[key as keyof typeof Types.LogImportance] === 'critical');
      expect(criticalKey).toBe('CRITICAL');
    });
  });
});

/**
 * CursorFlow prepare command
 * 
 * Prepare task files for a new feature - Terminal-first approach
 */

import * as fs from 'fs';
import * as path from 'path';
import * as logger from '../utils/logger';
import { loadConfig, getTasksDir } from '../utils/config';
import { Task, RunnerConfig } from '../utils/types';
import { safeJoin } from '../utils/path';
import { resolveTemplate } from '../utils/template';

// Preset template types
type PresetType = 'complex' | 'simple' | 'merge';
type EffectivePresetType = PresetType | 'custom';

interface PrepareOptions {
  featureName: string;
  lanes: number;
  template: string | null;
  preset: PresetType | null;  // --preset complex|simple|merge
  // Terminal-first options
  prompt: string | null;
  criteria: string[];
  model: string | null;
  taskSpecs: string[];  // Multiple --task "name|model|prompt|criteria|dependsOn|timeout"
  // Incremental options
  addLane: string | null;      // Add lane to existing task dir
  addTask: string | null;      // Add task to existing lane file
  force: boolean;
  help: boolean;
}

function printHelp(): void {
  console.log(`
cursorflow prepare - 태스크 파일 생성

═══════════════════════════════════════════════════════════════════════════════
  시나리오: "쇼핑몰" 프로젝트에서 백엔드 API와 프론트엔드 동시 개발
═══════════════════════════════════════════════════════════════════════════════

[Case 1] 가장 간단하게 - 버그 하나 고치기
─────────────────────────────────────────
  cursorflow prepare FixCartBug --prompt "장바구니 수량 버그 수정"

  결과: _cursorflow/tasks/2412251030_FixCartBug/
        └── 01-FixCartBug.json    (implement 태스크 1개)


[Case 2] 프리셋 사용 - 계획부터 테스트까지
─────────────────────────────────────────
  cursorflow prepare PaymentAPI --preset complex --prompt "Stripe 결제 연동"

  결과: 01-PaymentAPI.json에 plan → implement → test 태스크 생성

  프리셋:
    --preset complex   plan → implement → test
    --preset simple    implement → test
    (없으면)           implement만


[Case 3] 병렬 레인 - 백엔드/프론트 동시 개발
─────────────────────────────────────────
  cursorflow prepare ShopFeature --lanes 2 --preset complex \\
    --prompt "상품 검색 기능"

  결과: 01-lane-1.json (백엔드)  ─┬─ 동시 실행
        02-lane-2.json (프론트)  ─┘


[Case 4] 의존성 - 프론트가 백엔드 완료 후 시작
─────────────────────────────────────────
  cursorflow prepare --add-task ./02-lane-2.json \\
    --task "integrate|sonnet-4.5|API 연동|완료|01-lane-1:implement"
                                              └─ 이 태스크 완료 후 시작

  실행 흐름:
    01-lane-1: [plan] → [implement] → [test]
                             ↓ 완료되면
    02-lane-2: [plan] ───────┴─────→ [integrate]


[Case 5] 커스텀 태스크 - 원하는 대로 구성
─────────────────────────────────────────
  cursorflow prepare CustomFlow \\
    --task "setup|sonnet-4.5|DB 스키마 생성|완료" \\
    --task "api|sonnet-4.5|REST API 구현|동작" \\
    --task "test|sonnet-4.5|테스트 작성|통과"


[Case 6] 나중에 추가 - 레인이나 태스크 덧붙이기
─────────────────────────────────────────
  # 새 레인 추가
  cursorflow prepare --add-lane ./tasks/ShopFeature --preset simple

  # 기존 레인에 태스크 추가
  cursorflow prepare --add-task ./01-lane-1.json \\
    --task "docs|sonnet-4.5|API 문서화|완성"

═══════════════════════════════════════════════════════════════════════════════

--task 형식: "이름|모델|프롬프트|완료조건|의존성|타임아웃"

  예시:
    "build|sonnet-4.5|빌드하기|완료"                    기본
    "deploy|sonnet-4.5|배포|성공|01-lane:build"         의존성
    "heavy|sonnet-4.5|대용량|완료||1200000"             타임아웃 20분

═══════════════════════════════════════════════════════════════════════════════

옵션 요약:
  --prompt <text>      작업 설명
  --preset <type>      complex | simple | merge
  --lanes <num>        병렬 레인 수 (기본: 1)
  --task <spec>        커스텀 태스크 (반복 가능)
  --add-lane <dir>     기존 디렉토리에 레인 추가
  --add-task <file>    기존 레인에 태스크 추가
  --model <model>      AI 모델 (기본: sonnet-4.5)
  --template <path>    외부 템플릿 파일
  --force              덮어쓰기
  `);
}

function parseArgs(args: string[]): PrepareOptions {
  const result: PrepareOptions = {
    featureName: '',
    lanes: 1,
    template: null,
    preset: null,
    prompt: null,
    criteria: [],
    model: null,
    taskSpecs: [],
    addLane: null,
    addTask: null,
    force: false,
    help: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--force') {
      result.force = true;
    } else if (arg === '--lanes' && args[i + 1]) {
      result.lanes = parseInt(args[++i]) || 1;
    } else if (arg === '--template' && args[i + 1]) {
      result.template = args[++i];
    } else if (arg === '--preset' && args[i + 1]) {
      const presetValue = args[++i].toLowerCase();
      if (presetValue === 'complex' || presetValue === 'simple' || presetValue === 'merge') {
        result.preset = presetValue;
      } else {
        throw new Error(`Invalid preset: "${presetValue}". Must be one of: complex, simple, merge`);
      }
    } else if (arg === '--prompt' && args[i + 1]) {
      result.prompt = args[++i];
    } else if (arg === '--criteria' && args[i + 1]) {
      result.criteria = args[++i].split(',').map(c => c.trim()).filter(c => c);
    } else if (arg === '--model' && args[i + 1]) {
      result.model = args[++i];
    } else if (arg === '--task' && args[i + 1]) {
      result.taskSpecs.push(args[++i]);
    } else if (arg === '--add-lane' && args[i + 1]) {
      result.addLane = args[++i];
    } else if (arg === '--add-task' && args[i + 1]) {
      result.addTask = args[++i];
    } else if (!arg.startsWith('--') && !result.featureName) {
      result.featureName = arg;
    }
    
    i++;
  }

  return result;
}

function parseTaskSpec(spec: string): Task {
  // Format: "name|model|prompt|criteria1,criteria2|lane:task1,lane:task2|timeoutMs"
  const parts = spec.split('|');
  
  if (parts.length < 3) {
    throw new Error(`Invalid task spec: "${spec}". Expected format: "name|model|prompt[|criteria[|dependsOn[|timeout]]]"`);
  }
  
  const [name, model, prompt, _criteriaStr, depsStr, timeoutStr] = parts;
  
  const dependsOn = depsStr
    ? depsStr.split(',').map(d => d.trim()).filter(d => d)
    : undefined;

  const timeout = timeoutStr ? parseInt(timeoutStr) : undefined;
  
  return {
    name: name.trim(),
    model: model.trim() || 'sonnet-4.5',
    prompt: prompt.trim(),
    ...(dependsOn && dependsOn.length > 0 ? { dependsOn } : {}),
    ...(timeout ? { timeout } : {}),
  };
}

/**
 * Generate tasks based on preset template
 */
function buildTasksFromPreset(
  preset: PresetType,
  featureName: string,
  laneNumber: number,
  basePrompt: string,
  criteria: string[],
  hasDependencies: boolean
): Task[] {
  const tasks: Task[] = [];
  
  // Plan document path - stored in the worktree root
  const planDocPath = `_cursorflow/PLAN_lane-${laneNumber}.md`;
  
  // If lane has dependencies, auto-apply merge preset logic
  const effectivePreset = hasDependencies && preset !== 'merge' ? preset : preset;
  
  switch (effectivePreset) {
    case 'complex':
      // plan → implement → test
      tasks.push(
        {
          name: 'plan',
          model: 'sonnet-4.5-thinking',
          prompt: `# Planning: ${featureName} (Lane ${laneNumber})

## Goal
Analyze the requirements and create a detailed implementation plan.

## Context
${basePrompt}

## Instructions
1. Understand the scope and requirements.
2. List all files that need to be created or modified.
3. Define data structures and interfaces.
4. Outline step-by-step implementation plan.

## Output
**IMPORTANT: Save the plan document to \`${planDocPath}\`**

The plan document should include:
- Overview of the implementation approach
- List of files to create/modify
- Data structures and interfaces
- Step-by-step implementation tasks
- Potential risks and edge cases`,
        },
        {
          name: 'implement',
          model: 'sonnet-4.5',
          prompt: `# Implementation: ${featureName} (Lane ${laneNumber})

## Goal
Implement the planned changes.

## Context
${basePrompt}

## Plan Document
**Read the plan from \`${planDocPath}\` before starting implementation.**

## Instructions
1. Read and understand the plan document at \`${planDocPath}\`.
2. Follow the plan step by step.
3. Implement all code changes.
4. Ensure no build errors.
5. Write necessary code comments.
6. Double-check all requirements before finishing.

## Important
- Refer back to the plan document if unsure about any step.
- Verify all edge cases from the plan are handled.
- Ensure code follows project conventions.`,
        },
        {
          name: 'test',
          model: 'sonnet-4.5',
          prompt: `# Testing: ${featureName} (Lane ${laneNumber})

## Goal
Write comprehensive tests for the implementation.

## Plan Document
**Refer to \`${planDocPath}\` for the list of features and edge cases to test.**

## Instructions
1. Review the plan document for test requirements.
2. Write unit tests for new functions/classes.
3. Write integration tests if applicable.
4. Ensure all tests pass.
5. Verify edge cases from the plan are covered.
6. Double-check that nothing is missing.

## Important
- All tests must pass before completing.
- Cover happy path and error cases from the plan.`,
        }
      );
      break;

    case 'simple':
      // implement → test
      tasks.push(
        {
          name: 'implement',
          model: 'sonnet-4.5',
          prompt: `# Implementation: ${featureName} (Lane ${laneNumber})

## Goal
${basePrompt}

## Instructions
1. Implement the required changes.
2. Ensure no build errors.
3. Handle edge cases appropriately.
4. Double-check all requirements before finishing.

## Important
- Keep changes focused and minimal.
- Follow existing code conventions.`,
        },
        {
          name: 'test',
          model: 'sonnet-4.5',
          prompt: `# Testing: ${featureName} (Lane ${laneNumber})

## Goal
Test the implementation thoroughly.

## Instructions
1. Write or update tests for the changes.
2. Run all related tests.
3. Ensure all tests pass.
4. Double-check edge cases.

## Important
- All tests must pass before completing.`,
        }
      );
      break;

    case 'merge':
      // merge → test (for dependent lanes)
      tasks.push(
        {
          name: 'merge',
          model: 'sonnet-4.5',
          prompt: `# Merge & Integrate: ${featureName} (Lane ${laneNumber})

## Goal
Merge dependent branches and resolve any conflicts.

## Instructions
1. The dependent branches have been automatically merged.
2. Check for any merge conflicts and resolve them.
3. Ensure all imports and dependencies are correct.
4. Verify the integrated code compiles without errors.
5. Fix any integration issues.

## Important
- Resolve all conflicts cleanly.
- Ensure code from all merged branches works together.
- Check that no functionality was broken by the merge.`,
        },
        {
          name: 'test',
          model: 'sonnet-4.5',
          prompt: `# Integration Testing: ${featureName} (Lane ${laneNumber})

## Goal
Run comprehensive tests after the merge.

## Instructions
1. Run all unit tests.
2. Run integration tests.
3. Test that features from merged branches work together.
4. Verify no regressions were introduced.
5. Fix any failing tests.

## Important
- All tests must pass.
- Test the interaction between merged features.`,
        }
      );
      break;
  }
  
  return tasks;
}

function buildTasksFromOptions(
  options: PrepareOptions,
  laneNumber: number,
  featureName: string,
  _hasDependencies: boolean = false
): Task[] {
  // Priority: --task > --preset > --prompt alone > default
  
  // 1. Explicit --task specifications (highest priority)
  if (options.taskSpecs.length > 0) {
    const tasks: Task[] = [];
    for (const spec of options.taskSpecs) {
      tasks.push(parseTaskSpec(spec));
    }
    return tasks;
  }
  
  // 2. Preset template (use when --preset specified)
  //    --prompt serves as context when used with preset
  if (options.preset) {
    return buildTasksFromPreset(
      options.preset,
      featureName,
      laneNumber,
      options.prompt || `Implement ${featureName}`,
      options.criteria,
      false
    );
  }
  
  // 3. Single task from --prompt (only when no preset specified)
  if (options.prompt) {
    const task: Task = {
      name: 'implement',
      model: options.model || 'sonnet-4.5',
      prompt: options.prompt,
    };
    
    return [task];
  }
  
  // 4. Default: complex preset
  return buildTasksFromPreset(
    'complex',
    featureName,
    laneNumber,
    `Implement ${featureName}`,
    options.criteria,
    false
  );
}

function getDefaultConfig(laneNumber: number, featureName: string, tasks: Task[]) {
  return {
    // Git Configuration
    // baseBranch is auto-detected from current branch at runtime
    branchPrefix: `${featureName.toLowerCase()}/lane-${laneNumber}-`,
    
    // Execution Settings
    timeout: 600000,
    enableIntervention: false,
    
    // Dependency Policy
    dependencyPolicy: {
      allowDependencyChange: false,
      lockfileReadOnly: true,
    },
    
    // Lane Metadata
    laneNumber: laneNumber,
    devPort: 3000 + laneNumber,
    
    // Tasks
    tasks: tasks,
  };
}

function replacePlaceholders(obj: any, context: { featureName: string; laneNumber: number; devPort: number }): any {
  if (typeof obj === 'string') {
    return obj
      .replace(/\{\{featureName\}\}/g, context.featureName)
      .replace(/\{\{laneNumber\}\}/g, String(context.laneNumber))
      .replace(/\{\{devPort\}\}/g, String(context.devPort));
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => replacePlaceholders(item, context));
  }
  
  if (obj !== null && typeof obj === 'object') {
    const result: any = {};
    for (const key in obj) {
      result[key] = replacePlaceholders(obj[key], context);
    }
    return result;
  }
  
  return obj;
}

function getNextLaneNumber(taskDir: string): number {
  const files = fs.readdirSync(taskDir).filter(f => f.endsWith('.json'));
  let maxNum = 0;
  for (const file of files) {
    const match = file.match(/^(\d+)-/);
    if (match) {
      const num = parseInt(match[1]);
      if (num > maxNum) maxNum = num;
    }
  }
  return maxNum + 1;
}

function getFeatureNameFromDir(taskDir: string): string {
  const dirName = path.basename(taskDir);
  // Format: YYMMDDHHMM_FeatureName
  const match = dirName.match(/^\d+_(.+)$/);
  return match ? match[1] : dirName;
}

async function addLaneToDir(options: PrepareOptions): Promise<void> {
  const taskDir = path.resolve(process.cwd(), options.addLane!); // nosemgrep
  
  if (!fs.existsSync(taskDir)) {
    throw new Error(`Task directory not found: ${taskDir}`);
  }
  
  const featureName = getFeatureNameFromDir(taskDir);
  const laneNumber = getNextLaneNumber(taskDir);
  const laneName = `lane-${laneNumber}`;
  const fileName = `${laneNumber.toString().padStart(2, '0')}-${laneName}.json`;
  const filePath = safeJoin(taskDir, fileName);
  
  // Load template if provided
  let template = null;
  if (options.template) {
    template = await resolveTemplate(options.template);
  }

  let taskConfig;

  if (template) {
    taskConfig = { ...template, laneNumber, devPort: 3000 + laneNumber };
  } else {
    // Build tasks from options
    const tasks = buildTasksFromOptions(options, laneNumber, featureName, false);
    taskConfig = getDefaultConfig(laneNumber, featureName, tasks);
  }

  // Replace placeholders
  const finalConfig = replacePlaceholders(taskConfig, {
    featureName,
    laneNumber,
    devPort: 3000 + laneNumber,
  });
  
  // Use atomic write with wx flag to avoid TOCTOU race condition (unless force is set)
  // SECURITY NOTE: Writing user-defined task configuration to the file system.
  // The input is from CLI arguments and templates, used to generate CursorFlow lane files.
  try {
    const writeFlag = options.force ? 'w' : 'wx';
    fs.writeFileSync(filePath, JSON.stringify(finalConfig, null, 2) + '\n', { encoding: 'utf8', flag: writeFlag });
  } catch (err: any) {
    if (err.code === 'EEXIST') {
      throw new Error(`Lane file already exists: ${filePath}. Use --force to overwrite.`);
    }
    throw err;
  }
  
  const tasksList = finalConfig.tasks || [];
  const taskSummary = tasksList.map((t: any) => t.name).join(' → ');
  const presetInfo = options.preset ? ` [${options.preset}]` : (template ? ' [template]' : '');
  
  logger.success(`Added lane: ${fileName} [${taskSummary}]${presetInfo}`);
  logger.info(`Directory: ${taskDir}`);
  
  console.log(`\nNext steps:`);
  console.log(`  1. Validate: cursorflow doctor --tasks-dir ${taskDir}`);
  console.log(`  2. Run: cursorflow run ${taskDir}`);
}

async function addTaskToLane(options: PrepareOptions): Promise<void> {
  const laneFile = path.resolve(process.cwd(), options.addTask!); // nosemgrep
  
  if (options.taskSpecs.length === 0) {
    throw new Error('No task specified. Use --task "name|model|prompt|criteria" to define a task.');
  }
  
  // Read existing config - let the error propagate if file doesn't exist (avoids TOCTOU)
  let existingConfig: any;
  try {
    existingConfig = JSON.parse(fs.readFileSync(laneFile, 'utf8'));
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw new Error(`Lane file not found: ${laneFile}`);
    }
    throw err;
  }
  
  if (!existingConfig.tasks || !Array.isArray(existingConfig.tasks)) {
    existingConfig.tasks = [];
  }
  
  // Add new tasks
  const newTasks: Task[] = [];
  for (const spec of options.taskSpecs) {
    const task = parseTaskSpec(spec);
    existingConfig.tasks.push(task);
    newTasks.push(task);
  }
  
  // Write back
  fs.writeFileSync(laneFile, JSON.stringify(existingConfig, null, 2) + '\n', 'utf8');
  
  const taskNames = newTasks.map(t => t.name).join(', ');
  logger.success(`Added task(s): ${taskNames}`);
  logger.info(`Updated: ${laneFile}`);
  
  const taskSummary = existingConfig.tasks.map((t: Task) => t.name).join(' → ');
  logger.info(`Lane now has: ${taskSummary}`);
}

async function createNewFeature(options: PrepareOptions): Promise<void> {
  const config = loadConfig();
  const tasksBaseDir = getTasksDir(config);
  
  // Timestamp-based folder name (YYMMDDHHMM)
  const now = new Date();
  const timestamp = now.toISOString().replace(/[-T:]/g, '').substring(2, 12);
  const taskDirName = `${timestamp}_${options.featureName}`;
  const taskDir = safeJoin(tasksBaseDir, taskDirName);

  if (fs.existsSync(taskDir) && !options.force) {
    throw new Error(`Task directory already exists: ${taskDir}. Use --force to overwrite.`);
  }

  if (!fs.existsSync(taskDir)) {
    fs.mkdirSync(taskDir, { recursive: true });
  }

  logger.info(`Creating tasks in: ${path.relative(config.projectRoot, taskDir)}`);

  // Load template if provided (overrides --prompt/--task/--preset)
  let template = null;
  if (options.template) {
    template = await resolveTemplate(options.template);
  }

  const laneInfoList: { name: string; fileName: string; preset: string }[] = [];

  for (let i = 1; i <= options.lanes; i++) {
    const laneName = `lane-${i}`;
    const fileName = `${i.toString().padStart(2, '0')}-${laneName}.json`;
    const filePath = safeJoin(taskDir, fileName);
    
    const devPort = 3000 + i;
    
    let taskConfig;
    let effectivePreset: EffectivePresetType = options.preset || 'complex';
    
    if (template) {
      // Use template
      taskConfig = { ...template, laneNumber: i, devPort };
      effectivePreset = 'custom';
    } else {
      // Build from CLI options
      const tasks = buildTasksFromOptions(options, i, options.featureName, false);
      taskConfig = getDefaultConfig(i, options.featureName, tasks);
    }
    
    // Replace placeholders
    const finalConfig = replacePlaceholders(taskConfig, {
      featureName: options.featureName,
      laneNumber: i,
      devPort: devPort,
    });
    
    // SECURITY NOTE: Writing generated lane configuration (containing user prompts) to file system.
    fs.writeFileSync(filePath, JSON.stringify(finalConfig, null, 2) + '\n', 'utf8');
    
    const taskSummary = finalConfig.tasks?.map((t: any) => t.name).join(' → ') || 'default';
    const presetLabel = effectivePreset !== 'custom' ? ` [${effectivePreset}]` : '';
    logger.success(`Created: ${fileName} [${taskSummary}]${presetLabel}`);
    
    laneInfoList.push({ name: laneName, fileName, preset: effectivePreset });
  }

  // Create README
  const readmePath = safeJoin(taskDir, 'README.md');
  const readme = `# Task: ${options.featureName}

Prepared at: ${now.toISOString()}
Lanes: ${options.lanes}

## How to Run

\`\`\`bash
# 1. Validate configuration
cursorflow doctor --tasks-dir ${path.relative(config.projectRoot, taskDir)}

# 2. Run
cursorflow run ${path.relative(config.projectRoot, taskDir)}
\`\`\`

## Lanes

${laneInfoList.map(l => `- **${l.fileName.replace('.json', '')}** [${l.preset}]`).join('\n')}

## Task-Level Dependencies

To make a task wait for another task to complete before starting, use the \`dependsOn\` field:

\`\`\`json
{
  "tasks": [
    {
      "name": "my-task",
      "prompt": "...",
      "dependsOn": ["other-lane:other-task"]
    }
  ]
}
\`\`\`

## Modifying Tasks

\`\`\`bash
# Add a new lane
cursorflow prepare --add-lane ${path.relative(config.projectRoot, taskDir)} --preset complex

# Add task to existing lane
cursorflow prepare --add-task ${path.relative(config.projectRoot, taskDir)}/01-lane-1.json \\
  --task "verify|sonnet-4.5|Verify requirements|All met"
\`\`\`
`;

  fs.writeFileSync(readmePath, readme, 'utf8');
  logger.success('Created README.md');

  logger.section('✅ Preparation complete!');
  console.log(`\nNext steps:`);
  console.log(`  1. (Optional) Add more lanes/tasks`);
  console.log(`  2. Validate: cursorflow doctor --tasks-dir ${path.relative(config.projectRoot, taskDir)}`);
  console.log(`  3. Run: cursorflow run ${path.relative(config.projectRoot, taskDir)}`);
  console.log('');
}

async function prepare(args: string[]): Promise<void> {
  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    return;
  }

  // Mode 1: Add task to existing lane
  if (options.addTask) {
    await addTaskToLane(options);
    return;
  }

  // Mode 2: Add lane to existing directory
  if (options.addLane) {
    await addLaneToDir(options);
    return;
  }

  // Mode 3: Create new feature (requires featureName)
  if (!options.featureName) {
    printHelp();
    process.exit(1);
    return;
  }

  await createNewFeature(options);
}

export = prepare;

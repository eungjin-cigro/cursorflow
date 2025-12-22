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
  sequential: boolean;
  deps: string | null;
  // Terminal-first options
  prompt: string | null;
  criteria: string[];
  model: string | null;
  taskSpecs: string[];  // Multiple --task "name|model|prompt|criteria"
  // Incremental options
  addLane: string | null;      // Add lane to existing task dir
  addTask: string | null;      // Add task to existing lane file
  dependsOnLanes: string[];    // --depends-on for new lane
  force: boolean;
  help: boolean;
}

function printHelp(): void {
  console.log(`
Usage: cursorflow prepare <feature-name> [options]

Prepare task files for a new feature - Terminal-first workflow.

═══════════════════════════════════════════════════════════════════════════════
  WORKFLOW: Requirements → Lanes → Tasks → Validate → Run
═══════════════════════════════════════════════════════════════════════════════

## Step 1: Create Initial Lanes (with Presets)

  # Complex implementation: plan → implement → test
  cursorflow prepare FeatureName --preset complex --prompt "Implement user auth"

  # Simple implementation: implement → test
  cursorflow prepare BugFix --preset simple --prompt "Fix login bug"

  # Merge lane: merge → test (for lanes with dependencies)
  cursorflow prepare Integration --preset merge --depends-on "01-lane-1,02-lane-2"

  # Multiple sequential lanes (auto-detects merge preset for dependent lanes)
  cursorflow prepare FullStack --lanes 3 --sequential --prompt "Build your layer"

## Step 2: Add More Lanes (Incremental)

  # Add a merge lane to existing task directory
  cursorflow prepare --add-lane _cursorflow/tasks/2412211530_FullStack \\
    --preset merge --depends-on "01-lane-1,02-lane-2"

## Step 3: Add More Tasks to a Lane

  # Append a task to an existing lane
  cursorflow prepare --add-task _cursorflow/tasks/2412211530_FullStack/01-lane-1.json \\
    --task "verify|sonnet-4.5|Double-check all requirements|All criteria met"

## Step 4: Validate Configuration

  cursorflow doctor --tasks-dir _cursorflow/tasks/2412211530_FullStack

## Step 5: Run

  cursorflow run _cursorflow/tasks/2412211530_FullStack

═══════════════════════════════════════════════════════════════════════════════

## Preset Templates

  --preset complex     plan → implement → test (for complex features)
  --preset simple      implement → test (for simple changes)
  --preset merge       merge → test (auto-applied when --depends-on is set)

## Options

  Core:
    <feature-name>            Name of the feature (for new task directories)
    --lanes <num>             Number of lanes to create (default: 1)
    --preset <type>           Use preset template: complex | simple | merge

  Task Definition:
    --prompt <text>           Task prompt (uses preset or single task)
    --criteria <list>         Comma-separated acceptance criteria
    --model <model>           Model to use (default: sonnet-4.5)
    --task <spec>             Full task spec: "name|model|prompt|criteria|dependsOn|timeout" (repeatable)

  Dependencies:
    --sequential              Chain lanes: 1 → 2 → 3
    --deps <spec>             Custom dependencies: "2:1;3:1,2"
    --depends-on <lanes>      Dependencies for --add-lane: "01-lane-1,02-lane-2"
    Task-level deps:          In --task, add "lane:task" at the end.
                              Example: "test|sonnet-4.5|Run tests|All pass|01-lane-1:setup"
    Task-level timeout:       In --task, add milliseconds at the end.
                              Example: "heavy|sonnet-4.5|Big task|Done||1200000"

  Incremental (add to existing):
    --add-lane <dir>          Add a new lane to existing task directory
    --add-task <file>         Append task(s) to existing lane JSON file

  Advanced:
    --template <path|url|name>  External template JSON file, URL, or built-in name
    --force                     Overwrite existing files

═══════════════════════════════════════════════════════════════════════════════

## Examples

  # 1. Complex feature with multiple lanes
  cursorflow prepare AuthSystem --lanes 3 --sequential --preset complex \\
    --prompt "Implement authentication for your layer"

  # 2. Simple bug fix
  cursorflow prepare FixLoginBug --preset simple \\
    --prompt "Fix the login validation bug in auth.ts"

  # 3. Add a merge/integration lane
  cursorflow prepare --add-lane _cursorflow/tasks/2412211530_AuthSystem \\
    --preset merge --depends-on "01-lane-1,02-lane-2"

  # 4. Custom multi-task lane (overrides preset)
  cursorflow prepare ComplexFeature \\
    --task "plan|sonnet-4.5-thinking|Create implementation plan|Plan documented" \\
    --task "implement|sonnet-4.5|Build the feature|Code complete" \\
    --task "test|sonnet-4.5|Write comprehensive tests|Tests pass"
  `);
}

function parseArgs(args: string[]): PrepareOptions {
  const result: PrepareOptions = {
    featureName: '',
    lanes: 1,
    template: null,
    preset: null,
    sequential: false,
    deps: null,
    prompt: null,
    criteria: [],
    model: null,
    taskSpecs: [],
    addLane: null,
    addTask: null,
    dependsOnLanes: [],
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
    } else if (arg === '--sequential') {
      result.sequential = true;
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
    } else if (arg === '--deps' && args[i + 1]) {
      result.deps = args[++i];
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
    } else if (arg === '--depends-on' && args[i + 1]) {
      result.dependsOnLanes = args[++i].split(',').map(d => d.trim()).filter(d => d);
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
  
  const [name, model, prompt, criteriaStr, depsStr, timeoutStr] = parts;
  const acceptanceCriteria = criteriaStr 
    ? criteriaStr.split(',').map(c => c.trim()).filter(c => c)
    : undefined;
  
  const dependsOn = depsStr
    ? depsStr.split(',').map(d => d.trim()).filter(d => d)
    : undefined;

  const timeout = timeoutStr ? parseInt(timeoutStr) : undefined;
  
  return {
    name: name.trim(),
    model: model.trim() || 'sonnet-4.5',
    prompt: prompt.trim(),
    ...(acceptanceCriteria && acceptanceCriteria.length > 0 ? { acceptanceCriteria } : {}),
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
          acceptanceCriteria: [
            `Plan document saved to ${planDocPath}`,
            'All required files are identified',
            'Approach is clearly defined',
          ],
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
          acceptanceCriteria: criteria.length > 0 ? criteria : [
            'Code implemented according to plan',
            'No build errors',
            'All edge cases handled',
          ],
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
          acceptanceCriteria: [
            'Unit tests written',
            'All tests pass',
            'Edge cases covered',
          ],
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
          acceptanceCriteria: criteria.length > 0 ? criteria : [
            'Implementation complete',
            'No build errors',
            'Code follows conventions',
          ],
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
          acceptanceCriteria: [
            'Tests written/updated',
            'All tests pass',
          ],
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
          acceptanceCriteria: [
            'All conflicts resolved',
            'No build errors',
            'Integration verified',
          ],
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
          acceptanceCriteria: criteria.length > 0 ? criteria : [
            'All unit tests pass',
            'Integration tests pass',
            'No regressions',
          ],
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
  hasDependencies: boolean = false
): Task[] {
  // Priority: --task > --preset/dependencies > --prompt alone > default
  
  // 1. Explicit --task specifications (highest priority)
  if (options.taskSpecs.length > 0) {
    const tasks: Task[] = [];
    for (const spec of options.taskSpecs) {
      tasks.push(parseTaskSpec(spec));
    }
    return tasks;
  }
  
  // 2. Preset template (use when --preset specified OR lane has dependencies)
  //    --prompt serves as context when used with preset
  if (options.preset || hasDependencies) {
    // Auto-apply merge preset if lane has dependencies and no explicit preset
    const preset = options.preset || (hasDependencies ? 'merge' : 'complex');
    return buildTasksFromPreset(
      preset,
      featureName,
      laneNumber,
      options.prompt || `Implement ${featureName}`,
      options.criteria,
      hasDependencies
    );
  }
  
  // 3. Single task from --prompt (only when no preset specified)
  if (options.prompt) {
    const task: Task = {
      name: 'implement',
      model: options.model || 'sonnet-4.5',
      prompt: options.prompt,
    };
    
    if (options.criteria.length > 0) {
      task.acceptanceCriteria = options.criteria;
    }
    
    return [task];
  }
  
  // 4. Default: complex preset
  return buildTasksFromPreset(
    'complex',
    featureName,
    laneNumber,
    `Implement ${featureName}`,
    options.criteria,
    hasDependencies
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
    
    // Review Settings
    enableReview: true,
    reviewModel: 'sonnet-4.5-thinking',
    maxReviewIterations: 3,
    
    // Lane Metadata
    laneNumber: laneNumber,
    devPort: 3000 + laneNumber,
    
    // Tasks
    tasks: tasks,
  };
}

function parseDeps(depsStr: string): Map<number, number[]> {
  const map = new Map<number, number[]>();
  // Format: "2:1;3:1,2"
  const lanes = depsStr.split(';');
  for (const lane of lanes) {
    const [targetStr, depsPart] = lane.split(':');
    if (!targetStr || !depsPart) continue;
    
    const target = parseInt(targetStr);
    const deps = depsPart.split(',').map(d => parseInt(d)).filter(d => !isNaN(d));
    
    if (!isNaN(target) && deps.length > 0) {
      map.set(target, deps);
    }
  }
  return map;
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
  
  const hasDependencies = options.dependsOnLanes.length > 0;
  
  // Load template if provided
  let template = null;
  if (options.template) {
    template = await resolveTemplate(options.template);
  }

  let taskConfig;
  let effectivePreset: EffectivePresetType = options.preset || (hasDependencies ? 'merge' : 'complex');

  if (template) {
    taskConfig = { ...template, laneNumber, devPort: 3000 + laneNumber };
    effectivePreset = 'custom';
  } else {
    // Build tasks from options (auto-detects merge preset if has dependencies)
    const tasks = buildTasksFromOptions(options, laneNumber, featureName, hasDependencies);
    taskConfig = getDefaultConfig(laneNumber, featureName, tasks);
  }

  // Replace placeholders
  const processedConfig = replacePlaceholders(taskConfig, {
    featureName,
    laneNumber,
    devPort: 3000 + laneNumber,
  });
  
  // Add dependencies if specified
  const finalConfig = {
    ...processedConfig,
    ...(hasDependencies ? { dependsOn: options.dependsOnLanes } : {}),
  };
  
  // Use atomic write with wx flag to avoid TOCTOU race condition (unless force is set)
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
  const depsInfo = hasDependencies ? ` (depends: ${options.dependsOnLanes.join(', ')})` : '';
  const presetInfo = options.preset ? ` [${options.preset}]` : (hasDependencies ? ' [merge]' : (template ? ' [template]' : ''));
  
  logger.success(`Added lane: ${fileName} [${taskSummary}]${presetInfo}${depsInfo}`);
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

  // Calculate dependencies
  const dependencyMap = options.sequential 
    ? new Map(Array.from({ length: options.lanes - 1 }, (_, i) => [i + 2, [i + 1]]))
    : (options.deps ? parseDeps(options.deps) : new Map<number, number[]>());

  const laneInfoList: { name: string; fileName: string; dependsOn: string[]; preset: string }[] = [];

  for (let i = 1; i <= options.lanes; i++) {
    const laneName = `lane-${i}`;
    const fileName = `${i.toString().padStart(2, '0')}-${laneName}.json`;
    const filePath = safeJoin(taskDir, fileName);
    
    const depNums = dependencyMap.get(i) || [];
    const dependsOn = depNums.map(n => {
      const depLaneName = `lane-${n}`;
      return `${n.toString().padStart(2, '0')}-${depLaneName}`;
    });

    const hasDependencies = dependsOn.length > 0;
    const devPort = 3000 + i;
    
    let taskConfig;
    let effectivePreset: EffectivePresetType = options.preset || (hasDependencies ? 'merge' : 'complex');
    
    if (template) {
      // Use template
      taskConfig = { ...template, laneNumber: i, devPort };
      effectivePreset = 'custom';
    } else {
      // Build from CLI options
      const tasks = buildTasksFromOptions(options, i, options.featureName, hasDependencies);
      taskConfig = getDefaultConfig(i, options.featureName, tasks);
    }
    
    // Replace placeholders
    const processedConfig = replacePlaceholders(taskConfig, {
      featureName: options.featureName,
      laneNumber: i,
      devPort: devPort,
    });
    
    // Add dependencies if any
    const finalConfig = {
      ...processedConfig,
      ...(dependsOn.length > 0 ? { dependsOn } : {}),
    };
    
    fs.writeFileSync(filePath, JSON.stringify(finalConfig, null, 2) + '\n', 'utf8');
    
    const taskSummary = finalConfig.tasks?.map((t: any) => t.name).join(' → ') || 'default';
    const presetLabel = effectivePreset !== 'custom' ? ` [${effectivePreset}]` : '';
    logger.success(`Created: ${fileName} [${taskSummary}]${presetLabel}${dependsOn.length > 0 ? ` (depends: ${dependsOn.join(', ')})` : ''}`);
    
    laneInfoList.push({ name: laneName, fileName, dependsOn, preset: effectivePreset });
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

${laneInfoList.map(l => `- **${l.fileName.replace('.json', '')}** [${l.preset}]${l.dependsOn.length > 0 ? ` (depends: ${l.dependsOn.join(', ')})` : ''}`).join('\n')}

## Modifying Tasks

\`\`\`bash
# Add a new lane (with merge preset for dependent lanes)
cursorflow prepare --add-lane ${path.relative(config.projectRoot, taskDir)} \\
  --preset merge --depends-on "01-lane-1"

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

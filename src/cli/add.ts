/**
 * CursorFlow 'add' command
 * 
 * Adds tasks to an existing Lane in a Flow
 */

import * as fs from 'fs';
import * as path from 'path';
import * as logger from '../utils/logger';
import { loadConfig, findProjectRoot } from '../utils/config';
import { FlowMeta, LaneConfig, FlowTask, ParsedTaskSpec } from '../types/flow';
import { safeJoin } from '../utils/path';

interface AddOptions {
  flowName: string;
  laneName: string;
  taskSpecs: string[];
  after: string[];  // Dependencies: "lane:task" or "lane"
  help: boolean;
}

function printHelp(): void {
  console.log(`
\x1b[1mcursorflow add\x1b[0m - Lane에 Task 추가

\x1b[1m사용법:\x1b[0m
  cursorflow add <FlowName> <LaneName> --task "name=...|prompt=..." [--after ...]

\x1b[1m설명:\x1b[0m
  지정된 Flow의 Lane에 Task를 추가합니다.
  --task 옵션은 여러 번 사용하여 여러 태스크를 순차적으로 추가할 수 있습니다.

\x1b[1m--task 형식:\x1b[0m
  "name=<이름>|prompt=<프롬프트>"           (기본 모델 사용)
  "name=<이름>|model=<모델>|prompt=<프롬프트>" (모델 지정)

  필수 필드:
    name     태스크 이름 (영문, 숫자, 대시, 언더스코어)
    prompt   태스크 프롬프트/지시사항

  선택 필드:
    model    AI 모델 (생략 시 기본 모델 사용, cursorflow config로 설정)

\x1b[1m--after 형식:\x1b[0m (선택, 의존성 설정)
  첫 번째 태스크가 시작되기 전에 완료되어야 할 태스크를 지정합니다.

  "lane"              해당 레인의 마지막 태스크 완료 후 시작
  "lane:task"         특정 태스크 완료 후 시작
  "a:t1, b:t2"        여러 태스크가 모두 완료된 후 시작 (콤마 구분)

\x1b[1m예시:\x1b[0m
  # 기본 모델 사용 (model 생략)
  cursorflow add SearchFeature api \\
    --task "name=implement|prompt=검색 API 구현"

  # 모델 지정
  cursorflow add SearchFeature api \\
    --task "name=plan|model=opus-4.5-thinking|prompt=API 설계"

  # 의존성 설정
  cursorflow add SearchFeature web \\
    --task "name=ui|prompt=검색 UI 구현" \\
    --after "api:implement"

\x1b[1m기본 모델 설정:\x1b[0m
  cursorflow config defaultModel <모델명>
  예: cursorflow config defaultModel gemini-3-flash
  `);
}

function parseArgs(args: string[]): AddOptions {
  const result: AddOptions = {
    flowName: '',
    laneName: '',
    taskSpecs: [],
    after: [],
    help: false,
  };

  let i = 0;
  let positionalCount = 0;
  
  while (i < args.length) {
    const arg = args[i];
    
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--task' && args[i + 1]) {
      result.taskSpecs.push(args[++i]);
    } else if (arg === '--after' && args[i + 1]) {
      // Parse comma-separated dependencies
      const deps = args[++i].split(',').map(d => d.trim()).filter(d => d);
      result.after.push(...deps);
    } else if (!arg.startsWith('--')) {
      if (positionalCount === 0) {
        result.flowName = arg;
      } else if (positionalCount === 1) {
        result.laneName = arg;
      }
      positionalCount++;
    }
    
    i++;
  }

  return result;
}

/**
 * Parse task spec string into ParsedTaskSpec
 * Format: "name=value|model=value|prompt=value"
 * Note: model is optional, uses defaultModel from config if not specified
 */
function parseTaskSpec(spec: string, defaultModel: string): ParsedTaskSpec {
  const parts = spec.split('|');
  const result: Partial<ParsedTaskSpec> = {};

  for (const part of parts) {
    const eqIndex = part.indexOf('=');
    if (eqIndex === -1) continue;
    
    const key = part.substring(0, eqIndex).trim().toLowerCase();
    const value = part.substring(eqIndex + 1).trim();
    
    if (key === 'name') result.name = value;
    else if (key === 'model') result.model = value;
    else if (key === 'prompt') result.prompt = value;
    else if (key === 'timeout') result.timeout = parseInt(value, 10);
  }

  // Validate required fields
  if (!result.name) {
    throw new Error(`태스크 스펙에 'name' 필드가 필요합니다: ${spec}`);
  }
  if (!result.prompt) {
    throw new Error(`태스크 스펙에 'prompt' 필드가 필요합니다: ${spec}`);
  }
  
  // Use default model if not specified
  if (!result.model) {
    result.model = defaultModel;
  }

  // Validate name format
  if (!/^[a-zA-Z0-9_-]+$/.test(result.name)) {
    throw new Error(`태스크 이름은 영문, 숫자, 대시, 언더스코어만 사용 가능합니다: ${result.name}`);
  }

  return result as ParsedTaskSpec;
}

/**
 * Find flow directory by name
 */
function findFlowDir(flowsDir: string, flowName: string): string | null {
  if (!fs.existsSync(flowsDir)) {
    return null;
  }

  const dirs = fs.readdirSync(flowsDir)
    .filter(name => {
      const dirPath = safeJoin(flowsDir, name);
      return fs.statSync(dirPath).isDirectory();
    })
    .filter(name => {
      // Match by exact name or by suffix (ignoring ID prefix)
      const match = name.match(/^\d+_(.+)$/);
      return match ? match[1] === flowName : name === flowName;
    });

  if (dirs.length === 0) {
    return null;
  }

  // Return the most recent one (highest ID)
  dirs.sort((a, b) => b.localeCompare(a));
  return safeJoin(flowsDir, dirs[0]);
}

/**
 * Find lane file in flow directory
 * Supports both formats: "backend.json" (new) and "01-backend.json" (legacy)
 */
function findLaneFile(flowDir: string, laneName: string): string | null {
  const files = fs.readdirSync(flowDir)
    .filter(name => name.endsWith('.json') && name !== 'flow.meta.json');

  for (const file of files) {
    // New format: "backend.json"
    if (file === `${laneName}.json`) {
      return safeJoin(flowDir, file);
    }
    
    // Legacy format: "01-backend.json"
    const match = file.match(/^\d+-([^.]+)\.json$/);
    if (match && match[1] === laneName) {
      return safeJoin(flowDir, file);
    }
  }

  return null;
}

/**
 * Resolve --after dependencies to dependsOn format
 */
function resolveAfterDependencies(
  after: string[],
  flowDir: string
): string[] {
  const dependsOn: string[] = [];

  for (const dep of after) {
    if (dep.includes(':')) {
      // Already in "lane:task" format
      dependsOn.push(dep);
    } else {
      // Just lane name - find the lane file and get the last task
      const laneFile = findLaneFile(flowDir, dep);
      if (!laneFile) {
        throw new Error(`레인을 찾을 수 없습니다: ${dep}`);
      }
      
      const laneConfig: LaneConfig = JSON.parse(fs.readFileSync(laneFile, 'utf-8'));
      if (laneConfig.tasks.length === 0) {
        throw new Error(`레인 '${dep}'에 태스크가 없습니다. --after를 사용하려면 먼저 태스크를 추가하세요.`);
      }
      
      const lastTask = laneConfig.tasks[laneConfig.tasks.length - 1];
      
      // Get lane name from file (supports both "backend.json" and "01-backend.json")
      const fileName = path.basename(laneFile);
      const laneId = fileName.replace(/\.json$/, '');
      
      dependsOn.push(`${laneId}:${lastTask.name}`);
    }
  }

  return dependsOn;
}

async function addTasks(args: string[]): Promise<void> {
  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    return;
  }

  // Validate inputs
  if (!options.flowName) {
    logger.error('Flow 이름이 필요합니다.');
    console.log('\n사용법: cursorflow add <FlowName> <LaneName> --task "..."');
    console.log('도움말: cursorflow add --help');
    process.exit(1);
  }

  if (!options.laneName) {
    logger.error('Lane 이름이 필요합니다.');
    console.log('\n사용법: cursorflow add ' + options.flowName + ' <LaneName> --task "..."');
    process.exit(1);
  }

  if (options.taskSpecs.length === 0) {
    logger.error('최소 하나의 태스크가 필요합니다.');
    console.log('\n예: cursorflow add ' + options.flowName + ' ' + options.laneName + ' \\');
    console.log('      --task "name=implement|model=sonnet-4.5|prompt=기능 구현"');
    process.exit(1);
  }

  // Load config and find paths
  const projectRoot = findProjectRoot();
  const config = loadConfig(projectRoot);
  const flowsDir = safeJoin(projectRoot, config.flowsDir);

  // Find flow directory
  const flowDir = findFlowDir(flowsDir, options.flowName);
  if (!flowDir) {
    logger.error(`Flow를 찾을 수 없습니다: ${options.flowName}`);
    console.log('\n사용 가능한 Flow 목록을 확인하세요:');
    console.log('  ls ' + flowsDir);
    process.exit(1);
  }

  // Find lane file
  const laneFile = findLaneFile(flowDir, options.laneName);
  if (!laneFile) {
    logger.error(`Lane을 찾을 수 없습니다: ${options.laneName}`);
    
    // List available lanes
    const files = fs.readdirSync(flowDir)
      .filter(name => name.endsWith('.json') && name !== 'flow.meta.json');
    if (files.length > 0) {
      console.log('\n사용 가능한 Lane:');
      files.forEach(f => {
        const match = f.match(/^\d+-([^.]+)\.json$/);
        if (match) console.log('  - ' + match[1]);
      });
    }
    process.exit(1);
  }

  // Parse task specs (use defaultModel from config if model not specified)
  const parsedTasks: ParsedTaskSpec[] = [];
  for (const spec of options.taskSpecs) {
    try {
      parsedTasks.push(parseTaskSpec(spec, config.defaultModel));
    } catch (error: any) {
      logger.error(error.message);
      process.exit(1);
    }
  }

  // Check for duplicate task names within the specs
  const taskNames = parsedTasks.map(t => t.name);
  const duplicates = taskNames.filter((name, idx) => taskNames.indexOf(name) !== idx);
  if (duplicates.length > 0) {
    logger.error(`중복된 태스크 이름: ${[...new Set(duplicates)].join(', ')}`);
    process.exit(1);
  }

  // Load existing lane config
  const laneConfig: LaneConfig = JSON.parse(fs.readFileSync(laneFile, 'utf-8'));

  // Check for duplicate task names with existing tasks
  const existingNames = laneConfig.tasks.map(t => t.name);
  const conflicts = taskNames.filter(name => existingNames.includes(name));
  if (conflicts.length > 0) {
    logger.error(`이미 존재하는 태스크 이름: ${conflicts.join(', ')}`);
    process.exit(1);
  }

  // Resolve --after dependencies
  let dependsOn: string[] = [];
  if (options.after.length > 0) {
    try {
      dependsOn = resolveAfterDependencies(options.after, flowDir);
    } catch (error: any) {
      logger.error(error.message);
      process.exit(1);
    }
  }

  // Create FlowTask objects
  const newTasks: FlowTask[] = parsedTasks.map((spec, index) => {
    const task: FlowTask = {
      name: spec.name,
      model: spec.model,
      prompt: spec.prompt,
    };

    // Add dependsOn only to the first task
    if (index === 0 && dependsOn.length > 0) {
      task.dependsOn = dependsOn;
    }

    if (spec.timeout) {
      task.timeout = spec.timeout;
    }

    return task;
  });

  // Add tasks to lane
  laneConfig.tasks.push(...newTasks);

  // Save updated lane config
  fs.writeFileSync(laneFile, JSON.stringify(laneConfig, null, 2));

  // Print success message
  const laneFileName = path.basename(laneFile);
  logger.section(`✅ ${newTasks.length}개 태스크 추가 완료`);
  console.log('');
  console.log(`  📄 ${laneFileName}`);
  console.log('');
  
  newTasks.forEach((task, index) => {
    const isLast = index === newTasks.length - 1;
    const prefix = isLast ? '  └──' : '  ├──';
    let depInfo = '';
    if (task.dependsOn && task.dependsOn.length > 0) {
      depInfo = ` \x1b[33m← ${task.dependsOn.join(', ')}\x1b[0m`;
    }
    console.log(`${prefix} ${task.name} (${task.model})${depInfo}`);
  });

  console.log('');
  logger.info('전체 태스크 목록:');
  laneConfig.tasks.forEach((task, index) => {
    const isNew = newTasks.some(t => t.name === task.name);
    const marker = isNew ? '\x1b[32m(new)\x1b[0m' : '\x1b[90m(기존)\x1b[0m';
    console.log(`  ${index + 1}. ${task.name} ${marker}`);
  });

  console.log('');
  console.log('다음 단계:');
  console.log(`  cursorflow run ${options.flowName}    # Flow 실행`);
  console.log(`  cursorflow doctor ${options.flowName} # 설정 검증`);
}

export = addTasks;


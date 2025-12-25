/**
 * CursorFlow 'new' command
 * 
 * Creates a new Flow with empty Lane files
 */

import * as fs from 'fs';
import * as path from 'path';
import * as logger from '../utils/logger';
import { loadConfig, findProjectRoot } from '../utils/config';
import { FlowMeta, LaneConfig } from '../types/flow';
import { safeJoin } from '../utils/path';
import * as git from '../utils/git';

interface NewOptions {
  flowName: string;
  lanes: string[];
  help: boolean;
}

function printHelp(): void {
  console.log(`
\x1b[1mcursorflow new\x1b[0m - Flow와 Lane 생성

\x1b[1m사용법:\x1b[0m
  cursorflow new <FlowName> --lanes "lane1,lane2,..."

\x1b[1m설명:\x1b[0m
  새로운 Flow 디렉토리를 생성하고, 지정된 Lane 파일들의 뼈대를 만듭니다.
  각 Lane에 실제 Task를 추가하려면 'cursorflow add' 명령을 사용하세요.

\x1b[1m옵션:\x1b[0m
  --lanes <names>    콤마로 구분된 레인 이름 목록 (필수)
                     예: --lanes "backend,frontend,mobile"

\x1b[1m예시:\x1b[0m
  # 백엔드와 프론트엔드 2개 레인 생성
  cursorflow new ShopFeature --lanes "backend,frontend"

  # API, Web, Mobile 3개 레인 생성
  cursorflow new SearchFeature --lanes "api,web,mobile"

\x1b[1m생성 결과:\x1b[0m
  _cursorflow/flows/001_ShopFeature/
  ├── flow.meta.json       # Flow 메타데이터
  ├── 01-backend.json      # Lane 1 (빈 상태)
  └── 02-frontend.json     # Lane 2 (빈 상태)
  `);
}

function parseArgs(args: string[]): NewOptions {
  const result: NewOptions = {
    flowName: '',
    lanes: [],
    help: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--lanes' && args[i + 1]) {
      result.lanes = args[++i].split(',').map(l => l.trim()).filter(l => l);
    } else if (!arg.startsWith('--') && !result.flowName) {
      result.flowName = arg;
    }
    
    i++;
  }

  return result;
}

/**
 * Get next flow ID by scanning existing flows
 */
function getNextFlowId(flowsDir: string): string {
  if (!fs.existsSync(flowsDir)) {
    return '001';
  }

  const dirs = fs.readdirSync(flowsDir)
    .filter(name => {
      const dirPath = safeJoin(flowsDir, name);
      return fs.statSync(dirPath).isDirectory();
    })
    .filter(name => /^\d+_/.test(name));

  if (dirs.length === 0) {
    return '001';
  }

  const maxId = Math.max(...dirs.map(name => {
    const match = name.match(/^(\d+)_/);
    return match ? parseInt(match[1], 10) : 0;
  }));

  return String(maxId + 1).padStart(3, '0');
}

/**
 * Create flow.meta.json
 */
function createFlowMeta(flowId: string, flowName: string, lanes: string[], baseBranch: string): FlowMeta {
  return {
    id: flowId,
    name: flowName,
    createdAt: new Date().toISOString(),
    createdBy: 'user',
    baseBranch,
    status: 'pending',
    lanes,
  };
}

/**
 * Create empty lane config
 */
function createEmptyLaneConfig(laneName: string): LaneConfig {
  return {
    laneName,
    tasks: [],
  };
}

async function newFlow(args: string[]): Promise<void> {
  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    return;
  }

  // Validate inputs
  if (!options.flowName) {
    logger.error('Flow 이름이 필요합니다.');
    console.log('\n사용법: cursorflow new <FlowName> --lanes "lane1,lane2"');
    console.log('도움말: cursorflow new --help');
    process.exit(1);
  }

  if (options.lanes.length === 0) {
    logger.error('최소 하나의 레인이 필요합니다.');
    console.log('\n예: cursorflow new ' + options.flowName + ' --lanes "backend,frontend"');
    process.exit(1);
  }

  // Validate lane names (alphanumeric, dash, underscore only)
  const invalidLanes = options.lanes.filter(l => !/^[a-zA-Z0-9_-]+$/.test(l));
  if (invalidLanes.length > 0) {
    logger.error(`잘못된 레인 이름: ${invalidLanes.join(', ')}`);
    console.log('레인 이름은 영문, 숫자, 대시(-), 언더스코어(_)만 사용 가능합니다.');
    process.exit(1);
  }

  // Check for duplicate lane names
  const uniqueLanes = new Set(options.lanes);
  if (uniqueLanes.size !== options.lanes.length) {
    logger.error('중복된 레인 이름이 있습니다.');
    process.exit(1);
  }

  // Load config and determine paths
  const projectRoot = findProjectRoot();
  const config = loadConfig(projectRoot);
  const flowsDir = safeJoin(projectRoot, config.flowsDir);

  // Ensure flows directory exists
  if (!fs.existsSync(flowsDir)) {
    fs.mkdirSync(flowsDir, { recursive: true });
  }

  // Get next flow ID
  const flowId = getNextFlowId(flowsDir);
  const flowDirName = `${flowId}_${options.flowName}`;
  const flowDir = safeJoin(flowsDir, flowDirName);

  // Check if flow already exists
  if (fs.existsSync(flowDir)) {
    logger.error(`Flow 디렉토리가 이미 존재합니다: ${flowDirName}`);
    process.exit(1);
  }

  // Get current branch as base branch
  let baseBranch = 'main';
  try {
    baseBranch = git.getCurrentBranch(projectRoot);
  } catch {
    logger.warn('현재 브랜치를 가져올 수 없어 main을 기본값으로 사용합니다.');
  }

  // Create flow directory
  fs.mkdirSync(flowDir, { recursive: true });

  // Create flow.meta.json
  const flowMeta = createFlowMeta(flowId, options.flowName, options.lanes, baseBranch);
  const metaPath = safeJoin(flowDir, 'flow.meta.json');
  fs.writeFileSync(metaPath, JSON.stringify(flowMeta, null, 2));

  // Create lane files
  options.lanes.forEach((laneName, index) => {
    const laneNumber = String(index + 1).padStart(2, '0');
    const laneFileName = `${laneNumber}-${laneName}.json`;
    const lanePath = safeJoin(flowDir, laneFileName);
    
    const laneConfig = createEmptyLaneConfig(laneName);
    fs.writeFileSync(lanePath, JSON.stringify(laneConfig, null, 2));
  });

  // Print success message
  logger.section(`✅ Flow 생성 완료: ${flowDirName}`);
  console.log('');
  console.log(`  📁 ${flowDir}`);
  console.log(`     ├── flow.meta.json`);
  options.lanes.forEach((laneName, index) => {
    const laneNumber = String(index + 1).padStart(2, '0');
    const isLast = index === options.lanes.length - 1;
    const prefix = isLast ? '└──' : '├──';
    console.log(`     ${prefix} ${laneNumber}-${laneName}.json  (빈 상태)`);
  });
  
  console.log('');
  logger.info('다음 단계: 각 레인에 태스크를 추가하세요.');
  console.log('');
  options.lanes.forEach((laneName) => {
    console.log(`  cursorflow add ${options.flowName} ${laneName} \\`);
    console.log(`    --task "name=implement|model=sonnet-4.5|prompt=..."`);
    console.log('');
  });
}

export = newFlow;


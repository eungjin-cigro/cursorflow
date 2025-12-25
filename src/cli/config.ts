/**
 * CursorFlow 'config' command
 * 
 * View and set configuration values
 */

import * as fs from 'fs';
import * as path from 'path';
import * as logger from '../utils/logger';
import { loadConfig, findProjectRoot } from '../utils/config';
import { safeJoin } from '../utils/path';

interface ConfigOptions {
  key: string | null;
  value: string | null;
  list: boolean;
  help: boolean;
}

function printHelp(): void {
  console.log(`
\x1b[1mcursorflow config\x1b[0m - 설정 조회 및 변경

\x1b[1m사용법:\x1b[0m
  cursorflow config                     # 현재 설정 보기
  cursorflow config <key>               # 특정 설정 값 보기
  cursorflow config <key> <value>       # 설정 값 변경

\x1b[1m주요 설정 키:\x1b[0m
  defaultModel       기본 AI 모델 (예: gemini-3-flash)
  branchPrefix       브랜치 접두사 (예: feature/)
  executor           실행기 (cursor-agent | cloud)

\x1b[1m예시:\x1b[0m
  # 현재 설정 보기
  cursorflow config

  # 기본 모델 확인
  cursorflow config defaultModel

  # 기본 모델 변경
  cursorflow config defaultModel opus-4.5-thinking

\x1b[1m참고:\x1b[0m
  설정 파일 위치: cursorflow.config.js
  설정을 영구 저장하려면 cursorflow.config.js 파일을 직접 수정하세요.
  `);
}

function parseArgs(args: string[]): ConfigOptions {
  const result: ConfigOptions = {
    key: null,
    value: null,
    list: false,
    help: false,
  };

  let positionalCount = 0;
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--list' || arg === '-l') {
      result.list = true;
    } else if (!arg.startsWith('--')) {
      if (positionalCount === 0) {
        result.key = arg;
      } else if (positionalCount === 1) {
        result.value = arg;
      }
      positionalCount++;
    }
  }

  return result;
}

async function config(args: string[]): Promise<void> {
  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    return;
  }

  const projectRoot = findProjectRoot();
  const currentConfig = loadConfig(projectRoot);
  const configPath = safeJoin(projectRoot, 'cursorflow.config.js');

  // If setting a value
  if (options.key && options.value) {
    const key = options.key;
    const value = options.value;
    
    // Validate key exists
    if (!(key in currentConfig)) {
      logger.error(`알 수 없는 설정 키: ${key}`);
      console.log('\n사용 가능한 키: defaultModel, branchPrefix, executor, ...');
      process.exit(1);
    }

    // Update or create config file
    let configContent: string;
    
    if (fs.existsSync(configPath)) {
      // Read existing config
      const existingContent = fs.readFileSync(configPath, 'utf-8');
      
      // Simple regex replace for the key
      const keyRegex = new RegExp(`(${key}\\s*:\\s*)['"]?[^'",\\n]+['"]?`, 'g');
      if (keyRegex.test(existingContent)) {
        configContent = existingContent.replace(keyRegex, `$1'${value}'`);
      } else {
        // Add the key to the config
        configContent = existingContent.replace(
          /module\.exports\s*=\s*\{/,
          `module.exports = {\n  ${key}: '${value}',`
        );
      }
    } else {
      // Create new config file
      configContent = `module.exports = {
  ${key}: '${value}',
};
`;
    }

    fs.writeFileSync(configPath, configContent);
    logger.success(`✅ ${key} = '${value}' 설정됨`);
    console.log(`\n설정 파일: ${configPath}`);
    return;
  }

  // If viewing a specific key
  if (options.key) {
    const key = options.key;
    
    if (!(key in currentConfig)) {
      logger.error(`알 수 없는 설정 키: ${key}`);
      process.exit(1);
    }

    const value = (currentConfig as any)[key];
    console.log(`${key} = ${JSON.stringify(value)}`);
    return;
  }

  // List all config
  logger.section('CursorFlow 설정');
  console.log('');
  
  const importantKeys = [
    'defaultModel',
    'branchPrefix',
    'executor',
    'flowsDir',
    'tasksDir',
    'logsDir',
  ];

  console.log('\x1b[1m주요 설정:\x1b[0m');
  for (const key of importantKeys) {
    const value = (currentConfig as any)[key];
    console.log(`  ${key.padEnd(20)} ${JSON.stringify(value)}`);
  }

  console.log('');
  console.log(`설정 파일: ${configPath}`);
  console.log('');
  console.log('설정 변경: cursorflow config <key> <value>');
  console.log('예: cursorflow config defaultModel opus-4.5-thinking');
}

export = config;


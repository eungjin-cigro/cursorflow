#!/usr/bin/env node
/**
 * CursorFlow init command
 * 
 * Initialize CursorFlow in a project
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { findProjectRoot, createDefaultConfig } = require('../utils/config');
const { setupCommands } = require('./setup-commands');

function parseArgs(args) {
  const options = {
    example: false,
    withCommands: true,
    configOnly: false,
    force: false,
    gitignore: true,
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--example':
        options.example = true;
        break;
      case '--with-commands':
        options.withCommands = true;
        break;
      case '--no-commands':
        options.withCommands = false;
        break;
      case '--config-only':
        options.configOnly = true;
        break;
      case '--force':
        options.force = true;
        break;
      case '--no-gitignore':
        options.gitignore = false;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
    }
  }
  
  return options;
}

function printHelp() {
  console.log(`
Usage: cursorflow init [options]

Initialize CursorFlow in your project

Options:
  --example           Create example tasks
  --with-commands     Install Cursor commands (default: true)
  --no-commands       Skip Cursor commands installation
  --no-gitignore      Skip adding _cursorflow to .gitignore
  --config-only       Only create config file
  --force             Overwrite existing files
  --help, -h          Show help

Examples:
  cursorflow init
  cursorflow init --example
  cursorflow init --config-only
  cursorflow init --no-gitignore
  `);
}

function createDirectories(projectRoot, config) {
  const tasksDir = path.join(projectRoot, config.tasksDir);
  const logsDir = path.join(projectRoot, config.logsDir);
  
  if (!fs.existsSync(tasksDir)) {
    fs.mkdirSync(tasksDir, { recursive: true });
    logger.success(`Created directory: ${config.tasksDir}`);
  } else {
    logger.info(`Directory already exists: ${config.tasksDir}`);
  }
  
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
    logger.success(`Created directory: ${config.logsDir}`);
  } else {
    logger.info(`Directory already exists: ${config.logsDir}`);
  }
}

function createExampleTasks(projectRoot, config) {
  const exampleDir = path.join(projectRoot, config.tasksDir, 'example');
  
  if (!fs.existsSync(exampleDir)) {
    fs.mkdirSync(exampleDir, { recursive: true });
  }
  
  const exampleTask = {
    repository: "https://github.com/your-org/your-repo",
    baseBranch: "main",
    branchPrefix: "cursorflow/example-",
    executor: "cursor-agent",
    autoCreatePr: false,
    pollInterval: 60,
    tasks: [
      {
        name: "hello",
        model: "sonnet-4.5",
        prompt: `# Example Task

## Goal
Create a simple hello.txt file with a greeting message.

## Steps
1. Create a file called hello.txt
2. Write "Hello from CursorFlow!" in the file
3. Commit the change with message: "feat: add hello file"
`
      }
    ]
  };
  
  const taskPath = path.join(exampleDir, '01-hello.json');
  fs.writeFileSync(taskPath, JSON.stringify(exampleTask, null, 2) + '\n', 'utf8');
  
  logger.success(`Created example task: ${path.relative(projectRoot, taskPath)}`);
  
  // Create README
  const readmePath = path.join(exampleDir, 'README.md');
  const readme = `# Example Task

This is an example CursorFlow task to help you get started.

## Running the example

\`\`\`bash
cursorflow run ${config.tasksDir}/example/
\`\`\`

## What it does

- Creates a simple hello.txt file
- Demonstrates basic task structure
- Shows how to write task prompts

## Next steps

1. Review the task configuration in \`01-hello.json\`
2. Run the task to see CursorFlow in action
3. Create your own tasks based on this example
`;
  
  fs.writeFileSync(readmePath, readme, 'utf8');
  logger.success(`Created example README: ${path.relative(projectRoot, readmePath)}`);
}

/**
 * Add _cursorflow to .gitignore
 */
function updateGitignore(projectRoot) {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  const entry = '_cursorflow/';
  
  // Check if .gitignore exists
  if (!fs.existsSync(gitignorePath)) {
    // Create new .gitignore
    fs.writeFileSync(gitignorePath, `# CursorFlow\n${entry}\n`, 'utf8');
    logger.success('Created .gitignore with _cursorflow/');
    return;
  }
  
  // Read existing .gitignore
  const content = fs.readFileSync(gitignorePath, 'utf8');
  
  // Check if already included
  const lines = content.split('\n');
  const hasEntry = lines.some(line => {
    const trimmed = line.trim();
    return trimmed === '_cursorflow' || 
           trimmed === '_cursorflow/' || 
           trimmed === '/_cursorflow' ||
           trimmed === '/_cursorflow/';
  });
  
  if (hasEntry) {
    logger.info('_cursorflow/ already in .gitignore');
    return;
  }
  
  // Add entry
  let newContent = content;
  
  // Add newline if file doesn't end with one
  if (!content.endsWith('\n')) {
    newContent += '\n';
  }
  
  // Add section header and entry
  newContent += `\n# CursorFlow\n${entry}\n`;
  
  fs.writeFileSync(gitignorePath, newContent, 'utf8');
  logger.success('Added _cursorflow/ to .gitignore');
}

async function init(args) {
  logger.section('🚀 Initializing CursorFlow');
  
  const options = parseArgs(args);
  const projectRoot = findProjectRoot();
  
  logger.info(`Project root: ${projectRoot}`);
  
  // 1. Create config file
  const configPath = path.join(projectRoot, 'cursorflow.config.js');
  const configExists = fs.existsSync(configPath);
  
  if (configExists && !options.force) {
    logger.warn(`Config file already exists: ${configPath}`);
    logger.info('Use --force to overwrite');
  } else {
    try {
      createDefaultConfig(projectRoot, options.force);
      logger.success(`Created config file: cursorflow.config.js`);
    } catch (error) {
      if (error.message.includes('already exists') && !options.force) {
        logger.warn(error.message);
      } else {
        throw error;
      }
    }
  }
  
  const config = require(configPath);
  
  if (options.configOnly) {
    logger.section('✅ Configuration initialized');
    logger.info('\nNext steps:');
    logger.info('  1. Review cursorflow.config.js');
    logger.info('  2. Run: cursorflow init (without --config-only) to set up directories');
    return;
  }
  
  // 2. Create directories
  logger.info('\n📁 Creating directories...');
  createDirectories(projectRoot, config);
  
  // 3. Update .gitignore
  if (options.gitignore) {
    logger.info('\n📝 Updating .gitignore...');
    try {
      updateGitignore(projectRoot);
    } catch (error) {
      logger.warn(`Failed to update .gitignore: ${error.message}`);
      logger.info('You can manually add "_cursorflow/" to your .gitignore');
    }
  }
  
  // 4. Install Cursor commands
  if (options.withCommands) {
    logger.info('\n📋 Installing Cursor commands...');
    try {
      await setupCommands({ force: options.force, silent: false });
    } catch (error) {
      logger.warn(`Failed to install Cursor commands: ${error.message}`);
      logger.info('You can install them later with: npx cursorflow-setup');
    }
  }
  
  // 5. Create example tasks
  if (options.example) {
    logger.info('\n📝 Creating example tasks...');
    createExampleTasks(projectRoot, config);
  }
  
  // 6. Summary
  logger.section('✅ CursorFlow initialized successfully!');
  
  console.log('\n📚 Next steps:\n');
  console.log('  1. Review cursorflow.config.js');
  console.log('  2. Type "/" in Cursor IDE to see available commands');
  
  if (options.example) {
    console.log(`  3. Run: cursorflow run ${config.tasksDir}/example/`);
  } else {
    console.log('  3. Create tasks with: cursorflow prepare MyFeature');
  }
  
  console.log('\n📖 Documentation:');
  console.log('  https://github.com/eungjin-cigro/cursorflow#readme');
  console.log('');
}

module.exports = init;

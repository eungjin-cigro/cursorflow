/**
 * Setup Cursor commands
 * 
 * Installs CursorFlow commands to .cursor/commands/cursorflow/
 */

import * as fs from 'fs';
import * as path from 'path';
import * as logger from '../utils/logger';
import { findProjectRoot } from '../utils/config';

interface SetupOptions {
  force?: boolean;
  uninstall?: boolean;
  silent?: boolean;
}

function parseArgs(args: string[]): SetupOptions {
  const options: SetupOptions = {
    force: false,
    uninstall: false,
    silent: false,
  };
  
  for (const arg of args) {
    switch (arg) {
      case '--force':
        options.force = true;
        break;
      case '--uninstall':
        options.uninstall = true;
        break;
      case '--silent':
        options.silent = true;
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

function printHelp(): void {
  console.log(`
Usage: cursorflow-setup [options]

Install CursorFlow commands to Cursor IDE

Options:
  --force             Overwrite existing commands
  --uninstall         Remove installed commands
  --silent            Suppress output
  --help, -h          Show help

Examples:
  cursorflow-setup
  cursorflow-setup --force
  cursorflow-setup --uninstall
  `);
}

function getCommandsSourceDir(): string {
  // Commands are in the package directory
  return path.join(__dirname, '..', '..', 'commands');
}

export function setupCommands(options: SetupOptions = {}): { installed: number; backed: number; skipped: number } {
  const projectRoot = findProjectRoot();
  const targetDir = path.join(projectRoot, '.cursor', 'commands', 'cursorflow');
  const sourceDir = getCommandsSourceDir();
  
  if (!options.silent) {
    logger.info(`Installing commands to: ${path.relative(projectRoot, targetDir)}`);
  }
  
  // Create target directory
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  
  // Get list of command files
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Commands directory not found: ${sourceDir}`);
  }
  
  const commandFiles = fs.readdirSync(sourceDir).filter(f => f.endsWith('.md'));
  
  if (commandFiles.length === 0) {
    throw new Error(`No command files found in ${sourceDir}`);
  }
  
  let installed = 0;
  let backed = 0;
  let skipped = 0;
  
  for (const file of commandFiles) {
    const sourcePath = path.join(sourceDir, file);
    const targetPath = path.join(targetDir, file);
    
    // Check if file exists
    if (fs.existsSync(targetPath)) {
      if (options.force) {
        // Backup existing file
        const backupPath = `${targetPath}.backup`;
        fs.copyFileSync(targetPath, backupPath);
        backed++;
        if (!options.silent) {
          logger.info(`📦 Backed up: ${file}`);
        }
      } else {
        skipped++;
        if (!options.silent) {
          logger.info(`⏭️  Skipped (exists): ${file}`);
        }
        continue;
      }
    }
    
    // Copy file
    fs.copyFileSync(sourcePath, targetPath);
    installed++;
    if (!options.silent) {
      logger.success(`Installed: ${file}`);
    }
  }
  
  if (!options.silent) {
    logger.section('🎉 Setup complete!');
    console.log(`   Installed: ${installed} commands`);
    if (backed > 0) {
      console.log(`   Backed up: ${backed} existing commands`);
    }
    if (skipped > 0) {
      console.log(`   Skipped: ${skipped} commands (use --force to overwrite)`);
    }
    console.log(`\n📍 Location: ${targetDir}`);
    console.log('\n💡 Usage: Type "/" in Cursor chat to see commands');
  }
  
  return { installed, backed, skipped };
}

export function uninstallCommands(options: SetupOptions = {}): { removed: number } {
  const projectRoot = findProjectRoot();
  const targetDir = path.join(projectRoot, '.cursor', 'commands', 'cursorflow');
  
  if (!fs.existsSync(targetDir)) {
    if (!options.silent) {
      logger.info('Commands directory not found, nothing to uninstall');
    }
    return { removed: 0 };
  }
  
  const commandFiles = fs.readdirSync(targetDir).filter(f => f.endsWith('.md'));
  let removed = 0;
  
  for (const file of commandFiles) {
    const filePath = path.join(targetDir, file);
    fs.unlinkSync(filePath);
    removed++;
    if (!options.silent) {
      logger.info(`Removed: ${file}`);
    }
  }
  
  // Remove directory if empty
  const remainingFiles = fs.readdirSync(targetDir);
  if (remainingFiles.length === 0) {
    fs.rmdirSync(targetDir);
    if (!options.silent) {
      logger.info(`Removed directory: ${targetDir}`);
    }
  }
  
  if (!options.silent) {
    logger.success(`Uninstalled ${removed} commands`);
  }
  
  return { removed };
}

async function main(args: string[]): Promise<any> {
  const options = parseArgs(args);
  
  try {
    if (options.uninstall) {
      return uninstallCommands(options);
    } else {
      return setupCommands(options);
    }
  } catch (error: any) {
    if (!options.silent) {
      logger.error(error.message);
    }
    throw error;
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(error => {
    console.error('❌ Error:', error.message);
    if (process.env['DEBUG']) {
      console.error(error.stack);
    }
    process.exit(1);
  });
}

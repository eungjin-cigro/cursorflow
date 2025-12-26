import { startServer } from '../api/server';
import * as logger from '../utils/logger';

/**
 * Command: cursorflow api
 * Starts the CursorFlow backend API server
 */
async function main(args: string[]): Promise<void> {
  let port = 3000;
  let host = 'localhost';

  // Basic argument parsing
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' || args[i] === '-p') {
      port = parseInt(args[++i] || '3000', 10);
    } else if (args[i] === '--host' || args[i] === '-h') {
      host = args[++i] || 'localhost';
    }
  }

  try {
    startServer(port, host);
  } catch (error: any) {
    logger.error(`Failed to start API server: ${error.message}`);
    process.exit(1);
  }
}

export = main;

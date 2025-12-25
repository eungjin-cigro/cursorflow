import * as fs from 'fs';
import * as path from 'path';
import { safeJoin } from './path';

/**
 * Find flow directory by name in the flows directory.
 * Matches by exact name or by suffix (ignoring ID prefix like '001_').
 * 
 * @param flowsDir The base flows directory (e.g., _cursorflow/flows)
 * @param flowName The name of the flow to find
 * @returns The absolute path to the flow directory, or null if not found
 */
export function findFlowDir(flowsDir: string, flowName: string): string | null {
  if (!fs.existsSync(flowsDir)) {
    return null;
  }

  const dirs = fs.readdirSync(flowsDir)
    .filter(name => {
      const dirPath = safeJoin(flowsDir, name);
      try {
        return fs.statSync(dirPath).isDirectory();
      } catch {
        return false;
      }
    })
    .filter(name => {
      // Match by exact name or by suffix (ignoring ID prefix)
      const match = name.match(/^\d+_(.+)$/);
      return match ? match[1] === flowName : name === flowName;
    });

  if (dirs.length === 0) {
    return null;
  }

  // Return the most recent one (highest ID / alphabetical)
  dirs.sort((a, b) => b.localeCompare(a));
  return safeJoin(flowsDir, dirs[0]!);
}


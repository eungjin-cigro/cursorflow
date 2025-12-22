import * as path from 'path';

/**
 * Ensures that a path is safe and stays within a base directory.
 * Prevents path traversal attacks.
 */
export function isSafePath(baseDir: string, ...parts: string[]): boolean {
  const joined = path.join(baseDir, ...parts); // nosemgrep
  const resolvedBase = path.resolve(baseDir); // nosemgrep
  const resolvedJoined = path.resolve(joined); // nosemgrep
  
  return resolvedJoined.startsWith(resolvedBase);
}

/**
 * Safely joins path parts and ensures the result is within the base directory.
 * Throws an error if path traversal is detected.
 * 
 * @param baseDir The base directory that the resulting path must be within
 * @param parts Path parts to join
 * @returns The joined path
 * @throws Error if the resulting path is outside the base directory
 */
export function safeJoin(baseDir: string, ...parts: string[]): string {
  const joined = path.join(baseDir, ...parts); // nosemgrep
  const resolvedBase = path.resolve(baseDir); // nosemgrep
  const resolvedJoined = path.resolve(joined); // nosemgrep
  
  if (!resolvedJoined.startsWith(resolvedBase)) {
    throw new Error(`Potential path traversal detected: ${joined} is outside of ${baseDir}`);
  }
  
  return joined;
}

/**
 * Normalizes a path and checks if it's absolute or relative to project root.
 */
export function normalizePath(p: string, projectRoot: string): string {
  if (path.isAbsolute(p)) {
    return path.normalize(p);
  }
  return path.join(projectRoot, p); // nosemgrep
}


import * as path from 'path';

export const LOG_FILE_NAMES = {
  jsonl: 'terminal.jsonl',
} as const;

export type LogFileType = keyof typeof LOG_FILE_NAMES;

export function getLaneLogPath(laneDir: string, type: LogFileType): string {
  return path.join(laneDir, LOG_FILE_NAMES[type]);
}

import { stripAnsi } from './formatter';

export interface ParsedRawLogLine {
  timestamp: Date;
  message: string;
  level: string;
}

const ISO_TIMESTAMP = /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\]\s*/;
const SHORT_TIMESTAMP = /^\[(\d{2}:\d{2}:\d{2})\]\s*/;

export function parseRawLogLine(line: string, fallbackTime: Date): ParsedRawLogLine {
  const cleanLine = stripAnsi(line).trimEnd();
  let timestamp = fallbackTime;
  let message = cleanLine;

  const isoMatch = cleanLine.match(ISO_TIMESTAMP);
  if (isoMatch) {
    const parsed = new Date(isoMatch[1]);
    if (!Number.isNaN(parsed.getTime())) {
      timestamp = parsed;
    }
    message = cleanLine.slice(isoMatch[0].length);
  } else {
    const shortMatch = cleanLine.match(SHORT_TIMESTAMP);
    if (shortMatch) {
      const [hours, minutes, seconds] = shortMatch[1].split(':').map(Number);
      const candidate = new Date(fallbackTime);
      candidate.setHours(hours, minutes, seconds, 0);
      timestamp = candidate;
      message = cleanLine.slice(shortMatch[0].length);
    }
  }

  const lower = message.toLowerCase();
  const level = lower.includes('error') || lower.includes('failed') || lower.includes('❌')
    ? 'error'
    : lower.includes('warn')
      ? 'warn'
      : 'info';

  return { timestamp, message, level };
}

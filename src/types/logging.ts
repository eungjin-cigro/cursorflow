
export enum LogImportance {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
  INFO = 'info',
  DEBUG = 'debug'
}

export type MessageType = 
  | 'system' 
  | 'user' 
  | 'assistant' 
  | 'tool' 
  | 'tool_result' 
  | 'result' 
  | 'thinking'
  | 'info'
  | 'warn'
  | 'error'
  | 'success'
  | 'progress';

export interface ParsedMessage {
  type: MessageType;
  role: string;
  content: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface JsonLogEntry {
  timestamp: string;
  level: 'stdout' | 'stderr' | 'info' | 'error' | 'debug' | 'session';
  source?: string;
  task?: string;
  lane?: string;
  message: string;
  raw?: string;
  metadata?: Record<string, any>;
}

export interface BufferedLogEntry {
  id: string;
  timestamp: Date;
  laneName: string;
  level: string;
  message: string;
  raw?: string;
  importance: LogImportance;
  laneColor: string;
  metadata?: Record<string, any>;
}

export interface LogSession {
  id: string;
  laneName: string;
  taskName?: string;
  model?: string;
  startTime: number;
  metadata?: Record<string, any>;
}

export interface ConversationEntry {
  timestamp: string;
  role: 'user' | 'assistant' | 'reviewer' | 'system' | 'intervention';
  task: string | null;
  fullText: string;
  textLength: number;
  model: string | null;
}

export interface GitLogEntry {
  timestamp: string;
  operation: string;
  [key: string]: any;
}

export interface EventEntry {
  timestamp: string;
  event: string;
  [key: string]: any;
}

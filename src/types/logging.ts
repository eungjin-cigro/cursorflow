/**
 * Logging-related type definitions
 */

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
  | 'success'
  | 'info'
  | 'warn'
  | 'error' 
  | 'debug'
  | 'progress'
  | 'stdout' 
  | 'stderr';

export interface ParsedMessage {
  type: MessageType;
  role: string;
  content: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface JsonLogEntry {
  timestamp: string;
  type?: string;
  level?: 'stdout' | 'stderr' | 'info' | 'error' | 'debug' | 'session';
  source?: string;
  task?: string;
  lane?: string;
  message?: string;
  content?: string;
  raw?: string;
  metadata?: Record<string, any>;
  [key: string]: any;
}

export interface BufferedLogEntry {
  id: number;
  timestamp: Date;
  laneName: string;
  level: string;
  type: MessageType | string;
  message: string;
  raw?: JsonLogEntry;
  importance: LogImportance;
  laneColor: string;
  metadata?: Record<string, any>;
}

// Re-export EnhancedLogConfig from config.ts
export type { EnhancedLogConfig } from './config';

export interface LogSession {
  id: string;
  laneName: string;
  taskName?: string;
  model?: string;
  startTime: number;
  metadata?: Record<string, any>;
  /** Lane index (0-based) for display as L01, L02, etc. */
  laneIndex?: number;
  /** Task index (0-based) for display as T01, T02, etc. */
  taskIndex?: number;
}

export interface ConversationEntry {
  timestamp: string;
  role: 'user' | 'assistant' | 'system' | 'intervention';
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


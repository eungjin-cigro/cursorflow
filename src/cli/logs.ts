/**
 * CursorFlow logs command - View and export logs
 */

import * as fs from 'fs';
import * as path from 'path';
import * as logger from '../utils/logger';
import { loadConfig } from '../utils/config';
import { 
  readJsonLog, 
  exportLogs, 
  stripAnsi,
  JsonLogEntry 
} from '../utils/enhanced-logger';

interface LogsOptions {
  runDir?: string;
  lane?: string;
  all: boolean;  // View all lanes merged
  format: 'text' | 'json' | 'markdown' | 'html';
  output?: string;
  tail?: number;
  follow: boolean;
  filter?: string;
  level?: string;
  clean: boolean;
  raw: boolean;
  readable: boolean;  // Show readable parsed log
  help: boolean;
}

function printHelp(): void {
  console.log(`
Usage: cursorflow logs [run-dir] [options]

View and export lane logs.

Options:
  [run-dir]              Run directory (default: latest)
  --lane <name>          Filter to specific lane
  --all, -a              View all lanes merged (sorted by timestamp)
  --format <fmt>         Output format: text, json, markdown, html (default: text)
  --output <path>        Write output to file instead of stdout
  --tail <n>             Show last n lines/entries (default: all)
  --follow, -f           Follow log output in real-time
  --filter <pattern>     Filter entries by regex pattern
  --level <level>        Filter by log level: stdout, stderr, info, error, debug
  --readable, -r         Show readable log (parsed AI output) (default)
  --clean                Show clean terminal logs without ANSI codes
  --raw                  Show raw terminal logs with ANSI codes
  --help, -h             Show help

Examples:
  cursorflow logs                              # View latest run logs summary
  cursorflow logs --lane api-setup             # View readable parsed log (default)
  cursorflow logs --lane api-setup --clean     # View clean terminal logs
  cursorflow logs --all                        # View all lanes merged by time
  cursorflow logs --all --follow               # Follow all lanes in real-time
  cursorflow logs --all --format json          # Export all lanes as JSON
  cursorflow logs --all --filter "error"       # Filter all lanes for errors
  cursorflow logs --format json --output out.json  # Export as JSON
  `);
}

function parseArgs(args: string[]): LogsOptions {
  const laneIdx = args.indexOf('--lane');
  const formatIdx = args.indexOf('--format');
  const outputIdx = args.indexOf('--output');
  const tailIdx = args.indexOf('--tail');
  const filterIdx = args.indexOf('--filter');
  const levelIdx = args.indexOf('--level');
  
  // Find run directory (first non-option argument)
  const runDir = args.find((arg, i) => {
    if (arg.startsWith('--') || arg.startsWith('-')) return false;
    // Skip values for options
    const prevArg = args[i - 1];
    if (prevArg && ['--lane', '--format', '--output', '--tail', '--filter', '--level'].includes(prevArg)) {
      return false;
    }
    return true;
  });

  const raw = args.includes('--raw');
  const clean = args.includes('--clean');
  const readable = args.includes('--readable') || args.includes('-r');

  return {
    runDir,
    lane: laneIdx >= 0 ? args[laneIdx + 1] : undefined,
    all: args.includes('--all') || args.includes('-a'),
    format: (formatIdx >= 0 ? args[formatIdx + 1] : 'text') as LogsOptions['format'],
    output: outputIdx >= 0 ? args[outputIdx + 1] : undefined,
    tail: tailIdx >= 0 ? parseInt(args[tailIdx + 1] || '50') : undefined,
    follow: args.includes('--follow') || args.includes('-f'),
    filter: filterIdx >= 0 ? args[filterIdx + 1] : undefined,
    level: levelIdx >= 0 ? args[levelIdx + 1] : undefined,
    raw,
    clean,
    // Default to readable if no other format is specified
    readable: readable || (!raw && !clean),
    help: args.includes('--help') || args.includes('-h'),
  };
}

/**
 * Find the latest run directory
 */
function findLatestRunDir(logsDir: string): string | null {
  const runsDir = path.join(logsDir, 'runs');
  if (!fs.existsSync(runsDir)) return null;
  
  const runs = fs.readdirSync(runsDir)
    .filter(d => d.startsWith('run-'))
    .map(d => ({ 
      name: d, 
      path: path.join(runsDir, d), 
      mtime: fs.statSync(path.join(runsDir, d)).mtime.getTime() 
    }))
    .sort((a, b) => b.mtime - a.mtime);
  
  return runs.length > 0 ? runs[0]!.path : null;
}

/**
 * List lanes in a run directory
 */
function listLanes(runDir: string): string[] {
  const lanesDir = path.join(runDir, 'lanes');
  if (!fs.existsSync(lanesDir)) return [];
  
  return fs.readdirSync(lanesDir)
    .filter(d => fs.statSync(path.join(lanesDir, d)).isDirectory());
}

/**
 * Read and display text logs
 */
function displayTextLogs(
  laneDir: string, 
  options: LogsOptions
): void {
  let logFile: string;
  const readableLog = path.join(laneDir, 'terminal-readable.log');
  const rawLog = path.join(laneDir, 'terminal-raw.log');
  const cleanLog = path.join(laneDir, 'terminal.log');

  if (options.raw) {
    logFile = rawLog;
  } else if (options.clean) {
    logFile = cleanLog;
  } else if (options.readable && fs.existsSync(readableLog)) {
    logFile = readableLog;
  } else {
    // Default or fallback to clean log
    logFile = cleanLog;
  }
  
  if (!fs.existsSync(logFile)) {
    console.log('No log file found.');
    return;
  }
  
  let content = fs.readFileSync(logFile, 'utf8');
  let lines = content.split('\n');
  
  // Apply filter
  if (options.filter) {
    const regex = new RegExp(options.filter, 'i');
    lines = lines.filter(line => regex.test(line));
  }
  
  // Apply tail
  if (options.tail && lines.length > options.tail) {
    lines = lines.slice(-options.tail);
  }
  
  // Clean ANSI if needed (for clean mode or default fallback)
  if (!options.raw) {
    lines = lines.map(line => stripAnsi(line));
  }
  
  console.log(lines.join('\n'));
}

/**
 * Read and display JSON logs
 */
function displayJsonLogs(
  laneDir: string, 
  options: LogsOptions
): void {
  const logFile = path.join(laneDir, 'terminal.jsonl');
  
  if (!fs.existsSync(logFile)) {
    console.log('No JSON log file found.');
    return;
  }
  
  let entries = readJsonLog(logFile);
  
  // Apply level filter
  if (options.level) {
    entries = entries.filter(e => e.level === options.level);
  }
  
  // Apply regex filter
  if (options.filter) {
    const regex = new RegExp(options.filter, 'i');
    entries = entries.filter(e => regex.test(e.message) || regex.test(e.task || ''));
  }
  
  // Apply tail
  if (options.tail && entries.length > options.tail) {
    entries = entries.slice(-options.tail);
  }
  
  if (options.format === 'json') {
    console.log(JSON.stringify(entries, null, 2));
  } else {
    // Display as formatted text
    for (const entry of entries) {
      const levelColor = getLevelColor(entry.level);
      const ts = new Date(entry.timestamp).toLocaleTimeString();
      console.log(`${levelColor}[${ts}] [${entry.level.toUpperCase().padEnd(6)}]${logger.COLORS.reset} ${entry.message}`);
    }
  }
}

/**
 * Get color for log level
 */
function getLevelColor(level: string): string {
  switch (level) {
    case 'error':
      return logger.COLORS.red;
    case 'stderr':
      return logger.COLORS.yellow;
    case 'info':
    case 'session':
      return logger.COLORS.cyan;
    case 'debug':
      return logger.COLORS.gray;
    default:
      return logger.COLORS.reset;
  }
}

/**
 * Lane color palette for distinguishing lanes in merged view
 */
const LANE_COLORS = [
  '\x1b[38;5;39m',   // Blue
  '\x1b[38;5;208m',  // Orange
  '\x1b[38;5;156m',  // Light Green
  '\x1b[38;5;213m',  // Pink
  '\x1b[38;5;87m',   // Cyan
  '\x1b[38;5;228m',  // Yellow
  '\x1b[38;5;183m',  // Light Purple
  '\x1b[38;5;121m',  // Sea Green
];

/**
 * Get consistent color for a lane name
 */
function getLaneColor(laneName: string, laneIndex: number): string {
  return LANE_COLORS[laneIndex % LANE_COLORS.length]!;
}

/**
 * Extended JSON log entry with lane info
 */
interface MergedLogEntry extends JsonLogEntry {
  laneName: string;
  laneColor: string;
}

/**
 * Read and merge all lane logs
 */
function readAllLaneLogs(runDir: string): MergedLogEntry[] {
  const lanes = listLanes(runDir);
  const allEntries: MergedLogEntry[] = [];
  
  lanes.forEach((laneName, index) => {
    const laneDir = path.join(runDir, 'lanes', laneName);
    const jsonLogPath = path.join(laneDir, 'terminal.jsonl');
    
    if (fs.existsSync(jsonLogPath)) {
      const entries = readJsonLog(jsonLogPath);
      const laneColor = getLaneColor(laneName, index);
      
      for (const entry of entries) {
        allEntries.push({
          ...entry,
          laneName,
          laneColor,
        });
      }
    }
  });
  
  // Sort by timestamp
  allEntries.sort((a, b) => {
    const timeA = new Date(a.timestamp).getTime();
    const timeB = new Date(b.timestamp).getTime();
    return timeA - timeB;
  });
  
  return allEntries;
}

/**
 * Display merged logs from all lanes
 */
function displayMergedLogs(runDir: string, options: LogsOptions): void {
  let entries = readAllLaneLogs(runDir);
  
  if (entries.length === 0) {
    console.log('No log entries found in any lane.');
    return;
  }
  
  // Apply level filter
  if (options.level) {
    entries = entries.filter(e => e.level === options.level);
  }
  
  // Apply regex filter
  if (options.filter) {
    const regex = new RegExp(options.filter, 'i');
    entries = entries.filter(e => 
      regex.test(e.message) || 
      regex.test(e.task || '') ||
      regex.test(e.laneName)
    );
  }
  
  // Apply tail
  if (options.tail && entries.length > options.tail) {
    entries = entries.slice(-options.tail);
  }
  
  // Get unique lanes for legend
  const lanes = [...new Set(entries.map(e => e.laneName))];
  
  // Print header
  console.log(`\n${logger.COLORS.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${logger.COLORS.reset}`);
  console.log(`${logger.COLORS.cyan}  🔀 Merged Logs - ${path.basename(runDir)} (${entries.length} entries from ${lanes.length} lanes)${logger.COLORS.reset}`);
  console.log(`${logger.COLORS.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${logger.COLORS.reset}`);
  
  // Print lane legend
  console.log('\n  Lanes: ' + lanes.map((lane, i) => {
    const color = getLaneColor(lane, lanes.indexOf(lane));
    return `${color}■${logger.COLORS.reset} ${lane}`;
  }).join('  '));
  console.log('');
  
  // Format output based on format option
  if (options.format === 'json') {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }
  
  // Display entries
  for (const entry of entries) {
    const ts = new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false });
    const levelColor = getLevelColor(entry.level);
    const laneColor = entry.laneColor;
    const lanePad = entry.laneName.substring(0, 12).padEnd(12);
    const levelPad = entry.level.toUpperCase().padEnd(6);
    
    // Skip session entries for cleaner output unless they're important
    if (entry.level === 'session' && entry.message === 'Session started') {
      console.log(`${logger.COLORS.gray}[${ts}]${logger.COLORS.reset} ${laneColor}[${lanePad}]${logger.COLORS.reset} ${logger.COLORS.cyan}── Session Started ──${logger.COLORS.reset}`);
      continue;
    }
    if (entry.level === 'session' && entry.message === 'Session ended') {
      console.log(`${logger.COLORS.gray}[${ts}]${logger.COLORS.reset} ${laneColor}[${lanePad}]${logger.COLORS.reset} ${logger.COLORS.cyan}── Session Ended ──${logger.COLORS.reset}`);
      continue;
    }
    
    console.log(`${logger.COLORS.gray}[${ts}]${logger.COLORS.reset} ${laneColor}[${lanePad}]${logger.COLORS.reset} ${levelColor}[${levelPad}]${logger.COLORS.reset} ${entry.message}`);
  }
  
  console.log(`\n${logger.COLORS.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${logger.COLORS.reset}`);
}

/**
 * Follow all lanes in real-time
 */
function followAllLogs(runDir: string, options: LogsOptions): void {
  const lanes = listLanes(runDir);
  
  if (lanes.length === 0) {
    console.log('No lanes found.');
    return;
  }
  
  // Track last read position for each lane
  const lastPositions: Record<string, number> = {};
  const laneColors: Record<string, string> = {};
  
  lanes.forEach((lane, index) => {
    lastPositions[lane] = 0;
    laneColors[lane] = getLaneColor(lane, index);
  });
  
  // Print header
  console.log(`\n${logger.COLORS.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${logger.COLORS.reset}`);
  console.log(`${logger.COLORS.cyan}  🔴 Following All Lanes - ${path.basename(runDir)} (Ctrl+C to stop)${logger.COLORS.reset}`);
  console.log(`${logger.COLORS.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${logger.COLORS.reset}`);
  console.log('\n  Lanes: ' + lanes.map((lane, i) => {
    return `${laneColors[lane]}■${logger.COLORS.reset} ${lane}`;
  }).join('  '));
  console.log('');
  
  const checkInterval = setInterval(() => {
    const newEntries: MergedLogEntry[] = [];
    
    for (const lane of lanes) {
      const laneDir = path.join(runDir, 'lanes', lane);
      const jsonLogPath = path.join(laneDir, 'terminal.jsonl');
      
      if (!fs.existsSync(jsonLogPath)) continue;
      
      try {
        const stats = fs.statSync(jsonLogPath);
        if (stats.size > lastPositions[lane]!) {
          const fd = fs.openSync(jsonLogPath, 'r');
          const buffer = Buffer.alloc(stats.size - lastPositions[lane]!);
          fs.readSync(fd, buffer, 0, buffer.length, lastPositions[lane]!);
          fs.closeSync(fd);
          
          const content = buffer.toString();
          const lines = content.split('\n').filter(l => l.trim());
          
          for (const line of lines) {
            try {
              const entry = JSON.parse(line) as JsonLogEntry;
              newEntries.push({
                ...entry,
                laneName: lane,
                laneColor: laneColors[lane]!,
              });
            } catch {
              // Skip invalid lines
            }
          }
          
          lastPositions[lane] = stats.size;
        }
      } catch {
        // Ignore errors
      }
    }
    
    // Sort new entries by timestamp
    newEntries.sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      return timeA - timeB;
    });
    
    // Apply filters and display
    for (let entry of newEntries) {
      // Apply level filter
      if (options.level && entry.level !== options.level) continue;
      
      // Apply regex filter
      if (options.filter) {
        const regex = new RegExp(options.filter, 'i');
        if (!regex.test(entry.message) && !regex.test(entry.task || '') && !regex.test(entry.laneName)) {
          continue;
        }
      }
      
      const ts = new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false });
      const levelColor = getLevelColor(entry.level);
      const lanePad = entry.laneName.substring(0, 12).padEnd(12);
      const levelPad = entry.level.toUpperCase().padEnd(6);
      
      // Skip verbose session entries
      if (entry.level === 'session') {
        if (entry.message === 'Session started') {
          console.log(`${logger.COLORS.gray}[${ts}]${logger.COLORS.reset} ${entry.laneColor}[${lanePad}]${logger.COLORS.reset} ${logger.COLORS.cyan}── Session Started ──${logger.COLORS.reset}`);
        } else if (entry.message === 'Session ended') {
          console.log(`${logger.COLORS.gray}[${ts}]${logger.COLORS.reset} ${entry.laneColor}[${lanePad}]${logger.COLORS.reset} ${logger.COLORS.cyan}── Session Ended ──${logger.COLORS.reset}`);
        }
        continue;
      }
      
      console.log(`${logger.COLORS.gray}[${ts}]${logger.COLORS.reset} ${entry.laneColor}[${lanePad}]${logger.COLORS.reset} ${levelColor}[${levelPad}]${logger.COLORS.reset} ${entry.message}`);
    }
  }, 100);
  
  // Handle Ctrl+C
  process.on('SIGINT', () => {
    clearInterval(checkInterval);
    console.log('\n\nStopped following logs.');
    process.exit(0);
  });
}

/**
 * Export merged logs to various formats
 */
function exportMergedLogs(runDir: string, format: string, outputPath?: string): string {
  let entries = readAllLaneLogs(runDir);
  let output = '';
  
  switch (format) {
    case 'json':
      output = JSON.stringify(entries, null, 2);
      break;
      
    case 'markdown':
      output = exportMergedToMarkdown(entries, runDir);
      break;
      
    case 'html':
      output = exportMergedToHtml(entries, runDir);
      break;
      
    default:
      // Text format
      for (const entry of entries) {
        const ts = new Date(entry.timestamp).toISOString();
        output += `[${ts}] [${entry.laneName}] [${entry.level.toUpperCase()}] ${entry.message}\n`;
      }
  }
  
  if (outputPath) {
    fs.writeFileSync(outputPath, output, 'utf8');
  }
  
  return output;
}

/**
 * Export merged logs to Markdown
 */
function exportMergedToMarkdown(entries: MergedLogEntry[], runDir: string): string {
  const lanes = [...new Set(entries.map(e => e.laneName))];
  
  let md = `# CursorFlow Merged Logs\n\n`;
  md += `**Run:** ${path.basename(runDir)}\n`;
  md += `**Lanes:** ${lanes.join(', ')}\n`;
  md += `**Entries:** ${entries.length}\n\n`;
  
  md += `## Timeline\n\n`;
  md += '| Time | Lane | Level | Message |\n';
  md += '|------|------|-------|--------|\n';
  
  for (const entry of entries) {
    const ts = new Date(entry.timestamp).toLocaleTimeString();
    const message = entry.message.replace(/\|/g, '\\|').substring(0, 80);
    md += `| ${ts} | ${entry.laneName} | ${entry.level} | ${message} |\n`;
  }
  
  return md;
}

/**
 * Export merged logs to HTML
 */
function exportMergedToHtml(entries: MergedLogEntry[], runDir: string): string {
  const lanes = [...new Set(entries.map(e => e.laneName))];
  
  let html = `<!DOCTYPE html>
<html>
<head>
  <title>CursorFlow Merged Logs - ${path.basename(runDir)}</title>
  <style>
    body { font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace; margin: 20px; background: #1e1e1e; color: #d4d4d4; }
    h1, h2 { color: #569cd6; }
    .legend { margin: 10px 0; padding: 10px; background: #252526; border-radius: 4px; }
    .legend-item { display: inline-block; margin-right: 15px; }
    .legend-color { display: inline-block; width: 12px; height: 12px; margin-right: 5px; border-radius: 2px; }
    .entry { padding: 4px 8px; margin: 2px 0; border-radius: 4px; display: flex; }
    .entry .time { color: #808080; width: 80px; flex-shrink: 0; }
    .entry .lane { width: 120px; flex-shrink: 0; font-weight: bold; }
    .entry .level { width: 70px; flex-shrink: 0; }
    .entry .message { flex: 1; white-space: pre-wrap; }
    .entry.stdout { background: #252526; }
    .entry.stderr { background: #3c1f1f; }
    .entry.stderr .level { color: #f48771; }
    .entry.info { background: #1e3a5f; }
    .entry.error { background: #5f1e1e; }
    .entry.session { background: #1e4620; color: #6a9955; }
  </style>
</head>
<body>
  <h1>🔀 CursorFlow Merged Logs</h1>
  <p><strong>Run:</strong> ${path.basename(runDir)} | <strong>Entries:</strong> ${entries.length}</p>
  
  <div class="legend">
    <strong>Lanes:</strong> `;
  
  const colors = ['#5dade2', '#f39c12', '#58d68d', '#af7ac5', '#48c9b0', '#f7dc6f', '#bb8fce', '#76d7c4'];
  lanes.forEach((lane, i) => {
    const color = colors[i % colors.length];
    html += `<span class="legend-item"><span class="legend-color" style="background: ${color}"></span>${lane}</span>`;
  });
  
  html += `</div>\n`;
  
  for (const entry of entries) {
    const ts = new Date(entry.timestamp).toLocaleTimeString();
    const laneIndex = lanes.indexOf(entry.laneName);
    const color = colors[laneIndex % colors.length];
    
    html += `  <div class="entry ${entry.level}">
    <span class="time">${ts}</span>
    <span class="lane" style="color: ${color}">${entry.laneName}</span>
    <span class="level">[${entry.level.toUpperCase()}]</span>
    <span class="message">${escapeHtml(entry.message)}</span>
  </div>\n`;
  }
  
  html += '</body></html>';
  return html;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Follow logs in real-time
 */
function followLogs(laneDir: string, options: LogsOptions): void {
  let logFile: string;
  const readableLog = path.join(laneDir, 'terminal-readable.log');
  const rawLog = path.join(laneDir, 'terminal-raw.log');
  const cleanLog = path.join(laneDir, 'terminal.log');

  if (options.raw) {
    logFile = rawLog;
  } else if (options.clean) {
    logFile = cleanLog;
  } else if (options.readable && fs.existsSync(readableLog)) {
    logFile = readableLog;
  } else {
    // Default or fallback to clean log
    logFile = cleanLog;
  }
  
  if (!fs.existsSync(logFile)) {
    console.log('Waiting for log file...');
  }
  
  let lastSize = 0;
  try {
    lastSize = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
  } catch {
    // Ignore
  }
  
  console.log(`${logger.COLORS.cyan}Following ${logFile}... (Ctrl+C to stop)${logger.COLORS.reset}\n`);
  
  const checkInterval = setInterval(() => {
    try {
      if (!fs.existsSync(logFile)) return;
      
      const stats = fs.statSync(logFile);
      if (stats.size > lastSize) {
        const fd = fs.openSync(logFile, 'r');
        const buffer = Buffer.alloc(stats.size - lastSize);
        fs.readSync(fd, buffer, 0, buffer.length, lastSize);
        fs.closeSync(fd);
        
        let content = buffer.toString();
        
        // Apply filter
        if (options.filter) {
          const regex = new RegExp(options.filter, 'i');
          const lines = content.split('\n');
          content = lines.filter(line => regex.test(line)).join('\n');
        }
        
        // Clean ANSI if needed (unless raw mode)
        if (!options.raw) {
          content = stripAnsi(content);
        }
        
        if (content.trim()) {
          process.stdout.write(content);
        }
        
        lastSize = stats.size;
      }
    } catch (e) {
      // Ignore errors (file might be rotating)
    }
  }, 100);
  
  // Handle Ctrl+C
  process.on('SIGINT', () => {
    clearInterval(checkInterval);
    console.log('\n\nStopped following logs.');
    process.exit(0);
  });
}

/**
 * Display logs summary for all lanes
 */
function displaySummary(runDir: string): void {
  const lanes = listLanes(runDir);
  
  console.log(`\n${logger.COLORS.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${logger.COLORS.reset}`);
  console.log(`${logger.COLORS.cyan}  📋 Logs Summary - ${path.basename(runDir)}${logger.COLORS.reset}`);
  console.log(`${logger.COLORS.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${logger.COLORS.reset}\n`);
  
  if (lanes.length === 0) {
    console.log('  No lanes found.');
    return;
  }
  
  for (const lane of lanes) {
    const laneDir = path.join(runDir, 'lanes', lane);
    const cleanLog = path.join(laneDir, 'terminal.log');
    const rawLog = path.join(laneDir, 'terminal-raw.log');
    const jsonLog = path.join(laneDir, 'terminal.jsonl');
    const readableLog = path.join(laneDir, 'terminal-readable.log');
    
    console.log(`  ${logger.COLORS.green}📁 ${lane}${logger.COLORS.reset}`);
    
    if (fs.existsSync(cleanLog)) {
      const stats = fs.statSync(cleanLog);
      console.log(`     └─ terminal.log          ${formatSize(stats.size)}`);
    }
    
    if (fs.existsSync(rawLog)) {
      const stats = fs.statSync(rawLog);
      console.log(`     └─ terminal-raw.log      ${formatSize(stats.size)}`);
    }
    
    if (fs.existsSync(readableLog)) {
      const stats = fs.statSync(readableLog);
      console.log(`     └─ terminal-readable.log ${formatSize(stats.size)} ${logger.COLORS.yellow}(parsed AI output)${logger.COLORS.reset}`);
    }
    
    if (fs.existsSync(jsonLog)) {
      const stats = fs.statSync(jsonLog);
      const entries = readJsonLog(jsonLog);
      const errors = entries.filter(e => e.level === 'error' || e.level === 'stderr').length;
      console.log(`     └─ terminal.jsonl        ${formatSize(stats.size)} (${entries.length} entries, ${errors} errors)`);
    }
    
    console.log('');
  }
}

/**
 * Format file size
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Main logs command
 */
async function logs(args: string[]): Promise<void> {
  const options = parseArgs(args);
  
  if (options.help) {
    printHelp();
    return;
  }
  
  const config = loadConfig();
  
  // Find run directory
  let runDir = options.runDir;
  if (!runDir || runDir === 'latest') {
    runDir = findLatestRunDir(config.logsDir) || undefined;
    if (!runDir) {
      throw new Error('No run directories found');
    }
  }
  
  if (!fs.existsSync(runDir)) {
    throw new Error(`Run directory not found: ${runDir}`);
  }
  
  // Handle --all option (view all lanes merged)
  if (options.all) {
    // Handle follow mode for all lanes
    if (options.follow) {
      followAllLogs(runDir, options);
      return;
    }
    
    // Handle export for all lanes
    if (options.output) {
      exportMergedLogs(runDir, options.format, options.output);
      console.log(`Exported merged logs to: ${options.output}`);
      return;
    }
    
    // Display merged logs
    if (options.format === 'json') {
      const entries = readAllLaneLogs(runDir);
      console.log(JSON.stringify(entries, null, 2));
    } else if (options.format === 'markdown' || options.format === 'html') {
      const content = exportMergedLogs(runDir, options.format);
      console.log(content);
    } else {
      displayMergedLogs(runDir, options);
    }
    return;
  }
  
  // If no lane specified, show summary
  if (!options.lane) {
    displaySummary(runDir);
    console.log(`${logger.COLORS.gray}Use --lane <name> to view logs (default: readable), --clean for terminal logs, or --all to view all lanes merged${logger.COLORS.reset}`);
    return;
  }
  
  // Find lane directory
  const laneDir = path.join(runDir, 'lanes', options.lane);
  if (!fs.existsSync(laneDir)) {
    const lanes = listLanes(runDir);
    throw new Error(`Lane not found: ${options.lane}\nAvailable lanes: ${lanes.join(', ')}`);
  }
  
  // Handle follow mode
  if (options.follow) {
    followLogs(laneDir, options);
    return;
  }
  
  // Handle export
  if (options.output) {
    const content = exportLogs(laneDir, options.format, options.output);
    console.log(`Exported logs to: ${options.output}`);
    return;
  }
  
  // Display logs
  if (options.format === 'json' || options.level) {
    displayJsonLogs(laneDir, options);
  } else if (options.format === 'markdown' || options.format === 'html') {
    const content = exportLogs(laneDir, options.format);
    console.log(content);
  } else {
    displayTextLogs(laneDir, options);
  }
}

export = logs;


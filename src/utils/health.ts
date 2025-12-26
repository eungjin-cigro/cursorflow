/**
 * Health check system for CursorFlow
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { safeJoin } from './path';
import * as git from './git';
import { cleanStaleLocks, getLockDir, getLockStatus } from './lock';
import { checkCursorAgentInstalled, checkCursorAuth } from './cursor-agent';
import * as logger from './logger';

export interface HealthCheckResult {
  name: string;
  ok: boolean;
  message: string;
  details?: Record<string, any>;
  latencyMs?: number;
}

export interface SystemHealth {
  healthy: boolean;
  timestamp: number;
  checks: HealthCheckResult[];
  summary: {
    passed: number;
    failed: number;
    warnings: number;
  };
}

export interface PreflightResult {
  canProceed: boolean;
  blockers: string[];
  warnings: string[];
  recommendations: string[];
}

/**
 * Check if cursor-agent is installed and responsive
 */
export async function checkAgentHealth(): Promise<HealthCheckResult> {
  const start = Date.now();

  if (!checkCursorAgentInstalled()) {
    return {
      name: 'cursor-agent',
      ok: false,
      message: 'cursor-agent CLI is not installed',
      latencyMs: Date.now() - start,
    };
  }

  try {
    const result = spawnSync('cursor-agent', ['--version'], {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 5000,
    });

    if (result.status === 0) {
      const version = result.stdout.trim();
      return {
        name: 'cursor-agent',
        ok: true,
        message: `cursor-agent installed (${version})`,
        details: { version },
        latencyMs: Date.now() - start,
      };
    } else {
      return {
        name: 'cursor-agent',
        ok: false,
        message: `cursor-agent error: ${result.stderr}`,
        latencyMs: Date.now() - start,
      };
    }
  } catch (error: any) {
    return {
      name: 'cursor-agent',
      ok: false,
      message: `cursor-agent check failed: ${error.message}`,
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * Check cursor authentication status
 */
export async function checkAuthHealth(): Promise<HealthCheckResult> {
  const start = Date.now();

  try {
    const authStatus = checkCursorAuth();

    return {
      name: 'cursor-auth',
      ok: authStatus.authenticated,
      message: authStatus.message,
      details: authStatus.details ? { details: authStatus.details } : undefined,
      latencyMs: Date.now() - start,
    };
  } catch (error: any) {
    return {
      name: 'cursor-auth',
      ok: false,
      message: `Auth check failed: ${error.message}`,
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * Check Git repository status
 */
export async function checkGitHealth(cwd?: string): Promise<HealthCheckResult> {
  const start = Date.now();

  try {
    if (!git.isGitRepo(cwd)) {
      return {
        name: 'git-repo',
        ok: false,
        message: 'Not a Git repository',
        latencyMs: Date.now() - start,
      };
    }

    const branch = git.getCurrentBranch(cwd);
    const hasRemote = git.remoteExists('origin', { cwd });

    return {
      name: 'git-repo',
      ok: true,
      message: `Git repository OK (branch: ${branch})`,
      details: {
        branch,
        hasRemote,
      },
      latencyMs: Date.now() - start,
    };
  } catch (error: any) {
    return {
      name: 'git-repo',
      ok: false,
      message: `Git check failed: ${error.message}`,
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * Check Git remote connectivity
 */
export async function checkGitRemoteHealth(cwd?: string): Promise<HealthCheckResult> {
  const start = Date.now();

  try {
    if (!git.remoteExists('origin', { cwd })) {
      return {
        name: 'git-remote',
        ok: true, // Not an error, just not configured
        message: 'No remote "origin" configured',
        latencyMs: Date.now() - start,
      };
    }

    // Try to fetch with timeout
    const result = spawnSync('git', ['ls-remote', '--exit-code', 'origin', 'HEAD'], {
      cwd: cwd || process.cwd(),
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 10000,
    });

    if (result.status === 0) {
      return {
        name: 'git-remote',
        ok: true,
        message: 'Git remote is reachable',
        latencyMs: Date.now() - start,
      };
    } else {
      return {
        name: 'git-remote',
        ok: false,
        message: `Git remote unreachable: ${result.stderr}`,
        latencyMs: Date.now() - start,
      };
    }
  } catch (error: any) {
    return {
      name: 'git-remote',
      ok: false,
      message: `Git remote check failed: ${error.message}`,
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * Check available disk space
 */
export async function checkDiskSpace(minMb: number = 500): Promise<HealthCheckResult> {
  const start = Date.now();

  try {
    const cwd = process.cwd();

    // Use df command to check disk space
    const result = spawnSync('df', ['-m', cwd], {
      encoding: 'utf8',
      stdio: 'pipe',
    });

    if (result.status === 0) {
      const lines = result.stdout.trim().split('\n');
      if (lines.length >= 2) {
        const parts = lines[1]!.split(/\s+/);
        const availableMb = parseInt(parts[3] || '0');

        return {
          name: 'disk-space',
          ok: availableMb >= minMb,
          message: availableMb >= minMb
            ? `${availableMb} MB available`
            : `Low disk space: ${availableMb} MB (minimum: ${minMb} MB)`,
          details: { availableMb, minMb },
          latencyMs: Date.now() - start,
        };
      }
    }

    // Fallback: assume OK if we can't check
    return {
      name: 'disk-space',
      ok: true,
      message: 'Could not determine disk space (assuming OK)',
      latencyMs: Date.now() - start,
    };
  } catch (error: any) {
    return {
      name: 'disk-space',
      ok: true, // Don't block on disk check failures
      message: `Disk check skipped: ${error.message}`,
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * Check for stale lock files
 */
export async function checkLockFiles(basePath?: string): Promise<HealthCheckResult> {
  const start = Date.now();

  try {
    const lockDir = getLockDir(basePath || process.cwd());
    
    if (!fs.existsSync(lockDir)) {
      return {
        name: 'lock-files',
        ok: true,
        message: 'No lock directory (OK)',
        latencyMs: Date.now() - start,
      };
    }

    const status = getLockStatus(lockDir);
    const staleCount = status.filter(s => s.stale).length;
    const activeCount = status.filter(s => !s.stale).length;

    if (staleCount > 0) {
      return {
        name: 'lock-files',
        ok: false,
        message: `${staleCount} stale lock(s) found`,
        details: { staleCount, activeCount, locks: status },
        latencyMs: Date.now() - start,
      };
    }

    return {
      name: 'lock-files',
      ok: true,
      message: activeCount > 0 ? `${activeCount} active lock(s)` : 'No locks',
      details: { activeCount },
      latencyMs: Date.now() - start,
    };
  } catch (error: any) {
    return {
      name: 'lock-files',
      ok: true, // Don't block on lock check failures
      message: `Lock check skipped: ${error.message}`,
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * Check system resources (CPU, memory)
 */
export async function checkSystemResources(): Promise<HealthCheckResult> {
  const start = Date.now();

  try {
    const totalMem = os.totalmem() / (1024 * 1024 * 1024); // GB
    const freeMem = os.freemem() / (1024 * 1024 * 1024); // GB
    const usedPercent = ((totalMem - freeMem) / totalMem) * 100;
    const cpuCount = os.cpus().length;
    const loadAvg = os.loadavg()[0]!; // 1-minute average

    const memoryOk = freeMem > 1; // At least 1GB free
    const cpuOk = loadAvg < cpuCount * 2; // Load less than 2x CPU count

    return {
      name: 'system-resources',
      ok: memoryOk && cpuOk,
      message: memoryOk && cpuOk
        ? 'System resources OK'
        : `System under load (Memory: ${usedPercent.toFixed(0)}%, Load: ${loadAvg.toFixed(1)})`,
      details: {
        totalMemoryGb: totalMem.toFixed(1),
        freeMemoryGb: freeMem.toFixed(1),
        memoryUsedPercent: usedPercent.toFixed(1),
        cpuCount,
        loadAverage: loadAvg.toFixed(2),
      },
      latencyMs: Date.now() - start,
    };
  } catch (error: any) {
    return {
      name: 'system-resources',
      ok: true, // Don't block on resource check failures
      message: `Resource check skipped: ${error.message}`,
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * Check worktrees status
 */
export async function checkWorktrees(cwd?: string): Promise<HealthCheckResult> {
  const start = Date.now();

  try {
    const worktrees = git.listWorktrees(cwd);
    const orphaned: string[] = [];

    for (const wt of worktrees) {
      if (wt.path && !fs.existsSync(wt.path)) {
        orphaned.push(wt.path);
      }
    }

    if (orphaned.length > 0) {
      return {
        name: 'worktrees',
        ok: false,
        message: `${orphaned.length} orphaned worktree(s) found`,
        details: { total: worktrees.length, orphaned },
        latencyMs: Date.now() - start,
      };
    }

    return {
      name: 'worktrees',
      ok: true,
      message: `${worktrees.length} worktree(s) OK`,
      details: { count: worktrees.length },
      latencyMs: Date.now() - start,
    };
  } catch (error: any) {
    return {
      name: 'worktrees',
      ok: true, // Don't block on worktree check failures
      message: `Worktree check skipped: ${error.message}`,
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * Run all health checks
 */
export async function runHealthCheck(options: {
  cwd?: string;
  skipRemote?: boolean;
  skipAuth?: boolean;
} = {}): Promise<SystemHealth> {
  const checks: HealthCheckResult[] = [];

  // Run checks in parallel where possible
  const [agentHealth, gitHealth, diskSpace, lockFiles, sysResources, worktrees] = await Promise.all([
    checkAgentHealth(),
    checkGitHealth(options.cwd),
    checkDiskSpace(),
    checkLockFiles(options.cwd),
    checkSystemResources(),
    checkWorktrees(options.cwd),
  ]);

  checks.push(agentHealth, gitHealth, diskSpace, lockFiles, sysResources, worktrees);

  // Remote checks (might be slow, so optional)
  if (!options.skipRemote) {
    checks.push(await checkGitRemoteHealth(options.cwd));
  }

  // Auth check (requires network, so optional)
  if (!options.skipAuth) {
    checks.push(await checkAuthHealth());
  }

  const passed = checks.filter(c => c.ok).length;
  const failed = checks.filter(c => !c.ok).length;

  return {
    healthy: failed === 0,
    timestamp: Date.now(),
    checks,
    summary: {
      passed,
      failed,
      warnings: 0, // Could be extended to include warnings
    },
  };
}

/**
 * Run preflight checks before starting orchestration
 */
export async function preflightCheck(options: {
  cwd?: string;
  requireRemote?: boolean;
  requireAuth?: boolean;
} = {}): Promise<PreflightResult> {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const recommendations: string[] = [];

  // Check cursor-agent
  const agentHealth = await checkAgentHealth();
  if (!agentHealth.ok) {
    blockers.push(`cursor-agent: ${agentHealth.message}`);
  }

  // Check Git repository
  const gitHealth = await checkGitHealth(options.cwd);
  if (!gitHealth.ok) {
    blockers.push(`Git: ${gitHealth.message}`);
  }

  // Check Git remote (warning only unless required)
  const remoteHealth = await checkGitRemoteHealth(options.cwd);
  if (!remoteHealth.ok) {
    if (options.requireRemote) {
      blockers.push(`Git remote: ${remoteHealth.message}`);
    } else {
      warnings.push(`Git remote: ${remoteHealth.message}`);
    }
  }

  // Check worktrees
  const worktreeHealth = await checkWorktrees(options.cwd);
  if (!worktreeHealth.ok) {
    warnings.push(`Worktrees: ${worktreeHealth.message}`);
    recommendations.push('Run `cursorflow clean worktrees` to clean up orphaned worktrees');
  }

  // Check authentication
  if (options.requireAuth !== false) {
    const authHealth = await checkAuthHealth();
    if (!authHealth.ok) {
      blockers.push(`Authentication: ${authHealth.message}`);
    }
  }

  // Check disk space
  const diskHealth = await checkDiskSpace();
  if (!diskHealth.ok) {
    warnings.push(`Disk space: ${diskHealth.message}`);
  }

  // Check for stale locks
  const lockHealth = await checkLockFiles(options.cwd);
  if (!lockHealth.ok) {
    warnings.push(`Locks: ${lockHealth.message}`);
    recommendations.push('Run `cursorflow clean locks` to remove stale locks');
  }

  // Check system resources
  const resourceHealth = await checkSystemResources();
  if (!resourceHealth.ok) {
    warnings.push(`Resources: ${resourceHealth.message}`);
  }

  return {
    canProceed: blockers.length === 0,
    blockers,
    warnings,
    recommendations,
  };
}

/**
 * Print health check results to console
 */
export function printHealthReport(health: SystemHealth): void {
  logger.section('🏥 System Health Check');
  
  for (const check of health.checks) {
    const icon = check.ok ? '✅' : '❌';
    const latency = check.latencyMs ? ` (${check.latencyMs}ms)` : '';
    console.log(`${icon} ${check.name}: ${check.message}${latency}`);
  }

  console.log('');
  console.log(`Summary: ${health.summary.passed} passed, ${health.summary.failed} failed`);
  console.log(`Overall: ${health.healthy ? '✅ Healthy' : '❌ Unhealthy'}`);
}

/**
 * Print preflight check results to console
 */
export function printPreflightReport(result: PreflightResult): void {
  logger.section('🚀 Preflight Check');

  if (result.blockers.length > 0) {
    console.log('❌ Blockers:');
    for (const blocker of result.blockers) {
      console.log(`   • ${blocker}`);
    }
    console.log('');
  }

  if (result.warnings.length > 0) {
    console.log('⚠️  Warnings:');
    for (const warning of result.warnings) {
      console.log(`   • ${warning}`);
    }
    console.log('');
  }

  if (result.recommendations.length > 0) {
    console.log('💡 Recommendations:');
    for (const rec of result.recommendations) {
      console.log(`   • ${rec}`);
    }
    console.log('');
  }

  if (result.canProceed) {
    logger.success('Preflight check passed!');
  } else {
    logger.error('Preflight check failed. Please fix the blockers above.');
  }
}

/**
 * Auto-repair common issues found during health check
 */
export async function autoRepair(options: { cwd?: string } = {}): Promise<{ repaired: string[]; failed: string[] }> {
  const repaired: string[] = [];
  const failed: string[] = [];

  // Clean stale locks
  try {
    const lockDir = getLockDir(options.cwd || process.cwd());
    if (fs.existsSync(lockDir)) {
      const cleaned = cleanStaleLocks(lockDir);
      if (cleaned > 0) {
        repaired.push(`Cleaned ${cleaned} stale lock(s)`);
      }
    }
  } catch (e: any) {
    failed.push(`Lock cleanup failed: ${e.message}`);
  }

  // Prune orphaned worktrees
  try {
    const result = git.runGitResult(['worktree', 'prune'], { cwd: options.cwd });
    if (result.success) {
      repaired.push('Pruned orphaned worktrees');
    }
  } catch (e: any) {
    failed.push(`Worktree prune failed: ${e.message}`);
  }

  return { repaired, failed };
}


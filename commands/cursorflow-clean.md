# CursorFlow Clean

## Overview
Clean up branches, worktrees, and logs. Remove stale files or remnants from failed runs.

## Steps

1. **Choose what to clean**

   | Type | Description |
   |------|------|
   | `branches` | Clean Git branches |
   | `worktrees` | Clean Git worktrees |
   | `logs` | Clean log files |
   | `all` | Clean everything |

2. **Clean branches**
   ```bash
   cursorflow clean branches --pattern "feature/my-*"
   ```

3. **Clean worktrees**
   ```bash
   cursorflow clean worktrees --all
   ```

4. **Clean logs**
   ```bash
   cursorflow clean logs --older-than 30
   ```

5. **Verify with a dry run**
   ```bash
   cursorflow clean all --dry-run
   ```

## Options

| Option | Description |
|------|------|
| `--pattern <pattern>` | Pattern match (e.g., "feature/*") |
| `--older-than <days>` | Items older than N days (for logs) |
| `--dry-run` | Show items to delete without removing |
| `--force` | Delete without confirmation |
| `--local-only` | Local only (branches) |
| `--remote-only` | Remote only (branches) |

## Examples

### Branch cleanup

#### Delete by pattern
```bash
cursorflow clean branches --pattern "feature/dashboard-*"
```

#### All CursorFlow branches
```bash
cursorflow clean branches --pattern "feature/*" --dry-run
```

#### Local branches only
```bash
cursorflow clean branches --pattern "feature/*" --local-only
```

### Worktree cleanup

#### All worktrees
```bash
cursorflow clean worktrees --all
```

#### Specific pattern
```bash
cursorflow clean worktrees --pattern "*-dashboard-*"
```

### Log cleanup

#### Logs older than 30 days
```bash
cursorflow clean logs --older-than 30
```

#### All logs
```bash
cursorflow clean logs --all --force
```

### Full cleanup

#### Review then delete
```bash
cursorflow clean all --dry-run
cursorflow clean all --force
```

## Sample output

```
🧹 Cleaning CursorFlow Resources
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Branches to delete:
  - feature/dashboard-pipeline-abc123 (local)
  - feature/dashboard-pipeline-abc123 (remote)
  - feature/client-pipeline-def456 (local)

Worktrees to remove:
  - .cursorflow/logs/worktrees/01-dashboard-pipeline-abc123
  - .cursorflow/logs/worktrees/02-client-pipeline-def456

Logs to delete:
  - _cursorflow/logs/runs/01-dashboard-2025-12-10T10-00-00 (9 days old)

Total: 5 branches, 2 worktrees, 1 log directory

Proceed? [y/N]
```

## Notes

1. **Back up**: Save important branches before deleting.
2. **Confirm**: Start with `--dry-run` to review changes.
3. **Remote caution**: Be careful when deleting remote branches.
4. **Irreversible**: Deleted items are hard to recover.

## Checklist
- [ ] Have you reviewed items to clean?
- [ ] Do you need backups?
- [ ] Did you run a dry run first?
- [ ] Are other teammates using these branches?
- [ ] Do you also need to delete from the remote?

## Troubleshooting

### Branch deletion failed
```bash
# Force delete
git branch -D <branch-name>
git push origin --delete <branch-name>
```

### Worktree removal failed
```bash
# Force remove
git worktree remove --force <worktree-path>
```

### Log directory permission issues
```bash
# Check permissions
ls -la _cursorflow/logs/
# Fix permissions
chmod -R u+w _cursorflow/logs/
```

## Next steps
1. Clean logs regularly (e.g., monthly).
2. Add an automated cleanup script to CI/CD.
3. Add log directories to `.gitignore`.

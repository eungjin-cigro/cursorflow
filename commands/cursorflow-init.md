# CursorFlow Init

## Overview
Initialize CursorFlow in your project. Create the config file and directory structure, and optionally install Cursor commands and example tasks.

## Steps

1. **Run initialization**
   ```bash
   cursorflow init
   ```

2. **Choose options**
   - `--example`: create example tasks
   - `--config-only`: create only the config file
   - `--no-commands`: skip installing Cursor commands
   - `--force`: overwrite existing files

3. **Verify created files**
   - `cursorflow.config.js` created
   - `_cursorflow/tasks/` directory created
   - `_cursorflow/logs/` directory created
   - `.cursor/commands/cursorflow/` commands installed (optional)

4. **Review the config file**
   ```javascript
   // cursorflow.config.js
   module.exports = {
     tasksDir: '_cursorflow/tasks',
     logsDir: '_cursorflow/logs',
     baseBranch: 'main',
     // ... other settings
   };
   ```

## Examples

### Basic initialization
```bash
cursorflow init
```

### Include example tasks
```bash
cursorflow init --example
```

### Generate only the config
```bash
cursorflow init --config-only
```

### Overwrite existing files
```bash
cursorflow init --force
```

## Checklist
- [ ] Was the config file created at the project root?
- [ ] Were the required directories created?
- [ ] Were Cursor commands installed?
- [ ] Is the configuration adjusted for the project?

## Next steps
1. Update `cursorflow.config.js` for your project.
2. In Cursor IDE, type `/` to confirm the commands are available.
3. Start generating tasks with `cursorflow prepare MyFeature`.

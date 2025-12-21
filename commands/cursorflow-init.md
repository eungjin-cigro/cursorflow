# CursorFlow Init

## Overview
Initialize CursorFlow in your project. This command creates the default configuration file, sets up the required directory structure, and prepares the environment for parallel AI orchestration.

## Usage

```bash
cursorflow init [options]
```

## Options

| Option | Description |
|------|------|
| `--example` | Create an example task to help you get started |
| `--config-only` | Only create the `cursorflow.config.js` file |
| `--no-commands` | Skip installing Cursor IDE custom commands |
| `--no-gitignore` | Skip adding `_cursorflow/` to your `.gitignore` |
| `--force` | Overwrite existing configuration or directories |

## What's Created?

1. **`cursorflow.config.js`**: Central configuration for the project.
2. **`_cursorflow/tasks/`**: Directory where you define your task JSON files.
3. **`_cursorflow/logs/`**: Directory for run logs and terminal outputs.
4. **`.cursor/commands/cursorflow/`**: (Optional) Integrated Cursor IDE commands.
5. **`.gitignore` update**: Adds `_cursorflow/` to prevent committing logs.

## Example

```bash
# Standard initialization with an example task
cursorflow init --example

# Minimal initialization
cursorflow init --no-commands --no-gitignore
```

## Next Steps

1. **Configure**: Review `cursorflow.config.js` and adjust settings like `baseBranch` or `maxConcurrentLanes`.
2. **Explore**: If you used `--example`, run it with:
   ```bash
   cursorflow run _cursorflow/tasks/example/
   ```
3. **Create**: Start your own feature tasks with:
   ```bash
   cursorflow prepare MyFeature
   ```

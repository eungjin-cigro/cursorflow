#!/usr/bin/env node
/**
 * Post-install script
 * 
 * Shows a message after package installation
 */

console.log(`
📦 CursorFlow installed successfully!

To get started:

  1. Initialize CursorFlow in your project:
     npx cursorflow init

  2. Install Cursor commands:
     npx cursorflow-setup

  3. Start using CursorFlow:
     cursorflow run _cursorflow/tasks/example/

Documentation:
  https://github.com/eungjin-cigro/cursorflow#readme

Need help?
  cursorflow --help
`);

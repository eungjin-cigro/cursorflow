/**
 * Template loading utilities for CursorFlow
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import * as logger from './logger';
import { safeJoin } from './path';
import { findProjectRoot } from './config';

/**
 * Fetch remote template from URL
 */
export async function fetchRemoteTemplate(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    protocol.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to fetch template from ${url}: Status ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse template JSON from ${url}: ${e}`));
        }
      });
    }).on('error', (err) => {
      reject(new Error(`Network error while fetching template from ${url}: ${err.message}`));
    });
  });
}

/**
 * Resolve template from various sources:
 * 1. URL (starts with http:// or https://)
 * 2. Built-in template (name without .json)
 * 3. Local file path
 */
export async function resolveTemplate(templatePath: string): Promise<any> {
  // 1. Remote URL
  if (templatePath.startsWith('http://') || templatePath.startsWith('https://')) {
    logger.info(`Fetching remote template: ${templatePath}`);
    return fetchRemoteTemplate(templatePath);
  }

  // 2. Built-in template
  // Search in templates/ directory of the project root
  try {
    const projectRoot = findProjectRoot();
    const builtInPath = safeJoin(projectRoot, 'templates', templatePath.endsWith('.json') ? templatePath : `${templatePath}.json`);
    if (fs.existsSync(builtInPath)) {
      logger.info(`Using built-in template: ${templatePath}`);
      return JSON.parse(fs.readFileSync(builtInPath, 'utf8'));
    }
  } catch (e) {
    // Ignore error if project root not found, try other methods
  }

  // Fallback for built-in templates relative to the module (for installed package)
  const modulePath = path.resolve(__dirname, '../../templates', templatePath.endsWith('.json') ? templatePath : `${templatePath}.json`);
  if (fs.existsSync(modulePath)) {
    logger.info(`Using module template: ${templatePath}`);
    return JSON.parse(fs.readFileSync(modulePath, 'utf8'));
  }

  // 3. Local file path
  const localPath = path.resolve(process.cwd(), templatePath);
  if (fs.existsSync(localPath)) {
    logger.info(`Using local template: ${templatePath}`);
    try {
      return JSON.parse(fs.readFileSync(localPath, 'utf8'));
    } catch (e) {
      throw new Error(`Failed to parse local template ${templatePath}: ${e}`);
    }
  }

  throw new Error(`Template not found: ${templatePath}. It must be a URL, a built-in template name, or a local file path.`);
}


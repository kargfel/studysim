// Lädt die Phaser-freien Kerndateien (klassische Skripte) in Node.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const CORE_FILES = [
  'src/config.js',
  'src/core/state.js',
  'src/core/physics.js',
  'src/core/level.js'
];

export function loadScripts(files) {
  for (const file of files) {
    const code = fs.readFileSync(path.join(root, file), 'utf8');
    vm.runInThisContext(code, { filename: file });
  }
  return globalThis.SS;
}

export function loadCore(extra = []) {
  return loadScripts([...CORE_FILES, ...extra]);
}

#!/usr/bin/env node
// Packt das Spiel für die Moodle-Abgabe nach dist/Spiel.zip (ohne node_modules und Test-Screenshots).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { root } from './_load.mjs';

const out = path.join(root, 'dist', 'Spiel.zip');
fs.mkdirSync(path.dirname(out), { recursive: true });
if (fs.existsSync(out)) fs.rmSync(out);

const include = ['index.html', 'favicon.svg', 'og-image.png', 'css', 'src', 'vendor', 'docs', 'tests', 'deploy', 'screenshots',
  'Dockerfile', 'compose.yaml', '.dockerignore', 'package.json', 'README.md', 'PROMPT.md']
  .filter((p) => fs.existsSync(path.join(root, p)));

execFileSync('zip', ['-r', '-q', out, ...include, '-x', 'screenshots/_tmp/*', '*.DS_Store'], { cwd: root, stdio: 'inherit' });
const kb = Math.round(fs.statSync(out).size / 1024);
console.log(`dist/Spiel.zip erstellt (${kb} KB)`);

#!/usr/bin/env node
/*
 * hosting.mjs – testet den Webserver aus deploy/server.mjs so, wie er auf dem Homeserver läuft.
 *
 *  1. HTTP: Statuscodes, Sicherheits-Header, Caching, gzip, ETag/304, HEAD, 405
 *  2. Sicherheit: nur Spiel-Dateien erreichbar (kein .git, tests/, docs/, kein Path Traversal)
 *  3. Browser über http://: Spiel startet ohne CSP-Verstöße und ohne Anfragen an fremde Server,
 *     der Runner erreicht den ersten Checkpoint (Side Quest öffnet sich)
 *
 * Aufruf: node tests/hosting.mjs   (startet den Server selbst auf einem freien Port)
 */
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { startServer } from '../deploy/server.mjs';
import { findChrome } from './run-scene.mjs';
import { root } from './_load.mjs';

const failures = [];
let passed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed++;
  } else {
    failures.push(name);
    console.error(`✘ ${name}${detail ? ` – ${detail}` : ''}`);
  }
}

/** Rohe HTTP-Anfrage: Pfad wird unverändert gesendet (fetch würde ../ normalisieren). */
function request(port, rawPath, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

const { port, close } = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
const base = `http://127.0.0.1:${port}`;
console.log(`Server läuft auf ${base}`);

try {
  // ── 1. HTTP-Grundlagen ──────────────────────────────────────────
  const index = await request(port, '/');
  const html = index.body.toString('utf8');
  check('GET / → 200', index.status === 200, `Status ${index.status}`);
  check('GET / ist HTML', /text\/html/.test(index.headers['content-type'] || ''));
  check('index.html: Skripte versioniert (?v=)', /src="src\/config\.js\?v=[0-9a-f]{10}"/.test(html) && /src="src\/phaser-loader\.js\?v=/.test(html));
  check('index.html: CSS versioniert (?v=)', /href="css\/style\.css\?v=/.test(html));
  check('index.html: Favicon nicht versioniert (kein Ordner-Präfix)', /href="favicon\.svg"/.test(html));
  check('CSP gesetzt', /script-src 'self'/.test(index.headers['content-security-policy'] || ''));
  check('nosniff gesetzt', index.headers['x-content-type-options'] === 'nosniff');
  check('Framing verboten', index.headers['x-frame-options'] === 'DENY');
  check('index.html: Cache-Control no-cache', index.headers['cache-control'] === 'no-cache');
  check('HSTS gesetzt', /max-age=\d+/.test(index.headers['strict-transport-security'] || ''));

  const again = await request(port, '/', { headers: { 'If-None-Match': index.headers.etag } });
  check('ETag → 304', again.status === 304, `Status ${again.status}`);

  const head = await request(port, '/', { method: 'HEAD' });
  check('HEAD / → 200 ohne Body', head.status === 200 && head.body.length === 0);

  const post = await request(port, '/', { method: 'POST' });
  check('POST → 405 mit Allow', post.status === 405 && /GET/.test(post.headers.allow || ''));

  const health = await request(port, '/healthz');
  check('/healthz → ok', health.status === 200 && health.body.toString() === 'ok');

  const js = await request(port, '/src/config.js');
  check('JS mit richtigem MIME-Typ', /text\/javascript/.test(js.headers['content-type'] || ''));
  check('unversioniertes JS: kurzer Cache', js.headers['cache-control'] === 'public, max-age=300');
  const buildId = (html.match(/config\.js\?v=([0-9a-f]{10})/) || [])[1];
  const jsV = await request(port, `/src/config.js?v=${buildId}`);
  check('JS mit aktueller Build-ID: immutable', /immutable/.test(jsV.headers['cache-control'] || ''));
  const jsWrong = await request(port, '/src/config.js?v=0123456789');
  check('JS mit fremder/künftiger ID: no-store (kein Cache-Poisoning)', jsWrong.headers['cache-control'] === 'no-store', jsWrong.headers['cache-control']);

  const phaserPlain = await request(port, '/vendor/phaser.min.js');
  const phaserGzip = await request(port, '/vendor/phaser.min.js', { headers: { 'Accept-Encoding': 'gzip, br' } });
  check('Phaser wird gzip-komprimiert', phaserGzip.headers['content-encoding'] === 'gzip' && phaserGzip.body.length < phaserPlain.body.length / 2,
    `${phaserGzip.body.length} vs. ${phaserPlain.body.length} Bytes`);
  check('Vary: Accept-Encoding', /Accept-Encoding/.test(phaserGzip.headers.vary || ''));

  // Viele parallele Anfragen dürfen den Speicher nicht volllaufen lassen (Datei-Cache statt readFile je Anfrage)
  global.gc?.();
  const rssBefore = process.memoryUsage().rss;
  const burst = await Promise.all(Array.from({ length: 500 }, (_, i) =>
    request(port, `/vendor/phaser.min.js?r=${i}`, { method: 'HEAD', headers: { 'Accept-Encoding': 'gzip' } })));
  const rssGrowthMb = (process.memoryUsage().rss - rssBefore) / 1024 / 1024;
  check('500 parallele Anfragen: alle 200', burst.every((r) => r.status === 200));
  check('500 parallele Anfragen: Speicher wächst kaum', rssGrowthMb < 150, `+${rssGrowthMb.toFixed(0)} MB`);

  // ── 2. Nur Spiel-Dateien sind öffentlich ────────────────────────
  const notFound = [
    '/.git/HEAD', '/.git/config', '/.gitignore', '/.dockerignore', '/tests/smoke.mjs', '/docs/HOSTING.md',
    '/package.json', '/README.md', '/PROMPT.md', '/deploy/server.mjs', '/Dockerfile', '/compose.yaml',
    '/screenshots/01-menu.png', '/node_modules/playwright-core/package.json',
    '/src', '/src/', '/src/core/', '/vendor/',
    '/../package.json', '/src/../package.json', '/src/%2e%2e/package.json', '/%2e%2e/%2e%2e/etc/passwd',
    '/src/..%2f..%2fpackage.json', '/src/.hidden', '/src/core/../../tests/smoke.mjs', '//etc/passwd'
  ];
  for (const p of notFound) {
    const r = await request(port, p);
    check(`${p} → 404`, r.status === 404, `Status ${r.status}`);
  }
  for (const p of ['/%E0%A4%A', '/src/%00.js', '/src/..%5c..%5cpackage.json']) {
    const r = await request(port, p);
    check(`${p} → 400`, r.status === 400, `Status ${r.status}`);
  }

  // Symlinks im öffentlichen Baum werden abgelehnt (Test in einer Kopie, das Projekt bleibt unberührt)
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studysim-symlink-'));
  try {
    fs.mkdirSync(path.join(tmpRoot, 'deploy'));
    fs.mkdirSync(path.join(tmpRoot, 'src'));
    fs.copyFileSync(path.join(root, 'deploy', 'server.mjs'), path.join(tmpRoot, 'deploy', 'server.mjs'));
    fs.writeFileSync(path.join(tmpRoot, 'index.html'), '<!doctype html><script src="src/ok.js"></script>');
    fs.writeFileSync(path.join(tmpRoot, 'src', 'ok.js'), '// ok');
    fs.writeFileSync(path.join(tmpRoot, 'geheim.txt'), 'API_KEY=geheim');
    fs.symlinkSync('../geheim.txt', path.join(tmpRoot, 'src', 'link.js'));
    const copy = await import(path.join(tmpRoot, 'deploy', 'server.mjs'));
    const s2 = await copy.startServer({ port: 0, host: '127.0.0.1', quiet: true });
    try {
      check('Kopie: normale Datei → 200', (await request(s2.port, '/src/ok.js')).status === 200);
      const link = await request(s2.port, '/src/link.js');
      check('Symlink im öffentlichen Baum → 404', link.status === 404, `Status ${link.status}: ${link.body.toString().slice(0, 40)}`);
    } finally {
      await s2.close();
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  // Start über einen Pfad mit Symlink (z. B. /opt/studysim → Datenplatte) und PORT-Prüfung
  const freePort = await new Promise((resolve) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => { const p = probe.address().port; probe.close(() => resolve(p)); });
  });
  const linkDir = path.join(os.tmpdir(), `studysim-link-${process.pid}`);
  fs.rmSync(linkDir, { force: true });
  fs.symlinkSync(root, linkDir);
  try {
    const started = await new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(linkDir, 'deploy', 'server.mjs')], {
        env: { ...process.env, PORT: String(freePort), HOST: '127.0.0.1' }
      });
      let out = '';
      const timer = setTimeout(() => { child.kill(); resolve(false); }, 8000);
      child.stdout.on('data', (d) => {
        out += d;
        if (out.includes('läuft auf')) { clearTimeout(timer); child.kill('SIGTERM'); resolve(true); }
      });
      child.on('exit', () => { clearTimeout(timer); resolve(out.includes('läuft auf')); });
    });
    check('Start über Symlink-Pfad funktioniert', started);
  } finally {
    fs.rmSync(linkDir, { force: true });
  }
  for (const bad of ['0', '', 'abc', '70000', '22 23']) {
    const code = await new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(root, 'deploy', 'server.mjs')], { env: { ...process.env, PORT: bad } });
      const timer = setTimeout(() => { child.kill(); resolve('läuft'); }, 5000);
      child.on('exit', (c) => { clearTimeout(timer); resolve(c); });
    });
    check(`PORT="${bad}" wird abgelehnt (Exit 1)`, code === 1, `Exit ${code}`);
  }

  // ── 3. Browser über http:// ─────────────────────────────────────
  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--use-angle=swiftshader']
  });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    const errors = [];
    const foreign = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (msg.type() === 'error' || /Content Security Policy|Refused to/.test(text)) errors.push(text);
    });
    page.on('pageerror', (err) => errors.push('Exception: ' + err.message));
    page.on('request', (req) => {
      if (!req.url().startsWith(base) && !req.url().startsWith('data:') && !req.url().startsWith('blob:')) foreign.push(req.url());
    });
    await page.addInitScript(() => {
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective}: ${e.blockedURI}`));
    });

    await page.goto(base + '/');
    await page.waitForFunction(() => window.SS && window.SS.game && window.SS.game.isBooted, null, { timeout: 15000 });
    await page.waitForFunction(() => window.SS.game.scene.isActive('MenuScene'), null, { timeout: 10000 });
    check('Browser: Menü startet über http://', true);
    check('Browser: Phaser 3.90.0 aus vendor/', await page.evaluate(() => window.Phaser.VERSION) === '3.90.0');

    await page.goto(base + '/?scene=GameScene&god=1&speed=4');
    await page.waitForFunction(() => window.SS && window.SS.game && window.SS.game.isBooted, null, { timeout: 15000 });
    let reached = false;
    try {
      await page.waitForFunction(() => window.SS.game.scene.isActive('EduroamScene'), null, { timeout: 60000 });
      reached = true;
    } catch { /* unten gemeldet */ }
    check('Browser: Runner erreicht den ersten Checkpoint (eduroam-Quest)', reached);

    const csp = await page.evaluate(() => window.__csp);
    check('Browser: keine CSP-Verstöße', csp.length === 0, csp.join(', '));
    check('Browser: keine JS-Fehler', errors.length === 0, errors.slice(0, 5).join(' | '));
    check('Browser: keine Anfragen an fremde Server', foreign.length === 0, foreign.slice(0, 5).join(', '));
  } finally {
    await browser.close();
  }
} finally {
  await close();
}

console.log(`\n${passed} bestanden, ${failures.length} fehlgeschlagen`);
process.exit(failures.length ? 1 : 0);

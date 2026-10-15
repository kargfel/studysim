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
import { chromium } from 'playwright-core';
import { startServer } from '../deploy/server.mjs';
import { findChrome } from './run-scene.mjs';

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
  const jsV = await request(port, '/src/config.js?v=abc');
  check('versioniertes JS: immutable', /immutable/.test(jsV.headers['cache-control'] || ''));

  const phaserPlain = await request(port, '/vendor/phaser.min.js');
  const phaserGzip = await request(port, '/vendor/phaser.min.js', { headers: { 'Accept-Encoding': 'gzip, br' } });
  check('Phaser wird gzip-komprimiert', phaserGzip.headers['content-encoding'] === 'gzip' && phaserGzip.body.length < phaserPlain.body.length / 2,
    `${phaserGzip.body.length} vs. ${phaserPlain.body.length} Bytes`);
  check('Vary: Accept-Encoding', /Accept-Encoding/.test(phaserGzip.headers.vary || ''));

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

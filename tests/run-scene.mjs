#!/usr/bin/env node
/*
 * run-scene.mjs – startet das Spiel headless (Chromium aus dem Playwright-Cache),
 * öffnet optional direkt eine Szene, führt Aktionen aus und macht Screenshots.
 *
 * Beispiele:
 *   node tests/run-scene.mjs                                   # Menü, Screenshot nach 1,5 s
 *   node tests/run-scene.mjs EduroamScene --out screenshots/eduroam.png
 *   node tests/run-scene.mjs GameScene --params "section=1&god=1" --wait 4000
 *   node tests/run-scene.mjs KlausurScene --actions '[{"wait":800,"type":"key","key":"Enter"},{"wait":500,"type":"click","x":400,"y":420},{"wait":300,"type":"shot","out":"screenshots/k2.png"}]'
 *
 * Aktionen (JSON-Array, nacheinander; "wait" = ms vor der Aktion):
 *   {type:"key", key:"Space"}            Taste drücken (Playwright-Namen: Enter, Space, ArrowUp, Escape, KeyA …)
 *   {type:"down"|"up", key:"Space"}      Taste halten/loslassen
 *   {type:"type", text:"123456"}         Text tippen
 *   {type:"click", x:400, y:300}         Klick in Spielkoordinaten (800×600)
 *   {type:"shot", out:"pfad.png"}        Screenshot
 *   {type:"eval", js:"SS.State.run.ects"} JS im Spiel ausführen (Ergebnis wird ausgegeben)
 *   {type:"scenes"}                      aktive Szenen ausgeben
 *
 * Optionen: --params "a=1&b=2"  --wait <ms vor Abschluss-Screenshot> --out <png>  --no-shot  --fallback (CDN blockieren)
 * Ausgabe: JSON mit errors (Konsole/Exceptions), warnings, activeScenes, results. Exit-Code 1 bei Fehlern.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { root } from './_load.mjs';

function parseArgs(argv) {
  const args = { scene: null, params: '', wait: 1500, out: null, actions: [], shot: true, fallback: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--params') args.params = argv[++i];
    else if (a === '--wait') args.wait = Number(argv[++i]);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--actions') args.actions = JSON.parse(argv[++i]);
    else if (a === '--no-shot') args.shot = false;
    else if (a === '--fallback') args.fallback = true;
    else if (!a.startsWith('--') && !args.scene) args.scene = a;
  }
  return args;
}

export function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const cache = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  const candidates = [];
  if (fs.existsSync(cache)) {
    for (const dir of fs.readdirSync(cache).sort().reverse()) {
      if (dir.startsWith('chromium_headless_shell-')) {
        candidates.push(path.join(cache, dir, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'));
        candidates.push(path.join(cache, dir, 'chrome-headless-shell-mac-x64', 'chrome-headless-shell'));
      }
      if (dir.startsWith('chromium-')) {
        candidates.push(path.join(cache, dir, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'));
        candidates.push(path.join(cache, dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'));
      }
    }
  }
  candidates.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) throw new Error('Kein Chromium gefunden. CHROME_PATH setzen.');
  return found;
}

/** Öffnet das Spiel und liefert {browser, page, errors, warnings}. */
export async function openGame({ scene = null, params = '', fallback = false } = {}) {
  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--use-angle=swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const errors = [];
  const warnings = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error') {
      // Erwarteter Fehler im Fallback-Test: das blockierte CDN
      if (fallback && text.includes('Failed to load resource')) return;
      errors.push('console.error: ' + text);
    } else if (msg.type() === 'warning' && !text.includes('GL Driver Message')) {
      warnings.push(text);
    }
  });
  page.on('pageerror', (err) => errors.push('Exception: ' + (err.stack || err.message)));
  page.on('requestfailed', (req) => {
    const url = req.url();
    if (!url.includes('cdn.jsdelivr.net')) errors.push('Request fehlgeschlagen: ' + url);
  });
  const vendor = path.join(root, 'vendor', 'phaser.min.js');
  await page.route('**/cdn.jsdelivr.net/**', (route) => {
    if (fallback) return route.abort();
    return route.fulfill({ path: vendor, contentType: 'application/javascript' });
  });
  const query = new URLSearchParams(params);
  if (scene) query.set('scene', scene);
  const url = pathToFileURL(path.join(root, 'index.html')).href + (query.toString() ? '?' + query.toString() : '');
  await page.goto(url);
  await page.waitForFunction(() => window.SS && window.SS.game && window.SS.game.isBooted, null, { timeout: 15000 });
  return { browser, page, errors, warnings };
}

export async function activeScenes(page) {
  return page.evaluate(() => window.SS.game.scene.getScenes(true).map((s) => s.scene.key));
}

export async function runActions(page, actions, results) {
  for (const act of actions) {
    if (act.wait) await page.waitForTimeout(act.wait);
    switch (act.type) {
      case 'key': await page.keyboard.press(act.key); break;
      case 'down': await page.keyboard.down(act.key); break;
      case 'up': await page.keyboard.up(act.key); break;
      case 'type': await page.keyboard.type(act.text, { delay: 40 }); break;
      case 'click': await page.mouse.click(act.x, act.y); break;
      case 'shot':
        fs.mkdirSync(path.dirname(path.resolve(root, act.out)), { recursive: true });
        await page.screenshot({ path: path.resolve(root, act.out) });
        results.push({ shot: act.out });
        break;
      case 'eval': results.push({ eval: act.js, value: await page.evaluate(act.js) }); break;
      case 'scenes': results.push({ scenes: await activeScenes(page) }); break;
      default: throw new Error('Unbekannte Aktion: ' + act.type);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { browser, page, errors, warnings } = await openGame(args);
  const results = [];
  try {
    await runActions(page, args.actions, results);
    await page.waitForTimeout(args.wait);
    let shot = null;
    if (args.shot) {
      shot = args.out || path.join('screenshots', '_tmp', (args.scene || 'menu') + '.png');
      fs.mkdirSync(path.dirname(path.resolve(root, shot)), { recursive: true });
      await page.screenshot({ path: path.resolve(root, shot) });
    }
    const summary = { ok: errors.length === 0, scene: args.scene, activeScenes: await activeScenes(page), errors, warnings, results, screenshot: shot };
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = errors.length ? 1 : 0;
  } finally {
    await browser.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(2);
  });
}

#!/usr/bin/env node
/*
 * smoke.mjs – End-to-End-Test im Headless-Browser.
 *
 *  1. Menü lädt (auch mit gesperrtem CDN → lokale Phaser-Kopie)
 *  2. Jede Szene lässt sich direkt starten, ohne JavaScript-Fehler
 *  3. Kompletter Durchlauf (unverwundbar, 4-faches Tempo): alle 4 Side Quests
 *     öffnen sich in der richtigen Reihenfolge, am Ende kommt das Zeugnis
 *  4. Ohne Eingabe: 3 Crashes → exmatrikuliert
 *  5. Pause mit Esc und weiter
 * Screenshots landen in screenshots/ (für die Abgabe).
 */
import path from 'node:path';
import { openGame, activeScenes } from './run-scene.mjs';
import { root } from './_load.mjs';

const SIDE_QUESTS = ['EduroamScene', 'WasserspenderScene', 'KlausurScene', 'PruefungScene'];
const failures = [];
let passed = 0;

function shotPath(name) {
  return path.join(root, 'screenshots', name);
}

async function check(name, fn) {
  const t0 = Date.now();
  let ctx = null;
  try {
    ctx = await fn((opts) => openGame(opts).then((c) => (ctx = c)));
    const errors = ctx ? ctx.errors : [];
    if (errors.length) throw new Error('JS-Fehler:\n  ' + errors.join('\n  '));
    passed++;
    console.log(`✔ ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (err) {
    failures.push(name);
    console.error(`✘ ${name}\n  ${String(err.message || err).split('\n').join('\n  ')}`);
  } finally {
    if (ctx && ctx.browser) await ctx.browser.close();
  }
}

async function waitForScene(page, key, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const scenes = await activeScenes(page);
    if (scenes.includes(key)) return scenes;
    await page.waitForTimeout(150);
  }
  throw new Error(`Szene ${key} nicht innerhalb von ${timeoutMs} ms aktiv (aktiv: ${(await activeScenes(page)).join(', ')})`);
}

/** Beendet die aktive Side Quest direkt über die Kern-API (ohne ihr UI zu bedienen). */
async function finishSideQuest(page, key) {
  await page.evaluate((sceneKey) => {
    const scene = window.SS.game.scene.getScene(sceneKey);
    const result = sceneKey === 'PruefungScene'
      ? { id: 'pruefung', title: 'Mündliche Prüfung', success: true, ects: 5, grade: 2.0, message: 'Smoke-Test' }
      : { id: sceneKey, title: sceneKey, success: true, ects: 3, message: 'Smoke-Test' };
    window.SS.SideQuest.finish(scene, result);
  }, key);
}

await check('Menü lädt', async (open) => {
  const ctx = await open({});
  await waitForScene(ctx.page, 'MenuScene', 5000);
  await ctx.page.waitForTimeout(1200);
  await ctx.page.screenshot({ path: shotPath('01-menu.png') });
  return ctx;
});

await check('Menü lädt auch ohne CDN (vendor/phaser.min.js)', async (open) => {
  const ctx = await open({ fallback: true });
  await waitForScene(ctx.page, 'MenuScene', 5000);
  return ctx;
});

// Screenshot mitten im Sprung: Taste noch auf der freien Anlaufstrecke halten
async function runnerShot(open, section, file) {
  const ctx = await open({ scene: 'GameScene', params: section ? `section=${section}` : '' });
  await waitForScene(ctx.page, 'GameScene', 5000);
  await ctx.page.waitForTimeout(2100);
  await ctx.page.keyboard.down('Space');
  await ctx.page.waitForTimeout(600);
  await ctx.page.screenshot({ path: shotPath(file) });
  await ctx.page.keyboard.up('Space');
  return ctx;
}

await check('Runner startet und zeichnet', (open) => runnerShot(open, 0, '02-runner.png'));
await check('Klausurenphase (schnell) zeichnet', (open) => runnerShot(open, 2, '03b-klausurenphase.png'));

await check('Praxisphase (Abschnitt 2) läuft', async (open) => {
  const ctx = await open({ scene: 'GameScene', params: 'section=1&god=1&speed=2' });
  await waitForScene(ctx.page, 'GameScene', 5000);
  // warten, bis der Spieler kopfüber läuft (max. 20 s)
  const t0 = Date.now();
  let flipped = false;
  while (Date.now() - t0 < 20000 && !flipped) {
    await ctx.page.waitForTimeout(200);
    flipped = await ctx.page.evaluate(() => {
      const gs = window.SS.game.scene.getScene('GameScene');
      const info = gs && gs.getHudInfo && gs.getHudInfo();
      return !!info && info.phaseLabel === 'Praxisphase';
    });
  }
  if (!flipped) throw new Error('Praxisphase wurde nicht erreicht');
  await ctx.page.waitForTimeout(500);
  await ctx.page.screenshot({ path: shotPath('03-praxisphase.png') });
  return ctx;
});

let shotIndex = 4;
for (const key of SIDE_QUESTS) {
  const name = key.replace('Scene', '').toLowerCase();
  const idx = shotIndex++;
  await check(`Side Quest ${key} startet (Übungsmodus)`, async (open) => {
    const ctx = await open({ scene: key });
    await waitForScene(ctx.page, key, 5000);
    await ctx.page.waitForTimeout(500);
    await ctx.page.screenshot({ path: shotPath(`0${idx}-${name}-intro.png`) });
    await ctx.page.keyboard.press('Enter');
    await ctx.page.waitForTimeout(2200);
    await ctx.page.screenshot({ path: shotPath(`0${idx}-${name}.png`) });
    return ctx;
  });
}

await check('Kompletter Durchlauf (unverwundbar): alle Side Quests, dann Zeugnis', async (open) => {
  const ctx = await open({ scene: 'GameScene', params: 'god=1&speed=4' });
  for (const key of SIDE_QUESTS) {
    await waitForScene(ctx.page, key, 60000);
    await ctx.page.waitForTimeout(400);
    await finishSideQuest(ctx.page, key);
  }
  await waitForScene(ctx.page, 'GameOverScene', 15000);
  const run = await ctx.page.evaluate(() => window.SS.State.run);
  if (run.outcome !== 'graduated') throw new Error('Erwartet outcome=graduated, ist ' + run.outcome);
  if (run.sideQuests.length !== 4) throw new Error('Erwartet 4 Side-Quest-Ergebnisse, sind ' + run.sideQuests.length);
  await ctx.page.waitForTimeout(1500);
  await ctx.page.screenshot({ path: shotPath('08-zeugnis.png') });
  return ctx;
});

await check('Ohne Eingabe: drei Crashes → exmatrikuliert', async (open) => {
  const ctx = await open({ scene: 'GameScene', params: 'speed=2' });
  await waitForScene(ctx.page, 'GameOverScene', 60000);
  const run = await ctx.page.evaluate(() => window.SS.State.run);
  if (run.outcome !== 'exmatrikuliert') throw new Error('Erwartet outcome=exmatrikuliert, ist ' + run.outcome);
  if (run.deaths !== 3) throw new Error('Erwartet 3 Crashes, sind ' + run.deaths);
  await ctx.page.waitForTimeout(1500);
  await ctx.page.screenshot({ path: shotPath('09-exmatrikuliert.png') });
  return ctx;
});

await check('Pause mit Esc und weiter', async (open) => {
  const ctx = await open({ scene: 'GameScene', params: 'god=1' });
  await waitForScene(ctx.page, 'GameScene', 5000);
  await ctx.page.waitForTimeout(2500);
  await ctx.page.keyboard.press('Escape');
  await waitForScene(ctx.page, 'PauseScene', 3000);
  await ctx.page.waitForTimeout(400);
  await ctx.page.screenshot({ path: shotPath('10-pause.png') });
  await ctx.page.keyboard.press('Escape');
  await ctx.page.waitForTimeout(600);
  const scenes = await activeScenes(ctx.page);
  if (scenes.includes('PauseScene')) throw new Error('PauseScene ist noch aktiv');
  const paused = await ctx.page.evaluate(() => window.SS.game.scene.isPaused('GameScene'));
  if (paused) throw new Error('GameScene ist noch pausiert');
  return ctx;
});

console.log(`\n${passed} bestanden, ${failures.length} fehlgeschlagen`);
process.exit(failures.length ? 1 : 0);

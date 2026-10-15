#!/usr/bin/env node
/*
 * beatability.mjs – prüft, ob jeder Abschnitt des Levels schaffbar ist, und misst die Sprungfenster.
 *
 * 1. Schaffbar? Nutzt exakt die Spielphysik (src/core/physics.js) und durchsucht alle
 *    Eingabefolgen (springen / nicht springen in jedem Physik-Schritt).
 *    Zustände mit (fast) gleicher Höhe/Geschwindigkeit werden zusammengefasst,
 *    damit die Suche schnell bleibt.
 * 2. Wie genau muss man drücken? „Schaffbar“ heißt nur, dass es irgendeinen Weg gibt – auch
 *    einen, den man nur mit einem einzigen Bild Spielraum trifft. Deshalb läuft der Prüfer danach
 *    einen Lösungsweg ab und misst an jedem Pflichtsprung das Sprungfenster: die Zeitspanne, in der
 *    ein Tipp (100 ms) noch zum Ziel führt. Die Taste wird dabei wie im Spiel einmal pro Bild (60 Hz)
 *    gelesen. Ausgegeben wird das engste Fenster je Abschnitt, unter 120 ms gibt es eine WARNUNG.
 *    Gemessen wird mit Tipps: Stellen, die man durch Gedrückthalten leichter schafft (z. B. Sprünge
 *    direkt nacheinander oder Orbs), können hier enger erscheinen, als sie für Halter sind.
 *
 * Aufruf: node tests/beatability.mjs [levelName]
 */
import { loadCore } from './_load.mjs';

const SS = loadCore(['src/levels/semester.js']);
const { Physics, Level, CONFIG: C } = SS;

const levelName = process.argv[2] || 'semester';
const def = SS.Levels[levelName];
if (!def) {
  console.error(`Level "${levelName}" nicht gefunden.`);
  process.exit(1);
}

const { errors, warnings } = Level.validate(def);
for (const w of warnings) console.warn('WARNUNG:', w);
if (errors.length) {
  for (const e of errors) console.error('FEHLER:', e);
  process.exit(1);
}

const world = Level.parse(def);
const MAX_FRONTIER = 20000;
const STEPS_PER_FRAME = Math.round(1 / (60 * C.STEP)); // 4 Physik-Schritte pro Bild bei 60 Hz
const PRESS_STEPS = [24, 8, 4, 48, 96];  // Tipp 100 ms; nur wenn der nicht passt: 33 / 17 ms oder 0,2 / 0,4 s
const WINDOW_WARN_MS = 120;              // engere Sprungfenster sind Glückssache
const MAX_STATES = 500000;               // Notbremse für die Fenster-Messung

function keyOf(p) {
  return [
    Math.round(p.y * 2), Math.round(p.vy / 5), p.gravityDir, p.speedMode,
    p.grounded ? 1 : 0, p.lastOrbId, p.lastPadId, p.triggerIdx
  ].join('|');
}

/**
 * Breitensuche über alle Eingaben (jeder Physik-Schritt, 240 Hz): Gibt es überhaupt einen Weg?
 * Wie genau man dafür drücken muss, misst erst measureWindows().
 */
function checkSection(sec) {
  let frontier = [Physics.createPlayer({ x: sec.startX, triggerIdx: sec.startTriggerIdx, speedMode: sec.speed })];
  let steps = 0;
  let lastX = sec.startX;
  let maxFrontier = 1;
  const maxSteps = Math.ceil(((sec.endX - sec.startX) / C.SPEED.normal + 10) / C.STEP);
  while (frontier.length) {
    steps++;
    const next = new Map();
    for (const p of frontier) {
      for (const jump of [false, true]) {
        const q = Physics.clonePlayer(p);
        const events = [];
        Physics.step(q, world, { jump }, C.STEP, events);
        if (q.dead) continue;
        if (events.some((e) => e.type === 'checkpoint' && e.sectionIndex === sec.index)) {
          return { ok: true, steps, seconds: steps * C.STEP, maxFrontier };
        }
        const k = keyOf(q);
        if (!next.has(k)) next.set(k, q);
      }
    }
    frontier = [...next.values()];
    if (frontier.length) lastX = frontier[0].x;
    maxFrontier = Math.max(maxFrontier, frontier.length);
    if (frontier.length > MAX_FRONTIER) frontier.length = MAX_FRONTIER;
    if (steps > maxSteps) return { ok: false, reason: 'Zeitlimit der Suche', x: lastX };
  }
  return { ok: false, reason: 'alle Wege enden im Crash', x: lastX };
}

/**
 * Sprungfenster entlang eines Lösungswegs. Der Würfel läuft ohne Eingabe, bis er ohne Druck
 * verloren wäre. Dann wird vom Verlustpunkt aus rückwärts geprüft, in welchen Physik-Schritten ein
 * Druck noch zum Ziel führt (danach geht es mit einer Entscheidung pro Bild weiter). Die späteste
 * zusammenhängende Folge solcher Schritte vor dem Verlustpunkt ist das Fenster dieser Stelle;
 * gedrückt wird in seiner Mitte, dann geht es weiter.
 * Ergebnis: [{ ms, col }] je Pflichtsprung (col = Abschnittsspalte der Stelle);
 * ms = 0 heißt: mit einer Entscheidung pro Bild nicht zu schaffen.
 */
function measureWindows(sec) {
  const memo = new Map();   // Zustand → kommt man von dort noch ans Ziel?
  const stateKey = (p) => [
    p.x.toFixed(2), p.y.toFixed(3), p.vy.toFixed(2), p.gravityDir, p.grounded ? 1 : 0,
    p.lastOrbId, p.lastPadId, p.triggerIdx, p.speedMode
  ].join('|');
  const colOf = (p) => Math.floor((p.x + C.PLAYER_SIZE) / C.TILE) - sec.startCol;

  // n Physik-Schritte mit fester Eingabe: 'tot', 'ziel' oder null (läuft weiter)
  function run(p, jump, n) {
    const events = [];
    for (let i = 0; i < n; i++) {
      events.length = 0;
      Physics.step(p, world, { jump }, C.STEP, events);
      if (p.dead) return 'tot';
      if (events.some((e) => e.type === 'checkpoint' && e.sectionIndex === sec.index)) return 'ziel';
    }
    return null;
  }

  // Kommt man von start aus ans Ziel, wenn man einmal pro Bild entscheidet? (Tiefensuche mit Gedächtnis)
  function viable(start) {
    const startKey = stateKey(start);
    if (memo.has(startKey)) return memo.get(startKey);
    const stack = [{ p: start, k: startKey, tried: 0 }];   // tried: 0 = nichts, 1 = „nicht drücken“, 2 = beides probiert
    let result;                                           // Ergebnis des zuletzt fertig untersuchten Zweigs
    while (stack.length) {
      const node = stack[stack.length - 1];
      if (result === true) { memo.set(node.k, true); stack.pop(); continue; }
      if (node.tried === 2) { memo.set(node.k, false); stack.pop(); result = false; continue; }
      const q = Physics.clonePlayer(node.p);
      const outcome = run(q, node.tried === 1, STEPS_PER_FRAME);
      node.tried++;
      if (outcome !== null) { result = outcome === 'ziel'; continue; }
      const k = stateKey(q);
      if (memo.has(k)) { result = memo.get(k); continue; }
      if (memo.size > MAX_STATES) throw new Error(`über ${MAX_STATES} Zustände`);
      result = undefined;
      stack.push({ p: q, k, tried: 0 });
    }
    return result;
  }

  // Rettet ein Druck über n Schritte ab Zustand p? Ein Druck, der nichts ändert (in der Luft), zählt nicht.
  function pressSaves(p, n) {
    const q = Physics.clonePlayer(p);
    const outcome = run(q, true, n);
    if (outcome !== null) return outcome === 'ziel';
    const idle = Physics.clonePlayer(p);
    if (run(idle, false, n) === null && stateKey(idle) === stateKey(q)) return false;
    return viable(q);
  }

  const windows = [];
  let p = Physics.createPlayer({ x: sec.startX, triggerIdx: sec.startTriggerIdx, speedMode: sec.speed });
  if (!viable(p)) return [{ ms: 0, col: colOf(p) }];
  for (;;) {
    // Ohne Eingabe weiterlaufen, bis der Weg ohne Druck verloren wäre
    const roll = [Physics.clonePlayer(p)];
    let lost = -1;
    while (lost === -1) {
      const q = Physics.clonePlayer(roll[roll.length - 1]);
      const outcome = run(q, false, 1);
      if (outcome === 'ziel') return windows;
      roll.push(q);
      if (outcome === 'tot' || !viable(q)) lost = roll.length - 1;
    }
    // Rückwärts: späteste zusammenhängende Folge von Schritten vor lost, in denen ein Druck rettet
    let win = null;
    for (const n of PRESS_STEPS) {
      let last = -1;
      let first = 0;
      for (let s = lost - 1; s >= 0; s--) {
        const ok = pressSaves(roll[s], n);
        if (ok && last === -1) last = s;
        if (!ok && last !== -1) { first = s + 1; break; }
      }
      if (last !== -1) { win = { first, last, n }; break; }
    }
    if (!win) return [...windows, { ms: 0, col: colOf(roll[lost]) }];
    windows.push({ ms: (win.last - win.first + 1) * C.STEP * 1000, col: colOf(roll[lost]) });
    // In der Fenstermitte drücken und weiter zur nächsten Stelle
    p = Physics.clonePlayer(roll[Math.floor((win.first + win.last) / 2)]);
    if (run(p, true, win.n) === 'ziel') return windows;
  }
}

/** Gibt das engste Sprungfenster eines Abschnitts aus und warnt bei Stellen unter WINDOW_WARN_MS. */
function reportWindows(sec) {
  const t0 = Date.now();
  let windows;
  try {
    windows = measureWindows(sec);
  } catch (e) {
    console.warn(`WARNUNG: ${sec.index}: ${sec.title} – Sprungfenster nicht gemessen (${e.message})`);
    return;
  }
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  if (!windows.length) {
    console.log(`  Sprungfenster: keine Pflichtsprünge (Messung ${dur} s)`);
    return;
  }
  const tightest = windows.reduce((a, w) => (w.ms < a.ms ? w : a));
  const count = `${windows.length} ${windows.length === 1 ? 'Pflichtsprung' : 'Pflichtsprünge'}`;
  console.log(`  Sprungfenster: ${count}, engstes ${Math.round(tightest.ms)} ms bei Abschnittsspalte ${tightest.col} (Messung ${dur} s)`);
  for (const w of windows) {
    if (w.ms >= WINDOW_WARN_MS) continue;
    const how = w.ms === 0 ? 'mit einer Eingabe pro Bild nicht zu schaffen' : `nur ${Math.round(w.ms)} ms`;
    console.warn(`WARNUNG: ${sec.index}: ${sec.title} – Sprungfenster ${how} bei Abschnittsspalte ${w.col} (unter ${WINDOW_WARN_MS} ms ist der Sprung Glückssache)`);
  }
}

let failed = false;
console.log(`Level "${def.title || levelName}": ${world.sections.length} Abschnitte, ${world.cols} Spalten, ${world.coins.length} ECTS-Münzen`);
for (const sec of world.sections) {
  const t0 = Date.now();
  const res = checkSection(sec);
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  const lengthS = ((sec.endX - sec.startX) / C.SPEED[sec.speed]).toFixed(1);
  if (res.ok) {
    console.log(`✔ ${sec.index}: ${sec.title} – schaffbar (${res.seconds.toFixed(1)} s Laufzeit, Länge ≈ ${lengthS} s, Suche ${dur} s, max. ${res.maxFrontier} Zustände)`);
    reportWindows(sec);
  } else {
    failed = true;
    const col = Math.floor(res.x / C.TILE);
    console.error(`✘ ${sec.index}: ${sec.title} – NICHT schaffbar: ${res.reason} bei x ≈ ${Math.round(res.x)} px (Spalte ${col}, Abschnittsspalte ${col - sec.startCol})`);
  }
}
process.exit(failed ? 1 : 0);

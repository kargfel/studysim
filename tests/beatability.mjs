#!/usr/bin/env node
/*
 * beatability.mjs – prüft, ob jeder Abschnitt des Levels schaffbar ist.
 *
 * Nutzt exakt die Spielphysik (src/core/physics.js) und durchsucht alle
 * Eingabefolgen (springen / nicht springen in jedem Physik-Schritt).
 * Zustände mit (fast) gleicher Höhe/Geschwindigkeit werden zusammengefasst,
 * damit die Suche schnell bleibt.
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
const MAX_FRONTIER = 6000;

function keyOf(p) {
  return [
    Math.round(p.y * 2), Math.round(p.vy / 5), p.gravityDir, p.speedMode,
    p.grounded ? 1 : 0, p.lastOrbId, p.lastPadId, p.triggerIdx
  ].join('|');
}

/**
 * Breitensuche über alle Eingaben. Jeder Zustand merkt sich, in welchem
 * Schritt der letzte Sprung begann (für die Fenster-Messung).
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

let failed = false;
console.log(`Level "${def.title || levelName}": ${world.sections.length} Abschnitte, ${world.cols} Spalten, ${world.coins.length} ECTS-Münzen`);
for (const sec of world.sections) {
  const t0 = Date.now();
  const res = checkSection(sec);
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  const lengthS = ((sec.endX - sec.startX) / C.SPEED[sec.speed]).toFixed(1);
  if (res.ok) {
    console.log(`✔ ${sec.index}: ${sec.title} – schaffbar (${res.seconds.toFixed(1)} s Laufzeit, Länge ≈ ${lengthS} s, Suche ${dur} s, max. ${res.maxFrontier} Zustände)`);
  } else {
    failed = true;
    const col = Math.floor(res.x / C.TILE);
    console.error(`✘ ${sec.index}: ${sec.title} – NICHT schaffbar: ${res.reason} bei x ≈ ${Math.round(res.x)} px (Spalte ${col}, Abschnittsspalte ${col - sec.startCol})`);
  }
}
process.exit(failed ? 1 : 0);

// Unit-Tests für die Phaser-freie Spiellogik: node --test tests/unit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './_load.mjs';

const SS = loadCore(['src/levels/semester.js']);
const { State, Physics, Level, CONFIG: C } = SS;

// ── Hilfen ──────────────────────────────────────────────────────────
function flatWorld(rows) {
  return Level.parse({
    sections: [{ id: 't', title: 'Test', theme: 'campus', sideQuest: 'EduroamScene', rows }]
  });
}

function simulate(world, player, { seconds, jumpAt = () => false }) {
  const events = [];
  const steps = Math.round(seconds / C.STEP);
  for (let i = 0; i < steps && !player.dead; i++) {
    Physics.step(player, world, { jump: jumpAt(i, player) }, C.STEP, events);
  }
  return events;
}

// ── State ───────────────────────────────────────────────────────────
test('State: drei Versuche pro Abschnitt, danach exmatrikuliert', () => {
  State.newRun();
  assert.equal(State.registerDeath().exhausted, false);
  assert.equal(State.run.attempt, 2);
  assert.equal(State.registerDeath().exhausted, false);
  assert.equal(State.run.attempt, 3);
  assert.equal(State.registerDeath().exhausted, true);
  assert.equal(State.run.deaths, 3);
});

test('State: Crash setzt ECTS auf den Abschnittsanfang zurück', () => {
  State.newRun();
  State.addEcts(2);
  State.completeSection();
  State.addEcts(3);
  State.registerDeath();
  assert.equal(State.run.ects, 2);
  assert.equal(State.run.attempt, 2);
});

test('State: Checkpoint sichert ECTS und setzt Versuche zurück', () => {
  State.newRun();
  State.addEcts(1);
  State.registerDeath();
  State.addEcts(1);
  assert.equal(State.completeSection(), 1);
  assert.equal(State.run.attempt, 1);
  assert.equal(State.run.ectsAtSectionStart, 1);
});

test('State: Side Quest gibt ECTS und übernimmt die Note', () => {
  State.newRun();
  State.recordSideQuest({ id: 'pruefung', title: 'Prüfung', success: true, ects: 5, grade: 2.3 });
  assert.equal(State.run.ects, 5);
  assert.equal(State.run.grade, 2.3);
  assert.equal(State.run.sideQuests.length, 1);
});

test('State: Notenformat und Notenstufen', () => {
  assert.equal(State.formatGrade(1.3), '1,3');
  assert.equal(State.formatGrade(null), '–');
  assert.equal(State.roundGrade(1.1), 1.0);
  assert.equal(State.roundGrade(2.2), 2.3);
  assert.equal(State.roundGrade(4.0), 4.0);
  assert.equal(State.roundGrade(4.2), 5.0);
});

test('State: Highscore ohne localStorage stürzt nicht ab', () => {
  State.newRun();
  const hs = State.loadHighscore();
  assert.equal(hs.bestEcts, 0);
  assert.doesNotThrow(() => State.saveHighscore());
});

// ── Physik ──────────────────────────────────────────────────────────
test('Physik: Sprung erreicht ca. 2,2 Kacheln Höhe und ca. 4 Kacheln Weite', () => {
  const world = flatWorld([' '.repeat(60), '='.repeat(60)]);
  const p = Physics.createPlayer({ x: 2 * C.TILE });
  const startY = p.y;
  const startX = p.x;
  let minY = p.y;
  let landX = null;
  let jumped = false;
  for (let i = 0; i < 400; i++) {
    const events = [];
    Physics.step(p, world, { jump: !jumped }, C.STEP, events);
    if (events.some((e) => e.type === 'jump')) jumped = true;
    minY = Math.min(minY, p.y);
    if (events.some((e) => e.type === 'land')) { landX = p.x; break; }
  }
  const height = (startY - minY) / C.TILE;
  const width = (landX - startX) / C.TILE;
  assert.ok(height > 2.0 && height < 2.4, `Sprunghöhe ${height.toFixed(2)} Kacheln`);
  assert.ok(width > 3.6 && width < 4.4, `Sprungweite ${width.toFixed(2)} Kacheln`);
});

test('Physik: Stachel ohne Sprung = Crash, mit Sprung = überlebt', () => {
  const rows = ['          ^          ', '====================='];
  const p1 = Physics.createPlayer({ x: 2 * C.TILE });
  simulate(flatWorld(rows), p1, { seconds: 2 });
  assert.equal(p1.dead, true);
  assert.equal(p1.deathReason, 'spike');

  const p2 = Physics.createPlayer({ x: 2 * C.TILE });
  // Absprung ca. 1,5 Kacheln vor dem Stachel
  simulate(flatWorld(rows), p2, { seconds: 2, jumpAt: (i, p) => p.x > 7.6 * C.TILE && p.x < 8.2 * C.TILE });
  assert.equal(p2.dead, false);
});

test('Physik: seitlich gegen einen Block = Crash, auf den Block springen = Landung', () => {
  const rows = ['          ###########', '====================='];
  const p1 = Physics.createPlayer({ x: 2 * C.TILE });
  simulate(flatWorld(rows), p1, { seconds: 2 });
  assert.equal(p1.deathReason, 'wall');

  const p2 = Physics.createPlayer({ x: 2 * C.TILE });
  simulate(flatWorld(rows), p2, { seconds: 1.5, jumpAt: (i, p) => p.x > 7.5 * C.TILE && p.x < 8 * C.TILE });
  assert.equal(p2.dead, false);
  assert.equal(p2.y, C.GROUND_Y - C.TILE - C.PLAYER_SIZE);
});

test('Physik: Grube ohne Sprung = Crash (Absturz oder gegen die Kante)', () => {
  // schmale Grube: man fällt ein Stück und knallt gegen die gegenüberliegende Bodenkante
  const narrow = Physics.createPlayer({ x: 2 * C.TILE });
  simulate(flatWorld(['                    ', '==========___======='].map((r) => r)), narrow, { seconds: 2 });
  assert.equal(narrow.deathReason, 'wall');
  // breite Grube: Absturz nach unten aus dem Bild
  const wide = Physics.createPlayer({ x: 2 * C.TILE });
  simulate(flatWorld([' '.repeat(40), '==========' + '_'.repeat(30)]), wide, { seconds: 2 });
  assert.equal(wide.deathReason, 'pit');
  // 1 Kachel breite Lücke ist harmlos (der Würfel ist breiter als die Lücke tief fällt)
  const tiny = Physics.createPlayer({ x: 2 * C.TILE });
  simulate(flatWorld(['                    ', '==========_========='].map((r) => r)), tiny, { seconds: 1.5 });
  assert.equal(tiny.dead, false);
});

test('Physik: Praxis-Portal kehrt die Schwerkraft um, Theorie-Portal stellt sie wieder her', () => {
  const rows = [
    '######################################',
    '                                      ',
    '                                      ',
    '                                      ',
    '         G                  T         ',
    '                                      ',
    '======================================'
  ];
  const world = flatWorld(rows);
  const p = Physics.createPlayer({ x: 2 * C.TILE });
  const kinds = [];
  for (let i = 0; i < Math.round(3 / C.STEP) && !p.dead; i++) {
    const events = [];
    Physics.step(p, world, { jump: false }, C.STEP, events);
    for (const e of events) if (e.type === 'portal') kinds.push({ kind: e.kind, gravity: p.gravityDir });
    if (kinds.length === 1 && p.grounded) {
      // läuft jetzt kopfüber an der Decke (Unterkante der Deckenreihe)
      assert.equal(p.y, (C.GROUND_Y / C.TILE - 6 + 1) * C.TILE);
    }
  }
  assert.deepEqual(kinds.map((k) => k.kind), ['praxis', 'theorie']);
  assert.equal(p.dead, false);
  assert.equal(p.gravityDir, 1);
});

test('Physik: Jump-Pad schleudert höher als ein normaler Sprung', () => {
  const world = flatWorld(['     J                    ', '=========================='].map((r) => r));
  const p = Physics.createPlayer({ x: 2 * C.TILE });
  let minY = p.y;
  simulate(world, p, { seconds: 1.2, jumpAt: () => false });
  // Höhe erneut messen
  const p2 = Physics.createPlayer({ x: 2 * C.TILE });
  for (let i = 0; i < Math.round(1.2 / C.STEP); i++) {
    Physics.step(p2, world, { jump: false }, C.STEP, []);
    minY = Math.min(minY, p2.y);
  }
  const height = (C.GROUND_Y - C.PLAYER_SIZE - minY) / C.TILE;
  assert.ok(height > 3.8, `Pad-Höhe ${height.toFixed(2)} Kacheln`);
  assert.equal(p.dead, false);
});

test('Physik: Checkpoint-Event am Abschnittsende', () => {
  const world = flatWorld([' '.repeat(30), '='.repeat(30)]);
  const p = Physics.createPlayer({ x: world.sections[0].startX, triggerIdx: world.sections[0].startTriggerIdx });
  const events = simulate(world, p, { seconds: 4 });
  const cp = events.find((e) => e.type === 'checkpoint');
  assert.ok(cp, 'Checkpoint erreicht');
  assert.equal(cp.sideQuest, 'EduroamScene');
});

// ── Level ───────────────────────────────────────────────────────────
test('Level: join richtet Bausteine unten bündig aus', () => {
  const rows = Level.join(['#', '='], Level.gap(2), [' o', '^ ', '=='], Level.pit(1));
  assert.deepEqual(rows, [
    '    o ',
    '#  ^  ',
    '=====_'
  ]);
});

test('Level: validate erkennt unbekannte Zeichen und belegte Anlaufstrecke', () => {
  const bad = Level.validate({
    sections: [{ id: 'x', title: 'X', theme: 'campus', sideQuest: 'EduroamScene', rows: ['  ^  X', '======'] }]
  });
  assert.ok(bad.errors.some((e) => e.includes('unbekanntes Zeichen')));
  assert.ok(bad.errors.some((e) => e.includes('Anlaufstrecke')));
});

test('Level: das Semester-Level ist gültig und vollständig', () => {
  const def = SS.Levels.semester;
  const { errors } = Level.validate(def);
  assert.deepEqual(errors, []);
  const world = Level.parse(def);
  assert.equal(world.sections.length, 4);
  assert.deepEqual(world.sections.map((s) => s.sideQuest), ['EduroamScene', 'WasserspenderScene', 'KlausurScene', 'PruefungScene']);
  assert.equal(world.checkpoints.length, 4);
  for (const s of world.sections) {
    assert.ok(s.startTriggerIdx >= 0 && s.startTriggerIdx <= world.triggers.length);
    assert.equal(world.isSolid(Math.floor(s.startX / C.TILE), world.groundRow), true, `Boden unter dem Start von ${s.id}`);
  }
});

test('State: nur die mündliche Prüfung setzt die Endnote', () => {
  State.newRun();
  State.recordSideQuest({ id: 'klausur', title: 'Klausur', success: true, ects: 6, grade: 1.7 });
  assert.equal(State.run.grade, null);
  assert.equal(State.run.sideQuests[0].grade, 1.7);
  State.recordSideQuest({ id: 'pruefung', title: 'Prüfung', success: true, ects: 5, grade: 2.3 });
  assert.equal(State.run.grade, 2.3);
});

test('Audio: API läuft ohne WebAudio (Node) ohne Fehler', async () => {
  const { loadScripts } = await import('./_load.mjs');
  loadScripts(['src/core/audio.js']);
  const A = globalThis.SS.Audio;
  assert.doesNotThrow(() => {
    A.unlock();
    for (const name of ['jump', 'coin', 'death', 'checkpoint', 'portal', 'pad', 'orb', 'click', 'success', 'fail', 'error', 'type', 'water', 'buzz', 'tick', 'win', 'lose', 'gibtsnicht']) A.sfx(name);
    A.music.play('run');
    A.music.play('boss');
    A.music.stop();
    A.toggleMute();
    A.setMuted(false);
  });
  assert.equal(typeof A.isMuted(), 'boolean');
});

test('State: Notenrundung genau zwischen zwei Stufen ergibt die bessere Note', () => {
  // 1 + 3 · (1 − Ü/100) + N/100 mit ganzzahligen Balken trifft solche Mittelwerte regelmäßig
  assert.equal(State.roundGrade(1 + 3 * (1 - 72 / 100) + 1 / 100), State.roundGrade(1 + 3 * (1 - 77 / 100) + 16 / 100));
  assert.equal(State.roundGrade(1.85), 1.7);
  assert.equal(State.roundGrade(3.85), 3.7);
  assert.equal(State.roundGrade(4.0000000001), 4.0);
});

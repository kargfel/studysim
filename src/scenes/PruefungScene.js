/*
 * PruefungScene.js – Side Quest 4 und Endboss: die mündliche Projektarbeitsprüfung.
 *
 * Ablauf: SS.SideQuest.intro → 6 Fragerunden (Bossfight) → Notenverkündung → SS.SideQuest.outro
 *   - Pro Runde stellt die Kommission eine Frage (Inhalte: SS.Data.pruefung).
 *   - Antwortstil per Button oder Taste 1–4. Welcher Stil wirkt, steht pro Frage in den Daten.
 *     „Fundiert“ verlangt eine Mini-Aufgabe (Zeiger im grünen Bereich stoppen).
 *     Läuft die Antwortzeit ab, wird automatisch geschwafelt.
 *   - Vor 2–3 zufälligen Runden passiert ein Zwischenfall (Quick-Time-Event).
 *   - Balken „Überzeugung“ (die Boss-HP der Kommission) und „Nervosität“.
 *     Nervosität 100 % = Blackout = Note 5,0 sofort.
 *   - Note: raw = 1 + 3 · (1 − Überzeugung/100) + Nervosität/100 → SS.State.roundGrade(raw).
 *
 * Debug-Hook: ?scene=PruefungScene&seed=42 macht Titel, Fragen, Zufall und Zwischenfälle
 * reproduzierbar (für Headless-Tests).
 */
(function () {
  'use strict';
  const SS = globalThis.SS;
  const C = SS.CONFIG;
  const COL = C.COLORS;
  const T = SS.Textures;

  // ── Regeln und Balancing ───────────────────────────────────────
  const ROUNDS = 6;
  const ANSWER_MS = 10000;            // Antwortzeit pro Frage
  const START_NERVES = 15;            // Lampenfieber zu Beginn
  const HARD_QUESTION_NERVES = 4;     // harte Fragen machen sofort nervöser
  const INCIDENTS_MIN = 2;
  const INCIDENTS_MAX = 3;
  const QUESTION_CPS = 42;            // Schreibmaschinen-Tempo (Zeichen pro Sekunde)

  // Wirkung je Ergebnis und Passung zur Frage: [Δ Überzeugung, Δ Nervosität]
  const EFFECTS = {
    fundiert:        { best: [24, -4],  normal: [16, -3],  worst: [8, 0] },
    fundiertFail:    { best: [6, 10],   normal: [4, 10],   worst: [0, 12] },
    ehrlich:         { best: [14, -10], normal: [8, -10],  worst: [3, -4] },
    buzzwordJackpot: { best: [24, -6],  normal: [22, -5],  worst: [18, -4] },
    buzzwordFlop:    { best: [-2, 6],   normal: [-6, 8],   worst: [-10, 12] },
    schwafeln:       { best: [4, 14],   normal: [2, 16],   worst: [-4, 20] }
  };
  // Chance, dass Buzzword-Bingo ausnahmsweise genial ist
  const JACKPOT_CHANCE = { best: 0.7, normal: 0.2, worst: 0.05 };
  const INCIDENT_EFFECTS = { success: [5, -6], fail: [-3, 14] };

  // ECTS laut Notentabelle (erste passende Zeile gilt, sonst 0)
  const ECTS_TABLE = [
    { maxGrade: 1.7, ects: 6 },
    { maxGrade: 2.7, ects: 5 },
    { maxGrade: 3.7, ects: 4 },
    { maxGrade: 4.0, ects: 3 }
  ];

  // Mini-Aufgabe „Fundiert“: Zeiger im grünen Bereich stoppen
  // armMs: so lange zählt nach dem Start keine Eingabe (zweiter Klick eines Doppelklicks auf „Fundiert“)
  const ARGUMENT = { zone: 0.22, hardZone: 0.15, sweepMs: 700, hardSweepMs: 540, timeoutMs: 3500, armMs: 300 };

  // Zwischenfälle: Minispiel-Methode der Szene und Zeitlimit
  const INCIDENT_GAMES = {
    beamer: { method: 'qteBeamer', ms: 4500 },
    demo:   { method: 'qteDemo',   ms: 5500 },
    akku:   { method: 'qteAkku',   ms: 5000 },
    folie:  { method: 'qteFolie',  ms: 4000 },
    tafel:  { method: 'qteTafel',  ms: 4500 }
  };
  const QTE = {
    demoLength: 5,                              // Pfeile in der Neustart-Folge
    akkuTolerance: 20, akkuSweepMs: 650,        // Stecker: Trefferbereich in px, Pendelzeit
    akkuMissLockMs: 600,                        // Sperre nach einem Fehlversuch
    foliePerPress: 10, folieDecayPerSec: 12,    // Folie: Fortschritt pro Tastendruck, Abfall pro Sekunde
    tafelMinWait: 1100, tafelMaxWait: 2600, tafelReactMs: 800
  };

  // ── Layout (800 × 600) ─────────────────────────────────────────
  const LAYOUT = {
    barY: 34, barW: 280, barH: 16,
    deskX: 20, deskY: 236,
    profX: 120, betreuerX: 312, examinerY: 272,
    screenX: 430, screenY: 70, screenW: 340, screenH: 196,
    cubeX: 600, cubeY: 292,
    floorY: 300,
    boxY: 336, boxH: 84,
    timerY: 428,
    buttonW: 364, buttonH: 54, buttonRows: [482, 546], buttonCols: [212, 588],
    overlay: { x: 120, y: 92, w: 560, h: 324 }
  };

  // Gesichtsausdruck des fragenden Prüfers → Reaktion der/des anderen
  const SECOND_MOOD = {
    happy: 'happy', neutral: 'neutral', skeptical: 'neutral', angry: 'skeptical', shocked: 'shocked', bored: 'bored'
  };
  // Textfarbe der Prüfer-Reaktion je Gesichtsausdruck
  const MOOD_COLORS = {
    happy: '#86efac', neutral: '#ffffff', skeptical: '#fde68a', angry: '#fca5a5', shocked: '#f0abfc', bored: '#d1d5db'
  };
  const CLOCK_SPEED = 0.001;   // Wanduhr: rad pro ms (die Zeit rast!)
  const INPUT_KEYS = ['ONE', 'TWO', 'THREE', 'FOUR', 'SPACE', 'UP', 'DOWN', 'LEFT', 'RIGHT'];
  const ANSWER_KEYS = ['ONE', 'TWO', 'THREE', 'FOUR'];
  const ARROWS = { UP: -90, DOWN: 90, LEFT: 180, RIGHT: 0 };   // Drehwinkel der Pfeil-Textur
  const ARROW_BUTTONS = ['LEFT', 'UP', 'DOWN', 'RIGHT'];        // Pfeil-Buttons der Live-Demo (Maus und Touch)

  // ── Texturen (Canvas-2D, Präfix pr_) ───────────────────────────
  const SKIN = '#f1c7a3';

  /** Prüfer:in als Brustbild; der Unterkörper verschwindet hinter dem Tisch. */
  function drawExaminer(ctx, w, h, look) {
    // Oberkörper
    ctx.fillStyle = look.jacket;
    T.roundRect(ctx, 14, 100, w - 28, h - 96, 26);
    ctx.fill();
    ctx.fillStyle = look.shirt;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 18, 100);
    ctx.lineTo(w / 2 + 18, 100);
    ctx.lineTo(w / 2, 142);
    ctx.closePath();
    ctx.fill();
    // Hals und Kopf
    ctx.fillStyle = SKIN;
    ctx.fillRect(w / 2 - 11, 84, 22, 20);
    ctx.beginPath();
    ctx.arc(w / 2, 58, 36, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(w / 2 - 36, 62, 7, 0, Math.PI * 2);
    ctx.arc(w / 2 + 36, 62, 7, 0, Math.PI * 2);
    ctx.fill();
    look.details(ctx, w);
  }

  function drawProfDetails(ctx, w) {
    // graue Haarkränze, oben fast kahl
    ctx.fillStyle = '#c7c9d1';
    ctx.beginPath();
    ctx.ellipse(w / 2 - 30, 40, 11, 20, -0.3, 0, Math.PI * 2);
    ctx.ellipse(w / 2 + 30, 40, 11, 20, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(w / 2 - 8, 22, 16, 5);
    // rote Fliege
    ctx.fillStyle = '#e2001a';
    ctx.beginPath();
    ctx.moveTo(w / 2, 108);
    ctx.lineTo(w / 2 - 16, 100);
    ctx.lineTo(w / 2 - 16, 116);
    ctx.closePath();
    ctx.moveTo(w / 2, 108);
    ctx.lineTo(w / 2 + 16, 100);
    ctx.lineTo(w / 2 + 16, 116);
    ctx.closePath();
    ctx.fill();
  }

  function drawBetreuerDetails(ctx, w) {
    // dunkle Haare mit Dutt
    ctx.fillStyle = '#3b2416';
    ctx.beginPath();
    ctx.arc(w / 2, 14, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(w / 2, 52, 38, Math.PI * 1.05, Math.PI * 1.95);
    ctx.fill();
    // Schlüsselband mit Firmenausweis
    ctx.strokeStyle = '#ffd400';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 16, 102);
    ctx.lineTo(w / 2, 150);
    ctx.lineTo(w / 2 + 16, 102);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(w / 2 - 10, 148, 20, 14);
    ctx.fillStyle = '#22d3ee';
    ctx.fillRect(w / 2 - 10, 148, 20, 4);
  }

  const LOOKS = {
    prof: { jacket: '#7c5a3a', shirt: '#f3f4f6', details: drawProfDetails },          // Tweed-Sakko, Fliege
    betreuer: { jacket: '#1e3a8a', shirt: '#22d3ee', details: drawBetreuerDetails }   // Blazer, Firmenausweis
  };
  T.register('pr_prof', 130, 190, (ctx, w, h) => drawExaminer(ctx, w, h, LOOKS.prof));
  T.register('pr_betreuer', 130, 190, (ctx, w, h) => drawExaminer(ctx, w, h, LOOKS.betreuer));

  /** Gesichter (Augen, Brauen, Mund) – werden über den Kopf gelegt. */
  // brows = Absenkung der inneren Brauen-Enden in px (positiv = grimmig, negativ = hochgezogen)
  const FACES = {
    neutral:   { eyes: 'dot',   brows: [0, 0],   browY: 0,  mouth: 'flat' },
    happy:     { eyes: 'happy', brows: [-2, -2], browY: -3, mouth: 'smile' },
    skeptical: { eyes: 'dot',   brows: [3, -3],  browY: -1, mouth: 'slant' },
    angry:     { eyes: 'dot',   brows: [4, 4],   browY: 2,  mouth: 'frown' },
    shocked:   { eyes: 'wide',  brows: [-2, -2], browY: -5, mouth: 'open' },
    bored:     { eyes: 'half',  brows: [0, 0],   browY: 3,  mouth: 'wavy' }
  };

  function drawFace(ctx, face) {
    const eyeY = 18;
    const eyesX = [20, 44];
    ctx.strokeStyle = '#1f1720';
    ctx.fillStyle = '#1f1720';
    ctx.lineCap = 'round';
    ctx.lineWidth = 3;
    // Augen
    eyesX.forEach((x) => {
      ctx.beginPath();
      if (face.eyes === 'happy') ctx.arc(x, eyeY + 2, 5, Math.PI * 1.1, Math.PI * 1.9);
      else if (face.eyes === 'half') { ctx.moveTo(x - 6, eyeY); ctx.lineTo(x + 6, eyeY); }
      if (face.eyes === 'happy' || face.eyes === 'half') { ctx.stroke(); return; }
      if (face.eyes === 'wide') {
        ctx.fillStyle = '#ffffff';
        ctx.arc(x, eyeY, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#1f1720';
        ctx.beginPath();
        ctx.arc(x, eyeY, 2.5, 0, Math.PI * 2);
      } else {
        ctx.arc(x, eyeY, 4, 0, Math.PI * 2);
      }
      ctx.fill();
    });
    // Brauen: von außen nach innen
    face.brows.forEach((drop, i) => {
      const outer = i === 0 ? eyesX[0] - 8 : eyesX[1] + 8;
      const inner = i === 0 ? eyesX[0] + 8 : eyesX[1] - 8;
      const y = 8 + face.browY;
      ctx.beginPath();
      ctx.moveTo(outer, y - drop);
      ctx.lineTo(inner, y + drop);
      ctx.stroke();
    });
    // Mund
    ctx.beginPath();
    switch (face.mouth) {
      case 'smile': ctx.arc(32, 28, 9, Math.PI * 0.15, Math.PI * 0.85); break;
      case 'frown': ctx.arc(32, 42, 9, Math.PI * 1.2, Math.PI * 1.8); break;
      case 'slant': ctx.moveTo(24, 36); ctx.lineTo(40, 32); break;
      case 'open': ctx.ellipse(32, 35, 6, 7, 0, 0, Math.PI * 2); ctx.fill(); break;
      case 'wavy': ctx.moveTo(24, 35); ctx.quadraticCurveTo(28, 31, 32, 35); ctx.quadraticCurveTo(36, 39, 40, 35); break;
      default: ctx.moveTo(25, 35); ctx.lineTo(39, 35);
    }
    ctx.stroke();
  }

  Object.keys(FACES).forEach((mood) => T.register('pr_face_' + mood, 64, 46, (ctx) => drawFace(ctx, FACES[mood])));

  T.register('pr_brille', 64, 22, (ctx) => {
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2.5;
    ctx.fillStyle = 'rgba(186, 230, 253, 0.25)';
    [20, 44].forEach((x) => {
      ctx.beginPath();
      ctx.arc(x, 11, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    ctx.beginPath();
    ctx.moveTo(29, 10);
    ctx.lineTo(35, 10);
    ctx.stroke();
  });

  // Spieler-Würfel in DHBW-Rot (Blick zur Kommission)
  T.register('pr_cube', 56, 56, (ctx, w, h) => {
    ctx.fillStyle = '#9e0012';
    T.roundRect(ctx, 0, 0, w, h, 8);
    ctx.fill();
    ctx.fillStyle = '#e2001a';
    T.roundRect(ctx, 4, 4, w - 8, h - 8, 6);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(8, 8, w - 16, 7);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(12, 20, 12, 12);
    ctx.fillRect(32, 20, 12, 12);
    ctx.fillStyle = '#12101c';
    ctx.fillRect(13, 24, 6, 6);
    ctx.fillRect(33, 24, 6, 6);
    ctx.fillRect(20, 40, 16, 4);
  });

  T.register('pr_sweat', 12, 16, (ctx) => {
    ctx.fillStyle = '#7dd3fc';
    ctx.beginPath();
    ctx.moveTo(6, 0);
    ctx.quadraticCurveTo(12, 9, 9, 13);
    ctx.arc(6, 11, 4.5, 0.2, Math.PI - 0.2);
    ctx.quadraticCurveTo(0, 9, 6, 0);
    ctx.fill();
  });

  // Lichtkegel von der Decke (wird additiv geblendet)
  T.register('pr_spot', 240, 300, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255, 244, 214, 0.75)');
    g.addColorStop(1, 'rgba(255, 244, 214, 0.05)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 22, 0);
    ctx.lineTo(w / 2 + 22, 0);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();
  });

  // Tunnelblick: dunkler Rand, der mit der Nervosität zunimmt
  T.register('pr_vignette', 800, 600, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 170, w / 2, h / 2, 520);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });

  // Pfeil nach rechts (wird für ↑ ↓ ← gedreht)
  T.register('pr_pfeil', 40, 40, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(6, 16, 16, 8);
    ctx.beginPath();
    ctx.moveTo(20, 6);
    ctx.lineTo(36, 20);
    ctx.lineTo(20, 34);
    ctx.closePath();
    ctx.fill();
  });

  // Ladestecker mit Kabel (zeigt nach unten)
  T.register('pr_stecker', 34, 70, (ctx, w) => {
    ctx.fillStyle = '#111827';
    ctx.fillRect(w / 2 - 4, 0, 8, 34);
    ctx.fillStyle = '#374151';
    T.roundRect(ctx, 3, 30, w - 6, 26, 5);
    ctx.fill();
    ctx.fillStyle = '#d1d5db';
    ctx.fillRect(w / 2 - 6, 56, 12, 14);
  });

  // Klassenzimmer-Tafel für die Herleitung
  T.register('pr_tafel', 420, 150, (ctx, w, h) => {
    ctx.fillStyle = '#8b5a2b';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1f4d3a';
    ctx.fillRect(8, 8, w - 16, h - 16);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (let i = 0; i < 6; i++) ctx.fillRect(20 + i * 70, 20 + (i % 3) * 30, 40, 3);
  });

  // ── kleine Helfer ──────────────────────────────────────────────
  const clamp100 = (v) => Math.max(0, Math.min(100, v));

  /** ECTS für eine Note laut Tabelle. */
  function ectsForGrade(grade) {
    const row = ECTS_TABLE.find((r) => grade <= r.maxGrade);
    return row ? row.ects : 0;
  }

  /** Note aus den beiden Balken (siehe Dateikopf). */
  function gradeFor(conviction, nerves) {
    const raw = 1 + 3 * (1 - conviction / 100) + nerves / 100;
    return SS.State.roundGrade(raw);
  }

  class PruefungScene extends Phaser.Scene {
    constructor() {
      super('PruefungScene');
    }

    init() {
      const seed = SS.getUrlParams().seed;
      this.rng = new Phaser.Math.RandomDataGenerator([seed != null ? 'pr' + seed : String(Date.now())]);
      this.content = SS.Data.pruefung;
      this.conviction = 0;          // 0–100, Ziel: Kommission überzeugen
      this.nerves = START_NERVES;   // 0–100, bei 100 Blackout
      this.round = -1;
      this.ended = false;           // Prüfung vorbei (regulär oder Blackout)
      this.phase = 'intro';
      this.inputHandler = null;     // aktuelle Eingabe-Logik (Antwort, Mini-Aufgabe, Zwischenfall)
      this.answerTimer = null;
      this.lineTyper = null;        // Schreibmaschine in der Fragebox
      this.musicOn = false;
      this.activeCleanup = null;    // Aufräumen eines laufenden Zwischenfalls
      // Phaser verwendet das Szenenobjekt beim nächsten Start wieder – die „fertig“-Markierung
      // von SS.SideQuest.finish() muss deshalb zurück, sonst hängt die zweite Prüfung an der Ergebniskarte.
      this.__sideQuestFinished = false;
    }

    create() {
      this.cameras.main.fadeIn(250, 0, 0, 0);
      this.questions = this.pickQuestions();
      this.incidentPlan = this.planIncidents();
      this.projectTitle = this.makeProjectTitle();

      this.buildRoom();
      this.buildExaminers();
      this.buildScreen();
      this.buildPlayer();
      this.buildLighting();
      this.buildHud();
      this.buildQuestionBox();
      this.buildAnswerButtons();
      this.bindInput();
      this.events.once('shutdown', this.onShutdown, this);

      SS.SideQuest.intro(this, {
        tag: 'ENDBOSS',
        title: 'Mündliche Projektarbeitsprüfung',
        subtitle: 'Die Kommission wartet. Der Beamer auch.',
        lines: [
          'Beantworte 6 Fragen – per Klick oder Taste 1–4.',
          'Welcher Antwortstil wirkt, hängt von der Frage ab.',
          'Zwischenfälle schnell lösen, die Zeit läuft!',
          'Nervosität 100 % = Blackout = Note 5,0.'
        ],
        buttonLabel: 'Prüfung beginnen',
        accent: COL.dhbwRed
      }, () => this.startExam());
    }

    // ── Zufall: Fragen, Zwischenfälle, Projekttitel ──────────────
    /** 6 zufällige Fragen; eine harte Frage kommt zum Schluss (Boss-Finale). */
    pickQuestions() {
      const chosen = this.rng.shuffle(this.content.questions.slice()).slice(0, ROUNDS);
      const hardIndex = chosen.findIndex((q) => q.hard);
      if (hardIndex >= 0) chosen.push(chosen.splice(hardIndex, 1)[0]);
      return chosen;
    }

    /** Ordnet 2–3 Zwischenfälle zufälligen Runden zu (nie vor der ersten Frage). */
    planIncidents() {
      const count = this.rng.between(INCIDENTS_MIN, INCIDENTS_MAX);
      const rounds = this.rng.shuffle([1, 2, 3, 4, 5]).slice(0, count);
      const incidents = this.rng.shuffle(this.content.incidents.slice()).slice(0, count);
      const plan = {};
      rounds.forEach((round, i) => { plan[round] = incidents[i]; });
      return plan;
    }

    makeProjectTitle() {
      const p = this.content.titleParts;
      return [p.adjective, p.action, p.subject, p.method].map((list) => this.rng.pick(list)).join(' ');
    }

    // ── Aufbau des Prüfungsraums ─────────────────────────────────
    buildRoom() {
      SS.UI.background(this, 0x1c2238, 0x0b0d18);
      const g = this.add.graphics();
      // Wandverkleidung und Boden
      g.fillStyle(0x232a42, 1).fillRect(0, 196, C.WIDTH, LAYOUT.floorY - 196);
      g.fillStyle(0x3a4466, 1).fillRect(0, 196, C.WIDTH, 3);
      g.fillStyle(0x2b2233, 1).fillRect(0, LAYOUT.floorY, C.WIDTH, LAYOUT.boxY - LAYOUT.floorY);
      g.fillStyle(0x433650, 1).fillRect(0, LAYOUT.floorY, C.WIDTH, 3);
      // Wanduhr über der Kommission (Zeiger dreht sich in update)
      g.fillStyle(0x0f172a, 1).fillCircle(216, 84, 20);
      g.fillStyle(0xf8fafc, 1).fillCircle(216, 84, 17);
      this.clockHand = this.add.graphics({ x: 216, y: 84 });
      this.clockAngle = 0;
      this.buildDesk();
    }

    buildDesk() {
      const x = LAYOUT.deskX;
      const y = LAYOUT.deskY;
      const g = this.add.graphics().setDepth(5);
      g.fillStyle(0xc8a27a, 1).fillRect(x, y, 400, 12);
      g.fillStyle(0x5b4636, 1).fillRect(x + 6, y + 12, 388, 60);
      g.fillStyle(0x4a382b, 1).fillRect(x + 6, y + 64, 388, 8);
      // Kaffeetasse und Stapel mit der ausgedruckten Projektarbeit
      g.fillStyle(0xf8fafc, 1).fillRect(212, y - 14, 14, 14);
      g.lineStyle(3, 0xf8fafc, 1).strokeCircle(229, y - 7, 4);
      g.fillStyle(0xe5e7eb, 1).fillRect(366, y - 9, 38, 9);
      g.fillStyle(0xffffff, 1).fillRect(369, y - 12, 38, 4);
      // Namensschilder
      this.namePlate(LAYOUT.profX, this.content.examiners.prof);
      this.namePlate(LAYOUT.betreuerX, this.content.examiners.betreuer);
    }

    namePlate(x, person) {
      const y = LAYOUT.deskY + 24;
      const g = this.add.graphics().setDepth(6);
      g.fillStyle(0x111827, 1).fillRoundedRect(x - 84, y, 168, 34, 6);
      g.lineStyle(2, 0x6b7280, 1).strokeRoundedRect(x - 84, y, 168, 34, 6);
      SS.UI.text(this, x, y + 10, person.name, 'small', { color: '#ffffff', fontSize: '13px', fontStyle: 'bold' })
        .setOrigin(0.5).setDepth(6);
      SS.UI.text(this, x, y + 25, person.role, 'small', { fontSize: '11px' }).setOrigin(0.5).setDepth(6);
    }

    buildExaminers() {
      this.examiners = {};
      [['prof', LAYOUT.profX], ['betreuer', LAYOUT.betreuerX]].forEach(([id, x]) => {
        const body = this.add.image(0, 0, 'pr_' + id).setOrigin(0.5, 1);
        const face = this.add.image(0, -129, 'pr_face_neutral');
        const parts = [body, face];
        if (id === 'prof') parts.push(this.add.image(0, -134, 'pr_brille'));
        const container = this.add.container(x, LAYOUT.examinerY, parts).setDepth(4);
        // leichtes Atmen, damit die Kommission lebendig wirkt
        this.tweens.add({
          targets: container, y: LAYOUT.examinerY + 2, duration: 1300 + this.rng.between(0, 500),
          yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
        });
        this.examiners[id] = { container, face, x };
      });
    }

    buildScreen() {
      const { screenX: x, screenY: y, screenW: w, screenH: h } = LAYOUT;
      const g = this.add.graphics();
      g.fillStyle(0x9ca3af, 1).fillRect(x - 14, y - 12, w + 28, 8);
      g.fillStyle(0x0f172a, 1).fillRect(x - 6, y - 6, w + 12, h + 12);
      g.fillStyle(0xf8fafc, 1).fillRect(x, y, w, h);
      g.fillStyle(COL.dhbwRed, 1).fillRect(x, y, w, 26);
      SS.UI.text(this, x + 12, y + 13, 'DHBW', 'h2', { fontSize: '15px', strokeThickness: 0 }).setOrigin(0, 0.5);
      SS.UI.text(this, x + w - 12, y + 13, 'Projektarbeit', 'small', { color: '#ffffff', fontSize: '13px' }).setOrigin(1, 0.5);
      SS.UI.text(this, x + w / 2, y + 90, this.projectTitle, 'h2', {
        fontSize: '18px', color: '#1f2937', strokeThickness: 0, align: 'center', wordWrap: { width: w - 40 }
      }).setOrigin(0.5);
      SS.UI.text(this, x + w / 2, y + 152, 'Mündliche Prüfung zur Projektarbeit', 'small', { color: '#6b7280', fontSize: '13px' })
        .setOrigin(0.5);
      this.slideNumber = SS.UI.text(this, x + w - 10, y + h - 8, '', 'small', { color: '#6b7280', fontSize: '11px' })
        .setOrigin(1, 1);
      this.setSlideNumber(1);
      // Overlay für Zwischenfälle („Kein Signal“, Absturz …)
      this.screenOverlay = this.add.rectangle(x, y, w, h, 0x1d4ed8, 1).setOrigin(0).setVisible(false);
      this.screenOverlayText = SS.UI.text(this, x + w / 2, y + h / 2, '', 'h2', { fontSize: '22px', align: 'center' })
        .setOrigin(0.5).setVisible(false);
    }

    setSlideNumber(n) {
      this.slideNumber.setText('Folie ' + n + ' von 47');
    }

    showScreenOverlay(text, color) {
      this.screenOverlay.setFillStyle(color, 1).setVisible(true);
      this.screenOverlayText.setText(text).setVisible(true);
    }

    hideScreenOverlay() {
      this.screenOverlay.setVisible(false);
      this.screenOverlayText.setVisible(false);
    }

    buildPlayer() {
      const { cubeX: x, cubeY: y } = LAYOUT;
      this.add.ellipse(x, y + 30, 64, 12, 0x000000, 0.4);
      this.cube = this.add.image(x, y, 'pr_cube').setDepth(8);
      this.sweat = this.add.image(x + 30, y - 22, 'pr_sweat').setDepth(9).setVisible(false);
    }

    buildLighting() {
      this.spot = this.add.image(LAYOUT.cubeX, 40, 'pr_spot').setOrigin(0.5, 0)
        .setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.22).setDepth(10);
      this.tweens.add({ targets: this.spot, alpha: 0.3, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      // scrollFactor 0: decken auch bei Kamerafahrt und Zoom das ganze Bild ab
      this.vignette = this.add.image(0, 0, 'pr_vignette').setOrigin(0).setScrollFactor(0).setDepth(20);
      this.lightsOut = this.add.rectangle(0, 0, C.WIDTH, C.HEIGHT, 0x000000, 1).setOrigin(0).setScrollFactor(0)
        .setAlpha(0).setDepth(35);   // über allem außer Würfel und Lichtkegel beim Blackout
      this.updateVignette(0);
    }

    /** Je nervöser, desto enger der Tunnelblick. */
    updateVignette(duration) {
      const alpha = 0.25 + 0.6 * (this.nerves / 100);
      this.tweens.add({ targets: this.vignette, alpha, duration: duration == null ? 400 : duration });
    }

    // ── HUD: Balken und Runde ────────────────────────────────────
    buildHud() {
      const { barY, barW } = LAYOUT;
      this.shown = { conviction: this.conviction, nerves: this.nerves };   // angezeigte (getweente) Werte
      SS.UI.text(this, 24, barY - 18, 'ÜBERZEUGUNG DER KOMMISSION', 'small', { fontSize: '13px', fontStyle: 'bold', color: C.CSS.ink })
        .setDepth(30);
      SS.UI.text(this, C.WIDTH - 24, barY - 18, 'NERVOSITÄT', 'small', { fontSize: '13px', fontStyle: 'bold', color: C.CSS.ink })
        .setOrigin(1, 0).setDepth(30);
      this.barGraphics = this.add.graphics().setDepth(30);
      this.convictionText = SS.UI.text(this, 24 + barW - 8, barY + 8, '', 'hud', { fontSize: '13px', strokeThickness: 3 })
        .setOrigin(1, 0.5).setDepth(31);
      this.nervesText = SS.UI.text(this, C.WIDTH - 24 - 8, barY + 8, '', 'hud', { fontSize: '13px', strokeThickness: 3 })
        .setOrigin(1, 0.5).setDepth(31);
      this.roundText = SS.UI.text(this, C.WIDTH / 2, barY + 4, 'PRÜFUNG', 'hud', { fontSize: '20px' }).setOrigin(0.5).setDepth(30);
      this.drawBars();
    }

    drawBars() {
      const { barY: y, barW: w, barH: h } = LAYOUT;
      const g = this.barGraphics;
      const nervesColor = this.shown.nerves >= 70 ? COL.danger : COL.orange;
      g.clear();
      this.drawBar(g, 24, y, w, h, this.shown.conviction, COL.green);
      this.drawBar(g, C.WIDTH - 24 - w, y, w, h, this.shown.nerves, nervesColor);
      this.convictionText.setText(Math.round(this.shown.conviction) + ' %');
      this.nervesText.setText(Math.round(this.shown.nerves) + ' %');
    }

    drawBar(g, x, y, w, h, value, color) {
      g.fillStyle(0x000000, 0.6).fillRoundedRect(x, y, w, h, h / 2);
      if (value > 0) g.fillStyle(color, 1).fillRoundedRect(x + 2, y + 2, Math.max(h - 4, (w - 4) * value / 100), h - 4, (h - 4) / 2);
      g.lineStyle(2, 0xffffff, 0.85).strokeRoundedRect(x, y, w, h, h / 2);
    }

    // ── Fragebox und Antwort-Buttons ─────────────────────────────
    buildQuestionBox() {
      SS.UI.panel(this, 24, LAYOUT.boxY, C.WIDTH - 48, LAYOUT.boxH, { radius: 12 }).setDepth(30);
      this.speakerText = SS.UI.text(this, 44, LAYOUT.boxY + 10, '', 'small', { fontSize: '14px', fontStyle: 'bold', color: C.CSS.yellow })
        .setDepth(31);
      this.lineText = SS.UI.text(this, 44, LAYOUT.boxY + 32, '', 'body', { fontSize: '19px', wordWrap: { width: C.WIDTH - 88 } })
        .setDepth(31);
      this.hardTag = SS.UI.text(this, C.WIDTH - 44, LAYOUT.boxY + 10, 'HARTE FRAGE', 'small', {
        fontSize: '13px', fontStyle: 'bold', color: C.CSS.danger
      }).setOrigin(1, 0).setDepth(31).setVisible(false);
    }

    buildAnswerButtons() {
      const { buttonW, buttonH, buttonRows, buttonCols } = LAYOUT;
      this.answerButtons = this.content.styles.map((style, i) => {
        const x = buttonCols[i % 2];
        const y = buttonRows[Math.floor(i / 2)];
        const btn = SS.UI.button(this, x, y, (i + 1) + '  ' + style.label, () => this.chooseStyle(style.id), {
          width: buttonW, height: buttonH, color: style.color, fontSize: '19px'
        });
        btn.labelText.setY(-9);
        btn.add(SS.UI.text(this, 0, 14, style.hint, 'small', { fontSize: '13px', color: '#e5e7eb' }).setOrigin(0.5));
        return btn.setDepth(30).setEnabled(false);
      });
    }

    setAnswersEnabled(enabled) {
      this.answerButtons.forEach((btn) => btn.setEnabled(enabled));
    }

    // ── Eingabe: eine zentrale Weiche für Tasten und Klicks ─────
    bindInput() {
      INPUT_KEYS.forEach((key) => SS.UI.onKey(this, key, () => this.handleInput(key)));
      this.onPointerDown = () => this.handleInput('POINTER');
      this.input.on('pointerdown', this.onPointerDown);
    }

    handleInput(input) {
      if (this.inputHandler && !this.ended) this.inputHandler(input);
    }

    onShutdown() {
      this.input.off('pointerdown', this.onPointerDown);
      if (this.activeCleanup) this.activeCleanup();
      if (this.answerTimer) this.answerTimer.destroy();
      if (this.musicOn) SS.Audio.music.stop();
    }

    // ── Prüfungsablauf ───────────────────────────────────────────
    startExam() {
      SS.Audio.music.play('boss');
      this.musicOn = true;
      const cam = this.cameras.main;
      cam.setZoom(1.15);
      cam.zoomTo(1, 900, 'Cubic.easeOut', true);
      SS.UI.banner(this, 'ENDBOSS', 'Die Kommission bittet zur Prüfung.', {
        duration: 1100, color: COL.dhbwRed, onDone: () => this.nextRound()
      });
    }

    nextRound() {
      if (this.ended) return;
      this.round += 1;
      if (this.round >= ROUNDS) {
        this.finishExam();
        return;
      }
      this.roundText.setText('FRAGE ' + (this.round + 1) + ' / ' + ROUNDS);
      this.setSlideNumber(this.round + 2);
      const ask = () => this.askQuestion(this.questions[this.round]);
      const incident = this.incidentPlan[this.round];
      if (incident) this.runIncident(incident, ask);
      else ask();
    }

    askQuestion(question) {
      if (this.ended) return;
      this.phase = 'answer';
      this.currentQuestion = question;
      this.setMood(question.asker, question.hard ? 'skeptical' : 'neutral');
      this.setMood(this.otherExaminer(question.asker), 'neutral');
      this.leanIn(question.asker);
      this.speakerText.setText(this.content.examiners[question.asker].name + ' fragt:').setColor(C.CSS.yellow);
      this.lineText.setColor(C.CSS.ink);
      this.hardTag.setVisible(!!question.hard);
      if (question.hard && this.hardQuestionEffects()) return;
      SS.Audio.sfx('type');
      this.typeLine(question.text, QUESTION_CPS, () => this.onQuestionTyped());
      this.setAnswersEnabled(true);
      this.inputHandler = (input) => {
        const index = ANSWER_KEYS.indexOf(input);
        if (index >= 0) this.answerButtons[index].press();
      };
    }

    /** Harte Frage: Wackeln, roter Blitz, Zoom – und etwas mehr Nervosität. true = Blackout. */
    hardQuestionEffects() {
      SS.UI.shake(this, 320, 0.01);
      SS.Audio.sfx('buzz');
      this.cameras.main.flash(180, 140, 0, 0);
      this.zoomPulse(1.06);
      return this.applyDelta([0, HARD_QUESTION_NERVES]);
    }

    /** Erst wenn die Frage komplett dasteht, läuft die Antwortzeit. */
    onQuestionTyped() {
      if (this.phase !== 'answer' || this.answerTimer) return;
      this.answerTimer = SS.UI.timerBar(this, 24, LAYOUT.timerY, C.WIDTH - 48, 16, ANSWER_MS, {
        depth: 31, color: COL.cyan, onDone: () => this.chooseStyle('schwafeln', true)
      });
    }

    chooseStyle(styleId, timedOut) {
      if (this.phase !== 'answer' || this.ended) return;
      this.phase = 'resolve';
      this.inputHandler = null;
      this.setAnswersEnabled(false);
      this.finishTyping();
      this.stopAnswerTimer();
      this.hardTag.setVisible(false);
      this.cameras.main.zoomTo(1, 220, 'Cubic.easeOut', true);
      this.punchButton(styleId);
      if (styleId === 'fundiert') {
        this.runArgumentCheck(this.currentQuestion.hard, (ok) => this.resolveAnswer(styleId, { taskSuccess: ok }));
      } else {
        this.resolveAnswer(styleId, { timedOut: !!timedOut });
      }
    }

    resolveAnswer(styleId, opts) {
      if (this.ended) return;
      const question = this.currentQuestion;
      const result = this.evaluateAnswer(question, styleId, opts);
      this.showPlayerLine(result.playerLine);
      this.later(1000, () => {
        this.showReaction(question.asker, result);
        if (this.applyDelta(result.delta)) return;   // Blackout beendet die Prüfung
        this.later(2200, () => this.nextRound());
      });
    }

    /** Wirkung, Texte und Gesicht einer Antwort – abhängig von Stil und Frage. */
    evaluateAnswer(question, styleId, opts) {
      const style = this.content.styles.find((s) => s.id === styleId);
      const fit = question.best === styleId ? 'best' : (question.worst === styleId ? 'worst' : 'normal');
      let outcome = styleId;
      let reaction = question.reactions[styleId];
      let playerLine = this.rng.pick(style.playerLines);
      if (styleId === 'fundiert' && !opts.taskSuccess) {
        outcome = 'fundiertFail';
        reaction = this.rng.pick(style.failLines);
        playerLine = style.failPlayerLine;
      } else if (styleId === 'buzzword') {
        const jackpot = this.rng.frac() < JACKPOT_CHANCE[fit];
        outcome = jackpot ? 'buzzwordJackpot' : 'buzzwordFlop';
        if (jackpot) reaction = question.jackpot || this.rng.pick(style.jackpotLines);
      } else if (opts.timedOut) {
        playerLine = this.content.timeoutLine;
      }
      const delta = EFFECTS[outcome][fit];
      return { outcome, fit, delta, reaction, playerLine, mood: this.moodFor(outcome, delta[0]) };
    }

    moodFor(outcome, gain) {
      if (outcome === 'schwafeln') return gain < 0 ? 'angry' : 'bored';
      if (gain >= 14) return 'happy';
      if (gain >= 6) return 'neutral';
      return gain < 0 ? 'angry' : 'skeptical';
    }

    showPlayerLine(text) {
      this.speakerText.setText('Sie:').setColor(C.CSS.cyan);
      this.lineText.setText('„' + text + '“').setColor('#e0f2fe');
      this.tweens.add({ targets: this.cube, y: LAYOUT.cubeY - 10, duration: 110, yoyo: true, ease: 'Quad.easeOut' });
    }

    showReaction(askerId, result) {
      const second = result.outcome === 'buzzwordJackpot' ? 'shocked' : SECOND_MOOD[result.mood];
      this.speakerText.setText(this.content.examiners[askerId].name + ':').setColor(C.CSS.yellow);
      this.lineText.setColor(MOOD_COLORS[result.mood]);
      this.typeLine(result.reaction, 60);
      this.setMood(askerId, result.mood);
      this.setMood(this.otherExaminer(askerId), second);
      this.leanIn(null);
      this.answerJuice(result);
    }

    /** Sound, Partikel und Kamera passend zum Ergebnis. */
    answerJuice(result) {
      const gain = result.delta[0];
      const x = this.examiners[this.currentQuestion.asker].x;
      if (result.outcome === 'buzzwordJackpot') {
        SS.Audio.sfx('win');
        this.zoomPulse(1.07);
        SS.UI.burst(this, x, 130, { texture: 'spark', tint: [COL.magenta, COL.yellow, 0xffffff], count: 30, gravityY: 0, depth: 40 });
      } else if (gain >= 14) {
        SS.Audio.sfx('success');
        SS.UI.burst(this, x, 130, { texture: 'spark', tint: [COL.green, 0xffffff], count: 16, gravityY: 0, depth: 40 });
      } else if (gain < 0) {
        SS.Audio.sfx('error');
        SS.UI.shake(this, 220, 0.01);
      } else {
        SS.Audio.sfx(result.outcome === 'schwafeln' ? 'buzz' : 'click');
      }
    }

    /**
     * Ändert beide Balken um delta = [Δ Überzeugung, Δ Nervosität].
     * @returns {boolean} true, wenn dadurch der Blackout eintritt
     */
    applyDelta(delta) {
      const [dc, dn] = delta;
      this.conviction = clamp100(this.conviction + dc);
      this.nerves = clamp100(this.nerves + dn);
      const y = LAYOUT.barY + 32;
      if (dc) this.floatText(24 + LAYOUT.barW / 2, y, (dc > 0 ? '+' : '') + dc, dc > 0 ? C.CSS.green : C.CSS.danger);
      if (dn) this.floatText(C.WIDTH - 24 - LAYOUT.barW / 2, y, (dn > 0 ? '+' : '') + dn, dn > 0 ? C.CSS.danger : C.CSS.green);
      this.tweens.killTweensOf(this.shown);
      this.tweens.add({
        targets: this.shown, conviction: this.conviction, nerves: this.nerves,
        duration: 500, ease: 'Cubic.easeOut', onUpdate: () => this.drawBars()
      });
      this.updateVignette();
      this.sweat.setVisible(this.nerves >= 60);
      if (this.nerves >= 100) {
        this.triggerBlackout();
        return true;
      }
      return false;
    }

    // ── kleine Bausteine ─────────────────────────────────────────
    /** Wie delayedCall, aber nach Prüfungsende wirkungslos. */
    later(ms, fn) {
      return this.time.delayedCall(ms, () => { if (!this.ended) fn(); });
    }

    /** Schreibt einen Text in die Fragebox (bricht einen laufenden Typewriter ab). */
    typeLine(text, cps, onDone) {
      this.finishTyping();
      this.lineTyper = SS.UI.typewriter(this, this.lineText, text, { cps, onDone });
    }

    finishTyping() {
      if (this.lineTyper && !this.lineTyper.isDone()) this.lineTyper.skip();
    }

    stopAnswerTimer() {
      if (!this.answerTimer) return;
      this.answerTimer.destroy();
      this.answerTimer = null;
    }

    otherExaminer(id) {
      return id === 'prof' ? 'betreuer' : 'prof';
    }

    setMood(id, mood) {
      const examiner = this.examiners[id];
      if (!examiner || examiner.mood === mood) return;
      examiner.mood = mood;
      examiner.face.setTexture('pr_face_' + mood);
      this.tweens.add({ targets: examiner.face, scaleY: { from: 0.6, to: 1 }, duration: 180, ease: 'Back.easeOut' });
    }

    /** Wer fragt, beugt sich nach vorn (id = null: alle lehnen sich zurück). */
    leanIn(id) {
      Object.keys(this.examiners).forEach((key) => {
        this.tweens.add({ targets: this.examiners[key].container, scale: key === id ? 1.07 : 1, duration: 260, ease: 'Back.easeOut' });
      });
    }

    punchButton(styleId) {
      const index = this.content.styles.findIndex((s) => s.id === styleId);
      const btn = this.answerButtons[index];
      if (btn) this.tweens.add({ targets: btn, scale: 1.08, duration: 90, yoyo: true });
    }

    floatText(x, y, text, color) {
      const t = SS.UI.text(this, x, y, text, 'hud', { fontSize: '22px', color }).setOrigin(0.5).setDepth(40);
      this.tweens.add({ targets: t, y: y + 26, alpha: 0, duration: 1100, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
    }

    zoomPulse(zoom) {
      const cam = this.cameras.main;
      cam.zoomTo(zoom, 160, 'Cubic.easeOut', true);
      this.later(260, () => cam.zoomTo(1, 420, 'Cubic.easeOut', true));
    }

    // ── Mini-Aufgabe „Fundiert“: Zeiger im grünen Bereich stoppen ─
    runArgumentCheck(hard, done) {
      this.phase = 'task';
      const zoneWidth = hard ? ARGUMENT.hardZone : ARGUMENT.zone;
      const zoneStart = this.rng.realInRange(0.08, 0.92 - zoneWidth);
      const bar = { x: 84, y: 524, w: C.WIDTH - 168, h: 22 };
      const panel = SS.UI.panel(this, 24, 450, C.WIDTH - 48, 126, { lineColor: COL.blue, lineWidth: 3, alpha: 1 });
      const title = SS.UI.text(this, C.WIDTH / 2, 474, 'Belege dein Argument!', 'h2', { fontSize: '20px' }).setOrigin(0.5);
      const hint = SS.UI.text(this, C.WIDTH / 2, 500, 'Stoppe den Zeiger im grünen Bereich – Leertaste oder Klick', 'small', {
        fontSize: '14px'
      }).setOrigin(0.5);
      const g = this.add.graphics();
      g.fillStyle(0x000000, 0.6).fillRoundedRect(bar.x, bar.y, bar.w, bar.h, 6);
      g.lineStyle(2, 0xffffff, 0.8).strokeRoundedRect(bar.x, bar.y, bar.w, bar.h, 6);
      const zone = this.add.rectangle(bar.x + bar.w * zoneStart, bar.y + 2, bar.w * zoneWidth, bar.h - 4, COL.green).setOrigin(0);
      const marker = this.add.rectangle(bar.x, bar.y + bar.h / 2, 6, bar.h + 16, 0xffffff);
      const layer = this.add.container(0, 0, [panel, title, hint, g, zone, marker]).setDepth(50);
      const sweep = this.tweens.add({
        targets: marker, x: bar.x + bar.w, duration: hard ? ARGUMENT.hardSweepMs : ARGUMENT.sweepMs, yoyo: true, repeat: -1
      });

      let finished = false;
      const finish = (ok) => {
        if (finished) return;
        finished = true;
        this.inputHandler = null;
        sweep.stop();
        timeout.remove(false);
        title.setText(ok ? 'Treffer – das sitzt!' : 'Daneben …').setColor(ok ? C.CSS.green : C.CSS.danger);
        SS.Audio.sfx(ok ? 'coin' : 'error');
        if (ok) {
          SS.UI.burst(this, marker.x, marker.y, { texture: 'spark', tint: [COL.green, 0xffffff], count: 18, gravityY: 0, depth: 60 });
        }
        this.later(650, () => {
          layer.destroy();
          done(ok);
        });
      };
      const timeout = this.time.delayedCall(ARGUMENT.timeoutMs, () => finish(false));
      const armedAt = this.time.now + ARGUMENT.armMs;
      this.inputHandler = (input) => {
        if (input !== 'SPACE' && input !== 'POINTER') return;
        if (this.time.now < armedAt) return;   // Doppelklick-Schutz
        finish(marker.x >= zone.x && marker.x <= zone.x + zone.width);
      };
    }

    // ── Zwischenfälle (Quick-Time-Events) ────────────────────────
    /** Baut das Zwischenfall-Fenster, startet das passende Minispiel und wertet es aus. */
    runIncident(def, done) {
      const game = INCIDENT_GAMES[def.id];
      const o = LAYOUT.overlay;
      this.phase = 'incident';
      this.setAnswersEnabled(false);
      this.speakerText.setText('ZWISCHENFALL!').setColor(C.CSS.danger);
      this.lineText.setText(def.title).setColor(C.CSS.ink);
      SS.Audio.sfx('error');
      SS.UI.shake(this, 220, 0.008);

      const layer = this.add.container(0, 0, [
        this.add.rectangle(0, 0, C.WIDTH, C.HEIGHT, 0x000000, 0.45).setOrigin(0),
        SS.UI.panel(this, o.x, o.y, o.w, o.h, { lineColor: COL.danger, lineWidth: 3 }),
        SS.UI.text(this, C.WIDTH / 2, o.y + 30, def.title, 'h2', { fontSize: '24px', color: C.CSS.yellow }).setOrigin(0.5),
        SS.UI.text(this, C.WIDTH / 2, o.y + 64, def.hint, 'small', {
          fontSize: '15px', align: 'center', wordWrap: { width: o.w - 60 }
        }).setOrigin(0.5)
      ]).setDepth(60).setAlpha(0);
      this.tweens.add({ targets: layer, alpha: 1, duration: 160 });

      // ctx: Spielfläche im Fenster + optionale Aufräum-Funktion des Minispiels
      const ctx = { layer, area: { x: o.x, y: o.y + 90, w: o.w, h: o.h - 130 }, cleanup: null };
      let finished = false;
      const finish = (ok) => {
        if (finished) return;
        finished = true;
        this.inputHandler = null;
        timer.destroy();
        if (ctx.cleanup) ctx.cleanup();
        this.activeCleanup = null;
        this.hideScreenOverlay();
        this.incidentResult(def, ok, layer, done);
      };
      const timer = SS.UI.timerBar(this, o.x + 30, o.y + o.h - 30, o.w - 60, 14, game.ms, {
        depth: 61, onDone: () => finish(false)
      });
      this[game.method](ctx, finish);
      this.activeCleanup = ctx.cleanup;
    }

    incidentResult(def, ok, layer, done) {
      SS.Audio.sfx(ok ? 'success' : 'fail');
      this.speakerText.setText(ok ? 'GERETTET!' : 'AUTSCH …').setColor(ok ? C.CSS.green : C.CSS.danger);
      this.lineText.setText(ok ? def.success : def.fail).setColor(C.CSS.ink);
      this.setMood('prof', ok ? 'happy' : 'shocked');
      this.setMood('betreuer', ok ? 'happy' : 'shocked');
      if (!ok) SS.UI.shake(this, 260, 0.012);
      this.tweens.add({ targets: layer, alpha: 0, duration: 220, delay: 250, onComplete: () => layer.destroy() });
      if (this.applyDelta(INCIDENT_EFFECTS[ok ? 'success' : 'fail'])) return;
      this.later(1600, done);
    }

    /** Beamer: den richtigen HDMI-Eingang finden (Klick oder Taste 1–3). */
    qteBeamer(ctx, finish) {
      const correct = this.rng.between(1, 3);
      this.showScreenOverlay('KEIN SIGNAL', 0x1d4ed8);
      const tryInput = (n, btn) => {
        if (!this.inputHandler) return;   // schon gelöst oder Zeit um – das Fenster blendet nur noch aus
        if (n === correct) {
          finish(true);
          return;
        }
        btn.setEnabled(false).setLabel('HDMI ' + n + ' ✗');
        SS.Audio.sfx('error');
        SS.UI.shake(this, 120, 0.006);
        this.showScreenOverlay('HDMI ' + n + '\nKEIN SIGNAL', 0x1d4ed8);
      };
      const buttons = [1, 2, 3].map((n, i) => {
        const btn = SS.UI.button(this, C.WIDTH / 2 + (i - 1) * 170, ctx.area.y + 76, 'HDMI ' + n, () => tryInput(n, btn), {
          width: 150, height: 58, color: COL.dhbwGray
        });
        ctx.layer.add(btn);
        return btn;
      });
      this.inputHandler = (input) => {
        const index = ANSWER_KEYS.indexOf(input);
        if (index >= 0 && index < buttons.length) buttons[index].press();
      };
    }

    /** Live-Demo: angezeigte Pfeil-Folge nachtippen – Pfeiltasten oder Buttons (Fehler = von vorn). */
    qteDemo(ctx, finish) {
      this.showScreenOverlay('Fehler 500\nDemo abgestürzt', 0x7f1d1d);
      const keys = Object.keys(ARROWS);
      const sequence = Array.from({ length: QTE.demoLength }, () => this.rng.pick(keys));
      const spacing = 70;
      const startX = C.WIDTH / 2 - (spacing * (sequence.length - 1)) / 2;
      const y = ctx.area.y + 76;
      const caps = sequence.map((key, i) => {
        const cap = this.add.rectangle(startX + i * spacing, y, 56, 56, 0x111827);
        const arrow = this.add.image(startX + i * spacing, y, 'pr_pfeil').setAngle(ARROWS[key]);
        ctx.layer.add([cap, arrow]);
        return { cap, arrow };
      });
      // Pfeil-Buttons für Maus und Touch: wirken wie die Pfeiltasten
      ARROW_BUTTONS.forEach((key, i) => {
        const btn = SS.UI.button(this, C.WIDTH / 2 + (i - 1.5) * 96, ctx.area.y + 148, '', () => this.handleInput(key), {
          width: 80, height: 48, color: COL.dhbwGray
        });
        btn.add(this.add.image(0, 0, 'pr_pfeil').setAngle(ARROWS[key]).setScale(0.8));
        ctx.layer.add(btn);
      });
      let progress = 0;
      const paint = () => caps.forEach((c, i) => {
        const doneKey = i < progress;
        c.cap.setStrokeStyle(3, doneKey ? COL.green : (i === progress ? COL.yellow : 0x6b7280));
        c.arrow.setTint(doneKey ? COL.green : 0xffffff);
      });
      paint();
      this.inputHandler = (input) => {
        if (!(input in ARROWS)) return;
        if (input === sequence[progress]) {
          progress += 1;
          SS.Audio.sfx('tick');
        } else {
          progress = 0;
          SS.Audio.sfx('error');
          SS.UI.shake(this, 120, 0.006);
        }
        paint();
        if (progress >= sequence.length) finish(true);
      };
    }

    /** Akku: Stecker pendelt über der Buchse – im richtigen Moment einstecken. */
    qteAkku(ctx, finish) {
      const { area } = ctx;
      const game = INCIDENT_GAMES.akku;
      const portX = C.WIDTH / 2 + this.rng.between(-150, 150);
      const portY = area.y + 108;
      this.showScreenOverlay('Akku: 3 %', 0x111827);
      const g = this.add.graphics();
      g.fillStyle(0x9ca3af, 1).fillRoundedRect(area.x + 40, portY, area.w - 80, 26, 6);
      const port = this.add.rectangle(portX, portY + 9, 18, 12, 0x111827).setStrokeStyle(2, COL.yellow);
      const portLabel = SS.UI.text(this, portX, portY + 40, 'Ladebuchse', 'small', { fontSize: '13px', color: C.CSS.yellow })
        .setOrigin(0.5);
      const battery = SS.UI.text(this, area.x + area.w - 50, area.y + 4, 'Akku: 3 %', 'hud', { fontSize: '18px', color: C.CSS.danger })
        .setOrigin(1, 0);
      const plug = this.add.image(area.x + 60, portY - 74, 'pr_stecker').setOrigin(0.5, 0);
      ctx.layer.add([g, port, portLabel, battery, plug]);

      const sweep = this.tweens.add({ targets: plug, x: area.x + area.w - 60, duration: QTE.akkuSweepMs, yoyo: true, repeat: -1 });
      const blink = this.tweens.add({ targets: battery, alpha: 0.35, duration: 250, yoyo: true, repeat: -1 });
      let percent = 3;
      const drain = this.time.addEvent({
        delay: game.ms / 3, repeat: 1,
        callback: () => { percent -= 1; battery.setText('Akku: ' + percent + ' %'); }
      });
      ctx.cleanup = () => { sweep.stop(); blink.stop(); drain.remove(false); };

      let plugged = false;
      let lockedUntil = 0;   // nach einem Fehlversuch kurz gesperrt (sonst hilft Dauerklicken)
      this.inputHandler = (input) => {
        if (plugged || this.time.now < lockedUntil || (input !== 'SPACE' && input !== 'POINTER')) return;
        if (Math.abs(plug.x - port.x) > QTE.akkuTolerance) {
          lockedUntil = this.time.now + QTE.akkuMissLockMs;
          SS.Audio.sfx('error');
          SS.UI.shake(this, 90, 0.004);
          this.tweens.add({ targets: plug, angle: { from: -12, to: 0 }, duration: 300, ease: 'Back.easeOut' });
          return;
        }
        plugged = true;
        sweep.stop();
        plug.x = port.x;
        battery.setText('Lädt …').setColor(C.CSS.green);
        // sofort werten – sonst kann die Zeit noch während der Steck-Animation ablaufen
        this.tweens.add({ targets: plug, y: plug.y + 16, duration: 140, ease: 'Quad.easeIn' });
        finish(true);
      };
    }

    /** Folie hängt: Leertaste hämmern, bevor der Fortschritt wieder abfällt. */
    qteFolie(ctx, finish) {
      const { area } = ctx;
      const bar = { x: area.x + 60, y: area.y + 56, w: area.w - 120, h: 28 };
      this.showScreenOverlay('Folie lädt …', 0x334155);
      const g = this.add.graphics();
      const label = SS.UI.text(this, C.WIDTH / 2, bar.y + 70, 'LEERTASTE!', 'h2', { fontSize: '28px', color: C.CSS.yellow }).setOrigin(0.5);
      ctx.layer.add([g, label]);
      let progress = 0;
      const draw = () => {
        g.clear();
        this.drawBar(g, bar.x, bar.y, bar.w, bar.h, progress, COL.cyan);
      };
      const decay = (time, delta) => {
        progress = Math.max(0, progress - QTE.folieDecayPerSec * delta / 1000);
        draw();
      };
      this.events.on('update', decay);
      ctx.cleanup = () => this.events.off('update', decay);
      draw();
      this.inputHandler = (input) => {
        if (input !== 'SPACE' && input !== 'POINTER') return;
        progress = Math.min(100, progress + QTE.foliePerPress);
        SS.Audio.sfx('tick');
        this.tweens.add({ targets: label, scale: { from: 1.25, to: 1 }, duration: 90 });
        draw();
        if (progress >= 100) finish(true);
      };
    }

    /** Tafel: Reaktionsspiel – erst bei „JETZT!“ drücken. */
    qteTafel(ctx, finish) {
      const { area } = ctx;
      this.setMood('prof', 'skeptical');
      const board = this.add.image(C.WIDTH / 2, area.y + 70, 'pr_tafel');
      const formula = SS.UI.text(this, C.WIDTH / 2, area.y + 40, '', 'body', { fontSize: '24px', color: '#ecfccb' }).setOrigin(0.5);
      const signal = SS.UI.text(this, C.WIDTH / 2, area.y + 100, 'Warte …', 'h2', { fontSize: '28px', color: '#d1d5db' }).setOrigin(0.5);
      ctx.layer.add([board, formula, signal]);
      const typer = SS.UI.typewriter(this, formula, this.rng.pick(this.content.formulas), { cps: 16 });

      let ready = false;
      let reactTimer = null;
      const go = this.time.delayedCall(this.rng.between(QTE.tafelMinWait, QTE.tafelMaxWait), () => {
        ready = true;
        signal.setText('JETZT!').setColor(C.CSS.yellow);
        SS.Audio.sfx('tick');
        this.tweens.add({ targets: signal, scale: { from: 1.7, to: 1 }, duration: 160, ease: 'Back.easeOut' });
        reactTimer = this.time.delayedCall(QTE.tafelReactMs, () => {
          signal.setText('Zu langsam!').setColor(C.CSS.danger);
          finish(false);
        });
      });
      ctx.cleanup = () => {
        if (!typer.isDone()) typer.skip();
        go.remove(false);
        if (reactTimer) reactTimer.remove(false);
      };
      this.inputHandler = (input) => {
        if (input !== 'SPACE' && input !== 'POINTER') return;
        if (!ready) {
          signal.setText('Zu früh – Kreide abgebrochen!').setColor(C.CSS.danger);
          finish(false);
          return;
        }
        signal.setText('Q. e. d.!').setColor(C.CSS.green);
        finish(true);
      };
    }

    // ── Ende: Beratung, Note, Ergebniskarte ──────────────────────
    finishExam() {
      this.ended = true;
      this.phase = 'ending';
      this.inputHandler = null;
      this.setAnswersEnabled(false);
      this.roundText.setText('BERATUNG');
      this.speakerText.setText('Kommission:').setColor(C.CSS.yellow);
      this.lineText.setText('Einen Moment bitte, wir beraten uns …').setColor(C.CSS.ink);
      this.setMood('prof', 'neutral');
      this.setMood('betreuer', 'neutral');
      // Köpfe zusammenstecken und tuscheln
      this.tweens.add({ targets: this.examiners.prof.container, x: LAYOUT.profX + 28, duration: 400, yoyo: true, hold: 900 });
      this.tweens.add({ targets: this.examiners.betreuer.container, x: LAYOUT.betreuerX - 28, duration: 400, yoyo: true, hold: 900 });
      const grade = gradeFor(this.conviction, this.nerves);
      this.time.delayedCall(1900, () => this.revealGrade(grade));
    }

    revealGrade(grade) {
      const passed = grade <= C.PASS_GRADE;
      const color = passed ? COL.green : COL.danger;
      const verdict = this.content.verdicts.find((v) => grade <= v.maxGrade).text;
      const mood = !passed ? 'angry' : (grade <= 2.7 ? 'happy' : 'neutral');
      this.setMood('prof', mood);
      this.setMood('betreuer', mood);
      this.speakerText.setText(this.content.examiners.prof.name + ':').setColor(C.CSS.yellow);
      this.typeLine(verdict, 50);

      // Notenstempel landet auf der Beamer-Leinwand (deckend, sonst scheint der Folientitel durch)
      const g = this.add.graphics();
      g.fillStyle(0x0f172a, 1).fillRoundedRect(-125, -64, 250, 128, 16);
      g.lineStyle(5, color, 1).strokeRoundedRect(-125, -64, 250, 128, 16);
      const stamp = this.add.container(LAYOUT.screenX + LAYOUT.screenW / 2, LAYOUT.screenY + LAYOUT.screenH / 2 + 4, [
        g,
        SS.UI.text(this, 0, -42, 'NOTE', 'small', { fontSize: '16px', fontStyle: 'bold', color: C.CSS.inkSoft }).setOrigin(0.5),
        SS.UI.text(this, 0, 10, SS.State.formatGrade(grade), 'title', { fontSize: '68px', color: SS.Textures.hex(color) }).setOrigin(0.5)
      ]).setDepth(70).setScale(2.6).setAlpha(0).setAngle(-8);
      this.tweens.add({
        targets: stamp, scale: 1, alpha: 1, angle: -3, duration: 280, ease: 'Back.easeOut',
        onComplete: () => {
          SS.UI.shake(this, 260, 0.014);
          SS.Audio.sfx(passed ? 'win' : 'lose');
          SS.UI.burst(this, stamp.x, stamp.y, { texture: 'spark', tint: [color, 0xffffff, COL.yellow], count: 34, gravityY: 0, depth: 71 });
        }
      });
      this.time.delayedCall(2800, () => this.showResult(grade, verdict, false));
    }

    /** Totaler Blackout: Licht aus, Kamera rauscht auf den Würfel, Note 5,0. */
    triggerBlackout() {
      this.ended = true;
      this.phase = 'ending';
      this.inputHandler = null;
      this.setAnswersEnabled(false);
      this.stopAnswerTimer();
      this.finishTyping();
      this.stopMusic();
      SS.Audio.sfx('lose');
      this.setMood('prof', 'shocked');
      this.setMood('betreuer', 'shocked');
      this.roundText.setText('BLACKOUT');
      this.speakerText.setText('Sie:').setColor(C.CSS.cyan);
      this.lineText.setText('… … …').setColor('#9ca3af');

      const cam = this.cameras.main;
      cam.shake(500, 0.015);
      cam.pan(LAYOUT.cubeX, LAYOUT.cubeY, 900, 'Cubic.easeOut', true);
      cam.zoomTo(1.5, 900, 'Cubic.easeOut', true);
      // Licht aus – nur der Würfel bleibt im Scheinwerfer
      this.tweens.add({ targets: this.vignette, alpha: 1, duration: 700 });
      this.tweens.add({ targets: this.lightsOut, alpha: 0.8, duration: 900 });
      this.spot.setDepth(36);
      this.cube.setDepth(37);
      const label = SS.UI.text(this, C.WIDTH / 2, 190, 'BLACKOUT', 'title', { color: C.CSS.danger })
        .setOrigin(0.5).setScrollFactor(0).setDepth(80).setAlpha(0);
      this.tweens.add({ targets: label, alpha: 1, duration: 90, yoyo: true, repeat: 4, onComplete: () => label.setAlpha(1) });
      this.time.delayedCall(2300, () => this.showResult(5.0, this.content.blackoutVerdict, true));
    }

    /** Kamera zurücksetzen, Musik aus, Ergebniskarte zeigen. */
    showResult(grade, verdict, blackout) {
      const success = grade <= C.PASS_GRADE;
      const result = {
        id: 'pruefung',
        title: 'Mündliche Projektarbeitsprüfung',
        success,
        ects: ectsForGrade(grade),
        grade,
        message: 'Note: ' + SS.State.formatGrade(grade) + ' – ' + verdict
      };
      const cam = this.cameras.main;
      cam.zoomEffect.reset();
      cam.panEffect.reset();
      cam.setZoom(1).setScroll(0, 0);
      this.stopMusic();
      this.result = result;   // für Tests lesbar
      SS.SideQuest.outro(this, result, { headline: blackout ? 'BLACKOUT!' : (success ? 'BESTANDEN!' : 'DURCHGEFALLEN') });
    }

    stopMusic() {
      if (!this.musicOn) return;
      SS.Audio.music.stop();
      this.musicOn = false;
    }

    // ── laufende Animationen ─────────────────────────────────────
    update(time, delta) {
      this.clockAngle += delta * CLOCK_SPEED;
      this.clockHand.clear().lineStyle(2, 0x111827, 1)
        .lineBetween(0, 0, Math.cos(this.clockAngle) * 13, Math.sin(this.clockAngle) * 13);
      this.updateNervousCube(delta);
    }

    /** Je nervöser, desto stärker zittert der Würfel; ab 60 % fließt Angstschweiß. */
    updateNervousCube(delta) {
      const tremble = (Math.max(0, this.nerves - 30) / 70) * 3;
      this.cube.x = LAYOUT.cubeX + (Math.random() * 2 - 1) * tremble;
      if (!this.sweat.visible) return;
      this.sweatTime = ((this.sweatTime || 0) + delta) % 900;
      const t = this.sweatTime / 900;
      this.sweat.setPosition(LAYOUT.cubeX + 30, LAYOUT.cubeY - 22 + t * 30).setAlpha(1 - t);
    }
  }

  SS.scenes.PruefungScene = PruefungScene;
})();

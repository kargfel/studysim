/*
 * GameOverScene.js – Ende eines Semesters als Dokument auf Papier.
 *
 * Drei Varianten nach SS.State.run.outcome:
 *   'graduated'      Zeugnis mit Siegel, Konfetti und ggf. „NEUER REKORD!“
 *   'failed'         Zeugnis „nicht bestanden“ (Note > 4,0) mit Hinweis auf die Wiederholungsprüfung
 *   'exmatrikuliert' Brief vom Prüfungsamt mit rotem Stempel
 * Der Highscore wird pro Durchlauf genau einmal gespeichert – Debug-Läufe (siehe isDebugRun) zählen nicht.
 */
(function () {
  'use strict';
  const SS = globalThis.SS;
  const C = SS.CONFIG;
  const F = C.FONTS;
  const Outcome = SS.State.Outcome;

  // ── Layout ──────────────────────────────────────────────────
  const CX = C.WIDTH / 2;
  const PAPER = { x: 120, y: 20, w: 560, h: 500 };
  const LEFT = PAPER.x + 40;                 // Textspalte auf dem Papier
  const RIGHT = PAPER.x + PAPER.w - 40;
  const RESULT_COL = LEFT + 270;             // Spalte „Ergebnis“ bzw. Werte
  const BUTTON_Y = 556;
  const SIGNATURE_Y = PAPER.y + PAPER.h - 40;  // Grundlinie der Unterschrift
  const BADGE = { x: PAPER.x + PAPER.w + 42, y: PAPER.y + 140, scale: 0.82 };
  const MAX_ECTS = C.MAX_ECTS || 30;

  // ── Ablauf ──────────────────────────────────────────────────
  const PAPER_IN_MS = 550;                   // Papier fliegt von unten herein
  const STAMP_DELAY_MS = 250;                // nach der Landung des Papiers
  const BADGE_DELAY_MS = 600;
  const FADE_IN_MS = 250;
  const CONFETTI_X = [PAPER.x + 40, PAPER.x + PAPER.w - 40, CX];   // Konfetti-Salven nacheinander
  const CONFETTI_INTERVAL_MS = 380;

  // ── Farben (Druckfarben auf Papier) ─────────────────────────
  const INK = '#1f2430';
  const INK_SOFT = '#5b6170';
  const INK_RED = '#c8001a';
  const STAMP_RED = '#d0001c';
  const LINE = { rule: 0x9aa0ab, ink: 0x1f2430, red: 0xc8001a, signature: 0x1d3a8a }; // dieselben Töne für Graphics

  // Stempel sitzen unten auf dem Papier unter dem Text (wie neben einer Unterschrift), damit alles lesbar bleibt
  const STAMPS = {
    exmatrikuliert: { key: 'ui_stamp_exmatrikuliert', label: 'EXMATRIKULIERT', w: 316, h: 76, x: CX + 20, y: 473, angle: -3 },
    failed: { key: 'ui_stamp_nicht_bestanden', label: 'NICHT BESTANDEN', w: 280, h: 64, x: RIGHT - 120, y: PAPER.y + PAPER.h - 46, angle: -5 }
  };
  const STAMP_GAP = 2;                       // Mindestabstand zwischen Text und Stempel (siehe placeStamp)
  const STAMP_MIN_SCALE = 0.6;               // so weit schrumpft ein Stempel, wenn der Text mehr Platz braucht

  const DOC = {
    brand: { fontFamily: F.display, fontSize: '28px', color: INK_RED },
    org: { fontFamily: F.body, fontSize: '13px', color: INK_SOFT },
    title: { fontFamily: F.display, fontSize: '30px', color: INK },
    subject: { fontFamily: F.display, fontSize: '22px', color: INK },
    lead: { fontFamily: F.body, fontSize: '15px', color: INK_SOFT, fontStyle: 'italic' },
    body: { fontFamily: F.body, fontSize: '15px', color: INK },
    bold: { fontFamily: F.body, fontSize: '15px', color: INK, fontStyle: 'bold' },
    fail: { fontFamily: F.body, fontSize: '15px', color: INK_RED, fontStyle: 'bold' },
    head: { fontFamily: F.body, fontSize: '13px', color: INK_SOFT, fontStyle: 'bold' },
    small: { fontFamily: F.body, fontSize: '12px', color: INK_SOFT }
  };

  const BACKGROUNDS = {
    [Outcome.GRADUATED]: [0x2e1065, C.COLORS.dhbwRedDark],
    [Outcome.FAILED]: [0x111827, 0x374151],
    [Outcome.EXMATRIKULIERT]: [0x140707, 0x3b0a0a]
  };

  // Ergebnis von saveHighscore() je Durchlauf – so wird auch bei einem Neustart der Szene nur einmal gespeichert.
  const savedHighscores = new WeakMap();

  // ── Texturen (Präfix ui_) ───────────────────────────────────

  /** Pseudozufall mit festem Startwert: jedes Papier sieht bei jedem Start gleich aus. */
  function seededRandom(seed) {
    let s = seed % 2147483647 || 1;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
  }

  SS.Textures.register('ui_paper', PAPER.w, PAPER.h, (ctx, w, h) => {
    ctx.fillStyle = '#fbf8f1';
    ctx.fillRect(0, 0, w, h);
    const rand = seededRandom(7);
    for (let i = 0; i < 1600; i++) {                 // Papierfasern
      ctx.fillStyle = `rgba(120, 100, 60, ${0.02 + rand() * 0.05})`;
      ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1);
    }
    const fold = ctx.createLinearGradient(0, h / 3 - 5, 0, h / 3 + 5);  // Knick vom Falten
    fold.addColorStop(0, 'rgba(0, 0, 0, 0)');
    fold.addColorStop(0.5, 'rgba(0, 0, 0, 0.05)');
    fold.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = fold;
    ctx.fillRect(0, h / 3 - 5, w, 10);
    const vignette = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.75);
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, 'rgba(110, 80, 30, 0.14)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
  });

  /** Roter Stempel mit Doppelrahmen und abgenutzter Farbe. */
  function registerStamp({ key, label, w: width, h: height }) {
    SS.Textures.register(key, width, height, (ctx, w, h) => {
      ctx.strokeStyle = STAMP_RED;
      ctx.lineWidth = 6;
      SS.Textures.roundRect(ctx, 5, 5, w - 10, h - 10, 12);
      ctx.stroke();
      ctx.lineWidth = 2;
      SS.Textures.roundRect(ctx, 14, 14, w - 28, h - 28, 8);
      ctx.stroke();
      let size = Math.round(h * 0.48);
      ctx.font = `900 ${size}px ${F.display}`;
      while (ctx.measureText(label).width > w - 60 && size > 10) {
        size -= 2;
        ctx.font = `900 ${size}px ${F.display}`;
      }
      ctx.fillStyle = STAMP_RED;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, w / 2, h / 2 + 2);
      ctx.globalCompositeOperation = 'destination-out';   // Löcher = zu wenig Stempelfarbe
      const rand = seededRandom(label.length * 97);
      for (let i = 0; i < 320; i++) {
        ctx.globalAlpha = 0.3 + rand() * 0.7;
        ctx.beginPath();
        ctx.arc(rand() * w, rand() * h, 0.6 + rand() * 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    });
  }
  registerStamp(STAMPS.exmatrikuliert);
  registerStamp(STAMPS.failed);

  // Hochschulsiegel mit gezacktem Rand
  SS.Textures.register('ui_seal', 112, 112, (ctx, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    ctx.beginPath();
    for (let i = 0; i < 48; i++) {
      const angle = (i / 48) * Math.PI * 2;
      const r = i % 2 ? 50 : 55;
      ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
    }
    ctx.closePath();
    ctx.fillStyle = INK_RED;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 2;
    for (const r of [43, 38]) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 22px ${F.display}`;
    ctx.fillText('DHBW', cx, cy - 4);
    ctx.font = `bold 10px ${F.body}`;
    ctx.fillText('· SIEGEL ·', cx, cy + 16);
  });

  // Gelber Stern für „NEUER REKORD!“
  SS.Textures.register('ui_badge', 150, 150, (ctx, w, h) => {
    const points = 16;
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 ? 58 : 72;
      ctx.lineTo(w / 2 + Math.cos(angle) * r, h / 2 + Math.sin(angle) * r);
    }
    ctx.closePath();
    ctx.fillStyle = SS.Textures.hex(C.COLORS.yellow);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#000000';
    ctx.stroke();
  });

  // ── Hilfsfunktionen ─────────────────────────────────────────

  function saveHighscoreOnce(run) {
    if (!savedHighscores.has(run)) savedHighscores.set(run, SS.State.saveHighscore());
    return savedHighscores.get(run);
  }

  /**
   * Endlage eines Stempels: seine Position aus STAMPS, solange der Text darüber Platz lässt. Bricht eine
   * breitere Ersatzschrift mehr Zeilen um, rutscht er tiefer und wird notfalls kleiner – bleibt aber auf dem Papier.
   */
  function placeStamp(stamp, textBottom) {
    const rad = Phaser.Math.DegToRad(stamp.angle);
    const halfH = (stamp.w * Math.abs(Math.sin(rad)) + stamp.h * Math.cos(rad)) / 2;   // halbe Höhe des gedrehten Stempels
    const top = textBottom + STAMP_GAP;
    if (stamp.y - halfH >= top) return { y: stamp.y, scale: 1 };
    const paperBottom = PAPER.y + PAPER.h;
    const scale = Phaser.Math.Clamp((paperBottom - top) / (2 * halfH), STAMP_MIN_SCALE, 1);
    return { y: Math.min(top + halfH * scale, paperBottom - halfH * scale), scale };
  }

  /**
   * Debug-Lauf? Das Beispiel-Zeugnis der BootScene kommt mit {debug: true}. Beim Runner entscheiden dessen
   * Startdaten (siehe GameScene.init): unverwundbar, anderes Tempo oder Start in einem späteren Abschnitt.
   */
  function isDebugRun(scene, data) {
    if (data && data.debug) return true;
    const game = scene.scene.get('GameScene');
    const start = (game && game.sys.settings.data) || {};
    return !!start.god || (Number(start.timeScale) || 1) !== 1 || (start.section | 0) > 0;
  }

  /** Ausgang des Laufs; fehlt er oder ist unbekannt, entscheidet die Note. */
  function resolveOutcome(run) {
    const known = [Outcome.GRADUATED, Outcome.FAILED, Outcome.EXMATRIKULIERT];
    if (known.indexOf(run.outcome) >= 0) return run.outcome;
    return run.grade !== null && run.grade <= C.PASS_GRADE ? Outcome.GRADUATED : Outcome.FAILED;
  }

  function formatTime(seconds) {
    const total = Math.floor(seconds);
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  /** „2,3 (gut)“ – Notenstufen nach deutschem Hochschulschema. */
  function gradeLabel(grade) {
    if (typeof grade !== 'number') return '–';
    let word = 'nicht ausreichend';
    if (grade <= 1.5) word = 'sehr gut';
    else if (grade <= 2.5) word = 'gut';
    else if (grade <= 3.5) word = 'befriedigend';
    else if (grade <= C.PASS_GRADE) word = 'ausreichend';
    return `${SS.State.formatGrade(grade)} (${word})`;
  }

  function ordinal(n) {
    const words = ['ersten', 'zweiten', 'dritten', 'vierten', 'fünften'];
    return words[n - 1] || `${n}.`;
  }

  /** „Abschnitt 3 („Klausurenphase“)“ – Titel kommt aus der Level-Definition. */
  function sectionLabel(index) {
    const level = SS.Levels && SS.Levels.semester;
    const section = level && level.sections && level.sections[index];
    return section ? `Abschnitt ${index + 1} („${section.title}“)` : `Abschnitt ${index + 1}`;
  }

  function questResultText(quest) {
    if (typeof quest.grade === 'number') return `Note ${SS.State.formatGrade(quest.grade)}`;
    return quest.success ? 'bestanden' : 'nicht bestanden';
  }

  /** ECTS aus Münzen = alles, was nicht aus Side Quests stammt. */
  function coinEcts(run) {
    const fromQuests = run.sideQuests.reduce((sum, quest) => sum + quest.ects, 0);
    return Math.max(0, run.ects - fromQuests);
  }

  function todayLabel() {
    return new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  /**
   * Schreibt Zeilen von oben nach unten aufs Papier; y wandert automatisch mit.
   * Eine Zelle: { x, text, style, align: 'left'|'center'|'right', wrap? }
   */
  class PaperWriter {
    constructor(scene, container, top) {
      this.scene = scene;
      this.container = container;
      this.y = top;
    }

    line(cells, gap) {
      let height = 0;
      [].concat(cells).forEach((cell) => {
        const originX = { left: 0, center: 0.5, right: 1 }[cell.align || 'left'];
        const extra = cell.wrap ? { wordWrap: { width: cell.wrap }, align: cell.align || 'left' } : {};
        const text = SS.UI.text(this.scene, cell.x, this.y, cell.text, cell.style, extra).setOrigin(originX, 0);
        this.container.add(text);
        height = Math.max(height, text.height);
      });
      this.y += height + (gap != null ? gap : 4);
    }

    rule(color, width, gap) {
      const g = this.scene.add.graphics();
      g.lineStyle(width || 1, color, 1);
      g.lineBetween(LEFT, this.y, RIGHT, this.y);
      this.container.add(g);
      this.y += gap != null ? gap : 8;
    }

    space(px) {
      this.y += px;
    }
  }

  class GameOverScene extends Phaser.Scene {
    constructor() {
      super('GameOverScene');
    }

    create(data) {
      const run = SS.State.run;
      this.leaving = false;
      this.outcome = resolveOutcome(run);
      // Debug-Läufe lassen die Bestleistung unberührt (und zeigen kein „NEUER REKORD!“)
      this.highscore = isDebugRun(this, data)
        ? { highscore: SS.State.loadHighscore(), newBestEcts: false, newBestGrade: false }
        : saveHighscoreOnce(run);
      SS.Audio.music.stop();

      this.createBackground();
      this.paper = this.createPaper();
      if (this.outcome === Outcome.EXMATRIKULIERT) this.writeExmatrikulation(run);
      else this.writeZeugnis(run);
      this.createButtons();
      SS.UI.onKey(this, 'M', () => SS.Audio.toggleMute()); // Ton an/aus wie im Runner
      this.cameras.main.fadeIn(FADE_IN_MS, 0, 0, 0);
      this.playEntrance();
    }

    // ── Aufbau ────────────────────────────────────────────────

    createBackground() {
      const [top, bottom] = BACKGROUNDS[this.outcome];
      SS.UI.background(this, top, bottom);
      this.add.image(CX, PAPER.y + PAPER.h / 2, 'glow').setDisplaySize(900, 760).setAlpha(0.18);
      if (this.outcome === Outcome.GRADUATED) this.startConfettiRain();
    }

    /** Papier mit Schatten und rotem Kopfbalken; alle Inhalte kommen in diesen Container. */
    createPaper() {
      const shadow = this.add.rectangle(PAPER.x + 6, PAPER.y + 8, PAPER.w, PAPER.h, 0x000000, 0.4).setOrigin(0);
      const sheet = this.add.image(PAPER.x, PAPER.y, 'ui_paper').setOrigin(0);
      const headerBar = this.add.rectangle(PAPER.x, PAPER.y, PAPER.w, 8, C.COLORS.dhbwRed).setOrigin(0);
      return this.add.container(0, 0, [shadow, sheet, headerBar]).setDepth(10);
    }

    /** Zeugnis für 'graduated' und 'failed'. */
    writeZeugnis(run) {
      const passed = this.outcome === Outcome.GRADUATED;
      const w = new PaperWriter(this, this.paper, PAPER.y + 26);
      w.line([
        { x: LEFT, text: 'DHBW', style: DOC.brand },
        { x: RIGHT, text: 'Semester Dash', style: DOC.head, align: 'right' }
      ], 0);
      w.line([
        { x: LEFT, text: 'Duale Hochschule Baden-Württemberg', style: DOC.org },
        { x: RIGHT, text: `Ausgestellt am ${todayLabel()}`, style: DOC.org, align: 'right' }
      ], 10);
      w.rule(LINE.rule, 1, 12);
      w.line({ x: CX, text: 'ZEUGNIS', style: DOC.title, align: 'center' }, 0);
      w.line({
        x: CX,
        text: passed ? 'Das Semester wurde erfolgreich abgeschlossen.' : 'Das Semester wurde nicht bestanden.',
        style: passed ? DOC.lead : DOC.fail,
        align: 'center'
      }, 12);
      this.writeResultTable(w, run);
      this.writeStats(w, run);
      if (passed) {
        this.addSeal();
      } else {
        this.writeRetakeNotice(w);
      }
      this.textBottom = w.y;   // Unterkante von Text bzw. Hinweiskasten – ein Stempel kommt darunter (placeStamp)
      this.addSignature();
    }

    writeResultTable(w, run) {
      const row = (label, result, ects, styles) => w.line([
        { x: LEFT, text: label, style: styles[0] },
        { x: RESULT_COL, text: result, style: styles[1] },
        { x: RIGHT, text: String(ects), style: styles[2], align: 'right' }
      ], 5);
      row('Leistung', 'Ergebnis', 'ECTS', [DOC.head, DOC.head, DOC.head]);
      w.rule(LINE.rule, 1, 6);
      row('Münzen im Level', 'eingesammelt', coinEcts(run), [DOC.body, DOC.body, DOC.body]);
      run.sideQuests.forEach((quest) => {
        const resultStyle = quest.success ? DOC.body : DOC.fail;
        row(quest.title, questResultText(quest), quest.ects, [DOC.body, resultStyle, DOC.body]);
      });
      w.rule(LINE.ink, 2, 6);
      row('ECTS gesamt', '', `${run.ects} / ${MAX_ECTS}`, [DOC.bold, DOC.bold, DOC.bold]);
      w.space(10);
    }

    /** Eckdaten als Paare „Bezeichnung – Wert“; die Note bekommt eine eigene Zeile (Text kann lang sein). */
    writeStats(w, run) {
      const pair = (label, value, x) => [
        { x, text: label, style: DOC.small },
        { x: x + 150, text: value, style: DOC.bold }
      ];
      w.line(pair('Note der mündl. Prüfung', gradeLabel(run.grade), LEFT), 6);
      w.line(pair('Crashes / Nachklausuren', String(run.deaths), LEFT).concat(
        pair('Spielzeit', formatTime(SS.State.elapsedSeconds()), RESULT_COL)), 6);
    }

    writeRetakeNotice(w) {
      w.space(6);
      const boxTop = w.y;
      const box = this.add.graphics();
      this.paper.add(box);
      w.space(8);
      w.line({
        x: LEFT + 14,
        text: 'Wiederholungsprüfung möglich: einfach ein neues Semester starten.',
        style: Object.assign({}, DOC.body, { fontSize: '14px' }),
        wrap: RIGHT - LEFT - 28
      }, 8);
      box.fillStyle(LINE.red, 0.07);
      box.fillRect(LEFT, boxTop, RIGHT - LEFT, w.y - boxTop);
      box.fillStyle(LINE.red, 1);
      box.fillRect(LEFT, boxTop, 4, w.y - boxTop);
    }

    addSeal() {
      this.seal = this.add.image(RIGHT - 60, PAPER.y + PAPER.h - 68, 'ui_seal').setAngle(-8).setAlpha(0);
      this.paper.add(this.seal);
    }

    /** Unterschriftslinie mit gekritzeltem Namenszug. */
    addSignature() {
      const baseY = SIGNATURE_Y;
      const g = this.add.graphics();
      g.lineStyle(1, LINE.rule, 1);
      g.lineBetween(LEFT, baseY, LEFT + 200, baseY);
      const scribble = new Phaser.Curves.Spline([
        LEFT + 10, baseY - 6, LEFT + 30, baseY - 26, LEFT + 42, baseY - 4, LEFT + 60, baseY - 22,
        LEFT + 78, baseY - 6, LEFT + 100, baseY - 18, LEFT + 135, baseY - 10, LEFT + 175, baseY - 14
      ]);
      g.lineStyle(2, LINE.signature, 0.85);
      g.strokePoints(scribble.getPoints(48));
      const label = SS.UI.text(this, LEFT, baseY + 5, 'Prüfungsausschuss', DOC.small);
      this.paper.add([g, label]);
    }

    /** Brief vom Prüfungsamt für 'exmatrikuliert'. */
    writeExmatrikulation(run) {
      const w = new PaperWriter(this, this.paper, PAPER.y + 26);
      w.line([
        { x: LEFT, text: 'DHBW · Prüfungsamt', style: Object.assign({}, DOC.brand, { fontSize: '24px' }) },
        { x: RIGHT, text: `Datum: ${todayLabel()}`, style: DOC.org, align: 'right' }
      ], 0);
      w.line({ x: LEFT, text: 'Duale Hochschule Baden-Württemberg', style: DOC.org }, 14);
      w.line({ x: LEFT, text: 'An die Studierende / den Studierenden\nim Studiengang Semester Dash', style: DOC.small }, 16);
      w.line({ x: LEFT, text: 'Exmatrikulationsbescheid', style: DOC.subject }, 8);
      w.line({ x: LEFT, text: 'Sehr geehrte Studierende, sehr geehrter Studierender,', style: DOC.body }, 6);
      w.line({
        x: LEFT,
        text: `Sie haben die Prüfungsleistung im ${sectionLabel(run.sectionIndex)} auch im ` +
          `${ordinal(C.ATTEMPTS_PER_SECTION)} Versuch nicht bestanden. Sie gilt damit als endgültig ` +
          'nicht bestanden. Gemäß Studien- und Prüfungsordnung werden Sie hiermit exmatrikuliert.',
        style: DOC.body,
        wrap: RIGHT - LEFT
      }, 12);
      this.writeLetterStats(w, run);
      w.line({
        x: LEFT,
        text: 'Rechtsbehelfsbelehrung: Gegen diesen Bescheid können Sie innerhalb eines Monats Widerspruch ' +
          'einlegen – oder einfach ein neues Semester starten.',
        style: DOC.small,
        wrap: RIGHT - LEFT
      }, 10);
      w.line({ x: LEFT, text: 'Mit freundlichen Grüßen\nIhr Prüfungsamt', style: DOC.body }, 8);
      w.line({
        x: LEFT,
        text: 'Dieses Schreiben wurde maschinell erstellt und ist ohne Unterschrift gültig.',
        style: Object.assign({}, DOC.small, { fontStyle: 'italic' })
      }, 0);
      this.textBottom = w.y;   // Unterkante des Textes – der Stempel kommt darunter (placeStamp)
    }

    /** Graue Box mit den Eckdaten des Laufs. */
    writeLetterStats(w, run) {
      const boxTop = w.y;
      const box = this.add.graphics();
      this.paper.add(box);
      w.space(9);
      const cells = [
        ['Erreichte ECTS', `${run.ects} / ${MAX_ECTS}`],
        ['Crashes', String(run.deaths)],
        ['Spielzeit', formatTime(SS.State.elapsedSeconds())]
      ];
      const cellW = (RIGHT - LEFT) / cells.length;
      w.line(cells.map(([label], i) => ({ x: LEFT + cellW * (i + 0.5), text: label, style: DOC.small, align: 'center' })), 2);
      w.line(cells.map(([, value], i) => ({ x: LEFT + cellW * (i + 0.5), text: value, style: DOC.bold, align: 'center' })), 9);
      box.fillStyle(LINE.ink, 0.06);
      box.fillRect(LEFT, boxTop, RIGHT - LEFT, w.y - boxTop);
      box.lineStyle(1, LINE.rule, 1);
      box.strokeRect(LEFT, boxTop, RIGHT - LEFT, w.y - boxTop);
      w.space(12);
    }

    createButtons() {
      SS.UI.button(this, CX - 120, BUTTON_Y, 'Nochmal', () => this.goTo('GameScene', { newRun: true }), {
        width: 220, height: 48, key: 'ENTER'
      });
      // {}: sonst behält Phaser die alten Startdaten des Menüs (z. B. einen Übungs-Toast)
      SS.UI.button(this, CX + 120, BUTTON_Y, 'Menü', () => this.goTo('MenuScene', {}), {
        width: 220, height: 48, color: C.COLORS.dhbwGray, key: 'ESC'
      });
    }

    // ── Effekte ───────────────────────────────────────────────

    /** Papier fliegt herein; danach je nach Ausgang Stempel oder Feier. */
    playEntrance() {
      this.paper.y = C.HEIGHT;
      this.tweens.add({
        targets: this.paper,
        y: 0,
        duration: PAPER_IN_MS,
        ease: 'Back.Out',
        onComplete: () => this.time.delayedCall(STAMP_DELAY_MS, () => this.onPaperLanded())
      });
    }

    onPaperLanded() {
      if (this.outcome === Outcome.EXMATRIKULIERT) {
        this.slamStamp(STAMPS.exmatrikuliert);
      } else if (this.outcome === Outcome.FAILED) {
        this.slamStamp(STAMPS.failed);
      } else {
        this.celebrate();
      }
    }

    /** Stempel saust aufs Papier: kurz groß, dann Aufprall mit Shake, Sound und Farbspritzern. */
    slamStamp(cfg) {
      const { key, x, angle } = cfg;
      const { y, scale } = placeStamp(cfg, this.textBottom);
      const stamp = this.add.image(x, y, key).setAngle(angle).setScale(2.4 * scale).setAlpha(0);
      this.paper.add(stamp);
      this.tweens.add({
        targets: stamp,
        scale,
        alpha: 0.9,
        duration: 220,
        ease: 'Cubic.In',
        onComplete: () => {
          SS.UI.shake(this, 260, 0.014);
          SS.Audio.sfx('lose');
          SS.UI.burst(this, x, y, {
            count: 18, speedMin: 60, speedMax: 220, lifespan: 500, gravityY: 200, scale: 1.2,
            tint: [C.COLORS.dhbwRed, C.COLORS.dhbwRedDark], depth: 50
          });
          this.tweens.add({ targets: this.paper, y: 4, duration: 70, yoyo: true });
        }
      });
    }

    celebrate() {
      SS.Audio.sfx('win');
      CONFETTI_X.forEach((x, i) => {
        this.time.delayedCall(i * CONFETTI_INTERVAL_MS, () => SS.UI.confetti(this, x, PAPER.y + 40));
      });
      this.tweens.add({ targets: this.seal, alpha: 1, scale: { from: 2, to: 1 }, duration: 260, ease: 'Cubic.In' });
      const { newBestEcts, newBestGrade } = this.highscore;
      if (newBestEcts || newBestGrade) this.time.delayedCall(BADGE_DELAY_MS, () => this.showRecordBadge());
    }

    /** Pulsierender „NEUER REKORD!“-Stern rechts am Papierrand (verdeckt keinen Text). */
    showRecordBadge() {
      const star = this.add.image(0, 0, 'ui_badge');
      const label = SS.UI.text(this, 0, 0, 'NEUER\nREKORD!', 'h2', {
        fontSize: '19px', color: '#000000', stroke: '#ffffff', strokeThickness: 2, align: 'center'
      }).setOrigin(0.5);
      const badge = this.add.container(BADGE.x, BADGE.y, [star, label]).setDepth(60).setAngle(14).setScale(0);
      this.tweens.add({
        targets: badge,
        scale: BADGE.scale,
        duration: 320,
        ease: 'Back.Out',
        onComplete: () => this.tweens.add({
          targets: badge, scale: BADGE.scale * 1.08, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.InOut'
        })
      });
      SS.Audio.sfx('coin');
    }

    /** Leiser Konfetti-Regen hinter dem Papier. */
    startConfettiRain() {
      this.add.particles(0, -10, 'px', {
        x: { min: 0, max: C.WIDTH },
        speedY: { min: 60, max: 150 },
        speedX: { min: -30, max: 30 },
        rotate: { min: 0, max: 360 },
        scale: { min: 1, max: 2.2 },
        lifespan: 6000,
        frequency: 70,
        tint: [C.COLORS.dhbwRed, C.COLORS.yellow, C.COLORS.cyan, C.COLORS.green, C.COLORS.magenta, 0xffffff]
      }).setDepth(1);
    }

    /** Szenenwechsel mit Abblende – nur einmal, auch bei Doppelklick. */
    goTo(sceneKey, data) {
      if (this.leaving) return;
      this.leaving = true;
      SS.UI.fadeToScene(this, sceneKey, data);
    }
  }

  SS.scenes.GameOverScene = GameOverScene;
})();

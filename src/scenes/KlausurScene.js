/*
 * KlausurScene.js – Side Quest 3 nach der Klausurenphase:
 * „Klausur – und notfalls die Nachklausur“ (result.id 'klausur').
 *
 * Ablauf:
 *   Intro → Klausur (6 Fragen, je 12 s) ── bestanden ──────────────────────────► Ergebniskarte (+6 ECTS)
 *                                       └─ durchgefallen → NACHKLAUSUR (6 neue Fragen, je 10 s)
 *                                                            ├─ bestanden ────► Ergebniskarte (+4 ECTS)
 *                                                            └─ durchgefallen ► Ergebniskarte (0 ECTS)
 *
 * Bestanden ab 3 von 6 richtigen Antworten. Die Note ergibt sich linear aus dem Anteil
 * richtiger Antworten (100 % → 1,0 · 50 % → 4,0 · darunter 5,0) und steht in result.message.
 * result.grade bleibt bewusst leer: SS.State.run.grade gehört der mündlichen Prüfung.
 *
 * Fragen: SS.Data.klausurfragen (src/data/klausurfragen.js); die Antworten werden gemischt.
 *
 * Debug-Hook für Tests:
 *   SS.game.scene.getScene('KlausurScene').debugAnswer(true)   // aktuelle Frage richtig beantworten
 *   SS.game.scene.getScene('KlausurScene').debugAnswer(false)  // absichtlich falsch
 */
(function () {
  'use strict';
  const SS = globalThis.SS;
  const C = SS.CONFIG;
  const T = SS.Textures;

  // ── Regeln ──────────────────────────────────────────────────────
  const QUESTIONS_PER_EXAM = 6;
  const PASS_COUNT = 3;                       // 50 %
  const ATTEMPTS = [
    { name: 'Klausur', seconds: 12, ects: 6, timerColor: C.COLORS.yellow },
    { name: 'Nachklausur', seconds: 10, ects: 4, timerColor: C.COLORS.orange }
  ];

  // ── Zeiten (ms) ─────────────────────────────────────────────────
  const FEEDBACK_MS = 1200;                   // nach richtiger Antwort
  const FEEDBACK_WRONG_MS = 1700;             // nach Fehler/Zeitablauf etwas länger, damit die Erklärung lesbar ist
  const RESULT_HOLD_MS = 1900;                // Note auf dem Bogen, bevor es weitergeht
  const RETAKE_BANNER_MS = 2200;
  const DISTRACTION_CHANCE = 0.55;            // Wahrscheinlichkeit einer Ablenkung pro Frage
  const CLOCK_START = 10 * 3600 + 50 * 60;    // Wanduhr startet um 10:50 Uhr („Noch 10 Minuten!“)

  // ── Layout (Spielfläche 800 × 600) ──────────────────────────────
  const WALL_H = 118;
  const SHEET = { x: 80, y: 126, w: 640, h: 466 };   // Klausurbogen, linke obere Ecke
  const BOARD = { x: 24, y: 14, w: 300, h: 92 };     // Tafel
  const CLOCK = { x: 728, y: 60 };                   // Wanduhr, Mittelpunkt
  const SIGN = { x: 499, y: 32 };                    // Schild „Ruhe – Prüfung!“
  const PEN = { x: 752, y: 360, angle: 14 };
  const BOTTLE = { x: 44, y: 470, angle: -4 };
  // Positionen auf dem Bogen (relativ zu dessen linker oberer Ecke)
  const PAGE = { left: 50, width: 560, marginX: 18, metaY: 64, questionY: 88, answersY: 176, feedbackY: 414, timerY: 432 };
  const ANSWER = { h: 46, gap: 8 };
  const DEPTH = { tint: 5, sheet: 10, bubble: 40, vignette: 50, particles: 60 };

  // ── Farben und Schriften ────────────────────────────────────────
  const INK = '#1f2937';
  const INK_SOFT = '#64748b';
  const BLUE_INK = '#1e40af';
  const RED_INK = '#c81e1e';
  const GREEN_INK = '#15803d';
  const CHALK = '#f1f5f9';
  const CHALK_RED = '#fca5a5';
  const HAND_FONT = '"Chalkboard SE", "Comic Sans MS", "Segoe Print", cursive';
  const PRINT_TITLE = { fontFamily: C.FONTS.display, color: INK };
  const ROW_STYLES = {
    idle: { fill: 0xffffff, fillAlpha: 0.75, line: 0x475569, lineAlpha: 0.55, width: 2 },
    hover: { fill: 0xeff6ff, fillAlpha: 1, line: 0x1d4ed8, lineAlpha: 1, width: 3 },
    correct: { fill: 0xdcfce7, fillAlpha: 1, line: 0x16a34a, lineAlpha: 1, width: 3 },
    wrong: { fill: 0xfee2e2, fillAlpha: 1, line: 0xdc2626, lineAlpha: 1, width: 3 }
  };
  const FEEDBACK_HEADLINES = { correct: 'Richtig!', wrong: 'Leider falsch.', timeout: 'Zeit um!' };
  const POINTS_BLANK = '– / ' + QUESTIONS_PER_EXAM;   // Punktefeld, bevor korrigiert wird

  // Ablenkungen im Prüfungsraum. spot: 'wall' (über dem Bogen), 'side' (Tischrand), 'pen' (Kuli fällt)
  const DISTRACTIONS = [
    { text: '*hust*', spot: 'side' },
    { text: '*hust hust*', spot: 'side' },
    { text: '*Stuhl quietscht*', spot: 'side' },
    { text: '*raschel raschel*', spot: 'side' },
    { text: '*Handy vibriert*', spot: 'side', sfx: 'buzz' },
    { text: '*Kuli fällt* KLACK!', spot: 'pen', sfx: 'error' },
    { text: 'Aufsicht: „Noch 10 Minuten!“', spot: 'wall' },
    { text: 'Aufsicht: „Augen aufs eigene Blatt!“', spot: 'wall' },
    { text: 'Jemand gibt schon ab …', spot: 'wall' },
    { text: '*Magen knurrt* – Mensa erst um zwölf', spot: 'wall' }
  ];

  // Uhrzeiger: Breite/Höhe der Textur, Länge hinter der Nabe, Strichstärke
  const HANDS = {
    hour: { w: 8, h: 30, tail: 6, line: 6, color: '#111827' },
    minute: { w: 6, h: 42, tail: 6, line: 4, color: '#111827' },
    second: { w: 10, h: 50, tail: 12, line: 2, color: '#e2001a' }
  };

  // ── Hilfsfunktionen ─────────────────────────────────────────────

  /** Note aus dem Anteil richtiger Antworten: 100 % → 1,0 · 50 % → 4,0 (linear) · darunter 5,0. */
  function gradeFor(correctCount, total) {
    const share = correctCount / total;
    if (share < 0.5) return 5.0;
    return SS.State.roundGrade(4.0 - ((share - 0.5) / 0.5) * 3.0);
  }

  function gradeComment(grade) {
    if (grade <= 1.0) return 'Glatte Eins – der Kurs will deine Zusammenfassung!';
    if (grade <= 2.0) return 'Solide – die Lerngruppe hat sich gelohnt.';
    if (grade <= 3.0) return 'Bestanden ist bestanden.';
    return 'Vier gewinnt – Hauptsache bestanden!';
  }

  /** Kopie einer Frage mit gemischten Antworten; correct zeigt auf die neue Position. */
  function shuffleAnswers(question) {
    const order = Phaser.Utils.Array.Shuffle([0, 1, 2, 3]);
    return {
      category: question.category,
      question: question.question,
      explanation: question.explanation || '',
      answers: order.map((i) => question.answers[i]),
      correct: order.indexOf(question.correct)
    };
  }

  /** Mitte einer Antwortzeile (y relativ zum Bogen). */
  function rowCenterY(index) {
    return PAGE.answersY + index * (ANSWER.h + ANSWER.gap) + ANSWER.h / 2;
  }

  /** Häkchen um (x, y) – lineStyle vorher setzen. */
  function drawCheck(g, x, y, size) {
    g.beginPath();
    g.moveTo(x - size, y);
    g.lineTo(x - size * 0.3, y + size * 0.7);
    g.lineTo(x + size, y - size * 0.8);
    g.strokePath();
  }

  /** Kreuz um (x, y) – lineStyle vorher setzen. */
  function drawCross(g, x, y, size) {
    g.lineBetween(x - size, y - size, x + size, y + size);
    g.lineBetween(x - size, y + size, x + size, y - size);
  }

  // ── Texturen (Canvas-2D, Präfix kl_) ────────────────────────────

  T.register('kl_wall', C.WIDTH, WALL_H, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#556070');
    grad.addColorStop(1, '#3c4552');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';       // Wandpaneele
    for (let x = 0; x < w; x += 64) ctx.fillRect(x, 0, 2, h);
  });

  T.register('kl_desk', C.WIDTH, C.HEIGHT - WALL_H, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#a26d3d');
    grad.addColorStop(1, '#7a4e2a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {                       // Holzmaserung
      const y = Math.random() * h;
      ctx.strokeStyle = Math.random() < 0.5 ? 'rgba(60, 30, 10, 0.18)' : 'rgba(255, 220, 180, 0.08)';
      ctx.lineWidth = 1 + Math.random() * 2;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 40) ctx.lineTo(x, y + Math.sin(x / 90 + i) * 4);
      ctx.stroke();
    }
    ctx.fillStyle = '#c08a55';                           // Tischkante
    ctx.fillRect(0, 0, w, 5);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(0, 5, w, 3);
  });

  /** Klausurpapier: Linien, roter Rand, Lochung. */
  function drawPaper(ctx, w, h, paperColor) {
    ctx.fillStyle = paperColor;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.16)';
    ctx.lineWidth = 1;
    for (let y = 66.5; y < h - 8; y += 27) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(220, 38, 38, 0.45)';
    ctx.beginPath();
    ctx.moveTo(36.5, 0);
    ctx.lineTo(36.5, h);
    ctx.stroke();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
    [34, h - 34].forEach((y) => {
      ctx.beginPath();
      ctx.arc(16, y, 6, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  }
  T.register('kl_sheet', SHEET.w, SHEET.h, (ctx, w, h) => drawPaper(ctx, w, h, '#fbf8ef'));
  T.register('kl_sheet_retake', SHEET.w, SHEET.h, (ctx, w, h) => drawPaper(ctx, w, h, '#fde8e8'));

  T.register('kl_board', BOARD.w, BOARD.h, (ctx, w, h) => {
    ctx.fillStyle = '#6b4423';                           // Holzrahmen
    T.roundRect(ctx, 0, 0, w, h, 6);
    ctx.fill();
    ctx.fillStyle = '#1f3b30';                           // Tafelfläche
    ctx.fillRect(6, 6, w - 12, h - 12);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';         // Wischspuren
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.ellipse(30 + i * 48, h / 2 + (i % 2 ? 10 : -12), 34, 12, 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#e5e7eb';                           // Kreidestück
    ctx.fillRect(w - 40, h - 10, 18, 4);
  });

  T.register('kl_clock', 96, 96, (ctx, w) => {
    const c = w / 2;
    ctx.fillStyle = '#1f2937';                           // Gehäuse
    ctx.beginPath();
    ctx.arc(c, c, c, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f8fafc';                           // Zifferblatt
    ctx.beginPath();
    ctx.arc(c, c, c - 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#111827';
    for (let i = 0; i < 60; i++) {                       // Minuten- und Stundenstriche
      const isHour = i % 5 === 0;
      const a = (i / 60) * Math.PI * 2;
      const inner = isHour ? c - 17 : c - 12;
      ctx.lineWidth = isHour ? 3 : 1;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * (c - 9), c + Math.sin(a) * (c - 9));
      ctx.lineTo(c + Math.cos(a) * inner, c + Math.sin(a) * inner);
      ctx.stroke();
    }
  });

  Object.keys(HANDS).forEach((name) => {
    const hand = HANDS[name];
    T.register('kl_hand_' + name, hand.w, hand.h, (ctx, w, h) => {
      ctx.fillStyle = hand.color;
      T.roundRect(ctx, (w - hand.line) / 2, 0, hand.line, h, hand.line / 2);
      ctx.fill();
      ctx.beginPath();                                   // Nabe
      ctx.arc(w / 2, h - hand.tail, w / 2, 0, Math.PI * 2);
      ctx.fill();
    });
  });

  T.register('kl_pen', 14, 104, (ctx, w, h) => {
    ctx.fillStyle = '#1d4ed8';                           // Schaft
    T.roundRect(ctx, 2, 0, w - 4, h - 18, 4);
    ctx.fill();
    ctx.fillStyle = '#1e3a8a';                           // Druckknopf
    ctx.fillRect(2, 0, w - 4, 12);
    ctx.fillStyle = '#93c5fd';                           // Glanz
    ctx.fillRect(w - 6, 16, 2, 40);
    ctx.fillStyle = '#cbd5e1';                           // Spitze
    ctx.beginPath();
    ctx.moveTo(2, h - 18);
    ctx.lineTo(w - 2, h - 18);
    ctx.lineTo(w / 2, h - 2);
    ctx.closePath();
    ctx.fill();
  });

  T.register('kl_bottle', 36, 92, (ctx, w, h) => {
    ctx.fillStyle = '#e2e8f0';                           // Deckel
    ctx.fillRect(12, 0, 12, 10);
    ctx.fillStyle = 'rgba(191, 219, 254, 0.6)';          // Flasche
    T.roundRect(ctx, 4, 10, w - 8, h - 12, 8);
    ctx.fill();
    ctx.fillStyle = 'rgba(59, 130, 246, 0.5)';           // Wasser
    ctx.fillRect(6, 34, w - 12, h - 40);
    ctx.fillStyle = '#ffffff';                           // Etikett – natürlich stilles Wasser
    ctx.fillRect(4, 48, w - 8, 18);
    ctx.fillStyle = '#1e3a8a';
    ctx.font = 'bold 11px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('still', w / 2, 61);
  });

  T.register('kl_vignette', C.WIDTH, C.HEIGHT, (ctx, w, h) => {
    const grad = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.7);
    grad.addColorStop(0, 'rgba(90, 0, 0, 0)');
    grad.addColorStop(1, 'rgba(90, 0, 0, 0.65)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  });

  // ── Szene ───────────────────────────────────────────────────────

  class KlausurScene extends Phaser.Scene {
    constructor() {
      super('KlausurScene');
    }

    init() {
      // Phaser verwendet die Szene wieder: Flag aus SS.SideQuest.finish für den nächsten Durchlauf zurücksetzen
      this.__sideQuestFinished = false;
      this.phase = 'intro';                 // intro | question | feedback | result | transition | done
      this.attemptIndex = 0;                // 0 = Klausur, 1 = Nachklausur
      this.attempt = ATTEMPTS[0];
      this.usedQuestions = new Set();       // keine Wiederholung zwischen Klausur und Nachklausur
      this.examQuestions = [];
      this.questionNo = 0;                  // 1–6 während eines Versuchs
      this.score = 0;
      this.current = null;                  // aktuelle Frage (Antworten gemischt)
      this.timer = null;
      this.lastDistraction = null;
      this.penOnDesk = true;
      this.clockSeconds = CLOCK_START;
    }

    create() {
      // Aufräumen beim Shutdown: this.time, this.tweens, SS.UI.onKey und SS.UI.timerBar erledigen das selbst.
      this.buildRoom();
      this.buildClock();
      this.buildSheet();
      this.bindAnswerKeys();
      this.updateBoard();
      this.time.addEvent({ delay: 1000, loop: true, callback: this.tickClock, callbackScope: this });
      this.showIntro();
    }

    showIntro() {
      const [exam, retake] = ATTEMPTS;
      SS.SideQuest.intro(this, {
        tag: 'SIDE QUEST · KLAUSURENPHASE',
        title: 'Klausur',
        subtitle: '… und notfalls die Nachklausur',
        lines: [
          `${QUESTIONS_PER_EXAM} Aufgaben, je ${exam.seconds} Sekunden – Klick oder Taste 1–4`,
          `Bestanden ab ${PASS_COUNT} richtigen Antworten`,
          'Durchgefallen? Sofort Nachklausur mit neuen Fragen',
          `Erstversuch +${exam.ects} ECTS · Nachklausur +${retake.ects} ECTS`
        ],
        buttonLabel: 'Bogen umdrehen'
      }, () => this.beginExam());
    }

    // ── Aufbau des Prüfungsraums ──────────────────────────────────

    /** Wand, Tisch, Tafel, Schild, Kuli und Wasserflasche. */
    buildRoom() {
      this.add.image(0, 0, 'kl_wall').setOrigin(0);
      this.add.image(0, WALL_H, 'kl_desk').setOrigin(0);
      this.add.image(BOARD.x, BOARD.y, 'kl_board').setOrigin(0);
      const chalk = { fontFamily: HAND_FONT, color: CHALK };
      this.boardTitle = SS.UI.text(this, BOARD.x + 18, BOARD.y + 9, '', chalk, { fontSize: '24px' });
      this.boardInfo = SS.UI.text(this, BOARD.x + 18, BOARD.y + 44, '', chalk, { fontSize: '15px', lineSpacing: 2 }).setAlpha(0.9);
      this.buildQuietSign();
      this.pen = this.add.image(PEN.x, PEN.y, 'kl_pen').setAngle(PEN.angle);
      this.add.image(BOTTLE.x, BOTTLE.y, 'kl_bottle').setAngle(BOTTLE.angle);
      // Rote Optik der Nachklausur (anfangs unsichtbar): Tönung über dem Raum, Vignette über allem
      this.retakeTint = this.add.rectangle(0, 0, C.WIDTH, C.HEIGHT, 0xdc2626, 0).setOrigin(0).setDepth(DEPTH.tint);
      this.vignette = this.add.image(0, 0, 'kl_vignette').setOrigin(0).setDepth(DEPTH.vignette).setAlpha(0);
    }

    buildQuietSign() {
      const w = 192;
      const h = 30;
      this.add.graphics()
        .fillStyle(0xffffff, 1).fillRoundedRect(SIGN.x - w / 2, SIGN.y - h / 2, w, h, 6)
        .lineStyle(3, C.COLORS.dhbwRed, 1).strokeRoundedRect(SIGN.x - w / 2, SIGN.y - h / 2, w, h, 6);
      SS.UI.text(this, SIGN.x, SIGN.y, 'RUHE – PRÜFUNG!', PRINT_TITLE, { fontSize: '15px', color: C.CSS.dhbwRed }).setOrigin(0.5);
    }

    /** Wanduhr: Zifferblatt und drei Zeiger, die um ihre Nabe rotieren. */
    buildClock() {
      this.add.image(CLOCK.x, CLOCK.y, 'kl_clock');
      this.hands = {};
      Object.keys(HANDS).forEach((name) => {
        const hand = HANDS[name];
        this.hands[name] = this.add.image(CLOCK.x, CLOCK.y, 'kl_hand_' + name).setOrigin(0.5, (hand.h - hand.tail) / hand.h);
      });
      this.hands.second.setAngle((this.clockSeconds % 60) * 6);
      this.updateSlowHands();
    }

    /** Klausurbogen als Container: Papier, Kopfzeile und drei Seiten (Deckblatt, Aufgabe, Ergebnis). */
    buildSheet() {
      this.sheet = this.add.container(SHEET.x, SHEET.y).setDepth(DEPTH.sheet);
      this.paper = this.add.image(0, 0, 'kl_sheet').setOrigin(0);
      this.sheet.add([this.add.rectangle(6, 8, SHEET.w, SHEET.h, 0x000000, 0.28).setOrigin(0), this.paper]);
      this.buildSheetHeader();
      this.coverPage = this.buildCoverPage();
      this.questionPage = this.buildQuestionPage();
      this.resultPage = this.buildResultPage();
      this.sheet.add([this.coverPage, this.questionPage, this.resultPage]);
      this.showPage(this.coverPage);
    }

    buildSheetHeader() {
      const label = { fontFamily: C.FONTS.body, fontSize: '17px', color: INK, fontStyle: 'bold' };
      const right = PAGE.left + PAGE.width;
      const lines = this.add.graphics().lineStyle(2, 0x334155, 0.8);
      lines.lineBetween(PAGE.left + 56, 40, 330, 40);     // Name: ________
      lines.lineBetween(PAGE.left, 50, right, 50);         // doppelte Trennlinie
      lines.lineBetween(PAGE.left, 53, right, 53);
      this.pointsText = SS.UI.text(this, right, 12, POINTS_BLANK, { fontFamily: HAND_FONT, fontSize: '24px', color: RED_INK }).setOrigin(1, 0);
      this.sheet.add([
        lines,
        SS.UI.text(this, PAGE.left, 20, 'Name:', label),
        SS.UI.text(this, PAGE.left + 66, 12, 'Würfel-Studi', { fontFamily: HAND_FONT, fontSize: '21px', color: BLUE_INK }),
        SS.UI.text(this, right - 140, 20, 'Punkte:', label),
        this.pointsText
      ]);
    }

    buildCoverPage() {
      const cx = SHEET.w / 2;
      this.coverTitle = SS.UI.text(this, cx, 140, 'KLAUSUR', PRINT_TITLE, { fontSize: '44px' }).setOrigin(0.5);
      this.coverInfo = SS.UI.text(this, cx, 250, '', 'body', {
        color: INK_SOFT, fontSize: '18px', align: 'center', lineSpacing: 8
      }).setOrigin(0.5, 0);
      this.setCoverText(0);
      return this.add.container(0, 0, [
        this.coverTitle,
        SS.UI.text(this, cx, 192, 'Informatik-Grundlagen & Studienalltag', 'body', { color: INK }).setOrigin(0.5),
        this.coverInfo,
        SS.UI.text(this, cx, 400, 'Bitte erst umdrehen, wenn die Aufsicht es sagt.', 'small', {
          color: INK_SOFT, fontStyle: 'italic'
        }).setOrigin(0.5)
      ]);
    }

    buildQuestionPage() {
      const page = this.add.container(0, 0);
      this.metaText = SS.UI.text(this, PAGE.left, PAGE.metaY, '', 'small', { color: INK_SOFT, fontStyle: 'bold' });
      this.questionText = SS.UI.text(this, PAGE.left, PAGE.questionY, '', 'body', {
        color: INK, fontSize: '21px', fontStyle: 'bold', lineSpacing: 4, wordWrap: { width: PAGE.width }
      });
      this.feedbackText = SS.UI.text(this, SHEET.w / 2, PAGE.feedbackY, '', 'body', {
        fontSize: '16px', fontStyle: 'bold', align: 'center', wordWrap: { width: PAGE.width }
      }).setOrigin(0.5);
      this.marginMark = this.add.graphics();             // Korrekturzeichen links am Rand
      page.add([this.metaText, this.questionText, this.feedbackText, this.marginMark]);
      this.answerRows = [0, 1, 2, 3].map((index) => this.createAnswerRow(page, index));
      return page;
    }

    /** Eine Antwortzeile: Kästchen mit Tastennummer, Antworttext und Klickfläche. */
    createAnswerRow(page, index) {
      const container = this.add.container(PAGE.left + PAGE.width / 2, rowCenterY(index));
      const row = {
        index,
        container,
        bg: this.add.graphics(),
        box: this.add.graphics(),
        keyLabel: SS.UI.text(this, -PAGE.width / 2 + 26, 0, String(index + 1), 'body', {
          fontSize: '17px', color: INK, fontStyle: 'bold'
        }).setOrigin(0.5),
        label: SS.UI.text(this, -PAGE.width / 2 + 52, 0, '', 'body', {
          fontSize: '18px', color: INK, wordWrap: { width: PAGE.width - 66 }
        }).setOrigin(0, 0.5)
      };
      const zone = this.add.zone(0, 0, PAGE.width, ANSWER.h).setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => { if (this.phase === 'question') this.paintRow(row, 'hover'); });
      zone.on('pointerout', () => { if (this.phase === 'question') this.paintRow(row, 'idle'); });
      zone.on('pointerdown', () => this.chooseAnswer(index));
      container.add([row.bg, row.box, row.keyLabel, row.label, zone]);
      page.add(container);
      this.paintRow(row, 'idle');
      return row;
    }

    buildResultPage() {
      const cx = SHEET.w / 2;
      this.resultScore = SS.UI.text(this, cx, 110, '', PRINT_TITLE, { fontSize: '26px' }).setOrigin(0.5);
      this.resultCircle = this.add.graphics();
      this.resultGrade = SS.UI.text(this, cx, 220, '', { fontFamily: HAND_FONT, fontSize: '84px', color: RED_INK }).setOrigin(0.5);
      this.resultVerdict = SS.UI.text(this, cx, 330, '', PRINT_TITLE, { fontSize: '30px' }).setOrigin(0.5);
      const note = SS.UI.text(this, cx, 400, 'Korrigiert in Rekordzeit – so schnell geht das sonst nie.', 'small', {
        color: INK_SOFT, fontStyle: 'italic'
      }).setOrigin(0.5);
      return this.add.container(0, 0, [this.resultScore, this.resultCircle, this.resultGrade, this.resultVerdict, note]);
    }

    bindAnswerKeys() {
      const keys = [['ONE', 'NUMPAD_ONE'], ['TWO', 'NUMPAD_TWO'], ['THREE', 'NUMPAD_THREE'], ['FOUR', 'NUMPAD_FOUR']];
      keys.forEach((names, index) => names.forEach((name) => SS.UI.onKey(this, name, () => this.chooseAnswer(index))));
    }

    // ── Anzeige-Helfer ────────────────────────────────────────────

    showPage(page) {
      [this.coverPage, this.questionPage, this.resultPage].forEach((p) => p.setVisible(p === page));
    }

    setCoverText(attemptIndex) {
      const attempt = ATTEMPTS[attemptIndex];
      const tools = attemptIndex === 0 ? 'keine' : 'Hoffnung';
      this.coverInfo.setText(
        `Bearbeitungszeit: ${QUESTIONS_PER_EXAM} × ${attempt.seconds} Sekunden\n` +
        `Hilfsmittel: ${tools}\n` +
        `Bestanden ab ${PASS_COUNT} von ${QUESTIONS_PER_EXAM} Punkten`
      );
    }

    updateBoard() {
      const retake = this.attemptIndex === 1;
      this.boardTitle.setText(retake ? 'NACHKLAUSUR' : 'KLAUSUR').setColor(retake ? CHALK_RED : CHALK);
      this.boardInfo.setText(
        `Versuch ${this.attemptIndex + 1} von ${ATTEMPTS.length} · ${this.attempt.seconds} s pro Aufgabe\n` +
        `Hilfsmittel: ${retake ? 'Hoffnung' : 'keine'}`
      );
    }

    updatePoints() {
      this.pointsText.setText(`${this.score} / ${QUESTIONS_PER_EXAM}`);
    }

    /** Zeichnet eine Antwortzeile im Zustand idle | hover | correct | wrong. */
    paintRow(row, state) {
      const s = ROW_STYLES[state];
      const w = PAGE.width;
      const h = ANSWER.h;
      row.bg.clear()
        .fillStyle(s.fill, s.fillAlpha).fillRoundedRect(-w / 2, -h / 2, w, h, 8)
        .lineStyle(s.width, s.line, s.lineAlpha).strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
      const boxX = -w / 2 + 12;
      const boxSize = 28;
      const marked = state === 'correct' || state === 'wrong';
      row.box.clear();
      if (marked) {
        row.box.fillStyle(s.line, 1).fillRoundedRect(boxX, -boxSize / 2, boxSize, boxSize, 5).lineStyle(4, 0xffffff, 1);
        if (state === 'correct') drawCheck(row.box, boxX + boxSize / 2, 0, 9);
        else drawCross(row.box, boxX + boxSize / 2, 0, 7);
      } else {
        row.box.lineStyle(2, s.line, 1).strokeRoundedRect(boxX, -boxSize / 2, boxSize, boxSize, 5);
      }
      row.keyLabel.setVisible(!marked);
    }

    /** Bogen „umdrehen“: zusammenklappen, Inhalt tauschen, wieder aufklappen (Mitte bleibt stehen). */
    flipSheet(swapContent, onDone) {
      SS.Audio.sfx('type');
      this.tweens.add({
        targets: this.sheet, scaleX: 0, x: SHEET.x + SHEET.w / 2, duration: 140, ease: 'Sine.In',
        onComplete: () => {
          swapContent();
          this.tweens.add({ targets: this.sheet, scaleX: 1, x: SHEET.x, duration: 160, ease: 'Sine.Out', onComplete: onDone });
        }
      });
    }

    /** Neue Aufgabe gleitet wie ein umgeblättertes Blatt herein. */
    slideInQuestionPage() {
      SS.Audio.sfx('type');
      this.questionPage.setAlpha(0).setX(24);
      this.tweens.add({ targets: this.questionPage, alpha: 1, x: 0, duration: 220, ease: 'Cubic.Out' });
    }

    // ── Prüfungsablauf ────────────────────────────────────────────

    /** Intro bestätigt: Musik an und los. */
    beginExam() {
      SS.Audio.music.play('klausur');
      this.startAttempt(0);
    }

    /** Startet Klausur (0) oder Nachklausur (1) mit frischen Fragen. */
    startAttempt(attemptIndex) {
      this.setAttempt(attemptIndex);
      this.examQuestions = this.pickQuestions(QUESTIONS_PER_EXAM);
      this.questionNo = 0;
      this.score = 0;
      this.updatePoints();
      this.updateBoard();
      this.showNextQuestion();
    }

    setAttempt(attemptIndex) {
      this.attemptIndex = attemptIndex;
      this.attempt = ATTEMPTS[attemptIndex];
    }

    /** Zieht unbenutzte Fragen, möglichst aus verschiedenen Kategorien. */
    pickQuestions(count) {
      const all = SS.Data.klausurfragen || [];
      let pool = all.filter((q) => !this.usedQuestions.has(q));
      if (pool.length < count) pool = all.slice();      // Notfall: Katalog zu klein → Wiederholung erlaubt
      Phaser.Utils.Array.Shuffle(pool);
      const picked = [];
      const categories = new Set();
      pool.forEach((q) => {                              // 1. Runde: je Kategorie höchstens eine Frage
        if (picked.length < count && !categories.has(q.category)) {
          picked.push(q);
          categories.add(q.category);
        }
      });
      pool.forEach((q) => {                              // 2. Runde: auffüllen
        if (picked.length < count && !picked.includes(q)) picked.push(q);
      });
      picked.forEach((q) => this.usedQuestions.add(q));
      return Phaser.Utils.Array.Shuffle(picked);
    }

    /** Nächste Aufgabe – die erste eines Versuchs durch Umdrehen des Bogens, danach durch Umblättern. */
    showNextQuestion() {
      if (this.questionNo >= this.examQuestions.length) {
        this.finishAttempt();
        return;
      }
      this.questionNo += 1;
      this.current = shuffleAnswers(this.examQuestions[this.questionNo - 1]);
      if (this.questionNo === 1) {
        this.flipSheet(() => this.fillQuestionPage(), () => this.startQuestionTimer());
      } else {
        this.fillQuestionPage();
        this.slideInQuestionPage();
        this.startQuestionTimer();
      }
    }

    fillQuestionPage() {
      const q = this.current;
      const retake = this.attemptIndex === 1;
      this.metaText
        .setText(`${retake ? 'NACHKLAUSUR · ' : ''}Aufgabe ${this.questionNo} von ${QUESTIONS_PER_EXAM} · ${q.category}`)
        .setColor(retake ? RED_INK : INK_SOFT);
      this.questionText.setText(q.question);
      this.answerRows.forEach((row) => {
        row.label.setText(q.answers[row.index]);
        row.container.setAlpha(1);
        this.paintRow(row, 'idle');
      });
      this.marginMark.clear();
      const hint = this.questionNo === 1 ? 'Antwort anklicken oder Taste 1–4 drücken' : '';
      this.feedbackText.setText(hint).setColor(INK_SOFT).setScale(1);
      this.showPage(this.questionPage);
    }

    startQuestionTimer() {
      const ms = this.attempt.seconds * 1000;
      this.timer = SS.UI.timerBar(this, SHEET.x + PAGE.left, SHEET.y + PAGE.timerY, PAGE.width, 18, ms, {
        color: this.attempt.timerColor,
        onDone: () => this.onTimeUp()
      });
      this.phase = 'question';
      this.maybeScheduleDistraction(ms);
    }

    stopTimer() {
      if (!this.timer) return;
      this.timer.destroy();
      this.timer = null;
    }

    /** Klick oder Taste 1–4. */
    chooseAnswer(index) {
      if (this.phase !== 'question') return;
      const correct = index === this.current.correct;
      if (correct) this.score += 1;
      this.revealAnswer(index, correct ? 'correct' : 'wrong');
    }

    onTimeUp() {
      if (this.phase !== 'question') return;
      this.revealAnswer(null, 'timeout');
    }

    /** Sofortiges Feedback: richtige Antwort grün, gewählte falsche rot, dazu Erklärung. */
    revealAnswer(chosenIndex, outcome) {
      this.phase = 'feedback';
      this.stopTimer();
      const q = this.current;
      this.answerRows.forEach((row) => {
        if (row.index === q.correct) this.paintRow(row, 'correct');
        else if (row.index === chosenIndex) this.paintRow(row, 'wrong');
        else row.container.setAlpha(0.45);
      });
      if (chosenIndex !== null) this.drawMarginMark(chosenIndex, outcome === 'correct');
      this.showFeedbackText(outcome, q.explanation);
      this.playFeedbackEffects(outcome, q.correct);
      this.updatePoints();
      this.time.delayedCall(outcome === 'correct' ? FEEDBACK_MS : FEEDBACK_WRONG_MS, () => this.showNextQuestion());
    }

    /** Korrektur mit Rotstift: Häkchen oder Kreuz links neben der gewählten Antwort. */
    drawMarginMark(rowIndex, ok) {
      this.marginMark.clear().setPosition(PAGE.marginX, rowCenterY(rowIndex));
      this.marginMark.lineStyle(4, ok ? 0x16a34a : 0xc81e1e, 1);
      if (ok) drawCheck(this.marginMark, 0, 0, 11);
      else drawCross(this.marginMark, 0, 0, 9);
      this.marginMark.setScale(1.8).setAlpha(0);
      this.tweens.add({ targets: this.marginMark, scale: 1, alpha: 1, duration: 180, ease: 'Back.Out' });
    }

    showFeedbackText(outcome, explanation) {
      const headline = FEEDBACK_HEADLINES[outcome];
      this.feedbackText
        .setText(explanation ? `${headline} ${explanation}` : headline)
        .setColor(outcome === 'correct' ? GREEN_INK : RED_INK)
        .setScale(0.85);
      this.tweens.add({ targets: this.feedbackText, scale: 1, duration: 160, ease: 'Back.Out' });
    }

    playFeedbackEffects(outcome, correctIndex) {
      if (outcome === 'correct') {
        SS.Audio.sfx('coin');
        // Sternchen in kräftigen Farben – helle Partikel gingen auf dem Papier unter
        SS.UI.burst(this, SHEET.x + PAGE.left + PAGE.width / 2, SHEET.y + rowCenterY(correctIndex), {
          texture: 'spark', scale: 0.9, count: 18, speedMin: 80, speedMax: 280, gravityY: 260, lifespan: 650,
          depth: DEPTH.particles, tint: [0x16a34a, C.COLORS.green, 0xf59e0b]
        });
        this.pointsText.setScale(1.5);
        this.tweens.add({ targets: this.pointsText, scale: 1, duration: 260, ease: 'Back.Out' });
      } else {
        SS.Audio.sfx(outcome === 'timeout' ? 'buzz' : 'error');
        SS.UI.shake(this, 160, 0.006);
      }
    }

    /** Alle Aufgaben beantwortet: Note auf den Bogen, danach Ergebniskarte oder Nachklausur. */
    finishAttempt() {
      this.phase = 'result';
      const grade = gradeFor(this.score, QUESTIONS_PER_EXAM);
      const passed = this.score >= PASS_COUNT;
      const lastAttempt = this.attemptIndex === ATTEMPTS.length - 1;
      this.showResultPage(grade, passed);
      this.time.delayedCall(RESULT_HOLD_MS, () => {
        if (passed || lastAttempt) this.finishQuest(passed, grade);
        else this.startRetake();
      });
    }

    showResultPage(grade, passed) {
      this.showPage(this.resultPage);
      this.resultScore.setText(`${this.score} von ${QUESTIONS_PER_EXAM} Punkten`);
      this.resultVerdict.setText(passed ? 'BESTANDEN' : 'NICHT BESTANDEN').setColor(passed ? GREEN_INK : RED_INK);
      this.resultGrade.setText(SS.State.formatGrade(grade)).setScale(2.4).setAlpha(0);
      this.resultCircle.clear().lineStyle(5, 0xc81e1e, 0.85).strokeEllipse(SHEET.w / 2, 220, 200, 124).setAlpha(0);
      // Note „aufstempeln“, danach den Rotstift-Kringel einblenden
      this.tweens.add({ targets: this.resultGrade, scale: 1, alpha: 1, duration: 280, ease: 'Back.Out' });
      this.tweens.add({ targets: this.resultCircle, alpha: 1, delay: 250, duration: 200 });
      SS.Audio.sfx(passed ? 'checkpoint' : 'error');
      if (!passed) SS.UI.shake(this, 220, 0.01);
    }

    /** Durchgefallen im Erstversuch: dramatischer Übergang in die Nachklausur. */
    startRetake() {
      this.phase = 'transition';
      this.setAttempt(1);                    // Tafel und Deckblatt zeigen schon während des Banners „Versuch 2“
      SS.Audio.sfx('lose');
      this.cameras.main.flash(400, 160, 0, 0);
      SS.UI.shake(this, 450, 0.014);
      this.applyRetakeLook();
      const subtitle = `Versuch ${this.attemptIndex + 1} von ${ATTEMPTS.length} · neue Fragen · ` +
        `nur ${this.attempt.seconds} Sekunden pro Aufgabe`;
      SS.UI.banner(this, 'NACHKLAUSUR', subtitle, {
        duration: RETAKE_BANNER_MS, color: C.COLORS.dhbwRed, bg: 0x2a0606, bgAlpha: 0.9,
        onDone: () => this.startAttempt(1)
      });
    }

    /** Rötliche Optik: Raum tönen, Vignette, rosa Nachklausur-Papier, Tafel und Deckblatt anpassen. */
    applyRetakeLook() {
      this.tweens.add({ targets: this.retakeTint, fillAlpha: 0.22, duration: 600 });
      this.tweens.add({ targets: this.vignette, alpha: 1, duration: 600 });
      this.updateBoard();
      this.flipSheet(() => {
        this.paper.setTexture('kl_sheet_retake');
        this.coverTitle.setText('NACHKLAUSUR').setColor(RED_INK);
        this.setCoverText(1);
        this.pointsText.setText(POINTS_BLANK);
        this.showPage(this.coverPage);
      });
    }

    /** Ergebniskarte zeigen; deren „Weiter“ ruft SS.SideQuest.finish auf. */
    finishQuest(passed, grade) {
      this.phase = 'done';
      SS.Audio.music.stop();
      SS.SideQuest.outro(this, this.buildResult(passed, grade), { headline: passed ? 'BESTANDEN!' : 'DURCHGEFALLEN' });
    }

    buildResult(passed, grade) {
      const retake = this.attemptIndex === 1;
      const prefix = `Note: ${SS.State.formatGrade(grade)} – `;
      let message;
      if (!passed) message = prefix + 'Auch die Nachklausur ging daneben. Drittversuch? Antrag beim Prüfungsausschuss …';
      else if (retake) message = prefix + `Nachklausur mit ${this.score} von ${QUESTIONS_PER_EXAM} bestanden. ${gradeComment(grade)}`;
      else message = prefix + `${this.score} von ${QUESTIONS_PER_EXAM} richtig im Erstversuch. ${gradeComment(grade)}`;
      return {
        id: 'klausur',
        title: retake ? 'Klausur (Nachklausur)' : 'Klausur',
        success: passed,
        ects: passed ? this.attempt.ects : 0,
        message
      };
    }

    // ── Wanduhr ───────────────────────────────────────────────────

    /** Jede Sekunde: Sekundenzeiger springt mit kleinem Nachfedern; während der Aufgaben tickt es hörbar. */
    tickClock() {
      this.clockSeconds += 1;
      const second = this.hands.second;
      this.tweens.killTweensOf(second);
      second.setAngle(((this.clockSeconds - 1) % 60) * 6);   // exakt auf der vorigen Sekunde starten
      this.tweens.add({ targets: second, angle: '+=6', duration: 140, ease: 'Back.Out' });
      this.updateSlowHands();
      if (this.phase === 'question') SS.Audio.sfx('tick');
    }

    updateSlowHands() {
      this.hands.minute.setAngle(((this.clockSeconds / 60) % 60) * 6);
      this.hands.hour.setAngle(((this.clockSeconds / 3600) % 12) * 30);
    }

    // ── Ablenkungen ───────────────────────────────────────────────

    /** Mit etwas Pech passiert während der Aufgabe etwas im Raum. */
    maybeScheduleDistraction(questionMs) {
      if (Math.random() > DISTRACTION_CHANCE) return;
      const questionNo = this.questionNo;
      this.time.delayedCall(Phaser.Math.Between(1500, questionMs - 3000), () => {
        if (this.phase === 'question' && this.questionNo === questionNo) this.showDistraction(this.pickDistraction());
      });
    }

    pickDistraction() {
      const options = DISTRACTIONS.filter((d) => d !== this.lastDistraction && (d.spot !== 'pen' || this.penOnDesk));
      this.lastDistraction = Phaser.Utils.Array.GetRandom(options);
      return this.lastDistraction;
    }

    showDistraction(distraction) {
      if (distraction.sfx) SS.Audio.sfx(distraction.sfx);
      if (distraction.spot === 'pen') this.dropPen();
      const spot = this.distractionSpot(distraction.spot);
      this.popBubble(spot.x, spot.y, distraction.text, spot.maxWidth);
    }

    /** Wo erscheint die Einblendung? Nie über den Antworten. */
    distractionSpot(spot) {
      if (spot === 'wall') return { x: SIGN.x, y: 82, maxWidth: 320 };
      if (spot === 'pen') return { x: PEN.x - 10, y: PEN.y + 90, maxWidth: 80 };
      const left = Math.random() < 0.5;
      return { x: left ? 62 : 738, y: Phaser.Math.Between(200, 450), maxWidth: 80 };
    }

    /** Kurze Einblendung als Sprechblase, die nach oben wegschwebt. */
    popBubble(x, y, text, maxWidth) {
      const label = SS.UI.text(this, 0, 0, text, 'small', {
        color: INK, fontStyle: 'italic', align: 'center', wordWrap: { width: maxWidth }
      }).setOrigin(0.5);
      const w = label.width + 16;
      const h = label.height + 10;
      const bg = this.add.graphics()
        .fillStyle(0xffffff, 0.94).fillRoundedRect(-w / 2, -h / 2, w, h, 8)
        .lineStyle(2, 0x334155, 0.8).strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
      const safeX = Phaser.Math.Clamp(x, w / 2 + 6, C.WIDTH - w / 2 - 6);
      const bubble = this.add.container(safeX, y, [bg, label]).setDepth(DEPTH.bubble).setScale(0.6).setAlpha(0);
      this.tweens.add({ targets: bubble, scale: 1, alpha: 1, duration: 160, ease: 'Back.Out' });
      this.tweens.add({
        targets: bubble, y: y - 16, alpha: 0, delay: 1400, duration: 400,
        onComplete: () => bubble.destroy()
      });
    }

    /** Der Kuli rollt vom Tisch – und liegt ein paar Sekunden später wieder da. */
    dropPen() {
      this.penOnDesk = false;
      this.tweens.add({
        targets: this.pen, y: C.HEIGHT + 80, angle: 200, duration: 650, ease: 'Quad.In',
        onComplete: () => this.time.delayedCall(2500, () => this.returnPen())
      });
    }

    returnPen() {
      this.pen.setPosition(PEN.x, PEN.y).setAngle(PEN.angle).setAlpha(0);
      this.tweens.add({ targets: this.pen, alpha: 1, duration: 300, onComplete: () => { this.penOnDesk = true; } });
    }

    // ── Debug ─────────────────────────────────────────────────────

    /** Test-Hook: beantwortet die aktuelle Frage richtig (true) oder absichtlich falsch (false). */
    debugAnswer(correct) {
      if (this.phase !== 'question') return false;
      const right = this.current.correct;
      this.chooseAnswer(correct === false ? (right + 1) % 4 : right);
      return true;
    }
  }

  SS.scenes.KlausurScene = KlausurScene;
})();

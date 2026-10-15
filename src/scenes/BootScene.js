/*
 * BootScene.js – erste Szene: erzeugt alle Texturen und leitet weiter.
 *
 * Normaler Start: kurzer Splash mit Ladebalken, danach das Hauptmenü.
 * Debug-/Test-Start per URL (ohne Splash, damit Tests schnell sind):
 *   ?scene=GameScene&section=2&god=1&speed=3   Runner ab Abschnitt 3, unverwundbar, 3-faches Tempo
 *   ?scene=GameOverScene&outcome=failed        Zeugnis/Bescheid mit einem Beispiel-Durchlauf
 *                                              (outcome: graduated | failed | exmatrikuliert)
 *   ?scene=EduroamScene                        jede andere Szene direkt im Übungsmodus
 */
(function () {
  'use strict';
  const SS = globalThis.SS;
  const C = SS.CONFIG;

  // ── Splash ──────────────────────────────────────────────────
  const SPLASH_MS = 450;        // Ladebalken läuft voll …
  const FADE_MS = 150;          // … dann kurz ausblenden (zusammen ≈ 0,6 s)
  const BAR_W = 360;
  const BAR_H = 14;
  const BAR_Y = 330;
  const LOADING_LINES = [
    'Suche freie Steckdose im Hörsaal …',
    'Drucke Vorlesungsfolien doppelseitig …',
    'Koche Kaffee für die erste Vorlesung …',
    'Verschiebe Abgabetermin gedanklich …',
    'Sortiere ECTS nach Farbe …'
  ];

  // ── Beispiel-Durchlauf für ?scene=GameOverScene ─────────────
  // Pro Abschnitt: gesammelte Münzen, Crashes davor und das Ergebnis der Side Quest.
  const DEMO_SECTIONS = [
    { coins: 3, crashes: 0, quest: { id: 'eduroam', title: 'eduroam einrichten', success: true, ects: 3, message: 'Verbunden – beim dritten Zertifikat.' } },
    { coins: 2, crashes: 1, quest: { id: 'wasserspender', title: 'Wasserspender', success: true, ects: 2, message: 'Halbvoll ist auch voll.' } },
    { coins: 3, crashes: 2, quest: { id: 'klausur', title: 'Klausur', success: true, ects: 4, message: 'In der Nachklausur bestanden.' } },
    { coins: 3, crashes: 0, quest: { id: 'pruefung', title: 'Mündliche Projektarbeitsprüfung', success: true, ects: 5, grade: 2.3, message: 'Souverän verteidigt.' } }
  ];
  const DEMO_FAILED_EXAM = { id: 'pruefung', title: 'Mündliche Projektarbeitsprüfung', success: false, ects: 0, grade: 5.0, message: 'Die Rückfragen waren stärker.' };
  const DEMO_EXMATRIKULATION_SECTION = 2; // in Abschnitt 3 sind alle Versuche weg

  /** Spielt einen Abschnitt über die SS.State-API nach (Crashes kosten die Münzen des Versuchs). */
  function playDemoSection(plan, quest) {
    for (let i = 0; i < plan.crashes; i++) {
      SS.State.addEcts(1);
      SS.State.registerDeath();
    }
    SS.State.addEcts(plan.coins);
    SS.State.recordSideQuest(quest);
    SS.State.completeSection();
  }

  /** Crasht so lange, bis alle Versuche des aktuellen Abschnitts verbraucht sind. */
  function crashUntilExhausted() {
    let attempt;
    do {
      SS.State.addEcts(1);
      attempt = SS.State.registerDeath();
    } while (!attempt.exhausted);
  }

  /** Füllt SS.State mit einem plausiblen Durchlauf, damit die GameOverScene direkt testbar ist. */
  function fillDemoRun(requestedOutcome) {
    const Outcome = SS.State.Outcome;
    const outcome = Object.values(Outcome).includes(requestedOutcome) ? requestedOutcome : Outcome.GRADUATED;
    SS.State.newRun();
    DEMO_SECTIONS.forEach((plan, index) => {
      if (outcome === Outcome.EXMATRIKULIERT && index >= DEMO_EXMATRIKULATION_SECTION) return;
      const isLast = index === DEMO_SECTIONS.length - 1;
      playDemoSection(plan, isLast && outcome === Outcome.FAILED ? DEMO_FAILED_EXAM : plan.quest);
    });
    if (outcome === Outcome.EXMATRIKULIERT) crashUntilExhausted();
    SS.State.finishRun(outcome);
  }

  class BootScene extends Phaser.Scene {
    constructor() {
      super('BootScene');
    }

    create() {
      SS.Textures.generateAll(this);
      const route = this.resolveRoute(SS.getUrlParams());
      if (route.debug) {
        this.scene.start(route.key, route.data);
      } else {
        this.showSplash(() => this.scene.start(route.key, route.data));
      }
    }

    /** Ermittelt aus den URL-Parametern, welche Szene mit welchen Daten startet. */
    resolveRoute(params) {
      const key = params.scene;
      if (key === 'GameScene') {
        return {
          key,
          debug: true,
          data: {
            newRun: true,
            section: Number(params.section) || 0,
            god: params.god === '1',
            timeScale: Number(params.speed) || 1
          }
        };
      }
      if (key === 'GameOverScene') {
        fillDemoRun(params.outcome);
        return { key, debug: true, data: { debug: true } };
      }
      if (key && key !== 'BootScene' && this.scene.get(key)) {
        return { key, debug: true, data: { practice: true, debug: true } };
      }
      if (key) console.warn('[BootScene] Szene aus der URL nicht startbar, zeige Menü:', key);
      return { key: 'MenuScene', debug: false, data: {} };
    }

    /** Kurzer Splash: Schriftzug, Ladebalken mit hüpfendem Würfel, dann Ausblenden. */
    showSplash(onDone) {
      const cx = C.WIDTH / 2;
      const barX = cx - BAR_W / 2;
      SS.UI.background(this, C.COLORS.night, C.COLORS.panel);
      SS.UI.text(this, cx, 262, 'DHBW · Studiums-Simulator', 'h1', { fontSize: '34px' }).setOrigin(0.5);
      SS.UI.text(this, cx, 372, Phaser.Utils.Array.GetRandom(LOADING_LINES), 'small').setOrigin(0.5);

      const bar = this.add.graphics();
      const cube = this.add.rectangle(barX, BAR_Y - 14, 16, 16, C.COLORS.dhbwRed).setStrokeStyle(2, 0x000000);
      const progress = { value: 0 };

      this.tweens.add({
        targets: progress,
        value: 1,
        duration: SPLASH_MS,
        ease: 'Sine.InOut',
        onUpdate: () => {
          this.drawLoadingBar(bar, barX, progress.value);
          cube.setPosition(barX + BAR_W * progress.value, BAR_Y - 14 - Math.abs(Math.sin(progress.value * Math.PI * 3)) * 14);
          cube.setAngle(progress.value * 540);
        },
        onComplete: () => {
          this.cameras.main.fadeOut(FADE_MS, 0, 0, 0);
          this.cameras.main.once('camerafadeoutcomplete', onDone);
        }
      });
      this.drawLoadingBar(bar, barX, 0);
    }

    drawLoadingBar(g, x, fraction) {
      g.clear();
      g.fillStyle(0x000000, 0.5);
      g.fillRoundedRect(x, BAR_Y, BAR_W, BAR_H, BAR_H / 2);
      if (fraction > 0) {
        g.fillStyle(C.COLORS.dhbwRed, 1);
        g.fillRoundedRect(x + 2, BAR_Y + 2, Math.max(BAR_H - 4, (BAR_W - 4) * fraction), BAR_H - 4, (BAR_H - 4) / 2);
      }
      g.lineStyle(2, 0xffffff, 0.8);
      g.strokeRoundedRect(x, BAR_Y, BAR_W, BAR_H, BAR_H / 2);
    }
  }

  SS.scenes.BootScene = BootScene;
})();

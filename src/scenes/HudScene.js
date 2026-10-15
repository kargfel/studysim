/*
 * HudScene.js – Anzeige über dem Runner: ECTS, Fortschritt, Versuch und Phase.
 *
 * Läuft als eigene Szene parallel zur GameScene (die sie startet und beendet).
 * Liest jeden Frame SS.State.run und GameScene.getHudInfo() – nur lesend,
 * der Spielstand wird hier nie verändert. Texte werden nur bei Änderungen
 * neu gesetzt, damit nicht jeden Frame neu gerendert werden muss.
 */
(function () {
  'use strict';
  const SS = globalThis.SS;
  const C = SS.CONFIG;

  const MARGIN = 20;
  const BAR = { x: 250, y: 18, w: 300, h: 20 };   // Fortschrittsbalken oben in der Mitte
  const PIP = { size: 10, gap: 5 };               // Kästchen für die verbleibenden Versuche
  const ATTEMPT_LABELS = ['Erstversuch', 'Nachklausur 1', 'Nachklausur 2'];
  const ATTEMPT_COLORS = [C.CSS.ink, C.CSS.yellow, C.CSS.danger];
  const PHASE_COLORS = { Theoriephase: C.CSS.cyan, Praxisphase: '#fb923c' };
  const HELP_TEXT = 'Leertaste/Klick: springen · Esc: Pause · M: Ton';

  /** Werte, falls die GameScene (noch) nichts liefert. */
  const FALLBACK_INFO = {
    progress: 0, sectionIndex: 0, sectionCount: 0, sectionTitle: '',
    phaseLabel: 'Theoriephase', speedLabel: 'normal', sectionMarks: [], debugLabel: ''
  };

  const OUTLINE = { stroke: '#000000', strokeThickness: 3 };

  class HudScene extends Phaser.Scene {
    constructor() {
      super('HudScene');
    }

    create() {
      this.shown = {};   // zuletzt angezeigte Werte
      this.createEctsCounter();
      this.createProgressBar();
      this.createStatus();
      this.createHelpLine();
    }

    update() {
      const info = this.readGameInfo();
      this.showEcts(SS.State.run.ects);
      this.showProgress(info.progress, info.sectionMarks);
      this.showSection(info);
      this.showAttempt(info.attempt);
      this.showPhase(info.phaseLabel, info.speedLabel);
      this.showHelp(SS.Audio.isMuted(), info.debugLabel);
    }

    /** Defensiv lesen: die GameScene kann gerade erst starten oder schon beendet sein. */
    readGameInfo() {
      const game = this.scene.get('GameScene');
      const info = game && typeof game.getHudInfo === 'function' ? game.getHudInfo() : null;
      return Object.assign({}, FALLBACK_INFO, { attempt: SS.State.run.attempt }, info || {});
    }

    // ── ECTS oben links ──────────────────────────────────────────

    createEctsCounter() {
      const icon = this.add.image(0, 0, 'rn_coin').setScale(0.85);
      this.ectsText = SS.UI.text(this, 22, 1, '0 ECTS', 'hud', { fontSize: '22px' }).setOrigin(0, 0.5);
      this.ectsGroup = this.add.container(MARGIN + 15, MARGIN + 14, [icon, this.ectsText]);
    }

    /** Kleine Pop-Animation: gelb bei Gewinn, rot bei Verlust (Crash). */
    showEcts(ects) {
      const before = this.shown.ects;
      if (ects === before) return;
      this.shown.ects = ects;
      this.ectsText.setText(ects + ' ECTS');
      if (before === undefined) return;
      const gained = ects > before;
      this.ectsText.setColor(gained ? C.CSS.yellow : C.CSS.danger);
      this.tweens.killTweensOf(this.ectsGroup);
      this.ectsGroup.setScale(gained ? 1.35 : 0.75);
      this.tweens.add({
        targets: this.ectsGroup, scale: 1, duration: 320, ease: 'Back.Out',
        onComplete: () => this.ectsText.setColor(C.CSS.ink)
      });
    }

    // ── Fortschritt oben in der Mitte ────────────────────────────

    createProgressBar() {
      this.barGfx = this.add.graphics();
      this.percentText = SS.UI.text(this, BAR.x + BAR.w / 2, BAR.y + BAR.h / 2 + 1, '0 %', 'hud', {
        fontSize: '13px', strokeThickness: 3
      }).setOrigin(0.5);
      this.sectionText = SS.UI.text(this, C.WIDTH / 2, BAR.y + BAR.h + 15, '', 'small', Object.assign({
        fontSize: '15px', fontStyle: 'bold', color: C.CSS.ink
      }, OUTLINE)).setOrigin(0.5);
    }

    showProgress(progress, marks) {
      const fraction = Phaser.Math.Clamp(progress || 0, 0, 1);
      const fillWidth = Math.round((BAR.w - 4) * fraction);
      if (fillWidth !== this.shown.fillWidth) {
        this.shown.fillWidth = fillWidth;
        this.drawBar(fillWidth, marks || []);
      }
      const percent = Math.floor(fraction * 100);
      if (percent !== this.shown.percent) {
        this.shown.percent = percent;
        this.percentText.setText(percent + ' %');
      }
    }

    /** GD-Balken: dunkle Schiene, rote Füllung mit Glanzlicht, Striche an den Checkpoints. */
    drawBar(fillWidth, marks) {
      const g = this.barGfx;
      const r = BAR.h / 2;
      const inner = BAR.w - 4;
      g.clear();
      g.fillStyle(0x000000, 0.5).fillRoundedRect(BAR.x, BAR.y, BAR.w, BAR.h, r);
      if (fillWidth > 0) {
        const w = Math.max(fillWidth, BAR.h - 4);
        g.fillStyle(C.COLORS.dhbwRed, 1).fillRoundedRect(BAR.x + 2, BAR.y + 2, w, BAR.h - 4, r - 2);
        g.fillStyle(0xffffff, 0.3).fillRect(BAR.x + r, BAR.y + 4, Math.max(0, w - 2 * r + 4), 2);
      }
      // Checkpoint-Striche nur am oberen und unteren Rand – die Mitte gehört der Prozentzahl
      g.fillStyle(0xffffff, 0.75);
      marks.forEach((m) => {
        const x = BAR.x + 2 + inner * m - 1;
        g.fillRect(x, BAR.y + 2, 2, 4);
        g.fillRect(x, BAR.y + BAR.h - 6, 2, 4);
      });
      g.lineStyle(2, 0xffffff, 0.9).strokeRoundedRect(BAR.x, BAR.y, BAR.w, BAR.h, r);
    }

    showSection(info) {
      const label = info.sectionTitle
        ? `Abschnitt ${info.sectionIndex + 1}/${info.sectionCount || '?'} · ${info.sectionTitle}`
        : '';
      if (label === this.shown.section) return;
      this.shown.section = label;
      this.sectionText.setText(label);
    }

    // ── Versuch und Phase oben rechts ────────────────────────────

    createStatus() {
      const right = C.WIDTH - MARGIN;
      this.attemptText = SS.UI.text(this, right, MARGIN - 2, '', 'hud', { fontSize: '18px' }).setOrigin(1, 0);
      this.phaseText = SS.UI.text(this, right, MARGIN + 26, '', 'small', Object.assign({ fontStyle: 'bold' }, OUTLINE))
        .setOrigin(1, 0);
      this.pips = this.add.graphics();
    }

    showAttempt(attempt) {
      if (attempt === this.shown.attempt) return;
      const isChange = this.shown.attempt !== undefined;
      this.shown.attempt = attempt;
      const i = Phaser.Math.Clamp((attempt | 0) - 1, 0, ATTEMPT_LABELS.length - 1);
      this.attemptText.setText(ATTEMPT_LABELS[i]).setColor(ATTEMPT_COLORS[i]);
      this.drawPips(C.ATTEMPTS_PER_SECTION - i);
      if (isChange) this.tweens.add({ targets: this.attemptText, scale: { from: 1.3, to: 1 }, duration: 320, ease: 'Back.Out' });
    }

    /** Ein Kästchen pro Versuch; gefüllt = noch übrig. */
    drawPips(remaining) {
      const g = this.pips;
      const count = C.ATTEMPTS_PER_SECTION;
      const right = C.WIDTH - MARGIN - this.attemptText.width - 10;
      const left = right - count * PIP.size - (count - 1) * PIP.gap;
      g.clear();
      for (let k = 0; k < count; k++) {
        const x = left + k * (PIP.size + PIP.gap);
        const filled = k < remaining;
        g.fillStyle(filled ? C.COLORS.dhbwRed : 0x000000, filled ? 1 : 0.4).fillRect(x, MARGIN + 3, PIP.size, PIP.size);
        g.lineStyle(2, 0xffffff, 0.9).strokeRect(x, MARGIN + 3, PIP.size, PIP.size);
      }
    }

    showPhase(phaseLabel, speedLabel) {
      const label = phaseLabel + (speedLabel === 'schnell' ? ' · schnell' : '');
      if (label === this.shown.phase) return;
      this.shown.phase = label;
      this.phaseText.setText(label).setColor(PHASE_COLORS[phaseLabel] || C.CSS.inkSoft);
    }

    // ── Hilfezeile unten ─────────────────────────────────────────

    createHelpLine() {
      this.helpText = SS.UI.text(this, C.WIDTH / 2, C.HEIGHT - MARGIN + 4, HELP_TEXT, 'small', Object.assign({ fontSize: '14px' }, OUTLINE))
        .setOrigin(0.5, 1).setAlpha(0.85);
      this.debugText = SS.UI.text(this, MARGIN, C.HEIGHT - MARGIN + 4, '', 'small', Object.assign({
        fontSize: '13px', color: C.CSS.yellow
      }, OUTLINE)).setOrigin(0, 1);
    }

    showHelp(muted, debugLabel) {
      const help = HELP_TEXT + (muted ? ' (aus)' : '');
      if (help !== this.shown.help) {
        this.shown.help = help;
        this.helpText.setText(help);
      }
      if (debugLabel !== this.shown.debug) {
        this.shown.debug = debugLabel;
        this.debugText.setText(debugLabel || '');
      }
    }
  }

  SS.scenes.HudScene = HudScene;
})();

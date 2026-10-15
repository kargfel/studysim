/*
 * PauseScene.js – halbtransparentes Pausen-Overlay über der angehaltenen GameScene.
 *
 * Die GameScene pausiert sich selbst und startet diese Szene per scene.launch('PauseScene').
 * Esc/P/Enter: weiter · „Hauptmenü“: Lauf abbrechen · M: Ton an/aus
 */
(function () {
  'use strict';
  const SS = globalThis.SS;
  const C = SS.CONFIG;

  const GAME_KEY = 'GameScene';
  const HUD_KEY = 'HudScene';
  const CX = C.WIDTH / 2;
  const PANEL_W = 400;
  const PANEL_H = 360;
  const PANEL_TOP = (C.HEIGHT - PANEL_H) / 2;
  const DIM_ALPHA = 0.55;
  const BUTTON_W = 260;

  class PauseScene extends Phaser.Scene {
    constructor() {
      super('PauseScene');
    }

    create() {
      this.closing = false;
      this.add.rectangle(0, 0, C.WIDTH, C.HEIGHT, 0x000000, DIM_ALPHA).setOrigin(0);
      const card = this.add.container(0, 0, this.createCard());
      this.popIn(card);
      this.bindKeys();
    }

    /** Panel mit Titel, Lauf-Infos und den drei Buttons. */
    createCard() {
      const top = PANEL_TOP;
      const panel = SS.UI.panel(this, CX - PANEL_W / 2, top, PANEL_W, PANEL_H, { lineColor: C.COLORS.dhbwRed, lineWidth: 3 });
      const title = SS.UI.text(this, CX, top + 50, 'PAUSE', 'title', { fontSize: '52px' }).setOrigin(0.5);
      const info = SS.UI.text(this, CX, top + 100, this.describeRun(), 'small', {
        align: 'center', fontSize: '15px', wordWrap: { width: PANEL_W - 40 }
      }).setOrigin(0.5);
      this.resumeButton = SS.UI.button(this, CX, top + 158, 'Weiter', () => this.resumeGame(), { width: BUTTON_W });
      const menu = SS.UI.button(this, CX, top + 222, 'Hauptmenü', () => this.quitToMenu(), {
        width: BUTTON_W, color: C.COLORS.dhbwGray
      });
      this.soundButton = SS.UI.button(this, CX, top + 282, soundLabel(), () => this.toggleSound(), {
        width: BUTTON_W, height: 44, fontSize: '18px', color: C.COLORS.dhbwGray
      });
      const hint = SS.UI.text(this, CX, top + PANEL_H - 22, 'Esc/P/Enter: weiter · M: Ton · Hauptmenü bricht den Lauf ab', 'small', {
        fontSize: '13px'
      }).setOrigin(0.5);
      return [panel, title, info, this.resumeButton, menu, this.soundButton, hint];
    }

    /** Kurzinfo zum Lauf, z. B. „Abschnitt 2 · Vorlesungszeit · Versuch 1/3 · 7 ECTS“. */
    describeRun() {
      const run = SS.State.run;
      const game = this.scene.get(GAME_KEY);
      const hud = game && typeof game.getHudInfo === 'function' ? game.getHudInfo() : {};
      const parts = [`Abschnitt ${run.sectionIndex + 1}`];
      if (hud.sectionTitle) parts.push(hud.sectionTitle);
      parts.push(`Versuch ${run.attempt}/${C.ATTEMPTS_PER_SECTION}`);
      parts.push(`${run.ects} ECTS`);
      return parts.join(' · ');
    }

    popIn(card) {
      card.setAlpha(0).setY(18);
      this.tweens.add({ targets: card, alpha: 1, y: 0, duration: 160, ease: 'Back.Out' });
    }

    /**
     * Tasten lösen dieselben Buttons aus wie ein Klick. Gehaltene Tasten (Auto-Repeat)
     * zählen nicht – sonst würde ein gehaltenes Esc Pause und Weiter im Wechsel auslösen.
     */
    bindKeys() {
      const bind = (keyName, button) => SS.UI.onKey(this, keyName, (event) => {
        if (!event || !event.repeat) button.press();
      });
      bind('ESC', this.resumeButton);
      bind('P', this.resumeButton);
      bind('ENTER', this.resumeButton);
      bind('M', this.soundButton);
    }

    // ── Aktionen ──────────────────────────────────────────────

    resumeGame() {
      if (this.closing) return;
      this.closing = true;
      if (this.scene.isPaused(GAME_KEY)) {
        this.scene.resume(GAME_KEY);
        this.scene.stop();
      } else {
        this.scene.start('MenuScene'); // direkt per ?scene=PauseScene geöffnet: kein Lauf zum Fortsetzen
      }
    }

    quitToMenu() {
      if (this.closing) return;
      this.closing = true;
      this.scene.stop(HUD_KEY);
      this.scene.stop(GAME_KEY);
      this.scene.start('MenuScene');
    }

    toggleSound() {
      SS.Audio.toggleMute();
      this.soundButton.setLabel(soundLabel());
    }
  }

  function soundLabel() {
    return SS.Audio.isMuted() ? 'Ton: aus (M)' : 'Ton: an (M)';
  }

  SS.scenes.PauseScene = PauseScene;
})();

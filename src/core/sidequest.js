/*
 * sidequest.js – gemeinsamer Ablauf aller Side Quests.
 *
 * Ablauf einer Side-Quest-Szene:
 *   create() → SS.SideQuest.intro(this, {...}, () => startGameplay())
 *   … eigenes Gameplay …
 *   SS.SideQuest.outro(this, result)   // Ergebniskarte, „Weiter“ ruft finish()
 *
 * result = { id, title, success, ects, message, grade? }
 *
 * Gestartet wird eine Side Quest entweder von der GameScene (die dann pausiert
 * ist und per resume das Ergebnis bekommt) oder aus dem Menü im Übungsmodus
 * (data.practice === true → zurück ins Menü, Spielstand bleibt unberührt).
 */
(function () {
  'use strict';
  const SS = (globalThis.SS = globalThis.SS || {});
  const C = SS.CONFIG;

  const SideQuest = {
    isPractice(scene) {
      const data = scene.sys.settings.data;
      return !!(data && data.practice);
    },

    /**
     * Titelkarte mit Erklärung. onStart wird nach Klick/Enter/Leertaste aufgerufen.
     * cfg: { title, subtitle?, lines?: string[], buttonLabel?, accent? }
     */
    intro(scene, cfg, onStart) {
      const accent = cfg.accent != null ? cfg.accent : C.COLORS.yellow;
      const lines = cfg.lines || [];
      const panelW = 620;
      const panelH = 210 + lines.length * 30;
      const px = (C.WIDTH - panelW) / 2;
      const py = (C.HEIGHT - panelH) / 2;
      const dim = scene.add.rectangle(0, 0, C.WIDTH, C.HEIGHT, 0x000000, 0.55).setOrigin(0);
      const panel = SS.UI.panel(scene, px, py, panelW, panelH, { lineColor: accent, lineWidth: 3 });
      const tag = SS.UI.text(scene, C.WIDTH / 2, py + 26, cfg.tag || 'SIDE QUEST', 'small', {
        color: SS.Textures.hex(accent), fontSize: '16px', fontStyle: 'bold'
      }).setOrigin(0.5);
      const title = SS.UI.text(scene, C.WIDTH / 2, py + 62, cfg.title, 'h1', { fontSize: '32px' }).setOrigin(0.5);
      const items = [dim, panel, tag, title];
      if (cfg.subtitle) {
        items.push(SS.UI.text(scene, C.WIDTH / 2, py + 100, cfg.subtitle, 'body', {
          color: C.CSS.inkSoft, fontSize: '18px', align: 'center', wordWrap: { width: panelW - 60 }
        }).setOrigin(0.5));
      }
      lines.forEach((line, i) => {
        items.push(SS.UI.text(scene, px + 44, py + 132 + i * 30, '• ' + line, 'body', {
          fontSize: '18px', wordWrap: { width: panelW - 88 }
        }));
      });
      let started = false;
      const start = () => {
        if (started) return;
        started = true;
        container.destroy();
        if (SS.Audio) SS.Audio.unlock();
        onStart();
      };
      const btn = SS.UI.button(scene, C.WIDTH / 2, py + panelH - 40, cfg.buttonLabel || "Los geht's", start, {
        color: C.COLORS.dhbwRed, key: 'ENTER'
      });
      items.push(btn);
      const container = scene.add.container(0, 0, items).setDepth(2000);
      container.setScrollFactor(0, 0, true);
      // Leertaste startet ebenfalls (aber erst nach kurzer Zeit, damit ein gehaltener Sprung nicht durchrutscht)
      scene.time.delayedCall(350, () => SS.UI.onKey(scene, 'SPACE', start));
      return container;
    },

    /**
     * Ergebniskarte. „Weiter“ (oder Enter) beendet die Side Quest über finish().
     */
    outro(scene, result, opts) {
      const o = opts || {};
      const ok = !!result.success;
      const practice = this.isPractice(scene);
      const panelW = 600;
      const panelH = 280;
      const px = (C.WIDTH - panelW) / 2;
      const py = (C.HEIGHT - panelH) / 2;
      const color = ok ? C.COLORS.green : C.COLORS.danger;
      const dim = scene.add.rectangle(0, 0, C.WIDTH, C.HEIGHT, 0x000000, 0.6).setOrigin(0);
      const panel = SS.UI.panel(scene, px, py, panelW, panelH, { lineColor: color, lineWidth: 4 });
      const headline = o.headline || (ok ? 'GESCHAFFT!' : 'NICHT BESTANDEN');
      const title = SS.UI.text(scene, C.WIDTH / 2, py + 52, headline, 'h1', {
        fontSize: '40px', color: SS.Textures.hex(color)
      }).setOrigin(0.5);
      const ects = result.ects | 0;
      const ectsLabel = (ects > 0 ? '+' : '') + ects + ' ECTS';
      const ectsText = SS.UI.text(scene, C.WIDTH / 2, py + 104, ectsLabel + (practice ? '  (Übungsmodus)' : ''), 'h2', {
        color: ects > 0 ? C.CSS.yellow : C.CSS.inkSoft
      }).setOrigin(0.5);
      const msg = SS.UI.text(scene, C.WIDTH / 2, py + 160, result.message || '', 'body', {
        fontSize: '18px', align: 'center', wordWrap: { width: panelW - 60 }
      }).setOrigin(0.5);
      const btn = SS.UI.button(scene, C.WIDTH / 2, py + panelH - 42, practice ? 'Zurück zum Menü' : 'Weiter', () => this.finish(scene, result), {
        color: C.COLORS.dhbwRed, key: 'ENTER'
      });
      const container = scene.add.container(0, 0, [dim, panel, title, ectsText, msg, btn]).setDepth(2100);
      container.setScrollFactor(0, 0, true);
      if (SS.Audio) SS.Audio.sfx(ok ? 'success' : 'fail');
      if (ok) SS.UI.confetti(scene, C.WIDTH / 2, py + 40);
      else SS.UI.shake(scene, 250, 0.012);
      return container;
    },

    /** Ergebnis übernehmen und zur GameScene (bzw. ins Menü) zurückkehren. */
    finish(scene, result) {
      if (scene.__sideQuestFinished) return;
      scene.__sideQuestFinished = true;
      const game = scene.scene.get('GameScene');
      const fromRun = !this.isPractice(scene) && game && scene.scene.isPaused('GameScene');
      if (!fromRun) {
        scene.scene.start('MenuScene', { practiceResult: result });
        return;
      }
      const entry = SS.State.recordSideQuest(result);
      scene.scene.resume('GameScene', { sideQuestResult: entry });
      scene.scene.stop();
    }
  };

  SS.SideQuest = SideQuest;
})();

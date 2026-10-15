/* PLATZHALTER – wird durch den echten Runner ersetzt. Simuliert nur die Checkpoints. */
(function () {
  'use strict';
  const SS = globalThis.SS;
  const C = SS.CONFIG;
  class GameScene extends Phaser.Scene {
    constructor() { super('GameScene'); }
    init(data) {
      this.startData = data || {};
    }
    create() {
      if (this.startData.newRun !== false) SS.State.newRun();
      if (this.startData.section) SS.State.jumpToSection(this.startData.section);
      this.world = SS.Level.parse(SS.Levels.semester);
      SS.UI.background(this, 0x1e3a8a, 0x0ea5e9);
      this.info = SS.UI.text(this, C.WIDTH / 2, 200, '', 'h2', { align: 'center' }).setOrigin(0.5);
      SS.UI.button(this, C.WIDTH / 2, 360, 'Checkpoint simulieren', () => this.reachCheckpoint(), { width: 340, key: 'ENTER' });
      this.events.on('resume', (sys, data) => this.onSideQuestDone(data));
      this.refresh();
    }
    refresh() {
      const sec = this.world.sections[SS.State.run.sectionIndex];
      this.info.setText(sec ? `Abschnitt ${sec.index + 1}: ${sec.title}\nECTS: ${SS.State.run.ects}` : 'Ende');
    }
    reachCheckpoint() {
      const sec = this.world.sections[SS.State.run.sectionIndex];
      this.scene.pause();
      this.scene.launch(sec.sideQuest, { sectionIndex: sec.index });
    }
    onSideQuestDone() {
      const next = SS.State.completeSection();
      if (next >= this.world.sections.length) {
        const grade = SS.State.run.grade;
        SS.State.finishRun(grade !== null && grade <= C.PASS_GRADE ? 'graduated' : 'failed');
        this.scene.start('GameOverScene', {});
        return;
      }
      this.refresh();
    }
    getHudInfo() {
      return { progress: 0, phaseLabel: 'Theoriephase', sectionTitle: '', speedLabel: 'normal' };
    }
  }
  SS.scenes.GameScene = GameScene;
})();

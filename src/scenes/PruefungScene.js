/* PLATZHALTER – wird durch die echte Side Quest ersetzt. */
(function () {
  'use strict';
  const SS = globalThis.SS;
  const C = SS.CONFIG;
  class PruefungScene extends Phaser.Scene {
    constructor() { super('PruefungScene'); }
    create() {
      SS.UI.background(this, C.COLORS.night, C.COLORS.panel);
      SS.SideQuest.intro(this, { title: 'Mündliche Projektarbeitsprüfung', subtitle: 'Platzhalter', lines: ['Diese Szene wird gerade gebaut.'] }, () => {
        SS.SideQuest.outro(this, { id: 'pruefung', title: 'Mündliche Projektarbeitsprüfung', success: true, ects: 1, message: 'Platzhalter bestanden.', grade: 2.3 });
      });
    }
  }
  SS.scenes.PruefungScene = PruefungScene;
})();

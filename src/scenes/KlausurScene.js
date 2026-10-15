/* PLATZHALTER – wird durch die echte Side Quest ersetzt. */
(function () {
  'use strict';
  const SS = globalThis.SS;
  const C = SS.CONFIG;
  class KlausurScene extends Phaser.Scene {
    constructor() { super('KlausurScene'); }
    create() {
      SS.UI.background(this, C.COLORS.night, C.COLORS.panel);
      SS.SideQuest.intro(this, { title: 'Klausur', subtitle: 'Platzhalter', lines: ['Diese Szene wird gerade gebaut.'] }, () => {
        SS.SideQuest.outro(this, { id: 'klausur', title: 'Klausur', success: true, ects: 1, message: 'Platzhalter bestanden.' });
      });
    }
  }
  SS.scenes.KlausurScene = KlausurScene;
})();

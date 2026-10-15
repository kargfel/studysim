/*
 * semester.js – VORLÄUFIGES Beispiel-Level (kurz). Wird durch das echte Level ersetzt.
 * Format: siehe src/core/level.js
 */
(function () {
  'use strict';
  const SS = globalThis.SS;
  const L = SS.Level;

  const spike = ['^', '='];
  const spike2 = ['^^', '=='];
  const block = ['#', '='];
  const stairs = [
    '  #',
    ' ##',
    '==='
  ];
  const coins = [
    ' o ',
    'o o',
    '   ',
    '==='
  ];
  const padJump = [
    '      ',
    '   ## ',
    '   ## ',
    'J  ## ',
    '======'
  ];
  const orbJump = [
    '   O    ',
    '        ',
    '        ',
    '  ^^^^  ',
    '========'
  ];
  // Praxisphase: Portal, Decke, hängende Stacheln, zurück zur Theorie
  const praxis = [
    '##########################',
    '        v       v         ',
    '                          ',
    '                          ',
    ' G                     T  ',
    '                          ',
    '=========================='
  ];

  SS.Levels.semester = {
    id: 'semester',
    title: 'Ein Semester',
    sections: [
      {
        id: 'semesterstart',
        title: 'Semesterstart',
        subtitle: 'Erster Tag auf dem Campus',
        theme: 'campus',
        sideQuest: 'EduroamScene',
        rows: L.join(L.gap(10), spike, L.gap(8), coins, L.gap(5), block, L.gap(6), spike2, L.gap(8), stairs, L.gap(10))
      },
      {
        id: 'vorlesungszeit',
        title: 'Vorlesungszeit',
        subtitle: 'Theorie- und Praxisphase im Wechsel',
        theme: 'vorlesung',
        sideQuest: 'WasserspenderScene',
        rows: L.join(L.gap(10), spike, L.gap(8), praxis, L.gap(8), spike2, L.gap(10))
      },
      {
        id: 'klausurenphase',
        title: 'Klausurenphase',
        subtitle: 'Alles wird schneller',
        theme: 'klausur',
        speed: 'fast',
        sideQuest: 'KlausurScene',
        rows: L.join(L.gap(12), spike, L.gap(9), spike2, L.gap(9), L.pit(2), L.gap(9), coins, L.gap(12))
      },
      {
        id: 'projektphase',
        title: 'Projektphase',
        subtitle: 'Die Projektarbeit muss fertig werden',
        theme: 'projekt',
        sideQuest: 'PruefungScene',
        rows: L.join(L.gap(10), padJump, L.gap(8), orbJump, L.gap(8), spike, L.gap(12))
      }
    ]
  };
})();

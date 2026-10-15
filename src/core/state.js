/*
 * state.js – Spielstand eines Durchlaufs (ein Semester) und Highscore.
 *
 * Reine Logik ohne Phaser, damit sie in Node getestet werden kann.
 * Szenen lesen über SS.State.run und ändern nur über die Methoden hier.
 */
(function () {
  'use strict';
  const SS = (globalThis.SS = globalThis.SS || {});
  const C = SS.CONFIG;

  const Outcome = Object.freeze({
    GRADUATED: 'graduated',          // Semester bestanden
    FAILED: 'failed',                // Prüfung schlechter als 4,0
    EXMATRIKULIERT: 'exmatrikuliert' // alle Versuche eines Abschnitts verbraucht
  });

  function now() {
    return (globalThis.performance && performance.now) ? performance.now() : Date.now();
  }

  function createRun() {
    return {
      ects: 0,
      ectsAtSectionStart: 0,   // Stand am letzten Checkpoint (Crash setzt hierauf zurück)
      sectionIndex: 0,
      attempt: 1,              // 1 = Erstversuch, 2–3 = Nachklausuren
      deaths: 0,
      sideQuests: [],          // Ergebnisse der Side Quests (siehe recordSideQuest)
      grade: null,             // Note der mündlichen Prüfung (1,0–5,0)
      startedAt: now(),
      finishedAt: null,
      outcome: null
    };
  }

  const State = {
    Outcome,
    run: createRun(),

    /** Startet ein neues Semester (setzt alles zurück). */
    newRun() {
      this.run = createRun();
      return this.run;
    },

    /** Startet direkt in einem späteren Abschnitt (Debug/Übungsmodus). */
    jumpToSection(index) {
      this.run.sectionIndex = Math.max(0, index | 0);
      this.run.attempt = 1;
      this.run.ectsAtSectionStart = this.run.ects;
    },

    addEcts(amount) {
      this.run.ects = Math.max(0, this.run.ects + (amount | 0));
      return this.run.ects;
    },

    /**
     * Crash im Runner. Setzt die ECTS des Abschnitts zurück und verbraucht einen Versuch.
     * @returns {{attempt:number, attemptsLeft:number, exhausted:boolean}}
     */
    registerDeath() {
      const run = this.run;
      run.deaths += 1;
      run.ects = run.ectsAtSectionStart;
      const exhausted = run.attempt >= C.ATTEMPTS_PER_SECTION;
      if (!exhausted) run.attempt += 1;
      return { attempt: run.attempt, attemptsLeft: C.ATTEMPTS_PER_SECTION - run.attempt, exhausted };
    },

    /** Checkpoint erreicht: ECTS sind „sicher“, Versuche werden zurückgesetzt. */
    completeSection() {
      const run = this.run;
      run.ectsAtSectionStart = run.ects;
      run.sectionIndex += 1;
      run.attempt = 1;
      return run.sectionIndex;
    },

    /**
     * Ergebnis einer Side Quest speichern.
     * @param {{id:string, title:string, success:boolean, ects:number, message?:string, grade?:number}} result
     */
    recordSideQuest(result) {
      const entry = {
        id: String(result.id || 'unbekannt'),
        title: String(result.title || result.id || 'Side Quest'),
        success: !!result.success,
        ects: result.ects | 0,
        message: result.message ? String(result.message) : '',
        grade: typeof result.grade === 'number' ? result.grade : null
      };
      this.run.sideQuests.push(entry);
      if (entry.ects) this.addEcts(entry.ects);
      this.run.ectsAtSectionStart = this.run.ects;
      if (entry.grade !== null && entry.id === 'pruefung') this.run.grade = entry.grade; // Endnote = mündliche Prüfung
      return entry;
    },

    finishRun(outcome) {
      this.run.outcome = outcome;
      this.run.finishedAt = now();
      return this.run;
    },

    /** Spielzeit in Sekunden (bis jetzt oder bis zum Ende). */
    elapsedSeconds() {
      const end = this.run.finishedAt || now();
      return Math.max(0, (end - this.run.startedAt) / 1000);
    },

    // ── Highscore (localStorage, robust gegen gesperrten Speicher) ──
    loadHighscore() {
      try {
        const raw = globalThis.localStorage && localStorage.getItem(C.STORAGE_KEY);
        const data = raw ? JSON.parse(raw) : null;
        return {
          bestEcts: Number(data && data.bestEcts) || 0,
          bestGrade: (data && typeof data.bestGrade === 'number') ? data.bestGrade : null,
          runs: Number(data && data.runs) || 0,
          graduations: Number(data && data.graduations) || 0
        };
      } catch (e) {
        return { bestEcts: 0, bestGrade: null, runs: 0, graduations: 0 };
      }
    },

    /**
     * Übernimmt den aktuellen Durchlauf in den Highscore.
     * @returns {{highscore:object, newBestEcts:boolean, newBestGrade:boolean}}
     */
    saveHighscore() {
      const hs = this.loadHighscore();
      const run = this.run;
      const newBestEcts = run.ects > hs.bestEcts;
      const graduated = run.outcome === Outcome.GRADUATED;
      const newBestGrade = graduated && run.grade !== null && (hs.bestGrade === null || run.grade < hs.bestGrade);
      const next = {
        bestEcts: Math.max(hs.bestEcts, run.ects),
        bestGrade: newBestGrade ? run.grade : hs.bestGrade,
        runs: hs.runs + 1,
        graduations: hs.graduations + (graduated ? 1 : 0)
      };
      try {
        if (globalThis.localStorage) localStorage.setItem(C.STORAGE_KEY, JSON.stringify(next));
      } catch (e) { /* privater Modus o. Ä.: Highscore geht dann eben verloren */ }
      return { highscore: next, newBestEcts, newBestGrade };
    }
  };

  /** Formatiert eine Note deutsch: 1.3 → "1,3". */
  State.formatGrade = function formatGrade(grade) {
    if (typeof grade !== 'number' || !isFinite(grade)) return '–';
    return grade.toFixed(1).replace('.', ',');
  };

  /** Rundet auf die an Hochschulen üblichen Notenstufen (1,0 1,3 1,7 2,0 … 4,0 5,0). */
  State.roundGrade = function roundGrade(raw) {
    const steps = [1.0, 1.3, 1.7, 2.0, 2.3, 2.7, 3.0, 3.3, 3.7, 4.0, 5.0];
    if (typeof raw !== 'number' || !isFinite(raw)) return 5.0;
    if (raw > 4.0 + 1e-9) return 5.0;
    let best = steps[0];
    // Toleranz: genau in der Mitte zweier Stufen gewinnt die bessere Note (statt Gleitkomma-Zufall)
    for (const s of steps) if (Math.abs(s - raw) < Math.abs(best - raw) - 1e-9) best = s;
    return best;
  };

  SS.State = State;
})();

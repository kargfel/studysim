/*
 * level.js – ASCII-Level-Format, Parser und Validierung.
 *
 * Ein Level besteht aus Abschnitten (sections). Jeder Abschnitt ist ein Array
 * von Zeilen (oben → unten). Die LETZTE Zeile ist die Bodenzeile:
 *   '=' Boden   '_' Grube
 * Alle Zeilen darüber sind Luftzeilen (höchstens 13), unten bündig über dem Boden:
 *   ' ' / '.' leer        '#' Block (fest, seitlich = Crash)
 *   '^' Stachel (Deadline) 'v' hängender Stachel
 *   'o' ECTS-Münze        'J' Jump-Pad Boden   'j' Jump-Pad Decke
 *   'O' Sprung-Orb (in der Luft drücken)
 *   'G' Portal Praxisphase (Schwerkraft kopfüber)   'T' Portal Theoriephase (normal)
 *   'S' Portal Klausurenphase (schnell)             'N' Portal normales Tempo
 * Am Ende jedes Abschnitts setzt der Parser automatisch einen Checkpoint,
 * der die Side Quest des Abschnitts startet.
 *
 * Bausteine lassen sich mit SS.Level.join(...) horizontal zusammensetzen.
 */
(function () {
  'use strict';
  const SS = (globalThis.SS = globalThis.SS || {});
  const C = SS.CONFIG;

  const GROUND_ROW = C.GROUND_Y / C.TILE; // 13
  const MAX_AIR_ROWS = GROUND_ROW;        // 13 Zeilen bis zum oberen Bildrand
  const RUNWAY = 8;                       // freie Spalten am Abschnittsanfang
  const END_PADDING = 24;                 // Deko-Spalten nach dem letzten Checkpoint

  const AIR_CHARS = ' .#^vojJOGTSN';
  const GROUND_CHARS = '=_';
  const PORTALS = { G: 'praxis', T: 'theorie', S: 'fast', N: 'normal' };

  /** Zeilen auf gleiche Breite bringen (Luft mit ' ', Boden mit '='). */
  function normalizeChunk(rows) {
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('Leerer Level-Baustein');
    const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
    const out = rows.map((r, i) => {
      const fill = i === rows.length - 1 ? '=' : ' ';
      return r + fill.repeat(width - r.length);
    });
    return { rows: out, width, height: out.length };
  }

  /** Bausteine horizontal verketten (unten bündig). */
  function join(...chunks) {
    const parts = chunks.map(normalizeChunk);
    const height = parts.reduce((h, p) => Math.max(h, p.height), 0);
    const result = [];
    for (let i = 0; i < height; i++) {
      let line = '';
      for (const p of parts) {
        const offset = height - p.height; // fehlende Zeilen oben auffüllen
        line += i < offset ? ' '.repeat(p.width) : p.rows[i - offset];
      }
      result.push(line);
    }
    return result;
  }

  /** n freie Spalten mit Boden. */
  function gap(n) {
    return ['='.repeat(Math.max(1, n | 0))];
  }

  /** n Spalten Grube (kein Boden). */
  function pit(n) {
    return ['_'.repeat(Math.max(1, n | 0))];
  }

  function repeat(chunk, times) {
    const list = [];
    for (let i = 0; i < times; i++) list.push(chunk);
    return join(...list);
  }

  /**
   * Prüft eine Level-Definition. Gibt {errors, warnings} zurück (Strings).
   */
  function validate(def) {
    const errors = [];
    const warnings = [];
    if (!def || !Array.isArray(def.sections) || def.sections.length === 0) {
      errors.push('Level braucht mindestens einen Abschnitt (sections).');
      return { errors, warnings };
    }
    def.sections.forEach((sec, i) => {
      const name = `Abschnitt ${i} (${sec && sec.id})`;
      if (!sec.id) errors.push(`${name}: id fehlt`);
      if (!sec.title) errors.push(`${name}: title fehlt`);
      if (!C.THEMES[sec.theme]) errors.push(`${name}: unbekanntes theme "${sec.theme}"`);
      if (!sec.sideQuest) errors.push(`${name}: sideQuest fehlt`);
      if (sec.speed && !C.SPEED[sec.speed]) errors.push(`${name}: unbekanntes speed "${sec.speed}"`);
      if (!Array.isArray(sec.rows) || sec.rows.length < 1) {
        errors.push(`${name}: rows fehlt`);
        return;
      }
      const lengths = new Set(sec.rows.map((r) => r.length));
      if (lengths.size > 1) warnings.push(`${name}: Zeilen unterschiedlich lang (${[...lengths].join(', ')}), wird aufgefüllt`);
      const { rows, width, height } = normalizeChunk(sec.rows);
      if (height - 1 > MAX_AIR_ROWS) errors.push(`${name}: ${height - 1} Luftzeilen, erlaubt sind ${MAX_AIR_ROWS}`);
      rows.forEach((row, r) => {
        const allowed = r === height - 1 ? GROUND_CHARS : AIR_CHARS;
        for (let x = 0; x < row.length; x++) {
          if (!allowed.includes(row[x])) errors.push(`${name}: unbekanntes Zeichen "${row[x]}" in Zeile ${r}, Spalte ${x}`);
        }
      });
      // Anlaufstrecke: Respawn-Punkt muss sicher sein
      const ground = rows[height - 1];
      for (let x = 0; x < Math.min(RUNWAY, width); x++) {
        if (ground[x] !== '=') errors.push(`${name}: Grube in der Anlaufstrecke (Spalte ${x})`);
        for (let r = 0; r < height - 1; r++) {
          if (rows[r][x] !== ' ' && rows[r][x] !== '.') {
            errors.push(`${name}: Objekt "${rows[r][x]}" in der Anlaufstrecke (Spalte ${x}); die ersten ${RUNWAY} Spalten müssen frei sein`);
            break;
          }
        }
      }
      // Schwerkraft muss vor dem Checkpoint wieder normal sein
      let flipped = false;
      for (let x = 0; x < width; x++) {
        for (let r = 0; r < height - 1; r++) {
          if (rows[r][x] === 'G') flipped = true;
          if (rows[r][x] === 'T') flipped = false;
        }
      }
      if (flipped) warnings.push(`${name}: endet in der Praxisphase (G ohne nachfolgendes T)`);
      if (width < 40) warnings.push(`${name}: sehr kurz (${width} Spalten)`);
    });
    return { errors, warnings };
  }

  /**
   * Baut aus der Level-Definition die Spielwelt für Physik und Rendering.
   */
  function parse(def) {
    const T = C.TILE;
    const ROWS = C.ROWS;
    const P = C.PLAYER_SIZE;
    const parts = def.sections.map((sec) => normalizeChunk(sec.rows));
    const levelCols = parts.reduce((sum, p) => sum + p.width, 0);
    const cols = levelCols + END_PADDING;

    const grid = new Uint8Array(cols * ROWS);
    for (let c = 0; c < cols; c++) {
      for (let r = GROUND_ROW; r < ROWS; r++) grid[c * ROWS + r] = 1;
    }

    const buckets = Array.from({ length: cols }, () => []);
    const blocks = [];
    const objects = [];
    const triggers = [];
    const sections = [];
    let nextId = 0;

    function addObject(o) {
      o.id = nextId++;
      objects.push(o);
      buckets[o.col].push(o);
    }

    let offset = 0;
    def.sections.forEach((sec, i) => {
      const { rows, width, height } = parts[i];
      const airRows = height - 1;
      const ground = rows[height - 1];
      for (let x = 0; x < width; x++) {
        if (ground[x] === '_') {
          for (let r = GROUND_ROW; r < ROWS; r++) grid[(offset + x) * ROWS + r] = 0;
        }
      }
      for (let k = 0; k < airRows; k++) {
        const r = GROUND_ROW - airRows + k;
        const line = rows[k];
        for (let x = 0; x < width; x++) {
          const ch = line[x];
          const col = offset + x;
          const px = col * T;
          const py = r * T;
          switch (ch) {
            case '#':
              grid[col * ROWS + r] = 1;
              blocks.push({ col, row: r, x: px, y: py, sectionIndex: i });
              break;
            case '^':
              addObject({ type: 'spike', dir: 1, col, row: r, x: px, y: py, hx: px + 14, hy: py + 16, hw: 12, hh: 24, sectionIndex: i });
              break;
            case 'v':
              addObject({ type: 'spike', dir: -1, col, row: r, x: px, y: py, hx: px + 14, hy: py, hw: 12, hh: 24, sectionIndex: i });
              break;
            case 'o':
              addObject({ type: 'coin', col, row: r, x: px, y: py, hx: px + 6, hy: py + 6, hw: 28, hh: 28, sectionIndex: i });
              break;
            case 'J':
              addObject({ type: 'pad', dir: 1, col, row: r, x: px, y: py, hx: px + 4, hy: py + T - 10, hw: T - 8, hh: 10, sectionIndex: i });
              break;
            case 'j':
              addObject({ type: 'pad', dir: -1, col, row: r, x: px, y: py, hx: px + 4, hy: py, hw: T - 8, hh: 10, sectionIndex: i });
              break;
            case 'O':
              addObject({ type: 'orb', col, row: r, x: px, y: py, hx: px, hy: py, hw: T, hh: T, sectionIndex: i });
              break;
            case 'G':
            case 'T':
            case 'S':
            case 'N':
              triggers.push({ type: 'portal', kind: PORTALS[ch], col, row: r, x: px + T / 2, y: py, id: nextId++, sectionIndex: i });
              break;
            default:
              break; // leer
          }
        }
      }
      const startX = i === 0 ? 2 * T : offset * T + T;
      sections.push({
        index: i,
        id: sec.id,
        title: sec.title,
        subtitle: sec.subtitle || '',
        theme: sec.theme,
        sideQuest: sec.sideQuest,
        speed: sec.speed || 'normal',
        startCol: offset,
        endCol: offset + width,
        startX,
        endX: (offset + width) * T,
        startTriggerIdx: 0 // wird unten nach dem Sortieren gesetzt
      });
      triggers.push({ type: 'checkpoint', sectionIndex: i, sideQuest: sec.sideQuest, col: offset + width - 1, x: (offset + width) * T - T / 2, y: 0, id: nextId++ });
      offset += width;
    });

    triggers.sort((a, b) => a.x - b.x || a.id - b.id);
    for (const s of sections) {
      const idx = triggers.findIndex((t) => t.x > s.startX + P / 2);
      s.startTriggerIdx = idx === -1 ? triggers.length : idx;
    }

    function isSolid(c, r) {
      if (r < 0 || r >= ROWS) return false;
      if (c < 0 || c >= cols) return r >= GROUND_ROW; // außerhalb: Boden läuft weiter
      return grid[c * ROWS + r] === 1;
    }

    function isPit(c) {
      return c >= 0 && c < cols && grid[c * ROWS + GROUND_ROW] === 0;
    }

    return {
      id: def.id || 'level',
      title: def.title || '',
      tile: T,
      cols,
      rows: ROWS,
      groundRow: GROUND_ROW,
      levelWidth: levelCols * T, // Ende des letzten Abschnitts (für Fortschritt in %)
      width: cols * T,
      height: C.HEIGHT,
      grid,
      isSolid,
      isPit,
      buckets,
      blocks,
      objects,
      coins: objects.filter((o) => o.type === 'coin'),
      triggers,
      portals: triggers.filter((t) => t.type === 'portal'),
      checkpoints: triggers.filter((t) => t.type === 'checkpoint'),
      sections
    };
  }

  SS.Level = { parse, validate, join, gap, pit, repeat, normalizeChunk, GROUND_ROW, MAX_AIR_ROWS, RUNWAY };
  SS.Levels = SS.Levels || {};
})();

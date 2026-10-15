/*
 * WasserspenderScene.js – Side Quest 2: „Hydration Quest: Der Wasserspender“.
 *
 * Nach der Vorlesungszeit ist die Flasche leer. Der Spender im Flur hat aber
 * seinen eigenen Kopf: Alle 3–6 s wechselt er zufällig den Zustand (STATES),
 * kurz vorher flackert das Display als Vorwarnung.
 *
 *   Ziel      Flasche auf 75–95 % füllen – am liebsten mit Sprudel.
 *   Zapfen    Taste 1/2/3 halten oder Maus auf „Still“/„Medium“/„Sprudel“ halten.
 *   Klopfen   K oder Klick aufs Gehäuse: 50 % repariert, sonst Druckstoß (2 s Cooldown).
 *   Fertig    Füllstand 1 s im Ziel, ohne zu zapfen – oder Button „Fertig“ (F).
 *   Überlauf  Über 100 % = „Nasse Hose!“, die Hälfte ist weg. Beim zweiten Mal verloren.
 *
 * Ergebnis (result.id 'wasserspender'): Ziel + Sprudel/Medium ≥ 50 % → 3 ECTS,
 * Ziel mit überwiegend Still → 2 ECTS, Zeit um oder zweimal übergelaufen → 0 ECTS.
 *
 * Debug-Hook: Bei data.debug (setzt die BootScene für ?scene=WasserspenderScene)
 * würfelt der Spender mit festem Seed → bei jedem Start dieselbe Zustandsfolge.
 * Zusätzlich startet ?wsState=<Schlüssel aus STATES> (z. B. co2leer) in diesem
 * Zustand und schaltet die Zufallswechsel ab.
 */
(function () {
  'use strict';
  const SS = globalThis.SS;
  const C = SS.CONFIG;
  const F = C.FONTS;

  // ── Spielregeln ──────────────────────────────────────────────
  const QUEST_ID = 'wasserspender';
  const QUEST_TITLE = 'Hydration Quest: Der Wasserspender';
  const DURATION_MS = 30000;
  const TARGET_MIN = 75;            // Zielbereich der Flasche in % …
  const TARGET_MAX = 95;            // … (beide Grenzen zählen noch)
  const OVERFLOW_AT = 100;          // darüber läuft die Flasche über
  const MAX_OVERFLOWS = 2;          // beim zweiten Überlaufen ist die Quest verloren
  const SPILL_KEEP = 0.5;           // nach dem Überlaufen bleibt die Hälfte in der Flasche
  const SETTLE_MS = 1000;           // so lange im Ziel bleiben (ohne zu zapfen) = fertig
  const FILL_RATE = 12;             // % pro Sekunde, wenn der Spender BEREIT ist
  const SPARKLING_GOAL = 0.5;       // Anteil Sprudel + Medium für 3 ECTS
  const KNOCK_COOLDOWN_MS = 2000;
  const KNOCK_FIX_CHANCE = 0.5;
  const SURGE_MIN = 8;              // Druckstoß nach misslungenem Klopfen: +8 … 14 % Wasser
  const SURGE_MAX = 14;
  const STATE_MIN_MS = 3000;        // so lange hält ein Spender-Zustand …
  const STATE_MAX_MS = 6000;
  const WARNING_MS = 800;           // … und so lange flackert vorher das Display
  const WATER_SFX_MS = 170;         // Abstand der Plätscher-Sounds
  const DRIP_MS = 320;              // Abstand der Tropfen bei „TRÖPFELT“
  const END_DELAY_MS = 1300;        // Pause zwischen Spielende und Ergebniskarte
  const MAX_FRAME_MS = 250;         // nach einem Ruckler springt der Füllstand höchstens so weit
  const DEBUG_SEED = 'wasserspender';

  const REWARDS = {
    sparkling: { success: true, ects: 3, message: 'Perfekt hydriert. Konzentration +10 %.' },
    still: { success: true, ects: 2, message: 'Stilles Wasser. Ein Kompromiss, wie das ganze Studium.' },
    timeout: {
      success: false, ects: 0, headline: 'ZEIT ABGELAUFEN',
      message: 'Dehydriert. Du schläfst in der Vorlesung ein.'
    },
    overflow: {
      success: false, ects: 0, headline: 'NASSE HOSE!',
      message: 'Zweimal übergelaufen. Die nächste Vorlesung sitzt du lieber in der letzten Reihe ab.'
    }
  };

  // Wassersorten der drei Zapftasten (sparkling = mit Kohlensäure)
  const WATER_TYPES = [
    { key: 'still', label: 'Still', digit: '1', keys: ['ONE', 'NUMPAD_ONE'], color: 0x2563eb, dark: 0x1e3a8a, sparkling: false },
    { key: 'medium', label: 'Medium', digit: '2', keys: ['TWO', 'NUMPAD_TWO'], color: 0x16a34a, dark: 0x14532d, sparkling: true },
    { key: 'sprudel', label: 'Sprudel', digit: '3', keys: ['THREE', 'NUMPAD_THREE'], color: 0xea580c, dark: 0x7c2d12, sparkling: true }
  ];
  const MIX_ORDER = ['sprudel', 'medium', 'still']; // Reihenfolge im Mischbalken (Kohlensäure links)

  // Zustände des Spenders: Display-Text, Durchfluss und Tipp im HUD.
  // flow = Faktor auf FILL_RATE · sparklingFlow ersetzt ihn für Medium/Sprudel ·
  // pulse = stoßweiser Durchfluss · weight = Wahrscheinlichkeit beim Zufallswechsel.
  const STATES = {
    bereit: {
      label: 'BEREIT', sub: 'Wasser marsch!', tone: 'ok', weight: 4, flow: 1,
      tip: 'Läuft! Sprudel bringt die meisten ECTS.'
    },
    troepfelt: {
      label: 'TRÖPFELT …', sub: 'Durchfluss: 12 %', tone: 'warn', weight: 2, flow: 0.12, drip: true,
      tip: 'Nur ein Rinnsal. Abwarten – oder dagegen klopfen.'
    },
    stoerung: {
      label: 'STÖRUNG E-42', sub: 'Ursache: unbekannt', tone: 'error', weight: 2, flow: 0,
      tip: 'Nichts geht. Dagegen klopfen (K)!'
    },
    co2leer: {
      label: 'CO₂ LEER', sub: 'Nur Still verfügbar', tone: 'warn', weight: 2, flow: 1, sparklingFlow: 0,
      tip: 'Kohlensäure alle: Nur Still läuft, der Rest zischt.'
    },
    ausserBetrieb: {
      label: 'AUSSER BETRIEB', sub: 'Hausmeister informiert\n(seit 2019)', tone: 'error', weight: 1, flow: 0,
      durationMs: { min: 1500, max: 2500 }, // selten und kurz
      tip: 'Außer Betrieb. Geht meist schnell vorbei …'
    },
    zuVielDruck: {
      label: 'ZU VIEL DRUCK', sub: 'Achtung, spritzt!', tone: 'error', weight: 2, flow: 1,
      pulse: { periodMs: 450, highMs: 200, high: 4, low: 0.3 },
      tip: 'Stoßweise Vollgas – nur kurz antippen!'
    }
  };
  const STATE_KEYS = Object.keys(STATES);

  // Farben des LCD-Displays je nach Zustand
  const LCD_TONES = {
    ok: { bg: 0x0c2a18, text: '#86efac', led: 0x22c55e },
    warn: { bg: 0x2b220a, text: '#fcd34d', led: 0xfbbf24 },
    error: { bg: 0x2e0c10, text: '#fca5a5', led: 0xef4444 }
  };

  const INTRO = {
    tag: 'SIDE QUEST · NACH DER VORLESUNG',
    title: 'Hydration Quest',
    subtitle: 'Der Wasserspender im Flur hat seinen eigenen Kopf.',
    lines: [
      'Fülle die Flasche auf 75–95 % – am liebsten mit Sprudel.',
      'Zapfen: Taste 1 · 2 · 3 oder Maus auf der Taste halten.',
      'Spinnt der Spender? Dagegen klopfen (K oder Klick).',
      'Über 100 % = nasse Hose. Beim zweiten Mal: durchgefallen.'
    ],
    buttonLabel: 'Durst stillen',
    accent: C.COLORS.cyan
  };

  const CONTROLS_HINT = [
    'Zapfen: 1 · 2 · 3 halten (oder Maus)',
    'Klopfen: K oder Klick aufs Gehäuse',
    'Fertig: F – nur im Zielbereich'
  ].join('\n');

  // ── Layout (Spielkoordinaten 800 × 600) ──────────────────────
  const CX = 250;                                   // Mittelachse des Spenders
  const TANK = { x: 170, y: 50, w: 160, h: 104 };   // Wasserballon oben
  const BODY = { x: 100, y: 148, w: 300, h: 428 };  // Gehäuse
  const LCD = { x: 130, y: 176, w: 240, h: 74 };
  const TAP = { y: 292, w: 76, h: 48, gap: 12 };    // die drei Zapftasten (y = Mitte)
  const NICHE = { x: 160, y: 330, w: 180, h: 170 }; // Zapfnische
  const NOZZLE_Y = 350;                             // Unterkante der Düse
  const TRAY = { x: 146, y: 498, w: 208, h: 14 };   // Tropfschale
  const BOTTLE = { x: 218, y: 362, w: 64, h: 136, neckW: 26, neckH: 14, shoulderH: 22, radius: 10 };
  const FILL_Y0 = 494;                              // Wasserspiegel bei 0 %
  const FILL_Y100 = 382;                            // Wasserspiegel bei 100 %
  const FLOOR_Y = 446;                              // Oberkante des Flurbodens

  const PANEL = { x: 452, y: 56, w: 328, h: 522 };  // HUD rechts
  const HUD_LEFT = PANEL.x + 20;
  const HUD_RIGHT = PANEL.x + PANEL.w - 20;
  const HUD_WIDTH = HUD_RIGHT - HUD_LEFT;
  const FILL_BAR = { x: HUD_LEFT, y: 104, w: HUD_WIDTH, h: 30 };
  const MIX_BAR = { x: HUD_LEFT, y: 188, w: HUD_WIDTH, h: 18 };
  const KNOCK_BAR = { x: HUD_LEFT, y: 322, w: HUD_WIDTH, h: 8 };
  const SETTLE_BAR = { x: HUD_LEFT, y: 406, w: HUD_WIDTH, h: 6 };

  const DEPTH = {
    background: 0, puddle: 2, tank: 10, body: 20, knockZone: 21, lcd: 22, taps: 24,
    stream: 25, water: 26, bottle: 27, particles: 30, pop: 60, hud: 100
  };

  // ── Texturen (Canvas-2D; die BootScene erzeugt sie vor dem Szenenstart) ──
  SS.Textures.register('ws_flur', C.WIDTH, C.HEIGHT, drawCorridor);
  SS.Textures.register('ws_tank', TANK.w, TANK.h, drawTank);
  SS.Textures.register('ws_body', BODY.w, BODY.h, drawBody);
  SS.Textures.register('ws_bottle', BOTTLE.w + 4, BOTTLE.h + 4, drawBottle);
  SS.Textures.register('ws_lcd_scan', LCD.w, LCD.h, drawScanlines);
  SS.Textures.register('ws_drop', 10, 14, drawDrop);
  SS.Textures.register('ws_hose', 28, 32, (ctx, w, h) => drawTrousers(ctx, w, h, false));
  SS.Textures.register('ws_hose_nass', 28, 32, (ctx, w, h) => drawTrousers(ctx, w, h, true));

  /** Flur-Kulisse: Wand, Decke mit Leuchtstoffröhren, Hörsaaltür, Boden. */
  function drawCorridor(ctx, w, h) {
    const wall = ctx.createLinearGradient(0, 0, 0, FLOOR_Y);
    wall.addColorStop(0, '#3b4759');
    wall.addColorStop(1, '#2a3443');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, w, FLOOR_Y);
    // Rammschutz-Leiste im unteren Wandbereich
    ctx.fillStyle = '#222b38';
    ctx.fillRect(0, 372, w, FLOOR_Y - 372);
    ctx.fillStyle = '#56657a';
    ctx.fillRect(0, 366, w, 6);
    // Decke mit Leuchtstoffröhren
    ctx.fillStyle = '#181b22';
    ctx.fillRect(0, 0, w, 14);
    [60, 330, 600].forEach((x) => {
      const glow = ctx.createRadialGradient(x + 60, 14, 4, x + 60, 14, 170);
      glow.addColorStop(0, 'rgba(255, 252, 230, 0.30)');
      glow.addColorStop(1, 'rgba(255, 252, 230, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(x - 120, 0, 360, 200);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(x, 9, 120, 5);
    });
    drawDoor(ctx);
    drawFloor(ctx, w, h);
    drawDryPlant(ctx);
    // Schatten unter dem Spender
    ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
    ctx.beginPath();
    ctx.ellipse(CX, BODY.y + BODY.h + 2, 170, 12, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawDoor(ctx) {
    ctx.fillStyle = '#1a2029';
    ctx.fillRect(8, 150, 92, FLOOR_Y - 150);
    const leaf = ctx.createLinearGradient(14, 0, 94, 0);
    leaf.addColorStop(0, '#8b6744');
    leaf.addColorStop(1, '#6b4c30');
    ctx.fillStyle = leaf;
    ctx.fillRect(14, 156, 80, FLOOR_Y - 156);
    ctx.fillStyle = 'rgba(186, 230, 253, 0.28)';
    ctx.fillRect(30, 176, 48, 84);
    ctx.fillStyle = '#d1d5db';
    ctx.fillRect(76, 306, 12, 4);
    // Türschild und Notausgang-Schild
    ctx.fillStyle = '#e5e7eb';
    ctx.fillRect(20, 118, 68, 22);
    ctx.fillStyle = '#1f2937';
    ctx.font = 'bold 11px ' + F.body;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Hörsaal 3', 54, 129);
    ctx.fillStyle = '#16a34a';
    ctx.fillRect(24, 64, 60, 26);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(30, 69, 11, 16);
    ctx.fillRect(48, 75, 16, 4);
    ctx.beginPath();
    ctx.moveTo(63, 70);
    ctx.lineTo(76, 77);
    ctx.lineTo(63, 84);
    ctx.closePath();
    ctx.fill();
  }

  function drawFloor(ctx, w, h) {
    const floor = ctx.createLinearGradient(0, FLOOR_Y, 0, h);
    floor.addColorStop(0, '#4b5058');
    floor.addColorStop(1, '#2a2d33');
    ctx.fillStyle = floor;
    ctx.fillRect(0, FLOOR_Y, w, h - FLOOR_Y);
    ctx.fillStyle = '#161a21';
    ctx.fillRect(0, FLOOR_Y - 4, w, 6);
    // Fugen in Fluchtpunkt-Perspektive
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.lineWidth = 1;
    const vanishX = 400;
    const vanishY = 260;
    const t = (FLOOR_Y - vanishY) / (h - vanishY);
    for (let x = -480; x <= w + 480; x += 96) {
      ctx.beginPath();
      ctx.moveTo(vanishX + (x - vanishX) * t, FLOOR_Y);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    [10, 26, 48, 80, 124].forEach((d) => {
      ctx.beginPath();
      ctx.moveTo(0, FLOOR_Y + d);
      ctx.lineTo(w, FLOOR_Y + d);
      ctx.stroke();
    });
  }

  /** Vertrocknete Zimmerpflanze – sie hat den Spender wohl auch nie zum Laufen gebracht. */
  function drawDryPlant(ctx) {
    ctx.strokeStyle = '#8b6b3d';
    ctx.lineWidth = 2;
    [[-14, -44, -22, -16], [0, -58, 8, -30], [12, -40, 21, -14], [-6, -32, -17, -6]].forEach(([cx, cy, ex, ey]) => {
      ctx.beginPath();
      ctx.moveTo(426, 548);
      ctx.quadraticCurveTo(426 + cx, 548 + cy, 426 + ex, 548 + ey);
      ctx.stroke();
      ctx.fillStyle = '#a16207';
      ctx.beginPath();
      ctx.ellipse(426 + ex, 548 + ey, 4, 2, 0.8, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = '#9a4a2b';
    ctx.beginPath();
    ctx.moveTo(410, 546);
    ctx.lineTo(442, 546);
    ctx.lineTo(438, 578);
    ctx.lineTo(414, 578);
    ctx.closePath();
    ctx.fill();
  }

  /** Umgedrehter Wasserballon mit Rillen, Luftpolster und Glanzlicht. */
  function drawTank(ctx, w, h) {
    const T = SS.Textures;
    ctx.fillStyle = 'rgba(147, 197, 253, 0.75)';
    ctx.fillRect(w / 2 - 18, h - 30, 36, 30);
    T.roundRect(ctx, 6, 2, w - 12, h - 28, 28);
    const shell = ctx.createLinearGradient(0, 0, w, 0);
    shell.addColorStop(0, 'rgba(59, 130, 246, 0.8)');
    shell.addColorStop(0.3, 'rgba(191, 219, 254, 0.9)');
    shell.addColorStop(1, 'rgba(37, 99, 235, 0.85)');
    ctx.fillStyle = shell;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(30, 64, 175, 0.9)';
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
    T.roundRect(ctx, 14, 6, w - 28, 12, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    [30, 50, 66].forEach((y) => {
      ctx.beginPath();
      ctx.moveTo(12, y);
      ctx.lineTo(w - 12, y);
      ctx.stroke();
    });
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    T.roundRect(ctx, 22, 14, 9, h - 50, 4);
    ctx.fill();
  }

  /** Gehäuse des Spenders. Gezeichnet wird in Spielkoordinaten (siehe translate). */
  function drawBody(ctx) {
    ctx.translate(-BODY.x, -BODY.y);
    drawHousing(ctx);
    drawControlPanel(ctx);
    drawNiche(ctx);
    drawVentsAndStickers(ctx);
  }

  function drawHousing(ctx) {
    const T = SS.Textures;
    const { x, y, w, h } = BODY;
    ctx.fillStyle = '#374151';
    ctx.fillRect(x + 24, y + h - 10, 40, 10);
    ctx.fillRect(x + w - 64, y + h - 10, 40, 10);
    const shell = ctx.createLinearGradient(x, 0, x + w, 0);
    shell.addColorStop(0, '#b4bec8');
    shell.addColorStop(0.15, '#e6ebf0');
    shell.addColorStop(0.5, '#f5f7fa');
    shell.addColorStop(0.85, '#dfe5ea');
    shell.addColorStop(1, '#a9b4bf');
    T.roundRect(ctx, x, y + 10, w, h - 18, 20);
    ctx.fillStyle = shell;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#7b8794';
    ctx.stroke();
    // Deckel mit Tankaufnahme
    T.roundRect(ctx, x + 6, y, w - 12, 26, 12);
    ctx.fillStyle = '#9ca8b4';
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#5b6672';
    ctx.beginPath();
    ctx.ellipse(CX, y + 7, 30, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4b5563';
    ctx.font = 'bold 11px ' + F.body;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('TRINKWASSER', x + 20, y + 15);
  }

  function drawControlPanel(ctx) {
    const T = SS.Textures;
    T.roundRect(ctx, LCD.x - 8, LCD.y - 8, LCD.w + 16, LCD.h + 16, 10);
    ctx.fillStyle = '#374151';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#1f2937';
    ctx.stroke();
    T.roundRect(ctx, LCD.x - 8, TAP.y - TAP.h / 2 - 8, LCD.w + 16, TAP.h + 18, 10);
    ctx.fillStyle = '#cfd6dd';
    ctx.fill();
    ctx.strokeStyle = '#9aa5b1';
    ctx.stroke();
  }

  function drawNiche(ctx) {
    const T = SS.Textures;
    const n = NICHE;
    T.roundRect(ctx, n.x, n.y, n.w, n.h, 16);
    const inner = ctx.createLinearGradient(0, n.y, 0, n.y + n.h);
    inner.addColorStop(0, '#0f141c');
    inner.addColorStop(1, '#384350');
    ctx.fillStyle = inner;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#9aa5b1';
    ctx.stroke();
    // Düse (Chrom)
    const chrome = ctx.createLinearGradient(CX - 14, 0, CX + 14, 0);
    chrome.addColorStop(0, '#8b929c');
    chrome.addColorStop(0.5, '#f3f4f6');
    chrome.addColorStop(1, '#6b7280');
    ctx.fillStyle = chrome;
    ctx.fillRect(CX - 14, n.y, 28, 10);
    ctx.fillRect(CX - 6, n.y + 10, 12, NOZZLE_Y - n.y - 10);
    // Tropfschale mit Gitter
    T.roundRect(ctx, TRAY.x, TRAY.y, TRAY.w, TRAY.h, 4);
    ctx.fillStyle = '#4b5563';
    ctx.fill();
    ctx.fillStyle = '#1f2937';
    for (let gx = TRAY.x + 10; gx < TRAY.x + TRAY.w - 10; gx += 10) {
      ctx.fillRect(gx, TRAY.y + 4, 5, TRAY.h - 8);
    }
    // Wartungsplakette neben der Nische
    ctx.fillStyle = '#f9fafb';
    ctx.fillRect(BODY.x + 12, n.y + 16, 42, 28);
    ctx.fillStyle = '#6b7280';
    ctx.font = 'bold 9px ' + F.body;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Wartung', BODY.x + 33, n.y + 24);
    ctx.fillText('03/2019', BODY.x + 33, n.y + 36);
  }

  function drawVentsAndStickers(ctx) {
    const T = SS.Textures;
    for (let i = 0; i < 5; i++) {
      T.roundRect(ctx, BODY.x + 26, 524 + i * 9, 140, 4, 2);
      ctx.fillStyle = '#4b5563';
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.fillRect(BODY.x + 28, 529 + i * 9, 136, 1);
    }
    // Warnaufkleber – passt perfekt zur Spielmechanik
    ctx.save();
    ctx.translate(330, 544);
    ctx.rotate(-0.07);
    ctx.fillStyle = '#facc15';
    ctx.fillRect(-50, -21, 100, 42);
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2;
    ctx.strokeRect(-46, -17, 92, 34);
    ctx.fillStyle = '#111827';
    ctx.font = 'bold 11px ' + F.body;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Bitte NICHT', 0, -6);
    ctx.fillText('dagegen klopfen!', 0, 8);
    ctx.restore();
  }

  /** Umriss der Flasche als Punktliste in Spielkoordinaten; inset > 0 = Innenraum. */
  function bottleOutline(inset) {
    const i = inset || 0;
    const left = BOTTLE.x + i;
    const right = BOTTLE.x + BOTTLE.w - i;
    const neckLeft = CX - BOTTLE.neckW / 2 + i;
    const neckRight = CX + BOTTLE.neckW / 2 - i;
    const neckBottom = BOTTLE.y + BOTTLE.neckH;
    const shoulderBottom = neckBottom + BOTTLE.shoulderH;
    const bottom = BOTTLE.y + BOTTLE.h - i;
    const r = BOTTLE.radius - i;
    const points = [
      { x: neckLeft, y: BOTTLE.y + i }, { x: neckRight, y: BOTTLE.y + i },
      { x: neckRight, y: neckBottom }, { x: right, y: shoulderBottom }
    ];
    // abgerundeter Boden: rechts unten, dann links unten (Viertelkreise)
    for (let deg = 0; deg <= 180; deg += 30) {
      const cx = deg <= 90 ? right - r : left + r;
      const a = Phaser.Math.DegToRad(deg);
      points.push({ x: cx + Math.cos(a) * r, y: bottom - r + Math.sin(a) * r });
      if (deg === 90) points.push({ x: left + r, y: bottom });
    }
    points.push({ x: left, y: shoulderBottom }, { x: neckLeft, y: neckBottom });
    return points;
  }

  function tracePolygon(ctx, points) {
    ctx.beginPath();
    points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
  }

  /** Durchsichtige Flasche mit Glanz, Gewinde und rotem DHBW-Aufkleber. */
  function drawBottle(ctx) {
    ctx.translate(2 - BOTTLE.x, 2 - BOTTLE.y);
    tracePolygon(ctx, bottleOutline(0));
    ctx.fillStyle = 'rgba(219, 234, 254, 0.12)';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(241, 245, 249, 0.9)';
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fillRect(BOTTLE.x + 7, BOTTLE.y + BOTTLE.neckH + BOTTLE.shoulderH + 6, 5, 54);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 1.5;
    [4, 9].forEach((dy) => {
      ctx.beginPath();
      ctx.moveTo(CX - BOTTLE.neckW / 2, BOTTLE.y + dy);
      ctx.lineTo(CX + BOTTLE.neckW / 2, BOTTLE.y + dy);
      ctx.stroke();
    });
    // Schmaler Aufkleber, damit man links und rechts daneben den Wasserstand sieht
    const stickerY = BOTTLE.y + 100;
    SS.Textures.roundRect(ctx, CX - 23, stickerY, 46, 18, 3);
    ctx.fillStyle = '#e2001a';
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px ' + F.display;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('DHBW', CX, stickerY + 10);
  }

  /** Rasterzeilen und Spiegelung über dem LCD. */
  function drawScanlines(ctx, w, h) {
    SS.Textures.roundRect(ctx, 0, 0, w, h, 6);
    ctx.clip();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
    const glare = ctx.createLinearGradient(0, 0, w * 0.6, h);
    glare.addColorStop(0, 'rgba(255, 255, 255, 0.12)');
    glare.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = glare;
    ctx.fillRect(0, 0, w, h);
  }

  function drawDrop(ctx, w, h) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.bezierCurveTo(w, h * 0.55, w, h, w / 2, h);
    ctx.bezierCurveTo(0, h, 0, h * 0.55, w / 2, 0);
    ctx.fill();
  }

  /** Hosen-Symbol fürs HUD; wet = mit nassem Fleck und Tropfen. */
  function drawTrousers(ctx, w, h, wet) {
    ctx.fillStyle = wet ? '#1e3a8a' : '#5b7db8';
    ctx.beginPath();
    ctx.moveTo(4, 4);
    ctx.lineTo(w - 4, 4);
    ctx.lineTo(w - 2, h - 2);
    ctx.lineTo(w / 2 + 3, h - 2);
    ctx.lineTo(w / 2, 13);
    ctx.lineTo(w / 2 - 3, h - 2);
    ctx.lineTo(2, h - 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#2b3f63';
    ctx.fillRect(4, 3, w - 8, 4);
    if (!wet) return;
    ctx.fillStyle = 'rgba(5, 10, 35, 0.65)';
    ctx.beginPath();
    ctx.ellipse(w / 2, 14, 8, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#7dd3fc';
    [[w / 2 - 6, h - 9], [w / 2 + 6, h - 5], [w / 2, h - 13]].forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(x, y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // ── Szene ────────────────────────────────────────────────────
  class WasserspenderScene extends Phaser.Scene {
    constructor() {
      super('WasserspenderScene');
    }

    init(data) {
      const opts = data || {};
      this.__sideQuestFinished = false; // Flag aus SS.SideQuest.finish – bei erneutem Start zurücksetzen
      this.running = false;             // true zwischen Intro und Spielende
      this.finished = false;
      this.volumes = { still: 0, medium: 0, sprudel: 0 }; // Inhalt der Flasche in % je Sorte
      this.overflows = 0;
      this.settleMs = 0;                // so lange ist der Füllstand schon ruhig im Ziel
      this.stateKey = 'bereit';
      this.warningNext = null;          // angekündigter nächster Zustand (Display flackert)
      this.warningBlink = false;
      this.stateTimers = [];
      this.pointerTap = null;           // per Maus gehaltene Sorte
      this.activeTap = null;            // gerade gezapfte Sorte (Maus oder Taste)
      this.flowRate = 0;                // aktueller Durchfluss in % pro Sekunde
      this.knockReadyAt = 0;
      this.knockDeniedUntil = 0;
      this.surgeUntil = 0;
      this.nextWaterSfxAt = 0;
      this.nextBlockedAt = 0;
      this.nextPuffAt = 0;
      this.nextSplashAt = 0;
      this.nextDripAt = 0;
      this.nextTankBubbleAt = 0;
      this.tankBubbles = [];
      this.bottleBubbles = [];
      // Zufall: im Debug-Modus mit festem Seed → reproduzierbare Zustandsfolge
      const seed = opts.debug ? DEBUG_SEED : String(Math.random());
      this.stateRandom = new Phaser.Math.RandomDataGenerator([seed + '-zustand']);
      this.knockRandom = new Phaser.Math.RandomDataGenerator([seed + '-klopfen']);
      const forced = opts.debug ? SS.getUrlParams().wsState : null;
      this.forcedState = STATE_KEYS.includes(forced) ? forced : null;
    }

    create() {
      SS.Audio.music.play('sidequest');
      this.add.image(0, 0, 'ws_flur').setOrigin(0).setDepth(DEPTH.background);
      this.createDispenser();
      this.createBottle();
      this.createEffects();
      this.createHud();
      this.createInput();
      this.stateKey = this.forcedState || 'bereit';
      this.renderDisplay(STATES[this.stateKey]);
      this.time.addEvent({ delay: 80, loop: true, callback: this.flickerDisplay, callbackScope: this });
      this.events.once('shutdown', this.cleanup, this);
      SS.SideQuest.intro(this, INTRO, () => this.startGameplay());
    }

    // ── Aufbau ───────────────────────────────────────────────

    createDispenser() {
      this.tank = this.add.image(CX, TANK.y + TANK.h, 'ws_tank').setOrigin(0.5, 1).setDepth(DEPTH.tank);
      this.tankGfx = this.add.graphics().setDepth(DEPTH.tank + 1);
      this.add.image(BODY.x, BODY.y, 'ws_body').setOrigin(0).setDepth(DEPTH.body);

      this.lcdGfx = this.add.graphics().setDepth(DEPTH.lcd);
      this.lcdMain = SS.UI.text(this, LCD.x + 12, LCD.y + 9, '', 'mono', { fontSize: '22px', fontStyle: 'bold' })
        .setDepth(DEPTH.lcd + 1);
      this.lcdSub = SS.UI.text(this, LCD.x + 12, LCD.y + 40, '', 'mono', { fontSize: '13px' }).setDepth(DEPTH.lcd + 1);
      this.lcdLed = this.add.circle(LCD.x + LCD.w - 14, LCD.y + 16, 5, C.COLORS.green).setDepth(DEPTH.lcd + 1);
      this.add.image(LCD.x, LCD.y, 'ws_lcd_scan').setOrigin(0).setDepth(DEPTH.lcd + 2);

      // Klick aufs Gehäuse = dagegen klopfen. Die Zapftasten liegen darüber
      // und fangen ihre Klicks selbst ab (Phaser meldet nur das oberste Objekt).
      const knockZone = this.add.zone(BODY.x, TANK.y, BODY.w, BODY.y + BODY.h - TANK.y)
        .setOrigin(0).setDepth(DEPTH.knockZone).setInteractive({ useHandCursor: true });
      knockZone.on('pointerdown', (pointer) => this.knock(pointer.x, pointer.y));

      const step = TAP.w + TAP.gap;
      this.tapButtons = WATER_TYPES.map((type, i) => this.createTapButton(type, CX + (i - 1) * step));
    }

    /** Zapftaste: gedrückt halten = Wasser läuft (Loslassen irgendwo beendet es). */
    createTapButton(type, x) {
      const g = this.add.graphics().setDepth(DEPTH.taps);
      const label = SS.UI.text(this, x, TAP.y - 7, type.label, 'body', {
        fontSize: '16px', fontStyle: 'bold', stroke: '#000000', strokeThickness: 3
      }).setOrigin(0.5).setDepth(DEPTH.taps + 1);
      const hint = SS.UI.text(this, x, TAP.y + 12, 'Taste ' + type.digit, 'small', {
        fontSize: '11px', color: '#f1f5f9'
      }).setOrigin(0.5).setDepth(DEPTH.taps + 1);
      const zone = this.add.zone(x, TAP.y, TAP.w, TAP.h).setDepth(DEPTH.taps + 2)
        .setInteractive({ useHandCursor: true });
      zone.on('pointerdown', () => { this.pointerTap = type; });
      zone.on('pointerout', () => this.releasePointerTap());
      return { type, x, g, label, hint };
    }

    createBottle() {
      this.streamGfx = this.add.graphics().setDepth(DEPTH.stream);
      this.waterGfx = this.add.graphics().setDepth(DEPTH.water);
      // Maske: Wasser und Bläschen nur innerhalb der Flasche zeichnen
      this.bottleMaskShape = this.make.graphics({}, false);
      this.bottleMaskShape.fillStyle(0xffffff, 1);
      this.bottleMaskShape.fillPoints(bottleOutline(3), true);
      this.bottleMask = this.bottleMaskShape.createGeometryMask();
      this.waterGfx.setMask(this.bottleMask);
      this.add.image(BOTTLE.x - 2, BOTTLE.y - 2, 'ws_bottle').setOrigin(0).setDepth(DEPTH.bottle);
      this.drawTargetMarks();
      // Deckel liegt auf der Tropfschale
      const cap = this.add.graphics().setDepth(DEPTH.bottle);
      cap.fillStyle(C.COLORS.dhbwRed, 1).fillRoundedRect(BOTTLE.x + BOTTLE.w + 18, TRAY.y - 9, 22, 9, 2);
      cap.fillStyle(0xffffff, 0.35).fillRect(BOTTLE.x + BOTTLE.w + 20, TRAY.y - 7, 18, 2);
    }

    /** Grüne Klammer neben der Flasche markiert den Zielbereich. */
    drawTargetMarks() {
      const g = this.add.graphics().setDepth(DEPTH.bottle + 1);
      const x = BOTTLE.x + BOTTLE.w + 8;
      const top = this.fillToY(TARGET_MAX);
      const bottom = this.fillToY(TARGET_MIN);
      g.lineStyle(3, C.COLORS.green, 1);
      g.beginPath();
      g.moveTo(x - 6, top);
      g.lineTo(x, top);
      g.lineTo(x, bottom);
      g.lineTo(x - 6, bottom);
      g.strokePath();
      SS.UI.text(this, x + 5, (top + bottom) / 2, 'Ziel', 'small', {
        fontSize: '12px', fontStyle: 'bold', color: C.CSS.green
      }).setOrigin(0, 0.5).setDepth(DEPTH.bottle + 1);
    }

    createEffects() {
      this.splashEmitter = this.add.particles(0, 0, 'dot', {
        speed: { min: 50, max: 160 }, angle: { min: 205, max: 335 }, gravityY: 650,
        lifespan: { min: 250, max: 450 }, scale: { start: 0.45, end: 0.1 }, alpha: { start: 0.9, end: 0 },
        tint: [0xe0f2fe, 0x7dd3fc, 0x38bdf8], emitting: false
      }).setDepth(DEPTH.particles);
      // Zischen bei leerer CO₂-Flasche: kleine Dampfwölkchen an der Düse
      this.puffEmitter = this.add.particles(0, 0, 'glow', {
        speed: { min: 15, max: 55 }, angle: { min: 40, max: 140 }, lifespan: 650,
        scale: { start: 0.15, end: 0.7 }, alpha: { start: 0.5, end: 0 }, emitting: false
      }).setDepth(DEPTH.particles);
      // Pfütze vor dem Spender (wächst bei jedem Überlaufen)
      this.puddle = this.add.graphics({ x: CX + 30, y: 589 }).setDepth(DEPTH.puddle).setScale(0);
      this.puddle.fillStyle(0x7dd3fc, 0.5).fillEllipse(0, 0, 180, 16);
      this.puddle.fillStyle(0xffffff, 0.35).fillEllipse(-36, -2, 56, 4);
    }

    createHud() {
      SS.UI.panel(this, PANEL.x, PANEL.y, PANEL.w, PANEL.h, { alpha: 0.94 }).setDepth(DEPTH.hud);
      const frame = this.add.graphics().setDepth(DEPTH.hud);
      frame.lineStyle(1, C.COLORS.panelLine, 1);
      [240, 284, 338].forEach((y) => frame.lineBetween(HUD_LEFT, y, HUD_RIGHT, y));
      frame.fillStyle(0x000000, 0.25).fillRoundedRect(HUD_LEFT - 8, 346, HUD_WIDTH + 16, 72, 10);
      this.hudGfx = this.add.graphics().setDepth(DEPTH.hud + 1);

      this.addHudLabel(HUD_LEFT, 78, 'FÜLLSTAND');
      this.fillText = this.addHudValue(HUD_RIGHT, 70);
      const zoneCenter = FILL_BAR.x + FILL_BAR.w * (TARGET_MIN + TARGET_MAX) / 200;
      this.addHudLabel(zoneCenter, FILL_BAR.y + FILL_BAR.h / 2, 'ZIEL', { color: '#ffffff', fontSize: '11px' })
        .setOrigin(0.5).setDepth(DEPTH.hud + 2);

      this.addHudLabel(HUD_LEFT, 162, 'SPRUDEL-ANTEIL');
      this.shareText = this.addHudValue(HUD_RIGHT, 154);
      this.addMixLegend(214);

      this.addHudLabel(HUD_LEFT, 254, 'NASSE HOSEN');
      this.hoseIcons = [0, 1].map((i) => this.add.image(HUD_RIGHT - 48 + i * 34, 262, 'ws_hose')
        .setDepth(DEPTH.hud + 2));

      this.addHudLabel(HUD_LEFT, 298, 'KLOPFEN');
      this.knockText = SS.UI.text(this, HUD_RIGHT, 296, '', 'small', { fontSize: '14px' })
        .setOrigin(1, 0).setDepth(DEPTH.hud + 2);

      this.tipText = SS.UI.text(this, HUD_LEFT, 356, '', 'body', {
        fontSize: '16px', wordWrap: { width: HUD_WIDTH }, lineSpacing: 2
      }).setDepth(DEPTH.hud + 2);

      SS.UI.text(this, HUD_LEFT, 430, CONTROLS_HINT, 'small', { fontSize: '14px', lineSpacing: 5 })
        .setDepth(DEPTH.hud + 2);

      this.finishButton = SS.UI.button(this, HUD_LEFT + HUD_WIDTH / 2, PANEL.y + PANEL.h - 44, 'Fertig (F)',
        () => this.onFinishPressed(), { width: HUD_WIDTH, height: 50, color: C.COLORS.green, key: 'F', disabled: true });
      this.finishButton.setDepth(DEPTH.hud + 3);
    }

    addHudLabel(x, y, label, overrides) {
      return SS.UI.text(this, x, y, label, 'small', Object.assign({
        fontFamily: F.display, fontSize: '13px', color: C.CSS.inkSoft
      }, overrides || {})).setDepth(DEPTH.hud + 2);
    }

    addHudValue(x, y) {
      return SS.UI.text(this, x, y, '0 %', 'h2', { fontSize: '24px' }).setOrigin(1, 0).setDepth(DEPTH.hud + 2);
    }

    /** Legende unter dem Mischbalken: Farbe je Sorte + Ziel-Hinweis. */
    addMixLegend(y) {
      const g = this.add.graphics().setDepth(DEPTH.hud + 2);
      let x = HUD_LEFT;
      MIX_ORDER.forEach((key) => {
        const type = WATER_TYPES.find((t) => t.key === key);
        g.fillStyle(type.color, 1).fillRect(x, y + 3, 10, 10);
        const label = SS.UI.text(this, x + 14, y, type.label, 'small', { fontSize: '12px' }).setDepth(DEPTH.hud + 2);
        x += 14 + label.width + 12;
      });
      SS.UI.text(this, HUD_RIGHT, y, 'Ziel: ≥ 50 %', 'small', { fontSize: '12px', color: C.CSS.yellow })
        .setOrigin(1, 0).setDepth(DEPTH.hud + 2);
    }

    createInput() {
      // Tasten 1/2/3 werden in update() abgefragt: gehalten = Wasser läuft
      this.tapKeys = {};
      WATER_TYPES.forEach((type) => {
        this.tapKeys[type.key] = type.keys.map((name) => this.input.keyboard.addKey(name, false));
      });
      SS.UI.onKey(this, 'K', () => this.knock());
      // Maustaste irgendwo losgelassen → Zapfen beenden
      this.input.on('pointerup', this.releasePointerTap, this);
    }

    startGameplay() {
      this.running = true;
      this.timer = SS.UI.timerBar(this, 20, 20, C.WIDTH - 40, 20, DURATION_MS, {
        color: C.COLORS.cyan, onDone: () => this.onTimeUp()
      });
      this.setDispenserState(this.stateKey);
    }

    update(time, delta) {
      const dt = Math.min(delta, MAX_FRAME_MS);
      if (this.running) {
        this.updatePouring(dt);
        this.updateSettle(dt);
      }
      this.updateTankBubbles(dt);
      this.drawStream();
      this.drawBottleWater(dt);
      this.tapButtons.forEach((button) => this.drawTapButton(button));
      this.refreshHud();
    }

    // ── Zapfen ───────────────────────────────────────────────

    /** Gehaltene Sorte: Maus hat Vorrang, sonst die erste gedrückte Taste. */
    getHeldType() {
      if (this.pointerTap) return this.pointerTap;
      return WATER_TYPES.find((type) => this.tapKeys[type.key].some((key) => key.isDown)) || null;
    }

    /** Durchfluss in % pro Sekunde für eine Sorte im aktuellen Spender-Zustand. */
    flowRateFor(type, now) {
      const state = STATES[this.stateKey];
      if (type.sparkling && state.sparklingFlow !== undefined) return FILL_RATE * state.sparklingFlow;
      if (state.pulse) {
        const burst = now % state.pulse.periodMs < state.pulse.highMs;
        return FILL_RATE * (burst ? state.pulse.high : state.pulse.low);
      }
      return FILL_RATE * state.flow;
    }

    updatePouring(dt) {
      const now = this.time.now;
      const type = this.getHeldType();
      this.activeTap = type;
      this.flowRate = type ? this.flowRateFor(type, now) : 0;
      if (!type) return;
      if (this.flowRate > 0) {
        this.addWater(type.key, this.flowRate * dt / 1000);
        this.playWaterSound(now);
      } else {
        this.showBlockedTap(type, now);
      }
    }

    addWater(kind, amount) {
      this.volumes[kind] += amount;
      if (this.getFill() > OVERFLOW_AT) this.overflow();
    }

    playWaterSound(now) {
      if (now < this.nextWaterSfxAt || STATES[this.stateKey].drip) return; // Tropfen klingen beim Aufprall
      SS.Audio.sfx('water');
      this.nextWaterSfxAt = now + (this.flowRate > FILL_RATE ? WATER_SFX_MS / 2 : WATER_SFX_MS);
    }

    /** Taste gedrückt, aber kein Wasser: zischen (CO₂ leer) oder nur klicken (Störung). */
    showBlockedTap(type, now) {
      const hissing = type.sparkling && this.stateKey === 'co2leer';
      if (hissing && now >= this.nextPuffAt) {
        this.puffEmitter.emitParticleAt(CX, NOZZLE_Y + 2, 2);
        this.nextPuffAt = now + 45;
      }
      if (now < this.nextBlockedAt) return;
      this.nextBlockedAt = now + 900;
      SS.Audio.sfx(hissing ? 'hiss' : 'error');
      this.popText(CX, NOZZLE_Y + 34, hissing ? 'pfffft …' : '*klick*', '#e5e7eb', 18);
    }

    releasePointerTap() {
      this.pointerTap = null;
    }

    // ── Füllstand und Ziel ───────────────────────────────────

    getFill() {
      return this.volumes.still + this.volumes.medium + this.volumes.sprudel;
    }

    /** Anteil Sprudel + Medium am Flascheninhalt (0–1). */
    sparklingShare() {
      const total = this.getFill();
      return total > 0 ? (this.volumes.medium + this.volumes.sprudel) / total : 0;
    }

    // Gewertet wird, was das HUD anzeigt: ganze Prozent (sonst stünde „75 %“ da und zählte nicht).
    fillPercent() {
      return Math.round(this.getFill());
    }

    sparklingPercent() {
      return Math.round(this.sparklingShare() * 100);
    }

    hasEnoughSparkling() {
      return this.sparklingPercent() >= SPARKLING_GOAL * 100;
    }

    inTargetZone() {
      const fill = this.fillPercent();
      return fill >= TARGET_MIN && fill <= TARGET_MAX;
    }

    fillToY(fill) {
      return FILL_Y0 - (FILL_Y0 - FILL_Y100) * (fill / 100);
    }

    /** Ziel erreicht, wenn der Füllstand 1 s im Zielbereich bleibt und keine Taste gehalten wird. */
    updateSettle(dt) {
      if (this.inTargetZone() && !this.activeTap) this.settleMs += dt;
      else this.settleMs = 0;
      if (this.settleMs >= SETTLE_MS) this.finishQuest('goal');
    }

    /** Über 100 %: „Nasse Hose!“ – die Hälfte geht daneben (Mischung bleibt gleich). */
    overflow() {
      this.overflows += 1;
      Object.keys(this.volumes).forEach((kind) => { this.volumes[kind] *= SPILL_KEEP; });
      const icon = this.hoseIcons[this.overflows - 1];
      if (icon) {
        icon.setTexture('ws_hose_nass');
        this.tweens.add({ targets: icon, scale: { from: 1.8, to: 1 }, duration: 320, ease: 'Back.Out' });
      }
      SS.Audio.sfx('death');
      SS.UI.shake(this, 320, 0.016);
      SS.UI.burst(this, CX, BOTTLE.y + 6, {
        texture: 'dot', count: 36, speedMin: 120, speedMax: 340, gravityY: 900, lifespan: 900, scale: 0.7,
        tint: [0x7dd3fc, 0x38bdf8, 0xffffff], depth: DEPTH.particles
      });
      this.tweens.add({ targets: this.puddle, scale: 0.6 + 0.4 * this.overflows, duration: 500, ease: 'Back.Out' });
      if (this.overflows >= MAX_OVERFLOWS) this.finishQuest('overflow');
      else this.popText(CX, NICHE.y + 44, 'NASSE HOSE!', '#7dd3fc', 34);
    }

    // ── Spender-Zustände ─────────────────────────────────────

    /** Zustand sofort setzen und den nächsten Zufallswechsel planen. */
    setDispenserState(key) {
      this.cancelStateTimers();
      this.stateKey = key;
      this.warningNext = null;
      this.renderDisplay(STATES[key]);
      if (this.running && !this.forcedState) this.scheduleNextState();
    }

    /** Zeitgesteuerter Wechsel – mit Signalton. */
    changeState(key) {
      SS.Audio.sfx(key === 'bereit' ? 'coin' : 'buzz');
      this.setDispenserState(key);
    }

    scheduleNextState() {
      const range = STATES[this.stateKey].durationMs || { min: STATE_MIN_MS, max: STATE_MAX_MS };
      const duration = this.stateRandom.between(range.min, range.max);
      const next = this.pickNextState();
      this.stateTimers = [
        this.time.delayedCall(duration - WARNING_MS, () => this.startWarning(next)),
        this.time.delayedCall(duration, () => this.changeState(next))
      ];
    }

    /** Gewichteter Zufall über alle anderen Zustände. */
    pickNextState() {
      const options = STATE_KEYS.filter((key) => key !== this.stateKey);
      const total = options.reduce((sum, key) => sum + STATES[key].weight, 0);
      let roll = this.stateRandom.frac() * total;
      for (const key of options) {
        roll -= STATES[key].weight;
        if (roll < 0) return key;
      }
      return options[options.length - 1];
    }

    startWarning(next) {
      this.warningNext = next;
      SS.Audio.sfx('tick');
    }

    cancelStateTimers() {
      this.stateTimers.forEach((timer) => timer.remove(false));
      this.stateTimers = [];
    }

    // ── Display ──────────────────────────────────────────────

    renderDisplay(state, alpha) {
      const tone = LCD_TONES[state.tone];
      this.lcdGfx.clear();
      this.lcdGfx.fillStyle(tone.bg, 1);
      this.lcdGfx.fillRoundedRect(LCD.x, LCD.y, LCD.w, LCD.h, 6);
      this.lcdMain.setText(state.label).setColor(tone.text);
      this.lcdSub.setText(state.sub).setColor(tone.text);
      this.lcdLed.setFillStyle(tone.led).setVisible(true);
      this.setDisplayAlpha(alpha === undefined ? 1 : alpha);
    }

    setDisplayAlpha(alpha) {
      this.lcdMain.setAlpha(alpha);
      this.lcdSub.setAlpha(alpha);
    }

    /** Läuft alle 80 ms: Vorwarnung (wechselt zwischen jetzt und gleich) oder Störungs-Flackern. */
    flickerDisplay() {
      if (this.warningNext) {
        this.warningBlink = !this.warningBlink;
        const shown = this.warningBlink ? this.warningNext : this.stateKey;
        this.renderDisplay(STATES[shown], this.warningBlink ? 0.75 : 1);
        return;
      }
      const broken = this.stateKey !== 'bereit';
      const glitch = broken && Math.random() < 0.22;
      this.setDisplayAlpha(glitch ? Phaser.Math.FloatBetween(0.15, 0.6) : 1);
      this.lcdLed.setVisible(!broken || Math.floor(this.time.now / 250) % 2 === 0);
    }

    // ── Dagegen klopfen ──────────────────────────────────────

    knock(x, y) {
      if (!this.running) return;
      const now = this.time.now;
      if (now < this.knockReadyAt) {
        this.knockDeniedUntil = now + 300; // Cooldown-Balken blinkt rot
        return;
      }
      this.knockReadyAt = now + KNOCK_COOLDOWN_MS;
      SS.Audio.sfx('error'); // dumpfes „Klonk“
      SS.UI.shake(this, 110, 0.005);
      this.tweens.add({
        targets: this.tank, angle: { from: -3, to: 3 }, duration: 70, yoyo: true, repeat: 1,
        onComplete: () => this.tank.setAngle(0)
      });
      this.popText(x || BODY.x + BODY.w - 44, y || NICHE.y - 8, 'KLONK!', C.CSS.yellow, 28);
      if (this.knockRandom.frac() < KNOCK_FIX_CHANCE) this.knockHelps();
      else this.pressureSurge();
    }

    knockHelps() {
      if (this.stateKey === 'bereit') {
        this.popText(CX, NOZZLE_Y + 44, 'Läuft doch …', '#e5e7eb', 18);
        return;
      }
      SS.Audio.sfx('checkpoint');
      this.setDispenserState('bereit');
      this.popText(LCD.x + LCD.w / 2, LCD.y + LCD.h / 2, 'Repariert!', C.CSS.green, 28);
    }

    /** Misslungenes Klopfen: Ein Schwall stilles Wasser schießt in die Flasche. */
    pressureSurge() {
      const amount = this.knockRandom.between(SURGE_MIN, SURGE_MAX);
      this.surgeUntil = this.time.now + 280;
      SS.Audio.sfx('pad');
      SS.UI.shake(this, 220, 0.012);
      this.popText(CX, NICHE.y + 30, 'Druckstoß!', '#7dd3fc', 26);
      this.splashEmitter.emitParticleAt(CX, NOZZLE_Y + 6, 24);
      this.addWater('still', amount);
    }

    // ── Wasser zeichnen ──────────────────────────────────────

    drawStream() {
      const g = this.streamGfx;
      g.clear();
      const now = this.time.now;
      const surge = now < this.surgeUntil;
      if (!surge && !(this.running && this.flowRate > 0)) return;
      const surfaceY = this.fillToY(Math.min(this.getFill(), OVERFLOW_AT));
      if (!surge && STATES[this.stateKey].drip) {
        this.dripWater(now, surfaceY);
        return;
      }
      const strength = surge ? 4 : this.flowRate / FILL_RATE; // 0,3 (schwach) … 4 (Druck)
      const halfWidth = Phaser.Math.Clamp(2 + strength * 2.5, 2.5, 10);
      this.drawWavyStream(g, surfaceY, halfWidth, Math.min(3, strength), now);
      if (!surge && this.activeTap && this.activeTap.sparkling) this.drawStreamBubbles(g, surfaceY, now);
      if (now >= this.nextSplashAt) {
        this.splashEmitter.emitParticleAt(CX, surfaceY, Math.ceil(strength * 1.5));
        this.nextSplashAt = now + 55;
      }
    }

    /** Wasserstrahl als Band, das unten stärker schwingt. */
    drawWavyStream(g, bottom, halfWidth, wobble, now) {
      const steps = 8;
      const left = [];
      const right = [];
      const shine = [];
      for (let i = 0; i <= steps; i++) {
        const y = NOZZLE_Y + (bottom - NOZZLE_Y) * (i / steps);
        const sway = Math.sin(y / 9 + now / 50) * wobble * (i / steps);
        left.push({ x: CX - halfWidth + sway, y });
        right.push({ x: CX + halfWidth + sway, y });
        shine.push({ x: CX - halfWidth * 0.35 + sway, y });
      }
      g.fillStyle(0xa5dcff, 0.85);
      g.fillPoints(left.concat(right.reverse()), true);
      g.lineStyle(Math.max(1, halfWidth * 0.4), 0xffffff, 0.55);
      g.strokePoints(shine, false);
    }

    drawStreamBubbles(g, bottom, now) {
      g.fillStyle(0xffffff, 0.9);
      for (let y = NOZZLE_Y + ((now * 0.25) % 14); y < bottom - 2; y += 14) {
        g.fillCircle(CX + Math.sin(y * 0.7) * 2, y, 1.4);
      }
    }

    /** „TRÖPFELT“: einzelne Tropfen statt Strahl. */
    dripWater(now, surfaceY) {
      if (now < this.nextDripAt) return;
      this.nextDripAt = now + DRIP_MS;
      const drop = this.add.image(CX, NOZZLE_Y, 'ws_drop').setTint(0xa5dcff).setScale(0.8).setDepth(DEPTH.stream);
      this.tweens.add({
        targets: drop, y: surfaceY - 4, duration: 260, ease: 'Quad.In',
        onComplete: () => {
          drop.destroy();
          SS.Audio.sfx('water');
          this.splashEmitter.emitParticleAt(CX, surfaceY, 3);
        }
      });
    }

    drawBottleWater(dt) {
      const g = this.waterGfx;
      g.clear();
      const fill = Math.min(this.getFill(), OVERFLOW_AT);
      this.updateBottleBubbles(dt, fill);
      if (fill < 0.3) return;
      const now = this.time.now;
      const surfaceY = this.fillToY(fill);
      const wave = this.flowRate > 0 ? 2 : 0.7;
      const surface = [];
      for (let x = BOTTLE.x; x <= BOTTLE.x + BOTTLE.w; x += 4) {
        surface.push({ x, y: surfaceY + Math.sin(x / 6 + now / 140) * wave });
      }
      const bottom = BOTTLE.y + BOTTLE.h + 4;
      g.fillStyle(0x38bdf8, 0.62);
      g.fillPoints(surface.concat([{ x: BOTTLE.x + BOTTLE.w, y: bottom }, { x: BOTTLE.x, y: bottom }]), true);
      g.lineStyle(2, 0xe0f2fe, 0.9);
      g.strokePoints(surface, false);
      g.fillStyle(0xffffff, 0.75);
      this.bottleBubbles.forEach((b) => g.fillCircle(b.x, b.y, b.r));
    }

    /** Kohlensäure-Bläschen in der Flasche: je mehr Sprudel, desto mehr Bläschen. */
    updateBottleBubbles(dt, fill) {
      const wanted = Math.round(this.sparklingShare() * (fill / 100) * 18);
      if (this.bottleBubbles.length > wanted) this.bottleBubbles.length = wanted;
      while (this.bottleBubbles.length < wanted) this.bottleBubbles.push(this.newBottleBubble(fill, false));
      const surfaceY = this.fillToY(fill);
      this.bottleBubbles.forEach((bubble) => {
        bubble.y -= bubble.speed * dt / 1000;
        if (bubble.y < surfaceY + 3) Object.assign(bubble, this.newBottleBubble(fill, true));
      });
    }

    newBottleBubble(fill, fromBottom) {
      const top = Math.min(FILL_Y0, Math.ceil(this.fillToY(fill)) + 4);
      return {
        x: Phaser.Math.Between(BOTTLE.x + 8, BOTTLE.x + BOTTLE.w - 8),
        y: fromBottom ? FILL_Y0 - Phaser.Math.Between(0, 6) : Phaser.Math.Between(top, FILL_Y0),
        r: Phaser.Math.FloatBetween(1, 2.4),
        speed: Phaser.Math.Between(18, 42)
      };
    }

    /** Luftblasen im Tank – beim Zapfen gluckert es kräftig. */
    updateTankBubbles(dt) {
      const now = this.time.now;
      const glugging = this.running && this.flowRate > 0;
      if (now >= this.nextTankBubbleAt) {
        this.tankBubbles.push(this.newTankBubble(glugging));
        this.nextTankBubbleAt = now + (glugging ? 140 : 600);
      }
      const topY = TANK.y + 20;
      this.tankBubbles.forEach((bubble) => { bubble.y -= bubble.speed * dt / 1000; });
      this.tankBubbles = this.tankBubbles.filter((bubble) => bubble.y > topY);
      const g = this.tankGfx;
      g.clear();
      this.tankBubbles.forEach((bubble) => {
        const x = bubble.x + Math.sin(bubble.y / 8 + bubble.phase) * 2;
        g.lineStyle(1.5, 0xffffff, 0.8);
        g.strokeCircle(x, bubble.y, bubble.r);
        g.fillStyle(0xffffff, 0.45);
        g.fillCircle(x - bubble.r * 0.35, bubble.y - bubble.r * 0.35, bubble.r * 0.35);
      });
    }

    newTankBubble(big) {
      return {
        x: big ? CX + Phaser.Math.Between(-8, 8) : Phaser.Math.Between(TANK.x + 26, TANK.x + TANK.w - 26),
        y: TANK.y + TANK.h - 32,
        r: big ? Phaser.Math.Between(4, 8) : Phaser.Math.Between(2, 3),
        speed: big ? Phaser.Math.Between(80, 120) : Phaser.Math.Between(22, 40),
        phase: Math.random() * 6
      };
    }

    /** Zapftaste mit Druck-Animation und LED (grün = läuft, rot = nichts kommt). */
    drawTapButton(button) {
      const { g, type, x } = button;
      const held = this.activeTap === type;
      const blocked = held && this.flowRate <= 0;
      const press = held ? 3 : 0;
      const left = x - TAP.w / 2;
      const top = TAP.y - TAP.h / 2;
      g.clear();
      g.fillStyle(0x000000, 0.3).fillRoundedRect(left, top + 4, TAP.w, TAP.h, 10);
      g.fillStyle(type.dark, 1).fillRoundedRect(left, top + 3, TAP.w, TAP.h - 3, 10);
      g.fillStyle(held ? SS.UI.lighten(type.color, 0.18) : type.color, 1)
        .fillRoundedRect(left, top + press, TAP.w, TAP.h - 3, 10);
      g.fillStyle(0xffffff, 0.18).fillRoundedRect(left + 4, top + press + 3, TAP.w - 8, 9, 4);
      const led = !held ? 0x1f2937 : (blocked ? C.COLORS.danger : C.COLORS.green);
      // LED unten rechts neben „Taste n“ – oben rechts verdeckte sie das „l“ von „Sprudel“
      g.fillStyle(led, 1).fillCircle(left + TAP.w - 9, top + press + TAP.h - 14, 3.5);
      button.label.setY(TAP.y - 7 + press);
      button.hint.setY(TAP.y + 12 + press);
    }

    // ── HUD ──────────────────────────────────────────────────

    refreshHud() {
      const fill = this.getFill();
      const inZone = this.inTargetZone();
      const fillColor = inZone ? C.CSS.green : (this.fillPercent() > TARGET_MAX ? '#fb923c' : '#ffffff');
      this.fillText.setText(this.fillPercent() + ' %').setColor(fillColor);
      this.shareText.setText(fill > 0 ? this.sparklingPercent() + ' %' : '– %');
      this.knockText.setText(this.knockStatus());
      this.tipText.setText(this.currentTip());
      const g = this.hudGfx;
      g.clear();
      this.drawFillBar(g, fill, inZone);
      this.drawMixBar(g, fill);
      this.drawKnockBar(g);
      this.drawSettleBar(g);
      if (this.running && this.finishButton.isEnabled() !== inZone) this.finishButton.setEnabled(inZone);
    }

    drawFillBar(g, fill, inZone) {
      const b = FILL_BAR;
      const xAt = (percent) => b.x + b.w * percent / 100;
      g.fillStyle(0x000000, 0.45).fillRoundedRect(b.x, b.y, b.w, b.h, 8);
      g.fillStyle(C.COLORS.green, 0.3).fillRect(xAt(TARGET_MIN), b.y, xAt(TARGET_MAX) - xAt(TARGET_MIN), b.h);
      if (fill > 0.5) {
        const color = inZone ? C.COLORS.green : (fill > TARGET_MAX ? C.COLORS.orange : 0x38bdf8);
        const width = Math.max(10, (b.w - 6) * Math.min(fill, 100) / 100);
        g.fillStyle(color, 1).fillRoundedRect(b.x + 3, b.y + 3, width, b.h - 6, 5);
      }
      g.lineStyle(2, C.COLORS.green, 1);
      g.lineBetween(xAt(TARGET_MIN), b.y - 4, xAt(TARGET_MIN), b.y + b.h + 4);
      g.lineBetween(xAt(TARGET_MAX), b.y - 4, xAt(TARGET_MAX), b.y + b.h + 4);
      g.fillStyle(C.COLORS.danger, 1).fillRect(b.x + b.w - 5, b.y + 4, 3, b.h - 8); // Überlaufkante
      g.lineStyle(2, 0xffffff, 0.75).strokeRoundedRect(b.x, b.y, b.w, b.h, 8);
    }

    /** Mischbalken: Sprudel | Medium | Still, Markierung bei 50 %. */
    drawMixBar(g, fill) {
      const b = MIX_BAR;
      g.fillStyle(0x000000, 0.45).fillRoundedRect(b.x, b.y, b.w, b.h, 5);
      if (fill > 0.01) {
        let x = b.x + 2;
        MIX_ORDER.forEach((key) => {
          const width = (b.w - 4) * this.volumes[key] / fill;
          const type = WATER_TYPES.find((t) => t.key === key);
          if (width > 0.5) g.fillStyle(type.color, 1).fillRect(x, b.y + 2, width, b.h - 4);
          x += width;
        });
      }
      const mid = b.x + b.w * SPARKLING_GOAL;
      g.lineStyle(2, C.COLORS.yellow, 1).lineBetween(mid, b.y - 5, mid, b.y + b.h + 5);
      g.lineStyle(2, 0xffffff, 0.75).strokeRoundedRect(b.x, b.y, b.w, b.h, 5);
    }

    drawKnockBar(g) {
      const b = KNOCK_BAR;
      const now = this.time.now;
      const remaining = Math.max(0, this.knockReadyAt - now);
      const fraction = 1 - remaining / KNOCK_COOLDOWN_MS;
      const color = now < this.knockDeniedUntil ? C.COLORS.danger : (remaining > 0 ? 0x9ca3af : C.COLORS.yellow);
      g.fillStyle(0x000000, 0.45).fillRoundedRect(b.x, b.y, b.w, b.h, b.h / 2);
      g.fillStyle(color, 1).fillRoundedRect(b.x, b.y, Math.max(b.h, b.w * fraction), b.h, b.h / 2);
    }

    /** Fortschritt „1 s ruhig im Ziel“. */
    drawSettleBar(g) {
      if (this.settleMs <= 0) return;
      const b = SETTLE_BAR;
      g.fillStyle(0x000000, 0.45).fillRoundedRect(b.x, b.y, b.w, b.h, b.h / 2);
      g.fillStyle(C.COLORS.green, 1).fillRoundedRect(b.x, b.y, Math.max(b.h, b.w * this.settleMs / SETTLE_MS), b.h, b.h / 2);
    }

    knockStatus() {
      const remaining = this.knockReadyAt - this.time.now;
      if (remaining <= 0) return 'bereit (K / Klick)';
      return 'wieder in ' + (remaining / 1000).toFixed(1).replace('.', ',') + ' s';
    }

    currentTip() {
      if (this.finished) return 'Abgefüllt. Mal sehen, was es bringt …';
      if (!this.running) return 'Gleich geht’s los …';
      if (this.inTargetZone()) {
        const sparkling = this.hasEnoughSparkling();
        if (this.activeTap) return sparkling ? 'Im Ziel! Jetzt loslassen.' : 'Im Ziel – aber viel Still (nur 2 ECTS).';
        return sparkling ? 'Perfekt! Gleich fertig (3 ECTS) …' : 'Stilles Wasser … gleich fertig (2 ECTS).';
      }
      if (this.fillPercent() > TARGET_MAX) return 'Zu voll! Zurück geht nichts mehr – nur noch überlaufen …';
      if (this.warningNext) return 'Das Display flackert … gleich: ' + STATES[this.warningNext].label;
      return STATES[this.stateKey].tip;
    }

    // ── Spielende ────────────────────────────────────────────

    onFinishPressed() {
      if (this.running && this.inTargetZone()) this.finishQuest('goal');
    }

    /** Zeit um: Wer gerade im Ziel ist, bekommt die Flasche trotzdem gewertet. */
    onTimeUp() {
      this.finishQuest(this.inTargetZone() ? 'goal' : 'timeout');
    }

    finishQuest(reason) {
      if (this.finished) return;
      this.finished = true;
      this.running = false;
      this.activeTap = null;
      this.pointerTap = null;
      this.flowRate = 0;
      this.settleMs = 0;
      if (this.timer) this.timer.stop();
      this.cancelStateTimers();
      this.warningNext = null;
      this.finishButton.setEnabled(false);
      const result = this.buildResult(reason);
      this.showEndStamp(reason);
      this.time.delayedCall(END_DELAY_MS, () => {
        SS.SideQuest.outro(this, result, { headline: this.rewardFor(reason).headline });
      });
    }

    rewardFor(reason) {
      if (reason !== 'goal') return REWARDS[reason];
      return this.hasEnoughSparkling() ? REWARDS.sparkling : REWARDS.still;
    }

    buildResult(reason) {
      const reward = this.rewardFor(reason);
      return { id: QUEST_ID, title: QUEST_TITLE, success: reward.success, ects: reward.ects, message: reward.message };
    }

    /** Kurzer Stempel über dem Spender, bevor die Ergebniskarte kommt. */
    showEndStamp(reason) {
      const looks = {
        goal: { text: 'PROST!', color: C.CSS.green, sfx: 'coin' },
        timeout: { text: 'ZEIT UM!', color: C.CSS.danger, sfx: 'error' },
        overflow: { text: 'PLATSCH!', color: '#7dd3fc', sfx: null }
      };
      const look = looks[reason];
      if (look.sfx) SS.Audio.sfx(look.sfx);
      const backdrop = this.add.graphics().setDepth(DEPTH.pop).setAlpha(0);
      backdrop.fillStyle(0x000000, 0.72).fillRoundedRect(BODY.x + 12, TAP.y - 56, BODY.w - 24, 112, 14);
      const stamp = SS.UI.text(this, CX, TAP.y - 14, look.text, 'h1', { fontSize: '46px', color: look.color })
        .setOrigin(0.5).setDepth(DEPTH.pop).setAngle(-6).setScale(2.2).setAlpha(0);
      const stats = 'Füllstand ' + this.fillPercent() + ' % · Sprudel-Anteil ' + this.sparklingPercent() + ' %';
      const statsText = SS.UI.text(this, CX, TAP.y + 32, stats, 'body', { fontSize: '16px', color: C.CSS.inkSoft })
        .setOrigin(0.5).setDepth(DEPTH.pop).setAlpha(0);
      this.tweens.add({ targets: [backdrop, statsText], alpha: 1, duration: 200 });
      this.tweens.add({ targets: stamp, scale: 1, alpha: 1, duration: 280, ease: 'Back.Out' });
      if (reason === 'goal') {
        SS.UI.burst(this, CX, BOTTLE.y, {
          texture: 'spark', count: 26, speedMin: 90, speedMax: 260, gravityY: 300, scale: 0.9,
          tint: [C.COLORS.green, C.COLORS.cyan, 0xffffff], depth: DEPTH.particles
        });
      }
    }

    // ── Hilfen ───────────────────────────────────────────────

    /** Kurzer Comic-Text, der aufploppt und nach oben verschwindet. */
    popText(x, y, message, color, size) {
      const text = SS.UI.text(this, x, y, message, 'h2', { fontSize: (size || 24) + 'px', color: color || '#ffffff' })
        .setOrigin(0.5).setDepth(DEPTH.pop).setScale(0.3);
      this.tweens.add({ targets: text, scale: 1, duration: 180, ease: 'Back.Out' });
      this.tweens.add({
        targets: text, y: y - 34, alpha: 0, delay: 650, duration: 420,
        onComplete: () => text.destroy()
      });
      return text;
    }

    /** Eigene Listener, Tasten und die Masken-Grafik aufräumen (Timer/Tweens räumt Phaser selbst ab). */
    cleanup() {
      this.input.off('pointerup', this.releasePointerTap, this);
      Object.keys(this.tapKeys || {}).forEach((kind) => {
        this.tapKeys[kind].forEach((key) => this.input.keyboard.removeKey(key));
      });
      if (this.bottleMask) this.bottleMask.destroy();
      if (this.bottleMaskShape) this.bottleMaskShape.destroy();
      this.bottleMask = null;
      this.bottleMaskShape = null;
    }
  }

  SS.scenes.WasserspenderScene = WasserspenderScene;
})();

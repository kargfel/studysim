/*
 * EduroamScene.js – Side Quest 1: „WLAN-Odyssee: eduroam einrichten“.
 *
 * Ein nachgebautes Smartphone führt in sechs Schritten durch die eduroam-Einrichtung.
 * Pro Schritt passt genau eine Antwort (Reihenfolge zufällig). Eine falsche Wahl kostet
 * 5 Sekunden und zeigt eine Fehlermeldung. Laden und Dialoge halten die Zeit an.
 *
 * Ablauf:    SS.SideQuest.intro → showStep(0 … 5) → showConnected | onTimeUp → SS.SideQuest.outro
 * Steuerung: Klick oder Tasten 1–4 · Hochschul-Liste: ← → blättern ·
 *            Zwei-Faktor-Code: Ziffern, Backspace, Enter (oder Ziffernblock im Handy)
 * Belohnung: geschafft mit ≤ 2 Fehlern → 3 ECTS, sonst 2 ECTS · Zeit abgelaufen → 0 ECTS
 *
 * Debug-Hook für Tests:
 *   ?scene=EduroamScene&seed=42   → reproduzierbare Reihenfolge, Ladezeiten und Codes
 *   SS.game.scene.getScene('EduroamScene').debugState()
 *     → { phase, step, stepId, rows: [{key, label, state, x, y}], correctKey, correctPage,
 *         page, code, codeInput, mistakes, remainingMs }
 */
(function () {
  'use strict';
  const SS = globalThis.SS;
  const C = SS.CONFIG;
  const T = SS.Textures;

  // ── Regeln und Zeiten ──────────────────────────────────────────
  const QUEST = { id: 'eduroam', title: 'WLAN-Odyssee: eduroam einrichten' };
  const TOTAL_MS = 45000;               // Zeit für alle sechs Schritte
  const PENALTY_MS = 5000;              // falsche Antwort oder falscher Code
  const SECURITY_PENALTY_MS = 10000;    // „Zertifikat nicht prüfen“ kostet extra
  const MAX_MISTAKES_FOR_FULL = 2;      // bis hierhin gibt es die volle Belohnung
  const ECTS_FULL = 3;
  const ECTS_REDUCED = 2;
  const CODE_LENGTH = 6;
  const CODE_VISIBLE_MS = 3000;         // so lange ist der 2FA-Code zu sehen
  const LOADING_MS = { min: 800, max: 1500 };
  const SUCCESS_PAUSE_MS = 350;         // grüner Haken, bevor das Laden startet
  const ALERT_TIMING = { autoCloseMs: 1900, minMs: 350 };
  const SECURITY_ALERT_TIMING = { autoCloseMs: 6500, minMs: 1500 };
  const NOTIFY_MS = 2200;
  const END_DELAY_MS = 3000;            // „Verbunden“-Bildschirm, dann Ergebniskarte
  const TIMEOUT_DELAY_MS = 2600;
  const PAGE_SIZE = 4;                  // Einträge pro Seite in der Hochschul-Liste
  const START_BATTERY = 12;             // Akku in Prozent

  // ── Layout (Spielkoordinaten 800 × 600) ────────────────────────
  const PHONE = { x: 242, y: 56, w: 316, h: 524 };                 // Gehäuse, linke obere Ecke
  const SCREEN = { x: 254, y: 68, w: 292, h: 496, radius: 32 };    // Display im Gehäuse
  const CENTER_X = SCREEN.x + SCREEN.w / 2;
  const CONTENT = { x: SCREEN.x + 14, w: SCREEN.w - 28 };          // Innenbereich mit Rand
  const STATUS_Y = SCREEN.y + 14;                                  // Mitte der Statusleiste
  const APPBAR_Y = SCREEN.y + 50;                                  // Mitte der App-Titelzeile
  const PROMPT_Y = SCREEN.y + 84;                                  // Oberkante der Frage
  const CONTENT_BOTTOM = SCREEN.y + SCREEN.h - 22;                 // über dem Home-Balken
  const ROW = { minH: 50, gap: 8, radius: 12, badgeX: 22, textX: 44, padRight: 12, iconSpace: 34, maxLines: 2 };
  const KEYPAD = { keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'], cols: 3, w: 76, h: 40, gapX: 10, stepY: 48 };
  const KEYPAD_ALIASES = { '⌫': 'Backspace', OK: 'Enter' };
  const CODE_BOX = { w: 34, h: 44, gap: 8 };
  const TIMER = { x: 250, y: 20, w: 300, h: 24 };
  const SIDE = { y: 236, w: 206, h: 214, leftX: 20, rightX: 574, pad: 16 };
  const PAGE_KEYS = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
  const DEPTH = { campus: -100, panel: 5, phone: 10, content: 20, overlay: 30, status: 40, notification: 50, alert: 60, fx: 70 };
  const HORIZON_Y = 478;                                           // Boden der Campus-Kulisse

  // ── Handy-Optik: heller „Einstellungen“-Look, bewusst anders als der Rest des Spiels ──
  const PHONE_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  const PH = {
    screen: 0xf2f2f7, card: 0xffffff, line: 0xd1d5db, hover: 0xeff6ff, dark: 0x111827,
    accent: 0x2563eb, ok: 0x16a34a, okTint: 0xdcfce7, bad: 0xdc2626, badTint: 0xfee2e2, muted: 0x9ca3af,
    ink: '#111827', inkSoft: '#6b7280', inkMuted: '#9ca3af'
  };
  const PHONE_TEXT = { fontFamily: PHONE_FONT, fontSize: '16px', color: PH.ink };
  const ROW_LOOK = {
    idle: { fill: PH.card, line: PH.line, badge: PH.accent, mark: null },
    wrong: { fill: PH.badTint, line: PH.bad, badge: PH.muted, mark: '✕' },
    correct: { fill: PH.okTint, line: PH.ok, badge: PH.ok, mark: '✔' }
  };

  // ── Texte ──────────────────────────────────────────────────────
  const INTRO = {
    title: 'WLAN-Odyssee',
    subtitle: 'eduroam einrichten – bevor die Vorlesung beginnt',
    lines: [
      'Dein Handy: 12 % Akku, null Balken WLAN.',
      '6 Schritte, pro Schritt passt genau eine Antwort.',
      'Klick oder Tasten 1–4 · Liste: ← → · Code: Ziffern',
      'Fehler kosten 5 s. Höchstens 2 Fehler: 3 ECTS.'
    ],
    buttonLabel: 'Handy zücken',
    accent: C.COLORS.cyan
  };

  /*
   * Die sechs Schritte. type: 'choice' (3–4 Antworten), 'list' (lange Liste mit Seiten),
   * 'code' (Zwei-Faktor-Code). Genau eine Antwort hat correct: true;
   * security: true ist die Sicherheitsfalle mit eigener Strafe und Erklärung.
   * loadingNote: Push-Nachricht während der Lade-Animation nach dem Schritt.
   */
  const STEPS = [
    {
      id: 'netzwerk', type: 'choice', checklist: 'Netzwerk wählen', app: 'WLAN', loadingNote: 'battery',
      prompt: 'Mit welchem Netz verbindest du dich?',
      hint: 'Verfügbare Netzwerke in der Nähe',
      loading: 'Verbinde mit eduroam …',
      options: [
        { label: 'eduroam', sub: 'gesichert · WPA2-Enterprise', bars: 1, correct: true },
        { label: 'DHBW-Gast', sub: 'offen · Gastzugang', bars: 3,
          error: 'Gastzugang nur mit Voucher aus dem Sekretariat. Sprechzeit: dienstags, 10 bis 11 Uhr.' },
        { label: 'Mensa_Free_WiFi', sub: 'offen · sehr verdächtig', bars: 3,
          error: 'Erst das Tagesgericht mit fünf Sternen bewerten, dann gibt’s Internet. Heute: Linseneintopf.' },
        { label: 'iPhone von Kevin', sub: 'persönlicher Hotspot', bars: 2,
          error: 'Kevin hat seinen Hotspot gerade abgeschaltet. Er braucht sein Datenvolumen selbst.' }
      ]
    },
    {
      id: 'methode', type: 'choice', checklist: 'Einrichtungsweg', app: 'eduroam', loadingNote: 'chat',
      prompt: 'Wie richtest du eduroam ein?',
      hint: 'Die Anleitung der Hochschul-IT liegt … im Internet.',
      loading: 'easyroam wird gestartet …',
      options: [
        { label: 'easyroam-App', correct: true },
        { label: 'WLAN-Booster Pro (4,99 €)',
          error: 'Kauf erfolgreich! Signalstärke: unverändert. Kontostand: −4,99 €.' },
        { label: 'Alles manuell eintragen',
          error: 'EAP-Methode? Phase-2-Authentifizierung? Anonyme Identität? Du klappst das Menü leise wieder zu.' },
        { label: 'Kommiliton:in fragen (hat auch kein Netz)',
          error: '„Bei mir geht’s auch nicht.“ Jetzt starrt ihr zu zweit aufs Handy.' }
      ]
    },
    {
      id: 'einrichtung', type: 'list', checklist: 'Hochschule finden', app: 'easyroam', loadingNote: 'mensa',
      prompt: 'Wähle deine Einrichtung:',
      hint: 'Suche gerade nicht verfügbar (kein Netz).',
      loading: 'Profil wird installiert …',
      options: [
        { label: 'Duale Hochschule Baden-Württemberg', correct: true },
        { label: 'Duale Hochschule Bad Württemberg',
          error: 'Fast! „Bad Württemberg“ ist ein Kurort. Dort gibt’s nur Thermal-WLAN.' },
        { label: 'Dualer Hochschulverbund Nord',
          error: 'Falscher Verbund. Dein Konto liegt ein paar hundert Kilometer weiter südlich.' },
        { label: 'Hochschule für Dualität',
          error: 'Die Hochschule für Dualität ist gleichzeitig offen und geschlossen. Wie dein WLAN.' },
        { label: 'Duale Hochschule Baden-Würtemberg',
          error: 'Ein „t“ zu wenig. Der Server ist da sehr pingelig.' },
        { label: 'Duale Hochschule Baden-Württemberg (Test)',
          error: 'Testsystem! Hier klappt alles – nur leider nicht in echt.' },
        { label: 'Duale Akademie Württemberg-Baden',
          error: 'Falsch herum. Und eine Akademie ist es auch nicht.' },
        { label: 'Volkshochschule Dualbach',
          error: 'Töpferkurs statt Studium? Dein Konto sagt Nein.' },
        { label: 'Duale Hochschule Baden-Württemberg Alumni',
          error: 'Alumni? So weit bist du noch nicht. Erst mal dieses Semester überleben.' },
        { label: 'Akademie für angewandtes Warten',
          error: 'Klingt passend, ist aber nicht deine Einrichtung. Bitte warten Sie …' },
        { label: 'Duales Studienzentrum Baden-Wüttemberg',
          error: '„Wüttemberg“? Da fehlt ein „r“ – und das Studienzentrum gibt es auch nicht.' },
        { label: 'Fernuni Couchhausen',
          error: 'Studieren von der Couch? Verlockend. Ist aber nicht deine Hochschule.' }
      ]
    },
    {
      id: 'anmeldung', type: 'choice', checklist: 'Anmelden', app: 'Anmeldung',
      prompt: 'Wie lautet dein Benutzername?',
      hint: 'Passwort: •••••••• (zum Glück gespeichert)',
      loading: 'Anmeldedaten werden geprüft …',
      options: [
        { label: 's123456@student.dhbw.example', correct: true },
        { label: 'max.mustermann',
          error: 'Ohne @-Domain weiß eduroam nicht, zu welcher Hochschule du gehörst.' },
        { label: 'admin',
          error: 'Netter Versuch. Die Hochschul-IT hat das gesehen.' },
        { label: 'Max Mustermann (Kurs 24B)',
          error: 'Leerzeichen und Klammern im Benutzernamen? Der Server bekommt Schnappatmung.' }
      ]
    },
    {
      id: 'code', type: 'code', checklist: 'Zwei-Faktor-Code', app: 'Zwei-Faktor',
      prompt: 'Gib den 6-stelligen Code ein.',
      hint: 'Kommt per Push-Nachricht und ist nur 3 Sekunden sichtbar.',
      loading: 'Code wird geprüft …'
    },
    {
      id: 'zertifikat', type: 'choice', checklist: 'Zertifikat', app: 'Sicherheit', danger: true,
      prompt: 'Zertifikat abgelaufen!',
      hint: 'radius.dhbw.example · gültig bis: gestern',
      loading: 'Neues Profil wird erzeugt …',
      options: [
        { label: 'Neues Profil erzeugen', correct: true },
        { label: 'Zertifikat nicht prüfen', security: true },
        { label: 'Handy-Datum auf 2019 stellen',
          error: 'Zertifikat gültig! Dafür hält dein Handy dich jetzt für einen Zeitreisenden. Keine App startet mehr.' },
        { label: 'Weinen',
          error: 'Verständlich. Hilft aber nicht: Das Zertifikat ist immer noch abgelaufen.' }
      ]
    }
  ];

  const WRONG_ANSWER_TITLE = 'Fehler · −' + PENALTY_MS / 1000 + ' s';
  const WRONG_CODE_ALERT = {
    title: 'Falscher Code · −' + PENALTY_MS / 1000 + ' s',
    message: 'Vertippt oder schon abgelaufen. Ein neuer Code ist unterwegs …'
  };
  const SECURITY_ALERT = {
    title: 'Sicherheitsfalle! −' + SECURITY_PENALTY_MS / 1000 + ' s',
    message: 'Ohne Zertifikatsprüfung kann sich jeder fremde Hotspot als „eduroam“ ausgeben. ' +
      'Als Man-in-the-Middle liest er dann deine Zugangsdaten mit.'
  };

  // Push-Benachrichtigungen (app = Absender, color = Farbe des App-Symbols, big = große zweite Zeile)
  const NOTES = {
    battery: { app: 'System', color: 0x6b7280, text: 'Akku 12 %. Das Ladekabel liegt zu Hause.' },
    chat: { app: 'Kurs-Chat', color: 0x16a34a, text: '„Hat irgendwer schon WLAN?!“ · 37 neue Nachrichten' },
    mensa: { app: 'Mensa', color: 0xf97316, text: 'Heute: Gemüselasagne. Schon wieder.' },
    cancelled: { app: 'Kurs-Chat', color: 0x16a34a, text: '„Die Vorlesung fällt heute übrigens aus.“' },
    hotspot: { app: 'System', color: 0x6b7280, text: 'Persönlicher Hotspot aktiv. Restvolumen: 0,3 GB.' }
  };

  const HELP = {
    choice: 'Klicken oder\nTasten 1–4',
    list: 'Tasten 1–4 wählen\n← → blättern',
    code: 'Ziffern tippen\n⌫ löschen · Enter'
  };

  const RESULT_TEXT = {
    perfect: 'Fehlerfrei verbunden! Signal: 1 Balken – für die Vorlesungsfolien reicht’s.',
    good: (n) => `Verbunden mit eduroam (${n} ${n === 1 ? 'Fehlversuch' : 'Fehlversuche'}). Signal: 1 Balken – reicht für die Folien.`,
    sloppy: (n) => `Verbunden – nach ${n} Fehlversuchen. Die Hochschul-IT kennt jetzt deinen Namen.`,
    insecure: 'Verbunden. Merke: Zertifikatsprüfung nie abschalten – sonst liest ein Man-in-the-Middle mit.',
    timeout: 'Du nutzt jetzt den Hotspot deines Handys. Restvolumen: 0,3 GB.'
  };

  // ── Texturen (Präfix edu_) ─────────────────────────────────────
  T.register('edu_campus', C.WIDTH, C.HEIGHT, drawCampus);
  T.register('edu_phone', PHONE.w, PHONE.h, drawPhone);
  T.register('edu_spinner', 44, 44, drawSpinner);

  /** Campus-Kulisse: Himmel, Hörsaalgebäude, Mensa mit müdem Access-Point, Rasen, Leute. */
  function drawCampus(ctx, w, h) {
    drawSky(ctx, w);
    drawCloud(ctx, 92, 86, 1);
    drawCloud(ctx, 628, 126, 0.75);
    drawBuilding(ctx, { x: 0, y: 136, w: 234, h: HORIZON_Y - 136, wall: '#e2e8f0', band: '#e2001a', sign: 'DHBW', signColor: '#ffffff' });
    drawBuilding(ctx, { x: 568, y: 166, w: 232, h: HORIZON_Y - 166, wall: '#e7e5e4', band: '#f59e0b', sign: 'MENSA', signColor: '#1f2937' });
    drawAccessPoint(ctx, 592, 216);
    drawGround(ctx, w, h);
    drawTree(ctx, 46, 548, 1);
    drawTree(ctx, 758, 552, 1.1);
    drawStudent(ctx, 152, 586, '#3b82f6');
    drawStudent(ctx, 662, 586, '#f97316');
  }

  function drawSky(ctx, w) {
    const sky = ctx.createLinearGradient(0, 0, 0, HORIZON_Y);
    sky.addColorStop(0, '#1e3a8a');
    sky.addColorStop(0.6, '#3b82f6');
    sky.addColorStop(1, '#bae6fd');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, HORIZON_Y);
    const sun = ctx.createRadialGradient(730, 64, 6, 730, 64, 70);
    sun.addColorStop(0, 'rgba(255, 247, 214, 1)');
    sun.addColorStop(0.35, 'rgba(255, 228, 140, 0.85)');
    sun.addColorStop(1, 'rgba(255, 228, 140, 0)');
    ctx.fillStyle = sun;
    ctx.fillRect(650, 0, 150, 140);
  }

  /** Wolke aus vier Kreisen – als ein Pfad gefüllt, damit sich nichts überlagert. */
  function drawCloud(ctx, x, y, s) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    [[0, 0, 22], [24, -10, 26], [52, 0, 20], [26, 8, 22]].forEach(([dx, dy, r]) => {
      ctx.moveTo(x + (dx + r) * s, y + dy * s);
      ctx.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2);
    });
    ctx.fill();
  }

  function drawBuilding(ctx, b) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.fillRect(b.x + 6, b.y + 6, b.w, b.h);
    ctx.fillStyle = b.wall;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    for (let y = b.y + 62; y < b.y + b.h - 60; y += 46) {          // Fensterraster
      for (let x = b.x + 16; x < b.x + b.w - 30; x += 44) {
        ctx.fillStyle = '#93c5fd';
        ctx.fillRect(x, y, 30, 32);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.fillRect(x + 3, y + 3, 8, 26);
      }
    }
    ctx.fillStyle = b.band;                                          // Schriftband
    ctx.fillRect(b.x, b.y, b.w, 46);
    ctx.fillStyle = b.signColor;
    ctx.font = 'bold 30px ' + C.FONTS.display;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.sign, b.x + b.w / 2, b.y + 24);
  }

  /** WLAN-Access-Point mit roter LED und durchgestrichenen Funkwellen. */
  function drawAccessPoint(ctx, x, y) {
    ctx.fillStyle = '#f8fafc';
    T.roundRect(ctx, x, y, 40, 14, 5);
    ctx.fill();
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(x + 32, y + 7, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(30, 41, 59, 0.6)';
    ctx.lineWidth = 2;
    [7, 13].forEach((r) => {
      ctx.beginPath();
      ctx.arc(x + 60, y + 14, r, -Math.PI * 0.75, -Math.PI * 0.25);
      ctx.stroke();
    });
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x + 50, y - 2);
    ctx.lineTo(x + 70, y + 14);
    ctx.stroke();
  }

  function drawGround(ctx, w, h) {
    ctx.fillStyle = '#cbd5e1';                                       // Gehweg vor den Gebäuden
    ctx.fillRect(0, HORIZON_Y, w, 14);
    const lawn = ctx.createLinearGradient(0, HORIZON_Y + 14, 0, h);
    lawn.addColorStop(0, '#4ade80');
    lawn.addColorStop(1, '#15803d');
    ctx.fillStyle = lawn;
    ctx.fillRect(0, HORIZON_Y + 14, w, h - HORIZON_Y - 14);
  }

  function drawTree(ctx, x, baseY, s) {
    ctx.fillStyle = '#78350f';
    ctx.fillRect(x - 5 * s, baseY - 40 * s, 10 * s, 40 * s);
    ctx.fillStyle = '#166534';
    [[0, -62, 26], [-18, -46, 20], [18, -46, 20]].forEach(([dx, dy, r]) => {
      ctx.beginPath();
      ctx.arc(x + dx * s, baseY + dy * s, r * s, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  /** Studi, der das Handy auf der Suche nach Empfang in die Luft hält. */
  function drawStudent(ctx, x, footY, shirt) {
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(x - 10, footY - 36, 8, 36);
    ctx.fillRect(x + 2, footY - 36, 8, 36);
    ctx.fillStyle = shirt;
    T.roundRect(ctx, x - 14, footY - 78, 28, 46, 9);
    ctx.fill();
    ctx.strokeStyle = shirt;
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + 10, footY - 70);
    ctx.lineTo(x + 24, footY - 112);
    ctx.stroke();
    ctx.fillStyle = '#0f172a';
    T.roundRect(ctx, x + 18, footY - 130, 13, 21, 3);
    ctx.fill();
    ctx.fillStyle = '#f2c9a0';
    ctx.beginPath();
    ctx.arc(x, footY - 90, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3f2a1d';
    ctx.beginPath();
    ctx.arc(x, footY - 93, 12, Math.PI, 0);
    ctx.fill();
  }

  /** Smartphone-Gehäuse mit leerem Display und Kamera-Loch. */
  function drawPhone(ctx, w, h) {
    const sx = SCREEN.x - PHONE.x;
    const sy = SCREEN.y - PHONE.y;
    ctx.fillStyle = '#4b5563';                                       // Seitentasten
    ctx.fillRect(0, 118, 5, 44);
    ctx.fillRect(0, 172, 5, 44);
    ctx.fillRect(w - 5, 150, 5, 64);
    const body = ctx.createLinearGradient(0, 0, w, 0);
    body.addColorStop(0, '#374151');
    body.addColorStop(0.08, '#111827');
    body.addColorStop(0.92, '#111827');
    body.addColorStop(1, '#374151');
    ctx.fillStyle = body;
    T.roundRect(ctx, 3, 0, w - 6, h, 44);
    ctx.fill();
    ctx.strokeStyle = '#6b7280';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = T.hex(PH.screen);
    T.roundRect(ctx, sx, sy, SCREEN.w, SCREEN.h, SCREEN.radius);
    ctx.fill();
    ctx.fillStyle = '#0b0b0f';
    ctx.beginPath();
    ctx.arc(w / 2, sy + 14, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Lade-Kreisel aus 12 Strichen mit zunehmender Deckkraft. */
  function drawSpinner(ctx, w) {
    const c = w / 2;
    ctx.lineCap = 'round';
    ctx.lineWidth = 4;
    for (let i = 0; i < 12; i++) {
      const a = (Math.PI * 2 * i) / 12;
      ctx.strokeStyle = `rgba(55, 65, 81, ${(0.15 + (0.85 * i) / 11).toFixed(2)})`;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * 10, c + Math.sin(a) * 10);
      ctx.lineTo(c + Math.cos(a) * 19, c + Math.sin(a) * 19);
      ctx.stroke();
    }
  }

  // ── Kleine Helfer ──────────────────────────────────────────────

  /** WLAN-Symbol: Punkt + drei Bögen; (x, y) = Punkt unten, bars = aktive Bögen (0–3). */
  function drawWifiIcon(g, x, y, size, bars, onColor, offColor) {
    const thickness = Math.max(2, size * 0.14);
    g.fillStyle(bars > 0 ? onColor : offColor, 1);
    g.fillCircle(x, y - thickness / 2, thickness * 0.9);
    for (let i = 1; i <= 3; i++) {
      g.lineStyle(thickness, i <= bars ? onColor : offColor, 1);
      g.beginPath();
      g.arc(x, y, (size * i) / 3, -Math.PI * 0.75, -Math.PI * 0.25, false);
      g.strokePath();
    }
  }

  /** Akku-Symbol (22 × 11 px) mit Füllstand; x/y = linke obere Ecke. */
  function drawBattery(g, x, y, percent) {
    g.lineStyle(1.5, PH.dark, 0.9);
    g.strokeRoundedRect(x, y, 22, 11, 3);
    g.fillStyle(PH.dark, 0.9);
    g.fillRect(x + 23, y + 3.5, 2, 4);
    g.fillStyle(percent <= 20 ? 0xef4444 : PH.dark, 1);
    g.fillRect(x + 2, y + 2, Math.max(1.5, (18 * percent) / 100), 7);
  }

  /**
   * Verkleinert die Schrift, bis der Text höchstens maxLines Zeilen hat und nicht breiter
   * als maxWidth ist (lange Hochschulnamen, E-Mail-Adressen, breitere Schriften unter Windows).
   */
  function fitText(text, maxWidth, maxLines, minSize) {
    let size = parseInt(text.style.fontSize, 10);
    const tooBig = () => text.width > maxWidth || text.getWrappedText().length > maxLines;
    while (tooBig() && size > minSize) {
      size -= 1;
      text.setFontSize(size);
    }
  }

  /** Kopiert die Schritte und mischt die Antworten (die Vorlage bleibt unverändert). */
  function prepareSteps(rng) {
    return STEPS.map((step) => Object.assign({}, step, {
      options: step.options ? rng.shuffle(step.options.map((option) => Object.assign({}, option))) : null
    }));
  }

  function randomCode(rng) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) code += rng.between(0, 9);
    return code;
  }

  /** "482913" → "482 913" (lesbarer in der Push-Nachricht). */
  function formatCode(code) {
    return code.slice(0, 3) + ' ' + code.slice(3);
  }

  // ── Szene ──────────────────────────────────────────────────────
  class EduroamScene extends Phaser.Scene {
    constructor() {
      super('EduroamScene');
    }

    /** Zustand bei jedem Start neu setzen – Phaser verwendet die Szenen-Instanz wieder. */
    init() {
      this.__sideQuestFinished = false; // Workaround: SS.SideQuest.finish() setzt das Flag sonst nie zurück
      const seed = SS.getUrlParams().seed;
      this.rng = seed ? new Phaser.Math.RandomDataGenerator([String(seed)]) : Phaser.Math.RND;
      this.steps = prepareSteps(this.rng);
      this.stepIndex = -1;
      this.completed = 0;          // Anzahl erledigter Schritte
      this.rows = [];              // sichtbare Antwortzeilen
      this.codeBoxes = [];
      this.mistakes = 0;
      this.penaltyMs = 0;
      this.choseInsecure = false;
      this.locked = true;          // Eingaben gesperrt (Intro, Laden, Dialog, Ende)
      this.finished = false;
      this.timedOut = false;
      this.timer = null;
      this.alertBox = null;
      this.notification = null;
      this.listPage = 0;
      this.code = '';
      this.codeInput = '';
      this.wifiBars = 0;
      this.battery = START_BATTERY;
      this.seenKeyEvents = new WeakSet();
    }

    create() {
      this.add.image(0, 0, 'edu_campus').setOrigin(0).setDepth(DEPTH.campus);
      this.createSidePanels();
      this.createPhone();
      this.showLockScreen();
      this.input.keyboard.on('keydown', this.handleKey, this);
      this.events.once('shutdown', this.cleanup, this);
      SS.Audio.music.play('sidequest');
      SS.SideQuest.intro(this, INTRO, () => this.startGameplay());
    }

    update() {
      this.refreshBattery();
    }

    /** Timer und Tweens räumt Phaser selbst ab – nur der Tastatur-Listener muss weg. */
    cleanup() {
      this.input.keyboard.off('keydown', this.handleKey, this);
    }

    // ── Aufbau ───────────────────────────────────────────────────

    createPhone() {
      this.add.image(PHONE.x, PHONE.y, 'edu_phone').setOrigin(0).setDepth(DEPTH.phone);
      this.content = this.add.container(0, 0).setDepth(DEPTH.content);
      this.createStatusBar();
      this.errorFlash = this.add.graphics().setDepth(DEPTH.fx).setAlpha(0);
    }

    /** Statusleiste: Uhrzeit, WLAN (0 Balken), Akku – dazu der Home-Balken unten. */
    createStatusBar() {
      this.clockText = SS.UI.text(this, SCREEN.x + 26, STATUS_Y, '08:14', PHONE_TEXT, { fontSize: '14px', fontStyle: 'bold' })
        .setOrigin(0, 0.5).setDepth(DEPTH.status);
      this.batteryText = SS.UI.text(this, SCREEN.x + SCREEN.w - 52, STATUS_Y, '', PHONE_TEXT, { fontSize: '12px', fontStyle: 'bold' })
        .setOrigin(1, 0.5).setDepth(DEPTH.status);
      this.statusIcons = this.add.graphics().setDepth(DEPTH.status);
      this.drawStatusIcons();
    }

    drawStatusIcons() {
      const g = this.statusIcons;
      const right = SCREEN.x + SCREEN.w;
      g.clear();
      drawWifiIcon(g, right - 100, STATUS_Y + 6, 13, this.wifiBars, PH.dark, 0xc7c7cc);
      drawBattery(g, right - 48, STATUS_Y - 6, this.battery);
      g.fillStyle(PH.dark, 0.85);
      g.fillRoundedRect(CENTER_X - 55, SCREEN.y + SCREEN.h - 12, 110, 5, 2.5);
      this.batteryText.setText(this.battery + ' %');
    }

    /** Akku sinkt mit der Restzeit von 12 % auf 1 %. */
    refreshBattery() {
      if (!this.timer || this.finished) return;
      const battery = Math.max(1, Math.ceil(START_BATTERY * this.timer.getFraction()));
      if (battery === this.battery) return;
      this.battery = battery;
      this.drawStatusIcons();
    }

    setWifiBars(bars) {
      this.wifiBars = bars;
      this.drawStatusIcons();
    }

    /** Sperrbildschirm, solange die Intro-Karte zu sehen ist. */
    showLockScreen() {
      this.content.add([
        this.phoneText(CENTER_X, SCREEN.y + 130, '08:14', 64, { fontStyle: 'bold' }).setOrigin(0.5),
        this.phoneText(CENTER_X, SCREEN.y + 180, 'Erster Vorlesungstag', 16, { color: PH.inkSoft }).setOrigin(0.5),
        this.phoneText(CENTER_X, SCREEN.y + 430, 'Kein WLAN · Akku 12 %', 14, { color: PH.inkSoft }).setOrigin(0.5)
      ]);
    }

    /** Links die Checkliste, rechts Belohnung, Fehler und Steuerung. */
    createSidePanels() {
      const left = SIDE.leftX + SIDE.pad;
      SS.UI.panel(this, SIDE.leftX, SIDE.y, SIDE.w, SIDE.h, { alpha: 0.85 }).setDepth(DEPTH.panel);
      this.sideLabel(left, SIDE.y + 14, 'CHECKLISTE');
      this.checklist = STEPS.map((step, i) => SS.UI.text(this, left, SIDE.y + 44 + i * 27, '', 'body', { fontSize: '15px' })
        .setDepth(DEPTH.panel));

      const right = SIDE.rightX + SIDE.pad;
      SS.UI.panel(this, SIDE.rightX, SIDE.y, SIDE.w, SIDE.h, { alpha: 0.85 }).setDepth(DEPTH.panel);
      this.sideLabel(right, SIDE.y + 14, 'BELOHNUNG');
      this.ectsText = SS.UI.text(this, right, SIDE.y + 34, '', 'h2', { color: C.CSS.yellow }).setDepth(DEPTH.panel);
      this.mistakeText = SS.UI.text(this, right, SIDE.y + 76, '', 'body', { fontSize: '16px' }).setDepth(DEPTH.panel);
      this.penaltyText = SS.UI.text(this, right, SIDE.y + 100, '', 'body', { fontSize: '16px' }).setDepth(DEPTH.panel);
      this.add.rectangle(right, SIDE.y + 134, SIDE.w - 2 * SIDE.pad, 1, C.COLORS.panelLine).setOrigin(0).setDepth(DEPTH.panel);
      this.sideLabel(right, SIDE.y + 146, 'STEUERUNG');
      this.helpText = SS.UI.text(this, right, SIDE.y + 168, '', 'body', { fontSize: '15px', color: C.CSS.inkSoft })
        .setDepth(DEPTH.panel);
      this.updateSidePanels();
    }

    sideLabel(x, y, str) {
      return SS.UI.text(this, x, y, str, 'small', { fontSize: '13px', fontStyle: 'bold', color: C.CSS.yellow })
        .setDepth(DEPTH.panel);
    }

    updateSidePanels() {
      STEPS.forEach((step, i) => {
        const done = i < this.completed;
        const current = i === this.stepIndex && !done;
        const mark = done ? '✔' : (current ? '▸' : '○');
        this.checklist[i].setText(`${mark}  ${step.checklist}`)
          .setColor(done ? C.CSS.green : (current ? '#ffffff' : C.CSS.inkSoft))
          .setFontStyle(current ? 'bold' : '')
          .setAlpha(done || current ? 1 : 0.7);
      });
      this.ectsText.setText(this.currentReward() + ' ECTS');
      this.mistakeText.setText('Fehlversuche: ' + this.mistakes);
      this.penaltyText.setText('Zeitstrafe: ' + this.penaltyMs / 1000 + ' s')
        .setColor(this.penaltyMs > 0 ? C.CSS.danger : '#ffffff');
      const step = this.currentStep();
      this.helpText.setText(HELP[step ? step.type : 'choice']);
    }

    currentReward() {
      if (this.timedOut) return 0;
      return this.mistakes <= MAX_MISTAKES_FOR_FULL ? ECTS_FULL : ECTS_REDUCED;
    }

    // ── Ablauf ───────────────────────────────────────────────────

    startGameplay() {
      this.timer = SS.UI.timerBar(this, TIMER.x, TIMER.y, TIMER.w, TIMER.h, TOTAL_MS, {
        color: C.COLORS.cyan,
        onDone: () => this.onTimeUp()
      });
      SS.UI.text(this, TIMER.x - 12, TIMER.y + TIMER.h / 2, 'Vorlesung in', 'hud', { fontSize: '16px' }).setOrigin(1, 0.5);
      this.showStep(0);
    }

    currentStep() {
      return (this.steps && this.steps[this.stepIndex]) || null;
    }

    showStep(index) {
      this.stepIndex = index;
      const step = this.currentStep();
      this.hideNotification();
      this.clearContent();
      const top = this.renderHeader(step);
      if (step.type === 'choice') this.renderChoices(step.options, top, this.content);
      else if (step.type === 'list') this.renderList(top);
      else this.renderCodeEntry(top);
      this.updateSidePanels();
      this.setBusy(false);
    }

    /** Richtige Antwort: Haken, kurze Pause, Lade-Animation, nächster Schritt. */
    completeStep() {
      this.setBusy(true);
      this.completed = this.stepIndex + 1;
      this.updateSidePanels();
      SS.Audio.sfx('checkpoint');
      const step = this.currentStep();
      this.time.delayedCall(SUCCESS_PAUSE_MS, () => this.showLoading(step, () => this.nextStep()));
    }

    nextStep() {
      if (this.stepIndex + 1 < this.steps.length) this.showStep(this.stepIndex + 1);
      else this.showConnected();
    }

    /** Sperrt Eingaben und hält dabei die Zeit an (Laden und Dialoge kosten keine Zeit). */
    setBusy(busy) {
      this.locked = busy;
      if (!this.timer || this.finished) return;
      if (busy) this.timer.pause();
      else this.timer.resume();
    }

    /** Verzögerter Aufruf, der nach Spielende verfällt. */
    later(ms, fn) {
      return this.time.delayedCall(ms, () => {
        if (!this.finished) fn();
      });
    }

    /** Die Pointe: verbunden – mit genau einem Balken. */
    showConnected() {
      this.finish();
      this.timer.stop();
      this.setWifiBars(1);
      const icon = this.createBigWifiIcon(0, PH.ok, PH.line);
      this.time.delayedCall(350, () => {
        this.redrawBigWifi(icon, 1, PH.ok, PH.line);
        this.tweens.add({ targets: icon, scale: { from: 1.25, to: 1 }, duration: 260, ease: 'Back.Out' });
        SS.Audio.sfx('portal');
      });
      this.addCenteredLines([
        { str: 'Verbunden ✔', size: 26, color: T.hex(PH.ok), bold: true, y: SCREEN.y + 246 },
        { str: 'eduroam', size: 15, color: PH.inkSoft, y: SCREEN.y + 278 },
        { str: 'Signal: 1 Balken', size: 20, bold: true, y: SCREEN.y + 306 },
        { str: 'Download: 0,3 MB/s – reicht für eine Folie pro Minute.', size: 13, color: PH.inkSoft, y: SCREEN.y + 342 }
      ]);
      SS.UI.confetti(this, CENTER_X, SCREEN.y + 120);
      this.time.delayedCall(900, () => this.notify(NOTES.cancelled, END_DELAY_MS));
      this.time.delayedCall(END_DELAY_MS, () => this.endQuest(true));
    }

    onTimeUp() {
      if (this.finished) return;
      this.timedOut = true;
      this.finish();
      this.updateSidePanels();
      this.clockText.setText('08:15');
      this.createBigWifiIcon(0, PH.ok, PH.muted);
      this.addCenteredLines([
        { str: 'Keine Verbindung', size: 24, color: T.hex(PH.bad), bold: true, y: SCREEN.y + 246 },
        { str: 'Die Vorlesung hat ohne dich angefangen.', size: 14, color: PH.inkSoft, y: SCREEN.y + 280 }
      ]);
      SS.Audio.sfx('buzz');
      SS.UI.shake(this, 250, 0.01);
      this.time.delayedCall(700, () => this.notify(NOTES.hotspot, TIMEOUT_DELAY_MS));
      this.time.delayedCall(TIMEOUT_DELAY_MS, () => this.endQuest(false));
    }

    /** Gemeinsames Spielende: Eingaben sperren, Handy-Inhalt leeren. */
    finish() {
      this.finished = true;
      this.locked = true;
      this.hideNotification();
      this.clearContent();
    }

    endQuest(success) {
      this.hideNotification();
      SS.SideQuest.outro(this, this.buildResult(success), { headline: success ? 'VERBUNDEN!' : 'KEIN NETZ' });
    }

    /** Ergebnis für SS.SideQuest.outro → { id, title, success, ects, message }. */
    buildResult(success) {
      return {
        id: QUEST.id,
        title: QUEST.title,
        success,
        ects: success ? this.currentReward() : 0,
        message: this.resultMessage(success)
      };
    }

    resultMessage(success) {
      if (!success) return RESULT_TEXT.timeout;
      if (this.choseInsecure) return RESULT_TEXT.insecure;
      if (this.mistakes > MAX_MISTAKES_FOR_FULL) return RESULT_TEXT.sloppy(this.mistakes);
      if (this.mistakes > 0) return RESULT_TEXT.good(this.mistakes);
      return RESULT_TEXT.perfect;
    }

    // ── Handy-Bildschirm: Inhalte ────────────────────────────────

    phoneText(x, y, str, size, extra) {
      return SS.UI.text(this, x, y, str, PHONE_TEXT, Object.assign({ fontSize: size + 'px' }, extra || {}));
    }

    clearContent() {
      this.rows.forEach((row) => this.tweens.killTweensOf(row.container));
      this.content.removeAll(true);
      this.rows = [];
      this.codeBoxes = [];
    }

    /** App-Titel, Schrittzähler, Frage und Hinweis; liefert die y-Position für die Antworten. */
    renderHeader(step) {
      const title = this.phoneText(CONTENT.x, APPBAR_Y, step.app, 21, { fontStyle: 'bold' }).setOrigin(0, 0.5);
      const counter = this.phoneText(CONTENT.x + CONTENT.w, APPBAR_Y, `Schritt ${this.stepIndex + 1}/${STEPS.length}`, 13, {
        color: PH.inkSoft
      }).setOrigin(1, 0.5);
      const line = this.add.rectangle(SCREEN.x, APPBAR_Y + 22, SCREEN.w, 1, PH.line).setOrigin(0);
      const prompt = this.phoneText(CONTENT.x, PROMPT_Y, step.prompt, 17, {
        fontStyle: 'bold', color: step.danger ? T.hex(PH.bad) : PH.ink, wordWrap: { width: CONTENT.w }
      });
      const hint = this.phoneText(CONTENT.x, prompt.y + prompt.height + 4, step.hint, 13, {
        color: PH.inkSoft, wordWrap: { width: CONTENT.w }
      });
      this.content.add([title, counter, line, prompt, hint]);
      return hint.y + hint.height + 14;
    }

    /** Legt Antwortzeilen ab `top` an und blendet sie gestaffelt ein. */
    renderChoices(options, top, parent) {
      this.rows = [];
      let y = top;
      options.forEach((option, i) => {
        const row = this.createOptionRow(option, i + 1, y);
        parent.add(row.container);
        this.rows.push(row);
        y += row.h + ROW.gap;
        row.container.setAlpha(0).setX(CONTENT.x + 18);
        this.tweens.add({ targets: row.container, alpha: 1, x: CONTENT.x, duration: 180, delay: i * 50, ease: 'Cubic.Out' });
      });
    }

    /** Eine Antwortzeile im Handy-Look: Nummer (= Taste), Text, optional WLAN-Stärke. */
    createOptionRow(option, number, y) {
      const w = CONTENT.w;
      const hasIcon = option.bars != null;
      const textWidth = w - ROW.textX - ROW.padRight - (hasIcon ? ROW.iconSpace : 0);
      const label = this.phoneText(ROW.textX, 0, option.label, 16, { wordWrap: { width: textWidth } });
      fitText(label, textWidth, ROW.maxLines, 12);
      const sub = option.sub ? this.phoneText(ROW.textX, 0, option.sub, 12, { color: PH.inkSoft }) : null;
      const textHeight = label.height + (sub ? sub.height + 1 : 0);
      const h = Math.max(ROW.minH, Math.ceil(textHeight) + 18);
      label.setY((h - textHeight) / 2);
      if (sub) sub.setY(label.y + label.height + 1);

      const bg = this.add.graphics();
      const badge = this.phoneText(ROW.badgeX, h / 2, String(number), 13, { fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5);
      const container = this.add.container(CONTENT.x, y, [bg, badge, label]);
      if (sub) container.add(sub);
      if (hasIcon) {
        const icon = this.add.graphics();
        drawWifiIcon(icon, w - 26, h / 2 + 7, 15, option.bars, PH.dark, PH.line);
        container.add(icon);
      }
      const zone = this.add.zone(0, 0, w, h).setOrigin(0).setInteractive({ useHandCursor: true });
      container.add(zone);

      const row = { option, number, container, bg, badge, label, w, h, hover: false, state: option.failed ? 'wrong' : 'idle' };
      zone.on('pointerover', () => { row.hover = true; this.drawRow(row); });
      zone.on('pointerout', () => { row.hover = false; this.drawRow(row); });
      zone.on('pointerdown', () => this.chooseRow(row));
      this.drawRow(row);
      return row;
    }

    drawRow(row) {
      const look = ROW_LOOK[row.state];
      const highlight = row.state === 'idle' && row.hover;
      const g = row.bg;
      g.clear();
      g.fillStyle(0x000000, 0.06);
      g.fillRoundedRect(0, 2, row.w, row.h, ROW.radius);
      g.fillStyle(highlight ? PH.hover : look.fill, 1);
      g.fillRoundedRect(0, 0, row.w, row.h, ROW.radius);
      g.lineStyle(2, highlight ? PH.accent : look.line, 1);
      g.strokeRoundedRect(0, 0, row.w, row.h, ROW.radius);
      g.fillStyle(look.badge, 1);
      g.fillCircle(ROW.badgeX, row.h / 2, 12);
      row.badge.setText(look.mark || String(row.number));
      row.label.setColor(row.state === 'wrong' ? PH.inkMuted : PH.ink);
    }

    // ── Schritt 3: lange Liste mit Seiten ────────────────────────

    renderList(top) {
      this.listPage = 0;
      this.listTop = top;
      this.listRows = this.add.container(0, 0);
      this.content.add(this.listRows);
      this.createPager();
      this.renderListPage();
    }

    pageCount() {
      return Math.ceil(this.currentStep().options.length / PAGE_SIZE);
    }

    renderListPage() {
      const first = this.listPage * PAGE_SIZE;
      this.rows.forEach((row) => this.tweens.killTweensOf(row.container));
      this.listRows.removeAll(true);
      this.renderChoices(this.currentStep().options.slice(first, first + PAGE_SIZE), this.listTop, this.listRows);
      this.pagerLabel.setText(`Seite ${this.listPage + 1} / ${this.pageCount()}`);
    }

    /** Blättert vor/zurück (am Ende geht es wieder von vorn los). */
    flipPage(direction) {
      if (this.locked) return;
      const count = this.pageCount();
      this.listPage = (this.listPage + direction + count) % count;
      SS.Audio.sfx('tick');
      this.renderListPage();
    }

    createPager() {
      const y = CONTENT_BOTTOM - 18;
      this.pagerLabel = this.phoneText(CENTER_X, y, '', 14, { color: PH.inkSoft }).setOrigin(0.5);
      this.content.add([
        this.pagerLabel,
        this.createPagerButton(CONTENT.x + 22, y, '‹', -1),
        this.createPagerButton(CONTENT.x + CONTENT.w - 22, y, '›', 1)
      ]);
    }

    createPagerButton(x, y, symbol, direction) {
      const g = this.add.graphics();
      g.fillStyle(PH.accent, 1);
      g.fillCircle(0, 0, 18);
      const label = this.phoneText(0, -2, symbol, 26, { fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5);
      const zone = this.add.zone(0, 0, 40, 40).setInteractive({ useHandCursor: true });
      zone.on('pointerdown', () => this.flipPage(direction));
      return this.add.container(x, y, [g, label, zone]);
    }

    // ── Schritt 5: Zwei-Faktor-Code ──────────────────────────────

    renderCodeEntry(top) {
      this.code = '';
      this.codeInput = '';
      this.createCodeBoxes(top);
      const keypadTop = top + CODE_BOX.h + 20;
      this.createKeypad(keypadTop);
      const resendY = keypadTop + (KEYPAD.keys.length / KEYPAD.cols - 1) * KEYPAD.stepY + KEYPAD.h + 22;
      const resend = this.phoneText(CENTER_X, resendY, 'Code erneut senden', 14, { color: T.hex(PH.accent) })
        .setOrigin(0.5).setInteractive({ useHandCursor: true });
      resend.on('pointerdown', () => this.resendCode());
      this.content.add(resend);
      this.later(450, () => this.sendCode());
    }

    createCodeBoxes(top) {
      const totalWidth = CODE_LENGTH * CODE_BOX.w + (CODE_LENGTH - 1) * CODE_BOX.gap;
      this.codeRow = this.add.container(0, 0);
      this.content.add(this.codeRow);
      for (let i = 0; i < CODE_LENGTH; i++) {
        const x = CENTER_X - totalWidth / 2 + i * (CODE_BOX.w + CODE_BOX.gap);
        const g = this.add.graphics();
        const digit = this.phoneText(CODE_BOX.w / 2, CODE_BOX.h / 2, '', 22, { fontStyle: 'bold' }).setOrigin(0.5);
        this.codeRow.add(this.add.container(x, top, [g, digit]));
        this.codeBoxes.push({ g, digit });
      }
      this.refreshCodeBoxes();
    }

    refreshCodeBoxes(lineColor) {
      this.codeBoxes.forEach((box, i) => {
        const filled = i < this.codeInput.length;
        const active = i === this.codeInput.length;
        const color = lineColor != null ? lineColor : (active ? PH.accent : (filled ? PH.dark : PH.line));
        box.g.clear();
        box.g.fillStyle(PH.card, 1);
        box.g.fillRoundedRect(0, 0, CODE_BOX.w, CODE_BOX.h, 8);
        box.g.lineStyle(2, color, 1);
        box.g.strokeRoundedRect(0, 0, CODE_BOX.w, CODE_BOX.h, 8);
        box.digit.setText(filled ? this.codeInput[i] : '');
      });
    }

    createKeypad(top) {
      const totalWidth = KEYPAD.cols * KEYPAD.w + (KEYPAD.cols - 1) * KEYPAD.gapX;
      KEYPAD.keys.forEach((key, i) => {
        const x = CENTER_X - totalWidth / 2 + (i % KEYPAD.cols) * (KEYPAD.w + KEYPAD.gapX);
        const y = top + Math.floor(i / KEYPAD.cols) * KEYPAD.stepY;
        this.content.add(this.createKeypadKey(key, x, y));
      });
    }

    createKeypadKey(key, x, y) {
      const isOk = key === 'OK';
      const g = this.add.graphics();
      g.fillStyle(0x000000, 0.08);
      g.fillRoundedRect(0, 2, KEYPAD.w, KEYPAD.h, 10);
      g.fillStyle(isOk ? PH.accent : PH.card, 1);
      g.fillRoundedRect(0, 0, KEYPAD.w, KEYPAD.h, 10);
      const label = this.phoneText(KEYPAD.w / 2, KEYPAD.h / 2, key, isOk ? 16 : 20, {
        fontStyle: 'bold', color: isOk ? '#ffffff' : PH.ink
      }).setOrigin(0.5);
      const zone = this.add.zone(0, 0, KEYPAD.w, KEYPAD.h).setOrigin(0).setInteractive({ useHandCursor: true });
      const button = this.add.container(x, y, [g, label, zone]);
      zone.on('pointerdown', () => {
        if (this.locked) return;
        this.tweens.add({ targets: button, y: y + 2, duration: 50, yoyo: true });
        this.handleCodeKey(KEYPAD_ALIASES[key] || key);
      });
      return button;
    }

    /** Neuer Code per Push-Nachricht – nur CODE_VISIBLE_MS lang sichtbar. */
    sendCode() {
      const step = this.currentStep();
      if (this.finished || !step || step.type !== 'code') return;
      this.code = randomCode(this.rng);
      this.notify({ app: 'Authenticator', color: PH.accent, text: 'Dein Anmeldecode:', big: formatCode(this.code) }, CODE_VISIBLE_MS);
    }

    resendCode() {
      if (this.locked) return;
      SS.Audio.sfx('click');
      this.sendCode();
    }

    handleCodeKey(key) {
      if (this.locked) return;
      if (/^[0-9]$/.test(key)) this.typeDigit(key);
      else if (key === 'Backspace') this.deleteDigit();
      else if (key === 'Enter') this.submitCode();
    }

    typeDigit(digit) {
      if (this.codeInput.length >= CODE_LENGTH) return;
      this.codeInput += digit;
      SS.Audio.sfx('type');
      this.refreshCodeBoxes();
      const box = this.codeBoxes[this.codeInput.length - 1];
      this.tweens.add({ targets: box.digit, scale: { from: 1.5, to: 1 }, duration: 140, ease: 'Back.Out' });
    }

    deleteDigit() {
      if (!this.codeInput.length) return;
      this.codeInput = this.codeInput.slice(0, -1);
      SS.Audio.sfx('type');
      this.refreshCodeBoxes();
    }

    submitCode() {
      if (this.codeInput.length < CODE_LENGTH) {       // unvollständig: Hinweis ohne Strafe
        SS.Audio.sfx('buzz');
        this.wiggle(this.codeRow, 0);
        return;
      }
      this.hideNotification();
      if (this.code && this.codeInput === this.code) {
        this.refreshCodeBoxes(PH.ok);
        this.completeStep();
        return;
      }
      this.refreshCodeBoxes(PH.bad);
      this.wiggle(this.codeRow, 0);
      this.registerMistake(PENALTY_MS);
      this.showAlert(WRONG_CODE_ALERT, ALERT_TIMING, () => {
        this.codeInput = '';
        this.refreshCodeBoxes();
        this.sendCode();
      });
    }

    // ── Eingabe ──────────────────────────────────────────────────

    /** Zentrale Tastatur-Verteilung (Ziffern, Pfeile, Backspace, Enter). */
    handleKey(event) {
      // Phaser 3.90 meldet bei mehreren Tastendrücken im selben Frame frühere Ereignisse
      // erneut (gleiches Event-Objekt) – deshalb jedes Ereignis nur einmal auswerten.
      if (event.repeat || this.seenKeyEvents.has(event)) return;
      this.seenKeyEvents.add(event);
      if (this.alertBox) {
        this.closeAlert();
        return;
      }
      if (this.locked) return;
      const step = this.currentStep();
      if (step.type === 'code') {
        this.handleCodeKey(event.key);
        return;
      }
      if (step.type === 'list' && PAGE_KEYS[event.key]) {
        this.flipPage(PAGE_KEYS[event.key]);
        return;
      }
      const row = this.rows[Number(event.key) - 1];
      if (row) this.chooseRow(row);
    }

    chooseRow(row) {
      if (this.locked || row.state !== 'idle') return;
      if (row.option.correct) this.answerCorrect(row);
      else if (row.option.security) this.answerInsecure(row);
      else this.answerWrong(row);
    }

    answerCorrect(row) {
      row.state = 'correct';
      this.drawRow(row);
      SS.UI.burst(this, CONTENT.x + ROW.badgeX, row.container.y + row.h / 2, {
        count: 16, speedMin: 60, speedMax: 220, gravityY: 0, lifespan: 500, scale: 1.2,
        tint: [PH.ok, 0xffffff, C.COLORS.yellow], depth: DEPTH.fx
      });
      this.completeStep();
    }

    answerWrong(row) {
      this.markFailed(row);
      this.registerMistake(PENALTY_MS);
      this.showAlert({ title: WRONG_ANSWER_TITLE, message: row.option.error }, ALERT_TIMING);
    }

    /** Sicherheitsfalle: höhere Strafe und eine kurze Erklärung (Man-in-the-Middle). */
    answerInsecure(row) {
      this.choseInsecure = true;
      this.markFailed(row);
      this.registerMistake(SECURITY_PENALTY_MS, 'buzz');
      this.showAlert(SECURITY_ALERT, SECURITY_ALERT_TIMING);
    }

    markFailed(row) {
      row.option.failed = true;        // bleibt beim Blättern in der Liste erhalten
      row.state = 'wrong';
      this.drawRow(row);
      this.wiggle(row.container, CONTENT.x);
    }

    // ── Rückmeldungen ────────────────────────────────────────────

    /** Fehler zählen: Zeitstrafe, Ton, Wackeln, roter Rahmen, „−5 s“ am Zeitbalken. */
    registerMistake(penaltyMs, sound) {
      const rewardBefore = this.currentReward();
      this.mistakes += 1;
      this.penaltyMs += penaltyMs;
      this.timer.addTime(-Math.min(penaltyMs, this.timer.getRemaining()));
      SS.Audio.sfx(sound || 'error');
      SS.UI.shake(this, 200, 0.008);
      this.flashScreenBorder();
      this.floatPenalty(penaltyMs);
      this.updateSidePanels();
      if (this.currentReward() < rewardBefore) {   // Belohnung gesunken: kurz „aufploppen“
        this.tweens.add({ targets: this.ectsText, scale: { from: 1.4, to: 1 }, duration: 300, ease: 'Back.Out' });
      }
    }

    wiggle(target, baseX) {
      this.tweens.killTweensOf(target);
      target.setAlpha(1).setX(baseX);
      this.tweens.add({
        targets: target, x: baseX + 7, duration: 45, yoyo: true, repeat: 2,
        onComplete: () => target.setX(baseX)
      });
    }

    flashScreenBorder() {
      const g = this.errorFlash;
      g.clear();
      g.lineStyle(5, PH.bad, 1);
      g.strokeRoundedRect(SCREEN.x + 2, SCREEN.y + 2, SCREEN.w - 4, SCREEN.h - 4, SCREEN.radius - 2);
      this.tweens.killTweensOf(g);
      g.setAlpha(1);
      this.tweens.add({ targets: g, alpha: 0, duration: 500, ease: 'Quad.In' });
    }

    floatPenalty(ms) {
      const text = SS.UI.text(this, TIMER.x + TIMER.w + 14, TIMER.y + TIMER.h / 2, '−' + ms / 1000 + ' s', 'hud', {
        color: C.CSS.danger
      }).setOrigin(0, 0.5).setDepth(DEPTH.fx);
      this.tweens.add({ targets: text, y: text.y + 28, alpha: 0, duration: 1100, ease: 'Cubic.In', onComplete: () => text.destroy() });
    }

    /**
     * Handy-Dialog über dem Bildschirm. Pausiert die Zeit, sperrt Eingaben und schließt
     * sich nach timing.autoCloseMs – per Klick/Taste schon nach timing.minMs.
     */
    showAlert(content, timing, onClose) {
      this.setBusy(true);
      const w = SCREEN.w - 44;
      const title = this.phoneText(0, 0, content.title, 17, {
        fontStyle: 'bold', color: T.hex(PH.bad), align: 'center', wordWrap: { width: w - 28 }
      }).setOrigin(0.5, 0);
      const message = this.phoneText(0, 0, content.message, 14, {
        align: 'center', lineSpacing: 2, wordWrap: { width: w - 32 }
      }).setOrigin(0.5, 0);
      const h = 18 + title.height + 8 + message.height + 16 + 44;
      title.setY(-h / 2 + 18);
      message.setY(title.y + title.height + 8);
      const buttonY = h / 2 - 44;
      const box = this.add.graphics();
      box.fillStyle(PH.card, 1);
      box.fillRoundedRect(-w / 2, -h / 2, w, h, 16);
      box.lineStyle(1, PH.line, 1);
      box.lineBetween(-w / 2, buttonY, w / 2, buttonY);
      const ok = this.phoneText(0, buttonY + 22, 'OK', 17, { fontStyle: 'bold', color: T.hex(PH.accent) }).setOrigin(0.5);
      const dialog = this.add.container(CENTER_X, SCREEN.y + SCREEN.h / 2, [box, title, message, ok]);

      const dim = this.add.graphics();
      dim.fillStyle(0x000000, 0.4);
      dim.fillRoundedRect(SCREEN.x, SCREEN.y, SCREEN.w, SCREEN.h, SCREEN.radius);
      const blocker = this.add.zone(SCREEN.x, SCREEN.y, SCREEN.w, SCREEN.h).setOrigin(0).setInteractive();
      blocker.on('pointerdown', () => this.closeAlert());
      const container = this.add.container(0, 0, [dim, blocker, dialog]).setDepth(DEPTH.alert);
      dialog.setScale(0.85).setAlpha(0);
      this.tweens.add({ targets: dialog, scale: 1, alpha: 1, duration: 170, ease: 'Back.Out' });

      this.alertBox = {
        container,
        onClose,
        closableAt: this.time.now + timing.minMs,
        autoClose: this.time.delayedCall(timing.autoCloseMs, () => this.closeAlert(true))
      };
    }

    closeAlert(force) {
      const alert = this.alertBox;
      if (!alert || (!force && this.time.now < alert.closableAt)) return;
      this.alertBox = null;
      alert.autoClose.remove(false);
      alert.container.destroy();
      this.setBusy(false);
      if (alert.onClose) alert.onClose();
    }

    /**
     * Lade-Animation im Handy („Profil wird installiert …“), danach onDone.
     * Mit Push-Nachricht wird maximal lange geladen, damit man sie lesen kann.
     */
    showLoading(step, onDone) {
      const note = step.loadingNote ? NOTES[step.loadingNote] : null;
      const duration = note ? LOADING_MS.max : this.rng.between(LOADING_MS.min, LOADING_MS.max);
      const top = SCREEN.y + 28;
      const bg = this.add.graphics();
      bg.fillStyle(PH.screen, 1);
      bg.fillRoundedRect(SCREEN.x, top, SCREEN.w, SCREEN.y + SCREEN.h - top, { tl: 0, tr: 0, bl: SCREEN.radius, br: SCREEN.radius });
      const spinner = this.add.image(CENTER_X, SCREEN.y + 200, 'edu_spinner');
      const label = this.phoneText(CENTER_X, SCREEN.y + 254, '', 16, { fontStyle: 'bold' }).setOrigin(0.5);
      const track = this.add.rectangle(CENTER_X - 80, SCREEN.y + 286, 160, 6, PH.line).setOrigin(0, 0.5);
      const bar = this.add.rectangle(CENTER_X - 80, SCREEN.y + 286, 160, 6, PH.accent).setOrigin(0, 0.5).setScale(0, 1);
      const overlay = this.add.container(0, 0, [bg, spinner, label, track, bar]).setDepth(DEPTH.overlay);
      this.tweens.add({ targets: spinner, angle: 360, duration: 800, repeat: -1 });
      this.tweens.add({ targets: bar, scaleX: 1, duration, ease: 'Sine.InOut' });
      const typing = this.typeText(label, step.loading);
      if (note) this.notify(note, duration);
      this.time.delayedCall(duration, () => {
        typing.remove(false);
        this.tweens.killTweensOf([spinner, bar]);
        overlay.destroy();
        onDone();
      });
    }

    /** Schreibt einen Text Zeichen für Zeichen (mit Tipp-Sound); liefert das TimerEvent. */
    typeText(textObj, str) {
      let shown = 0;
      return this.time.addEvent({
        delay: 22,
        repeat: Math.max(0, str.length - 1),
        callback: () => {
          shown += 1;
          textObj.setText(str.slice(0, shown));
          if (shown % 2 === 1) SS.Audio.sfx('type');
        }
      });
    }

    /** Push-Benachrichtigung oben im Handy; Antippen blendet sie aus. */
    notify(note, durationMs) {
      this.hideNotification();
      const w = SCREEN.w - 20;
      const appLine = this.phoneText(56, 10, note.app.toUpperCase() + ' · jetzt', 11, { color: PH.inkSoft });
      const text = this.phoneText(56, 27, note.text, 14, { fontStyle: 'bold', wordWrap: { width: w - 68 } });
      const big = note.big ? this.phoneText(56, text.y + text.height, note.big, 26, { fontStyle: 'bold', color: T.hex(PH.accent) }) : null;
      const last = big || text;
      const h = Math.max(58, last.y + last.height + 10);
      const g = this.add.graphics();
      g.fillStyle(0x000000, 0.22);
      g.fillRoundedRect(2, 4, w, h, 16);
      g.fillStyle(PH.card, 1);
      g.fillRoundedRect(0, 0, w, h, 16);
      g.fillStyle(note.color, 1);
      g.fillRoundedRect(12, 12, 34, 34, 9);
      const icon = this.phoneText(29, 29, note.app[0], 18, { fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5);
      const zone = this.add.zone(0, 0, w, h).setOrigin(0).setInteractive();
      zone.on('pointerdown', () => this.hideNotification());
      const y = SCREEN.y + 28;
      const children = big ? [g, icon, appLine, text, big, zone] : [g, icon, appLine, text, zone];
      const box = this.add.container(SCREEN.x + 10, y - 14, children).setDepth(DEPTH.notification).setAlpha(0);
      this.tweens.add({ targets: box, alpha: 1, y, duration: 200, ease: 'Cubic.Out' });
      SS.Audio.sfx('orb');
      this.notification = { box, hideEvent: this.time.delayedCall(durationMs || NOTIFY_MS, () => this.hideNotification()) };
    }

    hideNotification() {
      const note = this.notification;
      if (!note) return;
      this.notification = null;
      note.hideEvent.remove(false);
      this.tweens.add({ targets: note.box, alpha: 0, y: note.box.y - 14, duration: 160, onComplete: () => note.box.destroy() });
    }

    /** Großes WLAN-Symbol für die End-Bildschirme (in einem Container, damit es „poppen“ kann). */
    createBigWifiIcon(bars, onColor, offColor) {
      const icon = this.add.container(CENTER_X, SCREEN.y + 200, [this.add.graphics()]);
      this.content.add(icon);
      this.redrawBigWifi(icon, bars, onColor, offColor);
      return icon;
    }

    redrawBigWifi(icon, bars, onColor, offColor) {
      const g = icon.getAt(0);
      g.clear();
      drawWifiIcon(g, 0, 0, 66, bars, onColor, offColor);
    }

    addCenteredLines(lines) {
      lines.forEach((line) => {
        this.content.add(this.phoneText(CENTER_X, line.y, line.str, line.size, {
          color: line.color || PH.ink, fontStyle: line.bold ? 'bold' : '', align: 'center', wordWrap: { width: CONTENT.w }
        }).setOrigin(0.5, 0));
      });
    }

    // ── Debug ────────────────────────────────────────────────────

    /** Für Tests: aktueller Zustand inklusive richtiger Taste und 2FA-Code. */
    debugState() {
      const step = this.currentStep();
      const rows = this.rows || [];
      const correct = rows.find((row) => row.option.correct);
      return {
        phase: this.finished ? 'done' : (this.alertBox ? 'alert' : (this.locked ? 'busy' : 'input')),
        step: this.stepIndex + 1,
        stepId: step ? step.id : null,
        rows: rows.map((row) => ({
          key: String(row.number),
          label: row.option.label,
          state: row.state,
          x: Math.round(CONTENT.x + row.w / 2),
          y: Math.round(row.container.y + row.h / 2)
        })),
        correctKey: correct ? String(correct.number) : null,
        correctPage: step && step.type === 'list' ? Math.floor(step.options.findIndex((o) => o.correct) / PAGE_SIZE) : null,
        page: step && step.type === 'list' ? this.listPage : null,
        code: this.code,
        codeInput: this.codeInput,
        mistakes: this.mistakes,
        remainingMs: this.timer ? Math.round(this.timer.getRemaining()) : TOTAL_MS
      };
    }
  }

  SS.scenes.EduroamScene = EduroamScene;
})();

/*
 * MenuScene.js – Titelbildschirm im Geometry-Dash-Stil.
 *
 * Hintergrund (Klasse MenuBackdrop): Himmel in den Farben der Semester-Abschnitte,
 * scrollender Boden mit Kachelkanten, Stacheln und ein Würfel-Studi, der automatisch
 * darüberspringt – mit derselben Sprungphysik wie im Runner.
 * Vordergrund: Titel, Buttons, Bestleistungen und nach dem Übungsmodus ein Ergebnis-Toast.
 *
 * Start-Daten: { practiceResult? }  – Ergebnis einer Side Quest aus dem Übungsmodus.
 */
(function () {
  'use strict';
  const SS = globalThis.SS;
  const C = SS.CONFIG;
  const hex = SS.Textures.hex;

  // ── Layout ──────────────────────────────────────────────────
  const CX = C.WIDTH / 2;
  const GROUND_Y = C.GROUND_Y;              // Bodenoberkante wie im Runner
  const TITLE_Y = 96;
  const TITLE_MAX_W = 740;
  const SUBTITLE_Y = 156;
  const SPLASH_POS = { x: 655, y: 180 };
  const SPLASH_MAX_W = 190;
  const START_Y = 236;
  const SECONDARY_Y = 310;
  const STATS = { y: 350, w: 440, h: 90 };
  const TOAST_Y = 474;
  const FOOTER_Y = 562;
  const OVERLAY_W = 680;
  const OVERLAY_DEPTH = 1200;                // über Toasts (1000)
  const SECONDARY_COLOR = C.COLORS.dhbwGray;
  const MAX_ECTS = C.MAX_ECTS || 30;        // 12 Münzen + 18 aus Side Quests

  // ── Hintergrund-Animation ───────────────────────────────────
  const SCROLL_SPEED = C.SPEED.normal;      // px/s – wie im Runner
  const PATTERN_PARALLAX = 0.15;            // ferne Quadrate scrollen langsamer
  const SKYLINE_PARALLAX = 0.4;
  const SKYLINE_H = 120;
  const CUBE_X = 150;
  const CUBE_SIZE = 40;
  const CUBE_REST_Y = GROUND_Y - CUBE_SIZE / 2;
  const AIR_TIME = (2 * C.JUMP_V) / C.GRAVITY;        // ≈ 0,44 s in der Luft
  const SPIN_SPEED = 360 / AIR_TIME;                  // eine volle Drehung pro Sprung (°/s) – wie im Runner
  const JUMP_LEAD = (SCROLL_SPEED * AIR_TIME) / 2;    // Absprung so, dass der Scheitel über dem Stachel liegt
  const SPIKE_SIZE = 40;
  const MAX_SPIKES_PER_GROUP = 2;
  const SPIKE_GAP = { min: 320, max: 640 };
  const FIRST_SPIKE_IN = 160;
  const SKY_THEMES = ['campus', 'vorlesung', 'projekt', 'praxis']; // ohne Rot, damit die Buttons lesbar bleiben
  const SKY_CYCLE_MS = 6000;
  const SKY_FADE_MS = 1500;
  const MAX_FRAME_MS = 50;                  // lange Frames (z. B. nach Tab-Wechsel) nicht nachholen
  const DEPTH = { sky: -100, pattern: -90, skyline: -80, ground: -30, spikes: -20, cube: -10 };

  // ── Inhalte ─────────────────────────────────────────────────
  const SPLASHES = [
    `Jetzt mit ${MAX_ECTS} ECTS!`,
    'Nachklausur inklusive!',
    'Theorie trifft Praxis!',
    'Kaffee nicht enthalten!',
    'Jetzt auch kopfüber!',
    'Ohne Anwesenheitsliste!'
  ];
  const PRACTICE_QUESTS = [
    { key: 'EduroamScene', title: 'eduroam einrichten', hint: 'Zertifikat, Identität, Passwort – und dann klappt’s vielleicht.' },
    { key: 'WasserspenderScene', title: 'Wasserspender', hint: 'Sprudel oder still? Hauptsache, die Flasche wird voll.' },
    { key: 'KlausurScene', title: 'Klausur', hint: 'Fragen unter Zeitdruck – sonst wartet die Nachklausur.' },
    { key: 'PruefungScene', title: 'Mündliche Prüfung', hint: 'Der Endboss: Rückfragen zur Projektarbeit parieren.' }
  ];
  const NUMBER_KEYS = ['ONE', 'TWO', 'THREE', 'FOUR'];
  const HELP_TIP = 'Tipp: Jede Side Quest lässt sich vorher im Übungsmodus ausprobieren.';
  const HELP_SECTIONS = [
    {
      heading: 'Steuerung',
      lines: [
        'Springen: Leertaste, Klick oder ↑',
        'Gedrückt halten: springt bei jeder Landung sofort wieder ab',
        'Sprung-Pads katapultieren dich von selbst nach oben',
        'Orbs: in der Luft berühren und dabei springen',
        'Praxisphase-Portal: Die Schwerkraft dreht sich um – du läufst kopfüber. Das Theorie-Portal dreht sie zurück.',
        'Esc oder P: Pause · M: Ton an/aus'
      ]
    },
    {
      heading: 'Regeln',
      lines: [
        'Crash = durchgefallen: Nachklausur ab Anfang des Abschnitts',
        `${C.ATTEMPTS_PER_SECTION} Versuche pro Abschnitt – danach bist du exmatrikuliert`,
        'Münzen bringen ECTS, sicher sind sie aber erst am Checkpoint',
        'An jedem Checkpoint wartet eine Side Quest mit weiteren ECTS',
        `Ziel: ${MAX_ECTS} ECTS. Endboss ist die mündliche Projektarbeitsprüfung – bis 4,0 bestanden.`
      ]
    }
  ];

  // ── Texturen (Präfix ui_) ───────────────────────────────────
  // Würfel-Studi in DHBW-Rot mit Gesicht
  SS.Textures.register('ui_cube', CUBE_SIZE, CUBE_SIZE, (ctx, w, h) => {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = hex(C.COLORS.dhbwRed);
    ctx.fillRect(3, 3, w - 6, h - 6);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';   // Glanzkante
    ctx.fillRect(3, 3, w - 6, 5);
    ctx.fillStyle = '#ffffff';                     // Augen
    ctx.fillRect(9, 12, 8, 9);
    ctx.fillRect(23, 12, 8, 9);
    ctx.fillStyle = '#000000';
    ctx.fillRect(12, 15, 4, 5);
    ctx.fillRect(26, 15, 4, 5);
    ctx.fillRect(12, 27, 16, 3);                   // Mund
  });

  // Stachel: schwarze Silhouette mit weißer Kontur
  SS.Textures.register('ui_spike', SPIKE_SIZE, SPIKE_SIZE, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#34324a');
    grad.addColorStop(1, '#000000');
    ctx.beginPath();
    ctx.moveTo(3, h);
    ctx.lineTo(w / 2, 3);
    ctx.lineTo(w - 3, h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  // Bodenkachel (zwei Reihen): halbtransparent, damit die Himmelsfarbe durchscheint
  SS.Textures.register('ui_ground', 40, 80, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(0, 0, 25, 0.45)');
    grad.addColorStop(1, 'rgba(0, 0, 10, 0.8)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';  // Kachelkanten
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, 38);
    ctx.strokeRect(1, 41, w - 2, 38);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.fillRect(2, 2, w - 4, 5);
  });

  // Leuchtende Bodenkante: Mitte hell, Ränder blenden aus
  SS.Textures.register('ui_groundline', C.WIDTH, 4, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
    grad.addColorStop(0.5, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  });

  // Große, blasse Quadrate wie im Geometry-Dash-Hintergrund (kachelbar)
  SS.Textures.register('ui_bgsquares', 240, 240, (ctx) => {
    const squares = [[16, 20, 92], [138, 8, 64], [60, 136, 70], [160, 120, 96]];
    ctx.lineWidth = 2;
    for (const [x, y, size] of squares) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.fillRect(x, y, size, size);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
      ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
    }
  });

  // Campus-Silhouette: Gebäude mit Fenstern (kachelbar)
  SS.Textures.register('ui_skyline', 480, SKYLINE_H, (ctx, w, h) => {
    const buildings = [[0, 70, 62], [74, 44, 96], [124, 96, 58], [228, 34, 112], [270, 80, 76], [362, 54, 50], [424, 50, 88]];
    ctx.fillStyle = 'rgba(0, 0, 20, 0.28)';
    for (const [x, bw, bh] of buildings) ctx.fillRect(x, h - bh, bw, bh);
    ctx.fillStyle = 'rgba(255, 255, 220, 0.12)';       // Fenster
    for (const [x, bw, bh] of buildings) {
      for (let wy = h - bh + 10; wy < h - 12; wy += 16) {
        for (let wx = x + 8; wx < x + bw - 10; wx += 14) ctx.fillRect(wx, wy, 6, 8);
      }
    }
  });

  /**
   * Animierter Hintergrund: Himmel wechselt die Abschnittsfarben, Boden und Stacheln scrollen,
   * der Würfel-Studi springt automatisch. Reine Deko – keine Kollisionen.
   */
  class MenuBackdrop {
    constructor(scene) {
      this.scene = scene;
      this.themeIndex = 0;
      this.sky = this.addSky(SKY_THEMES[0]);
      this.pattern = scene.add.tileSprite(0, 0, C.WIDTH, GROUND_Y, 'ui_bgsquares').setOrigin(0).setDepth(DEPTH.pattern);
      this.skyline = scene.add.tileSprite(0, GROUND_Y - SKYLINE_H, C.WIDTH, SKYLINE_H, 'ui_skyline').setOrigin(0).setDepth(DEPTH.skyline);
      this.ground = scene.add.tileSprite(0, GROUND_Y, C.WIDTH, C.HEIGHT - GROUND_Y, 'ui_ground').setOrigin(0).setDepth(DEPTH.ground);
      scene.add.image(CX, GROUND_Y, 'ui_groundline').setDepth(DEPTH.ground);
      this.spikeGroups = [];
      this.nextSpikeIn = FIRST_SPIKE_IN;
      this.createCube();
      this.createParticles();
      scene.time.addEvent({ delay: SKY_CYCLE_MS, loop: true, callback: () => this.cycleSky() });
    }

    addSky(themeKey) {
      const theme = C.THEMES[themeKey];
      return SS.UI.background(this.scene, theme.top, theme.bottom, { depth: DEPTH.sky });
    }

    /** Blendet weich in die Farben des nächsten Abschnitts über. */
    cycleSky() {
      this.themeIndex = (this.themeIndex + 1) % SKY_THEMES.length;
      const oldSky = this.sky;
      this.sky = this.addSky(SKY_THEMES[this.themeIndex]).setAlpha(0);
      this.scene.tweens.add({ targets: this.sky, alpha: 1, duration: SKY_FADE_MS, onComplete: () => oldSky.destroy() });
    }

    createCube() {
      this.cube = this.scene.add.image(CUBE_X, CUBE_REST_Y, 'ui_cube').setDepth(DEPTH.cube);
      this.cubeVelocity = 0;
      this.cubeGrounded = true;
    }

    createParticles() {
      // Staubspur hinter dem Würfel – nur solange er auf dem Boden rutscht
      this.trail = this.scene.add.particles(0, 0, 'px', {
        speedX: { min: -260, max: -140 },
        speedY: { min: -50, max: -5 },
        lifespan: 320,
        scale: { start: 1.3, end: 0 },
        alpha: { start: 0.9, end: 0 },
        frequency: 28
      }).setDepth(DEPTH.cube - 1);
      this.trail.startFollow(this.cube, -CUBE_SIZE / 2 + 2, CUBE_SIZE / 2 - 3);

      // Leicht aufsteigende Lichtpunkte
      this.scene.add.particles(0, 0, 'dot', {
        x: { min: 0, max: C.WIDTH },
        y: { min: GROUND_Y - 60, max: GROUND_Y },
        speedX: { min: -40, max: -15 },
        speedY: { min: -45, max: -20 },
        lifespan: 7000,
        scale: { start: 0.5, end: 0.1 },
        alpha: { start: 0.35, end: 0 },
        frequency: 240,
        blendMode: 'ADD',
        advance: 7000
      }).setDepth(DEPTH.pattern + 1);
    }

    update(dt) {
      const dx = SCROLL_SPEED * dt;
      this.ground.tilePositionX += dx;
      this.skyline.tilePositionX += dx * SKYLINE_PARALLAX;
      this.pattern.tilePositionX += dx * PATTERN_PARALLAX;
      this.scrollSpikes(dx);
      this.autoJump();
      this.updateCube(dt);
    }

    scrollSpikes(dx) {
      this.nextSpikeIn -= dx;
      if (this.nextSpikeIn <= 0) this.spawnSpikeGroup();
      this.spikeGroups.forEach((group) => { group.container.x -= dx; });
      const first = this.spikeGroups[0];
      if (first && first.container.x + first.width < 0) {
        first.container.destroy();
        this.spikeGroups.shift();
      }
    }

    spawnSpikeGroup() {
      const count = Phaser.Math.Between(1, MAX_SPIKES_PER_GROUP);
      const spikes = [];
      for (let i = 0; i < count; i++) {
        spikes.push(this.scene.add.image(i * SPIKE_SIZE, 0, 'ui_spike').setOrigin(0, 1));
      }
      const container = this.scene.add.container(C.WIDTH + SPIKE_SIZE, GROUND_Y, spikes).setDepth(DEPTH.spikes);
      this.spikeGroups.push({ container, width: count * SPIKE_SIZE, jumped: false });
      this.nextSpikeIn = Phaser.Math.Between(SPIKE_GAP.min, SPIKE_GAP.max);
    }

    /** Springt ab, sobald die nächste Stachelgruppe nah genug ist (wie ein perfekter Spieler). */
    autoJump() {
      if (!this.cubeGrounded) return;
      const next = this.spikeGroups.find((group) => !group.jumped);
      if (!next) return;
      const distance = next.container.x + next.width / 2 - CUBE_X;
      if (distance <= JUMP_LEAD) {
        next.jumped = true;
        this.jump();
      }
    }

    jump() {
      this.cubeGrounded = false;
      this.cubeVelocity = -C.JUMP_V;
      this.trail.stop();
    }

    updateCube(dt) {
      if (this.cubeGrounded) return;
      this.cubeVelocity += C.GRAVITY * dt;
      this.cube.y += this.cubeVelocity * dt;
      this.cube.angle += SPIN_SPEED * dt;
      if (this.cube.y >= CUBE_REST_Y) this.land();
    }

    land() {
      this.cube.y = CUBE_REST_Y;
      this.cube.angle = Math.round(this.cube.angle / 90) * 90; // auf die nächste Seite einrasten
      this.cubeGrounded = true;
      this.cubeVelocity = 0;
      this.trail.start();
      SS.UI.burst(this.scene, CUBE_X, GROUND_Y, {
        count: 6, speedMin: 40, speedMax: 120, lifespan: 300, gravityY: 300, scale: 1,
        tint: [0xffffff], depth: DEPTH.cube - 1
      });
    }
  }

  class MenuScene extends Phaser.Scene {
    constructor() {
      super('MenuScene');
    }

    init(data) {
      this.practiceResult = (data && data.practiceResult) || null;
      this.overlay = null;
      this.leaving = false;
    }

    create() {
      this.backdrop = new MenuBackdrop(this);
      this.createTitle();
      this.createMainButtons();
      this.createStatsPanel();
      this.createFooter();
      SS.UI.onKey(this, 'ESC', () => this.closeOverlay());
      SS.Audio.music.play('menu');
      this.cameras.main.fadeIn(250, 0, 0, 0);
      if (this.practiceResult) this.showPracticeToast(this.practiceResult);
    }

    update(time, delta) {
      this.backdrop.update(Math.min(delta, MAX_FRAME_MS) / 1000);
    }

    // ── Aufbau ────────────────────────────────────────────────

    createTitle() {
      const title = SS.UI.text(this, CX, TITLE_Y, 'STUDIUMS-SIMULATOR', 'title', {
        fontSize: '58px',
        strokeThickness: 10,
        shadow: { offsetX: 0, offsetY: 6, color: '#6b000e', blur: 0, stroke: true, fill: true }
      }).setOrigin(0.5);
      if (title.width > TITLE_MAX_W) title.setScale(TITLE_MAX_W / title.width);
      const gradient = title.context.createLinearGradient(0, 0, 0, title.height);
      gradient.addColorStop(0, '#fff7b8');
      gradient.addColorStop(0.45, '#ffd400');
      gradient.addColorStop(1, '#ff8a00');
      title.setFill(gradient);

      const subtitle = SS.UI.text(this, CX, SUBTITLE_Y, 'Semester Dash · DHBW Edition', 'h2', {
        fontSize: '22px', strokeThickness: 5
      }).setOrigin(0.5);

      // Einflug, danach sanftes Schweben
      title.setAlpha(0).setY(TITLE_Y - 40);
      this.tweens.add({ targets: title, alpha: 1, y: TITLE_Y, duration: 450, ease: 'Back.Out' });
      this.tweens.add({ targets: title, y: TITLE_Y + 5, duration: 1600, delay: 450, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      subtitle.setAlpha(0);
      this.tweens.add({ targets: subtitle, alpha: 1, duration: 400, delay: 200 });
      this.createSplash();
    }

    /** Gelber, pulsierender Spruch schräg rechts unter dem Titel (zufällig pro Besuch). */
    createSplash() {
      const splash = SS.UI.text(this, SPLASH_POS.x, SPLASH_POS.y, Phaser.Utils.Array.GetRandom(SPLASHES), 'h2', {
        fontSize: '17px', color: C.CSS.yellow, strokeThickness: 4
      }).setOrigin(0.5).setAngle(-8);
      const baseScale = Math.min(1, SPLASH_MAX_W / splash.width);
      splash.setScale(baseScale);
      this.tweens.add({ targets: splash, scale: baseScale * 1.1, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    }

    createMainButtons() {
      const glow = this.add.image(CX, START_Y, 'glow').setDisplaySize(440, 140).setBlendMode('ADD').setAlpha(0.25);
      this.tweens.add({ targets: glow, alpha: 0.55, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.InOut' });

      this.mainButtons = [
        SS.UI.button(this, CX, START_Y, 'Semester starten', () => this.startSemester(), {
          width: 340, height: 64, fontSize: '26px', key: 'ENTER'
        }),
        SS.UI.button(this, CX - 145, SECONDARY_Y, 'Side Quests üben', () => this.openPracticeOverlay(), {
          width: 270, height: 50, fontSize: '19px', color: SECONDARY_COLOR
        }),
        SS.UI.button(this, CX + 145, SECONDARY_Y, 'Steuerung & Regeln', () => this.openHelpOverlay(), {
          width: 270, height: 50, fontSize: '19px', color: SECONDARY_COLOR
        })
      ];
      // gestaffelt von unten einblenden
      this.mainButtons.forEach((btn, i) => {
        const y = btn.y;
        btn.setAlpha(0).setY(y + 24);
        this.tweens.add({ targets: btn, alpha: 1, y, duration: 300, delay: 250 + i * 90, ease: 'Cubic.Out' });
      });
    }

    /** Bestleistungen aus dem Highscore (localStorage). */
    createStatsPanel() {
      const hs = SS.State.loadHighscore();
      const stats = [
        { label: 'Beste ECTS', value: `${hs.bestEcts}/${MAX_ECTS}` },
        { label: 'Bestnote', value: SS.State.formatGrade(hs.bestGrade) },
        { label: 'Durchläufe', value: String(hs.runs) },
        { label: 'Abschlüsse', value: String(hs.graduations) }
      ];
      const left = CX - STATS.w / 2;
      const cellW = STATS.w / stats.length;
      SS.UI.panel(this, left, STATS.y, STATS.w, STATS.h, { color: 0x000000, alpha: 0.45, lineColor: 0xffffff, radius: 12 });
      SS.UI.text(this, CX, STATS.y + 16, 'BESTLEISTUNG', 'small', { color: C.CSS.yellow, fontStyle: 'bold', fontSize: '13px' })
        .setOrigin(0.5);
      stats.forEach((stat, i) => {
        const x = left + cellW * (i + 0.5);
        SS.UI.text(this, x, STATS.y + 45, stat.value, 'h2').setOrigin(0.5);
        SS.UI.text(this, x, STATS.y + 72, stat.label, 'small', { fontSize: '14px' }).setOrigin(0.5);
      });
    }

    createFooter() {
      SS.UI.text(this, 24, FOOTER_Y, 'Enter: Semester starten  ·  M: Ton an/aus', 'small').setOrigin(0, 0.5);
      this.soundButton = SS.UI.button(this, C.WIDTH - 90, FOOTER_Y, soundLabel(), () => this.toggleSound(), {
        width: 140, height: 40, fontSize: '16px', color: SECONDARY_COLOR, key: 'M'
      });
    }

    showPracticeToast(result) {
      const title = result.title || result.id || 'Side Quest';
      const verdict = result.success ? 'bestanden' : 'nicht bestanden';
      const grade = typeof result.grade === 'number' ? ` · Note ${SS.State.formatGrade(result.grade)}` : '';
      SS.UI.toast(this, `Übung „${title}“: ${verdict}\n${result.ects | 0} ECTS${grade} (zählt nicht fürs Semester)`, {
        y: TOAST_Y, duration: 3200, bg: result.success ? 0x14532d : 0x7f1d1d
      });
    }

    // ── Aktionen ──────────────────────────────────────────────

    startSemester() {
      this.goTo('GameScene', { newRun: true });
    }

    /** Side Quest im Übungsmodus; fehlt die Szene (z. B. noch in Arbeit), gibt es nur einen Hinweis. */
    startPractice(sceneKey) {
      if (!this.scene.get(sceneKey)) {
        SS.UI.toast(this, 'Diese Side Quest gibt es noch nicht.', { y: 40, depth: OVERLAY_DEPTH + 1, bg: 0x7f1d1d });
        return;
      }
      this.goTo(sceneKey, { practice: true });
    }

    /** Szenenwechsel mit Abblende – nur einmal, auch bei Doppelklick. */
    goTo(sceneKey, data) {
      if (this.leaving) return;
      this.leaving = true;
      SS.UI.fadeToScene(this, sceneKey, data);
    }

    toggleSound() {
      SS.Audio.toggleMute();
      this.soundButton.setLabel(soundLabel());
    }

    // ── Overlays ──────────────────────────────────────────────

    openPracticeOverlay() {
      this.openOverlay('Side Quests üben', 420, (top, left) => {
        const items = [
          SS.UI.text(this, CX, top + 74, 'Übungsmodus: Ergebnisse zählen nicht fürs Semester. Tasten 1–4 starten direkt.', 'small')
            .setOrigin(0.5)
        ];
        PRACTICE_QUESTS.forEach((quest, i) => {
          const y = top + 124 + i * 62;
          items.push(...keyCap(this, left + 44, y, String(i + 1)));
          items.push(SS.UI.button(this, left + 196, y, quest.title, () => this.startPractice(quest.key), {
            width: 240, height: 48, fontSize: '18px', key: NUMBER_KEYS[i]
          }));
          items.push(SS.UI.text(this, left + 332, y, quest.hint, 'small', {
            fontSize: '15px', wordWrap: { width: OVERLAY_W - 360 }
          }).setOrigin(0, 0.5));
        });
        return items;
      });
    }

    openHelpOverlay() {
      const colW = (OVERLAY_W - 100) / 2;
      const height = 480;
      this.openOverlay('Steuerung & Regeln', height, (top, left) => {
        const items = [
          SS.UI.text(this, CX, top + height - 92, HELP_TIP, 'small', { color: C.CSS.yellow, fontSize: '15px' }).setOrigin(0.5)
        ];
        HELP_SECTIONS.forEach((section, col) => {
          const x = left + 36 + col * (colW + 28);
          let y = top + 70;
          items.push(SS.UI.text(this, x, y, section.heading.toUpperCase(), 'small', {
            color: C.CSS.yellow, fontStyle: 'bold', fontSize: '15px'
          }));
          y += 28;
          section.lines.forEach((line) => {
            const bullet = SS.UI.text(this, x, y, '•', 'body', { fontSize: '16px', color: C.CSS.dhbwRed });
            const text = SS.UI.text(this, x + 16, y, line, 'body', { fontSize: '16px', wordWrap: { width: colW - 16 } });
            items.push(bullet, text);
            y += text.height + 9;
          });
        });
        return items;
      });
    }

    /**
     * Modales Fenster über dem Menü. buildContent(top, left) liefert die Inhalte;
     * „Zurück“ oder Esc schließen es. Die Menü-Buttons werden solange versteckt –
     * unsichtbare Buttons reagieren in Phaser weder auf Klicks noch auf ihre Taste.
     */
    openOverlay(title, height, buildContent) {
      if (this.overlay || this.leaving) return;
      this.setMainButtonsVisible(false);
      const top = Math.round((C.HEIGHT - height) / 2);
      const left = (C.WIDTH - OVERLAY_W) / 2;
      const dim = this.add.rectangle(0, 0, C.WIDTH, C.HEIGHT, 0x000000, 0.6).setOrigin(0);
      const panel = SS.UI.panel(this, left, top, OVERLAY_W, height, { lineColor: C.COLORS.dhbwRed, lineWidth: 3 });
      const heading = SS.UI.text(this, CX, top + 36, title, 'h1', { fontSize: '30px' }).setOrigin(0.5);
      const back = SS.UI.button(this, CX, top + height - 40, 'Zurück', () => this.closeOverlay(), {
        width: 180, height: 44, fontSize: '19px', color: SECONDARY_COLOR
      });
      this.overlay = this.add.container(0, 0, [dim, panel, heading].concat(buildContent(top, left), [back]))
        .setDepth(OVERLAY_DEPTH)
        .setAlpha(0);
      this.overlay.y = 16;
      this.tweens.add({ targets: this.overlay, alpha: 1, y: 0, duration: 160, ease: 'Cubic.Out' });
    }

    closeOverlay() {
      if (!this.overlay) return;
      this.overlay.destroy();
      this.overlay = null;
      this.setMainButtonsVisible(true);
    }

    setMainButtonsVisible(visible) {
      this.mainButtons.forEach((btn) => btn.setVisible(visible));
    }
  }

  function soundLabel() {
    return SS.Audio.isMuted() ? 'Ton: aus' : 'Ton: an';
  }

  /** Kleine Tastenkappe, z. B. für die Ziffern 1–4. Gibt die Spielobjekte zurück. */
  function keyCap(scene, x, y, label) {
    const g = scene.add.graphics();
    g.fillStyle(0x000000, 0.5);
    g.fillRoundedRect(x - 14, y - 14, 28, 28, 6);
    g.lineStyle(2, 0xffffff, 0.7);
    g.strokeRoundedRect(x - 14, y - 14, 28, 28, 6);
    const txt = SS.UI.text(scene, x, y, label, 'mono', { fontSize: '16px', fontStyle: 'bold' }).setOrigin(0.5);
    return [g, txt];
  }

  SS.scenes.MenuScene = MenuScene;
})();

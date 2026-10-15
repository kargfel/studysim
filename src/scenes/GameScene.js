/*
 * GameScene.js – der Runner: ein Semester als Geometry-Dash-Level.
 *
 * Ablauf:  Banner + Countdown → Laufen → Crash (Nachklausur) oder Checkpoint
 *          → Side Quest → nächster Abschnitt … → GameOverScene
 *
 * Die Physik steckt komplett in SS.Physics (core/physics.js) und läuft hier in
 * festen Zeitschritten (SS.CONFIG.STEP) über einen Akkumulator. Diese Szene
 * kümmert sich nur um Eingabe, Darstellung, Effekte und den Spielablauf.
 * Die Welt kommt aus SS.Level.parse(SS.Levels.semester) – gerendert wird
 * alles, was das Level-Format kennt, egal wie lang das Level ist.
 *
 * Parallel läuft die HudScene, die jeden Frame getHudInfo() liest.
 * Die Texturen (Präfix rn_) werden am Ende der Datei angemeldet.
 */
(function () {
  'use strict';
  const SS = globalThis.SS;
  const C = SS.CONFIG;
  const T = C.TILE;
  const P = C.PLAYER_SIZE;

  // ── Kamera und Würfel ─────────────────────────────────────────
  const PLAYER_SCREEN_X = 220;        // Würfelmitte im Bild (px von links)
  const CUBE_SIZE = 40;               // gezeichnete Größe (die Hitbox ist PLAYER_SIZE)
  const SPIN_DEG_PER_S = 360 / 0.44;  // Drehung in der Luft: eine Umdrehung pro Sprung
  const SNAP_PER_S = 24;              // wie schnell der Würfel nach der Landung einrastet
  const MAX_FRAME_S = 0.05;           // lange Frames (z. B. Tab-Wechsel) nicht nachholen

  // ── Darstellung ───────────────────────────────────────────────
  const CULL_MARGIN = 2;              // Spalten links/rechts außerhalb des Bildes, die sichtbar bleiben
  const PARALLAX = { far: 0.12, near: 0.35 };
  const DEPTH = {
    sky: -100, far: -90, near: -80, ground: 0, beam: 1, flag: 2, block: 4, object: 5,
    portal: 6, trail: 7, player: 10, effect: 20, overlay: 1200
  };
  const TOAST_Y = 112;                // unterhalb der HUD-Zeile
  const COUNTDOWN_Y = 390;            // unterhalb des Banners

  // ── Zeiten des Ablaufs (ms) ───────────────────────────────────
  const COUNTDOWN = ['3', '2', '1', 'Los!'];
  const COUNTDOWN_STEP_MS = 450;
  const SECTION_BANNER_MS = 1900;
  const CRASH_BANNER_MS = 1700;
  const RESPAWN_DELAY_MS = 900;
  const GAME_OVER_DELAY_MS = 1300;
  const CHECKPOINT_DELAY_MS = 800;
  const THEME_FADE_MS = 900;

  /** Zustände der Szene – nur im Zustand RUNNING läuft die Physik. */
  const MODE = Object.freeze({
    COUNTDOWN: 'countdown',   // Würfel wartet am Abschnittsanfang
    RUNNING: 'running',       // Physik läuft
    CRASHED: 'crashed',       // Explosion, gleich Nachklausur oder Exmatrikulation
    CHECKPOINT: 'checkpoint', // Fahne erreicht, Side Quest läuft
    ENDED: 'ended'            // Wechsel zur GameOverScene
  });

  const PORTALS = {
    praxis:  { label: 'PRAXIS',  color: C.COLORS.orange,  message: 'PRAXISPHASE – alles steht Kopf' },
    theorie: { label: 'THEORIE', color: C.COLORS.cyan,    message: 'THEORIEPHASE' },
    fast:    { label: 'SCHNELL', color: C.COLORS.magenta, message: 'KLAUSURENPHASE – schneller!' },
    normal:  { label: 'NORMAL',  color: C.COLORS.green,   message: 'Normales Tempo – durchatmen' }
  };

  const SIDE_QUEST_NAMES = {
    EduroamScene: 'eduroam', WasserspenderScene: 'Wasserspender', KlausurScene: 'Klausur', PruefungScene: 'Prüfung'
  };

  // Hintergrund-Ebenen je Thema. Die Praxisphase zeigt das Büro – kopfüber.
  const BACKDROPS = {
    campus:    { far: 'rn_far_campus',    near: 'rn_near_campus' },
    vorlesung: { far: 'rn_far_vorlesung', near: 'rn_near_vorlesung' },
    klausur:   { far: 'rn_far_klausur',   near: 'rn_near_klausur' },
    projekt:   { far: 'rn_far_projekt',   near: 'rn_near_projekt' },
    praxis:    { far: 'rn_far_projekt',   near: 'rn_near_projekt', upsideDown: true }
  };

  // Maße der Texturen, die auch zum Platzieren gebraucht werden
  const PORTAL_TEX = { w: 64, h: 150, cx: 32, cy: 88, rx: 18, ry: 56, plateY: 2 };  // Schild oben, Oval darunter
  const FLAG_TEX = { w: 56, h: 120, poleX: 6 };
  const PAD_TEX = { w: 40, h: 14 };

  // ── kleine Helfer ─────────────────────────────────────────────

  /** Mischt zwei Farben (0xRRGGBB); t = 0 … 1. */
  function mixColor(a, b, t) {
    const channel = (shift) => {
      const from = (a >> shift) & 0xff;
      const to = (b >> shift) & 0xff;
      return Math.round(from + (to - from) * t);
    };
    return (channel(16) << 16) | (channel(8) << 8) | channel(0);
  }

  /** Dreht den Würfel weich auf das nächste Vielfache von 90° (nach der Landung). */
  function snapAngle(angle, dt) {
    const target = Math.round(angle / 90) * 90;
    return angle + (target - angle) * Math.min(1, SNAP_PER_S * dt);
  }

  /** x-Bereiche, in denen die Praxisphase gilt (Portal G bis T bzw. Abschnittsende). */
  function findPraxisRanges(world) {
    const ranges = [];
    let start = null;
    for (const t of world.triggers) {
      const endsPraxis = t.type === 'checkpoint' || (t.type === 'portal' && t.kind === 'theorie');
      if (t.type === 'portal' && t.kind === 'praxis' && start === null) start = t.x;
      else if (endsPraxis && start !== null) {
        ranges.push({ from: start, to: t.x });
        start = null;
      }
    }
    return ranges;
  }

  /** Welt für den God-Modus: Boden ohne Gruben, Decke am Bildrand, keine Stacheln. */
  function createGodWorld(world) {
    return Object.assign({}, world, {
      isSolid: (c, r) => r < 0 || r >= world.groundRow || world.isSolid(c, r),
      buckets: world.buckets.map((list) => list.filter((o) => o.type !== 'spike'))
    });
  }

  class GameScene extends Phaser.Scene {
    constructor() {
      super('GameScene');
    }

    /** data: {newRun = true, section = 0, god = false, timeScale = 1} */
    init(data) {
      const d = data || {};
      this.isNewRun = d.newRun !== false;
      this.startSectionIndex = Math.max(0, d.section | 0);
      this.god = !!d.god;
      this.timeScale = Math.max(0.1, Number(d.timeScale) || 1);
    }

    create() {
      this.world = SS.Level.parse(SS.Levels.semester);
      this.physicsWorld = this.god ? createGodWorld(this.world) : this.world;
      // Lage der Checkpoints auf dem Fortschrittsbalken (0–1), ohne den letzten
      this.sectionMarks = this.world.sections.slice(0, -1).map((s) => s.endX / this.world.levelWidth);
      this.prepareRunState();
      this.resetRuntimeState();

      this.createBackdrop();
      this.createLevelViews();
      this.createCube();
      this.createEffects();
      this.bindInput();
      this.bindSceneEvents();

      this.scene.launch('HudScene');
      this.startSection(this.currentSection().index, true);
    }

    // ═══ Aufbau ═════════════════════════════════════════════════

    prepareRunState() {
      if (this.isNewRun) SS.State.newRun();
      if (this.startSectionIndex > 0) {
        SS.State.jumpToSection(Math.min(this.startSectionIndex, this.world.sections.length - 1));
      }
    }

    /** Alles, was bei einem Neustart der Szene frisch sein muss. */
    resetRuntimeState() {
      this.mode = MODE.COUNTDOWN;
      this.player = null;
      this.prevPos = { x: 0, y: 0 };    // Position vor dem letzten Physik-Schritt (für weiche Darstellung)
      this.accumulator = 0;
      this.collectedCoins = new Set();  // Münz-IDs, die in diesem Versuch schon zählen
      this.waitForRelease = false;      // nach Pause/Side Quest erst loslassen, dann wieder springen
      this.themeKey = null;
      this.colors = { ground: 0x000000, line: 0xffffff };
      this.colorTween = null;
      this.visibleCols = { from: 0, to: -1 };
      this.phase = 'theorie';
      this.speedMode = 'normal';
    }

    createBackdrop() {
      this.skies = {};
      this.backdrops = {};
      Object.keys(C.THEMES).forEach((key) => {
        const theme = C.THEMES[key];
        this.skies[key] = SS.UI.background(this, theme.top, theme.bottom, { depth: DEPTH.sky }).setAlpha(0);
        this.backdrops[key] = this.createParallaxLayers(BACKDROPS[key] || BACKDROPS.campus);
      });
      this.ground = this.add.graphics().setDepth(DEPTH.ground);
    }

    /** Zwei Parallax-Ebenen; kopfüber hängen sie vom oberen Bildrand. */
    createParallaxLayers(art) {
      const layer = (key, depth) => {
        const height = this.textures.get(key).getSourceImage().height;
        return this.add.tileSprite(0, art.upsideDown ? 0 : C.GROUND_Y, C.WIDTH, height, key)
          .setOrigin(0, art.upsideDown ? 0 : 1)
          .setFlipY(!!art.upsideDown)
          .setScrollFactor(0)
          .setDepth(depth)
          .setAlpha(0);
      };
      return { far: layer(art.far, DEPTH.far), near: layer(art.near, DEPTH.near) };
    }

    /** Ein Sprite pro Level-Objekt, einsortiert nach Spalten (für das Culling). */
    createLevelViews() {
      const world = this.world;
      this.columns = Array.from({ length: world.cols }, () => []);
      this.coinViews = new Map();    // Münz-ID → Sprite
      this.objectViews = new Map();  // Pad-/Orb-/Portal-ID → Sprite (für Effekte)
      this.orbViews = [];
      this.flagViews = [];           // Abschnittsindex → Fahne
      const praxisRanges = findPraxisRanges(world);

      world.blocks.forEach((block) => this.addToColumn(block.col, this.createBlockView(block, praxisRanges)));
      world.objects.forEach((obj) => this.addToColumn(obj.col, this.createObjectView(obj)));
      world.portals.forEach((portal) => {
        this.createPortalView(portal).forEach((view) => this.addToColumn(portal.col, view));
      });
      world.checkpoints.forEach((cp) => {
        this.createCheckpointViews(cp).forEach((view) => this.addToColumn(cp.col, view));
      });
    }

    addToColumn(col, view) {
      if (!view) return;
      view.setVisible(false);
      const index = Phaser.Math.Clamp(col, 0, this.columns.length - 1);
      this.columns[index].push(view);
    }

    /** Blöcke tragen die Randfarbe ihres Themas (in der Praxisphase: Praxis-Thema). */
    createBlockView(block, praxisRanges) {
      const inPraxis = praxisRanges.some((r) => block.x >= r.from && block.x < r.to);
      const themeKey = inPraxis ? 'praxis' : this.world.sections[block.sectionIndex].theme;
      const theme = C.THEMES[themeKey] || C.THEMES.campus;
      return this.add.image(block.x, block.y, 'rn_block').setOrigin(0).setDepth(DEPTH.block).setTint(theme.line);
    }

    createObjectView(obj) {
      switch (obj.type) {
        case 'spike':
          return this.add.image(obj.x, obj.y, obj.dir === 1 ? 'rn_spike' : 'rn_spike_hang')
            .setOrigin(0).setDepth(DEPTH.object);
        case 'coin': {
          const coin = this.add.image(obj.x + T / 2, obj.y + T / 2, 'rn_coin').setDepth(DEPTH.object);
          this.coinViews.set(obj.id, coin);
          return coin;
        }
        case 'pad': {
          const onFloor = obj.dir === 1;
          const pad = this.add.image(obj.x, onFloor ? obj.y + T : obj.y, 'rn_pad')
            .setOrigin(0, onFloor ? 1 : 0).setFlipY(!onFloor).setDepth(DEPTH.object);
          this.objectViews.set(obj.id, pad);
          return pad;
        }
        case 'orb': {
          const orb = this.add.image(obj.x + T / 2, obj.y + T / 2, 'rn_orb').setDepth(DEPTH.object);
          this.objectViews.set(obj.id, orb);
          this.orbViews.push(orb);
          return orb;
        }
        default:
          return null; // unbekannter Objekttyp: nicht darstellen
      }
    }

    /**
     * Portal plus Lichtvorhang über die ganze Höhe: Portale wirken nur über x,
     * egal ob der Würfel am Boden oder an der Decke vorbeikommt.
     */
    createPortalView(portal) {
      const kind = PORTALS[portal.kind] ? portal.kind : 'normal';
      const color = PORTALS[kind].color;
      // Oval steht höchstens auf dem Boden und ragt nie aus dem Bild
      const centerY = Phaser.Math.Clamp(portal.y + T / 2, PORTAL_TEX.cy, C.GROUND_Y - (PORTAL_TEX.h - PORTAL_TEX.cy));
      const beam = this.add.image(portal.x, 0, 'rn_beam').setOrigin(0.5, 0)
        .setDisplaySize(18, C.GROUND_Y).setTint(color).setAlpha(0.45).setDepth(DEPTH.beam);
      const view = this.add.image(portal.x, centerY, 'rn_portal_' + kind)
        .setOrigin(0.5, PORTAL_TEX.cy / PORTAL_TEX.h).setDepth(DEPTH.portal);
      this.objectViews.set(portal.id, view);
      return [beam, view];
    }

    /** Fahne am Abschnittsende plus Schild, welche Side Quest dort wartet. */
    createCheckpointViews(cp) {
      const flag = this.add.image(cp.x, C.GROUND_Y, 'rn_flag')
        .setOrigin(FLAG_TEX.poleX / FLAG_TEX.w, 1).setDepth(DEPTH.flag);
      const name = SIDE_QUEST_NAMES[cp.sideQuest] || String(cp.sideQuest).replace(/Scene$/, '');
      const label = SS.UI.text(this, cp.x + 22, C.GROUND_Y - FLAG_TEX.h - 6, 'Side Quest\n' + name, 'small', {
        fontSize: '14px', fontStyle: 'bold', color: C.CSS.ink, align: 'center', stroke: '#000000', strokeThickness: 3
      }).setOrigin(0.5, 1).setDepth(DEPTH.flag);
      this.flagViews[cp.sectionIndex] = flag;
      return [flag, label];
    }

    createCube() {
      this.cube = this.add.image(0, 0, 'rn_cube').setDepth(DEPTH.player);
    }

    createEffects() {
      // Spur hinter dem Würfel, solange er auf dem Boden (bzw. an der Decke) rutscht
      this.trail = this.add.particles(0, 0, 'px', {
        lifespan: 320, frequency: 22,
        speedX: { min: -70, max: 0 }, speedY: { min: -25, max: 25 },
        scale: { start: 1.3, end: 0 }, alpha: { start: 0.85, end: 0 },
        tint: [0xffffff, C.COLORS.dhbwRed, C.COLORS.yellow],
        emitting: false
      }).setDepth(DEPTH.trail);
      this.trail.startFollow(this.cube, -P / 2, P / 2);

      // Staub bei Sprung und Landung, Funken bei Münzen und Pads
      this.dust = this.add.particles(0, 0, 'dot', {
        lifespan: 380, speed: { min: 30, max: 120 }, angle: { min: 0, max: 360 },
        scale: { start: 0.55, end: 0 }, alpha: { start: 0.75, end: 0 }, emitting: false
      }).setDepth(DEPTH.effect);
      this.sparks = this.add.particles(0, 0, 'spark', {
        lifespan: 520, speed: { min: 70, max: 220 }, angle: { min: 0, max: 360 },
        scale: { start: 0.9, end: 0 }, rotate: { min: 0, max: 360 },
        tint: [C.COLORS.yellow, 0xffffff], emitting: false
      }).setDepth(DEPTH.effect);
    }

    bindInput() {
      const keyboard = this.input.keyboard;
      this.jumpKeys = keyboard ? Object.values(keyboard.addKeys('SPACE,UP,W')) : [];
      SS.UI.onKey(this, 'ESC', () => this.openPause());
      SS.UI.onKey(this, 'P', () => this.openPause());
      SS.UI.onKey(this, 'M', () => SS.Audio.toggleMute());
    }

    bindSceneEvents() {
      this.events.on('resume', this.onResume, this);
      this.events.once('shutdown', () => {
        this.events.off('resume', this.onResume, this);
        this.scene.stop('HudScene');
      });
    }

    // ═══ Spielschleife ══════════════════════════════════════════

    update(time, delta) {
      if (this.mode === MODE.RUNNING) this.advancePhysics(delta);
      const pos = this.renderPosition();
      const cam = this.cameras.main;
      cam.scrollX = pos.x + P / 2 - PLAYER_SCREEN_X;   // Kamera folgt nur in x
      this.updateCube(pos, delta / 1000);
      this.updateCulling(cam.scrollX);
      this.drawGround(cam.scrollX);
      this.updateParallax(cam.scrollX);
      this.animateObjects(time);
    }

    /** Feste Physik-Schritte; timeScale > 1 rechnet mehrere Schritte pro Frame. */
    advancePhysics(deltaMs) {
      this.accumulator += Math.min(deltaMs / 1000, MAX_FRAME_S) * this.timeScale;
      const input = { jump: this.readJumpInput() };
      const events = [];
      while (this.accumulator >= C.STEP && this.mode === MODE.RUNNING) {
        this.accumulator -= C.STEP;
        this.prevPos.x = this.player.x;
        this.prevPos.y = this.player.y;
        events.length = 0;
        SS.Physics.step(this.player, this.physicsWorld, input, C.STEP, events);
        events.forEach((e) => this.handlePhysicsEvent(e));
      }
    }

    /** Gedrückt halten = Dauersprung (Leertaste, Pfeil hoch, W, Maus/Touch). */
    readJumpInput() {
      const held = this.jumpKeys.some((key) => key.isDown) || this.input.activePointer.isDown;
      if (this.waitForRelease) {
        if (held) return false;
        this.waitForRelease = false;
      }
      return held;
    }

    /** Zwischen zwei Physik-Schritten interpolieren – sieht bei jeder Bildrate flüssig aus. */
    renderPosition() {
      const p = this.player;
      if (!p) return { x: 0, y: 0 };
      const a = this.mode === MODE.RUNNING ? this.accumulator / C.STEP : 1;
      return {
        x: this.prevPos.x + (p.x - this.prevPos.x) * a,
        y: this.prevPos.y + (p.y - this.prevPos.y) * a
      };
    }

    handlePhysicsEvent(e) {
      switch (e.type) {
        case 'jump': this.onJump(); break;
        case 'land': this.puffDust(6); break;
        case 'pad': this.onPad(e.id); break;
        case 'orb': this.onOrb(e.id); break;
        case 'coin': this.onCoin(e.id); break;
        case 'portal': this.onPortal(e.kind, e.id); break;
        case 'checkpoint': this.onCheckpoint(e.sectionIndex); break;
        case 'death': this.onDeath(); break;
        default: break; // 'finish' liegt hinter dem letzten Checkpoint – nichts zu tun
      }
    }

    // ═══ Physik-Ereignisse ══════════════════════════════════════

    onJump() {
      SS.Audio.sfx('jump');
      this.puffDust(4);
    }

    onPad(id) {
      SS.Audio.sfx('pad');
      const pad = this.objectViews.get(id);
      if (!pad) return;
      const x = pad.x + T / 2;
      this.sparks.explode(10, x, pad.y);
      this.flashAt(x, pad.y, C.COLORS.yellow, 1.4);
      this.tweens.add({ targets: pad, scaleY: 1.7, duration: 90, yoyo: true });
    }

    onOrb(id) {
      SS.Audio.sfx('orb');
      const orb = this.objectViews.get(id);
      if (!orb) return;
      const ring = this.add.image(orb.x, orb.y, 'rn_orb').setDepth(DEPTH.effect);
      this.tweens.add({ targets: ring, scale: 2.4, alpha: 0, duration: 320, ease: 'Quad.Out', onComplete: () => ring.destroy() });
      this.flashAt(orb.x, orb.y, C.COLORS.yellow, 1.6);
    }

    onCoin(id) {
      if (this.collectedCoins.has(id)) return;   // jede Münze zählt nur einmal pro Versuch
      this.collectedCoins.add(id);
      SS.State.addEcts(C.ECTS_PER_COIN);
      SS.Audio.sfx('coin');
      const coin = this.coinViews.get(id);
      if (!coin) return;
      this.sparks.explode(12, coin.x, coin.y);
      this.floatText(coin.x, coin.y - 26, '+' + C.ECTS_PER_COIN + ' ECTS', C.CSS.yellow);
      this.tweens.add({ targets: coin, y: coin.y - 26, scale: 1.6, alpha: 0, duration: 280, ease: 'Quad.Out' });
    }

    /** Portale ändern Schwerkraft oder Tempo – angezeigt wird nur, was sich wirklich ändert. */
    onPortal(kind, id) {
      const info = PORTALS[kind] || PORTALS.normal;
      const p = this.player;
      const phase = p.gravityDir === -1 ? 'praxis' : 'theorie';
      const phaseChanged = phase !== this.phase;
      const speedChanged = p.speedMode !== this.speedMode;
      this.phase = phase;
      this.speedMode = p.speedMode;

      SS.Audio.sfx('portal');
      const view = this.objectViews.get(id);
      if (view) this.flashAt(view.x, view.y, info.color, 3);
      if (phaseChanged) this.setTheme(phase === 'praxis' ? 'praxis' : this.currentSection().theme);
      if (phaseChanged || speedChanged) {
        SS.UI.toast(this, info.message, { y: TOAST_Y, fontSize: '22px', color: SS.Textures.hex(info.color), duration: 1500 });
      }
    }

    onCheckpoint(sectionIndex) {
      if (this.mode !== MODE.RUNNING) return;
      this.mode = MODE.CHECKPOINT;
      this.setTrail(false);
      SS.Audio.sfx('checkpoint');
      this.celebrateCheckpoint(sectionIndex);
      this.time.delayedCall(CHECKPOINT_DELAY_MS, () => this.launchSideQuest(sectionIndex));
    }

    onDeath() {
      if (this.god) {
        this.reviveInGodMode();
        return;
      }
      this.mode = MODE.CRASHED;
      this.explodeCube();
      const result = SS.State.registerDeath();
      if (result.exhausted) {
        SS.UI.banner(this, 'EXMATRIKULIERT!', 'Drei Versuche verbraucht – das Prüfungsamt hat entschieden.', {
          color: C.COLORS.danger, duration: 0
        });
        this.endRun(SS.State.Outcome.EXMATRIKULIERT, GAME_OVER_DELAY_MS);
        return;
      }
      SS.UI.banner(this, 'DURCHGEFALLEN!', `Nachklausur – Versuch ${result.attempt} von ${C.ATTEMPTS_PER_SECTION}`, {
        color: C.COLORS.danger, duration: CRASH_BANNER_MS
      });
      this.time.delayedCall(RESPAWN_DELAY_MS, () => this.respawn());
    }

    /** God-Modus: statt zu sterben gegen die Schwerkraft aus dem Hindernis klettern. */
    reviveInGodMode() {
      const p = this.player;
      p.dead = false;
      p.deathReason = null;
      for (let i = 0; i < C.ROWS; i++) {
        const hits = SS.Physics.overlappingSolids(this.physicsWorld, p.x, p.y, P);
        if (!hits.length) break;
        const rows = hits.map((h) => h.r);
        p.y = p.gravityDir === 1 ? Math.min(...rows) * T - P : (Math.max(...rows) + 1) * T;
      }
      p.vy = 0;
      p.grounded = true;
    }

    // ═══ Spielablauf ════════════════════════════════════════════

    currentSection() {
      const sections = this.world.sections;
      return sections[Math.min(SS.State.run.sectionIndex, sections.length - 1)];
    }

    /** Abschnitt beginnen: Spieler an den Anfang, Thema, Musik, Banner, Countdown. */
    startSection(index, instantTheme) {
      const sec = this.world.sections[index];
      const theme = C.THEMES[sec.theme] || C.THEMES.campus;
      this.spawnPlayer(sec);
      this.setTheme(sec.theme, instantTheme);
      SS.Audio.music.play(sec.speed === 'fast' ? 'klausur' : 'run');
      SS.UI.banner(this, sec.title, sec.subtitle, { duration: SECTION_BANNER_MS, color: theme.accent });
      this.startCountdown();
    }

    spawnPlayer(sec) {
      this.player = SS.Physics.createPlayer({ x: sec.startX, triggerIdx: sec.startTriggerIdx, speedMode: sec.speed });
      this.prevPos = { x: this.player.x, y: this.player.y };
      this.accumulator = 0;
      this.phase = 'theorie';
      this.speedMode = this.player.speedMode;
      this.tweens.killTweensOf(this.cube);
      this.cube.setVisible(true).setAlpha(1).setScale(1).setAngle(0);
    }

    startCountdown() {
      this.mode = MODE.COUNTDOWN;
      COUNTDOWN.forEach((label, i) => {
        this.time.delayedCall(i * COUNTDOWN_STEP_MS, () => this.showCountdownStep(label, i === COUNTDOWN.length - 1));
      });
    }

    showCountdownStep(label, isLast) {
      SS.Audio.sfx(isLast ? 'coin' : 'tick');
      const txt = SS.UI.text(this, C.WIDTH / 2, COUNTDOWN_Y, label, 'title', {
        fontSize: isLast ? '64px' : '72px', color: isLast ? C.CSS.yellow : C.CSS.ink
      }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.overlay).setScale(1.8).setAlpha(0);
      this.tweens.add({ targets: txt, scale: 1, alpha: 1, duration: 180, ease: 'Back.Out' });
      this.tweens.add({
        targets: txt, scale: 0.8, alpha: 0, delay: COUNTDOWN_STEP_MS - 110, duration: 160,
        onComplete: () => txt.destroy()
      });
      if (isLast) {
        this.mode = MODE.RUNNING;
        this.accumulator = 0;
      }
    }

    respawn() {
      const sec = this.currentSection();
      this.resetSectionCoins(sec.index);
      this.spawnPlayer(sec);
      this.setTheme(sec.theme, false);
      this.cameras.main.fadeIn(250, 0, 0, 0);
      this.startCountdown();
    }

    /** Nach einem Crash sind die Münzen des Abschnitts wieder da (die ECTS setzt SS.State zurück). */
    resetSectionCoins(sectionIndex) {
      for (const coin of this.world.coins) {
        if (coin.sectionIndex !== sectionIndex || !this.collectedCoins.has(coin.id)) continue;
        this.collectedCoins.delete(coin.id);
        const view = this.coinViews.get(coin.id);
        this.tweens.killTweensOf(view);
        view.setPosition(coin.x + T / 2, coin.y + T / 2).setScale(1).setAlpha(1);
      }
    }

    launchSideQuest(sectionIndex) {
      const key = this.world.sections[sectionIndex].sideQuest;
      if (!this.scene.get(key)) {
        console.warn('[GameScene] Side Quest fehlt:', key);
        this.continueAfterSideQuest();
        return;
      }
      this.scene.pause();
      this.scene.launch(key, { sectionIndex });
    }

    /** Rückkehr aus der PauseScene oder einer Side Quest (data.sideQuestResult). */
    onResume(sys, data) {
      // Tasten, die während der Pause losgelassen wurden, sonst „hängen“ (Phantom-Sprung)
      if (this.input.keyboard) this.input.keyboard.resetKeys();
      this.waitForRelease = true;
      // Auch ohne Ergebnis weiter, falls eine Side Quest es vergisst – sonst stünde das Spiel.
      if ((data && data.sideQuestResult) || this.mode === MODE.CHECKPOINT) this.continueAfterSideQuest();
    }

    continueAfterSideQuest() {
      const next = SS.State.completeSection();
      if (next >= this.world.sections.length) {
        this.finishSemester();
        return;
      }
      this.startSection(next, false);
    }

    finishSemester() {
      const grade = SS.State.run.grade;
      const passed = grade !== null && grade <= C.PASS_GRADE;
      this.endRun(passed ? SS.State.Outcome.GRADUATED : SS.State.Outcome.FAILED, 300);
    }

    endRun(outcome, delayMs) {
      this.mode = MODE.ENDED;
      SS.State.finishRun(outcome);
      this.time.delayedCall(delayMs, () => SS.UI.fadeToScene(this, 'GameOverScene', { outcome }));
    }

    openPause() {
      if (this.mode === MODE.CHECKPOINT || this.mode === MODE.ENDED) return;
      this.scene.pause();
      this.scene.launch('PauseScene');
    }

    // ═══ Darstellung ════════════════════════════════════════════

    /** Würfel folgt der Physik: Drehung in der Luft, Einrasten am Boden, kopfüber gespiegelt. */
    updateCube(pos, dt) {
      if (this.mode !== MODE.RUNNING && this.mode !== MODE.COUNTDOWN) return;
      const p = this.player;
      const lift = ((CUBE_SIZE - P) / 2) * p.gravityDir; // gezeichneter Würfel sitzt bündig auf
      this.cube.setPosition(pos.x + P / 2, pos.y + P / 2 - lift);
      this.cube.setFlipY(p.gravityDir === -1);
      if (this.mode === MODE.RUNNING && !p.grounded) this.cube.angle += SPIN_DEG_PER_S * dt * p.gravityDir;
      else this.cube.angle = snapAngle(this.cube.angle, dt);
      this.trail.followOffset.set(-P / 2, (P / 2) * p.gravityDir);
      this.setTrail(this.mode === MODE.RUNNING && p.grounded);
    }

    setTrail(on) {
      if (on === this.trail.emitting) return;
      if (on) this.trail.start();
      else this.trail.stop();
    }

    /** Nur Spalten im Bild (plus Rand) sind sichtbar – so bleiben auch lange Level flüssig. */
    updateCulling(scrollX) {
      const from = Math.max(0, Math.floor(scrollX / T) - CULL_MARGIN);
      const to = Math.min(this.columns.length - 1, Math.floor((scrollX + C.WIDTH) / T) + CULL_MARGIN);
      const old = this.visibleCols;
      if (from === old.from && to === old.to) return;
      for (let c = old.from; c <= old.to; c++) {
        if (c < from || c > to) this.setColumnVisible(c, false);
      }
      for (let c = from; c <= to; c++) {
        if (c < old.from || c > old.to) this.setColumnVisible(c, true);
      }
      this.visibleCols = { from, to };
    }

    setColumnVisible(col, visible) {
      for (const view of this.columns[col]) view.setVisible(visible);
    }

    /** Boden jeden Frame neu zeichnen: nur sichtbare Spalten, Gruben bleiben frei. */
    drawGround(scrollX) {
      const g = this.ground;
      const world = this.world;
      const { ground, line } = this.colors;
      const depth = C.HEIGHT - C.GROUND_Y;
      const first = Math.floor(scrollX / T) - 1;
      const last = first + Math.ceil(C.WIDTH / T) + 2;
      g.clear();
      for (let c = first; c <= last; c++) {
        if (world.isPit(c)) continue;
        const x = c * T;
        g.fillStyle(ground, 1).fillRect(x, C.GROUND_Y, T, depth);
        g.fillStyle(0x000000, 0.25).fillRect(x, C.GROUND_Y + T, T, depth - T);    // unten dunkler
        g.lineStyle(1, line, 0.16).strokeRect(x + 6, C.GROUND_Y + 10, T - 12, T - 14);
        g.fillStyle(line, 0.22).fillRect(x, C.GROUND_Y + 3, T, 6);                // Leuchten
        g.fillStyle(line, 1).fillRect(x, C.GROUND_Y, T, 3);                       // Bodenkante
        if (world.isPit(c - 1)) g.fillRect(x, C.GROUND_Y, 3, depth);              // Grubenränder
        if (world.isPit(c + 1)) g.fillRect(x + T - 3, C.GROUND_Y, 3, depth);
      }
    }

    updateParallax(scrollX) {
      Object.values(this.backdrops).forEach((set) => {
        if (set.far.alpha <= 0) return;   // ausgeblendete Ebenen nicht bewegen
        set.far.tilePositionX = scrollX * PARALLAX.far;
        set.near.tilePositionX = scrollX * PARALLAX.near;
      });
    }

    /** Münzen drehen sich, Orbs pulsieren. */
    animateObjects(time) {
      const spin = 0.3 + 0.7 * Math.abs(Math.cos(time / 280));
      this.coinViews.forEach((coin, id) => {
        if (coin.visible && !this.collectedCoins.has(id)) coin.scaleX = spin;
      });
      const pulse = 1 + 0.08 * Math.sin(time / 130);
      this.orbViews.forEach((orb) => { if (orb.visible) orb.setScale(pulse); });
    }

    // ═══ Thema (Farben, Himmel, Parallax) ═══════════════════════

    /** Weicher Wechsel auf ein Thema aus SS.CONFIG.THEMES (auch 'praxis'). */
    setTheme(key, instant) {
      const themeKey = C.THEMES[key] ? key : 'campus';
      if (themeKey === this.themeKey) return;
      const previous = this.themeKey;
      this.themeKey = themeKey;
      const duration = instant || !previous ? 0 : THEME_FADE_MS;
      this.fadeSky(this.skies[previous], this.skies[themeKey], duration);
      this.fadeLayers(this.backdrops[previous], this.backdrops[themeKey], duration);
      this.fadeColors(C.THEMES[themeKey], duration);
    }

    /** Neuer Himmel wird über dem alten eingeblendet (kein Flackern). */
    fadeSky(prev, next, duration) {
      Object.values(this.skies).forEach((sky) => {
        this.tweens.killTweensOf(sky);
        sky.setDepth(DEPTH.sky);
        if (sky !== prev) sky.setAlpha(0);
      });
      next.setDepth(DEPTH.sky + 1);
      if (!duration || !prev) {
        next.setAlpha(1);
        if (prev) prev.setAlpha(0);
        return;
      }
      prev.setAlpha(1);
      this.tweens.add({ targets: next, alpha: 1, duration, onComplete: () => prev.setAlpha(0) });
    }

    /** Alte Ebenen aus-, neue einblenden (beide Ebenen eines Themas gemeinsam). */
    fadeLayers(prev, next, duration) {
      const layersOf = (set) => [set.far, set.near];
      Object.values(this.backdrops).forEach((set) => {
        this.tweens.killTweensOf(layersOf(set));
        if (set !== prev && set !== next) layersOf(set).forEach((layer) => layer.setAlpha(0));
      });
      if (!duration || !prev) {
        if (prev) layersOf(prev).forEach((layer) => layer.setAlpha(0));
        layersOf(next).forEach((layer) => layer.setAlpha(1));
        return;
      }
      this.tweens.add({ targets: layersOf(prev), alpha: 0, duration });
      this.tweens.add({ targets: layersOf(next), alpha: 1, duration });
    }

    /** Boden- und Linienfarbe gleiten zum neuen Thema. */
    fadeColors(theme, duration) {
      const from = { ground: this.colors.ground, line: this.colors.line };
      if (this.colorTween) this.colorTween.stop();
      if (!duration) {
        this.colors = { ground: theme.ground, line: theme.line };
        return;
      }
      this.colorTween = this.tweens.addCounter({
        from: 0, to: 1, duration,
        onUpdate: (tween) => {
          const t = tween.getValue();
          this.colors = { ground: mixColor(from.ground, theme.ground, t), line: mixColor(from.line, theme.line, t) };
        }
      });
    }

    // ═══ Effekte ════════════════════════════════════════════════

    puffDust(count) {
      const p = this.player;
      const footY = p.gravityDir === 1 ? p.y + P : p.y;
      this.dust.explode(count, p.x + P / 2, footY);
    }

    flashAt(x, y, color, scale) {
      const glow = this.add.image(x, y, 'glow').setTint(color).setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(DEPTH.effect).setScale(scale * 0.5);
      this.tweens.add({ targets: glow, scale: scale * 1.6, alpha: 0, duration: 360, ease: 'Quad.Out', onComplete: () => glow.destroy() });
    }

    floatText(x, y, str, color) {
      const txt = SS.UI.text(this, x, y, str, 'hud', { fontSize: '18px', color }).setOrigin(0.5).setDepth(DEPTH.effect);
      this.tweens.add({ targets: txt, y: y - 40, alpha: 0, duration: 750, ease: 'Quad.Out', onComplete: () => txt.destroy() });
    }

    explodeCube() {
      const x = this.cube.x;
      const y = Phaser.Math.Clamp(this.cube.y, 20, C.HEIGHT - 20);  // auch bei Gruben im Bild
      this.cube.setVisible(false);
      this.setTrail(false);
      SS.Audio.sfx('death');
      SS.UI.shake(this, 280, 0.014);
      SS.UI.burst(this, x, y, {
        count: 36, speedMax: 420, lifespan: 800, depth: DEPTH.effect,
        tint: [C.COLORS.dhbwRed, 0xffffff, C.COLORS.dhbwRedDark]
      });
      this.flashAt(x, y, C.COLORS.dhbwRed, 2.5);
    }

    /** Fahne wackelt, Konfetti, der Würfel macht einen Freudensprung. */
    celebrateCheckpoint(sectionIndex) {
      const flag = this.flagViews[sectionIndex];
      if (flag) {
        this.tweens.add({ targets: flag, scaleX: 1.25, scaleY: 1.1, duration: 140, yoyo: true, repeat: 1 });
        SS.UI.burst(this, flag.x + 22, flag.y - FLAG_TEX.h + 30, {
          count: 40, speedMin: 120, speedMax: 380, lifespan: 900, depth: DEPTH.effect,
          tint: [C.COLORS.dhbwRed, C.COLORS.yellow, C.COLORS.cyan, C.COLORS.green, 0xffffff]
        });
      }
      const dir = this.player.gravityDir;
      this.tweens.add({ targets: this.cube, y: this.cube.y - 36 * dir, duration: 240, yoyo: true, ease: 'Quad.Out' });
      this.tweens.add({ targets: this.cube, angle: this.cube.angle + 360 * dir, duration: 480 });
    }

    // ═══ Schnittstelle zur HudScene ═════════════════════════════

    /** Vertrag (docs/ARCHITECTURE.md) plus sectionCount, sectionMarks und debugLabel. */
    getHudInfo() {
      const run = SS.State.run;
      if (!this.world || !this.player) {
        return { progress: 0, sectionIndex: run.sectionIndex, sectionTitle: '', phaseLabel: 'Theoriephase', speedLabel: 'normal', attempt: run.attempt };
      }
      const p = this.player;
      const sec = this.currentSection();
      return {
        progress: Phaser.Math.Clamp((p.x + P / 2) / this.world.levelWidth, 0, 1),
        sectionIndex: sec.index,
        sectionCount: this.world.sections.length,
        sectionTitle: sec.title,
        phaseLabel: p.gravityDir === -1 ? 'Praxisphase' : 'Theoriephase',
        speedLabel: p.speedMode === 'fast' ? 'schnell' : 'normal',
        attempt: run.attempt,
        sectionMarks: this.sectionMarks,
        debugLabel: this.debugLabel()
      };
    }

    debugLabel() {
      const parts = [];
      if (this.god) parts.push('unverwundbar');
      if (this.timeScale !== 1) parts.push('Tempo ×' + this.timeScale);
      return parts.length ? 'DEBUG · ' + parts.join(' · ') : '';
    }
  }

  SS.scenes.GameScene = GameScene;

  // ═══ Texturen (Canvas-2D, werden von der BootScene erzeugt) ═════

  const TX = SS.Textures;
  const SHADE_FAR = 'rgba(6, 8, 30, 0.30)';     // Silhouetten nehmen so die Himmelsfarbe an
  const SHADE_NEAR = 'rgba(4, 4, 18, 0.46)';
  const LIGHT = 'rgba(255, 240, 190, 0.26)';     // erleuchtete Fenster
  const DISPLAY_FONT = '"Arial Black", "Arial Bold", Arial, sans-serif';

  /** Kleiner Zufallsgenerator mit festem Startwert – die Hintergründe sehen immer gleich aus. */
  function seeded(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function circle(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }

  function centeredText(ctx, str, x, y, font, color) {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(str, x, y);
  }

  // ── Würfel-Studi: DHBW-Rot, Brille, Rucksackgurt ──
  TX.register('rn_cube', CUBE_SIZE, CUBE_SIZE, (ctx, w, h) => {
    ctx.fillStyle = '#14060a';
    ctx.fillRect(0, 0, w, h);
    const body = ctx.createLinearGradient(0, 0, 0, h);
    body.addColorStop(0, '#ff3346');
    body.addColorStop(1, '#b80016');
    ctx.fillStyle = body;
    ctx.fillRect(2, 2, w - 4, h - 4);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 2;
    ctx.strokeRect(5, 5, w - 10, h - 10);
    // Rucksackgurt mit Schnalle
    ctx.fillStyle = '#3b3f46';
    ctx.fillRect(4, 2, 5, h - 4);
    ctx.fillStyle = '#ffd400';
    ctx.fillRect(3, 23, 7, 5);
    // Brille (Pupillen schauen nach vorn)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(13, 11, 10, 9);
    ctx.fillRect(26, 11, 10, 9);
    ctx.strokeStyle = '#111111';
    ctx.strokeRect(13, 11, 10, 9);
    ctx.strokeRect(26, 11, 10, 9);
    ctx.beginPath();
    ctx.moveTo(23, 14);
    ctx.lineTo(26, 14);
    ctx.stroke();
    ctx.fillStyle = '#111111';
    ctx.fillRect(19, 14, 3, 4);
    ctx.fillRect(32, 14, 3, 4);
    // Lächeln
    ctx.beginPath();
    ctx.arc(25, 25, 5, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  });

  // ── Block im GD-Look: dunkler Kern, heller Rand (wird je Thema eingefärbt) ──
  TX.register('rn_block', T, T, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    const core = ctx.createLinearGradient(0, 0, 0, h);
    core.addColorStop(0, '#4a4a4a');
    core.addColorStop(1, '#161616');
    ctx.fillStyle = core;
    ctx.fillRect(3, 3, w - 6, h - 6);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, w - 20, h - 20);
  });

  // ── Stachel als Deadline: Warndreieck mit Uhr ──
  function drawSpike(ctx, w, h, hanging) {
    const baseY = hanging ? 1 : h - 1;
    const tipY = hanging ? h - 2 : 2;
    ctx.beginPath();
    ctx.moveTo(2, baseY);
    ctx.lineTo(w / 2, tipY);
    ctx.lineTo(w - 2, baseY);
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, tipY, 0, baseY);
    fill.addColorStop(0, '#ff4d4d');
    fill.addColorStop(1, '#3a0008');
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    // kleine Uhr: die Deadline tickt
    const cx = w / 2;
    const cy = hanging ? 12 : h - 12;
    circle(ctx, cx, cy, 6);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#7a0010';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy - 4);
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + 3, cy + 1);
    ctx.stroke();
  }
  TX.register('rn_spike', T, T, (ctx, w, h) => drawSpike(ctx, w, h, false));
  TX.register('rn_spike_hang', T, T, (ctx, w, h) => drawSpike(ctx, w, h, true));

  // ── Jump-Pad (Decken-Pad = gespiegelt) ──
  TX.register('rn_pad', PAD_TEX.w, PAD_TEX.h, (ctx, w, h) => {
    ctx.beginPath();
    ctx.ellipse(w / 2, h, w / 2 - 3, h - 2, 0, Math.PI, Math.PI * 2);
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, 0, 0, h);
    fill.addColorStop(0, '#fff3a0');
    fill.addColorStop(1, '#f59e0b');
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  });

  // ── Sprung-Orb ──
  TX.register('rn_orb', T, T, (ctx, w) => {
    const c = w / 2;
    circle(ctx, c, c, 19);
    ctx.fillStyle = 'rgba(255, 212, 0, 0.22)';
    ctx.fill();
    circle(ctx, c, c, 13);
    ctx.fillStyle = 'rgba(255, 245, 157, 0.55)';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ffd400';
    ctx.stroke();
    circle(ctx, c, c, 5);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  });

  // ── ECTS-Münze ──
  TX.register('rn_coin', 36, 36, (ctx, w) => {
    const c = w / 2;
    circle(ctx, c, c, 17);
    ctx.fillStyle = '#a16207';
    ctx.fill();
    const face = ctx.createRadialGradient(c - 4, c - 5, 2, c, c, 15);
    face.addColorStop(0, '#fff7c2');
    face.addColorStop(1, '#f59e0b');
    circle(ctx, c, c, 14.5);
    ctx.fillStyle = face;
    ctx.fill();
    circle(ctx, c, c, 12);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1;
    ctx.stroke();
    centeredText(ctx, 'ECTS', c, c + 1, 'bold 9px ' + DISPLAY_FONT, '#7c2d12');
  });

  // ── Portale: Oval mit Symbol und Schild ──
  function chevron(ctx, x, y, size, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(-size / 2, -size);
    ctx.lineTo(size / 2, 0);
    ctx.lineTo(-size / 2, size);
    ctx.stroke();
    ctx.restore();
  }

  function drawPortal(ctx, kind) {
    const { w, cx, cy, rx, ry } = PORTAL_TEX;
    const info = PORTALS[kind];
    const color = TX.hex(info.color);
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx + 10, ry + 8, 0, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx - 5, ry - 6, 0, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.stroke();
    // Symbol: Pfeil hoch/runter = Schwerkraft, Doppelpfeil = schnell
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (kind === 'praxis') chevron(ctx, cx, cy + 4, 7, -Math.PI / 2);
    if (kind === 'theorie') chevron(ctx, cx, cy - 4, 7, Math.PI / 2);
    if (kind === 'fast') { chevron(ctx, cx - 5, cy, 7, 0); chevron(ctx, cx + 5, cy, 7, 0); }
    if (kind === 'normal') chevron(ctx, cx, cy, 7, 0);
    // Schild mit Beschriftung über dem Oval
    TX.roundRect(ctx, 3, PORTAL_TEX.plateY, w - 6, 20, 6);
    ctx.fillStyle = '#0b0b14';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
    centeredText(ctx, info.label, w / 2, PORTAL_TEX.plateY + 11, 'bold 10px ' + DISPLAY_FONT, '#ffffff');
  }
  Object.keys(PORTALS).forEach((kind) => {
    TX.register('rn_portal_' + kind, PORTAL_TEX.w, PORTAL_TEX.h, (ctx) => drawPortal(ctx, kind));
  });

  // Lichtvorhang hinter dem Portal (weiß, wird eingefärbt und gestreckt)
  TX.register('rn_beam', 16, 64, (ctx, w, h) => {
    const fade = ctx.createLinearGradient(0, 0, w, 0);
    fade.addColorStop(0, 'rgba(255, 255, 255, 0)');
    fade.addColorStop(0.5, 'rgba(255, 255, 255, 0.55)');
    fade.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, w, h);
  });

  // ── Checkpoint-Fahne: DHBW-Rot mit Haken ──
  TX.register('rn_flag', FLAG_TEX.w, FLAG_TEX.h, (ctx, w, h) => {
    const x = FLAG_TEX.poleX;
    ctx.fillStyle = '#e5e7eb';
    ctx.fillRect(x - 2, 8, 4, h - 8);
    circle(ctx, x, 7, 5);
    ctx.fillStyle = '#ffd400';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + 2, 12);
    ctx.quadraticCurveTo(28, 4, w - 2, 14);
    ctx.lineTo(w - 2, 44);
    ctx.quadraticCurveTo(28, 34, x + 2, 44);
    ctx.closePath();
    ctx.fillStyle = '#e2001a';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(21, 27);
    ctx.lineTo(27, 33);
    ctx.lineTo(39, 19);
    ctx.stroke();
    ctx.fillStyle = '#9ca3af';
    ctx.fillRect(0, h - 6, 14, 6);
  });

  // ── Parallax-Hintergründe (halbtransparente Silhouetten, kachelbar) ──

  function windowGrid(ctx, x, y, w, h, rand, litChance) {
    for (let wy = y; wy + 9 <= y + h; wy += 15) {
      for (let wx = x; wx + 7 <= x + w; wx += 12) {
        if (rand() < litChance) {
          ctx.fillStyle = LIGHT;
          ctx.fillRect(wx, wy, 7, 9);
        }
      }
    }
  }

  function skyline(ctx, w, h, rand, opts) {
    let x = 4;
    while (x < w - opts.minW) {
      const bw = Math.min(w - 4 - x, opts.minW + Math.floor(rand() * opts.varW));
      const bh = opts.minH + Math.floor(rand() * opts.varH);
      ctx.fillStyle = SHADE_FAR;
      ctx.fillRect(x, h - bh, bw, bh);
      if (rand() < 0.4) ctx.fillRect(x + bw / 2 - 1, h - bh - 18, 2, 18); // Antenne
      windowGrid(ctx, x + 6, h - bh + 10, bw - 12, bh - 16, rand, opts.lit);
      x += bw + 6 + Math.floor(rand() * 16);
    }
  }

  function tree(ctx, x, baseY, height) {
    ctx.fillStyle = SHADE_NEAR;
    ctx.fillRect(x - 3, baseY - height * 0.5, 6, height * 0.5);
    [[0, -0.75, 0.3], [-0.22, -0.55, 0.24], [0.22, -0.55, 0.24]].forEach(([dx, dy, r]) => {
      circle(ctx, x + dx * height, baseY + dy * height, r * height);
      ctx.fill();
    });
  }

  function lamp(ctx, x, baseY) {
    ctx.fillStyle = SHADE_NEAR;
    ctx.fillRect(x - 2, baseY - 74, 4, 74);
    ctx.fillRect(x - 2, baseY - 74, 14, 3);
    circle(ctx, x + 12, baseY - 68, 9);
    ctx.fillStyle = 'rgba(255, 236, 160, 0.25)';
    ctx.fill();
    circle(ctx, x + 12, baseY - 69, 3.5);
    ctx.fillStyle = 'rgba(255, 240, 190, 0.8)';
    ctx.fill();
  }

  // Campus: Gebäude im Hintergrund, vorne das Hauptgebäude mit DHBW-Schriftzug
  TX.register('rn_far_campus', 640, 250, (ctx, w, h) => {
    skyline(ctx, w, h, seeded(7), { minW: 56, varW: 64, minH: 90, varH: 140, lit: 0.35 });
  });

  TX.register('rn_near_campus', 1000, 170, (ctx, w, h) => {
    const bx = 330;
    const bw = 250;
    const top = h - 128;
    ctx.fillStyle = SHADE_NEAR;
    ctx.fillRect(bx, top, bw, h - top);
    ctx.fillRect(bx + 20, top - 14, bw - 40, 14);
    windowGrid(ctx, bx + 14, top + 54, bw - 28, 52, seeded(3), 0.55);
    TX.roundRect(ctx, bx + bw / 2 - 64, top + 10, 128, 34, 5);
    ctx.fillStyle = 'rgba(226, 0, 26, 0.92)';
    ctx.fill();
    centeredText(ctx, 'DHBW', bx + bw / 2, top + 28, 'bold 24px ' + DISPLAY_FONT, '#ffffff');
    ctx.fillStyle = 'rgba(255, 230, 160, 0.35)';
    ctx.fillRect(bx + bw / 2 - 18, h - 34, 36, 34);  // Eingang
    [50, 140, 230, 660, 760, 900].forEach((x, i) => tree(ctx, x, h, 56 + (i % 3) * 14));
    [290, 620, 960].forEach((x) => lamp(ctx, x, h));
  });

  // Hörsaal: Tafeln und Leinwand, vorne Sitzreihen mit Köpfen
  function chalkboard(ctx, x, y, w, h, lines) {
    ctx.fillStyle = 'rgba(14, 44, 32, 0.55)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 6;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.42)';
    ctx.font = '17px "Comic Sans MS", "Chalkboard SE", "Trebuchet MS", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    lines.forEach((line, i) => ctx.fillText(line, x + 14, y + 14 + i * 32));
  }

  TX.register('rn_far_vorlesung', 640, 250, (ctx, w, h) => {
    chalkboard(ctx, 24, 40, 250, 120, ['f(x) = x² + 2x', 'Σ ECTS = 30', 'klausurrelevant!']);
    chalkboard(ctx, 300, 40, 180, 120, ['O(n · log n)', '∫ Kaffee dt', '= Wissen']);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.fillRect(510, 30, 112, 80);
    centeredText(ctx, 'Noch Fragen?', 566, 70, 'bold 12px "Trebuchet MS", Arial, sans-serif', 'rgba(255, 255, 255, 0.5)');
    ctx.fillStyle = SHADE_FAR;
    ctx.fillRect(340, h - 70, 90, 70);  // Pult
  });

  TX.register('rn_near_vorlesung', 600, 150, (ctx, w, h) => {
    const rand = seeded(5);
    for (let row = 2; row >= 0; row--) {   // hinterste Reihe zuerst
      const deskY = h - 40 - row * 36;
      ctx.fillStyle = SHADE_NEAR;
      for (let x = 10; x + 30 < w; x += 40) {
        if (rand() < 0.7) {
          circle(ctx, x + 15, deskY - 10, 9);
          ctx.fill();
        }
        if (rand() < 0.08) {   // Meldung
          ctx.fillRect(x + 25, deskY - 36, 4, 28);
          circle(ctx, x + 27, deskY - 38, 4);
          ctx.fill();
        }
        if (rand() < 0.3) {    // aufgeklappter Laptop
          ctx.fillStyle = 'rgba(150, 220, 255, 0.35)';
          ctx.fillRect(x + 6, deskY - 4, 18, 4);
          ctx.fillStyle = SHADE_NEAR;
        }
      }
      ctx.fillRect(0, deskY, w, 14);
    }
  });

  // Prüfungsraum: Wanduhren, Schild, vorne Tische mit Klausurbögen
  function wallClock(ctx, x, y, r, hour, minute) {
    circle(ctx, x, y, r);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.stroke();
    const hand = (angle, length, width) => {
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.sin(angle) * length, y - Math.cos(angle) * length);
      ctx.stroke();
    };
    hand((hour % 12) / 12 * Math.PI * 2 + (minute / 60) * (Math.PI / 6), r * 0.5, 3);
    hand(minute / 60 * Math.PI * 2, r * 0.8, 2);
  }

  TX.register('rn_far_klausur', 640, 250, (ctx, w) => {
    for (let x = 24; x + 70 < w; x += 160) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
      ctx.fillRect(x, 46, 70, 150);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
      for (let y = 52; y < 196; y += 10) ctx.fillRect(x, y, 70, 3);  // Jalousie
    }
    wallClock(ctx, 150, 76, 30, 10, 50);
    wallClock(ctx, 470, 90, 24, 11, 58);
    // Schild oben an der Wand – weit weg von der Sprunghöhe
    TX.roundRect(ctx, 218, 6, 200, 34, 6);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fill();
    centeredText(ctx, 'RUHE – PRÜFUNG!', 318, 24, 'bold 16px ' + DISPLAY_FONT, 'rgba(255, 255, 255, 0.5)');
  });

  TX.register('rn_near_klausur', 560, 140, (ctx, w, h) => {
    for (let x = 16; x + 120 <= w; x += 140) {
      ctx.fillStyle = SHADE_NEAR;
      ctx.fillRect(x, h - 58, 104, 8);          // Tischplatte
      ctx.fillRect(x + 6, h - 50, 6, 50);
      ctx.fillRect(x + 92, h - 50, 6, 50);
      ctx.fillRect(x + 108, h - 90, 7, 90);     // Stuhllehne
      ctx.fillRect(x + 92, h - 36, 23, 6);
      circle(ctx, x + 70, h - 76, 11);          // Kopf über die Klausur gebeugt
      ctx.fill();
      ctx.fillRect(x + 62, h - 66, 30, 10);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.fillRect(x + 18, h - 62, 30, 4);      // Klausurbogen
    }
  });

  // Partnerunternehmen: Büro-Skyline, vorne Schreibtische mit Monitoren
  TX.register('rn_far_projekt', 640, 250, (ctx, w, h) => {
    skyline(ctx, w, h, seeded(13), { minW: 40, varW: 46, minH: 120, varH: 120, lit: 0.5 });
  });

  TX.register('rn_near_projekt', 600, 150, (ctx, w, h) => {
    const rand = seeded(21);
    for (let i = 0; i < 4; i++) {
      const x = 10 + i * 150;
      ctx.fillStyle = SHADE_NEAR;
      ctx.fillRect(x, h - 52, 130, 7);                 // Tisch
      ctx.fillRect(x + 6, h - 45, 6, 45);
      ctx.fillRect(x + 118, h - 45, 6, 45);
      ctx.fillRect(x + 26, h - 114, 78, 54);           // Monitor
      ctx.fillRect(x + 60, h - 60, 10, 8);
      ctx.fillStyle = 'rgba(125, 211, 252, 0.3)';
      ctx.fillRect(x + 30, h - 110, 70, 44);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      if (i % 2 === 0) {                               // Code
        for (let k = 0; k < 5; k++) ctx.fillRect(x + 35 + (k % 2) * 8, h - 104 + k * 8, 20 + rand() * 30, 3);
      } else {                                         // Diagramm
        for (let k = 0; k < 5; k++) {
          const bar = 8 + rand() * 26;
          ctx.fillRect(x + 36 + k * 12, h - 70 - bar, 8, bar);
        }
      }
      ctx.fillStyle = SHADE_NEAR;
      if (i % 2 === 0) {                               // Kaffeetasse
        ctx.fillRect(x + 108, h - 66, 12, 14);
      } else {                                         // Pflanze
        ctx.fillRect(x + 106, h - 64, 14, 12);
        circle(ctx, x + 113, h - 72, 9);
        ctx.fill();
      }
    }
  });
})();

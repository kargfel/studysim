/*
 * ui.js – wiederverwendbare UI-Bausteine für alle Szenen (Phaser 3).
 *
 * Alle Overlays (Banner, Toasts, Timer) setzen scrollFactor 0, damit sie
 * auch in der scrollenden GameScene fest im Bild bleiben.
 */
(function () {
  'use strict';
  const SS = (globalThis.SS = globalThis.SS || {});
  const C = SS.CONFIG;
  const F = C.FONTS;

  const TEXT = {
    title: { fontFamily: F.display, fontSize: '56px', color: '#ffffff', stroke: '#000000', strokeThickness: 8 },
    h1: { fontFamily: F.display, fontSize: '36px', color: '#ffffff', stroke: '#000000', strokeThickness: 6 },
    h2: { fontFamily: F.display, fontSize: '24px', color: '#ffffff', stroke: '#000000', strokeThickness: 4 },
    body: { fontFamily: F.body, fontSize: '20px', color: '#ffffff' },
    small: { fontFamily: F.body, fontSize: '15px', color: C.CSS.inkSoft },
    mono: { fontFamily: F.mono, fontSize: '18px', color: '#e5e7eb' },
    hud: { fontFamily: F.display, fontSize: '20px', color: '#ffffff', stroke: '#000000', strokeThickness: 4 },
    button: { fontFamily: F.display, fontSize: '22px', color: '#ffffff' }
  };

  function lighten(color, amount) {
    const a = amount == null ? 0.35 : amount;
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    const mix = (v) => Math.min(255, Math.round(v + (255 - v) * a));
    return (mix(r) << 16) | (mix(g) << 8) | mix(b);
  }

  /**
   * Hängt einen Tastatur-Handler an, der beim Beenden der Szene entfernt wird.
   * Phaser 3.90 meldet bei mehreren Tastendrücken im selben Frame frühere keydowns
   * erneut – deshalb wird jedes DOM-Ereignis pro Handler nur einmal weitergereicht.
   */
  function onKey(scene, keyName, handler) {
    if (!scene.input || !scene.input.keyboard) return () => {};
    const evt = 'keydown-' + keyName;
    const seen = new WeakSet();
    const once = (event) => {
      if (event && typeof event === 'object') {
        if (seen.has(event)) return;
        seen.add(event);
      }
      handler(event);
    };
    scene.input.keyboard.on(evt, once);
    const off = () => scene.input && scene.input.keyboard && scene.input.keyboard.off(evt, once);
    scene.events.once('shutdown', off);
    return off;
  }

  const UI = {
    TEXT,
    lighten,
    onKey,

    /** Text mit vordefiniertem Stil ('title', 'h1', 'h2', 'body', 'small', 'mono', 'hud'). */
    text(scene, x, y, str, styleName, overrides) {
      const base = typeof styleName === 'object' ? styleName : (TEXT[styleName] || TEXT.body);
      return scene.add.text(x, y, str, Object.assign({}, base, overrides || {}));
    },

    /** Vollbild-Verlauf als Hintergrund (funktioniert mit Canvas und WebGL). */
    background(scene, topColor, bottomColor, opts) {
      const o = opts || {};
      const key = `bg_${topColor.toString(16)}_${bottomColor.toString(16)}`;
      if (!scene.textures.exists(key)) {
        const tex = scene.textures.createCanvas(key, C.WIDTH, C.HEIGHT);
        const ctx = tex.getContext();
        const grad = ctx.createLinearGradient(0, 0, 0, C.HEIGHT);
        grad.addColorStop(0, SS.Textures.hex(topColor));
        grad.addColorStop(1, SS.Textures.hex(bottomColor));
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, C.WIDTH, C.HEIGHT);
        tex.refresh();
      }
      return scene.add.image(0, 0, key).setOrigin(0).setScrollFactor(0).setDepth(o.depth != null ? o.depth : -100);
    },

    /** Abgerundetes Panel; x/y = linke obere Ecke. */
    panel(scene, x, y, w, h, opts) {
      const o = opts || {};
      const g = scene.add.graphics();
      const radius = o.radius != null ? o.radius : 14;
      if (o.shadow !== false) {
        g.fillStyle(0x000000, 0.35);
        g.fillRoundedRect(x + 4, y + 6, w, h, radius);
      }
      g.fillStyle(o.color != null ? o.color : C.COLORS.panel, o.alpha != null ? o.alpha : 0.96);
      g.fillRoundedRect(x, y, w, h, radius);
      g.lineStyle(o.lineWidth || 2, o.lineColor != null ? o.lineColor : C.COLORS.panelLine, 1);
      g.strokeRoundedRect(x, y, w, h, radius);
      return g;
    },

    /**
     * Button (Container, Mittelpunkt x/y).
     * opts: width, height, color, fontSize, key ('ENTER', 'SPACE', 'ONE' …), disabled
     */
    button(scene, x, y, label, onClick, opts) {
      const o = opts || {};
      const w = o.width || 260;
      const h = o.height || 52;
      const color = o.color != null ? o.color : C.COLORS.dhbwRed;
      const container = scene.add.container(x, y);
      const g = scene.add.graphics();
      const txt = scene.add.text(0, 0, label, Object.assign({}, TEXT.button, {
        fontSize: o.fontSize || TEXT.button.fontSize,
        align: 'center',
        wordWrap: { width: w - 20 }
      })).setOrigin(0.5);
      const zone = scene.add.zone(0, 0, w, h).setInteractive({ useHandCursor: true });
      container.add([g, txt, zone]);
      container.setSize(w, h);

      let hover = false;
      let pressed = false;
      let enabled = !o.disabled;

      function draw() {
        g.clear();
        const fill = enabled ? color : 0x4b4b5a;
        g.fillStyle(0x000000, 0.35);
        g.fillRoundedRect(-w / 2 + 3, -h / 2 + 5, w, h, 12);
        g.fillStyle(fill, 1);
        g.fillRoundedRect(-w / 2, -h / 2, w, h, 12);
        g.lineStyle(3, hover && enabled ? 0xffffff : lighten(fill), 1);
        g.strokeRoundedRect(-w / 2, -h / 2, w, h, 12);
        txt.setAlpha(enabled ? 1 : 0.55);
      }

      function fire() {
        if (!enabled || !container.visible || !container.active) return;
        if (SS.Audio) SS.Audio.sfx('click');
        if (onClick) onClick(container);
      }

      zone.on('pointerover', () => {
        hover = true;
        draw();
        if (enabled) scene.tweens.add({ targets: container, scale: 1.05, duration: 90 });
      });
      zone.on('pointerout', () => {
        hover = false;
        pressed = false;
        draw();
        scene.tweens.add({ targets: container, scale: 1, duration: 90 });
      });
      zone.on('pointerdown', () => {
        if (!enabled) return;
        pressed = true;
        container.setScale(0.96);
      });
      zone.on('pointerup', () => {
        if (!pressed) return;
        pressed = false;
        container.setScale(hover ? 1.05 : 1);
        fire();
      });
      if (o.key) onKey(scene, o.key, fire);

      container.setEnabled = (value) => { enabled = !!value; draw(); return container; };
      container.isEnabled = () => enabled;
      container.setLabel = (value) => { txt.setText(value); return container; };
      container.labelText = txt;
      container.press = fire;
      draw();
      return container;
    },

    /** Kurzer Hinweis oben in der Mitte. */
    toast(scene, message, opts) {
      const o = opts || {};
      const y = o.y != null ? o.y : 96;
      const txt = scene.add.text(0, 0, message, Object.assign({}, TEXT.body, {
        fontSize: o.fontSize || '20px',
        color: o.color || '#ffffff',
        align: 'center',
        wordWrap: { width: 560 }
      })).setOrigin(0.5);
      const w = Math.max(200, txt.width + 40);
      const h = txt.height + 22;
      const g = scene.add.graphics();
      g.fillStyle(o.bg != null ? o.bg : 0x000000, 0.72);
      g.fillRoundedRect(-w / 2, -h / 2, w, h, 12);
      const container = scene.add.container(C.WIDTH / 2, y, [g, txt]).setDepth(o.depth || 1000);
      container.setScrollFactor(0, 0, true);
      container.setAlpha(0);
      scene.tweens.add({ targets: container, alpha: 1, y: y + 6, duration: 160 });
      scene.time.delayedCall(o.duration || 1600, () => {
        scene.tweens.add({ targets: container, alpha: 0, duration: 260, onComplete: () => container.destroy() });
      });
      return container;
    },

    /** Großes Banner in der Bildmitte, z. B. „DURCHGEFALLEN!“. */
    banner(scene, title, subtitle, opts) {
      const o = opts || {};
      const y = o.y != null ? o.y : 230;
      const band = scene.add.graphics();
      band.fillStyle(o.bg != null ? o.bg : 0x000000, o.bgAlpha != null ? o.bgAlpha : 0.7);
      band.fillRect(-C.WIDTH / 2, -70, C.WIDTH, 140);
      band.fillStyle(o.color != null ? o.color : C.COLORS.dhbwRed, 1);
      band.fillRect(-C.WIDTH / 2, -70, C.WIDTH, 5);
      band.fillRect(-C.WIDTH / 2, 65, C.WIDTH, 5);
      const t = scene.add.text(0, subtitle ? -18 : 0, title, Object.assign({}, TEXT.h1, {
        fontSize: o.fontSize || '44px',
        color: o.titleColor || '#ffffff'
      })).setOrigin(0.5);
      const children = [band, t];
      if (subtitle) {
        children.push(scene.add.text(0, 32, subtitle, Object.assign({}, TEXT.body, {
          fontSize: '20px', color: C.CSS.inkSoft, align: 'center', wordWrap: { width: 700 }
        })).setOrigin(0.5));
      }
      const container = scene.add.container(C.WIDTH / 2, y, children).setDepth(o.depth || 1100);
      container.setScrollFactor(0, 0, true);
      container.setScale(1, 0);
      scene.tweens.add({ targets: container, scaleY: 1, duration: 180, ease: 'Back.Out' });
      const duration = o.duration != null ? o.duration : 1400;
      if (duration > 0) {
        scene.time.delayedCall(duration, () => {
          scene.tweens.add({
            targets: container, scaleY: 0, alpha: 0, duration: 200,
            onComplete: () => { container.destroy(); if (o.onDone) o.onDone(); }
          });
        });
      }
      return container;
    },

    /**
     * Ablaufender Zeitbalken. Ruft onDone einmal auf, wenn die Zeit um ist.
     * @returns {{getRemaining():number, getFraction():number, addTime(ms:number):void, pause():void, resume():void, stop():void, destroy():void, isDone():boolean}}
     */
    timerBar(scene, x, y, w, h, durationMs, opts) {
      const o = opts || {};
      let remaining = durationMs;
      let paused = false;
      let done = false;
      const g = scene.add.graphics().setScrollFactor(0).setDepth(o.depth || 900);
      const label = o.showLabel === false ? null : scene.add.text(x + w / 2, y + h / 2, '', Object.assign({}, TEXT.hud, {
        fontSize: Math.max(12, Math.round(h * 0.7)) + 'px', strokeThickness: 3
      })).setOrigin(0.5).setScrollFactor(0).setDepth((o.depth || 900) + 1);

      function draw() {
        const frac = Math.max(0, Math.min(1, remaining / durationMs));
        g.clear();
        g.fillStyle(0x000000, 0.55);
        g.fillRoundedRect(x, y, w, h, h / 2);
        const col = frac < 0.25 ? C.COLORS.danger : (o.color != null ? o.color : C.COLORS.yellow);
        if (frac > 0) {
          g.fillStyle(col, 1);
          g.fillRoundedRect(x + 2, y + 2, Math.max(h - 4, (w - 4) * frac), h - 4, (h - 4) / 2);
        }
        g.lineStyle(2, 0xffffff, 0.8);
        g.strokeRoundedRect(x, y, w, h, h / 2);
        if (label) label.setText(Math.ceil(remaining / 1000) + ' s');
      }

      function onUpdate(time, delta) {
        if (paused || done) return;
        remaining -= delta;
        if (remaining <= 0) {
          remaining = 0;
          done = true;
          draw();
          if (o.onDone) o.onDone();
          return;
        }
        draw();
      }

      scene.events.on('update', onUpdate);
      scene.events.once('shutdown', () => scene.events.off('update', onUpdate));
      draw();

      return {
        graphics: g,
        getRemaining: () => remaining,
        getFraction: () => Math.max(0, remaining / durationMs),
        addTime(ms) { if (!done) { remaining = Math.max(0, Math.min(durationMs, remaining + ms)); draw(); } },
        pause() { paused = true; },
        resume() { paused = false; },
        stop() { done = true; },
        isDone: () => done,
        destroy() {
          done = true;
          scene.events.off('update', onUpdate);
          g.destroy();
          if (label) label.destroy();
        }
      };
    },

    /** Schreibmaschinen-Effekt für ein Text-Objekt. */
    typewriter(scene, textObj, fullText, opts) {
      const o = opts || {};
      const cps = o.cps || 45;
      let i = 0;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        if (o.onDone) o.onDone();
      };
      textObj.setText('');
      const timer = scene.time.addEvent({
        delay: 1000 / cps,
        repeat: Math.max(0, fullText.length - 1),
        callback: () => {
          i += 1;
          textObj.setText(fullText.slice(0, i));
          if (i >= fullText.length) finish();
        }
      });
      if (!fullText.length) finish();
      return {
        skip() { timer.remove(false); i = fullText.length; textObj.setText(fullText); finish(); },
        cancel() { timer.remove(false); finished = true; },
        isDone: () => i >= fullText.length
      };
    },

    /** Kamera ausblenden und Szene wechseln. */
    fadeToScene(scene, key, data, ms) {
      const cam = scene.cameras.main;
      cam.fadeOut(ms || 280, 0, 0, 0);
      cam.once('camerafadeoutcomplete', () => scene.scene.start(key, data));
    },

    shake(scene, ms, intensity) {
      scene.cameras.main.shake(ms || 160, intensity || 0.01);
    },

    /** Partikel-Explosion (z. B. Crash, Konfetti). */
    burst(scene, x, y, opts) {
      const o = opts || {};
      const lifespan = o.lifespan || 700;
      const emitter = scene.add.particles(x, y, o.texture || 'px', {
        speed: { min: o.speedMin != null ? o.speedMin : 80, max: o.speedMax != null ? o.speedMax : 320 },
        angle: { min: 0, max: 360 },
        lifespan,
        scale: { start: o.scale || 1.6, end: 0 },
        alpha: { start: 1, end: 0 },
        gravityY: o.gravityY != null ? o.gravityY : 500,
        tint: o.tint || [0xffffff, C.COLORS.dhbwRed, C.COLORS.yellow],
        emitting: false
      });
      emitter.setDepth(o.depth || 600);
      if (o.fixed) emitter.setScrollFactor(0);
      emitter.explode(o.count || 24);
      scene.time.delayedCall(lifespan + 150, () => emitter.destroy());
      return emitter;
    },

    confetti(scene, x, y) {
      return UI.burst(scene, x, y, {
        count: 60, speedMin: 150, speedMax: 520, lifespan: 1400, gravityY: 700, scale: 2,
        tint: [C.COLORS.dhbwRed, C.COLORS.yellow, C.COLORS.cyan, C.COLORS.green, C.COLORS.magenta, 0xffffff],
        fixed: true
      });
    }
  };

  SS.UI = UI;
})();

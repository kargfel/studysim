/*
 * textures.js – Registry für prozedural erzeugte Texturen (keine externen Assets).
 *
 * Jede Szenen-Datei kann beim Laden eigene Texturen anmelden:
 *   SS.Textures.register('cube', 40, 40, (ctx, w, h) => { ... Canvas-2D ... });
 * BootScene erzeugt danach alle angemeldeten Texturen mit generateAll(scene).
 * Szenen, die direkt gestartet werden, können ensure(scene) aufrufen.
 */
(function () {
  'use strict';
  const SS = (globalThis.SS = globalThis.SS || {});

  const defs = [];

  const Textures = {
    /**
     * @param {string} key   Phaser-Texturschlüssel
     * @param {number} width
     * @param {number} height
     * @param {(ctx:CanvasRenderingContext2D, w:number, h:number) => void} draw
     */
    register(key, width, height, draw) {
      const existing = defs.findIndex((d) => d.key === key);
      const def = { key, width, height, draw };
      if (existing >= 0) defs[existing] = def; else defs.push(def);
    },

    /** Erzeugt alle angemeldeten Texturen, die es noch nicht gibt. */
    generateAll(scene) {
      for (const def of defs) {
        if (scene.textures.exists(def.key)) continue;
        try {
          const tex = scene.textures.createCanvas(def.key, def.width, def.height);
          const ctx = tex.getContext();
          def.draw(ctx, def.width, def.height);
          tex.refresh();
        } catch (e) {
          console.error('[Textures] Fehler beim Erzeugen von', def.key, e);
        }
      }
    },

    ensure(scene) {
      this.generateAll(scene);
    },

    keys() {
      return defs.map((d) => d.key);
    },

    // ── kleine Zeichenhilfen für Canvas-2D ──
    roundRect(ctx, x, y, w, h, r) {
      const rr = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.arcTo(x + w, y, x + w, y + h, rr);
      ctx.arcTo(x + w, y + h, x, y + h, rr);
      ctx.arcTo(x, y + h, x, y, rr);
      ctx.arcTo(x, y, x + w, y, rr);
      ctx.closePath();
    },

    hex(color) {
      return '#' + (color >>> 0).toString(16).padStart(6, '0').slice(-6);
    }
  };

  // ── Basistexturen, die alle Szenen nutzen dürfen ──
  Textures.register('px', 4, 4, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  });

  Textures.register('dot', 12, 12, (ctx, w) => {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(w / 2, w / 2, w / 2, 0, Math.PI * 2);
    ctx.fill();
  });

  Textures.register('glow', 64, 64, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });

  Textures.register('spark', 16, 16, (ctx, w) => {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    const c = w / 2;
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i;
      const r = i % 2 === 0 ? c : c * 0.35;
      ctx.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
  });

  SS.Textures = Textures;
})();

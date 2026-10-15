/*
 * physics.js – deterministische Runner-Physik im Stil von Geometry Dash.
 *
 * Reine Logik ohne Phaser: GameScene rendert nur, was hier berechnet wird,
 * und tests/beatability.mjs nutzt exakt dieselbe Funktion, um zu prüfen,
 * dass jedes Level schaffbar ist.
 *
 * Koordinaten: px, y wächst nach unten. Der Spieler ist ein Quadrat
 * (PLAYER_SIZE) mit (x, y) = linke obere Ecke der Hitbox.
 * gravityDir = 1 → normale Schwerkraft (Theoriephase),
 * gravityDir = -1 → kopfüber (Praxisphase).
 */
(function () {
  'use strict';
  const SS = (globalThis.SS = globalThis.SS || {});
  const C = SS.CONFIG;
  const EPS = 1e-6;

  /** Neuer Spielerzustand, z. B. beim (Re-)Spawn an einem Abschnittsanfang. */
  function createPlayer(opts) {
    const o = opts || {};
    return {
      x: o.x != null ? o.x : 2 * C.TILE,
      y: o.y != null ? o.y : C.GROUND_Y - C.PLAYER_SIZE,
      vy: 0,
      gravityDir: o.gravityDir === -1 ? -1 : 1,
      speedMode: o.speedMode || 'normal',
      grounded: true,
      dead: false,
      deathReason: null,
      finished: false,
      triggerIdx: o.triggerIdx || 0,   // nächster Trigger (Portal/Checkpoint) in world.triggers
      lastPadId: -1,
      lastOrbId: -1
    };
  }

  function clonePlayer(p) {
    return Object.assign({}, p);
  }

  function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  /** Alle festen Kacheln, die die Spieler-Hitbox überlappen. */
  function overlappingSolids(world, x, y, size) {
    const T = world.tile;
    const c0 = Math.floor(x / T);
    const c1 = Math.floor((x + size - EPS) / T);
    const r0 = Math.floor(y / T);
    const r1 = Math.floor((y + size - EPS) / T);
    const hits = [];
    for (let c = c0; c <= c1; c++) {
      for (let r = r0; r <= r1; r++) {
        if (world.isSolid(c, r)) hits.push({ c, r });
      }
    }
    return hits;
  }

  function die(p, reason, events) {
    p.dead = true;
    p.deathReason = reason;
    if (events) events.push({ type: 'death', reason });
    return p;
  }

  /**
   * Seitlich in eine Kachel gelaufen: Wenn die Füße nur knapp (LAND_SNAP)
   * unter der Kante stecken, wird der Würfel aufgesetzt statt zu sterben.
   */
  function trySnapOntoEdge(p, world, hits) {
    const T = world.tile;
    const P = C.PLAYER_SIZE;
    if (p.vy * p.gravityDir < 0) return false; // steigt gerade → kein Aufsetzen
    if (p.gravityDir === 1) {
      let top = Infinity;
      for (const h of hits) top = Math.min(top, h.r * T);
      if (p.y + P - top > C.LAND_SNAP) return false;
      p.y = top - P;
    } else {
      let bottom = -Infinity;
      for (const h of hits) bottom = Math.max(bottom, (h.r + 1) * T);
      if (bottom - p.y > C.LAND_SNAP) return false;
      p.y = bottom;
    }
    if (overlappingSolids(world, p.x, p.y, P).length) return false;
    p.vy = 0;
    p.grounded = true;
    return true;
  }

  function resolveVertical(p, world, events, wasGrounded) {
    const T = world.tile;
    const P = C.PLAYER_SIZE;
    const hits = overlappingSolids(world, p.x, p.y, P);
    if (!hits.length) return;
    const movingWithGravity = p.vy * p.gravityDir > 0;
    let top = Infinity;
    let bottom = -Infinity;
    for (const h of hits) {
      top = Math.min(top, h.r * T);
      bottom = Math.max(bottom, (h.r + 1) * T);
    }
    if (movingWithGravity) {
      p.y = p.gravityDir === 1 ? top - P : bottom; // landen
      p.grounded = true;
      if (!wasGrounded && events) events.push({ type: 'land' });
    } else {
      p.y = p.gravityDir === 1 ? bottom : top - P; // Kopf angestoßen
    }
    p.vy = 0;
    if (overlappingSolids(world, p.x, p.y, P).length) die(p, 'crush', events);
  }

  function handleObjects(p, world, input, events) {
    const T = world.tile;
    const P = C.PLAYER_SIZE;
    const c0 = Math.floor(p.x / T) - 1;
    const c1 = Math.floor((p.x + P) / T) + 1;
    for (let c = c0; c <= c1; c++) {
      const bucket = world.buckets[c];
      if (!bucket) continue;
      for (const o of bucket) {
        if (!aabb(p.x, p.y, P, P, o.hx, o.hy, o.hw, o.hh)) continue;
        if (o.type === 'spike') {
          die(p, 'spike', events);
          return;
        }
        if (o.type === 'pad' && p.lastPadId !== o.id) {
          p.lastPadId = o.id;
          p.vy = -C.PAD_V * p.gravityDir;
          p.grounded = false;
          if (events) events.push({ type: 'pad', id: o.id });
        } else if (o.type === 'orb' && input && input.jump && p.lastOrbId !== o.id) {
          p.lastOrbId = o.id;
          p.vy = -C.ORB_V * p.gravityDir;
          p.grounded = false;
          if (events) events.push({ type: 'orb', id: o.id });
        } else if (o.type === 'coin' && events) {
          events.push({ type: 'coin', id: o.id });
        }
      }
    }
  }

  function handleTriggers(p, world, events) {
    const triggers = world.triggers;
    const center = p.x + C.PLAYER_SIZE / 2;
    while (p.triggerIdx < triggers.length && center >= triggers[p.triggerIdx].x) {
      const t = triggers[p.triggerIdx++];
      if (t.type === 'portal') {
        if (t.kind === 'praxis' && p.gravityDir !== -1) {
          p.gravityDir = -1;
          p.vy *= 0.4;
          p.grounded = false;
        } else if (t.kind === 'theorie' && p.gravityDir !== 1) {
          p.gravityDir = 1;
          p.vy *= 0.4;
          p.grounded = false;
        } else if (t.kind === 'fast') {
          p.speedMode = 'fast';
        } else if (t.kind === 'normal') {
          p.speedMode = 'normal';
        }
        if (events) events.push({ type: 'portal', kind: t.kind, id: t.id });
      } else if (t.type === 'checkpoint') {
        if (events) events.push({ type: 'checkpoint', sectionIndex: t.sectionIndex, sideQuest: t.sideQuest });
      }
    }
  }

  /**
   * Ein fester Physik-Schritt.
   * @param {object} p      Spielerzustand (wird verändert)
   * @param {object} world  Ergebnis von SS.Level.parse()
   * @param {{jump:boolean}} input  true, solange Sprungtaste gehalten wird
   * @param {number} dt     Sekunden (SS.CONFIG.STEP)
   * @param {Array} [events] erhält {type:'jump'|'land'|'pad'|'orb'|'coin'|'portal'|'checkpoint'|'death'|'finish', …}
   */
  function step(p, world, input, dt, events) {
    if (p.dead || p.finished) return p;
    const P = C.PLAYER_SIZE;

    // 1) Absprung vom Boden (gedrückt halten = springt bei jeder Landung erneut)
    if (input && input.jump && p.grounded) {
      p.vy = -C.JUMP_V * p.gravityDir;
      p.grounded = false;
      if (events) events.push({ type: 'jump' });
    }

    // 2) Horizontal: konstante Geschwindigkeit, seitlicher Treffer = Crash
    p.x += C.SPEED[p.speedMode] * dt;
    const sideHits = overlappingSolids(world, p.x, p.y, P);
    if (sideHits.length && !trySnapOntoEdge(p, world, sideHits)) return die(p, 'wall', events);

    // 3) Vertikal: Schwerkraft, Landen, Kopfstoß
    const wasGrounded = p.grounded;
    p.vy += C.GRAVITY * p.gravityDir * dt;
    if (p.vy > C.MAX_FALL) p.vy = C.MAX_FALL;
    if (p.vy < -C.MAX_FALL) p.vy = -C.MAX_FALL;
    p.y += p.vy * dt;
    p.grounded = false;
    resolveVertical(p, world, events, wasGrounded);
    if (p.dead) return p;

    // 4) Stacheln, Pads, Orbs, Münzen
    handleObjects(p, world, input, events);
    if (p.dead) return p;

    // 5) Portale und Checkpoints (beim Überqueren der Spalte)
    handleTriggers(p, world, events);

    // 6) Aus dem Bild gefallen
    if (p.y > C.HEIGHT + 40) return die(p, 'pit', events);
    if (p.y < -P - 160) return die(p, 'sky', events);
    if (p.x > world.width) {
      p.finished = true;
      if (events) events.push({ type: 'finish' });
    }
    return p;
  }

  SS.Physics = { createPlayer, clonePlayer, step, aabb, overlappingSolids };
})();

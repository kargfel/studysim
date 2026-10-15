/*
 * phaser-loader.js – lädt Phaser 3.90 synchron, also vor allen Spielskripten.
 *
 * Doppelklick auf index.html (file://): wie im Workshop-Template vom CDN,
 * ohne Internet automatisch die lokale Kopie aus vendor/.
 * Gehostet (http/https, z. B. hinter Traefik und Cloudflare): immer die eigene Kopie.
 * Das ist schneller, gut cachebar, und es gehen keine Besucherdaten an ein fremdes CDN.
 */
(function () {
  'use strict';
  var CDN_URL = 'https://cdn.jsdelivr.net/npm/phaser@3.90.0/dist/phaser.min.js';
  var LOCAL_URL = 'vendor/phaser.min.js';

  // Versions-Parameter (?v=…) vom eigenen <script>-Tag übernehmen (setzt deploy/server.mjs)
  var own = document.currentScript;
  var query = own && own.src.indexOf('?') !== -1 ? own.src.slice(own.src.indexOf('?')) : '';

  if (location.protocol === 'file:') {
    document.write('<script src="' + CDN_URL + '"><\/script>');
    document.write('<script>window.Phaser || document.write(\'<script src="' + LOCAL_URL + '"><\\/script>\');<\/script>');
  } else {
    document.write('<script src="' + LOCAL_URL + query + '"><\/script>');
  }
})();

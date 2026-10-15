#!/usr/bin/env node
/*
 * server.mjs – statischer Webserver für den Studiums-Simulator (Node ≥ 18, keine Abhängigkeiten).
 *
 * Gedacht für den Betrieb hinter einem Reverse Proxy (Traefik) und Cloudflare:
 *   PORT=2223 HOST=0.0.0.0 node deploy/server.mjs
 *
 * - Liefert NUR die Dateien aus, die das Spiel braucht (index.html, css/, src/, vendor/,
 *   favicon.svg, og-image.png) – nie .git, tests/, docs/ oder package.json. Symlinks im
 *   öffentlichen Baum werden abgelehnt.
 * - Cache-Busting: In index.html bekommen alle lokalen Skripte/Styles ?v=<Build-ID>
 *   (Hash über alle Spiel-Dateien). Nur die aktuelle ID wird lange gecacht; fremde oder
 *   künftige IDs bekommen no-store, damit niemand den Cloudflare-Cache vergiften kann.
 * - Sicherheits-Header (strikte Content-Security-Policy, nosniff, kein Framing, HSTS),
 *   gzip, ETag/304, nur GET und HEAD.
 * - Dateien werden einmal pro Version im Speicher gehalten (alle zusammen ~2 MB),
 *   damit viele parallele Anfragen den Server nicht volllaufen lassen.
 * - GET /healthz → "ok" (für Docker-Healthcheck und Monitoring, wird nicht geloggt).
 */
import http from 'node:http';
import { realpathSync } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── Was öffentlich ist ────────────────────────────────────────────────
// Neue Top-Level-Pfade hier UND im Dockerfile (COPY) eintragen.
const PUBLIC_FILES = ['index.html', 'favicon.svg', 'og-image.png'];
const PUBLIC_DIRS = ['css', 'src', 'vendor'];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.svg', '.md', '.txt', '.json']);

const SECURITY_HEADERS = {
  // Das Spiel lädt nur eigene Dateien; Phaser erzeugt Texturen aus data:/blob:-URLs.
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "connect-src 'self'",
    "font-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  // Browser beachten HSTS nur über HTTPS (also hinter Cloudflare), lokal über http:// nicht
  'Strict-Transport-Security': 'max-age=31536000'
};

const CACHE = {
  html: 'no-cache',                                   // immer per ETag nachfragen
  versioned: 'public, max-age=31536000, immutable',   // aktuelle ?v=…-ID: ändert sich mit jedem Update
  asset: 'public, max-age=300',                        // unversionierte Spiel-Dateien
  image: 'public, max-age=86400',
  none: 'no-store'
};

const BUILD_ID_TTL_MS = 1000;   // so lange gilt eine geprüfte Build-ID, bevor die Dateien erneut verglichen werden
const KEEP_ALIVE_MS = 95000;    // länger als Traefiks Idle-Timeout (90 s), sonst sporadische 502
const MAX_LOGGED_PATH = 200;    // lange Pfade im Log kürzen

// ── Dateien und Build-ID ──────────────────────────────────────────────

/** Alle öffentlichen Dateien relativ zu ROOT (sortiert, ohne versteckte Dateien und Symlinks). */
async function listPublicFiles() {
  const result = [];
  async function walk(rel) {
    let entries;
    try {
      entries = await fsp.readdir(path.join(ROOT, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const childRel = rel + '/' + entry.name;
      if (entry.isDirectory()) await walk(childRel);
      else if (entry.isFile()) result.push(childRel);
    }
  }
  for (const dir of PUBLIC_DIRS) await walk(dir);
  for (const file of PUBLIC_FILES) {
    try {
      if ((await fsp.lstat(path.join(ROOT, file))).isFile()) result.push(file);
    } catch { /* optional */ }
  }
  return result.sort();
}

const buildIdCache = { id: null, statKey: null, checkedAt: 0, pending: null };

async function computeBuildId() {
  const files = await listPublicFiles();
  const stats = await Promise.all(files.map((f) => fsp.stat(path.join(ROOT, f))));
  const statKey = files.map((f, i) => `${f}:${stats[i].size}:${stats[i].mtimeMs}`).join('|');
  if (statKey !== buildIdCache.statKey) {
    const hash = crypto.createHash('sha256');
    for (const f of files) {
      hash.update(f);
      hash.update(await fsp.readFile(path.join(ROOT, f)));
    }
    buildIdCache.id = hash.digest('hex').slice(0, 10);
    buildIdCache.statKey = statKey;
  }
  buildIdCache.checkedAt = Date.now();
  return buildIdCache.id;
}

/** Kurzer Hash über den Inhalt aller Spiel-Dateien. Gleichzeitige Anfragen teilen sich eine Berechnung. */
function getBuildId() {
  if (buildIdCache.id && Date.now() - buildIdCache.checkedAt < BUILD_ID_TTL_MS) return Promise.resolve(buildIdCache.id);
  if (!buildIdCache.pending) {
    buildIdCache.pending = computeBuildId().finally(() => { buildIdCache.pending = null; });
  }
  return buildIdCache.pending;
}

/** Hängt ?v=<id> an alle lokalen src/href-Verweise in index.html. */
export function addVersionToAssets(html, id) {
  return html.replace(/(\s(?:src|href)=")((?:css|src|vendor)\/[^"?#]+)(")/g, `$1$2?v=${id}$3`);
}

/**
 * Wandelt den URL-Pfad in eine sichere, öffentliche Datei um.
 * @returns {{rel:string, abs:string} | {status:number}}
 */
export function resolvePublicPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { status: 400 };
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return { status: 400 };
  if (decoded === '/' || decoded === '') decoded = '/index.html';
  const rel = path.posix.normalize(decoded).replace(/^\/+/, '');
  const segments = rel.split('/');
  if (segments.some((s) => s === '..' || s.startsWith('.'))) return { status: 404 };
  const isPublic = PUBLIC_FILES.includes(rel) || (segments.length > 1 && PUBLIC_DIRS.includes(segments[0]));
  if (!isPublic) return { status: 404 };
  const abs = path.join(ROOT, rel);
  if (!abs.startsWith(ROOT + path.sep)) return { status: 404 };
  return { rel, abs };
}

let realRoot = null;
async function getRealRoot() {
  if (!realRoot) realRoot = await fsp.realpath(ROOT);
  return realRoot;
}

// ── Speicher-Caches (pro Datei-Version genau ein Eintrag) ──────────────

const fileCache = new Map();  // rel → { key, body: Promise<Buffer> }
const gzipCache = new Map();  // rel → { key, body: Buffer }
const htmlCache = { id: null, body: null };

function readCached(rel, abs, key) {
  let entry = fileCache.get(rel);
  if (!entry || entry.key !== key) {
    entry = { key, body: fsp.readFile(abs) };
    fileCache.set(rel, entry);
    entry.body.catch(() => fileCache.delete(rel));
  }
  return entry.body;
}

function gzipCached(rel, key, body) {
  let entry = gzipCache.get(rel);
  if (!entry || entry.key !== key) {
    entry = { key, body: zlib.gzipSync(body, { level: 9 }) };
    gzipCache.set(rel, entry);
  }
  return entry.body;
}

async function renderIndex(abs, id) {
  if (htmlCache.id !== id) {
    const html = await fsp.readFile(abs, 'utf8');
    htmlCache.body = Buffer.from(addVersionToAssets(html, id));
    htmlCache.id = id;
  }
  return htmlCache.body;
}

// ── Antworten ────────────────────────────────────────────────────────

function send(req, res, status, body, headers) {
  res.writeHead(status, Object.assign({}, SECURITY_HEADERS, headers, { 'Content-Length': Buffer.byteLength(body) }));
  res.end(req.method === 'HEAD' ? undefined : body);
}

function sendText(req, res, status, text, extra) {
  send(req, res, status, text, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': CACHE.none }, extra));
}

/** Antwortet mit 304, wenn der Browser die Version schon hat – ohne die Datei zu lesen. */
function sendNotModified(req, res, headers) {
  if (req.headers['if-none-match'] !== headers.ETag) return false;
  res.writeHead(304, Object.assign({}, SECURITY_HEADERS, headers));
  res.end();
  return true;
}

function cacheControlFor(rel, vParam, buildId) {
  if (rel === 'index.html') return CACHE.html;
  if (vParam !== null) return vParam === buildId ? CACHE.versioned : CACHE.none;
  if (rel.endsWith('.png') || rel.endsWith('.svg')) return CACHE.image;
  return CACHE.asset;
}

async function handle(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(req, res, 405, 'Methode nicht erlaubt', { Allow: 'GET, HEAD' });
    return 405;
  }
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    sendText(req, res, 400, 'Ungültige Anfrage');
    return 400;
  }
  if (url.pathname === '/healthz') {
    sendText(req, res, 200, 'ok');
    return 200;
  }
  const target = resolvePublicPath(url.pathname);
  if (target.status) {
    sendText(req, res, target.status, target.status === 400 ? 'Ungültige Anfrage' : 'Nicht gefunden');
    return target.status;
  }
  let stat;
  try {
    stat = await fsp.stat(target.abs);
    // Kein Symlink im öffentlichen Baum: der echte Pfad muss exakt der erwartete sein
    const real = await fsp.realpath(target.abs);
    if (real !== path.join(await getRealRoot(), target.rel)) throw new Error('Symlink');
  } catch {
    sendText(req, res, 404, 'Nicht gefunden');
    return 404;
  }
  if (!stat.isFile()) {
    sendText(req, res, 404, 'Nicht gefunden');
    return 404;
  }
  const ext = path.extname(target.rel).toLowerCase();
  const compressible = COMPRESSIBLE.has(ext);
  const wantsGzip = compressible && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const buildId = await getBuildId();
  const vParam = url.searchParams.get('v');
  const fileKey = target.rel === 'index.html' ? `html-${buildId}` : `${stat.size}-${Math.round(stat.mtimeMs)}`;
  const headers = {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Cache-Control': cacheControlFor(target.rel, vParam, buildId),
    ETag: `W/"${fileKey}"`
  };
  if (compressible) headers.Vary = 'Accept-Encoding';
  if (sendNotModified(req, res, headers)) return 304;

  const body = target.rel === 'index.html'
    ? await renderIndex(target.abs, buildId)
    : await readCached(target.rel, target.abs, fileKey);
  let payload = body;
  if (wantsGzip && body.length > 1024) {
    payload = gzipCached(target.rel, fileKey, body);
    headers['Content-Encoding'] = 'gzip';
  }
  send(req, res, 200, payload, headers);
  return 200;
}

// ── Server ───────────────────────────────────────────────────────────

/**
 * Startet den Server. Gibt {server, port, close()} zurück (für Tests mit port: 0).
 */
export async function startServer({ port = 2223, host = '0.0.0.0', quiet = false } = {}) {
  await getBuildId(); // einmal vorab: Dateien lesen und hashen, bevor Anfragen kommen
  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    let status = 500;
    try {
      status = await handle(req, res);
    } catch (err) {
      console.error('[studysim] Fehler:', err);
      if (!res.headersSent) sendText(req, res, 500, 'Interner Fehler');
      else res.destroy();
    }
    const pathOnly = (req.url || '').split('?')[0].slice(0, MAX_LOGGED_PATH);
    if (!quiet && pathOnly !== '/healthz') {
      console.log(`${new Date().toISOString()} ${req.method} ${pathOnly} ${status} ${Date.now() - started}ms`);
    }
  });
  server.keepAliveTimeout = KEEP_ALIVE_MS;
  server.headersTimeout = KEEP_ALIVE_MS + 1000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const actualPort = server.address().port;
  if (!quiet) console.log(`[studysim] läuft auf http://${host}:${actualPort} (Build ${await getBuildId()})`);
  return {
    server,
    port: actualPort,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

/** PORT aus der Umgebung: nur ganze Zahlen 1–65535 (0 = Zufallsport gibt es nur in Tests). */
function readPort() {
  const raw = (process.env.PORT ?? '2223').trim();
  const port = /^\d{1,5}$/.test(raw) ? Number(raw) : NaN;
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

async function main() {
  const port = readPort();
  if (port === null) {
    console.error(`[studysim] Ungültiger PORT: "${process.env.PORT}" (erlaubt: 1–65535)`);
    process.exit(1);
  }
  const { server } = await startServer({ port, host: process.env.HOST || '0.0.0.0', quiet: process.env.QUIET === '1' });
  const shutdown = (signal) => {
    console.log(`[studysim] ${signal} empfangen, beende …`);
    server.close(() => process.exit(0));
    server.closeIdleConnections?.();
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

/** Direkt gestartet (nicht importiert)? Vergleich über realpath, damit Symlink-Pfade funktionieren. */
function isMainModule() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (process.argv[1] && isMainModule()) {
  main().catch((err) => {
    console.error('[studysim] Start fehlgeschlagen:', err.message);
    process.exit(1);
  });
}

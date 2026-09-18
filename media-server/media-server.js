/**
 * Fusion Academy – vlastný media server (oddelenie „Streamy a záznamy")
 * ---------------------------------------------------------------------
 * Nahrádza YouTube pri online hodinách:
 *   · tréner vysiela z mobilu/OBS na   rtmp://<RTMP_HOST>/live/<STREAM_KEY>
 *   · appka prehráva naživo (HLS)      GET /live/<slug>/index.m3u8?t=<token>
 *   · každé vysielanie sa nahrá do MP4 GET /rec/<slug>/<súbor>.mp4?t=<token>
 *   · žiadny Content ID — hudba sa nestlmí, lebo je to náš server
 *
 * Bezpečnosť
 *   · STREAM_KEY (tajný, len tréner/admin) ≠ slug (verejné id hodiny na prehrávanie)
 *   · zoznam platných kľúčov si server sťahuje z appky (APP_URL/api/media/keys),
 *     cudzí kľúč sa odmietne
 *   · prehrávanie vyžaduje token podpísaný appkou (HMAC MEDIA_SECRET, s expiráciou);
 *     appka ho vydá len klientke s online prístupom
 *   · servisné API (/api/*) chráni hlavička x-media-secret
 *
 * Env: PORT (HTTP), RTMP_PORT (1935), MEDIA_ROOT, APP_URL, MEDIA_SECRET,
 *      FFMPEG, FFPROBE, RETENTION_DAYS (90)
 */
'use strict';
const NodeMediaServer = require('node-media-server');
const express = require('express');
const crypto  = require('crypto');
const fs      = require('fs');
const path    = require('path');
const { spawn, execFile } = require('child_process');

const HTTP_PORT   = +(process.env.PORT || process.env.HTTP_PORT || 8000);
const RTMP_PORT   = +(process.env.RTMP_PORT || 1935);
const MEDIA_ROOT  = process.env.MEDIA_ROOT || path.join(__dirname, 'media');
const APP_URL     = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const SECRET      = process.env.MEDIA_SECRET || '';
const FFMPEG      = process.env.FFMPEG  || 'ffmpeg';
const FFPROBE     = process.env.FFPROBE || 'ffprobe';
const RETENTION_DAYS = +(process.env.RETENTION_DAYS || 90);

if (!SECRET) console.warn('⚠️  MEDIA_SECRET nie je nastavený — prehrávanie aj servisné API sú OTVORENÉ (len na lokálny test)');

const LIVE_DIR = path.join(MEDIA_ROOT, 'live');
const REC_DIR  = path.join(MEDIA_ROOT, 'rec');
for (const d of [LIVE_DIR, REC_DIR]) fs.mkdirSync(d, { recursive: true });

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const safeId = s => String(s || '').replace(/[^a-zA-Z0-9_-]/g, '');
const nowISO = () => new Date().toISOString();

// ── Volanie appky (so servisným tajomstvom) ─────────────────────────────────
async function appFetch(p, body) {
  const r = await fetch(APP_URL + p, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'x-media-secret': SECRET },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error('app ' + p + ' → ' + r.status);
  return r.json();
}
async function hook(event, data) {
  try { await appFetch('/api/media/hook', { event, ...data, at: nowISO() }); }
  catch (e) { log('⚠️  hook ' + event + ' zlyhal:', e.message); }
}

// ── Platné stream kľúče: key → {slug, name} (sťahuje sa z appky) ────────────
let keys = new Map();
let keysLoadedAt = 0;
async function refreshKeys() {
  try {
    const d = await appFetch('/api/media/keys');
    keys = new Map((d.keys || []).map(k => [k.key, { slug: safeId(k.slug), name: k.name || '' }]));
    keysLoadedAt = Date.now();
  } catch (e) { log('⚠️  kľúče z appky sa nepodarilo načítať:', e.message); }
}
refreshKeys();
setInterval(refreshKeys, 30 * 1000);

// ── RTMP ingest ──────────────────────────────────────────────────────────────
const nms = new NodeMediaServer({
  logType: 1,
  rtmp: { port: RTMP_PORT, chunk_size: 60000, gop_cache: true, ping: 30, ping_timeout: 60 },
});
const keyFromPath = p => safeId((p || '').split('/').filter(Boolean).pop());

// slug → {key, name, started_at, ffmpeg, recFile}
const live = new Map();
// id RTMP session → slug (prePublish odmietne, postPublish spustí ffmpeg)
const sessions = new Map();

nms.on('prePublish', (id, StreamPath) => {
  const key = keyFromPath(StreamPath);
  const info = keys.get(key);
  const session = nms.getSession(id);
  if (!info || !info.slug) {
    log('⛔ Odmietnuté vysielanie – neznámy kľúč:', key.slice(0, 6) + '…');
    refreshKeys();                       // možno je kľúč nový — nabudúce prejde
    if (session) session.reject();
    return;
  }
  if (live.has(info.slug)) {
    log('⛔ Odmietnuté – hodina', info.slug, 'už vysiela');
    if (session) session.reject();
    return;
  }
  sessions.set(id, info.slug);
});

nms.on('postPublish', (id, StreamPath) => {
  const slug = sessions.get(id);
  if (!slug) return;
  const key = keyFromPath(StreamPath);
  const info = keys.get(key) || { name: '' };
  startPipeline(slug, key, info.name);
});

nms.on('donePublish', (id) => {
  const slug = sessions.get(id);
  sessions.delete(id);
  if (slug) stopPipeline(slug);
});

nms.run();

// ── ffmpeg: RTMP → HLS (live) + MP4 (záznam) bez prekódovania ───────────────
function startPipeline(slug, key, name) {
  const liveDir = path.join(LIVE_DIR, slug);
  const recDir  = path.join(REC_DIR, slug);
  fs.rmSync(liveDir, { recursive: true, force: true });
  fs.mkdirSync(liveDir, { recursive: true });
  fs.mkdirSync(recDir, { recursive: true });
  const started_at = nowISO();
  const stamp = started_at.replace(/[:.]/g, '-').slice(0, 19);
  const partFile = path.join(recDir, stamp + '.part.mp4');

  const args = [
    '-hide_banner', '-loglevel', 'warning', '-y',
    '-i', `rtmp://127.0.0.1:${RTMP_PORT}/live/${key}`,
    // 1) živý HLS: 2 s segmenty, ~10–15 s oneskorenie
    '-map', '0:v:0', '-map', '0:a?', '-c', 'copy',
    '-f', 'hls', '-hls_time', '2', '-hls_list_size', '8',
    '-hls_flags', 'delete_segments+temp_file+independent_segments',
    '-hls_segment_filename', path.join(liveDir, 'seg_%05d.ts'),
    path.join(liveDir, 'index.m3u8'),
    // 2) záznam: fragmentované MP4 (prežije aj pád spojenia), po skončení sa premuxuje
    '-map', '0:v:0', '-map', '0:a?', '-c', 'copy',
    '-movflags', '+frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4', partFile,
  ];
  const ff = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  ff.stderr.on('data', d => { const s = String(d).trim(); if (s) log('ffmpeg[' + slug + ']', s.slice(0, 300)); });
  const entry = { key, name, started_at, ffmpeg: ff, partFile, recDir, liveDir, finished: false };
  live.set(slug, entry);
  log('▶️  LIVE štart:', slug, name ? '(' + name + ')' : '');
  hook('start', { slug, name, started_at });

  ff.on('exit', code => {
    log('ffmpeg[' + slug + '] skončil, kód', code);
    finishRecording(slug, entry).catch(e => log('⚠️  dokončenie záznamu:', e.message));
  });
}

function stopPipeline(slug) {
  const e = live.get(slug);
  if (!e) return;
  log('⏹️  LIVE koniec:', slug);
  // ffmpeg sám skončí, keď RTMP vstup zmizne; poistka po 8 s
  setTimeout(() => { try { if (e.ffmpeg.exitCode === null) e.ffmpeg.kill('SIGINT'); } catch (_) {} }, 8000);
}

async function finishRecording(slug, e) {
  if (e.finished) return;
  e.finished = true;
  live.delete(slug);
  fs.rmSync(e.liveDir, { recursive: true, force: true });
  const ended_at = nowISO();
  let file = null, size = 0, duration_s = 0;
  try {
    const st = fs.statSync(e.partFile);
    if (st.size > 100 * 1024) {
      // moov na začiatok → rýchle pretáčanie v prehrávači
      const finalFile = e.partFile.replace(/\.part\.mp4$/, '.mp4');
      await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', e.partFile, '-c', 'copy', '-movflags', '+faststart', finalFile]);
      fs.unlinkSync(e.partFile);
      file = path.basename(finalFile);
      size = fs.statSync(finalFile).size;
      duration_s = await probeDuration(finalFile);
      log('💾 Záznam uložený:', slug + '/' + file, Math.round(size / 1048576) + ' MB,', Math.round(duration_s / 60) + ' min');
    } else {
      fs.unlinkSync(e.partFile); // pár sekúnd skúšobného spojenia — nezaujímavé
      log('🗑️  Príliš krátke vysielanie, záznam zahodený:', slug);
    }
  } catch (err) { log('⚠️  záznam', slug, err.message); }
  hook('stop', { slug, name: e.name, started_at: e.started_at, ended_at, file, size, duration_s,
    url: file ? `/rec/${slug}/${file}` : null });
}

const run = (cmd, args) => new Promise((res, rej) =>
  execFile(cmd, args, { maxBuffer: 4 * 1048576 }, (err, out, errOut) => err ? rej(new Error(errOut || err.message)) : res(out)));

async function probeDuration(file) {
  try {
    const out = await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
    return Math.round(+String(out).trim() || 0);
  } catch (_) { return 0; }
}

// ── Tokeny na prehrávanie (vydáva appka, tu sa len overujú) ─────────────────
// t = <exp>.<hmac_sha256(SECRET, slug|exp) prvých 32 hex>
function tokenOk(slug, t) {
  if (!SECRET) return true;
  const [exp, sig] = String(t || '').split('.');
  if (!exp || !sig || +exp < Date.now() / 1000) return false;
  const want = crypto.createHmac('sha256', SECRET).update(slug + '|' + exp).digest('hex').slice(0, 32);
  return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'x-media-secret, Content-Type, Range');
  res.set('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json());
const service = (req, res, next) => (!SECRET || req.get('x-media-secret') === SECRET) ? next() : res.status(401).json({ error: 'unauthorized' });
const playable = (req, res, next) => tokenOk(safeId(req.params.slug), req.query.t) ? next() : res.status(403).json({ error: 'Prístup vypršal — obnov stránku' });

app.get('/health', (req, res) => res.json({ ok: true, live: [...live.keys()], keys: keys.size, keys_at: keysLoadedAt ? new Date(keysLoadedAt).toISOString() : null }));

// Kto práve vysiela (slugy hodín — verejné id, nie kľúče)
app.get('/api/streams', (req, res) => res.json({ live: [...live.keys()] }));

// Živý HLS: playlist sa prepíše tak, aby segmenty niesli ten istý token
app.get('/live/:slug/index.m3u8', playable, (req, res) => {
  const slug = safeId(req.params.slug);
  const f = path.join(LIVE_DIR, slug, 'index.m3u8');
  if (!fs.existsSync(f)) return res.status(404).json({ error: 'Vysielanie práve nebeží', live: false });
  const t = encodeURIComponent(req.query.t || '');
  const body = fs.readFileSync(f, 'utf8').split('\n')
    .map(l => (l && !l.startsWith('#')) ? l + '?t=' + t : l).join('\n');
  res.set('Content-Type', 'application/vnd.apple.mpegurl');
  res.set('Cache-Control', 'no-store');
  res.send(body);
});
app.get('/live/:slug/:seg', playable, (req, res) => {
  const slug = safeId(req.params.slug);
  const seg = String(req.params.seg || '');
  if (!/^seg_\d+\.ts$/.test(seg)) return res.status(404).end();
  const f = path.join(LIVE_DIR, slug, seg);
  if (!fs.existsSync(f)) return res.status(404).end();
  res.set('Content-Type', 'video/mp2t');
  res.set('Cache-Control', 'public, max-age=60');
  res.sendFile(f);
});

// Záznamy (MP4 s podporou Range → pretáčanie)
app.get('/rec/:slug/:file', playable, (req, res) => {
  const slug = safeId(req.params.slug);
  const file = String(req.params.file || '');
  if (!/^[\w-]+\.mp4$/.test(file)) return res.status(404).end();
  const f = path.join(REC_DIR, slug, file);
  if (!fs.existsSync(f)) return res.status(404).json({ error: 'Záznam už nie je k dispozícii' });
  res.set('Content-Type', 'video/mp4');
  res.set('Cache-Control', 'private, max-age=3600');
  res.sendFile(f);
});

// Servisné API pre appku
app.get('/api/recordings', service, (req, res) => {
  const slug = safeId(req.query.slug);
  const dirs = slug ? [slug] : (fs.existsSync(REC_DIR) ? fs.readdirSync(REC_DIR) : []);
  const out = [];
  for (const s of dirs) {
    const dir = path.join(REC_DIR, s);
    let files = []; try { files = fs.readdirSync(dir); } catch (_) { continue; }
    for (const fn of files) {
      if (!/^[\w-]+\.mp4$/.test(fn) || /\.part\.mp4$/.test(fn)) continue;
      const st = fs.statSync(path.join(dir, fn));
      out.push({ slug: s, file: fn, url: `/rec/${s}/${fn}`, size: st.size, created_at: st.mtime.toISOString() });
    }
  }
  out.sort((a, b) => b.created_at.localeCompare(a.created_at));
  res.json({ recordings: out });
});
app.delete('/api/recordings/:slug/:file', service, (req, res) => {
  const slug = safeId(req.params.slug), file = String(req.params.file || '');
  if (!/^[\w-]+\.mp4$/.test(file)) return res.status(400).json({ error: 'bad file' });
  const f = path.join(REC_DIR, slug, file);
  try { fs.unlinkSync(f); } catch (_) {}
  res.json({ ok: true });
});
// Appka po vytvorení kľúča požiada o okamžité obnovenie (inak do 30 s)
app.post('/api/refresh', service, async (req, res) => { await refreshKeys(); res.json({ ok: true, keys: keys.size }); });
app.get('/api/usage', service, (req, res) => {
  let bytes = 0, files = 0;
  try {
    for (const s of fs.readdirSync(REC_DIR)) for (const fn of fs.readdirSync(path.join(REC_DIR, s))) {
      bytes += fs.statSync(path.join(REC_DIR, s, fn)).size; files++;
    }
  } catch (_) {}
  res.json({ bytes, files, retention_days: RETENTION_DAYS, live: [...live.keys()] });
});

// ── Retencia: staré záznamy sa mažú samy (appke sa to ohlási) ───────────────
async function retention() {
  const limit = Date.now() - RETENTION_DAYS * 86400e3;
  try {
    for (const s of fs.readdirSync(REC_DIR)) {
      const dir = path.join(REC_DIR, s);
      for (const fn of fs.readdirSync(dir)) {
        const f = path.join(dir, fn);
        const st = fs.statSync(f);
        const stale = st.mtimeMs < limit || (/\.part\.mp4$/.test(fn) && !live.has(s) && st.mtimeMs < Date.now() - 3600e3);
        if (!stale) continue;
        fs.unlinkSync(f);
        log('🗑️  Retencia: zmazaný', s + '/' + fn);
        if (!/\.part\.mp4$/.test(fn)) await hook('expired', { slug: s, file: fn, url: `/rec/${s}/${fn}` });
      }
    }
  } catch (e) { log('⚠️  retencia:', e.message); }
}
setTimeout(retention, 60 * 1000);
setInterval(retention, 6 * 3600 * 1000);

app.listen(HTTP_PORT, () => {
  log('🎥 Fusion media server beží');
  log('   RTMP ingest : rtmp://<host>:' + RTMP_PORT + '/live/<STREAM_KEY>');
  log('   HLS live    : http://<host>:' + HTTP_PORT + '/live/<slug>/index.m3u8?t=<token>');
  log('   Záznamy     : ' + REC_DIR + ' (retencia ' + RETENTION_DAYS + ' dní)');
  log('   Appka       : ' + APP_URL);
});

process.on('SIGTERM', () => { for (const [, e] of live) try { e.ffmpeg.kill('SIGINT'); } catch (_) {} setTimeout(() => process.exit(0), 3000); });

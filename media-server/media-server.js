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

// ── Cloudflare R2 (voliteľné): hotový záznam sa nahrá do R2 a lokálny súbor sa
// zmaže — Railway volume (5 GB) tak slúži len na rozpracovanú nahrávku.
// Env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.
const R2_ON = !!(process.env.R2_BUCKET && process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);
let s3 = null, S3 = null, Upload = null, getSignedUrl = null;
if (R2_ON) {
  S3 = require('@aws-sdk/client-s3');
  Upload = require('@aws-sdk/lib-storage').Upload;
  getSignedUrl = require('@aws-sdk/s3-request-presigner').getSignedUrl;
  s3 = new S3.S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
}
const R2_BUCKET = process.env.R2_BUCKET || '';
const r2Key = (slug, file) => `rec/${slug}/${file}`;

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

// ── Platné stream kľúče: key → [hodiny] (sťahuje sa z appky) ─────────────────
// Jeden kľúč môže patriť viacerým hodinám (jeden kľúč na mesto). Pri štarte
// vysielania sa vyberie hodina, ktorá podľa rozvrhu práve beží alebo je dnes
// najbližšia — podľa času v Bratislave, nie UTC servera.
let keys = new Map();
let keysLoadedAt = 0;
async function refreshKeys() {
  try {
    const d = await appFetch('/api/media/keys');
    const m = new Map();
    for (const k of (d.keys || [])) {
      const e = { slug: safeId(k.slug), name: k.name || '', city: k.city || '', day_of_week: k.day_of_week, time_start: k.time_start || '', time_end: k.time_end || '', only_date: k.only_date || null };
      if (!m.has(k.key)) m.set(k.key, []);
      m.get(k.key).push(e);
    }
    keys = m;
    keysLoadedAt = Date.now();
  } catch (e) { log('⚠️  kľúče z appky sa nepodarilo načítať:', e.message); }
}
function bratislavaNow() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bratislava', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = t => (p.find(x => x.type === t) || {}).value;
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(g('weekday'));
  return { dow, min: (+g('hour') % 24) * 60 + +g('minute'), date: `${g('year')}-${g('month')}-${g('day')}` };
}
const toMin = t => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
function pickClassForKey(key) {
  const list = (keys.get(key) || []).filter(e => e.slug && !live.has(e.slug));
  if (!list.length) return null;
  const now = bratislavaNow();
  const today = list.filter(e => e.day_of_week === now.dow && (!e.only_date || e.only_date === now.date));
  const endOf = e => { const en = toMin(e.time_end), st = toMin(e.time_start); return en > st ? en : st + 60; };
  // 1) práve beží (od 40 min pred štartom do 10 min po konci), pri viacerých najneskorší štart
  const running = today.filter(e => now.min >= toMin(e.time_start) - 40 && now.min < endOf(e) + 10).sort((a, b) => toMin(b.time_start) - toMin(a.time_start));
  if (running.length) return running[0];
  // 2) najbližšia dnešná, 3) prvá so správnym kľúčom (skúšobné vysielanie mimo rozvrhu)
  const upcoming = today.filter(e => toMin(e.time_start) > now.min).sort((a, b) => toMin(a.time_start) - toMin(b.time_start));
  return upcoming[0] || today[0] || list[0];
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
  const session = nms.getSession(id);
  if (!keys.has(key)) {
    log('⛔ Odmietnuté vysielanie – neznámy kľúč:', key.slice(0, 6) + '…');
    refreshKeys();                       // možno je kľúč nový — nabudúce prejde
    if (session) session.reject();
    return;
  }
  const info = pickClassForKey(key);
  if (!info) {
    log('⛔ Odmietnuté – všetky hodiny s týmto kľúčom už vysielajú');
    if (session) session.reject();
    return;
  }
  sessions.set(id, { slug: info.slug, name: info.name });
});

nms.on('postPublish', async (id, StreamPath) => {
  const s = sessions.get(id);
  if (!s) return;
  try { await uvolniMiesto(true); } catch (e) { log('⚠️  uvoľnenie miesta:', e.message); }
  startPipeline(s.slug, keyFromPath(StreamPath), s.name);
});

nms.on('donePublish', (id) => {
  const s = sessions.get(id);
  sessions.delete(id);
  if (s) stopPipeline(s.slug);
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
    // 2) záznam: fragmentované MP4 (prežije aj pád spojenia), po skončení sa premuxuje.
    //    Zvuk sa prekóduje na AAC-LC: audio z GoPro skopírované 1:1 Chrome v MP4 odmietol
    //    (PIPELINE_ERROR_DECODE, 19. 9.), video ostáva bez prekódovania.
    '-map', '0:v:0', '-map', '0:a?', '-c', 'copy',
    // fragmenty min. 60 s: prehliadač pri otvorení číta hlavičky všetkých fragmentov,
    // pri 2-sekundových ich boli tisíce a 4 GB záznam z R2 sa nespustil (18. 9.)
    '-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-min_frag_duration', '60000000',
    '-f', 'mp4', partFile,
  ];
  const ff = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  ff.stderr.on('data', d => { const s = String(d).trim(); if (s) log('ffmpeg[' + slug + ']', s.slice(0, 300)); });
  const entry = { key, name, started_at, ffmpeg: ff, partFile, recDir, liveDir, finished: false };
  live.set(slug, entry);
  // Diagnostika zdroja (19. 9.: Chrome odmietol zvuk z GoPro skopírovaný do MP4) — čo presne kamera posiela
  setTimeout(() => run(FFPROBE, ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,profile,sample_rate,channels,width,height,r_frame_rate,extradata_size', '-of', 'compact=p=0:nk=0', `rtmp://127.0.0.1:${RTMP_PORT}/live/${key}`])
    .then(o => log('🔬 vstup[' + slug + ']', String(o).replace(/\s+/g, ' ').slice(0, 400))).catch(e => log('🔬 vstup[' + slug + '] ffprobe:', e.message.slice(0, 200))), 6000);
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
  const r = await finalizeFile(slug, e.partFile);
  if (r.file) { try { await r2Upload(slug, r.file, path.join(e.recDir, r.file)); } catch (err) { log('⚠️  R2 upload zlyhal, záznam ostáva lokálne:', err.message); } }
  await hook('stop', { slug, name: e.name, started_at: e.started_at, ended_at, file: r.file, size: r.size, duration_s: r.duration_s,
    url: r.file ? `/rec/${slug}/${r.file}` : null });
  uvolniMiesto().catch(() => {});
  if (r.file && r.needsR2Transcode && !fs.existsSync(path.join(e.recDir, r.file))) await transcodeViaR2(slug, r.file);
}

// Fragmentované MP4 (frag_keyframe + sidx) je priamo prehrateľné aj pretáčateľné,
// preto sa už NEprepisuje do druhej kópie — 18. 9. pri 2-hodinovej hodine práve
// tá kópia zaplnila 5 GB volume („No space left on device") a záznam skoro prepadol.
async function finalizeFile(slug, partFile) {
  let file = null, size = 0, duration_s = 0, needsR2Transcode = false;
  try {
    const st = fs.statSync(partFile);
    const finalFile = partFile.replace(/\.part\.mp4$/, '.mp4');
    try { fs.unlinkSync(finalFile); } catch (_) {}   // zvyšok neúspešného prepisu
    if (st.size > 100 * 1024) {
      // Keď je na disku miesto na druhú kópiu, prepíš do klasického MP4 (moov na začiatku,
      // okamžitý štart aj pretáčanie); inak ostane fragmentované (60 s fragmenty, tiež hrá).
      if (freeBytes() > st.size + 300 * 1048576) {
        try {
          await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', partFile, '-c', 'copy', '-movflags', '+faststart', finalFile]);
          fs.unlinkSync(partFile);
          log('🎞️  Záznam prepísaný na klasické MP4:', slug);
        } catch (e) { log('⚠️  prepis na MP4 zlyhal, ostáva fragmentovaný:', e.message.slice(0, 200)); try { fs.unlinkSync(finalFile); } catch (_) {} }
      } else log('ℹ️  Málo miesta na prepis, záznam ostáva fragmentovaný (60 s fragmenty)');
      if (fs.existsSync(partFile)) fs.renameSync(partFile, finalFile);
      file = path.basename(finalFile);
      size = fs.statSync(finalFile).size;
      duration_s = await probeDuration(finalFile);
      log('💾 Záznam uložený:', slug + '/' + file, Math.round(size / 1048576) + ' MB,', Math.round(duration_s / 60) + ' min');
      // Zvuk pre prehliadač: AAC-LC prekódovanie do druhého súboru; originál sa nahradí len keď
      // má výsledok správnu dĺžku a rozumnú veľkosť (18. 9. nekontrolovaný výsledok zmazal záznam)
      if (freeBytes() > size + 300 * 1048576 && !process.env.FORCE_R2_REPROCESS) {
        const aacFile = finalFile.replace(/\.mp4$/, '.aac.part.mp4');
        try {
          const errTail = await runErr(FFMPEG, ['-hide_banner', '-loglevel', 'warning', '-y', '-i', finalFile, '-map', '0:v:0', '-map', '0:a?', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', aacFile]);
          const d2 = await probeDuration(aacFile), s2 = fs.statSync(aacFile).size;
          if (d2 >= duration_s * 0.98 && s2 >= size * 0.5) { fs.renameSync(aacFile, finalFile); size = s2; duration_s = d2; log('🔊 Zvuk prekódovaný na AAC-LC:', slug + '/' + file, errTail ? '| ffmpeg: ' + errTail : ''); }
          else { fs.unlinkSync(aacFile); log('⚠️  prekódovanie zvuku dalo zlý výsledok (' + Math.round(d2) + ' s, ' + Math.round(s2 / 1048576) + ' MB) — ostáva originál', errTail ? '| ffmpeg: ' + errTail : ''); }
        } catch (e) { try { fs.unlinkSync(aacFile); } catch (_) {} log('⚠️  prekódovanie zvuku zlyhalo — ostáva originál:', e.message.slice(0, 300)); }
      } else { needsR2Transcode = true; log('ℹ️  Málo miesta na lokálne prekódovanie zvuku (1080p, ' + Math.round(size / 1048576) + ' MB) — originál ide do R2 a zvuk sa prekóduje odtiaľ'); }
    } else {
      fs.unlinkSync(partFile); // pár sekúnd skúšobného spojenia — nezaujímavé
      log('🗑️  Príliš krátke vysielanie, záznam zahodený:', slug);
    }
  } catch (err) { log('⚠️  záznam', slug, err.message); }
  return { file, size, duration_s, needsR2Transcode };
}
// Veľký záznam (1080p, 2 h ≈ 4 GB): originál je už bezpečne v R2, prekódovanie zvuku ide
// cez r2Reprocess (stiahnuť → rúra → dočasný kľúč → kontrola → výmena). Zlyhanie = originál ostáva.
async function transcodeViaR2(slug, file) {
  if (!R2_ON) return;
  try { await r2Reprocess(slug, file); } catch (e) { log('⚠️  prekódovanie zvuku cez R2 zlyhalo — ostáva originál:', e.message.slice(0, 300)); }
}

// Po štarte: osirelé .part súbory (pád servera / reštart počas vysielania) sa
// dokončia a ohlásia appke, nech sa nestratí ani záznam prerušenej hodiny.
async function adoptOrphans() {
  try {
    for (const s of fs.readdirSync(REC_DIR)) {
      if (live.has(s)) continue;
      const dir = path.join(REC_DIR, s);
      for (const fn of fs.readdirSync(dir)) {
        if (!/\.part\.mp4$/.test(fn)) continue;
        const stamp = fn.replace(/\.part\.mp4$/, '');                  // 2026-09-18T16-04-46
        const started_at = stamp.replace(/T(\d\d)-(\d\d)-(\d\d)$/, 'T$1:$2:$3') + 'Z';
        const ended_at = fs.statSync(path.join(dir, fn)).mtime.toISOString();
        log('♻️  Osirelý záznam:', s + '/' + fn);
        const r = await finalizeFile(s, path.join(dir, fn));
        if (r.file) { try { await r2Upload(s, r.file, path.join(dir, r.file)); } catch (err) { log('⚠️  R2 upload zlyhal, záznam ostáva lokálne:', err.message); } }
        if (r.file) await hook('stop', { slug: s, name: '', started_at, ended_at, file: r.file, size: r.size, duration_s: r.duration_s, url: `/rec/${s}/${r.file}`, adopted: true });
        if (r.file && r.needsR2Transcode && !fs.existsSync(path.join(dir, r.file))) await transcodeViaR2(s, r.file);
      }
    }
  } catch (e) { log('⚠️  osirelé záznamy:', e.message); }
}

// Volume má pevnú veľkosť: keď sa záznamy priblížia k limitu, najstaršie sa zmažú
// (a appke sa to ohlási), nech nová hodina má vždy kam nahrávať.
const MAX_BYTES = +(process.env.RECORDINGS_MAX_MB || 4300) * 1048576;
function recordingsList() {
  const out = [];
  try {
    for (const s of fs.readdirSync(REC_DIR)) for (const fn of fs.readdirSync(path.join(REC_DIR, s))) {
      const f = path.join(REC_DIR, s, fn); const st = fs.statSync(f);
      out.push({ slug: s, file: fn, path: f, size: st.size, mtime: st.mtimeMs, part: /\.part\.mp4$/.test(fn) });
    }
  } catch (_) {}
  return out;
}
// Pred štartom vysielania musí ostať rezerva na celú hodinu (RESERVE_MB), inak by
// nahrávka skončila v polovici na plnom disku — vtedy sa uvoľní aj najnovší záznam.
const RESERVE_BYTES = +(process.env.RESERVE_MB || 3000) * 1048576;
async function uvolniMiesto(predStartom = false) {
  let list = recordingsList().sort((a, b) => a.mtime - b.mtime);
  let total = list.reduce((s, f) => s + f.size, 0);
  const limit = predStartom ? Math.max(0, MAX_BYTES - RESERVE_BYTES) : MAX_BYTES;
  if (total > limit) log('⚠️  Záznamy zaberajú', Math.round(total / 1048576), 'MB, limit', Math.round(limit / 1048576), 'MB' + (predStartom ? ' (rezerva pred hodinou)' : '') + ' — mažem najstaršie');
  // najnovší záznam sa nikdy nemaže sám od seba (aj keby bol sám nad limitom) — okrem rezervy pred hodinou
  for (const f of (predStartom ? list : list.slice(0, -1))) {
    if (total <= limit) break;
    if (f.part && live.has(f.slug)) continue;
    fs.unlinkSync(f.path); total -= f.size;
    log('🗑️  Miesto: zmazaný najstarší záznam', f.slug + '/' + f.file, Math.round(f.size / 1048576) + ' MB');
    if (!f.part) await hook('expired', { slug: f.slug, file: f.file, url: `/rec/${f.slug}/${f.file}` });
  }
}

// ── R2 operácie (všetky bezpečné aj bez R2 — vrátia prázdno) ────────────────
async function r2Upload(slug, file, localPath) {
  if (!R2_ON) return false;
  const size = fs.statSync(localPath).size;
  log('☁️  R2 upload:', slug + '/' + file, Math.round(size / 1048576) + ' MB…');
  const up = new Upload({ client: s3, params: { Bucket: R2_BUCKET, Key: r2Key(slug, file), Body: fs.createReadStream(localPath), ContentType: 'video/mp4' },
    partSize: 64 * 1048576, queueSize: 2, leavePartsOnError: false });
  await up.done();
  fs.unlinkSync(localPath);
  r2Cache.at = 0;
  log('☁️  R2 hotovo:', slug + '/' + file);
  return true;
}
let r2Cache = { at: 0, items: [] };
async function r2List() {
  if (!R2_ON) return [];
  if (Date.now() - r2Cache.at < 5 * 60 * 1000) return r2Cache.items;
  const items = []; let token;
  do {
    const r = await s3.send(new S3.ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: 'rec/', ContinuationToken: token }));
    for (const o of (r.Contents || [])) {
      const m = /^rec\/([\w-]+)\/([\w-]+\.mp4)$/.exec(o.Key || '');   // .tmp.mp4 (prerábanie) sa nezhoduje
      if (m) items.push({ slug: m[1], file: m[2], url: `/rec/${m[1]}/${m[2]}`, size: o.Size || 0, created_at: (o.LastModified || new Date()).toISOString(), r2: true });
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  r2Cache = { at: Date.now(), items };
  return items;
}
async function r2Delete(slug, file) {
  if (!R2_ON) return;
  await s3.send(new S3.DeleteObjectCommand({ Bucket: R2_BUCKET, Key: r2Key(slug, file) }));
  r2Cache.at = 0;
}
async function r2Presign(slug, file) {
  return getSignedUrl(s3, new S3.GetObjectCommand({ Bucket: R2_BUCKET, Key: r2Key(slug, file) }), { expiresIn: 3600 });
}
function freeBytes() { try { const s = fs.statfsSync(MEDIA_ROOT); return s.bavail * s.bsize; } catch (_) { return Infinity; } }

// Prerobenie záznamu v R2 na prehrateľný tvar: ffmpeg číta priamo z R2 (podpísaný
// odkaz), zapíše lokálne s 60 s fragmentmi (alebo klasické MP4, ak je miesto),
// nahrá späť a lokálny súbor zmaže. Spúšťa sa raz po nasadení (REPROCESS_ONCE)
// pre záznamy uložené pred 18. 9. večer, alebo na požiadanie cez /api/reprocess.
async function r2Reprocess(slug, file) {
  // Veľký záznam (1080p, ~4 GB) sa na 5 GB disku nedá prekódovať do druhého lokálneho súboru.
  // Dva prechody cez R2, na disku je vždy len JEDEN súbor:
  //   A) originál z R2 → disk → ffmpeg (video copy, zvuk AAC-LC) → rúra → R2 dočasný kľúč (fmp4)
  //   B) dočasný z R2 (http) → ffmpeg -c copy +faststart → disk (klasické MP4, správna dĺžka) → R2 finálny kľúč
  // Originál sa nahradí až po kontrole dĺžky a veľkosti; každé zlyhanie = originál ostáva.
  const dir = path.join(REC_DIR, slug); fs.mkdirSync(dir, { recursive: true });
  const base = file.replace(/\.mp4$/, '');
  const local = path.join(dir, base + '.src.part.mp4');
  const out = path.join(dir, base + '.out.part.mp4');
  const Key = r2Key(slug, file), TmpKey = Key + '.tmp.ts';
  const cleanup = async () => { for (const f of [local, out]) try { fs.unlinkSync(f); } catch (_) {} try { await s3.send(new S3.DeleteObjectCommand({ Bucket: R2_BUCKET, Key: TmpKey })); } catch (_) {} };
  try {
    log('🎞️  Prerábam záznam z R2:', slug + '/' + file, '— sťahujem…');
    const obj = await s3.send(new S3.GetObjectCommand({ Bucket: R2_BUCKET, Key }));
    await require('stream/promises').pipeline(obj.Body, fs.createWriteStream(local));
    const srcSize = fs.statSync(local).size;
    const srcDur = await probeDuration(local);
    log('🎞️  Stiahnuté', Math.round(srcSize / 1048576), 'MB,', Math.round(srcDur), 's — A) zvuk → AAC, rúrou do R2…');
    // A)
    const ff = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'warning', '-i', local, '-map', '0:v:0', '-map', '0:a?', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
      // MPEG-TS: sekvenčný formát, ktorý ffmpeg v prechode B číta z R2 lineárne bez pretáčania
      // (fragmentované MP4 cez http čítal len prvý fragment — 19. 9.)
      '-f', 'mpegts', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = ''; ff.stderr.on('data', d => { err += d; if (err.length > 4000) err = err.slice(-4000); });
    const up = new Upload({ client: s3, params: { Bucket: R2_BUCKET, Key: TmpKey, Body: ff.stdout, ContentType: 'video/mp2t' }, partSize: 64 * 1048576, queueSize: 2 });
    await up.done();
    const [code, signal] = await new Promise(r => (ff.exitCode !== null ? r([ff.exitCode, ff.signalCode]) : ff.on('exit', (c, sg) => r([c, sg]))));
    const head = await s3.send(new S3.HeadObjectCommand({ Bucket: R2_BUCKET, Key: TmpKey }));
    log('🎞️  A) výsledok:', Math.round((head.ContentLength || 0) / 1048576) + ' MB, ffmpeg kód', code, signal || '', err ? '| ' + err.trim().slice(-300) : '');
    if (code || signal || (head.ContentLength || 0) < srcSize * 0.5) throw new Error('A) neprešlo kontrolou (kód ' + code + ' ' + (signal || '') + ', ' + Math.round((head.ContentLength || 0) / 1048576) + ' MB)');
    fs.unlinkSync(local);
    // B)
    log('🎞️  B) klasické MP4 s moov na začiatku…');
    const tmpUrl = await getSignedUrl(s3, new S3.GetObjectCommand({ Bucket: R2_BUCKET, Key: TmpKey }), { expiresIn: 3600 });
    const errB = await runErr(FFMPEG, ['-hide_banner', '-loglevel', 'warning', '-y', '-i', tmpUrl, '-map', '0:v:0', '-map', '0:a?', '-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-movflags', '+faststart', out]);
    const outSize = fs.statSync(out).size, outDur = await probeDuration(out);
    log('🎞️  B) výsledok:', Math.round(outSize / 1048576) + ' MB,', Math.round(outDur) + ' s (zdroj ' + Math.round(srcDur) + ' s)', errB ? '| ' + errB : '');
    if (outDur < srcDur * 0.98 || outSize < srcSize * 0.5) throw new Error('B) neprešlo kontrolou (' + Math.round(outDur) + ' s, ' + Math.round(outSize / 1048576) + ' MB)');
    // výmena: až teraz sa originál prepíše
    await r2Upload(slug, file, out);
    await s3.send(new S3.DeleteObjectCommand({ Bucket: R2_BUCKET, Key: TmpKey }));
    r2Cache.at = 0;
    log('🎞️  Záznam prerobený a nahratý späť:', slug + '/' + file);
  } catch (e) { await cleanup(); throw new Error(e.message + ' — originál ostáva nedotknutý'); }
}
async function reprocessOnce() {
  const tag = process.env.REPROCESS_ONCE; if (!R2_ON || !tag) return;
  const marker = path.join(MEDIA_ROOT, 'reprocessed-' + safeId(tag));
  if (fs.existsSync(marker)) return;
  for (const r of await r2List()) { try { await r2Reprocess(r.slug, r.file); } catch (e) { log('⚠️  prerobenie', r.slug + '/' + r.file, e.message.slice(0, 200)); } }
  fs.writeFileSync(marker, nowISO());
}

// Diagnostika (PROBE_ONCE=1): po štarte skontroluj každý záznam v R2 — HEAD + ffprobe cez podpísaný odkaz
async function r2Probe() {
  if (!R2_ON || !process.env.PROBE_ONCE) return;
  for (const r of await r2List()) {
    try {
      const h = await s3.send(new S3.HeadObjectCommand({ Bucket: R2_BUCKET, Key: r2Key(r.slug, r.file) }));
      const url = await r2Presign(r.slug, r.file);
      const out = await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=format_name,duration,size:stream=codec_type,codec_name,width,height', '-of', 'compact=p=0:nk=0', url]);
      log('🔍 R2 probe', r.slug + '/' + r.file, 'HEAD', h.ContentLength, h.ContentType, '|', String(out).replace(/\s+/g, ' ').slice(0, 300));
    } catch (e) { log('🔍 R2 probe CHYBA', r.slug + '/' + r.file, e.message.slice(0, 300)); }
  }
}

// Po štarte: lokálne hotové záznamy (z čias bez R2) sa presunú do R2
async function r2Migrate() {
  if (!R2_ON) return;
  for (const f of recordingsList()) {
    if (f.part) continue;
    try { await r2Upload(f.slug, f.file, f.path); } catch (e) { log('⚠️  R2 migrácia', f.slug + '/' + f.file, e.message); }
  }
}

const runErr = (cmd, args) => new Promise((res, rej) =>
  execFile(cmd, args, { maxBuffer: 4 * 1048576 }, (err, out, errOut) => err ? rej(new Error((errOut || err.message).slice(-400))) : res(String(errOut || '').trim().slice(-300))));
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

// Verzia ffmpeg v /health: bez neho sa nič nenahrá ani neprehrá (Railpack musí mať railpack.json s aptPackages)
let ffmpegVersion = null;
execFile(FFMPEG, ['-version'], (err, out) => { ffmpegVersion = err ? null : String(out).split('\n')[0].replace(/^ffmpeg version\s*/, '').slice(0, 40); if (err) log('⛔ ffmpeg sa nenašiel:', err.message); });
app.get('/health', (req, res) => res.json({ ok: true, live: [...live.keys()], keys: keys.size, keys_at: keysLoadedAt ? new Date(keysLoadedAt).toISOString() : null,
  ffmpeg: ffmpegVersion, secret: !!SECRET, r2: R2_ON, used_mb: Math.round(recordingsList().reduce((s, f) => s + f.size, 0) / 1048576), max_mb: Math.round(MAX_BYTES / 1048576) }));

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
  if (fs.existsSync(f)) {
    res.set('Content-Type', 'video/mp4');
    res.set('Cache-Control', 'private, max-age=3600');
    return res.sendFile(f);
  }
  if (!R2_ON) return res.status(404).json({ error: 'Záznam už nie je k dispozícii' });
  // Záznam je v R2: presmeruj na podpísaný odkaz (1 h), Range/pretáčanie ide priamo z R2
  r2Presign(slug, file).then(u => { res.set('Cache-Control', 'no-store'); res.redirect(302, u); })
    .catch(e => res.status(404).json({ error: 'Záznam už nie je k dispozícii', detail: e.message }));
});

// Servisné API pre appku
app.get('/api/recordings', service, async (req, res) => {
  const slug = safeId(req.query.slug);
  const out = recordingsList().filter(f => !f.part && (!slug || f.slug === slug))
    .map(f => ({ slug: f.slug, file: f.file, url: `/rec/${f.slug}/${f.file}`, size: f.size, created_at: new Date(f.mtime).toISOString(), r2: false }));
  try { for (const r of await r2List()) if (!slug || r.slug === slug) out.push(r); } catch (e) { log('⚠️  R2 list:', e.message); }
  out.sort((a, b) => b.created_at.localeCompare(a.created_at));
  res.json({ recordings: out });
});
app.delete('/api/recordings/:slug/:file', service, async (req, res) => {
  const slug = safeId(req.params.slug), file = String(req.params.file || '');
  if (!/^[\w-]+\.mp4$/.test(file)) return res.status(400).json({ error: 'bad file' });
  try { fs.unlinkSync(path.join(REC_DIR, slug, file)); } catch (_) {}
  try { await r2Delete(slug, file); } catch (e) { log('⚠️  R2 delete:', e.message); }
  res.json({ ok: true });
});
// Na požiadanie: prerob záznam v R2 (napr. keď sa v prehliadači nespúšťa)
app.post('/api/reprocess/:slug/:file', service, async (req, res) => {
  const slug = safeId(req.params.slug), file = String(req.params.file || '');
  if (!R2_ON || !/^[\w-]+\.mp4$/.test(file)) return res.status(400).json({ error: 'bad request' });
  res.json({ ok: true, started: true });
  r2Reprocess(slug, file).catch(e => log('⚠️  prerobenie', slug + '/' + file, e.message.slice(0, 200)));
});
// Appka po vytvorení kľúča požiada o okamžité obnovenie (inak do 30 s)
app.post('/api/refresh', service, async (req, res) => { await refreshKeys(); res.json({ ok: true, keys: keys.size }); });
app.get('/api/usage', service, async (req, res) => {
  const local = recordingsList();
  let bytes = local.reduce((s, f) => s + f.size, 0), files = local.filter(f => !f.part).length, r2_bytes = 0, r2_files = 0;
  try { for (const r of await r2List()) { r2_bytes += r.size; r2_files++; } } catch (_) {}
  res.json({ bytes: bytes + r2_bytes, files: files + r2_files, local_bytes: bytes, r2_bytes, r2: R2_ON, retention_days: RETENTION_DAYS, live: [...live.keys()] });
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
  // to isté v R2
  try {
    for (const r of await r2List()) if (new Date(r.created_at).getTime() < limit) {
      await r2Delete(r.slug, r.file);
      log('🗑️  Retencia R2: zmazaný', r.slug + '/' + r.file);
      await hook('expired', { slug: r.slug, file: r.file, url: r.url });
    }
  } catch (e) { log('⚠️  retencia R2:', e.message); }
}
// Poradie po štarte: najprv zachrániť osirelé záznamy, až potom údržba a limit miesta
setTimeout(async () => { await adoptOrphans(); await r2Migrate(); await reprocessOnce(); await r2Probe(); await retention(); await uvolniMiesto(); }, 8 * 1000);
setInterval(async () => { await retention(); await uvolniMiesto(); }, 6 * 3600 * 1000);

app.listen(HTTP_PORT, () => {
  log('🎥 Fusion media server beží');
  log('   RTMP ingest : rtmp://<host>:' + RTMP_PORT + '/live/<STREAM_KEY>');
  log('   HLS live    : http://<host>:' + HTTP_PORT + '/live/<slug>/index.m3u8?t=<token>');
  log('   Záznamy     : ' + REC_DIR + ' (retencia ' + RETENTION_DAYS + ' dní)');
  log('   Appka       : ' + APP_URL);
});

process.on('SIGTERM', () => { for (const [, e] of live) try { e.ffmpeg.kill('SIGINT'); } catch (_) {} setTimeout(() => process.exit(0), 3000); });

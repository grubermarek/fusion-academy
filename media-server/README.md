# Fusion media server — streamy a záznamy bez YouTube

Samostatná služba (Railway service `media`), ktorá prijíma vysielanie trénerov
cez RTMP, prehráva ho klientkám v appke ako HLS a každé vysielanie nahrá do MP4.
Hudba sa nestlmí — žiadny Content ID, je to náš server.

```
tréner (Larix / OBS)  ──RTMP──▶  media server  ──HLS (token)──▶  appka /online
                                    │
                                    └─▶ MP4 záznam  ──hook──▶  appka db.recordings
```

## Ako to funguje

| Krok | Kto | Čo |
|---|---|---|
| kľúč | tréner v paneli (alebo admin v Hodiny & Stream) | `POST /api/trainer/online-stream/:id/key` → náhodný `stream_key` na hodine |
| vysielanie | tréner | `rtmp://<RTMP_PUBLIC>/<stream_key>` v Larix Broadcaster / OBS |
| overenie | media server | kľúče si sťahuje z appky (`GET /api/media/keys`, hlavička `x-media-secret`), cudzí kľúč odmietne |
| live | media server → appka | hook `start` → appka hlási `is_live`, vydá klientke token, dashboard banner svieti |
| prehrávanie | klientka | `GET <MEDIA_BASE>/live/<id hodiny>/index.m3u8?t=<token>` (hls.js / Safari natívne) |
| záznam | media server → appka | po skončení hook `stop` s MP4 → `db.recordings`; kratšie ako 3 min sú skryté |
| archív | klientka so Silver/Gold/Online | `/online` → sekcia Záznamy hodín, `GET /rec/<id>/<súbor>.mp4?t=<token>` |
| správa | admin | Hodiny & Stream → Záznamy vysielaní: prehrať, skryť/odkryť, zmazať; miesto na serveri |
| retencia | media server | `RETENTION_DAYS` (90) — starý súbor sa zmaže, hook `expired` vymaže evidenciu |

Hodina sa na prehrávanie identifikuje svojím `_id` (slug). Tajný `stream_key`
sa klientkam nikdy neposiela (ani cez verejný `/api/classes`).

Token na prehrávanie: `<exp>.<hmac_sha256(MEDIA_SECRET, slug|exp)[0:32]>`, platí 6 h,
vydáva ho appka len s online prístupom. Media server ho overí sám, bez volania appky.

## Env premenné

**media server** (`media-server/`):

| Premenná | Hodnota |
|---|---|
| `PORT` | HTTP (Railway dosadí sám) |
| `RTMP_PORT` | 1935 |
| `MEDIA_ROOT` | `/app/media` (Railway volume) |
| `APP_URL` | `https://app.fusionacademy.sk` |
| `MEDIA_SECRET` | rovnaké ako v appke (dlhý náhodný reťazec) |
| `RETENTION_DAYS` | 90 |

**appka** (`web`):

| Premenná | Hodnota |
|---|---|
| `MEDIA_BASE` | verejná HTTPS adresa media servera, bez lomky na konci |
| `MEDIA_SECRET` | rovnaké ako na media serveri |
| `RTMP_PUBLIC` | `rtmp://<tcp-proxy-domena>:<port>/live` (Railway → služba media → Networking → TCP Proxy na port 1935) |

Bez `MEDIA_BASE` appka beží ako doteraz (YouTube/Vimeo odkaz pri hodine ostáva ako záloha).

## Nasadenie (Railway, ten istý projekt ako appka)

Služba `media` existuje od 18. 9. 2026: doména `https://media-production-a0df.up.railway.app`
(HTTP port 8000), TCP proxy `altaria.proxy.rlwy.net:38961` → 1935 (RTMP), volume `media-volume`
na `/app/media` (5 GB).

Priečinok `media-server/` je prepojený na službu `media` samostatne (`railway link -s media`
spustený v tomto priečinku) — inak by `railway up` nahral celý repozitár a na službe by bežala
kópia hlavnej appky (stalo sa 18. 9.). Nasadenie preto vždy z tohto priečinka:

```bash
cd media-server
railway up --detach
```

Pozor: Railway dosadí `PORT` podľa TCP proxy (1935), preto je na službe natvrdo `PORT=8000`
a doména má cieľový port 8000 (`railway domain update <domena> -s media --port 8000`).

## Lokálny test

`node qa/stream.test.js` (potrebuje ffmpeg; `FFMPEG=cesta` ak nie je v PATH) — spustí
izolovanú appku aj media server, odvysiela skúšobný obraz a overí kľúče, tokeny,
HLS, záznam, viditeľnosť a mazanie (23 kontrol).

## Náklady (Railway, orientačne)

Odchádzajúce dáta 0,05 $/GB, volume 0,15 $/GB/mesiac. Hodina v 720p pri 2 Mb/s
je ~0,9 GB na diváčku: 20 diváčok × 3 hodiny týždenne ≈ 220 GB/mesiac ≈ 11 $ +
záznamy (~0,9 GB na hodinu, pri 90-dňovej retencii ~35 GB ≈ 5 $). Ak by to
rástlo, záznamy sa dajú presunúť na Cloudflare R2 (bez poplatku za sťahovanie).

// Cloudflare Worker that proxies Mapbox calls for the /space/ page.
// The Mapbox token lives only here as a Worker secret — it never reaches
// the browser.
//
// Two endpoints, with independent quotas:
//
//   GET /?lat=…&lon=…&zoom=…    — Static-image endpoint, hit by CAPTURE.
//                                  One Mapbox request per call.
//   GET /tile/{z}/{x}/{y}        — Tile endpoint, hit by the close-zoom
//                                  globe overlay. Many requests per
//                                  session, but Cloudflare's edge cache
//                                  absorbs most of the load (immutable
//                                  tiles → near-100% hit rate after
//                                  warm-up over major cities).
//
// Hard caps per month + per-IP-per-minute on each endpoint, so a runaway
// client or a viral moment can't blow past Mapbox's free tier.
//
// Workers KV free tier is 1k writes/day, so this Worker is careful never
// to write to KV on the hot path:
//   - Per-IP rate-limit counters live in the Cache API (free, per-DC,
//     functionally per-user since a single client routes to one DC).
//   - Monthly Mapbox-call counters use sampled writes — record 1-in-N
//     calls with increment=N, so the running total tracks the truth on
//     average while writes drop ~Nx.

const ALLOWED_ORIGINS = new Set([
  'https://juiceandthejoe.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
]);
const REFERER = 'https://juiceandthejoe.github.io/';

// Static-image endpoint. Mapbox Static Images free tier is 50k/month.
const STATIC_BASE       = 'https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static';
const MAX_MONTHLY       = 40000;
const PER_IP_PER_MIN    = 10;
// Captures are rare (one per CAPTURE button click) so a small sample rate
// keeps the counter close to the truth without burning many writes.
const STATIC_SAMPLE_N   = 5;

// Tile endpoint. Mapbox Raster Tiles free tier is 200k/month — but the
// edge cache means we only hit Mapbox on tile cache misses, so even much
// busier traffic stays within budget.
const TILE_BASE             = 'https://api.mapbox.com/v4/mapbox.satellite';
// Lower than Mapbox's 200k free tier to leave headroom for sampled-counter
// noise: with N=50 the counter's stddev is ~50·sqrt(actual·(1−1/N)/N), so
// a 160k cap reads as roughly 160k ± 2k. Stays comfortably under 200k.
const MAX_MONTHLY_TILES     = 160000;
const PER_IP_PER_MIN_TILES  = 100;
const TILE_SAMPLE_N         = 50;

const TILE_PATH_RE = /^\/tile\/(\d+)\/(\d+)\/(\d+)$/;

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.has(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Node-Secret',
    'Vary': 'Origin',
  };
}

// --- "The Node" add-link endpoint config ---
// POST /add-link appends a pinned link to node/links.json in the site repo.
// The GitHub PAT and the shared NODE_SECRET both live as Worker secrets:
//   wrangler secret put GITHUB_PAT     (fine-grained, this repo, Contents R/W)
//   wrangler secret put NODE_SECRET    (random string; the caller echoes it)
const GH_OWNER  = 'JuiceAndTheJoe';
const GH_REPO   = 'JuiceAndTheJoe.github.io';
const GH_BRANCH = 'main';
const GH_PATH   = 'node/links.json';
const ADD_PER_IP_PER_MIN = 5;

// `<img src>` requests don't send an Origin header — only Referer. Accept
// either as proof that the call is coming from one of our pages.
function isAllowedCaller(req) {
  const origin = req.headers.get('Origin') || '';
  if (ALLOWED_ORIGINS.has(origin)) return true;
  const referer = req.headers.get('Referer') || '';
  for (const allowed of ALLOWED_ORIGINS) {
    if (referer === allowed || referer.startsWith(allowed + '/')) return true;
  }
  return false;
}

function monthSuffix(d = new Date()) {
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${d.getUTCFullYear()}-${m}`;
}
function staticMonthKey() { return `count:${monthSuffix()}`; }
function tileMonthKey()   { return `tilecount:${monthSuffix()}`; }

function jsonError(msg, status, headers) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

// Per-IP rate limit using the Cache API. KV writes burn the 1k/day free
// tier fast; Cache puts are free and unlimited. The trade-off is that the
// CF cache is per-data-center, so this rate-limits per (IP × DC) instead
// of globally per IP — fine in practice, since a client almost always
// routes to one DC at a time.
//
// Returns true if the request is under cap and the counter has been
// bumped, false if the cap was hit.
async function bumpRateLimit(prefix, ip, max) {
  const minute = Math.floor(Date.now() / 60000);
  const url = `https://rl.local/${prefix}/${encodeURIComponent(ip)}/${minute}`;
  const cache = caches.default;
  const cached = await cache.match(url);
  let count = 0;
  if (cached) count = parseInt(await cached.text(), 10) || 0;
  if (count >= max) return false;
  await cache.put(
    url,
    new Response(String(count + 1), {
      headers: { 'Cache-Control': 'public, max-age=120' },
    })
  );
  return true;
}

// Sampled increment for the monthly Mapbox-call counters. Writing on every
// hot-path request burned through 1k KV writes/day in a few hours.
// Instead, with probability 1/N write `current + N` so the long-run mean
// equals the true count. The cap-check still reads the counter on every
// request (reads are 100k/day — plenty of headroom).
function sampledIncrement(env, ctx, key, current, sampleN) {
  if (Math.random() < 1 / sampleN) {
    ctx.waitUntil(env.QUOTA.put(key, String(current + sampleN)));
  }
}

export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const u = new URL(req.url);

    // The Node add-link endpoint. Auth is the shared NODE_SECRET (not origin),
    // so it must run BEFORE the GET-only / allowed-origin gates — the iOS
    // Shortcut sends neither Origin nor Referer.
    if (req.method === 'POST' && u.pathname === '/add-link') {
      return handleAddLink(req, env, cors);
    }
    if (req.method === 'POST' && u.pathname === '/delete-link') {
      return handleDeleteLink(req, env, cors);
    }

    if (req.method !== 'GET') {
      return jsonError('Method not allowed', 405, cors);
    }
    if (!isAllowedCaller(req)) {
      return jsonError('Forbidden origin', 403, cors);
    }

    const tileMatch = u.pathname.match(TILE_PATH_RE);
    if (tileMatch) {
      return handleTile(req, env, ctx, cors, tileMatch);
    }
    return handleStatic(req, env, ctx, cors, u);
  },
};

async function handleStatic(req, env, ctx, cors, u) {
  const lat = parseFloat(u.searchParams.get('lat'));
  const lon = parseFloat(u.searchParams.get('lon'));
  const zoom = parseInt(u.searchParams.get('zoom'), 10);

  if (
    Number.isNaN(lat) || lat < -90 || lat > 90 ||
    Number.isNaN(lon) || lon < -180 || lon > 180 ||
    Number.isNaN(zoom) || zoom < 4 || zoom > 20
  ) {
    return jsonError('Invalid lat/lon/zoom', 400, cors);
  }

  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await bumpRateLimit('s', ip, PER_IP_PER_MIN))) {
    return jsonError('Rate limited — slow down', 429, cors);
  }

  const mKey = staticMonthKey();
  const monthly = parseInt((await env.QUOTA.get(mKey)) || '0', 10);
  if (monthly >= MAX_MONTHLY) {
    return jsonError('Monthly cap reached — try again next month', 429, cors);
  }

  const mapboxUrl =
    `${STATIC_BASE}/${lon.toFixed(6)},${lat.toFixed(6)},${zoom},0/512x512@2x` +
    `?access_token=${env.MAPBOX_TOKEN}&logo=false&attribution=false`;

  // Spoof Referer so URL-restricted tokens accept the call. Keeping the
  // restriction on means a leaked token still can't be used from the open
  // internet without also spoofing this header.
  const upstream = await fetch(mapboxUrl, {
    headers: { 'Referer': REFERER },
  });

  if (!upstream.ok) {
    return jsonError(`Upstream ${upstream.status}`, 502, cors);
  }

  sampledIncrement(env, ctx, mKey, monthly, STATIC_SAMPLE_N);

  const out = new Headers(cors);
  out.set('Content-Type', upstream.headers.get('Content-Type') || 'image/jpeg');
  out.set('Cache-Control', 'public, max-age=86400');
  return new Response(upstream.body, { status: 200, headers: out });
}

async function handleTile(req, env, ctx, cors, [, zStr, xStr, yStr]) {
  const z = parseInt(zStr, 10);
  const x = parseInt(xStr, 10);
  const y = parseInt(yStr, 10);
  const max = z >= 0 && z <= 30 ? (1 << z) : 0;
  if (
    !Number.isInteger(z) || z < 0 || z > 22 ||
    !Number.isInteger(x) || x < 0 || x >= max ||
    !Number.isInteger(y) || y < 0 || y >= max
  ) {
    return jsonError('Invalid tile coords', 400, cors);
  }

  // Edge cache lookup runs FIRST so cache hits never touch KV — the
  // Workers KV free tier is only 1k puts/day, and a per-request rate-limit
  // write before the cache check burns through it on bot traffic.
  // Cache key intentionally has no query string and no origin info so
  // every visitor shares the same cached entry. CORS headers are NOT
  // cached — we add them to the response per request.
  const cacheKey = new Request(`https://tile-cache/${z}/${x}/${y}.jpg`);
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    return new Response(cached.body, { status: cached.status, headers });
  }

  // Cache miss — apply per-IP burst cap before paying for the Mapbox call.
  // Cache hits don't reach here, so cached traffic costs zero KV writes.
  // Per-IP counter lives in the Cache API (free, per-DC) instead of KV.
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await bumpRateLimit('t', ip, PER_IP_PER_MIN_TILES))) {
    return jsonError('Tile rate limited — slow down', 429, cors);
  }

  // Monthly Mapbox cap.
  const mKey = tileMonthKey();
  const monthly = parseInt((await env.QUOTA.get(mKey)) || '0', 10);
  if (monthly >= MAX_MONTHLY_TILES) {
    return jsonError('Monthly tile cap reached — try again next month', 429, cors);
  }

  const upstream = await fetch(
    `${TILE_BASE}/${z}/${x}/${y}@2x.jpg?access_token=${env.MAPBOX_TOKEN}`,
    { headers: { 'Referer': REFERER } }
  );
  if (!upstream.ok) {
    return jsonError(`Upstream ${upstream.status}`, 502, cors);
  }

  // Buffer the body once so we can both cache it and return it. Tiles top
  // out around ~30 KB so the doubled-memory cost is trivial.
  const body = await upstream.arrayBuffer();
  const contentType = upstream.headers.get('Content-Type') || 'image/jpeg';

  // Edge cache entry — long-lived, no CORS, no Vary. Mapbox satellite
  // tiles for a given (z,x,y) are effectively immutable; the rare base
  // imagery refresh is small enough that a 1-year TTL is fine.
  const cacheHeaders = new Headers();
  cacheHeaders.set('Content-Type', contentType);
  cacheHeaders.set('Cache-Control', 'public, max-age=31536000, immutable');
  ctx.waitUntil(
    cache.put(cacheKey, new Response(body, { status: 200, headers: cacheHeaders }))
  );
  sampledIncrement(env, ctx, mKey, monthly, TILE_SAMPLE_N);

  // Per-request response with CORS headers on top of the cache headers.
  const out = new Headers(cors);
  out.set('Content-Type', contentType);
  out.set('Cache-Control', 'public, max-age=31536000, immutable');
  return new Response(body, { status: 200, headers: out });
}

// ============================================================
// The Node — POST /add-link
// Body: { url, note?, category? }. Fetches the target page, scrapes
// title/description/og:image, then appends a link object to
// node/links.json via the GitHub Contents API (read SHA → push → write).
// ============================================================
async function handleAddLink(req, env, cors) {
  if (!env.NODE_SECRET || req.headers.get('X-Node-Secret') !== env.NODE_SECRET) {
    return jsonError('Unauthorized', 401, cors);
  }

  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await bumpRateLimit('add', ip, ADD_PER_IP_PER_MIN))) {
    return jsonError('Rate limited — slow down', 429, cors);
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return jsonError('Body must be JSON', 400, cors);
  }

  let target;
  try {
    target = new URL(String(payload.url || '').trim());
    if (!/^https?:$/.test(target.protocol)) throw new Error('bad protocol');
  } catch {
    return jsonError('Provide a valid http(s) url', 400, cors);
  }

  // Server-config guard — checked after the request is validated so a
  // malformed call still gets a 400, not a 500.
  if (!env.GITHUB_PAT) {
    return jsonError('Server missing GITHUB_PAT', 500, cors);
  }

  const meta = await scrapeMeta(target);

  const link = {
    id: crypto.randomUUID(),
    url: target.href,
    title: meta.title || target.hostname.replace(/^www\./, ''),
    description: (payload.note && String(payload.note).trim()) || meta.description || '',
    category: typeof payload.category === 'string' && payload.category ? payload.category : 'inbox',
    tags: [],
    status: 'inbox',
    favicon: `https://www.google.com/s2/favicons?domain=${target.hostname}&sz=64`,
    ogImage: meta.ogImage || null,
    dateAdded: new Date().toISOString(),
  };

  try {
    await appendLinkToRepo(env, link);
  } catch (err) {
    return jsonError('GitHub write failed: ' + err.message, 502, cors);
  }

  return new Response(JSON.stringify({ ok: true, id: link.id, title: link.title, link }), {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

// ============================================================
// The Node — POST /delete-link
// Body: { id }. Removes the matching link from node/links.json.
// ============================================================
async function handleDeleteLink(req, env, cors) {
  if (!env.NODE_SECRET || req.headers.get('X-Node-Secret') !== env.NODE_SECRET) {
    return jsonError('Unauthorized', 401, cors);
  }

  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await bumpRateLimit('add', ip, ADD_PER_IP_PER_MIN))) {
    return jsonError('Rate limited — slow down', 429, cors);
  }

  let payload;
  try { payload = await req.json(); }
  catch { return jsonError('Body must be JSON', 400, cors); }

  const id = String(payload.id || '').trim();
  if (!id) return jsonError('Provide a link id', 400, cors);

  if (!env.GITHUB_PAT) return jsonError('Server missing GITHUB_PAT', 500, cors);

  try {
    await deleteLinkFromRepo(env, id);
  } catch (err) {
    if (err.message === 'not found') return jsonError('No link with that id', 404, cors);
    return jsonError('GitHub write failed: ' + err.message, 502, cors);
  }

  return new Response(JSON.stringify({ ok: true, id }), {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

// Fetch the target page and pull title / description / og:image out of the
// HTML. Best-effort: any failure just yields empty fields and the link is
// still added (with a favicon and the URL).
async function scrapeMeta(target) {
  const out = { title: '', description: '', ogImage: '' };
  try {
    const res = await fetch(target.href, {
      headers: { 'User-Agent': 'TheNodeBot/1.0 (+https://juiceandthejoe.github.io)' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return out;
    const type = res.headers.get('Content-Type') || '';
    if (!type.includes('text/html')) return out;
    // Only need the <head>; cap the read so a huge page can't blow memory.
    const html = (await res.text()).slice(0, 200000);

    out.title =
      metaContent(html, 'og:title') ||
      metaContent(html, 'twitter:title') ||
      tagText(html, 'title');
    out.description =
      metaContent(html, 'og:description') ||
      metaContent(html, 'twitter:description') ||
      metaNamed(html, 'description');
    const img =
      metaContent(html, 'og:image') ||
      metaContent(html, 'twitter:image');
    if (img) {
      try { out.ogImage = new URL(img, target.href).href; } catch { /* ignore */ }
    }
  } catch { /* network/timeout — best-effort */ }
  out.title = decodeEntities(out.title).trim().slice(0, 160);
  out.description = decodeEntities(out.description).trim().slice(0, 280);
  return out;
}

function metaContent(html, prop) {
  // Matches <meta property="og:title" content="..."> in either attr order.
  const re = new RegExp(
    '<meta[^>]+(?:property|name)=["\']' + escapeRe(prop) +
    '["\'][^>]*content=["\']([^"\']*)["\']', 'i');
  const m = html.match(re);
  if (m) return m[1];
  const re2 = new RegExp(
    '<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']' +
    escapeRe(prop) + '["\']', 'i');
  const m2 = html.match(re2);
  return m2 ? m2[1] : '';
}
function metaNamed(html, name) { return metaContent(html, name); }
function tagText(html, tag) {
  const m = html.match(new RegExp('<' + tag + '[^>]*>([^<]*)</' + tag + '>', 'i'));
  return m ? m[1] : '';
}
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

// node/links.json read/write via the GitHub Contents API. One GET (for the
// blob SHA) + one PUT, both authenticated with the fine-grained PAT.
const GH_API = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_PATH}`;
function ghHeaders(env) {
  return {
    'Authorization': `Bearer ${env.GITHUB_PAT}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'TheNodeBot/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}
async function ghReadLinks(env) {
  const res = await fetch(`${GH_API}?ref=${GH_BRANCH}`, { headers: ghHeaders(env) });
  if (!res.ok) throw new Error('read ' + res.status);
  const file = await res.json();
  return { sha: file.sha, data: JSON.parse(b64ToText(file.content)) };
}
async function ghWriteLinks(env, data, sha, message) {
  const res = await fetch(GH_API, {
    method: 'PUT',
    headers: { ...ghHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: textToB64(JSON.stringify(data, null, 2) + '\n'),
      sha,
      branch: GH_BRANCH,
    }),
  });
  if (!res.ok) throw new Error('write ' + res.status);
}

async function appendLinkToRepo(env, link) {
  const { sha, data } = await ghReadLinks(env);
  if (!Array.isArray(data.links)) data.links = [];
  // Validate category against the file's known ids; an unknown value (e.g. a
  // label like "Thesis/Summer Jobs" instead of the id "thesis") would make the
  // card unreachable on the board, so fall back to inbox. Mutating link here
  // also corrects the object returned to the caller for its optimistic render.
  const validCats = Array.isArray(data.categories) ? data.categories.map((c) => c.id) : [];
  if (!validCats.includes(link.category)) link.category = 'inbox';
  data.links.push(link);
  await ghWriteLinks(env, data, sha, `node: pin "${link.title}"`);
}

async function deleteLinkFromRepo(env, id) {
  const { sha, data } = await ghReadLinks(env);
  const before = Array.isArray(data.links) ? data.links.length : 0;
  data.links = (data.links || []).filter((l) => l.id !== id);
  if (data.links.length === before) throw new Error('not found');
  await ghWriteLinks(env, data, sha, `node: remove ${id}`);
}

// UTF-8-safe base64 helpers — GitHub stores file content as base64 of the
// UTF-8 bytes, and titles can carry non-ASCII (e.g. "Velásquez").
function b64ToText(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
function textToB64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

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

// Tile endpoint. Mapbox Raster Tiles free tier is 200k/month — but the
// edge cache means we only hit Mapbox on tile cache misses, so even much
// busier traffic stays within budget.
const TILE_BASE             = 'https://api.mapbox.com/v4/mapbox.satellite';
const MAX_MONTHLY_TILES     = 200000;
const PER_IP_PER_MIN_TILES  = 100;

const TILE_PATH_RE = /^\/tile\/(\d+)\/(\d+)\/(\d+)$/;

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.has(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

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

export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (req.method !== 'GET') {
      return jsonError('Method not allowed', 405, cors);
    }
    if (!isAllowedCaller(req)) {
      return jsonError('Forbidden origin', 403, cors);
    }

    const u = new URL(req.url);
    const tileMatch = u.pathname.match(TILE_PATH_RE);
    if (tileMatch) {
      return handleTile(req, env, ctx, cors, tileMatch);
    }
    return handleStatic(req, env, cors, u);
  },
};

async function handleStatic(req, env, cors, u) {
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
  const ipKey = `ip:${ip}:${Math.floor(Date.now() / 60000)}`;
  const ipCount = parseInt((await env.QUOTA.get(ipKey)) || '0', 10);
  if (ipCount >= PER_IP_PER_MIN) {
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

  // Eventually consistent — fine, since the cap sits well below the free
  // tier and a few-request overshoot near the boundary is harmless.
  await Promise.all([
    env.QUOTA.put(mKey, String(monthly + 1)),
    env.QUOTA.put(ipKey, String(ipCount + 1), { expirationTtl: 120 }),
  ]);

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
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  const ipKey = `tip:${ip}:${Math.floor(Date.now() / 60000)}`;
  const ipCount = parseInt((await env.QUOTA.get(ipKey)) || '0', 10);
  if (ipCount >= PER_IP_PER_MIN_TILES) {
    return jsonError('Tile rate limited — slow down', 429, cors);
  }
  ctx.waitUntil(env.QUOTA.put(ipKey, String(ipCount + 1), { expirationTtl: 120 }));

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
  ctx.waitUntil(env.QUOTA.put(mKey, String(monthly + 1)));

  // Per-request response with CORS headers on top of the cache headers.
  const out = new Headers(cors);
  out.set('Content-Type', contentType);
  out.set('Cache-Control', 'public, max-age=31536000, immutable');
  return new Response(body, { status: 200, headers: out });
}

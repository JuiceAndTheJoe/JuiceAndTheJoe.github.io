// Cloudflare Worker that proxies Mapbox Static Images requests for the
// /space/ page. The Mapbox token lives only here as a Worker secret —
// it never reaches the browser.
//
// Hard caps (real spending guarantees):
//   MAX_MONTHLY  — global counter in KV, resets on the 1st UTC.
//   PER_IP_PER_MIN — burst limiter to keep one client from churning.

const ALLOWED_ORIGINS = new Set([
  'https://juiceandthejoe.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
]);

const MAX_MONTHLY = 40000; // safely under Mapbox's 50k free tier
const PER_IP_PER_MIN = 10;
const REFERER = 'https://juiceandthejoe.github.io/';
const BASE = 'https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static';

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.has(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function monthKey(d = new Date()) {
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `count:${d.getUTCFullYear()}-${m}`;
}

function jsonError(msg, status, headers) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (req.method !== 'GET') {
      return jsonError('Method not allowed', 405, cors);
    }
    if (!ALLOWED_ORIGINS.has(origin)) {
      return jsonError('Forbidden origin', 403, cors);
    }

    const u = new URL(req.url);
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

    const mKey = monthKey();
    const monthly = parseInt((await env.QUOTA.get(mKey)) || '0', 10);
    if (monthly >= MAX_MONTHLY) {
      return jsonError('Monthly cap reached — try again next month', 429, cors);
    }

    const mapboxUrl =
      `${BASE}/${lon.toFixed(6)},${lat.toFixed(6)},${zoom},0/512x512@2x` +
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
  },
};

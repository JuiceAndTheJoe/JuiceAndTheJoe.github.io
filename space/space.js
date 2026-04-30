// Mapbox public token. Public (pk.*) tokens are safe to ship in the browser
// when locked down with URL restrictions in the Mapbox dashboard.
// Replace before merging — see issue #14.
const MAPBOX_TOKEN = 'pk.REPLACE_WITH_URL_RESTRICTED_PUBLIC_TOKEN';

// Per-device daily quota. Best-effort only — clearing localStorage or opening
// a private window resets it. The real safety net is a Mapbox dashboard
// spending cap and the URL-restricted token.
const MAX_CAPTURES_PER_DAY = 5;
const QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;
const QUOTA_KEY = 'space.captureTimestamps';

const BASE = 'https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static';

function estimateZoomForRadiusKm(km) {
  if (km <= 1) return 17;
  if (km <= 2) return 16;
  if (km <= 5) return 15;
  if (km <= 10) return 14;
  if (km <= 20) return 13;
  if (km <= 40) return 12;
  if (km <= 80) return 11;
  if (km <= 160) return 10;
  if (km <= 320) return 9;
  if (km <= 640) return 8;
  if (km <= 1200) return 7;
  return 6;
}

function clampZoom(z) {
  return Math.min(20, Math.max(4, Math.round(z)));
}

function buildUrl(lat, lon, radiusKm, token) {
  const zoom = clampZoom(estimateZoomForRadiusKm(Math.max(radiusKm, 0.5)));
  return `${BASE}/${lon.toFixed(6)},${lat.toFixed(6)},${zoom},0/512x512@2x` +
         `?access_token=${encodeURIComponent(token)}&logo=false&attribution=false`;
}

function readQuota() {
  try {
    const raw = localStorage.getItem(QUOTA_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const cutoff = Date.now() - QUOTA_WINDOW_MS;
    return arr.filter((t) => typeof t === 'number' && t > cutoff);
  } catch {
    return [];
  }
}

function writeQuota(timestamps) {
  try {
    localStorage.setItem(QUOTA_KEY, JSON.stringify(timestamps));
  } catch {
    // localStorage unavailable (private mode, quota full) — fail open and
    // rely on Mapbox-side safeguards.
  }
}

function recordCapture() {
  const stamps = readQuota();
  stamps.push(Date.now());
  writeQuota(stamps);
  return stamps.length;
}

function remainingQuota() {
  return Math.max(0, MAX_CAPTURES_PER_DAY - readQuota().length);
}

function nextResetMs() {
  const stamps = readQuota();
  if (stamps.length < MAX_CAPTURES_PER_DAY) return 0;
  const oldest = Math.min(...stamps);
  return oldest + QUOTA_WINDOW_MS - Date.now();
}

function formatHours(ms) {
  const hours = Math.ceil(ms / (60 * 60 * 1000));
  return hours <= 1 ? 'about an hour' : `about ${hours} hours`;
}

const latInput = document.getElementById('lat');
const lonInput = document.getElementById('lon');
const radiusInput = document.getElementById('radius');
const radiusValue = document.getElementById('radius-value');
const captureBtn = document.getElementById('capture-btn');
const resultImg = document.getElementById('result-img');
const downloadLink = document.getElementById('download-link');
const statusEl = document.getElementById('status');
const quotaEl = document.getElementById('quota');

function formatRadius(km) {
  return km < 10 ? km.toFixed(1) : Math.round(km).toString();
}

radiusInput.addEventListener('input', () => {
  radiusValue.textContent = formatRadius(parseFloat(radiusInput.value));
});

function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.dataset.kind = kind || '';
}

function refreshQuotaUi() {
  const remaining = remainingQuota();
  if (quotaEl) {
    quotaEl.textContent =
      `${remaining} of ${MAX_CAPTURES_PER_DAY} captures left today`;
  }
  if (remaining === 0) {
    captureBtn.disabled = true;
    captureBtn.title = 'Daily limit reached';
  } else {
    captureBtn.disabled = false;
    captureBtn.title = '';
  }
}

function parseInputs() {
  const lat = parseFloat(latInput.value);
  const lon = parseFloat(lonInput.value);
  const radius = parseFloat(radiusInput.value);
  if (Number.isNaN(lat) || lat < -90 || lat > 90) {
    return { error: 'Latitude must be a number between -90 and 90.' };
  }
  if (Number.isNaN(lon) || lon < -180 || lon > 180) {
    return { error: 'Longitude must be a number between -180 and 180.' };
  }
  if (Number.isNaN(radius) || radius <= 0) {
    return { error: 'Radius must be a positive number.' };
  }
  return { lat, lon, radius };
}

function capture() {
  if (remainingQuota() === 0) {
    setStatus(
      `Daily limit of ${MAX_CAPTURES_PER_DAY} captures reached. Try again in ${formatHours(nextResetMs())}.`,
      'error'
    );
    return;
  }

  const parsed = parseInputs();
  if (parsed.error) {
    setStatus(parsed.error, 'error');
    return;
  }
  const { lat, lon, radius } = parsed;
  const url = buildUrl(lat, lon, radius, MAPBOX_TOKEN);

  recordCapture();
  refreshQuotaUi();

  setStatus('Loading satellite image…', 'loading');
  resultImg.hidden = false;
  resultImg.src = url;

  downloadLink.href = url;
  downloadLink.download = `satellite_${lat.toFixed(4)}_${lon.toFixed(4)}.jpg`;
  downloadLink.hidden = false;
}

resultImg.addEventListener('load', () => {
  setStatus('Captured. Right-click to save, or use the download link.', 'ok');
});

resultImg.addEventListener('error', () => {
  setStatus(
    'Image failed to load. Check the Mapbox token, its URL restrictions, or your network connection.',
    'error'
  );
  downloadLink.hidden = true;
});

captureBtn.addEventListener('click', capture);

document.querySelectorAll('.preset-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    latInput.value = btn.dataset.lat;
    lonInput.value = btn.dataset.lon;
    radiusInput.value = btn.dataset.radius;
    radiusValue.textContent = formatRadius(parseFloat(btn.dataset.radius));
    capture();
  });
});

refreshQuotaUi();

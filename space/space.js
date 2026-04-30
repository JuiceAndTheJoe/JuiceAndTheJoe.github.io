// Captures hit a Cloudflare Worker that holds the Mapbox token as a server-
// side secret and enforces a global monthly cap. See worker/ in the repo.
// Replace this with the URL printed by `wrangler deploy`.
const PROXY_BASE = 'https://satellite-proxy.REPLACE_WITH_CF_SUBDOMAIN.workers.dev';

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

function buildUrl(lat, lon, radiusKm) {
  const zoom = clampZoom(estimateZoomForRadiusKm(Math.max(radiusKm, 0.5)));
  const params = new URLSearchParams({
    lat: lat.toFixed(6),
    lon: lon.toFixed(6),
    zoom: String(zoom),
  });
  return `${PROXY_BASE}/?${params}`;
}

const latInput = document.getElementById('lat');
const lonInput = document.getElementById('lon');
const radiusInput = document.getElementById('radius');
const radiusValue = document.getElementById('radius-value');
const captureBtn = document.getElementById('capture-btn');
const resultImg = document.getElementById('result-img');
const downloadLink = document.getElementById('download-link');
const statusEl = document.getElementById('status');

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
  const parsed = parseInputs();
  if (parsed.error) {
    setStatus(parsed.error, 'error');
    return;
  }
  const { lat, lon, radius } = parsed;
  const url = buildUrl(lat, lon, radius);

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
    'Image failed to load. Either the monthly cap was reached, the request was rate-limited, or the Worker is unreachable.',
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

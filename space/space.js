// =============================================================================
// SATELLITE IMAGERY — space.js
// Cloudflare Worker proxy → Mapbox Static Images + Globe.gl 3D interaction
// =============================================================================

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PROXY_BASE = 'https://satellite-proxy.esvela02.workers.dev';

const DEFAULT_LAT = 59.349800;
const DEFAULT_LON = 18.070700;
const DEFAULT_RADIUS = 2;

// Notable land coordinates for the random preset (~30, spread across continents)
const LAND_PRESETS = [
  { lat: 48.8584,   lon: 2.2945   }, // Eiffel Tower, Paris
  { lat: 51.5007,   lon: -0.1246  }, // Big Ben, London
  { lat: 41.9029,   lon: 12.4534  }, // Vatican City
  { lat: 40.6892,   lon: -74.0445 }, // Statue of Liberty, NYC
  { lat: 37.8199,   lon: -122.4783}, // Golden Gate Bridge, SF
  { lat: -22.9519,  lon: -43.2105 }, // Cristo Redentor, Rio
  { lat: -13.1631,  lon: -72.5450 }, // Machu Picchu, Peru
  { lat: 59.3498,   lon: 18.0707  }, // KTH Stockholm
  { lat: 55.7520,   lon: 37.6175  }, // Red Square, Moscow
  { lat: 29.9792,   lon: 31.1342  }, // Great Pyramid of Giza
  { lat: -33.8568,  lon: 151.2153 }, // Sydney Opera House
  { lat: 35.6762,   lon: 139.6503 }, // Tokyo
  { lat: 22.3193,   lon: 114.1694 }, // Hong Kong
  { lat: 1.2966,    lon: 103.8520 }, // Singapore
  { lat: 27.1751,   lon: 78.0421  }, // Taj Mahal, India
  { lat: 36.0544,   lon: -112.1401}, // Grand Canyon South Rim
  { lat: 9.0765,    lon: 7.3986   }, // Abuja, Nigeria
  { lat: -1.2921,   lon: 36.8219  }, // Nairobi, Kenya
  { lat: 64.1355,   lon: -21.8954 }, // Reykjavik, Iceland
  { lat: 78.2232,   lon: 15.6267  }, // Longyearbyen, Svalbard
  { lat: -54.8019,  lon: -68.3030 }, // Ushuaia, Argentina
  { lat: 19.4326,   lon: -99.1332 }, // Mexico City
  { lat: 43.7230,   lon: -79.3780 }, // Toronto
  { lat: -34.6037,  lon: -58.3816 }, // Buenos Aires
  { lat: 31.2304,   lon: 121.4737 }, // Shanghai
  { lat: 28.6139,   lon: 77.2090  }, // New Delhi
  { lat: 52.5200,   lon: 13.4050  }, // Berlin
  { lat: 33.7490,   lon: -84.3880 }, // Atlanta, Georgia
  { lat: -4.3220,   lon: 15.3220  }, // Kinshasa, DRC
  { lat: 60.1699,   lon: 24.9384  }, // Helsinki, Finland
];

// ---------------------------------------------------------------------------
// URL builder (preserved verbatim)
// ---------------------------------------------------------------------------
function estimateZoomForRadiusKm(km) {
  if (km <= 1)    return 17;
  if (km <= 2)    return 16;
  if (km <= 5)    return 15;
  if (km <= 10)   return 14;
  if (km <= 20)   return 13;
  if (km <= 40)   return 12;
  if (km <= 80)   return 11;
  if (km <= 160)  return 10;
  if (km <= 320)  return 9;
  if (km <= 640)  return 8;
  if (km <= 1200) return 7;
  return 6;
}

function clampZoom(z) { return Math.min(20, Math.max(4, Math.round(z))); }

function buildUrl(lat, lon, radiusKm) {
  const zoom = clampZoom(estimateZoomForRadiusKm(Math.max(radiusKm, 0.5)));
  const params = new URLSearchParams({
    lat: lat.toFixed(6),
    lon: lon.toFixed(6),
    zoom: String(zoom),
  });
  return `${PROXY_BASE}/?${params}`;
}

// ---------------------------------------------------------------------------
// Metadata math
// ---------------------------------------------------------------------------
function metersPerPixel(lat, zoom) {
  const C = 156543.03392; // earth circumference in m / 256 px at zoom 0
  return C * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom);
}

function formatLength(meters) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  if (km >= 100) return `${Math.round(km)} km`;
  return `${km.toFixed(1)} km`;
}

function formatArea(m2) {
  if (m2 < 1e6) return `${Math.round(m2).toLocaleString()} m²`;
  const km2 = m2 / 1e6;
  if (km2 >= 100) return `${Math.round(km2).toLocaleString()} km²`;
  return `${km2.toFixed(2)} km²`;
}

function formatResolution(mpp) {
  if (mpp < 10) return `${mpp.toFixed(1)} m / px`;
  return `${Math.round(mpp)} m / px`;
}

function formatLatLng(lat, lng) {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lonDir = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(6)}° ${latDir}, ${Math.abs(lng).toFixed(6)}° ${lonDir}`;
}

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const latInput      = document.getElementById('lat');
const lonInput      = document.getElementById('lon');
const radiusInput   = document.getElementById('radius');
const radiusValue   = document.getElementById('radius-value');
const captureBtn    = document.getElementById('capture-btn');
const statusEl      = document.getElementById('status');
const resultImg     = document.getElementById('result-img');
const placeholder   = document.getElementById('image-placeholder');
const downloadLink  = document.getElementById('download-link');
const metadataCard  = document.getElementById('metadata-card');
const coordsReadout = document.getElementById('globe-coords-readout');
const globeStatus   = document.getElementById('globe-status');

const metaCoords     = document.getElementById('meta-coords');
const metaZoom       = document.getElementById('meta-zoom');
const metaResolution = document.getElementById('meta-resolution');
const metaSide       = document.getElementById('meta-side');
const metaArea       = document.getElementById('meta-area');
const metaTime       = document.getElementById('meta-time');

// ---------------------------------------------------------------------------
// Status helper
// ---------------------------------------------------------------------------
function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.dataset.kind = kind || '';
}

// ---------------------------------------------------------------------------
// HUD sync — keeps the overlay in step with the text inputs
// ---------------------------------------------------------------------------
function syncHud() {
  const lat = parseFloat(latInput.value);
  const lon = parseFloat(lonInput.value);
  if (!isNaN(lat) && !isNaN(lon)) {
    coordsReadout.textContent = formatLatLng(lat, lon);
  } else {
    coordsReadout.textContent = '--.------°, --.------°';
  }
}

latInput.addEventListener('input', syncHud);
lonInput.addEventListener('input', syncHud);

// ---------------------------------------------------------------------------
// Radius slider live readout
// ---------------------------------------------------------------------------
radiusInput.addEventListener('input', () => {
  radiusValue.textContent = radiusInput.value;
});

// ---------------------------------------------------------------------------
// Metadata fill
// ---------------------------------------------------------------------------
function fillMetadata(lat, lon, zoom) {
  const mpp = metersPerPixel(lat, zoom);
  const sideMeters = 512 * mpp;
  const areaM2 = sideMeters * sideMeters;
  // @2x: Mapbox returns 1024 physical px representing 512 logical px,
  // so actual ground sample on the image is halved.
  const displayMpp = mpp / 2;

  metaCoords.textContent     = formatLatLng(lat, lon);
  metaZoom.textContent       = `z${zoom} · 512×512 @2x`;
  metaResolution.textContent = formatResolution(displayMpp);
  metaSide.textContent       = `${formatLength(sideMeters)} × ${formatLength(sideMeters)}`;
  metaArea.textContent       = formatArea(areaM2);
  metaTime.textContent       = new Date().toLocaleString();

  metadataCard.hidden = false;
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------
function capture() {
  const lat    = parseFloat(latInput.value);
  const lon    = parseFloat(lonInput.value);
  const radius = parseFloat(radiusInput.value);

  if (isNaN(lat) || lat < -90 || lat > 90) {
    setStatus('Invalid latitude — must be between -90 and 90.', 'error');
    return;
  }
  if (isNaN(lon) || lon < -180 || lon > 180) {
    setStatus('Invalid longitude — must be between -180 and 180.', 'error');
    return;
  }
  if (isNaN(radius) || radius <= 0) {
    setStatus('Invalid radius — must be greater than 0.', 'error');
    return;
  }

  const zoom = clampZoom(estimateZoomForRadiusKm(Math.max(radius, 0.5)));
  const url  = buildUrl(lat, lon, radius);

  setStatus('Acquiring satellite imagery…', 'loading');
  globeStatus.textContent = 'CAPTURING…';
  captureBtn.disabled = true;

  // Update globe marker and ring to the current target
  if (globe) {
    globe.pointsData([{ lat, lng: lon }]);
    globe.ringsData([{ lat, lng: lon }]);
  }

  resultImg.onload = () => {
    resultImg.hidden  = false;
    placeholder.hidden = true;
    downloadLink.href = url;
    downloadLink.download = `satellite_${lat.toFixed(4)}_${lon.toFixed(4)}_z${zoom}.jpg`;
    downloadLink.hidden = false;
    setStatus('Imagery acquired successfully.', 'ok');
    globeStatus.textContent = 'TARGET LOCKED';
    captureBtn.disabled = false;
    fillMetadata(lat, lon, zoom);
  };

  resultImg.onerror = () => {
    setStatus(
      'Image failed to load. The Worker may be unreachable, rate-limited, or the monthly cap has been reached. Try again later.',
      'error'
    );
    globeStatus.textContent = 'SIGNAL LOST';
    captureBtn.disabled = false;
    downloadLink.hidden = true;
  };

  resultImg.src = url;
  resultImg.alt = `Satellite image at ${lat.toFixed(4)}, ${lon.toFixed(4)} zoom ${zoom}`;
}

// ---------------------------------------------------------------------------
// Capture button + Enter-key shortcut
// ---------------------------------------------------------------------------
captureBtn.addEventListener('click', capture);
latInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') capture(); });
lonInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') capture(); });

// ---------------------------------------------------------------------------
// Preset buttons
// ---------------------------------------------------------------------------
document.querySelectorAll('.preset-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.random === 'true') {
      const pick = LAND_PRESETS[Math.floor(Math.random() * LAND_PRESETS.length)];
      latInput.value          = pick.lat.toFixed(6);
      lonInput.value          = pick.lon.toFixed(6);
      radiusInput.value       = '5';
      radiusValue.textContent = '5';
    } else {
      latInput.value          = btn.dataset.lat;
      lonInput.value          = btn.dataset.lon;
      radiusInput.value       = btn.dataset.radius;
      radiusValue.textContent = btn.dataset.radius;
    }

    syncHud();

    // Fly the globe to the new target
    if (globe) {
      const lat = parseFloat(latInput.value);
      const lng = parseFloat(lonInput.value);
      globe.pointsData([{ lat, lng }]);
      globe.ringsData([{ lat, lng }]);
      globe.pointOfView({ lat, lng, altitude: 1.5 }, 800);
    }

    capture();
  });
});

// ---------------------------------------------------------------------------
// 3D Globe (Globe.gl)
// ---------------------------------------------------------------------------
let globe = null;

(function initGlobe() {
  const container = document.getElementById('globe-container');
  if (!container || typeof globalThis.Globe !== 'function') return;

  globe = globalThis.Globe()(container)
    .globeImageUrl('//unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
    .bumpImageUrl('//unpkg.com/three-globe/example/img/earth-topology.png')
    .backgroundColor('rgba(0,0,0,0)')
    .showAtmosphere(true)
    .atmosphereColor('#5fc1ff')
    .atmosphereAltitude(0.18)
    .width(container.clientWidth)
    .height(container.clientHeight)
    // Target marker
    .pointAltitude(0.01)
    .pointRadius(0.5)
    .pointColor(() => '#ff3a8c')
    // Pulsing ring
    .ringColor(() => 'rgba(255,58,140,0.8)')
    .ringMaxRadius(2)
    .ringPropagationSpeed(2)
    .ringRepeatPeriod(1200);

  // Slow idle rotation
  globe.controls().autoRotate      = true;
  globe.controls().autoRotateSpeed = 0.4;

  // Stop rotation on any user interaction with the globe
  container.addEventListener('mousedown',  () => { globe.controls().autoRotate = false; });
  container.addEventListener('touchstart', () => { globe.controls().autoRotate = false; }, { passive: true });

  // Drop initial marker on default Stockholm coords
  globe.pointsData([{ lat: DEFAULT_LAT, lng: DEFAULT_LON }]);
  globe.ringsData([{ lat: DEFAULT_LAT, lng: DEFAULT_LON }]);
  globe.pointOfView({ lat: DEFAULT_LAT, lng: DEFAULT_LON, altitude: 1.8 });

  // Globe click → write inputs, sync HUD, update marker/ring, auto-capture
  globe.onGlobeClick(({ lat, lng }) => {
    latInput.value = lat.toFixed(6);
    lonInput.value = lng.toFixed(6);
    syncHud();
    globeStatus.textContent = 'TARGET LOCKED';
    globe.pointsData([{ lat, lng }]);
    globe.ringsData([{ lat, lng }]);
    capture();
  });

  // Keep canvas sized to its container on window resize
  window.addEventListener('resize', () => {
    globe.width(container.clientWidth).height(container.clientHeight);
  });
})();

// ---------------------------------------------------------------------------
// Initial HUD
// ---------------------------------------------------------------------------
syncHud();
globeStatus.textContent = 'READY';

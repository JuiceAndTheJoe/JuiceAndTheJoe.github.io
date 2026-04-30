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

// Country borders GeoJSON (Natural Earth 110m, ~840 KB). Served from
// jsdelivr's GitHub mirror — proper CDN caching + correct content type.
const COUNTRIES_GEOJSON_URL =
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_0_countries.geojson';

// City labels rendered on the globe. Mix of capitals + iconic cities,
// geographically distributed so every continent has visible reference points.
const CITY_LABELS = [
  // Europe
  { lat: 59.3293, lng: 18.0686,  name: 'Stockholm' },
  { lat: 60.1699, lng: 24.9384,  name: 'Helsinki' },
  { lat: 59.9139, lng: 10.7522,  name: 'Oslo' },
  { lat: 55.6761, lng: 12.5683,  name: 'Copenhagen' },
  { lat: 52.5200, lng: 13.4050,  name: 'Berlin' },
  { lat: 48.8566, lng: 2.3522,   name: 'Paris' },
  { lat: 51.5074, lng: -0.1278,  name: 'London' },
  { lat: 53.3498, lng: -6.2603,  name: 'Dublin' },
  { lat: 40.4168, lng: -3.7038,  name: 'Madrid' },
  { lat: 38.7223, lng: -9.1393,  name: 'Lisbon' },
  { lat: 41.9028, lng: 12.4964,  name: 'Rome' },
  { lat: 48.2082, lng: 16.3738,  name: 'Vienna' },
  { lat: 50.0755, lng: 14.4378,  name: 'Prague' },
  { lat: 52.2297, lng: 21.0122,  name: 'Warsaw' },
  { lat: 55.7558, lng: 37.6173,  name: 'Moscow' },
  { lat: 41.0082, lng: 28.9784,  name: 'Istanbul' },
  { lat: 37.9838, lng: 23.7275,  name: 'Athens' },
  { lat: 64.1466, lng: -21.9426, name: 'Reykjavík' },
  // Asia
  { lat: 35.6762, lng: 139.6503, name: 'Tokyo' },
  { lat: 37.5665, lng: 126.9780, name: 'Seoul' },
  { lat: 39.9042, lng: 116.4074, name: 'Beijing' },
  { lat: 31.2304, lng: 121.4737, name: 'Shanghai' },
  { lat: 22.3193, lng: 114.1694, name: 'Hong Kong' },
  { lat: 1.3521,  lng: 103.8198, name: 'Singapore' },
  { lat: 13.7563, lng: 100.5018, name: 'Bangkok' },
  { lat: 14.5995, lng: 120.9842, name: 'Manila' },
  { lat: -6.2088, lng: 106.8456, name: 'Jakarta' },
  { lat: 28.6139, lng: 77.2090,  name: 'New Delhi' },
  { lat: 19.0760, lng: 72.8777,  name: 'Mumbai' },
  { lat: 24.8607, lng: 67.0011,  name: 'Karachi' },
  { lat: 25.2048, lng: 55.2708,  name: 'Dubai' },
  { lat: 31.7683, lng: 35.2137,  name: 'Jerusalem' },
  { lat: 35.6892, lng: 51.3890,  name: 'Tehran' },
  { lat: 41.3111, lng: 69.2401,  name: 'Tashkent' },
  // Africa
  { lat: 30.0444, lng: 31.2357,  name: 'Cairo' },
  { lat: 6.5244,  lng: 3.3792,   name: 'Lagos' },
  { lat: -1.2921, lng: 36.8219,  name: 'Nairobi' },
  { lat: -33.9249, lng: 18.4241, name: 'Cape Town' },
  { lat: -26.2041, lng: 28.0473, name: 'Johannesburg' },
  { lat: 9.0765,  lng: 7.3986,   name: 'Abuja' },
  { lat: -4.4419, lng: 15.2663,  name: 'Kinshasa' },
  { lat: 33.5731, lng: -7.5898,  name: 'Casablanca' },
  { lat: 14.7167, lng: -17.4677, name: 'Dakar' },
  // North America
  { lat: 40.7128, lng: -74.0060, name: 'New York' },
  { lat: 34.0522, lng: -118.2437, name: 'Los Angeles' },
  { lat: 41.8781, lng: -87.6298, name: 'Chicago' },
  { lat: 29.7604, lng: -95.3698, name: 'Houston' },
  { lat: 43.6532, lng: -79.3832, name: 'Toronto' },
  { lat: 45.5017, lng: -73.5673, name: 'Montreal' },
  { lat: 49.2827, lng: -123.1207, name: 'Vancouver' },
  { lat: 19.4326, lng: -99.1332, name: 'Mexico City' },
  { lat: 25.7617, lng: -80.1918, name: 'Miami' },
  { lat: 47.6062, lng: -122.3321, name: 'Seattle' },
  // South America
  { lat: -22.9068, lng: -43.1729, name: 'Rio de Janeiro' },
  { lat: -23.5505, lng: -46.6333, name: 'São Paulo' },
  { lat: -34.6037, lng: -58.3816, name: 'Buenos Aires' },
  { lat: -33.4489, lng: -70.6693, name: 'Santiago' },
  { lat: -12.0464, lng: -77.0428, name: 'Lima' },
  { lat: 4.7110,  lng: -74.0721, name: 'Bogotá' },
  { lat: 10.4806, lng: -66.9036, name: 'Caracas' },
  // Oceania / Pacific
  { lat: -33.8688, lng: 151.2093, name: 'Sydney' },
  { lat: -37.8136, lng: 144.9631, name: 'Melbourne' },
  { lat: -36.8485, lng: 174.7633, name: 'Auckland' },
  { lat: 21.3099, lng: -157.8581, name: 'Honolulu' },
  // Polar / extreme
  { lat: 78.2232, lng: 15.6267,  name: 'Longyearbyen' },
  { lat: -54.8019, lng: -68.3030, name: 'Ushuaia' },
];

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
    .ringRepeatPeriod(1200)
    // Country borders — populated after the GeoJSON fetch resolves.
    // Vector overlay stays sharp at any zoom level; transparent fill so the
    // satellite texture shows through.
    .polygonsData([])
    .polygonAltitude(0.005)
    .polygonCapColor(() => 'rgba(0,0,0,0)')
    .polygonSideColor(() => 'rgba(0,0,0,0)')
    .polygonStrokeColor(() => 'rgba(16,241,249,0.55)')
    // City labels
    .labelsData(CITY_LABELS)
    .labelLat('lat')
    .labelLng('lng')
    .labelText('name')
    .labelSize(0.45)
    .labelDotRadius(0.22)
    .labelDotOrientation(() => 'bottom')
    .labelColor(() => 'rgba(255,255,255,0.92)')
    .labelAltitude(0.012)
    .labelResolution(2);

  // Fetch country borders asynchronously so the globe renders immediately.
  fetch(COUNTRIES_GEOJSON_URL)
    .then((r) => r.json())
    .then((geo) => {
      // Skip Antarctica — its polygon spans the whole bottom and looks messy.
      const features = geo.features.filter(
        (f) => f.properties && f.properties.ISO_A2 !== 'AQ'
      );
      globe.polygonsData(features);
    })
    .catch(() => {
      // Borders are a nice-to-have — silently fail if the CDN is down.
    });

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

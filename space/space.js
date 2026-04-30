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
const DEFAULT_RADIUS = 100;

// Vector overlays from Natural Earth via jsdelivr's GitHub mirror. Country
// borders load on init; urban-area + lake polygons load lazily on first
// close-zoom. We dropped state polygons entirely (294 extra meshes for
// modest visual gain) and the urban dataset is filtered down to the larger
// footprints, since each polygon turns into a 3D extruded mesh.
const NE_BASE = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson';
const COUNTRIES_GEOJSON_URL = `${NE_BASE}/ne_110m_admin_0_countries.geojson`;
const URBAN_GEOJSON_URL     = `${NE_BASE}/ne_50m_urban_areas.geojson`;
const LAKES_GEOJSON_URL     = `${NE_BASE}/ne_50m_lakes.geojson`;
const POP_PLACES_URL        = `${NE_BASE}/ne_50m_populated_places.geojson`;
const VECTOR_LOAD_ALTITUDE  = 0.7;
// SCALERANK 0–4 covers ~1,100 cities, 5+ adds smaller towns. Keep up through
// 7 so virtually every urban polygon has a nearby labelled point.
const POP_PLACES_MAX_SCALERANK = 7;
// Dataset has ~2,100 urban polygons globally; only keeping the larger ones
// keeps the per-frame draw count manageable while still showing every city
// you're realistically going to point a satellite at.
const URBAN_MIN_AREA_SQKM   = 200;

// Globe surface texture. Iconic 2K Blue Marble at orbital distance; below
// TEX_DARK_ALTITUDE the texture is replaced by a flat dark sphere so the
// vector overlays are the only thing the eye sees up close.
const GLOBE_TEXTURE = '//unpkg.com/three-globe/example/img/earth-blue-marble.jpg';
const TEX_DARK_ALTITUDE = 0.15;
function buildDarkTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 2; canvas.height = 2;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#040a14';
  ctx.fillRect(0, 0, 2, 2);
  return canvas.toDataURL();
}
const TEX_DARK = buildDarkTexture();

// City prominence tiers. Top tier always visible; mid tier appears when the
// camera drops below the regional altitude threshold; the rest only show on
// close zoom. This keeps the globe legible from afar instead of solid text.
const TIER1_CITIES = new Set([
  // Megacities + globally recognised capitals
  'New York', 'Los Angeles', 'Chicago', 'San Francisco', 'Honolulu',
  'Mexico City', 'Toronto',
  'Rio de Janeiro', 'São Paulo', 'Buenos Aires',
  'London', 'Paris', 'Berlin', 'Madrid', 'Rome', 'Moscow', 'Stockholm',
  'Istanbul', 'Reykjavík',
  'Tokyo', 'Beijing', 'Shanghai', 'Hong Kong', 'Seoul', 'Singapore',
  'Bangkok', 'Mumbai', 'New Delhi', 'Jakarta', 'Dubai', 'Jerusalem',
  'Cairo', 'Lagos', 'Cape Town', 'Johannesburg',
  'Sydney', 'Melbourne', 'Auckland',
]);

const TIER2_CITIES = new Set([
  // Europe
  'Helsinki', 'Oslo', 'Copenhagen', 'Hamburg', 'Munich', 'Frankfurt',
  'Amsterdam', 'Brussels', 'Zurich', 'Vienna', 'Prague', 'Warsaw',
  'Kraków', 'Kyiv', 'St. Petersburg', 'Ankara', 'Athens', 'Lisbon',
  'Barcelona', 'Manchester', 'Edinburgh', 'Dublin', 'Milan', 'Naples',
  // North America
  'Houston', 'Phoenix', 'Denver', 'Las Vegas', 'Seattle', 'Portland',
  'Washington', 'Boston', 'Philadelphia', 'Miami', 'Atlanta', 'Dallas',
  'Detroit', 'Minneapolis', 'Anchorage',
  'Montreal', 'Vancouver', 'Calgary',
  'Havana', 'Panama City', 'San Juan', 'Guatemala City',
  // South America
  'Bogotá', 'Lima', 'La Paz', 'Santiago', 'Brasília', 'Caracas',
  'Montevideo', 'Quito',
  // Asia
  'Osaka', 'Kyoto', 'Taipei', 'Manila', 'Ho Chi Minh City', 'Hanoi',
  'Kuala Lumpur', 'Guangzhou', 'Shenzhen', 'Bangalore', 'Chennai',
  'Kolkata', 'Hyderabad', 'Karachi', 'Lahore', 'Islamabad', 'Tehran',
  'Riyadh', 'Tel Aviv', 'Damascus', 'Beirut', 'Baghdad', 'Kabul',
  'Tashkent', 'Almaty',
  // Africa
  'Casablanca', 'Algiers', 'Tunis', 'Dakar', 'Accra', 'Abuja', 'Nairobi',
  'Addis Ababa', 'Kinshasa', 'Khartoum', 'Pretoria', 'Luanda',
  // Oceania
  'Brisbane', 'Perth', 'Adelaide', 'Wellington',
]);

function cityTier(name) {
  if (TIER1_CITIES.has(name)) return 1;
  if (TIER2_CITIES.has(name)) return 2;
  return 3;
}

// Altitude thresholds: above 1.5 only tier-1; 0.5–1.5 tier-1+2; below 0.5 all.
function citiesForAltitude(altitude) {
  if (altitude > 1.5) return CITY_LABELS.filter((c) => cityTier(c.name) === 1);
  if (altitude > 0.5) return CITY_LABELS.filter((c) => cityTier(c.name) <= 2);
  return CITY_LABELS;
}

// Cities rendered as clickable HTML labels on the globe. Used for both the
// label overlay and the random-preset roulette. ~220 entries, multiple
// cities per major country, geographically distributed.
const CITY_LABELS = [
  // Europe
  { lat: 59.3293, lng: 18.0686,  name: 'Stockholm' },
  { lat: 57.7089, lng: 11.9746,  name: 'Gothenburg' },
  { lat: 55.6050, lng: 13.0038,  name: 'Malmö' },
  { lat: 60.1699, lng: 24.9384,  name: 'Helsinki' },
  { lat: 59.9139, lng: 10.7522,  name: 'Oslo' },
  { lat: 60.3913, lng: 5.3221,   name: 'Bergen' },
  { lat: 55.6761, lng: 12.5683,  name: 'Copenhagen' },
  { lat: 53.5511, lng: 9.9937,   name: 'Hamburg' },
  { lat: 52.5200, lng: 13.4050,  name: 'Berlin' },
  { lat: 48.1351, lng: 11.5820,  name: 'Munich' },
  { lat: 50.9375, lng: 6.9603,   name: 'Cologne' },
  { lat: 50.1109, lng: 8.6821,   name: 'Frankfurt' },
  { lat: 48.8566, lng: 2.3522,   name: 'Paris' },
  { lat: 45.7640, lng: 4.8357,   name: 'Lyon' },
  { lat: 43.2965, lng: 5.3698,   name: 'Marseille' },
  { lat: 51.5074, lng: -0.1278,  name: 'London' },
  { lat: 53.4808, lng: -2.2426,  name: 'Manchester' },
  { lat: 55.9533, lng: -3.1883,  name: 'Edinburgh' },
  { lat: 53.3498, lng: -6.2603,  name: 'Dublin' },
  { lat: 52.3676, lng: 4.9041,   name: 'Amsterdam' },
  { lat: 50.8503, lng: 4.3517,   name: 'Brussels' },
  { lat: 49.6116, lng: 6.1319,   name: 'Luxembourg' },
  { lat: 47.3769, lng: 8.5417,   name: 'Zurich' },
  { lat: 46.2044, lng: 6.1432,   name: 'Geneva' },
  { lat: 48.2082, lng: 16.3738,  name: 'Vienna' },
  { lat: 50.0755, lng: 14.4378,  name: 'Prague' },
  { lat: 47.4979, lng: 19.0402,  name: 'Budapest' },
  { lat: 52.2297, lng: 21.0122,  name: 'Warsaw' },
  { lat: 50.0647, lng: 19.9450,  name: 'Kraków' },
  { lat: 55.7558, lng: 37.6173,  name: 'Moscow' },
  { lat: 59.9311, lng: 30.3609,  name: 'St. Petersburg' },
  { lat: 50.4501, lng: 30.5234,  name: 'Kyiv' },
  { lat: 41.0082, lng: 28.9784,  name: 'Istanbul' },
  { lat: 39.9334, lng: 32.8597,  name: 'Ankara' },
  { lat: 37.9838, lng: 23.7275,  name: 'Athens' },
  { lat: 41.9028, lng: 12.4964,  name: 'Rome' },
  { lat: 45.4642, lng: 9.1900,   name: 'Milan' },
  { lat: 40.8518, lng: 14.2681,  name: 'Naples' },
  { lat: 45.4408, lng: 12.3155,  name: 'Venice' },
  { lat: 43.7696, lng: 11.2558,  name: 'Florence' },
  { lat: 41.3851, lng: 2.1734,   name: 'Barcelona' },
  { lat: 40.4168, lng: -3.7038,  name: 'Madrid' },
  { lat: 37.3886, lng: -5.9823,  name: 'Seville' },
  { lat: 38.7223, lng: -9.1393,  name: 'Lisbon' },
  { lat: 41.1496, lng: -8.6109,  name: 'Porto' },
  { lat: 64.1466, lng: -21.9426, name: 'Reykjavík' },

  // North America
  { lat: 40.7128, lng: -74.0060, name: 'New York' },
  { lat: 34.0522, lng: -118.2437, name: 'Los Angeles' },
  { lat: 41.8781, lng: -87.6298, name: 'Chicago' },
  { lat: 29.7604, lng: -95.3698, name: 'Houston' },
  { lat: 33.4484, lng: -112.0740, name: 'Phoenix' },
  { lat: 39.7392, lng: -104.9903, name: 'Denver' },
  { lat: 36.1699, lng: -115.1398, name: 'Las Vegas' },
  { lat: 32.7157, lng: -117.1611, name: 'San Diego' },
  { lat: 37.7749, lng: -122.4194, name: 'San Francisco' },
  { lat: 47.6062, lng: -122.3321, name: 'Seattle' },
  { lat: 45.5152, lng: -122.6784, name: 'Portland' },
  { lat: 38.9072, lng: -77.0369, name: 'Washington' },
  { lat: 42.3601, lng: -71.0589, name: 'Boston' },
  { lat: 39.9526, lng: -75.1652, name: 'Philadelphia' },
  { lat: 25.7617, lng: -80.1918, name: 'Miami' },
  { lat: 28.5383, lng: -81.3792, name: 'Orlando' },
  { lat: 33.7490, lng: -84.3880, name: 'Atlanta' },
  { lat: 30.2672, lng: -97.7431, name: 'Austin' },
  { lat: 32.7767, lng: -96.7970, name: 'Dallas' },
  { lat: 29.4241, lng: -98.4936, name: 'San Antonio' },
  { lat: 36.1627, lng: -86.7816, name: 'Nashville' },
  { lat: 42.3314, lng: -83.0458, name: 'Detroit' },
  { lat: 44.9778, lng: -93.2650, name: 'Minneapolis' },
  { lat: 40.7608, lng: -111.8910, name: 'Salt Lake City' },
  { lat: 21.3099, lng: -157.8581, name: 'Honolulu' },
  { lat: 61.2181, lng: -149.9003, name: 'Anchorage' },
  { lat: 64.8401, lng: -147.7200, name: 'Fairbanks' },
  { lat: 43.6532, lng: -79.3832, name: 'Toronto' },
  { lat: 45.5017, lng: -73.5673, name: 'Montreal' },
  { lat: 49.2827, lng: -123.1207, name: 'Vancouver' },
  { lat: 51.0447, lng: -114.0719, name: 'Calgary' },
  { lat: 53.5461, lng: -113.4938, name: 'Edmonton' },
  { lat: 45.4215, lng: -75.6972, name: 'Ottawa' },
  { lat: 46.8139, lng: -71.2080, name: 'Québec City' },
  { lat: 19.4326, lng: -99.1332, name: 'Mexico City' },
  { lat: 20.6597, lng: -103.3496, name: 'Guadalajara' },
  { lat: 25.6866, lng: -100.3161, name: 'Monterrey' },
  { lat: 21.1619, lng: -86.8515, name: 'Cancún' },
  { lat: 23.1136, lng: -82.3666, name: 'Havana' },
  { lat: 18.4861, lng: -69.9312, name: 'Santo Domingo' },
  { lat: 18.4655, lng: -66.1057, name: 'San Juan' },
  { lat: 14.6349, lng: -90.5069, name: 'Guatemala City' },
  { lat: 9.9281,  lng: -84.0907, name: 'San José' },
  { lat: 8.9824,  lng: -79.5199, name: 'Panama City' },

  // South America
  { lat: 4.7110,  lng: -74.0721, name: 'Bogotá' },
  { lat: 6.2476,  lng: -75.5658, name: 'Medellín' },
  { lat: 10.9685, lng: -74.7813, name: 'Barranquilla' },
  { lat: -12.0464, lng: -77.0428, name: 'Lima' },
  { lat: -13.5319, lng: -71.9675, name: 'Cuzco' },
  { lat: -16.5000, lng: -68.1500, name: 'La Paz' },
  { lat: -33.4489, lng: -70.6693, name: 'Santiago' },
  { lat: -34.6037, lng: -58.3816, name: 'Buenos Aires' },
  { lat: -31.4201, lng: -64.1888, name: 'Córdoba' },
  { lat: -34.9011, lng: -56.1645, name: 'Montevideo' },
  { lat: -25.2637, lng: -57.5759, name: 'Asunción' },
  { lat: -22.9068, lng: -43.1729, name: 'Rio de Janeiro' },
  { lat: -23.5505, lng: -46.6333, name: 'São Paulo' },
  { lat: -15.7942, lng: -47.8822, name: 'Brasília' },
  { lat: -3.7172,  lng: -38.5434, name: 'Fortaleza' },
  { lat: -8.0476,  lng: -34.8770, name: 'Recife' },
  { lat: -12.9777, lng: -38.5016, name: 'Salvador' },
  { lat: -3.1190,  lng: -60.0217, name: 'Manaus' },
  { lat: -25.4284, lng: -49.2733, name: 'Curitiba' },
  { lat: -30.0346, lng: -51.2177, name: 'Porto Alegre' },
  { lat: 0.1807,   lng: -78.4678, name: 'Quito' },
  { lat: -2.1894,  lng: -79.8891, name: 'Guayaquil' },
  { lat: 10.4806,  lng: -66.9036, name: 'Caracas' },
  { lat: -54.8019, lng: -68.3030, name: 'Ushuaia' },

  // Asia
  { lat: 35.6762, lng: 139.6503, name: 'Tokyo' },
  { lat: 34.6937, lng: 135.5023, name: 'Osaka' },
  { lat: 35.0116, lng: 135.7681, name: 'Kyoto' },
  { lat: 43.0618, lng: 141.3545, name: 'Sapporo' },
  { lat: 33.5904, lng: 130.4017, name: 'Fukuoka' },
  { lat: 37.5665, lng: 126.9780, name: 'Seoul' },
  { lat: 35.1796, lng: 129.0756, name: 'Busan' },
  { lat: 39.0392, lng: 125.7625, name: 'Pyongyang' },
  { lat: 39.9042, lng: 116.4074, name: 'Beijing' },
  { lat: 31.2304, lng: 121.4737, name: 'Shanghai' },
  { lat: 23.1291, lng: 113.2644, name: 'Guangzhou' },
  { lat: 22.5431, lng: 114.0579, name: 'Shenzhen' },
  { lat: 22.3193, lng: 114.1694, name: 'Hong Kong' },
  { lat: 30.5728, lng: 104.0668, name: 'Chengdu' },
  { lat: 29.5630, lng: 106.5516, name: 'Chongqing' },
  { lat: 32.0603, lng: 118.7969, name: 'Nanjing' },
  { lat: 34.3416, lng: 108.9398, name: "Xi'an" },
  { lat: 25.0330, lng: 121.5654, name: 'Taipei' },
  { lat: 1.3521,  lng: 103.8198, name: 'Singapore' },
  { lat: 3.1390,  lng: 101.6869, name: 'Kuala Lumpur' },
  { lat: 13.7563, lng: 100.5018, name: 'Bangkok' },
  { lat: 18.7883, lng: 98.9853,  name: 'Chiang Mai' },
  { lat: 21.0285, lng: 105.8542, name: 'Hanoi' },
  { lat: 10.7626, lng: 106.6602, name: 'Ho Chi Minh City' },
  { lat: 11.5564, lng: 104.9282, name: 'Phnom Penh' },
  { lat: 14.5995, lng: 120.9842, name: 'Manila' },
  { lat: 10.3157, lng: 123.8854, name: 'Cebu' },
  { lat: -6.2088, lng: 106.8456, name: 'Jakarta' },
  { lat: -8.6500, lng: 115.2167, name: 'Denpasar' },
  { lat: 16.8409, lng: 96.1735,  name: 'Yangon' },
  { lat: 23.8103, lng: 90.4125,  name: 'Dhaka' },
  { lat: 27.7172, lng: 85.3240,  name: 'Kathmandu' },
  { lat: 28.6139, lng: 77.2090,  name: 'New Delhi' },
  { lat: 19.0760, lng: 72.8777,  name: 'Mumbai' },
  { lat: 12.9716, lng: 77.5946,  name: 'Bangalore' },
  { lat: 13.0827, lng: 80.2707,  name: 'Chennai' },
  { lat: 22.5726, lng: 88.3639,  name: 'Kolkata' },
  { lat: 17.3850, lng: 78.4867,  name: 'Hyderabad' },
  { lat: 26.9124, lng: 75.7873,  name: 'Jaipur' },
  { lat: 27.1751, lng: 78.0421,  name: 'Agra' },
  { lat: 6.9271,  lng: 79.8612,  name: 'Colombo' },
  { lat: 24.8607, lng: 67.0011,  name: 'Karachi' },
  { lat: 31.5497, lng: 74.3436,  name: 'Lahore' },
  { lat: 33.6844, lng: 73.0479,  name: 'Islamabad' },
  { lat: 34.5553, lng: 69.2075,  name: 'Kabul' },
  { lat: 35.6892, lng: 51.3890,  name: 'Tehran' },
  { lat: 41.3111, lng: 69.2401,  name: 'Tashkent' },
  { lat: 51.1605, lng: 71.4704,  name: 'Astana' },
  { lat: 43.2389, lng: 76.8897,  name: 'Almaty' },
  { lat: 25.2048, lng: 55.2708,  name: 'Dubai' },
  { lat: 24.4539, lng: 54.3773,  name: 'Abu Dhabi' },
  { lat: 24.7136, lng: 46.6753,  name: 'Riyadh' },
  { lat: 21.4858, lng: 39.1925,  name: 'Jeddah' },
  { lat: 21.4225, lng: 39.8262,  name: 'Mecca' },
  { lat: 33.3152, lng: 44.3661,  name: 'Baghdad' },
  { lat: 33.5138, lng: 36.2765,  name: 'Damascus' },
  { lat: 33.8938, lng: 35.5018,  name: 'Beirut' },
  { lat: 31.7683, lng: 35.2137,  name: 'Jerusalem' },
  { lat: 32.0853, lng: 34.7818,  name: 'Tel Aviv' },
  { lat: 31.9454, lng: 35.9284,  name: 'Amman' },

  // Africa
  { lat: 30.0444, lng: 31.2357,  name: 'Cairo' },
  { lat: 31.2001, lng: 29.9187,  name: 'Alexandria' },
  { lat: 36.7538, lng: 3.0588,   name: 'Algiers' },
  { lat: 36.8065, lng: 10.1815,  name: 'Tunis' },
  { lat: 33.5731, lng: -7.5898,  name: 'Casablanca' },
  { lat: 34.0209, lng: -6.8417,  name: 'Rabat' },
  { lat: 31.6295, lng: -7.9811,  name: 'Marrakesh' },
  { lat: 14.7167, lng: -17.4677, name: 'Dakar' },
  { lat: 12.6392, lng: -8.0029,  name: 'Bamako' },
  { lat: 5.5600,  lng: -0.1969,  name: 'Accra' },
  { lat: 6.5244,  lng: 3.3792,   name: 'Lagos' },
  { lat: 9.0765,  lng: 7.3986,   name: 'Abuja' },
  { lat: 3.8480,  lng: 11.5021,  name: 'Yaoundé' },
  { lat: -4.4419, lng: 15.2663,  name: 'Kinshasa' },
  { lat: 0.3476,  lng: 32.5825,  name: 'Kampala' },
  { lat: -1.2921, lng: 36.8219,  name: 'Nairobi' },
  { lat: -6.7924, lng: 39.2083,  name: 'Dar es Salaam' },
  { lat: -1.9706, lng: 30.1044,  name: 'Kigali' },
  { lat: 9.0145,  lng: 38.7613,  name: 'Addis Ababa' },
  { lat: 15.5527, lng: 32.5599,  name: 'Khartoum' },
  { lat: -8.8390, lng: 13.2894,  name: 'Luanda' },
  { lat: -17.8252, lng: 31.0335, name: 'Harare' },
  { lat: -15.4067, lng: 28.2871, name: 'Lusaka' },
  { lat: -25.7479, lng: 28.2293, name: 'Pretoria' },
  { lat: -26.2041, lng: 28.0473, name: 'Johannesburg' },
  { lat: -29.8587, lng: 31.0218, name: 'Durban' },
  { lat: -33.9249, lng: 18.4241, name: 'Cape Town' },
  { lat: -22.5597, lng: 17.0832, name: 'Windhoek' },
  { lat: -18.8792, lng: 47.5079, name: 'Antananarivo' },

  // Oceania
  { lat: -33.8688, lng: 151.2093, name: 'Sydney' },
  { lat: -37.8136, lng: 144.9631, name: 'Melbourne' },
  { lat: -27.4705, lng: 153.0260, name: 'Brisbane' },
  { lat: -31.9505, lng: 115.8605, name: 'Perth' },
  { lat: -34.9285, lng: 138.6007, name: 'Adelaide' },
  { lat: -35.2809, lng: 149.1300, name: 'Canberra' },
  { lat: -36.8485, lng: 174.7633, name: 'Auckland' },
  { lat: -41.2865, lng: 174.7762, name: 'Wellington' },
  { lat: -43.5321, lng: 172.6362, name: 'Christchurch' },
  { lat: -17.7333, lng: 168.3273, name: 'Port Vila' },
  { lat: -18.1416, lng: 178.4419, name: 'Suva' },

  // Polar / extreme
  { lat: 78.2232, lng: 15.6267,  name: 'Longyearbyen' },
  { lat: 69.6492, lng: 18.9553,  name: 'Tromsø' },
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

// 1° of latitude = ~111.32 km. We use this to convert the captured image's
// half-side (in km) into degrees on the sphere for the ring radius.
const KM_PER_DEG = 111.32;

// What does the captured image actually cover, in degrees? At zoom Z and
// latitude L, Mapbox's 512×512@2x tile spans 512 logical pixels of
// metersPerPixel(L,Z) each, so half the side is the natural radius for the
// pink ring to indicate "this is what gets photographed".
function captureHalfSideDeg(lat, sliderRadiusKm) {
  const zoom = clampZoom(estimateZoomForRadiusKm(Math.max(sliderRadiusKm, 0.5)));
  const halfSideMeters = 256 * metersPerPixel(lat, zoom);
  return halfSideMeters / 1000 / KM_PER_DEG;
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
const resultPanel   = document.querySelector('.result');
const globeHint     = document.querySelector('.globe-hint');

const metaCoords     = document.getElementById('meta-coords');
const metaZoom       = document.getElementById('meta-zoom');
const metaResolution = document.getElementById('meta-resolution');
const metaSide       = document.getElementById('meta-side');
const metaArea       = document.getElementById('meta-area');
const metaTime       = document.getElementById('meta-time');
const metaSun        = document.getElementById('meta-sun');
const metaSolarTime  = document.getElementById('meta-solar-time');
const metaAntipode   = document.getElementById('meta-antipode');
const metaSource     = document.getElementById('meta-source');
const sourceInfoBtn   = document.getElementById('source-info-btn');
const sourceInfoPopup = document.getElementById('source-info-popup');
const sourceInfoBody  = document.getElementById('source-info-body');
const sourceInfoClose = document.getElementById('source-info-close');

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
// Target selection — sets coords + visual marker without triggering capture.
// Capture only happens when the user explicitly hits the CAPTURE button.
// ---------------------------------------------------------------------------
function updateTargetMarker() {
  if (!globe) return;
  const lat = parseFloat(latInput.value);
  const lng = parseFloat(lonInput.value);
  const sliderKm = parseFloat(radiusInput.value);
  if (isNaN(lat) || isNaN(lng) || isNaN(sliderKm)) return;
  const radiusDeg = captureHalfSideDeg(lat, sliderKm);
  // Both the static disc (pointsData) and the radar pulse (ringsData) read
  // their size from the same per-feature radiusDeg, so slider/disc/ring/image
  // are all describing the same area.
  globe.pointsData([{ lat, lng, radiusDeg }]);
  globe.ringsData([{ lat, lng, radiusDeg }]);
}

function dismissHeader() {
  const header = document.querySelector('.space-header');
  if (header) header.classList.add('dismissed');
}

function setTarget(lat, lng) {
  latInput.value = lat.toFixed(6);
  lonInput.value = lng.toFixed(6);
  syncHud();
  globeStatus.textContent = 'TARGET LOCKED';
  updateTargetMarker();
  dismissHeader();
}

// ---------------------------------------------------------------------------
// Radius slider live readout
// ---------------------------------------------------------------------------
radiusInput.addEventListener('input', () => {
  radiusValue.textContent = radiusInput.value;
  updateTargetMarker();
});

// ---------------------------------------------------------------------------
// "Likely source" explainer popup
// ---------------------------------------------------------------------------
function buildSourceInfoHtml() {
  const lat = parseFloat(latInput.value);
  const lng = parseFloat(lonInput.value);
  const sliderKm = parseFloat(radiusInput.value);
  if (isNaN(lat) || isNaN(lng) || isNaN(sliderKm)) {
    return 'Pick a target first to see the example.';
  }
  const zoom = clampZoom(estimateZoomForRadiusKm(Math.max(sliderKm, 0.5)));
  const city = closestCityName(lat, lng);
  const placeStr = city
    ? `your current capture near <strong>${city}</strong>`
    : `your current target at <strong>${formatLatLng(lat, lng)}</strong>`;
  const source = likelyImagerySource(zoom);
  const band = zoomBandLabel(zoom);
  return (
    `Mapbox's <strong>satellite-v9</strong> tileset is a composite — they ` +
    `stitch imagery from several satellites, picking different providers ` +
    `depending on zoom level and region, and they don't publish which ` +
    `satellite shot any specific tile. ` +
    `For ${placeStr} at zoom z${zoom} (${band}), the band is typically ` +
    `backed by <strong>${source}</strong>.`
  );
}

function openSourceInfo() {
  sourceInfoBody.innerHTML = buildSourceInfoHtml();
  sourceInfoPopup.hidden = false;
}

function closeSourceInfo() {
  sourceInfoPopup.hidden = true;
}

if (sourceInfoBtn) {
  sourceInfoBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (sourceInfoPopup.hidden) openSourceInfo();
    else closeSourceInfo();
  });
}
if (sourceInfoClose) {
  sourceInfoClose.addEventListener('click', (e) => {
    e.stopPropagation();
    closeSourceInfo();
  });
}
// Click anywhere outside the popup or the button to dismiss.
document.addEventListener('click', (e) => {
  if (sourceInfoPopup.hidden) return;
  if (sourceInfoPopup.contains(e.target)) return;
  if (e.target === sourceInfoBtn) return;
  closeSourceInfo();
});
// Keep text in sync if the user changes target/radius while the popup is open.
[latInput, lonInput, radiusInput].forEach((el) => {
  el.addEventListener('input', () => {
    if (!sourceInfoPopup.hidden) sourceInfoBody.innerHTML = buildSourceInfoHtml();
  });
});

// ---------------------------------------------------------------------------
// Metadata extras: solar position, local solar time, antipode
// ---------------------------------------------------------------------------

// NOAA-style approximation of the sun's elevation (degrees above horizon)
// at a given lat/lng/UTC date. Good to within ~0.5° — fine for a vibes-y
// "is it day or night where this picture was just taken" readout.
function solarElevationDeg(lat, lng, date) {
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = (date.getTime() - startOfYear) / 86400000;
  const decl = 23.45 * Math.sin((2 * Math.PI * (dayOfYear - 81)) / 365);
  const utcHour = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const localSolarHour = utcHour + lng / 15;
  const hourAngle = (localSolarHour - 12) * 15;
  const toRad = Math.PI / 180;
  const sinElev =
    Math.sin(lat * toRad) * Math.sin(decl * toRad) +
    Math.cos(lat * toRad) * Math.cos(decl * toRad) * Math.cos(hourAngle * toRad);
  return Math.asin(Math.max(-1, Math.min(1, sinElev))) / toRad;
}

function describeSun(elevDeg) {
  if (elevDeg >= 6)  return `Day · ${elevDeg.toFixed(1)}° above horizon`;
  if (elevDeg >= 0)  return `Sunrise/sunset · ${elevDeg.toFixed(1)}° above`;
  if (elevDeg >= -6) return `Civil twilight · ${(-elevDeg).toFixed(1)}° below`;
  if (elevDeg >= -18) return `Astronomical twilight · ${(-elevDeg).toFixed(1)}° below`;
  return `Night · ${(-elevDeg).toFixed(1)}° below`;
}

// Solar mean time at the given longitude — rough, ignores equation of time.
function localSolarTime(lng, date) {
  const utcMs = date.getTime();
  const offsetMs = (lng / 15) * 3600 * 1000;
  const local = new Date(utcMs + offsetMs);
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const mm = String(local.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm} (LMT)`;
}

function antipode(lat, lng) {
  let aLng = lng + 180;
  if (aLng > 180) aLng -= 360;
  if (aLng < -180) aLng += 360;
  return { lat: -lat, lng: aLng };
}

// Mapbox satellite-v9 is a composite — they don't expose per-tile satellite
// metadata, but their docs publish the typical source by zoom band:
// https://docs.mapbox.com/data/tilesets/reference/mapbox-satellite/
function likelyImagerySource(zoom) {
  if (zoom <= 5)  return 'NASA MODIS / Blue Marble';
  if (zoom <= 9)  return 'Landsat 8 (USGS)';
  if (zoom <= 12) return 'Sentinel-2 (ESA) + Landsat';
  if (zoom <= 16) return 'Maxar Vivid';
  return 'Maxar Vivid HD';
}

function zoomBandLabel(zoom) {
  if (zoom <= 5)  return 'global scale';
  if (zoom <= 9)  return 'continental scale';
  if (zoom <= 12) return 'regional scale';
  if (zoom <= 16) return 'city scale';
  return 'street scale';
}

// Closest curated city to a lat/lng — used so the source-info popup can say
// "your capture near Bogotá" instead of just spitting out coordinates.
function closestCityName(lat, lng) {
  let best = null;
  let bestDistSq = Infinity;
  const cosLat = Math.cos(lat * Math.PI / 180);
  for (const c of CITY_LABELS) {
    const dLat = c.lat - lat;
    let dLng = c.lng - lng;
    if (dLng > 180)  dLng -= 360;
    if (dLng < -180) dLng += 360;
    const distSq = dLat * dLat + (dLng * cosLat) ** 2;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = c.name;
    }
  }
  return Math.sqrt(bestDistSq) < 3 ? best : null;
}

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

  const now = new Date();
  const elev = solarElevationDeg(lat, lon, now);
  const ant = antipode(lat, lon);

  metaCoords.textContent     = formatLatLng(lat, lon);
  metaZoom.textContent       = `z${zoom} · 512×512 @2x`;
  metaSource.textContent     = likelyImagerySource(zoom);
  metaResolution.textContent = formatResolution(displayMpp);
  metaSide.textContent       = `${formatLength(sideMeters)} × ${formatLength(sideMeters)}`;
  metaArea.textContent       = formatArea(areaM2);
  metaSun.textContent        = describeSun(elev);
  metaSolarTime.textContent  = localSolarTime(lon, now);
  metaAntipode.textContent   = formatLatLng(ant.lat, ant.lng);
  metaTime.textContent       = now.toLocaleString();

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

  // Reveal the result panel on first capture, hide the onboarding hint.
  if (resultPanel) resultPanel.classList.add('visible');
  if (globeHint)   globeHint.classList.add('hidden');

  // Update globe marker and ring to the current target
  updateTargetMarker();

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
    let lat;
    let lng;
    let radius;
    if (btn.dataset.random === 'true') {
      const pick = CITY_LABELS[Math.floor(Math.random() * CITY_LABELS.length)];
      lat = pick.lat;
      lng = pick.lng;
      radius = 5;
    } else {
      lat = parseFloat(btn.dataset.lat);
      lng = parseFloat(btn.dataset.lon);
      radius = parseFloat(btn.dataset.radius);
    }

    radiusInput.value       = String(radius);
    radiusValue.textContent = String(radius);
    setTarget(lat, lng);

    if (globe) {
      globe.pointOfView({ lat, lng, altitude: 0.06 }, 1200);
      setTimeout(() => globe._refreshAfterFlight && globe._refreshAfterFlight(), 1300);
    }
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
    .globeImageUrl(GLOBE_TEXTURE)
    .bumpImageUrl('//unpkg.com/three-globe/example/img/earth-topology.png')
    .backgroundColor('rgba(0,0,0,0)')
    .showAtmosphere(true)
    .atmosphereColor('#5fc1ff')
    .atmosphereAltitude(0.18)
    .width(container.clientWidth)
    .height(container.clientHeight)
    // Target marker — semi-transparent disc whose radius matches the capture
    // half-side, so the user gets a visible footprint of what the next image
    // will cover. Lifted slightly above the polygon stack to stay visible.
    .pointAltitude(0.012)
    .pointRadius((d) => d.radiusDeg)
    .pointColor(() => 'rgba(255, 58, 140, 0.45)')
    // Pulsing ring — altitude bumped above the polygon overlays (0.005–0.008)
    // so country borders, urban areas, and lakes can't depth-occlude it even
    // when their caps are transparent. Radius and propagation speed read off
    // each ring's own `radiusDeg`, set by updateTargetMarker() to match the
    // half-side of the captured image. So the pulse fans out exactly to the
    // edge of what the next CAPTURE will photograph.
    .ringAltitude(0.012)
    .ringColor(() => 'rgba(255,58,140,0.8)')
    .ringMaxRadius((d) => d.radiusDeg)
    .ringPropagationSpeed((d) => Math.max(d.radiusDeg / 1.2, 0.005))
    .ringRepeatPeriod(1500)
    // Vector overlays. Country borders load on init; states + urban areas +
    // lakes lazy-load on first close-zoom. All features carry a `_kind`
    // property so the polygon style callbacks render each layer differently.
    .polygonsData([])
    .polygonAltitude((d) => {
      // Stack altitudes so urban sits above country outlines, lakes below,
      // to avoid z-fighting on the extruded caps.
      switch (d._kind) {
        case 'urban':   return 0.008;
        case 'lake':    return 0.004;
        case 'country': return 0.005;
        default:        return 0.005;
      }
    })
    .polygonCapColor((d) => {
      // Filled = visible polygon body (cap is the top face of the extrusion).
      switch (d._kind) {
        case 'urban': return 'rgba(255, 200, 80, 0.22)';
        case 'lake':  return 'rgba(40, 140, 220, 0.35)';
        default:      return 'rgba(0,0,0,0)';
      }
    })
    .polygonSideColor(() => 'rgba(0,0,0,0)')
    .polygonStrokeColor((d) => {
      switch (d._kind) {
        case 'urban':   return 'rgba(255, 200, 80, 0.85)';
        case 'lake':    return 'rgba(70, 180, 255, 0.7)';
        case 'country': return 'rgba(16, 241, 249, 0.6)';
        default:        return 'rgba(0,0,0,0)';
      }
    })
    // City labels as DOM elements. WebGL-rendered labels use a default
    // typeface that lacks extended Latin glyphs (so 'Bogotá' became 'Bogot?');
    // HTML labels inherit the page's CSS font and support all Unicode.
    // Each element also gets its own click handler — clicking the label
    // snaps to the city's exact coordinates instead of relying on the
    // sphere raycast hitting the right pixel.
    // Initial label set is the top tier only (matches default altitude 1.8).
    // The onZoom listener swaps in the larger tier sets as the camera drops.
    .htmlElementsData(citiesForAltitude(1.8))
    .htmlLat('lat')
    .htmlLng('lng')
    .htmlAltitude(0.012)
    .htmlElement((d) => {
      const el = document.createElement('div');
      el.className = 'globe-city-label';
      el.title = `Lock target on ${d.name} and zoom in`;
      const dot = document.createElement('span');
      dot.className = 'city-dot';
      const name = document.createElement('span');
      name.className = 'city-name';
      name.textContent = d.name;
      el.appendChild(dot);
      el.appendChild(name);
      // Clicking a label locks the target and flies the camera in close
      // enough that the user can pick a more precise spot inside the city.
      // Capture only happens when they hit the CAPTURE button.
      el.addEventListener('click', (event) => {
        event.stopPropagation();
        setTarget(d.lat, d.lng);
        loadDetailLayers(); // start fetching detail data immediately
        globe.pointOfView({ lat: d.lat, lng: d.lng, altitude: 0.06 }, 1200);
        // Force a refresh once the flight settles.
        setTimeout(() => globe._refreshAfterFlight && globe._refreshAfterFlight(), 1300);
      });
      return el;
    });

  // Tagged feature buckets. Country borders load now; urban + lakes are lazy.
  // Each feature is augmented with a centroid so we can do a cheap spatial
  // filter (only render polygons within angular range of the camera).
  const polyBuckets = { country: [], urban: [], lake: [] };

  function bboxCentroid(geometry) {
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    const visit = (a) => {
      if (typeof a[0] === 'number') {
        if (a[0] < minLng) minLng = a[0];
        if (a[0] > maxLng) maxLng = a[0];
        if (a[1] < minLat) minLat = a[1];
        if (a[1] > maxLat) maxLat = a[1];
      } else {
        for (const x of a) visit(x);
      }
    };
    visit(geometry.coordinates);
    return [(minLat + maxLat) / 2, (minLng + maxLng) / 2];
  }

  function tagFeature(feature, kind) {
    const [lat, lng] = bboxCentroid(feature.geometry);
    return { ...feature, _kind: kind, _lat: lat, _lng: lng };
  }

  // Spatial filter: only keep features whose centroid sits within radiusDeg
  // of the camera's pointOfView. Country outlines stay always-visible since
  // there are only ~250 of them and they're the orientation backbone.
  function filterToView(features, centerLat, centerLng, radiusDeg) {
    if (radiusDeg >= 360) return features;
    const cosLat = Math.cos(centerLat * Math.PI / 180);
    return features.filter((f) => {
      const dLat = f._lat - centerLat;
      let dLng = f._lng - centerLng;
      if (dLng > 180)  dLng -= 360;
      if (dLng < -180) dLng += 360;
      const ang = Math.sqrt(dLat * dLat + (dLng * cosLat) ** 2);
      return ang < radiusDeg;
    });
  }

  let lastFilterKey = '';
  function refreshPolygons() {
    const pov = globe.pointOfView();
    // Wider radius at higher altitude; tighter when zoomed in close.
    const radiusDeg =
      pov.altitude > 1.0 ? 360 :
      pov.altitude > 0.4 ? 60 :
      pov.altitude > 0.15 ? 25 :
      12;
    // Cheap stability key so we don't re-filter on every animation frame.
    const key = `${radiusDeg}|${pov.lat.toFixed(1)}|${pov.lng.toFixed(1)}|${polyBuckets.urban.length}|${polyBuckets.lake.length}|${polyBuckets.country.length}`;
    if (key === lastFilterKey) return;
    lastFilterKey = key;
    // Country borders also get spatially filtered at close zoom — at
    // altitude < 0.5 there are at most a handful in view, no point paying
    // for ~250 extruded meshes globally.
    const countries = pov.altitude > 0.5
      ? polyBuckets.country
      : filterToView(polyBuckets.country, pov.lat, pov.lng, radiusDeg);
    globe.polygonsData([
      ...countries,
      ...filterToView(polyBuckets.lake,  pov.lat, pov.lng, radiusDeg),
      ...filterToView(polyBuckets.urban, pov.lat, pov.lng, radiusDeg),
    ]);
  }

  fetch(COUNTRIES_GEOJSON_URL)
    .then((r) => r.json())
    .then((geo) => {
      // Skip Antarctica — its polygon spans the whole bottom and looks messy.
      polyBuckets.country = geo.features
        .filter((f) => f.properties && f.properties.ISO_A2 !== 'AQ')
        .map((f) => tagFeature(f, 'country'));
      refreshPolygons();
    })
    .catch(() => {});

  // Populated places — used as the close-zoom label layer so every urban
  // polygon gets a name from a nearby labelled point. Stored as
  // {lat, lng, name} so the existing htmlElement renderer works unchanged.
  let popPlaces = [];

  function filterPointsToView(points, centerLat, centerLng, radiusDeg) {
    if (radiusDeg >= 360) return points;
    const cosLat = Math.cos(centerLat * Math.PI / 180);
    return points.filter((p) => {
      const dLat = p.lat - centerLat;
      let dLng = p.lng - centerLng;
      if (dLng > 180)  dLng -= 360;
      if (dLng < -180) dLng += 360;
      const ang = Math.sqrt(dLat * dLat + (dLng * cosLat) ** 2);
      return ang < radiusDeg;
    });
  }

  let lastLabelKey = '';
  function refreshLabels() {
    const pov = globe.pointOfView();
    let labels;
    let key;
    if (pov.altitude > 0.5) {
      // Far/medium: curated tiered set, no spatial cull (small lists).
      labels = citiesForAltitude(pov.altitude);
      key = `tier|${labels.length}`;
    } else {
      // Close: combine curated CITY_LABELS (so megacities never disappear)
      // with the populated-places dataset for richer regional context, all
      // spatially filtered. Wider radius than the polygon cull because labels
      // are cheap (DOM elements; globe.gl auto-hides backside ones).
      const radiusDeg = pov.altitude > 0.15 ? 45 : 25;
      const curatedInView = filterPointsToView(
        CITY_LABELS, pov.lat, pov.lng, radiusDeg
      );
      const seen = new Set(curatedInView.map((c) => c.name));
      const popInView = popPlaces.length
        ? filterPointsToView(popPlaces, pov.lat, pov.lng, radiusDeg)
            .filter((p) => p.name && !seen.has(p.name))
        : [];
      labels = [...curatedInView, ...popInView];
      key = `near|${pov.lat.toFixed(1)}|${pov.lng.toFixed(1)}|${radiusDeg}|${labels.length}|${popPlaces.length}`;
    }
    if (key === lastLabelKey) return;
    lastLabelKey = key;
    globe.htmlElementsData(labels);
  }

  // One-shot lazy loaders for the close-zoom layers.
  const lazyLoaded = { urban: false, lake: false, pop: false };
  function loadDetailLayers() {
    if (!lazyLoaded.urban) {
      lazyLoaded.urban = true;
      fetch(URBAN_GEOJSON_URL)
        .then((r) => r.json())
        .then((geo) => {
          polyBuckets.urban = geo.features
            .filter((f) => (f.properties && f.properties.area_sqkm) >= URBAN_MIN_AREA_SQKM)
            .map((f) => tagFeature(f, 'urban'));
          lastFilterKey = ''; // force re-filter
          // Route through the debounced path: a fly-in fetch could resolve
          // mid-animation, and uploading polygons synchronously would
          // freeze the camera tween.
          scheduleHeavyRefresh();
        })
        .catch(() => { lazyLoaded.urban = false; });
    }
    if (!lazyLoaded.lake) {
      lazyLoaded.lake = true;
      fetch(LAKES_GEOJSON_URL)
        .then((r) => r.json())
        .then((geo) => {
          polyBuckets.lake = geo.features.map((f) => tagFeature(f, 'lake'));
          lastFilterKey = '';
          scheduleHeavyRefresh();
        })
        .catch(() => { lazyLoaded.lake = false; });
    }
    if (!lazyLoaded.pop) {
      lazyLoaded.pop = true;
      fetch(POP_PLACES_URL)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((geo) => {
          popPlaces = geo.features
            .filter((f) =>
              f.properties &&
              typeof f.properties.SCALERANK === 'number' &&
              f.properties.SCALERANK <= POP_PLACES_MAX_SCALERANK
            )
            .map((f) => ({
              lat: f.geometry.coordinates[1],
              lng: f.geometry.coordinates[0],
              name: f.properties.NAME || f.properties.NAMEASCII || '',
            }));
          lastLabelKey = ''; // force re-render of labels
          scheduleHeavyRefresh();
        })
        .catch((err) => {
          console.error('[space] populated-places fetch failed:', err);
          lazyLoaded.pop = false;
        });
    }
  }

  // Slow idle rotation
  globe.controls().autoRotate      = true;
  globe.controls().autoRotateSpeed = 0.4;

  // Stop rotation on any user interaction with the globe
  container.addEventListener('mousedown',  () => { globe.controls().autoRotate = false; });
  container.addEventListener('touchstart', () => { globe.controls().autoRotate = false; }, { passive: true });

  // Drop initial marker on default Stockholm coords
  updateTargetMarker();
  globe.pointOfView({ lat: DEFAULT_LAT, lng: DEFAULT_LON, altitude: 1.8 });

  // Globe click → set the target and update marker/ring. Capture is a
  // separate explicit action — the user hits CAPTURE when they're ready.
  globe.onGlobeClick(({ lat, lng }) => {
    setTarget(lat, lng);
  });

  // Polygons (country borders, urban areas, lakes) are 3D meshes above the
  // sphere, so when the user clicks on land their click hits the polygon
  // before reaching the globe sphere — onGlobeClick never fires. Register
  // onPolygonClick to forward those clicks to the same setTarget code,
  // using the globe-projected click point so the target lands exactly
  // where the cursor was, not at the polygon's centroid.
  globe.onPolygonClick((polygon, event) => {
    if (event && typeof globe.toGlobeCoords === 'function') {
      const coords = globe.toGlobeCoords(event.clientX, event.clientY);
      if (coords && !isNaN(coords.lat) && !isNaN(coords.lng)) {
        setTarget(coords.lat, coords.lng);
        return;
      }
    }
    if (polygon && typeof polygon._lat === 'number') {
      setTarget(polygon._lat, polygon._lng);
    }
  });

  // Disable the per-layer fade-in/out tweens — the user wants the disc and
  // ring to track the radius slider in real time. globe.gl's defaults
  // animate over ~1 s, which feels laggy especially when polygons occlude
  // the cylinder mid-transition. Feature-detected so missing methods don't
  // break the page.
  if (typeof globe.pointsTransitionDuration === 'function') {
    globe.pointsTransitionDuration(0);
  }
  if (typeof globe.polygonsTransitionDuration === 'function') {
    globe.polygonsTransitionDuration(0);
  }

  // Camera-driven detail updates. We listen to three.js OrbitControls
  // 'change' instead of globe.gl's onZoom because the latter doesn't
  // reliably fire during programmatic pointOfView flights in all versions.
  //
  // Light work (texture swap, body class, lazy-load trigger, header dismiss)
  // runs every change. The expensive part — re-filtering and uploading new
  // polygon/label data to globe.gl — is debounced to fire 150 ms after the
  // camera settles, so a fly-in that traverses dozens of degrees triggers
  // exactly one heavy refresh at the end instead of one per animation frame.
  let currentTexMode = 'far';
  let settleTimer = null;
  function scheduleHeavyRefresh() {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      refreshLabels();
      refreshPolygons();
    }, 150);
  }
  function onCameraChange() {
    const { altitude } = globe.pointOfView();
    if (altitude < 1.5) dismissHeader();
    if (altitude < VECTOR_LOAD_ALTITUDE) loadDetailLayers();
    const texMode = altitude < TEX_DARK_ALTITUDE ? 'dark' : 'far';
    if (texMode !== currentTexMode) {
      currentTexMode = texMode;
      globe.globeImageUrl(texMode === 'dark' ? TEX_DARK : GLOBE_TEXTURE);
    }
    // At close zoom, let clicks pass straight through labels to the globe
    // sphere underneath. CSS rule keyed off this class flips
    // `pointer-events: none` on the city labels.
    document.body.classList.toggle('globe-close-zoom', altitude < 0.2);
    scheduleHeavyRefresh();
  }
  globe.controls().addEventListener('change', onCameraChange);

  // Expose a synchronous refresh for the label/preset click handlers to
  // call right after their pointOfView animation finishes — bypasses the
  // settle debounce so the user sees the new vector overlay/labels exactly
  // when the camera arrives.
  globe._refreshAfterFlight = () => {
    if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
    loadDetailLayers();
    refreshLabels();
    refreshPolygons();
  };

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

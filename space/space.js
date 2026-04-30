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

// Globe textures. The 2K Blue Marble looks iconic at orbital distance but
// pixelates up close; we swap to a self-hosted 8K natural-color daymap from
// Solar System Scope (CC-BY 4.0, attribution in the footer) once altitude
// drops below TEX_SWAP_ALTITUDE. Preloaded on init so the swap is instant.
const TEX_FAR = '//unpkg.com/three-globe/example/img/earth-blue-marble.jpg';
const TEX_NEAR = 'textures/earth_daymap_8k.jpg';
const TEX_SWAP_ALTITUDE = 0.7;

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
function setTarget(lat, lng) {
  latInput.value = lat.toFixed(6);
  lonInput.value = lng.toFixed(6);
  syncHud();
  globeStatus.textContent = 'TARGET LOCKED';
  if (globe) {
    globe.pointsData([{ lat, lng }]);
    globe.ringsData([{ lat, lng }]);
  }
}

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

  // Reveal the result panel on first capture, hide the onboarding hint.
  if (resultPanel) resultPanel.classList.add('visible');
  if (globeHint)   globeHint.classList.add('hidden');

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

  // Warm the 4K texture cache so the close-up swap is instant.
  new Image().src = TEX_NEAR;

  globe = globalThis.Globe()(container)
    .globeImageUrl(TEX_FAR)
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
        globe.pointOfView({ lat: d.lat, lng: d.lng, altitude: 0.06 }, 1200);
      });
      return el;
    });

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

  // Globe click → set the target and update marker/ring. Capture is a
  // separate explicit action — the user hits CAPTURE when they're ready.
  globe.onGlobeClick(({ lat, lng }) => {
    setTarget(lat, lng);
  });

  // Camera-altitude-driven detail swap:
  //   - city label tier (which set is visible)
  //   - globe surface texture (blue-marble far away, 4K natural-color close)
  // Both only re-apply when the altitude actually crosses a threshold to
  // avoid thrashing on every animation frame.
  let currentTier = 1;
  let currentTexMode = 'far';
  globe.onZoom(({ altitude }) => {
    const tier = altitude > 1.5 ? 1 : altitude > 0.5 ? 2 : 3;
    if (tier !== currentTier) {
      currentTier = tier;
      globe.htmlElementsData(citiesForAltitude(altitude));
    }
    const texMode = altitude < TEX_SWAP_ALTITUDE ? 'near' : 'far';
    if (texMode !== currentTexMode) {
      currentTexMode = texMode;
      globe.globeImageUrl(texMode === 'near' ? TEX_NEAR : TEX_FAR);
    }
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

// Curated coordinates + timezone hints for common world destinations.
// Used to (a) place map pins when an item has only a city name, and
// (b) cluster/sort the wishlist by geography. Not exhaustive — the app
// falls back gracefully to any lat/lng captured during enrichment.

export const CITIES = {
  'tokyo': { lat: 35.6762, lng: 139.6503, country: 'Japan', region: 'Asia' },
  'kyoto': { lat: 35.0116, lng: 135.7681, country: 'Japan', region: 'Asia' },
  'osaka': { lat: 34.6937, lng: 135.5023, country: 'Japan', region: 'Asia' },
  'seoul': { lat: 37.5665, lng: 126.978, country: 'South Korea', region: 'Asia' },
  'bangkok': { lat: 13.7563, lng: 100.5018, country: 'Thailand', region: 'Asia' },
  'singapore': { lat: 1.3521, lng: 103.8198, country: 'Singapore', region: 'Asia' },
  'hong kong': { lat: 22.3193, lng: 114.1694, country: 'Hong Kong', region: 'Asia' },
  'taipei': { lat: 25.033, lng: 121.5654, country: 'Taiwan', region: 'Asia' },
  'bali': { lat: -8.4095, lng: 115.1889, country: 'Indonesia', region: 'Asia' },
  'paris': { lat: 48.8566, lng: 2.3522, country: 'France', region: 'Europe' },
  'london': { lat: 51.5074, lng: -0.1278, country: 'United Kingdom', region: 'Europe' },
  'rome': { lat: 41.9028, lng: 12.4964, country: 'Italy', region: 'Europe' },
  'florence': { lat: 43.7696, lng: 11.2558, country: 'Italy', region: 'Europe' },
  'venice': { lat: 45.4408, lng: 12.3155, country: 'Italy', region: 'Europe' },
  'barcelona': { lat: 41.3874, lng: 2.1686, country: 'Spain', region: 'Europe' },
  'madrid': { lat: 40.4168, lng: -3.7038, country: 'Spain', region: 'Europe' },
  'lisbon': { lat: 38.7223, lng: -9.1393, country: 'Portugal', region: 'Europe' },
  'amsterdam': { lat: 52.3676, lng: 4.9041, country: 'Netherlands', region: 'Europe' },
  'berlin': { lat: 52.52, lng: 13.405, country: 'Germany', region: 'Europe' },
  'vienna': { lat: 48.2082, lng: 16.3738, country: 'Austria', region: 'Europe' },
  'zurich': { lat: 47.3769, lng: 8.5417, country: 'Switzerland', region: 'Europe' },
  'copenhagen': { lat: 55.6761, lng: 12.5683, country: 'Denmark', region: 'Europe' },
  'reykjavik': { lat: 64.1466, lng: -21.9426, country: 'Iceland', region: 'Europe' },
  'istanbul': { lat: 41.0082, lng: 28.9784, country: 'Turkey', region: 'Europe' },
  'new york': { lat: 40.7128, lng: -74.006, country: 'USA', region: 'North America' },
  'nyc': { lat: 40.7128, lng: -74.006, country: 'USA', region: 'North America' },
  'san francisco': { lat: 37.7749, lng: -122.4194, country: 'USA', region: 'North America' },
  'los angeles': { lat: 34.0522, lng: -118.2437, country: 'USA', region: 'North America' },
  'chicago': { lat: 41.8781, lng: -87.6298, country: 'USA', region: 'North America' },
  'mexico city': { lat: 19.4326, lng: -99.1332, country: 'Mexico', region: 'North America' },
  'vancouver': { lat: 49.2827, lng: -123.1207, country: 'Canada', region: 'North America' },
  'honolulu': { lat: 21.3069, lng: -157.8583, country: 'USA', region: 'North America' },
  'sydney': { lat: -33.8688, lng: 151.2093, country: 'Australia', region: 'Oceania' },
  'melbourne': { lat: -37.8136, lng: 144.9631, country: 'Australia', region: 'Oceania' },
  'queenstown': { lat: -45.0312, lng: 168.6626, country: 'New Zealand', region: 'Oceania' },
  'cape town': { lat: -33.9249, lng: 18.4241, country: 'South Africa', region: 'Africa' },
  'marrakech': { lat: 31.6295, lng: -7.9811, country: 'Morocco', region: 'Africa' },
  'cairo': { lat: 30.0444, lng: 31.2357, country: 'Egypt', region: 'Africa' },
  'dubai': { lat: 25.2048, lng: 55.2708, country: 'UAE', region: 'Middle East' },
  'rio de janeiro': { lat: -22.9068, lng: -43.1729, country: 'Brazil', region: 'South America' },
  'buenos aires': { lat: -34.6037, lng: -58.3816, country: 'Argentina', region: 'South America' },
  'lima': { lat: -12.0464, lng: -77.0428, country: 'Peru', region: 'South America' },
}

const ALIASES = { 'saigon': 'ho chi minh city', 'bombay': 'mumbai' }

/**
 * Resolve a free-text city name to coordinates + metadata.
 * Tolerant of case, surrounding text ("dinner in Kyoto, Japan"), and aliases.
 * @returns {{name:string, lat:number, lng:number, country:string, region:string}|null}
 */
export function resolveCity(input) {
  if (!input || typeof input !== 'string') return null
  const raw = input.toLowerCase().trim()
  const norm = ALIASES[raw] || raw
  if (CITIES[norm]) return { name: titleCase(norm), ...CITIES[norm] }
  // Substring / token match against known cities (longest name wins).
  const hits = Object.keys(CITIES)
    .filter((c) => norm.includes(c))
    .sort((a, b) => b.length - a.length)
  if (hits[0]) return { name: titleCase(hits[0]), ...CITIES[hits[0]] }
  return null
}

export function titleCase(s) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase())
}

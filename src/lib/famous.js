// A small, bundled catalogue of famous places so the capture bar can suggest
// spots the instant you start typing — and keep working with no internet at
// all. Online lookups (Nominatim) augment this; this is the always-available
// offline floor. Each: { name, city, country, lat, lng, category }.

export const FAMOUS = [
  // Paris
  { name: 'Eiffel Tower', city: 'Paris', country: 'France', lat: 48.8584, lng: 2.2945, category: 'see' },
  { name: 'Louvre Museum', city: 'Paris', country: 'France', lat: 48.8606, lng: 2.3376, category: 'see' },
  { name: 'Musée d’Orsay', city: 'Paris', country: 'France', lat: 48.86, lng: 2.3266, category: 'see' },
  { name: 'Notre-Dame de Paris', city: 'Paris', country: 'France', lat: 48.853, lng: 2.3499, category: 'see' },
  { name: 'Arc de Triomphe', city: 'Paris', country: 'France', lat: 48.8738, lng: 2.295, category: 'see' },
  { name: 'Sacré-Cœur', city: 'Paris', country: 'France', lat: 48.8867, lng: 2.3431, category: 'see' },
  { name: 'Septime', city: 'Paris', country: 'France', lat: 48.8536, lng: 2.3809, category: 'eat' },
  { name: 'Arpège', city: 'Paris', country: 'France', lat: 48.8557, lng: 2.3157, category: 'eat' },
  { name: 'L’Ambroisie', city: 'Paris', country: 'France', lat: 48.8551, lng: 2.3654, category: 'eat' },
  { name: 'Palais Garnier', city: 'Paris', country: 'France', lat: 48.8719, lng: 2.3316, category: 'do' },
  // London
  { name: 'The British Museum', city: 'London', country: 'UK', lat: 51.5194, lng: -0.127, category: 'see' },
  { name: 'The National Gallery', city: 'London', country: 'UK', lat: 51.5089, lng: -0.1283, category: 'see' },
  { name: 'Tower of London', city: 'London', country: 'UK', lat: 51.5081, lng: -0.0759, category: 'see' },
  { name: 'Tate Modern', city: 'London', country: 'UK', lat: 51.5076, lng: -0.0994, category: 'see' },
  { name: 'Buckingham Palace', city: 'London', country: 'UK', lat: 51.5014, lng: -0.1419, category: 'see' },
  { name: 'Borough Market', city: 'London', country: 'UK', lat: 51.5055, lng: -0.0909, category: 'eat' },
  { name: 'Noble Rot', city: 'London', country: 'UK', lat: 51.5223, lng: -0.1183, category: 'eat' },
  { name: 'Dishoom', city: 'London', country: 'UK', lat: 51.5127, lng: -0.1285, category: 'eat' },
  // New York
  { name: 'Statue of Liberty', city: 'New York', country: 'USA', lat: 40.6892, lng: -74.0445, category: 'see' },
  { name: 'Central Park', city: 'New York', country: 'USA', lat: 40.7829, lng: -73.9654, category: 'see' },
  { name: 'The Met', city: 'New York', country: 'USA', lat: 40.7794, lng: -73.9632, category: 'see' },
  { name: 'MoMA', city: 'New York', country: 'USA', lat: 40.7614, lng: -73.9776, category: 'see' },
  { name: 'Times Square', city: 'New York', country: 'USA', lat: 40.758, lng: -73.9855, category: 'see' },
  { name: 'Brooklyn Bridge', city: 'New York', country: 'USA', lat: 40.7061, lng: -73.9969, category: 'see' },
  { name: "Katz's Delicatessen", city: 'New York', country: 'USA', lat: 40.7223, lng: -73.9874, category: 'eat' },
  { name: 'Le Bernardin', city: 'New York', country: 'USA', lat: 40.7615, lng: -73.9819, category: 'eat' },
  // Tokyo
  { name: 'Senso-ji', city: 'Tokyo', country: 'Japan', lat: 35.7148, lng: 139.7967, category: 'see' },
  { name: 'Meiji Shrine', city: 'Tokyo', country: 'Japan', lat: 35.6764, lng: 139.6993, category: 'see' },
  { name: 'Shibuya Crossing', city: 'Tokyo', country: 'Japan', lat: 35.6595, lng: 139.7004, category: 'see' },
  { name: 'teamLab Planets', city: 'Tokyo', country: 'Japan', lat: 35.6486, lng: 139.7905, category: 'do' },
  { name: 'Tsukiji Outer Market', city: 'Tokyo', country: 'Japan', lat: 35.6655, lng: 139.7708, category: 'eat' },
  { name: 'Sukiyabashi Jiro', city: 'Tokyo', country: 'Japan', lat: 35.6717, lng: 139.7638, category: 'eat' },
  { name: 'Tokyo Skytree', city: 'Tokyo', country: 'Japan', lat: 35.7101, lng: 139.8107, category: 'see' },
  // Kyoto
  { name: 'Fushimi Inari Taisha', city: 'Kyoto', country: 'Japan', lat: 34.9671, lng: 135.7727, category: 'see' },
  { name: 'Kinkaku-ji', city: 'Kyoto', country: 'Japan', lat: 35.0394, lng: 135.7292, category: 'see' },
  { name: 'Arashiyama Bamboo Grove', city: 'Kyoto', country: 'Japan', lat: 35.0169, lng: 135.6717, category: 'see' },
  { name: 'Kiyomizu-dera', city: 'Kyoto', country: 'Japan', lat: 34.9949, lng: 135.785, category: 'see' },
  // Rome
  { name: 'Colosseum', city: 'Rome', country: 'Italy', lat: 41.8902, lng: 12.4922, category: 'see' },
  { name: 'Vatican Museums', city: 'Rome', country: 'Italy', lat: 41.9065, lng: 12.4536, category: 'see' },
  { name: 'Trevi Fountain', city: 'Rome', country: 'Italy', lat: 41.9009, lng: 12.4833, category: 'see' },
  { name: 'Pantheon', city: 'Rome', country: 'Italy', lat: 41.8986, lng: 12.4769, category: 'see' },
  { name: 'Roscioli', city: 'Rome', country: 'Italy', lat: 41.8942, lng: 12.4725, category: 'eat' },
  // Barcelona
  { name: 'Sagrada Família', city: 'Barcelona', country: 'Spain', lat: 41.4036, lng: 2.1744, category: 'see' },
  { name: 'Park Güell', city: 'Barcelona', country: 'Spain', lat: 41.4145, lng: 2.1527, category: 'see' },
  { name: 'La Boqueria', city: 'Barcelona', country: 'Spain', lat: 41.3817, lng: 2.1717, category: 'eat' },
  { name: 'Casa Batlló', city: 'Barcelona', country: 'Spain', lat: 41.3916, lng: 2.1649, category: 'see' },
  // Amsterdam / Berlin / more Europe
  { name: 'Rijksmuseum', city: 'Amsterdam', country: 'Netherlands', lat: 52.36, lng: 4.8852, category: 'see' },
  { name: 'Van Gogh Museum', city: 'Amsterdam', country: 'Netherlands', lat: 52.3584, lng: 4.8811, category: 'see' },
  { name: 'Anne Frank House', city: 'Amsterdam', country: 'Netherlands', lat: 52.3752, lng: 4.884, category: 'see' },
  { name: 'Brandenburg Gate', city: 'Berlin', country: 'Germany', lat: 52.5163, lng: 13.3777, category: 'see' },
  { name: 'Reichstag', city: 'Berlin', country: 'Germany', lat: 52.5186, lng: 13.3762, category: 'see' },
  { name: 'Schönbrunn Palace', city: 'Vienna', country: 'Austria', lat: 48.1858, lng: 16.3122, category: 'see' },
  { name: 'Sagrada', city: 'Lisbon', country: 'Portugal', lat: 38.7223, lng: -9.1393, category: 'see' },
  // Asia / Oceania / others
  { name: 'Marina Bay Sands', city: 'Singapore', country: 'Singapore', lat: 1.2834, lng: 103.8607, category: 'stay' },
  { name: 'Gardens by the Bay', city: 'Singapore', country: 'Singapore', lat: 1.2816, lng: 103.8636, category: 'see' },
  { name: 'Grand Palace', city: 'Bangkok', country: 'Thailand', lat: 13.75, lng: 100.4915, category: 'see' },
  { name: 'Sydney Opera House', city: 'Sydney', country: 'Australia', lat: -33.8568, lng: 151.2153, category: 'see' },
  { name: 'Bondi Beach', city: 'Sydney', country: 'Australia', lat: -33.8908, lng: 151.2743, category: 'do' },
  { name: 'Burj Khalifa', city: 'Dubai', country: 'UAE', lat: 25.1972, lng: 55.2744, category: 'see' },
  { name: 'Table Mountain', city: 'Cape Town', country: 'South Africa', lat: -33.9628, lng: 18.4098, category: 'see' },
  { name: 'Christ the Redeemer', city: 'Rio de Janeiro', country: 'Brazil', lat: -22.9519, lng: -43.2105, category: 'see' },
  { name: 'Machu Picchu', city: 'Cusco', country: 'Peru', lat: -13.1631, lng: -72.545, category: 'see' },
  { name: 'Golden Gate Bridge', city: 'San Francisco', country: 'USA', lat: 37.8199, lng: -122.4783, category: 'see' },
  { name: 'Griffith Observatory', city: 'Los Angeles', country: 'USA', lat: 34.1184, lng: -118.3004, category: 'see' },
]

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/**
 * Rank famous places matching a query (prefix > word-start > substring).
 * Fully local — the offline floor for the capture-bar autocomplete.
 */
export function searchFamous(query, limit = 6) {
  const q = norm(query).trim()
  if (q.length < 2) return []
  const scored = []
  for (const p of FAMOUS) {
    const name = norm(p.name)
    const hay = name + ' ' + norm(p.city) + ' ' + norm(p.country)
    let score = 0
    if (name.startsWith(q)) score = 3
    else if (new RegExp('\\b' + escapeRe(q)).test(name)) score = 2
    else if (hay.includes(q)) score = 1
    if (score) scored.push({ p, score })
  }
  return scored
    .sort((a, b) => b.score - a.score || a.p.name.length - b.p.name.length)
    .slice(0, limit)
    .map((s) => s.p)
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

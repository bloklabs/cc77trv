// Fun starter wishlist for cc & nana — London + Paris. Links point to a Google
// Maps search (always valid; surfaces latest opening hours + the booking link),
// and booking-difficulty is auto-rated by normalizeItem. Loaded once when the
// local store is empty; users can delete anything they don't want.

const maps = (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`

export const SEED_ITEMS = [
  // ---------- London ----------
  { title: 'Quality Wines', category: 'eat', city: 'London', url: maps('Quality Wines Farringdon London'),
    snippet: 'Buzzy Farringdon wine bar — pasta & natural wine. Lunch is the move.', notes: 'Perhaps lunch. Small — book ahead.' },
  { title: 'Noble Rot', category: 'eat', city: 'London', url: maps('Noble Rot Lamb\'s Conduit London'),
    snippet: 'Wine-focused bistro on Lamb’s Conduit St — get the roast chicken.', notes: 'Chicken. Reservation recommended.' },
  { title: 'Dorian', category: 'eat', city: 'London', url: maps('Dorian Notting Hill London'),
    snippet: 'Notting Hill’s cool modern brasserie — dry-aged beef, great wine.', notes: 'Hot table, book well ahead.' },
  { title: 'The Drapers Arms', category: 'eat', city: 'London', url: maps('The Drapers Arms Islington London'),
    snippet: 'Handsome Islington gastropub — proper Sunday roast.', notes: 'Relaxed; Sunday roast books up.' },
  { title: 'Brunswick House', category: 'eat', city: 'London', url: maps('Brunswick House Vauxhall London'),
    snippet: 'Restaurant inside a Georgian house crammed with antiques.', notes: 'Atmospheric; reserve ahead.' },
  { title: 'Taillevent', category: 'eat', city: 'London', url: maps('Taillevent'),
    snippet: 'Storied haute-cuisine name — a special-occasion classic.', notes: 'Michelin. Reservation required well ahead.' },
  { title: 'The National Gallery', category: 'see', city: 'London', url: maps('The National Gallery Trafalgar Square London'),
    snippet: 'Trafalgar Square masterpieces — free entry, world-class collection.',
    hoursByDay: { 0: '10:00–18:00', 1: '10:00–18:00', 2: '10:00–18:00', 3: '10:00–18:00', 4: '10:00–18:00', 5: '10:00–21:00', 6: '10:00–18:00' },
    hours: 'Sun–Thu, Sat 10:00–18:00, Fri 10:00–21:00', notes: 'Free. Fridays open late.' },
  { title: 'Perrotin London', category: 'see', city: 'London', url: maps('Perrotin gallery London'),
    snippet: 'Contemporary art gallery — rotating international shows.', notes: 'Free; check current exhibition.' },

  // ---------- Paris ----------
  { title: 'Plénitude — Cheval Blanc', category: 'eat', city: 'Paris', url: maps('Plenitude Cheval Blanc Paris'),
    snippet: 'Arnaud Donckele’s 3-star at Cheval Blanc — Seine-side haute cuisine.', notes: 'Michelin 3-star. Book a month+ ahead.' },
  { title: 'Septime', category: 'eat', city: 'Paris', url: maps('Septime restaurant Paris'),
    snippet: 'Modern bistro — one of the hardest, best tables in Paris.', notes: 'Books open ~3 weeks out at 10am, vanish fast.' },
  { title: 'Le Doyenné', category: 'eat', city: 'Paris', url: maps('Le Doyenne Saint-Vrain'),
    snippet: 'Farm-to-table destination just outside Paris from ex-Fäviken chefs.', notes: 'Lunch destination; reserve well ahead.' },
  { title: 'Arpège', category: 'eat', city: 'Paris', url: maps('Arpege Alain Passard Paris'),
    snippet: 'Alain Passard’s vegetable-driven Michelin 3-star.', notes: 'Michelin 3-star. Reserve a month+ ahead.' },
  { title: 'L’Ambroisie', category: 'eat', city: 'Paris', url: maps('L\'Ambroisie Place des Vosges Paris'),
    snippet: 'Old-guard 3-star on Place des Vosges — a bucket-list classic.', notes: 'One of those you have to have done. Book far ahead.' },
  { title: 'Parcelles', category: 'eat', city: 'Paris', url: maps('Parcelles Marais Paris'),
    snippet: 'Marais neighbourhood bistro & serious wine list.', notes: 'Reserve ahead.' },
  { title: 'Le Petit Sommelier', category: 'eat', city: 'Paris', url: maps('Le Petit Sommelier Montparnasse Paris'),
    snippet: 'Wine-lover’s bistro near Montparnasse — deep cellar.', notes: 'Great value wine.' },
  { title: 'Le Bon Georges', category: 'eat', city: 'Paris', url: maps('Le Bon Georges Paris'),
    snippet: 'Quintessential Paris bistro — top produce, great steak & wine.', notes: 'Book ahead.' },
  { title: 'Motors Espresso', category: 'eat', city: 'Paris', url: maps('Motors Espresso Paris'),
    snippet: 'Tiny specialty espresso bar — excellent quick coffee.', notes: 'Walk-in coffee stop.' },
  { title: 'Opéra de Paris — Palais Garnier', category: 'do', city: 'Paris', url: maps('Palais Garnier Opera de Paris'),
    snippet: 'Opera & ballet in the opulent Palais Garnier — book tickets ahead.', notes: 'Buy tickets in advance; daytime tours too.' },
]

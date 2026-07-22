import { describe, it, expect } from 'vitest'
import { parseOpeningHours, makeSnippet, parseHtmlMetadata } from '../src/lib/enrich.js'
import { bookingDifficulty, normalizeItem, todaysHours, makeSnippet as normSnippet } from '../src/lib/normalize.js'

describe('parseOpeningHours', () => {
  it('parses schema.org spec objects', () => {
    const r = parseOpeningHours([
      { '@type': 'OpeningHoursSpecification', dayOfWeek: 'https://schema.org/Monday', opens: '09:00', closes: '17:00' },
      { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Saturday', 'Sunday'], opens: '10:00', closes: '14:00' },
    ])
    expect(r.byDay[1]).toBe('09:00–17:00') // Monday
    expect(r.byDay[6]).toBe('10:00–14:00') // Saturday
    expect(r.byDay[0]).toBe('10:00–14:00') // Sunday
    expect(r.summary).toContain('Mon')
  })
  it('parses "Mo-Fr 09:00-17:00" string form and collapses runs', () => {
    const r = parseOpeningHours('Mo-Fr 09:00-17:00')
    expect(r.byDay[1]).toBe('09:00–17:00')
    expect(r.byDay[5]).toBe('09:00–17:00')
    expect(r.byDay[0]).toBeUndefined()
    expect(r.summary).toBe('Mon–Fri 09:00–17:00')
  })
  it('returns null for junk', () => {
    expect(parseOpeningHours('not hours')).toBeNull()
    expect(parseOpeningHours([])).toBeNull()
  })
})

describe('opening hours via JSON-LD', () => {
  it('surfaces hours + hoursByDay from parseHtmlMetadata', () => {
    const html = `<script type="application/ld+json">
      {"@type":"Restaurant","name":"X","openingHoursSpecification":[
        {"dayOfWeek":"Friday","opens":"18:00","closes":"23:00"}]}</script>`
    const m = parseHtmlMetadata(html)
    expect(m.hoursByDay[5]).toBe('18:00–23:00')
    expect(m.hours).toContain('Fri')
  })
})

describe('makeSnippet', () => {
  it('truncates cleanly with an ellipsis', () => {
    const long = 'A '.repeat(80)
    expect(makeSnippet(long, 40).length).toBeLessThanOrEqual(40)
    expect(makeSnippet(long, 40).endsWith('…')).toBe(true)
  })
  it('passes through short text and handles null', () => {
    expect(normSnippet('short')).toBe('short')
    expect(normSnippet(null)).toBeNull()
  })
})

describe('bookingDifficulty', () => {
  it('rates famous hard tables at the top', () => {
    expect(bookingDifficulty({ title: 'Arpège', category: 'eat', text: 'arpège paris', reservation: { required: true, leadDays: 30 } }).score).toBe(5)
    expect(bookingDifficulty({ title: 'Septime', category: 'eat', text: 'septime paris' }).score).toBeGreaterThanOrEqual(4)
  })
  it('rates a casual sight low', () => {
    const d = bookingDifficulty({ title: 'A public park', category: 'see', text: 'public park', reservation: { required: false, leadDays: 0 } })
    expect(d.score).toBeLessThanOrEqual(2)
    expect(d.label).toBeDefined()
  })
  it('bumps for fine-dining signals + reservation', () => {
    const d = bookingDifficulty({ title: 'Some Omakase', category: 'eat', text: 'michelin omakase tasting menu', reservation: { required: true, leadDays: 14 } })
    expect(d.score).toBeGreaterThanOrEqual(4)
  })
})

describe('normalizeItem carries new fields', () => {
  it('includes booking, snippet, hours, hoursByDay', () => {
    const it = normalizeItem({
      title: 'L’Ambroisie', category: 'eat', city: 'Paris',
      description: 'Old-guard three-star on Place des Vosges, a bucket-list classic dinner.',
      hoursByDay: { 2: '12:00–14:00', 4: '12:00–14:00' },
    })
    expect(it.booking.score).toBe(5)
    expect(it.snippet).toContain('three-star')
    expect(it.hoursByDay[2]).toBe('12:00–14:00')
  })
})

describe('todaysHours', () => {
  it('returns the hours for the given weekday', () => {
    const item = { hoursByDay: { 1: '09:00–17:00', 5: '10:00–21:00' } }
    expect(todaysHours(item, 1)).toBe('09:00–17:00')
    expect(todaysHours(item, 5)).toBe('10:00–21:00')
    expect(todaysHours(item, 0)).toBeNull()
    expect(todaysHours({}, 1)).toBeNull()
  })
})

import { describe, it, expect } from 'vitest'
import { itemBlurb, itineraryBlurb } from '../src/lib/blurb.js'
import { buildItinerary } from '../src/lib/itinerary.js'

const item = {
  title: 'Sukiyabashi Jiro', category: 'eat', city: 'Tokyo', country: 'Japan',
  costUsd: 268, costRaw: '¥40,000', visitMin: 90,
  reservation: { required: true, leadDays: 30, note: 'Book via concierge' },
  url: 'https://example.com/jiro', notes: 'bucket list',
}

describe('itemBlurb', () => {
  it('renders a concierge-ready summary with all key fields', () => {
    const b = itemBlurb(item)
    expect(b).toContain('Sukiyabashi Jiro')
    expect(b).toContain('Tokyo, Japan')
    expect(b).toContain('Est. cost')
    expect(b).toContain('REQUIRED')
    expect(b).toContain('30 days')
    expect(b).toContain('https://example.com/jiro')
    expect(b).toContain('confirm availability')
  })
  it('omits missing fields gracefully', () => {
    const b = itemBlurb({ title: 'Mystery spot', category: 'other' })
    expect(b).toContain('Mystery spot')
    expect(b).not.toContain('Est. cost')
  })
})

describe('itineraryBlurb', () => {
  it('renders an ordered plan with totals and bookings', () => {
    const items = [
      { id: '1', title: 'Shrine', category: 'see', city: 'Tokyo', lat: 35.681, lng: 139.767, visitMin: 45 },
      { id: '2', title: 'Jiro', category: 'eat', city: 'Tokyo', lat: 35.6717, lng: 139.7638, visitMin: 90, reservation: { required: true, leadDays: 30, note: 'book ahead' } },
    ]
    const plan = buildItinerary(items, { startTime: '10:00' })
    const b = itineraryBlurb(plan, { city: 'Tokyo', date: 'Apr 3' })
    expect(b).toContain('Tokyo')
    expect(b).toContain('Proposed order')
    expect(b).toContain('Totals:')
    expect(b).toContain('Needs advance booking')
    expect(b).toContain('Jiro')
  })
})

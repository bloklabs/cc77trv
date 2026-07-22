import { describe, it, expect } from 'vitest'
import { parseHtmlMetadata, parseTextMetadata, enrichFromUrl } from '../src/lib/enrich.js'

const HTML = `<!doctype html><html><head>
  <title>Fallback Title</title>
  <meta property="og:title" content="Sukiyabashi Jiro — Ginza" />
  <meta property="og:description" content="Legendary omakase sushi. Reservation required. &amp; more." />
  <meta property="og:image" content="https://img.example/jiro.jpg" />
  <script type="application/ld+json">
  {"@type":"Restaurant","name":"Jiro","address":{"addressLocality":"Tokyo"},
   "geo":{"latitude":35.6717,"longitude":139.7638},
   "offers":{"price":"40000","priceCurrency":"JPY"}}
  </script>
</head><body>Booking essential. ¥40,000</body></html>`

describe('parseHtmlMetadata', () => {
  it('prefers og tags and decodes entities', () => {
    const m = parseHtmlMetadata(HTML)
    expect(m.title).toBe('Sukiyabashi Jiro — Ginza')
    expect(m.description).toContain('&')
    expect(m.image).toBe('https://img.example/jiro.jpg')
  })
  it('pulls geo, city, and price from JSON-LD', () => {
    const m = parseHtmlMetadata(HTML)
    expect(m.lat).toBeCloseTo(35.6717, 3)
    expect(m.city).toBe('Tokyo')
    expect(m.costRaw).toContain('40000')
  })
  it('falls back to <title> when no og:title', () => {
    const m = parseHtmlMetadata('<html><head><title>Just Title</title></head></html>')
    expect(m.title).toBe('Just Title')
  })
  it('handles empty / junk input', () => {
    expect(parseHtmlMetadata('').title).toBeNull()
    expect(parseHtmlMetadata(null).title).toBeNull()
  })
})

describe('parseTextMetadata', () => {
  it('extracts a title line and first paragraph', () => {
    const m = parseTextMetadata('Title: Cool Bar\nURL Source: http://x\n\nA lovely rooftop bar with skyline views and great cocktails all night.')
    expect(m.title).toBe('Cool Bar')
    expect(m.description).toContain('rooftop')
  })
})

describe('enrichFromUrl', () => {
  it('uses an injected fetch and returns normalized-ready fields', async () => {
    const fetchImpl = async () => ({ ok: true, text: async () => HTML })
    const data = await enrichFromUrl('https://example.com/jiro', { fetchImpl })
    expect(data.source).toBe('enriched')
    expect(data.title).toContain('Jiro')
    expect(data.city).toBe('Tokyo')
    expect(data.url).toBe('https://example.com/jiro')
  })
  it('falls through proxies and degrades gracefully on total failure', async () => {
    const fetchImpl = async () => ({ ok: false, status: 500, text: async () => '' })
    const data = await enrichFromUrl('https://example.com/x', { fetchImpl })
    expect(data.source).toBe('manual')
    expect(data.enrichError).toBeDefined()
  })
})

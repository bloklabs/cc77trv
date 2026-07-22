import { describe, it, expect } from 'vitest'
import { parseBulk, isBulk, cityHeader } from '../src/lib/bulk.js'

describe('parseBulk — email / multi-place dumps', () => {
  it('splits a bulleted list into separate entries', () => {
    const out = parseBulk(`- Septime\n- Le Doyenné\n* Arpège\n1. L'Ambroisie`)
    expect(out.length).toBe(4)
    expect(out.map((c) => c.title)).toContain('Septime')
    expect(out.map((c) => c.title)).toContain('Arpège')
  })

  it('assigns city from headers ("For Paris" / "London:")', () => {
    const out = parseBulk(`London:\n- Noble Rot\n- Dorian\n\nFor Paris\n- Septime\n- Arpège`)
    const byTitle = Object.fromEntries(out.map((c) => [c.title, c.city]))
    expect(byTitle['Noble Rot']).toBe('London')
    expect(byTitle['Dorian']).toBe('London')
    expect(byTitle['Septime']).toBe('Paris')
    expect(byTitle['Arpège']).toBe('Paris')
  })

  it('extracts links and pairs them with names', () => {
    const out = parseBulk(`Quality Wines https://qualitywines.co.uk\nNoble Rot — https://noblerot.co.uk`)
    expect(out.length).toBe(2)
    expect(out[0].url).toContain('qualitywines')
    expect(out[0].title).toBe('Quality Wines')
    expect(out[1].title).toBe('Noble Rot')
  })

  it('pulls a parenthetical into a note', () => {
    const out = parseBulk('Quality Wines (perhaps lunch)')
    expect(out[0].title).toBe('Quality Wines')
    expect(out[0].note).toBe('perhaps lunch')
  })

  it('splits a single-line comma list', () => {
    const out = parseBulk('Septime, Le Doyenné, Arpège and Parcelles')
    expect(out.length).toBe(4)
  })

  it('ignores email greetings and sign-offs', () => {
    const out = parseBulk(`Hi nana!\nHere are some places:\n- Septime\n- Arpège\nThanks,\ncc`)
    const titles = out.map((c) => c.title)
    expect(titles).toContain('Septime')
    expect(titles).toContain('Arpège')
    expect(titles).not.toContain('Hi nana!')
    expect(titles).not.toContain('Thanks')
  })

  it('handles a stack of bare links', () => {
    const out = parseBulk('https://a.com/one\nhttps://b.com/two\nhttps://instagram.com/septime_paris')
    expect(out.length).toBe(3)
    expect(out.every((c) => c.url)).toBe(true)
  })

  it('treats a single place as one entry', () => {
    const out = parseBulk('Noble Rot')
    expect(out.length).toBe(1)
    expect(isBulk('Noble Rot')).toBe(false)
    expect(isBulk('- Septime\n- Arpège')).toBe(true)
  })
})

describe('cityHeader', () => {
  it('recognises plain and prefixed city headings', () => {
    expect(cityHeader('London:')).toBe('London')
    expect(cityHeader('For Paris')).toBe('Paris')
    expect(cityHeader('Tokyo 🗾')).toBe('Tokyo')
  })
  it('rejects non-headers', () => {
    expect(cityHeader('dinner near Tokyo station tonight')).toBeNull()
    expect(cityHeader('Noble Rot')).toBeNull()
  })
})

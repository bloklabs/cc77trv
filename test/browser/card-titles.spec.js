import { test, expect } from '@playwright/test'

const titles = [
  'Concert Bastien Lallemant / 13Sep2026 15:00CEST / checked12Sep17:36CEST / seats UNKNOWN',
  'https://official.example/events/' + 'ProgrammeTrèsLongSansEspace'.repeat(5),
  '東京の音楽公演とパリの演奏会 — édition spéciale, programme et source officielle — inventory UNKNOWN',
]
const notes = 'Source checked 2026-09-12 17:36 CEST. Inventory UNKNOWN; no reservation confirmed.'

async function records(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('wander', 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const read = db.transaction('items', 'readonly').objectStore('items').getAll()
      read.onsuccess = () => { db.close(); resolve(read.result) }
      read.onerror = () => { db.close(); reject(read.error) }
    }
  }))
}

async function expectReadableCard(page, title) {
  const heading = page.getByRole('heading', { name: title, exact: true })
  await expect(heading).toBeVisible()
  const layout = await heading.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(element)
    const lines = [...range.getClientRects()]
    return {
      clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight, scrollHeight: element.scrollHeight,
      lineCount: new Set(lines.map((line) => Math.round(line.top))).size,
      textInside: lines.every((line) => line.left >= box.left - 1 && line.right <= box.right + 1 && line.top >= box.top - 1 && line.bottom <= box.bottom + 1),
    }
  })
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1)
  expect(layout.scrollHeight).toBeLessThanOrEqual(layout.clientHeight + 1)
  expect(layout.lineCount).toBeGreaterThan(1)
  expect(layout.textInside).toBe(true)
  const card = page.locator('.card').filter({ has: heading })
  await expect(card.locator('.domain')).toHaveText('🎭 Entertainment')
  await expect(card.locator('.meta b')).toHaveText('Paris')
  await expect(card.locator('.access')).toBeVisible()
  await expect(card.getByTitle('Open source link')).toHaveAttribute('href', 'https://official.example/event-source')
  for (const label of ['Edit', 'Delete', 'Copy concierge blurb']) await expect(card.getByTitle(label, { exact: true })).toBeVisible()
}

test('390px long and unbroken titles stay readable with all card information and records offline', async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  // The isolated fixture never contacts a restaurant, account, or mission backend.
  await context.route('**/*', (route) => new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort())
  await page.goto('./')
  await expect(page.locator('#cap')).toBeVisible()
  const originals = await records(page)
  expect(originals.length).toBeGreaterThan(0)
  await page.evaluate(({ titles, notes, template }) => new Promise((resolve, reject) => {
    const request = indexedDB.open('wander', 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const write = db.transaction('items', 'readwrite')
      for (const [index, title] of titles.entries()) write.objectStore('items').put({
        ...template, id: 'title-preservation-' + index, title, notes,
        url: 'https://official.example/event-source', city: 'Paris', domain: 'entertainment',
        gatheredAt: new Date().toISOString(), gatherVersion: 2,
        booking: { ...template.booking, tier: 'walkin', tierLabel: 'Walk-in', tierHint: 'Existing estimate; inventory remains UNKNOWN' },
        legacyExtension: { keep: 'unknown fields must survive a CSS-only release' },
      })
      write.oncomplete = () => { db.close(); resolve() }
      write.onerror = () => { db.close(); reject(write.error) }
    }
  }), { titles, notes, template: originals[0] })
  await page.reload()
  for (const title of titles) await expectReadableCard(page, title)
  for (const tab of ['list', 'map', 'plan', 'voice']) await expect(page.locator(`.tab[data-tab="${tab}"]`)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const beforeOffline = await records(page)
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
  await context.setOffline(true)
  await page.reload()
  for (const title of titles) await expectReadableCard(page, title)
  const afterOffline = await records(page)
  expect(afterOffline.filter((item) => item.id.startsWith('title-preservation-'))).toEqual(beforeOffline.filter((item) => item.id.startsWith('title-preservation-')))
  expect(afterOffline).toHaveLength(originals.length + titles.length)
  for (const original of originals) {
    const retained = afterOffline.find((item) => item.id === original.id)
    for (const key of ['title', 'url', 'notes', 'createdAt', 'deleted']) expect(retained[key]).toEqual(original[key])
  }
  const first = page.locator('.card').filter({ has: page.getByRole('heading', { name: titles[0], exact: true }) })
  await first.getByTitle('Edit', { exact: true }).click()
  await expect(page.locator('#fNotes')).toHaveValue(notes)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(errors).toEqual([])
})

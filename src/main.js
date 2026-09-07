import './styles.css'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { registerSW } from 'virtual:pwa-register'

import {
  CATEGORIES, CATEGORY_META, DOMAINS, DOMAIN_META,
  todaysHours, cleanUrl, ACCESS_TIERS, ACCESS_META,
} from './lib/normalize.js'
import { LEGACY_COMPAT } from './lib/compat.js'
import { gatherInfo } from './lib/gather.js'
import { parseBulk } from './lib/bulk.js'
import { searchFamous } from './lib/famous.js'
import { nominatimSuggest } from './lib/places.js'
import { alertsToFire } from './lib/proximity.js'
import { consumeVoiceFragment, readVoice, saveVoiceDraft } from './lib/voice.js'
import { mountVoice } from './voice-view.js'

// Bump when the info-gathering scripts improve — the background loop then
// re-runs them on every saved entry so old items pick up the latest data.
const GATHER_VERSION = 2
const REFRESH_MS = 10 * 60 * 1000 // sweep all entries ~every 10 min
const REFRESH_MAX_AGE_MS = 6 * 60 * 60 * 1000 // also refresh anything older than 6h
import { groupByCity, buildItinerary } from './lib/itinerary.js'
import { itemBlurb, itineraryBlurb } from './lib/blurb.js'
import { formatDuration } from './lib/transit.js'
import {
  allItems, allRecords, saveItem, deleteItem, replaceAll, seedIfEmpty, migrateRecords,
  loadSpace, saveSpace, clearSpace,
} from './lib/store.js'
import {
  deriveKey, SyncClient, encodeSpaceCode, parseSpaceCode, mergeItems,
} from './lib/sync.js'

const XRAY = import.meta.env.VITE_XRAY === '1'
const APP_BASE = import.meta.env.BASE_URL

if (!XRAY) registerSW({ immediate: true })

const state = {
  tab: 'list',
  items: [],
  filter: { domain: 'all', category: 'all', city: 'all', q: '' },
  space: XRAY ? null : loadSpace(),
  map: null,
  markers: null,
  geo: { watchId: null, notified: {} },
  syncError: null,
  lastSyncedAt: null,
}

const $ = (s, r = document) => r.querySelector(s)
const view = $('#view')
let voiceCleanup = null
let voiceNotice = ''

// ---------- boot ----------
async function boot() {
  // Wire visible navigation before asynchronous storage work: an early tap
  // must not disappear while IndexedDB opens.
  wireChrome()
  try {
    const returned = await consumeVoiceFragment(localStorage, location, history)
    if (returned) { state.tab = 'voice'; voiceNotice = returned.message }
  } catch (e) { voiceNotice = e.message }
  if (state.tab === 'voice') render()
  await seedIfEmpty()
  await migrateRecords()
  state.items = await allItems()
  handleDeepLinks()
  updateSpaceLabel()
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === state.tab))
  $('#xrayBadge').hidden = !XRAY
  if (state.tab !== 'voice' || !voiceCleanup) render()
  scheduleSync()
  if (!XRAY) startGatherLoop()
  // resume nearby alerts if the user had them on and permission is still granted
  if (geoEnabled() && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    startGeo({ prompt: false })
  }
  updateGeoChip()
}

function wireChrome() {
  document.querySelectorAll('.tab').forEach((t) =>
    t.addEventListener('click', () => setTab(t.dataset.tab))
  )
  $('#fab').addEventListener('click', () => openAddSheet())
  $('#spaceBtn').addEventListener('click', XRAY ? openXraySheet : openSpaceSheet)
  $('#geoBtn').addEventListener('click', toggleGeo)
  $('#sheet').addEventListener('click', (e) => {
    if (e.target.hasAttribute('data-close')) closeSheet()
  })
}

function setTab(tab) {
  state.tab = tab
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === tab))
  render()
}

async function refresh() {
  state.items = await allItems()
  // Background research must not interrupt voice playback or a typed draft.
  if (state.tab !== 'voice') render()
}

function render() {
  voiceCleanup?.()
  voiceCleanup = null
  if (state.tab === 'list') renderList()
  else if (state.tab === 'map') renderMap()
  else if (state.tab === 'plan') renderPlan()
  else if (state.tab === 'voice') {
    voiceCleanup = mountVoice(view, { notice: voiceNotice, origin: import.meta.env.VITE_OS3_VOICE_ORIGIN || undefined })
    voiceNotice = ''
  }
}

// ---------- LIST (landing = instant capture) ----------
function renderList() {
  const cities = ['all', ...uniqueCities(state.items)]
  const f = state.filter
  const filtered = applyFilters(state.items)

  view.innerHTML = `
    <div class="capture">
      <input class="capture-input" id="cap" enterkeyhint="done" autocomplete="off"
        placeholder="Paste a link or type a place you love…" value="" />
      <span class="capture-status" id="capStatus"></span>
      <div class="ac" id="acList" hidden></div>
    </div>
    <input class="search" id="q" placeholder="🔍 Filter…" value="${esc(f.q)}" />
    <div class="filters" id="domainFilters" aria-label="Research area">
      ${['all', ...DOMAINS].map((d) => filterPill('domain:' + d, f.domain === d, d === 'all' ? 'All research' : DOMAIN_META[d].emoji + ' ' + DOMAIN_META[d].label)).join('')}
    </div>
    <div class="filters" id="catFilters">
      ${['all', ...CATEGORIES].map((c) => filterPill(c, f.category === c, c === 'all' ? 'All' : CATEGORY_META[c].emoji + CATEGORY_META[c].label)).join('')}
    </div>
    <div class="filters" id="cityFilters">
      ${cities.map((c) => filterPill('city:' + c, f.city === c, c === 'all' ? '🌍' : '📍' + c)).join('')}
    </div>
    <div id="cards">${filtered.length ? filtered.map(cardHtml).join('') : emptyState()}</div>
  `

  const cap = $('#cap')
  cap.focus()
  cap.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && cap.value.trim()) { hideAc(); const v = cap.value; cap.value = ''; quickAdd(v) }
    else if (e.key === 'Escape') hideAc()
  })
  cap.addEventListener('paste', (e) => {
    const text = (e.clipboardData || window.clipboardData).getData('text')
    // Auto-process a link, a multi-line dump, or an email of places.
    if (text && (/https?:\/\//i.test(text) || /\r?\n/.test(text.trim()) || parseBulk(text).length > 1)) {
      e.preventDefault(); cap.value = ''; hideAc(); quickAdd(text)
    }
  })
  cap.addEventListener('input', () => onCaptureInput(cap.value))
  cap.addEventListener('blur', () => setTimeout(hideAc, 180)) // let a tap register first

  $('#q').addEventListener('input', (e) => { state.filter.q = e.target.value; renderCards() })
  $('#domainFilters').addEventListener('click', (e) => {
    const p = e.target.closest('.pill'); if (!p) return
    state.filter.domain = p.dataset.k.replace(/^domain:/, ''); renderList()
  })
  $('#catFilters').addEventListener('click', (e) => {
    const p = e.target.closest('.pill'); if (!p) return
    state.filter.category = p.dataset.k; renderList()
  })
  $('#cityFilters').addEventListener('click', (e) => {
    const p = e.target.closest('.pill'); if (!p) return
    state.filter.city = p.dataset.k.replace(/^city:/, ''); renderList()
  })
  wireCards()
}

function renderCards() {
  const filtered = applyFilters(state.items)
  $('#cards').innerHTML = filtered.length ? filtered.map(cardHtml).join('') : emptyState()
  wireCards()
}

function wireCards() {
  $('#cards')?.addEventListener('click', onCardClick)
}

async function onCardClick(e) {
  if (e.target.closest('a')) return // links navigate natively (maps / source)
  const card = e.target.closest('.card')
  if (!card) return
  const item = state.items.find((i) => i.id === card.dataset.id)
  if (!item) return
  const btn = e.target.closest('button[data-act]')
  const act = btn ? btn.dataset.act : 'tap'
  if (act === 'blurb') copyText(itemBlurb(item), 'Blurb copied for concierge')
  else if (act === 'voice') {
    try {
      const { draft } = readVoice(localStorage)
      await saveVoiceDraft(localStorage, { ...draft, ref: item.id, restaurantName: item.title, city: item.city || '', phone: item.phone || '' })
      setTab('voice')
    } catch (error) { toast(error.message) }
  }
  else if (act === 'edit') openAddSheet(item)
  else if (act === 'del') removeItem(card.dataset.id)
  else if (act === 'tap') { const u = item.url || item.mapsUrl; if (u) window.open(u, '_blank', 'noopener') }
}

/** Optimistic instant save, then async enrich — handles one place OR many. */
async function quickAdd(text) {
  const candidates = parseBulk(text)
  if (candidates.length <= 1) return quickAddOne(candidates[0] || { title: text.trim() })
  return bulkAdd(candidates)
}

/** Save one candidate immediately, then gather info in the background. */
async function quickAddOne(c) {
  const url = c.url ? cleanUrl(c.url) : null
  setCapStatus(url ? '⏳ saving + looking up…' : '⏳ saving + finding it…')
  const saved = await saveItem({
    url, title: c.title || (url ? hostTitle(url) : 'New place'),
    city: c.city || undefined, notes: c.note || undefined,
    lat: c.lat, lng: c.lng, category: c.category, domain: c.domain,
  })
  await refresh()
  setCapStatus('✓ added')
  scheduleSync()
  // Always gather — for a name this geocodes it, for a link it reads the page,
  // for a Google/maps/share link it resolves and looks the place up.
  await gatherInto(saved)
  scheduleSync()
  setTimeout(() => setCapStatus(''), 1600)
}

/** Save many candidates at once (an email / list), then gather quietly. */
async function bulkAdd(candidates) {
  setCapStatus(`⏳ adding ${candidates.length} places…`)
  const saved = []
  for (const c of candidates) {
    const url = c.url ? cleanUrl(c.url) : null
    saved.push(await saveItem({
      url, title: c.title || (url ? hostTitle(url) : 'New place'),
      city: c.city || undefined, notes: c.note || undefined, domain: c.domain,
    }))
  }
  await refresh()
  toast(`Added ${saved.length} places`)
  setCapStatus(`✓ ${saved.length} added`)
  scheduleSync()
  // gather sequentially, gently, so external services aren't hammered
  let done = 0
  for (const s of saved) {
    await gatherInto(s)
    done++
    setCapStatus(`✓ finding ${done}/${saved.length}…`)
    await sleep(1200)
  }
  await refresh()
  scheduleSync()
  setCapStatus('✓ done')
  setTimeout(() => setCapStatus(''), 1600)
}

/**
 * Run the latest info-gathering on one saved record and merge the results.
 * Fresh data (hours, coords) is always refreshed; descriptive fields fill only
 * when empty so manual edits are preserved. Returns true if anything changed.
 */
async function gatherInto(rec) {
  let changed = false
  try {
    const info = await gatherInfo({ url: rec.url, title: rec.title, city: rec.city })
    if (info) {
      const merged = mergeGather(rec, info)
      merged.gatheredAt = new Date().toISOString()
      merged.gatherVersion = GATHER_VERSION
      await saveItem(merged)
      await refresh()
      changed = true
    } else {
      // mark attempted so the loop doesn't retry it every cycle
      await saveItem({ ...rec, gatheredAt: new Date().toISOString(), gatherVersion: GATHER_VERSION })
    }
  } catch { /* keep the optimistic item; try again next sweep */ }
  return changed
}

/** Merge policy: refresh volatile fields, fill descriptive ones only if empty. */
function mergeGather(rec, info) {
  const out = { ...rec, id: rec.id, createdAt: rec.createdAt }
  const isPlaceholder = !rec.title || rec.title === 'New place' || rec.title === hostTitle(rec.url)
  for (const k of ['hours', 'hoursByDay', 'lat', 'lng']) if (info[k] != null) out[k] = info[k]
  for (const k of ['city', 'category', 'domain', 'snippet', 'costRaw', 'website', 'description', 'image']) {
    if ((out[k] == null || out[k] === '') && info[k] != null) out[k] = info[k]
  }
  if (isPlaceholder && info.title) out.title = info.title
  // a bare name that resolved to a real website gets that as its openable link
  if (!out.url && info.website) out.url = info.website
  return out
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Background sweep: periodically re-run the latest gathering scripts on every
 * entry. Version-gated + age-gated so we only refetch what's stale, throttled
 * to stay a good citizen of the free lookup services.
 */
async function refreshAllEntries({ force } = {}) {
  if (state.refreshing) return
  state.refreshing = true
  try {
    const now = Date.now()
    const stale = state.items.filter((it) => {
      if (force) return true
      if ((it.gatherVersion || 0) < GATHER_VERSION) return true
      if (!it.gatheredAt) return true
      return now - Date.parse(it.gatheredAt) > REFRESH_MAX_AGE_MS
    })
    let n = 0
    for (const it of stale) {
      const fresh = state.items.find((x) => x.id === it.id) // may have changed
      if (!fresh) continue
      await gatherInto(fresh)
      if (++n >= 30) break // cap per sweep
      await sleep(1400)
    }
    if (n) scheduleSync()
  } finally {
    state.refreshing = false
  }
}

function startGatherLoop() {
  setTimeout(() => refreshAllEntries(), 4000) // shortly after boot
  setInterval(() => refreshAllEntries(), REFRESH_MS) // ~every 10 min
}

// ---------- capture autocomplete (famous places, offline-first) ----------
const AC_CACHE = new Map() // query → suggestions (session cache)
let acTimer = null
let acSeq = 0

function onCaptureInput(value) {
  const v = value.trim()
  clearTimeout(acTimer)
  // Don't autocomplete links or multi-line/bulk pastes — those are handled on add.
  if (v.length < 2 || /https?:\/\//i.test(v) || /[\n,]/.test(v)) return hideAc()
  // 1) instant offline suggestions from the bundled famous list
  const local = searchFamous(v, 6).map((p) => ({ ...p, title: p.name, src: 'famous' }))
  renderAc(v, local)
  // 2) augment with online results (debounced + cached), if connected
  acTimer = setTimeout(() => fetchSuggest(v, local), 240)
}

async function fetchSuggest(v, local) {
  const key = v.toLowerCase()
  const seq = ++acSeq
  let online = AC_CACHE.get(key) || loadAcCache(key)
  if (!online) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    try {
      online = await nominatimSuggest(v, { limit: 6 })
      AC_CACHE.set(key, online)
      saveAcCache(key, online)
    } catch { online = [] }
  }
  if (seq !== acSeq) return // a newer keystroke superseded this
  const merged = dedupeSuggest([...local, ...online.map((s) => ({ ...s, src: 'osm' }))])
  renderAc(v, merged)
}

function dedupeSuggest(list) {
  const seen = new Set()
  const out = []
  for (const s of list) {
    const k = `${(s.title || '').toLowerCase()}|${(s.city || '').toLowerCase()}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s)
    if (out.length >= 8) break
  }
  return out
}

function renderAc(query, suggestions) {
  const el = $('#acList')
  if (!el) return
  if (!suggestions.length) return hideAc()
  el.innerHTML = suggestions.map((s, i) => {
    const m = CATEGORY_META[s.category || 'other'] || CATEGORY_META.other
    const where = [s.city, s.country].filter(Boolean).join(', ')
    return `<button class="ac-item" data-i="${i}"><span class="ac-emoji">${m.emoji}</span>
      <span class="ac-name">${esc(s.title)}</span>${where ? `<span class="ac-where">${esc(where)}</span>` : ''}</button>`
  }).join('')
  el.hidden = false
  el.onclick = (e) => {
    const b = e.target.closest('.ac-item'); if (!b) return
    pickSuggestion(suggestions[Number(b.dataset.i)])
  }
}

function hideAc() { const el = $('#acList'); if (el) { el.hidden = true; el.innerHTML = '' } }

function pickSuggestion(s) {
  hideAc()
  const cap = $('#cap'); if (cap) cap.value = ''
  // has coords → fully offline-capable save; still gathers extra detail if online
  quickAddOne({ title: s.title, city: s.city || undefined, lat: s.lat, lng: s.lng, category: s.category, domain: s.domain })
}

function loadAcCache(key) {
  try {
    const raw = localStorage.getItem(LEGACY_COMPAT.autocompletePrefix + key)
    if (!raw) return null
    const { t, v } = JSON.parse(raw)
    if (Date.now() - t > 7 * 24 * 3600 * 1000) return null // 7-day TTL
    return v
  } catch { return null }
}
function saveAcCache(key, v) {
  try { localStorage.setItem(LEGACY_COMPAT.autocompletePrefix + key, JSON.stringify({ t: Date.now(), v })) } catch { /* quota */ }
}

// ---------- proximity alerts (within 100m of a liked place) ----------
const GEO_KEY = LEGACY_COMPAT.geoKey
function geoEnabled() { return localStorage.getItem(GEO_KEY) === '1' }

async function toggleGeo() {
  if (state.geo && state.geo.watchId != null) { stopGeo(); toast('Nearby alerts off'); return }
  await startGeo({ prompt: true })
}

async function startGeo({ prompt } = {}) {
  if (typeof navigator === 'undefined' || !navigator.geolocation) { toast('Location not available'); return }
  if (prompt && typeof Notification !== 'undefined' && Notification.permission === 'default') {
    try { await Notification.requestPermission() } catch { /* ignore */ }
  }
  state.geo = state.geo || { watchId: null, notified: {} }
  try {
    state.geo.watchId = navigator.geolocation.watchPosition(onPosition, onGeoErr, {
      enableHighAccuracy: true, maximumAge: 30000, timeout: 25000,
    })
    localStorage.setItem(GEO_KEY, '1')
    updateGeoChip()
    if (prompt) toast('Nearby alerts on — I’ll ping you within 100m of a spot')
  } catch { toast('Could not start location') }
}

function stopGeo() {
  if (state.geo && state.geo.watchId != null) navigator.geolocation.clearWatch(state.geo.watchId)
  if (state.geo) state.geo.watchId = null
  localStorage.setItem(GEO_KEY, '0')
  updateGeoChip()
}

function onGeoErr() { /* permission denied / timeout — stay quiet, keep watching */ }

function onPosition(pos) {
  if (!state.geo) return
  const { latitude, longitude } = pos.coords
  state.geo.lat = latitude
  state.geo.lng = longitude
  const fires = alertsToFire(latitude, longitude, state.items, {
    now: Date.now(), radiusM: 100, cooldownMs: 60 * 60 * 1000, lastNotified: state.geo.notified,
  })
  for (const { item, distanceM } of fires) {
    state.geo.notified[item.id] = Date.now()
    notifyNear(item, distanceM)
  }
}

async function notifyNear(item, distanceM) {
  const m = CATEGORY_META[item.category || 'other'] || CATEGORY_META.other
  const title = `📍 Near ${item.title}`
  const body = `${item.snippet || m.label}${item.hours ? ' · ' + String(item.hours).split(',')[0] : ''} · ${distanceM}m away`
  const icon = `${APP_BASE}icons/icon-192.png`
  const opts = { body, icon, badge: icon, tag: 'near-' + item.id }
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        const reg = await navigator.serviceWorker.ready
        await reg.showNotification(title, opts)
      } else {
        new Notification(title, opts)
      }
      return
    }
  } catch { /* fall through to in-app toast */ }
  toast(`${title} · ${distanceM}m`)
}

function updateGeoChip() {
  const el = $('#geoBtn')
  if (!el) return
  const on = state.geo && state.geo.watchId != null
  el.classList.toggle('on', !!on)
  el.textContent = on ? '🔔' : '🔕'
}

function setCapStatus(s) { const el = $('#capStatus'); if (el) el.textContent = s }
function hostTitle(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return 'New place' }
}

function cardHtml(it) {
  const m = CATEGORY_META[it.category || 'other']
  const dm = DOMAIN_META[it.domain] || DOMAIN_META.travel
  const th = todaysHours(it)
  const hours = th ? `<span class="hrs">🕐 ${esc(th)}</span>` : (it.hours ? `<span class="hrs">🕐 ${esc(it.hours.split(',')[0])}</span>` : '')
  const meta = []
  meta.push(`<span class="domain" title="Research area">${esc(dm.emoji)} ${esc(dm.label)}</span>`)
  if (it.city) meta.push(`<b>${esc(it.city)}</b>`)
  if (it.costUsd != null) meta.push(`~$${it.costUsd}`)
  const b = it.booking
  const am = b && ACCESS_META[b.tier]
  const access = am ? `<span class="access ${b.tier}" title="${esc(b.tierHint || '')}">${esc(am.emoji)} ${esc(b.tierLabel || am.label)}</span>` : ''
  const snippet = it.snippet ? `<div class="snip">${esc(it.snippet)}</div>` : ''
  const maps = it.mapsUrl ? `<a class="lnk" href="${esc(it.mapsUrl)}" target="_blank" rel="noopener" data-act="maps" title="Open in Google Maps">📍</a>` : ''
  const link = it.url ? `<a class="lnk" href="${esc(it.url)}" target="_blank" rel="noopener" data-act="open" title="Open source link">↗</a>` : ''
  return `
    <div class="card" data-id="${it.id}">
      <div class="ico" style="background:${m.color}33">${m.emoji}</div>
      <div class="body">
        <div class="row1"><h3>${esc(it.title)}</h3>${access}</div>
        ${snippet}
        <div class="meta">${meta.join('<i>·</i>')}${hours}
          <span class="links">${maps}${link}</span>
          <button class="mini" data-act="blurb" title="Copy concierge blurb">📋</button>
          <button class="mini" data-act="voice" title="Speak or call with OS3" aria-label="Speak or call with OS3">🗣️</button>
          <button class="mini" data-act="edit" title="Edit">✎</button>
          <button class="mini" data-act="del" title="Delete">✕</button>
        </div>
      </div>
    </div>`
}

function emptyState() {
  return `<div class="empty"><div class="big">🌸</div>
    <p>Gather travel, dining, culture, and family research here.<br>Paste a link above — it saves locally first.</p></div>`
}

// ---------- MAP ----------
function renderMap() {
  view.innerHTML = `
    <div class="filters" id="mapCity"></div>
    <div id="map"></div>`
  const cities = ['all', ...uniqueCities(state.items)]
  $('#mapCity').innerHTML = cities.map((c) => filterPill('city:' + c, state.filter.city === c, c === 'all' ? '🌍 All' : '📍 ' + c)).join('')
  $('#mapCity').addEventListener('click', (e) => {
    const p = e.target.closest('.pill'); if (!p) return
    state.filter.city = p.dataset.k.replace(/^city:/, ''); renderMap()
  })

  const located = applyFilters(state.items).filter((i) => i.lat != null && i.lng != null)
  requestAnimationFrame(() => {
    const map = L.map('map', { zoomControl: true }).setView([20, 10], 2)
    // Soft, muted basemap (Carto Positron) — gentler than default OSM tiles.
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19, subdomains: 'abcd',
      attribution: '© OpenStreetMap © CARTO',
    }).addTo(map)
    const group = []
    for (const it of located) {
      const m = CATEGORY_META[it.category || 'other']
      const icon = L.divIcon({ className: '', html: `<div class="pin-dot" style="background:${m.color}"></div>`, iconSize: [18, 18], iconAnchor: [9, 18] })
      const mk = L.marker([it.lat, it.lng], { icon }).addTo(map)
      mk.bindPopup(`<b>${esc(it.title)}</b><br>${m.emoji} ${m.label}${it.city ? ' · ' + esc(it.city) : ''}${it.url ? `<br><a href="${esc(it.url)}" target="_blank" rel="noopener">Open link ↗</a>` : ''}`)
      group.push([it.lat, it.lng])
    }
    if (group.length) map.fitBounds(group, { padding: [40, 40], maxZoom: 13 })
  })
}

// ---------- PLAN ----------
function renderPlan() {
  const grouped = groupByCity(state.items.filter((i) => i.category !== 'stay' || i.lat != null))
  const cities = Object.keys(grouped).filter((c) => c !== 'Unsorted').sort()
  if (!state.filter.planCity || !cities.includes(state.filter.planCity)) state.filter.planCity = cities[0] || 'Unsorted'

  view.innerHTML = `
    <div class="plan-controls">
      <div class="field"><label>City</label><select id="planCity">${['Unsorted', ...cities].filter((c, i, a) => a.indexOf(c) === i).map((c) => `<option ${c === state.filter.planCity ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="field"><label>Start time</label><input id="planStart" type="time" value="${state.filter.planStart || '09:00'}" /></div>
      <div class="field"><label>Trip budget ($)</label><input id="planBudget" type="number" inputmode="numeric" placeholder="optional" value="${state.filter.planBudget || ''}" /></div>
      <div class="field" style="justify-content:flex-end"><button class="btn primary" id="planCopy" style="padding:11px">📋 Copy plan</button></div>
    </div>
    <div id="planOut"></div>`

  const rebuild = () => {
    state.filter.planCity = $('#planCity').value
    state.filter.planStart = $('#planStart').value
    state.filter.planBudget = $('#planBudget').value
    renderPlanOut(grouped)
  }
  $('#planCity').addEventListener('change', rebuild)
  $('#planStart').addEventListener('change', rebuild)
  $('#planBudget').addEventListener('input', rebuild)
  $('#planCopy').addEventListener('click', () => {
    const plan = currentPlan(grouped)
    copyText(itineraryBlurb(plan, { city: state.filter.planCity }), 'Itinerary copied for concierge')
  })
  renderPlanOut(grouped)
}

function currentPlan(grouped) {
  const items = grouped[state.filter.planCity] || []
  return buildItinerary(items, {
    startTime: state.filter.planStart || '09:00',
    tripBudgetUsd: Number(state.filter.planBudget) || 0,
  })
}

function renderPlanOut(grouped) {
  const plan = currentPlan(grouped)
  const out = $('#planOut')
  if (!plan.stops.length && !plan.unlocated.length) {
    out.innerHTML = `<div class="empty"><div class="big">🧠</div><p>Add a few places in this city (with a location) and OS3 Concierge will order your day.</p></div>`
    return
  }
  const stops = plan.stops.map((s) => {
    const m = CATEGORY_META[s.item.category || 'other']
    const hop = s.hopFromPrev ? `<p class="hop">↳ ${s.hopFromPrev.mode} ~${formatDuration(s.hopFromPrev.minutes)} · ${s.hopFromPrev.km} km</p>` : ''
    return `<div class="stop"><div class="time">${s.arriveLabel}</div><div style="flex:1">${hop}<b>${m.emoji} ${esc(s.item.title)}</b><div class="card-meta" style="color:var(--muted);font-size:12px">${formatDuration(s.item.visitMin)}${s.item.costUsd ? ' · ~$' + s.item.costUsd : ''}</div></div></div>`
  }).join('')
  const t = plan.totals
  const budget = t.budget ? ` · budget: <b>${t.budget.pct}%</b> used` : ''
  const resv = plan.reservations.length
    ? `<div class="section-title">Book ahead</div>` + plan.reservations.map((r) => `<div class="card"><div class="body"><b>${esc(r.title)}</b><div class="meta">book ~${r.leadDays} days ahead · ${esc(r.note)}</div></div></div>`).join('')
    : ''
  const unl = plan.unlocated.length
    ? `<div class="section-title">Also on the list</div>` + plan.unlocated.map((i) => `<div class="meta" style="margin:4px 2px">${CATEGORY_META[i.category || 'other'].emoji} ${esc(i.title)}</div>`).join('')
    : ''
  out.innerHTML = `
    ${stops}
    <div class="totals"><b>${t.stops}</b> stops · ~<b>${t.distanceKm} km</b> · transit ${formatDuration(t.transitMin)} · visits ${formatDuration(t.visitMin)} · est. <b>$${t.costUsd}</b>${budget}<br>Ends around <b>${t.endLabel}</b>.</div>
    ${resv}${unl}`
}

// ---------- ADD / EDIT SHEET ----------
function openAddSheet(existing) {
  const it = existing || {}
  const isEdit = !!existing
  $('#sheetBody').innerHTML = `
    <h2>${isEdit ? 'Edit place' : 'Add a place'}</h2>
    <div class="form-row">
      <label>Link (paste anything)</label>
      <input id="fUrl" type="url" inputmode="url" placeholder="https://…" value="${esc(it.url || '')}" />
      ${isEdit ? '' : '<p class="hint" id="enrichHint">Paste a link and OS3 Concierge auto-fills the details.</p>'}
    </div>
    <div class="form-row"><label>Name</label><input id="fTitle" placeholder="Place name" value="${esc(it.title || '')}" /></div>
    <div class="form-row">
      <label>Category</label>
      <div class="cat-grid" id="fCat">${CATEGORIES.map((c) => `<button data-c="${c}" class="${(it.category || 'eat') === c ? 'is-active' : ''}" title="${CATEGORY_META[c].label}">${CATEGORY_META[c].emoji}</button>`).join('')}</div>
    </div>
    <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div><label>City</label><input id="fCity" placeholder="e.g. Tokyo" value="${esc(it.city || '')}" /></div>
      <div><label>Cost</label><input id="fCost" placeholder="e.g. $40" value="${esc(it.costRaw || '')}" /></div>
    </div>
    <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div><label>Research area</label><select id="fDomain">
        <option value="auto"${!it.domain ? ' selected' : ''}>Auto</option>
        ${DOMAINS.map((d) => `<option value="${d}"${it.domain === d ? ' selected' : ''}>${DOMAIN_META[d].emoji} ${DOMAIN_META[d].label}</option>`).join('')}
      </select></div>
      <div><label>Getting in</label><select id="fAccess">
        <option value="auto"${!it.access ? ' selected' : ''}>Auto${it.booking ? ` · ${it.booking.tierLabel}` : ''}</option>
        ${ACCESS_TIERS.map((t) => `<option value="${t}"${it.access === t ? ' selected' : ''}>${ACCESS_META[t].emoji} ${ACCESS_META[t].label}</option>`).join('')}
      </select></div>
    </div>
    <div class="form-row"><label>Opening hours</label><input id="fHours" placeholder="e.g. Mon–Fri 9–17" value="${esc(it.hours || '')}" /></div>
    <div class="form-row"><label>Short snippet</label><input id="fSnippet" placeholder="One-line description" value="${esc(it.snippet || '')}" /></div>
    <div class="form-row"><label>Notes</label><textarea id="fNotes" placeholder="Why you want to go…">${esc(it.notes || '')}</textarea></div>
    <div class="sheet-actions">
      <button class="btn ghost" data-close>Cancel</button>
      <button class="btn primary" id="fSave">${isEdit ? 'Save' : 'Add place'}</button>
    </div>`
  openSheet()

  let cat = it.category || 'eat'
  $('#fCat').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return
    cat = b.dataset.c
    $('#fCat').querySelectorAll('button').forEach((x) => x.classList.toggle('is-active', x === b))
  })

  // Auto-gather on paste/blur of the link OR the name (handles URLs, Google
  // maps/share links, and bare names via the place lookup).
  const urlInput = $('#fUrl')
  urlInput.addEventListener('change', () => tryGather())
  $('#fTitle').addEventListener('change', () => { if (!urlInput.value.trim()) tryGather() })
  if (!isEdit && it.url) tryGather()

  async function tryGather() {
    const url = urlInput.value.trim()
    const title = $('#fTitle').value.trim()
    if (!url && !title) return
    const hint = $('#enrichHint')
    if (hint) hint.innerHTML = '<span class="spinner"></span> Looking it up…'
    try {
      const data = await gatherInfo({ url: url || null, title, city: $('#fCity').value.trim() || null })
      if (!data) { if (hint) hint.textContent = 'Nothing found — fill in manually.'; return }
      if (data.title && !$('#fTitle').value) $('#fTitle').value = data.title
      if (data.city && !$('#fCity').value) $('#fCity').value = data.city
      if (data.costRaw && !$('#fCost').value) $('#fCost').value = data.costRaw
      if (data.snippet && !$('#fSnippet').value) $('#fSnippet').value = data.snippet
      if (data.hours && !$('#fHours').value) $('#fHours').value = data.hours
      if (data.description && !$('#fNotes').value) $('#fNotes').value = data.description.slice(0, 200)
      if (hint) hint.textContent = '✓ Auto-filled from the lookup.'
    } catch {
      if (hint) hint.textContent = 'Could not look that up — fill in manually.'
    }
  }

  $('#fSave').addEventListener('click', async () => {
    const cityVal = $('#fCity').value.trim()
    const cityChanged = (cityVal || null) !== (it.city || null)
    const access = $('#fAccess').value
    const domain = $('#fDomain').value
    const raw = {
      id: it.id, createdAt: it.createdAt, source: it.source,
      // preserve enrichment the form doesn't expose:
      image: it.image, description: it.description, hoursByDay: it.hoursByDay,
      // if the city changed, drop stale coords so they re-resolve:
      lat: cityChanged ? undefined : it.lat, lng: cityChanged ? undefined : it.lng,
      // editable fields:
      url: $('#fUrl').value, title: $('#fTitle').value,
      category: cat, city: cityVal, costRaw: $('#fCost').value,
      domain: domain === 'auto' ? undefined : domain,
      hours: $('#fHours').value, snippet: $('#fSnippet').value,
      notes: $('#fNotes').value,
      access: access === 'auto' ? undefined : access,
    }
    if (!raw.title && !raw.url) { toast('Add a name or a link'); return }
    const saved = await saveItem(raw)
    closeSheet()
    await refresh()
    toast(isEdit ? 'Saved' : `Added ${saved.title}`)
    scheduleSync()
  })
}

async function removeItem(id) {
  await deleteItem(id)
  await refresh()
  toast('Deleted')
  scheduleSync()
}

// ---------- SPACE / SYNC ----------
function openSpaceSheet() {
  const sp = state.space
  $('#sheetBody').innerHTML = sp ? spaceConnectedHtml(sp) : spaceSetupHtml()
  openSheet()
  if (sp) {
    $('#spSync').addEventListener('click', async () => { await syncNow(); if (!$('#sheet').hidden) openSpaceSheet() })
    $('#spCopy').addEventListener('click', () => copyText(encodeSpaceCode(sp.blobId, sp.passphrase), 'Space code copied — send to your travel buddy'))
    $('#spLeave').addEventListener('click', () => { clearSpace(); state.space = null; updateSpaceLabel(); closeSheet(); toast('Left shared space') })
  } else {
    $('#spCreate').addEventListener('click', createSpace)
    $('#spJoin').addEventListener('click', () => joinSpace($('#spCode').value))
  }
}

function openXraySheet() {
  $('#sheetBody').innerHTML = `<h2>🩻 X-ray workbench</h2>
    <p class="hint">Tailnet-only local data. Shared-space sync is disabled here, so production ciphertext cannot be changed.</p>
    <div class="sheet-actions"><button class="btn primary" data-close>Done</button></div>`
  openSheet()
}

function spaceSetupHtml() {
  return `<h2>🔗 Shared space</h2>
    <p class="hint">Sync your wishlist with cc & nana. Data is <b>end-to-end encrypted</b> — the sync host only sees ciphertext.</p>
    <div class="form-row"><button class="btn primary" id="spCreate" style="width:100%;padding:13px">Create a new shared space</button></div>
    <div class="section-title">or join an existing one</div>
    <div class="form-row"><input id="spCode" placeholder="Paste space code (wander1.…)" /></div>
    <div class="form-row"><button class="btn" id="spJoin" style="width:100%;padding:12px">Join space</button></div>`
}

function spaceConnectedHtml(sp) {
  const status = state.syncError
    ? `<p class="hint" style="color:#c58a86">⚠ Last sync failed: ${esc(state.syncError)}. It retries automatically — tap “Sync now”.</p>`
    : state.lastSyncedAt
      ? `<p class="hint" style="color:#6f9268">✓ Synced ${agoLabel(state.lastSyncedAt)}.</p>`
      : `<p class="hint">Not synced yet — tap “Sync now”.</p>`
  return `<h2>🔗 Shared space</h2>
    <p class="hint">Share this code so your travel buddy joins the same list:</p>
    <div class="code-box" id="codeBox">${esc(encodeSpaceCode(sp.blobId, sp.passphrase))}</div>
    ${status}
    <div class="sheet-actions" style="margin-top:12px">
      <button class="btn" id="spCopy">📋 Copy code</button>
      <button class="btn primary" id="spSync">↻ Sync now</button>
    </div>
    <div class="form-row" style="margin-top:14px"><button class="btn ghost danger" id="spLeave" style="width:100%">Leave space (keeps local data)</button></div>`
}

function agoLabel(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  return `${Math.round(s / 3600)}h ago`
}

async function createSpace() {
  try {
    toast('Creating shared space…')
    const blobId = await SyncClient.createSpace()
    const passphrase = randomPhrase()
    state.space = { blobId, passphrase }
    saveSpace(state.space)
    updateSpaceLabel()
    await syncNow()
    openSpaceSheet()
  } catch (e) {
    toast('Could not create space (offline?)')
  }
}

async function joinSpace(code) {
  const parsed = parseSpaceCode(code)
  if (!parsed) { toast('That code looks invalid'); return }
  state.space = parsed
  saveSpace(state.space)
  updateSpaceLabel()
  closeSheet()
  await syncNow()
}

let syncTimer = null
let syncInFlight = false
/** Debounced sync — coalesces a storm of saves (bulk add, gather loop) into one
 * push so we never hammer the sync host. Use for background/auto syncs. */
function scheduleSync() {
  if (XRAY || !state.space) return
  clearTimeout(syncTimer)
  syncTimer = setTimeout(() => syncNow({ silent: true }), 2500)
}

async function syncNow({ silent } = {}) {
  if (XRAY || !state.space) return
  if (syncInFlight) { scheduleSync(); return } // don't overlap; retry after
  syncInFlight = true
  try {
    const key = await deriveKey(state.space.passphrase)
    const client = new SyncClient({ blobId: state.space.blobId, key })
    const local = await allRecords()
    const merged = await client.sync(local)
    await replaceAll(merged)
    state.syncError = null
    state.lastSyncedAt = Date.now()
    await refresh()
    updateSpaceLabel()
    if (!silent) toast(`Synced ✓ ${merged.filter((i) => !i.deleted).length} places`)
  } catch (e) {
    state.syncError = String((e && e.message) || e || 'unknown error')
    updateSpaceLabel()
    if (!silent) toast(`Sync failed: ${state.syncError}`)
  } finally {
    syncInFlight = false
  }
}

function updateSpaceLabel() {
  const el = $('#spaceLabel')
  if (!el) return
  el.textContent = XRAY ? 'Local' : !state.space ? 'Solo' : state.syncError ? '⚠ Sync' : 'Synced'
}

// ---------- deep links ----------
function handleDeepLinks() {
  const p = new URLSearchParams(location.search)
  const join = p.get('join')
  if (join && !state.space && !XRAY) { joinSpace(join); return }
  const add = p.get('add') || p.get('url') || p.get('text')
  if (add) {
    history.replaceState(null, '', location.pathname)
    openAddSheet({ url: extractUrl(add) })
  }
}
function extractUrl(s) {
  const m = String(s).match(/https?:\/\/\S+/)
  return m ? m[0] : s
}

// ---------- sheet + toast utils ----------
function openSheet() { $('#sheet').hidden = false }
function closeSheet() { $('#sheet').hidden = true }
let toastT
function toast(msg) {
  const el = $('#toast')
  el.textContent = msg
  el.hidden = false
  clearTimeout(toastT)
  toastT = setTimeout(() => (el.hidden = true), 2600)
}
async function copyText(text, okMsg) {
  try {
    if (navigator.share && /Mobi|Android|iPhone/i.test(navigator.userAgent)) {
      await navigator.share({ text })
      return
    }
    await navigator.clipboard.writeText(text)
    toast(okMsg || 'Copied')
  } catch {
    // fallback: temporary textarea
    const ta = document.createElement('textarea')
    ta.value = text; document.body.appendChild(ta); ta.select()
    try { document.execCommand('copy'); toast(okMsg || 'Copied') } catch { toast('Copy failed') }
    ta.remove()
  }
}

// ---------- pure helpers ----------
function applyFilters(items) {
  const f = state.filter
  return items.filter((it) => {
    if (f.domain !== 'all' && (it.domain || 'travel') !== f.domain) return false
    if (f.category !== 'all' && it.category !== f.category) return false
    if (f.city !== 'all' && it.city !== f.city) return false
    if (f.q) {
      const domain = DOMAIN_META[it.domain] || DOMAIN_META.travel
      const hay = [it.title, it.city, it.notes, domain.label, (it.tags || []).join(' ')].join(' ').toLowerCase()
      if (!hay.includes(f.q.toLowerCase())) return false
    }
    return true
  })
}
function uniqueCities(items) {
  return [...new Set(items.map((i) => i.city).filter(Boolean))].sort()
}
function filterPill(k, active, label) {
  return `<button class="pill ${active ? 'is-active' : ''}" data-k="${esc(k)}">${esc(label)}</button>`
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
function randomPhrase() {
  const w = ['tokyo', 'ramen', 'sunset', 'harbor', 'lantern', 'ferry', 'orchid', 'cobalt', 'saffron', 'monsoon', 'compass', 'atlas', 'summit', 'delta', 'nomad']
  const r = globalThis.crypto.getRandomValues(new Uint32Array(3))
  return [w[r[0] % w.length], w[r[1] % w.length], r[2] % 9000 + 1000].join('-')
}

boot()

import './styles.css'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { registerSW } from 'virtual:pwa-register'

import { CATEGORIES, CATEGORY_META, todaysHours, cleanUrl } from './lib/normalize.js'
import { enrichFromUrl } from './lib/enrich.js'
import { groupByCity, buildItinerary } from './lib/itinerary.js'
import { itemBlurb, itineraryBlurb } from './lib/blurb.js'
import { formatDuration } from './lib/transit.js'
import {
  allItems, allRecords, saveItem, deleteItem, replaceAll, seedIfEmpty,
  loadSpace, saveSpace, clearSpace,
} from './lib/store.js'
import {
  deriveKey, SyncClient, encodeSpaceCode, parseSpaceCode, mergeItems,
} from './lib/sync.js'

registerSW({ immediate: true })

const state = {
  tab: 'list',
  items: [],
  filter: { category: 'all', city: 'all', q: '' },
  space: loadSpace(),
  map: null,
  markers: null,
}

const $ = (s, r = document) => r.querySelector(s)
const view = $('#view')

// ---------- boot ----------
async function boot() {
  await seedIfEmpty()
  state.items = await allItems()
  handleDeepLinks()
  updateSpaceLabel()
  wireChrome()
  render()
  if (state.space) syncNow({ silent: true })
}

function wireChrome() {
  document.querySelectorAll('.tab').forEach((t) =>
    t.addEventListener('click', () => setTab(t.dataset.tab))
  )
  $('#fab').addEventListener('click', () => openAddSheet())
  $('#spaceBtn').addEventListener('click', openSpaceSheet)
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
  render()
}

function render() {
  if (state.tab === 'list') renderList()
  else if (state.tab === 'map') renderMap()
  else if (state.tab === 'plan') renderPlan()
}

// ---------- LIST (landing = instant capture) ----------
function renderList() {
  const cities = ['all', ...uniqueCities(state.items)]
  const f = state.filter
  const filtered = applyFilters(state.items)

  view.innerHTML = `
    <div class="capture">
      <input class="capture-input" id="cap" enterkeyhint="done" autocomplete="off"
        placeholder="Paste a link or type a place + Enter" value="" />
      <span class="capture-status" id="capStatus"></span>
    </div>
    <input class="search" id="q" placeholder="🔍 Filter…" value="${esc(f.q)}" />
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
    if (e.key === 'Enter' && cap.value.trim()) { const v = cap.value; cap.value = ''; quickAdd(v) }
  })
  cap.addEventListener('paste', (e) => {
    const text = (e.clipboardData || window.clipboardData).getData('text')
    if (text && /https?:\/\//i.test(text)) {
      e.preventDefault(); cap.value = ''; quickAdd(text)
    }
  })

  $('#q').addEventListener('input', (e) => { state.filter.q = e.target.value; renderCards() })
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

function onCardClick(e) {
  const btn = e.target.closest('[data-act]')
  const card = e.target.closest('.card')
  if (!card) return
  const id = card.dataset.id
  const item = state.items.find((i) => i.id === id)
  if (!item) return
  const act = btn ? btn.dataset.act : 'open' // tap anywhere else = open link
  if (act === 'blurb') { copyText(itemBlurb(item), 'Blurb copied for concierge'); e.stopPropagation() }
  else if (act === 'edit') openAddSheet(item)
  else if (act === 'del') removeItem(id)
  else if (act === 'open' && item.url) window.open(item.url, '_blank', 'noopener')
}

/** Optimistic instant save, then async enrich in the background. */
async function quickAdd(text) {
  const raw = text.trim()
  const url = cleanUrl(raw)
  setCapStatus(url ? '⏳ saving + looking up…' : '⏳ saving…')
  // 1) instant save so it shows immediately
  const seed = url ? { url, title: hostTitle(url) } : { title: raw }
  const saved = await saveItem(seed)
  await refresh()
  setCapStatus('✓ added')
  if (state.space) syncNow({ silent: true })
  // 2) enrich in background (real users' browsers can fetch cross-origin)
  if (url) {
    try {
      const data = await enrichFromUrl(url)
      if (data && (data.title || data.snippet || data.hoursByDay || data.costRaw)) {
        await saveItem({ ...saved, ...data, id: saved.id, createdAt: saved.createdAt, title: data.title || saved.title })
        await refresh()
        setCapStatus('✓ enriched')
        if (state.space) syncNow({ silent: true })
      }
    } catch { /* keep the optimistic item */ }
  }
  setTimeout(() => setCapStatus(''), 1800)
}

function setCapStatus(s) { const el = $('#capStatus'); if (el) el.textContent = s }
function hostTitle(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return 'New place' }
}

function cardHtml(it) {
  const m = CATEGORY_META[it.category || 'other']
  const th = todaysHours(it)
  const hours = th ? `<span class="hrs">🕐 ${esc(th)}</span>` : (it.hours ? `<span class="hrs">🕐 ${esc(it.hours.split(',')[0])}</span>` : '')
  const meta = []
  if (it.city) meta.push(`<b>${esc(it.city)}</b>`)
  if (it.costUsd != null) meta.push(`~$${it.costUsd}`)
  const diff = it.booking ? `<span class="diff d${it.booking.score}" title="${esc(it.booking.label)}">${'●'.repeat(it.booking.score)}${'○'.repeat(5 - it.booking.score)}</span>` : ''
  const snippet = it.snippet ? `<div class="snip">${esc(it.snippet)}</div>` : ''
  const link = it.url ? `<a class="lnk" href="${esc(it.url)}" target="_blank" rel="noopener" data-act="open">↗</a>` : ''
  return `
    <div class="card" data-id="${it.id}">
      <div class="ico" style="background:${m.color}22">${m.emoji}</div>
      <div class="body">
        <div class="row1"><h3>${esc(it.title)}</h3>${diff}</div>
        ${snippet}
        <div class="meta">${meta.join('<i>·</i>')}${hours}
          ${link}
          <button class="mini" data-act="blurb" title="Copy concierge blurb">📋</button>
          <button class="mini" data-act="edit" title="Edit">✎</button>
          <button class="mini" data-act="del" title="Delete">✕</button>
        </div>
      </div>
    </div>`
}

function emptyState() {
  return `<div class="empty"><div class="big">🧳</div>
    <p>Nothing here yet — paste a link above and it saves instantly.</p></div>`
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
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap',
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
    out.innerHTML = `<div class="empty"><div class="big">🧠</div><p>Add a few places in this city (with a location) and Wander will order your day.</p></div>`
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
      ${isEdit ? '' : '<p class="hint" id="enrichHint">Paste a link and Wander auto-fills the details.</p>'}
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

  // Auto-enrich on paste/blur of URL
  const urlInput = $('#fUrl')
  urlInput.addEventListener('change', () => tryEnrich(urlInput.value))
  if (!isEdit && it.url) tryEnrich(it.url)

  async function tryEnrich(url) {
    if (!url || !/^https?:\/\//i.test(url)) return
    const hint = $('#enrichHint')
    if (hint) hint.innerHTML = '<span class="spinner"></span> Looking it up…'
    try {
      const data = await enrichFromUrl(url)
      if (data.title && !$('#fTitle').value) $('#fTitle').value = data.title
      if (data.city && !$('#fCity').value) $('#fCity').value = data.city
      if (data.costRaw && !$('#fCost').value) $('#fCost').value = data.costRaw
      if (data.description && !$('#fNotes').value) $('#fNotes').value = data.description.slice(0, 200)
      // auto-pick category from enriched text
      if (hint) hint.textContent = data.source === 'enriched' ? '✓ Auto-filled from the link.' : 'Could not read that link — fill in manually.'
    } catch {
      if (hint) hint.textContent = 'Could not read that link — fill in manually.'
    }
  }

  $('#fSave').addEventListener('click', async () => {
    const raw = {
      id: it.id, createdAt: it.createdAt,
      url: $('#fUrl').value, title: $('#fTitle').value,
      category: cat, city: $('#fCity').value, costRaw: $('#fCost').value,
      notes: $('#fNotes').value, source: it.source,
    }
    if (!raw.title && !raw.url) { toast('Add a name or a link'); return }
    const saved = await saveItem(raw)
    closeSheet()
    await refresh()
    toast(isEdit ? 'Saved' : `Added ${saved.title}`)
    if (state.space) syncNow({ silent: true })
  })
}

async function removeItem(id) {
  await deleteItem(id)
  await refresh()
  toast('Deleted')
  if (state.space) syncNow({ silent: true })
}

// ---------- SPACE / SYNC ----------
function openSpaceSheet() {
  const sp = state.space
  $('#sheetBody').innerHTML = sp ? spaceConnectedHtml(sp) : spaceSetupHtml()
  openSheet()
  if (sp) {
    $('#spSync').addEventListener('click', () => syncNow())
    $('#spCopy').addEventListener('click', () => copyText(encodeSpaceCode(sp.blobId, sp.passphrase), 'Space code copied — send to your travel buddy'))
    $('#spLeave').addEventListener('click', () => { clearSpace(); state.space = null; updateSpaceLabel(); closeSheet(); toast('Left shared space') })
  } else {
    $('#spCreate').addEventListener('click', createSpace)
    $('#spJoin').addEventListener('click', () => joinSpace($('#spCode').value))
  }
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
  return `<h2>🔗 Shared space</h2>
    <p class="hint">You're synced. Share this code so your travel buddy joins the same list:</p>
    <div class="code-box" id="codeBox">${esc(encodeSpaceCode(sp.blobId, sp.passphrase))}</div>
    <div class="sheet-actions" style="margin-top:14px">
      <button class="btn" id="spCopy">📋 Copy code</button>
      <button class="btn primary" id="spSync">↻ Sync now</button>
    </div>
    <div class="form-row" style="margin-top:14px"><button class="btn ghost danger" id="spLeave" style="width:100%">Leave space (keeps local data)</button></div>`
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

async function syncNow({ silent } = {}) {
  if (!state.space) return
  try {
    const key = await deriveKey(state.space.passphrase)
    const client = new SyncClient({ blobId: state.space.blobId, key })
    const local = await allRecords()
    const merged = await client.sync(local)
    await replaceAll(merged)
    await refresh()
    if (!silent) toast('Synced ✓')
  } catch (e) {
    if (!silent) toast('Sync failed (offline?)')
  }
}

function updateSpaceLabel() {
  $('#spaceLabel').textContent = state.space ? 'Synced' : 'Solo'
}

// ---------- deep links ----------
function handleDeepLinks() {
  const p = new URLSearchParams(location.search)
  const join = p.get('join')
  if (join && !state.space) { joinSpace(join); return }
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
    if (f.category !== 'all' && it.category !== f.category) return false
    if (f.city !== 'all' && it.city !== f.city) return false
    if (f.q) {
      const hay = [it.title, it.city, it.notes, (it.tags || []).join(' ')].join(' ').toLowerCase()
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

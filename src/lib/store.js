// IndexedDB-backed local store (source of truth, offline-first) plus space
// config persisted in localStorage. Wraps normalization so every write is
// consistent. Sync (sync.js) reconciles this local store with the shared blob.

import { normalizeItem } from './normalize.js'

const DB_NAME = 'wander'
const DB_VERSION = 1
const STORE = 'items'
const SPACE_KEY = 'wander.space'

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' })
        os.createIndex('city', 'city', { unique: false })
        os.createIndex('category', 'category', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const os = t.objectStore(STORE)
    const result = fn(os)
    t.oncomplete = () => resolve(result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

export function makeId() {
  const c = globalThis.crypto
  if (c && c.randomUUID) return c.randomUUID()
  return 'id-' + Math.abs(hashStr(String(performance.now()) + ':' + Object.keys({}).length)).toString(36)
}

/** All non-deleted items. */
export async function allItems() {
  const db = await openDb()
  const items = await tx(db, 'readonly', (os) => {
    const acc = []
    os.openCursor().onsuccess = (e) => {
      const cur = e.target.result
      if (cur) {
        if (!cur.value.deleted) acc.push(cur.value)
        cur.continue()
      }
    }
    return acc
  })
  return items.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
}

/** Every record including tombstones — used by sync. */
export async function allRecords() {
  const db = await openDb()
  return tx(db, 'readonly', (os) => {
    const acc = []
    os.openCursor().onsuccess = (e) => {
      const cur = e.target.result
      if (cur) {
        acc.push(cur.value)
        cur.continue()
      }
    }
    return acc
  })
}

export async function saveItem(raw) {
  const db = await openDb()
  const now = new Date().toISOString()
  const norm = normalizeItem(raw)
  const record = {
    id: raw.id || makeId(),
    createdAt: raw.createdAt || now,
    updatedAt: now,
    deleted: false,
    ...norm,
  }
  await tx(db, 'readwrite', (os) => os.put(record))
  return record
}

export async function deleteItem(id) {
  const db = await openDb()
  const now = new Date().toISOString()
  await tx(db, 'readwrite', (os) => {
    const g = os.get(id)
    g.onsuccess = () => {
      const rec = g.result || { id }
      os.put({ ...rec, deleted: true, updatedAt: now })
    }
  })
}

/** Replace the whole store with merged records (used after a sync). */
export async function replaceAll(records) {
  const db = await openDb()
  await tx(db, 'readwrite', (os) => {
    for (const r of records) if (r && r.id) os.put(r)
  })
}

// --- space config (localStorage) ---
export function loadSpace() {
  try {
    const raw = localStorage.getItem(SPACE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
export function saveSpace(space) {
  localStorage.setItem(SPACE_KEY, JSON.stringify(space))
}
export function clearSpace() {
  localStorage.removeItem(SPACE_KEY)
}

function hashStr(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i)
  return h
}

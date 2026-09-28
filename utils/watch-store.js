import { LocalStorage } from '@zos/storage'
import { sanitize, applyOps, queueOp, lastSeq } from './presets'

// The watch copy of the data, shared by the app page and the shortcut card.
// A LocalStorage instance keeps the file in memory, so every read and write
// opens a fresh one: the page and the card never work from a stale copy of
// each other's changes.

function readJSON(store, key, fallback) {
  try {
    const raw = store.getItem(key, null)
    if (raw === null || raw === undefined || raw === '') return fallback
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch (e) {
    return fallback
  }
}

// { data, pending, seq, lid, wid } — see page/home/index.page.js for what each one is.
export function readLocal() {
  const store = new LocalStorage()
  const stored = readJSON(store, 'pending', [])
  const pending = Array.isArray(stored) ? stored : []
  return {
    data: sanitize(readJSON(store, 'data', null)),
    pending,
    seq: Math.max(Number(store.getItem('seq', 0)) || 0, lastSeq(pending)),
    lid: String(store.getItem('lid', '') || ''),
    wid: String(store.getItem('wid', '') || '')
  }
}

export function writeLocal(s) {
  const store = new LocalStorage()
  store.setItem('data', JSON.stringify(s.data))
  store.setItem('pending', JSON.stringify(s.pending))
  store.setItem('seq', s.seq)
  store.setItem('lid', s.lid)
  if (s.wid) store.setItem('wid', s.wid)
}

// A change made on the watch: queued for the phone and applied to the local data.
export function recordChange(s, op) {
  op.seq = ++s.seq
  s.pending = queueOp(s.pending, op)
  s.data = applyOps(s.data, [op])
  writeLocal(s)
}

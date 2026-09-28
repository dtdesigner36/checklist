// Shared data helpers.
//
// data = { defaultId, presets: [{ id, name, locations: [{ id, name, open }] }], settings }
// Each preset has its own locations; ids are unique across all presets.
// defaultId is the preset the watch opens on start.
// settings = { vibration: 'off' | 'light' | 'medium' | 'strong', sound, keepScreen }
//
// The phone copy (settingsStorage "presets") is { rev, by, lid, data }:
// rev grows on every write, by ('watch' | 'phone') says who wrote it last,
// lid is a random id given when the copy is created from nothing, so the watch
// can tell when the phone lost its copy (Zepp reinstalled, a new phone).
//
// Changes made on the watch are kept as ops until the phone confirms them:
//   { seq, kind: 'open', id, open }   a location switched open / closed
//   { seq, kind: 'default', id }      a preset chosen as the default
//   { seq, kind: 'setting', id, value }  a setting changed (id is its key)
// Ops carry the new value rather than "flip", so applying one twice gives the same result.
// seq grows per watch install (wid). The phone remembers the last seq it applied
// (settingsStorage "watchAck" = { wid, seq }) and skips ops it has already seen,
// so an op re-sent after a lost reply cannot undo a later edit made in Zepp.

export const STORAGE_KEY = 'presets'
export const ACK_KEY = 'watchAck'
export const MAX_NAME = 100
export const VIBRATION = ['off', 'light', 'medium', 'strong']
export const DEFAULT_SETTINGS = { vibration: 'light', sound: false, keepScreen: false }

export function cleanSettings(settings) {
  const s = settings && typeof settings === 'object' ? settings : {}
  return {
    vibration: VIBRATION.indexOf(s.vibration) >= 0 ? s.vibration : DEFAULT_SETTINGS.vibration,
    sound: typeof s.sound === 'boolean' ? s.sound : DEFAULT_SETTINGS.sound,
    keepScreen: typeof s.keepScreen === 'boolean' ? s.keepScreen : DEFAULT_SETTINGS.keepScreen
  }
}

export function newId() {
  return Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36)
}

export function cleanName(name) {
  return typeof name === 'string' ? name.trim().slice(0, MAX_NAME) : ''
}

function cleanList(list, map) {
  if (!Array.isArray(list)) return []
  return list.filter((x) => x && cleanName(x.name)).map(map)
}

export function sanitize(data) {
  const presets = cleanList(data && data.presets, (p) => ({
    id: p.id ? String(p.id) : newId(),
    name: cleanName(p.name),
    locations: cleanList(p.locations, (l) => ({
      id: l.id ? String(l.id) : newId(),
      name: cleanName(l.name),
      open: !!l.open
    }))
  }))
  const wanted = data && data.defaultId ? String(data.defaultId) : ''
  const defaultId = presets.some((p) => p.id === wanted) ? wanted : presets.length ? presets[0].id : ''
  return { defaultId, presets, settings: cleanSettings(data && data.settings) }
}

export function defaultPreset(data) {
  return data.presets.find((p) => p.id === data.defaultId) || null
}

export function findLocation(data, id) {
  for (const p of data.presets) {
    const loc = p.locations.find((l) => l.id === id)
    if (loc) return loc
  }
  return null
}

// Stored string -> { rev, by, lid, data }, or null if nothing usable is stored.
export function readDoc(str) {
  if (!str) return null
  let doc
  try {
    doc = JSON.parse(str)
  } catch (e) {
    return null
  }
  if (!doc || !doc.data) return null
  return {
    rev: Number(doc.rev) || 0,
    by: doc.by === 'watch' ? 'watch' : 'phone',
    lid: doc.lid ? String(doc.lid) : '',
    data: sanitize(doc.data)
  }
}

// Next version of the phone copy after a write by 'watch' or 'phone'.
export function makeDoc(prev, data, by) {
  return {
    rev: (prev ? prev.rev : 0) + 1,
    by,
    lid: prev ? prev.lid : newId(),
    data: sanitize(data)
  }
}

// Presets from the watch that the phone copy does not have are added at the end.
// Settings still at their defaults on the new phone copy take the watch values.
export function mergeData(phoneData, watchData) {
  const out = sanitize(phoneData)
  const watch = sanitize(watchData)
  watch.presets.forEach((p) => {
    if (!out.presets.some((x) => x.id === p.id)) out.presets.push(p)
  })
  if (JSON.stringify(out.settings) === JSON.stringify(DEFAULT_SETTINGS)) out.settings = watch.settings
  return sanitize(out)
}

export function readAck(str) {
  try {
    const ack = JSON.parse(str)
    return { wid: String(ack.wid || ''), seq: Number(ack.seq) || 0 }
  } catch (e) {
    return { wid: '', seq: 0 }
  }
}

// Ops for presets or locations that no longer exist (deleted on the phone) are skipped.
export function applyOps(data, ops) {
  const out = sanitize(data)
  ;(Array.isArray(ops) ? ops : []).forEach((op) => {
    if (!op) return
    const id = String(op.id)
    if (op.kind === 'open') {
      out.presets.forEach((p) => {
        const loc = p.locations.find((l) => l.id === id)
        if (loc) loc.open = !!op.open
      })
    } else if (op.kind === 'default') {
      if (out.presets.some((p) => p.id === id)) out.defaultId = id
    } else if (op.kind === 'setting') {
      if (id in out.settings) out.settings = cleanSettings({ ...out.settings, [id]: op.value })
    }
  })
  return out
}

// Only the latest value matters: an older op for the same location or setting,
// or an older default choice, is dropped, so the queue stays short.
export function queueOp(pending, op) {
  return pending
    .filter((p) => !(p.kind === op.kind && (op.kind === 'default' || p.id === op.id)))
    .concat([op])
}

export function lastSeq(ops) {
  return (Array.isArray(ops) ? ops : []).reduce((m, o) => Math.max(m, Number(o && o.seq) || 0), 0)
}

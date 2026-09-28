import { BaseSideService, settingsLib } from '@zeppos/zml/base-side'
import {
  STORAGE_KEY,
  ACK_KEY,
  readDoc,
  makeDoc,
  applyOps,
  mergeData,
  sanitize,
  readAck,
  lastSeq
} from '../utils/presets'

// The phone keeps a copy of the presets in settings storage so they can be
// edited in the Zepp app. The watch keeps its own copy and works fully offline.

function readPhoneDoc() {
  return readDoc(settingsLib.getItem(STORAGE_KEY))
}

function writePhoneDoc(prev, data) {
  const doc = makeDoc(prev, data, 'watch')
  settingsLib.setItem(STORAGE_KEY, JSON.stringify(doc))
  return doc
}

AppSideService(
  BaseSideService({
    onInit() {},

    onRequest(req, res) {
      const params = req.params || {}

      if (req.method === 'SYNC') {
        // The watch sends the changes it made since the phone last confirmed
        // (switched locations, a new default preset). They go on top of the
        // phone copy: for the same location the watch wins, everything else
        // edited in the Zepp app is kept.
        const wid = String(params.wid || '')
        const ops = Array.isArray(params.ops) ? params.ops : []
        const ack = readAck(settingsLib.getItem(ACK_KEY))
        const done = ack.wid === wid ? ack.seq : 0
        // Ops applied before whose reply never reached the watch come again; skip them.
        const fresh = ops.filter((op) => Number(op.seq) > done)

        let doc = readPhoneDoc()
        if (!doc) {
          // First run: the phone has no copy yet, take the watch data (its ops are already in it).
          doc = writePhoneDoc(null, params.data)
        } else {
          let data = doc.data
          let changed = false
          const watchData = sanitize(params.data)
          if (params.lid && params.lid !== doc.lid && watchData.presets.length) {
            // The watch data comes from an earlier phone copy that was lost:
            // add the watch presets to what was created here instead of dropping them.
            data = mergeData(data, watchData)
            changed = true
          }
          if (fresh.length) {
            data = applyOps(data, fresh)
            changed = true
          }
          if (changed) doc = writePhoneDoc(doc, data)
        }

        const seq = Math.max(done, lastSeq(ops))
        if (ack.wid !== wid || ack.seq !== seq) {
          settingsLib.setItem(ACK_KEY, JSON.stringify({ wid, seq }))
        }
        res(null, { rev: doc.rev, lid: doc.lid, data: doc.data, wid, ack: seq })
        return
      }

      res('unknown method')
    },

    onSettingsChange(e) {
      if (e && e.key && e.key !== STORAGE_KEY) return
      // Read the stored copy rather than e.newValue, so a late event never sends older data.
      const doc = readPhoneDoc()
      // Written by onRequest above: the watch got this data in the reply.
      if (!doc || doc.by === 'watch') return
      const ack = readAck(settingsLib.getItem(ACK_KEY))
      const sent = this.call({
        method: 'DATA',
        params: { rev: doc.rev, lid: doc.lid, data: doc.data, wid: ack.wid, ack: ack.seq }
      })
      // The watch app is closed or out of range: it picks the data up on its next sync.
      if (sent && sent.catch) sent.catch(() => {})
    },

    onRun() {},
    onDestroy() {}
  })
)

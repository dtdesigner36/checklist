import {
  createWidget,
  deleteWidget,
  widget,
  prop,
  align,
  text_style,
  getTextLayout,
  getImageInfo
} from '@zos/ui'
import {
  onGesture,
  offGesture,
  onKey,
  offKey,
  GESTURE_RIGHT,
  KEY_BACK,
  KEY_EVENT_CLICK
} from '@zos/interaction'
import { getDeviceInfo } from '@zos/device'
import { scrollTo } from '@zos/page'
import { setPageBrightTime, resetPageBrightTime } from '@zos/display'
import {
  Vibrator,
  SystemSounds,
  VIBRATOR_SCENE_SHORT_LIGHT,
  VIBRATOR_SCENE_SHORT_MIDDLE,
  VIBRATOR_SCENE_SHORT_STRONG
} from '@zos/sensor'
import { px } from '@zos/utils'
import { BasePage } from '@zeppos/zml/base-page'

import { newId, sanitize, defaultPreset, findLocation, applyOps } from '../../utils/presets'
import { readLocal, writeLocal, recordChange } from '../../utils/watch-store'

const { width: W } = getDeviceInfo()

// ---- look: watchOS 26 "Liquid Glass" on black (design width 480, scaled with px) ----

// Medium weight for names and titles; secondary text uses the system font.
const FONT_MEDIUM = 'fonts/NotoSans-Medium.ttf'

// zeus scales images for the screen, so their sizes are read at runtime.
function imageSize(path, w, h) {
  try {
    const info = getImageInfo(path)
    if (info && info.width && info.height) return info
  } catch (e) {}
  return { width: Math.floor((w * W) / 480), height: Math.floor((h * W) / 480) }
}

const CAP = imageSize('glass/row_top.png', 400, 48) // glass row top / bottom caps
const SWITCH = imageSize('switch_on.png', 86, 52)
const CHECK = imageSize('check.png', 34, 34)
const PILL = imageSize('glass/pill.png', 312, 88)
const EMPTY = imageSize('empty_lock.png', 120, 120)
const ICON = imageSize('ic_presets.png', 36, 36)

const ROW_W = CAP.width
const SIDE = Math.floor((W - ROW_W) / 2)
const ROW_R = px(30)
const ROW_GAP = px(10)
const RIM_W = px(2)
const PAD_L = px(24)
const PAD_R = px(20)
const SW_GAP = px(12)
const NAME_SIZE = px(32)
const STATUS_SIZE = px(28)
const STATUS_PULL = px(6)
const ROW_PAD_V = px(16)
const ROW_MIN_H = Math.max(px(112), CAP.height * 2)
const LIST_TOP = px(150)
const NAME_W = ROW_W - PAD_L - PAD_R - SWITCH.width - SW_GAP
const PRESET_NAME_W = ROW_W - PAD_L - PAD_R - CHECK.width - SW_GAP
const STATUS_H = Math.ceil(
  getTextLayout('Закрыто', { text_size: STATUS_SIZE, text_width: NAME_W, wrapped: 0 }).height ||
    STATUS_SIZE * 1.44
)

const C = {
  row: 0x2f2f31,
  rowPress: 0x4a4a4e,
  rowRim: 0x6a6a6c, // white 28% over the row fill, mixed in advance
  current: 0x234865, // the default preset: blue-tinted glass
  currentPress: 0x375c7a,
  currentRim: 0x617c90,
  text: 0xffffff,
  subRow: 0x9a9ba1, // secondary text on glass
  sub: 0x8e8e93, // secondary text on black
  open: 0xff9230,
  closed: 0x30d158,
  accent: 0x5cb8ff,
  chipOpen: 0x331d0a,
  chipClosed: 0x0a2a12
}

// Rows shown by the current view: fewer rows means the page got shorter.
function rowCount(data, view) {
  if (view === 'presets') return data.presets.length
  if (view === 'settings') return 3
  const preset = defaultPreset(data)
  return preset ? preset.locations.length : 0
}

function openSummary(locations) {
  const open = locations.filter((l) => l.open).length
  if (!locations.length) return { text: 'Нет локаций', color: C.subRow, chip: 0 }
  if (!open) return { text: 'Всё закрыто', color: C.closed, chip: C.chipClosed }
  return { text: `Открыто: ${open} из ${locations.length}`, color: C.open, chip: C.chipOpen }
}

function textWidth(text, size) {
  return Math.ceil(getTextLayout(text, { text_size: size, text_width: 0, wrapped: 0 }).width || 0)
}

// Breaks a name into at most `rows` lines by hand (words; letters for a word
// longer than the line) and ends the last one with "…" when the name does not fit.
// getTextLayout measures the system font but names are drawn in Medium, so the
// lines are fixed here: the row height then always matches what is drawn.
function wrapName(name, size, width, rows) {
  const fits = (s) => textWidth(s, size) <= width
  const lines = []
  let cur = ''
  for (let word of name.split(' ')) {
    if (!word) continue
    const t = cur ? cur + ' ' + word : word
    if (fits(t)) {
      cur = t
      continue
    }
    if (cur) lines.push(cur)
    while (word.length > 1 && !fits(word)) {
      let k = word.length - 1
      while (k > 1 && !fits(word.slice(0, k))) k--
      lines.push(word.slice(0, k))
      word = word.slice(k)
    }
    cur = word
  }
  if (cur) lines.push(cur)
  if (lines.length > rows) {
    let last = lines.slice(rows - 1).join(' ')
    while (last.length > 1 && !fits(last + '…')) last = last.slice(0, -1)
    lines.length = rows - 1
    lines.push(last.trimEnd() + '…')
  }
  return lines
}

function textHeight(text, size, width) {
  return Math.ceil(getTextLayout(text, { text_size: size, text_width: width, wrapped: 1 }).height || 0)
}

const VIBRATION_MODE = {
  light: VIBRATOR_SCENE_SHORT_LIGHT,
  medium: VIBRATOR_SCENE_SHORT_MIDDLE,
  strong: VIBRATOR_SCENE_SHORT_STRONG
}
const VIBRATION_NAME = { off: 'Выкл', light: 'Лёгкая', medium: 'Средняя', strong: 'Сильная' }
const VIBRATION_NEXT = { off: 'light', light: 'medium', medium: 'strong', strong: 'off' }

let vibrator = null
function buzz(level) {
  const mode = VIBRATION_MODE[level]
  if (mode === undefined) return // 'off'
  try {
    if (!vibrator) vibrator = new Vibrator()
    vibrator.stop()
    vibrator.start({ mode })
  } catch (e) {}
}

// Click on a switch. On this watch only system sounds reach the speaker (a file
// played through @zos/media stays silent), so the short camera-shutter sound is
// used. It plays only while system sounds are on in the watch settings.
let systemSounds = null
function clickSound() {
  try {
    if (!systemSounds) systemSounds = new SystemSounds()
    if (systemSounds.getEnabled()) systemSounds.start(systemSounds.getSourceType().CAMERA, 0)
  } catch (e) {}
}

// "Экран не гаснет": longer bright time for this page, capped so a watch lying
// face up does not stay lit for hours. Lowering the wrist still turns it off.
const KEEP_ON_MS = 10 * 60 * 1000

Page(
  BasePage({
    state: {
      data: sanitize(null), // what the watch shows: the phone copy plus pending ops
      pending: [], // watch changes the phone has not confirmed yet
      seq: 0,
      wid: '', // id of this watch install, so the phone can tell which ops it has seen
      lid: '', // id of the phone copy the data came from (see utils/presets.js)
      rev: 0, // newest phone copy seen while the page is open
      view: 'locations', // or 'presets', 'settings'
      syncing: false,
      syncAgain: false,
      retries: 0,
      retryTimer: null,
      pollTimer: null,
      renderQueued: false,
      scrollTop: false,
      screenKept: false,
      backHooked: false,
      destroyed: false,
      widgets: [],
      rows: {},
      title: null,
      chip: null,
      counter: null
    },

    onInit() {
      // The shortcut card may have switched locations since the page last ran.
      Object.assign(this.state, readLocal())
      if (!this.state.wid) {
        this.state.wid = newId()
        writeLocal(this.state)
      }
    },

    build() {
      // Large title, narrow enough to stay inside the round screen at this height.
      this.state.title = createWidget(widget.TEXT, {
        x: px(96),
        y: px(34),
        w: W - 2 * px(96),
        h: px(54),
        text: '',
        text_size: px(36),
        font: FONT_MEDIUM,
        color: C.text,
        align_h: align.CENTER_H,
        align_v: align.CENTER_V,
        text_style: text_style.ELLIPSIS
      })

      this.render()
      this.sync()
      // While the page stays open, check in once a minute: picks up an edit
      // from Zepp whose message got lost and sends ops the retries gave up on.
      this.state.pollTimer = setInterval(() => this.sync(), 60000)
    },

    onDestroy() {
      this.state.destroyed = true
      if (this.state.retryTimer) clearTimeout(this.state.retryTimer)
      if (this.state.pollTimer) clearInterval(this.state.pollTimer)
      if (this.state.screenKept) this.keepScreen(false)
      this.unhookBack()
      this.saveLocal()
    },

    // ---------- storage & sync ----------

    saveLocal() {
      writeLocal(this.state)
    },

    // Every change made on the watch becomes an op in state.pending. sync()
    // sends all pending ops; the phone applies them to its copy and replies
    // with the result. Ops the phone has not confirmed yet are re-applied on
    // top of everything that comes from the phone, so what was changed on the
    // watch while the phone was away wins, and other edits made in the Zepp
    // app are kept.
    sync() {
      if (this.state.destroyed) return
      if (this.state.syncing) {
        this.state.syncAgain = true
        return
      }
      this.state.syncing = true
      this.state.syncAgain = false
      if (this.state.retryTimer) {
        clearTimeout(this.state.retryTimer)
        this.state.retryTimer = null
      }
      const { wid, lid } = this.state
      const ops = this.state.pending.slice()
      this.request(
        { method: 'SYNC', params: { wid, lid, ops, data: this.state.data } },
        { timeout: 10000 }
      )
        .then((res) => {
          this.state.syncing = false
          this.state.retries = 0
          this.acceptPhone(res)
          if (this.state.syncAgain) this.sync()
        })
        .catch(() => {
          // No phone right now: the ops stay queued for the next sync.
          this.state.syncing = false
          if (this.state.syncAgain) this.sync()
          else this.retryLater()
        })
    },

    // A failed sync (phone app slow to start, lost message) is tried again a
    // few times while the page is open; a new connection starts over.
    retryLater() {
      if (this.state.destroyed || this.state.retryTimer || this.state.retries >= 3) return
      const delay = [3000, 10000, 30000][this.state.retries++]
      this.state.retryTimer = setTimeout(() => {
        this.state.retryTimer = null
        this.sync()
      }, delay)
    },

    // Data from the phone: { rev, lid, data, wid, ack }, where ack is the last
    // op seq of watch install wid that the phone has applied.
    acceptPhone(msg) {
      if (this.state.destroyed || !msg) return
      if (msg.wid === this.state.wid && msg.ack) {
        this.state.pending = this.state.pending.filter((op) => op.seq > msg.ack)
      }
      if (msg.lid && msg.lid !== this.state.lid) {
        // A new phone copy: its rev numbers start over.
        this.state.lid = msg.lid
        this.state.rev = 0
      }
      const rev = Number(msg.rev) || 0
      // An older copy than one already shown can arrive late; skip it.
      if (msg.data && rev >= this.state.rev) {
        this.state.rev = rev
        const next = applyOps(msg.data, this.state.pending)
        if (JSON.stringify(next) !== JSON.stringify(this.state.data)) {
          const { view } = this.state
          // The page got shorter: go back to the top rather than stay below the end.
          if (rowCount(next, view) < rowCount(this.state.data, view)) this.state.scrollTop = true
          this.state.data = next
          this.queueRender()
        }
      }
      this.saveLocal()
    },

    // Presets were edited in the Zepp app while this page is open.
    onCall(msg) {
      if (!msg || msg.method !== 'DATA' || !msg.params) return
      this.acceptPhone(msg.params)
      if (this.state.pending.length) this.sync()
    },

    // The phone is back after a break: send what was changed on the watch
    // meanwhile and pick up what was edited in the Zepp app.
    onBleChanged(connected) {
      if (!connected) return
      this.state.retries = 0
      setTimeout(() => this.sync(), 1000)
    },

    // ---------- actions ----------

    change(op) {
      recordChange(this.state, op)
    },

    toggle(id) {
      const loc = findLocation(this.state.data, id)
      if (!loc) return
      this.change({ kind: 'open', id, open: !loc.open })
      this.feedback()
      this.paintRow(id)
      this.updateHeader()
      this.sync()
    },

    selectPreset(id) {
      if (id !== this.state.data.defaultId) {
        this.change({ kind: 'default', id })
        this.sync()
      }
      this.showView('locations')
    },

    // Vibration and click sound on a switch, as set in the settings.
    feedback() {
      const { settings } = this.state.data
      buzz(settings.vibration)
      if (settings.sound) this.click()
    },

    changeSetting(key, value) {
      this.change({ kind: 'setting', id: key, value })
      if (key === 'vibration') buzz(value) // let the new strength be felt
      if (key === 'sound' && value) this.click() // and the click be heard
      this.applySettings()
      this.queueRender()
      this.sync()
    },

    // Settings that act on the device (the screen); vibration and sound are read on each switch.
    applySettings() {
      const keep = this.state.data.settings.keepScreen
      if (keep === this.state.screenKept) return
      this.state.screenKept = keep
      this.keepScreen(keep)
    },

    click() {
      clickSound()
    },

    keepScreen(on) {
      try {
        if (on) setPageBrightTime({ brightTime: KEEP_ON_MS })
        else resetPageBrightTime()
      } catch (e) {}
    },

    showView(view) {
      if (this.state.view === view) return
      this.state.view = view
      if (view !== 'locations') this.hookBack()
      else this.unhookBack()
      this.state.scrollTop = true
      this.queueRender()
    },

    // On the presets screen, swipe right and the back key return to the
    // locations instead of closing the app.
    hookBack() {
      if (this.state.backHooked) return
      this.state.backHooked = true
      const back = () => setTimeout(() => this.showView('locations'), 0)
      onGesture({
        callback: (event) => {
          if (event !== GESTURE_RIGHT) return false
          back()
          return true
        }
      })
      onKey({
        callback: (key, event) => {
          if (key !== KEY_BACK) return false
          if (event === KEY_EVENT_CLICK) back()
          return true
        }
      })
    },

    unhookBack() {
      if (!this.state.backHooked) return
      this.state.backHooked = false
      try {
        offGesture()
      } catch (e) {}
      try {
        offKey()
      } catch (e) {}
    },

    // ---------- rendering ----------

    clear() {
      this.state.widgets.forEach((w) => {
        try {
          deleteWidget(w)
        } catch (e) {}
      })
      this.state.widgets = []
      this.state.rows = {}
    },

    add(type, opts) {
      const w = createWidget(type, opts)
      this.state.widgets.push(w)
      return w
    },

    queueRender() {
      if (this.state.renderQueued) return
      this.state.renderQueued = true
      // Deferred so we never delete the widget whose callback is running.
      setTimeout(() => {
        this.state.renderQueued = false
        if (!this.state.destroyed) this.render()
      }, 10)
    },

    // Widget drawn over the row button: it must let taps through to it.
    overlay(type, opts) {
      const w = this.add(type, opts)
      w.setEnable(false)
      return w
    },

    // Header: large title plus a tinted status chip ("Открыто: 2 из 4" / "Всё закрыто").
    // The chip sits under the counter text, so both are drawn again on every change.
    updateHeader() {
      const { title, view, data } = this.state
      let text = ''
      let color = C.sub
      let chip = 0
      if (view === 'presets') {
        title.setProperty(prop.TEXT, 'Пресеты')
        text = 'Выберите основной'
      } else if (view === 'settings') {
        title.setProperty(prop.TEXT, 'Настройки')
        text = 'Меняются и в Zepp'
      } else {
        const preset = defaultPreset(data)
        title.setProperty(prop.TEXT, preset ? preset.name : 'Чеклист')
        if (preset && preset.locations.length) {
          const summary = openSummary(preset.locations)
          text = summary.text
          color = summary.color
          chip = summary.chip
        }
      }

      ;[this.state.chip, this.state.counter].forEach((w) => {
        if (!w) return
        try {
          deleteWidget(w)
        } catch (e) {}
      })
      this.state.chip = null
      this.state.counter = null
      if (chip) {
        const w = textWidth(text, px(26)) + 2 * px(18)
        this.state.chip = createWidget(widget.FILL_RECT, {
          x: Math.floor((W - w) / 2),
          y: px(94),
          w,
          h: px(40),
          radius: Math.floor(px(40) / 2),
          color: chip
        })
      }
      this.state.counter = createWidget(widget.TEXT, {
        x: 0,
        y: px(94),
        w: W,
        h: px(40),
        text,
        text_size: px(26),
        color,
        align_h: align.CENTER_H,
        align_v: align.CENTER_V
      })
    },

    paintRow(id) {
      const row = this.state.rows[id]
      const loc = findLocation(this.state.data, id)
      if (!row || !loc) return
      row.sw.setProperty(prop.SRC, loc.open ? 'switch_off.png' : 'switch_on.png')
      row.status.setProperty(prop.TEXT, loc.open ? 'Открыто' : 'Закрыто')
      row.status.setProperty(prop.COLOR, loc.open ? C.open : C.subRow)
    },

    render() {
      this.clear()
      this.updateHeader()
      this.applySettings()
      if (this.state.view === 'presets') this.renderPresets()
      else if (this.state.view === 'settings') this.renderSettings()
      else this.renderLocations()
      if (this.state.scrollTop) {
        this.state.scrollTop = false
        try {
          scrollTo({ y: 0 })
        } catch (e) {}
      }
    },

    // A glass row of any height: the button is the fill and the touch target,
    // the top and bottom caps carry the rim, edge and sheen, and 2 px strips
    // continue the rim along the sides between them.
    glassRow(y, h, current, onClick) {
      this.add(widget.BUTTON, {
        x: SIDE,
        y,
        w: ROW_W,
        h,
        radius: ROW_R,
        text: '',
        normal_color: current ? C.current : C.row,
        press_color: current ? C.currentPress : C.rowPress,
        click_func: onClick
      })
      this.overlay(widget.IMG, { x: SIDE, y, src: 'glass/row_top.png' })
      this.overlay(widget.IMG, { x: SIDE, y: y + h - CAP.height, src: 'glass/row_bot.png' })
      const mid = h - CAP.height * 2
      if (mid > 0) {
        const color = current ? C.currentRim : C.rowRim
        this.overlay(widget.FILL_RECT, { x: SIDE, y: y + CAP.height, w: RIM_W, h: mid, color })
        this.overlay(widget.FILL_RECT, {
          x: SIDE + ROW_W - RIM_W,
          y: y + CAP.height,
          w: RIM_W,
          h: mid,
          color
        })
      }
    },

    // Name (up to 3 lines, then "…") + status line; returns the text and heights to lay out.
    measure(name, width) {
      // Lines are measured px(4) narrower than the box and the box gets px(8) more
      // (rowTexts), so the Medium font never wraps a line again on its own.
      const text = wrapName(name, NAME_SIZE, width - px(4), 3).join('\n')
      const nameH = Math.max(textHeight(text, NAME_SIZE, width + px(8)), Math.ceil(NAME_SIZE * 1.44))
      const contentH = nameH + STATUS_H - STATUS_PULL
      return {
        text,
        nameH,
        contentH,
        h: Math.max(ROW_MIN_H, contentH + ROW_PAD_V * 2)
      }
    },

    rowTexts(y, m, width, status) {
      const top = y + Math.floor((m.h - m.contentH) / 2)
      this.overlay(widget.TEXT, {
        x: SIDE + PAD_L,
        y: top,
        w: width + px(8),
        h: m.nameH,
        text: m.text,
        text_size: NAME_SIZE,
        font: FONT_MEDIUM,
        color: C.text,
        align_h: align.LEFT,
        align_v: align.CENTER_V,
        text_style: text_style.WRAP
      })
      return this.overlay(widget.TEXT, {
        x: SIDE + PAD_L,
        y: top + m.nameH - STATUS_PULL,
        w: width,
        h: STATUS_H,
        text: status.text,
        text_size: STATUS_SIZE,
        color: status.color,
        align_h: align.LEFT,
        align_v: align.CENTER_V
      })
    },

    // Glass capsule button with an optional icon; returns the y below it.
    pillButton(y, label, icon, onClick) {
      this.add(widget.BUTTON, {
        x: Math.floor((W - PILL.width) / 2),
        y,
        w: PILL.width,
        h: PILL.height,
        text: '',
        normal_src: 'glass/pill.png',
        press_src: 'glass/pill_press.png',
        click_func: onClick
      })
      const tw = textWidth(label, px(32))
      const iconW = icon ? ICON.width + px(12) : 0
      const gx = Math.floor((W - (iconW + tw)) / 2)
      if (icon) {
        this.overlay(widget.IMG, {
          x: gx,
          y: y + Math.floor((PILL.height - ICON.height) / 2) - px(1),
          src: icon
        })
      }
      this.overlay(widget.TEXT, {
        x: gx + iconW,
        y,
        w: tw + px(12),
        h: PILL.height,
        text: label,
        text_size: px(32),
        font: FONT_MEDIUM,
        color: C.text,
        align_h: align.LEFT,
        align_v: align.CENTER_V
      })
      return y + PILL.height + ROW_GAP
    },

    // Glass lock, title and hint in place of an empty list; returns the y below it.
    emptyState(title, body) {
      const y0 = px(118)
      this.add(widget.IMG, { x: Math.floor((W - EMPTY.width) / 2), y: y0, src: 'empty_lock.png' })
      const titleY = y0 + EMPTY.height + px(18)
      const titleW = W - 2 * px(64)
      const titleH = Math.max(textHeight(title, px(32), titleW), px(46))
      this.add(widget.TEXT, {
        x: px(64),
        y: titleY,
        w: titleW,
        h: titleH,
        text: title,
        text_size: px(32),
        font: FONT_MEDIUM,
        color: C.text,
        align_h: align.CENTER_H,
        align_v: align.CENTER_V,
        text_style: text_style.WRAP
      })
      const bodyY = titleY + titleH + px(4)
      const bodyW = W - 2 * px(76)
      const bodyH = Math.max(textHeight(body, px(26), bodyW), px(38))
      this.add(widget.TEXT, {
        x: px(76),
        y: bodyY,
        w: bodyW,
        h: bodyH,
        text: body,
        text_size: px(26),
        color: C.sub,
        align_h: align.CENTER_H,
        align_v: align.CENTER_V,
        text_style: text_style.WRAP
      })
      return bodyY + bodyH + px(24)
    },

    // Bottom spacer so the last row can scroll above the round edge.
    spacer(y) {
      this.add(widget.FILL_RECT, { x: 0, y, w: W, h: px(120), color: 0x000000 })
    },

    renderLocations() {
      const { data } = this.state
      const preset = defaultPreset(data)

      if (!preset) {
        const y = this.emptyState('Пресетов пока нет', 'Создайте их\nв приложении Zepp\nна телефоне')
        this.spacer(this.pillButton(y, 'Настройки', null, () => this.showView('settings')))
        return
      }

      let y = LIST_TOP
      if (!preset.locations.length) {
        y = this.emptyState('Локаций нет', 'Добавьте их\nв приложении Zepp\nна телефоне')
      }

      preset.locations.forEach((loc) => {
        const m = this.measure(loc.name, NAME_W)
        // The whole row is the touch target: a tap anywhere flips the switch.
        this.glassRow(y, m.h, false, () => this.toggle(loc.id))
        const status = this.rowTexts(y, m, NAME_W, {
          text: loc.open ? 'Открыто' : 'Закрыто',
          color: loc.open ? C.open : C.subRow
        })
        const sw = this.overlay(widget.IMG, {
          x: SIDE + ROW_W - PAD_R - SWITCH.width,
          y: y + Math.floor((m.h - SWITCH.height) / 2),
          src: loc.open ? 'switch_off.png' : 'switch_on.png'
        })
        this.state.rows[loc.id] = { sw, status }
        y += m.h + ROW_GAP
      })

      y = this.pillButton(y + px(10), 'Пресеты', 'ic_presets.png', () => this.showView('presets'))
      y = this.pillButton(y, 'Настройки', null, () => this.showView('settings'))
      this.spacer(y)
    },

    renderSettings() {
      const { settings } = this.state.data
      const rows = [
        {
          name: 'Вибрация',
          status: { text: VIBRATION_NAME[settings.vibration], color: C.accent },
          onClick: () => this.changeSetting('vibration', VIBRATION_NEXT[settings.vibration])
        },
        {
          name: 'Звук',
          status: { text: settings.sound ? 'Щелчок' : 'Выключен', color: C.subRow },
          on: settings.sound,
          onClick: () => this.changeSetting('sound', !settings.sound)
        },
        {
          name: 'Экран не гаснет',
          status: { text: settings.keepScreen ? 'До 10 минут' : 'Выключено', color: C.subRow },
          on: settings.keepScreen,
          onClick: () => this.changeSetting('keepScreen', !settings.keepScreen)
        }
      ]
      let y = LIST_TOP
      rows.forEach((r) => {
        const m = this.measure(r.name, NAME_W)
        this.glassRow(y, m.h, false, r.onClick)
        this.rowTexts(y, m, NAME_W, r.status)
        if (r.on !== undefined) {
          this.overlay(widget.IMG, {
            x: SIDE + ROW_W - PAD_R - SWITCH.width,
            y: y + Math.floor((m.h - SWITCH.height) / 2),
            src: r.on ? 'switch_on.png' : 'switch_off.png'
          })
        }
        y += m.h + ROW_GAP
      })
      this.spacer(y)
    },

    renderPresets() {
      const { data } = this.state
      let y = LIST_TOP

      data.presets.forEach((p) => {
        const isDefault = p.id === data.defaultId
        const m = this.measure(p.name, PRESET_NAME_W)
        this.glassRow(y, m.h, isDefault, () => this.selectPreset(p.id))
        this.rowTexts(
          y,
          m,
          PRESET_NAME_W,
          isDefault ? { text: 'По умолчанию', color: C.accent } : openSummary(p.locations)
        )
        if (isDefault) {
          this.overlay(widget.IMG, {
            x: SIDE + ROW_W - PAD_R - CHECK.width,
            y: y + Math.floor((m.h - CHECK.height) / 2),
            src: 'check.png'
          })
        }
        y += m.h + ROW_GAP
      })

      this.spacer(y)
    }
  })
)

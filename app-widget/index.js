import {
  createWidget,
  deleteWidget,
  widget,
  align,
  text_style,
  getTextLayout,
  getAppWidgetSize,
  setAppWidgetSize
} from '@zos/ui'
import { getDeviceInfo } from '@zos/device'
import { push } from '@zos/router'
import { px } from '@zos/utils'

import { defaultPreset } from '../utils/presets'
import { readLocal } from '../utils/watch-store'

// Shortcut card: how many locations of the default preset are open and closed.
// A tap anywhere on the card opens the app.

const FONT_MEDIUM = 'fonts/NotoSans-Medium.ttf'
const APP_PAGE = 'page/home/index.page'

const PAD = px(20)
const CHIP_H = px(36)
const CHIP_GAP = px(10)

const C = {
  card: 0x1c1c1e,
  cardPress: 0x2c2c2e,
  text: 0xffffff,
  sub: 0x8e8e93,
  open: 0xff9230,
  closed: 0x30d158,
  chipOpen: 0x331d0a,
  chipClosed: 0x0a2a12,
  chipNone: 0x2c2c2e
}

function textWidth(text, size) {
  return Math.ceil(getTextLayout(text, { text_size: size, text_width: 0, wrapped: 0 }).width || 0)
}

AppWidget({
  state: {
    widgets: []
  },

  build() {
    this.render()
  },

  // The app may have changed the data while the card was out of focus.
  onResume() {
    this.render()
  },

  openApp() {
    try {
      push({ url: APP_PAGE })
    } catch (e) {}
  },

  add(type, opts) {
    const w = createWidget(type, opts)
    this.state.widgets.push(w)
    return w
  },

  // Drawn over the card button: lets taps through to it.
  overlay(type, opts) {
    const w = this.add(type, opts)
    w.setEnable(false)
    return w
  },

  render() {
    try {
      this.draw()
    } catch (e) {
      console.log('card render error', e)
    }
  },

  draw() {
    this.state.widgets.forEach((w) => {
      try {
        deleteWidget(w)
      } catch (e) {}
    })
    this.state.widgets = []

    const { data } = readLocal()
    const preset = defaultPreset(data)
    const locations = preset ? preset.locations : []
    const open = locations.filter((l) => l.open).length
    const closed = locations.length - open

    const size = getAppWidgetSize() || {}
    const screen = getDeviceInfo()
    const w = size.w || screen.width - px(40)
    const h = Math.max(Math.ceil(screen.height * 0.2), px(118))
    setAppWidgetSize({ h })
    // On the watch, x is measured from the screen edge (the official card template
    // centres on the screen width too), so the card is centred on the screen.
    const x0 = Math.floor((screen.width - w) / 2)

    // The whole card is one button.
    this.add(widget.BUTTON, {
      x: x0,
      y: 0,
      w,
      h,
      radius: size.radius || px(28),
      text: '',
      normal_color: C.card,
      press_color: C.cardPress,
      click_func: () => this.openApp()
    })

    const chevronW = px(28)
    this.overlay(widget.TEXT, {
      x: x0 + w - PAD - chevronW,
      y: 0,
      w: chevronW,
      h,
      text: '›',
      text_size: px(44),
      color: C.sub,
      align_h: align.CENTER_H,
      align_v: align.CENTER_V
    })

    const top = Math.floor((h - px(42) - px(8) - CHIP_H) / 2)
    this.overlay(widget.TEXT, {
      x: x0 + PAD,
      y: top,
      w: w - PAD * 2 - chevronW,
      h: px(42),
      text: preset ? preset.name : 'Чеклист',
      text_size: px(30),
      font: FONT_MEDIUM,
      color: C.text,
      align_h: align.LEFT,
      align_v: align.CENTER_V,
      text_style: text_style.ELLIPSIS
    })

    const chipY = top + px(42) + px(8)
    if (!locations.length) {
      this.overlay(widget.TEXT, {
        x: x0 + PAD,
        y: chipY,
        w: w - PAD * 2 - chevronW,
        h: CHIP_H,
        text: preset ? 'Нет локаций' : 'Создайте пресет в Zepp',
        text_size: px(24),
        color: C.sub,
        align_h: align.LEFT,
        align_v: align.CENTER_V
      })
      return
    }

    let x = x0 + PAD
    ;[
      { text: `Открыто ${open}`, color: open ? C.open : C.sub, fill: open ? C.chipOpen : C.chipNone },
      { text: `Закрыто ${closed}`, color: C.closed, fill: C.chipClosed }
    ].forEach((chip) => {
      const cw = textWidth(chip.text, px(24)) + px(28)
      this.overlay(widget.FILL_RECT, {
        x,
        y: chipY,
        w: cw,
        h: CHIP_H,
        radius: Math.floor(CHIP_H / 2),
        color: chip.fill
      })
      this.overlay(widget.TEXT, {
        x,
        y: chipY,
        w: cw,
        h: CHIP_H,
        text: chip.text,
        text_size: px(24),
        color: chip.color,
        align_h: align.CENTER_H,
        align_v: align.CENTER_V
      })
      x += cw + CHIP_GAP
    })
  }
})
